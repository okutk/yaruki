// ご褒美の文の「不自然な形」を機械で見つけるテスト。全部の組み合わせを作って、形のルールで調べる。
// 見つけたいのは、前後が食い違う・無用な繰り返しが続く・動作が長く連なる、といった形。
// 「深呼吸をひとつ」「好きな飲み物をひと口飲む」のような、やわらかい言い回しは不自然として扱わない
// (ご褒美は「これならやってもいいかも」と思える言い方にしたいので、言い回しをそろえすぎない)。
// 実行: node tests/rewards-lint.test.js
//   --list          見つかった文をすべて表示する(ふだんは各ルール5件まで)
//   --rewards PATH  別の rewards.js を調べる(直す前と後を比べるとき)
"use strict";
var path = require("path");
var argv = process.argv.slice(2);
var modArg = argv.indexOf("--rewards");
var R = require(modArg !== -1 ? path.resolve(argv[modArg + 1]) : path.join(__dirname, "..", "rewards.js"));
var LIST_ALL = argv.indexOf("--list") !== -1;

function count(text, re) {
  var m = text.match(re);
  return m ? m.length : 0;
}

// 時を表す言葉(長いものから順に当てる。「今週末」を「今週」と「週末」の2つに数えない)
var TIME_WORDS = /今週末|今週中|今週|週末|今月|次の連休|連休|次の休み|近いうち|今日|今夜|寝る前|明日|このあと|ひと息ついたら/g;
// 動作のつなぎ(「だらだら」の「だら」は数えない)
var STEP_WORDS = /てから|でから|たら|だら|たあとで|だあとで|[てで]、/g;
// 言葉の重なり(同じ動詞や名詞が2回出てくる)
var REPEATS = [
  ["飲", /飲(?!み物)/g], ["食べ", /食べ/g], ["見", /見/g], ["眺め", /眺め/g], ["聴", /聴/g], ["読", /読/g],
  ["いれ", /いれ/g], ["入れ", /入れ/g], ["作", /作/g], ["休", /休/g], ["好き", /好き/g], ["お気に入り", /お気に入り/g],
  ["ゆっくり", /ゆっくり/g], ["少し", /少し/g], ["ちょっと", /ちょっと/g], ["時間", /時間/g], ["気分", /気分/g],
  ["味わ", /味わ/g], ["楽し", /楽し/g], ["外", /外/g], ["音", /音/g], ["買", /買/g], ["行く", /行[くっき]/g],
  ["過ご", /過ご/g], ["塗", /塗/g], ["温", /温/g], ["ほぐ", /ほぐ/g], ["伸", /伸/g], ["歩", /歩/g], ["書", /書/g],
  ["描", /描/g], ["遊", /遊/g], ["手", /(?<![歌拍])手(?!帳)/g], ["自分", /自分/g], ["気に", /気に/g], ["用意", /用意/g],
  ["ながら", /ながら/g], ["切", /切/g]
];
// 意味の食い違い(片方の言葉と、もう片方の言葉が同じ文にある)
var CLASH = [
  ["ひとりで楽しむ言葉と人と過ごす行動", /遠慮せず|ひとりで|こっそり|誰も見ていない/, /友達|家族|誘|人と|誰か|会う|会い|電話|チャット|おしゃべり|メッセージ|オンライン/],
  ["目を閉じたまま見る・書く", /目を閉じて/, /見る|見て|眺め|読む|描|塗|撮|探|書|めくる|解く|遊ぶ/],
  ["暗くしてにぎやかなこと", /暗く|照明/, /カラオケ|歌う|踊る/],
  ["贅沢とささやかな物", /贅沢|奮発|記念|堂々と/, /自販機|100円|300円|ひと口|水を|白湯|麦茶/],
  ["夜に日なた・天気", /寝る前|今夜/, /天気|日光|日の当たる|外で/],
  ["くつろいだ後に出かける", /パジャマ|湯船につかったあと/, /出かけ|に行く|買いに/],
  ["先の日付に今すぐやること", /次の休み|明日(?!の予定)|今週|今月|連休|近いうち/, /スクショ|拍手|宣言|おつかれ|パジャマ|明日の予定/],
  ["帰り道の寄り道で出かける", /帰り道|寄り道/, /に行く|出かけ|ランチ|ディナー/],
  // 寝る紙だけで使う翌日用の部品
  ["翌朝に夜・眠る・帰り道・今日のこと", /明日の朝|起きたら|目が覚めたら|休みの朝/, /夜|星|暗く|照明|パジャマ|昼寝|眠|寝る|帰る|帰り|寄って|ランチ|ディナー|今日/],
  ["起きたあとに布団に残る", /起きたら/, /布団にいる|横に/],
  ["明日の夜に日なた・朝のこと・半日かかること", /明日の夜/, /天気|日光|日の光|日の当たる|公園|朝|早起き|半日|1日/],
  ["明日の午後に夜・朝のこと", /明日の午後/, /夜|星|パジャマ|朝|早起き|目覚まし/]
];

