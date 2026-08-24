# Asistente de respuestas — Maiko

Aplicación web privada. El cliente escribe en inglés, ella lo lee en español, elige entre
tres respuestas ya escritas en inglés, copia y envía. Un solo clic (o ninguno, en el ordenador).

---

## 1. Poner en marcha (una vez)

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
```

> **La clave se puede poner desde la web.** No hace falta tocar el `.env` para eso:
> entra en la aplicación → **Ajustes**, pega la clave y pulsa **Probar**. Se guarda
> en `config/ajustes.json` y tiene prioridad sobre lo que haya en `.env`.
> El `.env` sigue sirviendo para dejarla puesta de antemano.

Abre `.env` y rellena:

| Variable | Qué es |
|---|---|
| `OPENAI_API_KEY` | Clave de la API, se saca en https://platform.openai.com/api-keys |
| `APP_USER` / `APP_PASSWORD` | Usuario y clave para entrar en la web |
| `SESSION_SECRET` | Cualquier texto largo y aleatorio |
| `MODEL` | `gpt-5` (máxima calidad) o `gpt-5-mini` (más rápido y barato) |
| `REASONING_EFFORT` | `low` por defecto. Súbelo a `medium` si quieres respuestas más elaboradas a costa de velocidad. Déjalo vacío si el modelo no es de razonamiento |

Ver qué modelos tiene disponibles la cuenta (para no adivinar el valor de `MODEL`):

```bash
npm run modelos
```

Comprobar que la clave y el prompt funcionan, sin abrir el navegador:

```bash
npm run probar
npm run probar -- "hey beautiful, what are you up to tonight?"
```

Imprime la traducción, la situación detectada y las tres respuestas en consola.

### Probar gratis, sin clave y sin gastar nada

Añade `MOCK=1` al `.env` (o ponlo delante del comando). El asistente devuelve
respuestas de ejemplo escritas a mano, sin llamar a la API:

```bash
npm start          # con MOCK=1 en .env
```

Sirve para probar y enseñar **la interfaz**: el pegado automático, los botones de
copiar, el móvil, el diseño. **No sirve para valorar el tono** — esos textos son
fijos, no los escribe la IA. La pantalla lo avisa en rojo mientras está activo.

Quita `MOCK=1` para usarlo de verdad.

### Si la clave falla, se pasa solo al modo de prueba

Con `FALLBACK_SIMULADO=1` (el valor por defecto), cuando la clave está caducada,
mal copiada, sin saldo o el modelo no existe, la aplicación **no se queda en
blanco**: sigue funcionando en modo de prueba y explica el motivo en pantalla.

Solo ocurre con problemas que no se arreglan reintentando (clave, saldo, modelo).
Un corte de red o un pico de peticiones siguen dando error normal, porque ahí lo
correcto es reintentar, no cambiar de modo.

Cuando pasa, la pantalla muestra un aviso grande en rojo con el motivo, las
respuestas salen con el borde discontinuo y aparece un enlace a Ajustes. Es
deliberadamente llamativo: esas respuestas **no las escribe la IA** y no se le
deben enviar a un cliente.

Pon `FALLBACK_SIMULADO=0` si prefieres que dé error a secas.

### Probar gratis con un modelo local (Ollama)

Si quieres respuestas generadas de verdad sin pagar, puedes apuntar la app a
[Ollama](https://ollama.com) en tu propio ordenador. En `.env`:

```
OPENAI_BASE_URL=http://localhost:11434/v1
MODEL=llama3.1
REASONING_EFFORT=
```

Es gratis y sí genera texto real, pero la calidad queda muy por debajo: el tono en
inglés suena más plano y algunos modelos locales fallan al devolver el JSON con la
forma exacta. Vale para desarrollar; no vale para decidir el tono final ni para
entregar.

Arrancar:

```bash
npm start
```

Abre http://localhost:3000 — si el puerto 3000 ya está ocupado, cambia `PORT` en `.env`.

---

## 2. Cómo funciona por dentro

Una sola llamada a la API por mensaje. Es lo que hace que sea rápido: en una única
petición se obtiene la traducción **y** las tres respuestas, en lugar de encadenar
traducir → escribir → traducir de vuelta.

```
Mensaje del cliente (inglés)
        │
        └──► 1 llamada a OpenAI, Structured Outputs (JSON con esquema fijo, strict)
                 ├── idioma_cliente       → en / pt / fr ... (detectado)
                 ├── mensaje_en_espanol   → lo que dice el cliente
                 ├── situacion            → nuevo / casual / interesado / reconexión / habitual
                 └── respuestas[3]        → { etiqueta, texto, espanol }
