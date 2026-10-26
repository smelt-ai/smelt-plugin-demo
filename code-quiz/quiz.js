// 出题和计分的纯逻辑：不读盘、不起进程、不联网，随机数由调用方传进来。
// 所以这个文件在 Node 里可以直接测（见 tests/quiz.test.mjs）。

/** 一局几道题。 */
export const ROUND_SIZE = 10;
/** 每道题的时间。 */
export const QUESTION_MS = 20_000;
/** 一段代码几行。 */
export const SNIPPET_LINES = 6;
/** 几个选项。 */
export const CHOICES = 4;

export const KIND_PROMPTS = {
  file: "这段代码在哪个文件里？",
  author: "高亮的这一行是谁写的？",
  when: "高亮的这一行是什么时候写的？",
};

/** 拿来出题的代码文件。锁文件、压缩产物、依赖目录不要：看一眼就知道，没意思。 */
const CODE_EXTENSIONS = new Set([
  "c", "cc", "cpp", "cs", "css", "dart", "ex", "go", "h", "hpp", "java", "js", "jsx", "kt",
  "lua", "m", "mjs", "php", "py", "rb", "rs", "scala", "scss", "sh", "sql", "svelte", "swift",
  "ts", "tsx", "vue", "zig",
]);
const SKIPPED_PATH = /(^|\/)(node_modules|vendor|dist|build|target|third_party)\//;

/** 0 ≤ x < 1 的随机数。游戏里用 `Math.random`，测试里用固定种子。 */
/** @typedef {() => number} Rng */

export function extensionOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isQuizFile(path) {
  return CODE_EXTENSIONS.has(extensionOf(path)) && !SKIPPED_PATH.test(path) && !path.includes(".min.");
}

/** @param {Rng} rng */
export function pick(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

/** 打乱一份副本。 @param {Rng} rng */
export function shuffle(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 不重复地抽 `count` 个；不够就全给。 @param {Rng} rng */
export function sample(items, count, rng) {
  return shuffle([...new Set(items)], rng).slice(0, count);
}

/// 去掉这几行共同的缩进，制表符按两个空格算。
export function dedent(lines) {
  const expanded = lines.map((line) => line.replace(/\t/g, "  ").trimEnd());
  const indents = expanded.filter((line) => line.trim() !== "").map((line) => line.match(/^ */)[0].length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return expanded.map((line) => line.slice(common));
}

/**
 * 从文件内容里挑连续几行。太短、大半是空行或括号的不要，超长的行也不要（多半是生成的）。
 * 返回 `{ start, lines }`，`start` 从 1 数；挑不出来返回 null。
 * @param {Rng} rng
 */
export function pickSnippet(text, rng, size = SNIPPET_LINES) {
  const all = text.split("\n");
  if (all.length < size) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = Math.floor(rng() * (all.length - size + 1));
    const lines = all.slice(start, start + size);
    const meaningful = lines.filter((line) => /[\p{L}\p{N}_]{3,}/u.test(line)).length;
    if (meaningful >= Math.ceil(size / 2) && lines.every((line) => line.length <= 160)) {
      return { start: start + 1, lines: dedent(lines) };
    }
  }
  return null;
}

/**
 * `git blame --porcelain -L n,n` 的输出：第一行是 `<sha> <原行号> <行号> <行数>`，
 * 之后是 `键 值` 形式的提交信息，以制表符开头的那行是代码本身。
 * 还没提交的行（sha 全是 0）返回 null：没有答案可猜。
 */
export function parseBlame(output) {
  const lines = output.split("\n");
  const sha = (lines[0] ?? "").split(" ")[0];
  if (!/^[0-9a-f]{40}$/.test(sha) || /^0+$/.test(sha)) return null;
  const fields = {};
  for (const line of lines.slice(1)) {
    if (line.startsWith("\t")) break;
    const space = line.indexOf(" ");
    if (space > 0) fields[line.slice(0, space)] = line.slice(space + 1);
  }
  return {
    sha,
    author: fields.author ?? "",
    email: (fields["author-mail"] ?? "").replace(/^<|>$/g, ""),
    time: Number(fields["author-time"] ?? 0) * 1000,
    summary: fields.summary ?? "",
  };
}

/// 用本地时间，和 git log 里人看到的日子一致。
export function monthLabel(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

/**
 * 正确答案加上从 `pool` 里抽的干扰项，打乱。干扰项凑不够就返回 null：这道题出不了。
 * @param {Rng} rng
 */
export function makeChoices(answer, pool, rng, count = CHOICES) {
  const others = sample(pool.filter((item) => item !== answer), count - 1, rng);
  return others.length < count - 1 ? null : shuffle([answer, ...others], rng);
}

/// 文件题的干扰项优先找同扩展名的：只看扩展名就能排除三个，就不用读代码了。
export function fileDistractors(answer, files) {
  const ext = extensionOf(answer);
  const same = files.filter((file) => file !== answer && extensionOf(file) === ext);
  return same.length >= CHOICES - 1 ? same : files.filter((file) => file !== answer);
}

/// 这个仓库能出哪几种题：每种都要凑得出四个不同的选项。
export function availableKinds(repo) {
  const kinds = [];
  if (repo.files.length >= CHOICES) kinds.push("file");
  if (repo.authors.length >= CHOICES) kinds.push("author");
  if (repo.months.length >= CHOICES) kinds.push("when");
  return kinds;
}

/**
 * 拼一道题。凑不出选项时返回 null，调用方换一段代码重来。
 * @param {"file" | "author" | "when"} kind
 * @param {{ file: string, start: number, lines: string[] }} snippet
 * @param {Rng} rng
 */
export function buildQuestion(kind, snippet, commit, repo, rng) {
  const focusLine = snippet.start + Math.floor(snippet.lines.length / 2);
  let answer;
  let choices;
  if (kind === "file") {
    answer = snippet.file;
    choices = makeChoices(answer, fileDistractors(answer, repo.files), rng);
  } else if (kind === "author") {
    answer = commit.author;
    choices = makeChoices(answer, repo.authors, rng);
  } else {
    answer = monthLabel(commit.time);
    choices = makeChoices(answer, repo.months, rng);
  }
  if (choices === null) return null;
  return { kind, prompt: KIND_PROMPTS[kind], snippet, focusLine, choices, answer, commit };
}

/**
 * 答对得 100，剩的每一秒加 5，连对从第二题起每题再加 20（最多加 100）。
 * `streak` 是算上这一题之后的连对数。
 */
export function scoreFor(correct, msLeft, streak) {
  if (!correct) return 0;
  return 100 + Math.ceil(Math.max(0, msLeft) / 1000) * 5 + Math.min(Math.max(streak - 1, 0), 5) * 20;
}

/// 复制出去的成绩单。
export function shareText(project, results, score) {
  const grid = results.map((result) => (result.correct ? "🟩" : "🟥")).join("");
  const correct = results.filter((result) => result.correct).length;
  return `代码猜猜看 · ${project}\n${grid}\n${correct}/${results.length} 题 · ${score} 分`;
}
