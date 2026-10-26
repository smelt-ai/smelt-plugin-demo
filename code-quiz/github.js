// 揭晓答案时联网查这次提交在 GitHub 上是谁、链接在哪。
//
// `fetch` 能访问哪些主机，要在 gpui-shell.json 的 `capabilities.network.hosts` 里声明，
// 这里只用 api.github.com。联网是锦上添花：没网、被限流、提交没推上去，都只是少显示
// 一点，游戏照玩。

import process from "process";

/**
 * `git remote get-url origin` 的输出 → `{ owner, repo }`。不是 GitHub 返回 null。
 * 认得 `https://github.com/o/r(.git)` 和 `git@github.com:o/r(.git)` 两种写法。
 */
export function parseGitHubRemote(url) {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  return match ? { owner: match[1], repo: match[2] } : null;
}

export function commitUrl(github, sha) {
  return `https://github.com/${github.owner}/${github.repo}/commit/${sha}`;
}

/** 同一个提交一局里可能被问到好几次；匿名一小时只有 60 次额度，查过的记下来。 */
const cache = new Map();

/**
 * @returns {Promise<{ state: "found", login: string | null, url: string }
 *   | { state: "unpushed" }>} 限流、出错时抛错。
 */
export async function lookupCommit(github, sha) {
  const key = `${github.owner}/${github.repo}@${sha}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const headers = { Accept: "application/vnd.github+json", "User-Agent": "smelt-code-quiz" };
  // 有令牌额度就宽得多，私有仓库也查得到。插件读得到全部环境变量。
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(
    `https://api.github.com/repos/${github.owner}/${github.repo}/commits/${sha}`,
    { headers },
  );
  let result;
  if (response.status === 404 || response.status === 422) {
    result = { state: "unpushed" };
  } else if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub 限流了，过一会儿再试。设置 GITHUB_TOKEN 环境变量可以放宽额度。");
  } else if (!response.ok) {
    throw new Error(`GitHub 返回 ${response.status}`);
  } else {
    const body = await response.json();
    result = { state: "found", login: body.author?.login ?? null, url: body.html_url ?? commitUrl(github, sha) };
  }
  cache.set(key, result);
  return result;
}
