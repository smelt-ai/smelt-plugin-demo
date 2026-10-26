// scores.js 的测试。在临时目录里读写，不碰真的数据目录。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_SCORES, addScore, bestFor, loadScores, rankOf, saveScores, scoresPath } from "../scores.js";

function entry(score, at, project = "smelt") {
  return { score, correct: 5, total: 10, streak: 2, project, at };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), "code-quiz-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("数据目录按插件 id 分", () => {
  assert.equal(scoresPath("/home/u"), "/home/u/.smelt/plugin-data/com.smelt.demo.code-quiz/scores.json");
});

test("分高的在前，同分新的在前，只留前 50", () => {
  const old = entry(300, 1);
  const recent = entry(300, 2);
  let scores = addScore(addScore(addScore([], entry(100, 3)), old), recent);
  assert.deepEqual(scores, [recent, old, entry(100, 3)]);
  assert.equal(rankOf(scores, old), 2);

  for (let i = 0; i < MAX_SCORES + 5; i++) scores = addScore(scores, entry(500 + i, 10 + i));
  assert.equal(scores.length, MAX_SCORES);
  assert.equal(rankOf(scores, old), null, "挤出榜外");
});

test("某个项目的最高分", () => {
  const scores = addScore(addScore([], entry(200, 1, "a")), entry(150, 2, "b"));
  assert.equal(bestFor(scores, "b"), 150);
  assert.equal(bestFor(scores, "c"), null);
});

test("存了能读回来，目录不存在会先建", async (t) => {
  const path = join(tempDir(t), "deep", "scores.json");
  const scores = [entry(120, 1)];
  await saveScores(path, scores);
  assert.deepEqual(await loadScores(path), scores);
  assert.ok(!fs.existsSync(`${path}.tmp`), "临时文件改名到位了");
});

test("文件不存在、坏了、版本不认识，都当没有成绩", async (t) => {
  const dir = tempDir(t);
  assert.deepEqual(await loadScores(join(dir, "missing.json")), []);
  fs.writeFileSync(join(dir, "broken.json"), "{");
  assert.deepEqual(await loadScores(join(dir, "broken.json")), []);
  fs.writeFileSync(join(dir, "future.json"), JSON.stringify({ version: 99, scores: [entry(1, 1)] }));
  assert.deepEqual(await loadScores(join(dir, "future.json")), []);
});
