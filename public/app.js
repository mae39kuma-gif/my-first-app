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

// このアプリを使うわんこは「ゆうた」1人だけなので名前は固定
const MY_NAME = "ゆうた";

const board = document.getElementById("board");
const connState = document.getElementById("connState");
const permNotice = document.getElementById("permNotice");
const toast = document.getElementById("toast");

// 全員の「今の状態」を名前ごとに覚えておく（同じ人は1枚のカードに上書き）
const people = {}; // { 名前: イベント }

// 「わん！〇〇と送りました！」のお知らせを画面に出す
let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// 状態ボタンを並べる
const btnArea = document.getElementById("statusButtons");
PRESETS.forEach((p) => {
  const b = document.createElement("button");
  b.className = "status";
  b.textContent = `${p.emoji} ${p.status}`;
  b.addEventListener("click", () => sendStatus(p.status));
  btnArea.appendChild(b);
});

// ご主人が「今なにしてるか」を表示する
function showMasterStatus(ms) {
  const now = document.getElementById("masterNow");
  const timeEl = document.getElementById("masterTime");
  if (ms && ms.text) {
    now.textContent = ms.text;
    now.classList.remove("empty-val");
    timeEl.textContent = ms.time ? `🐾 ${relativeTime(ms.time)}に更新` : "";
  } else {
    now.textContent = "まだお知らせはありません";
    now.classList.add("empty-val");
    timeEl.textContent = "";
  }
}

// ごはん予定（ご主人が決めたもの）を表示する
function showMealPlan(plan) {
  plan = plan || {};
  const map = {
    mvWeekdayDinner: plan.weekdayDinner,
    mvWeekendLunch: plan.weekendLunch,
    mvWeekendDinner: plan.weekendDinner,
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (val) {
      el.textContent = val;
      el.classList.remove("empty-val");
    } else {
      el.textContent = "まだ決まっていません";
      el.classList.add("empty-val");
    }
  });
}

// ごはんのリクエストを送る
document.getElementById("sendReq").addEventListener("click", async () => {
  const text = document.getElementById("reqMsg").value.trim();
  if (!text) {
    alert("リクエストを入力してください");
    return;
  }
  try {
    await fetch("/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: MY_NAME, text }),
    });
    document.getElementById("reqMsg").value = "";
    showToast(`わん！「${text}」とおねがいしました！🦴`);
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

// 自由入力の送信
document.getElementById("sendCustom").addEventListener("click", () => {
  const msg = document.getElementById("customMsg").value.trim();
  if (!msg) {
    alert("メッセージを入力してください");
    return;
  }
  sendStatus("ひとこと", msg, `わん！「${msg}」と送りました！`);
  document.getElementById("customMsg").value = "";
});

// サーバーへ状態を送る
async function sendStatus(status, message = "", toastText = "") {
  try {
    await fetch("/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: MY_NAME, status, message }),
    });
    // 「わん！〇〇をしていると送りました！」のお知らせを出す
    showToast(toastText || `わん！${status}をしていると送りました！`);
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
  const me = MY_NAME;
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
  if (ev.name === MY_NAME) return;
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
      showMealPlan(data.mealPlan);
      showMasterStatus(data.masterStatus);
      render();
    } else if (data.type === "update") {
      people[data.name] = data; // 同じ人は上書き
      render();
      notify(data);
    } else if (data.type === "meal") {
      // ご主人がごはん予定を更新した
      showMealPlan(data.mealPlan);
    } else if (data.type === "masterStatus") {
      // ご主人が「今なにしてるか」を更新した
      showMasterStatus(data.masterStatus);
    }
  };
}
connect();

// 「○分前」の表示を定期的に更新する
setInterval(render, 30000);
