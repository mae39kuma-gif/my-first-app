// ご主人モニター画面のロジック（見るだけ・状態は送れない）

const board = document.getElementById("board");
const logEl = document.getElementById("log");
const connState = document.getElementById("connState");
const totalCount = document.getElementById("totalCount");
const activeCount = document.getElementById("activeCount");

const requestsEl = document.getElementById("requests");

const people = {}; // 名前 -> 最新イベント
let logItems = []; // 活動ログ（新しい順）
let reqItems = []; // わんこからのリクエスト（新しい順）
let mealEditing = false; // 入力中はサーバーからの上書きを止める

const ACTIVE_MS = 5 * 60 * 1000; // 5分以内なら「活動中」とみなす

// ダッシュボードとログをこの端末に保存（サーバーが眠っても消えないように）
const CACHE_KEY = "masterCache";
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ people, logItems, reqItems }));
  } catch (e) {}
}
function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
}

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
      const detail = ev.message ? `：${ev.message}` : "";
      const active = now - new Date(ev.time).getTime() <= ACTIVE_MS;
      const card = document.createElement("div");
      card.className = "person" + (active ? "" : " idle");
      card.innerHTML = `
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
      const detail = ev.message ? `：${ev.message}` : "";
      const item = document.createElement("div");
      item.className = "log-item";
      item.innerHTML = `
        <span><b>${escapeHtml(ev.name)}</b> が <b>${escapeHtml(ev.status)}</b>${escapeHtml(detail)}</span>
        <span class="log-time">${relativeTime(ev.time)}</span>
      `;
      logEl.appendChild(item);
    });
  }
}

// わんこからのリクエスト一覧を描く
function renderRequests() {
  if (reqItems.length === 0) {
    requestsEl.innerHTML = '<div class="empty">まだリクエストはありません</div>';
    return;
  }
  requestsEl.innerHTML = "";
  reqItems.slice(0, 50).forEach((r) => {
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML = `
      <span class="emoji" style="font-size:20px">🦴</span>
      <span><span class="req-name">${escapeHtml(r.name)}</span>：${escapeHtml(r.text)}</span>
      <span class="log-time">${relativeTime(r.time)}</span>
    `;
    requestsEl.appendChild(item);
  });
}

// ごはん予定を入力欄に反映する（入力中は邪魔しない）
function fillMealInputs(plan) {
  if (mealEditing) return;
  document.getElementById("weekdayDinner").value = plan.weekdayDinner || "";
  document.getElementById("weekendLunch").value = plan.weekendLunch || "";
  document.getElementById("weekendDinner").value = plan.weekendDinner || "";
}

// 入力中フラグの管理
["weekdayDinner", "weekendLunch", "weekendDinner"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("focus", () => (mealEditing = true));
  el.addEventListener("blur", () => (mealEditing = false));
});

// ごはん予定を報告する
document.getElementById("saveMeal").addEventListener("click", async () => {
  mealEditing = false;
  const plan = {
    weekdayDinner: document.getElementById("weekdayDinner").value.trim(),
    weekendLunch: document.getElementById("weekendLunch").value.trim(),
    weekendDinner: document.getElementById("weekendDinner").value.trim(),
  };
  try {
    await fetch("/meal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    const msg = document.getElementById("mealSaved");
    msg.textContent = "✓ わんこ達に報告しました";
    setTimeout(() => (msg.textContent = ""), 3000);
  } catch (e) {
    alert("報告に失敗しました。");
  }
});

// ご主人が「今なにしてるか」をわんこに教える
document.getElementById("sendMasterStatus").addEventListener("click", async () => {
  const text = document.getElementById("masterStatusInput").value.trim();
  if (!text) {
    alert("教える内容を入力してください");
    return;
  }
  try {
    await fetch("/master-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const msg = document.getElementById("masterStatusSaved");
    msg.textContent = "✓ ゆうたに伝えました";
    setTimeout(() => (msg.textContent = ""), 3000);
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

// ゆうたへ応援ひとことを送る
async function sendCheer(text) {
  if (!text) {
    alert("メッセージを入力してください");
    return;
  }
  try {
    await fetch("/cheer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const msg = document.getElementById("cheerSaved");
    msg.textContent = `✓ 「${text}」を送りました`;
    setTimeout(() => (msg.textContent = ""), 3000);
  } catch (e) {
    alert("送信に失敗しました。");
  }
}
// よく使う言葉のボタン
document.querySelectorAll(".cheer-preset").forEach((b) => {
  b.addEventListener("click", () => sendCheer(b.dataset.msg));
});
// 自由入力の送信
document.getElementById("sendCheer").addEventListener("click", () => {
  const text = document.getElementById("cheerInput").value.trim();
  sendCheer(text);
  document.getElementById("cheerInput").value = "";
});
// 応援メッセージを消す
document.getElementById("clearCheer").addEventListener("click", async () => {
  if (!confirm("ゆうたへのメッセージを消しますか？")) return;
  try {
    await fetch("/clear-cheer", { method: "POST" });
  } catch (e) {
    alert("削除に失敗しました。");
  }
});

// リクエストを消すボタン
document.getElementById("clearReq").addEventListener("click", async () => {
  if (!confirm("わんこからのリクエストを全部消しますか？")) return;
  try {
    await fetch("/clear-requests", { method: "POST" });
  } catch (e) {
    alert("削除に失敗しました。");
  }
});

// ログを消すボタン（ご主人だけが操作）
document.getElementById("clearLog").addEventListener("click", async () => {
  if (!confirm("活動ログと、今の状態（ダッシュボード）を消しますか？\n（わんこの画面からも消えます）")) return;
  try {
    await fetch("/clear", { method: "POST" });
    // 消えた結果はサーバーからの "cleared" で反映される
  } catch (e) {
    alert("ログの削除に失敗しました。");
  }
});

// --- ポップアップ通知 ---
function notify(title, body) {
  // プッシュが使える端末では、サーバーからのプッシュが通知を出すので二重表示を避ける
  if (window.__pushActive) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body });
}

// 通知の許可をお願いする（ご主人の端末で）
const permNotice = document.getElementById("permNotice");
if ("Notification" in window) {
  if (Notification.permission === "default") {
    permNotice.innerHTML =
      '<a href="#" id="askPerm">🔔 通知をオンにする</a>（押すと、ゆうたの更新やおねがいがポップアップで届きます）';
    document.getElementById("askPerm").addEventListener("click", (e) => {
      e.preventDefault();
      Notification.requestPermission().then(() => location.reload());
    });
  } else if (Notification.permission === "granted") {
    permNotice.textContent = "🔔 通知はオンです";
    registerPush("master"); // 閉じていても届くプッシュを登録
  } else {
    permNotice.textContent = "🔕 通知はオフです（端末の設定から許可できます）";
  }
}

// 最初の読み込みで過去分まで通知しないように、初期化が終わってからONにする
let notifyReady = false;

function connect() {
  const es = new EventSource("/events");
  es.onopen = () => { connState.textContent = "監視中 ●"; };
  es.onerror = () => { connState.textContent = "切断 — 再接続中…"; };
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "init") {
      // まず端末に保存した内容を復元（サーバーが眠って空でも消えないように）
      const cache = loadCache();
      if (cache.people) Object.assign(people, cache.people);
      if (Array.isArray(cache.logItems)) logItems = cache.logItems.slice();
      if (Array.isArray(cache.reqItems)) reqItems = cache.reqItems.slice();
      // サーバーに中身があれば、それを優先して上書きする
      Object.values(data.statuses).forEach((ev) => (people[ev.name] = ev));
      if (Array.isArray(data.history) && data.history.length) logItems = data.history.slice();
      if (Array.isArray(data.requests) && data.requests.length) reqItems = data.requests.slice();
      if (data.mealPlan) fillMealInputs(data.mealPlan);
      if (data.masterStatus && data.masterStatus.text) {
        const el = document.getElementById("masterStatusInput");
        if (el !== document.activeElement) el.value = data.masterStatus.text;
      }
      render();
      renderRequests();
      saveCache();
      notifyReady = true; // ここから先の新着だけ通知する
    } else if (data.type === "update") {
      people[data.name] = data;
      logItems.unshift(data);
      if (logItems.length > 50) logItems.length = 50;
      render();
      saveCache();
      const detail = data.message ? `：${data.message}` : "";
      if (notifyReady) notify(`${data.name}さん`, `${data.status}${detail}`);
    } else if (data.type === "cleared") {
      // ご主人がログ＋ダッシュボードを消した
      logItems = [];
      for (const k in people) delete people[k];
      render();
      saveCache();
    } else if (data.type === "request") {
      reqItems.unshift(data.request);
      if (reqItems.length > 50) reqItems.length = 50;
      renderRequests();
      saveCache();
      if (notifyReady) notify(`🦴 ${data.request.name}からおねがい`, data.request.text);
    } else if (data.type === "requestscleared") {
      reqItems = [];
      renderRequests();
      saveCache();
    } else if (data.type === "meal") {
      fillMealInputs(data.mealPlan);
    }
  };
}
connect();

// 「○分前」と活動状況を定期更新
setInterval(render, 30000);
