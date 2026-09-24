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

// ── 1b. 合わない組み合わせが混じっていない(レビューで見つかった型) ─────────
var AVOID = [
  [/報告|終わった！/, "報告する相手がいる前提の文(ひとりで使うアプリなので入れない)"],
  [/ストレッチ動画|スクワット|足踏み|ジャンプ|つま先立ち|ラジオ体操|体操をする/, "運動そのもので、ご褒美にならない"],
  [/(寝る前に|今夜).*(外で|天気)/, "夜に外・天気"],
  [/(明日|次の休み|今週|今月|連休|近いうち).*(パジャマ|明日の予定|おつかれ|拍手|宣言|スクショ)/, "先の日付に「今すぐやること」"],
  [/こっそり.*(書|メモ|スタンプ|シール)/, "こっそり + 書く"],
  [/頑張った自分を連れて/, "外した部品"],
  [/今日.*今日/, "「今日」が重なる"],
  [/窓.*ベランダ/, "窓とベランダが重なる"]
];
TYPES.forEach(function (type) {
  for (var lv = 1; lv <= R.LEVELS; lv++) {
    R.pool(type, lv).forEach(function (text) {
      AVOID.forEach(function (a) { check(!a[0].test(text), type + " に入れない文(" + a[1] + "): 「" + text + "」"); });
    });
  }
});

// ── 1b2. やわらかい言い回しを残す(そろえすぎて、気持ちが動く言い方を消さない) ─────────
var GENTLE = [
  ["box", "好きな飲み物をひと口飲む"], ["box", "空の色を確かめる"], ["box", "深呼吸をひとつしてから"],
  ["box", "ため息をひとつ大きくつく"], ["box", "心の中で「いいね、自分」と言う"], ["box", "手を洗ってさっぱりしてから"],
  ["box", "冷蔵庫の前で立ったまま"], ["box", "今のひとときを味わうように"], ["final", "好きな飲み物をいれて、ゆっくり飲む"],
  ["final", "自分をたっぷり甘やかして"]
];
GENTLE.forEach(function (g) {
  var found = false;
  for (var lv = 1; lv <= R.LEVELS && !found; lv++) {
    found = R.pool(g[0], lv).some(function (text) { return text.indexOf(g[1]) !== -1; });
  }
  check(found, g[0] + " にやわらかい言い回し「" + g[1] + "」が残っていない");
});

