// 分類と難易度スコアのテスト。実行: node tests/classify.test.js
"use strict";
var path = require("path");
var C = require(path.join(__dirname, "..", "classify.js"));

var failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.log("  NG  " + msg); }
}

// ── 1. 代表的な入力 → 期待するカテゴリ ─────────────────
var CASES = [
  // 掃除
  ["部屋の掃除", "souji"], ["トイレ掃除", "souji"], ["お風呂を洗う", "souji"], ["換気扇のそうじ", "souji"],
  ["ソウジ", "souji"], ["窓ふきと網戸", "souji"], ["キッチンのシンクを磨く", "souji"],
  // 片付け・整理
  ["部屋の片付け", "katazuke"], ["クローゼットの整理", "katazuke"], ["断捨離したい", "katazuke"],
  ["衣替え", "katazuke"], ["いらない服をメルカリに出品", "katazuke"], ["机の上がカオス", "katazuke"],
  // 料理
  ["夕飯を作る", "ryouri"], ["作り置きをする", "ryouri"], ["自炊", "ryouri"], ["お弁当づくり", "ryouri"],
  ["夕飯の支度", "ryouri"], ["献立を考える", "ryouri"],
  // 洗濯
  ["洗濯物をたたむ", "sentaku"], ["洗濯", "sentaku"], ["シャツにアイロン", "sentaku"], ["布団を干す", "sentaku"],
  // 家事
  ["皿洗い", "kaji"], ["洗い物がたまってる", "kaji"], ["家事全般", "kaji"], ["草むしり", "kaji"],
  // 書類・手続き
  ["確定申告", "shorui"], ["役所の手続き", "shorui"], ["住所変更の届け出", "shorui"], ["パスポートの申請", "shorui"],
  ["保険の書類を書く", "shorui"], ["スマホの解約", "shorui"],
  // 支払い・お金
  ["公共料金の支払い", "okane"], ["家計簿をつける", "okane"], ["税金の振込", "okane"], ["クレジットカードの明細を見る", "okane"],
  // 連絡・返信
  ["溜まったメールの返信", "renraku"], ["LINEの返信", "renraku"], ["ラインを返す", "renraku"], ["友達にLINE返信", "renraku"],
  ["問い合わせの電話", "renraku"], ["メールを読む", "renraku"],
  // 仕事
  ["会議の資料作り", "shigoto"], ["報告書を書く", "shigoto"], ["仕事のタスク", "shigoto"], ["経費精算", "shigoto"],
  ["上司に相談", "shigoto"], ["プレゼンのスライド", "shigoto"],
  // 勉強
  ["資格の勉強", "benkyou"], ["英単語の暗記", "benkyou"], ["レポートの締め切り", "benkyou"], ["TOEICの勉強", "benkyou"],
  ["宿題", "benkyou"], ["課題の提出", "benkyou"],
  // 読書
  ["積読を崩す", "dokusho"], ["本を読む", "dokusho"], ["読みかけの小説", "dokusho"], ["図書館に本を返す", "dokusho"],
  // 創作
  ["イラストを描く", "sousaku"], ["小説を書く", "sousaku"], ["ブログを更新", "sousaku"], ["動画編集", "sousaku"],
  ["日記を書く", "sousaku"], ["編み物", "sousaku"],
  // 趣味の練習
  ["ギターの練習", "shumi"], ["ピアノ", "shumi"], ["書道", "shumi"], ["ボイトレ", "shumi"],
  // 運動
  ["筋トレ", "undou"], ["ジョギング", "undou"], ["ヨガをする", "undou"], ["ジムに行く", "undou"], ["ウォーキング", "undou"],
  // 通院
  ["歯医者の予約", "tsuuin"], ["病院に電話する", "tsuuin"], ["健康診断", "tsuuin"], ["皮膚科に行く", "tsuuin"],
  ["親知らずを抜く", "tsuuin"],
  // 健康習慣
  ["体重を測る", "kenkou"], ["禁煙", "kenkou"], ["薬を飲む習慣", "kenkou"],
  // 身支度
  ["着替える", "mijitaku"], ["メイクする", "mijitaku"], ["歯磨き", "mijitaku"],
  ["美容院の予約", "mijitaku"], ["出かける準備", "mijitaku"],
  // 買い物
  ["買い物", "kaimono"], ["夕飯の買い物", "kaimono"], ["日用品の買い出し", "kaimono"], ["彼女へのプレゼントを買う", "kaimono"],
  ["ネットで注文", "kaimono"],
  // 旅行・お出かけ
  ["家族との旅行の計画", "ryokou"], ["帰省の準備", "ryokou"], ["旅行の荷造り", "ryokou"], ["温泉に行きたい", "ryokou"],
  // お楽しみの準備
  ["映画のチケットを取る", "goraku"], ["ライブの準備", "goraku"], ["美術館に行く", "goraku"], ["推し活", "goraku"],
  // 人付き合い
  ["友達を飲み会に誘う", "hitozukiai"], ["お礼の手紙", "hitozukiai"], ["同窓会の幹事", "hitozukiai"], ["年賀状", "hitozukiai"],
  ["親戚にあいさつ", "hitozukiai"],
  // ユーザーの判断: 家族との相談は、人付き合いの億劫さが本題なので人付き合い
  ["実家の家族と旅行先の相談", "hitozukiai"],
  // 就活・転職
  ["履歴書を書く", "shukatsu"], ["転職活動", "shukatsu"], ["面接の準備", "shukatsu"], ["エントリーシート", "shukatsu"],
  ["仕事を辞めたい", "shukatsu"],
  // プログラミング
  ["アプリのバグを直す", "programming"], ["プログラミングの勉強", "programming"], ["Pythonでスクリプト", "programming"],
  ["GitHubにpush", "programming"],
  // 引っ越し
  ["引っ越しの準備", "hikkoshi"], ["引越し", "hikkoshi"], ["物件探し", "hikkoshi"], ["引っ越しの荷造り", "hikkoshi"],
  // お風呂(身支度から入浴・シャワー・髪を洗う・乾かすを分けた)
  ["お風呂に入る", "ofuro"], ["シャワーを浴びる", "ofuro"], ["髪を乾かす", "ofuro"], ["お風呂を洗う", "souji"],
  // ゴミ出し(家事からゴミ系を分けた)
  ["ゴミ出し", "gomi"], ["ペットボトルを捨てる", "gomi"], ["段ボールをつぶして出す", "gomi"], ["粗大ごみを申し込む", "katazuke"],
  // 郵便物
  ["郵便物を開ける", "yuubin"], ["ポストを見る", "yuubin"], ["再配達を頼む", "yuubin"],
  // 食べる(作るのは料理のまま)
  ["ご飯を食べる", "taberu"], ["朝ごはんを食べる", "taberu"], ["夕飯を作る", "ryouri"], ["野菜を食べる", "kenkou"],
  ["温かいものを食べる", "taberu"], // 「温かいもの」の中の「かいもの」を買い物と数えない
  // 起きる(昼夜逆転は、まず起きる時刻を決めることから)
  ["朝起きる", "okiru"], ["布団から出る", "okiru"], ["二度寝しない", "okiru"], ["昼夜逆転を直す", "okiru"], ["早起きする", "kenkou"],
  // 寝る(夜に寝ること。昼寝・寝る前の別のことは含めない)
  ["早く寝る", "neru"], ["布団に入る", "neru"], ["寝る準備", "neru"], ["寝る前にストレッチ", "undou"], ["昼寝", "other"],
  // 住まいの修理
  ["蛇口の水漏れを直す", "shuuri"], ["管理会社に連絡する", "shuuri"], ["エアコンの修理を頼む", "shuuri"],
  // 計画
  ["予定を立てる", "keikaku"], ["やることリストを作る", "keikaku"], ["今週の振り返り", "keikaku"],
  ["貯金の計画を立てる", "okane"], ["旅行の計画を立てる", "ryokou"], ["仕事の段取り", "shigoto"],
  // その他(当たらない・誤判定しやすい語)
  ["", "other"], ["なんとなくやる気が出ない", "other"], ["ゲーム", "other"],
  ["オンラインで何かする", "other"], ["日本を知る", "other"], ["本当にやる", "other"]
];

