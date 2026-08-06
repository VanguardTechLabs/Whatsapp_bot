import "dotenv/config";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import express from "express";
import cookieParser from "cookie-parser";

import { loadPersona, savePersona, SITUATIONS } from "./src/prompt.js";
import {
  generarRespuestas,
  probarClave,
  listarModelos,
  traducirError,
  MODO_SIMULADO,
} from "./src/generar.js";
import {
  leerAjustes,
  guardarAjustes,
  borrarClave,
  claveEfectiva,
  modeloEfectivo,
  origenClave,
  enmascarar,
  hayPassword,
  passwordPropia,
  verificarPassword,
  guardarPassword,
} from "./src/ajustes.js";
import {
  listarClientes,
  obtenerCliente,
  crearCliente,
  actualizarCliente,
  borrarCliente,
  anotarMensaje,
  anotarDetalle,
} from "./src/clientes.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const APP_USER = process.env.APP_USER || "maiko";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!claveEfectiva() && !MODO_SIMULADO && !process.env.OPENAI_BASE_URL) {
  console.warn("[aviso] Sin clave configurada — se puede poner desde la web, en Ajustes.");
}
if (!hayPassword()) {
  console.warn("[aviso] Sin clave de acceso: falta APP_PASSWORD y no se ha puesto ninguna desde la web.");
}

const app = express();
// Detras de un proxy (Railway, Render, nginx) para que req.ip sea la IP real
// y el freno del login no cuente todos los intentos como si fueran uno.
app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser(SESSION_SECRET));

const COOKIE = "asistente_sesion";
const cookieOpts = {
  signed: true,
  httpOnly: true,
  sameSite: "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
  secure: process.env.NODE_ENV === "production",
};

function isLoggedIn(req) {
  return req.signedCookies?.[COOKIE] === APP_USER && hayPassword();
}

function requireAuth(req, res, next) {
  if (isLoggedIn(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "no-autenticado" });
  return res.redirect("/login");
}

/* ---------------------------------------------------------------- auth --- */

// La app se publica en una URL abierta, asi que el login necesita freno.
const intentos = new Map(); // ip -> { n, bloqueadaHasta }
const MAX_INTENTOS = 8;
const BLOQUEO_MS = 10 * 60 * 1000;

