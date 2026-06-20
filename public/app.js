// 画面側のロジック

// 選べる状態のプリセット（絵文字付き）
const PRESETS = [
  { status: "勉強中", emoji: "📚" },
  { status: "仕事中", emoji: "💻" },
  { status: "ご飯中", emoji: "🍚" },
  { status: "休憩中", emoji: "☕" },
  { status: "移動中", emoji: "🚃" },
  { status: "寝てる", emoji: "😴" },
  { status: "ヒマ", emoji: "🙋" },
  { status: "電話できる", emoji: "📞" },
];

// 状態 → 絵文字 の対応表（通知表示用）
const EMOJI_MAP = Object.fromEntries(PRESETS.map((p) => [p.status, p.emoji]));

const nameInput = document.getElementById("name");
const feed = document.getElementById("feed");
const connState = document.getElementById("connState");
const permNotice = document.getElementById("permNotice");

// 名前を覚えておく（次に開いたとき自動で入る）
nameInput.value = localStorage.getItem("myName") || "";
nameInput.addEventListener("input", () => {
  localStorage.setItem("myName", nameInput.value.trim());
});

// 状態ボタンを並べる
const btnArea = document.getElementById("statusButtons");
PRESETS.forEach((p) => {
  const b = document.createElement("button");
  b.className = "status";
  b.textContent = `${p.emoji} ${p.status}`;
  b.addEventListener("click", () => sendStatus(p.status));
  btnArea.appendChild(b);
});

// 自由入力の送信
document.getElementById("sendCustom").addEventListener("click", () => {
  const msg = document.getElementById("customMsg").value.trim();
  if (!msg) {
    alert("メッセージを入力してください");
    return;
  }
  sendStatus("ひとこと", msg);
  document.getElementById("customMsg").value = "";
});

// サーバーへ状態を送る
async function sendStatus(status, message = "") {
  const name = nameInput.value.trim();
  if (!name) {
    alert("先にあなたの名前を入れてください");
    nameInput.focus();
    return;
  }
  try {
    await fetch("/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, status, message }),
    });
  } catch (e) {
    alert("送信に失敗しました。サーバーが動いているか確認してください。");
  }
}

// 時刻をきれいに表示
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

// 通知を画面の一番上に追加
function addFeedItem(ev) {
  const empty = feed.querySelector(".empty");
  if (empty) empty.remove();

  const item = document.createElement("div");
  item.className = "feed-item";
  const emoji = EMOJI_MAP[ev.status] || "💬";
  const detail = ev.message ? `：${ev.message}` : "";
  item.innerHTML = `
    <div class="emoji">${emoji}</div>
    <div>
      <div class="feed-name">${escapeHtml(ev.name)}</div>
      <div class="feed-status">${escapeHtml(ev.status)}${escapeHtml(detail)}</div>
    </div>
    <div class="feed-time">${fmtTime(ev.time)}</div>
  `;
  feed.prepend(item);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ブラウザ通知を出す
function notify(ev) {
  // 自分の操作では通知を出さない
  if (ev.name === nameInput.value.trim()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const emoji = EMOJI_MAP[ev.status] || "💬";
  const body = ev.message ? `${ev.status}：${ev.message}` : ev.status;
  new Notification(`${emoji} ${ev.name}さん`, { body });
}

// 通知の許可をお願いする
if ("Notification" in window) {
  if (Notification.permission === "default") {
    permNotice.innerHTML =
      '<a href="#" id="askPerm">🔔 ブラウザ通知を許可する</a>（押すと相手の更新がポップアップで届きます）';
    document.getElementById("askPerm").addEventListener("click", (e) => {
      e.preventDefault();
      Notification.requestPermission().then(() => location.reload());
    });
  } else if (Notification.permission === "granted") {
    permNotice.textContent = "🔔 ブラウザ通知はオンです";
  }
}

// サーバーからのリアルタイム受信
function connect() {
  const es = new EventSource("/events");
  es.onopen = () => {
    connState.textContent = "接続中 ●";
  };
  es.onerror = () => {
    connState.textContent = "切断 — 再接続中…";
  };
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "init") {
      // つないだ直後：今みんながどんな状態かをまとめて表示
      Object.values(data.statuses)
        .sort((a, b) => new Date(a.time) - new Date(b.time))
        .forEach(addFeedItem);
    } else if (data.type === "update") {
      addFeedItem(data);
      notify(data);
    }
  };
}
connect();
