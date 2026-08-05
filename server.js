import "dotenv/config";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import express from "express";
import cookieParser from "cookie-parser";

import { loadPersona, SITUATIONS } from "./src/prompt.js";
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
} from "./src/ajustes.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const APP_USER = process.env.APP_USER || "maiko";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!claveEfectiva() && !MODO_SIMULADO && !process.env.OPENAI_BASE_URL) {
  console.warn("[aviso] Sin clave configurada — se puede poner desde la web, en Ajustes.");
}
if (!APP_PASSWORD) {
  console.warn("[aviso] Falta APP_PASSWORD en .env — nadie podra entrar.");
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
  return req.signedCookies?.[COOKIE] === APP_USER && APP_PASSWORD.length > 0;
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
  const { usuario, clave } = req.body ?? {};
  const okUser = typeof usuario === "string" && usuario.trim() === APP_USER;
  const okPass =
    typeof clave === "string" &&
    APP_PASSWORD.length > 0 &&
    clave.length === APP_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(clave), Buffer.from(APP_PASSWORD));

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
  res.json({ autenticado: isLoggedIn(req), usuario: isLoggedIn(req) ? APP_USER : null });
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

  if (!mensaje) return res.status(400).json({ error: "Falta el mensaje del cliente." });
  if (mensaje.length > 6000) return res.status(400).json({ error: "El mensaje es demasiado largo." });
  if (!claveEfectiva() && !MODO_SIMULADO && !process.env.OPENAI_BASE_URL) {
    return res.status(400).json({
      error: "Todavia no has puesto tu clave. Entra en Ajustes y pegala ahi.",
      falta_clave: true,
    });
  }

  try {
    res.json(await generarRespuestas({ mensaje, situacion, notas }));
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
