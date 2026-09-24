// 書き上がる原稿用紙・金のマスのテスト。実行: node tests/manuscript.test.js
"use strict";
var path = require("path");
var M = require(path.join(__dirname, "..", "manuscript.js"));

var failures = 0;
function check(ok, msg) {
  console.log((ok ? "  OK  " : "  NG  ") + msg);
  if (!ok) failures++;
}

var T1 = "2026-09-24T10:00:00.000Z";
function rep(ch, n) { return new Array(n + 1).join(ch); }
function copy(o) { return JSON.parse(JSON.stringify(o)); }
// 紙の1行(縦の1列)を文字列にする(書いていないマス・空白は「・」)
function line(g, r) { return g.grid[r].map(function (c) { return c ? c.ch : "・"; }).join("").replace(/・+$/, ""); }

// テスト用の作品棚(文字は何でもよい)
function lib(list) { return M.library(list); }
var small = lib([
  { id: "h1", type: "haiku", author: "作者A", title: "句集", source: "句集", text: "あいうえおかきくけこさしすせそたち" },   // 17字
  { id: "h2", type: "haiku", author: "作者B", title: "句集", source: "句集", text: "なにぬねの" },                           // 5字
  { id: "p1", type: "poem", author: "作者C", title: "題", source: "詩集", text: "一二三\n四五六七\n\n八九十" }              // 10字・連の区切り1つ
]);

// ── 1. 作品を行に分ける ─────────────────────────
(function () {
  var r = M.rowsOfText("haiku", "古池や　蛙飛こむ 水のおと");
  check(r.length === 1 && r[0].join("") === "古池や蛙飛こむ水のおと", "俳句は1行。句の中の空白は詰める");
  r = M.rowsOfText("haiku", rep("あ", 25));
  check(r.length === 2 && r[0].length === 20 && r[1].length === 5, "20字を超えたら次の行へ続ける");
  r = M.rowsOfText("poem", "一行目\n二行目\n\n\n次の連\n");
  check(r.length === 4 && r[2].length === 0 && r[3].join("") === "次の連", "詩の改行は次の行へ、連の区切りは空け行1つ");
  r = M.rowsOfText("poem", "\nあ　い\n");
  check(r.length === 1 && r[0].length === 3 && r[0][1] === null, "詩の行の中の空白は空白のマス(先頭と末尾の空け行は取る)");
  check(M.lengthOf("h1", { lib: small }) === 17 && M.lengthOf("p1", { lib: small }) === 10, "字数は空白を数えない");
})();

// ── 2. 1マス = 1文字。空白はマスを使わない ───────────
(function () {
  var o = { lib: small, now: T1 };
  var ms = M.create(0, { lib: small, seed: 7, now: T1 });
  check(ms.written === 0 && ms.retroDone === true && ms.page.no === 1, "累計0マスで始めると何も書いていない(導入のお知らせも無し)");
  var first = M.current(ms, o).work;
  check(first && first.type === "haiku", "最初は俳句から");
  var ev = M.sync(ms, 1, o);
  var g = M.pageGrid(ms, o);
  check(ev.chars === 1 && ms.written === 1 && g.grid[0][0] && g.grid[0][0].ch === Array.from(first.text)[0], "1マス埋めると1文字書かれる(右の行の一番上から)");
  check(g.cursor && g.cursor.r === 0 && g.cursor.c === 1, "次に書くマスはそのすぐ下");
  var len = M.lengthOf(first.id, o);
  ev = M.sync(ms, len, o);
  check(ev.works.length === 1 && ev.works[0].id === first.id && ms.finishedWorks.length === 1, "作品の最後の文字で、書き上がり");
  g = M.pageGrid(ms, o);
  check(line(g, 0) === first.text && line(g, 1) === "" && g.cursor.r === 2 && g.cursor.c === 0,
    "次の作品は1行あけて、新しい行の頭から(行末の余りと空け行はマスを使わない)");
  var second = M.current(ms, o).work;
  check(second && second.id !== first.id, "次の作品がもう置いてある");
  M.sync(ms, len + 1, o);
  g = M.pageGrid(ms, o);
  check(g.grid[2][0] && g.grid[2][0].ch === Array.from(second.text)[0], "次の1マスで、次の作品の1文字目");
})();