CASES.forEach(function (c) {
  var r = C.classify(c[0]);
  check(r.id === c[1], "「" + c[0] + "」→ " + r.id + "(" + r.label + ") 期待: " + c[1] +
    "  当たった語: " + r.matched.join(",") + "  候補: " + JSON.stringify(r.candidates));
});
console.log("分類: " + (CASES.length - failures) + " / " + CASES.length + " 件が期待どおり");

// ── 2. カテゴリのデータ ──────────────────────────
var before = failures;
function priorities(list) {
  return list.map(function (s) { return parseInt(s.split("|")[0], 10); }).sort(function (a, b) { return a - b; }).join(",");
}
C.CATEGORIES.concat([C.FALLBACK]).forEach(function (cat) {
  check(cat.steps.length === 8 && priorities(cat.steps) === "1,2,3,4,5,6,7,8", cat.id + ": steps は優先順1〜8の8個");
  check(cat.light.length === 8 && priorities(cat.light) === "1,2,3,4,5,6,7,8", cat.id + ": light は優先順1〜8の8個");
  check(cat.base >= 0 && cat.base <= 100, cat.id + ": base は0〜100");
});
var ids = {};
C.CATEGORIES.forEach(function (cat) { check(!ids[cat.id], "id の重複: " + cat.id); ids[cat.id] = true; });
console.log("カテゴリ数: " + C.CATEGORIES.length + "(+その他)" + (failures === before ? "  データOK" : ""));

