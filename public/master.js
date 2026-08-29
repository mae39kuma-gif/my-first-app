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

// ごはん予定・状況をこの端末に保存（サーバーが眠っても入力欄が消えないように）
const CONTENT_KEY = "masterContent";
function loadContent() {
  try { return JSON.parse(localStorage.getItem(CONTENT_KEY)) || {}; } catch (e) { return {}; }
}
function saveContent(c) {
  try { localStorage.setItem(CONTENT_KEY, JSON.stringify(c)); } catch (e) {}
}
function updateContent(key, value) {
  const c = loadContent();
  c[key] = value;
  saveContent(c);
}
function mealHasContent(m) {
  return !!(m && (m.weekdayDinner || m.weekendLunch || m.weekendDinner));
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

// おうちのこと（鍵・クリーム）を表示する
function showLock(lockState) {
  const el = document.getElementById("mLock");
  const t = document.getElementById("mLockTime");
  if (lockState && lockState.time) {
    el.textContent = lockState.locked ? "🔒 かけている" : "🔓 外している";
    t.textContent = `${relativeTime(lockState.time)}に更新`;
  } else {
    el.textContent = "—";
    t.textContent = "";
  }
}
function showCream(creamState) {
  const el = document.getElementById("mCream");
  const t = document.getElementById("mCreamTime");
  if (creamState && creamState.time) {
    el.textContent = "塗った";
    t.textContent = `${relativeTime(creamState.time)}`;
  } else {
    el.textContent = "まだ塗っていない";
    t.textContent = "";
  }
}
function showCollar(collarState) {
  const el = document.getElementById("mCollar");
  const t = document.getElementById("mCollarTime");
  if (collarState && collarState.time) {
    el.textContent = collarState.on ? "🦮 付けている" : "外している";
    t.textContent = `${relativeTime(collarState.time)}に更新`;
  } else {
    el.textContent = "—";
    t.textContent = "";
  }
}
function showLook(lookState) {
  const el = document.getElementById("mLook");
  const t = document.getElementById("mLookTime");
  if (lookState && lookState.time) {
    el.textContent = "呼ばれた";
    t.textContent = `${relativeTime(lookState.time)}`;
  } else {
    el.textContent = "—";
    t.textContent = "";
  }
}

// --- ごほうびスタンプ🐾（今週分だけ数える）---
function weekStart() {
  const d = new Date();
  const diff = (d.getDay() + 6) % 7; // 月曜を週のはじめにする
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
const GOAL1 = 7;  // ここまで集めると ごほうび
const GOAL2 = 14; // ここまで集めると もっとごほうび

function showStamps(stamps) {
  const start = weekStart().getTime();
  const week = (stamps || []).filter((s) => new Date(s.time).getTime() >= start);
  const n = week.length;

  document.getElementById("stampCount").textContent = `${n}個`;

  // スタンプカードを描く（14マス。7つ目と14こ目はごほうび🎁）
  const card = document.getElementById("stampCard");
  card.innerHTML = "";
  for (let i = 1; i <= GOAL2; i++) {
    const filled = i <= n;
    const isGoal = i === GOAL1 || i === GOAL2;
    const slot = document.createElement("div");
    slot.className = "slot" + (filled ? " filled" : "") + (isGoal ? " goal" : "");
    slot.textContent = filled ? "🐾" : isGoal ? "🎁" : i;
    card.appendChild(slot);
  }

  const goal = document.getElementById("stampGoal");
  if (n >= GOAL2) {
    goal.textContent = "🎉 もっとごほうび🎁🎁 達成！";
  } else if (n >= GOAL1) {
    goal.textContent = `🎉 ごほうび🎁 達成！ あと${GOAL2 - n}こで もっとごほうび`;
  } else {
    goal.textContent = `あと${GOAL1 - n}つで ごほうび🎁`;
  }
}

// --- ごほうび🎁の管理 ---
function showRewards(rewards) {
  if (!rewards) return;
  const n = rewards.normal || { earned: 0, used: 0 };
  const b = rewards.big || { earned: 0, used: 0 };
  document.getElementById("mHave1").textContent = n.earned - n.used;
  document.getElementById("mHave2").textContent = b.earned - b.used;
  document.getElementById("mEarned1").textContent = n.earned;
  document.getElementById("mUsed1").textContent = n.used;
  document.getElementById("mEarned2").textContent = b.earned;
  document.getElementById("mUsed2").textContent = b.used;
}

// --- ゆうたのオネダリ ---
let wishItems = [];
function renderWishes() {
  const el = document.getElementById("wishes");
  if (!wishItems.length) {
    el.innerHTML = '<div class="empty">まだオネダリはありません</div>';
    return;
  }
  el.innerHTML = "";
  wishItems.slice(0, 30).forEach((w) => {
    const kindLabel = w.kind === "big" ? "もっとごほうび🎁🎁" : "ごほうび🎁";
    const item = document.createElement("div");
    item.className = "wish-item";
    item.innerHTML = `
      <div class="wish-main">
        <div class="wish-text ${w.status === "no" ? "no" : ""}">${escapeHtml(w.text)}</div>
        <div class="wish-meta">${kindLabel}・${relativeTime(w.time)}</div>
      </div>
    `;
    const acts = document.createElement("div");
    if (w.status === "pending") {
      acts.className = "wish-acts";
      const yes = document.createElement("button");
      yes.className = "wish-btn yes";
      yes.textContent = "かなえる";
      yes.addEventListener("click", () => answerWish(w.id, true, w.text));
      const no = document.createElement("button");
      no.className = "wish-btn no";
      no.textContent = "またこんど";
      no.addEventListener("click", () => answerWish(w.id, false, w.text));
      acts.append(yes, no);
    } else if (w.status === "done") {
      acts.className = "wish-done";
      acts.textContent = "かなえた🎉";
    } else {
      acts.className = "wish-nope";
      acts.textContent = "またこんど";
    }
    item.appendChild(acts);
    el.appendChild(item);
  });
}

async function answerWish(id, ok, text) {
  if (ok && !confirm(`「${text}」をかなえますか？（ごほうびを1つつかいます）`)) return;
  try {
    const res = await fetch("/wish-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ok }),
    });
    const json = await res.json();
    if (!json.ok) alert(json.reason || "できませんでした");
  } catch (e) {
    alert("送信に失敗しました。");
  }
}

document.getElementById("clearWishes").addEventListener("click", async () => {
  if (!confirm("お返事ずみのオネダリを消しますか？（お返事まちは残ります）")) return;
  try {
    await fetch("/clear-wishes", { method: "POST" });
  } catch (e) {
    alert("削除に失敗しました。");
  }
});

// ＋（足す）／つかう（減らす）ボタン
// もらった数・つかった数を ＋1 / −1 する（間違えたときも直せる）
document.querySelectorAll(".rw-btn").forEach((b) => {
  b.addEventListener("click", async () => {
    try {
      const res = await fetch("/adjust-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: b.dataset.kind,
          field: b.dataset.field,
          diff: Number(b.dataset.diff),
        }),
      });
      const json = await res.json();
      if (!json.ok) alert(json.reason || "できませんでした");
    } catch (e) {
      alert("送信に失敗しました。");
    }
  });
});

