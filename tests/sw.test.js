// sw.js の取得ルールのテスト(fetch とキャッシュは作り物)。実行: node tests/sw.test.js
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var failures = 0;
function check(ok, msg) {
  console.log((ok ? "  OK  " : "  NG  ") + msg);
  if (!ok) failures++;
}

function FakeResponse(body, ok) { this.body = body; this.ok = ok !== false; }
FakeResponse.prototype.clone = function () { return new FakeResponse(this.body, this.ok); };
FakeResponse.error = function () { return new FakeResponse("(error)", false); };

// 1つの状況ごとに sw.js を読み込み直す
function setup(net) {
  var store = {};
  var handlers = {};
  var ctx = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, URL: URL,
    Response: FakeResponse,
    self: { location: { origin: "https://example.test" }, addEventListener: function (t, f) { handlers[t] = f; },
            skipWaiting: function () {}, clients: { claim: function () {} } },
    caches: {
      open: function () {
        return Promise.resolve({
          put: function (req, res) { store[req.url] = res; return Promise.resolve(); },
          addAll: function () { return Promise.resolve(); }
        });
      },
      match: function (req) {
        var url = typeof req === "string" ? "https://example.test/" + req.replace(/^\.\//, "") : req.url;
        return Promise.resolve(store[url]);
      },
      keys: function () { return Promise.resolve([]); }
    },
    fetch: function () {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (net.fail) reject(new Error("offline"));
          else resolve(new FakeResponse("network"));
        }, net.delay);
      });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"), ctx);
  ctx.NETWORK_TIMEOUT = 50; // テストでは 3秒 を 50ms に縮める
  return { store: store, handlers: handlers };
}

function request(sw, url, mode) {
  var responded = null, waits = [];
  var started = Date.now();
  sw.handlers.fetch({
    request: { url: url, method: "GET", mode: mode || "no-cors" },
    respondWith: function (p) { responded = p; },
    waitUntil: function (p) { waits.push(p); }
  });
  return responded.then(function (res) {
    return { res: res, ms: Date.now() - started, waits: Promise.all(waits) };
  });
}

(async function () {
  var URL1 = "https://example.test/index.html";

  var a = setup({ delay: 10 });
  var r = await request(a, URL1, "navigate");
  await r.waits;
  check(r.res.body === "network", "電波が普通: ネットワークの最新版を返す");
  check(a.store[URL1] && a.store[URL1].body === "network", "電波が普通: 取れた版をキャッシュに保存する");

  var b = setup({ delay: 300 });
  b.store[URL1] = new FakeResponse("cached");
  r = await request(b, URL1, "navigate");
  check(r.res.body === "cached" && r.ms < 200, "電波が弱い: 時間切れ(" + r.ms + "ms)で保存済みの版を先に表示する");
  await r.waits;
  check(b.store[URL1].body === "network", "電波が弱い: あとから届いた版でキャッシュを新しくする");

  var c = setup({ delay: 150 });
  r = await request(c, URL1, "navigate");
  check(r.res.body === "network" && r.ms >= 140, "電波が弱くキャッシュも無い: ネットワークを待って表示する");

  var d = setup({ delay: 5, fail: true });
  d.store[URL1] = new FakeResponse("cached");
  r = await request(d, URL1, "navigate");
  check(r.res.body === "cached", "オフライン: 保存済みの版を表示する");

  var e = setup({ delay: 5, fail: true });
  e.store[URL1] = new FakeResponse("cached-index");
  r = await request(e, "https://example.test/?from=home", "navigate");
  check(r.res.body === "cached-index", "オフライン: 別のURLで開いても index.html を表示する");

  var f = setup({ delay: 5, fail: true });
  r = await request(f, "https://example.test/rewards.js");
  check(r.res.ok === false, "オフラインでキャッシュも無いファイル: エラーを返す(固まらない)");

  // ホーム画面の「ジムに行く」ショートカット(./?start=gym)は、オフラインでも index.html を開く
  var g = setup({ delay: 5, fail: true });
  g.store["https://example.test/"] = new FakeResponse("cached-root");
  g.store[URL1] = new FakeResponse("cached-index");
  r = await request(g, "https://example.test/?start=gym", "navigate");
  check(r.res.body === "cached-root" || r.res.body === "cached-index", "オフライン: ?start=gym で開いても、保存済みの画面を表示する");

  var src = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  ["./classify.js", "./rewards.js", "./records.js", "./gym.js", "./watch.js", "./index.html", "./icons/shortcut-gym-96.png"].forEach(function (f) {
    check(src.indexOf('"' + f + '"') !== -1, "最初からキャッシュするファイルに " + f + " がある");
  });
  var ctx = { self: { addEventListener: function () {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  var missing = ctx.ASSETS.filter(function (a) {
    return a !== "./" && !fs.existsSync(path.join(__dirname, "..", a));
  });
  check(!missing.length, "最初からキャッシュするファイルが全部ある" + (missing.length ? ": " + missing.join(", ") : ""));
  check(/genkouyoushi-v6/.test(ctx.CACHE), "キャッシュ名の番号を上げた(" + ctx.CACHE + ")");

  // manifest のショートカット
  var manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.webmanifest"), "utf8"));
  var sc = (manifest.shortcuts || [])[0];
  check(sc && sc.name === "ジムに行く" && sc.short_name === "ジム" && sc.url === "./?start=gym",
    "manifest に「ジムに行く」のショートカットがある");
  check(sc && sc.icons && sc.icons[0].sizes === "96x96" && ctx.ASSETS.indexOf("./" + sc.icons[0].src) !== -1,
    "ショートカットのアイコン(96×96)もキャッシュする");

  if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
  console.log("\nすべて成功");
})();