// ── 3. 難易度スコア ───────────────────────────
before = failures;
var HS = [1, 2, 3, 4, 5], ES = [1, 2, 3], TS = [5, 15, 30, 60];
var bases = C.CATEGORIES.map(function (c) { return c.base; }).concat([C.FALLBACK.base, 0, 100]);
HS.forEach(function (h) {
  ES.forEach(function (e) {
    TS.forEach(function (t) {
      bases.forEach(function (b) {
        var s = C.difficultyScore({ heaviness: h, energy: e, time: t, base: b });
        check(s >= 0 && s <= 100, "スコアは0〜100: " + s);
        if (e === 1) check(C.isLight(s), "エネルギー低めは必ず軽い手順: h" + h + " t" + t + " b" + b + " → " + s);
        var o = { heaviness: h, energy: e, time: t, base: b };
        var n = C.stepCount(C.countScore(o), e === 1);
        check(n >= 2 && n <= 8, "マス数は2〜8: " + n);
        // エネルギー低めでもマスは減らさない(ふつう以上。ふつう+1、最大8)
        if (e === 1) {
          var normal = C.stepCount(C.countScore({ heaviness: h, energy: 2, time: t, base: b }), false);
          check(n >= normal && n === Math.min(8, normal + 1), "低めのマス数はふつう+1: h" + h + " t" + t + " b" + b + " → " + n + " / ふつう " + normal);
        }
        var lv = C.rewardLevel(s);
        check(lv >= 1 && lv <= 6, "レベルは1〜6: " + lv);
        // 単調性: どの入力を上げてもスコアは下がらない
        if (h < 5) check(C.difficultyScore({ heaviness: h + 1, energy: e, time: t, base: b }) >= s, "気の重さで単調");
        if (e < 3) check(C.difficultyScore({ heaviness: h, energy: e + 1, time: t, base: b }) >= s, "エネルギーで単調");
      });
    });
  });
});
// 以前の「低めならご褒美を下げる」の向き: 同じ条件なら低めの方がレベルが低い
HS.forEach(function (h) {
  TS.forEach(function (t) {
    var low = C.rewardLevel(C.difficultyScore({ heaviness: h, energy: 1, time: t, base: 45 }));
    var mid = C.rewardLevel(C.difficultyScore({ heaviness: h, energy: 2, time: t, base: 45 }));
    check(low < mid, "低めはふつうよりご褒美が小さい: h" + h + " t" + t + " (" + low + " / " + mid + ")");
  });
});
console.log("難易度スコア: " + (failures === before ? "範囲・単調性・低エネルギーの規則 OK" : "NG あり"));

// どのカテゴリ・どの組み合わせでも、必要なマス数ぶんの手順がそろう(軽い手順が足りなくならない)
before = failures;
C.CATEGORIES.concat([C.FALLBACK]).forEach(function (cat) {
  HS.forEach(function (h) { ES.forEach(function (e) { TS.forEach(function (t) {
    var o = { heaviness: h, energy: e, time: t, base: cat.base };
    var s = C.difficultyScore(o);
    var n = C.stepCount(C.countScore(o), e === 1);
    var steps = C.pickSteps(C.isLight(s) ? cat.light : cat.steps, n, "テスト");
    check(steps.length === n, cat.id + ": " + n + "マス必要なのに手順が " + steps.length + " 個 (h" + h + " e" + e + " t" + t + ")");
  }); }); });
});
console.log("手順の数: " + (failures === before ? "どの組み合わせでも足りる" : "足りない組み合わせあり"));

