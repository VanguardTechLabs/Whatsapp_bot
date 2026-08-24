import OpenAI from "openai";
import { loadPersona, buildSystemPrompt, buildTurnoSistema, buildUserPrompt, nuevaValla, RESPONSE_SCHEMA } from "./prompt.js";
import { generarSimulado } from "./simulado.js";
import { claveEfectiva, modeloEfectivo } from "./ajustes.js";
import { contextoParaPrompt } from "./clientes.js";
import { parsearParcial } from "./jsonParcial.js";
import { limpiarDatos, limpiarRespuesta, limpiarTexto, precioNoAutorizado } from "./limpiar.js";

/**
 * Quita las respuestas que llevan un precio sin que ella lo haya autorizado.
 *
 * Es la ultima linea: el prompt ya se lo dice, pero un cliente que imita el
 * formato de las instrucciones dentro de su mensaje sigue colandolo parte de
 * las veces, y "nunca un precio" no puede depender de eso.
 */
function filtrarPrecio(respuestas, precioAutorizado) {
  const limpias = [];
  let quitadas = 0;
  for (const r of respuestas ?? []) {
    if (precioNoAutorizado(r?.texto, precioAutorizado) || precioNoAutorizado(r?.espanol, precioAutorizado)) {
      quitadas++;
      continue;
    }
    limpias.push(r);
  }
  return { limpias, quitadas };
}

const AVISO_INYECCION =
  "Ojo: el mensaje de este cliente intentaba colar un precio, como si lo hubieras autorizado tu. " +
  "Se han descartado las respuestas que lo repetian. Lee su mensaje entero antes de contestarle.";

const REASONING_EFFORT = (process.env.REASONING_EFFORT || "").trim();

/** MOCK=1 -> no se llama a la API, se devuelven textos de ejemplo. */
export const MODO_SIMULADO = process.env.MOCK === "1";

/**
 * Si la clave no sirve (caducada, mal copiada, sin saldo), en vez de dejar la
 * pantalla en blanco se pasa solo al modo simulado y se explica por que.
 * Poner FALLBACK_SIMULADO=0 para desactivarlo y que muestre error a secas.
 */
const FALLBACK = process.env.FALLBACK_SIMULADO !== "0";

/** Los modelos de razonamiento aceptan `reasoning_effort`; el resto lo rechaza. */
const esModeloDeRazonamiento = (m) => /^(gpt-5|o[0-9])/.test(m);

/**
 * El cliente se cachea por clave: si la usuaria cambia la clave desde la web,
 * la siguiente peticion crea uno nuevo sin reiniciar el servidor.
 */
const clientes = new Map();
function getCliente(clave) {
  const baseURL = process.env.OPENAI_BASE_URL || "";
  const cacheKey = clave + "|" + baseURL;
  if (!clientes.has(cacheKey)) {
    clientes.set(
      cacheKey,
      new OpenAI({
        apiKey: clave || "local",
        timeout: 90_000,
        maxRetries: 1,
        // Permite apuntar a un servidor compatible (por ejemplo Ollama en local):
        //   OPENAI_BASE_URL=http://localhost:11434/v1
        ...(baseURL ? { baseURL } : {}),
      })
    );
  }
  return clientes.get(cacheKey);
}

/** Error con codigo legible para que la capa HTTP decida el status. */
export class ErrorGeneracion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/**
 * Errores que no se arreglan reintentando: hay que tocar la clave, el saldo o el
 * modelo. Son los unicos casos en los que tiene sentido caer al modo simulado.
 * Un corte de red o un 429 pasajero NO entran aqui: ahi conviene reintentar.
 */
function esProblemaDeConfiguracion(err) {
  if (err instanceof OpenAI.AuthenticationError) return true;
  if (err instanceof OpenAI.PermissionDeniedError) return true;
  if (err instanceof OpenAI.NotFoundError) return true;
  if (err instanceof OpenAI.BadRequestError) return true; // modelo incompatible
  if (err instanceof OpenAI.RateLimitError) return /credit|billing|quota/i.test(err?.message ?? "");
  return false;
}

export async function generarRespuestas({ mensaje, situacion = null, notas = "", precio = "", clienteId = "", modo = "responder", idioma = "en" }) {
  if (MODO_SIMULADO) return generarSimulado({ mensaje, situacion });

  try {
    return await generarConAPI({ mensaje, situacion, notas, precio, clienteId, modo, idioma });
  } catch (err) {
    if (!FALLBACK || !esProblemaDeConfiguracion(err)) throw err;

    const { mensaje: motivo } = traducirError(err);
    console.warn("[fallback] Se pasa a modo simulado:", motivo);

    const simulado = await generarSimulado({ mensaje, situacion });
    simulado._meta.motivo_fallback = motivo;
    return simulado;
  }
}

