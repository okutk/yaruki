// ご褒美の生成と抽選のテスト。実行: node tests/rewards.test.js   (生成例も見るなら --samples)
"use strict";
var path = require("path");
var R = require(path.join(__dirname, "..", "rewards.js"));

var failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.log("  NG  " + msg); }
}

// 再現できる乱数(テスト用)
function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var TYPES = ["box", "final"];

// ── 1. 各レベルの件数・重複・長さ ──────────────────────
TYPES.forEach(function (type) {
  var all = {}, sizes = [];
  for (var lv = 1; lv <= R.LEVELS; lv++) {
    var items = R.pool(type, lv);
    sizes.push(items.length);
    check(items.length >= 1000, type + " レベル" + lv + " は1000件以上: " + items.length);
    check(items.length > R.RECENT_LIMIT, type + " レベル" + lv + " は直近履歴(" + R.RECENT_LIMIT + ")より多い");
    items.forEach(function (text) {
      check(!all[text], type + " で同じ文が2回: 「" + text + "」(レベル" + all[text] + "と" + lv + ")");
      all[text] = lv;
      check(text.length <= R.MAX_LEN[type], type + " の長さ上限を超えた: 「" + text + "」");
      check(!/、、|^、|、$|\{|\}|undefined/.test(text), type + " の文の形がおかしい: 「" + text + "」");
    });
  }
  console.log(type + ": レベル1〜6 = " + sizes.join(" / ") + " 件(合計 " + Object.keys(all).length + ")");
});

// ── 2. 1000回連続で引いて重複がない ─────────────────────
function run(type, n, levelOf, rng, roundTrip) {
  var hist = R.emptyHistory(type), texts = [];
  for (var i = 0; i < n; i++) {
    if (roundTrip) hist = R.checkHistory(type, JSON.parse(JSON.stringify(hist))); // localStorage に保存して読み戻すのと同じ
    texts.push(R.draw(type, levelOf(i), hist, rng).text);
  }
  return { texts: texts, hist: hist };
}

// 直近 window 回の中に同じ文がないか(どこから数えた1000回でも重複しないか)
function windowDuplicates(texts, windowSize) {
  var last = {}, bad = [];
  texts.forEach(function (t, i) {
    if (last[t] !== undefined && i - last[t] < windowSize) bad.push(t + "(" + last[t] + "回目と" + i + "回目)");
    last[t] = i;
  });
  return bad;
}

TYPES.forEach(function (type) {
  var rng = makeRng(type === "box" ? 1 : 2);
  // (a) レベルを毎回ランダムに変えて1000回。保存→読み戻しも毎回はさむ
  var a = run(type, 1000, function () { return 1 + Math.floor(rng() * R.LEVELS); }, rng, true);
  var uniq = {};
  a.texts.forEach(function (t) { uniq[t] = true; });
  check(Object.keys(uniq).length === 1000, type + ": ランダムなレベルで1000回 → 重複 " + (1000 - Object.keys(uniq).length) + " 件");

  // (b) 一番少ないレベルだけを1000回
  var smallest = 1;
  for (var lv = 2; lv <= R.LEVELS; lv++) if (R.pool(type, lv).length < R.pool(type, smallest).length) smallest = lv;
  var b = run(type, 1000, function () { return smallest; }, rng, false);
  var uniqB = {};
  b.texts.forEach(function (t) { uniqB[t] = true; });
  check(Object.keys(uniqB).length === 1000, type + ": 件数が一番少ないレベル" + smallest + "だけで1000回 → 重複 " + (1000 - Object.keys(uniqB).length) + " 件");

  // (c) 周回をまたぐ長さ(一番少ないレベルで4000回・ランダムなレベルで6000回)。どこから数えた1000回にも重複がない
  var c = run(type, 4000, function () { return smallest; }, rng, false);
  var badC = windowDuplicates(c.texts, 1000);
  check(badC.length === 0, type + ": レベル" + smallest + "で4000回(周回をまたぐ)の1000回窓で重複: " + badC.slice(0, 3).join(" / "));
  var d = run(type, 6000, function (i) { return 1 + Math.floor(rng() * R.LEVELS); }, rng, false);
  var badD = windowDuplicates(d.texts, 1000);
  check(badD.length === 0, type + ": ランダムなレベルで6000回の1000回窓で重複: " + badD.slice(0, 3).join(" / "));

  // (d) 使い切るまで同じものは出ない(1周目は全件が1回ずつ)
  var n = R.pool(type, smallest).length;
  var e = run(type, n, function () { return smallest; }, rng, false);
  var uniqE = {};
  e.texts.forEach(function (t) { uniqE[t] = true; });
  check(Object.keys(uniqE).length === n, type + ": レベル" + smallest + "の" + n + "件を1周で全部1回ずつ出す");

  var size = JSON.stringify(d.hist).length;
  console.log(type + ": 1000回連続の重複なし・周回またぎOK・保存サイズ " + (size / 1024).toFixed(1) + "KB(6000回引いた後)");
  check(size < 64 * 1024, type + ": 履歴の保存サイズが大きすぎる: " + size);
});

// ── 3. 履歴の互換性 ─────────────────────────────
var h = R.checkHistory("box", null);
check(h && h.sig === R.signature("box") && Array.isArray(h.recent), "空の履歴から作り直せる");
var h2 = R.checkHistory("box", { sig: "v0:1,2,3", used: {}, recent: [1, 2] });
check(h2.recent.length === 0, "部品が変わった(署名が違う)ら履歴をリセットする");
var h3 = R.checkHistory("box", "壊れたデータ");
check(h3.recent.length === 0, "壊れた履歴でも動く");
var t = R.draw("final", 99, R.emptyHistory("final"), makeRng(3));
check(t.level === R.LEVELS && typeof t.text === "string", "範囲外のレベルは端に丸める");

// ── 4. 生成例(目で自然さを確認する用) ────────────────────
if (process.argv.indexOf("--samples") !== -1) {
  var rs = makeRng(Date.now());
  TYPES.forEach(function (type) {
    for (var lv = 1; lv <= R.LEVELS; lv++) {
      var items = R.pool(type, lv);
      console.log("\n[" + type + " レベル" + lv + "]");
      for (var i = 0; i < 8; i++) console.log("  " + items[Math.floor(rs() * items.length)]);
    }
  });
}

if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
