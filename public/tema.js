/**
 * Tema y color principal.
 *
 * Se guarda en el navegador (localStorage) y no en el servidor, para que se
 * aplique antes de pintar la pagina y no haya un parpadeo blanco al entrar.
 * Por eso este fichero se carga en el <head> y no al final.
 *
 * Guardamos los valores ya resueltos (no el nombre del color) para que el
 * arranque no tenga que consultar ninguna tabla: leer y aplicar, nada mas.
 */

window.PALETAS = [
  { nombre: "Rosa", oscuro: "#d4657f", oscuroInk: "#1a090f", claro: "#a83a58", claroInk: "#ffffff" },
  { nombre: "Vino", oscuro: "#c1566b", oscuroInk: "#180810", claro: "#8e2f47", claroInk: "#ffffff" },
  { nombre: "Coral", oscuro: "#e4795e", oscuroInk: "#1a0f0c", claro: "#c2543a", claroInk: "#ffffff" },
  { nombre: "Ambar", oscuro: "#e3a851", oscuroInk: "#1e1508", claro: "#9a6410", claroInk: "#ffffff" },
  { nombre: "Verde", oscuro: "#6fc79a", oscuroInk: "#08201a", claro: "#17754f", claroInk: "#ffffff" },
  { nombre: "Azul", oscuro: "#7aa7f0", oscuroInk: "#0b142a", claro: "#2f5fb8", claroInk: "#ffffff" },
  { nombre: "Violeta", oscuro: "#b18cf0", oscuroInk: "#150c28", claro: "#6f45c0", claroInk: "#ffffff" },
];

(function () {
  const raiz = document.documentElement;

  function guardado(clave) {
    try {
      return localStorage.getItem(clave);
    } catch {
      return null;
    }
  }

  /** true si en este momento se esta viendo el tema oscuro. */
  function esOscuro() {
    const forzado = raiz.getAttribute("data-theme");
    if (forzado === "dark") return true;
    if (forzado === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function aplicar() {
    const tema = guardado("tema");
    if (tema === "light" || tema === "dark") raiz.setAttribute("data-theme", tema);
    else raiz.removeAttribute("data-theme");

    const oscuro = esOscuro();
    const color = guardado(oscuro ? "acento_oscuro" : "acento_claro");
    const tinta = guardado(oscuro ? "acento_oscuro_ink" : "acento_claro_ink");

    if (color) raiz.style.setProperty("--accent", color);
    else raiz.style.removeProperty("--accent");

    if (tinta) raiz.style.setProperty("--accent-ink", tinta);
    else raiz.style.removeProperty("--accent-ink");
  }

  window.aplicarTema = aplicar;

  /** Guarda la eleccion y la aplica al momento. */
  window.guardarApariencia = function (tema, paleta) {
    try {
      if (tema) localStorage.setItem("tema", tema);
      if (paleta) {
        localStorage.setItem("paleta", paleta.nombre);
        localStorage.setItem("acento_oscuro", paleta.oscuro);
        localStorage.setItem("acento_oscuro_ink", paleta.oscuroInk);
        localStorage.setItem("acento_claro", paleta.claro);
        localStorage.setItem("acento_claro_ink", paleta.claroInk);
      }
    } catch {
      /* navegacion privada: se aplica igual, solo que no se recuerda */
    }
    aplicar();
  };

  aplicar();

  // Si esta en automatico y el movil cambia a modo noche, el color se ajusta solo.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (!guardado("tema") || guardado("tema") === "auto") aplicar();
    });
})();