async function generarConAPI({ mensaje, situacion, notas, precio, clienteId, modo, idioma }) {
  const persona = loadPersona();
  const modelo = modeloEfectivo();
  const t0 = Date.now();
  const valla = nuevaValla();
  // En modo "escribir" el texto lo teclea ella, asi que una cifra suya no es una
  // inyeccion: si escribe "dile que son 30 dolares" sin marcar la casilla, el
  // filtro le tiraba las tres respuestas y le hablaba de un cliente inexistente.
  const autorizacion = precio || (modo === "escribir" ? mensaje : "");

  const params = {
    model: modelo,
    // En los modelos de razonamiento los tokens de pensamiento tambien cuentan
    // aqui, asi que se deja margen para que no se corte la respuesta.
    max_completion_tokens: 8000,
    messages: [
      // 1. La persona. Estable entre peticiones, para que se pueda cachear.
      { role: "system", content: buildSystemPrompt(persona) },
      // 2. Lo que manda en esta peticion. Viene de ella, es de fiar.
      {
        role: "system",
        content: buildTurnoSistema({
          message: mensaje,
          situation: situacion,
          notes: notas,
          precio,
          contexto: clienteId ? contextoParaPrompt(clienteId) : "",
          modo,
          idioma,
          valla,
        }),
      },
      // 3. El texto del cliente, vallado y sin autoridad ninguna.
      { role: "user", content: buildUserPrompt({ message: mensaje, modo, valla }) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "respuesta_asistente",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  };
  if (REASONING_EFFORT && esModeloDeRazonamiento(modelo)) {
    params.reasoning_effort = REASONING_EFFORT;
  }

  const completion = await getCliente(claveEfectiva()).chat.completions.create(params);
  const choice = completion.choices?.[0];

  if (choice?.message?.refusal) {
    throw new ErrorGeneracion(
      "rechazado",
      "El modelo no ha podido responder a este mensaje. Prueba a reformularlo o responde tu manualmente."
    );
  }
  if (choice?.finish_reason === "length") {
    throw new ErrorGeneracion("truncado", "La respuesta se corto por longitud. Reintenta.");
  }

  const bruto = choice?.message?.content;
  if (!bruto) throw new ErrorGeneracion("vacio", "Respuesta vacia del modelo.");

  const data = limpiarDatos(JSON.parse(bruto));
  const filtrado = filtrarPrecio((data.respuestas ?? []).slice(0, 3), autorizacion);
  data.respuestas = filtrado.limpias;
  if (filtrado.quitadas) data.aviso = AVISO_INYECCION;
  if (data.respuestas.length === 0) {
    if (filtrado.quitadas) throw new ErrorGeneracion("inyeccion", AVISO_INYECCION);
    throw new ErrorGeneracion("vacio", "El modelo no devolvio ninguna respuesta.");
  }

  const u = completion.usage ?? {};
  data._meta = {
    ms: Date.now() - t0,
    modelo: completion.model,
    tokens_entrada: u.prompt_tokens ?? null,
    tokens_salida: u.completion_tokens ?? null,
    cache_leida: u.prompt_tokens_details?.cached_tokens ?? 0,
  };

  return data;
}

/* ------------------------------------------------------------ en directo --- */

/**
 * Igual que generarRespuestas, pero va soltando lo que ya esta listo en vez de
 * esperar al final. La traduccion aparece enseguida y cada respuesta en cuanto
 * se termina de escribir: el tiempo total es parecido, pero la espera no.
 *
 * `emitir` recibe objetos { t: "traduccion" | "situacion" | "respuesta" | ... }.
 * Devuelve el resultado completo, para poder guardarlo en la memoria.
 */
export async function generarRespuestasEnDirecto(opciones, emitir) {
  const { mensaje, situacion = null, notas = "", precio = "", clienteId = "", modo = "responder", idioma = "en" } = opciones;

  if (MODO_SIMULADO) return await emitirSimulado({ mensaje, situacion }, emitir);

  try {
    return await conAPIEnDirecto({ mensaje, situacion, notas, precio, clienteId, modo, idioma }, emitir);
  } catch (err) {
    if (!FALLBACK || !esProblemaDeConfiguracion(err)) throw err;
    const { mensaje: motivo } = traducirError(err);
    console.warn("[fallback] Se pasa a modo simulado:", motivo);
    return await emitirSimulado({ mensaje, situacion }, emitir, motivo);
  }
}

/** Manda un resultado ya hecho (modo de prueba) con la misma forma de eventos. */
async function emitirSimulado(opciones, emitir, motivo) {
  const datos = await generarSimulado(opciones);
  if (motivo) datos._meta.motivo_fallback = motivo;

  emitir({ t: "traduccion", texto: datos.mensaje_en_espanol });
  emitir({ t: "situacion", situacion: datos.situacion, idioma: datos.idioma_cliente, motivo: datos.motivo_situacion });
  datos.respuestas.forEach((r, i) => emitir({ t: "respuesta", i, ...r }));
  emitir({ t: "fin", _meta: datos._meta });
  return datos;
}

async function conAPIEnDirecto({ mensaje, situacion, notas, precio, clienteId, modo, idioma }, emitir) {
  const persona = loadPersona();
  const modelo = modeloEfectivo();
  const t0 = Date.now();
  const valla = nuevaValla();
  // En modo "escribir" el texto lo teclea ella, asi que una cifra suya no es una
  // inyeccion: si escribe "dile que son 30 dolares" sin marcar la casilla, el
  // filtro le tiraba las tres respuestas y le hablaba de un cliente inexistente.
  const autorizacion = precio || (modo === "escribir" ? mensaje : "");

  const params = {
    model: modelo,
    max_completion_tokens: 8000,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: buildSystemPrompt(persona) },
      {
        role: "system",
        content: buildTurnoSistema({
          message: mensaje,
          situation: situacion,
          notes: notas,
          precio,
          contexto: clienteId ? contextoParaPrompt(clienteId) : "",
          modo,
          idioma,
          valla,
        }),
      },
      { role: "user", content: buildUserPrompt({ message: mensaje, modo, valla }) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "respuesta_asistente", strict: true, schema: RESPONSE_SCHEMA },
    },
  };
  if (REASONING_EFFORT && esModeloDeRazonamiento(modelo)) params.reasoning_effort = REASONING_EFFORT;

  const flujo = await getCliente(claveEfectiva()).chat.completions.create(params);

  let bruto = "";
  let uso = null;
  let modeloReal = modelo;

  // Lo que ya se ha mandado, para no repetirlo.
  let traduccionEnviada = false;
  let situacionEnviada = false;
  let precioColado = false;
  let emitidas = 0;
  const respuestasEnviadas = new Set();

  for await (const trozo of flujo) {
    if (trozo.usage) uso = trozo.usage;
    if (trozo.model) modeloReal = trozo.model;

    const delta = trozo.choices?.[0]?.delta?.content;
    if (!delta) continue;
    bruto += delta;

    const parcial = parsearParcial(bruto);
    if (!parcial) continue;

    if (!traduccionEnviada && parcial.mensaje_en_espanol) {
      // Solo cuando la frase ya esta cerrada, para no mostrarla a trozos.
      if (bruto.includes('"situacion"') || bruto.includes('"motivo_situacion"')) {
        traduccionEnviada = true;
        emitir({ t: "traduccion", texto: limpiarTexto(parcial.mensaje_en_espanol) });
      }
    }
    if (!situacionEnviada && parcial.motivo_situacion && parcial.situacion) {
      if (bruto.includes('"detalle_para_recordar"') || bruto.includes('"respuestas"')) {
        situacionEnviada = true;
        emitir({
          t: "situacion",
          situacion: parcial.situacion,
          idioma: parcial.idioma_cliente ?? "",
          motivo: limpiarTexto(parcial.motivo_situacion),
        });
      }
    }

    for (const [i, r] of (parcial.respuestas ?? []).entries()) {
      // Completa = tiene los tres campos. El ultimo puede estar a medias.
      if (respuestasEnviadas.has(i) || !r?.etiqueta || !r?.texto || !r?.espanol) continue;
      const esUltima = i === parcial.respuestas.length - 1;
      if (esUltima && !bruto.trimEnd().endsWith("}") && !bruto.includes(`"espanol"`, bruto.lastIndexOf(r.espanol))) continue;
      respuestasEnviadas.add(i);
      const limpia = limpiarRespuesta(r);
      // Se comprueba ANTES de mandarla a pantalla: una vez emitida, ella ya la
      // ha visto y podria copiarla.
      if (precioNoAutorizado(limpia.texto, autorizacion) || precioNoAutorizado(limpia.espanol, autorizacion)) {
        precioColado = true;
        continue;
      }
      emitir({ t: "respuesta", i: emitidas, etiqueta: limpia.etiqueta, texto: limpia.texto, espanol: limpia.espanol });
      emitidas++;
    }
  }

  const datos = limpiarDatos(JSON.parse(bruto));
  datos.respuestas = (datos.respuestas ?? []).slice(0, 3);
  if (datos.respuestas.length === 0) {
    throw new ErrorGeneracion("vacio", "El modelo no devolvio ninguna respuesta.");
  }

  // Por si algo no llego a emitirse durante el flujo.
  if (!traduccionEnviada) emitir({ t: "traduccion", texto: datos.mensaje_en_espanol });
  if (!situacionEnviada) {
    emitir({
      t: "situacion",
      situacion: datos.situacion,
      idioma: datos.idioma_cliente,
      motivo: datos.motivo_situacion,
    });
  }
  datos.respuestas.forEach((r, i) => {
    if (respuestasEnviadas.has(i)) return;
    if (precioNoAutorizado(r?.texto, autorizacion) || precioNoAutorizado(r?.espanol, autorizacion)) {
      precioColado = true;
      return;
    }
    emitir({ t: "respuesta", i: emitidas, ...r });
    emitidas++;
  });

  // Si se ha colado un precio, ella tiene que enterarse: puede que el cliente
  // este intentando fijar una cifra que ella no ha puesto.
  if (precioColado) {
    datos.respuestas = filtrarPrecio(datos.respuestas, autorizacion).limpias;
    if (emitidas === 0) throw new ErrorGeneracion("inyeccion", AVISO_INYECCION);
    emitir({ t: "aviso", mensaje: AVISO_INYECCION });
  }

  datos._meta = {
    ms: Date.now() - t0,
    modelo: modeloReal,
    tokens_entrada: uso?.prompt_tokens ?? null,
    tokens_salida: uso?.completion_tokens ?? null,
    cache_leida: uso?.prompt_tokens_details?.cached_tokens ?? 0,
  };
  emitir({ t: "fin", _meta: datos._meta });

  return datos;
}

