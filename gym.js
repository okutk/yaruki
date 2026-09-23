/*
 * やる気の原稿用紙: ジムの日カード(ジムの紙・日付の区切り・お供・今月ジムに着いた日)
 *
 * ブラウザでは window.YarukiGym、node では require("./gym.js") で使う。
 * 画面(DOM)と localStorage には触らない(読み書きは index.html が行う)。
 * テスト: node tests/gym.test.js
 *
 * ── 考え方 ─────────────────────────────────────
 * ・ジムに「着いたら」今日は達成。最初の MAIN_COUNT マスが本体で、4マス目「ジムに着いた」で完。残りはおまけ。
 * ・日付は朝4時で区切る(端末のローカル時刻)。夜中の3時台は前の日として扱う。
 * ・「今日はなし」も、行かなかった日も、どこにも記録しない。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YarukiGym = api;
})(this, function () {
  "use strict";

  var KEY = "genkouyoushi-gym-v1";
  var DAY_START_HOUR = 4;
  var MAIN_COUNT = 4;
  var TEXT_MAX = 60;           // いつ・どうする
  var COMPANION_MAX = 200;     // お供1件(リンクも入るので長め)
  var COMPANIONS_LIMIT = 20;
  var NOTE_MAX = 100;

  var DEFAULT_IF_THEN = {
    weekday: "帰ったら、座る前にジムの服に着替える",
    holiday: "お昼ごはんの前に行く"
  };
  // 休日の最後のご褒美の、最初の候補(「他の案」で変えられる)
  var HOLIDAY_LUNCH = "ジムの後のお昼ごはん。好きなものを食べる";

  /* 難易度の計算(classify.js の difficultyScore)に渡す値。
   * 60分で計算するとふつうでご褒美 Lv5(たっぷり: 半日・5千円くらい)になり、
   * 何度もくり返すことのご褒美としては大きすぎる。本体は「着くまで」なので 15分として計算する
   * → ふつう: 難易度55・Lv4(しっかり) / 軽め: 難易度26・Lv2(ちょっと)。 */
  var PLAN = { heaviness: 4, time: 15, category: "undou" };

  var WEEK = ["日", "月", "火", "水", "木", "金", "土"];

  /* ── マスの文言(カテゴリのテンプレートは使わない) ─────────── */
  // 本体の4マス。1マス目は平日/休日で変わる。3マス目はお供があるかどうかで変わる
  var STEPS = {
    normal: {
      first: { weekday: "座る前に、ジムの服に着替える", holiday: "お昼ごはんの前に、ジムの服に着替える" },
      second: "バッグを持って、靴を履く",
      third: { companion: "玄関を出て、お供を再生する", plain: "玄関を出る" },
      bonus: ["1種目やる", "あとは好きなだけ", "帰ったら、バッグを詰め直して玄関に置く（明日の自分へ）"]
    },
    light: {
      first: { weekday: "座る前に着替える", holiday: "お昼ごはんの前に着替える" },
      second: "靴を履いて、玄関を出る",
      third: { companion: "お供を聴きながら、ジムまで歩く", plain: "ジムまで歩く" },
      bonus: ["ストレッチだけして帰る", "帰ったら、バッグを玄関に戻す（明日の自分へ）"]
    }
  };
  var ARRIVE_STEP = "ジムに着いた";

  // マスを埋めたときのひとこと(4マス目は ARRIVE で大きく褒める)
  var PRAISE = {
    normal: [
      { weekday: "座る前に動けた。それが一番むずかしいところ", holiday: "お昼の前に動けた。それが一番むずかしいところ" },
      "靴まで履けた。もう半分、外にいる",
      "外に出た！",
      null,
      "1種目できた。ここからは全部プラス",
      "好きなだけ、できたね。十分すぎるくらい",
      "明日の自分が、きっと助かる。おかえり"
    ],
    light: [
      { weekday: "座る前に着替えられた。それが一番むずかしいところ", holiday: "着替えられた。それが一番むずかしいところ" },
      "外に出た！",
      "歩いてる。もうすぐ着くよ",
      null,
      "ストレッチまで。体がよろこんでる",
      "明日の自分が、きっと助かる。おかえり"
    ]
  };
  var ARRIVE = [
    "着いた！今日いちばん大変なところは、もう終わってる",
    "玄関を出られた時点で、もう勝ってた",
    "ここから先は全部おまけ。10分で帰ってもいいよ"
  ];

  /* ── 日付(朝4時区切り・端末のローカル時刻) ─────────── */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function keyOf(y, m0, d) { return y + "-" + pad2(m0 + 1) + "-" + pad2(d); }

  // その時刻が属する「日」(YYYY-MM-DD)。4時より前なら前の日
  function dayKey(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (d.getHours() < DAY_START_HOUR) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
    return keyOf(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function isDayKey(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var d = dateOfKey(v);
    return keyOf(d.getFullYear(), d.getMonth(), d.getDate()) === v;
  }
  function dateOfKey(key) {
    return new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), 12);
  }
  function weekdayOf(key) { return dateOfKey(key).getDay(); }        // 0 = 日曜
  function dayNumber(key) {                                          // 日ごとに1ずつ増える通し番号
    return Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86400000);
  }
  // 土日は休日、それ以外は平日
  function defaultDayType(key) {
    var w = weekdayOf(key);
    return w === 0 || w === 6 ? "holiday" : "weekday";
  }

  /* ── 保存データ ─────────────────────────────── */
  function emptyToday(key) {
    return { date: key, dayTypeOverride: null, hidden: false, sheet: null };
  }
  function defaults(now) {
    return {
      version: 1,
      enabled: true,
      days: [0, 1, 2, 3, 4, 5, 6],
      ifThen: { weekday: DEFAULT_IF_THEN.weekday, holiday: DEFAULT_IF_THEN.holiday },
      companions: [],
      companionIndex: 0,
      folded: false,
      today: emptyToday(dayKey(now || new Date()))
    };
  }

  function isoOrNull(v) {
    return typeof v === "string" && v && !isNaN(Date.parse(v)) ? v : null;
  }
  function intIn(v, lo, hi) {
    return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
  }
  function cleanText(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/\s+/g, " ").trim().slice(0, max);
  }
  function ifThenText(v, fallback) { return cleanText(v, TEXT_MAX) || fallback; }
  // 金のマスの番号(0〜n-1 の整数、重複なし、小さい順)
  function goldOf(v, n) {
    if (!Array.isArray(v)) return [];
    var seen = {}, out = [];
    v.forEach(function (i) {
      if (intIn(i, 0, n - 1) === i && !seen[i]) { seen[i] = true; out.push(i); }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  // 今日のジムの紙をそろえる。使えなければ null(カードは「始める前」に戻る)
  function checkSheet(s) {
    if (!s || typeof s !== "object") return null;
    if (typeof s.id !== "string" || !s.id || s.id.length > 64) return null;
    if (!Array.isArray(s.steps) || s.steps.length < MAIN_COUNT || s.steps.length > 12) return null;
    var steps = s.steps.map(function (x) { return String(x == null ? "" : x); });
    var srcDone = Array.isArray(s.done) ? s.done : [];
    var srcRewards = Array.isArray(s.boxRewards) ? s.boxRewards : [];
    var note = typeof s.note === "string" && s.note.trim() ? s.note.slice(0, NOTE_MAX) : null;
    return {
      id: s.id,
      light: s.light === true,
      dayType: s.dayType === "holiday" ? "holiday" : "weekday",
      steps: steps,
      mainCount: MAIN_COUNT,
      done: steps.map(function (_, i) { return srcDone[i] === true; }),
      gold: goldOf(s.gold, steps.length),
      boxRewards: steps.map(function (_, i) { return typeof srcRewards[i] === "string" ? srcRewards[i] : null; }),
      finalReward: typeof s.finalReward === "string" ? s.finalReward : "",
      rewardLocked: s.rewardLocked === true,
      finalUserId: typeof s.finalUserId === "string" && s.finalUserId ? s.finalUserId : null,
      score: intIn(s.score, 0, 100),
      level: intIn(s.level, 1, 6) || 3,
      createdAt: isoOrNull(s.createdAt) || new Date().toISOString(),
      moodBefore: intIn(s.moodBefore, 1, 5),
      moodAfter: intIn(s.moodAfter, 1, 5),
      note: note
    };
  }

  // 保存データを読み込める形にそろえ、日付が変わっていれば新しい日にする。形がおかしければ初期値
  function check(raw, now) {
    now = now || new Date();
    var g = defaults(now);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return g;
    g.enabled = raw.enabled !== false;
    if (Array.isArray(raw.days)) {
      g.days = [0, 1, 2, 3, 4, 5, 6].filter(function (d) { return raw.days.indexOf(d) !== -1; });
    }
    if (raw.ifThen && typeof raw.ifThen === "object") {
      g.ifThen.weekday = ifThenText(raw.ifThen.weekday, DEFAULT_IF_THEN.weekday);
      g.ifThen.holiday = ifThenText(raw.ifThen.holiday, DEFAULT_IF_THEN.holiday);
    }
    if (Array.isArray(raw.companions)) {
      g.companions = raw.companions.map(function (c) { return cleanText(c, COMPANION_MAX); })
        .filter(Boolean).slice(0, COMPANIONS_LIMIT);
    }
    g.companionIndex = intIn(raw.companionIndex, 0, 1e6) || 0;
    g.folded = raw.folded === true;
    var t = raw.today;
    if (t && typeof t === "object" && isDayKey(t.date)) {
      g.today = {
        date: t.date,
        dayTypeOverride: t.dayTypeOverride === "weekday" || t.dayTypeOverride === "holiday" ? t.dayTypeOverride : null,
        hidden: t.hidden === true,
        sheet: checkSheet(t.sheet)
      };
      if (g.today.sheet) g.today.hidden = false;   // 紙があるときは隠さない(「今日はなし」は紙を片付けてから隠す)
    }
    rollover(g, now);
    return g;
  }

  /* 日付が変わっていたら(朝4時を過ぎたら)、今日の状態を新しい日にする。g を書き換える。
   * 前の日の紙は、1マス以上埋まっていればもう綴じ帳に入っている(index.html がマスのたびに写している)。
   * 戻り値: 新しい日にしたら true */
  function rollover(g, now) {
    var key = dayKey(now || new Date());
    if (g.today && g.today.date === key) return false;
    g.today = emptyToday(key);
    g.folded = false;
    return true;
  }

  /* ── 今日のようす ───────────────────────────── */
  function dayType(g) {
    return g.today.dayTypeOverride || defaultDayType(g.today.date);
  }
  function isGymDay(g) {
    return g.days.indexOf(weekdayOf(g.today.date)) !== -1;
  }
  // カードを出すか: 今日の紙があれば(ショートカットで始めた日も)出す。
  // 無ければ、機能が ON・選んだ曜日・「今日はなし」にしていない、がそろったときだけ
  function cardVisible(g) {
    if (g.today.hidden) return false;
    if (g.today.sheet) return true;
    return g.enabled && isGymDay(g);
  }

  // 今日のお供。日替わりで順番に出す(companionIndex は「他のお供」で進めた分)
  function companionFor(g) {
    var n = g.companions.length;
    if (!n) return null;
    var i = ((dayNumber(g.today.date) + g.companionIndex) % n + n) % n;
    return g.companions[i];
  }
  function nextCompanion(g) {
    var n = g.companions.length;
    if (n < 2) return false;
    g.companionIndex = (g.companionIndex + 1) % n;
    return true;
  }
  function isUrl(text) {
    return typeof text === "string" && /^https?:\/\/[^\s<>"]+$/i.test(text.trim());
  }

  /* ── ジムの紙 ───────────────────────────────── */
  function buildSteps(light, type, hasCompanion) {
    var t = light ? STEPS.light : STEPS.normal;
    return [
      t.first[type === "holiday" ? "holiday" : "weekday"],
      t.second,
      hasCompanion ? t.third.companion : t.third.plain,
      ARRIVE_STEP
    ].concat(t.bonus);
  }

  // 難易度とご褒美レベル。C は classify.js(YarukiClassify)
  function plan(C, light) {
    var base = C.FALLBACK.base;
    C.CATEGORIES.forEach(function (c) { if (c.id === PLAN.category) base = c.base; });
    var score = C.difficultyScore({ heaviness: PLAN.heaviness, time: PLAN.time, energy: light ? 1 : 2, base: base });
    return { score: score, level: C.rewardLevel(score) };
  }

  // 新しいジムの紙。ご褒美(boxRewards / finalReward)は index.html が引く。gold: 金のマスの番号(index.html が決める)
  function newSheet(o) {
    var steps = buildSteps(o.light, o.dayType, o.hasCompanion);
    return {
      id: o.id,
      light: !!o.light,
      dayType: o.dayType === "holiday" ? "holiday" : "weekday",
      steps: steps,
      mainCount: MAIN_COUNT,
      done: steps.map(function () { return false; }),
      gold: goldOf(o.gold, steps.length),
      boxRewards: steps.map(function () { return null; }),
      finalReward: "",
      rewardLocked: !!o.rewardLocked,
      finalUserId: null,
      score: o.score == null ? null : o.score,
      level: o.level || 3,
      createdAt: o.createdAt,
      moodBefore: null,
      moodAfter: null,
      note: null
    };
  }

  function count(arr) {
    var n = 0;
    arr.forEach(function (d) { if (d === true) n++; });
    return n;
  }
  function mainDone(s) { return count(s.done.slice(0, s.mainCount)); }
  function arrived(s) { return mainDone(s) === s.mainCount; }
  function doneCount(s) { return count(s.done); }
  function bonus(s) {
    return { done: count(s.done.slice(s.mainCount)), total: s.steps.length - s.mainCount };
  }
  function isBonus(s, i) { return i >= s.mainCount; }

  // i マス目を埋めたときのひとこと(4マス目は null。完成の欄で大きく褒める)
  function praiseFor(s, i) {
    var p = (s.light ? PRAISE.light : PRAISE.normal)[i];
    if (p && typeof p === "object") p = p[s.dayType === "holiday" ? "holiday" : "weekday"];
    return p || null;
  }
  // 着いたときの言葉。紙ごとに決まる(開き直しても変わらない)。sub は「おまけ」のことを必ず伝える
  function arriveWords(id) {
    var h = 0;
    String(id || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    var i = h % ARRIVE.length;
    return { main: ARRIVE[i], sub: i === 2 ? ARRIVE[1] : ARRIVE[2] };
  }

  /* ── 今月ジムに着いた日(綴じ帳の記録から。分母は出さない) ──
   * kind が gym で completedAt がある記録を、紙を作った日(朝4時区切り)で重複なしに数える */
  function arrivedDaysThisMonth(sheets, now) {
    var month = dayKey(now || new Date()).slice(0, 7);
    var seen = {}, n = 0;
    (sheets || []).forEach(function (s) {
      if (!s || s.kind !== "gym" || !s.completedAt || !isoOrNull(s.createdAt)) return;
      var k = dayKey(new Date(s.createdAt));
      if (k.slice(0, 7) !== month || seen[k]) return;
      seen[k] = true;
      n++;
    });
    return n;
  }

  return {
    KEY: KEY,
    DAY_START_HOUR: DAY_START_HOUR,
    MAIN_COUNT: MAIN_COUNT,
    TEXT_MAX: TEXT_MAX,
    COMPANION_MAX: COMPANION_MAX,
    COMPANIONS_LIMIT: COMPANIONS_LIMIT,
    DEFAULT_IF_THEN: DEFAULT_IF_THEN,
    HOLIDAY_LUNCH: HOLIDAY_LUNCH,
    PLAN: PLAN,
    WEEK: WEEK,
    STEPS: STEPS,
    PRAISE: PRAISE,
    ARRIVE: ARRIVE,
    dayKey: dayKey,
    isDayKey: isDayKey,
    dateOfKey: dateOfKey,
    dayNumber: dayNumber,
    weekdayOf: weekdayOf,
    defaultDayType: defaultDayType,
    defaults: defaults,
    checkSheet: checkSheet,
    check: check,
    rollover: rollover,
    dayType: dayType,
    isGymDay: isGymDay,
    cardVisible: cardVisible,
    companionFor: companionFor,
    nextCompanion: nextCompanion,
    isUrl: isUrl,
    cleanText: cleanText,
    buildSteps: buildSteps,
    plan: plan,
    newSheet: newSheet,
    mainDone: mainDone,
    arrived: arrived,
    doneCount: doneCount,
    bonus: bonus,
    isBonus: isBonus,
    praiseFor: praiseFor,
    arriveWords: arriveWords,
    arrivedDaysThisMonth: arrivedDaysThisMonth
  };
});
