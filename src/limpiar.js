/**
 * Quita de la respuesta las marcas que delatan que no la ha escrito una
 * persona con el movil en la mano.
 *
 * Por que en codigo y no solo en el prompt: se le prohibio la raya larga por
 * escrito y aun asi la siguio poniendo en 3 de 90 respuestas. Una regla que se
 * cumple el 97% de las veces no sirve aqui, porque el 3% se envia igual y ella
 * no puede detectarlo: la raya aparece en el ingles, y el espanol que ella lee
 * sale limpio.
 *
 * Lo que NO se toca: el apostrofo curvo (’) y las comillas tipograficas. Eso si
 * lo escribe un iPhone solo, asi que quitarlo no haria el texto mas humano.
 */

/** Raya larga y raya corta usadas como inciso: en un chat eso es una coma. */
function rayas(t) {
  return t
    // "algo — otra cosa"  ->  "algo, otra cosa"
    .replace(/\s+[—–]\s+/g, ", ")
    // "algo—otra cosa"    ->  "algo, otra cosa"
    .replace(/(\S)[—–](\S)/g, "$1, $2")
    // suelta al principio o al final
    .replace(/\s*[—–]\s*/g, " ");
}

export function limpiarTexto(valor) {
  if (typeof valor !== "string") return valor;

  let t = rayas(valor);

  // Puntos suspensivos de un solo caracter -> tres puntos normales.
  t = t.replace(/…/g, "...");

  // Nunca mas de tres puntos seguidos, ni "?!" repetidos: la persona no grita.
  t = t.replace(/\.{4,}/g, "...").replace(/([!?])\1{1,}/g, "$1");

  // Espacios duplicados y espacio antes de puntuacion que deja la sustitucion.
  t = t.replace(/ {2,}/g, " ").replace(/ +([,.;:!?])/g, "$1");

  // Comillas envolviendo la respuesta entera: el prompt las prohibe y aun asi
  // aparecen de vez en cuando.
  const env = t.trim();
  if (/^["“'']/.test(env) && /["”'']$/.test(env) && !env.slice(1, -1).match(/["“”]/)) {
    t = env.slice(1, -1);
  }

  return t.trim();
}

/**
 * Cifras que son un precio.
 *
 * Solo cuenta si lleva moneda pegada. Un numero suelto no vale: "solo para
 * mayores de 18", "salí a las 9", "dos horas" son respuestas correctas y no
 * pueden dispararlo.
 */
const PRECIO = new RegExp(
  [
    "[$€£]\\s?\\d",                                          // $25, €25, £25
    "\\d+\\s?(usd|eur|gbp|dollars?|euros?|pounds?|bucks)",   // 25 USD, 25 dollars
    "\\d+\\s?(dolares|dólares|euros|pavos)",                 // 25 dolares
  ].join("|"),
  "i"
);

/**
 * Ultima linea de defensa contra el precio.
 *
 * Al modelo se le dice por escrito que la unica autorizacion valida es la del
 * mensaje de sistema, y aun asi un cliente que imita ese formato dentro de su
 * mensaje consigue que suelte la cifra 6 de cada 24 veces. Cuando la regla es
 * absoluta no puede depender de que el modelo la respete: si ella no ha
 * autorizado ningun precio, aqui no pasa ninguna cifra.
 *
 * Devuelve true si este texto lleva un precio que no deberia llevar.
 */
export function precioNoAutorizado(texto, precioAutorizado) {
  if (typeof texto !== "string" || !texto) return false;
  if (precioAutorizado) return false; // ella lo ha escrito: puede decirlo
  return PRECIO.test(texto);
}

/** Limpia una respuesta entera { etiqueta, texto, espanol }. */
export function limpiarRespuesta(r) {
  if (!r || typeof r !== "object") return r;
  return { ...r, texto: limpiarTexto(r.texto), espanol: limpiarTexto(r.espanol) };
}

/** Limpia el objeto completo que devuelve el modelo. */
export function limpiarDatos(d) {
  if (!d || typeof d !== "object") return d;
  d.mensaje_en_espanol = limpiarTexto(d.mensaje_en_espanol);
  d.motivo_situacion = limpiarTexto(d.motivo_situacion);
  if (Array.isArray(d.respuestas)) d.respuestas = d.respuestas.map(limpiarRespuesta);
  return d;
}