var RULES = [
  { name: "数や時間の位置(「〜を2分する」「ゲームを〜遊ぶ」)", test: function (t) {
    return /を\d+(?:〜\d+)?(?:秒|分|時間)(?:だけ|ほど|くらい)?(?:する|遊ぶ)/.test(t) || /ゲームを[^、]*遊ぶ/.test(t);
  } },
  { name: "時の言葉が重なる", test: function (t) { return count(t, TIME_WORDS) >= 2; } },
  { name: "意味がかみ合わない", test: function (t) {
    for (var i = 0; i < CLASH.length; i++) if (CLASH[i][1].test(t) && CLASH[i][2].test(t)) return CLASH[i][0];
    return false;
  } },
  { name: "動作の連なりが長い(〜してから・〜したら・〜て、が2つ以上/読点3つ以上)", test: function (t) {
    return count(t.replace(/だらだら/g, ""), STEP_WORDS) >= 2 || count(t, /、/g) >= 3;
  } },
  { name: "同じ言葉が重なる", test: function (t) {
    for (var i = 0; i < REPEATS.length; i++) if (count(t, REPEATS[i][1]) >= 2) return REPEATS[i][0];
    return false;
  } },
  { name: "同じ助詞が続く(の が3つ)", test: function (t) {
    return /の[^、。「」]{1,5}の[^、。「」]{1,5}の/.test(t);
  } },
  { name: "文の終わり方がそろっていない(常体の「〜する」)", test: function (t) {
    return !/[うくぐすつぬぶむる]$/.test(t) || /ます|です|ましょう|しよう|[!！?？]/.test(t);
  } },
  { name: "表記の揺れ(1本/一本・ひと口/一口・ご褒美/ごほうび・かっこ・全角数字)", test: function (t) {
    return /一(?:口|本|杯|枚|回|粒|息|切れ|日|冊|話|曲|品|個)|1口|1切れ|ごほうび|頑張|[（）()]|[０-９]/.test(t);
  } },
  { name: "読点の位置がおかしい", test: function (t) { return /、、|^、|、$/.test(t); } },
  { name: "長さの上限を超える", test: function (t, type) { return t.length > R.MAX_LEN[type]; } }
];

var failures = 0, total = 0;
var hits = RULES.map(function () { return []; });
["box", "final"].forEach(function (type) {
  for (var lv = 1; lv <= R.LEVELS; lv++) {
    var seen = {};
    // 寝る紙だけで使う翌日用の部品(minWhen を渡したときだけ出る)も調べる
    [undefined, { place: "out" }, { minWhen: 2 }, { minWhen: 2, place: "out" }].forEach(function (opts) {
      R.pool(type, lv, opts).forEach(function (text) {
        if (seen[text]) return;
        seen[text] = true;
        total++;
        RULES.forEach(function (rule, i) {
          var r = rule.test(text, type);
          if (r) hits[i].push(type + " Lv" + lv + ": " + text + (typeof r === "string" ? " 〔" + r + "〕" : ""));
        });
      });
    });
  }
});

console.log("調べた文: " + total + " 件");
RULES.forEach(function (rule, i) {
  var h = hits[i];
  console.log((h.length ? "  NG  " : "  OK  ") + rule.name + ": " + h.length + " 件");
  (LIST_ALL ? h : h.slice(0, 5)).forEach(function (s) { console.log("        " + s); });
  failures += h.length;
});

if (failures) { console.log("\n不自然な形: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
