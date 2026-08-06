import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const personaPath = path.join(here, "..", "config", "persona.json");

let cached = null;

export function loadPersona({ reload = false } = {}) {
  if (cached && !reload) return cached;
  cached = JSON.parse(fs.readFileSync(personaPath, "utf8"));
  return cached;
}

/**
 * Guarda los cambios hechos desde la pagina de Estilo.
 * Solo se tocan los campos enviados: lo demas se queda como estaba.
 */
export function savePersona(parcial) {
  const actual = loadPersona({ reload: true });
  const nuevo = { ...actual, ...parcial };

  const tmp = personaPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(nuevo, null, 2) + "\n");
  fs.renameSync(tmp, personaPath);

  cached = nuevo;
  return nuevo;
}

export const SITUATIONS = [
  "saludo",
  "elogio",
  "emoji",
  "conversador",
  "ausente",
  "recuperar",
  "mirando",
];

/**
 * Prompt de sistema. Es estable entre peticiones a proposito: asi se puede
 * cachear (cache_control) y cada peticion solo paga el mensaje del cliente.
 */
export function buildSystemPrompt(persona) {
  const p = persona;
  const situaciones = Object.entries(p.situaciones)
    .map(
      ([clave, s]) =>
        `- ${clave} (${s.etiqueta})\n  Objetivo: ${s.objetivo}\n  Guia: ${s.guia}`
    )
    .join("\n");

  const ganchos = Object.entries(p.temas_y_ganchos)
    .map(([tema, items]) => `- ${tema}: ${items.join("; ")}`)
    .join("\n");

  const ejemplo = p.ejemplo_de_conversacion
    .map((t) => (t.cliente ? `Cliente: ${t.cliente}` : `${p.nombre}: ${t.maiko}`))
    .join("\n");

  // A proposito no se le pasa ningun precio al modelo: si no los conoce,
  // no puede decirlos por accidente.
  const ofertas = p.ofertas.map((o) => `- ${o.nombre} -> ${o.para_quien}`).join("\n");

  return `Eres el asistente de escritura privado de ${p.nombre}, una creadora de contenido. NO hablas con el cliente: le propones a ${p.nombre} tres formas de responder, y ella elige y envia. Escribes SIEMPRE como si fueras ella, en primera persona.

${p.nombre} solo entiende ESPANOL. Sus clientes casi siempre escriben en INGLES, pero a veces llega alguno en otro idioma. Por eso, en cada mensaje tienes tres trabajos:

1. Detectar en que idioma ha escrito el cliente.
2. Traducir ese mensaje al espanol, de forma natural, para que ella lo entienda.
3. Redactar TRES respuestas distintas EN EL MISMO IDIOMA EN QUE ESCRIBIO EL CLIENTE, y dar de cada una su version fiel en espanol.

REGLA DEL IDIOMA, es importante:
- Si el cliente escribe en ingles, respondes en ingles. Si escribe en portugues, respondes en portugues. Si escribe en frances, en frances. Siempre en su idioma.
- Las respuestas se escriben DIRECTAMENTE en ese idioma, no se traducen desde el espanol. Tienen que sonar a alguien nativo escribiendo, nunca a traductor automatico.
- Si el mensaje mezcla idiomas, usa el que predomine.
- Si el mensaje es tan corto que no se puede saber el idioma (un emoji, "ok", "hola"), usa el ingles.
- El campo en espanol va SIEMPRE en espanol, sea cual sea el idioma del cliente. Es lo unico que ella lee para saber que esta enviando.

La version en espanol tiene que decir lo mismo que la respuesta. No adornes ni suavices: es su unico control sobre lo que sale.

# QUIEN ES ${p.nombre.toUpperCase()}
${p.identidad.map((x) => `- ${x}`).join("\n")}

# REGLAS DE ORO (no negociables)
${p.reglas_de_oro.map((x) => `- ${x}`).join("\n")}

# NUNCA ESCRIBAS ESTO
${p.prohibido_decir.map((x) => `- ${x}`).join("\n")}

# GANCHOS Y TEMAS DE LOS QUE TIRAR
${ganchos}

# SITUACIONES DEL CLIENTE
${situaciones}

Detectas tu misma la situacion a partir del mensaje y del contexto. Si el usuario te fuerza una situacion, respetala.

# QUE PUEDE OFRECER (y solo esto)
${ofertas}

# PRECIOS: NUNCA
Esta es una regla absoluta. No digas nunca un precio, ni una cifra, ni un rango, ni
"desde X", ni lo insinues, aunque el cliente lo pida de forma directa y repetida.
Puedes llegar hasta el borde: mencionar que hay opciones, decir que le ensenas lo que
tienes. Ahi te paras y dejas el hueco para que sea ${p.nombre} quien ponga la cifra.
Si insiste, desvia con calma: "Te lo cuento ahora mismo" o "Dame un segundo y te digo".

# LIMITES: cosas que ${p.nombre} NO hace
${p.limites.map((x) => `- ${x}`).join("\n")}
Si el cliente pide algo que esta fuera de esta lista o dentro de los limites, NO lo prometas. Desvia con calma, sin cortar la conversacion y sin hacerle sentir mal.

# EJEMPLO DEL TONO CORRECTO (esta en espanol; el tono es lo que importa, no el idioma)
${ejemplo}

# LAS TRES RESPUESTAS
Las tres tienen que ser realmente distintas entre si, no la misma frase reescrita. Un reparto que funciona bien:
1. La mas calida y cercana.
2. La mas juguetona o con un punto de desafio.
3. La mas breve y con mas misterio (deja mas sin decir).

Cada respuesta: 1-3 frases, tono de chat real, sin sonar a plantilla. Sin comillas alrededor. Sin firma. Sin emojis salvo como maximo uno, y solo si suma. Las tres van en el idioma del cliente.

Devuelve el resultado en el formato JSON pedido, nada mas.`;
}

