/**
 * Clientes y memoria de conversacion.
 *
 * Guarda, por cada cliente, quien es, los detalles que va soltando y las
 * ultimas cosas que se han dicho. Con eso el asistente deja de tratar cada
 * mensaje como si fuera el primero.
 *
 * Se guarda en clientes.json dentro de DATA_DIR, igual que el resto de
 * ajustes: fuera de git. En el servidor DATA_DIR apunta fuera del repositorio,
 * para que actualizar el codigo no borre las conversaciones.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { rutaDatos } from "./datos.js";

const fichero = rutaDatos("clientes.json");

/** Cuantos mensajes recientes se le pasan al modelo. */
export const MAX_HISTORIAL = 12;
/** Cuantos se guardan en disco (para que ella pueda leerlos). */
const MAX_GUARDADO = 60;
/** Detalles recordados por cliente. */
const MAX_DETALLES = 25;

function leerTodo() {
  try {
    const d = JSON.parse(fs.readFileSync(fichero, "utf8"));
    return Array.isArray(d.clientes) ? d : { clientes: [] };
  } catch {
    return { clientes: [] };
  }
}

function guardarTodo(datos) {
  const tmp = fichero + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, fichero);
}

/* ------------------------------------------------------------------ leer --- */

/** Lista ligera para el desplegable: sin historial, que puede ser largo. */
export function listarClientes() {
  return leerTodo()
    .clientes.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      etiqueta: c.etiqueta ?? "",
      mensajes: c.historial?.length ?? 0,
      actualizado: c.actualizado,
    }))
    .sort((a, b) => String(b.actualizado ?? "").localeCompare(String(a.actualizado ?? "")));
}

export function obtenerCliente(id) {
  return leerTodo().clientes.find((c) => c.id === id) ?? null;
}

/* --------------------------------------------------------------- escribir --- */

export function crearCliente({ nombre, etiqueta = "" }) {
  const datos = leerTodo();
  const cliente = {
    id: crypto.randomUUID(),
    nombre: String(nombre ?? "").trim() || "Sin nombre",
    etiqueta: String(etiqueta ?? "").trim(),
    detalles: [],
    historial: [],
    creado: new Date().toISOString(),
    actualizado: new Date().toISOString(),
  };
  datos.clientes.push(cliente);
  guardarTodo(datos);
  return cliente;
}

export function actualizarCliente(id, cambios) {
  const datos = leerTodo();
  const c = datos.clientes.find((x) => x.id === id);
  if (!c) return null;

  if (typeof cambios.nombre === "string") c.nombre = cambios.nombre.trim() || c.nombre;
  if (typeof cambios.etiqueta === "string") c.etiqueta = cambios.etiqueta.trim();
  if (Array.isArray(cambios.detalles)) {
    c.detalles = cambios.detalles.map((d) => String(d).trim()).filter(Boolean).slice(0, MAX_DETALLES);
  }
  c.actualizado = new Date().toISOString();

  guardarTodo(datos);
  return c;
}

export function borrarCliente(id) {
  const datos = leerTodo();
  const antes = datos.clientes.length;
  datos.clientes = datos.clientes.filter((c) => c.id !== id);
  if (datos.clientes.length === antes) return false;
  guardarTodo(datos);
  return true;
}

/** Añade un mensaje al historial. `de` es "cliente" o "maiko". */
export function anotarMensaje(id, de, texto) {
  const datos = leerTodo();
  const c = datos.clientes.find((x) => x.id === id);
  if (!c || !texto) return null;

  c.historial = c.historial ?? [];

  // Al pulsar "generar otras respuestas" llega el mismo mensaje otra vez.
  // Si se apuntara, el modelo creeria que el cliente se ha repetido.
  const limpio = String(texto).slice(0, 2000);
  const ultimo = c.historial[c.historial.length - 1];
  if (ultimo && ultimo.de === de && ultimo.texto === limpio) return c;

  c.historial.push({ de, texto: limpio, cuando: new Date().toISOString() });
  if (c.historial.length > MAX_GUARDADO) c.historial = c.historial.slice(-MAX_GUARDADO);
  c.actualizado = new Date().toISOString();

  guardarTodo(datos);
  return c;
}

