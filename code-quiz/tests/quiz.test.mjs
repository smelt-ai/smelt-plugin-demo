// quiz.js 的测试。在 code-quiz 目录里跑：node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHOICES,
  availableKinds,
  buildQuestion,
  dedent,
  fileDistractors,
  isQuizFile,
  makeChoices,
  monthLabel,
  parseBlame,
  pickSnippet,
  scoreFor,
  shareText,
  shuffle,
} from "../quiz.js";

/// 固定种子的随机数，测试结果不随运行变化。
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHA = "3f1c0d4e9a7b2c6d8e0f1a2b3c4d5e6f7a8b9c0d";

test("只拿代码文件出题，依赖目录、压缩产物不要", () => {
  assert.ok(isQuizFile("src/main.rs"));
  assert.ok(isQuizFile("web/App.TSX"));
  assert.ok(!isQuizFile("Cargo.lock"));
  assert.ok(!isQuizFile("README.md"));
  assert.ok(!isQuizFile("node_modules/x/index.js"));
  assert.ok(!isQuizFile("web/dist/app.js"));
  assert.ok(!isQuizFile("vendor/jquery.min.js"));
});

test("打乱不丢元素", () => {
  const items = [1, 2, 3, 4, 5, 6];
  assert.deepEqual([...shuffle(items, seeded(1))].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5, 6], "原数组不动");
});

test("去掉共同缩进，制表符按两个空格算", () => {
  assert.deepEqual(dedent(["    a", "      b", "", "\t\tc"]), ["a", "  b", "", "c"]);
});

test("挑代码段：太短的文件、全是括号的挑不出来", () => {
  assert.equal(pickSnippet("a\nb", seeded(1)), null);
  assert.equal(pickSnippet("}\n}\n}\n}\n}\n}\n}\n}", seeded(1)), null);

  const text = Array.from({ length: 30 }, (_, i) => `    let value_${i} = compute(${i});`).join("\n");
  const snippet = pickSnippet(text, seeded(7));
  assert.equal(snippet.lines.length, 6);
  assert.ok(snippet.start >= 1 && snippet.start <= 25);
  assert.match(snippet.lines[0], /^let value_\d+/, "去掉了缩进");
});

test("解析 git blame --porcelain", () => {
  const output = [
    `${SHA} 12 12 1`,
    "author Ada Lovelace",
    "author-mail <ada@example.com>",
    "author-time 1700000000",
    "author-tz +0000",
    "summary feat: 分析机",
    "filename src/engine.rs",
    "\tlet x = 1;",
  ].join("\n");
  assert.deepEqual(parseBlame(output), {
    sha: SHA,
    author: "Ada Lovelace",
    email: "ada@example.com",
    time: 1_700_000_000_000,
    summary: "feat: 分析机",
  });
  assert.equal(parseBlame(`${"0".repeat(40)} 1 1 1\nauthor Not Committed Yet\n`), null, "还没提交的行没法猜");
  assert.equal(parseBlame(""), null);
});

test("选项：正确答案在里面、不重复；干扰项不够就出不了", () => {
  const choices = makeChoices("b", ["a", "b", "c", "d", "e"], seeded(3));
  assert.equal(choices.length, CHOICES);
  assert.ok(choices.includes("b"));
  assert.equal(new Set(choices).size, CHOICES);
  assert.equal(makeChoices("a", ["a", "b", "c"], seeded(3)), null);
  assert.equal(makeChoices("a", ["b", "b", "b", "c"], seeded(3)), null, "重复的不算");
});

test("文件题的干扰项优先同扩展名", () => {
  const files = ["a.rs", "b.rs", "c.rs", "d.rs", "x.ts", "y.ts"];
  assert.deepEqual(fileDistractors("a.rs", files), ["b.rs", "c.rs", "d.rs"]);
  assert.deepEqual(fileDistractors("x.ts", files), ["a.rs", "b.rs", "c.rs", "d.rs", "y.ts"], "同扩展名不够就全拿");
});

test("能出哪几种题看选项凑不凑得够", () => {
  const repo = { files: ["a", "b", "c", "d"], authors: ["solo"], months: ["1", "2", "3", "4", "5"] };
  assert.deepEqual(availableKinds(repo), ["file", "when"]);
});

test("拼题：答案对得上题型，高亮行在中间", () => {
  const repo = {
    files: ["a.rs", "b.rs", "c.rs", "d.rs"],
    authors: ["Ada", "Bob", "Cy", "Di"],
    months: ["2024 年 1 月", "2024 年 2 月", "2024 年 3 月", monthLabel(1_700_000_000_000)],
  };
  const snippet = { file: "b.rs", start: 10, lines: ["1", "2", "3", "4", "5", "6"] };
  const commit = { sha: SHA, author: "Cy", email: "", time: 1_700_000_000_000, summary: "" };

  const file = buildQuestion("file", snippet, commit, repo, seeded(1));
  assert.equal(file.answer, "b.rs");
  assert.equal(file.focusLine, 13);
  assert.equal(buildQuestion("author", snippet, commit, repo, seeded(1)).answer, "Cy");
  assert.equal(buildQuestion("when", snippet, commit, repo, seeded(1)).answer, monthLabel(1_700_000_000_000));
  assert.equal(buildQuestion("author", snippet, commit, { ...repo, authors: ["Cy", "Ada"] }, seeded(1)), null);
});

test("计分：快、连对都加分，答错不得分", () => {
  assert.equal(scoreFor(false, 19_000, 0), 0);
  assert.equal(scoreFor(true, 0, 1), 100);
  assert.equal(scoreFor(true, 10_000, 1), 150);
  assert.equal(scoreFor(true, 9_001, 3), 100 + 50 + 40, "不足一秒按一秒算，连对第三题加 40");
  assert.equal(scoreFor(true, 0, 50), 200, "连对加成最多 100");
});

test("成绩单", () => {
  const results = [{ correct: true }, { correct: false }, { correct: true }];
  assert.equal(shareText("smelt", results, 260), "代码猜猜看 · smelt\n🟩🟥🟩\n2/3 题 · 260 分");
});
