/**
 * Modo simulado (MOCK=1): devuelve respuestas de ejemplo sin llamar a la API.
 *
 * Sirve para probar y enseñar la interfaz — el pegado automatico, los botones de
 * copiar, el movil, el diseno — sin gastar un centimo. NO sirve para valorar el
 * tono: esto son textos fijos escritos a mano, no salen del modelo.
 *
 * Detecta el idioma de forma tosca (por palabras sueltas) solo para que el modo
 * de prueba se comporte igual que el de verdad: se responde en el idioma en que
 * escribio el cliente. El modelo real lo hace bien; esto es una imitacion.
 */

/* --------------------------------------------------------------- idioma --- */

const MARCAS = {
  pt: /[ãõç]|\b(voce|voces|tudo bem|obrigad\w*|nao|beleza|saudade|gostei|muito|estou|sou|oi|ola|bom|seu|sua|falar|quanto|preco)\b/gi,
  es: /[ñ¿¡]|\b(hola|que|como|gracias|estas|dia|eres|estoy|quiero|bueno|aqui|cuanto|tu|usted|verte|puedes)\b/gi,
};

/** Quita acentos para que "días" y "dias" cuenten igual. */
const normalizar = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function detectarIdioma(mensaje) {
  const limpio = normalizar(mensaje);
  const cuenta = (re) => (limpio.match(re) ?? []).length;

  // Los acentos propios de cada idioma se miran sobre el texto sin normalizar.
  const pt = cuenta(MARCAS.pt) + (/[ãõç]/i.test(mensaje) ? 2 : 0);
  const es = cuenta(MARCAS.es) + (/[ñ¿¡]/i.test(mensaje) ? 2 : 0);

  if (pt === 0 && es === 0) return "en";
  return pt > es ? "pt" : "es";
}

/* -------------------------------------------------------------- guiones --- */

const SITUACIONES = [
  {
    clave: "nuevo",
    coincide: (m) => /^(hi|hey|hello|hola|oi|ola)\b[\s!.,?]*$/i.test(normalizar(m)),
    motivo: "Es un saludo suelto, sin contexto: no hay conversacion todavia.",
  },
  {
    clave: "interesado",
    coincide: (m) => /(how much|price|cost|pack|menu|cuanto|quanto|preco)/i.test(normalizar(m)),
    motivo: "Pregunta por precio: hay interes, pero aun no hay conversacion.",
  },
  {
    clave: "casual",
    coincide: () => true,
    motivo: "Mensaje conversacional: toca mantener el ritmo, sin ofrecer nada.",
  },
];

