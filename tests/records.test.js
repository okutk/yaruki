// 綴じ帳・累計マス・気分の傾向・バックアップのテスト。実行: node tests/records.test.js
// (月の区切りを日本時間で確かめるなら: TZ=Asia/Tokyo node tests/records.test.js)
"use strict";
var path = require("path");
var Rec = require(path.join(__dirname, "..", "records.js"));

var failures = 0;
function check(ok, msg) {
  console.log((ok ? "  OK  " : "  NG  ") + msg);
  if (!ok) failures++;
}

var T0 = "2026-09-01T10:00:00.000Z";
var T1 = "2026-09-01T10:05:00.000Z";
var T2 = "2026-09-01T10:10:00.000Z";
var T3 = "2026-09-01T10:15:00.000Z";

function rec(over) {
  var r = {
    id: "s1", task: "部屋の掃除", category: "souji", difficulty: 42, heaviness: 3, time: 15, energy: 2,
    lowEnergy: false, level: 3, steps: ["a", "b", "c"], done: [false, false, false],
    finalReward: "お茶", rewardLocked: false, finalUserId: null,
    createdAt: T0, firstFilledAt: null, completedAt: null, moodBefore: null, moodAfter: null, note: null
  };
  for (var k in over) r[k] = over[k];
  return r;
}

// ── 1. 履歴への出し入れ ──────────────────────────
(function () {
  var b = Rec.emptyBinder();
  check(Rec.putSheet(b, rec({}), T1) === "none" && b.sheets.length === 0, "0マスなら綴じ帳に入らない");
  check(Rec.putSheet(b, rec({ done: [true, false, false] }), T1) === "added" && b.sheets.length === 1, "1マス埋めると入る");
  var s = b.sheets[0];
  check(s.firstFilledAt === T1 && s.updatedAt === T1 && s.createdAt === T0, "作成・最初に埋めた・更新の時刻");
  check(s.completedAt === null, "途中なら completedAt は null");
  check(Rec.putSheet(b, rec({ done: [true, false, false] }), T2) === "same" && b.sheets[0].updatedAt === T1,
    "中身が変わらなければ更新時刻も変えない");
  Rec.putSheet(b, rec({ done: [true, true, true] }), T2);
  check(b.sheets[0].completedAt === T2 && b.sheets[0].firstFilledAt === T1, "全部埋めると completedAt が入る");
  Rec.putSheet(b, rec({ done: [true, false, true] }), T3);
  check(b.sheets[0].completedAt === null, "1マス外すと completedAt が null に戻る");
  Rec.putSheet(b, rec({ done: [true, true, true] }), T3);
  check(b.sheets[0].completedAt === T3, "もう一度全部埋めると、その時刻が入る");
  check(Rec.putSheet(b, rec({ done: [false, false, false] }), T3) === "removed" && b.sheets.length === 0,
    "0マスに戻すと綴じ帳から外れる");
  Rec.putSheet(b, rec({ done: [true, false, false], note: "   " }), T1);
  check(b.sheets[0].note === null, "空白だけの一言は保存しない");
  Rec.putSheet(b, rec({ done: [true, false, false], note: "よかった", moodBefore: 2 }), T2);
  check(b.sheets[0].note === "よかった" && b.sheets[0].moodBefore === 2 && b.sheets[0].updatedAt === T2,
    "一言・気分の変更で更新される");
  check(Object.keys(b.sheets[0]).join(",") === Rec.FIELDS.join(","), "保存する項目がそろっている");
  check(Rec.removeSheet(b, "s1") && b.sheets.length === 0, "1枚を外せる");
})();