function frenarLogin(req, res, next) {
  const registro = intentos.get(req.ip);
  if (registro?.bloqueadaHasta > Date.now()) {
    const minutos = Math.ceil((registro.bloqueadaHasta - Date.now()) / 60000);
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${minutos} minuto${minutos > 1 ? "s" : ""}.`,
    });
  }
  next();
}

function loginFallido(ip) {
  const r = intentos.get(ip) ?? { n: 0, bloqueadaHasta: 0 };
  r.n += 1;
  if (r.n >= MAX_INTENTOS) {
    r.bloqueadaHasta = Date.now() + BLOQUEO_MS;
    r.n = 0;
  }
  intentos.set(ip, r);
}

app.post("/api/login", frenarLogin, (req, res) => {
  // Sin APP_PASSWORD nadie puede entrar nunca. Decirlo claro, en vez de
  // "usuario o clave incorrectos", que hace perder mucho tiempo buscando.
  if (!hayPassword()) {
    return res.status(500).json({
      error:
        "El servidor no tiene ninguna clave configurada: falta la variable APP_PASSWORD. No es culpa de lo que has escrito.",
    });
  }

  const { usuario, clave } = req.body ?? {};
  const okUser = typeof usuario === "string" && usuario.trim() === APP_USER;
  const okPass = verificarPassword(clave);

  if (!okUser || !okPass) {
    loginFallido(req.ip);
    return res.status(401).json({ error: "Usuario o clave incorrectos." });
  }
  intentos.delete(req.ip);
  res.cookie(COOKIE, APP_USER, cookieOpts);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  // Sin sesion no se cuenta nada: el nombre de usuario es media contraseña.
  if (!isLoggedIn(req)) {
    return res.json({ autenticado: false, usuario: null, clave_configurada: hayPassword() });
  }
  res.json({
    autenticado: true,
    usuario: APP_USER,
    clave_configurada: true,
    clave_propia: passwordPropia(),
    en_produccion: process.env.NODE_ENV === "production",
  });
});

/** Cambiar la clave de acceso desde la propia web. */
app.post("/api/password", requireAuth, (req, res) => {
  const actual = String(req.body?.actual ?? "");
  const nueva = String(req.body?.nueva ?? "");

  if (!verificarPassword(actual)) {
    return res.status(401).json({ error: "La clave actual no es correcta." });
  }
  if (nueva.length < 6) {
    return res.status(400).json({ error: "La clave nueva tiene que tener al menos 6 caracteres." });
  }
  if (nueva === actual) {
    return res.status(400).json({ error: "La clave nueva es igual que la de ahora." });
  }

  try {
    guardarPassword(nueva);
    // Se renueva la cookie para no quedarse fuera al cambiarla.
    res.cookie(COOKIE, APP_USER, cookieOpts);
    res.json({ ok: true });
  } catch (err) {
    console.error("[password]", err?.message ?? err);
    res.status(500).json({ error: "No se ha podido guardar la clave nueva." });
  }
});

/* ------------------------------------------------------------- persona --- */

app.get("/api/persona", requireAuth, (req, res) => {
  const p = loadPersona({ reload: true });
  res.json({
    nombre: p.nombre,
    identidad: p.identidad,
    reglas_de_oro: p.reglas_de_oro,
    prohibido_decir: p.prohibido_decir,
    situaciones: p.situaciones,
    ofertas: p.ofertas,
    limites: p.limites,
    ejemplo_de_conversacion: p.ejemplo_de_conversacion,
  });
});

/**
 * Guarda el estilo editado desde la pagina de Estilo.
 * Las listas llegan como texto, una linea por elemento.
 */
app.put("/api/persona", requireAuth, (req, res) => {
  const lineas = (v) =>
    String(v ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  const parcial = {};
  const b = req.body ?? {};

  if (typeof b.identidad === "string") parcial.identidad = lineas(b.identidad);
  if (typeof b.reglas_de_oro === "string") parcial.reglas_de_oro = lineas(b.reglas_de_oro);
  if (typeof b.prohibido_decir === "string") parcial.prohibido_decir = lineas(b.prohibido_decir);
  if (typeof b.limites === "string") parcial.limites = lineas(b.limites);

  // "nombre del pack | para quien"  (sin precio: el asistente nunca lo dice)
  if (typeof b.ofertas === "string") {
    parcial.ofertas = lineas(b.ofertas).map((l) => {
      const [nombre, para] = l.split("|").map((x) => (x ?? "").trim());
      return { nombre, para_quien: para || "" };
    });
  }

  // { saludo: {objetivo, guia}, ... } — solo las situaciones conocidas
  if (b.situaciones && typeof b.situaciones === "object") {
    const actual = loadPersona({ reload: true }).situaciones;
    const nuevas = { ...actual };
    for (const clave of SITUATIONS) {
      const s = b.situaciones[clave];
      if (!s) continue;
      nuevas[clave] = {
        ...actual[clave],
        objetivo: String(s.objetivo ?? actual[clave]?.objetivo ?? "").trim(),
        guia: String(s.guia ?? actual[clave]?.guia ?? "").trim(),
      };
    }
    parcial.situaciones = nuevas;
  }

  if (Object.keys(parcial).length === 0) {
    return res.status(400).json({ error: "No has cambiado nada." });
  }

  try {
    savePersona(parcial);
    res.json({ ok: true });
  } catch (err) {
    console.error("[persona]", err?.message ?? err);
    res.status(500).json({ error: "No se ha podido guardar. Reintenta." });
  }
});

/* ------------------------------------------------------------- clientes --- */

app.get("/api/clientes", requireAuth, (req, res) => {
  res.json({ clientes: listarClientes() });
});

app.post("/api/clientes", requireAuth, (req, res) => {
  const nombre = String(req.body?.nombre ?? "").trim();
  if (!nombre) return res.status(400).json({ error: "Ponle un nombre para reconocerlo." });
  res.json(crearCliente({ nombre, etiqueta: req.body?.etiqueta }));
});

app.get("/api/clientes/:id", requireAuth, (req, res) => {
  const c = obtenerCliente(req.params.id);
  if (!c) return res.status(404).json({ error: "Ese cliente ya no existe." });
  res.json(c);
});

app.put("/api/clientes/:id", requireAuth, (req, res) => {
  const c = actualizarCliente(req.params.id, req.body ?? {});
  if (!c) return res.status(404).json({ error: "Ese cliente ya no existe." });
  res.json(c);
});

app.delete("/api/clientes/:id", requireAuth, (req, res) => {
  if (!borrarCliente(req.params.id)) {
    return res.status(404).json({ error: "Ese cliente ya no existe." });
  }
  res.json({ ok: true });
});

/** Se llama al copiar una respuesta: asi queda guardado lo que se envio. */
app.post("/api/clientes/:id/enviado", requireAuth, (req, res) => {
  const texto = String(req.body?.texto ?? "").trim();
  if (!texto) return res.status(400).json({ error: "Falta el texto." });
  const c = anotarMensaje(req.params.id, "maiko", texto);
  if (!c) return res.status(404).json({ error: "Ese cliente ya no existe." });
  res.json({ ok: true, mensajes: c.historial.length });
});

/* ------------------------------------------------------------- ajustes --- */

app.get("/api/ajustes", requireAuth, (req, res) => {
  const a = leerAjustes();
  res.json({
    clave_configurada: Boolean(claveEfectiva()),
    clave_enmascarada: enmascarar(claveEfectiva()),
    origen: origenClave(), // "web" | "env" | "ninguno"
    modelo: modeloEfectivo(),
    actualizado: a.actualizado,
    modo_simulado: MODO_SIMULADO,
  });
});

app.put("/api/ajustes", requireAuth, async (req, res) => {
  const parcial = {};

  if (typeof req.body?.openai_api_key === "string") {
    const clave = req.body.openai_api_key.trim();
    if (clave && !clave.startsWith("sk-")) {
      return res.status(400).json({
        error: "Eso no parece una clave. Tiene que empezar por sk- y ser muy larga.",
      });
    }
    parcial.openai_api_key = clave;
  }

  if (typeof req.body?.modelo === "string") {
    parcial.modelo = req.body.modelo.trim();
  }

  guardarAjustes(parcial);
  res.json({
    ok: true,
    clave_enmascarada: enmascarar(claveEfectiva()),
    origen: origenClave(),
    modelo: modeloEfectivo(),
  });
});

app.delete("/api/ajustes/clave", requireAuth, (req, res) => {
  borrarClave();
  res.json({ ok: true, clave_configurada: Boolean(claveEfectiva()), origen: origenClave() });
});

/** Prueba real: es la unica forma de detectar "sin saldo". */
app.post("/api/ajustes/probar", requireAuth, async (req, res) => {
  const clave = (typeof req.body?.clave === "string" && req.body.clave.trim()) || claveEfectiva();
  if (!clave) return res.status(400).json({ error: "Todavia no hay ninguna clave puesta." });

  try {
    const r = await probarClave(clave);
    res.json({ ok: true, mensaje: `Todo correcto. La cuenta funciona y tiene saldo (modelo ${r.modelo}).` });
  } catch (err) {
    const { status, mensaje } = traducirError(err);
    console.error("[probar]", err?.status ?? "", err?.message ?? err);
    res.status(status).json({ error: mensaje });
  }
});

/** Modelos disponibles en la cuenta, para el desplegable. */
app.get("/api/ajustes/modelos", requireAuth, async (req, res) => {
  const clave = claveEfectiva();
  if (!clave) return res.status(400).json({ error: "Todavia no hay ninguna clave puesta." });
  try {
    res.json({ modelos: await listarModelos(clave) });
  } catch (err) {
    const { status, mensaje } = traducirError(err);
    res.status(status).json({ error: mensaje });
  }
});

/* ------------------------------------------------------------ generate --- */

app.post("/api/generate", requireAuth, async (req, res) => {
  const mensaje = String(req.body?.mensaje ?? "").trim();
  const situacion = SITUATIONS.includes(req.body?.situacion) ? req.body.situacion : null;
  const notas = String(req.body?.notas ?? "").trim().slice(0, 2000);
  const precio = String(req.body?.precio ?? "").trim().slice(0, 60);
  const clienteId = String(req.body?.cliente ?? "").trim();

  if (!mensaje) return res.status(400).json({ error: "Falta el mensaje del cliente." });
  if (mensaje.length > 6000) return res.status(400).json({ error: "El mensaje es demasiado largo." });
  if (!claveEfectiva() && !MODO_SIMULADO && !process.env.OPENAI_BASE_URL) {
    return res.status(400).json({
      error: "Todavia no has puesto tu clave. Entra en Ajustes y pegala ahi.",
      falta_clave: true,
    });
  }

  try {
    const datos = await generarRespuestas({ mensaje, situacion, notas, precio, clienteId });

    // Memoria: se apunta lo que dijo el cliente y lo que haya contado de si mismo.
    if (clienteId && obtenerCliente(clienteId)) {
      anotarMensaje(clienteId, "cliente", mensaje);
      if (datos.detalle_para_recordar) anotarDetalle(clienteId, datos.detalle_para_recordar);
    }

    res.json(datos);
  } catch (err) {
    const { status, mensaje: texto } = traducirError(err);
    console.error("[generate]", err?.status ?? "", err?.message ?? err);
    res.status(status).json({ error: texto });
  }
});

/* -------------------------------------------------------------- static --- */

app.get("/login", (req, res) => {
  if (isLoggedIn(req)) return res.redirect("/");
  res.sendFile(path.join(here, "views", "login.html"));
});

app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(here, "views", "index.html"));
});

app.get("/instrucciones", requireAuth, (req, res) => {
  res.sendFile(path.join(here, "views", "instrucciones.html"));
});

app.get("/ajustes", requireAuth, (req, res) => {
  res.sendFile(path.join(here, "views", "ajustes.html"));
});

app.get("/estilo", requireAuth, (req, res) => {
  res.sendFile(path.join(here, "views", "estilo.html"));
});

/**
 * Llega aqui cuando comparte texto desde otra aplicacion (Android).
 * Se pasa el texto a la pantalla principal para que genere sin tocar nada mas.
 */
app.get("/compartido", requireAuth, (req, res) => {
  const texto = [req.query.text, req.query.title, req.query.url]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" ")
    .trim()
    .slice(0, 6000);
  res.redirect("/?compartido=" + encodeURIComponent(texto));
});

// Solo CSS y JS. Las paginas viven en views/ y se sirven detras de requireAuth,
// para que no se puedan pedir directamente saltandose el login.
//
// `no-cache` no significa "no guardes": significa "pregunta siempre si ha
// cambiado". Asi, al retocar la app durante los ajustes, nadie se queda con una
// version vieja en el navegador (sigue devolviendo 304 si no ha cambiado nada).
app.use(
  express.static(path.join(here, "public"), {
    index: false,
    extensions: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  })
);

app.listen(PORT, () => {
  console.log(`Asistente escuchando en http://localhost:${PORT}`);
  if (MODO_SIMULADO) {
    console.log("MODO SIMULADO (MOCK=1): respuestas de ejemplo, no se llama a la API.");
  } else {
    console.log(
      `Modelo: ${modeloEfectivo()} · clave: ${origenClave()}` +
        (process.env.REASONING_EFFORT ? ` · esfuerzo: ${process.env.REASONING_EFFORT}` : "") +
        (process.env.OPENAI_BASE_URL ? ` · servidor: ${process.env.OPENAI_BASE_URL}` : "")
    );
  }
});