/**
 * Vacia la conversacion de un cliente: se olvida lo hablado y los detalles,
 * pero el cliente sigue existiendo. Para empezar de cero con la misma persona.
 */
export function borrarConversacion(id) {
  const datos = leerTodo();
  const c = datos.clientes.find((x) => x.id === id);
  if (!c) return null;

  c.historial = [];
  c.detalles = [];
  c.actualizado = new Date().toISOString();

  guardarTodo(datos);
  return c;
}

/**
 * Reduce una frase a las palabras que llevan el significado, para poder
 * comparar dos maneras de contar lo mismo.
 *
 * "Su hermana ha tenido un bebe por primera vez y el es tio" y "Su hermana
 * acaba de tener un bebe y es su primer sobrino" son el mismo dato escrito
 * distinto. Comparando el texto entero nunca coinciden.
 */
const VACIAS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "y", "o",
  "que", "se", "su", "sus", "es", "ha", "han", "he", "por", "para", "con", "sin", "en",
  "lo", "le", "les", "me", "mi", "te", "tu", "muy", "mas", "ya", "acaba", "acaban", "vez",
  "primera", "primer", "hace", "hacer", "tiene", "tener", "tenido", "esta", "estan", "ser",
]);

function huellaDetalle(texto) {
  return new Set(
    String(texto)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((p) => p.length > 2 && !VACIAS.has(p))
  );
}

/** Cuanto se parecen dos detalles, de 0 a 1 (Jaccard sobre palabras con peso). */
function parecido(a, b) {
  const A = huellaDetalle(a);
  const B = huellaDetalle(b);
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const p of A) if (B.has(p)) comunes++;
  return comunes / Math.min(A.size, B.size);
}

/** Guarda un detalle nuevo, sin repetir los que ya estaban. */
export function anotarDetalle(id, detalle) {
  const limpio = String(detalle ?? "").trim();
  if (!limpio) return null;

  const datos = leerTodo();
  const c = datos.clientes.find((x) => x.id === id);
  if (!c) return null;

  c.detalles = c.detalles ?? [];
  // Antes se comparaba el texto entero: cuando el mensaje nuevo no traia nada
  // nuevo, el modelo reextraia un dato viejo del historial con otras palabras y
  // entraba como si fuera otro. Con MAX_DETALLES en 25, las parafrasis acababan
  // expulsando recuerdos de verdad.
  const yaEsta = c.detalles.some(
    (d) => d.toLowerCase() === limpio.toLowerCase() || parecido(d, limpio) >= 0.6
  );
  if (!yaEsta) {
    c.detalles.push(limpio);
    if (c.detalles.length > MAX_DETALLES) c.detalles = c.detalles.slice(-MAX_DETALLES);
    c.actualizado = new Date().toISOString();
    guardarTodo(datos);
  }
  return c;
}

/* ---------------------------------------------------------------- prompt --- */

/** El trozo de contexto que se le añade al modelo. Vacio si no hay cliente. */
export function contextoParaPrompt(id) {
  const c = obtenerCliente(id);
  if (!c) return "";

  const partes = [`# CON QUIEN ESTAS HABLANDO\nSe llama ${c.nombre}.`];

  if (c.etiqueta) partes.push(`Tipo de cliente: ${c.etiqueta}.`);

  if (c.detalles?.length) {
    partes.push(
      "Cosas que te ha contado y que ya sabes de el:\n" +
        c.detalles.map((d) => `- ${d}`).join("\n") +
        "\nUsalas cuando venga a cuento, con naturalidad. No las sueltes todas de golpe " +
        "ni le hagas notar que llevas una lista."
    );
  }

  const recientes = (c.historial ?? []).slice(-MAX_HISTORIAL);
  if (recientes.length) {
    partes.push(
      "Lo ultimo que os habeis dicho (lo mas antiguo arriba):\n" +
        recientes.map((m) => `${m.de === "cliente" ? "El" : "Tu"}: ${m.texto}`).join("\n") +
        "\nNo repitas lo que ya has dicho ni vuelvas a preguntar algo que ya te ha contestado."
    );
  } else {
    partes.push("Es la primera vez que hablais, no hay conversacion anterior.");
  }

  return partes.join("\n\n");
}