// ── 2. 累計マスとお祝い ────────────────────────
(function () {
  var b = Rec.emptyBinder();
  check(Rec.totalDone(b) === 0 && Rec.pageToCelebrate(b) === 0, "空なら 0");
  for (var i = 0; i < 49; i++) {
    Rec.putSheet(b, rec({ id: "p" + i, steps: ["1", "2", "3", "4", "5", "6", "7", "8"],
      done: [true, true, true, true, true, true, true, true] }), T1);
  }
  check(Rec.totalDone(b) === 392 && Rec.pageToCelebrate(b) === 0, "392マスではまだお祝いしない");
  var p = Rec.pageInfo(392);
  check(p.pages === 0 && p.rest === 392, "原稿用紙 0枚と392マス");
  Rec.putSheet(b, rec({ id: "last", steps: ["1", "2", "3", "4", "5", "6", "7", "8"],
    done: [true, true, true, true, true, true, true, true] }), T2);
  check(Rec.totalDone(b) === 400 && Rec.pageToCelebrate(b) === 1, "400マスで通算1枚目のお祝い");
  b.celebratedPages = 1;
  Rec.putSheet(b, rec({ id: "last", steps: ["1", "2", "3", "4", "5", "6", "7", "8"],
    done: [true, true, true, true, true, true, true, false] }), T3);
  Rec.putSheet(b, rec({ id: "last", steps: ["1", "2", "3", "4", "5", "6", "7", "8"],
    done: [true, true, true, true, true, true, true, true] }), T3);
  check(Rec.pageToCelebrate(b) === 0, "外して付け直しても、もう一度は出ない");
  var round = Rec.checkBinder(JSON.parse(JSON.stringify(b)));
  check(round.celebratedPages === 1 && Rec.pageToCelebrate(round) === 0, "保存して読み直しても出ない");
  check(Rec.pageInfo(803).pages === 2 && Rec.pageInfo(803).rest === 3, "803マス = 2枚と3マス");
})();

// ── 3. 同じ種類・気分の傾向・前のあなたより ───────
(function () {
  check(Rec.kindKey({ category: "undou", task: "ジム" }) === "c:undou", "カテゴリがあればカテゴリで比べる");
  check(Rec.kindKey({ category: "other", task: "  謎の用事 " }) === "t:謎の用事", "その他は入力文(前後の空白なし)で比べる");
  check(Rec.kindKey({ category: null, task: "  " }) === null, "カテゴリも入力文も無ければ比べない");

  function moodSheet(id, before, after, extra) {
    var s = { id: id, category: "souji", task: "掃除", moodBefore: before, moodAfter: after };
    for (var k in extra || {}) s[k] = extra[k];
    return s;
  }
  var two = [moodSheet("a", 1, 4), moodSheet("b", 2, 5)];
  check(Rec.moodTrend(two, "c:souji") === null, "2件では出さない");
  var three = two.concat([moodSheet("c", 3, 2)]);
  var t = Rec.moodTrend(three, "c:souji");
  check(t && t.count === 3 && t.up === 2, "3件中2件上がれば出す");
  var half = [moodSheet("a", 1, 4), moodSheet("b", 2, 5), moodSheet("c", 3, 2), moodSheet("d", 3, 3)];
  t = Rec.moodTrend(half, "c:souji");
  check(t && t.count === 4 && t.up === 2, "ちょうど半分でも出す");
  var down = [moodSheet("a", 1, 4), moodSheet("b", 4, 2), moodSheet("c", 3, 2), moodSheet("d", 3, 3)];
  check(Rec.moodTrend(down, "c:souji") === null, "上がったのが半分未満なら何も出さない");
  var partial = [moodSheet("a", 1, 4), moodSheet("b", 2, 5), moodSheet("c", null, 5), moodSheet("d", 2, null)];
  check(Rec.moodTrend(partial, "c:souji") === null, "前後の片方しか無い記録は数えない");
  check(Rec.moodTrend(three, "c:souji", "c") === null, "今の紙(excludeId)は数えない(3件→2件になり出さない)");
  check(Rec.moodTrend(three, "c:undou") === null, "別の種類では出さない");

  var notes = [
    moodSheet("n1", null, null, { note: "古い一言", completedAt: "2026-09-01T10:00:00Z" }),
    moodSheet("n2", null, null, { note: "新しい一言", completedAt: "2026-09-12T10:00:00Z" }),
    moodSheet("n3", null, null, { note: null, completedAt: "2026-09-20T10:00:00Z" }),
    { id: "g1", category: "undou", task: "ジム", note: "行けば気分いい", completedAt: "2026-09-21T10:00:00Z" }
  ];
  var n = Rec.latestNote(notes, "c:souji");
  check(n && n.note === "新しい一言" && n.id === "n2", "同じ種類の一番新しい一言を出す");
  check(Rec.latestNote(notes, "c:souji", "n2").note === "古い一言", "今の紙の一言は出さない");
  check(Rec.latestNote(notes, "c:shorui") === null, "別の種類の一言は出さない");
  check(Rec.latestNote(notes, "c:undou").note === "行けば気分いい", "普段のタスクの「運動」の一言は「運動」のときに出る");
})();

