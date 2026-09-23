// 見守り(おかえり・週のたより・はなまる)のテスト。実行: node tests/watch.test.js
// (日本時間で確かめるなら: TZ=Asia/Tokyo node tests/watch.test.js)
"use strict";
var path = require("path");
var W = require(path.join(__dirname, "..", "watch.js"));
var Rec = require(path.join(__dirname, "..", "records.js"));

var failures = 0;
function check(ok, msg) {
  console.log((ok ? "  OK  " : "  NG  ") + msg);
  if (!ok) failures++;
}
// 端末のローカル時刻で日時を作る(月は 1〜12)
function at(y, m, d, h, min) { return new Date(y, m - 1, d, h, min || 0); }
function iso(y, m, d, h, min) { return at(y, m, d, h, min).toISOString(); }
// くり返し同じ並びを返す乱数(テスト用)
function seeded(seed) {
  var x = seed >>> 0 || 1;
  return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}
// 綴じ帳にマスを埋めていく(putSheet と同じ道を通す)
function fillBoxes(b, rec, marks) {
  var done = rec.steps.map(function () { return false; });
  marks.forEach(function (m) {
    done = done.slice();
    done[m[0]] = true;
    var r = {};
    for (var k in rec) r[k] = rec[k];
    r.done = done;
    Rec.putSheet(b, r, m[1]);
  });
  return Rec.findSheet(b, rec.id);
}
function task(id, name, n, extra) {
  var r = { id: id, kind: "task", task: name, category: "souji", difficulty: 42, steps: [], createdAt: null };
  for (var i = 0; i < n; i++) r.steps.push("手順" + (i + 1));
  for (var k in extra || {}) r[k] = extra[k];
  return r;
}
function gymRec(id, createdAt) {
  return { id: id, kind: "gym", task: "ジム", category: "undou", difficulty: 55, mainCount: 4, light: false, dayType: "weekday",
    steps: ["1", "2", "3", "着いた", "a", "b", "c"], createdAt: createdAt };
}

// ── 1. 週の区切り(月曜の朝4時) ─────────────────────
(function () {
  check(W.weekStartKey(at(2026, 9, 28, 3, 59)) === "2026-09-21", "月曜 3:59 はまだ前の週");
  check(W.weekStartKey(at(2026, 9, 28, 4, 0)) === "2026-09-28", "月曜 4:00 から新しい週");
  check(W.weekStartKey(at(2026, 9, 27, 23, 0)) === "2026-09-21", "日曜の夜はその週");
  check(W.weekStartKey(at(2026, 10, 1, 12, 0)) === "2026-09-28", "月をまたぐ週(10月1日は 9月28日の週)");
  check(W.weekStartKey(at(2027, 1, 1, 2, 0)) === "2026-12-28", "年をまたぐ週");
  check(W.weekLabel("2026-09-21") === "9月21日〜27日" && W.weekLabel("2026-09-28") === "9月28日〜10月4日", "週の見出し");
})();

// ── 2. おかえり ─────────────────────────────────
(function () {
  var b = Rec.emptyBinder();
  check(!W.welcomeDue(b, at(2026, 9, 30, 12)), "一度もマスを埋めていなければ出さない(初めて使う)");
  b.lastFilledAt = iso(2026, 9, 21, 23, 0);   // 月曜の夜
  check(!W.welcomeDue(b, at(2026, 9, 23, 20)), "2日では出ない");
  check(!W.welcomeDue(b, at(2026, 9, 24, 3, 59)), "木曜 3:59 はまだ水曜(2日)なので出ない");
  check(W.welcomeDue(b, at(2026, 9, 24, 4, 0)), "木曜 4:00 で3日。出る");
  check(W.welcomeDue(b, at(2026, 10, 20, 12)), "もっと空いても出る");
  b.welcome.shownFor = b.lastFilledAt;
  check(!W.welcomeDue(b, at(2026, 9, 25, 12)), "同じ間あきには1回だけ(閉じた後に開き直しても出ない)");
  b.lastFilledAt = iso(2026, 9, 25, 12, 0);
  check(!W.welcomeDue(b, at(2026, 9, 26, 12)), "また埋めたら、次の間あきまでは出ない");
  check(W.welcomeDue(b, at(2026, 9, 28, 12)), "次の3日の間あきでは、また出る");
  check(W.bumpLevel(1) === 2 && W.bumpLevel(3) === 4 && W.bumpLevel(6) === 6, "おかえりのおまけ: ご褒美を1段上げる(6が上限)");
  W.WELCOME_WORDS.forEach(function (w) {
    check(w.indexOf("おかえり") === 0 && !/\d+日|久しぶり|空いた|サボ|ぶり/.test(w), "おかえりの文に日数や「久しぶり」が無い: " + w);
  });
})();

