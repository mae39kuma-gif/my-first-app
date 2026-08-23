// 画面側のロジック

// 選べる状態のプリセット（文字だけ・4つ）
const PRESETS = ["仕事", "ご飯", "休憩", "寝る"];

// このアプリを使うわんこは「ゆうた」1人だけなので名前は固定
const MY_NAME = "ゆうた";

const board = document.getElementById("board");
const connState = document.getElementById("connState");
const permNotice = document.getElementById("permNotice");
const toast = document.getElementById("toast");

// 全員の「今の状態」を名前ごとに覚えておく（同じ人は1枚のカードに上書き）
const people = {}; // { 名前: イベント }

// ダッシュボードをこの端末に保存しておく（サーバーが眠っても消えないように）
const CACHE_KEY = "dashboardCache";
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(people)); } catch (e) {}
}
function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
}
function clearCache() {
  for (const k in people) delete people[k];
  try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
}

// ご主人が決めた内容（ごはん予定・状況・応援メッセージ）もこの端末に保存
const CONTENT_KEY = "contentCache";
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

// 「わん！〇〇と送りました！」のお知らせを画面に出す
let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// --- おうちのこと（鍵・クリーム）---
let currentLocked = false;
const lockBtn = document.getElementById("lockBtn");
const creamBtn = document.getElementById("creamBtn");

// 鍵の状態を画面に反映する
function showLock(lockState) {
  currentLocked = !!(lockState && lockState.locked);
  lockBtn.textContent = currentLocked ? "鍵：かけた" : "鍵：外した";
  lockBtn.classList.toggle("locked", currentLocked);
  const t = document.getElementById("lockStateText");
  t.textContent = lockState && lockState.time
    ? `🐾 ${currentLocked ? "かけた" : "外した"}の：${relativeTime(lockState.time)}`
    : "";
}

// クリームの状態を画面に反映する
function showCream(creamState) {
  const t = document.getElementById("creamStateText");
  t.textContent = creamState && creamState.time
    ? `🐾 最後に塗ったの：${relativeTime(creamState.time)}`
    : "🐾 まだ塗っていません";
}

// 首輪の状態を画面に反映する
let currentCollar = false;
function showCollar(collarState) {
  currentCollar = !!(collarState && collarState.on);
  const b = document.getElementById("collarBtn");
  b.textContent = collarState && collarState.time
    ? (currentCollar ? "首輪：付けた" : "首輪：外した")
    : "首輪：まだ";
  b.classList.toggle("locked", currentCollar);
  const t = document.getElementById("collarStateText");
  t.textContent = collarState && collarState.time
    ? `🐾 ${currentCollar ? "付けた" : "外した"}の：${relativeTime(collarState.time)}`
    : "";
}

// 「見て欲しい！」の状態を画面に反映する
function showLook(lookState) {
  const t = document.getElementById("lookStateText");
  t.textContent = lookState && lookState.time
    ? `🐾 最後に呼んだの：${relativeTime(lookState.time)}`
    : "";
}