// ── 3. 外しても消えない・二重に進まない・綴じ帳から外したら続きから ──
(function () {
  var o = { lib: small, now: T1 };
  var ms = M.create(0, { lib: small, seed: 3, now: T1 });
  M.sync(ms, 5, o);
  M.sync(ms, 4, o);
  check(ms.written === 5 && ms.maxTotal === 5, "マスを外して累計が減っても、書いた文字はそのまま");
  M.sync(ms, 5, o);
  check(ms.written === 5, "外して付け直しても、二重には進まない");
  M.sync(ms, 6, o);
  check(ms.written === 6, "最大値を越えた分だけ進む");
  M.forget(ms, 3);
  check(ms.maxTotal === 3 && ms.written === 6, "綴じ帳から紙(3マス)を外すと、最大値だけ下がる(書いた文字は残る)");
  M.sync(ms, 4, o);
  check(ms.written === 7, "外したあと新しく埋めたマスで、また書き進む");
})();

// ── 4. 原稿用紙1枚(20行)が書き上がる ─────────────
(function () {
  // 20字の俳句: 1句が1行 + 空け行1行 → 1枚に10句(200字)
  var list = [];
  for (var i = 0; i < 12; i++) list.push({ id: "k" + i, type: "haiku", author: "作者", title: "句集", source: "句集", text: rep(String.fromCharCode(0x3042 + i), 20) });
  var L = lib(list), o = { lib: L, now: T1 };
  var ms = M.create(0, { lib: L, seed: 11, now: T1 });
  check(M.pageLeft(ms, o) === 200, "この紙はあと200マス(10句分)");
  var ev = M.sync(ms, 199, o);
  check(!ev.pages.length && ms.pages.length === 0 && M.pageLeft(ms, o) === 1, "199字ではまだ(あと1マス)");
  ev = M.sync(ms, 200, o);
  check(ev.pages.length === 1 && ms.pages.length === 1, "200字目で1枚書き上がる");
  var p = ms.pages[0];
  check(p.no === 1 && p.rows.length === 20 && p.rows[0].length === 20 && p.rows[1] === "" && p.workIds.length === 10 && p.quiet === false,
    "書き上げた紙の中身(20行・作品10)を残す");
  check(ms.page.no === 2 && ms.page.start === 200 && M.pageGrid(ms, o).cursor.r === 0, "次の紙は右の行の頭から");
  check(M.frozenGrid(ms, p).grid[18][0].ch === Array.from(list.filter(function (w) { return w.id === p.workIds[9]; })[0].text)[0],
    "書き上げた紙を後から描ける");

  // 紙の頭に空け行を置かない: 20行の詩で1枚が埋まると、次の作品は2枚目の1行目から
  var L2 = lib([
    { id: "tall", type: "poem", author: "作者", title: "長い詩", source: "詩集", text: rep("一\n", 20).trim() },
    { id: "next", type: "haiku", author: "作者", title: "句集", source: "句集", text: "つぎのく" }
  ]);
  var o2 = { lib: L2, now: T1 };
  var ms2 = M.create(0, { lib: L2, seed: 1, now: T1 });
  if (M.current(ms2, o2).work.id !== "tall") M.chooseNext(ms2, "tall", o2);
  var ev2 = M.sync(ms2, 20, o2);
  check(ev2.pages.length === 1 && ms2.page.no === 2, "20行の詩で1枚");
  var g2 = M.pageGrid(ms2, o2);
  check(g2.cursor.r === 0 && g2.cursor.c === 0, "次の作品は、空け行なしで2枚目の頭から");

  // 詩が紙をまたぐ: 途中の行から次の紙へ続く
  var L3 = lib([
    { id: "a", type: "haiku", author: "作者", title: "句集", source: "句集", text: rep("あ", 20) },
    { id: "b", type: "poem", author: "作者", title: "長い詩", source: "詩集", text: rep("二二\n", 30).trim() }
  ]);
  var o3 = { lib: L3, now: T1 };
  var ms3 = M.create(0, { lib: L3, seed: 5, now: T1 });
  if (M.current(ms3, o3).work.id !== "a") M.chooseNext(ms3, "a", o3);
  M.sync(ms3, 20, o3);   // 「あ」×20 → 空け行 → 詩が3行目から
  check(M.current(ms3, o3).work.id === "b", "続いて詩");
  var ev3 = M.sync(ms3, 20 + 18 * 2, o3);   // 詩の18行(3〜20行目)まで
  check(ev3.pages.length === 1 && ms3.page.items[0].id === "b" && ms3.page.items[0].from === 18, "詩の途中で1枚がいっぱい → 続きは次の紙へ");
  var g3 = M.pageGrid(ms3, o3);
  check(g3.cursor.r === 0 && g3.cursor.c === 0, "続きは次の紙の右の行の頭から");
  M.sync(ms3, 20 + 30 * 2, o3);
  check(ms3.finishedWorks.some(function (f) { return f.id === "b"; }), "紙をまたいだ詩も書き上がる");
})();

