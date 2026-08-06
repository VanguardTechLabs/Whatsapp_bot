/**
 * Service worker minimo.
 *
 * Existe para que el movil pueda instalar la aplicacion en la pantalla de
 * inicio: sin service worker, Android no ofrece "Instalar".
 *
 * A proposito NO cachea nada de la aplicacion. Es una herramienta que se usa
 * en directo y contra el servidor; un cache aqui solo serviria para que la
 * usuaria viera una version vieja sin entender por que.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      // Por si alguna version anterior dejo caches: se limpian.
      const nombres = await caches.keys();
      await Promise.all(nombres.map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (evento) => {
  // Siempre a la red. Si no hay conexion, el navegador muestra su propio aviso.
  evento.respondWith(fetch(evento.request));
});