// ── 3b. ジムの紙(kind: gym)と普段のタスク(kind: task)を混ぜない ──
(function () {
  check(Rec.kindKey({ kind: "gym", category: "undou", task: "ジム" }) === Rec.GYM_KIND_KEY, "ジムの紙はジムどうしで比べる");
  check(Rec.kindKey({ kind: "task", category: "undou", task: "ジム" }) === "c:undou", "普段のタスクの運動は運動で比べる");
  function s(id, kind, before, after, note, at) {
    return { id: id, kind: kind, category: "undou", task: "ジム", moodBefore: before, moodAfter: after,
      note: note || null, completedAt: at || "2026-09-10T10:00:00Z" };
  }
  var sheets = [
    s("g1", "gym", 1, 4, "準備運動を先に", "2026-09-20T10:00:00Z"), s("g2", "gym", 2, 5), s("g3", "gym", 2, 4),
    s("t1", "task", 1, 2, "水を持っていく", "2026-09-22T10:00:00Z"), s("t2", "task", 3, 2), s("t3", "task", 4, 3)
  ];
  check(Rec.latestNote(sheets, Rec.GYM_KIND_KEY).note === "準備運動を先に", "ジムのカードにはジムの一言だけ(普段の新しい一言は出ない)");
  check(Rec.latestNote(sheets, "c:undou").note === "水を持っていく", "普段のタスクにはジムの一言が出ない");
  var gt = Rec.moodTrend(sheets, Rec.GYM_KIND_KEY);
  check(gt && gt.count === 3 && gt.up === 3, "気分の傾向はジムの記録どうしで(3回中3回)");
  check(Rec.moodTrend(sheets, "c:undou") === null, "普段のタスクの傾向にジムの記録は入らない");
})();

// ── 3c. kind の補い(ジムの日カードより前の記録) ──────
(function () {
  var old = { version: 1, celebratedPages: 0, sheets: [
    { id: "o1", task: "掃除", category: "souji", steps: ["a", "b"], done: [true, true], createdAt: T0, updatedAt: T1 }
  ] };
  check(Rec.lacksKind(old), "kind の無い記録に気づく");
  var b = Rec.checkBinder(old);
  var o = b.sheets[0];
  check(o.kind === "task" && o.mainCount === null && o.light === null && o.dayType === null && o.completedAt === T1,
    "古い記録は kind: task になり、ジムの項目は null、仕上がりもそのまま");
  check(!Rec.lacksKind(JSON.parse(JSON.stringify(b))), "そろえて保存し直せば目印は消える");
  check(Rec.checkSheet({ id: "x", kind: "妙な値", steps: ["a"], done: [true], createdAt: T0 }).kind === "task",
    "知らない kind も task として読む");
  var gym = Rec.checkSheet({ id: "g", kind: "gym", steps: ["1", "2", "3", "4", "5"], done: [true, true, true, true, false],
    createdAt: T0, updatedAt: T1, dayType: "変な値" });
  check(gym.kind === "gym" && gym.mainCount === 5 && gym.completedAt === null && gym.dayType === "weekday",
    "ジムの紙に mainCount が無ければ全部を本体として扱う");
  check(Object.keys(gym).join(",") === Rec.FIELDS.join(","), "ジムの紙も保存する項目がそろっている");
})();

