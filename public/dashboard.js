// 自分用スマホダッシュボード
// データ(レイアウト・ToDo・メモ・リンク・天気の場所)はすべて
// この端末(localStorage)に保存します。サーバーには送りません。

// ---------- 小さなヘルパー ----------
const $ = (sel) => document.querySelector(sel);
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  if (/^\s*javascript:/i.test(s)) return "#"; // 危険なスキームを無効化
  return escapeHtml(s);
}

// ---------- 時計・あいさつ（時計ウィジェットの中身を更新） ----------
function tick() {
  const timeEl = document.querySelector('.widget[data-id="clock"] [data-clock="time"]');
  if (!timeEl) return; // 時計ウィジェットが無ければ何もしない
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const pad = (n) => String(n).padStart(2, "0");
  timeEl.innerHTML = `${pad(h)}:${pad(m)}<span class="sec">${pad(s)}</span>`;
  const week = ["日", "月", "火", "水", "木", "金", "土"];
  const dateEl = document.querySelector('.widget[data-id="clock"] [data-clock="date"]');
  if (dateEl) dateEl.textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 (${week[now.getDay()]})`;
  let greet = "こんにちは";
  if (h < 5) greet = "おやすみなさい";
  else if (h < 11) greet = "おはようございます";
  else if (h < 18) greet = "こんにちは";
  else greet = "こんばんは";
  const gEl = document.querySelector('.widget[data-id="clock"] [data-clock="greeting"]');
  if (gEl) gEl.textContent = greet;
}
setInterval(tick, 1000);

// ==================================================================
//  各ウィジェットの中身（body）とデータ
//  body() … カードの中身のHTML（タイトル＋中身）を返す
//  描画用のデータは、グリッドを作り直すたびに render〇〇() で流し込む
// ==================================================================

// ---------- 天気 (Open-Meteo / APIキー不要) ----------
const WEATHER = {
  0: ["☀️", "快晴"], 1: ["🌤️", "晴れ"], 2: ["⛅", "一部くもり"], 3: ["☁️", "くもり"],
  45: ["🌫️", "霧"], 48: ["🌫️", "霧"],
  51: ["🌦️", "霧雨"], 53: ["🌦️", "霧雨"], 55: ["🌦️", "霧雨"],
  61: ["🌧️", "雨"], 63: ["🌧️", "雨"], 65: ["🌧️", "強い雨"],
  66: ["🌧️", "みぞれ"], 67: ["🌧️", "みぞれ"],
  71: ["🌨️", "雪"], 73: ["🌨️", "雪"], 75: ["❄️", "大雪"], 77: ["🌨️", "霧雪"],
  80: ["🌦️", "にわか雨"], 81: ["🌦️", "にわか雨"], 82: ["⛈️", "激しい雨"],
  85: ["🌨️", "にわか雪"], 86: ["🌨️", "にわか雪"],
  95: ["⛈️", "雷雨"], 96: ["⛈️", "雷雨(ひょう)"], 99: ["⛈️", "雷雨(ひょう)"],
};
let weatherData = null; // 取得済みの天気(再描画してもすぐ出せるよう保持)

function renderWeather() {
  const el = document.querySelector('.widget[data-id="weather"] .weather-body');
  if (!el) return;
  if (weatherData === "error") {
    el.innerHTML = `<div class="muted">天気を取得できませんでした</div>`;
    return;
  }
  if (!weatherData) {
    el.innerHTML = `<div class="muted">位置情報を取得中…</div>`;
    return;
  }
  const cur = weatherData.current, day = weatherData.daily;
  const [icon, desc] = WEATHER[cur.weather_code] || ["🌡️", "—"];
  el.innerHTML = `
    <div class="weather-main">
      <div class="weather-icon">${icon}</div>
      <div>
        <div class="weather-temp">${Math.round(cur.temperature_2m)}°</div>
        <div class="weather-desc">${desc}</div>
      </div>
    </div>
    <div class="weather-range">
      <span class="muted">最高 <b>${Math.round(day.temperature_2m_max[0])}°</b></span>
      <span class="muted">最低 <b>${Math.round(day.temperature_2m_min[0])}°</b></span>
      <span class="muted">降水 <b>${day.precipitation_probability_max?.[0] ?? "-"}%</b></span>
    </div>`;
}
async function loadWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset` +
      `&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    weatherData = await res.json();
  } catch {
    weatherData = "error";
  }
  renderWeather();
}
function initWeather() {
  const saved = store.get("dash_geo", null);
  if (saved) loadWeather(saved.lat, saved.lon);
  if (!navigator.geolocation) {
    if (!saved) loadWeather(35.6809, 139.7673); // 取れなければ東京
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = +pos.coords.latitude.toFixed(3);
      const lon = +pos.coords.longitude.toFixed(3);
      store.set("dash_geo", { lat, lon });
      loadWeather(lat, lon);
    },
    () => { if (!saved) loadWeather(35.6809, 139.7673); }, // 拒否されたら東京
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  );
}

// ---------- 市場指標 (サーバー /market 経由) ----------
let marketData = null;
function fmtNum(n) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: n < 100 ? 2 : 0 });
}
function renderMarket() {
  const box = document.querySelector('.widget[data-id="market"] .market-body');
  if (!box) return;
  if (marketData === "error") {
    box.innerHTML = `<div class="muted" style="grid-column:1/-1;">指標を取得できませんでした</div>`;
    return;
  }
  if (!marketData) {
    box.innerHTML = `<div class="muted" style="grid-column:1/-1;">読み込み中…</div>`;
    return;
  }
  box.innerHTML = marketData
    .map((m) => {
      const has = m.change !== null && m.change !== undefined;
      const up = has && m.change >= 0;
      const arrow = !has ? "" : up ? "▲" : "▼";
      const cls = !has ? "muted" : up ? "up" : "down";
      const chg = has
        ? `${arrow} ${fmtNum(Math.abs(m.change))} (${m.changePct >= 0 ? "+" : "-"}${Math.abs(m.changePct).toFixed(2)}%)`
        : "—";
      return `<div class="m-item">
          <div class="m-label">${m.label}</div>
          <div class="m-value">${fmtNum(m.value)}</div>
          <div class="m-change ${cls}">${chg}</div>
        </div>`;
    })
    .join("");
  const t = new Date();
  const timeEl = document.querySelector('.widget[data-id="market"] .market-time');
  if (timeEl) {
    timeEl.textContent =
      `更新 ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} · 前日終値比`;
  }
}
async function loadMarket() {
  try {
    const res = await fetch("/market");
    const json = await res.json();
    marketData = json.ok && json.data ? json.data : "error";
  } catch {
    marketData = "error";
  }
  renderMarket();
}

// ---------- 週間天気（天気データを使う） ----------
function renderWeekly() {
  const el = document.querySelector('.widget[data-id="weekly"] .weekly-body');
  if (!el) return;
  if (!weatherData || weatherData === "error" || !weatherData.daily) {
    el.innerHTML = `<div class="muted">読み込み中…</div>`;
    return;
  }
  const d = weatherData.daily;
  const week = ["日", "月", "火", "水", "木", "金", "土"];
  let rows = "";
  for (let i = 0; i < (d.time?.length || 0); i++) {
    const date = new Date(d.time[i] + "T00:00:00");
    const wd = week[date.getDay()];
    const [icon] = WEATHER[d.weather_code[i]] || ["🌡️"];
    const label = i === 0 ? "今日" : `${date.getMonth() + 1}/${date.getDate()}(${wd})`;
    rows += `<div class="wk-row">
        <span class="wk-day">${label}</span>
        <span class="wk-ico">${icon}</span>
        <span class="wk-pop">${d.precipitation_probability_max?.[i] ?? "-"}%</span>
        <span class="wk-temp"><b>${Math.round(d.temperature_2m_max[i])}°</b> / ${Math.round(d.temperature_2m_min[i])}°</span>
      </div>`;
  }
  el.innerHTML = rows;
}

// ---------- 日の出・日の入り（天気データを使う） ----------
function renderSun() {
  const el = document.querySelector('.widget[data-id="sun"] .sun-body');
  if (!el) return;
  if (!weatherData || weatherData === "error" || !weatherData.daily?.sunrise) {
    el.innerHTML = `<div class="muted">読み込み中…</div>`;
    return;
  }
  const hm = (iso) => iso ? iso.slice(11, 16) : "--:--";
  const rise = weatherData.daily.sunrise[0];
  const set = weatherData.daily.sunset[0];
  el.innerHTML = `<div class="sun-main">
      <div class="sun-item"><div class="sun-ico">🌅</div><div><div class="muted">日の出</div><div class="sun-time">${hm(rise)}</div></div></div>
      <div class="sun-item"><div class="sun-ico">🌇</div><div><div class="muted">日の入り</div><div class="sun-time">${hm(set)}</div></div></div>
    </div>`;
}

// ---------- 仮想通貨 ----------
let cryptoData = null;
function renderQuoteList(selector, data) {
  const box = document.querySelector(selector);
  if (!box) return;
  if (data === "error") { box.innerHTML = `<div class="muted" style="grid-column:1/-1;">取得できませんでした</div>`; return; }
  if (!data) { box.innerHTML = `<div class="muted" style="grid-column:1/-1;">読み込み中…</div>`; return; }
  box.innerHTML = data
    .map((m) => {
      const has = m.changePct !== null && m.changePct !== undefined;
      const up = has && m.changePct >= 0;
      const cls = !has ? "muted" : up ? "up" : "down";
      const chg = has ? `${up ? "▲" : "▼"} ${Math.abs(m.changePct).toFixed(2)}%` : "—";
      return `<div class="m-item">
          <div class="m-label">${m.label}</div>
          <div class="m-value">${fmtNum(m.value)}</div>
          <div class="m-change ${cls}">${chg}</div>
        </div>`;
    })
    .join("");
}
function renderCrypto() { renderQuoteList('.widget[data-id="crypto"] .crypto-body', cryptoData); }
async function loadCrypto() {
  try {
    const json = await (await fetch("/crypto")).json();
    cryptoData = json.ok && json.data ? json.data : "error";
  } catch { cryptoData = "error"; }
  renderCrypto();
}

// ---------- 為替 ----------
let fxData = null;
function renderFx() {
  const box = document.querySelector('.widget[data-id="fx"] .fx-body');
  if (!box) return;
  if (fxData === "error") { box.innerHTML = `<div class="muted" style="grid-column:1/-1;">取得できませんでした</div>`; return; }
  if (!fxData) { box.innerHTML = `<div class="muted" style="grid-column:1/-1;">読み込み中…</div>`; return; }
  box.innerHTML = fxData
    .map((m) => {
      const has = m.change !== null && m.change !== undefined;
      const up = has && m.change >= 0;
      const cls = !has ? "muted" : up ? "up" : "down";
      const chg = has ? `${up ? "▲" : "▼"} ${Math.abs(m.changePct).toFixed(2)}%` : "—";
      return `<div class="m-item">
          <div class="m-label">${m.label}</div>
          <div class="m-value">${fmtNum(m.value)}</div>
          <div class="m-change ${cls}">${chg}</div>
        </div>`;
    })
    .join("");
}
async function loadFx() {
  try {
    const json = await (await fetch("/fx")).json();
    fxData = json.ok && json.data ? json.data : "error";
  } catch { fxData = "error"; }
  renderFx();
}

// ---------- ニュース ----------
let newsData = null;
function renderNews() {
  const box = document.querySelector('.widget[data-id="news"] .news-body');
  if (!box) return;
  if (newsData === "error") { box.innerHTML = `<div class="muted">取得できませんでした</div>`; return; }
  if (!newsData) { box.innerHTML = `<div class="muted">読み込み中…</div>`; return; }
  if (newsData.length === 0) { box.innerHTML = `<div class="muted">ニュースがありません</div>`; return; }
  box.innerHTML = newsData
    .map(
      (n) => `<a class="news-item" href="${escapeAttr(n.link)}" target="_blank" rel="noopener">
        <span class="news-dot">•</span><span class="news-title">${escapeHtml(n.title)}</span>
      </a>`
    )
    .join("");
}
async function loadNews() {
  try {
    const json = await (await fetch("/news")).json();
    newsData = json.ok && json.data ? json.data : "error";
  } catch { newsData = "error"; }
  renderNews();
}

// ---------- カウントダウン（この端末に保存） ----------
let countdowns = store.get("dash_countdowns", []);
function saveCountdowns() { store.set("dash_countdowns", countdowns); }
function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target - today) / 86400000);
}
function renderCountdown() {
  const list = document.querySelector('.widget[data-id="countdown"] .cd-list');
  if (!list) return;
  if (countdowns.length === 0) { list.innerHTML = `<li class="empty">予定はありません</li>`; return; }
  const sorted = countdowns
    .map((c, i) => ({ ...c, i, days: daysUntil(c.date) }))
    .sort((a, b) => a.days - b.days);
  list.innerHTML = sorted
    .map((c) => {
      let badge, cls;
      if (c.days > 0) { badge = `あと${c.days}日`; cls = "up"; }
      else if (c.days === 0) { badge = "今日！"; cls = "accent"; }
      else { badge = `${-c.days}日前`; cls = "muted"; }
      return `<li class="cd-row">
          <span class="cd-name">${escapeHtml(c.label)}</span>
          <span class="cd-badge ${cls}">${badge}</span>
          <button class="cd-del" data-del="${c.i}" aria-label="削除">×</button>
        </li>`;
    })
    .join("");
}

// ---------- 習慣トラッカー（この端末に保存） ----------
let habits = store.get("dash_habits", []);
function saveHabits() { store.set("dash_habits", habits); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function streakOf(dates) {
  const set = new Set(dates);
  let streak = 0;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  // 今日が未達成なら昨日から数える
  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  if (!set.has(key(d))) d.setDate(d.getDate() - 1);
  while (set.has(key(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
function renderHabit() {
  const list = document.querySelector('.widget[data-id="habit"] .habit-list');
  if (!list) return;
  if (habits.length === 0) { list.innerHTML = `<li class="empty">習慣を追加してみよう</li>`; return; }
  const today = todayStr();
  list.innerHTML = habits
    .map((h, i) => {
      const done = (h.dates || []).includes(today);
      const streak = streakOf(h.dates || []);
      return `<li class="habit-row">
          <button class="habit-toggle ${done ? "done" : ""}" data-i="${i}">${done ? "✓" : ""}</button>
          <span class="habit-name">${escapeHtml(h.name)}</span>
          <span class="habit-streak">🔥${streak}</span>
          <button class="habit-del" data-del="${i}" aria-label="削除">×</button>
        </li>`;
    })
    .join("");
}

// ---------- ToDo ----------
let todos = store.get("dash_todos", []);
function saveTodos() { store.set("dash_todos", todos); }
function renderTodos() {
  const list = document.querySelector('.widget[data-id="todo"] .todo-list');
  if (!list) return;
  if (todos.length === 0) {
    list.innerHTML = `<li class="empty">タスクはありません 🎉</li>`;
    return;
  }
  list.innerHTML = todos
    .map(
      (t, i) => `<li class="todo-item ${t.done ? "done" : ""}">
        <div class="todo-check" data-i="${i}">${t.done ? "✓" : ""}</div>
        <div class="todo-text">${escapeHtml(t.text)}</div>
        <button class="todo-del" data-del="${i}" aria-label="削除">🗑️</button>
      </li>`
    )
    .join("");
}
function addTodoFrom(input) {
  const text = input.value.trim();
  if (!text) return;
  todos.unshift({ text, done: false });
  saveTodos();
  renderTodos();
  input.value = "";
  input.focus();
}

// ---------- メモ ----------
let memoText = store.get("dash_memo", "");
let memoTimer = null;
function restoreMemo() {
  const area = document.querySelector('.widget[data-id="memo"] .memo-area');
  if (area) area.value = memoText;
}

// ---------- リンク集 ----------
const DEFAULT_LINKS = [
  { name: "YouTube", url: "https://youtube.com", emoji: "📺" },
  { name: "Gmail", url: "https://mail.google.com", emoji: "📧" },
  { name: "Maps", url: "https://maps.google.com", emoji: "🗺️" },
  { name: "X", url: "https://x.com", emoji: "🐦" },
];
let links = store.get("dash_links", DEFAULT_LINKS);
function saveLinks() { store.set("dash_links", links); }
function renderLinks() {
  const box = document.querySelector('.widget[data-id="links"] .links-grid');
  if (!box) return;
  const tiles = links
    .map(
      (l, i) => `<a class="link-tile" href="${escapeAttr(l.url)}" target="_blank" rel="noopener">
        <button class="link-del" data-del="${i}" aria-label="削除">×</button>
        <span class="link-emoji">${l.emoji || "🔗"}</span>
        <span class="link-name">${escapeHtml(l.name)}</span>
      </a>`
    )
    .join("");
  box.innerHTML = tiles + `<button class="link-tile link-add" type="button">
      <span class="link-emoji">＋</span><span class="link-name">追加</span>
    </button>`;
}

// ---------- ウィジェットの一覧（登録簿） ----------
const WIDGETS = {
  clock: {
    title: "🕐 時計",
    body: () => `<div class="clock-widget">
        <div class="greeting" data-clock="greeting">こんにちは</div>
        <div class="clock" data-clock="time">--:--<span class="sec">00</span></div>
        <div class="date" data-clock="date">----年--月--日</div>
      </div>`,
  },
  weather: {
    title: "☀️ 天気",
    body: () => `<div class="card-title">☀️ 天気</div>
      <div class="weather-body"><div class="muted">読み込み中…</div></div>`,
  },
  market: {
    title: "📈 マーケット",
    body: () => `<div class="card-title" style="justify-content:space-between;">
        <span>📈 マーケット</span>
        <button class="small-btn market-refresh" type="button">更新</button>
      </div>
      <div class="market-grid market-body"><div class="muted" style="grid-column:1/-1;">読み込み中…</div></div>
      <div class="muted market-time" style="font-size:11px;margin-top:8px;"></div>`,
  },
  todo: {
    title: "✅ やること",
    body: () => `<div class="card-title">✅ やること</div>
      <div class="row">
        <input type="text" class="todo-input" placeholder="タスクを追加…" maxlength="120" />
        <button class="primary todo-add-btn" type="button">追加</button>
      </div>
      <ul class="todo-list"></ul>`,
  },
  memo: {
    title: "📝 メモ",
    body: () => `<div class="card-title">📝 メモ</div>
      <textarea class="memo-area" placeholder="ひとことメモ…自動で保存されます"></textarea>
      <div class="saved-hint memo-saved"></div>`,
  },
  links: {
    title: "🔗 ショートカット",
    body: () => `<div class="card-title">🔗 ショートカット</div>
      <div class="links-grid"></div>`,
  },
  weekly: {
    title: "📅 週間天気",
    body: () => `<div class="card-title">📅 週間天気</div>
      <div class="weekly-body"><div class="muted">読み込み中…</div></div>`,
  },
  sun: {
    title: "🌅 日の出・日の入り",
    body: () => `<div class="card-title">🌅 日の出・日の入り</div>
      <div class="sun-body"><div class="muted">読み込み中…</div></div>`,
  },
  crypto: {
    title: "🪙 仮想通貨",
    body: () => `<div class="card-title">🪙 仮想通貨</div>
      <div class="market-grid crypto-body"><div class="muted" style="grid-column:1/-1;">読み込み中…</div></div>
      <div class="muted" style="font-size:11px;margin-top:8px;">24時間変化 · 円建て</div>`,
  },
  fx: {
    title: "💱 為替",
    body: () => `<div class="card-title">💱 為替</div>
      <div class="market-grid fx-body"><div class="muted" style="grid-column:1/-1;">読み込み中…</div></div>
      <div class="muted" style="font-size:11px;margin-top:8px;">前日終値比</div>`,
  },
  news: {
    title: "📰 ニュース",
    body: () => `<div class="card-title">📰 ニュース</div>
      <div class="news-body"><div class="muted">読み込み中…</div></div>`,
  },
  countdown: {
    title: "⏱️ カウントダウン",
    body: () => `<div class="card-title">⏱️ カウントダウン</div>
      <div class="row cd-form">
        <input type="text" class="cd-label" placeholder="名前（例：旅行）" maxlength="20" />
        <input type="date" class="cd-date" />
        <button class="primary cd-add-btn" type="button">追加</button>
      </div>
      <ul class="cd-list"></ul>`,
  },
  habit: {
    title: "🔢 習慣トラッカー",
    body: () => `<div class="card-title">🔢 習慣トラッカー</div>
      <div class="row">
        <input type="text" class="habit-name-input" placeholder="習慣（例：運動）" maxlength="20" />
        <button class="primary habit-add-btn" type="button">追加</button>
      </div>
      <ul class="habit-list"></ul>`,
  },
};

// ---------- レイアウト（並び順・大きさ）----------
const DEFAULT_LAYOUT = [
  { id: "clock", size: "lg" },
  { id: "weather", size: "lg" },
  { id: "news", size: "lg" },
  { id: "market", size: "lg" },
  { id: "fx", size: "lg" },
  { id: "crypto", size: "lg" },
  { id: "todo", size: "lg" },
  { id: "countdown", size: "lg" },
  { id: "habit", size: "lg" },
  { id: "memo", size: "lg" },
  { id: "sun", size: "lg" },
  { id: "weekly", size: "lg" },
  { id: "links", size: "lg" },
];
let layout = store.get("dash_layout", DEFAULT_LAYOUT)
  .filter((it) => WIDGETS[it.id]); // 知らないウィジェットは無視
// 以前のレイアウトに時計が無ければ先頭に足す（時計のウィジェット化に伴う移行）
if (!layout.some((it) => it.id === "clock")) layout.unshift({ id: "clock", size: "lg" });
function saveLayout() { store.set("dash_layout", layout); }

let editMode = false;
const grid = $("#grid");

function renderGrid() {
  grid.className = "grid" + (editMode ? " editing" : "");
  grid.innerHTML = layout
    .map((item) => {
      const w = WIDGETS[item.id];
      if (!w) return "";
      const span = item.size === "sm" ? "span1" : "span2";
      return `<div class="card widget ${span}" data-id="${item.id}">
          <button class="edit-badge del-badge" data-badge="del" aria-label="削除">−</button>
          <button class="edit-badge size-badge" data-badge="size" aria-label="大きさ">⤢</button>
          ${w.body()}
        </div>`;
    })
    .join("");
  // 中身のデータを流し込む
  renderWeather();
  renderWeekly();
  renderSun();
  renderMarket();
  renderFx();
  renderCrypto();
  renderNews();
  renderTodos();
  renderCountdown();
  renderHabit();
  renderLinks();
  restoreMemo();
}

// ==================================================================
//  iPhone風の編集モード（長押しでぷるぷる→ドラッグ並べ替え・−削除・⤢大きさ）
// ==================================================================
let suppressClick = false;
let pressTimer = null;
let pressCard = null;

function enterEditMode() {
  if (editMode) return;
  editMode = true;
  grid.classList.add("editing");
  $("#done-btn").classList.remove("hidden"); // 編集中は「完了」も出す（＋はそのまま）
}
function exitEditMode() {
  if (!editMode) return;
  editMode = false;
  grid.classList.remove("editing");
  $("#done-btn").classList.add("hidden");
}
$("#done-btn").addEventListener("click", exitEditMode);
$("#add-btn").addEventListener("click", openAddWidget);

// 編集モード外をタップしたら編集モードを抜ける
document.addEventListener("pointerdown", (e) => {
  if (editMode && !e.target.closest(".widget") && !e.target.closest(".toolbar") && !e.target.closest("dialog")) {
    exitEditMode();
  }
}, true);

function cancelPress() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  if (pressCard) { pressCard.classList.remove("pressing"); pressCard = null; }
}

// --- ドラッグ並べ替え ---
let drag = null;
function preventTouch(e) { e.preventDefault(); } // ドラッグ中はページのスクロールを止める

function beginLift() {
  drag.started = true;
  const el = drag.el;
  const ph = document.createElement("div");
  ph.className = "card widget placeholder " + (el.classList.contains("span1") ? "span1" : "span2");
  drag.placeholder = ph;
  el.parentNode.insertBefore(ph, el);
  el.style.width = drag.w + "px";
  el.style.height = drag.h + "px";
  el.style.position = "fixed";
  el.style.left = drag.x0 + "px";
  el.style.top = drag.y0 + "px";
  el.style.zIndex = "1000";
  el.style.pointerEvents = "none";
  el.classList.add("dragging");
  document.addEventListener("touchmove", preventTouch, { passive: false });
  if (navigator.vibrate) navigator.vibrate(10);
}
function onDragMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
  if (!drag.started) {
    if (Math.hypot(dx, dy) < 8) return; // 少し動いたらドラッグ開始
    beginLift();
  }
  drag.el.style.left = (e.clientX - drag.offsetX) + "px";
  drag.el.style.top = (e.clientY - drag.offsetY) + "px";
  // 指の下にあるウィジェットを探して、受け皿(placeholder)を移動
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const target = under && under.closest(".widget");
  if (target && target !== drag.el && target !== drag.placeholder && target.parentNode === grid) {
    const r = target.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    grid.insertBefore(drag.placeholder, before ? target : target.nextSibling);
  }
}
function onDragEnd() {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointercancel", onDragEnd);
  document.removeEventListener("touchmove", preventTouch, { passive: false });
  if (!drag) return;
  const el = drag.el;
  if (drag.started && drag.placeholder) {
    grid.insertBefore(el, drag.placeholder);
    drag.placeholder.remove();
    el.classList.remove("dragging");
    el.removeAttribute("style");
    // DOMの並び順から layout を作り直す（大きさは保持）
    const sizeById = {};
    layout.forEach((it) => (sizeById[it.id] = it.size));
    layout = [...grid.querySelectorAll(".widget")]
      .filter((n) => !n.classList.contains("placeholder"))
      .map((n) => ({ id: n.dataset.id, size: sizeById[n.dataset.id] || "lg" }));
    saveLayout();
  }
  drag = null;
}

grid.addEventListener("pointerdown", (e) => {
  const card = e.target.closest(".widget");
  if (!card) return;

  // --- 編集モードでない：長押しで編集モードへ ---
  if (!editMode) {
    if (e.target.closest("input, textarea, a, button, .todo-check")) return;
    pressCard = card;
    card.classList.add("pressing");
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClick = true;
      cancelPress();
      if (navigator.vibrate) navigator.vibrate(15);
      enterEditMode();
    }, 500);
    return;
  }

  // --- 編集モード中：バッジ以外を掴んでドラッグ開始準備 ---
  if (e.target.closest(".edit-badge")) return;
  const rect = card.getBoundingClientRect();
  drag = {
    el: card,
    startX: e.clientX, startY: e.clientY,
    offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
    x0: rect.left, y0: rect.top, w: rect.width, h: rect.height,
    started: false,
  };
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);
});
grid.addEventListener("pointerup", cancelPress);
grid.addEventListener("pointermove", cancelPress);
grid.addEventListener("pointercancel", cancelPress);
window.addEventListener("scroll", cancelPress, true);
// パソコンの右クリックでも編集モードへ
grid.addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (e.target.closest(".widget")) { e.preventDefault(); enterEditMode(); }
});

// ---------- グリッド内のクリックをまとめて処理（イベント委譲）----------
grid.addEventListener("click", (e) => {
  // 編集モードに入った直後のクリックは無視する
  if (suppressClick) { suppressClick = false; e.preventDefault(); return; }

  // --- 編集モード中：バッジ操作だけ受け付け、他の操作は無効化 ---
  if (editMode) {
    const badge = e.target.closest(".edit-badge");
    if (badge) {
      const idx = layout.findIndex((it) => it.id === badge.closest(".widget").dataset.id);
      if (idx < 0) return;
      if (badge.dataset.badge === "del") {
        layout.splice(idx, 1);
        saveLayout();
        renderGrid();
      } else if (badge.dataset.badge === "size") {
        layout[idx].size = layout[idx].size === "lg" ? "sm" : "lg";
        saveLayout();
        renderGrid();
      }
      return;
    }
    e.preventDefault(); // 編集中はリンク遷移などをさせない
    return;
  }

  // --- ToDo ---
  const check = e.target.closest(".todo-check");
  if (check) {
    const i = +check.dataset.i;
    todos[i].done = !todos[i].done;
    saveTodos();
    renderTodos();
    return;
  }
  const tdel = e.target.closest(".todo-del");
  if (tdel) {
    todos.splice(+tdel.dataset.del, 1);
    saveTodos();
    renderTodos();
    return;
  }
  if (e.target.closest(".todo-add-btn")) {
    const input = e.target.closest(".widget").querySelector(".todo-input");
    addTodoFrom(input);
    return;
  }

  // --- マーケット更新 ---
  if (e.target.closest(".market-refresh")) {
    marketData = null;
    renderMarket();
    loadMarket();
    return;
  }

  // --- カウントダウン 追加・削除 ---
  if (e.target.closest(".cd-add-btn")) {
    const w = e.target.closest(".widget");
    const label = w.querySelector(".cd-label").value.trim();
    const date = w.querySelector(".cd-date").value;
    if (!label || !date) return;
    countdowns.push({ label, date });
    saveCountdowns();
    renderCountdown();
    w.querySelector(".cd-label").value = "";
    w.querySelector(".cd-date").value = "";
    return;
  }
  const cddel = e.target.closest(".cd-del");
  if (cddel) {
    countdowns.splice(+cddel.dataset.del, 1);
    saveCountdowns();
    renderCountdown();
    return;
  }

  // --- 習慣トラッカー 追加・チェック・削除 ---
  if (e.target.closest(".habit-add-btn")) {
    const input = e.target.closest(".widget").querySelector(".habit-name-input");
    const name = input.value.trim();
    if (!name) return;
    habits.push({ name, dates: [] });
    saveHabits();
    renderHabit();
    input.value = "";
    return;
  }
  const htoggle = e.target.closest(".habit-toggle");
  if (htoggle) {
    const h = habits[+htoggle.dataset.i];
    h.dates = h.dates || [];
    const t = todayStr();
    if (h.dates.includes(t)) h.dates = h.dates.filter((d) => d !== t);
    else h.dates.push(t);
    saveHabits();
    renderHabit();
    return;
  }
  const hdel = e.target.closest(".habit-del");
  if (hdel) {
    habits.splice(+hdel.dataset.del, 1);
    saveHabits();
    renderHabit();
    return;
  }

  // --- リンク削除・追加 ---
  const ldel = e.target.closest(".link-del");
  if (ldel) {
    e.preventDefault();
    links.splice(+ldel.dataset.del, 1);
    saveLinks();
    renderLinks();
    return;
  }
  if (e.target.closest(".link-add")) {
    e.preventDefault();
    openLinkDialog();
    return;
  }
});

// ToDoの入力欄でEnter
grid.addEventListener("keydown", (e) => {
  if (e.target.classList.contains("todo-input") && e.key === "Enter") {
    addTodoFrom(e.target);
  }
});

// メモの自動保存
grid.addEventListener("input", (e) => {
  if (!e.target.classList.contains("memo-area")) return;
  memoText = e.target.value;
  clearTimeout(memoTimer);
  const hint = e.target.parentElement.querySelector(".memo-saved");
  memoTimer = setTimeout(() => {
    store.set("dash_memo", memoText);
    if (hint) {
      hint.textContent = "保存しました ✓";
      setTimeout(() => (hint.textContent = ""), 1200);
    }
  }, 400);
});

// ---------- リンク追加ダイアログ ----------
const linkDialog = $("#link-dialog");
function openLinkDialog() {
  $("#link-name").value = "";
  $("#link-url").value = "";
  $("#link-emoji").value = "";
  linkDialog.showModal();
  $("#link-name").focus();
}
$("#link-cancel").addEventListener("click", () => linkDialog.close());
$("#link-save").addEventListener("click", () => {
  const name = $("#link-name").value.trim();
  let url = $("#link-url").value.trim();
  const emoji = $("#link-emoji").value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  links.push({ name, url, emoji });
  saveLinks();
  renderLinks();
  linkDialog.close();
});

// ---------- ウィジェット追加ダイアログ ----------
const addDialog = $("#add-widget-dialog");
function openAddWidget() {
  const used = new Set(layout.map((it) => it.id));
  const available = Object.keys(WIDGETS).filter((id) => !used.has(id));
  const listEl = $("#add-widget-list");
  if (available.length === 0) {
    listEl.innerHTML = `<div class="muted">追加できるウィジェットはありません（すべて表示中）</div>`;
  } else {
    listEl.innerHTML = available
      .map((id) => `<button type="button" data-add="${id}">${WIDGETS[id].title}</button>`)
      .join("");
  }
  addDialog.showModal();
}
$("#add-widget-cancel").addEventListener("click", () => addDialog.close());
$("#add-widget-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-add]");
  if (!btn) return;
  layout.push({ id: btn.dataset.add, size: "lg" });
  saveLayout();
  renderGrid();
  addDialog.close();
});

// ---------- 起動 ----------
renderGrid();
tick();
initWeather();
loadMarket();
loadFx();
loadCrypto();
loadNews();
setInterval(() => { loadMarket(); loadFx(); loadCrypto(); }, 5 * 60 * 1000); // 5分ごと
setInterval(loadNews, 10 * 60 * 1000); // ニュースは10分ごと
