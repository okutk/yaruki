/*
 * やる気の原稿用紙: 綴じ帳(書いた原稿用紙の記録)・累計マス・気分の傾向・バックアップ
 *
 * ブラウザでは window.YarukiRecords、node では require("./records.js") で使う。
 * 画面(DOM)と localStorage には触らない(読み書きは index.html が行う)。
 * テスト: node tests/records.test.js
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YarukiRecords = api;
})(this, function () {
  "use strict";

  // 同じ origin(okutk.github.io)は他のアプリと共有なので、このアプリのキーは必ずこれで始める
  var PREFIX = "genkouyoushi-";
  var BINDER_KEY = "genkouyoushi-history-v1";
  var BACKUP_APP = "yaruki-genkouyoushi";
  var BACKUP_FORMAT = 1;
  var PAGE_SIZE = 400;            // 原稿用紙1枚 = 400マス
  var NOTE_MAX = 100;
  var TREND_MIN = 3;              // 気分の傾向は、前後がそろった記録がこれ以上あるときだけ出す

  var MOODS = [
    { v: 1, face: "😣", label: "しんどい" },
    { v: 2, face: "😕", label: "ちょっと重い" },
    { v: 3, face: "😐", label: "ふつう" },
    { v: 4, face: "🙂", label: "まあまあ" },
    { v: 5, face: "😊", label: "いい感じ" }
  ];

  // 1枚の記録の項目(この順で保存する)
  var FIELDS = [
    "id", "task", "category", "difficulty", "heaviness", "time", "energy", "lowEnergy", "level",
    "steps", "done", "finalReward", "rewardLocked", "finalUserId",
    "createdAt", "firstFilledAt", "updatedAt", "completedAt",
    "moodBefore", "moodAfter", "note"
  ];

  function isOwnKey(k) { return typeof k === "string" && k.indexOf(PREFIX) === 0; }

  function newId(now, rng) {
    rng = rng || Math.random;
    var t = (now instanceof Date ? now : new Date()).getTime().toString(36);
    return t + "-" + Math.floor(rng() * 1679616).toString(36);   // 36^4
  }

  function countDone(done) {
    var n = 0;
    if (Array.isArray(done)) done.forEach(function (d) { if (d === true) n++; });
    return n;
  }

  /* ── 値のそろえ方 ─────────────────────────── */
  function isoOrNull(v) {
    return typeof v === "string" && v && !isNaN(Date.parse(v)) ? v : null;
  }
  function intIn(v, lo, hi) {
    return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
  }
  function moodOrNull(v) { return intIn(v, 1, 5); }
  function noteOrNull(v) {
    if (typeof v !== "string" || !v.trim()) return null;
    return v.slice(0, NOTE_MAX);
  }

  // 保存・読み込み用に1枚をそろえる。使えない記録(id や手順が無い、1マスも埋まっていない)は null。
  function checkSheet(s) {
    if (!s || typeof s !== "object") return null;
    if (typeof s.id !== "string" || !s.id || s.id.length > 64) return null;
    if (!Array.isArray(s.steps) || !s.steps.length || s.steps.length > 50) return null;
    var steps = s.steps.map(function (x) { return String(x == null ? "" : x); });
    var srcDone = Array.isArray(s.done) ? s.done : [];
    var done = steps.map(function (_, i) { return srcDone[i] === true; });
    var n = countDone(done);
    if (!n) return null;
    var updatedAt = isoOrNull(s.updatedAt);
    var createdAt = isoOrNull(s.createdAt) || isoOrNull(s.firstFilledAt) || updatedAt;
    if (!createdAt) return null;
    var complete = n === steps.length;
    var out = {
      id: s.id,
      task: typeof s.task === "string" ? s.task : "",
      category: typeof s.category === "string" && s.category ? s.category : null,
      difficulty: intIn(s.difficulty, 0, 100),
      heaviness: intIn(s.heaviness, 1, 5),
      time: intIn(s.time, 0, 1440),
      energy: intIn(s.energy, 1, 3),
      lowEnergy: s.lowEnergy === true,
      level: intIn(s.level, 1, 6),
      steps: steps,
      done: done,
      finalReward: typeof s.finalReward === "string" ? s.finalReward : "",
      rewardLocked: s.rewardLocked === true,
      finalUserId: typeof s.finalUserId === "string" && s.finalUserId ? s.finalUserId : null,
      createdAt: createdAt,
      firstFilledAt: isoOrNull(s.firstFilledAt) || createdAt,
      updatedAt: updatedAt || createdAt,
      completedAt: complete ? (isoOrNull(s.completedAt) || updatedAt || createdAt) : null,
      moodBefore: moodOrNull(s.moodBefore),
      moodAfter: moodOrNull(s.moodAfter),
      note: noteOrNull(s.note)
    };
    return out;
  }

  function emptyBinder() {
    return { version: 1, celebratedPages: 0, sheets: [] };
  }

  function newer(a, b) {           // a の方が新しければ true
    return Date.parse(a.updatedAt) > Date.parse(b.updatedAt);
  }

  // 綴じ帳(保存データ)をそろえる。形がおかしければ空の綴じ帳を返す。同じ id は新しい方を残す。
  function checkBinder(raw) {
    var b = emptyBinder();
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.sheets)) return b;
    b.celebratedPages = intIn(raw.celebratedPages, 0, 1e6) || 0;
    var byId = {};
    raw.sheets.forEach(function (s) {
      var c = checkSheet(s);
      if (!c) return;
      if (byId[c.id] === undefined) { byId[c.id] = b.sheets.length; b.sheets.push(c); }
      else if (newer(c, b.sheets[byId[c.id]])) b.sheets[byId[c.id]] = c;
    });
    return b;
  }

  function indexOfSheet(binder, id) {
    for (var i = 0; i < binder.sheets.length; i++) if (binder.sheets[i].id === id) return i;
    return -1;
  }
  function findSheet(binder, id) {
    var i = indexOfSheet(binder, id);
    return i === -1 ? null : binder.sheets[i];
  }

  function sameContent(a, b) {
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      if (f === "updatedAt") continue;
      if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) return false;
    }
    return true;
  }

  /* 今の原稿用紙の状態を綴じ帳に反映する。binder を書き換える。
   *  1マス以上: 同じ id の記録を入れる/更新する。全部埋まったら completedAt、1マスでも外せば null。
   *  0マス   : 綴じ帳から外す(誤タップ対策)。
   * 戻り値: "added" / "updated" / "same"(変化なし) / "removed" / "none"(0マスで元々無い) */
  function putSheet(binder, rec, nowIso) {
    var idx = indexOfSheet(binder, rec.id);
    if (!countDone(rec.done)) {
      if (idx === -1) return "none";
      binder.sheets.splice(idx, 1);
      return "removed";
    }
    var old = idx === -1 ? null : binder.sheets[idx];
    var src = {};
    for (var k in rec) src[k] = rec[k];
    src.createdAt = isoOrNull(rec.createdAt) || (old && old.createdAt) || nowIso;
    src.firstFilledAt = (old && old.firstFilledAt) || isoOrNull(rec.firstFilledAt) || nowIso;
    src.updatedAt = (old && old.updatedAt) || nowIso;
    src.completedAt = (old && old.completedAt) || nowIso;   // 全部埋まっていなければ checkSheet が null にする
    var next = checkSheet(src);
    if (!next) return "none";
    if (old && sameContent(old, next)) return "same";
    next.updatedAt = nowIso;
    if (old) binder.sheets[idx] = next;
    else binder.sheets.push(next);
    return old ? "updated" : "added";
  }

  function removeSheet(binder, id) {
    var i = indexOfSheet(binder, id);
    if (i === -1) return false;
    binder.sheets.splice(i, 1);
    return true;
  }

  /* ── 累計マス ─────────────────────────────── */
  function totalDone(binder) {
    var n = 0;
    binder.sheets.forEach(function (s) { n += countDone(s.done); });
    return n;
  }
  function completedCount(binder) {
    return binder.sheets.filter(function (s) { return !!s.completedAt; }).length;
  }
  function pageInfo(total) {
    return { pages: Math.floor(total / PAGE_SIZE), rest: total % PAGE_SIZE };
  }
  // まだお祝いしていない枚数に届いていれば、その通算枚数を返す(無ければ 0)
  function pageToCelebrate(binder) {
    var p = Math.floor(totalDone(binder) / PAGE_SIZE);
    return p > binder.celebratedPages ? p : 0;
  }

  /* ── 同じ種類のタスク・気分の傾向・前のあなたより ── */
  // カテゴリがあれば(「その他」以外)カテゴリで、無ければ前後の空白を除いた入力文で比べる
  function kindKey(s) {
    if (s && s.category && s.category !== "other") return "c:" + s.category;
    var t = String((s && s.task) || "").trim();
    return t ? "t:" + t : null;
  }

  // 同じ種類で前後の気分がそろった記録が TREND_MIN 件以上あり、半分以上で「後の方が良い」ときだけ返す
  function moodTrend(sheets, key, excludeId) {
    if (!key) return null;
    var count = 0, up = 0;
    sheets.forEach(function (s) {
      if (s.id === excludeId || kindKey(s) !== key) return;
      if (s.moodBefore == null || s.moodAfter == null) return;
      count++;
      if (s.moodAfter > s.moodBefore) up++;
    });
    if (count < TREND_MIN || up * 2 < count) return null;
    return { count: count, up: up };
  }

  function noteTime(s) { return Date.parse(s.completedAt || s.updatedAt) || 0; }

  // 同じ種類で一言が残っている記録のうち、一番新しいもの
  function latestNote(sheets, key, excludeId) {
    if (!key) return null;
    var best = null;
    sheets.forEach(function (s) {
      if (s.id === excludeId || !s.note || kindKey(s) !== key) return;
      if (!best || noteTime(s) > noteTime(best)) best = s;
    });
    return best ? { note: best.note, at: best.completedAt || best.updatedAt, id: best.id } : null;
  }

  /* ── 並べ方と日付(端末のローカル時刻) ────────── */
  function sortNewest(sheets) {
    return sheets.slice().sort(function (a, b) {
      var d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      return d || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    });
  }
  var WEEK = ["日", "月", "火", "水", "木", "金", "土"];
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function monthKey(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }
  function monthLabel(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月";
  }
  function shortDay(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function dayLabel(iso) {
    return shortDay(iso) + "(" + WEEK[new Date(iso).getDay()] + ")";
  }
  function timeLabel(iso) {
    var d = new Date(iso);
    return d.getHours() + ":" + pad2(d.getMinutes());
  }
  function ymd(date) {
    return date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate());
  }

  function mood(v) {
    for (var i = 0; i < MOODS.length; i++) if (MOODS[i].v === v) return MOODS[i];
    return null;
  }

  /* ── バックアップ ─────────────────────────── */
  function backupFileName(date) { return "yaruki-backup-" + ymd(date) + ".json"; }

  // entries: { キー: localStorage の文字列 }。このアプリのキーだけを入れる。
  function buildBackup(entries, nowIso) {
    var data = {};
    Object.keys(entries).sort().forEach(function (k) {
      if (!isOwnKey(k) || typeof entries[k] !== "string") return;
      try { data[k] = JSON.parse(entries[k]); } catch (e) { data[k] = entries[k]; }
    });
    return { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: nowIso, data: data };
  }

  /* 読み込む前の確認。何も書き換えない。
   * 失敗: { ok: false, error: "broken"(JSON でない・形が違う) / "other"(別アプリのファイル) / "newer" / "empty" }
   * 成功: { ok: true, binder: 綴じ帳 | null, others: { キー: 文字列 }, sheetCount, skipped } */
  function parseBackup(text) {
    var obj;
    try { obj = JSON.parse(String(text == null ? "" : text).replace(/^﻿/, "")); }
    catch (e) { return { ok: false, error: "broken" }; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "broken" };
    if (obj.app !== BACKUP_APP) return { ok: false, error: "other" };
    if (typeof obj.format !== "number") return { ok: false, error: "broken" };
    if (obj.format > BACKUP_FORMAT) return { ok: false, error: "newer" };
    var data = obj.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "broken" };
    var binder = null, others = {}, skipped = 0, hasOthers = false;
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = data[k];
      if (!isOwnKey(k)) continue;
      if (k === BINDER_KEY) {
        if (!v || typeof v !== "object" || !Array.isArray(v.sheets)) return { ok: false, error: "broken" };
        binder = checkBinder(v);
        skipped = v.sheets.length - binder.sheets.length;
      } else {
        if (v === null || v === undefined) continue;
        others[k] = typeof v === "string" ? v : JSON.stringify(v);
        hasOthers = true;
      }
    }
    if (!binder && !hasOthers) return { ok: false, error: "empty" };
    return { ok: true, binder: binder, others: others, sheetCount: binder ? binder.sheets.length : 0, skipped: skipped };
  }

  // 読み込んだ綴じ帳を今の綴じ帳にまとめる。同じ id は updatedAt が新しい方を残す。binder を書き換える。
  function mergeBinder(binder, incoming) {
    var added = 0, updated = 0, same = 0;
    incoming.sheets.forEach(function (s) {
      var i = indexOfSheet(binder, s.id);
      if (i === -1) { binder.sheets.push(s); added++; }
      else if (newer(s, binder.sheets[i])) { binder.sheets[i] = s; updated++; }
      else same++;
    });
    // 読み込みで増えたマスではお祝いを出さない
    binder.celebratedPages = Math.max(binder.celebratedPages, incoming.celebratedPages,
      Math.floor(totalDone(binder) / PAGE_SIZE));
    return { added: added, updated: updated, same: same };
  }

  return {
    PREFIX: PREFIX,
    BINDER_KEY: BINDER_KEY,
    BACKUP_APP: BACKUP_APP,
    PAGE_SIZE: PAGE_SIZE,
    NOTE_MAX: NOTE_MAX,
    TREND_MIN: TREND_MIN,
    MOODS: MOODS,
    FIELDS: FIELDS,
    isOwnKey: isOwnKey,
    newId: newId,
    countDone: countDone,
    checkSheet: checkSheet,
    emptyBinder: emptyBinder,
    checkBinder: checkBinder,
    findSheet: findSheet,
    putSheet: putSheet,
    removeSheet: removeSheet,
    totalDone: totalDone,
    completedCount: completedCount,
    pageInfo: pageInfo,
    pageToCelebrate: pageToCelebrate,
    kindKey: kindKey,
    moodTrend: moodTrend,
    latestNote: latestNote,
    sortNewest: sortNewest,
    monthKey: monthKey,
    monthLabel: monthLabel,
    shortDay: shortDay,
    dayLabel: dayLabel,
    timeLabel: timeLabel,
    mood: mood,
    backupFileName: backupFileName,
    buildBackup: buildBackup,
    parseBackup: parseBackup,
    mergeBinder: mergeBinder
  };
});
