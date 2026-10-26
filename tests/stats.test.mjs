// stats.js 的测试。在仓库根目录跑：node --test tests/
// stats.js 只用 `fs/promises` 和 `path`，Node 里有同名模块，不需要替身。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scan, extensionOf, countLines, formatBytes, formatCount, NO_EXTENSION } from "../stats.js";

function makeProject(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "smelt-stats-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, contents) {
  const path = join(root, relative);
  fs.mkdirSync(join(path, ".."), { recursive: true });
  fs.writeFileSync(path, contents);
}

test("扩展名取最后一段、小写；点文件和没有点的算没有扩展名", () => {
  assert.equal(extensionOf("main.RS"), ".rs");
  assert.equal(extensionOf("archive.tar.gz"), ".gz");
  assert.equal(extensionOf(".gitignore"), NO_EXTENSION);
  assert.equal(extensionOf("Makefile"), NO_EXTENSION);
});

test("行数：末尾没有换行也算一行，空文件 0 行，含 NUL 是二进制", () => {
  const bytes = (text) => new TextEncoder().encode(text);
  assert.equal(countLines(bytes("")), 0);
  assert.equal(countLines(bytes("a")), 1);
  assert.equal(countLines(bytes("a\n")), 1);
  assert.equal(countLines(bytes("a\nb")), 2);
  assert.equal(countLines(bytes("a\r\nb\r\n")), 2);
  assert.equal(countLines(new Uint8Array([0x61, 0x00, 0x0a])), null);
});

test("按扩展名汇总，行数多的在前", async (t) => {
  const root = makeProject(t);
  write(root, "src/a.js", "1\n2\n3\n");
  write(root, "src/nested/b.js", "1\n");
  write(root, "README.md", "# hi\n");
  write(root, "Makefile", "all:\n\techo\n");

  const result = await scan(root);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.total, { files: 4, lines: 7, bytes: 6 + 2 + 5 + 11, binary: 0 });
  assert.deepEqual(
    result.byExtension.map((group) => [group.ext, group.files, group.lines]),
    [
      [".js", 2, 4],
      [NO_EXTENSION, 1, 2],
      [".md", 1, 1],
    ],
  );
});

test("跳过依赖、构建产物和版本库目录", async (t) => {
  const root = makeProject(t);
  write(root, "index.js", "x\n");
  write(root, "node_modules/dep/index.js", "x\n".repeat(100));
  write(root, "target/debug/out.rs", "x\n");
  write(root, ".git/HEAD", "ref\n");

  const result = await scan(root);
  assert.equal(result.total.files, 1);
  assert.equal(result.total.lines, 1);
});

test("不跟软链，避免成环和跑出项目", async (t) => {
  const root = makeProject(t);
  const outside = makeProject(t);
  write(root, "a.txt", "x\n");
  write(outside, "secret.txt", "x\n".repeat(50));
  fs.symlinkSync(outside, join(root, "linked-dir"));
  fs.symlinkSync(join(root, "a.txt"), join(root, "linked-file.txt"));
  fs.symlinkSync(root, join(root, "loop"));

  const result = await scan(root);
  assert.equal(result.total.files, 1);
  assert.equal(result.total.lines, 1);
});

test("二进制文件计数和大小，不计行", async (t) => {
  const root = makeProject(t);
  write(root, "logo.png", Buffer.from([0x89, 0x50, 0x00, 0x0a, 0x0a]));
  write(root, "a.txt", "x\n");

  const result = await scan(root);
  assert.equal(result.total.files, 2);
  assert.equal(result.total.binary, 1);
  assert.equal(result.total.lines, 1);
  const png = result.byExtension.find((group) => group.ext === ".png");
  assert.deepEqual(png, { ext: ".png", files: 1, lines: 0, bytes: 5 });
});

test("根目录不存在时抛错，交给界面显示", async (t) => {
  const root = makeProject(t);
  await assert.rejects(scan(join(root, "missing")));
});

test("进度回调每 200 个文件一次", async (t) => {
  const root = makeProject(t);
  for (let i = 0; i < 450; i++) write(root, `f${i}.txt`, "");
  const seen = [];
  await scan(root, { onProgress: (files) => seen.push(files) });
  assert.deepEqual(seen, [200, 400]);
});

test("格式化", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatCount(7), "7");
  assert.equal(formatCount(1234567), "1,234,567");
});
