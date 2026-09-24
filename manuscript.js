/*
 * やる気の原稿用紙: 書き上がる原稿用紙(名作を1文字ずつ書く)・金のマス
 *
 * ブラウザでは window.YarukiManuscript、node では require("./manuscript.js") で使う。
 * 画面(DOM)と localStorage には触らない(読み書きは index.html が行う)。
 * テスト: node tests/manuscript.test.js
 *
 * ── 考え方 ─────────────────────────────────────
 * ・マスを1つ埋めるごとに、原稿用紙(縦書き 20字×20行)に作品を1文字書く。右の行から書いていく。
 * ・新しい作品は新しい行から。作品と作品の間は1行あける。俳句は1句を1行に、詩は本文の改行どおりに書く。
 * ・空白のマス(行末の余り・作品の間の空け行・連の区切り・行の中の空白)はマスを使わずに埋まる。
 *   紙の頭には空け行を置かない。
 * ・書いた文字は消さない。累計マスが減っても戻さず、これまでの最大値(maxTotal)を越えた分だけ進める。
 * ・作品は俳句3〜5句ごとに詩を1編。並びは周ごとに一度だけシャッフルして保存する。全部書いたら次の周へ。
 * ・作品は「書いている作品」の分だけ、先に紙に置いておく(いつも1文字以上の書き残しがある)。
 *
 * ── 保存データ(genkouyoushi-manuscript-v1) ───────────
 *  seed / round / order / used : 並びを作る種・何周目か・この周の並び・この周で書き始めた作品
 *  maxTotal : 累計マスのこれまでの最大値   written : 書いた文字数(ここまでの通し番号)
 *  page     : 書いている紙 { no, start: この紙の最初の文字の通し番号, items: [{ id, at, from, cut }] }
 *             at = その作品の最初の文字の通し番号 / from = この紙がその作品の何行目から始まるか /
 *             cut = 飛ばした作品の、書いたところまでの字数(飛ばしていなければ null)
 *  pages    : 書き上げた紙 { no, start, completedAt, workIds, rows: 20行の文字(空白は半角スペース), reward, rewardUserId, quiet }
 *             quiet = 導入時や読み込みで書けていた紙(大きいご褒美は出さない)
 *  finishedWorks : 書き上げた作品 { id, at, completedAt }
 *  goldChars     : 金のマスで書いた文字の通し番号
 *  retro / retroDone : 導入時に、これまでの累計マスで書けていた分 / その知らせを見せたか
 *  rewardOverride / rewardOverrideId : 1枚ごとの大きいご褒美を自分で決めたとき(自分のご褒美から選んだならその id)
 *  nextWorkId    : 次に書く作品を選んだとき
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YarukiManuscript = api;
})(this, function () {
  "use strict";

  var KEY = "genkouyoushi-manuscript-v1";
  var LINE = 20;             // 1行の字数(縦に20マス)
  var LINES = 20;            // 1枚の行数
  var GOLD_RATE = 0.03;      // 金のマス: 1マスごとにこの確率(紙5〜6枚に1回くらい)
  var PER_POEM = { min: 3, max: 5 };   // 詩1編あたりの俳句の数
  var REWARD_MAX = 100;
  var PAGE_REWARD_LEVEL = 6; // 1枚書き上がったときのご褒美は、いちばん大きい段階から

  /* ── 作者の没年(日本で保護期間が切れた作家だけを入れる: 1967年までに亡くなった人) ── */
  var AUTHORS = {
    "松尾芭蕉": 1694, "与謝蕪村": 1784, "小林一茶": 1828, "正岡子規": 1902, "夏目漱石": 1916,
    "高浜虚子": 1959, "内藤鳴雪": 1926, "前田普羅": 1954,
    "山村暮鳥": 1924, "宮沢賢治": 1933, "北原白秋": 1942, "野口雨情": 1945
  };

  /* ── 作品棚 ──────────────────────────────────
   * 青空文庫の本文から(ルビ《》・注記［＃…］は取り除き、表記は本文のまま)。
   * 明るいもの・穏やかなもの・季節や小さな生き物・ユーモアのあるものを選ぶ。
   * 気持ちが沈む主題(死・別れ・孤独・寂しさ)や、説教くさいもの・迫るものは入れない。
   *  title : 詩は題。俳句は、句が載っている作品(句集・紀行など)
   *  source: 本文を取った青空文庫の作品(詩集の中の詩なら詩集の名)
   *  by    : 本文を取った作品の作者が、句の作者と違うとき(ほかの人の本に引用されている句)。出典にそのまま書く
   * id は保存データに残るので変えない。作品を外すときは消さずに retired: true を付ける
   * (書きかけ・書き上げた紙を描けるように。並びには入らなくなる)。
   * 詩の改行は \n、連の区切りは空行。行の中の全角空白は本文のまま(空白のマスになる)。 */
  var WORKS = [
    /* 俳句 */
    { id: "basho-01", type: "haiku", author: "松尾芭蕉", title: "おくのほそ道", source: "おくのほそ道", text: "閑さや岩にしみ入蝉の聲" },
    { id: "basho-02", type: "haiku", author: "松尾芭蕉", title: "おくのほそ道", source: "おくのほそ道", text: "五月雨をあつめて早し最上川" },
    { id: "basho-03", type: "haiku", author: "松尾芭蕉", title: "おくのほそ道", source: "おくのほそ道", text: "凉しさやほの三か月の羽黒山" },
    { id: "basho-04", type: "haiku", author: "松尾芭蕉", title: "おくのほそ道", source: "おくのほそ道", text: "雲の峰幾つ崩て月の山" },
    { id: "basho-05", type: "haiku", author: "松尾芭蕉", title: "おくのほそ道", source: "おくのほそ道", text: "暑き日を海にいれたり最上川" },
    { id: "basho-06", type: "haiku", author: "松尾芭蕉", title: "おくのほそ道", source: "おくのほそ道", text: "あらたうと青葉若葉の日の光" },
    { id: "basho-07", type: "haiku", author: "松尾芭蕉", title: "おくのほそ道", source: "おくのほそ道", text: "風流の初やおくの田植うた" },
    { id: "basho-08", type: "haiku", author: "松尾芭蕉", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "古池や蛙とび込む水の音" },
    { id: "basho-09", type: "haiku", author: "松尾芭蕉", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "木の下に汁も鱠も桜かな" },
    { id: "basho-10", type: "haiku", author: "松尾芭蕉", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "鶯や餅に糞する縁の先" },
    { id: "buson-01", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "菜の花や月は東に日は西に" },
    { id: "buson-02", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "釣鐘にとまりて眠る胡蝶かな" },
    { id: "buson-03", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "夏川をこす嬉しさよ手に草履" },
    { id: "buson-04", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "名月や兎のわたる諏訪の湖" },
    { id: "buson-05", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "小鳥来る音嬉しさよ板庇" },
    { id: "buson-06", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "不尽一つ埋み残して若葉かな" },
    { id: "buson-07", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "夕立や草葉をつかむむら雀" },
    { id: "buson-08", type: "haiku", author: "与謝蕪村", title: "俳人蕪村", source: "俳人蕪村", by: "正岡子規", text: "鶯の鳴くや小き口あけて" },
    { id: "buson-09", type: "haiku", author: "与謝蕪村", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "春の水山無き国を流れけり" },
    { id: "issa-01", type: "haiku", author: "小林一茶", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "いうぜんとして山を見る蛙かな" },
    { id: "issa-02", type: "haiku", author: "小林一茶", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "萍の花からのらんあの雲へ" },
    { id: "issa-03", type: "haiku", author: "小林一茶", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "蟻の道雲の峰より続きけん" },
    { id: "issa-04", type: "haiku", author: "小林一茶", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "初蛍其手はくはぬ飛びぶりや" },
    { id: "issa-05", type: "haiku", author: "小林一茶", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "馬までもはたご泊や春の雨" },
    { id: "issa-06", type: "haiku", author: "小林一茶", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "酒尽きてしんの座につく月見かな" },
    { id: "shiki-01", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "菜の花やはつとあかるき町はつれ" },
    { id: "shiki-02", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "半日は空にあそぶや舞雲雀" },
    { id: "shiki-03", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "蝶ふたつ風にもつれて水の上" },
    { id: "shiki-04", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "初空や烏は黒く富士白し" },
    { id: "shiki-05", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "長閑さや障子の穴に海見えて" },
    { id: "shiki-06", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "鈴蟲や露をのむこと日に五升" },
    { id: "shiki-07", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "春雨やよその燕のぬれてくる" },
    { id: "shiki-08", type: "haiku", author: "正岡子規", title: "寒山落木　巻一", source: "寒山落木　巻一", text: "蓮の葉にうまくのつたる蛙哉" },
    { id: "shiki-09", type: "haiku", author: "正岡子規", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "手に満つる蜆うれしや友を呼ぶ" },
    { id: "shiki-10", type: "haiku", author: "正岡子規", title: "俳句はかく解しかく味う", source: "俳句はかく解しかく味う", by: "高浜虚子", text: "鴨の子を盥に飼ふや銭葵" },
    { id: "soseki-01", type: "haiku", author: "夏目漱石", title: "草枕", source: "草枕", text: "春風や惟然が耳に馬の鈴" },
    { id: "soseki-02", type: "haiku", author: "夏目漱石", title: "草枕", source: "草枕", text: "海棠の精が出てくる月夜かな" },
    { id: "soseki-03", type: "haiku", author: "夏目漱石", title: "草枕", source: "草枕", text: "木蓮の花ばかりなる空を瞻る" },
    { id: "kyoshi-01", type: "haiku", author: "高浜虚子", title: "五百句", source: "五百句", text: "大空に又わき出でし小鳥かな" },
    { id: "kyoshi-02", type: "haiku", author: "高浜虚子", title: "五百句", source: "五百句", text: "流れ行く大根の葉の早さかな" },
    { id: "kyoshi-03", type: "haiku", author: "高浜虚子", title: "五百句", source: "五百句", text: "白牡丹といふといへども紅ほのか" },
    { id: "meisetsu-01", type: "haiku", author: "内藤鳴雪", title: "鳴雪句集", source: "鳴雪句集", text: "貰ひ来る茶碗の中の金魚かな" },
    { id: "meisetsu-02", type: "haiku", author: "内藤鳴雪", title: "鳴雪句集", source: "鳴雪句集", text: "遣羽子の裾にからまる小犬かな" },
    { id: "fura-01", type: "haiku", author: "前田普羅", title: "普羅句集", source: "普羅句集", text: "月出でゝ一枚の春田輝けり" },
    { id: "fura-02", type: "haiku", author: "前田普羅", title: "普羅句集", source: "普羅句集", text: "八ヶ嶽見えて嬉しき焚火哉" },
    /* 詩 */
    { id: "bocho-01", type: "poem", author: "山村暮鳥", title: "風景　純銀もざいく", source: "風景　純銀もざいく",
      text: "いちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nかすかなるむぎぶえ\nいちめんのなのはな\n\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nひばりのおしやべり\nいちめんのなのはな\n\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nいちめんのなのはな\nやめるはひるのつき\nいちめんのなのはな" },
    { id: "bocho-02", type: "poem", author: "山村暮鳥", title: "春の海のうた", source: "春の海のうた",
      text: "さしたり\nひいたり\nはるのしほ\n\nはるの\nひながの\nあをいうみ\n\nひよつこり\nいそが\nしづんだら\n\nぴよつこり\nおふねが\nうきだした\n\nぴよつこり\nおふねが\nういたらば\n\nひよつこり\nいそが\nしいづんだ\n\nいそと\nおふねの\nかくれんぼ\n\nそれを\nみてゐた\nかもめどり\n\nかもめも\nかもめで\nかくれんぼ\n\nひよつこり\nういたり\nしづんだり" },
    { id: "bocho-03", type: "poem", author: "山村暮鳥", title: "海辺にて", source: "海辺にて",
      text: "浪よ\n　浪、浪\n　ここまでおいで\n浪よ\n　浪、浪\n　つかまへておくれ\nどんと打つてくりや\nそらにげた\n\n浪よ\n　浪、浪\n　ここまでおいで\n腹がたつたか\n浪よ\n　浪\nさつとひくとき\n砂の小山をけちらした" },
    { id: "kenji-01", type: "poem", author: "宮沢賢治", title: "星めぐりの歌", source: "星めぐりの歌",
      text: "あかいめだまの　さそり\nひろげた鷲の　　つばさ\nあをいめだまの　小いぬ、\nひかりのへびの　とぐろ。\n\nオリオンは高く　うたひ\nつゆとしもとを　おとす、\nアンドロメダの　くもは\nさかなのくちの　かたち。\n\n大ぐまのあしを　きたに\n五つのばした　　ところ。\n小熊のひたいの　うへは\nそらのめぐりの　めあて。" },
    { id: "kenji-02", type: "poem", author: "宮沢賢治", title: "雲の信号", source: "春と修羅",
      text: "あゝいゝな　せいせいするな\n風が吹くし\n農具はぴかぴか光つてゐるし\n山はぼんやり\n岩頸だつて岩鐘だつて\nみんな時間のないころのゆめをみてゐるのだ\n　　そのとき雲の信号は\n　　もう青白い春の\n　　禁慾のそら高く掲げられてゐた\n山はぼんやり\nきつと四本杉には\n今夜は雁もおりてくる" },
    { id: "hakushu-01", type: "poem", author: "北原白秋", title: "八百屋さん", source: "とんぼの眼玉",
      text: "大枇杷、小枇杷、\n水蜜桃、葡萄、\n苺や野菜、\nお籠に入れて、\n頭に載せて、\nかつこ、かつこ、行けば、\n薄紫の、\n馬鈴薯畑の花盛り。\nあちらでもかつこう、\nこちらでもかつこう、\n郭公が啼いて、\n雨が霽れて、\n田舎は涼しい涼しいな。\nかつこう、かつこう、\n私もいそいそ口笛吹いて、\n足拍子とつて、\nお靴でかつこかつこ、躍りませう。\nかつこ、かつこ、かつこな、\nたららら、らるら。\n小母さん、今日は、\n小父さん、今日は。" },
    { id: "hakushu-02", type: "poem", author: "北原白秋", title: "雀のお宿", source: "とんぼの眼玉",
      text: "笹藪、小藪、小藪のなかで、\nちゆうちゆうぱたぱた、雀の機織。\n彼方でとんとん、\n此方でとんとん、\nやれやれ、いそがし、日がかげる。\nちゆうちゆうぱたぱた、ちゆうぱたり。\n\n雀、雀、雀の子らは、\nちゆうちゆうぱたぱた、その梭ひろひ。\n上へ行つたり、\n下へ行つたり、\nやれやれ、いそがし、日がつまる。\nちゆうちゆうぱたぱた、ちゆうぱたり。\n\n青縞、茶縞、茶縞のおべべ、\nちゆうちゆうぱたぱた、何反織れたか。\n朝から一反、\n昼から一反、\nやれやれいそがし、日が暮れる。\nちゆうちゆうぱたぱた、ちゆうぱたり。" },
    { id: "hakushu-03", type: "poem", author: "北原白秋", title: "りすりす小栗鼠", source: "とんぼの眼玉",
      text: "栗鼠、栗鼠、小栗鼠、\nちよろちよろ小栗鼠、\n葡萄の房が熟れたぞ、\n啼け、啼け、小栗鼠。\n\n栗鼠、栗鼠、小栗鼠、\nちよろちよろ小栗鼠、\nあつちの尻尾が太いぞ、\n揺れ、揺れ、小栗鼠。\n\n栗鼠、栗鼠、小栗鼠、\nちよろちよろ小栗鼠、\nひとりで飛んだらあぶないぞ、\n負され、負され、小栗鼠。" },
    { id: "ujo-01", type: "poem", author: "野口雨情", title: "兎のダンス", source: "螢の燈台",
      text: "ソソラ　ソラ　ソラ兎のダンス\nタラッタ　ラッタ　ラッタ\nラッタ　ラッタ　ラッタ　ラ\n\n脚で蹴り蹴り\nピヨツコ　ピヨツコ　踊る\n耳に鉢巻　ラッタ　ラッタ　ラッタ　ラ\n\nソソラ　ソラ　ソラ可愛いダンス\nタラッタ　ラッタ　ラッタ\nラッタ　ラッタ　ラッタ　ラ\n\nとんで跳ね跳ね\nピヨツコ　ピヨツコ　踊る\n脚に赤靴　ラッタ　ラッタ　ラッタ　ラ" },
    { id: "ujo-02", type: "poem", author: "野口雨情", title: "雀踊り", source: "螢の燈台",
      text: "雀踊りは　面白や　面白や\n手拍子そろへて　面白や\n\nチンチンチンノチン\n　　ソリヤチンチンチンノチン\n\n手拍子そろへて\n　　面白や\n\nはぐれ雀も　来て踊れ　来て踊れ\n手拍子そろへて　来て踊れ\n\nチンチンチンノチン\n　　ソリヤチンチンチンノチン\n\n手拍子そろへて\n　　来て踊れ\n\n雀可愛や　ようそろた　ようそろた\n手拍子そろへて　ようそろた\n\nチンチンチンノチン\n　　ソリヤチンチンチンノチン\n\n手拍子そろへて\n　　ようそろた" },
    { id: "ujo-03", type: "poem", author: "野口雨情", title: "虫の音楽", source: "螢の燈台",
      text: "虫の音楽　面白い\n面白い\n\n鈴虫アりんりん\n鈴振つた\n\n松虫　ガチヤガチヤ\nきりぎりす\n\n虫の音楽　賑だ\n賑だ\n\nりんりんガチヤガチヤ\nチンチロリン\n\nきりきりガチヤガチヤ\nチンチロリン" },
    { id: "ujo-04", type: "poem", author: "野口雨情", title: "狸のいたづら", source: "朝おき雀",
      text: "ゴムの毬は\nポンポコ　ポン\n\n狸の太鼓は\n腹太鼓\n\n太鼓で毬を\nついたなら\n\nポンポコ　ポンノ　ポンポコ　ポン\n\n狸も毬も\nポンポコ　ポン\n\n軽い瓢箪\nポンポコ　ポン\n\n狸の尻尾は\n重いから\n\n尻尾で狸が\nたたいたら\n\nポンポコ　ポンノ　ポンポコ　ポン\n\n瓢箪ころげて\nポンポコ　ポン" }
  ];

  /* ── 作品の形(行に分ける) ─────────────────────── */
  var SPACE = /^[\s\u3000]$/;
  function library(list) {
    var lib = { list: list, byId: {}, haiku: [], poems: [], info: {} };
    list.forEach(function (w) {
      lib.byId[w.id] = w;
      if (w.retired) return;
      (w.type === "poem" ? lib.poems : lib.haiku).push(w.id);
    });
    return lib;
  }

  // 1行を20字ずつに分ける。cell は1文字、空白のマスは null。俳句は句の中の空白を詰める
  function rowsOfText(type, text) {
    var rows = [];
    String(text || "").split("\n").forEach(function (line) {
      var cells = Array.from(line.replace(/[\s\u3000]+$/, ""));
      if (type !== "poem") cells = cells.filter(function (c) { return !SPACE.test(c); });
      cells = cells.map(function (c) { return SPACE.test(c) ? null : c; });
      if (!cells.some(function (c) { return c !== null; })) {
        if (rows.length && rows[rows.length - 1].length) rows.push([]);   // 連の区切り(続く空け行は1つに)
        return;
      }
      for (var i = 0; i < cells.length; i += LINE) rows.push(cells.slice(i, i + LINE));
    });
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return rows;
  }
  function countChars(cells) {
    var n = 0;
    cells.forEach(function (c) { if (c !== null) n++; });
    return n;
  }
  // 行・行ごとの字数・その行より前の字数・全体の字数(作品ごとに一度だけ作る)
  function workInfo(lib, id) {
    if (lib.info[id]) return lib.info[id];
    var w = lib.byId[id];
    if (!w) return null;
    var rows = rowsOfText(w.type, w.text), starts = [], counts = [], n = 0;
    rows.forEach(function (r) {
      starts.push(n);
      counts.push(countChars(r));
      n += countChars(r);
    });
    lib.info[id] = { rows: rows, starts: starts, counts: counts, len: n };
    return lib.info[id];
  }
  function lengthOf(lib, id) {
    var info = workInfo(lib, id);
    return info ? info.len : 0;
  }
  function effLen(lib, it) {
    var len = lengthOf(lib, it.id);
    return it.cut == null ? len : Math.min(len, it.cut);
  }
  function usable(lib, id) {
    var w = lib.byId[id];
    return !!w && !w.retired && lengthOf(lib, id) > 0;
  }

  /* ── 並べ方(周ごと。種と周の番号から決まる) ────────── */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // 俳句を3〜5句ずつに分け、それぞれの後に詩を1編。俳句から始める
  function makeOrder(lib, seed, round) {
    var rnd = mulberry32((seed ^ Math.imul(round, 0x9E3779B1)) >>> 0);
    var h = shuffle(lib.haiku.filter(function (id) { return usable(lib, id); }), rnd);
    var p = shuffle(lib.poems.filter(function (id) { return usable(lib, id); }), rnd);
    if (!p.length) return h;
    var base = Math.min(PER_POEM.min, Math.floor(h.length / p.length));
    var groups = p.map(function () { return base; });
    var left = h.length - base * p.length;
    while (left > 0 && groups.some(function (g) { return g < PER_POEM.max; })) {
      var i = Math.floor(rnd() * groups.length);
      if (groups[i] < PER_POEM.max) { groups[i]++; left--; }
    }
    var out = [], hi = 0;
    groups.forEach(function (g, i) {
      for (var k = 0; k < g; k++) out.push(h[hi++]);
      out.push(p[i]);
    });
    while (hi < h.length) out.push(h[hi++]);
    return out;
  }

  /* ── 置いていく ─────────────────────────────── */
  function last(arr) { return arr[arr.length - 1]; }
  function remaining(ms, lib) {
    return ms.order.filter(function (id) { return ms.used.indexOf(id) === -1 && usable(lib, id); });
  }
  function newRound(ms, lib) {
    var prev = ms.page.items.length ? last(ms.page.items).id : null;
    ms.round++;
    ms.order = makeOrder(lib, ms.seed, ms.round);
    ms.used = [];
    // 周の変わり目で、同じ作品が続かないように
    if (ms.order.length > 1 && ms.order[0] === prev) {
      var t = ms.order[0]; ms.order[0] = ms.order[1]; ms.order[1] = t;
    }
  }
  // 次の作品を紙に置く(選んだ作品があればそれ、無ければこの周の並びの次)
  function placeNext(ms, lib) {
    var id = ms.nextWorkId && usable(lib, ms.nextWorkId) ? ms.nextWorkId : null;
    ms.nextWorkId = null;
    if (!id) {
      var rest = remaining(ms, lib);
      if (!rest.length) {
        newRound(ms, lib);
        rest = remaining(ms, lib);
      }
      id = rest[0];
    }
    if (!id) return false;
    if (ms.used.indexOf(id) === -1) ms.used.push(id);
    ms.page.items.push({ id: id, at: ms.written, from: 0, cut: null });
    return true;
  }

  /* ── 紙の組み方 ───────────────────────────────
   * items を行に並べ、20行まで紙に置く。作品の頭には空け行を1つ入れる(紙の頭の空け行は置かない)。
   * 戻り値: { rows: [{ k: 何番目の item か, r: 作品の何行目か(空け行は -1), cells }], stop: 紙に入りきらなかった最初の行 } */
  function itemRows(lib, it) {
    var info = workInfo(lib, it.id), out = [];
    if (!info) return out;
    for (var r = it.from; r < info.rows.length; r++) {
      if (it.cut != null) {
        if (info.starts[r] >= it.cut) break;
        var need = it.cut - info.starts[r];
        if (need < info.counts[r]) {
          var cells = [], seen = 0;
          for (var c = 0; c < info.rows[r].length && seen < need; c++) {
            cells.push(info.rows[r][c]);
            if (info.rows[r][c] !== null) seen++;
          }
          out.push({ r: r, cells: cells });
          break;
        }
      }
      out.push({ r: r, cells: info.rows[r] });
    }
    return out;
  }
  function isBlank(cells) { return !countChars(cells); }
  function compose(lib, items) {
    var rows = [], stop = null;
    for (var k = 0; k < items.length && !stop; k++) {
      var it = items[k];
      var seq = it.from === 0 ? [{ k: k, r: -1, cells: [] }] : [];
      itemRows(lib, it).forEach(function (x) { seq.push({ k: k, r: x.r, cells: x.cells }); });
      for (var j = 0; j < seq.length; j++) {
        var x = seq[j];
        if (!rows.length && isBlank(x.cells)) continue;
        if (rows.length === LINES) { stop = x; break; }
        rows.push(x);
      }
    }
    return { rows: rows, stop: stop };
  }
  function charsIn(rows) {
    var n = 0;
    rows.forEach(function (x) { n += countChars(x.cells); });
    return n;
  }
  function rowText(cells) {
    return cells.map(function (c) { return c === null ? " " : c; }).join("").replace(/ +$/, "");
  }

  // 紙がいっぱいになったら(次に書く文字が20行に入らなくなったら)しまって、次の紙にする
  function settlePage(ms, lib, now, quiet, events) {
    for (var guard = 0; guard < 4; guard++) {
      var comp = compose(lib, ms.page.items);
      if (charsIn(comp.rows) > ms.written - ms.page.start || !comp.stop) return;
      var ids = [];
      comp.rows.forEach(function (x) {
        var id = ms.page.items[x.k].id;
        if (x.r >= 0 && ids.indexOf(id) === -1) ids.push(id);
      });
      var rec = {
        no: ms.page.no, start: ms.page.start, completedAt: now, workIds: ids,
        rows: comp.rows.map(function (x) { return rowText(x.cells); }),
        reward: null, rewardUserId: null, quiet: !!quiet
      };
      ms.pages.push(rec);
      events.pages.push(rec);
      var s = comp.stop;
      var items = ms.page.items.slice(s.k).map(function (it) { return { id: it.id, at: it.at, from: it.from, cut: it.cut }; });
      if (s.r >= 0) items[0].from = s.r;
      ms.page = { no: ms.page.no + 1, start: ms.written, items: items };
    }
  }

  function writeOne(ms, lib, now, quiet, events) {
    ms.written++;
    var it = last(ms.page.items);
    if (ms.written - it.at >= effLen(lib, it)) {
      if (it.cut == null) {
        var f = { id: it.id, at: it.at, completedAt: now };
        ms.finishedWorks.push(f);
        events.works.push(f);
      }
      placeNext(ms, lib);
    }
    settlePage(ms, lib, now, quiet, events);
  }

  function isoNow(o) { return (o && o.now) || new Date().toISOString(); }
  function libOf(o) { return (o && o.lib) || LIB; }
  function emptyEvents() { return { chars: 0, works: [], pages: [] }; }

  /* 累計マスに合わせて書き進める。ms を書き換える。
   *  o.gold: 今回新しく埋めた金のマスの数(書いた文字のうち、最後のその数だけを金色にする)
   *  o.quiet: 導入時・読み込みのとき(書き上がった紙に大きいご褒美を付けない)
   * 戻り値: { chars: 書いた字数, works: 書き上がった作品, pages: 書き上がった紙 } */
  function sync(ms, total, o) {
    var lib = libOf(o), now = isoNow(o), events = emptyEvents();
    total = Math.max(0, Math.floor(Number(total) || 0));
    if (!(total > ms.maxTotal) || !ms.page.items.length) return events;
    var d = total - ms.maxTotal, first = ms.written;
    ms.maxTotal = total;
    for (var i = 0; i < d; i++) writeOne(ms, lib, now, !!(o && o.quiet), events);
    var gold = Math.min(d, Math.max(0, Math.floor((o && o.gold) || 0)));
    for (var g = 0; g < gold; g++) {
      var idx = first + d - 1 - g;
      if (ms.goldChars.indexOf(idx) === -1) ms.goldChars.push(idx);
    }
    ms.goldChars.sort(function (a, b) { return a - b; });
    events.chars = d;
    return events;
  }

  // 綴じ帳から紙を外したとき: その分だけ最大値を下げる(次に埋めたマスから、また書き進める)。書いた文字はそのまま
  function forget(ms, n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    ms.maxTotal = Math.max(0, ms.maxTotal - n);
  }

  /* ── 新しく始める(導入時: これまでの累計マスの分を、最初から書いてあることにする) ── */
  function randomSeed() { return Math.floor(Math.random() * 2147483647); }
  function blank(lib, seed) {
    return {
      version: 1, seed: seed, round: 1, order: makeOrder(lib, seed, 1), used: [],
      maxTotal: 0, written: 0,
      page: { no: 1, start: 0, items: [] },
      pages: [], finishedWorks: [], goldChars: [],
      retro: null, retroDone: false,
      rewardOverride: null, rewardOverrideId: null, nextWorkId: null
    };
  }
  function create(total, o) {
    var lib = libOf(o);
    var ms = blank(lib, o && typeof o.seed === "number" ? o.seed : randomSeed());
    placeNext(ms, lib);
    sync(ms, total, { lib: lib, now: isoNow(o), quiet: true });
    ms.retro = { written: ms.written, works: ms.finishedWorks.length, pages: ms.pages.length };
    ms.retroDone = ms.written === 0;
    return ms;
  }

  /* ── いま書いている作品・飛ばす・次に書く作品を選ぶ ───── */
  function current(ms, o) {
    var lib = libOf(o), it = last(ms.page.items);
    if (!it) return null;
    return { work: lib.byId[it.id] || null, done: Math.max(0, ms.written - it.at), total: lengthOf(lib, it.id) };
  }
  // いまの作品を飛ばす。書いたところまでは紙に残す(まだ1文字も書いていなければ置かなかったことにする)
  function skip(ms, o) {
    var lib = libOf(o), events = emptyEvents();
    var it = last(ms.page.items);
    if (!it) return events;
    var done = ms.written - it.at;
    if (done > 0) it.cut = done;
    else if (it.from === 0) ms.page.items.pop();
    else return events;
    placeNext(ms, lib);
    settlePage(ms, lib, isoNow(o), false, events);
    return events;
  }
  // 次に書く作品を選ぶ(null でおまかせに戻す)。いまの作品をまだ1文字も書いていなければ、すぐ入れ替える
  // 戻り値: "now"(入れ替えた) / "next"(いまの作品の次に書く) / "same"(いま書いている作品) / "cleared" / "invalid"
  function chooseNext(ms, id, o) {
    var lib = libOf(o);
    if (id == null) { ms.nextWorkId = null; return "cleared"; }
    if (!usable(lib, id)) return "invalid";
    var it = last(ms.page.items);
    if (it && it.id === id && it.cut == null) { ms.nextWorkId = null; return "same"; }
    ms.nextWorkId = id;
    if (it && ms.written - it.at <= 0 && it.from === 0) {
      ms.page.items.pop();
      var u = ms.used.indexOf(it.id);
      if (u !== -1) ms.used.splice(u, 1);   // 書いていないので、この周の残りに戻す
      placeNext(ms, lib);
      return "now";
    }
    return "next";
  }

  /* ── 画面に出すもの ───────────────────────────
   * grid[行][字]: { ch, i: 通し番号, gold } / null(空白・まだ書いていないマス)。行は右から、字は上から。 */
  function goldSet(ms) {
    var s = {};
    ms.goldChars.forEach(function (i) { s[i] = true; });
    return s;
  }
  function pageGrid(ms, o) {
    var lib = libOf(o), comp = compose(lib, ms.page.items), n = ms.written - ms.page.start;
    var gs = goldSet(ms), grid = [], count = 0, cursor = null;
    for (var r = 0; r < LINES; r++) {
      var row = [], cells = comp.rows[r] ? comp.rows[r].cells : [];
      for (var c = 0; c < LINE; c++) {
        var ch = cells[c];
        if (ch == null) { row.push(null); continue; }
        var i = ms.page.start + count;
        if (count < n) row.push({ ch: ch, i: i, gold: !!gs[i] });
        else {
          if (!cursor) cursor = { r: r, c: c };
          row.push(null);
        }
        count++;
      }
      grid.push(row);
    }
    return { no: ms.page.no, grid: grid, cursor: cursor, written: n };
  }
  function frozenGrid(ms, page) {
    var gs = goldSet(ms), grid = [], count = 0;
    for (var r = 0; r < LINES; r++) {
      var row = [], cells = Array.from(page.rows[r] || "");
      for (var c = 0; c < LINE; c++) {
        var ch = cells[c];
        if (!ch || ch === " ") { row.push(null); continue; }
        var i = page.start + count++;
        row.push({ ch: ch, i: i, gold: !!gs[i] });
      }
      grid.push(row);
    }
    return { no: page.no, grid: grid, cursor: null, written: count };
  }

  // この紙はあと何マスで書き上がるか(この先に置く作品も、今の並びどおりに見込んで数える)
  function pageLeft(ms, o) {
    var lib = libOf(o);
    var sim = {
      seed: ms.seed, round: ms.round, order: ms.order.slice(), used: ms.used.slice(),
      nextWorkId: ms.nextWorkId, written: ms.written,
      page: { no: ms.page.no, start: ms.page.start, items: ms.page.items.map(function (it) {
        return { id: it.id, at: it.at, from: it.from, cut: it.cut };
      }) }
    };
    var comp = compose(lib, sim.page.items);
    for (var guard = 0; !comp.stop && guard < 60; guard++) {
      var it = last(sim.page.items);
      sim.written = it.at + effLen(lib, it);
      if (!placeNext(sim, lib)) break;
      comp = compose(lib, sim.page.items);
    }
    return Math.max(0, charsIn(comp.rows) - (ms.written - ms.page.start));
  }

  // この紙に書いている(書いた)作品の id
  function pageWorkIds(ms) {
    var ids = [];
    ms.page.items.forEach(function (it) {
      if (ms.written > it.at || it.from > 0) { if (ids.indexOf(it.id) === -1) ids.push(it.id); }
    });
    return ids;
  }

  // 作品の本文を行ごとに。金のマスで書いた文字には gold を付ける(at: その作品の最初の文字の通し番号)
  function workLines(ms, w, at) {
    var gs = ms ? goldSet(ms) : {}, n = 0;
    return String(w.text).split("\n").map(function (line) {
      return Array.from(line).map(function (ch) {
        if (SPACE.test(ch)) return { ch: ch, gold: false, space: true };
        var i = at == null ? -1 : at + n;
        n++;
        return { ch: ch, gold: !!gs[i], space: false };
      });
    });
  }

  // 出典。ほかの人の本に引用された句・詩集の中の詩は、どこから取ったかも書く
  //   松尾芭蕉『おくのほそ道』（青空文庫より） / 与謝蕪村（正岡子規『俳人蕪村』より・青空文庫） /
  //   北原白秋「八百屋さん」（『とんぼの眼玉』より・青空文庫）
  function attribution(w) {
    if (w.by) return w.author + "（" + w.by + "『" + w.source + "』より・青空文庫）";
    if (w.type === "poem" && w.source !== w.title) return w.author + "「" + w.title + "」（『" + w.source + "』より・青空文庫）";
    return w.author + "『" + (w.type === "poem" ? w.title : w.source) + "』（青空文庫より）";
  }
  // 一覧に添える短い出典(作品名は別に出すので、作者と、どこから取ったか)
  function sourceLabel(w) {
    if (w.by) return w.author + "（" + w.by + "『" + w.source + "』より）";
    return w.author + "『" + w.source + "』";
  }
  function kindLabel(w) {
    return w.type === "poem" ? w.author + "の詩「" + w.title + "」" : w.author + "の句";
  }
  // 一覧で見分けるための短い名前(俳句は句そのもの、詩は題)
  function shortName(w) {
    return w.type === "poem" ? "「" + w.title + "」" : w.text.replace(/[\s\u3000]+/g, "");
  }

  /* ── 金のマス(マス目を作るときに決めて保存する) ────── */
  function drawGold(n, rng) {
    rng = rng || Math.random;
    var out = [];
    for (var i = 0; i < n; i++) if (rng() < GOLD_RATE) out.push(i);
    return out;
  }
  // 保存された金のマスの番号をそろえる(0〜n-1 の整数、重複なし、小さい順)
  function checkGold(v, n) {
    if (!Array.isArray(v)) return [];
    var seen = {}, out = [];
    v.forEach(function (i) {
      if (typeof i === "number" && isFinite(i) && i >= 0 && i < n && Math.floor(i) === i && !seen[i]) {
        seen[i] = true;
        out.push(i);
      }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /* ── 保存データをそろえる ──────────────────────── */
  function intIn(v, lo, hi) {
    return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : null;
  }
  function isoOrNull(v) {
    return typeof v === "string" && v && !isNaN(Date.parse(v)) ? v : null;
  }
  function textOrNull(v, max) {
    if (typeof v !== "string") return null;
    var t = v.replace(/\s+/g, " ").trim();
    return t ? t.slice(0, max) : null;
  }
  function checkPageRec(p) {
    if (!p || typeof p !== "object") return null;
    var no = intIn(p.no, 1, 1e6), start = intIn(p.start, 0, 1e9), at = isoOrNull(p.completedAt);
    if (no === null || start === null || !at || !Array.isArray(p.rows)) return null;
    return {
      no: no, start: start, completedAt: at,
      workIds: Array.isArray(p.workIds) ? p.workIds.filter(function (x) { return typeof x === "string"; }).slice(0, 60) : [],
      rows: p.rows.slice(0, LINES).map(function (r) { return Array.from(typeof r === "string" ? r : "").slice(0, LINE).join(""); }),
      reward: typeof p.reward === "string" ? p.reward.slice(0, 200) : null,
      rewardUserId: typeof p.rewardUserId === "string" && p.rewardUserId ? p.rewardUserId : null,
      quiet: p.quiet === true
    };
  }

  // 形がおかしければ null(index.html は作り直す)
  function check(raw, o) {
    var lib = libOf(o);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var seed = intIn(raw.seed, 0, 4294967295), written = intIn(raw.written, 0, 1e9);
    if (seed === null || written === null) return null;
    var ms = blank(lib, seed);
    ms.round = intIn(raw.round, 1, 1e6) || 1;
    ms.written = written;
    ms.maxTotal = intIn(raw.maxTotal, 0, 1e9) || 0;
    var order = Array.isArray(raw.order) ? raw.order.filter(function (id) { return usable(lib, id); }) : [];
    // 作品が増えていたら、この周の終わりに足す
    lib.haiku.concat(lib.poems).forEach(function (id) {
      if (usable(lib, id) && order.indexOf(id) === -1) order.push(id);
    });
    ms.order = order;
    ms.used = Array.isArray(raw.used) ? raw.used.filter(function (id, i, a) { return usable(lib, id) && a.indexOf(id) === i; }) : [];
    ms.pages = (Array.isArray(raw.pages) ? raw.pages : []).map(checkPageRec).filter(Boolean);
    ms.finishedWorks = (Array.isArray(raw.finishedWorks) ? raw.finishedWorks : []).map(function (f) {
      if (!f || typeof f !== "object" || typeof f.id !== "string") return null;
      var at = intIn(f.at, 0, 1e9), t = isoOrNull(f.completedAt);
      return at === null || !t ? null : { id: f.id, at: at, completedAt: t };
    }).filter(Boolean);
    ms.goldChars = checkGold(raw.goldChars, written);
    var r = raw.retro;
    ms.retro = r && typeof r === "object" ?
      { written: intIn(r.written, 0, 1e9) || 0, works: intIn(r.works, 0, 1e9) || 0, pages: intIn(r.pages, 0, 1e9) || 0 } : null;
    ms.retroDone = raw.retroDone === true || !ms.retro || !ms.retro.written;
    ms.rewardOverride = textOrNull(raw.rewardOverride, REWARD_MAX);
    ms.rewardOverrideId = ms.rewardOverride && typeof raw.rewardOverrideId === "string" && raw.rewardOverrideId ? raw.rewardOverrideId : null;
    ms.nextWorkId = typeof raw.nextWorkId === "string" && usable(lib, raw.nextWorkId) ? raw.nextWorkId : null;

    // 書いている紙。作品が見つからないなど形が崩れていれば、次の文字から新しい紙にする
    var pg = raw.page, items = null;
    if (pg && typeof pg === "object" && Array.isArray(pg.items)) {
      items = pg.items.map(function (it) {
        if (!it || typeof it !== "object" || !lib.byId[it.id]) return null;
        var info = workInfo(lib, it.id);
        var at = intIn(it.at, 0, written), from = intIn(it.from, 0, info.rows.length - 1);
        var cut = it.cut == null ? null : intIn(it.cut, 1, info.len);
        if (at === null || from === null || (it.cut != null && cut === null)) return null;
        return { id: it.id, at: at, from: from, cut: cut };
      });
      if (items.some(function (x) { return !x; })) items = null;
    }
    var pno = items ? intIn(pg.no, 1, 1e6) : null, pstart = items ? intIn(pg.start, 0, written) : null;
    if (items && items.length && pno !== null && pstart !== null) {
      ms.page = { no: pno, start: pstart, items: items };
      var it = last(items);
      if (written - it.at >= effLen(lib, it)) placeNext(ms, lib);
    } else {
      ms.page = { no: (ms.pages.length ? last(ms.pages).no : 0) + 1, start: written, items: [] };
      placeNext(ms, lib);
    }
    return ms;
  }

  var LIB = library(WORKS);

  return {
    KEY: KEY,
    LINE: LINE,
    LINES: LINES,
    GOLD_RATE: GOLD_RATE,
    PAGE_REWARD_LEVEL: PAGE_REWARD_LEVEL,
    REWARD_MAX: REWARD_MAX,
    AUTHORS: AUTHORS,
    WORKS: WORKS,
    LIB: LIB,
    library: library,
    rowsOfText: rowsOfText,
    lengthOf: function (id, o) { return lengthOf(libOf(o), id); },
    makeOrder: makeOrder,
    create: create,
    check: check,
    sync: sync,
    forget: forget,
    current: current,
    skip: skip,
    chooseNext: chooseNext,
    pageGrid: pageGrid,
    frozenGrid: frozenGrid,
    pageLeft: pageLeft,
    pageWorkIds: pageWorkIds,
    workLines: workLines,
    attribution: attribution,
    sourceLabel: sourceLabel,
    kindLabel: kindLabel,
    shortName: shortName,
    drawGold: drawGold,
    checkGold: checkGold
  };
});