// ── 5. 並べ方・周 ───────────────────────────────
(function () {
  var list = [];
  for (var i = 0; i < 40; i++) list.push({ id: "h" + i, type: "haiku", author: "作者", title: "句集", source: "句集", text: "かきくけこ" + i });
  for (var j = 0; j < 10; j++) list.push({ id: "p" + j, type: "poem", author: "作者", title: "詩" + j, source: "詩集", text: "たちつてと\nなにぬねの" });
  var L = lib(list);
  var order = M.makeOrder(L, 42, 1);
  check(order.length === 50 && order.slice().sort().join() === L.haiku.concat(L.poems).sort().join(), "全部の作品が1回ずつ入る");
  check(order[0].charAt(0) === "h", "並びは俳句から始まる");
  var runs = [], n = 0, ok = true;
  order.forEach(function (id) {
    if (id.charAt(0) === "h") n++;
    else { runs.push(n); n = 0; }
  });
  runs.forEach(function (r) { if (r < 3 || r > 5) ok = false; });
  check(ok && runs.length === 10, "俳句3〜5句ごとに詩が1編(" + runs.join(",") + ")");
  check(M.makeOrder(L, 42, 1).join() === order.join(), "同じ種・同じ周なら同じ並び(読み直しても変わらない)");
  check(M.makeOrder(L, 42, 2).join() !== order.join(), "次の周は並びが変わる");

  var o = { lib: small, now: T1 };
  var ms = M.create(0, { lib: small, seed: 9, now: T1 });
  var o1 = ms.order.join();
  var saved = copy(ms);
  var back = M.check(saved, o);
  check(back.order.join() === o1 && M.current(back, o).work.id === M.current(ms, o).work.id, "保存して読み直しても並びと今の作品は変わらない");
  var total = 17 + 5 + 10;
  M.sync(ms, total - 1, o);
  check(ms.round === 1 && ms.finishedWorks.length === 2, "最後の作品を書いている間は1周目");
  M.sync(ms, total, o);
  check(ms.finishedWorks.length === 3 && ms.round === 2 && ms.used.length === 1 && M.current(ms, o).done === 0,
    "全部書き終えると2周目に入り、2周目の最初の作品が置かれる");
  check(ms.finishedWorks[2].id !== M.current(ms, o).work.id, "周の変わり目で同じ作品を続けない");
})();

// ── 6. 導入時(これまでの累計マス) ─────────────────
(function () {
  var list = [];
  for (var i = 0; i < 30; i++) list.push({ id: "k" + i, type: "haiku", author: "作者", title: "句集", source: "句集", text: rep("字", 20) });
  var L = lib(list), o = { lib: L, now: T1 };
  var ms = M.create(450, { lib: L, seed: 2, now: T1 });
  check(ms.written === 450 && ms.maxTotal === 450, "これまでの累計マスの分は、最初から書いてある");
  check(ms.pages.length === 2 && ms.pages.every(function (p) { return p.quiet && p.reward === null; }),
    "いっぱいになっていた紙は書き上げた紙として残す(大きいご褒美は付けない)");
  check(ms.retroDone === false && ms.retro.written === 450 && ms.retro.pages === 2 && ms.retro.works === 22,
    "初回のお知らせ用に、書けていた分を覚えておく");
  var back = M.check(copy(ms), o);
  check(back.retroDone === false, "お知らせを見せるまでは、読み直しても残る");
  back.retroDone = true;
  check(M.check(copy(back), o).retroDone === true, "見せたら、もう出さない");
  var ev = M.sync(ms, 451, o);
  check(ev.chars === 1 && ev.pages.length === 0, "その後は1マスずつ");
})();