```

- **El idioma de salida sigue al de entrada.** Si el cliente escribe en inglés se
  responde en inglés; si escribe en portugués, en portugués. Si el mensaje es
  demasiado corto para detectar el idioma (un emoji, un «ok»), se usa el inglés.
  La pantalla muestra una etiqueta «Responde en …» para que ella lo vea.
- **Las respuestas se escriben nativamente en ese idioma**, no se traducen del
  español. El campo `espanol` es una traducción fiel, solo para su control, y va
  siempre en español sea cual sea el idioma del cliente.
- El esquema va en modo `strict`: la API garantiza que el JSON llega siempre con la
  forma correcta, así que la interfaz nunca recibe algo que no sepa pintar.
- El prompt de sistema es idéntico en todas las peticiones, así que OpenAI lo sirve
  desde su caché automática de prompts: a partir de la segunda petición es más barato
  y más rápido, sin tener que configurar nada.
- La situación se detecta sola; el selector de la interfaz solo sirve para forzarla.

### Ficheros

```
server.js                 API + sesión + estáticos
src/prompt.js             Prompt de sistema y esquema JSON de la respuesta
src/generar.js            Llamada a OpenAI y traducción de errores
src/ajustes.js            Clave y modelo guardados desde la web
src/simulado.js           Respuestas de ejemplo para el modo MOCK
scripts/probar.js         Prueba de extremo a extremo por consola (npm run probar)
scripts/modelos.js        Lista los modelos de la cuenta (npm run modelos)
config/persona.json       ← LA PERSONALIDAD. Es lo único que hay que editar normalmente.
config/ajustes.json       Clave y modelo puestos desde la web (no se sube a git)
views/index.html          Pantalla principal
views/ajustes.html        Clave, modelo y botón de Probar
views/instrucciones.html  Manual de uso (accesible desde el panel)
views/login.html          Entrada
public/app.js             Portapapeles automático, copiar, atajos de teclado
public/styles.css
```

Las páginas viven en `views/` y **no** se sirven como ficheros estáticos: solo se
entregan detrás de `requireAuth`. En `public/` quedan únicamente el CSS y el JS.
Si estuvieran en `public/`, cualquiera podría pedir `/ajustes.html` y saltarse el
login.

### Seguridad

- El login admite **8 intentos fallidos** por IP; después bloquea esa IP 10 minutos.
  Va en memoria: se reinicia al reiniciar el servidor.
- Detrás de nginx se usa `trust proxy` para que el bloqueo cuente la IP real y
  no la del proxy. nginx tiene además su propio `limit_req` delante del login.
- La aplicación escucha en `127.0.0.1` (`HOST` en el `.env`), así que solo nginx
  puede llegar a ella: nadie puede entrar por `http://ip-del-pc:3010` y saltarse
  el HTTPS, el freno del login y las cabeceras de seguridad.
- Las páginas HTML no son ficheros públicos (ver arriba).

### Seguridad de la clave

`config/ajustes.json` guarda la clave en claro, igual que un `.env`, y se crea con
permisos `600`. Está en `.gitignore`. La web nunca devuelve la clave entera: solo
muestra los primeros y últimos caracteres. Aun así, la aplicación debe servirse por
HTTPS y detrás del login.

---

## 3. Editar la personalidad

Todo está en **`config/persona.json`**. Se edita con cualquier editor de texto y se
reinicia el servidor. No hay que tocar código.

Secciones:

- `identidad` — quién es
- `reglas_de_oro` — lo que hace siempre (orden conversación → detalles → recién ahí ofrecer)
- `prohibido_decir` — frases genéricas y de vendedora que quedan bloqueadas
- `temas_y_ganchos` — misterio, exclusividad, intensidad, juego
- `situaciones` — objetivo y ejemplo de tono para cada tipo de cliente
- `ejemplo_de_conversacion` — el ejemplo largo que marca el tono
- `ofertas` — **pendiente**: nombres y precios de los packs
- `limites` — **pendiente**: lo que nunca debe prometer

> ⚠️ Mientras `ofertas` y `limites` estén con `[PENDIENTE]`, el asistente no promete
> nada concreto: solo insinúa que "hay opciones". Es deliberado — así no puede
> comprometer a nada antes de tener esa lista.

---

## 4. Pendiente de la clienta

1. **Límites**: qué NO ofrece y qué no debe mencionarse nunca. Tres o cuatro puntos bastan.
2. **Packs y precios**: nombre y precio de cada uno.
3. Confirmar si algún cliente escribe en un idioma distinto del inglés
   (el sistema ya traduce cualquier idioma; solo afecta a las pruebas).

---

## 5. Fuera de alcance en esta versión

Acordado por escrito con la clienta como segunda fase, no incluido en los 190 USD:

- Etiquetas de cliente (nuevo / curioso / comprador / VIP)
- Memoria de conversaciones anteriores
- Mensajes programados de mañana / tarde / noche
- Envío automático
- Sistema de aprendizaje

