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

// ---------- 時計・あいさつ ----------
function tick() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const pad = (n) => String(n).padStart(2, "0");
  $("#clock").innerHTML = `${pad(h)}:${pad(m)}<span class="sec">${pad(s)}</span>`;
  const week = ["日", "月", "火", "水", "木", "金", "土"];
  $("#date").textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 (${week[now.getDay()]})`;
  let greet = "こんにちは";
  if (h < 5) greet = "おやすみなさい";
  else if (h < 11) greet = "おはようございます";
  else if (h < 18) greet = "こんにちは";
  else greet = "こんばんは";
  $("#greeting").textContent = greet;
}
tick();
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
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
      `&timezone=auto`;
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
};

// ---------- レイアウト（並び順・大きさ）----------
const DEFAULT_LAYOUT = [
  { id: "weather", size: "lg" },
  { id: "market", size: "lg" },
  { id: "todo", size: "lg" },
  { id: "memo", size: "lg" },
  { id: "links", size: "lg" },
];
let layout = store.get("dash_layout", DEFAULT_LAYOUT)
  .filter((it) => WIDGETS[it.id]); // 知らないウィジェットは無視
let editMode = false;
function saveLayout() { store.set("dash_layout", layout); }

const grid = $("#grid");

function renderGrid() {
  grid.className = "grid" + (editMode ? " editing" : "");
  let html = layout
    .map((item, idx) => {
      const w = WIDGETS[item.id];
      if (!w) return "";
      const span = item.size === "sm" ? "span1" : "span2";
      const controls = editMode
        ? `<div class="w-controls">
             <button class="w-btn w-up" data-act="up" ${idx === 0 ? "disabled" : ""}>↑</button>
             <button class="w-btn w-down" data-act="down" ${idx === layout.length - 1 ? "disabled" : ""}>↓</button>
             <button class="w-btn w-size" data-act="size">${item.size === "lg" ? "⬚ 小さく" : "⬛ 大きく"}</button>
             <button class="w-btn w-remove" data-act="remove">× 消す</button>
           </div>`
        : "";
      return `<div class="card widget ${span}" data-id="${item.id}">${controls}${w.body()}</div>`;
    })
    .join("");
  if (editMode) {
    html += `<button class="card widget span2 add-widget" type="button" id="add-widget-btn">＋ ウィジェットを追加</button>`;
  }
  grid.innerHTML = html;
  // 中身のデータを流し込む
  renderWeather();
  renderMarket();
  renderTodos();
  renderLinks();
  restoreMemo();
}

// ---------- 編集モードの切り替え ----------
$("#edit-toggle").addEventListener("click", () => {
  editMode = !editMode;
  const btn = $("#edit-toggle");
  btn.textContent = editMode ? "✓ 完了" : "✏️ 編集";
  btn.classList.toggle("active", editMode);
  renderGrid();
});

// ---------- グリッド内のクリックをまとめて処理（イベント委譲）----------
grid.addEventListener("click", (e) => {
  // --- 編集コントロール ---
  const ctrl = e.target.closest(".w-controls .w-btn");
  if (ctrl) {
    const id = ctrl.closest(".widget").dataset.id;
    const idx = layout.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const act = ctrl.dataset.act;
    if (act === "up" && idx > 0) {
      [layout[idx - 1], layout[idx]] = [layout[idx], layout[idx - 1]];
    } else if (act === "down" && idx < layout.length - 1) {
      [layout[idx + 1], layout[idx]] = [layout[idx], layout[idx + 1]];
    } else if (act === "size") {
      layout[idx].size = layout[idx].size === "lg" ? "sm" : "lg";
    } else if (act === "remove") {
      layout.splice(idx, 1);
    }
    saveLayout();
    renderGrid();
    return;
  }

  // --- ウィジェット追加ボタン ---
  if (e.target.closest("#add-widget-btn")) {
    openAddWidget();
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
initWeather();
loadMarket();
setInterval(loadMarket, 5 * 60 * 1000); // 5分ごとに自動更新
