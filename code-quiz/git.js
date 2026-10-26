// 从当前项目的 git 仓库里取题：`process.run` 跑 git 命令，`fs/promises` 读代码。
//
// 子进程的环境变量是空的，命令按宿主的 PATH 找。git 不需要别的环境就能用。
// 都是异步的：视图在 `cx.spawn` 里 await，结果缓存在视图上。

import process from "process";
import * as fs from "fs/promises";
import { join } from "path";

import { parseGitHubRemote } from "./github.js";
import { buildQuestion, isQuizFile, monthLabel, parseBlame, pickSnippet } from "./quiz.js";

/** 只看最近这么多个提交，大仓库也能很快出题。 */
const HISTORY = "3000";
/** 比这大的文件不读。 */
const MAX_FILE_BYTES = 512 * 1024;

async function git(root, args) {
  const output = await process.run("git", args, { cwd: root, timeoutMs: 15_000 });
  if (output.code !== 0) {
    const detail = output.stderr.trim();
    throw new Error(detail.includes("not a git repository") ? "当前项目不是 git 仓库" : detail || `git ${args[0]} 失败`);
  }
  return output.stdout;
}

function unique(lines) {
  return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
}

/**
 * 一局开始时取一次：能出题的文件、作者、提交月份、GitHub 地址。
 * @returns {Promise<{ root: string, files: string[], authors: string[], months: string[],
 *   github: { owner: string, repo: string } | null }>}
 */
export async function loadRepo(root) {
  const [files, authors, times] = await Promise.all([
    git(root, ["ls-files"]),
    git(root, ["log", `-n${HISTORY}`, "--format=%aN"]),
    git(root, ["log", `-n${HISTORY}`, "--format=%at"]),
  ]);
  // 没有 origin 不算错：只是揭晓时不联网查。
  const remote = await git(root, ["remote", "get-url", "origin"]).catch(() => "");
  return {
    root,
    files: unique(files.split("\n")).filter(isQuizFile),
    authors: unique(authors.split("\n")),
    months: unique(times.split("\n").map((seconds) => (seconds.trim() ? monthLabel(Number(seconds) * 1000) : ""))),
    github: parseGitHubRemote(remote.trim()),
  };
}

/**
 * 出一道 `kind` 题：随机挑文件、挑一段代码，用 `git blame` 查中间那行是谁、什么时候写的。
 * 挑到还没提交的行、太短的文件，就换一个再来。
 * @param {() => number} rng
 */
export async function nextQuestion(repo, kind, rng) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const file = repo.files[Math.floor(rng() * repo.files.length)];
    const path = join(repo.root, file);
    const info = await fs.stat(path).catch(() => null);
    if (info === null || !info.isFile() || info.size > MAX_FILE_BYTES) continue;
    const text = await fs.readFile(path, "utf8").catch(() => null);
    if (text === null) continue;
    const picked = pickSnippet(text, rng);
    if (picked === null) continue;

    const snippet = { file, ...picked };
    const line = snippet.start + Math.floor(snippet.lines.length / 2);
    const blame = await git(repo.root, ["blame", "--porcelain", "-L", `${line},${line}`, "--", file]).catch(() => "");
    const commit = parseBlame(blame);
    if (commit === null) continue;

    const question = buildQuestion(kind, snippet, commit, repo, rng);
    if (question !== null) return question;
  }
  throw new Error("在这个项目里没找到合适的代码出题");
}