// ── 3. おかえりのデータ(綴じ帳の lastFilledAt / welcome) ─────
(function () {
  var b = Rec.emptyBinder();
  var r = task("t1", "部屋の掃除", 3, { createdAt: iso(2026, 9, 21, 9) });
  fillBoxes(b, r, [[0, iso(2026, 9, 21, 10)]]);
  check(b.lastFilledAt === iso(2026, 9, 21, 10), "マスを埋めると lastFilledAt が入る");
  var s = Rec.findSheet(b, "t1");
  var moodOnly = {};
  for (var k in s) moodOnly[k] = s[k];
  moodOnly.moodBefore = 2;
  Rec.putSheet(b, moodOnly, iso(2026, 9, 22, 10));
  check(b.lastFilledAt === iso(2026, 9, 21, 10), "気分や一言を変えただけでは進まない");
  var off = {};
  for (k in s) off[k] = s[k];
  off.done = [false, false, false];
  Rec.putSheet(b, off, iso(2026, 9, 23, 10));
  check(b.lastFilledAt === iso(2026, 9, 21, 10), "マスを外しても進まない(綴じ帳から外れても残る)");
  var g = gymRec("g1", iso(2026, 9, 24, 18));
  fillBoxes(b, g, [[5, iso(2026, 9, 24, 19)]]);
  check(b.lastFilledAt === iso(2026, 9, 24, 19), "ジムの紙・おまけのマスでも進む");
  b.welcome = { shownFor: b.lastFilledAt, bonusPending: true, bonusFor: { id: "g1", box: 5 } };
  var round = Rec.checkBinder(JSON.parse(JSON.stringify(b)));
  check(round.lastFilledAt === b.lastFilledAt && round.welcome.bonusPending === true &&
    round.welcome.shownFor === b.lastFilledAt && round.welcome.bonusFor.box === 5, "保存して読み直しても残る");
  var broken = Rec.checkBinder({ sheets: [], lastFilledAt: "きのう", welcome: { shownFor: 5, bonusPending: "yes", bonusFor: { id: "", box: 2 } } });
  check(broken.lastFilledAt === null && broken.welcome.shownFor === null && broken.welcome.bonusPending === false &&
    broken.welcome.bonusFor === null, "形がおかしい値は使わない");
})();

// ── 4. 週のたより: 届く・届かない ─────────────────────
(function () {
  var b = Rec.emptyBinder();
  fillBoxes(b, task("a", "部屋の掃除", 3, { createdAt: iso(2026, 9, 22, 9) }),
    [[0, iso(2026, 9, 22, 10)], [1, iso(2026, 9, 22, 10, 5)], [2, iso(2026, 9, 22, 10, 9)]]);
  var data = W.emptyLetters();
  check(!W.makeLetters(b, data, at(2026, 9, 27, 22)).length, "週の途中では届かない");
  check(!W.makeLetters(b, data, at(2026, 9, 28, 3, 59)).length, "月曜 3:59 ではまだ届かない");
  var made = W.makeLetters(b, data, at(2026, 9, 28, 4, 0), { rng: seeded(1) });
  check(made.length === 1 && made[0].weekStart === "2026-09-21" && made[0].readAt === null, "月曜 4:00 をまたいで開くと、先週の分が届く");
  check(W.unreadLetter(data) === made[0], "届いたたよりが上に出る");
  check(!W.makeLetters(b, data, at(2026, 9, 28, 12)).length, "同じ週の分は二度作らない");
  // 1マスも埋めていない週の分は作らない
  var quiet = Rec.emptyBinder();
  fillBoxes(quiet, task("q", "書類の整理", 2, { createdAt: iso(2026, 9, 14, 9) }), [[0, iso(2026, 9, 14, 10)]]);
  var d2 = W.emptyLetters();
  var m2 = W.makeLetters(quiet, d2, at(2026, 9, 28, 12));
  check(m2.length === 1 && m2[0].weekStart === "2026-09-14", "埋めた週の分だけ(何もしなかった先週の分は無い)");
  var empty = W.emptyLetters();
  check(!W.makeLetters(Rec.emptyBinder(), empty, at(2026, 9, 28, 12)).length, "記録が無ければ何も届かない");
})();

