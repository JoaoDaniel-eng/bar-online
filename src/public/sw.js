const V = 'bdc-__BUILD__'; // __BUILD__ é trocado pelo servidor a cada deploy (veja server.js): é isso que faz o celular perceber a versão nova
const FILES = ['/', '/manifest.webmanifest', '/icons/logo.jpg', '/icons/icon-192.png'];
// Sem skipWaiting aqui: a versão nova espera, a loja mostra "nova atualização disponível" e só troca quando o cliente toca em Atualizar.
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES))); });
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/admin')) return;
  e.respondWith(fetch(e.request).then(r => {
    const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
