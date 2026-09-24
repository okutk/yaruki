// 質問で分類を決める(アキネーター形式)のテスト。実行: node tests/guess.test.js
"use strict";
var path = require("path");
var G = require(path.join(__dirname, "..", "guess.js"));
var C = require(path.join(__dirname, "..", "classify.js"));

var failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.log("  NG  " + msg); }
}
var IDS = C.CATEGORIES.map(function (c) { return c.id; });

// 決まった順に 0〜1 を返す(毎回同じ結果になるように)
function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// そのカテゴリらしい答え方(はい寄りは「はい」、いいえ寄りは「いいえ」、どちらともは「どちらでもない」)
function typical(truth) {
  return function (qid) {
    var p = G.pOf(truth, qid);
    return p >= 0.7 ? G.YES : p <= 0.3 ? G.NO : G.MAYBE;
  };
}
// 実際の人に近い答え方: どちらともの質問は人によって違い、ときどき迷う(15%)・間違える(7.5%)
function realistic(truth, rng) {
  return function (qid) {
    var p = G.pOf(truth, qid);
    var a = p >= 0.7 ? G.YES : p <= 0.3 ? G.NO : (rng() < 0.5 ? G.MAYBE : rng() < 0.5 ? G.YES : G.NO);
    var x = rng();
    if (x < 0.15) return G.MAYBE;
    if (x < 0.225) return a === G.YES ? G.NO : a === G.NO ? G.YES : a;
    return a;
  };
}
// 1回分を最後まで進める。「もしかして」が外れたら「ちがう」と答える
function play(truth, answerer, task) {
  var s = G.start(task || "テスト", IDS), trace = [];
  for (var i = 0; i < 40; i++) {
    var n = G.next(s);
    if (n.type === "question") {
      check(G.questionCount(s) < G.MAX_QUESTIONS, "質問は多くても " + G.MAX_QUESTIONS + " 問");
      trace.push(n.question.id);
      G.answer(s, n.question.id, answerer(n.question.id));
      continue;
    }
    if (n.type === "guess") {
      check(G.guessCount(s) < G.MAX_GUESSES, "「もしかして」は多くても " + G.MAX_GUESSES + " 回");
      if (n.id === truth) return { result: "guess", guesses: G.guessCount(s) + 1, questions: G.questionCount(s), trace: trace };
      G.reject(s, n.id);
      continue;
    }
    var inList = n.candidates.some(function (c) { return c.id === truth; });
    return { result: n.type + (inList ? "+list" : ""), questions: G.questionCount(s), trace: trace };
  }
  return { result: "loop", questions: G.questionCount(s), trace: trace };
}

// ── 1. 表(PROFILES)と質問 ─────────────────────────
var before = failures;
IDS.forEach(function (id) { check(!!G.PROFILES[id], "PROFILES に「" + id + "」の行がある(カテゴリを足したら guess.js にも足す)"); });
Object.keys(G.PROFILES).forEach(function (id) { check(IDS.indexOf(id) !== -1, "PROFILES の「" + id + "」は classify.js のカテゴリ"); });
var seenQ = {};
G.QUESTIONS.forEach(function (q) {
  check(!seenQ[q.id], "質問 id の重複: " + q.id);
  seenQ[q.id] = true;
  check(/？(（[^）]*）)?$/.test(q.text), "質問は「？」で終わる(後ろに（例）を付けてもよい): " + q.text);
  // 画面は「、」の後ろと「（」の前でだけ折り返すので、ひと続きの部分は短く
  q.text.replace(/、/g, "、\n").replace(/（/g, "\n（").split("\n").forEach(function (part) {
    check(part.length <= 15, "質問のひと続きの部分は15文字まで(スマホで途中で切れないように): " + part);
  });
});
// どの2つのカテゴリも、答え方がどこかで違う(ほぼ「はい」とどちらとも、くらいの差がある質問が1つはある)
IDS.forEach(function (a, i) {
  IDS.slice(i + 1).forEach(function (b) {
    var gap = G.QUESTIONS.some(function (q) { return Math.abs(G.pOf(a, q.id) - G.pOf(b, q.id)) >= 0.4; });
    check(gap, a + " と " + b + " を区別できる質問がある");
  });
});
[0.06, 0.08, 0.26, 0.5, 0.72, 0.92].forEach(function (p) {
  var sum = G.likelihood(p, G.YES) + G.likelihood(p, G.NO) + G.likelihood(p, G.MAYBE);
  check(Math.abs(sum - 1) < 1e-9, "答えの起こりやすさの合計は 1 (p=" + p + ")");
});
console.log("表と質問: カテゴリ " + IDS.length + "・質問 " + G.QUESTIONS.length + (failures === before ? "  OK" : "  NG あり"));

// ── 2. そのカテゴリらしく答えれば、1回目の「もしかして」で当たる ──────────
before = failures;
var qs = [];
IDS.forEach(function (id) {
  var r = play(id, typical(id));
  check(r.result === "guess" && r.guesses === 1, id + ": らしく答えたら1回目で当たる → " + JSON.stringify(r));
  qs.push(r.questions);
});
var avg = qs.reduce(function (a, b) { return a + b; }, 0) / qs.length;
check(avg <= 5.5, "らしく答えたときの質問数の平均は5.5問まで: " + avg.toFixed(2));
console.log("らしい答え方: 平均 " + avg.toFixed(2) + " 問・最大 " + Math.max.apply(null, qs) + " 問" + (failures === before ? "  OK" : "  NG あり"));

