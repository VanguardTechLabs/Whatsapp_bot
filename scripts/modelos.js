/**
 * Lista los modelos disponibles en la cuenta de OpenAI, para no adivinar
 * el valor de MODEL en .env.
 *   npm run modelos
 */
import "dotenv/config";
import { listarModelos, traducirError } from "../src/generar.js";
import { claveEfectiva } from "../src/ajustes.js";

const clave = claveEfectiva();
if (!clave) {
  console.error("No hay ninguna clave: ponla en .env o desde la web, en Ajustes.");
  process.exit(1);
}

try {
  const modelos = await listarModelos(clave);
  console.log("\nModelos disponibles en tu cuenta:\n");
  for (const m of modelos) console.log("  " + m);
  console.log(`\n(${modelos.length} utiles. Pon uno de estos en MODEL, o eligelo en Ajustes.)`);
} catch (err) {
  console.error("\nError:", traducirError(err).mensaje);
  process.exit(1);
}