// ── 1c. 段階の釣り合い: レベルが上がるほどご褒美が大きい(tools/reward-scale.md) ─────────
function quantile(list, p) {
  var s = list.slice().sort(function (a, b) { return a - b; });
  var i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
TYPES.forEach(function (type) {
  var med = [], q1 = [];
  for (var lv = 1; lv <= R.LEVELS; lv++) {
    var items = R.details(type, lv);
    var scores = items.map(function (x) { return x.score; });
    med.push(quantile(scores, 0.5));
    q1.push(quantile(scores, 0.25));
    // 行動そのものの点数は、そのレベルの目安の幅に入る
    var band = R.BANDS[type][lv - 1], seenAct = {};
    items.forEach(function (x) {
      if (seenAct[x.act]) return;
      seenAct[x.act] = true;
      check(x.base >= band[0] && x.base <= band[1], type + " レベル" + lv + " の行動の点数 " + x.base + " が目安 " + band.join("〜") + " の外: 「" + x.act + "」");
    });
    // 低いレベルは「今すぐ・今日のうち」だけ。先の日付は上のレベルから
    var maxW = type === "box" ? 0 : [1, 1, 2, 2, 3, 3][lv - 1];
    items.forEach(function (x) { check(x.size.w <= maxW, type + " レベル" + lv + " に先すぎるもの(時期 " + x.size.w + "): 「" + x.text + "」"); });
  }
  for (var i = 1; i < med.length; i++) {
    check(med[i] > med[i - 1], type + ": 点数の中央値がレベル" + i + "→" + (i + 1) + "で増えていない: " + med.join(" / "));
    // 隣のレベルとの重なり: 上のレベルの下位25%が、下のレベルの中央値を下回らない
    check(q1[i] >= med[i - 1], type + ": レベル" + (i + 1) + "の下位25%(" + q1[i] + ")がレベル" + i + "の中央値(" + med[i - 1] + ")より小さい");
  }
  console.log(type + ": 点数の中央値 レベル1〜6 = " + med.join(" / "));
});

// ── 1d. 場所(家/外/どこでも) ──────────────────────────
TYPES.forEach(function (type) {
  var outSizes = [];
  for (var lv = 1; lv <= R.LEVELS; lv++) {
    var base = R.pool(type, lv);
    // 省略したときは、これまでと同じ(家・どこでも)
    check(JSON.stringify(R.pool(type, lv, {})) === JSON.stringify(base), type + " レベル" + lv + ": opts が空でも結果が同じ");
    check(JSON.stringify(R.pool(type, lv, { place: "home" })) === JSON.stringify(base), type + " レベル" + lv + ": place home は省略と同じ");
    check(JSON.stringify(R.details(type, lv).map(function (x) { return x.text; })) === JSON.stringify(base), type + " レベル" + lv + ": details と pool の並びが同じ");
    R.details(type, lv).forEach(function (x) { check(x.place !== "o", type + " に外だけの文が混じる: 「" + x.text + "」"); });
    var out = R.details(type, lv, { place: "out" });
    outSizes.push(out.length);
    out.forEach(function (x) {
      var ok = x.place !== "h" || (type === "final" && x.size.w >= 1);
      check(ok, type + " の外の候補に家でしかできない文: 「" + x.text + "」");
    });
    check(out.length >= 400, type + " レベル" + lv + " の外の候補が少ない: " + out.length);
  }
  console.log(type + ": 外で使える件数 レベル1〜6 = " + outSizes.join(" / "));
});

// 外の条件で引く: 外の候補だけが出る・周回しても重複しない・履歴は省略時と共通で使える
(function () {
  var rng = makeRng(7), hist = R.emptyHistory("box");
  var outSet = {};
  R.pool("box", 4, { place: "out" }).forEach(function (t) { outSet[t] = true; });
  var texts = [];
  for (var i = 0; i < 1500; i++) {
    var r = R.draw("box", 4, hist, rng, { place: "out" });
    check(outSet[r.text], "外の条件で外の候補以外が出た: 「" + r.text + "」");
    texts.push(r.text);
    if (i % 3 === 0) R.draw("box", 4, hist, rng); // 省略時の抽選とまぜても壊れない
  }
  var n = R.pool("box", 4, { place: "out" }).length;
  var bad = windowDuplicatesOf(texts, Math.min(n, 400));
  check(bad.length === 0, "外の条件で " + Math.min(n, 400) + " 回の窓に重複: " + bad.slice(0, 3).join(" / "));
  var homeSet = {};
  R.pool("box", 4).forEach(function (t) { homeSet[t] = true; });
  for (var j = 0; j < 300; j++) check(homeSet[R.draw("box", 4, hist, rng).text], "省略時に外だけの文が出た");
})();
// 除外(opts.skip): 運動の紙では量の多い外食を出さない。省略すれば今と同じ
(function () {
  for (var lv = 1; lv <= R.LEVELS; lv++) {
    var all = R.pool("final", lv), skipped = R.pool("final", lv, { skip: ["feast"] });
    check(JSON.stringify(R.pool("final", lv, { skip: [] })) === JSON.stringify(all), "skip が空なら省略と同じ(レベル" + lv + ")");
    check(JSON.stringify(R.pool("final", lv, { skip: ["?"] })) === JSON.stringify(all), "知らない名前の skip は無視する(レベル" + lv + ")");
    skipped.forEach(function (text) { check(!/食べ放題|焼肉|ラーメン/.test(text), "feast を除いたのに出た: 「" + text + "」"); });
    check(skipped.length >= 900, "feast を除いても十分な件数がある(レベル" + lv + "): " + skipped.length);
  }
  var hist = R.emptyHistory("final"), rng = makeRng(11);
  for (var i = 0; i < 300; i++) {
    var r = R.draw("final", 5, hist, rng, { skip: ["feast"] });
    check(!/食べ放題|焼肉|ラーメン/.test(r.text), "feast を除いた抽選で出た: 「" + r.text + "」");
  }
})();
// 時期(opts.minWhen): 寝る紙の全完了のご褒美は、明日以降にもらうもの(w が2以上)から引く。省略すれば今と同じ
(function () {
  var NERU = { skip: ["feast"], minWhen: 2 };
  var sizes = [];
  for (var lv = 1; lv <= R.LEVELS; lv++) {
    var all = R.pool("final", lv), skipOnly = R.details("final", lv, { skip: ["feast"] });
    check(JSON.stringify(R.pool("final", lv, { minWhen: 0 })) === JSON.stringify(all), "minWhen が0なら省略と同じ(レベル" + lv + ")");
    check(JSON.stringify(R.pool("final", lv, { minWhen: "?" })) === JSON.stringify(all), "数でない minWhen は無視する(レベル" + lv + ")");
    [1, 2, 3].forEach(function (mw) {
      var expect = skipOnly.filter(function (x) { return x.size.w >= mw; }).map(function (x) { return x.text; });
      var got = R.details("final", lv, { skip: ["feast"], minWhen: mw }).map(function (x) { return x.text; });
      check(JSON.stringify(got) === JSON.stringify(expect), "minWhen " + mw + " は時期でしぼるだけ(レベル" + lv + ")");
      check(JSON.stringify(R.pool("final", lv, { skip: ["feast"], minWhen: mw })) === JSON.stringify(expect), "minWhen " + mw + " の pool と details が同じ(レベル" + lv + ")");
    });
    sizes.push(R.pool("final", lv, NERU).length);
  }
  // 寝る紙が引くレベル。index.html の taskFinalLevel と同じく、候補が残る一番近い上のレベル
  var used = [];
  for (var sl = 1; sl <= R.LEVELS; sl++) {
    var at = sl;
    while (at < R.LEVELS && !R.pool("final", at, NERU).length) at++;
    var n = R.pool("final", at, NERU).length;
    used.push(at + ":" + n);
    check(n >= 150, "寝る紙のレベル" + sl + "で引く候補(レベル" + at + ")が少ない: " + n);
    check(at - sl <= 2, "寝る紙のレベル" + sl + "のご褒美がレベル" + at + "まで上がる");
  }
  console.log("final: 明日以降のもの(minWhen 2・feast 除く)の件数 レベル1〜6 = " + sizes.join(" / ") +
    "  寝る紙が引くレベル:件数 = " + used.join(" / "));
  // 抽選: しぼった候補だけが出る・使い切るまで重複しない
  var rng = makeRng(13), hist = R.emptyHistory("final"), ok = {};
  var n3 = R.pool("final", 3, NERU).length, texts = [];
  R.pool("final", 3, NERU).forEach(function (text) { ok[text] = true; });
  for (var i = 0; i < n3; i++) {
    var r = R.draw("final", 3, hist, rng, NERU);
    check(ok[r.text], "minWhen でしぼった抽選で候補以外が出た: 「" + r.text + "」");
    texts.push(r.text);
  }
  check(windowDuplicatesOf(texts, n3).length === 0, "minWhen でしぼった抽選で、使い切る前に重複した");
  // しぼって候補が残らないレベルでも落ちない(時期でしぼらずに引く)
  var r1 = R.draw("final", 1, hist, rng, NERU);
  check(r1.level === 1 && R.pool("final", 1, { skip: ["feast"] }).indexOf(r1.text) !== -1, "候補が残らないレベルでも引ける");
})();
function windowDuplicatesOf(texts, windowSize) {
  var last = {}, bad = [];
  texts.forEach(function (t, i) {
    if (last[t] !== undefined && i - last[t] < windowSize) bad.push(t);
    last[t] = i;
  });
  return bad;
}

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
