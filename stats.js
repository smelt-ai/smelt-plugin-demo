// 项目文件统计：遍历一个目录，按扩展名汇总文件数、行数和字节数。
//
// 只依赖 gpui-shell 的标准模块 `fs/promises` 和 `path`，Node 里同名模块的子集，
// 所以这个文件在 Node 里也能直接跑测试（见 tests/）。
//
// 所有磁盘访问都是异步的：视图在事件里 await 它，结果缓存在视图上，render 只读缓存。

import { join } from "path";
import * as fs from "fs/promises";

/** 不往下走的目录：依赖、构建产物和版本库，统计它们没有意义还慢。 */
export const SKIPPED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".venv",
  "__pycache__",
]);

/** 最多统计这么多文件，超过就停下并标记 `truncated`。 */
export const MAX_FILES = 20000;

/** 比这大的文件只计字节，不读内容数行。 */
export const MAX_LINE_COUNT_BYTES = 1024 * 1024;

/** 开头这么多字节里出现 NUL 就当二进制，不数行。 */
const BINARY_SNIFF_BYTES = 8000;

const NEWLINE = 0x0a;

/** 没有扩展名的文件（含 `.gitignore` 这类点文件）归到这一组。 */
export const NO_EXTENSION = "";

/// 文件名的扩展名，小写、带点。点文件和没有点的名字算没有扩展名。
export function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : NO_EXTENSION;
}

/// 文本内容的行数。最后一行没有换行符也算一行；空文件是 0 行。
/// 二进制内容返回 null。
export function countLines(bytes) {
  const sniff = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sniff; i++) {
    if (bytes[i] === 0) return null;
  }
  let lines = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === NEWLINE) lines++;
  }
  if (bytes.length > 0 && bytes[bytes.length - 1] !== NEWLINE) lines++;
  return lines;
}

/**
 * 统计 `root` 下的文件。软链一律跳过：既避免成环，也不会顺着链接跑出项目。
 *
 * @param {string} root 绝对路径
 * @param {{ onProgress?: (files: number) => void }} [options]
 *   `onProgress` 每数完一批文件调一次，参数是已经数过的文件数。
 */
export async function scan(root, options = {}) {
  const groups = new Map();
  const total = { files: 0, lines: 0, bytes: 0, binary: 0 };
  let truncated = false;

  // 显式栈做深度优先；`readdir` 已按名字排好，结果和遍历顺序无关。
  const pending = [root];
  while (pending.length > 0 && !truncated) {
    const dir = pending.pop();
    let names;
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      // 根目录读不了要让调用方知道；子目录读不了（权限等）跳过即可。
      if (dir === root) throw error;
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      let info;
      try {
        info = await fs.lstat(path);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (!SKIPPED_DIRS.has(name)) pending.push(path);
        continue;
      }
      if (!info.isFile()) continue;

      if (total.files >= MAX_FILES) {
        truncated = true;
        break;
      }
      const lines = info.size > MAX_LINE_COUNT_BYTES ? 0 : await linesOf(path);
      const ext = extensionOf(name);
      let group = groups.get(ext);
      if (group === undefined) {
        group = { ext, files: 0, lines: 0, bytes: 0 };
        groups.set(ext, group);
      }
      group.files++;
      group.bytes += info.size;
      total.files++;
      total.bytes += info.size;
      if (lines === null) {
        total.binary++;
      } else {
        group.lines += lines;
        total.lines += lines;
      }
      if (options.onProgress && total.files % 200 === 0) options.onProgress(total.files);
    }
  }

  // 行数多的在前；行数一样（比如都是二进制）按字节，再按扩展名，保证顺序稳定。
  const byExtension = [...groups.values()].sort(
    (a, b) => b.lines - a.lines || b.bytes - a.bytes || a.ext.localeCompare(b.ext),
  );
  return { root, total, byExtension, truncated };
}

/// 读不了的文件当 0 行文本：它仍然计入文件数和字节数。
async function linesOf(path) {
  try {
    return countLines(await fs.readFile(path));
  } catch {
    return 0;
  }
}

/// 1536 → "1.5 KB"。
export function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${value} ${units[0]}` : `${value.toFixed(1)} ${units[unit]}`;
}

/// 12345 → "12,345"。
export function formatCount(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function message(error) {
  return error && error.message ? error.message : String(error);
}
