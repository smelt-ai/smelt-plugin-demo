// github.js 的测试。`fetch` 换成替身，不真联网。

import { test } from "node:test";
import assert from "node:assert/strict";

import { commitUrl, lookupCommit, parseGitHubRemote } from "../github.js";

test("认得 https 和 ssh 两种远程地址", () => {
  const expected = { owner: "smelt-ai", repo: "smelt" };
  assert.deepEqual(parseGitHubRemote("https://github.com/smelt-ai/smelt.git"), expected);
  assert.deepEqual(parseGitHubRemote("https://github.com/smelt-ai/smelt"), expected);
  assert.deepEqual(parseGitHubRemote("git@github.com:smelt-ai/smelt.git"), expected);
  assert.deepEqual(parseGitHubRemote("ssh://git@github.com/smelt-ai/smelt.git"), expected);
  assert.deepEqual(parseGitHubRemote("https://github.com/a/b.c"), { owner: "a", repo: "b.c" }, "仓库名可以带点");
  assert.equal(parseGitHubRemote("https://gitlab.com/a/b.git"), null);
  assert.equal(parseGitHubRemote(""), null);
});

test("提交链接", () => {
  assert.equal(commitUrl({ owner: "o", repo: "r" }, "abc"), "https://github.com/o/r/commit/abc");
});

/// 把全局 fetch 换成按状态码回话的替身，记下调了几次。
function stubFetch(t, status, body = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

const github = { owner: "o", repo: "r" };

test("查到提交：带上 GitHub 账号和链接，第二次走缓存", async (t) => {
  const calls = stubFetch(t, 200, { author: { login: "ada" }, html_url: "https://github.com/o/r/commit/s1" });
  const first = await lookupCommit(github, "s1");
  assert.deepEqual(first, { state: "found", login: "ada", url: "https://github.com/o/r/commit/s1" });
  assert.equal(calls[0].url, "https://api.github.com/repos/o/r/commits/s1");
  await lookupCommit(github, "s1");
  assert.equal(calls.length, 1);
});

test("提交没关联账号时 login 为 null", async (t) => {
  stubFetch(t, 200, { author: null });
  const result = await lookupCommit(github, "s2");
  assert.equal(result.login, null);
  assert.equal(result.url, "https://github.com/o/r/commit/s2");
});

test("没推上去的提交：404", async (t) => {
  stubFetch(t, 404);
  assert.deepEqual(await lookupCommit(github, "s3"), { state: "unpushed" });
});

test("限流和其它错误抛出来，不进缓存", async (t) => {
  const calls = stubFetch(t, 403);
  await assert.rejects(lookupCommit(github, "s4"), /限流/);
  await assert.rejects(lookupCommit(github, "s4"), /限流/);
  assert.equal(calls.length, 2);
});
