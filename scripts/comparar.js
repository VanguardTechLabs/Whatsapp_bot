/**
 * Compara modelos con el mismo mensaje, para elegir con datos y no a ojo.
 *
 *   node scripts/comparar.js
 *   node scripts/comparar.js "how much for a pack?"
 *
 * De cada modelo mide dos llamadas: la primera en frio y la segunda ya con la
 * cache del prompt caliente, que es como se comporta en el uso real.
 */
import "dotenv/config";
import OpenAI from "openai";
import { loadPersona, buildSystemPrompt, buildUserPrompt, RESPONSE_SCHEMA } from "../src/prompt.js";
import { claveEfectiva } from "../src/ajustes.js";

const mensaje = process.argv[2] || "hey beautiful, what are you up to tonight?";

const CANDIDATOS = [
  { modelo: "gpt-4.1-nano" },
  { modelo: "gpt-4.1-mini" },
  { modelo: "gpt-4.1" },
  { modelo: "gpt-4o-mini" },
  { modelo: "gpt-4o" },
  { modelo: "gpt-5-nano", esfuerzo: "minimal" },
  { modelo: "gpt-5-mini", esfuerzo: "minimal" },
  { modelo: "gpt-5-mini", esfuerzo: "low" },
  { modelo: "gpt-5", esfuerzo: "minimal" },
];

const clave = claveEfectiva();
if (!clave) {
  console.error("No hay ninguna clave: ponla en .env o desde la web, en Ajustes.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: clave, timeout: 120_000, maxRetries: 0 });
const persona = loadPersona();
const system = buildSystemPrompt(persona);
const user = buildUserPrompt({ message: mensaje });

async function unaLlamada({ modelo, esfuerzo }) {
  const params = {
    model: modelo,
    max_completion_tokens: 8000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "respuesta_asistente", strict: true, schema: RESPONSE_SCHEMA },
    },
  };
  if (esfuerzo) params.reasoning_effort = esfuerzo;

  const t0 = Date.now();
  const r = await client.chat.completions.create(params);
  const ms = Date.now() - t0;

  const bruto = r.choices?.[0]?.message?.content;
  if (!bruto) throw new Error("respuesta vacia (" + r.choices?.[0]?.finish_reason + ")");

  return {
    ms,
    datos: JSON.parse(bruto),
    cache: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    salida: r.usage?.completion_tokens ?? 0,
  };
}

console.log(`\nMensaje de prueba: "${mensaje}"\n`);
console.log("modelo                    esfuerzo   frio    caliente   salida   estado");
console.log("-".repeat(78));

const resultados = [];

for (const c of CANDIDATOS) {
  const etiqueta = c.modelo.padEnd(24) + " " + (c.esfuerzo ?? "-").padEnd(10);
  try {
    const frio = await unaLlamada(c);
    const caliente = await unaLlamada(c); // ya con la cache caliente
    resultados.push({ ...c, frio: frio.ms, caliente: caliente.ms, datos: caliente.datos });
    console.log(
      etiqueta +
        (frio.ms / 1000).toFixed(1).padStart(5) + "s" +
        (caliente.ms / 1000).toFixed(1).padStart(9) + "s" +
        String(caliente.salida).padStart(9) +
        "   ok"
    );
  } catch (err) {
    const motivo = (err?.message ?? String(err)).slice(0, 34).replace(/\n/g, " ");
    console.log(etiqueta + "    -          -         -   " + motivo);
  }
}

/* --------------------------------------------------------------- ejemplos --- */

console.log("\n\nQue escribe cada uno (la respuesta 1 de cada modelo):\n");
for (const r of resultados) {
  console.log(`${r.modelo}${r.esfuerzo ? " / " + r.esfuerzo : ""}  (${(r.caliente / 1000).toFixed(1)}s)`);
  const uno = r.datos.respuestas?.[0];
  if (uno) {
    console.log(`   EN: ${uno.texto}`);
    console.log(`   ES: ${uno.espanol}`);
  }
  console.log();
}

const ordenados = [...resultados].sort((a, b) => a.caliente - b.caliente);
if (ordenados.length) {
  console.log("Mas rapidos en caliente:");
  for (const r of ordenados.slice(0, 3)) {
    console.log(`   ${(r.caliente / 1000).toFixed(1)}s  ${r.modelo}${r.esfuerzo ? " / " + r.esfuerzo : ""}`);
  }
}
