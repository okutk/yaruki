// ジムの日カード(日付の区切り・平日と休日・ジムの紙・お供・今月ジムに着いた日)のテスト。実行: node tests/gym.test.js
// (日本時間で確かめるなら: TZ=Asia/Tokyo node tests/gym.test.js)
"use strict";
var fs = require("fs");
var path = require("path");
var G = require(path.join(__dirname, "..", "gym.js"));
var C = require(path.join(__dirname, "..", "classify.js"));
var Rec = require(path.join(__dirname, "..", "records.js"));

var failures = 0;
function check(ok, msg) {
  console.log((ok ? "  OK  " : "  NG  ") + msg);
  if (!ok) failures++;
}
// 端末のローカル時刻で日時を作る(月は 1〜12)
function at(y, m, d, h, min) { return new Date(y, m - 1, d, h, min || 0); }

// ── 1. 朝4時の区切り ─────────────────────────────
(function () {
  check(G.dayKey(at(2026, 9, 24, 3, 59)) === "2026-09-23", "3:59 は前の日");
  check(G.dayKey(at(2026, 9, 24, 4, 0)) === "2026-09-24", "4:00 から新しい日");
  check(G.dayKey(at(2026, 9, 24, 23, 59)) === "2026-09-24", "23:59 はその日");
  check(G.dayKey(at(2026, 10, 1, 2, 0)) === "2026-09-30", "月の変わり目: 10月1日 2:00 は 9月30日");
  check(G.dayKey(at(2027, 1, 1, 3, 0)) === "2026-12-31", "年の変わり目: 1月1日 3:00 は 12月31日");
  check(G.isDayKey("2026-09-24") && !G.isDayKey("2026-02-30") && !G.isDayKey("きょう"), "日付の形を確かめる");
})();

// ── 2. 平日と休日 ────────────────────────────────
(function () {
  check(G.defaultDayType("2026-09-26") === "holiday" && G.defaultDayType("2026-09-27") === "holiday", "土日は休日");
  check(G.defaultDayType("2026-09-25") === "weekday" && G.defaultDayType("2026-09-28") === "weekday", "金・月は平日");
  // 月曜の 2:00 は日曜扱い(休日)
  var g = G.check(null, at(2026, 9, 28, 2, 0));
  check(g.today.date === "2026-09-27" && G.dayType(g) === "holiday", "月曜 2:00 はまだ日曜(休日)");
  g = G.check(null, at(2026, 9, 24, 18, 0));
  check(G.dayType(g) === "weekday", "木曜は平日");
  g.today.dayTypeOverride = "holiday";
  check(G.dayType(g) === "holiday", "今日だけ休日に切り替えられる");
  var next = G.check(JSON.parse(JSON.stringify(g)), at(2026, 9, 25, 4, 0));
  check(next.today.dayTypeOverride === null && G.dayType(next) === "weekday", "切り替えは翌日(4時)には元に戻る");
})();