// ── 3d. 見守りの項目(filledAt・sticky・lastFilledAt・welcome)と、古い記録への補い ──
(function () {
  var b = Rec.emptyBinder();
  check(b.lastFilledAt === null && b.welcome.shownFor === null && b.welcome.bonusPending === false, "空の綴じ帳の初期値");
  Rec.putSheet(b, rec({ done: [true, false, false] }), T1);
  Rec.putSheet(b, rec({ done: [true, true, false] }), T2);
  var s = b.sheets[0];
  check(s.filledAt.join() === [T1, T2, null].join() && b.lastFilledAt === T2, "マスごとに埋めた時刻が入り、最後に埋めた時刻も進む");
  Rec.putSheet(b, rec({ done: [false, true, false] }), T3);
  check(b.sheets[0].filledAt[0] === null && b.sheets[0].filledAt[1] === T2 && b.lastFilledAt === T2,
    "外したマスの時刻は消え、残ったマスの時刻は変わらない");
  Rec.putSheet(b, rec({ done: [true, true, false] }), T3);
  check(b.sheets[0].filledAt[0] === T3, "埋め直したマスは、その時刻になる");

  // 付箋
  Rec.putSheet(b, rec({ done: [true, true, false], sticky: "  返事\n待ち  " }), T3);
  check(b.sheets[0].sticky === "返事 待ち", "付箋は1行にそろえる");
  var long = Rec.checkSheet(rec({ done: [true, false, false], sticky: new Array(80).join("あ"), updatedAt: T1 }));
  check(long.sticky.length === Rec.STICKY_MAX && Rec.STICKY_MAX === 40, "付箋は40字まで");
  check(Rec.checkSheet(rec({ done: [true, false, false], sticky: "   ", updatedAt: T1 })).sticky === null, "空白だけの付箋は貼らない");
  var gymWithSticky = Rec.checkSheet({ id: "g", kind: "gym", steps: ["1", "2"], done: [true, false], createdAt: T0, sticky: "x" });
  check(gymWithSticky.sticky === null, "ジムの紙には付箋を付けない");
  // 付箋を貼っても消しても、同じ id の記録が1枚のまま
  Rec.putSheet(b, rec({ done: [true, true, false], sticky: null }), T3);
  check(b.sheets.length === 1 && b.sheets[0].sticky === null, "付箋をはがしても記録は1枚のまま");

  // 見守りの項目が無い古い綴じ帳
  var old = { version: 1, celebratedPages: 0, sheets: [
    { id: "o1", kind: "task", task: "部屋の掃除", steps: ["a", "b", "c"], done: [true, true, false],
      createdAt: T0, firstFilledAt: T1, updatedAt: T3 }
  ] };
  check(Rec.needsFill(old), "古い綴じ帳に気づく");
  var filled = Rec.checkBinder(old);
  var o = filled.sheets[0];
  check(o.filledAt.join() === [T1, T3, null].join() && o.sticky === null,
    "マスの時刻は、最初のマスは最初に埋めた時刻・ほかは最後に書き換えた時刻で補う");
  check(filled.lastFilledAt === T3 && filled.welcome.bonusPending === false, "最後に埋めた時刻を記録から補う");
  check(!Rec.needsFill(JSON.parse(JSON.stringify(filled))), "そろえて保存し直せば目印は消える");
  check(Object.keys(o).join(",") === Rec.FIELDS.join(","), "補った記録も保存する項目がそろっている");
  check(!Rec.needsFill(null) && !Rec.needsFill({ sheets: "x" }), "綴じ帳が無ければ何もしない");

  // 読み込み: 最後に埋めた時刻は新しい方、おかえりはこの端末のもの
  var local = Rec.emptyBinder();
  Rec.putSheet(local, rec({ id: "l", done: [true, false, false] }), T1);
  local.welcome.shownFor = T1;
  var file = Rec.emptyBinder();
  Rec.putSheet(file, rec({ id: "f", done: [true, false, false] }), T3);
  file.welcome.bonusPending = true;
  Rec.mergeBinder(local, Rec.checkBinder(JSON.parse(JSON.stringify(file))));
  check(local.lastFilledAt === T3 && local.welcome.shownFor === T1 && local.welcome.bonusPending === false,
    "読み込むと、最後に埋めた時刻は新しい方・おかえりの記録は手元のまま");
})();