/** Para cada situacion, tres respuestas en cada idioma. */
const RESPUESTAS = {
  nuevo: {
    en: [
      ["Cercana", "Hey. Good to see you here. How's your day going?", "Hola. Que bueno verte por aqui. Como va tu dia?"],
      ["Juguetona", "Well, hello. You caught me in a good mood. What brings you here?", "Vaya, hola. Me pillas de buen humor. Que te trae por aqui?"],
      ["Misteriosa", "Hey you. I was just in the middle of something. Tell me about your day first.", "Hola tu. Justo estaba en medio de algo. Cuentame tu como fue tu dia primero."],
    ],
    es: [
      ["Cercana", "Hola. Que bueno verte por aqui. Como va tu dia?", null],
      ["Juguetona", "Vaya, hola. Me pillas de buen humor. Que te trae por aqui?", null],
      ["Misteriosa", "Hola tu. Justo estaba en medio de algo. Cuentame tu primero como fue tu dia.", null],
    ],
    pt: [
      ["Cercana", "Oi. Que bom te ver por aqui. Como esta indo o seu dia?", "Hola. Que bueno verte por aqui. Como va tu dia?"],
      ["Juguetona", "Ora, oi. Voce me pegou de bom humor. O que te trouxe aqui?", "Vaya, hola. Me pillas de buen humor. Que te trae por aqui?"],
      ["Misteriosa", "Oi voce. Eu estava bem no meio de uma coisa. Me conta primeiro como foi o seu dia.", "Hola tu. Justo estaba en medio de algo. Cuentame tu primero como fue tu dia."],
    ],
  },
  interesado: {
    en: [
      ["Cercana", "I'll get to that. First tell me something about you — I like knowing who I'm talking to before anything else.", "Ya llegaremos a eso. Primero cuentame algo de ti, me gusta saber con quien estoy hablando antes que nada."],
      ["Juguetona", "Straight to the point, I see. I don't usually go that fast. Tell me what caught your attention first.", "Directo al grano, ya veo. Yo no suelo ir tan rapido. Cuentame primero que fue lo que te llamo la atencion."],
      ["Misteriosa", "I have a few things, and they're not the same for everyone. Depends on the person. Who are you?", "Tengo algunas cosas, y no son las mismas para todo el mundo. Depende de la persona. Tu quien eres?"],
    ],
    es: [
      ["Cercana", "Ya llegaremos a eso. Primero cuentame algo de ti, me gusta saber con quien estoy hablando antes que nada.", null],
      ["Juguetona", "Directo al grano, ya veo. Yo no suelo ir tan rapido. Cuentame primero que fue lo que te llamo la atencion.", null],
      ["Misteriosa", "Tengo algunas cosas, y no son las mismas para todo el mundo. Depende de la persona. Tu quien eres?", null],
    ],
    pt: [
      ["Cercana", "Ja chego nisso. Primeiro me conta algo sobre voce, gosto de saber com quem estou falando antes de tudo.", "Ya llegaremos a eso. Primero cuentame algo de ti, me gusta saber con quien estoy hablando antes que nada."],
      ["Juguetona", "Direto ao ponto, entendi. Eu nao costumo ir tao rapido. Me conta primeiro o que chamou sua atencao.", "Directo al grano, ya veo. Yo no suelo ir tan rapido. Cuentame primero que fue lo que te llamo la atencion."],
      ["Misteriosa", "Tenho algumas coisas, e nao sao as mesmas para todo mundo. Depende da pessoa. Quem e voce?", "Tengo algunas cosas, y no son las mismas para todo el mundo. Depende de la persona. Tu quien eres?"],
    ],
  },
  casual: {
    en: [
      ["Cercana", "I like that you actually write instead of just dropping a hi. Was today one of those long ones?", "Me gusta que escribas de verdad en vez de dejar solo un hola. Fue hoy uno de esos dias largos?"],
      ["Juguetona", "You're more interesting than you're letting on. Go on, I'm listening.", "Eres mas interesante de lo que dejas ver. Sigue, te escucho."],
      ["Misteriosa", "Mm. There's more behind that than you're saying. I'm curious now.", "Mm. Hay mas detras de eso de lo que estas diciendo. Ahora me da curiosidad."],
    ],
    es: [
      ["Cercana", "Me gusta que escribas de verdad en vez de dejar solo un hola. Fue hoy uno de esos dias largos?", null],
      ["Juguetona", "Eres mas interesante de lo que dejas ver. Sigue, te escucho.", null],
      ["Misteriosa", "Mm. Hay mas detras de eso de lo que estas diciendo. Ahora me da curiosidad.", null],
    ],
    pt: [
      ["Cercana", "Gosto que voce escreve de verdade em vez de deixar so um oi. Hoje foi um daqueles dias longos?", "Me gusta que escribas de verdad en vez de dejar solo un hola. Fue hoy uno de esos dias largos?"],
      ["Juguetona", "Voce e mais interessante do que deixa transparecer. Continua, estou ouvindo.", "Eres mas interesante de lo que dejas ver. Sigue, te escucho."],
      ["Misteriosa", "Mm. Tem mais coisa por tras disso do que voce esta dizendo. Agora fiquei curiosa.", "Mm. Hay mas detras de eso de lo que estas diciendo. Ahora me da curiosidad."],
    ],
  },
};

/* ------------------------------------------------------------- generar --- */

export async function generarSimulado({ mensaje, situacion = null }) {
  await new Promise((r) => setTimeout(r, 600)); // latencia parecida a la real

  const idioma = detectarIdioma(mensaje);
  const detectada = SITUACIONES.find((s) => s.coincide(mensaje));
  const clave = situacion ?? detectada.clave;
  const juego = RESPUESTAS[clave] ?? RESPUESTAS.casual;

  return {
    idioma_cliente: idioma,
    // Si ya escribio en espanol no hay nada que traducir: se muestra tal cual.
    mensaje_en_espanol:
      idioma === "es" ? mensaje : "(traduccion simulada: aqui iria el mensaje del cliente en espanol)",
    situacion: clave,
    motivo_situacion: (situacion ? SITUACIONES.find((s) => s.clave === situacion)?.motivo : detectada.motivo) ?? detectada.motivo,
    respuestas: (juego[idioma] ?? juego.en).map(([etiqueta, texto, espanol]) => ({
      etiqueta,
      texto,
      espanol: espanol ?? texto, // en espanol, el texto y su version son lo mismo
    })),
    _meta: {
      ms: 600,
      modelo: "SIMULADO (sin API)",
      tokens_entrada: 0,
      tokens_salida: 0,
      cache_leida: 0,
      simulado: true,
    },
  };
}
