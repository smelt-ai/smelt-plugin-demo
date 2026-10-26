// forge.js、sprites.js、store.js 的测试。在 forge 目录里跑：node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LEVELS, agentLabel, dayKey, levelFor, observe, order } from "../forge.js";
import { FRAMES, HEIGHT, INGOT, PALETTE, WIDTH, runs } from "../sprites.js";
import { credit, emptyLedger, ledgerPath, loadLedger, saveLedger } from "../store.js";

test("等级：按铁锭总数升级，给出离下一级还差多少", () => {
  assert.deepEqual(levelFor(0), { index: 0, name: "铜炉", next: { name: "铁炉", remaining: 10 }, progress: 0 });
  assert.equal(levelFor(9).index, 0);
  assert.equal(levelFor(10).name, "铁炉");
  assert.equal(levelFor(30).progress, 0.5, "铁炉 10 到钢炉 50，走了一半");
  const top = levelFor(5000);
  assert.equal(top.index, LEVELS.length - 1);
  assert.equal(top.next, null);
  assert.equal(top.progress, 1);
});

test("干完一件活：上次在干活、这次歇下", () => {
  const first = observe(new Map(), [
    { id: "a", status: "running" },
    { id: "b", status: "idle" },
  ]);
  assert.deepEqual(first.finished, [], "第一次看到的不算");

  const second = observe(first.seen, [
    { id: "a", status: "idle" },
    { id: "b", status: "running" },
    { id: "c", status: "idle" },
  ]);
  assert.deepEqual(second.finished, ["a"]);

  const third = observe(second.seen, [
    { id: "b", status: "needs_you" },
    { id: "c", status: "idle" },
  ]);
  assert.deepEqual(third.finished, [], "停下来等批准不算完");
  assert.equal(third.seen.has("a"), false, "关掉的会话不再记着");

  const fourth = observe(third.seen, [{ id: "b", status: "idle" }]);
  assert.deepEqual(fourth.finished, [], "从等你直接到歇着：多半是被取消了，不算");
});

test("排序：等你的最前，其次干活的，同档保持侧栏顺序", () => {
  const sessions = [
    { id: "1", status: "idle" },
    { id: "2", status: "running" },
    { id: "3", status: "needs_you" },
    { id: "4", status: "running" },
  ];
  assert.deepEqual(
    order(sessions).map((session) => session.id),
    ["3", "2", "4", "1"],
  );
});

test("日期按本地时间", () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59).getTime()), "2026-01-05");
});

test("智能体名字", () => {
  assert.equal(agentLabel("claude"), "Claude");
  assert.equal(agentLabel("aider"), "aider");
  assert.equal(agentLabel(null), "终端");
});

test("每一帧都是同样大小，用到的颜色都在调色板里", () => {
  for (const [status, frames] of Object.entries(FRAMES)) {
    for (const frame of frames) {
      assert.equal(frame.length, HEIGHT, status);
      for (const row of frame) {
        assert.equal(row.length, WIDTH, `${status}: ${row}`);
        for (const pixel of row) assert.ok(pixel === "." || pixel in PALETTE, `${status}: ${pixel}`);
      }
    }
  }
  assert.ok(INGOT.every((row) => row.length === INGOT[0].length));
});

test("一行像素并成色块", () => {
  assert.deepEqual(runs("..kk.s"), [
    { color: null, length: 2 },
    { color: PALETTE.k, length: 2 },
    { color: null, length: 1 },
    { color: PALETTE.s, length: 1 },
  ]);
});

test("记账：总数和当天都加，只留最近 60 天", () => {
  let ledger = credit(emptyLedger(), "2026-10-26", 2);
  ledger = credit(ledger, "2026-10-26", 1);
  assert.deepEqual(ledger, { total: 3, days: { "2026-10-26": 3 } });

  let long = emptyLedger();
  for (let day = 1; day <= 70; day++) long = credit(long, `2026-01-${String(day).padStart(3, "0")}`, 1);
  assert.equal(Object.keys(long.days).length, 60);
  assert.equal(long.total, 70);
  assert.ok(!("2026-01-001" in long.days), "最早的先丢");
});

test("账本存了能读回来；坏文件、不认识的版本从零开始", async (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "forge-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "deep", "ledger.json");

  const ledger = credit(emptyLedger(), "2026-10-26", 4);
  await saveLedger(path, ledger);
  assert.deepEqual(await loadLedger(path), ledger);

  fs.writeFileSync(path, "{");
  assert.deepEqual(await loadLedger(path), emptyLedger());
  fs.writeFileSync(path, JSON.stringify({ version: 2, total: 9, days: {} }));
  assert.deepEqual(await loadLedger(path), emptyLedger());
  assert.deepEqual(await loadLedger(join(dir, "missing.json")), emptyLedger());
});

test("账本放在插件自己的数据目录", () => {
  assert.equal(ledgerPath("/home/u"), "/home/u/.smelt/plugin-data/com.smelt.forge/ledger.json");
});
