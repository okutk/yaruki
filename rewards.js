/*
 * やる気の原稿用紙: ご褒美の生成と抽選
 *
 * ブラウザでは window.YarukiRewards、node では require("./rewards.js") で使う。
 * テスト: node tests/rewards.test.js
 *
 * ── しくみ ─────────────────────────────────────
 * ご褒美は部品の組み合わせで作る。
 *   マスごと(box)  : [ひと工夫] + 行動                例「目を閉じて」+「好きな曲を1曲聴く」
 *   全完了(final)  : [いつ、] + [ひと工夫] + 行動      例「今週末、」+「スマホの通知を切って」+「映画を1本見る」
 * ひと工夫・いつ は付けない場合も1件として数える。
 *
 * 部品の相性:
 *   ・行動は「種類」を1つ持つ(drink・eat・watch など)。
 *   ・ひと工夫/いつ は「組み合わせてよい種類」と「使えるレベルの範囲」を持ち、合うものだけ組み合わせる。
 *     種類の書き方: "drink eat"(これだけ) / "*"(全部) / "* -praise"(praise 以外全部)
 *   ・CONFLICTS の同じグループの言葉を、ひと工夫と行動の両方が含むときは組み合わせない。
 *     (「目を閉じて」+「10秒だけ目を閉じて休む」、「好きなマグで」+「水をコップ1杯飲む」などを防ぐ)
 *   ・マスごとのご褒美は MAX_LEN.box 文字を超える組み合わせを使わない(スマホの2列表示で長くなりすぎるため)。
 *
 * 抽選(非復元):
 *   ・レベルごとに「今の周回で出したもの」を記録し、使い切るまで同じものは出さない。
 *   ・さらに種類(box/final)ごとに直近 RECENT_LIMIT 回の履歴を持ち、それにも入っていないものから選ぶ。
 *     周回をまたいでも、直近1000回と同じものは出ない。
 *   ・部品を変えたら VERSION を上げる。数や並びが変わると履歴は自動でリセットされる。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YarukiRewards = api;
})(this, function () {
  "use strict";

  var VERSION = 1;
  var LEVELS = 6;
  var RECENT_LIMIT = 1000;
  var MAX_LEN = { box: 28, final: 48 };
  var ID_BASE = 100000; // 履歴のID = レベル × ID_BASE + そのレベルでの番号

  var CONFLICTS = [
    ["目を閉じ", "アイマスク", "見ながら"],
    ["窓"],
    ["深呼吸", "呼吸", "息を"],
    ["伸び", "伸ば", "ストレッチ", "ほぐ"],
    ["スマホ", "SNS", "動画", "画像", "写真", "配信", "アプリ", "スクショ", "YouTube"],
    ["イヤホン"],
    ["タイマー"],
    ["寝転", "横に", "ごろ", "突っ伏", "大の字", "昼寝", "眠", "寝る"],
    ["座", "腰かけ", "ソファ", "ベッド", "椅子"],
    ["曲", "音楽", "ラジオ", "ポッドキャスト", "歌", "アルバム", "環境音", "カラオケ", "ライブ"],
    ["香り", "アロマ", "お香", "ミスト"],
    ["マグ", "コップ", "グラス", "急須", "ポット", "器", "お皿", "小皿"],
    ["味わ"],
    ["ゆっくり"],
    ["少しだけ", "少し"],
    ["贅沢", "ちょっといい", "とっておき"],
    ["好きな"],
    ["お気に入り"],
    ["よくやった", "よし", "えらい", "ほめ", "できた", "拍手", "ガッツポーズ", "宣言", "自分に"],
    ["マス"],
    ["洗"],
    ["場所", "ベランダ", "玄関", "外", "公園", "カフェ", "コンビニ", "机", "床", "日光", "日の当たる"],
    ["報告", "メッセージ", "送る", "連絡", "電話", "友達", "家族", "誘", "ひとり", "人と", "会う", "会い"],
    ["着替え", "パジャマ", "服"],
    ["時間", "予定", "半日", "1日"],
    ["湯", "風呂", "シャワー", "入浴", "銭湯", "温泉"],
    ["クッション", "ブランケット", "くるま"],
    ["暗く"],
    ["迷わず", "思いきって", "堂々と", "記念", "ごほうび", "奮発"],
    ["予約"],
    ["予算", "円"],
    ["朝寝坊", "早起き"],
    ["帰り道", "寄り道"],
    ["休み", "週末", "連休", "帰り道"],
    ["お菓子", "おやつ", "飲み物"],
    ["遠慮", "罪悪感"],
    ["ひと息"],
    ["乾杯"],
    ["丁寧"],
    ["思いきり"],
    ["小さく", "大げさ"],
    ["立って", "立ち", "立ったまま"],
    // 「今すぐやること」(報告・スクショ・宣言)は、先の日付(明日・次の休み…)と組み合わせない
    ["明日", "次の", "今週", "今月", "近いうち", "報告", "スクショ", "宣言"],
    // 「〜したあとで」を時間の言葉と重ねない
    ["あとで", "ついたら", "あとすぐ"]
  ];

  /* ────────────────────────────────────────────────
   * マスごとのご褒美(box)
   * レベル: 1 ささやか(〜30秒) 2 ちょっと(〜1分) 3 ほどよく(〜2分)
   *        4 しっかり(〜3分) 5 たっぷり(〜5分) 6 とっておき(〜10分)
   * ──────────────────────────────────────────────── */
  var BOX = {
    // 「種類|行動({d} に量や時間が入る)|レベル:量;レベル:量…」
    scaled: [
      "eyes|目を閉じて{d}休む|1:10秒だけ;2:1分だけ;3:2分だけ;4:3分;5:5分;6:10分",
      "breath|深呼吸を{d}する|1:3回;2:10回",
      "breath|瞑想を{d}する|3:2分;4:3分;5:5分;6:10分",
      "stretch|ストレッチを{d}する|2:1分;3:2分;4:3分;5:5分;6:10分",
      "gaze|窓の外を{d}眺める|1:30秒;2:1分;3:2分;4:3分;5:5分",
      "air|ベランダか玄関先で{d}外の空気を吸う|2:1分;3:2分;4:3分;5:5分",
      "listen|好きな曲を{d}聴く|1:サビだけ;2:ワンコーラスだけ;3:1曲;4:2曲;5:3曲;6:5曲くらい",
      "listen|ラジオかポッドキャストを{d}聴く|3:2分;4:3分;5:5分;6:10分",
      "watch|好きな動画を{d}見る|3:2分だけ;4:3分だけ;5:5分;6:10分",
      "watch|SNSを{d}見る|2:1分だけ;3:2分だけ;4:3分だけ;5:5分だけ;6:10分だけ",
      "read|漫画を{d}読む|2:1ページ;3:2〜3ページ;4:5ページ;5:1話;6:2話",
      "read|好きな本を{d}読む|2:半ページ;3:1ページ;4:3ページ;5:5分;6:10分",
      "play|ゲームを{d}遊ぶ|3:2分だけ;4:3分だけ;5:5分;6:10分",
      "play|落書きを{d}する|2:1分だけ;3:2分;4:3分;5:5分;6:10分",
      "play|パズルを{d}解く|3:1問;4:2問;5:5分;6:10分",
      "lie|{d}横になる|2:1分だけ;3:2分だけ;4:3分;5:5分;6:10分",
      "lie|ソファで{d}ごろごろする|4:3分;5:5分;6:10分",
      "move|家の中を{d}ぶらぶら歩く|2:1分;3:2分;4:3分",
      "move|近所を{d}歩く|5:5分;6:10分",
      "pet|ペットかぬいぐるみと{d}過ごす|3:2分;4:3分;5:5分;6:10分",
      "chat|家族か友達と{d}おしゃべりする|3:2分;4:3分;5:5分;6:10分",
      "care|手と腕を{d}マッサージする|2:1分;3:2分;4:3分;5:5分",
      "drink|好きな飲み物を片手に{d}くつろぐ|3:2分;4:3分;5:5分;6:10分"
    ],
    // レベルごとの行動「種類|行動」
    //   drink: 飲むだけ / brew: いれる・作ってから飲む / eat: 食べるだけ / cook: 切る・焼くなど手を動かす
    //   shop: 買いに出る / sing: 歌う / eyes: 目を閉じて休む / air: 外の空気を吸う / gaze: 眺める
    acts: {
      1: [
        "drink|水をひと口飲む", "drink|お茶をひと口飲む", "drink|白湯をひと口飲む", "drink|炭酸水をひと口飲む",
        "drink|好きな飲み物をひと口飲む", "drink|麦茶をひと口飲む", "drink|コーヒーをひと口飲む",
        "drink|紅茶をひと口飲む", "drink|ジュースをひと口飲む",
        "eat|ラムネを1粒食べる", "eat|チョコを1かけ食べる", "eat|飴を1つなめる", "eat|ナッツを1粒食べる",
        "eat|グミを1つ食べる", "eat|ガムを1枚かむ", "eat|小さいクッキーを1枚食べる", "eat|干し梅を1つ食べる",
        "eat|キャラメルを1つ食べる", "eat|マシュマロを1つ食べる",
        "breath|大きく息を吐く", "breath|鼻からゆっくり息を吸う", "breath|息を長く吐き切る",
        "breath|ため息をひとつ大きくつく",
        "stretch|両手を上げて伸びをする", "stretch|首をゆっくり左右に倒す", "stretch|肩を3回まわす",
        "stretch|手をグーパーする", "stretch|背中をぐーっと伸ばす", "stretch|足首をくるくる回す",
        "stretch|手首をぶらぶらさせる", "stretch|肩をすとんと落とす", "stretch|つま先立ちを5回する",
        "stretch|腕を前にぐーっと伸ばす",
        "gaze|空の色を確かめる", "gaze|遠くの景色を10秒見る", "gaze|観葉植物を眺める",
        "gaze|好きな色の物を1つ探して眺める",
        "listen|好きな曲のイントロだけ聴く",
        "watch|お気に入りの写真を1枚見る", "watch|推しの写真を1枚見る", "watch|好きな画像を1枚眺める",
        "watch|旅行の写真を1枚見返す", "watch|かわいい動物の画像を1枚見る", "watch|スマホの待ち受けを眺める",
        "care|ハンドクリームを塗る", "care|いい香りのものをかぐ", "care|手をこすり合わせて温める",
        "care|リップを塗る", "care|冷たい水で手を洗う", "care|首の後ろを手で温める",
        "praise|小さくガッツポーズする", "praise|「よし」と声に出す", "praise|自分の肩をぽんと叩く",
        "praise|手帳に小さく丸を描く", "praise|自分に「えらい」と言う", "praise|心の中で「いいね、自分」と言う",
        "play|ペンを1回くるっと回す"
      ],
      2: [
        "drink|水をコップ1杯飲む", "drink|お茶を1杯ゆっくり飲む", "drink|冷たい飲み物を1杯飲む",
        "drink|温かい飲み物を1杯飲む", "drink|好きなジュースを1杯飲む", "drink|炭酸水をグラス1杯飲む",
        "eat|チョコを2かけ食べる", "eat|好きなお菓子を1つ食べる", "eat|果物をひと切れ食べる",
        "eat|おせんべいを1枚食べる", "eat|ヨーグルトをひと口食べる", "eat|ドライフルーツをつまむ",
        "eat|ビスケットを2枚食べる",
        "breath|呼吸を数えながら1分休む", "breath|4秒吸って8秒吐く呼吸を3回する",
        "stretch|立ち上がって体をひねる", "stretch|肩甲骨を寄せてほぐす", "stretch|太ももの裏を伸ばす",
        "stretch|首と肩をゆっくり回す", "stretch|手のひらと指をほぐす", "stretch|その場で軽くジャンプする",
        "gaze|雲の形を1分眺める",
        "listen|環境音(雨音・波の音)を1分聴く", "listen|好きな曲の好きな部分だけリピートする",
        "watch|好きな画像を1分眺める", "watch|動物のショート動画を1本見る", "watch|推しの写真を1分眺める",
        "watch|好きなイラストを1分眺める", "watch|好きな景色の写真を1分眺める",
        "care|ハンドクリームを丁寧に塗り込む", "care|目の周りを指で軽く押す", "care|顔を洗ってさっぱりする",
        "care|アロマやお香の香りをかぐ", "care|手首に好きな香りをつける",
        "praise|自分に「よくやった」と言う", "praise|手帳に今日の「できた」を1つ書く",
        "praise|自分宛てに好きなスタンプを送る", "praise|埋まったマスを数えてにやっとする",
        "play|ペンをくるくる回して遊ぶ", "play|手元の小物で1分遊ぶ",
        "lie|1分だけ机に突っ伏す", "lie|椅子にもたれて1分ぼーっとする",
        "pet|ペットかぬいぐるみをなでる", "pet|お気に入りのぬいぐるみを抱きしめる"
      ],
      3: [
        "brew|飲み物をいれ直して飲む", "brew|温かいお茶をいれて飲む", "brew|氷を入れた飲み物を作って飲む",
        "brew|炭酸水にレモンを入れて飲む", "brew|インスタントのスープを飲む", "brew|ホットミルクを作って飲む",
        "eat|好きなお菓子を小皿に出して食べる", "eat|果物を1つ食べる", "eat|アイスを少しだけ食べる",
        "eat|小さなおやつを1つ味わう", "eat|チーズをひと切れ食べる", "eat|甘いものを少しだけ食べる",
        "eat|ナッツをひとつかみ食べる",
        "breath|呼吸だけに2分集中する",
        "stretch|ラジオ体操の最初のところだけやる", "stretch|腰を左右にひねってほぐす",
        "stretch|肩と首をしっかりほぐす",
        "gaze|空の写真を1枚撮る", "gaze|植物の葉っぱをじっくり眺める",
        "listen|懐かしい曲を1曲聴く", "listen|知らない曲を1曲だけ聴いてみる",
        "listen|好きな曲を少し大きめの音で聴く",
        "watch|ショート動画を2本見る", "watch|好きな人の投稿をさかのぼって見る",
        "read|雑誌をぱらぱらめくる", "read|気になっていた記事を1つ読む",
        "care|足の裏を手でもみほぐす", "care|ホットアイマスクで目を温める", "care|爪をやすりで整える",
        "care|化粧水を顔にたっぷりなじませる",
        "praise|今日のがんばりを手帳に1行書く", "praise|自分に「えらい」とメッセージを送る",
        "praise|手帳に小さなシールを貼る", "praise|できたことリストに1行足す",
        "play|クロスワードを1問解く", "play|折り紙を1枚折る",
        "lie|床に寝転んで天井を見る", "lie|ソファで思いきり伸びる",
        "pet|ぬいぐるみを抱えてぼーっとする",
        "chat|家族か友達に一言メッセージを送る", "chat|好きな人の投稿に「いいね」する"
      ],
      4: [
        "brew|お気に入りの飲み物を丁寧にいれる", "brew|ハーブティーをいれて飲む", "brew|ココアを作って飲む",
        "brew|好きな紅茶をいれて香りを楽しむ", "brew|カフェオレを作って飲む", "brew|はちみつ入りのお湯を作って飲む",
        "eat|好きなおやつを1つ、ゆっくり食べる", "eat|ちょっといいチョコを1粒味わう",
        "eat|プリンかヨーグルトを食べる", "eat|おにぎりか軽食をつまむ", "eat|クッキーと飲み物で休憩する",
        "eat|ナッツとドライフルーツをつまむ",
        "cook|果物を切って食べる",
        "stretch|好きな曲1曲分ストレッチする", "stretch|軽くスクワットを10回する",
        "stretch|その場で足踏みを3分する",
        "air|郵便受けを見に行くついでに外の空気を吸う", "air|家の外に出て空を見上げる",
        "listen|好きな歌手の新しい曲を聴く", "listen|歌詞を見ながら1曲聴く",
        "watch|好きな配信の切り抜きを1本見る", "watch|動物の動画を3分見る", "watch|好きな芸人のネタを1本見る",
        "watch|推しの写真フォルダを眺める",
        "read|ネットのコラムを1本読む", "read|好きな漫画の好きな場面を読み返す",
        "care|蒸しタオルで顔を温める", "care|首にタオルを巻いて温める", "care|好きなボディミストをつける",
        "care|目の上に温かいタオルをのせる",
        "praise|今日できたことを3つ書き出す", "praise|手帳にご褒美シールを貼って眺める",
        "praise|がんばった記録をスクショしておく",
        "play|数独を少しだけ解く", "play|好きなアプリで1回遊ぶ",
        "lie|布団の上で大の字になる", "lie|ベッドに倒れこむ",
        "chat|友達に近況を一言送る", "chat|家族に「ひとつ終わった」と報告する"
      ],
      5: [
        "brew|コーヒーをドリップしていれる", "brew|紅茶をポットでいれて飲む",
        "brew|甘いカフェオレを作ってゆっくり飲む", "brew|冷たいフルーツティーを作る", "brew|抹茶ラテを作って飲む",
        "shop|近くの自販機まで飲み物を買いに行く",
        "eat|好きなおやつをお皿に並べて食べる", "eat|アイスを1つ食べる", "eat|好きなおやつを2つ選んで食べる",
        "cook|トーストにジャムを塗って食べる", "cook|果物を切って器に盛って食べる", "cook|温かいスープを作って飲む",
        "stretch|5分ヨガをする", "stretch|好きな曲2曲分、体を動かす", "stretch|軽く体操をする",
        "stretch|ストレッチ動画に合わせて体を動かす",
        "air|ベランダで5分日光を浴びる", "air|玄関の外に出て空を眺める",
        "move|家の周りをひと回りする",
        "listen|お気に入りの曲をリピートで3回聴く", "listen|好きな歌手のライブ音源を聴く",
        "sing|カラオケアプリで1曲歌う",
        "watch|お笑いの動画を1本見る", "watch|好きなMVを1本見る", "watch|好きな配信を5分見る",
        "watch|推しの動画を1本見る", "watch|好きなアニメのオープニングを見る",
        "read|気になっていた記事を2つ読む", "read|好きな作家のエッセイを1本読む", "read|ネットの漫画を1話読む",
        "care|ホットアイマスクをして5分休む", "care|足湯を5分する", "care|顔のマッサージを5分する",
        "care|ヘアオイルで髪をいたわる", "care|首と肩を温める",
        "praise|今日のがんばりを日記に3行書く", "praise|自分をほめる言葉を5つメモする",
        "praise|埋まってきたマス目をスクショする", "praise|手帳にごほうびスタンプを押す",
        "play|パズルゲームを1ステージ遊ぶ", "play|塗り絵を少し塗る", "play|ジグソーパズルを少し進める",
        "chat|友達と5分チャットする", "chat|家族に電話で5分話す", "chat|誰かに今日のがんばりを報告する"
      ],
      6: [
        "brew|ちょっといい飲み物をいれて10分休む", "brew|カフェ風のドリンクを作る",
        "brew|好きなお茶を急須でいれて味わう", "brew|ホットミルクにはちみつを入れて飲む",
        "shop|近くのカフェで飲み物をテイクアウトする", "shop|コンビニで好きなスイーツを1つ買う",
        "shop|コンビニに寄って好きな飲み物を買う",
        "eat|好きなおやつと飲み物で10分休憩する", "eat|アイスをゆっくり1つ食べる", "eat|好きなパンを1つ食べる",
        "eat|ちょっといいおやつを10分かけて味わう",
        "cook|果物を盛り合わせて食べる", "cook|ホットサンドか軽食を作って食べる",
        "stretch|10分ヨガをする", "stretch|好きな曲を流して10分体を動かす", "stretch|好きな曲で1曲踊る",
        "stretch|タオルを使って全身をほぐす",
        "move|コンビニまで散歩する", "move|公園のベンチまで歩く", "move|近くの公園まで行って戻る",
        "air|ベランダで10分ぼーっとする",
        "sing|カラオケアプリで2曲歌う",
        "listen|好きなアルバムを途中まで聴く",
        "watch|好きなYouTuberの動画を1本見る", "watch|バラエティの好きなコーナーを見る",
        "watch|好きなMVを3本見る", "watch|好きなドラマのハイライトを見る",
        "read|雑誌を10分めくる", "read|短編小説を1本読む",
        "care|パックをして10分休む", "care|足湯を10分する", "care|爪を好きな色に塗る",
        "care|アロマをたいて10分休む", "care|ハンドマッサージをじっくりする",
        "praise|今日の自分に短い手紙を書く", "praise|日記をゆっくり書く",
        "play|ボードゲームアプリで1局遊ぶ", "play|好きな絵を10分描く", "play|パズルゲームを数ステージ遊ぶ",
        "play|ジグソーパズルを10分進める",
        "lie|10分だけ昼寝する",
        "chat|友達と10分電話する", "chat|友達とメッセージで10分やりとりする",
        "brew|ホットチョコレートを作って飲む", "brew|レモネードを作って飲む", "cook|小さなパンケーキを焼く",
        "watch|好きな映画の好きなシーンを見る", "play|オンラインで誰かと1回遊ぶ",
        "pet|ぬいぐるみを抱えて10分ごろごろする", "stretch|ストレッチ動画を1本やってみる"
      ]
    },
    // ひと工夫「文|組み合わせてよい種類|レベル範囲」
    twists: [
      "目を閉じて|breath listen drink eat care|1-6",
      "窓の外を眺めながら|drink eat breath|1-6",
      "背もたれに体をあずけて|drink breath listen watch read eyes|1-6",
      "いったん椅子から立って|stretch gaze drink move air brew cook shop|1-6",
      "「よくやった」とつぶやいてから|*|1-6",
      "小さく拍手してから|*|1-6",
      "肩の力を抜いて|drink eat breath listen watch gaze read|1-6",
      "スマホを置いて|drink eat breath stretch gaze care eyes lie pet air brew cook|1-6",
      "埋まったマスを眺めながら|drink eat breath|1-6",
      "ほっとひと息ついて|drink eat listen watch gaze read play|1-6",
      "ゆっくり味わいながら|drink eat|1-6",
      "日の当たる場所で|drink eat breath stretch gaze lie listen read|1-6",
      "お気に入りの場所に移動して|drink eat breath listen watch read play lie|2-6",
      "鼻歌まじりに|stretch care move brew cook shop|1-6",
      "好きなマグで|drink brew|1-6",
      "次のマスのことは忘れて|* -praise|1-6",
      "「ご褒美タイム」と宣言して|*|1-6",
      "深呼吸をひとつしてから|* -breath -eyes|1-6",
      "机から少し離れて|stretch drink eat breath gaze listen lie move pet brew cook|1-6",
      "照明を少し落として|listen watch breath eyes lie|3-6",
      "イヤホンをつけて|listen watch sing|2-6",
      "タイマーをかけて|watch play lie listen read chat eyes|3-6",
      "ブランケットにくるまって|drink listen watch lie breath read eyes|2-6",
      "床にごろんと寝転んで|listen watch breath gaze eyes|2-6",
      "ソファかベッドに腰かけて|drink eat listen watch play read|2-6",
      "窓を少し開けて|drink breath stretch listen eyes|1-6",
      "手を洗ってさっぱりしてから|eat drink care brew cook|2-6",
      "ぐーっと伸びをしてから|* -stretch|1-6",
      "ちょっと得意げな顔で|praise drink eat|1-6",
      "自分をほめながら|drink eat care stretch brew|1-6",
      "今日の自分に乾杯して|drink|1-6",
      "好きな音楽を小さく流して|drink eat stretch care gaze lie read play brew cook|2-6",
      "外の音に耳をすませながら|drink breath gaze lie eyes|1-6",
      "何も考えずに|gaze breath lie listen watch eyes air|1-6",
      "少しだけ贅沢な気分で|drink eat brew cook shop|1-6",
      "ひと仕事終えた顔で|drink eat stretch brew shop|1-6",
      "誰も見ていないのを確かめて|praise stretch sing|1-6",
      "姿勢をゆるめて|drink eat listen watch read|1-6",
      "足を投げ出して|drink eat listen watch read|1-6",
      "クッションを抱えて|listen watch read drink lie|2-6",
      "できたマスを指さし確認してから|*|1-6",
      "ペンや道具をいったん置いて|*|1-6",
      "ニヤッと笑ってから|*|1-6",
      "口ずさみながら|listen brew cook stretch|2-6",
      "呼吸に合わせて|stretch|1-6",
      "痛くない範囲で|stretch|1-6",
      "思いきり|stretch sing|1-6",
      "こっそり|eat praise|1-6",
      "大げさに|praise stretch|1-6",
      "丁寧に|care|1-6",
      "ぼんやりと|gaze air|1-6",
      "画面から目を離して|gaze eyes breath stretch|1-6",
      "お気に入りの一文を探しながら|read|2-6",
      "冷蔵庫の前で立ったまま|eat drink|1-2",
      "ベランダに出て|drink eat breath stretch|1-6",
      "お気に入りのお皿に出して|eat|2-6",
      "リズムに乗りながら|listen stretch|2-6",
      "温かい飲み物を用意して|listen watch read lie|3-6"
    ]
  };

  /* ────────────────────────────────────────────────
   * 全部埋まったときのご褒美(final)
   * レベル: 1 ささやか(15分・手元にあるもの) 2 ちょっと(30分・数百円)
   *        3 ほどよく(1時間・千円くらい) 4 しっかり(2〜3時間・3千円くらい)
   *        5 たっぷり(半日・5千円くらい) 6 とっておき(1日・1万円くらい)
   * ──────────────────────────────────────────────── */
  var FINAL = {
    scaled: [],
    acts: {
      1: [
        "eat_in|お気に入りのお菓子を1つ食べる", "eat_in|冷凍庫のアイスを1つ食べる", "eat_in|とっておきのチョコを2粒食べる",
        "eat_in|果物を切って食べる",
        "drink_in|好きな飲み物をいれて、ゆっくり飲む", "drink_in|温かいココアを作って飲む", "drink_in|ちょっといいお茶をいれる",
        "watch|好きな動画を1本見る", "watch|SNSを15分だけ自由に見る", "watch|推しの動画を1本見る",
        "watch|好きな番組の好きなコーナーだけ見る",
        "listen|好きな曲を3曲聴く", "listen|お気に入りのアルバムを流して15分くつろぐ", "listen|ラジオを15分聴く",
        "read|漫画を1話読む", "read|好きな本を15分読む", "read|好きな雑誌をぱらぱらめくる",
        "play|ゲームを15分遊ぶ", "play|パズルゲームを1ステージ遊ぶ",
        "rest|15分、何もしないでごろごろする", "rest|ベランダで15分ぼーっとする",
        "nap|15分だけ横になる",
        "care|ハンドクリームでゆっくり手をマッサージする", "care|ホットアイマスクで目を温める",
        "care|好きな香りのボディクリームを塗る",
        "bath|シャワーを浴びてさっぱりする",
        "out|近所を15分散歩する",
        "hobby|好きな絵を15分描く",
        "meet|友達に「終わった！」とメッセージを送る"
      ],
      2: [
        "buy|コンビニで好きなスイーツを1つ買う", "buy|好きなおやつを300円ぶん買う", "buy|コンビニで新作のお菓子を試す",
        "eat_in|アイスを1つ、ゆっくり食べる", "eat_in|好きなお菓子を1袋あける", "eat_in|トーストに好きなものをのせて食べる",
        "drink_out|自販機で好きな飲み物を買う", "drink_in|カフェ風のドリンクを作って飲む",
        "watch|好きな動画を30分見る", "watch|ドラマかアニメを1話見る", "watch|お笑いの動画を30分見る",
        "watch|YouTubeで好きなチャンネルを見る",
        "listen|好きなアルバムを1枚聴く", "listen|好きなラジオを30分聴く",
        "read|漫画を3話読む", "read|好きな本を30分読む",
        "play|ゲームを30分遊ぶ",
        "nap|30分だけ昼寝する",
        "rest|30分、予定を気にせずだらだらする",
        "bath|ゆっくりシャワーを浴びる", "bath|湯船にお湯をためて入る",
        "out|近所を30分散歩する", "out|気になっていた道を歩いてみる",
        "care|パックをして顔をいたわる", "care|爪をきれいに整える",
        "hobby|30分、好きなことに没頭する", "hobby|塗り絵や落書きを30分楽しむ",
        "meet|友達と30分電話する"
      ],
      3: [
        "bath|香りのいい入浴剤でお風呂に入る", "bath|湯船にゆっくり30分つかる",
        "watch|好きなドラマを2話見る", "watch|好きな配信を1時間見る", "watch|好きなアニメを3話見る",
        "drink_out|カフェで好きな飲み物を頼む", "eat_out|パン屋で好きなパンを2つ買って食べる",
        "buy|ちょっといいスイーツを1000円以内で買う", "buy|本屋で気になる本を1冊買う",
        "buy|100円ショップで好きなものを3つ選ぶ", "buy|好きな雑誌を1冊買う",
        "play|ゲームを1時間遊ぶ",
        "read|漫画を1冊読む", "read|好きな本を1時間読む",
        "rest|1時間、何もしない時間をつくる",
        "nap|1時間昼寝する",
        "out|1時間散歩して、気になるお店をのぞく", "out|公園でのんびりする",
        "listen|好きなアルバムを2枚聴く",
        "care|丁寧にスキンケアをする", "care|マッサージで体をほぐす",
        "hobby|1時間、好きなことに没頭する",
        "meet|友達とオンラインでおしゃべりする",
        "eat_in|ちょっといいアイスを食べる", "buy|デザートを買ってきて食べる",
        "buy|ちょっといい紅茶やコーヒーを買ってきて飲む"
      ],
      4: [
        "watch|映画を1本見る", "watch|ドラマを一気に3話見る", "watch|好きなアーティストのライブ映像を見る",
        "eat_out|好きなお店でランチする", "eat_out|ちょっといいランチを食べに行く",
        "eat_out|回転寿司に行く", "eat_out|好きなラーメンを食べに行く",
        "eat_in|好きなものをデリバリーで頼む", "buy|ちょっといいケーキを買ってくる",
        "buy|欲しかったものを3000円以内で買う", "buy|気になっていた本を2冊買う", "buy|好きなお店で雑貨を1つ買う",
        "out|カラオケに行く", "out|銭湯かスーパー銭湯に行く", "out|ちょっと遠くの公園まで出かける",
        "drink_out|行ってみたかったカフェに行く", "drink_out|カフェでケーキセットを頼む",
        "play|ゲームを2時間遊ぶ",
        "read|漫画を2〜3冊まとめて読む",
        "nap|たっぷり昼寝する",
        "rest|2時間、好きなことだけして過ごす",
        "care|ネイルやヘアケアに時間をかける",
        "hobby|2時間、趣味に没頭する",
        "meet|友達とお茶をする",
        "bath|入浴剤を入れて長風呂する"
      ],
      5: [
        "rest|半日、予定を入れずに過ごす",
        "eat_out|好きなものを外食かデリバリーで楽しむ", "eat_out|ちょっといいお店でディナーする",
        "eat_out|焼肉を食べに行く", "eat_out|食べたかったスイーツのお店に行く",
        "buy|前から気になっていたものを1つ買う", "buy|欲しかったものを5000円以内で買う",
        "buy|気になっていた服を1着買う", "buy|本屋で本を2〜3冊選んで買う",
        "out|映画館で映画を見る", "out|スーパー銭湯で半日のんびりする", "out|ちょっと遠くの街まで出かける",
        "out|美術館や水族館に行く", "out|気になっていたイベントに行く",
        "care|マッサージや整体に行く", "care|美容院でトリートメントまでしてもらう",
        "watch|映画を2本続けて見る", "watch|好きなシリーズを一気見する",
        "play|半日、ゲームに没頭する",
        "hobby|半日、趣味に没頭する",
        "meet|友達とごはんに行く",
        "nap|目覚ましをかけずに眠る",
        "drink_out|カフェをはしごする",
        "eat_out|気になっていたお店でランチをする", "eat_out|食べ放題に行く",
        "out|プラネタリウムに行く", "out|植物園や大きな公園を歩く", "out|ボウリングやゲームセンターで遊ぶ",
        "out|ドライブに出かける", "out|古本屋や雑貨屋をめぐる", "care|岩盤浴に行く",
        "watch|好きな映画シリーズを見返す", "rest|半日、スマホを見ずにのんびりする",
        "meet|友達を誘ってカラオケに行く", "buy|ちょっといい文房具を買う", "buy|好きなブランドのコスメを1つ買う"
      ],
      6: [
        "rest|丸1日、予定を入れず自由に過ごす",
        "meet|会いたかった人と会う約束をする", "meet|友達と1日遊びに行く",
        "out|日帰り旅行に行く", "out|温泉に行く", "out|ライブや舞台のチケットを取る",
        "out|テーマパークに遊びに行く", "out|行きたかった場所に遠出する", "out|ちょっといいホテルでのんびり過ごす",
        "buy|前から欲しかったものを思いきって買う", "buy|欲しかったものを1万円以内で買う",
        "buy|欲しかった服と靴をそろえる", "buy|ちょっといい家電や道具を買う",
        "eat_out|ちょっといいホテルのランチに行く", "eat_out|アフタヌーンティーを予約する",
        "eat_out|行ってみたかったレストランを予約する", "eat_out|食べたかった高級スイーツを食べに行く",
        "care|エステやヘッドスパに行く",
        "watch|1日中、好きなドラマや映画を一気見する",
        "play|1日中、好きなゲームをする",
        "hobby|1日を趣味だけのために使う",
        "nap|1日、好きなだけ寝る",
        "out|一泊旅行に行く", "out|行ってみたかった街を1日歩く", "out|好きなアーティストのライブに行く",
        "out|キャンプやグランピングに行く", "out|美術館をはしごする",
        "eat_out|コース料理を食べに行く", "eat_out|ちょっといい焼肉店に行く", "care|1日スパでのんびりする",
        "buy|新しい趣味の道具をそろえる", "meet|家族や友達とごちそうを食べる",
        "rest|1日スマホを置いてのんびりする", "buy|前から欲しかったゲームを買う"
      ]
    },
    twists: [
      "スマホの通知を切って|watch read play rest bath listen nap hobby eat_in drink_in|1-6",
      "誰にも遠慮せず|*|1-6",
      "いつもより少し贅沢に|eat_in eat_out drink_in drink_out buy bath|1-6",
      "罪悪感ゼロで|*|1-6",
      "時間を気にせず|watch read play rest bath hobby listen out meet|2-6",
      "お気に入りの服を着て|eat_out drink_out out buy meet|2-6",
      "部屋を少し暗くして|watch listen rest nap|1-6",
      "好きな音楽をかけながら|bath eat_in drink_in rest read hobby care|1-6",
      "ちょっといい器に盛って|eat_in|1-6",
      "帰り道に寄り道して|buy eat_out drink_out|2-6",
      "「今日はよくやった」と宣言して|*|1-6",
      "誰かに「終わった！」と報告してから|*|1-6",
      "完成したマス目をスクショしてから|*|1-6",
      "ふかふかのクッションを用意して|watch read play rest listen|1-6",
      "お菓子と飲み物を用意して|watch read play hobby listen|1-6",
      "パジャマに着替えて|watch read play rest listen eat_in drink_in nap|1-4",
      "窓を開けて風を入れながら|rest read eat_in drink_in hobby listen|1-6",
      "がんばった記念に|buy eat_out eat_in drink_out|1-6",
      "迷わず|buy eat_out|2-6",
      "思いきって|buy out eat_out meet|3-6",
      "天気がよければ外で|read eat_in drink_in rest|1-3",
      "ゆっくり湯船につかったあとで|watch read eat_in drink_in rest nap listen|1-4",
      "明日の予定を気にせず|watch play read|1-4",
      "ひとりで気ままに|eat_out drink_out out watch read|2-6",
      "好きな人を誘って|eat_out drink_out out|3-6",
      "ブランケットにくるまって|watch read rest listen nap|1-4",
      "家事は全部あとに回して|watch read play rest nap hobby|1-6",
      "自分へのごほうびとして堂々と|buy eat_out eat_in|1-6",
      "前もって予約して|eat_out care out|4-6",
      "少し早起きして|out eat_out drink_out buy|4-6",
      "ゆっくり朝寝坊してから|out eat_out drink_out buy watch play hobby|4-6",
      "天気のいい日を選んで|out eat_out drink_out|4-6",
      "頑張った自分を連れて|out eat_out drink_out|3-6",
      "ちょっとおしゃれして|eat_out drink_out out meet|3-6",
      "予算を決めて|buy eat_out|3-6",
      "奮発して|buy eat_out care|4-6"
    ],
    // いつ「文|組み合わせてよい種類|レベル範囲」。後ろに「、」を付けてつなぐ。
    whens: [
      "このあとすぐ|*|1-2",
      "ひと息ついたら|*|1-1",
      "寝る前に|watch read play rest bath listen care eat_in drink_in hobby|1-2",
      "今日のうちに|*|2-3",
      "今夜|watch read play rest bath listen care eat_in drink_in hobby meet|2-3",
      "明日|*|3-4",
      "次の休みに|*|3-6",
      "今週末|*|4-5",
      "今週中に|*|4-4",
      "今月中に|*|5-6",
      "次の連休に|*|6-6",
      "近いうちに|*|6-6"
    ]
  };

  var DEFS = { box: BOX, final: FINAL };

  /* ── 組み立て ──────────────────────────────── */
  function parseKinds(spec) {
    var all = false, only = {}, not = {};
    spec.split(/\s+/).forEach(function (k) {
      if (!k) return;
      if (k === "*") all = true;
      else if (k.charAt(0) === "-") not[k.slice(1)] = true;
      else only[k] = true;
    });
    return function (kind) { return !not[kind] && (all || !!only[kind]); };
  }

  function parseParts(list) {
    return (list || []).map(function (s) {
      var p = s.split("|");
      var r = p[2].split("-");
      return { text: p[0], fits: parseKinds(p[1]), min: +r[0], max: +r[1] };
    });
  }

  // 文ごとに「どの CONFLICTS グループの言葉を含むか」をビットで覚えておき、AND で判定する(スマホでも速い)
  var maskCache = {};
  function maskOf(text) {
    if (maskCache[text]) return maskCache[text];
    var m = [];
    for (var i = 0; i < CONFLICTS.length; i++) {
      var g = CONFLICTS[i];
      for (var j = 0; j < g.length; j++) {
        if (text.indexOf(g[j]) !== -1) { m[i >> 5] = (m[i >> 5] || 0) | (1 << (i & 31)); break; }
      }
    }
    return (maskCache[text] = m);
  }

  function conflicts(a, b) {
    var x = maskOf(a), y = maskOf(b);
    for (var i = 0; i < x.length; i++) if ((x[i] & (y[i] || 0)) !== 0) return true;
    return false;
  }

  function actsFor(def, level) {
    var out = [];
    (def.acts[level] || []).forEach(function (s) {
      var bar = s.indexOf("|");
      out.push({ kind: s.slice(0, bar), text: s.slice(bar + 1) });
    });
    (def.scaled || []).forEach(function (s) {
      var p = s.split("|");
      p[2].split(";").forEach(function (pair) {
        var colon = pair.indexOf(":");
        if (+pair.slice(0, colon) === level) out.push({ kind: p[0], text: p[1].replace("{d}", pair.slice(colon + 1)) });
      });
    });
    return out;
  }

  function joinTwist(twist, act) {
    if (!twist) return act;
    return twist + (twist.length >= 9 ? "、" : "") + act;
  }

  var poolCache = {};
  function pool(type, level) {
    var key = type + level;
    if (poolCache[key]) return poolCache[key];
    var def = DEFS[type];
    var twists = parseParts(def.twists).filter(function (t) { return t.min <= level && level <= t.max; });
    var whens = parseParts(def.whens).filter(function (w) { return w.min <= level && level <= w.max; });
    var seen = {}, items = [];
    function add(s) {
      if (s.length > MAX_LEN[type] || seen[s]) return;
      seen[s] = true;
      items.push(s);
    }
    actsFor(def, level).forEach(function (act) {
      var tws = [null].concat(twists.filter(function (t) { return t.fits(act.kind) && !conflicts(t.text, act.text); }));
      var whs = [null].concat(whens.filter(function (w) { return w.fits(act.kind) && !conflicts(w.text, act.text); }));
      whs.forEach(function (w) {
        tws.forEach(function (t) {
          if (w && t && conflicts(w.text, t.text)) return;
          var body = joinTwist(t && t.text, act.text);
          add(w ? w.text + "、" + body : body);
        });
      });
    });
    poolCache[key] = items;
    return items;
  }

  // 部品データのハッシュ。部品を変えると値が変わり、古い履歴はリセットされる(全レベルを作らずに求められる)
  var sigCache = {};
  function signature(type) {
    if (sigCache[type]) return sigCache[type];
    var src = JSON.stringify([VERSION, MAX_LEN[type], CONFLICTS, DEFS[type]]);
    var h = 0x811c9dc5;
    for (var i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (sigCache[type] = "v" + VERSION + ":" + h.toString(16));
  }

  /* ── 抽選 ────────────────────────────────────
   * hist は種類(box/final)ごとの履歴。JSON にしてそのまま保存できる。
   *   { sig: 部品の署名, used: { レベル: 16進のビット列 }, recent: [直近のID…] }
   * draw() は hist を書き換える。保存は呼び出し側で行う。 */
  function emptyHistory(type) {
    return { sig: signature(type), used: {}, recent: [] };
  }

  function checkHistory(type, hist) {
    if (!hist || typeof hist !== "object" || hist.sig !== signature(type) ||
        typeof hist.used !== "object" || !Array.isArray(hist.recent)) {
      return emptyHistory(type);
    }
    return hist;
  }

  function decodeBits(hex, n) {
    var bits = new Uint8Array(n);
    if (typeof hex !== "string") return bits;
    for (var c = 0; c < hex.length; c++) {
      var v = parseInt(hex.charAt(c), 16) || 0;
      for (var b = 0; b < 4; b++) {
        var i = c * 4 + b;
        if (i < n && (v >> b) & 1) bits[i] = 1;
      }
    }
    return bits;
  }

  function encodeBits(bits) {
    var s = "";
    for (var i = 0; i < bits.length; i += 4) {
      var v = 0;
      for (var b = 0; b < 4 && i + b < bits.length; b++) if (bits[i + b]) v |= 1 << b;
      s += v.toString(16);
    }
    return s;
  }

  function clampLevel(level) {
    level = Math.round(Number(level) || 1);
    return Math.max(1, Math.min(LEVELS, level));
  }

  function draw(type, level, hist, rng) {
    rng = rng || Math.random;
    level = clampLevel(level);
    var items = pool(type, level), n = items.length;
    var used = decodeBits(hist.used[level], n);
    var recent = {};
    hist.recent.forEach(function (id) { recent[id] = true; });
    var base = level * ID_BASE;

    var cand = [];
    for (var i = 0; i < n; i++) if (!used[i] && !recent[base + i]) cand.push(i);
    if (!cand.length) {
      // この周回を使い切った。直近の履歴に入っているもの以外で、新しい周回を始める。
      used = new Uint8Array(n);
      for (var j = 0; j < n; j++) if (!recent[base + j]) cand.push(j);
    }
    var pick = cand[Math.min(cand.length - 1, Math.floor(rng() * cand.length))];
    used[pick] = 1;
    hist.used[level] = encodeBits(used);
    hist.recent.push(base + pick);
    if (hist.recent.length > RECENT_LIMIT) hist.recent.splice(0, hist.recent.length - RECENT_LIMIT);
    return { id: base + pick, level: level, text: items[pick] };
  }

  return {
    VERSION: VERSION,
    LEVELS: LEVELS,
    RECENT_LIMIT: RECENT_LIMIT,
    MAX_LEN: MAX_LEN,
    pool: pool,
    signature: signature,
    emptyHistory: emptyHistory,
    checkHistory: checkHistory,
    draw: draw
  };
});
