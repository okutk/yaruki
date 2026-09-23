/*
 * やる気の原稿用紙: 見守り(おかえり・週のたより・はなまる)
 *
 * ブラウザでは window.YarukiWatch、node では require("./watch.js") で使う(gym.js を先に読み込む)。
 * 画面(DOM)と localStorage には触らない(読み書きは index.html が行う)。
 * テスト: node tests/watch.test.js
 *
 * ── 考え方 ─────────────────────────────────────
 * ・名前のない語り手が、よかったことだけを書く。日数の間あき・前の週との比較・届かなかったことには触れない。
 * ・日付は朝4時で区切る(gym.js の dayKey と同じ)。週は月曜の朝4時から、翌週の月曜の朝4時まで。
 * ・たよりは作ったときの文面をそのまま保存する(読み返しても変わらない)。
 */
(function (root, factory) {
  var node = typeof module === "object" && module.exports;
  var api = factory(node ? require("./gym.js") : root.YarukiGym);
  if (node) module.exports = api;
  else root.YarukiWatch = api;
})(this, function (G) {
  "use strict";

  var KEY = "genkouyoushi-letters-v1";
  var WELCOME_DAYS = 3;          // 最後にマスを埋めた日から、この日数以上たって開いたらおかえり
  var MAX_LEVEL = 6;
  var LIST_MAX = 5;              // やったことの一覧は最大5件
  var NAME_MAX = 20;
  var QUOTE_MAX = 40;
  var LETTERS_MAX = 520;         // 保存しておく通数の上限(10年分)

  var WELCOME_WORDS = [
    "おかえり。また会えてうれしいよ",
    "おかえり。今日は1マスだけでも十分だよ",
    "おかえり。ここはいつでも待ってるよ"
  ];

  /* ── 日付(朝4時区切り・端末のローカル時刻) ─────────── */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function keyOfDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addDays(key, n) {
    var d = G.dateOfKey(key);
    return keyOfDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12));
  }
  function isoOrNull(v) {
    return typeof v === "string" && v && !isNaN(Date.parse(v)) ? v : null;
  }

  // その時刻が属する週の月曜(YYYY-MM-DD)。月曜の 3時台はまだ前の週
  function weekStartKey(date) {
    var key = G.dayKey(date instanceof Date ? date : new Date(date));
    var back = (G.weekdayOf(key) + 6) % 7;     // 月曜なら 0、日曜なら 6
    return addDays(key, -back);
  }
  function weekOfIso(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? null : weekStartKey(new Date(t));
  }
  // 「9月21日〜27日」「9月28日〜10月4日」
  function weekLabel(weekStart) {
    var a = G.dateOfKey(weekStart), b = G.dateOfKey(addDays(weekStart, 6));
    return (a.getMonth() + 1) + "月" + a.getDate() + "日〜" +
      (a.getMonth() === b.getMonth() ? "" : (b.getMonth() + 1) + "月") + b.getDate() + "日";
  }
  function shortDate(key) {
    var d = G.dateOfKey(key);
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  /* ── おかえり ───────────────────────────────── */
  // 最後にマスを埋めた日から、今日まで何日か(朝4時区切り)
  function gapDays(fromIso, now) {
    var t = Date.parse(fromIso);
    if (isNaN(t)) return null;
    return G.dayNumber(G.dayKey(now || new Date())) - G.dayNumber(G.dayKey(new Date(t)));
  }
  // おかえりを出すか。一度もマスを埋めていなければ出さない。同じ間あきには1回だけ
  function welcomeDue(binder, now) {
    var last = binder && binder.lastFilledAt;
    if (!last) return false;
    var gap = gapDays(last, now);
    if (gap == null || gap < WELCOME_DAYS) return false;
    return !(binder.welcome && binder.welcome.shownFor === last);
  }
  // おかえりのおまけ: ご褒美を1段上げる
  function bumpLevel(level) {
    var lv = typeof level === "number" && isFinite(level) ? Math.round(level) : 1;
    return Math.max(1, Math.min(MAX_LEVEL, lv + 1));
  }

  /* ── たよりの保存データ ─────────────────────────── */
  function emptyLetters() { return { version: 1, letters: [] }; }

  function checkLetter(l) {
    if (!l || typeof l !== "object" || !G.isDayKey(l.weekStart)) return null;
    if (G.weekdayOf(l.weekStart) !== 1 || !Array.isArray(l.lines)) return null;
    var lines = l.lines.filter(function (x) { return typeof x === "string" && x; })
      .map(function (x) { return x.slice(0, 300); }).slice(0, 40);
    if (!lines.length) return null;
    return {
      weekStart: l.weekStart,
      createdAt: isoOrNull(l.createdAt) || G.dateOfKey(addDays(l.weekStart, 7)).toISOString(),
      readAt: isoOrNull(l.readAt),
      lines: lines
    };
  }
  // 形をそろえ、古い週から順に並べる。同じ週が2通あれば先に見つけた方を残す
  function checkLetters(raw) {
    var out = emptyLetters();
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.letters)) return out;
    var seen = {};
    raw.letters.forEach(function (l) {
      var c = checkLetter(l);
      if (!c || seen[c.weekStart]) return;
      seen[c.weekStart] = true;
      out.letters.push(c);
    });
    out.letters.sort(function (a, b) { return a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0; });
    if (out.letters.length > LETTERS_MAX) out.letters = out.letters.slice(-LETTERS_MAX);
    return out;
  }
  function findLetter(data, weekStart) {
    for (var i = 0; i < data.letters.length; i++) if (data.letters[i].weekStart === weekStart) return data.letters[i];
    return null;
  }
  function newestLetter(data) {
    return data.letters.length ? data.letters[data.letters.length - 1] : null;
  }
  // 上に出す封筒: 一番新しいたよりが、まだ開いていない(しまってもいない)ときだけ
  function unreadLetter(data) {
    var l = newestLetter(data);
    return l && !l.readAt ? l : null;
  }

  /* ── その週にやったこと(綴じ帳の記録から) ─────────────
   * マスは filledAt(埋めた時刻)の週で数える。仕上がりは completedAt の週。
   * ジムに着いた日は、着いた紙を作った日(朝4時区切り)で重複なしに数える。 */
  function clip(text, max) {
    var t = String(text || "").split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) + "…" : t;
  }
  function nameOf(s) {
    if (s.kind === "gym") return "ジム";
    var t = clip(s.task, NAME_MAX);
    return t ? "「" + t + "」" : "";
  }

  function weekActivity(sheets, weekStart) {
    var a = { boxes: 0, bonus: 0, touched: 0, finished: 0, open: 0, tasks: [], gymDays: 0, moodUps: [], notes: [], total: 0 };
    var gymDays = {}, touched = [];
    (sheets || []).forEach(function (s) {
      var gym = s.kind === "gym";
      var filled = Array.isArray(s.filledAt) ? s.filledAt : [];
      var inWeek = 0, first = null;
      s.done.forEach(function (d, i) {
        if (d !== true) return;
        var w = weekOfIso(filled[i]);
        if (!w || w > weekStart) return;
        a.total++;                                 // その週の終わりまでに埋めたマス
        if (w !== weekStart) return;
        inWeek++;
        a.boxes++;
        if (gym && s.mainCount && i >= s.mainCount) a.bonus++;
        if (!first || Date.parse(filled[i]) < Date.parse(first)) first = filled[i];
      });
      var doneWeek = s.completedAt ? weekOfIso(s.completedAt) : null;
      var finishedHere = doneWeek === weekStart;
      if (!inWeek && !finishedHere) return;
      touched.push({ s: s, at: Date.parse(first || s.completedAt) || 0 });
      if (gym) {
        if (finishedHere && isoOrNull(s.createdAt)) gymDays[G.dayKey(new Date(s.createdAt))] = true;
        return;
      }
      a.touched++;
      if (finishedHere) a.finished++;
      else if (!doneWeek || doneWeek > weekStart) a.open++;   // その週の時点では書きかけ
    });
    a.gymDays = Object.keys(gymDays).length;
    touched.sort(function (x, y) { return x.at - y.at; });
    var seenName = {};
    touched.forEach(function (t) {
      var s = t.s;
      if (s.kind !== "gym") {
        var n = clip(s.task, NAME_MAX);
        if (n && !seenName[n] && a.tasks.length < LIST_MAX) {
          seenName[n] = true;
          a.tasks.push(n);
        }
      }
      var name = nameOf(s);
      if (name && s.moodBefore != null && s.moodAfter != null && s.moodAfter > s.moodBefore) a.moodUps.push(name);
      if (s.note) {
        var q = clip(s.note, QUOTE_MAX);
        if (q) a.notes.push(q);
      }
    });
    return a;
  }

  // 1マス以上埋めた週(filledAt の週)。古い順
  function activeWeeks(sheets) {
    var seen = {}, out = [];
    (sheets || []).forEach(function (s) {
      (Array.isArray(s.filledAt) ? s.filledAt : []).forEach(function (t, i) {
        if (s.done[i] !== true) return;
        var w = weekOfIso(t);
        if (w && !seen[w]) { seen[w] = true; out.push(w); }
      });
    });
    return out.sort();
  }

  /* ── たよりの文面 ─────────────────────────────
   * データがある行だけを出す。候補からランダムに選ぶ(rng は 0 以上 1 未満を返す関数)。
   * 使わない言葉: 日数の間あき・前の週との比較・届かなかったこと・やらなかった日の数 */
  function pick(list, rng) { return list[Math.floor(rng() * list.length) % list.length]; }
  function fill(tpl, v) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) { return v[k] == null ? "" : String(v[k]); });
  }
  var LINES = {
    open: ["{week}のたよりだよ。", "{week}のこと、まとめておいたよ。", "{week}の原稿用紙を、読み返してみたよ。"],
    // マスの数の文は「。」の前に、おまけの数を添える
    boxes: ["{week}は、{n}マス埋めたよ", "埋めたマスは、{n}マス", "{n}マス、ちゃんと埋まってたよ"],
    bonus: ["（おまけのマスも{b}つ）", "（そのうち、おまけのマスが{b}つ）"],
    finishedAll: ["仕上がった原稿用紙が{f}枚。", "{f}枚、最後まで書き上げたね。"],
    finishedSome: ["仕上がった原稿用紙が{f}枚。手をつけたことは、全部で{t}つ。書きかけも、ちゃんと進んでるよ。",
      "{f}枚、最後まで書き上げたね。書きかけも入れると、手をつけたことは{t}つ。"],
    touchedOnly: ["手をつけたことが{t}つ。書きかけでも、ちゃんと前に進んでるよ。",
      "{t}つのことに、手をつけてたね。少しずつでも、進んでるよ。"],
    listHead: ["やったこと：", "やったことを並べてみたよ："],
    gym: ["ジムに着いた日は{d}日。", "ジムに着いた日が{d}日あったよ。", "{d}日、ジムに着いたね。"],
    mood: ["{name}のあと、気分が上がってたね。", "{name}のあと、少し気分が軽くなってたみたい。"],
    note: ["「{q}」って書いてたね。", "「{q}」って、次の自分に残してたね。"],
    total: ["これまでに埋めたマスは、全部で{n}マス。", "積み上がったマスは、これで{n}マス。"],
    closeLatest: ["今週も、1マスずつでいいからね。", "今週も、できる分だけでいいからね。", "今週も、ここで見てるね。"],
    close: ["これからも、1マスずつでいいからね。", "また、できる分だけでいいからね。", "ここで、ずっと見てるね。"]
  };

  /* o: { week: "先週" など, latest: 一番新しい週か, welcome: 書き出しを「おかえり。」にするか, rng } */
  function letterLines(a, o) {
    var rng = o.rng || Math.random;
    var v = { week: o.week || "先週", n: a.boxes, b: a.bonus, f: a.finished, t: a.touched, d: a.gymDays };
    var lines = [];
    lines.push((o.welcome ? "おかえり。" : "") + fill(pick(LINES.open, rng), v));
    if (a.boxes) lines.push(fill(pick(LINES.boxes, rng), v) + (a.bonus ? fill(pick(LINES.bonus, rng), v) : "") + "。");
    if (a.finished && a.touched > a.finished) lines.push(fill(pick(LINES.finishedSome, rng), v));
    else if (a.finished) lines.push(fill(pick(LINES.finishedAll, rng), v));
    else if (a.touched) lines.push(fill(pick(LINES.touchedOnly, rng), v));
    if (a.tasks.length) {
      lines.push(pick(LINES.listHead, rng));
      a.tasks.forEach(function (t) { lines.push("・" + t); });
    }
    if (a.gymDays) lines.push(fill(pick(LINES.gym, rng), v));
    if (a.moodUps.length) lines.push(fill(pick(LINES.mood, rng), { name: pick(a.moodUps, rng) }));
    if (a.notes.length) lines.push(fill(pick(LINES.note, rng), { q: pick(a.notes, rng) }));
    if (a.total) lines.push(fill(pick(LINES.total, rng), { n: a.total }));
    lines.push(pick(o.latest ? LINES.closeLatest : LINES.close, rng));
    return lines;
  }

  /* まだたよりの無い「1マス以上埋めた週」の分を作り、data に足す。作ったたよりを古い順に返す。
   *  ・今の週の分は作らない(週が終わってから)。
   *  ・一番新しいたよりの週より前の週は作らない(一度作った後で消したり、読み込みで増えた昔の週)。
   *  ・o.welcome なら、一番新しい1通の書き出しを「おかえり。」にする。 */
  function makeLetters(binder, data, now, o) {
    o = o || {};
    now = now || new Date();
    var current = weekStartKey(now);
    var prev = addDays(current, -7);
    var latest = newestLetter(data);
    var weeks = activeWeeks(binder.sheets).filter(function (w) {
      return w < current && !findLetter(data, w) && (!latest || w > latest.weekStart);
    });
    var made = [];
    weeks.forEach(function (w, i) {
      var a = weekActivity(binder.sheets, w);
      if (!a.boxes) return;
      var newest = i === weeks.length - 1;
      var letter = {
        weekStart: w,
        createdAt: now.toISOString(),
        readAt: null,
        lines: letterLines(a, {
          week: w === prev ? "先週" : shortDate(w) + "からの週",
          latest: newest && w === prev,
          welcome: !!o.welcome && newest,
          rng: o.rng
        })
      };
      data.letters.push(letter);
      made.push(letter);
    });
    if (data.letters.length > LETTERS_MAX) data.letters = data.letters.slice(-LETTERS_MAX);
    return made;
  }

  /* ── はなまる ─────────────────────────────────
   * 難しかった日ほど豪華にする(難易度 0〜100 → 3段階。ご褒美レベルの 1〜2 / 3〜4 / 5〜6 のあたり)。
   * 形は 100×100 の中の線。真ん中のうずまきから、そのまま外側の花びらを一筆で描く。
   * 3段目は花びらをもう一周重ね、まわりに小さな線を足す。 */
  var TIERS = [
    { petals: 5, R: 22, A: 16, turns: 1.5, rings: 1, sparkle: false },
    { petals: 7, R: 25, A: 13, turns: 2, rings: 1, sparkle: false },
    { petals: 8, R: 24, A: 12, turns: 2, rings: 2, sparkle: true }
  ];
  function hanamaruTier(difficulty) {
    if (typeof difficulty !== "number" || !isFinite(difficulty)) return 1;
    if (difficulty >= 58) return 3;
    if (difficulty >= 34) return 2;
    return 1;
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function toPath(pts) {
    var len = 0;
    var d = pts.map(function (p, i) {
      if (i) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      return (i ? "L" : "M") + r1(p[0]) + " " + r1(p[1]);
    }).join("");
    return { d: d, len: Math.round(len) };
  }
  // 花びらの輪: 半径 R の円に、丸い山を petals 個のせる。rot の向き(谷)から描き始める
  function petalPoints(petals, R, A, rot, cx, cy) {
    var n = petals * 40, pts = [];
    for (var k = 0; k <= n; k++) {
      var t = 2 * Math.PI * k / n;
      var r = R + A * Math.pow(Math.abs(Math.sin(petals * t / 2)), 0.6);
      pts.push([cx + r * Math.cos(t + rot), cy + r * Math.sin(t + rot)]);
    }
    return pts;
  }
  function hanamaruPaths(tier) {
    var c = TIERS[Math.max(1, Math.min(3, tier || 1)) - 1];
    var cx = 50, cy = 50;
    // 真ん中のうずまき(内側から外へ)。終わった向きから、花びらの谷へそのままつなぐ
    var start = -1.9, end = start + 2 * Math.PI * c.turns, inner = c.R - 8;
    var pts = [], steps = Math.round(40 * c.turns);
    for (var k = 0; k <= steps; k++) {
      var f = k / steps, th = start + (end - start) * f, r = 3 + (inner - 3) * f;
      pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    }
    var paths = [toPath(pts.concat(petalPoints(c.petals, c.R, c.A, end, cx, cy)))];
    if (c.rings > 1) {
      // 花びらの間に、ひとまわり大きい花びらを重ねる
      paths.push(toPath(petalPoints(c.petals, c.R + 4, c.A + 2, end + Math.PI / c.petals, cx, cy)));
    }
    if (c.sparkle) {
      [[88, 14, 95, 6], [91, 25, 99, 23], [79, 8, 81, 1]].forEach(function (s) {
        paths.push(toPath([[s[0], s[1]], [s[2], s[3]]]));
      });
    }
    return paths;
  }
  // 書きかけの紙に付ける小さな赤丸(ペンで描いたような、少し重なる丸)
  function redCirclePath() {
    var pts = [], a0 = -0.35, a1 = 2 * Math.PI + 0.5, n = 56;
    for (var k = 0; k <= n; k++) {
      var t = a0 + (a1 - a0) * k / n;
      var r = 1 + 0.05 * Math.sin(2 * t + 0.6) + 0.02 * (k / n);
      var x = 38 * r * Math.cos(t), y = 33 * r * Math.sin(t), rot = -0.2;
      pts.push([50 + x * Math.cos(rot) - y * Math.sin(rot), 52 + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return toPath(pts);
  }

  return {
    KEY: KEY,
    WELCOME_DAYS: WELCOME_DAYS,
    WELCOME_WORDS: WELCOME_WORDS,
    LINES: LINES,
    weekStartKey: weekStartKey,
    weekOfIso: weekOfIso,
    weekLabel: weekLabel,
    addDays: addDays,
    gapDays: gapDays,
    welcomeDue: welcomeDue,
    bumpLevel: bumpLevel,
    emptyLetters: emptyLetters,
    checkLetters: checkLetters,
    findLetter: findLetter,
    newestLetter: newestLetter,
    unreadLetter: unreadLetter,
    weekActivity: weekActivity,
    activeWeeks: activeWeeks,
    letterLines: letterLines,
    makeLetters: makeLetters,
    hanamaruTier: hanamaruTier,
    hanamaruPaths: hanamaruPaths,
    redCirclePath: redCirclePath
  };
});