/**
 * Comprueba una clave haciendo una peticion minima de verdad.
 * Es la unica forma de detectar "sin saldo": listar modelos funciona aunque el
 * saldo sea cero.
 */
export async function probarClave(clave) {
  const modelo = modeloEfectivo();
  await getCliente(clave).chat.completions.create({
    model: modelo,
    max_completion_tokens: 16,
    messages: [{ role: "user", content: "ping" }],
  });
  return { ok: true, modelo };
}

/**
 * Modelos de chat disponibles en la cuenta, para el desplegable de Ajustes.
 *
 * Se dejan fuera los que no sirven para esto: los de voz/imagen, y la familia
 * gpt-3.5, que no admite `json_schema` y romperia la app si se eligiera.
 */
export async function listarModelos(clave) {
  const nombres = [];
  for await (const m of getCliente(clave).models.list()) nombres.push(m.id);
  return nombres
    .filter((n) => /^(gpt-[0-9]|o[0-9])/.test(n))
    .filter((n) => !/(audio|realtime|image|transcribe|tts|search|codex)/.test(n))
    .filter((n) => !/^gpt-3/.test(n))
    .sort();
}

/** Traduce un error del SDK a { status, mensaje } para la respuesta HTTP. */
export function traducirError(err) {
  if (err instanceof ErrorGeneracion) {
    if (err.codigo === "rechazado") return { status: 422, mensaje: err.message };
    return { status: 502, mensaje: err.message };
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return {
      status: 400,
      mensaje:
        "La clave no es valida. Comprueba que la copiaste entera, desde sk- hasta el final, sin espacios.",
    };
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return { status: 400, mensaje: "La cuenta no tiene acceso a este modelo. Prueba con otro modelo." };
  }
  if (err instanceof OpenAI.NotFoundError) {
    return {
      status: 400,
      mensaje: `El modelo "${modeloEfectivo()}" no existe en esta cuenta. Elige otro en la lista.`,
    };
  }
  if (err instanceof OpenAI.BadRequestError) {
    return {
      status: 400,
      mensaje: `El modelo "${modeloEfectivo()}" no sirve para esto: no admite el formato de respuesta que necesita el asistente. Elige otro en Ajustes (gpt-5 o gpt-5-mini funcionan).`,
    };
  }
  if (err instanceof OpenAI.RateLimitError) {
    const sinSaldo = /credit|billing|quota/i.test(err?.message ?? "");
    return {
      status: sinSaldo ? 402 : 429,
      mensaje: sinSaldo
        ? "La clave funciona, pero la cuenta esta a cero. Entra en platform.openai.com, apartado Billing, y compra saldo (con 5 dolares sobra)."
        : "Demasiadas peticiones seguidas. Espera unos segundos y reintenta.",
    };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return { status: 504, mensaje: "Sin conexion con el servidor de la IA. Reintenta." };
  }
  if (err instanceof SyntaxError) {
    return { status: 502, mensaje: "La IA devolvio un formato inesperado. Reintenta." };
  }
  return { status: 500, mensaje: "Error inesperado generando la respuesta." };
}
