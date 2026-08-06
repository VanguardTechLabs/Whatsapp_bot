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
  cliente: $("cliente"),
  nuevoCliente: $("nuevo-cliente"),
  fichaCliente: $("ficha-cliente"),
  otra: $("otra"),
  usarPrecio: $("usar-precio"),
  precio: $("precio"),
};

const ETIQUETAS = {
  saludo: "Solo dice hola",
  elogio: "Manda un elogio",
  emoji: "Manda un emoji",
  conversador: "Conversa bastante",
  ausente: "Lleva tiempo sin escribir",
  recuperar: "Ya compro, hay que recuperarlo",
  mirando: "Habla mucho pero no compra",
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

/* -------------------------------------------------------------- clientes */

const CLIENTE_RECORDADO = "ultimo_cliente";

async function cargarClientes() {
  try {
    const r = await fetch("/api/clientes");
    if (!r.ok) return;
    const { clientes } = await r.json();
    const elegido = el.cliente.value || localStorage.getItem(CLIENTE_RECORDADO) || "";

    el.cliente.replaceChildren(
      Object.assign(document.createElement("option"), {
        value: "",
        textContent: "Sin cliente (no recuerda nada)",
      }),
      ...clientes.map((c) =>
        Object.assign(document.createElement("option"), {
          value: c.id,
          textContent: c.nombre + (c.mensajes ? ` · ${c.mensajes} mensajes` : ""),
        })
      )
    );
    if (clientes.some((c) => c.id === elegido)) el.cliente.value = elegido;
    await pintarFicha();
  } catch { /* sin conexion: se sigue pudiendo usar sin cliente */ }
}

/** Muestra lo que el asistente recuerda de esta persona. */
async function pintarFicha() {
  const id = el.cliente.value;
  try { localStorage.setItem(CLIENTE_RECORDADO, id); } catch {}

  if (!id) return el.fichaCliente.classList.add("hidden");

  const r = await fetch("/api/clientes/" + id);
  if (!r.ok) return el.fichaCliente.classList.add("hidden");
  const c = await r.json();

  el.fichaCliente.replaceChildren();

  const tDet = document.createElement("div");
  tDet.className = "titulo";
  tDet.textContent = "Lo que sabe de el";
  el.fichaCliente.append(tDet);

  if (c.detalles?.length) {
    const ul = document.createElement("ul");
    for (const d of c.detalles) {
      const li = document.createElement("li");
      li.textContent = d;
      ul.append(li);
    }
    el.fichaCliente.append(ul);
  } else {
    const p = document.createElement("p");
    p.className = "vacio";
    p.style.margin = "0 0 12px";
    p.textContent = "Todavia nada. Se ira apuntando solo segun hableis.";
    el.fichaCliente.append(p);
  }

  const recientes = (c.historial ?? []).slice(-8);
  if (recientes.length) {
    const tHist = document.createElement("div");
    tHist.className = "titulo";
    tHist.textContent = "Ultimos mensajes";
    const hilo = document.createElement("div");
    hilo.className = "hilo";
    for (const m of recientes) {
      const linea = document.createElement("div");
      linea.className = "linea " + (m.de === "cliente" ? "de-cliente" : "de-maiko");
      linea.textContent = m.texto;
      hilo.append(linea);
    }
    el.fichaCliente.append(tHist, hilo);
    setTimeout(() => (hilo.scrollTop = hilo.scrollHeight), 0);
  }

  el.fichaCliente.classList.remove("hidden");
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
      body: JSON.stringify({
        mensaje,
        situacion: el.situacion.value || null,
        precio: el.usarPrecio.checked ? el.precio.value.trim() : "",
        cliente: el.cliente.value || "",
      }),
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
    el.otra.classList.remove("hidden");
    if (el.cliente.value) pintarFicha();
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
  if (el.cliente.value) {
    fetch("/api/clientes/" + el.cliente.value + "/enviado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    }).then(() => pintarFicha()).catch(() => {});
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

el.otra.addEventListener("click", () => generar());

el.cliente.addEventListener("change", pintarFicha);

el.nuevoCliente.addEventListener("click", async () => {
  const nombre = prompt("Como quieres llamar a este cliente? (solo lo ves tu)");
  if (!nombre || !nombre.trim()) return;
  const r = await fetch("/api/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: nombre.trim() }),
  });
  if (!r.ok) return error("No se ha podido crear.");
  const c = await r.json();
  await cargarClientes();
  el.cliente.value = c.id;
  await pintarFicha();
  toast("Cliente creado");
});

el.usarPrecio.addEventListener("change", () => {
  el.precio.classList.toggle("hidden", !el.usarPrecio.checked);
  if (el.usarPrecio.checked) el.precio.focus();
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

// Instalable en la pantalla de inicio: asi se cambia con el selector de
// aplicaciones en vez de buscar una pestana perdida en el navegador.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Texto que llega compartido desde otra aplicacion: se genera directamente.
{
  const compartido = new URLSearchParams(location.search).get("compartido");
  if (compartido) {
    history.replaceState(null, "", "/");
    el.mensaje.value = compartido;
    generar();
  }
}

cargarClientes();

if (puedeLeerPortapapeles()) {
  estado("Pegado automatico activo: copia el mensaje y vuelve a esta pestana.", "on");
} else {
  el.auto.checked = false;
  el.auto.disabled = true;
  estado("Pega el mensaje y pulsa el boton.");
}
