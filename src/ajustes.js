/**
 * Ajustes que la usuaria puede cambiar desde la propia web (clave de la API y
 * modelo), sin tocar el .env ni el codigo.
 *
 * Se guardan en config/ajustes.json. Ese fichero tiene la clave en claro, igual
 * que un .env: no se sube a git y solo debe existir en el servidor.
 *
 * Prioridad: lo guardado desde la web  >  lo que haya en .env.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fichero = path.join(here, "..", "config", "ajustes.json");

const VACIO = {
  openai_api_key: "",
  modelo: "",
  // La clave de acceso NO se guarda en claro: solo su huella.
  password_hash: "",
  password_salt: "",
  actualizado: null,
};

export function leerAjustes() {
  try {
    return { ...VACIO, ...JSON.parse(fs.readFileSync(fichero, "utf8")) };
  } catch {
    return { ...VACIO };
  }
}

export function guardarAjustes(parcial) {
  const actual = leerAjustes();
  const nuevo = {
    ...actual,
    ...parcial,
    actualizado: new Date().toISOString(),
  };
  // Escritura atomica: primero a un temporal, luego se renombra.
  const tmp = fichero + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(nuevo, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, fichero);
  return nuevo;
}

export function borrarClave() {
  return guardarAjustes({ openai_api_key: "" });
}

/** La clave que se usa de verdad: la de la web, o si no la del .env. */
export function claveEfectiva() {
  return leerAjustes().openai_api_key || process.env.OPENAI_API_KEY || "";
}

/** El modelo que se usa de verdad. */
export function modeloEfectivo() {
  return leerAjustes().modelo || process.env.MODEL || "gpt-5";
}

/** De donde viene la clave, para poder explicarlo en la pantalla de ajustes. */
export function origenClave() {
  if (leerAjustes().openai_api_key) return "web";
  if (process.env.OPENAI_API_KEY) return "env";
  return "ninguno";
}

/* ------------------------------------------------- clave de acceso a la web --- */

/**
 * La clave con la que se entra en la aplicacion.
 *
 * Si se ha cambiado desde la web, manda la guardada (solo su huella, nunca en
 * claro). Si no, la del .env / las variables del servidor.
 *
 * Se usa scrypt, que esta pensado para esto: es lento a proposito, de forma que
 * probar claves a lo bruto no compensa.
 */
function huella(clave, sal) {
  return crypto.scryptSync(clave, sal, 64).toString("hex");
}

/** true si hay alguna clave con la que se pueda entrar. */
export function hayPassword() {
  return Boolean(leerAjustes().password_hash || process.env.APP_PASSWORD);
}

/** true si la clave se cambio desde la web (y no viene del servidor). */
export function passwordPropia() {
  return Boolean(leerAjustes().password_hash);
}

/** Comprueba una clave contra la guardada, o contra la del servidor. */
export function verificarPassword(clave) {
  if (typeof clave !== "string" || clave.length === 0) return false;

  const a = leerAjustes();

  if (a.password_hash && a.password_salt) {
    const calculada = Buffer.from(huella(clave, a.password_salt), "hex");
    const guardada = Buffer.from(a.password_hash, "hex");
    if (calculada.length !== guardada.length) return false;
    return crypto.timingSafeEqual(calculada, guardada);
  }

  const env = process.env.APP_PASSWORD || "";
  if (!env || clave.length !== env.length) return false;
  return crypto.timingSafeEqual(Buffer.from(clave), Buffer.from(env));
}

export function guardarPassword(nueva) {
  const sal = crypto.randomBytes(16).toString("hex");
  guardarAjustes({ password_hash: huella(nueva, sal), password_salt: sal });
}

/** Vuelve a la clave del servidor (por si se olvida la nueva). */
export function olvidarPassword() {
  guardarAjustes({ password_hash: "", password_salt: "" });
}

/** sk-proj-abc...WXYZ — nunca se devuelve la clave entera al navegador. */
export function enmascarar(clave) {
  if (!clave) return "";
  if (clave.length <= 14) return clave.slice(0, 4) + "…";
  return `${clave.slice(0, 11)}…${clave.slice(-4)}`;
}