// --- ごほうびスタンプ🐾 ---
// 今週（月曜はじまり）のスタンプだけ数えて表示する
function weekStart() {
  const d = new Date();
  const diff = (d.getDay() + 6) % 7; // 月曜を週のはじめにする
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
const GOAL1 = 7;  // ここまで集めると ごほうび
const GOAL2 = 14; // ここまで集めると もっとごほうび

let lastStampCount = -1; // 増えたときだけアニメを出すため

function showStamps(stamps) {
  const start = weekStart().getTime();
  const week = (stamps || []).filter((s) => new Date(s.time).getTime() >= start);
  const n = week.length;

  document.getElementById("stampCount").textContent = `${n}個`;

  // スタンプカードを描く（14マス。7つ目と14こ目はごほうび🎁）
  const card = document.getElementById("stampCard");
  card.innerHTML = "";
  const isNew = lastStampCount >= 0 && n > lastStampCount; // 今もらったところ
  for (let i = 1; i <= GOAL2; i++) {
    const filled = i <= n;
    const isGoal = i === GOAL1 || i === GOAL2;
    const slot = document.createElement("div");
    slot.className =
      "slot" + (filled ? " filled" : "") + (isGoal ? " goal" : "") +
      (filled && isNew && i === n ? " newest" : "");
    slot.textContent = filled ? "🐾" : isGoal ? "🎁" : i;
    card.appendChild(slot);
  }
  lastStampCount = n;

  // あと何個でごほうびかを知らせる
  const goal = document.getElementById("stampGoal");
  if (n >= GOAL2) {
    goal.textContent = "🎉 もっとごほうび🎁🎁 ゲット！すごい！";
  } else if (n >= GOAL1) {
    goal.textContent = `🎉 ごほうび🎁 ゲット！ あと${GOAL2 - n}こで もっとごほうび🎁🎁`;
  } else {
    goal.textContent = `あと${GOAL1 - n}つで ごほうび🎁`;
  }

  // 14こを超えた分
  const extra = document.getElementById("stampExtra");
  extra.textContent = n > GOAL2 ? `🐾 さらに ${n - GOAL2}こ ためたよ！` : "";

  markTodayStamps(stamps);
}

// --- ごほうび🎁 ---
// 「もっている数（もらった − つかった）」と「これまでの合計」を出す
function showRewards(rewards) {
  if (!rewards) return;
  const n = rewards.normal || { earned: 0, used: 0 };
  const b = rewards.big || { earned: 0, used: 0 };
  document.getElementById("have1").textContent = `${n.earned - n.used}こ`;
  document.getElementById("have2").textContent = `${b.earned - b.used}こ`;
  document.getElementById("rewardTotal").textContent =
    `これまでに ごほうび${n.earned}こ / もっとごほうび${b.earned}こ ためたよ` +
    (n.used + b.used > 0 ? `（つかったの：${n.used + b.used}こ）` : "");
}

// --- ごほうびのオネダリ ---
// ご主人に「これがしたい！」と送る
async function sendWish(text) {
  if (!text) {
    alert("したいことを書いてね");
    return;
  }
  const kind = document.getElementById("wishKind").value;
  try {
    await fetch("/wish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, text }),
    });
    document.getElementById("wishText").value = "";
    showToast(`わん！「${text}」をおねだりしました！🎁`);
  } catch (e) {
    alert("送信に失敗しました。");
  }
}
document.querySelectorAll(".wish-preset").forEach((b) => {
  b.addEventListener("click", () => sendWish(b.dataset.msg));
});
document.getElementById("sendWish").addEventListener("click", () => {
  sendWish(document.getElementById("wishText").value.trim());
});

// 最後に見たお返事を覚えておく（画面を開いた時に古い分で鳴らないように）
let lastAnsweredId = null;
let wishesReady = false;

