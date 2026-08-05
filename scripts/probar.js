/**
 * Prueba de extremo a extremo. Requiere OPENAI_API_KEY en .env.
 *   npm run probar
 *   npm run probar -- "hey beautiful, what are you up to tonight?"
 */
import "dotenv/config";
import { generarRespuestas, traducirError } from "../src/generar.js";
import { claveEfectiva } from "../src/ajustes.js";

const mensaje = process.argv[2] || "hey, just found your profile. you seem interesting";

// Vale tanto la clave del .env como la puesta desde la web (Ajustes).
if (!claveEfectiva() && process.env.MOCK !== "1" && !process.env.OPENAI_BASE_URL) {
  console.error("No hay ninguna clave: ponla en .env o desde la web, en Ajustes.");
  process.exit(1);
}

try {
  const data = await generarRespuestas({ mensaje });

  console.log(`\nCliente (${data.idioma_cliente}): ${mensaje}`);
  console.log(`En espanol:  ${data.mensaje_en_espanol}`);
  console.log(`Situacion:   ${data.situacion} — ${data.motivo_situacion}\n`);

  data.respuestas.forEach((r, i) => {
    console.log(`${i + 1}. [${r.etiqueta}]`);
    console.log(`   EN: ${r.texto}`);
    console.log(`   ES: ${r.espanol}\n`);
  });

  const m = data._meta;
  console.log(
    `${(m.ms / 1000).toFixed(1)} s · ${m.modelo} · ` +
      `entrada ${m.tokens_entrada} (cache ${m.cache_leida}) · salida ${m.tokens_salida}`
  );
} catch (err) {
  console.error("\nError:", traducirError(err).mensaje);
  console.error(err?.message ?? err);
  process.exit(1);
}