// ── 4. 並び順と月の区切り(ローカル時刻) ─────────────
(function () {
  var lateNight = new Date(2026, 8, 30, 23, 59).toISOString();   // 9月30日 23:59(端末の時刻)
  var justAfter = new Date(2026, 9, 1, 0, 1).toISOString();      // 10月1日 0:01
  check(Rec.monthKey(lateNight) === "2026-09" && Rec.monthKey(justAfter) === "2026-10",
    "深夜0時の前後で月がローカル時刻どおりに分かれる");
  check(Rec.monthLabel(justAfter) === "2026年10月" && Rec.shortDay(lateNight) === "9月30日", "月・日の表示");
  check(Rec.dayLabel(new Date(2026, 8, 23, 12).toISOString()) === "9月23日(水)", "曜日の表示");
  check(Rec.timeLabel(new Date(2026, 8, 23, 7, 5).toISOString()) === "7:05", "時刻の表示");
  var sorted = Rec.sortNewest([{ id: "a", createdAt: lateNight }, { id: "b", createdAt: justAfter },
    { id: "c", createdAt: "2026-08-01T00:00:00Z" }]);
  check(sorted.map(function (s) { return s.id; }).join("") === "bac", "新しい順に並ぶ");
  check(Rec.backupFileName(new Date(2026, 8, 3)) === "yaruki-backup-20260903.json", "書き出しのファイル名");
})();

// ── 5. バックアップ ──────────────────────────────
(function () {
  var b = Rec.emptyBinder();
  Rec.putSheet(b, rec({ id: "x1", done: [true, true, true], moodBefore: 1, moodAfter: 4, note: "すっきり" }), T1);
  Rec.putSheet(b, rec({ id: "x2", done: [true, false, false] }), T2);
  b.celebratedPages = 0;
  var entries = {
    "genkouyoushi-history-v1": JSON.stringify(b),
    "genkouyoushi-state-v1": JSON.stringify({ state: { steps: [] }, task: "" }),
    "genkouyoushi-my-rewards-v1": JSON.stringify({ items: [{ id: "m1", text: "ケーキ", levels: [3] }] }),
    "genkouyoushi-reward-history-v1": JSON.stringify({ box: {}, final: {} }),
    "genkouyoushi-gym-v1": JSON.stringify({ version: 1, enabled: true, days: [1, 3, 5], companions: ["ラジオ"],
      today: { date: "2026-09-01", hidden: false, sheet: null } }),
    "other-app-key": "秘密",
    "kakeibo-data": "{}"
  };
  var backup = Rec.buildBackup(entries, T3);
  var keys = Object.keys(backup.data);
  check(keys.every(Rec.isOwnKey) && keys.length === 5, "書き出しに他のアプリのキーは入らない");
  check(backup.data["genkouyoushi-gym-v1"] && backup.data["genkouyoushi-gym-v1"].days.join() === "1,3,5",
    "書き出しにジムの日カードの設定(genkouyoushi-gym-v1)が入る");
  check(backup.app === Rec.BACKUP_APP && backup.exportedAt === T3, "書き出しの見出し");
  var text = JSON.stringify(backup);

  var p = Rec.parseBackup(text);
  check(p.ok && p.sheetCount === 2 && p.skipped === 0, "書き出したものを読み込める(2枚)");
  check(Object.keys(p.others).length === 4 && JSON.parse(p.others["genkouyoushi-my-rewards-v1"]).items[0].text === "ケーキ",
    "綴じ帳以外のキー(自分のご褒美など)も入っている");
  check(JSON.parse(p.others["genkouyoushi-gym-v1"]).companions[0] === "ラジオ", "読み込みでジムの日カードの設定も戻せる");

  // 全部消した状態に読み込む → 元に戻る
  var fresh = Rec.emptyBinder();
  var r = Rec.mergeBinder(fresh, p.binder);
  check(r.added === 2 && JSON.stringify(fresh.sheets) === JSON.stringify(b.sheets), "消したあと読み込むと元に戻る");
  // 同じファイルを2回読み込んでも増えない
  r = Rec.mergeBinder(fresh, Rec.parseBackup(text).binder);
  check(r.added === 0 && r.same === 2 && fresh.sheets.length === 2, "同じファイルを2回読み込んでも重複しない");

  // 同じ id は updatedAt が新しい方
  var local = Rec.checkBinder(JSON.parse(JSON.stringify(b)));
  Rec.putSheet(local, rec({ id: "x2", done: [true, true, false] }), "2026-09-02T00:00:00.000Z");
  r = Rec.mergeBinder(local, p.binder);
  check(r.updated === 0 && Rec.findSheet(local, "x2").done[1] === true, "手元の方が新しければ手元を残す");
  var older = Rec.checkBinder(JSON.parse(JSON.stringify(b)));
  var newerFile = Rec.checkBinder(JSON.parse(JSON.stringify(local)));
  r = Rec.mergeBinder(older, newerFile);
  check(r.updated === 1 && Rec.findSheet(older, "x2").done[1] === true, "ファイルの方が新しければファイルを残す");

  // 読み込みで400マスを超えてもお祝いは出さない
  var big = Rec.emptyBinder();
  for (var i = 0; i < 134; i++) Rec.putSheet(big, rec({ id: "b" + i, done: [true, true, true] }), T1);
  var target = Rec.emptyBinder();
  Rec.mergeBinder(target, big);
  check(Rec.totalDone(target) === 402 && Rec.pageToCelebrate(target) === 0, "読み込みで増えたマスではお祝いしない");

  // 壊れたファイル・別アプリのファイル
  check(Rec.parseBackup("{ これは壊れている").error === "broken", "JSON でなければ broken");
  check(Rec.parseBackup("").error === "broken", "空なら broken");
  check(Rec.parseBackup(JSON.stringify({ app: "kakeibo", data: {} })).error === "other", "別アプリのファイルは other");
  check(Rec.parseBackup(JSON.stringify([1, 2])).error === "broken", "配列は broken");
  check(Rec.parseBackup(JSON.stringify({ app: Rec.BACKUP_APP, format: 1, data: { "genkouyoushi-history-v1": { sheets: "x" } } })).error === "broken",
    "綴じ帳の形が違えば broken");
  check(Rec.parseBackup(JSON.stringify({ app: Rec.BACKUP_APP, format: 1, data: { "other-key": 1 } })).error === "empty",
    "このアプリのキーが1つも無ければ empty");
  check(Rec.parseBackup(JSON.stringify({ app: Rec.BACKUP_APP, format: 9, data: {} })).error === "newer",
    "新しい形式は newer");
  var mixed = JSON.parse(text);
  mixed.data["genkouyoushi-history-v1"].sheets.push({ id: "bad" }, { id: "zero", steps: ["a"], done: [false], createdAt: T0 });
  mixed.data["someone-else"] = "x";
  p = Rec.parseBackup(JSON.stringify(mixed));
  check(p.ok && p.sheetCount === 2 && p.skipped === 2 && !p.others["someone-else"], "使えない記録と他アプリのキーは飛ばす");
  check(Rec.parseBackup("﻿" + text).ok, "先頭に BOM があっても読める");
})();