// ── 7. 飛ばす・次に書く作品を選ぶ ────────────────────
(function () {
  var o = { lib: small, now: T1 };
  var ms = M.create(0, { lib: small, seed: 4, now: T1 });
  var cur = M.current(ms, o).work;
  M.sync(ms, 3, o);
  M.skip(ms, o);
  var g = M.pageGrid(ms, o);
  check(line(g, 0) === Array.from(cur.text).slice(0, 3).join("") && g.cursor.r === 2 && g.cursor.c === 0,
    "途中で飛ばすと、書いたところまでは紙に残り、次の作品は1行あけて始まる");
  check(!ms.finishedWorks.length && M.current(ms, o).work.id !== cur.id, "飛ばした作品は書き上がりに入らない");
  var next = M.current(ms, o).work;
  M.skip(ms, o);
  check(M.current(ms, o).work.id !== next.id && M.pageGrid(ms, o).cursor.r === 2, "1文字も書いていなければ、置かなかったことにして次へ");

  var ms2 = M.create(0, { lib: small, seed: 4, now: T1 });
  var head = M.current(ms2, o).work.id;
  var other = small.list.filter(function (w) { return w.id !== head; })[0].id;
  check(M.chooseNext(ms2, other, o) === "now" && M.current(ms2, o).work.id === other, "まだ書いていなければ、選んだ作品にすぐ入れ替わる");
  check(ms2.used.indexOf(head) === -1, "入れ替えた作品は、この周の残りに戻る");
  M.sync(ms2, 2, o);
  var third = small.list.filter(function (w) { return w.id !== head && w.id !== other; })[0].id;
  check(M.chooseNext(ms2, third, o) === "next" && M.current(ms2, o).work.id === other, "書いている途中なら、その次に書く");
  M.sync(ms2, M.lengthOf(other, o), o);
  check(M.current(ms2, o).work.id === third && ms2.nextWorkId === null, "いまの作品を書き終えると、選んだ作品");
  check(M.chooseNext(ms2, third, o) === "same" && M.chooseNext(ms2, "nai", o) === "invalid", "今の作品・無い作品は選べない");
  M.chooseNext(ms2, head, o);
  check(M.chooseNext(ms2, null, o) === "cleared" && ms2.nextWorkId === null, "おまかせに戻せる");
})();

// ── 8. 金のマス ─────────────────────────────────
(function () {
  var seq = [0.5, 0.01, 0.9, 0.029, 0.03];
  var k = 0;
  var gold = M.drawGold(5, function () { return seq[k++]; });
  check(gold.join() === "1,3" && M.GOLD_RATE === 0.03, "マス目を作るとき、約3%の確率で金を仕込む");
  check(M.checkGold([3, 1, 1, 9, -1, 2.5, "x"], 5).join() === "1,3", "保存された金のマスの番号をそろえる");

  var o = { lib: small, now: T1 };
  var ms = M.create(0, { lib: small, seed: 6, now: T1 });
  M.sync(ms, 2, o);
  M.sync(ms, 3, { lib: small, now: T1, gold: 1 });
  var g = M.pageGrid(ms, o);
  check(ms.goldChars.join() === "2" && g.grid[0][2].gold && !g.grid[0][1].gold, "金のマスで書いた文字は金色");
  M.sync(ms, 7, { lib: small, now: T1, gold: 2 });
  check(ms.goldChars.join() === "2,5,6", "まとめて埋めたとき(ジムに着いた)は、書いた文字の最後から金にする");
  M.sync(ms, 6, { lib: small, now: T1, gold: 1 });
  check(ms.goldChars.join() === "2,5,6", "進まなかったときは金にしない");
  var w = M.current(ms, o);
  var lines = M.workLines(ms, small.byId["h1"], 0);
  check(lines[0].length === 17, "作品の本文を1文字ずつ(カードに出す)");
})();

// ── 9. 保存データのそろえ方 ─────────────────────────
(function () {
  var o = { lib: small, now: T1 };
  check(M.check(null, o) === null && M.check("x", o) === null && M.check({ seed: "a" }, o) === null, "形が違えば null(作り直す)");
  var ms = M.create(0, { lib: small, seed: 8, now: T1 });
  M.sync(ms, 4, o);
  var raw = copy(ms);
  raw.page.items[0].id = "消えた作品";
  var fixed = M.check(raw, o);
  check(fixed && fixed.written === 4 && fixed.page.start === 4 && M.current(fixed, o).work, "書いている紙の作品が見つからなければ、次の文字から新しい紙にする");
  raw = copy(ms);
  raw.goldChars = [1, 99];
  raw.rewardOverride = "  温泉に行く \n ";
  raw.nextWorkId = "消えた作品";
  fixed = M.check(raw, o);
  check(fixed.goldChars.join() === "1" && fixed.rewardOverride === "温泉に行く" && fixed.nextWorkId === null, "まだ書いていない金の文字・無い作品は外す");
  var r2 = copy(ms);
  delete r2.pages;
  check(M.check(r2, o).pages.length === 0, "書き上げた紙が無くても読める");
})();