// ── 3. 保存データのそろえ方と日付の切り替わり ─────────
(function () {
  var now = at(2026, 9, 24, 19, 0);
  var d = G.check(null, now);
  check(d.enabled === true && d.days.length === 7 && d.companions.length === 0 && d.today.sheet === null,
    "初期値: ON・毎日・お供なし・紙なし");
  check(d.ifThen.weekday === "帰ったら、座る前にジムの服に着替える" && d.ifThen.holiday === "お昼ごはんの前に行く",
    "いつ・どうするの初期値");
  check(G.check("壊れた", now).enabled === true && G.check([1, 2], now).days.length === 7, "壊れたデータなら初期値");

  var raw = {
    enabled: false, days: [1, 3, 9, "5", 3], ifThen: { weekday: "  着替えたら  すぐに出る ", holiday: "" },
    companions: ["ポッドキャスト", "", 5, "  https://example.com/x  "], companionIndex: 2, folded: true,
    today: { date: "2026-09-24", dayTypeOverride: "holiday", hidden: false, sheet: null }
  };
  var g = G.check(raw, now);
  check(g.enabled === false && g.days.join() === "1,3", "曜日は 0〜6 の数字だけ、重複なし");
  check(g.ifThen.weekday === "着替えたら すぐに出る" && g.ifThen.holiday === "お昼ごはんの前に行く",
    "いつ・どうする: 空白をそろえ、空なら初期値");
  check(g.companions.join("|") === "ポッドキャスト|https://example.com/x", "お供: 文字だけ、空は除く");
  check(g.folded === true && g.today.dayTypeOverride === "holiday", "同じ日ならたたみ・今日だけの切り替えを残す");

  // 紙があれば3:59までは同じ日、4:00で新しい日
  var sheet = G.newSheet({ id: "g1", light: false, dayType: "weekday", hasCompanion: true, score: 55, level: 4,
    createdAt: at(2026, 9, 24, 19, 0).toISOString() });
  sheet.done[0] = true;
  raw.today.sheet = sheet;
  var night = G.check(JSON.parse(JSON.stringify(raw)), at(2026, 9, 25, 3, 59));
  check(night.today.sheet && night.today.sheet.done[0] === true && night.today.date === "2026-09-24",
    "翌日 3:59 はまだ同じ日(紙はそのまま)");
  var morning = G.check(JSON.parse(JSON.stringify(raw)), at(2026, 9, 25, 4, 0));
  check(morning.today.sheet === null && morning.today.date === "2026-09-25" && morning.folded === false &&
    morning.today.hidden === false, "翌日 4:00 で新しい日(紙・たたみ・今日はなしを片付ける)");
  check(G.rollover(morning, at(2026, 9, 25, 12, 0)) === false, "同じ日なら何もしない");

  var hidden = G.check({ today: { date: "2026-09-24", hidden: true, sheet: null } }, now);
  check(hidden.today.hidden === true, "今日はなしは、その日のうちは残る");
  check(G.check({ today: { date: "2026-09-24", hidden: true, sheet: null } }, at(2026, 9, 25, 4, 0)).today.hidden === false,
    "今日はなしは翌朝4時まで");
  var broken = G.check({ today: { date: "2026-09-24", sheet: { id: "x", steps: ["a"] } } }, now);
  check(broken.today.sheet === null, "形のおかしい紙は使わない");
})();

// ── 4. カードを出す条件 ──────────────────────────
(function () {
  var thu = at(2026, 9, 24, 19, 0);   // 木曜
  var g = G.check(null, thu);
  check(G.cardVisible(g), "ON・毎日なら出る");
  g.days = [0, 6];
  check(!G.cardVisible(g), "選んでいない曜日は出ない");
  g.days = [4];
  check(G.cardVisible(g), "選んだ曜日(木)は出る");
  g.enabled = false;
  check(!G.cardVisible(g), "機能 OFF なら出ない");
  g.today.sheet = G.newSheet({ id: "s", dayType: "weekday", createdAt: thu.toISOString() });
  check(G.cardVisible(g), "今日の紙があれば(ショートカットで始めた日など)出る");
  g.enabled = true;
  g.today.sheet = null;
  g.today.hidden = true;
  check(!G.cardVisible(g), "今日はなしにしたら出ない");
})();

