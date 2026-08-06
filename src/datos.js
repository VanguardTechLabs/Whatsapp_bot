/**
 * Donde se guarda lo que la aplicacion escribe: ajustes, clientes y el estilo.
 *
 * En local es la carpeta `config/` de siempre. En un servidor como Railway el
 * disco se borra en cada despliegue, asi que hay que apuntar DATA_DIR a un
 * volumen (por ejemplo /data) para que no se pierdan ni la clave, ni los
 * clientes, ni las conversaciones.
 *
 *   DATA_DIR=/data
 *
 * El fichero `config/persona.json` del repositorio es solo la plantilla: la
 * primera vez se copia a DATA_DIR y a partir de ahi se edita la copia. Asi un
 * despliegue nuevo nunca pisa el estilo que ella haya ajustado.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Carpeta del repositorio: contiene las plantillas. */
export const PLANTILLAS = path.join(here, "..", "config");

/** Carpeta donde se escribe de verdad. */
export const DATOS = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : PLANTILLAS;

/** Ruta de un fichero de datos. */
export const rutaDatos = (nombre) => path.join(DATOS, nombre);

/** Crea la carpeta si hace falta y copia las plantillas la primera vez. */
export function prepararDatos() {
  if (DATOS !== PLANTILLAS) {
    fs.mkdirSync(DATOS, { recursive: true });

    // persona.json es lo unico que viene con contenido de fabrica.
    const destino = rutaDatos("persona.json");
    if (!fs.existsSync(destino)) {
      fs.copyFileSync(path.join(PLANTILLAS, "persona.json"), destino);
      console.log(`[datos] Estilo inicial copiado a ${destino}`);
    }
  }
  return DATOS;
}

prepararDatos();
