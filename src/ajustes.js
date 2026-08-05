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
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fichero = path.join(here, "..", "config", "ajustes.json");

const VACIO = { openai_api_key: "", modelo: "", actualizado: null };

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

/** sk-proj-abc...WXYZ — nunca se devuelve la clave entera al navegador. */
export function enmascarar(clave) {
  if (!clave) return "";
  if (clave.length <= 14) return clave.slice(0, 4) + "…";
  return `${clave.slice(0, 11)}…${clave.slice(-4)}`;
}