// ── 4. 計画(plan)の例 ─────────────────────────
function show(label, input) {
  var p = C.plan(input);
  console.log("  " + label + " → " + p.categoryLabel + " / スコア" + p.score + " / Lv" + p.level +
    "(" + C.LEVEL_NAMES[p.level - 1] + ") / " + p.steps.length + "マス" + (p.light ? "(軽い手順)" : ""));
  return p;
}
console.log("例:");
var p1 = show("部屋の掃除 重さ3 15分 ふつう", { task: "部屋の掃除", heaviness: 3, time: 15, energy: 2 });
var p2 = show("部屋の掃除 重さ3 15分 低め  ", { task: "部屋の掃除", heaviness: 3, time: 15, energy: 1 });
show("確定申告   重さ5 60分 高め  ", { task: "確定申告", heaviness: 5, time: 60, energy: 3 });
show("歯磨き     重さ1 5分  ふつう", { task: "歯磨き", heaviness: 1, time: 5, energy: 2 });
show("転職活動   重さ4 30分 ふつう", { task: "転職活動", heaviness: 4, time: 30, energy: 2 });
var p3 = show("謎のこと   重さ3 15分 ふつう", { task: "謎のこと", heaviness: 3, time: 15, energy: 2 });
check(p2.light && !p1.light, "低めは軽い手順、ふつうは通常の手順");
check(p2.steps.length >= p1.steps.length, "部屋の掃除: 低めのマス数(" + p2.steps.length + ")はふつう(" + p1.steps.length + ")以上");
var p4 = show("実家の家族と旅行先の相談 重さ4 15分 ふつう", { task: "実家の家族と旅行先の相談", heaviness: 4, time: 15, energy: 2 });
var p5 = show("実家の家族と旅行先の相談 重さ4 15分 低め  ", { task: "実家の家族と旅行先の相談", heaviness: 4, time: 15, energy: 1 });
check(p5.steps.length >= p4.steps.length, "旅行先の相談: 低めのマス数(" + p5.steps.length + ")はふつう(" + p4.steps.length + ")以上");
check(p5.level < p4.level, "旅行先の相談: 低めはご褒美レベルが下がる(" + p5.level + " / " + p4.level + ")");
check(p3.steps.join("").indexOf("「謎のこと」") !== -1, "その他の手順に入力が入る");

