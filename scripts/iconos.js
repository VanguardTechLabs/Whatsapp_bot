/**
 * Genera los iconos de la aplicacion a partir del mismo dibujo:
 *
 *   public/icono.svg      icono para navegadores modernos
 *   public/favicon.ico    16 y 32 px, para los que no admiten SVG
 *   public/icono-180.png  para la pantalla de inicio del iPhone
 *
 *   node scripts/iconos.js [colorFondo] [colorBarras]
 *
 * El dibujo: dos circulos en diagonal sobre un cuadrado redondeado. Uno es lo
 * que escribe el cliente y el otro lo que ella envia.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(here, "..", "public");

const FONDO = hexARgb(process.argv[2] || "#ff6f7d");
const BARRA = hexARgb(process.argv[3] || "#1a0710");

function hexARgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/* ------------------------------------------------------------- dibujo --- */

/** Distancia con signo a un rectangulo redondeado. Negativa = dentro. */
function distRect(px, py, cx, cy, mediaAncho, mediaAlto, r) {
  const dx = Math.abs(px - cx) - (mediaAncho - r);
  const dy = Math.abs(py - cy) - (mediaAlto - r);
  const fuera = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return fuera + Math.min(Math.max(dx, dy), 0) - r;
}

/** Proporciones del dibujo, en tanto por uno del lado. */
const BARRAS = [
  { x: 0.235, y: 0.265, w: 0.29, h: 0.29, redondo: true },
  { x: 0.50,  y: 0.47,  w: 0.29, h: 0.29, redondo: true },
];

/** Devuelve un buffer RGBA de lado x lado, con antialiasing por supermuestreo. */
function pintar(lado) {
  const buf = Buffer.alloc(lado * lado * 4);
  const M = 4; // 4x4 muestras por pixel
  const rFondo = lado * 0.28; // esquina generosa, tipo icono de app

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let dentroFondo = 0;
      let dentroBarra = 0;

      for (let sy = 0; sy < M; sy++) {
        for (let sx = 0; sx < M; sx++) {
          const px = x + (sx + 0.5) / M;
          const py = y + (sy + 0.5) / M;

          if (distRect(px, py, lado / 2, lado / 2, lado / 2, lado / 2, rFondo) < 0) {
            dentroFondo++;
          }
          for (const b of BARRAS) {
            const bx = b.x * lado, by = b.y * lado;
            const bw = b.w * lado, bh = b.h * lado;
            const r = b.redondo ? bh / 2 : 0;
            if (distRect(px, py, bx + bw / 2, by + bh / 2, bw / 2, bh / 2, r) < 0) {
              dentroBarra++;
              break;
            }
          }
        }
      }

      const total = M * M;
      const aFondo = dentroFondo / total;
      const aBarra = dentroBarra / total;

      // barra sobre fondo, y el conjunto recortado por el cuadrado redondeado
      const r = FONDO[0] * (1 - aBarra) + BARRA[0] * aBarra;
      const g = FONDO[1] * (1 - aBarra) + BARRA[1] * aBarra;
      const b = FONDO[2] * (1 - aBarra) + BARRA[2] * aBarra;

      const i = (y * lado + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(aFondo * 255);
    }
  }
  return buf;
}

/* ---------------------------------------------------------------- PNG --- */

const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function png(lado, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  // 10,11,12 = compresion, filtro, entrelazado: todos 0

  const filas = Buffer.alloc(lado * (lado * 4 + 1));
  for (let y = 0; y < lado; y++) {
    filas[y * (lado * 4 + 1)] = 0; // sin filtro
    rgba.copy(filas, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(filas, { level: 9 })),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- ICO --- */

function icoImagen(lado, rgba) {
  const cabecera = Buffer.alloc(40);
  cabecera.writeUInt32LE(40, 0);
  cabecera.writeInt32LE(lado, 4);
  cabecera.writeInt32LE(lado * 2, 8); // alto doble: imagen + mascara
  cabecera.writeUInt16LE(1, 12);
  cabecera.writeUInt16LE(32, 14);

  // BGRA, de abajo arriba
  const pixeles = Buffer.alloc(lado * lado * 4);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const o = ((lado - 1 - y) * lado + x) * 4;
      const i = (y * lado + x) * 4;
      pixeles[o] = rgba[i + 2];
      pixeles[o + 1] = rgba[i + 1];
      pixeles[o + 2] = rgba[i];
      pixeles[o + 3] = rgba[i + 3];
    }
  }

  // mascara AND: 1 bit por pixel, filas alineadas a 4 bytes. Todo 0 = opaco.
  const bytesFila = Math.ceil(lado / 32) * 4;
  const mascara = Buffer.alloc(bytesFila * lado);

  return Buffer.concat([cabecera, pixeles, mascara]);
}

function ico(lados) {
  const imagenes = lados.map((l) => ({ lado: l, datos: icoImagen(l, pintar(l)) }));

  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2); // 1 = icono
  cabecera.writeUInt16LE(imagenes.length, 4);

  const entradas = Buffer.alloc(16 * imagenes.length);
  let desplazamiento = 6 + 16 * imagenes.length;

  imagenes.forEach((img, n) => {
    const e = 16 * n;
    entradas[e] = img.lado === 256 ? 0 : img.lado;
    entradas[e + 1] = img.lado === 256 ? 0 : img.lado;
    entradas[e + 2] = 0;
    entradas[e + 3] = 0;
    entradas.writeUInt16LE(1, e + 4);
    entradas.writeUInt16LE(32, e + 6);
    entradas.writeUInt32LE(img.datos.length, e + 8);
    entradas.writeUInt32LE(desplazamiento, e + 12);
    desplazamiento += img.datos.length;
  });

  return Buffer.concat([cabecera, entradas, ...imagenes.map((i) => i.datos)]);
}

/* ---------------------------------------------------------------- SVG --- */

function svg() {
  const tinta = process.argv[3] || "#1a0710";
  const circulos = BARRAS.map((b, n) => {
    const r = (b.w * 32) / 2;
    const cx = (b.x * 32 + r).toFixed(2);
    const cy = (b.y * 32 + r).toFixed(2);
    const opacidad = n === 0 ? "" : ' opacity=".55"';
    return `  <circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="${tinta}"${opacidad}/>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${process.argv[2] || "#ff5f8f"}"/>
    <stop offset="1" stop-color="${process.argv[4] || "#ff9e5e"}"/>
  </linearGradient></defs>
  <rect width="32" height="32" rx="9" fill="url(#g)"/>
${circulos}
</svg>
`;
}

/* -------------------------------------------------------------- generar --- */

fs.writeFileSync(path.join(salida, "icono.svg"), svg());
fs.writeFileSync(path.join(salida, "favicon.ico"), ico([16, 32]));
fs.writeFileSync(path.join(salida, "icono-180.png"), png(180, pintar(180)));
fs.writeFileSync(path.join(salida, "icono-192.png"), png(192, pintar(192)));
fs.writeFileSync(path.join(salida, "icono-512.png"), png(512, pintar(512)));

for (const f of ["icono.svg", "favicon.ico", "icono-180.png", "icono-192.png", "icono-512.png"]) {
  const { size } = fs.statSync(path.join(salida, f));
  console.log(`  ${f.padEnd(16)} ${size} bytes`);
}