// スタンプをあげるボタン
document.getElementById("giveStamp").addEventListener("click", async () => {
  const b = document.getElementById("giveStamp");
  try {
    await fetch("/give-stamp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    b.textContent = "🐾 あげました！";
    setTimeout(() => (b.textContent = "🐾 スタンプをあげる"), 1500);
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

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
    updateContent("mealPlan", plan); // 端末にも保存（サーバーが眠っても残る）
    const msg = document.getElementById("mealSaved");
    msg.textContent = "✓ ゆうたに報告しました";
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
    updateContent("masterStatus", { text }); // 端末にも保存
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
// 返事ボタン（ワンタップでゆうたに返事する）
document.querySelectorAll(".reply-btn").forEach((b) => {
  b.addEventListener("click", async () => {
    const text = b.dataset.msg;
    const before = b.textContent;
    await sendCheer(text);
    b.textContent = "送った！";
    setTimeout(() => (b.textContent = before), 1500);
  });
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
    if (localStorage.getItem("pushDisabled") === "1") {
      permNotice.innerHTML = '🔕 通知を解除しています（<a href="#" id="onPush">もう一度オンにする</a>）';
      document.getElementById("onPush").addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("pushDisabled");
        location.reload();
      });
    } else {
      ensurePushRole("master"); // この端末の宛先を決める（すでにあればそのまま）
      permNotice.innerHTML =
        '🔔 通知はオンです（<a href="#" id="offPush">解除する</a>）<br>' +
        roleNoticeHtml();
      registerPush("master"); // 閉じていても届くプッシュを登録
      document.getElementById("offPush").addEventListener("click", (e) => {
        e.preventDefault();
        unsubscribePush().then(() => location.reload());
      });
      wireRoleSwitch();
    }
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
      // ごはん予定・状況：サーバーが空なら端末の保存内容を使う
      const cContent = loadContent();
      const meal = mealHasContent(data.mealPlan) ? data.mealPlan : (cContent.mealPlan || data.mealPlan);
      if (meal) fillMealInputs(meal);
      const msText = (data.masterStatus && data.masterStatus.text)
        ? data.masterStatus.text
        : (cContent.masterStatus && cContent.masterStatus.text) || "";
      if (msText) {
        const el = document.getElementById("masterStatusInput");
        if (el !== document.activeElement) el.value = msText;
      }
      saveContent({ mealPlan: meal, masterStatus: { text: msText } });
      showLock(data.lockState);
      showCream(data.creamState);
      showCollar(data.collarState);
      showLook(data.lookState);
      showStamps(data.stamps);
      showRewards(data.rewards);
      wishItems = data.wishes || [];
      renderWishes();
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
      updateContent("mealPlan", data.mealPlan);
    } else if (data.type === "lock") {
      showLock(data.lockState);
      showStamps(data.stamps);
      showRewards(data.rewards);
      if (notifyReady)
        notify(data.lockState.locked ? "🔒 鍵をかけたよ" : "🔓 鍵を外したよ", "ゆうた");
    } else if (data.type === "cream") {
      showCream(data.creamState);
      showStamps(data.stamps);
      showRewards(data.rewards);
      if (notifyReady) notify("🧴 クリームを塗ったよ", "ゆうた");
    } else if (data.type === "collar") {
      showCollar(data.collarState);
      showStamps(data.stamps);
      showRewards(data.rewards);
      if (notifyReady)
        notify(data.collarState.on ? "🦮 首輪をつけたよ" : "🦮 首輪を外したよ", "ゆうた");
    } else if (data.type === "look") {
      showLook(data.lookState);
      if (notifyReady) notify("👀 見て欲しい！", "ゆうた");
    } else if (data.type === "stamp") {
      showStamps(data.stamps);
      showRewards(data.rewards);
    } else if (data.type === "rewards") {
      showRewards(data.rewards);
    } else if (data.type === "wishes") {
      const before = wishItems.filter((w) => w.status === "pending").length;
      wishItems = data.wishes || [];
      if (data.rewards) showRewards(data.rewards);
      renderWishes();
      const after = wishItems.filter((w) => w.status === "pending").length;
      if (notifyReady && after > before) {
        const newest = wishItems.find((w) => w.status === "pending");
        if (newest) notify("🎁 ゆうたのオネダリ", newest.text);
      }
    }
  };
}
connect();

// 「○分前」と活動状況を定期更新
setInterval(render, 30000);
