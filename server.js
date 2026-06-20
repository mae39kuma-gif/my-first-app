// 相手が今なにをしているか分かる、ステータス通知アプリ
// 追加ライブラリ不要。Node標準の http モジュールだけで動きます。
//
// 使い方:
//   node server.js
//   → ブラウザで http://localhost:3000 を開く
//   自分と相手がそれぞれ開いて、名前を入れてボタンを押すと、
//   もう片方の画面に「○○さんが【勉強中】になりました」と通知が飛びます。

const http = require("http");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

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
// わんこからの「ごはんリクエスト」（新しいものが先頭・最大50件）
let requests = []; // { name, text, time }
const REQUESTS_MAX = 50;

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
        // 同じ端末の二重登録を防ぐ
        subscriptions[role] = subscriptions[role].filter(
          (s) => s.endpoint !== sub.endpoint
        );
        subscriptions[role].push(sub);
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
    broadcast({ type: "cheer", cheer: lastCheer });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
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
    broadcast({ type: "requestscleared" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- ご主人用の監視画面 ---
  if (req.url === "/master" || req.url === "/master/") {
    req.url = "/master.html";
  }

  // --- それ以外は静的ファイル ---
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`起動しました → http://localhost:${PORT}`);
  console.log("自分と相手でこのURLを開いて、名前を入れてボタンを押してみてください。");
});
