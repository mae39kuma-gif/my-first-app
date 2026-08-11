// 相手が今なにをしているか分かる、ステータス通知アプリ
// 追加ライブラリ不要。Node標準の http モジュールだけで動きます。
//
// 使い方:
//   node server.js
//   → ブラウザで http://localhost:3000 を開く
//   自分と相手がそれぞれ開いて、名前を入れてボタンを押すと、
//   もう片方の画面に「○○さんが【勉強中】になりました」と通知が飛びます。

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const { Redis } = require("@upstash/redis");

// --- データベース(Upstash Redis)の設定 ---
// 環境変数(UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)があれば、
// データを永久保存する。なければ今まで通りメモリだけで動く。
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}
const STATE_KEY = "appState";

const PORT = process.env.PORT || 3000;

// --- プッシュ通知(Web Push)の設定 ---
// 鍵はRenderの環境変数(VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)から読む
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
let pushEnabled = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails("mailto:owner@example.com", VAPID_PUBLIC, VAPID_PRIVATE);
  pushEnabled = true;
}
// プッシュの送り先（役割ごと）。dog=わんこ端末 / master=ご主人端末
const subscriptions = { dog: [], master: [] };

// 指定した役割の端末へプッシュを送る（アプリを閉じていても届く）
function sendPush(role, title, body) {
  if (!pushEnabled) return;
  const payload = JSON.stringify({ title, body });
  (subscriptions[role] || []).forEach((sub) => {
    webpush.sendNotification(sub, payload).catch((err) => {
      // 期限切れ・解除済みの登録は消す
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        subscriptions[role] = subscriptions[role].filter(
          (s) => s.endpoint !== sub.endpoint
        );
      }
    });
  });
}

// 接続中のクライアント(SSE)を保持する
let clients = [];
// 各ユーザーの「今の状態」を覚えておく（後から開いた人にも現状を見せるため）
const currentStatus = {}; // { 名前: { status, message, time } }
// ご主人画面の活動ログ用に、直近の更新履歴を覚えておく（最大50件）
let history = []; // 新しいものが先頭
const HISTORY_MAX = 50;

// ご主人が決める「ごはん予定」（平日の夜 / 土日の昼 / 土日の夜）
let mealPlan = { weekdayDinner: "", weekendLunch: "", weekendDinner: "" };
// ご主人が「今なにしてるか」をわんこに教える内容
let masterStatus = { text: "", time: "" };
// ご主人からわんこへの応援ひとことメッセージ
let lastCheer = { text: "", time: "" };
// おうちのこと：鍵の状態（かけた/外した）と、クリームを塗った時刻
let lockState = { locked: false, time: "" };
let creamState = { time: "" };
// 首輪の状態（付けた/外した）と、「見て欲しい！」を押した時刻
let collarState = { on: false, time: "" };
let lookState = { time: "" };
// ごほうびスタンプ（する事をこなすと貯まる・最大200件）
let stamps = []; // { type, time } 新しいものが先頭
const STAMPS_MAX = 200;
// やり忘れのお知らせを最後に送った日（同じ日に何度も送らないため）
let lastReminderDay = "";
// わんこからの「ごはんリクエスト」（新しいものが先頭・最大50件）
let requests = []; // { name, text, time }
const REQUESTS_MAX = 50;

