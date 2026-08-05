import OpenAI from "openai";
import { loadPersona, buildSystemPrompt, buildUserPrompt, RESPONSE_SCHEMA } from "./prompt.js";
import { generarSimulado } from "./simulado.js";
import { claveEfectiva, modeloEfectivo } from "./ajustes.js";

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

export async function generarRespuestas({ mensaje, situacion = null, notas = "", precio = "" }) {
  if (MODO_SIMULADO) return generarSimulado({ mensaje, situacion });

  try {
    return await generarConAPI({ mensaje, situacion, notas, precio });
  } catch (err) {
    if (!FALLBACK || !esProblemaDeConfiguracion(err)) throw err;

    const { mensaje: motivo } = traducirError(err);
    console.warn("[fallback] Se pasa a modo simulado:", motivo);

    const simulado = await generarSimulado({ mensaje, situacion });
    simulado._meta.motivo_fallback = motivo;
    return simulado;
  }
}

async function generarConAPI({ mensaje, situacion, notas, precio }) {
  const persona = loadPersona();
  const modelo = modeloEfectivo();
  const t0 = Date.now();

  const params = {
    model: modelo,
    // En los modelos de razonamiento los tokens de pensamiento tambien cuentan
    // aqui, asi que se deja margen para que no se corte la respuesta.
    max_completion_tokens: 8000,
    messages: [
      { role: "system", content: buildSystemPrompt(persona) },
      { role: "user", content: buildUserPrompt({ message: mensaje, situation: situacion, notes: notas, precio }) },
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

  const data = JSON.parse(bruto);
  data.respuestas = (data.respuestas ?? []).slice(0, 3);
  if (data.respuestas.length === 0) {
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
