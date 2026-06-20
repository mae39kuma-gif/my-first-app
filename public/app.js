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
const board = document.getElementById("board");
const connState = document.getElementById("connState");
const permNotice = document.getElementById("permNotice");

// 全員の「今の状態」を名前ごとに覚えておく（同じ人は1枚のカードに上書き）
const people = {}; // { 名前: イベント }

// 名前を覚えておく（次に開いたとき自動で入る）
nameInput.value = localStorage.getItem("myName") || "";
nameInput.addEventListener("input", () => {
  localStorage.setItem("myName", nameInput.value.trim());
  render(); // 自分のカードに「あなた」印を付け直す
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

// 「○分前」のような表示にする
function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.floor(hour / 24)}日前`;
}

// ダッシュボードを描き直す（全員のカードを最新更新順に並べる）
function render() {
  const me = nameInput.value.trim();
  const list = Object.values(people).sort(
    (a, b) => new Date(b.time) - new Date(a.time)
  );

  if (list.length === 0) {
    board.innerHTML = '<div class="empty">まだ誰も状態を送っていません</div>';
    return;
  }

  board.innerHTML = "";
  list.forEach((ev) => {
    const emoji = EMOJI_MAP[ev.status] || "💬";
    const detail = ev.message ? `：${ev.message}` : "";
    const isMe = ev.name === me;

    const card = document.createElement("div");
    card.className = "person" + (isMe ? " me" : "");
    card.innerHTML = `
      <div class="emoji">${emoji}</div>
      <div>
        <div class="person-name">${escapeHtml(ev.name)}${
      isMe ? '<span class="you-tag">あなた</span>' : ""
    }</div>
        <div class="person-status">${escapeHtml(ev.status)}${escapeHtml(
      detail
    )}</div>
        <div class="person-time">🐾 ${relativeTime(ev.time)}に更新</div>
      </div>
    `;
    board.appendChild(card);
  });
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
      // つないだ直後：今みんながどんな状態かをまとめて反映
      Object.values(data.statuses).forEach((ev) => (people[ev.name] = ev));
      render();
    } else if (data.type === "update") {
      people[data.name] = data; // 同じ人は上書き
      render();
      notify(data);
    }
  };
}
connect();

// 「○分前」の表示を定期的に更新する
setInterval(render, 30000);