// ── 5. ジムの紙のマス ─────────────────────────────
(function () {
  var a = G.buildSteps(false, "weekday", true);
  check(a.length === 7 && a[0] === "座る前に、ジムの服に着替える" && a[1] === "バッグを持って、靴を履く" &&
    a[2] === "玄関を出て、お供を再生する" && a[3] === "ジムに着いた", "ふつう・平日・お供あり: 7マス");
  check(a[4] === "1種目やる" && a[5] === "あとは好きなだけ" && a[6].indexOf("玄関に置く") !== -1, "ふつうのおまけ3マス");
  var b = G.buildSteps(false, "holiday", false);
  check(b[0] === "お昼ごはんの前に、ジムの服に着替える" && b[2] === "玄関を出る", "ふつう・休日・お供なし");
  var c = G.buildSteps(true, "weekday", true);
  check(c.length === 6 && c[0] === "座る前に着替える" && c[1] === "靴を履いて、玄関を出る" &&
    c[2] === "お供を聴きながら、ジムまで歩く" && c[3] === "ジムに着いた", "軽め・平日・お供あり: 6マス");
  var d = G.buildSteps(true, "holiday", false);
  check(d[0] === "お昼ごはんの前に着替える" && d[2] === "ジムまで歩く" && d[4] === "ストレッチだけして帰る" &&
    d[5].indexOf("玄関に戻す") !== -1, "軽め・休日・お供なし");

  var s = G.newSheet({ id: "s1", light: false, dayType: "weekday", hasCompanion: false, score: 55, level: 4,
    createdAt: "2026-09-24T10:00:00.000Z" });
  check(s.mainCount === 4 && s.done.length === 7 && !G.arrived(s), "新しい紙は本体4マス・まだ着いていない");
  s.done[0] = s.done[1] = s.done[2] = true;
  check(G.mainDone(s) === 3 && !G.arrived(s), "3マスではまだ");
  s.done[3] = true;
  check(G.arrived(s) && G.bonus(s).done === 0 && G.bonus(s).total === 3, "4マス目で着いた(おまけ 0/3 のまま)");
  s.done[4] = true;
  check(G.bonus(s).done === 1 && G.doneCount(s) === 5, "おまけも数える");
  check(G.isBonus(s, 4) && !G.isBonus(s, 3), "5マス目からがおまけ");

  check(G.praiseFor(s, 0) === "座る前に動けた。それが一番むずかしいところ", "1マス目のひとこと(平日)");
  check(G.praiseFor(s, 2) === "外に出た！", "3マス目のひとこと");
  check(G.praiseFor(s, 3) === null, "4マス目は完成の欄で褒める");
  var w = G.arriveWords("abc");
  check(G.ARRIVE.indexOf(w.main) !== -1 && G.ARRIVE.indexOf(w.sub) !== -1 && w.main !== w.sub &&
    (w.main === G.ARRIVE[2] || w.sub === G.ARRIVE[2]), "着いたときの言葉(「全部おまけ」を必ず出す)");
  check(G.arriveWords("abc").main === w.main, "同じ紙なら同じ言葉");

  var round = G.checkSheet(JSON.parse(JSON.stringify(s)));
  check(round && round.done.join() === s.done.join() && round.mainCount === 4, "保存して読み直せる");
  check(s.gold.length === 0 && round.gold.length === 0, "金のマスを決めなければ無し");
  var gs = G.newSheet({ id: "s2", light: true, dayType: "holiday", hasCompanion: false, score: 26, level: 2,
    createdAt: "2026-09-24T10:00:00.000Z", gold: [5, 1, 1, 99] });
  var gr = G.checkSheet(JSON.parse(JSON.stringify(gs)));
  check(gs.gold.join() === "1,5" && gr.gold.join() === "1,5", "金のマス(おまけのマスも)を紙に残し、読み直しても変わらない");
})();

// ── 6. 難易度とご褒美レベル ────────────────────────
(function () {
  var n = G.plan(C, false), l = G.plan(C, true);
  check(n.score === 55 && n.level === 4, "ふつう: 難易度55・Lv4(" + n.score + " / Lv" + n.level + ")");
  check(l.score === 26 && l.level === 2, "軽め: 難易度26・Lv2(" + l.score + " / Lv" + l.level + ")");
  check(l.level < n.level, "軽めはご褒美が軽い");
})();

// ── 7. お供 ──────────────────────────────────────
(function () {
  var g = G.check(null, at(2026, 9, 24, 19, 0));
  check(G.companionFor(g) === null, "0件なら出さない");
  g.companions = ["ラジオ"];
  check(G.companionFor(g) === "ラジオ" && G.nextCompanion(g) === false, "1件ならいつもそれ(切り替えなし)");
  g.companions = ["A", "B", "C"];
  var today = G.companionFor(g);
  g.today.date = "2026-09-25";
  var tomorrow = G.companionFor(g);
  g.today.date = "2026-09-26";
  var after = G.companionFor(g);
  check(today !== tomorrow && tomorrow !== after && today !== after, "複数なら日替わりで順番に出る(" + today + tomorrow + after + ")");
  check(G.nextCompanion(g) && G.companionFor(g) !== after, "「他のお供」で次のものになる");
  check(G.isUrl("https://open.spotify.com/show/xx") && G.isUrl("http://a.b/c") && !G.isUrl("ラジオ") &&
    !G.isUrl("javascript:alert(1)") && !G.isUrl("https://a b"), "http(s):// で始まるものだけリンクにする");
})();

