/**
 * Lee un JSON a medio escribir.
 *
 * Cuando el modelo va mandando la respuesta poco a poco, lo que llega es JSON
 * incompleto: le faltan comillas y llaves por cerrar. Esto lo cierra por su
 * cuenta para poder ir leyendo lo que ya esta listo, sin esperar al final.
 *
 * Ejemplo: {"a":"hola","b":["uno","do   ->   {"a":"hola","b":["uno","do"]}
 */

export function parsearParcial(texto) {
  if (!texto) return null;

  const pila = [];
  let enCadena = false;
  let escapando = false;

  for (const ch of texto) {
    if (escapando) {
      escapando = false;
      continue;
    }
    if (enCadena) {
      if (ch === "\\") escapando = true;
      else if (ch === '"') enCadena = false;
      continue;
    }
    if (ch === '"') enCadena = true;
    else if (ch === "{" || ch === "[") pila.push(ch);
    else if (ch === "}" || ch === "]") pila.pop();
  }

  let cerrado = texto;

  // Un escape a medias romperia el parseo: se quita.
  if (escapando) cerrado = cerrado.slice(0, -1);

  if (enCadena) cerrado += '"';

  // Si quedo colgando una coma o dos puntos, tampoco es JSON valido.
  cerrado = cerrado.replace(/[,:]\s*$/, "");

  for (let i = pila.length - 1; i >= 0; i--) {
    cerrado += pila[i] === "{" ? "}" : "]";
  }

  try {
    return JSON.parse(cerrado);
  } catch {
    return null;
  }
}