// ── 3. 迷ったり間違えたりしても、たいてい決まる(当たる・候補に入る) ───────────
before = failures;
var rng = makeRng(20260924), N = 40, got = { first: 0, second: 0, list: 0, miss: 0 }, total = 0, qsum = 0;
IDS.forEach(function (id) {
  for (var i = 0; i < N; i++) {
    var r = play(id, realistic(id, rng));
    total++; qsum += r.questions;
    check(r.result !== "loop", id + ": 終わらない");
    if (r.result === "guess") got[r.guesses === 1 ? "first" : "second"]++;
    else if (/\+list$/.test(r.result)) got.list++;
    else got.miss++;
  }
});
function pct(n) { return Math.round(n * 1000 / total) / 10 + "%"; }
check((got.first + got.second + got.list) / total >= 0.75, "迷い・間違いがあっても 75% 以上は当たるか候補に入る");
console.log("迷い・間違いあり(" + total + "回): 1回目で当たる " + pct(got.first) + " / 2回目 " + pct(got.second) +
  " / 候補に入る " + pct(got.list) + " / 入らない " + pct(got.miss) + " / 平均 " + (qsum / total).toFixed(2) + " 問" +
  (failures === before ? "  OK" : "  NG あり"));

// ── 4. 進め方の決まりごと ─────────────────────────
before = failures;
// 全部「どちらでもない」でも、終わる(候補を並べる)
var s = G.start("よくわからないこと", IDS), n, guard = 0;
check(G.next(s).question.id === G.FIRST_QUESTION, "最初の質問は " + G.FIRST_QUESTION);
while ((n = G.next(s)).type === "question" && guard++ < 50) G.answer(s, n.question.id, G.MAYBE);
check(n.type === "choose" && n.candidates.length === 4, "全部「どちらでもない」なら、" + G.MAX_QUESTIONS + " 問で候補を4つ並べる: " + n.type);
check(G.questionCount(s) === G.MAX_QUESTIONS, "全部「どちらでもない」のときの質問数は " + G.MAX_QUESTIONS);

// 同じ答えなら、同じ質問が同じ順で出る
var a1 = play("souji", typical("souji")).trace.join(","), a2 = play("souji", typical("souji")).trace.join(",");
check(a1 === a2, "同じ答えなら同じ質問の順: " + a1 + " / " + a2);

// ひとつ戻る: 答えを取り消すと、同じ質問に戻る
s = G.start("テスト", IDS);
var q1 = G.next(s).question.id;
G.answer(s, q1, G.YES);
var q2 = G.next(s).question.id;
check(q2 !== q1, "答えた質問は二度出ない");
check(G.undo(s) && G.next(s).question.id === q1 && G.questionCount(s) === 0, "ひとつ戻ると、前の質問に戻る");
check(!G.undo(s), "何も答えていなければ戻れない");

// 「ちがう」と言ったカテゴリは、もう出さない。そのあと1問は聞いてから次を当てにいく
s = G.start("テスト", IDS);
var ans = typical("sentaku");
while ((n = G.next(s)).type === "question") G.answer(s, n.question.id, ans(n.question.id));
check(n.type === "guess" && n.id === "sentaku", "洗濯らしく答えると洗濯を当てにいく: " + JSON.stringify(n));
G.reject(s, "sentaku");
check(G.candidates(s, 30).every(function (c) { return c.id !== "sentaku"; }), "外したカテゴリは候補に入らない");
check(G.next(s).type === "question", "外したあとは、まず1問聞く");
G.undo(s);
check(G.next(s).type === "guess", "「ちがう」も、ひとつ戻るで取り消せる");

// 文からわかる質問は聞かない(「〜に行く」なら外に出るか・家の中か、「スマホの〜」ならスマホを使うか)
function askedQuestions(task) {
  var t = G.start(task, IDS), out = [], m;
  while ((m = G.next(t)).type === "question") { out.push(m.question.id); G.answer(t, m.question.id, G.MAYBE); }
  return out;
}
var goOut = askedQuestions("忘れ物を取りに行く");
check(goOut.indexOf("out") === -1 && goOut.indexOf("home") === -1, "「〜に行く」なら、外に出るか・家の中かは聞かない: " + goOut.join(","));
var phone = askedQuestions("スマホの設定");
check(phone.indexOf("screen") === -1, "「スマホの〜」なら、スマホを使うかは聞かない: " + phone.join(","));

// 確からしさは合計 1、大きい順
var post = G.posterior(G.answer(G.start("テスト", IDS), "food", G.YES));
check(Math.abs(post.reduce(function (a, x) { return a + x.p; }, 0) - 1) < 1e-9, "確からしさの合計は 1");
check(post[0].id === "ryouri", "食べ物に「はい」なら、料理が一番上: " + post[0].id);
check(post.every(function (x, i) { return i === 0 || post[i - 1].p >= x.p; }), "確からしさは大きい順");
try { G.answer(G.start("テスト", IDS), "food", "たぶん"); check(false, "答えは yes / no / maybe だけ"); } catch (e) {}
console.log("進め方: " + (failures === before ? "終わる・同じ順・戻る・外す・文からわかる質問を飛ばす OK" : "NG あり"));

if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