// ── 4b. マスごとの役割・場所・ご褒美の段階 ─────────────────
before = failures;
C.CATEGORIES.concat([C.FALLBACK]).forEach(function (cat) {
  [cat.steps, cat.light].forEach(function (list) {
    for (var n = 2; n <= 8; n++) {
      var d = C.stepDetails(list, n, "テスト");
      check(JSON.stringify(d.map(function (x) { return x.text; })) === JSON.stringify(C.pickSteps(list, n, "テスト")), cat.id + ": stepDetails と pickSteps の並びが同じ");
      check(d[0].role === "start", cat.id + ": 最初のマスは start");
      check(d.filter(function (x) { return x.role === "close"; }).length === (n >= 3 ? 1 : 0), cat.id + ": 締めのマスは3マス以上のとき1つ (" + n + "マス)");
      d.forEach(function (x) { check(x.place === null || x.place === "out", cat.id + ": 場所は out か null"); });
    }
  });
});
for (var sl = 0; sl <= 7; sl++) {
  ["start", "main", "close", "?"].forEach(function (role) {
    var b = C.boxLevelFor(sl, role);
    check(b >= 1 && b <= 6, "boxLevelFor はレベル1〜6: " + sl + " " + role + " → " + b);
  });
}
check(C.boxLevelFor(3, "start") === 4 && C.boxLevelFor(3, "close") === 2 && C.boxLevelFor(3, "main") === 3, "最初 +1・締め −1・ほか ±0");
// 1枚の紙の平均レベルは、紙のレベルとほぼ同じ(ずれるのは端で丸めたときの 1/マス数 まで)
var shiftSum = 0, sheets = 0;
HS.forEach(function (h) { ES.forEach(function (e) { TS.forEach(function (t) {
  C.CATEGORIES.forEach(function (cat) {
    var p = C.plan({ task: cat.label, heaviness: h, energy: e, time: t });
    check(p.roles.length === p.steps.length && p.places.length === p.steps.length, "plan の roles・places の数がマスと同じ");
    var avg = p.roles.reduce(function (a, r) { return a + C.boxLevelFor(p.level, r); }, 0) / p.roles.length;
    check(Math.abs(avg - p.level) <= 1 / p.roles.length + 1e-9, cat.id + ": 紙の平均レベルがずれすぎ " + avg + " / " + p.level);
    shiftSum += avg - p.level; sheets++;
  });
}); }); });
// 保存してあるマスから役割・場所を求め直せる(文が変わっていれば null)
C.CATEGORIES.forEach(function (cat) {
  var p = C.plan({ task: cat.label, heaviness: 3, energy: 2, time: 15 });
  var info = C.stepInfoFor(p.category, p.light, p.steps, cat.label);
  check(info && JSON.stringify(info.roles) === JSON.stringify(p.roles) && JSON.stringify(info.places) === JSON.stringify(p.places),
    cat.id + ": stepInfoFor で plan と同じ役割・場所になる");
  check(C.stepInfoFor(p.category, p.light, p.steps.concat(["別の文"]), cat.label) === null, cat.id + ": 文が合わなければ null");
});
check(C.stepInfoFor("souji", false, ["昔の文言のマス", "もう1つ"], "") === null, "昔の文言の紙は null(紙のレベルのまま引く)");
// 使える時間が5分のときは1マス少ない(最小2マス)。締めのマスは残る
HS.forEach(function (h) { ES.forEach(function (e) {
  C.CATEGORIES.forEach(function (cat) {
    var p5 = C.plan({ task: cat.label, heaviness: h, energy: e, time: 5 });
    var n = C.stepCount(C.countScore({ heaviness: h, energy: e, time: 5, base: cat.base }), e === 1);
    check(p5.steps.length === Math.max(2, n - 1), cat.id + ": 5分の紙は1マス少ない h" + h + " e" + e + " (" + p5.steps.length + " / " + n + ")");
    check(p5.roles.indexOf("close") !== -1, cat.id + ": 5分の紙にも締めのマスがある");
  });
}); });
var outCats = C.CATEGORIES.filter(function (cat) { return cat.steps.concat(cat.light).some(function (s) { return /^\d+o\|/.test(s); }); }).map(function (c) { return c.id; });
console.log("マスごとの段階: " + (failures === before ? "範囲・並び OK" : "NG あり") + "  紙の平均のずれ(全組み合わせの平均) " +
  (Math.round(shiftSum / sheets * 1000) / 1000) + "  外のマスがあるカテゴリ: " + outCats.join(", "));

// ── 5. スコアの分布(係数を調整するときの参考) ───────────
var dist = [0, 0, 0, 0, 0, 0], lightCount = 0, total = 0;
HS.forEach(function (h) { ES.forEach(function (e) { TS.forEach(function (t) {
  C.CATEGORIES.forEach(function (cat) {
    var s = C.difficultyScore({ heaviness: h, energy: e, time: t, base: cat.base });
    dist[C.rewardLevel(s) - 1]++; total++; if (C.isLight(s)) lightCount++;
  });
}); }); });
console.log("全組み合わせ(" + total + "通り)のレベル分布: " + dist.map(function (n, i) {
  return "Lv" + (i + 1) + " " + Math.round(n * 100 / total) + "%";
}).join(" / ") + "  軽い手順 " + Math.round(lightCount * 100 / total) + "%");

// カテゴリの絵文字(最近のタスクのボタン)
check(C.CATEGORIES.every(function (c) { return typeof C.CATEGORY_EMOJI[c.id] === "string" && C.CATEGORY_EMOJI[c.id]; }) &&
  !C.CATEGORY_EMOJI[C.FALLBACK.id], "カテゴリごとに絵文字がある(「その他」には無い)");

if (failures) { console.log("\n失敗: " + failures + " 件"); process.exit(1); }
console.log("\nすべて成功");