// ── 5. 何週か開かなかったとき ───────────────────────
(function () {
  var b = Rec.emptyBinder();
  fillBoxes(b, task("w1", "部屋の掃除", 2, { createdAt: iso(2026, 8, 31, 9) }), [[0, iso(2026, 8, 31, 10)]]);
  fillBoxes(b, task("w3", "書類の整理", 2, { createdAt: iso(2026, 9, 16, 9) }), [[0, iso(2026, 9, 16, 10)], [1, iso(2026, 9, 17, 10)]]);
  var data = W.emptyLetters();
  var made = W.makeLetters(b, data, at(2026, 10, 7, 12), { welcome: true, rng: seeded(2) });
  check(made.length === 2 && made[0].weekStart === "2026-08-31" && made[1].weekStart === "2026-09-14",
    "活動のあった週の分がすべて保存される(何もしなかった週の分は無い)");
  check(W.unreadLetter(data).weekStart === "2026-09-14", "上に出るのは一番新しい1通だけ");
  check(made[1].lines[0].indexOf("おかえり。") === 0 && made[0].lines[0].indexOf("おかえり") === -1,
    "おかえりと重なったら、一番新しい1通の書き出しが「おかえり。」になる");
  check(made[1].lines[0].indexOf("先週") === -1 && made[1].lines[0].indexOf("9月14日からの週") !== -1,
    "先週より前の週は、日付で呼ぶ");
  // 一番新しいたよりより前の週に、あとから記録が増えても作らない
  fillBoxes(b, task("late", "昔の片付け", 1, { createdAt: iso(2026, 9, 8, 9) }), [[0, iso(2026, 9, 8, 10)]]);
  check(!W.makeLetters(b, data, at(2026, 10, 8, 12)).length, "もう届いた週より前の分は、あとから作らない");
})();

// ── 6. 中身: データがある行だけ ─────────────────────
(function () {
  var b = Rec.emptyBinder();
  // 前の週の分(累計に入る)
  fillBoxes(b, task("old", "洗濯", 2, { createdAt: iso(2026, 9, 15, 9) }), [[0, iso(2026, 9, 15, 10)], [1, iso(2026, 9, 15, 11)]]);
  // 先週: 掃除を仕上げた(気分が上がった・一言あり)、書類は書きかけ、ジムに2日着いた(1日はおまけも)
  var clean = task("c", "部屋の掃除", 3, { createdAt: iso(2026, 9, 21, 9), moodBefore: 2, moodAfter: 4, note: "思ったより早く終わった" });
  fillBoxes(b, clean, [[0, iso(2026, 9, 21, 10)], [1, iso(2026, 9, 21, 10, 5)], [2, iso(2026, 9, 21, 10, 9)]]);
  fillBoxes(b, task("p", "書類の整理", 4, { createdAt: iso(2026, 9, 23, 9) }), [[0, iso(2026, 9, 23, 10)]]);
  var g1 = gymRec("g1", iso(2026, 9, 22, 18));
  fillBoxes(b, g1, [[3, iso(2026, 9, 22, 19)]]);
  var s = Rec.findSheet(b, "g1");
  var all = {};
  for (var k in s) all[k] = s[k];
  all.done = [true, true, true, true, true, false, false];
  Rec.putSheet(b, all, iso(2026, 9, 22, 20));
  var t2 = iso(2026, 9, 25, 19);
  fillBoxes(b, gymRec("g2", iso(2026, 9, 25, 18)), [[0, t2], [1, t2], [2, t2], [3, t2]]);   // 「着いた」で本体がそろう
  // 今週の分(先週のたよりには入らない)
  fillBoxes(b, task("n", "買い物", 2, { createdAt: iso(2026, 9, 28, 9) }), [[0, iso(2026, 9, 28, 10)]]);

  var a = W.weekActivity(b.sheets, "2026-09-21");
  check(a.boxes === 3 + 1 + 5 + 4 && a.bonus === 1, "先週埋めたマスの数(おまけも数える): " + a.boxes + "(おまけ " + a.bonus + ")");
  check(a.finished === 1 && a.touched === 2 && a.open === 1, "仕上がった紙 1枚・手をつけたこと 2つ(書きかけ 1つ)");
  check(a.tasks.join("/") === "部屋の掃除/書類の整理", "やったことの一覧(ジムは別の行)");
  check(a.gymDays === 2, "ジムに着いた日 2日");
  check(a.moodUps.length === 1 && a.moodUps[0] === "「部屋の掃除」", "気分が上がった記録");
  check(a.notes.length === 1, "一言");
  check(a.total === 2 + 13, "累計はその週の終わりまで(今週の分は入らない): " + a.total);

  var lines = W.letterLines(a, { week: "先週", latest: true, rng: seeded(3) });
  var text = lines.join("\n");
  check(/13マス/.test(text) && /おまけのマス/.test(text), "マスの数とおまけの数が入る");
  check(lines.indexOf("・部屋の掃除") !== -1 && lines.indexOf("・書類の整理") !== -1, "やったことが並ぶ");
  check(/ジムに着いた|ジムに着いた日/.test(text) && /2日/.test(text), "ジムに着いた日の数が入る");
  check(/「部屋の掃除」のあと/.test(text), "気分が上がったことを1つ取り上げる");
  check(text.indexOf("「思ったより早く終わった」") !== -1, "一言を引用する");
  check(/15マス/.test(text), "これまでの累計マスが入る");

  // 少ない週: 掃除を1マスだけ
  var small = Rec.emptyBinder();
  fillBoxes(small, task("x", "部屋の掃除", 5, { createdAt: iso(2026, 9, 22, 9) }), [[0, iso(2026, 9, 22, 10)]]);
  var sa = W.weekActivity(small.sheets, "2026-09-21");
  var sl = W.letterLines(sa, { week: "先週", latest: true, rng: seeded(4) }).join("\n");
  check(!/ジム/.test(sl) && !/おまけ/.test(sl) && !/気分/.test(sl) && !/書いてた|残してた/.test(sl) && !/仕上がった|書き上げた/.test(sl),
    "データが無い行(ジム・おまけ・気分・一言・仕上がり)は出さない");
  check(/手をつけ/.test(sl), "書きかけも「手をつけたこと」として前向きに数える");

  // やったことは重複を除いて最大5件
  var many = Rec.emptyBinder();
  ["片付け", "洗濯", "片付け", "料理", "買い物", "書類の整理", "部屋の掃除", "植物の水やり"].forEach(function (n, i) {
    fillBoxes(many, task("m" + i, n, 1, { createdAt: iso(2026, 9, 22, 9) }), [[0, iso(2026, 9, 22, 10, i)]]);
  });
  var ma = W.weekActivity(many.sheets, "2026-09-21");
  check(ma.tasks.length === 5 && ma.tasks.join() === "片付け,洗濯,料理,買い物,書類の整理", "やったことは重複を除いて最大5件");
})();

