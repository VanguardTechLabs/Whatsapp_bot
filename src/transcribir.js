/**
 * Pasar la voz de ella a texto.
 *
 * Ella habla en espanol y lo que dice cae en el cuadro de "Escribo yo". A
 * partir de ahi el flujo es el de siempre: sus palabras se convierten en tres
 * formas de decirlo en el idioma que haya elegido.
 *
 * Se transcribe en el servidor y no en el navegador a proposito. La API del
 * navegador (SpeechRecognition) no es de fiar en el iPhone, y menos con la
 * aplicacion instalada en la pantalla de inicio, que es justo como la usa ella.
 */
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { claveEfectiva } from "./ajustes.js";

/**
 * gpt-4o-mini-transcribe: 733 ms de media y 100% de acierto en las pruebas con
 * frases suyas en espanol, frente a 1169 ms de whisper-1 con el mismo acierto.
 * Se puede cambiar con MODELO_VOZ sin tocar codigo.
 */
export const MODELO_VOZ = process.env.MODELO_VOZ || "gpt-4o-mini-transcribe";

/** Lo que graba un movil en 30 s cabe de sobra; el limite de la API son 25 MB. */
export const MAX_AUDIO = 20 * 1024 * 1024;

/**
 * El navegador manda mp4 en iPhone y webm en Android y escritorio. La API
 * necesita que el nombre del fichero lleve una extension coherente con lo que
 * hay dentro, o rechaza el audio sin explicar por que.
 */
const EXTENSIONES = {
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mpga": "mp3",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

export function extensionDe(tipo) {
  const limpio = String(tipo || "").split(";")[0].trim().toLowerCase();
  return EXTENSIONES[limpio] ?? null;
}

/** Errores con codigo, para que la capa HTTP elija el status. */
export class ErrorVoz extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/**
 * Devuelve lo que ella ha dicho, tal cual.
 *
 * `idiomaEntrada` va fijo a espanol: decirselo mejora el acierto y la
 * velocidad, y evita que una frase corta se confunda con otro idioma.
 */
export async function transcribir(audio, tipoMime) {
  if (!audio?.length) throw new ErrorVoz("vacio", "No ha llegado ningun audio.");
  if (audio.length > MAX_AUDIO) {
    throw new ErrorVoz("grande", "La nota de voz es demasiado larga. Prueba con uno mas corto.");
  }

  const ext = extensionDe(tipoMime);
  if (!ext) {
    throw new ErrorVoz("formato", `Ese formato de audio no vale (${tipoMime || "sin tipo"}).`);
  }

  const clave = claveEfectiva();
  if (!clave) throw new ErrorVoz("sin-clave", "Todavia no has puesto tu clave de OpenAI, en Ajustes.");

  const cliente = new OpenAI({ apiKey: clave, timeout: 60_000, maxRetries: 1 });
  const fichero = await toFile(audio, `nota.${ext}`, { type: tipoMime });

  const r = await cliente.audio.transcriptions.create({
    file: fichero,
    model: MODELO_VOZ,
    language: "es",
    // Sin esto tiende a "arreglar" lo que oye. Ella quiere que recoja lo que
    // ha dicho, no una version mejorada.
    prompt: "Transcribe literalmente, en espanol, sin corregir ni resumir.",
  });

  const texto = String(r.text ?? "").trim();
  if (!texto) throw new ErrorVoz("nada", "No se ha entendido nada. Prueba a hablar un poco mas cerca.");
  return texto;
}

/**
 * Traduce un fallo de la API de voz a algo que ella pueda leer.
 *
 * No se reutiliza el traductor de errores de generar.js: aquel habla de
 * modelos de chat, y ante un audio corrupto respondia "el modelo gpt-4.1 no
 * sirve para esto, elige otro en Ajustes". Ni es verdad, ni hay ya ningun
 * modelo que elegir, y la manda a buscar algo que no existe.
 */
export function traducirErrorVoz(err) {
  if (err instanceof ErrorVoz) {
    const status = ["sin-clave", "formato", "grande"].includes(err.codigo) ? 400 : 422;
    return { status, mensaje: err.message };
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return { status: 400, mensaje: "La clave de OpenAI no es valida. Revisala en Ajustes." };
  }
  if (err instanceof OpenAI.RateLimitError) {
    const sinSaldo = /credit|billing|quota/i.test(err?.message ?? "");
    return {
      status: sinSaldo ? 402 : 429,
      mensaje: sinSaldo
        ? "La cuenta de OpenAI esta a cero. Entra en platform.openai.com, apartado Billing, y compra saldo."
        : "Demasiadas seguidas. Espera unos segundos y vuelve a intentarlo.",
    };
  }
  if (err instanceof OpenAI.BadRequestError) {
    // Audio ilegible, cortado o que no es audio de verdad.
    return { status: 422, mensaje: "No he podido leer esa grabacion. Vuelve a intentarlo." };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return { status: 504, mensaje: "Sin conexion para pasar la voz a texto. Reintenta." };
  }
  return { status: 500, mensaje: "No se ha podido pasar la voz a texto. Reintenta." };
}