// ── 6. 記録のそろえ方 ──────────────────────────
(function () {
  check(Rec.checkSheet(null) === null && Rec.checkSheet({ id: "a" }) === null, "形が違う記録は使わない");
  var s = Rec.checkSheet({ id: "a", steps: ["x", "y"], done: [true], createdAt: T0, moodBefore: 9, note: 5, difficulty: 130 });
  check(s && s.done.join() === "true,false" && s.moodBefore === null && s.note === null && s.difficulty === null,
    "範囲外の値は null、done は手順の数にそろえる");
  var long = Rec.checkSheet({ id: "a", steps: ["x"], done: [true], createdAt: T0, note: new Array(300).join("あ") });
  check(long.note.length === Rec.NOTE_MAX, "一言は" + Rec.NOTE_MAX + "字まで");
  var dup = Rec.checkBinder({ sheets: [
    { id: "d", steps: ["x"], done: [true], createdAt: T0, updatedAt: T1, note: "古い" },
    { id: "d", steps: ["x"], done: [true], createdAt: T0, updatedAt: T2, note: "新しい" }
  ] });
  check(dup.sheets.length === 1 && dup.sheets[0].note === "新しい", "同じ id が2つあれば新しい方を残す");
  check(Rec.checkBinder("壊れた").sheets.length === 0, "綴じ帳が壊れていれば空から始める");
  var id1 = Rec.newId(new Date(), Math.random), id2 = Rec.newId(new Date(), Math.random);
  check(typeof id1 === "string" && id1 !== id2 && /^[0-9a-z-]+$/.test(id1), "id は英数字で、毎回ちがう");
})();

if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