// ── 10. 作品棚 ───────────────────────────────────
(function () {
  var W = M.WORKS, L = M.LIB;
  var haiku = W.filter(function (w) { return w.type === "haiku"; }), poems = W.filter(function (w) { return w.type === "poem"; });
  check(haiku.length >= 40 && haiku.length <= 60 && poems.length >= 10 && poems.length <= 15,
    "俳句 40〜60句・詩 10〜15編(" + haiku.length + "句・" + poems.length + "編)");
  var ids = {}, dup = false;
  W.forEach(function (w) { if (ids[w.id]) dup = true; ids[w.id] = true; });
  check(!dup && W.every(function (w) { return /^[a-z]+-\d\d$/.test(w.id); }), "id は重ならない");
  check(W.every(function (w) { return (w.type === "haiku" || w.type === "poem") && w.author && w.title && w.source && w.text; }),
    "どの作品にも種類・作者・作品名・出典・本文がある");
  var late = W.filter(function (w) {
    return !(M.AUTHORS[w.author] <= 1967) || (w.by && !(M.AUTHORS[w.by] <= 1967));
  });
  check(!late.length, "1967年までに亡くなった作家の作品だけ(引用元の作者も)" + (late.length ? ": " + late.map(function (w) { return w.id; }) : ""));
  var marks = W.filter(function (w) { return /[《》｜［］＃※]/.test(w.text + w.title + w.source); });
  check(!marks.length, "ルビや注記の記号が残っていない" + (marks.length ? ": " + marks.map(function (w) { return w.id; }) : ""));
  var long = haiku.filter(function (w) { return M.rowsOfText("haiku", w.text).length !== 1 || /[\s\u3000]/.test(w.text); });
  check(!long.length, "俳句は空白なしの1行(20字以内)" + (long.length ? ": " + long.map(function (w) { return w.id; }) : ""));
  var sizes = poems.map(function (w) { return M.lengthOf(w.id); });
  check(sizes.every(function (n) { return n >= 60 && n <= 300; }), "詩は短めの一編(" + Math.min.apply(null, sizes) + "〜" + Math.max.apply(null, sizes) + "字)");
  // 気持ちが沈む主題の言葉が入っていないか(入れるときは、主題でないことを確かめてここに足す)
  var SAD = /死|亡|墓|葬|別れ|孤独|寂し|淋し|さびし|悲し|かなし|哀|涙|泣|病|戦|一人|独り/;
  var sad = W.filter(function (w) { return SAD.test(w.text + w.title); });
  check(!sad.length, "死・別れ・孤独・寂しさなどの言葉が入っていない" + (sad.length ? ": " + sad.map(function (w) { return w.id; }) : ""));
  check(W.every(function (w) { return /青空文庫/.test(M.attribution(w)); }), "出典に「青空文庫」と書く");
  check(M.attribution(L.byId["buson-01"]) === "与謝蕪村（正岡子規『俳人蕪村』より・青空文庫）" &&
    M.attribution(L.byId["basho-01"]) === "松尾芭蕉『おくのほそ道』（青空文庫より）" &&
    M.attribution(L.byId["hakushu-01"]) === "北原白秋「八百屋さん」（『とんぼの眼玉』より・青空文庫）",
    "ほかの人の本に引用された句・詩集の中の詩は、どこから取ったかも書く");
  check(M.kindLabel(L.byId["issa-01"]) === "小林一茶の句" && M.kindLabel(L.byId["kenji-01"]) === "宮沢賢治の詩「星めぐりの歌」",
    "いま書いている作品の言い方");
  var order = M.makeOrder(L, 123, 1), run = 0, ok = order.length === haiku.length + poems.length;
  order.forEach(function (id) {
    if (L.byId[id].type === "haiku") run++;
    else { if (run < 3 || run > 5) ok = false; run = 0; }
  });
  check(ok, "作品棚でも、俳句3〜5句ごとに詩が1編");
  var ms = M.create(1000, { seed: 77, now: T1 });
  check(ms.written === 1000 && ms.pages.length >= 2 && ms.finishedWorks.length > 20, "作品棚で1000マス分を書ける(" + ms.pages.length + "枚)");
})();

if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
