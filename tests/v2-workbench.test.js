
import test from "node:test";
import assert from "node:assert/strict";
import seed from "../api/_v2-seed.js";
import { getSeedData } from "../api/_v2.js";
import { calculateStats, composeFullText, isOverdue, normalizeData, todayShanghai, toNullableNumber } from "../src/v2-model.js";
test("种子为 12 个情绪词、120 条文案", () => { assert.equal(seed.emotionWords.length, 12); assert.equal(seed.emotionWords.reduce((n, w) => n + w.captions.length, 0), 120); const data = getSeedData(); assert.equal(data.emotionWords.flatMap((w) => w.captions).length, 120); assert.equal(new Set(data.emotionWords.map((w) => w.id)).size, 12); assert.ok(data.products.every((p) => p.id)); });
test("稳定 ID、归档和空数据结构", () => { const data = normalizeData({ emotionWords: [{ id: "quiet", name: "安静", captions: [{ id: "quiet-1", title: "标题", body: "正文" }] }] }); assert.equal(data.emotionWords[0].captions[0].id, "quiet-1"); assert.equal(data.emotionWords[0].captions[0].archived, false); assert.equal(data.schemaVersion, 1); });
test("完整文本、0 和 null 统计规则", () => { assert.match(composeFullText({ extraTags: ["#竹林"] }, { body: "正文" }, { fixedFooter: "固定结尾", baseTags: ["#新津"] }), /固定结尾/); assert.equal(toNullableNumber("0"), 0); assert.equal(toNullableNumber(""), null); const stats = calculateStats([{ date: todayShanghai(), metrics: { views: 0, likes: 0, saves: null, follows: 0 } }]); assert.equal(stats.avgViews, 0); assert.equal(stats.avgLikes, 0); assert.equal(stats.avgSaves, null); assert.equal(stats.follows, 0); });
test("排期逾期判断", () => { assert.equal(isOverdue({ date: "2020-01-01", status: "scheduled" }, "2020-01-02"), true); assert.equal(isOverdue({ date: "2020-01-01", status: "published" }, "2020-01-02"), false); });

