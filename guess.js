/*
 * やる気の原稿用紙: 分類がわからないときに、質問で一緒に決める(アキネーター形式)
 *
 * 入力からカテゴリが決まらなかった(classify の結果が「その他」)ときに、
 * 「はい・いいえ・どちらでもない」で答えられる質問を1つずつ出して、カテゴリを絞り込む。
 * ブラウザでは window.YarukiGuess、node では require("./guess.js") で使う。
 * 画面(DOM)には触らない。テスト: node tests/guess.test.js
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YarukiGuess = api;
})(this, function () {
  "use strict";

  var YES = "yes", NO = "no", MAYBE = "maybe";
  var OTHER = "other";

  /* ────────────────────────────────────────────────
   * 1. 質問
   *
   * 画面では「『(入力)』のこと、」の下に text を出す。
   * やさしい言い方で、1つの質問では1つのことだけを聞く。
   * 画面は「、」の後ろと「（」の前でだけ折り返すので、「、」の無い文は短く(スマホで1行に収まる15文字くらいまで)。
   * 並び順は、情報量が同じときに先に出す順(答えやすいものを前に)。
   * ──────────────────────────────────────────────── */
  var QUESTIONS = [
    { id: "home", text: "おうちの中でできること？" },
    { id: "out", text: "外に出かけること？" },
    { id: "people", text: "だれかと関わること？（話す・会う・送る など）" },
    { id: "screen", text: "スマホやパソコンを使うこと？" },
    { id: "body", text: "体を動かすこと？" },
    { id: "fun", text: "自分の楽しみのためにやること？" },
    { id: "money", text: "お金が関係すること？" },
    { id: "work", text: "お仕事に関係すること？" },
    { id: "food", text: "食べ物や飲み物に関係すること？" },
    { id: "learn", text: "何かを覚えたり、学んだりすること？" },
    { id: "create", text: "何かを作ったり、書いたり描いたりすること？" },
    { id: "health", text: "体や心を、いたわるためのこと？" },
    { id: "routine", text: "毎日や毎週、くり返しやること？" },
    { id: "clean", text: "汚れを落として、きれいにすること？" },
    { id: "tidy", text: "物をしまったり、減らしたりすること？" },
    { id: "cloth", text: "服やタオル・シーツなど、布ものに関係すること？" },
    { id: "paper", text: "書類や手続きが関係すること？" },
    { id: "deadline", text: "期限や締め切りがあること？" },
    { id: "buy", text: "何かを買ったり、手に入れたりすること？" },
    { id: "read", text: "本や文章を読むこと？" },
    { id: "looks", text: "自分の見た目や、身だしなみのこと？" },
    { id: "practice", text: "上手になりたくて、練習していること？" },
    { id: "reply", text: "返事を、待っている人がいる？" },
    { id: "meet", text: "だれかと会うこと？" },
    { id: "trip", text: "遠くへ行ったり、泊まったりすること？" },
    { id: "plan", text: "予定や計画を考えること？" },
    { id: "rest", text: "ゆっくり休むためのこと？" },
    { id: "doctor", text: "お医者さんなど、専門の人にみてもらうこと？" },
    { id: "job", text: "新しい働き口を探したり、仕事を変えたりすること？" },
    { id: "move", text: "住む場所が変わること？" },
    { id: "code", text: "プログラムやコードに関係する？" },
    { id: "chore", text: "家事のひとつ？" },
    { id: "bath", text: "お風呂やシャワーのこと？" },
    { id: "trash", text: "ゴミに関係すること？" },
    { id: "mail", text: "郵便や、届いたもののこと？" },
    { id: "morning", text: "朝、起きるときのこと？" },
    { id: "night", text: "夜、寝るときのこと？" },
    { id: "broken", text: "家の中で、直したい所のこと？" }
  ];

  /* ────────────────────────────────────────────────
   * 2. カテゴリごとの答え方(PROFILES)
   *
   * 「質問id:記号」を空白区切りで並べる。書いていない質問は、ほぼ「いいえ」(DEFAULT_P)。
   *   Y = ほぼ「はい」 / y = 「はい」寄り / m = どちらとも / n = 「いいえ」寄り
   * カテゴリを増やしたら、ここにも1行足す(足し忘れは tests/guess.test.js で落ちる)。
   * ──────────────────────────────────────────────── */
  var LEVEL = { Y: 0.92, y: 0.72, m: 0.5, n: 0.26 };
  var DEFAULT_P = 0.08;
  var PROFILES = {
    souji: "home:Y out:n body:y clean:Y tidy:m routine:m chore:Y bath:n trash:n",
    katazuke: "home:Y body:y tidy:Y chore:y clean:m cloth:m trash:m screen:n money:n buy:n routine:n deadline:n",
    ryouri: "home:Y food:Y create:y routine:y chore:y fun:m body:n buy:n health:n morning:n night:n",
    sentaku: "home:Y out:n cloth:Y clean:Y routine:Y chore:Y body:m tidy:m looks:n",
    kaji: "home:Y out:n routine:Y chore:Y clean:m tidy:m body:m food:n cloth:n people:n deadline:n trash:n broken:n",
    shorui: "paper:Y deadline:Y home:m out:m screen:m money:m people:n read:m reply:n mail:n",
    okane: "money:Y deadline:Y home:y screen:y paper:m routine:m out:n mail:n",
    renraku: "people:Y reply:Y screen:Y home:Y work:m deadline:m routine:m read:m mail:n",
    shigoto: "work:Y screen:y deadline:y home:m out:m people:m create:m paper:m routine:m reply:m meet:m plan:m read:n",
    benkyou: "learn:Y read:y home:y deadline:y out:n practice:y screen:m routine:m create:n paper:n",
    dokusho: "read:Y home:Y fun:y learn:m out:n screen:n rest:n routine:m",
    sousaku: "create:Y home:Y fun:y screen:m practice:m deadline:n learn:n",
    shumi: "practice:Y fun:Y home:y learn:y body:m routine:m create:m out:n people:n",
    undou: "body:Y health:Y routine:y out:y home:m practice:m fun:m morning:n",
    tsuuin: "doctor:Y out:Y health:Y people:m deadline:m money:n paper:n meet:m",
    kenkou: "health:Y routine:Y home:Y body:m rest:m food:n morning:n night:n",
    mijitaku: "looks:Y home:Y routine:Y clean:m cloth:m health:n out:n money:n morning:m night:n bath:n",
    kaimono: "buy:Y money:Y out:y home:m chore:m screen:m food:m fun:m cloth:n routine:m mail:n",
    ryokou: "trip:Y out:Y fun:Y plan:Y money:y people:m screen:m meet:m deadline:m body:m buy:n",
    goraku: "fun:Y out:y plan:y home:m buy:m money:m people:m screen:m meet:m deadline:m rest:n",
    hitozukiai: "people:Y meet:y home:m out:m reply:y plan:m fun:m buy:n food:n create:n mail:n",
    shukatsu: "job:Y work:y paper:y deadline:y screen:y people:m meet:m out:m home:m create:m read:n learn:n",
    programming: "code:Y screen:Y create:Y home:Y learn:m work:m practice:m broken:n",
    hikkoshi: "move:Y chore:m paper:y money:y tidy:y deadline:y body:y out:m home:m plan:m people:m buy:m",
    ofuro: "bath:Y home:Y clean:Y routine:Y health:y looks:m body:m rest:m night:m",
    gomi: "trash:Y home:Y routine:Y chore:Y tidy:y body:m clean:m out:m deadline:m",
    yuubin: "mail:Y home:Y chore:m paper:y read:y deadline:m money:m tidy:m reply:m out:n",
    taberu: "food:Y health:y home:y routine:y buy:m rest:n",
    okiru: "morning:Y home:Y routine:Y health:y body:m",
    neru: "night:Y rest:Y home:Y routine:Y health:y",
    shuuri: "broken:Y home:Y chore:y people:m money:m deadline:m body:m screen:m paper:n",
    keikaku: "plan:Y home:y create:m screen:m work:m deadline:m routine:m read:n"
  };

  var TABLE = {};   // TABLE[カテゴリid][質問id] = 「はい」になりやすさ(0〜1)
  (function buildTable() {
    Object.keys(PROFILES).forEach(function (id) {
      var row = {};
      QUESTIONS.forEach(function (q) { row[q.id] = DEFAULT_P; });
      PROFILES[id].split(/\s+/).forEach(function (entry) {
        if (!entry) return;
        var m = entry.split(":");
        if (!(m[0] in row) || !(m[1] in LEVEL)) throw new Error("guess.js PROFILES の書き間違い: " + id + " " + entry);
        row[m[0]] = LEVEL[m[1]];
      });
      TABLE[id] = row;
    });
  })();
  function pOf(id, qid) {
    var row = TABLE[id];
    return row ? row[qid] : LEVEL.m;   // 表に無いカテゴリは、どの答えでも同じ
  }

  /* ────────────────────────────────────────────────
   * 3. 答えの起こりやすさ
   *
   * 「はい」になりやすさ p のカテゴリで、それぞれの答えが返ってくる確率:
   *   どちらでもない = u(p) = 0.12 + 0.33 × (1 − |2p − 1|)   (p が 0.5 に近いほど「どちらでもない」も出やすい)
   *   はい           = p × (1 − u)
   *   いいえ         = (1 − p) × (1 − u)
   * p は 0.06〜0.92 に収めてあるので、1回答えを間違えても正しいカテゴリが消えてしまうことはない。
   * ──────────────────────────────────────────────── */
  function likelihood(p, a) {
    var u = 0.12 + 0.33 * (1 - Math.abs(2 * p - 1));
    if (a === MAYBE) return u;
    return (a === YES ? p : 1 - p) * (1 - u);
  }

  /* ────────────────────────────────────────────────
   * 4. 入力の文から分かること(HINTS)
   *
   * 入力に「行く」などがあれば、はじめから少しだけそちらに寄せておく(weight は答え1回分の何割か)。
   * skip: true の質問は、答えが文から明らかなので聞かない。
   * ──────────────────────────────────────────────── */
  var HINTS = [
    { re: /(に|へ)(行|い)[くきけっこ]|行って|出かけ|でかけ|寄る|向かう|取りに/, q: { out: YES, home: NO }, weight: 0.7, skip: true },
    { re: /スマホ|すまほ|パソコン|ぱそこん|pc|ネット|アプリ|設定|wi-?fi|オンライン/, q: { screen: YES }, weight: 0.7, skip: true },
    { re: /(と|に)(話|会|相談)|誘|みんな|家族|友|子ども|子供|こども|親|母|父|夫|妻|彼氏|彼女/, q: { people: YES }, weight: 0.5, skip: false },
    { re: /休|寝|ぼーっ|ぼんやり|だらだら|ごろごろ|ゴロゴロ|のんびり/, q: { rest: YES }, weight: 0.5, skip: false }
  ];

  /* ────────────────────────────────────────────────
   * 5. 進め方
   *
   *   ・一番ありそうなカテゴリが GUESS_AT 以上になったら「もしかして○○？」と聞く(MIN_QUESTIONS 問以上答えてから)
   *   ・「ちがう」と言われたら、そのカテゴリを外して、もう1問以上聞いてから次を当てにいく
   *   ・どのカテゴリにも、はっきり食い違う答え(ほぼ「はい」のはずが「いいえ」、またはその逆)が
   *     NONE_CONFLICTS 個以上あれば、「ぴったりの分類はなさそう」と伝える(none。「その他」をすすめる)
   *   ・MAX_QUESTIONS 問聞いても決まらない、MAX_GUESSES 回外した、聞ける質問が無い
   *     → 近い順の候補を並べて、選んでもらう(choose)
   *   ・最初の質問は FIRST_QUESTION(答えやすく、家のこととそれ以外に大きく分けられる)。2問目からは、答えたあとに一番絞り込めそうな質問
   * 質問の数はなるべく少なく(答える気力を使い切らないように)。
   * ──────────────────────────────────────────────── */
  var GUESS_AT = 0.5;
  var NONE_CONFLICTS = 2;
  var MIN_QUESTIONS = 2;
  var MAX_QUESTIONS = 8;
  var MAX_GUESSES = 2;
  var FIRST_QUESTION = "chore";

  function norm(s) {
    s = String(s == null ? "" : s);
    if (s.normalize) s = s.normalize("NFKC");
    return s.toLowerCase().replace(/\s+/g, "");
  }

  // ids: カテゴリの id の並び(classify.js の CATEGORIES の順)。省くと PROFILES の順
  function start(task, ids) {
    var text = norm(task);
    var hints = [], skip = {};
    HINTS.forEach(function (h) {
      if (!h.re.test(text)) return;
      Object.keys(h.q).forEach(function (qid) {
        hints.push({ q: qid, a: h.q[qid], w: h.weight });
        if (h.skip) skip[qid] = true;
      });
    });
    return {
      task: String(task == null ? "" : task),
      ids: (ids && ids.length ? ids.slice() : Object.keys(PROFILES)).filter(function (id) { return id !== OTHER; }),
      hints: hints,
      skip: skip,
      history: []   // { t: "a", q, a } = 質問への答え / { t: "r", id } = 「もしかして」を外した
    };
  }

  function answered(s) {
    var out = {};
    s.hints.forEach(function (h) { if (s.skip[h.q]) out[h.q] = true; });
    s.history.forEach(function (x) { if (x.t === "a") out[x.q] = true; });
    return out;
  }
  function rejected(s) {
    var out = {};
    s.history.forEach(function (x) { if (x.t === "r") out[x.id] = true; });
    return out;
  }
  function questionCount(s) {
    return s.history.filter(function (x) { return x.t === "a"; }).length;
  }
  function guessCount(s) {
    return s.history.filter(function (x) { return x.t === "r"; }).length;
  }
  // 最後に外してから答えた数(まだ外していなければ、全部の答えの数)
  function sinceReject(s) {
    var n = 0;
    for (var i = s.history.length - 1; i >= 0; i--) {
      if (s.history[i].t === "r") break;
      n++;
    }
    return n;
  }

  // 今の答えから、カテゴリごとの確からしさ(合計 1)。外したカテゴリは入れない。大きい順(同じなら ids の順)
  function posterior(s) {
    var out = normalizeScores(logScores(s));
    var order = out.map(function (x) { return x.id; });
    out.sort(function (a, b) { return b.p - a.p || order.indexOf(a.id) - order.indexOf(b.id); });
    return out;
  }

  // 外していないカテゴリごとの、今までの答えから見た log(起こりやすさ)。並びは ids の順
  function logScores(s) {
    var rej = rejected(s);
    return s.ids.filter(function (id) { return !rej[id]; }).map(function (id) {
      var l = 0;
      s.hints.forEach(function (h) { l += h.w * Math.log(likelihood(pOf(id, h.q), h.a)); });
      s.history.forEach(function (x) { if (x.t === "a") l += Math.log(likelihood(pOf(id, x.q), x.a)); });
      return { id: id, l: l };
    });
  }
  // log(起こりやすさ) → 確からしさ(合計 1)。並びはそのまま
  function normalizeScores(list) {
    if (!list.length) return [];
    var max = Math.max.apply(null, list.map(function (x) { return x.l; }));
    var ws = list.map(function (x) { return Math.exp(x.l - max); });
    var sum = ws.reduce(function (a, b) { return a + b; }, 0);
    return list.map(function (x, i) { return { id: x.id, p: ws[i] / sum }; });
  }

  function entropy(list) {
    return list.reduce(function (h, x) { return x.p > 0 ? h - x.p * Math.log(x.p) : h; }, 0);
  }

  // 答えたあとに一番絞り込めそうな質問(答えたあとの不確かさの見込みが一番小さいもの)
  function bestQuestion(s) {
    var done = answered(s);
    if (!s.history.length && !done[FIRST_QUESTION]) return questionById(FIRST_QUESTION);
    var base = logScores(s);
    var post = normalizeScores(base);
    var best = null, bestH = Infinity;
    QUESTIONS.forEach(function (q) {
      if (done[q.id]) return;
      var h = 0;
      [YES, NO, MAYBE].forEach(function (a) {
        var pa = 0;
        var after = base.map(function (x, i) {
          var lk = likelihood(pOf(x.id, q.id), a);
          pa += post[i].p * lk;
          return { id: x.id, l: x.l + Math.log(lk) };
        });
        if (pa > 0) h += pa * entropy(normalizeScores(after));
      });
      if (h < bestH - 1e-9) { bestH = h; best = q; }
    });
    return best;
  }

  // 近そうなカテゴリ(外したものは入れない)。n 個まで
  function candidates(s, n) {
    return posterior(s).slice(0, n || 4);
  }

  // はっきり食い違う答えの数(ほぼ「はい」(Y)のはずが「いいえ」、ほぼ「いいえ」(書いていない質問)のはずが「はい」)
  function conflicts(s, id) {
    var n = 0;
    s.history.forEach(function (x) {
      if (x.t !== "a") return;
      var p = pOf(id, x.q);
      if ((x.a === NO && p >= LEVEL.Y) || (x.a === YES && p <= DEFAULT_P)) n++;
    });
    return n;
  }
  // どのカテゴリにも食い違いが NONE_CONFLICTS 個以上ある(ぴったりの分類がなさそう)
  function fitsNone(s) {
    var rej = rejected(s);
    return s.ids.every(function (id) { return rej[id] || conflicts(s, id) >= NONE_CONFLICTS; });
  }

  /*
   * 次にすること:
   *   { type: "question", question: {id, text}, number }  … 質問する(number は何問目か)
   *   { type: "guess", id, p }                             … 「もしかして○○？」
   *   { type: "none", candidates }                          … ぴったりの分類はなさそう(その他をすすめる)
   *   { type: "choose", candidates }                        … 近い順に並べて選んでもらう
   */
  function next(s) {
    var asked = questionCount(s);
    var top = posterior(s)[0];
    var ready = asked >= MIN_QUESTIONS && sinceReject(s) >= 1;
    if (!top) return { type: "none", candidates: [] };
    if (ready && fitsNone(s)) return { type: "none", candidates: candidates(s, 3) };
    if (ready && top.p >= GUESS_AT && guessCount(s) < MAX_GUESSES) {
      return { type: "guess", id: top.id, p: top.p };
    }
    var q = asked < MAX_QUESTIONS && guessCount(s) < MAX_GUESSES ? bestQuestion(s) : null;
    if (!q) return { type: "choose", candidates: candidates(s, 4) };
    return { type: "question", question: q, number: asked + 1 };
  }

  function answer(s, qid, a) {
    if (a !== YES && a !== NO && a !== MAYBE) throw new Error("答えは yes / no / maybe: " + a);
    s.history.push({ t: "a", q: qid, a: a });
    return s;
  }
  function reject(s, id) {
    s.history.push({ t: "r", id: id });
    return s;
  }
  // ひとつ戻る(最後の答えか「ちがう」を取り消す)。戻せたら true
  function undo(s) {
    return s.history.pop() !== undefined;
  }

  // 一番ありそうなカテゴリの確からしさ(0〜1)。画面の「わかってきた」の目安に使う
  function confidence(s) {
    var c = candidates(s, 1)[0];
    return c ? c.p : 0;
  }

  function questionById(id) {
    for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].id === id) return QUESTIONS[i];
    return null;
  }

  return {
    YES: YES, NO: NO, MAYBE: MAYBE, OTHER: OTHER,
    QUESTIONS: QUESTIONS,
    PROFILES: PROFILES,
    HINTS: HINTS,
    GUESS_AT: GUESS_AT,
    NONE_CONFLICTS: NONE_CONFLICTS,
    MIN_QUESTIONS: MIN_QUESTIONS,
    MAX_QUESTIONS: MAX_QUESTIONS,
    MAX_GUESSES: MAX_GUESSES,
    FIRST_QUESTION: FIRST_QUESTION,
    pOf: pOf,
    likelihood: likelihood,
    start: start,
    next: next,
    answer: answer,
    reject: reject,
    undo: undo,
    posterior: posterior,
    candidates: candidates,
    conflicts: conflicts,
    confidence: confidence,
    questionCount: questionCount,
    guessCount: guessCount,
    questionById: questionById
  };
});
