// 排行榜：存在插件自己的数据目录里，跨项目、跨重启都在。
//
// smelt 不给插件 `localStorage`（所有插件共用一份权限，键会互相覆盖），插件要存东西
// 就自己写文件。格式带版本号，读到不认识的版本或坏文件就当空的。

import * as fs from "fs/promises";
import { dirname, join } from "path";

const VERSION = 1;
/** 只留前这么多名。 */
export const MAX_SCORES = 50;

/** 数据目录按插件 id 分，和别的插件互不干扰。 */
export function scoresPath(home) {
  return join(home, ".smelt", "plugin-data", "com.smelt.demo.code-quiz", "scores.json");
}

/**
 * @typedef {{ score: number, correct: number, total: number, streak: number,
 *   project: string, at: number }} ScoreEntry
 */

/** @returns {Promise<ScoreEntry[]>} */
export async function loadScores(path) {
  try {
    const data = JSON.parse(await fs.readFile(path, "utf8"));
    return data.version === VERSION && Array.isArray(data.scores) ? data.scores : [];
  } catch {
    return [];
  }
}

/// 先写临时文件再改名：写到一半退出也不会留下半个文件。
export async function saveScores(path, scores) {
  await fs.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ version: VERSION, scores }, null, 2));
  await fs.rename(temp, path);
}

/// 分高的在前，同分时新的在前。
export function addScore(scores, entry) {
  return [...scores, entry].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, MAX_SCORES);
}

/// 这条成绩排第几；没进榜返回 null。
export function rankOf(scores, entry) {
  const index = scores.indexOf(entry);
  return index < 0 ? null : index + 1;
}

/// 某个项目的最高分。
export function bestFor(scores, project) {
  return scores.find((entry) => entry.project === project)?.score ?? null;
}
