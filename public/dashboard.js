// 自分用スマホダッシュボード
// データ(ToDo・メモ・リンク・天気の場所)はすべてこの端末(localStorage)に保存します。

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

// ---------- 時計・あいさつ ----------
function tick() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
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

// ---------- 天気 (Open-Meteo / APIキー不要) ----------
const WEATHER = {
  // WMO天気コード → 絵文字 + 日本語
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

function renderWeather(data, placeName) {
  const cur = data.current;
  const day = data.daily;
  const code = cur.weather_code;
  const [icon, desc] = WEATHER[code] || ["🌡️", "—"];
  $("#weather").innerHTML = `
    <div class="weather-main">
      <div class="weather-icon">${icon}</div>
      <div>
        <div class="weather-temp">${Math.round(cur.temperature_2m)}°</div>
        <div class="weather-desc">${desc}${placeName ? " · " + placeName : ""}</div>
      </div>
    </div>
    <div class="weather-range">
      <span class="muted">最高 <b>${Math.round(day.temperature_2m_max[0])}°</b></span>
      <span class="muted">最低 <b>${Math.round(day.temperature_2m_min[0])}°</b></span>
      <span class="muted">降水 <b>${day.precipitation_probability_max?.[0] ?? "-"}%</b></span>
    </div>`;
}

async function loadWeather(lat, lon, placeName) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
      `&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json();
    renderWeather(data, placeName);
  } catch {
    $("#weather").innerHTML = `<div class="muted">天気を取得できませんでした</div>`;
  }
}

function initWeather() {
  // 一度許可した場所を覚えておき、次回はすぐ表示
  const saved = store.get("dash_geo", null);
  if (saved) loadWeather(saved.lat, saved.lon, saved.name);

  if (!navigator.geolocation) {
    if (!saved) loadWeather(35.6809, 139.7673, "東京"); // 取れなければ東京
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = +pos.coords.latitude.toFixed(3);
      const lon = +pos.coords.longitude.toFixed(3);
      const geo = { lat, lon, name: "" };
      store.set("dash_geo", geo);
      loadWeather(lat, lon, "");
    },
    () => {
      if (!saved) loadWeather(35.6809, 139.7673, "東京"); // 拒否されたら東京
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  );
}
initWeather();

// ---------- 市場指標 (サーバー /market 経由) ----------
function fmtNum(n) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: n < 100 ? 2 : 0 });
}

async function loadMarket() {
  const box = $("#market");
  try {
    const res = await fetch("/market");
    const json = await res.json();
    if (!json.ok || !json.data) throw new Error("no data");
    box.innerHTML = json.data
      .map((m) => {
        const has = m.change !== null && m.change !== undefined;
        const up = has && m.change >= 0;
        const arrow = !has ? "" : up ? "▲" : "▼";
        const cls = !has ? "muted" : up ? "up" : "down";
        const chg = has
          ? `${arrow} ${fmtNum(Math.abs(m.change))} (${m.changePct >= 0 ? "+" : "-"}${Math.abs(m.changePct).toFixed(2)}%)`
          : "—";
        return `
          <div class="m-item">
            <div class="m-label">${m.label}</div>
            <div class="m-value">${fmtNum(m.value)}</div>
            <div class="m-change ${cls}">${chg}</div>
          </div>`;
      })
      .join("");
    const t = new Date();
    $("#market-time").textContent =
      `更新 ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} · 前日終値比`;
  } catch {
    box.innerHTML = `<div class="muted" style="grid-column:1/-1;">指標を取得できませんでした</div>`;
  }
}
$("#market-refresh").addEventListener("click", loadMarket);
loadMarket();
setInterval(loadMarket, 5 * 60 * 1000); // 5分ごとに自動更新

// ---------- ToDo ----------
let todos = store.get("dash_todos", []);
function saveTodos() { store.set("dash_todos", todos); }
function renderTodos() {
  const list = $("#todo-list");
  if (todos.length === 0) {
    list.innerHTML = `<li class="empty">タスクはありません 🎉</li>`;
    return;
  }
  list.innerHTML = todos
    .map(
      (t, i) => `
      <li class="todo-item ${t.done ? "done" : ""}">
        <div class="todo-check" data-i="${i}">${t.done ? "✓" : ""}</div>
        <div class="todo-text">${escapeHtml(t.text)}</div>
        <button class="todo-del" data-del="${i}" aria-label="削除">🗑️</button>
      </li>`
    )
    .join("");
}
function addTodo() {
  const input = $("#todo-input");
  const text = input.value.trim();
  if (!text) return;
  todos.unshift({ text, done: false });
  saveTodos();
  renderTodos();
  input.value = "";
  input.focus();
}
$("#todo-add").addEventListener("click", addTodo);
$("#todo-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTodo();
});
$("#todo-list").addEventListener("click", (e) => {
  const check = e.target.closest(".todo-check");
  const del = e.target.closest(".todo-del");
  if (check) {
    const i = +check.dataset.i;
    todos[i].done = !todos[i].done;
    saveTodos();
    renderTodos();
  } else if (del) {
    todos.splice(+del.dataset.del, 1);
    saveTodos();
    renderTodos();
  }
});
renderTodos();

// ---------- メモ (自動保存) ----------
const memo = $("#memo");
memo.value = store.get("dash_memo", "");
let memoTimer = null;
memo.addEventListener("input", () => {
  clearTimeout(memoTimer);
  memoTimer = setTimeout(() => {
    store.set("dash_memo", memo.value);
    const hint = $("#memo-saved");
    hint.textContent = "保存しました ✓";
    setTimeout(() => (hint.textContent = ""), 1200);
  }, 400);
});

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
  const box = $("#links");
  const tiles = links
    .map(
      (l, i) => `
      <a class="link-tile" href="${escapeAttr(l.url)}" target="_blank" rel="noopener">
        <button class="link-del" data-del="${i}" aria-label="削除">×</button>
        <span class="link-emoji">${l.emoji || "🔗"}</span>
        <span class="link-name">${escapeHtml(l.name)}</span>
      </a>`
    )
    .join("");
  box.innerHTML = tiles + `
    <button class="link-tile link-add" id="link-add-btn">
      <span class="link-emoji">＋</span>
      <span class="link-name">追加</span>
    </button>`;
}
$("#links").addEventListener("click", (e) => {
  const del = e.target.closest(".link-del");
  if (del) {
    e.preventDefault();
    links.splice(+del.dataset.del, 1);
    saveLinks();
    renderLinks();
    return;
  }
  if (e.target.closest("#link-add-btn")) {
    openLinkDialog();
  }
});

const dialog = $("#link-dialog");
function openLinkDialog() {
  $("#link-name").value = "";
  $("#link-url").value = "";
  $("#link-emoji").value = "";
  dialog.showModal();
  $("#link-name").focus();
}
$("#link-cancel").addEventListener("click", () => dialog.close());
$("#link-save").addEventListener("click", () => {
  const name = $("#link-name").value.trim();
  let url = $("#link-url").value.trim();
  const emoji = $("#link-emoji").value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url; // http(s)を補う
  links.push({ name, url, emoji });
  saveLinks();
  renderLinks();
  dialog.close();
});
renderLinks();

// ---------- 文字列のエスケープ(XSS対策) ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  // javascript: などの危険なスキームを無効化
  if (/^\s*javascript:/i.test(s)) return "#";
  return escapeHtml(s);
}
