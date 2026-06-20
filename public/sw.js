// サービスワーカー：アプリを閉じていてもプッシュ通知を受け取る係

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {}
  const title = data.title || "お知らせ";
  const options = {
    body: data.body || "",
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🐶</text></svg>",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知をタップしたらアプリを開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