// ── 8. 今月ジムに着いた日(分母は出さない) ─────────────
(function () {
  function gymRec(id, created, completed, extra) {
    var r = { id: id, kind: "gym", createdAt: created.toISOString(), completedAt: completed ? completed.toISOString() : null };
    for (var k in extra || {}) r[k] = extra[k];
    return r;
  }
  var now = at(2026, 9, 24, 20, 0);
  var sheets = [
    gymRec("a", at(2026, 9, 1, 18), at(2026, 9, 1, 18, 30)),
    gymRec("b", at(2026, 9, 1, 21), at(2026, 9, 1, 21, 30)),      // 同じ日にもう1枚 → 1日
    gymRec("c", at(2026, 9, 3, 18), null),                         // 着いていない → 数えない
    gymRec("d", at(2026, 9, 5, 12), at(2026, 9, 5, 12, 30), { kind: "task" }),   // 普段のタスク → 数えない
    gymRec("e", at(2026, 8, 31, 18), at(2026, 8, 31, 19)),         // 先月 → 数えない
    gymRec("f", at(2026, 9, 1, 3, 30), at(2026, 9, 1, 3, 50)),     // 9/1 3:30 は 8/31 扱い → 数えない
    gymRec("g", at(2026, 9, 10, 18), at(2026, 9, 10, 18, 40))
  ];
  check(G.arrivedDaysThisMonth(sheets, now) === 2, "着いた日を重複なしで数える(9/1・9/10 の2日)");
  check(G.arrivedDaysThisMonth([], now) === 0, "記録が無ければ 0(画面には出さない)");
  // 10月1日 3:00 はまだ9月
  check(G.arrivedDaysThisMonth(sheets, at(2026, 10, 1, 3, 0)) === 2, "10月1日 3:00 はまだ9月として数える");
  check(G.arrivedDaysThisMonth(sheets, at(2026, 10, 1, 4, 0)) === 0, "10月1日 4:00 からは10月");
})();

// ── 9. 綴じ帳とのつながり(records.js) ─────────────────
(function () {
  var T0 = "2026-09-24T09:00:00.000Z", T1 = "2026-09-24T09:10:00.000Z", T2 = "2026-09-24T09:20:00.000Z";
  var s = G.newSheet({ id: "gym1", light: true, dayType: "holiday", hasCompanion: false, score: 26, level: 2, createdAt: T0 });
  function rec() {
    return { id: s.id, kind: "gym", task: "ジム", category: "undou", difficulty: s.score, level: s.level,
      steps: s.steps, done: s.done, mainCount: s.mainCount, light: s.light, dayType: s.dayType,
      finalReward: "お昼ごはん", createdAt: s.createdAt };
  }
  var b = Rec.emptyBinder();
  check(Rec.putSheet(b, rec(), T1) === "none", "0マスのジムの紙は綴じ帳に入らない");
  s.done[0] = true;
  Rec.putSheet(b, rec(), T1);
  var r = b.sheets[0];
  check(r.kind === "gym" && r.mainCount === 4 && r.light === true && r.dayType === "holiday" && r.completedAt === null,
    "1マスで綴じ帳に入る(kind・mainCount・light・dayType)");
  s.done[1] = s.done[2] = s.done[3] = true;
  Rec.putSheet(b, rec(), T2);
  check(b.sheets[0].completedAt === T2, "本体4マスで completedAt(おまけは埋めなくてよい)");
  s.done[4] = true;
  Rec.putSheet(b, rec(), "2026-09-24T10:00:00.000Z");
  check(b.sheets[0].completedAt === T2 && Rec.totalDone(b) === 5, "おまけを埋めても完のまま・累計マスに数える");
  s.done[3] = false;
  Rec.putSheet(b, rec(), "2026-09-24T10:05:00.000Z");
  check(b.sheets[0].completedAt === null, "4マス目を外すと完が消える");
})();

// ── 10. 罪悪感につながる言葉を使わない ─────────────────
(function () {
  // (「保存できなかった」のような端末のエラーの知らせは、本人を責める言葉ではないので対象外)
  var NG = ["未完了", "失敗", "サボ", "さぼ", "休んだ", "怠け", "できなかった日", "行けなかった", "行かなかった", "逃し", "途切れ"];
  var texts = [];
  function collect(v) {
    if (typeof v === "string") texts.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.keys(v).forEach(function (k) { collect(v[k]); });
  }
  collect([G.STEPS, G.PRAISE, G.ARRIVE, G.DEFAULT_IF_THEN, G.HOLIDAY_LUNCH]);
  var bad = texts.filter(function (t) { return NG.some(function (w) { return t.indexOf(w) !== -1; }); });
  check(texts.length > 20 && !bad.length, "ジムの文言に NG の言葉が無い" + (bad.length ? ": " + bad.join(" / ") : ""));

  // 画面の文字(index.html の本文と、スクリプトの中の日本語の文字列)にも無いこと(コメントは除く)
  var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  var body = html.replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
  var found = NG.filter(function (w) { return body.indexOf(w) !== -1; });
  check(!found.length, "index.html の画面の文字に NG の言葉が無い" + (found.length ? ": " + found.join(" / ") : ""));
})();

if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
