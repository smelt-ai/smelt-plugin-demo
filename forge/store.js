// 铁锭账本：总数和每天的数，存在插件自己的数据目录里，重启不丢。
//
// smelt 不给插件 `localStorage`，插件自己写文件。格式带版本号，读到不认识的版本或坏
// 文件就从零开始。

import * as fs from "fs/promises";
import { dirname, join } from "path";

const VERSION = 1;
/** 每天的数只留最近这么多天。 */
const KEEP_DAYS = 60;

export function ledgerPath(home) {
  return join(home, ".smelt", "plugin-data", "com.smelt.forge", "ledger.json");
}

/** @typedef {{ total: number, days: Record<string, number> }} Ledger */

/** @returns {Ledger} */
export function emptyLedger() {
  return { total: 0, days: {} };
}

/** @returns {Promise<Ledger>} */
export async function loadLedger(path) {
  try {
    const data = JSON.parse(await fs.readFile(path, "utf8"));
    if (data.version !== VERSION || typeof data.total !== "number" || typeof data.days !== "object") {
      return emptyLedger();
    }
    return { total: data.total, days: data.days };
  } catch {
    return emptyLedger();
  }
}

/// 先写临时文件再改名：写到一半退出也不会留下半个文件。
export async function saveLedger(path, ledger) {
  await fs.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ version: VERSION, ...ledger }, null, 2));
  await fs.rename(temp, path);
}

/// 记上 `count` 块铁锭。返回新账本，只留最近 60 天的日账。
export function credit(ledger, day, count) {
  const days = { ...ledger.days, [day]: (ledger.days[day] ?? 0) + count };
  const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
  return { total: ledger.total + count, days: Object.fromEntries(kept.map((key) => [key, days[key]])) };
}