// ── 7. 口調: 比較・不足・日数の言葉を使わない ─────────────
(function () {
  var NG = /久しぶり|空いた|サボ|未完了|失敗|ぶり|先週より|前の週より|少な|足りな|届かな|できなかった|行かなかった|やらなかった|休んだ|目標/;
  var bad = [];
  var acts = [
    { boxes: 1, bonus: 0, touched: 1, finished: 0, open: 1, tasks: ["部屋の掃除"], gymDays: 0, moodUps: [], notes: [], total: 1 },
    { boxes: 30, bonus: 4, touched: 5, finished: 2, open: 3, tasks: ["a", "b"], gymDays: 3, moodUps: ["ジム"], notes: ["先に水を用意する"], total: 400 },
    { boxes: 4, bonus: 0, touched: 0, finished: 0, open: 0, tasks: [], gymDays: 1, moodUps: [], notes: [], total: 20 }
  ];
  for (var seed = 1; seed <= 300; seed++) {
    acts.forEach(function (a, i) {
      var lines = W.letterLines(a, { week: i ? "先週" : "9月7日からの週", latest: !!i, welcome: seed % 2 === 0, rng: seeded(seed * 7 + i) });
      lines.forEach(function (l) { if (NG.test(l)) bad.push(l); });
    });
  }
  check(!bad.length, "たよりに比較・不足・日数の間あきの言葉が出ない" + (bad.length ? ": " + bad[0] : ""));
  Object.keys(W.LINES).forEach(function (k) {
    W.LINES[k].forEach(function (l) { if (NG.test(l)) bad.push(l); });
  });
  check(!bad.length, "文面の候補すべてに、使わない言葉が無い");
})();

