const $ = (id) => document.getElementById(id);

const el = {
  mensaje: $("mensaje"),
  situacion: $("situacion"),
  auto: $("auto"),
  generar: $("generar"),
  estado: $("estado"),
  dot: $("dot"),
  error: $("error"),
  bloqueTraduccion: $("bloque-traduccion"),
  original: $("original"),
  traduccion: $("traduccion"),
  chip: $("chip-situacion"),
  chipIdioma: $("chip-idioma"),
  motivo: $("motivo"),
  respuestas: $("respuestas"),
  meta: $("meta"),
  salir: $("salir"),
  bannerDemo: $("banner-demo"),
  demoMotivo: $("demo-motivo"),
  toast: $("toast"),
};

const ETIQUETAS = {
  nuevo: "Cliente nuevo",
  casual: "Conversacion casual",
  interesado: "Interesado, no compra",
  reconexion: "Hace tiempo que no escribe",
  habitual: "Cliente habitual",
};

// El asistente responde en el mismo idioma en que escribio el cliente.
const IDIOMAS = {
  en: "ingles",
  es: "espanol",
  pt: "portugues",
  fr: "frances",
  it: "italiano",
  de: "aleman",
  nl: "neerlandes",
  ru: "ruso",
  ar: "arabe",
  ja: "japones",
  zh: "chino",
  ko: "coreano",
  tr: "turco",
  pl: "polaco",
};

let generando = false;
let ultimoPortapapeles = "";
const propias = new Set(); // textos que hemos copiado nosotros: no re-generar con ellos
let respuestasActuales = [];

/* --------------------------------------------------------------- estado */

function estado(texto, tipo = "") {
  el.estado.textContent = texto;
  el.dot.className = "dot" + (tipo ? " " + tipo : "");
}

function error(texto) {
  if (!texto) return el.error.classList.add("hidden");
  el.error.textContent = texto;
  el.error.classList.remove("hidden");
}

let temporizadorToast;
function toast(texto) {
  el.toast.textContent = texto;
  el.toast.classList.add("visible");
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.toast.classList.remove("visible"), 1800);
}

/** Tres tarjetas grises mientras se espera, en vez de un hueco vacio. */
function mostrarEsqueleto() {
  el.respuestas.replaceChildren(
    ...Array.from({ length: 3 }, () => {
      const s = document.createElement("div");
      s.className = "skeleton";
      s.innerHTML =
        '<div class="linea corta"></div><div class="linea"></div><div class="linea media"></div>';
      return s;
    })
  );
}

/* ---------------------------------------------------------- portapapeles */

const puedeLeerPortapapeles = () =>
  window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.readText === "function";

async function intentarPegadoAutomatico() {
  if (!el.auto.checked || generando || !puedeLeerPortapapeles() || !document.hasFocus()) return;
  let texto;
  try {
    texto = (await navigator.clipboard.readText()).trim();
  } catch {
    estado("Pegado automatico no disponible: usa el boton.", "off");
    return;
  }
  if (!texto || texto === ultimoPortapapeles || propias.has(texto)) return;
  if (texto.length > 6000) return;
  ultimoPortapapeles = texto;
  el.mensaje.value = texto;
  generar();
}

/* -------------------------------------------------------------- generar */

async function generar() {
  const mensaje = el.mensaje.value.trim();
  if (!mensaje) {
    el.mensaje.focus();
    return;
  }
  if (generando) return;

  generando = true;
  error("");
  el.generar.disabled = true;
  el.generar.textContent = "Generando...";
  el.dot.className = "dot spinner";
  el.estado.textContent = "Traduciendo y escribiendo respuestas...";
  el.meta.textContent = "";
  mostrarEsqueleto();

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje, situacion: el.situacion.value || null }),
    });

    if (res.status === 401) {
      location.href = "/login";
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.falta_clave) {
        el.respuestas.replaceChildren();
        el.error.replaceChildren(
          document.createTextNode(data.error + " "),
          Object.assign(document.createElement("a"), { href: "/ajustes", textContent: "Ir a Ajustes" })
        );
        el.error.classList.remove("hidden");
        estado("Falta configurar la clave.", "off");
        return;
      }
      throw new Error(data.error || "No se pudo generar la respuesta.");
    }

    pintar(mensaje, data);
    if (data._meta?.simulado) {
      estado("Modo de prueba: respuestas de ejemplo, no las escribe la IA.", "off");
    } else {
      estado("Listo. Pulsa 1, 2 o 3 para copiar.", "on");
    }
  } catch (e) {
    el.respuestas.replaceChildren();
    error(e.message);
    estado("Ha fallado. Reintenta.", "off");
  } finally {
    generando = false;
    el.generar.disabled = false;
    el.generar.textContent = "Pegar y generar respuestas";
  }
}

/* --------------------------------------------------------------- pintar */