---

## 6. Los datos que se guardan (importante al desplegar)

La aplicación escribe tres ficheros:

| Fichero | Qué guarda |
|---|---|
| `ajustes.json` | clave de OpenAI, modelo y la contraseña de acceso (con scrypt) |
| `clientes.json` | los clientes, sus detalles y el historial de conversación |
| `persona.json` | el estilo, editado desde la página **Estilo** |

Por defecto van a `config/`, dentro del repositorio. **En el servidor eso no
vale**: cualquier `git pull` o `git checkout` que toque esa carpeta se lleva por
delante los clientes, las conversaciones y el estilo que ella haya ajustado.

La solución es sacarlos del repositorio con una variable del `.env`:

```
DATA_DIR=C:\asistente-datos
```

El `config/persona.json` del repositorio pasa a ser solo la **plantilla**: la
primera vez se copia a `DATA_DIR` y a partir de ahí se edita la copia. Así
actualizar el código nunca pisa lo que ella haya cambiado.

> No apuntes `DATA_DIR` a la propia carpeta `config/` del repositorio: taparía la
> plantilla y volverías al problema de partida.

Copia de seguridad = copiar esa carpeta. Son tres ficheros de texto.

## 7. Despliegue: nginx en un PC propio

Necesita **HTTPS**. No es un adorno: el pegado automático del portapapeles solo
funciona en contexto seguro, y la cookie de sesión sale con el flag `secure`
cuando `NODE_ENV=production`, así que por HTTP el login ni siquiera guardaría la
sesión.

El montaje es: **nginx** coge el 443 con un certificado de Let's Encrypt y pasa
todo a la aplicación, que escucha solo en `127.0.0.1:3010`.

```
internet ──443──> nginx ──> 127.0.0.1:3010 ──> node server.js
```

### Lo que hay que tener antes

- **Node 20 o más** y `npm install` hecho.
- **nginx** instalado (aquí, en `C:\nginx`).
- Un **dominio que apunte a la IP de este PC**. Con DuckDNS basta, y sirve
  cualquier sub-nombre de uno que ya tengas.
- Los **puertos 80 y 443 abiertos** desde internet hacia este PC: el 80 lo usa
  Let's Encrypt para comprobar que el dominio es tuyo, el 443 es la aplicación.
- **simple-acme** (`winget install simple-acme.simple-acme`) para el certificado.

### Los pasos

```powershell
# 1. Dependencias y configuración
npm install
copy .env.example .env      # y rellenar APP_PASSWORD, SESSION_SECRET, DATA_DIR

# 2. Montarlo en nginx  (PowerShell COMO ADMINISTRADOR)
powershell -ExecutionPolicy Bypass -File servidor\instalar.ps1 -Dominio tu-dominio.duckdns.org

# 3. Certificado de verdad  (también como administrador)
powershell -ExecutionPolicy Bypass -File servidor\get-cert.ps1
```

`instalar.ps1` genera `nginx/asistente.conf` a partir de la plantilla, lo añade
al `nginx.conf` del sistema (guardando antes una copia con fecha), **comprueba la
configuración con `nginx -t` antes de reiniciar nada** y registra una tarea
programada que vuelve a levantar la aplicación si se cae o si se reinicia Windows.

Hasta que se pide el certificado, nginx usa uno autofirmado de arranque: la
página funciona, pero el navegador avisa. `get-cert.ps1` comprueba primero que el
dominio resuelve y que el puerto 80 llega de verdad desde internet, para no
gastar intentos contra Let's Encrypt si el router no está abierto.

### Qué hay en cada sitio

| Fichero | Para qué |
|---|---|
| `nginx/asistente.conf.plantilla` | Los bloques de nginx. Es lo que se edita. |
| `nginx/asistente.conf` | Generado con el dominio dentro. No se toca a mano. |
| `nginx/proxy_params.conf` | Cabeceras `X-Forwarded-*` que necesita la aplicación. |
| `servidor/instalar.ps1` | Monta todo lo anterior en el nginx del sistema. |
| `servidor/get-cert.ps1` | Pide el certificado y deja la renovación automática. |
| `servidor/arrancar.ps1` | Levanta la aplicación si no está en marcha. |

### El detalle que no se puede tocar

Las respuestas se van escribiendo en directo, una línea JSON por trozo. Si nginx
las acumulara, la pantalla se quedaría en blanco hasta el final y se perdería
justo lo que hace útil la aplicación. Por eso `location = /api/generate` lleva
`proxy_buffering off`, y por eso el `proxy_read_timeout` de ahí es de 300 s: el
cliente de OpenAI corta a los 90, y nginx tiene que aguantar más que él o sería
nginx quien cortara primero y el error nunca llegaría a verse.
