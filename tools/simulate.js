// 1か月分の試し運転。仮の使い方で原稿用紙を作り、ご褒美を引いて、数字を出す(テストではなく道具)。
// 実行: node tools/simulate.js [--days 30] [--seed 1] [--rewards PATH] [--classify PATH]
//   --rewards / --classify で別の版(直す前など)を読み込んで比べられる。
//
// 見るもの
//   ・紙のレベル・マス数・軽い手順の出方
//   ・同じ行動のご褒美が近い間隔で続く頻度(直前10回・20回のマスごとのご褒美、直前5回の全部埋めたときのご褒美)
//   ・マスごとの段階(boxLevelFor)を入れたときの、1枚の紙の平均レベルの変化
//   ・外でやるマス(place "out")で引いたとき、まだ出していない候補が尽きないか
"use strict";
var path = require("path");
var fs = require("fs");

var argv = process.argv.slice(2);
function arg(name, def) {
  var i = argv.indexOf("--" + name);
  return i === -1 ? def : argv[i + 1];
}
var DAYS = +arg("days", 30);
var SEED = +arg("seed", 1);
var rewardsPath = path.resolve(arg("rewards", path.join(__dirname, "..", "rewards.js")));
var classifyPath = path.resolve(arg("classify", path.join(__dirname, "..", "classify.js")));
var R = require(rewardsPath);
var C = require(classifyPath);

function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function weighted(rng, table) {
  var total = 0, k;
  for (k in table) total += table[k];
  var r = rng() * total;
  for (k in table) { r -= table[k]; if (r < 0) return k; }
  return k;
}

// 仮の使い方(一般的なやることと、気の重さ・時間・エネルギーの割合)
var TASKS = [
  "部屋の掃除", "トイレ掃除", "机の上の片付け", "クローゼットの整理", "夕飯を作る", "作り置き", "洗濯物を干す",
  "洗濯物をたたむ", "皿洗い", "ゴミ出し", "役所の手続き", "保険の書類", "公共料金の支払い", "家計簿をつける",
  "メールの返信", "LINEを返す", "資料作り", "会議の準備", "資格の勉強", "英単語の暗記", "本を読む", "積読を崩す",
  "イラストを描く", "ブログを書く", "ギターの練習", "筋トレ", "ジムに行く", "ジョギング", "歯医者に行く",
  "病院の予約", "早く寝る", "体重を測る", "お風呂に入る", "出かける準備", "買い物", "日用品の買い出し",
  "旅行の計画", "ライブのチケットを取る", "友達を誘う", "お礼の手紙", "履歴書を書く", "バグを直す",
  "引っ越しの準備", "なんとなくやる気が出ない"
];
var HEAVINESS = { 1: 10, 2: 20, 3: 35, 4: 25, 5: 10 };
var TIME = { 5: 20, 15: 40, 30: 25, 60: 15 };
var ENERGY = { 1: 25, 2: 55, 3: 20 };
var SHEETS_PER_DAY = { 3: 1, 4: 1, 5: 1 };

// 引いたご褒美が、どの行動・種類のものか(details があればそれを使い、なければ部品の文から探す)
function actFinder(type) {
  if (R.details) {
    var map = {};
    for (var lv = 1; lv <= R.LEVELS; lv++) {
      [undefined, { place: "out" }].forEach(function (opts) {
        R.details(type, lv, opts).forEach(function (x) { map[x.text] = { act: x.act, kind: x.kind }; });
      });
    }
    return function (text) { return map[text] || { act: text, kind: "?" }; };
  }
  var src = fs.readFileSync(rewardsPath, "utf8");
  var start = src.indexOf(type === "box" ? "var BOX" : "var FINAL");
  var end = src.indexOf(type === "box" ? "var FINAL" : "var DEFS", start);
  var literals = [], patterns = [];
  (src.slice(start, end).match(/"[a-z_]+\|[^"]*"/g) || []).forEach(function (q) {
    var parts = q.slice(1, -1).split("|");
    var text = parts.filter(function (p) { return /[ぁ-んァ-ン一-龥]/.test(p) && !/^\d:/.test(p); })[0];
    if (!text) return;
    if (text.indexOf("{d}") !== -1) patterns.push({ act: text, kind: parts[0], re: new RegExp(text.replace("{d}", ".+") + "$") });
    else literals.push({ act: text, kind: parts[0] });
  });
  literals.sort(function (a, b) { return b.act.length - a.act.length; });
  return function (text) {
    for (var i = 0; i < literals.length; i++) if (text.slice(-literals[i].act.length) === literals[i].act) return literals[i];
    for (var j = 0; j < patterns.length; j++) if (patterns[j].re.test(text)) return patterns[j];
    return { act: text, kind: "?" };
  };
}