// ── 8. 保存: 文面は作ったときのまま ─────────────────────
(function () {
  var b = Rec.emptyBinder();
  fillBoxes(b, task("a", "部屋の掃除", 2, { createdAt: iso(2026, 9, 22, 9) }), [[0, iso(2026, 9, 22, 10)]]);
  var data = W.emptyLetters();
  W.makeLetters(b, data, at(2026, 9, 28, 12), { rng: seeded(5) });
  var saved = JSON.stringify(data);
  var back = W.checkLetters(JSON.parse(saved));
  check(JSON.stringify(back) === saved, "保存して読み直しても、文面も含めて同じ");
  // 記録が変わっても、作ったたよりの文面は変わらない
  var s = Rec.findSheet(b, "a");
  var more = {};
  for (var k in s) more[k] = s[k];
  more.done = [true, true];
  Rec.putSheet(b, more, iso(2026, 9, 28, 13));
  W.makeLetters(b, back, at(2026, 9, 29, 12), { rng: seeded(6) });
  check(JSON.stringify(back.letters[0].lines) === JSON.stringify(data.letters[0].lines), "あとで記録が増えても、読み返す文面は変わらない");
  back.letters[0].readAt = iso(2026, 9, 28, 14);
  check(W.unreadLetter(W.checkLetters(JSON.parse(JSON.stringify(back)))) === null, "開いた(しまった)たよりは、もう上に出ない");
  var messy = W.checkLetters({ letters: [
    { weekStart: "2026-09-21", lines: ["a"] }, { weekStart: "2026-09-21", lines: ["b"] },
    { weekStart: "2026-09-23", lines: ["水曜は週の始まりではない"] }, { weekStart: "2026-09-14", lines: [] },
    { weekStart: "2026-09-07", lines: ["古い", 5, null] }, "壊れた"
  ] });
  check(messy.letters.length === 2 && messy.letters[0].weekStart === "2026-09-07" && messy.letters[1].lines[0] === "a" &&
    messy.letters[0].lines.length === 1, "形がおかしいたよりは飛ばし、古い週から並べる");
  check(W.checkLetters("壊れた").letters.length === 0 && W.checkLetters(null).version === 1, "壊れていれば空から始める");
})();

// ── 9. バックアップにたよりが入る ─────────────────────
(function () {
  var data = { version: 1, letters: [{ weekStart: "2026-09-21", createdAt: iso(2026, 9, 28, 12), readAt: null, lines: ["先週のたよりだよ。", "3マス、ちゃんと埋まってたよ。"] }] };
  var b = Rec.emptyBinder();
  fillBoxes(b, task("a", "部屋の掃除", 2, { createdAt: iso(2026, 9, 22, 9), sticky: "返事待ち" }), [[0, iso(2026, 9, 22, 10)]]);
  var entries = {};
  entries[Rec.BINDER_KEY] = JSON.stringify(b);
  entries[W.KEY] = JSON.stringify(data);
  var backup = Rec.buildBackup(entries, iso(2026, 9, 29, 12));
  check(W.KEY.indexOf(Rec.PREFIX) === 0 && !!backup.data[W.KEY], "たより(genkouyoushi-letters-v1)が書き出しに入る");
  var p = Rec.parseBackup(JSON.stringify(backup));
  check(p.ok && JSON.stringify(W.checkLetters(JSON.parse(p.others[W.KEY]))) === JSON.stringify(W.checkLetters(data)),
    "読み込むと、たよりが文面ごと戻る");
  check(p.binder.sheets[0].sticky === "返事待ち" && p.binder.lastFilledAt === b.lastFilledAt, "付箋と最後に埋めた時刻も戻る");
})();

// ── 10. はなまる ───────────────────────────────
(function () {
  check(W.hanamaruTier(null) === 1 && W.hanamaruTier(20) === 1 && W.hanamaruTier(33) === 1, "やさしい日は1段目");
  check(W.hanamaruTier(34) === 2 && W.hanamaruTier(55) === 2, "ふつうの日は2段目(ジムのふつう: 55)");
  check(W.hanamaruTier(58) === 3 && W.hanamaruTier(100) === 3, "難しかった日は3段目");
  var p1 = W.hanamaruPaths(1), p2 = W.hanamaruPaths(2), p3 = W.hanamaruPaths(3);
  check(p1.length === 1 && p2.length === 1 && p3.length > 2, "段が上がるほど線が増える(花びらの重なり・きらきら)");
  check(p1[0].len < p2[0].len, "2段目は花びらが多い");
  check([p1, p2, p3].every(function (ps) {
    return ps.every(function (p) { return /^M[\d. -]+(L[\d. -]+)+$/.test(p.d) && p.len > 0; });
  }), "線の形が正しい(100×100 の中の座標)");
  var nums = p3.map(function (p) { return p.d; }).join(" ").match(/-?\d+(\.\d+)?/g).map(Number);
  check(nums.every(function (n) { return n >= 0 && n <= 100; }), "はなまるが枠からはみ出さない");
  check(/^M/.test(W.redCirclePath().d), "書きかけの赤丸の線");
})();

if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