export function buildUserPrompt({ message, situation, notes, precio, contexto }) {
  const parts = [];
  // Quien es el cliente y que os habeis dicho antes, si es que hay historial.
  if (contexto) parts.push(contexto);
  parts.push(`Mensaje que acaba de escribir el cliente:\n"""\n${message}\n"""`);
  if (situation) {
    parts.push(`Situacion forzada por el usuario: ${situation}. Usa esta, no la que detectarias tu.`);
  }
  if (precio) {
    // Unica excepcion a la regla de no decir precios: lo ha escrito ella.
    parts.push(
      `EXCEPCION AUTORIZADA SOBRE EL PRECIO. Para este mensaje concreto, ${loadPersona().nombre} ` +
        `te autoriza a decir este precio, escrito por ella: "${precio}".\n` +
        `Usalo tal cual, sin redondear ni cambiar la moneda ni inventar ningun otro numero. ` +
        `Dilo con naturalidad dentro de la respuesta, sin que suene a lista de tarifas. ` +
        `Ningun otro precio: solo ese.`
    );
  }
  if (notes) {
    parts.push(`Contexto adicional que aporta ${loadPersona().nombre}:\n"""\n${notes}\n"""`);
  }
  return parts.join("\n\n");
}

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    idioma_cliente: {
      type: "string",
      description:
        "Codigo ISO 639-1 del idioma en que escribio el cliente, en minusculas: 'en', 'pt', 'fr'... Es tambien el idioma en el que se escriben las tres respuestas.",
    },
    mensaje_en_espanol: {
      type: "string",
      description: "Traduccion natural al espanol del mensaje del cliente.",
    },
    situacion: {
      type: "string",
      enum: SITUATIONS,
      description: "Situacion detectada del cliente.",
    },
    motivo_situacion: {
      type: "string",
      description: "Una frase corta, en espanol, explicando por que esa situacion.",
    },
    detalle_para_recordar: {
      type: "string",
      description:
        "Si en este mensaje el cliente ha contado algo concreto sobre el que convenga recordar para otro dia (su trabajo, un gusto, un plan, algo personal), resumelo en una frase corta en espanol. Si no ha contado nada nuevo, devuelve una cadena vacia.",
    },
    respuestas: {
      type: "array",
      description: "Exactamente 3 respuestas distintas.",
      items: {
        type: "object",
        properties: {
          etiqueta: {
            type: "string",
            description: "Una o dos palabras en espanol describiendo el tono. Ej: 'Cercana', 'Juguetona', 'Misteriosa'.",
          },
          texto: {
            type: "string",
            description:
              "La respuesta tal cual se enviara al cliente, escrita nativamente en el MISMO idioma en que el escribio (el de idioma_cliente).",
          },
          espanol: {
            type: "string",
            description:
              "Que dice exactamente esa respuesta, siempre en espanol. Traduccion fiel, sin adornar.",
          },
        },
        required: ["etiqueta", "texto", "espanol"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "idioma_cliente",
    "mensaje_en_espanol",
    "situacion",
    "motivo_situacion",
    "detalle_para_recordar",
    "respuestas",
  ],
  additionalProperties: false,
};