// その時刻が日本時間で何日かを返す（"2026-08-10" のような形）
function jstDay(t) {
  return new Date(new Date(t).getTime() + 9 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
}

// スタンプを1つ増やす
// oncePerDay=true のときは、その種類は1日に1つまで（何度押しても増えない）
function addStamp(type, oncePerDay = false) {
  if (oncePerDay) {
    const today = jstDay(Date.now());
    if (stamps.some((s) => s.type === type && jstDay(s.time) === today)) return false;
  }
  stamps.unshift({ type, time: new Date().toISOString() });
  if (stamps.length > STAMPS_MAX) stamps.length = STAMPS_MAX;
  return true;
}

// --- データベースへの保存・読み込み（Upstash Redisがあれば永久保存）---
function snapshot() {
  return { currentStatus, history, mealPlan, masterStatus, lastCheer, lockState, creamState, collarState, lookState, stamps, lastReminderDay, requests, subscriptions };
}
let saveTimer = null;
function scheduleSave() {
  if (!redis) return;
  clearTimeout(saveTimer);
  // まとめて保存（短時間に何度も書き込まないように）
  saveTimer = setTimeout(() => {
    redis.set(STATE_KEY, snapshot()).catch((e) => console.log("保存に失敗:", e.message));
  }, 500);
}
async function loadState() {
  if (!redis) return;
  try {
    const s = await redis.get(STATE_KEY);
    if (!s) return;
    if (s.currentStatus) {
      for (const k in currentStatus) delete currentStatus[k];
      Object.assign(currentStatus, s.currentStatus);
    }
    if (Array.isArray(s.history)) history = s.history;
    if (s.mealPlan) mealPlan = s.mealPlan;
    if (s.masterStatus) masterStatus = s.masterStatus;
    if (s.lastCheer) lastCheer = s.lastCheer;
    if (s.lockState) lockState = s.lockState;
    if (s.creamState) creamState = s.creamState;
    if (s.collarState) collarState = s.collarState;
    if (s.lookState) lookState = s.lookState;
    if (Array.isArray(s.stamps)) stamps = s.stamps;
    if (s.lastReminderDay) lastReminderDay = s.lastReminderDay;
    if (Array.isArray(s.requests)) requests = s.requests;
    if (s.subscriptions) {
      subscriptions.dog = s.subscriptions.dog || [];
      subscriptions.master = s.subscriptions.master || [];
    }
    console.log("データベースから読み込みました");
  } catch (e) {
    console.log("読み込みに失敗:", e.message);
  }
}

// --- 市場指標(日経平均など)を Yahoo Finance から取得する ---
// ブラウザから直接だと CORS で弾かれるので、サーバー側で代理取得して返す。
// 前日終値も取れるので「前日比」を正しく出せる。短時間に何度も外部へ
// 問い合わせないよう、60秒キャッシュする。
const MARKET_SYMBOLS = [
  { symbol: "^N225", label: "日経平均" },
  { symbol: "^DJI", label: "NYダウ" },
  { symbol: "^GSPC", label: "S&P500" },
  { symbol: "JPY=X", label: "ドル円" },
];

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    const options = { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } };
    const req = https.get(url, options, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// 1銘柄ぶんを取得する（symbolごとに60秒キャッシュ。失敗しても null を返す）
const quoteCache = new Map(); // symbol -> { time, data }
async function fetchQuote(symbol) {
  const c = quoteCache.get(symbol);
  if (c && Date.now() - c.time < 60 * 1000) return c.data;
  let data;
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/` +
      `${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const json = JSON.parse(await httpsGetText(url));
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prev = meta?.chartPreviousClose;
    if (!isFinite(price)) {
      data = { symbol, value: null, change: null, changePct: null };
    } else {
      const change = isFinite(prev) ? price - prev : null;
      const changePct = change !== null && prev ? (change / prev) * 100 : null;
      data = { symbol, value: price, change, changePct };
    }
  } catch (e) {
    data = { symbol, value: null, change: null, changePct: null };
  }
  quoteCache.set(symbol, { time: Date.now(), data });
  return data;
}

// ラベル付きのリストをまとめて取得
async function fetchList(items) {
  const arr = await Promise.all(items.map((it) => fetchQuote(it.symbol)));
  return arr.map((d, i) => ({ label: items[i].label, ...d }));
}
// シンボル配列(ラベルなし)をまとめて取得
async function fetchSymbols(symbols) {
  return Promise.all(symbols.map((s) => fetchQuote(s)));
}
function fetchMarket() { return fetchList(MARKET_SYMBOLS); }

// --- 為替(複数通貨ペア)も Yahoo Finance から取得 ---
const FX_SYMBOLS = [
  { symbol: "EURJPY=X", label: "ユーロ円" },
  { symbol: "GBPJPY=X", label: "ポンド円" },
  { symbol: "EURUSD=X", label: "ユーロドル" },
];
let fxCache = { time: 0, data: null };
async function fetchFx() {
  if (fxCache.data && Date.now() - fxCache.time < 60 * 1000) return fxCache.data;
  const data = await fetchList(FX_SYMBOLS);
  fxCache = { time: Date.now(), data };
  return data;
}

// --- 仮想通貨を CoinGecko から取得(APIキー不要) ---
const CRYPTO = [
  { id: "bitcoin", label: "ビットコイン" },
  { id: "ethereum", label: "イーサリアム" },
  { id: "solana", label: "ソラナ" },
];
let cryptoCache = { time: 0, data: null };
async function fetchCrypto() {
  if (cryptoCache.data && Date.now() - cryptoCache.time < 60 * 1000) return cryptoCache.data;
  const ids = CRYPTO.map((c) => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=jpy&include_24hr_change=true`;
  const json = JSON.parse(await httpsGetText(url));
  const data = CRYPTO.map((c) => {
    const o = json[c.id] || {};
    const value = isFinite(o.jpy) ? o.jpy : null;
    const changePct = isFinite(o.jpy_24h_change) ? o.jpy_24h_change : null;
    return { label: c.label, value, changePct };
  });
  cryptoCache = { time: Date.now(), data };
  return data;
}

// --- ニュース見出しを RSS から取得 ---
function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
let newsCache = { time: 0, data: null };
async function fetchNews() {
  // ニュースは5分キャッシュ
  if (newsCache.data && Date.now() - newsCache.time < 5 * 60 * 1000) return newsCache.data;
  const xml = await httpsGetText("https://news.yahoo.co.jp/rss/topics/top-picks.xml");
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 8) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    if (title) items.push({ title: decodeEntities(title.trim()), link: link.trim() });
  }
  newsCache = { time: Date.now(), data: items };
  return items;
}

const PUBLIC_DIR = path.join(__dirname, "public");

// 静的ファイルの簡単な配信
function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // ディレクトリ外へのアクセスを防ぐ
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
    res.end(data);
  });
}

// 全クライアントへイベントを送る
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach((c) => c.res.write(payload));
}

// POSTのJSONボディを読み取って cb(data) を呼ぶ（共通処理）
function readJson(req, res, cb) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10000) req.destroy(); // 巨大なリクエストを弾く
  });
  req.on("end", () => {
    try {
      cb(JSON.parse(body));
    } catch (e) {
      res.writeHead(400);
      res.end("不正なデータです");
    }
  });
}

const server = http.createServer((req, res) => {
  // --- 状態確認（DB・プッシュが有効かを返す。秘密の値は出さない）---
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      db: !!redis,
      push: pushEnabled,
      // 通知の宛先として登録されている端末の数（中身は出さない）
      targets: { dog: subscriptions.dog.length, master: subscriptions.master.length },
    }));
    return;
  }

  // --- プッシュ用の公開鍵を渡す ---
  if (req.url === "/vapid-public-key") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ key: VAPID_PUBLIC }));
    return;
  }

  // --- プッシュの登録を受け取る ---
  if (req.url === "/subscribe" && req.method === "POST") {
    readJson(req, res, (data) => {
      const role = data.role === "master" ? "master" : "dog";
      const sub = data.subscription;
      if (sub && sub.endpoint) {
        // この端末は一旦どちらの役割からも外し、選んだ役割だけに登録する
        // （同じ端末が「わんこ」と「ご主人」の両方に入るのを防ぐ）
        subscriptions.dog = subscriptions.dog.filter((s) => s.endpoint !== sub.endpoint);
        subscriptions.master = subscriptions.master.filter((s) => s.endpoint !== sub.endpoint);
        subscriptions[role].push(sub);
        scheduleSave();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- プッシュの解除（この端末を全役割から外す）---
  if (req.url === "/unsubscribe" && req.method === "POST") {
    readJson(req, res, (data) => {
      const ep = data.endpoint;
      if (ep) {
        subscriptions.dog = subscriptions.dog.filter((s) => s.endpoint !== ep);
        subscriptions.master = subscriptions.master.filter((s) => s.endpoint !== ep);
        scheduleSave();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- リアルタイム通知の受け口 (Server-Sent Events) ---
  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    const client = { res };
    clients.push(client);

    // 今みんながどんな状態か＋履歴＋ごはん予定＋リクエストを、つないだ直後に送る
    res.write(
      `data: ${JSON.stringify({
        type: "init",
        statuses: currentStatus,
        history: history,
        mealPlan: mealPlan,
        requests: requests,
        masterStatus: masterStatus,
        lastCheer: lastCheer,
        lockState: lockState,
        creamState: creamState,
        collarState: collarState,
        lookState: lookState,
        stamps: stamps,
      })}\n\n`
    );

    req.on("close", () => {
      clients = clients.filter((c) => c !== client);
    });
    return;
  }

  // --- 状態の更新を受け取る ---
  if (req.url === "/status" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // 巨大なリクエストを弾く（簡単な安全策）
      if (body.length > 10000) req.destroy();
    });
    req.on("end", () => {
      try {
        const { name, status, message } = JSON.parse(body);
        if (!name || !status) {
          res.writeHead(400);
          res.end("name と status が必要です");
          return;
        }
        const event = {
          type: "update",
          name: String(name).slice(0, 30),
          status: String(status).slice(0, 30),
          message: message ? String(message).slice(0, 100) : "",
          time: new Date().toISOString(),
        };
        currentStatus[event.name] = event;
        history.unshift(event); // 履歴の先頭に追加
        if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
        scheduleSave();
        broadcast(event);
        // ご主人の端末へプッシュ（閉じていても届く）
        const detail = event.message ? `：${event.message}` : "";
        sendPush("master", `${event.name}さん`, `${event.status}${detail}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end("不正なデータです");
      }
    });
    return;
  }

  // --- ご主人が活動ログを消す（ダッシュボードの状態もまとめて消す）---
  if (req.url === "/clear" && req.method === "POST") {
    history = [];
    for (const k in currentStatus) delete currentStatus[k]; // 今の状態も消す
    scheduleSave();
    broadcast({ type: "cleared" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- ご主人がごはん予定を決める ---
  if (req.url === "/meal" && req.method === "POST") {
    readJson(req, res, (data) => {
      mealPlan = {
        weekdayDinner: String(data.weekdayDinner || "").slice(0, 100),
        weekendLunch: String(data.weekendLunch || "").slice(0, 100),
        weekendDinner: String(data.weekendDinner || "").slice(0, 100),
      };
      scheduleSave();
      broadcast({ type: "meal", mealPlan });
      // わんこの端末へプッシュ
      sendPush("dog", "🍚 ごはん予定が更新されたよ", "ご主人が予定を決めたよ！");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- ご主人が「今なにしてるか」をわんこに教える ---
  if (req.url === "/master-status" && req.method === "POST") {
    readJson(req, res, (data) => {
      masterStatus = {
        text: String(data.text || "").slice(0, 100),
        time: new Date().toISOString(),
      };
      scheduleSave();
      broadcast({ type: "masterStatus", masterStatus });
      // わんこの端末へプッシュ
      if (masterStatus.text) sendPush("dog", "📣 ご主人より", masterStatus.text);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- ご主人からわんこへ応援ひとことを送る ---
  if (req.url === "/cheer" && req.method === "POST") {
    readJson(req, res, (data) => {
      if (!data.text) {
        res.writeHead(400);
        res.end("text が必要です");
        return;
      }
      lastCheer = {
        text: String(data.text).slice(0, 100),
        time: new Date().toISOString(),
      };
      scheduleSave();
      broadcast({ type: "cheer", cheer: lastCheer });
      // わんこの端末へプッシュ
      sendPush("dog", "💌 ご主人より", lastCheer.text);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- ご主人が応援メッセージを消す ---
  if (req.url === "/clear-cheer" && req.method === "POST") {
    lastCheer = { text: "", time: "" };
    scheduleSave();
    broadcast({ type: "cheer", cheer: lastCheer });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- 鍵をかけた/外したを切り替える ---
  if (req.url === "/lock" && req.method === "POST") {
    readJson(req, res, (data) => {
      lockState = { locked: !!data.locked, time: new Date().toISOString() };
      if (lockState.locked) addStamp("鍵", true); // かけたとき・1日1回だけ
      scheduleSave();
      broadcast({ type: "lock", lockState, stamps });
      // ご主人の端末へプッシュ
      sendPush("master", lockState.locked ? "🔒 鍵をかけたよ" : "🔓 鍵を外したよ", "ゆうた");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- クリームを塗った ---
  if (req.url === "/cream" && req.method === "POST") {
    readJson(req, res, () => {
      creamState = { time: new Date().toISOString() };
      addStamp("クリーム", true); // 1日1回だけ
      scheduleSave();
      broadcast({ type: "cream", creamState, stamps });
      // ご主人の端末へプッシュ
      sendPush("master", "🧴 クリームを塗ったよ", "ゆうた");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- 首輪を付けた/外したを切り替える ---
  if (req.url === "/collar" && req.method === "POST") {
    readJson(req, res, (data) => {
      collarState = { on: !!data.on, time: new Date().toISOString() };
      if (collarState.on) addStamp("首輪", true); // 付けたとき・1日1回だけ
      scheduleSave();
      broadcast({ type: "collar", collarState, stamps });
      // ご主人の端末へプッシュ
      sendPush("master", collarState.on ? "🦮 首輪をつけたよ" : "🦮 首輪を外したよ", "ゆうた");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- 見て欲しい！ ---
  if (req.url === "/look" && req.method === "POST") {
    readJson(req, res, () => {
      lookState = { time: new Date().toISOString() };
      scheduleSave();
      broadcast({ type: "look", lookState });
      // ご主人の端末へプッシュ
      sendPush("master", "👀 見て欲しい！", "ゆうた");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- ご主人がスタンプをあげる ---
  if (req.url === "/give-stamp" && req.method === "POST") {
    readJson(req, res, () => {
      addStamp("ごほうび");
      scheduleSave();
      broadcast({ type: "stamp", stamps });
      // わんこの端末へプッシュ
      sendPush("dog", "🐾 スタンプをもらったよ！", "ご主人からスタンプが1つ");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- わんこがごはんをリクエストする ---
  if (req.url === "/request" && req.method === "POST") {
    readJson(req, res, (data) => {
      if (!data.name || !data.text) {
        res.writeHead(400);
        res.end("name と text が必要です");
        return;
      }
      const request = {
        name: String(data.name).slice(0, 30),
        text: String(data.text).slice(0, 100),
        time: new Date().toISOString(),
      };
      requests.unshift(request);
      if (requests.length > REQUESTS_MAX) requests.length = REQUESTS_MAX;
      scheduleSave();
      broadcast({ type: "request", request });
      // ご主人の端末へプッシュ
      sendPush("master", `🦴 ${request.name}からおねがい`, request.text);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // --- ご主人がリクエストを消す ---
  if (req.url === "/clear-requests" && req.method === "POST") {
    requests = [];
    scheduleSave();
    broadcast({ type: "requestscleared" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const urlPathOnly = req.url.split("?")[0];

  // --- マーケット指標(銘柄を ?symbols= で自由に指定できる) ---
  if (urlPathOnly === "/market") {
    let producer;
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const raw = sp.get("symbols");
      if (raw) {
        // 安全な文字だけ許可し、最大12銘柄まで
        const symbols = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^[A-Za-z0-9.^=:-]{1,15}$/.test(s))
          .slice(0, 12);
        producer = symbols.length ? () => fetchSymbols(symbols) : fetchMarket;
      } else {
        producer = fetchMarket;
      }
    } catch (e) {
      producer = fetchMarket;
    }
    producer()
      .then((data) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data }));
      })
      .catch((e) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message, data: null }));
      });
    return;
  }

  // --- 外部データ(為替・仮想通貨・ニュース)を返す共通処理 ---
  const feeds = { "/fx": fetchFx, "/crypto": fetchCrypto, "/news": fetchNews };
  if (feeds[urlPathOnly]) {
    feeds[urlPathOnly]()
      .then((data) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data }));
      })
      .catch((e) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message, data: null }));
      });
    return;
  }

  // --- 自分用のスマホダッシュボード ---
  if (req.url === "/dashboard" || req.url === "/dashboard/") {
    req.url = "/dashboard.html";
  }

  // --- ご主人用の監視画面 ---
  if (req.url === "/master" || req.url === "/master/") {
    req.url = "/master.html";
  }

  // --- それ以外は静的ファイル ---
  serveStatic(req, res);
});

// --- やり忘れのお知らせ ---
// 日本時間の夜11時になっても「鍵」「クリーム」が終わっていなければ、
// ゆうたの端末に「まだだよ！」とお知らせを送る（1晩に1回だけ）。
const REMINDER_HOUR = 23;     // 日本時間の何時から知らせるか（23=夜11時）
const REMINDER_END_HOUR = 2;  // 深夜2時までは「同じ夜」として扱う
                              // （サーバーが眠っていて23時台を逃しても届くように）

// 日本時間での「今日の日付」と「時」を求める
function jstNow() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC+9
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}
// 日付を1日ずらす（"2026-08-10" → "2026-08-09" など）
function shiftDay(day, diff) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
// その日（日本時間）の0時以降に済ませてあるか
function doneSinceJst(iso, day) {
  if (!iso) return false;
  return new Date(iso).getTime() >= Date.parse(day + "T00:00:00+09:00");
}

function checkReminder() {
  const { day, hour } = jstNow();
  // 夜11時〜深夜2時のあいだだけ確認する
  if (hour < REMINDER_HOUR && hour >= REMINDER_END_HOUR) return;
  // 深夜0〜2時は「前の日の夜」として数える
  const night = hour < REMINDER_END_HOUR ? shiftDay(day, -1) : day;
  if (lastReminderDay === night) return; // この夜はもう送った

  const todo = [];
  if (!lockState.locked) todo.push("鍵");
  if (!doneSinceJst(creamState.time, night)) todo.push("クリーム");
  if (todo.length === 0) return; // 全部おわっている

  lastReminderDay = night;
  scheduleSave();
  sendPush("dog", "🐾 まだだよ！", `${todo.join("と")}がまだだよ`);
  broadcast({ type: "reminder", todo });
}
setInterval(checkReminder, 60 * 1000); // 1分ごとに確認

// データベースから前回のデータを読み込んでから起動する
loadState().finally(() => {
  server.listen(PORT, () => {
    console.log(`起動しました → http://localhost:${PORT}`);
    console.log(redis ? "データベース：接続あり（永久保存）" : "データベース：なし（メモリのみ）");
  });
});