function pintar(original, data) {
  el.original.textContent = original;
  el.traduccion.textContent = data.mensaje_en_espanol || "";
  el.chip.textContent = ETIQUETAS[data.situacion] || data.situacion || "";

  const codigo = (data.idioma_cliente || "").toLowerCase();
  el.chipIdioma.textContent = codigo ? "Responde en " + (IDIOMAS[codigo] || codigo) : "";
  el.chipIdioma.classList.toggle("hidden", !codigo);

  el.motivo.textContent = data.motivo_situacion || "";
  el.bloqueTraduccion.classList.remove("hidden");

  respuestasActuales = data.respuestas || [];
  el.respuestas.replaceChildren();

  respuestasActuales.forEach((r, i) => {
    const card = document.createElement("div");
    card.className = "reply";

    const top = document.createElement("div");
    top.className = "top";

    const izq = document.createElement("div");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = i + 1;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = r.etiqueta || "";
    izq.append(num, chip);

    const btn = document.createElement("button");
    btn.className = "copy";
    btn.type = "button";
    btn.textContent = "Copiar";
    btn.addEventListener("click", () => copiar(i));

    top.append(izq, btn);

    const en = document.createElement("div");
    en.className = "en";
    en.textContent = r.texto || "";

    const es = document.createElement("div");
    es.className = "es";
    es.textContent = r.espanol || "";

    card.append(top, en, es);
    el.respuestas.append(card);
  });

  const m = data._meta || {};

  if (m.simulado) {
    el.demoMotivo.textContent = m.motivo_fallback
      ? "Motivo: " + m.motivo_fallback
      : "El asistente esta en modo de prueba y no esta conectado a la IA.";
    el.bannerDemo.classList.remove("hidden");
    for (const card of el.respuestas.children) card.classList.add("demo");
    el.meta.textContent = "Respuestas de ejemplo";
    el.meta.style.color = "var(--danger)";
  } else {
    el.bannerDemo.classList.add("hidden");
    el.meta.textContent = m.ms ? `${(m.ms / 1000).toFixed(1)} s · ${m.modelo || ""}` : "";
    el.meta.style.color = "";
  }
}

/* --------------------------------------------------------------- copiar */

async function copiar(indice) {
  const r = respuestasActuales[indice];
  if (!r) return;
  const texto = r.texto;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // navegadores sin permiso de escritura: seleccion manual
    const tmp = document.createElement("textarea");
    tmp.value = texto;
    document.body.append(tmp);
    tmp.select();
    document.execCommand("copy");
    tmp.remove();
  }
  propias.add(texto.trim());
  ultimoPortapapeles = texto.trim();

  const btn = el.respuestas.children[indice]?.querySelector("button.copy");
  if (btn) {
    btn.textContent = "Copiado";
    btn.classList.add("done");
    setTimeout(() => {
      btn.textContent = "Copiar";
      btn.classList.remove("done");
    }, 1600);
  }
  toast("Copiado — pegalo y envialo");
  estado("Copiado. Pegalo en OnlyFans y envialo.", "on");
}

/* --------------------------------------------------------------- eventos */

el.generar.addEventListener("click", async () => {
  // si el campo esta vacio, intentamos leer el portapapeles primero
  if (!el.mensaje.value.trim() && puedeLeerPortapapeles()) {
    try {
      el.mensaje.value = (await navigator.clipboard.readText()).trim();
    } catch { /* sin permiso: el usuario pega a mano */ }
  }
  generar();
});

el.mensaje.addEventListener("paste", () => {
  setTimeout(() => {
    if (el.auto.checked && el.mensaje.value.trim()) generar();
  }, 0);
});

document.addEventListener("keydown", (e) => {
  // Los atajos 1/2/3 no deben dispararse mientras se escribe ni con el foco en
  // el desplegable de situacion.
  const foco = document.activeElement;
  const escribiendo =
    foco && ["TEXTAREA", "INPUT", "SELECT"].includes(foco.tagName);

  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    generar();
    return;
  }
  if (!escribiendo && ["1", "2", "3"].includes(e.key)) {
    e.preventDefault();
    copiar(Number(e.key) - 1);
  }
});

window.addEventListener("focus", intentarPegadoAutomatico);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") intentarPegadoAutomatico();
});

el.auto.addEventListener("change", () => {
  if (el.auto.checked) {
    estado("Pegado automatico activo.", "on");
    intentarPegadoAutomatico();
  } else {
    estado("Pegado automatico desactivado.");
  }
});

el.salir.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});

/* ---------------------------------------------------------------- inicio */

if (puedeLeerPortapapeles()) {
  estado("Pegado automatico activo: copia el mensaje y vuelve a esta pestana.", "on");
} else {
  el.auto.checked = false;
  el.auto.disabled = true;
  estado("Pega el mensaje y pulsa el boton.");
}
