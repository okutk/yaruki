// オフライン用。常にネットワークを優先し、つながらないときだけキャッシュを使う。
// そのため更新を push すれば、次にオンラインで開いたときに最新版が表示される。
// 電波が弱くて NETWORK_TIMEOUT を過ぎても返事がないときは、保存してある版を先に表示する
// (ネットワークの取得はそのまま続け、届いたらキャッシュを新しくする)。
var CACHE = "genkouyoushi-v8";
var NETWORK_TIMEOUT = 3000;
var ASSETS = [
  "./",
  "./index.html",
  "./classify.js",
  "./guess.js",
  "./rewards.js",
  "./records.js",
  "./gym.js",
  "./watch.js",
  "./manuscript.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/shortcut-gym-96.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("./index.html");
    return undefined;
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  var network = fetch(req, { cache: "no-cache" }).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      return caches.open(CACHE).then(function (c) { return c.put(req, copy); }).then(function () { return res; });
    }
    return res;
  });
  e.waitUntil(network.catch(function () {}));
  e.respondWith(new Promise(function (resolve) {
    var settled = false;
    function answer(res) {
      if (settled) return;
      settled = true;
      resolve(res);
    }
    var timer = setTimeout(function () {
      // 時間切れ: キャッシュにあればそれを返す。無ければネットワークを待ち続ける
      fromCache(req).then(function (hit) { if (hit) answer(hit); });
    }, NETWORK_TIMEOUT);
    network.then(function (res) {
      clearTimeout(timer);
      answer(res);
    }, function () {
      clearTimeout(timer);
      fromCache(req).then(function (hit) { answer(hit || Response.error()); });
    });
  }));
});