// オネダリの一覧（お返事の結果もわかる）
function showWishes(wishes) {
  const el = document.getElementById("wishList");
  const list = (wishes || []).slice(0, 10);
  if (!list.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = "";
  list.forEach((w) => {
    const label =
      w.status === "done" ? "かなった🎉" : w.status === "no" ? "またこんど" : "おへんじまち";
    const item = document.createElement("div");
    item.className = "wish-item";
    item.innerHTML = `
      <span class="wish-badge ${w.status}">${label}</span>
      <span class="wish-text ${w.status === "no" ? "no" : ""}">${escapeHtml(w.text)}</span>
      <span class="wish-badge">${w.kind === "big" ? "🎁🎁" : "🎁"}</span>
    `;
    el.appendChild(item);
  });
}

// 今日もうスタンプをもらった する事のボタンに🐾を付ける
// （する事のスタンプは1日1つまでなので、押しても増えないことが分かるように）
function markTodayStamps(stamps) {
  const today = new Date().toDateString();
  const done = new Set(
    (stamps || [])
      .filter((s) => new Date(s.time).toDateString() === today)
      .map((s) => s.type)
  );
  [["鍵", "lockBtn"], ["クリーム", "creamBtn"], ["首輪", "collarBtn"]].forEach(
    ([type, id]) => {
      document.getElementById(id).classList.toggle("stamped", done.has(type));
    }
  );
}

// --- やり忘れのお知らせ ---
// 鍵とクリームが今日まだなら、夜に「まだだよ！」と出す
let todoList = [];
function showTodoWarn(todo) {
  todoList = todo || [];
  const el = document.getElementById("todoWarn");
  if (todoList.length) {
    el.textContent = `🐾 まだだよ！ ${todoList.join("と")}がまだだよ`;
    el.classList.add("show");
  } else {
    el.classList.remove("show");
  }
}
// 終わったものはお知らせから消す
function doneTodo(name) {
  if (todoList.includes(name)) showTodoWarn(todoList.filter((t) => t !== name));
}

// 鍵ボタン：押すたびに かけた⇄外した を切り替える
lockBtn.addEventListener("click", async () => {
  const next = !currentLocked;
  try {
    await fetch("/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: next }),
    });
    showToast(next ? "わん！鍵をかけたと送りました！" : "わん！鍵を外したと送りました！");
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

// クリームボタン：塗ったことを送る
creamBtn.addEventListener("click", async () => {
  try {
    await fetch("/cream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    showToast("わん！クリームを塗ったと送りました！");
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

// 首輪ボタン：押すたびに 付けた⇄外した を切り替える
document.getElementById("collarBtn").addEventListener("click", async () => {
  const next = !currentCollar;
  try {
    await fetch("/collar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: next }),
    });
    showToast(next ? "わん！首輪を付けたと送りました！" : "わん！首輪を外したと送りました！");
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

// 見て欲しい！ボタン
document.getElementById("lookBtn").addEventListener("click", async () => {
  try {
    await fetch("/look", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    showToast("わん！見て欲しいと送りました！");
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

// 状態ボタンを並べる（文字だけ）
const btnArea = document.getElementById("statusButtons");
PRESETS.forEach((status) => {
  const b = document.createElement("button");
  b.className = "status";
  b.textContent = status;
  b.addEventListener("click", () => sendStatus(status));
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

// ご主人からの応援メッセージを表示する
function showCheer(cheer) {
  const now = document.getElementById("cheerNow");
  const timeEl = document.getElementById("cheerTime");
  if (cheer && cheer.text) {
    now.textContent = cheer.text;
    now.classList.remove("empty-val");
    timeEl.textContent = cheer.time ? `🐾 ${relativeTime(cheer.time)}` : "";
  } else {
    now.textContent = "まだメッセージはありません";
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
  showTodayMeal(plan);
}

// 今日が平日か土日かを自動で見て、「今日のごはん」を大きく出す
function showTodayMeal(plan) {
  const now = new Date();
  const day = now.getDay(); // 0=日曜, 6=土曜
  const isWeekend = day === 0 || day === 6;
  // お昼までは昼ごはん、それ以降は夜ごはんを出す
  const isLunchTime = isWeekend && now.getHours() < 14;

  let label, val;
  if (isLunchTime) {
    label = "今日のお昼";
    val = plan.weekendLunch;
  } else if (isWeekend) {
    label = "今日の夜";
    val = plan.weekendDinner;
  } else {
    label = "今日の夜";
    val = plan.weekdayDinner;
  }

  document.getElementById("todayLabel").textContent = label;
  const el = document.getElementById("todayVal");
  if (val) {
    el.textContent = val;
    el.classList.remove("empty-val");
  } else {
    el.textContent = "まだ決まっていません";
    el.classList.add("empty-val");
  }
}

// 「さみしい」ボタン → ご主人に伝える
document.getElementById("lonelyBtn").addEventListener("click", async () => {
  try {
    await fetch("/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: MY_NAME, text: "さみしいよ〜🥺" }),
    });
    showToast("わん！さみしいってつたえました！🥺");
  } catch (e) {
    alert("送信に失敗しました。");
  }
});

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
    const isMe = ev.name === me;
    const done = ev.message === "おわった";
    const detail = ev.message ? `：${ev.message}` : "";

    const card = document.createElement("div");
    card.className = "person" + (isMe ? " me" : "");
    card.innerHTML = `
      <div>
        <div class="person-name">${escapeHtml(ev.name)}${
      isMe ? '<span class="you-tag">あなた</span>' : ""
    }</div>
        <div class="person-status${done ? " done" : ""}">${escapeHtml(ev.status)}${escapeHtml(
      detail
    )}</div>
        <div class="person-time">🐾 ${relativeTime(ev.time)}に更新</div>
      </div>
    `;

    // 仕事・ご飯・休憩のときは「終わり」ボタンを出す（寝るは対象外）
    const FINISHABLE = ["仕事", "ご飯", "休憩"];
    if (isMe && FINISHABLE.includes(ev.status) && !done) {
      const fb = document.createElement("button");
      fb.className = "finish-btn";
      fb.textContent = "終わり";
      fb.addEventListener("click", () =>
        sendStatus(ev.status, "おわった", `わん！${ev.status}が終わったと送りました！`)
      );
      card.appendChild(fb);
    }

    board.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ブラウザ通知を出す（汎用）
function notifyPopup(title, body) {
  // プッシュが使える端末では、サーバーからのプッシュが通知を出すので二重表示を避ける
  if (window.__pushActive) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body });
}

// ブラウザ通知を出す（他の人の状態更新用）
function notify(ev) {
  // 自分の操作では通知を出さない
  if (ev.name === MY_NAME) return;
  const body = ev.message ? `${ev.status}：${ev.message}` : ev.status;
  notifyPopup(`${ev.name}さん`, body);
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
    if (localStorage.getItem("pushDisabled") === "1") {
      permNotice.innerHTML = '🔕 通知を解除しています（<a href="#" id="onPush">もう一度オンにする</a>）';
      document.getElementById("onPush").addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("pushDisabled");
        location.reload();
      });
    } else {
      ensurePushRole("dog"); // この端末の宛先を決める（すでにあればそのまま）
      permNotice.innerHTML =
        '🔔 ブラウザ通知はオンです（<a href="#" id="offPush">解除する</a>）<br>' +
        roleNoticeHtml();
      registerPush("dog"); // 閉じていても届くプッシュを登録
      document.getElementById("offPush").addEventListener("click", (e) => {
        e.preventDefault();
        unsubscribePush().then(() => location.reload());
      });
      wireRoleSwitch();
    }
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
      // まず端末に保存した内容を出す（サーバーが眠って空でも消えないように）
      Object.assign(people, loadCache());
      // サーバーに最新の状態があれば、それで上書きする
      Object.values(data.statuses).forEach((ev) => (people[ev.name] = ev));
      // サーバーが眠って空で戻ってきたら、端末に保存した内容を使う
      const cached = loadContent();
      const meal = mealHasContent(data.mealPlan) ? data.mealPlan : (cached.mealPlan || data.mealPlan);
      const ms = (data.masterStatus && data.masterStatus.text) ? data.masterStatus : (cached.masterStatus || data.masterStatus);
      const cheer = (data.lastCheer && data.lastCheer.text) ? data.lastCheer : (cached.lastCheer || data.lastCheer);
      showMealPlan(meal);
      showMasterStatus(ms);
      showCheer(cheer);
      showLock(data.lockState);
      showCream(data.creamState);
      showCollar(data.collarState);
      showLook(data.lookState);
      showStamps(data.stamps);
      showRewards(data.rewards);
      showWishes(data.wishes);
      // 画面を開いた時点のお返事は「見たこと」にして、あとの新着だけ知らせる
      const seen = (data.wishes || []).find((w) => w.status !== "pending");
      lastAnsweredId = seen ? seen.id : null;
      wishesReady = true;
      saveContent({ mealPlan: meal, masterStatus: ms, lastCheer: cheer });
      render();
      saveCache();
    } else if (data.type === "update") {
      people[data.name] = data; // 同じ人は上書き
      render();
      saveCache();
      notify(data);
    } else if (data.type === "cleared") {
      // ご主人がログ＋ダッシュボードを消した
      clearCache();
      render();
    } else if (data.type === "meal") {
      // ご主人がごはん予定を更新した
      showMealPlan(data.mealPlan);
      updateContent("mealPlan", data.mealPlan);
      notifyPopup("🍚 ごはん予定が更新されたよ", "ご主人が予定を決めたよ！");
    } else if (data.type === "masterStatus") {
      // ご主人が「今なにしてるか」を更新した
      showMasterStatus(data.masterStatus);
      updateContent("masterStatus", data.masterStatus);
      if (data.masterStatus && data.masterStatus.text)
        notifyPopup("📣 ご主人より", data.masterStatus.text);
    } else if (data.type === "cheer") {
      // ご主人から応援メッセージが届いた（空のときは削除されたとき）
      showCheer(data.cheer);
      updateContent("lastCheer", data.cheer);
      if (data.cheer && data.cheer.text) {
        showToast(`💌 ご主人より：${data.cheer.text}`);
        notifyPopup("💌 ご主人より", data.cheer.text);
      }
    } else if (data.type === "lock") {
      showLock(data.lockState);
      showStamps(data.stamps);
      showRewards(data.rewards);
      if (data.lockState && data.lockState.locked) doneTodo("鍵");
    } else if (data.type === "cream") {
      showCream(data.creamState);
      showStamps(data.stamps);
      doneTodo("クリーム");
    } else if (data.type === "collar") {
      showCollar(data.collarState);
      showStamps(data.stamps);
    } else if (data.type === "look") {
      showLook(data.lookState);
    } else if (data.type === "stamp") {
      // ご主人がスタンプをくれた
      showStamps(data.stamps);
      showRewards(data.rewards);
      showToast("わん！スタンプをもらいました！🐾");
      notifyPopup("🐾 スタンプをもらったよ！", "ご主人からスタンプが1つ");
    } else if (data.type === "wishes") {
      // オネダリの状況が変わった（送った／お返事がきた）
      showWishes(data.wishes);
      if (data.rewards) showRewards(data.rewards);
      // 新しいお返事がきたときだけ知らせる
      const answered = (data.wishes || []).find((w) => w.status !== "pending");
      if (answered && wishesReady && answered.id !== lastAnsweredId) {
        showToast(
          answered.status === "done"
            ? `🎉 「${answered.text}」がかなったよ！`
            : `「${answered.text}」は またこんど`
        );
      }
      if (answered) lastAnsweredId = answered.id;
    } else if (data.type === "reminder") {
      // 夜になってもやり忘れがあるとき
      showTodoWarn(data.todo);
      notifyPopup("🐾 まだだよ！", `${data.todo.join("と")}がまだだよ`);
    }
  };
}
connect();

// 「○分前」の表示を定期的に更新する
setInterval(render, 30000);
// 日付が変わったときのために「今日のごはん」も定期的に見直す
setInterval(() => showTodayMeal(loadContent().mealPlan || {}), 60000);
