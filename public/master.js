// ご主人モニター画面のロジック（見るだけ・状態は送れない）

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
const EMOJI_MAP = Object.fromEntries(PRESETS.map((p) => [p.status, p.emoji]));

const board = document.getElementById("board");
const logEl = document.getElementById("log");
const connState = document.getElementById("connState");
const totalCount = document.getElementById("totalCount");
const activeCount = document.getElementById("activeCount");

const people = {}; // 名前 -> 最新イベント
let logItems = []; // 活動ログ（新しい順）

const ACTIVE_MS = 5 * 60 * 1000; // 5分以内なら「活動中」とみなす

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.floor(hour / 24)}日前`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function render() {
  const list = Object.values(people).sort(
    (a, b) => new Date(b.time) - new Date(a.time)
  );

  // 統計
  totalCount.textContent = list.length;
  const now = Date.now();
  activeCount.textContent = list.filter(
    (e) => now - new Date(e.time).getTime() <= ACTIVE_MS
  ).length;

  // 現在の状態カード
  if (list.length === 0) {
    board.innerHTML = '<div class="empty">まだ誰も状態を送っていません 🦴</div>';
  } else {
    board.innerHTML = "";
    list.forEach((ev) => {
      const emoji = EMOJI_MAP[ev.status] || "💬";
      const detail = ev.message ? `：${ev.message}` : "";
      const active = now - new Date(ev.time).getTime() <= ACTIVE_MS;
      const card = document.createElement("div");
      card.className = "person" + (active ? "" : " idle");
      card.innerHTML = `
        <div class="emoji">${emoji}</div>
        <div>
          <div class="person-name"><span class="dot ${active ? "on" : "off"}"></span>${escapeHtml(ev.name)}</div>
          <div class="person-status">${escapeHtml(ev.status)}${escapeHtml(detail)}</div>
          <div class="person-time">🐾 ${relativeTime(ev.time)}に更新</div>
        </div>
      `;
      board.appendChild(card);
    });
  }

  // 活動ログ
  if (logItems.length === 0) {
    logEl.innerHTML = '<div class="empty">まだ活動はありません</div>';
  } else {
    logEl.innerHTML = "";
    logItems.slice(0, 50).forEach((ev) => {
      const emoji = EMOJI_MAP[ev.status] || "💬";
      const detail = ev.message ? `：${ev.message}` : "";
      const item = document.createElement("div");
      item.className = "log-item";
      item.innerHTML = `
        <span class="emoji" style="font-size:20px">${emoji}</span>
        <span><b>${escapeHtml(ev.name)}</b> が <b>${escapeHtml(ev.status)}</b>${escapeHtml(detail)}</span>
        <span class="log-time">${relativeTime(ev.time)}</span>
      `;
      logEl.appendChild(item);
    });
  }
}

// ログを消すボタン（ご主人だけが操作）
document.getElementById("clearLog").addEventListener("click", async () => {
  if (!confirm("活動ログを全部消しますか？（みんなの画面からも消えます）")) return;
  try {
    await fetch("/clear", { method: "POST" });
    // 消えた結果はサーバーからの "logcleared" で反映される
  } catch (e) {
    alert("ログの削除に失敗しました。");
  }
});

function connect() {
  const es = new EventSource("/events");
  es.onopen = () => { connState.textContent = "監視中 ●"; };
  es.onerror = () => { connState.textContent = "切断 — 再接続中…"; };
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "init") {
      Object.values(data.statuses).forEach((ev) => (people[ev.name] = ev));
      if (Array.isArray(data.history)) logItems = data.history.slice();
      render();
    } else if (data.type === "update") {
      people[data.name] = data;
      logItems.unshift(data);
      if (logItems.length > 50) logItems.length = 50;
      render();
    } else if (data.type === "logcleared") {
      logItems = []; // ご主人がログを消した
      render();
    }
  };
}
connect();

// 「○分前」と活動状況を定期更新
setInterval(render, 30000);
