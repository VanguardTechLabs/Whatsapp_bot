/**
 * Pasada de tono: manda una tanda de mensajes reales y enseña las respuestas
 * juntas, para poder leerlas de golpe y ver donde se sale del personaje.
 *
 *   node scripts/tono.js
 *   node scripts/tono.js mirando      (solo una situacion)
 */
import "dotenv/config";
import { generarRespuestas } from "../src/generar.js";
import { claveEfectiva } from "../src/ajustes.js";

const CASOS = [
  { sit: "saludo", msg: "hi" },
  { sit: "saludo", msg: "hey beautiful" },
  { sit: "elogio", msg: "you are gorgeous, i couldn't scroll past" },
  { sit: "elogio", msg: "wow. just wow" },
  { sit: "emoji", msg: "😍" },
  { sit: "emoji", msg: "🔥🔥" },
  { sit: "conversador", msg: "long day at work, my boss is impossible. just got home" },
  { sit: "conversador", msg: "i'm a nurse, night shifts. sleep is a myth lol" },
  { sit: "conversador", msg: "not much going on, just bored honestly" },
  { sit: "ausente", msg: "hey stranger, it's been a while" },
  { sit: "ausente", msg: "hi, sorry i disappeared. life got busy" },
  { sit: "recuperar", msg: "hey, i'm back" },
  { sit: "mirando", msg: "how much for a pack?" },
  { sit: "mirando", msg: "what do you offer?" },
  { sit: "mirando", msg: "just tell me the price, i don't have all day" },
  { sit: null, msg: "can we do a video call?" },
  { sit: null, msg: "send me something free first and then i'll pay" },
  { sit: null, msg: "oi linda, tudo bem? gostei muito do seu perfil" },
];

if (!claveEfectiva()) {
  console.error("No hay ninguna clave.");
  process.exit(1);
}

const filtro = process.argv[2];
const casos = filtro ? CASOS.filter((c) => c.sit === filtro) : CASOS;

for (const [n, caso] of casos.entries()) {
  try {
    const d = await generarRespuestas({ mensaje: caso.msg });
    const marca = d._meta.simulado ? "  [SIMULADO]" : "";
    console.log(`\n${"=".repeat(74)}`);
    console.log(`${n + 1}. "${caso.msg}"${marca}`);
    console.log(`   detecta: ${d.situacion}${caso.sit && d.situacion !== caso.sit ? `  (esperaba ${caso.sit})` : ""}  ·  ${d.idioma_cliente}`);
    if (d.detalle_para_recordar) console.log(`   recuerda: ${d.detalle_para_recordar}`);
    console.log();
    for (const r of d.respuestas) {
      console.log(`   [${r.etiqueta}] ${r.texto}`);
    }
  } catch (err) {
    console.log(`\n${n + 1}. "${caso.msg}"  -> ERROR: ${err.message}`);
  }
}
console.log();