function simulate(useBoxLevels) {
  var rng = makeRng(SEED);
  var hist = { box: R.emptyHistory("box"), final: R.emptyHistory("final") };
  var actOf = { box: actFinder("box"), final: actFinder("final") };
  var recent = { box: [], final: [] }, recentKinds = { box: [], final: [] };
  var st = {
    sheets: 0, levels: [0, 0, 0, 0, 0, 0], steps: {}, light: 0, boxes: 0,
    repeat10: 0, repeat20: 0, finalRepeat5: 0, kind3: 0, finalKind2: 0, levelShift: 0, boxLevels: [0, 0, 0, 0, 0, 0],
    outDraws: 0, outMinFresh: Infinity, outExhausted: 0, drawFails: 0
  };
  function drawOne(type, level, opts) {
    var before = opts && opts.place === "out" && R.details ? freshCount(level, opts) : null;
    if (before !== null) {
      st.outDraws++;
      st.outMinFresh = Math.min(st.outMinFresh, before);
      if (before === 0) st.outExhausted++;
    }
    var r = opts ? R.draw(type, level, hist[type], rng, opts) : R.draw(type, level, hist[type], rng);
    var found = actOf[type](r.text), act = found.act, kind = found.kind;
    var list = recent[type], kinds = recentKinds[type];
    if (type === "box") {
      if (list.slice(-10).indexOf(act) !== -1) st.repeat10++;
      if (list.slice(-20).indexOf(act) !== -1) st.repeat20++;
      if (kinds.slice(-3).indexOf(kind) !== -1) st.kind3++;
    } else {
      if (list.slice(-5).indexOf(act) !== -1) st.finalRepeat5++;
      if (kinds.slice(-2).indexOf(kind) !== -1) st.finalKind2++;
    }
    list.push(act);
    kinds.push(kind);
    return r;
  }
  // 外の条件で、まだ出していない(今の周回で未使用・直近にない)候補の数
  function freshCount(level, opts) {
    var used = hist.box.used[level] || "", recentIds = {};
    hist.box.recent.forEach(function (id) { recentIds[id] = true; });
    var n = 0;
    R.details("box", level, opts).forEach(function (it) {
      var c = used.charAt(it.index >> 2), bit = c ? (parseInt(c, 16) >> (it.index & 3)) & 1 : 0;
      if (!bit && !recentIds[level * 100000 + it.index]) n++;
    });
    return n;
  }

  for (var day = 0; day < DAYS; day++) {
    var n = +weighted(rng, SHEETS_PER_DAY);
    for (var k = 0; k < n; k++) {
      var input = {
        task: TASKS[Math.floor(rng() * TASKS.length)],
        heaviness: +weighted(rng, HEAVINESS), time: +weighted(rng, TIME), energy: +weighted(rng, ENERGY)
      };
      var p = C.plan(input);
      st.sheets++;
      st.levels[p.level - 1]++;
      st.steps[p.steps.length] = (st.steps[p.steps.length] || 0) + 1;
      if (p.light) st.light++;
      var sum = 0;
      p.steps.forEach(function (step, i) {
        var lv = useBoxLevels && C.boxLevelFor && p.roles ? C.boxLevelFor(p.level, p.roles[i]) : p.level;
        var opts = p.places && p.places[i] === "out" ? { place: "out" } : undefined;
        sum += lv;
        st.boxLevels[lv - 1]++;
        st.boxes++;
        drawOne("box", lv, opts);
      });
      st.levelShift += sum / p.steps.length - p.level;
      drawOne("final", p.level);
    }
  }
  return st;
}

function pct(a, b) { return b ? (Math.round(a * 1000 / b) / 10) + "%" : "-"; }
function report(title, st) {
  console.log("■ " + title);
  console.log("  紙 " + st.sheets + " 枚 / マス " + st.boxes + " 個 / 軽い手順 " + pct(st.light, st.sheets));
  console.log("  紙のレベル  " + st.levels.map(function (c, i) { return "Lv" + (i + 1) + " " + pct(c, st.sheets); }).join(" / "));
  console.log("  マス数      " + Object.keys(st.steps).sort().map(function (k) { return k + "マス " + pct(st.steps[k], st.sheets); }).join(" / "));
  console.log("  マスのご褒美のレベル " + st.boxLevels.map(function (c, i) { return "Lv" + (i + 1) + " " + pct(c, st.boxes); }).join(" / "));
  console.log("  1枚の紙の平均レベル − 紙のレベル: " + (Math.round(st.levelShift / st.sheets * 1000) / 1000));
  console.log("  同じ行動が続く: マスごと 直前10回に同じ行動 " + pct(st.repeat10, st.boxes) + " / 直前20回 " + pct(st.repeat20, st.boxes) +
    "  全部埋めたとき 直前5回 " + pct(st.finalRepeat5, st.sheets));
  console.log("  同じ種類(飲む・見る など)が続く: マスごと 直前3回に同じ種類 " + pct(st.kind3, st.boxes) +
    " / 全部埋めたとき 直前2回 " + pct(st.finalKind2, st.sheets));
  if (st.outDraws) {
    console.log("  外のマス: " + st.outDraws + " 回引いた / まだ出していない候補の最小 " + st.outMinFresh + " 件 / 尽きた回数 " + st.outExhausted);
  }
}

console.log("試し運転: " + DAYS + " 日 / seed " + SEED + "\n  rewards: " + rewardsPath + "\n  classify: " + classifyPath + "\n");
report("マスごとのご褒美 = 紙のレベル(これまでどおり)", simulate(false));
if (C.boxLevelFor) report("マスごとのご褒美 = boxLevelFor(最初 +1・締め −1)", simulate(true));
