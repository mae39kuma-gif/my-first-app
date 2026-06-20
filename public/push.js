// プッシュ通知の登録（わんこ画面・ご主人画面の両方で使う共通コード）
// registerPush("dog") か registerPush("master") を呼ぶと、その端末を
// プッシュの送り先として登録する。アプリを閉じていても通知が届くようになる。

window.__pushActive = false;

// VAPID公開鍵(文字)を、subscribeで使える形式に変換する
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function registerPush(role) {
  // ユーザーが「解除」した端末では登録し直さない
  if (localStorage.getItem("pushDisabled") === "1") return;
  // 対応していないブラウザ、または通知が許可されていなければ何もしない
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    const reg = await navigator.serviceWorker.register("/sw.js");

    // サーバーにプッシュ用の鍵があるか確認
    const res = await fetch("/vapid-public-key");
    const { key } = await res.json();
    if (!key) return; // 鍵が未設定ならプッシュは使えない（画面が開いている間の通知のみ）

    // すでに登録済みならそれを使い、なければ新規登録
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    // この端末を、役割つきでサーバーに登録
    await fetch("/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub, role }),
    });

    window.__pushActive = true; // プッシュが使える状態
  } catch (e) {
    // 失敗してもアプリ自体は普通に使える
    console.log("push登録に失敗:", e);
  }
}

// プッシュ通知を解除する（この端末への通知を止める）
async function unsubscribePush() {
  localStorage.setItem("pushDisabled", "1"); // 次回以降も登録し直さない
  window.__pushActive = false;
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      // サーバーからこの端末を外す
      await fetch("/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe(); // ブラウザ側の登録も解除
    }
  } catch (e) {
    console.log("push解除に失敗:", e);
  }
}
