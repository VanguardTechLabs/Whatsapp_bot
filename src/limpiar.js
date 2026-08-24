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
