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

const PORT = process.env.PORT || 3000;

// 接続中のクライアント(SSE)を保持する
let clients = [];
// 各ユーザーの「今の状態」を覚えておく（後から開いた人にも現状を見せるため）
const currentStatus = {}; // { 名前: { status, message, time } }
// ご主人画面の活動ログ用に、直近の更新履歴を覚えておく（最大50件）
let history = []; // 新しいものが先頭
const HISTORY_MAX = 50;

// ご主人が決める「ごはん予定」（平日の夜 / 土日の昼 / 土日の夜）
let mealPlan = { weekdayDinner: "", weekendLunch: "", weekendDinner: "" };
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
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end("不正なデータです");
      }
    });
    return;
  }

  // --- ご主人が活動ログを消す ---
  if (req.url === "/clear" && req.method === "POST") {
    history = [];
    broadcast({ type: "logcleared" });
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
      broadcast({ type: "request", request });
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
