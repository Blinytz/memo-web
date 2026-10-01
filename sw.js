// Cette adresse est retirée : Mnémo vit à https://blinytz.github.io/mnemo/.
// Le service worker ne sert plus rien : il vide les caches de l'ancienne copie
// (et seulement eux : le domaine est partagé avec les autres applications),
// se désinscrit, puis recharge les fenêtres ouvertes vers la redirection.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const noms = await caches.keys();
  const anciens = noms.filter((nom) => /^memo-v([0-9]+)$/.test(nom) && Number(nom.slice(6)) <= 91);
  await Promise.all(anciens.map((nom) => caches.delete(nom)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.navigate(client.url);
})()));
