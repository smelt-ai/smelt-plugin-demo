// 熔炉的规则：什么算打出一块铁锭、炉子怎么升级、铁匠怎么排。都是纯函数，不碰宿主，
// 在 Node 里直接测（见 tests/forge.test.mjs）。

/** 炉子的等级，按攒下的铁锭总数。 */
export const LEVELS = [
  { min: 0, name: "铜炉" },
  { min: 10, name: "铁炉" },
  { min: 50, name: "钢炉" },
  { min: 200, name: "金炉" },
  { min: 1000, name: "秘银炉" },
];

export const STATUS_LABELS = {
  running: "打铁中",
  needs_you: "摇铃等你",
  idle: "歇着",
};

/**
 * 当前等级，以及离下一级还差多少。`progress` 是这一级里走了多少，0 到 1；满级时为 1。
 */
export function levelFor(total) {
  let index = 0;
  while (index + 1 < LEVELS.length && total >= LEVELS[index + 1].min) index += 1;
  const level = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  return {
    index,
    name: level.name,
    next: next === null ? null : { name: next.name, remaining: next.min - total },
    progress: next === null ? 1 : (total - level.min) / (next.min - level.min),
  };
}

/** 本地日期，`2026-10-26`。铁锭按天记。 */
export function dayKey(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 对比两次看到的会话状态，找出打完一件活的：上次在干活，这次歇下了。
 * 中途停下来等你批准不算完；第一次看到的会话没有「上次」，也不算。
 * @param {Map<string, string>} previous 会话 id → 上次的状态
 * @param {{ id: string, status: string }[]} sessions
 * @returns {{ finished: string[], seen: Map<string, string> }}
 */
export function observe(previous, sessions) {
  const finished = [];
  const seen = new Map();
  for (const session of sessions) {
    if (previous.get(session.id) === "running" && session.status === "idle") finished.push(session.id);
    seen.set(session.id, session.status);
  }
  return { finished, seen };
}

const RANK = { needs_you: 0, running: 1, idle: 2 };

/// 等你的排最前，其次在干活的，歇着的最后；同一档里保持侧栏顺序。
export function order(sessions) {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((a, b) => (RANK[a.session.status] ?? 3) - (RANK[b.session.status] ?? 3) || a.index - b.index)
    .map(({ session }) => session);
}

/// 智能体 id 给人看的名字。认不出来的原样给出。
export function agentLabel(agent) {
  const names = { claude: "Claude", codex: "Codex", pi: "Pi", gemini: "Gemini", cursor: "Cursor" };
  if (agent === null || agent === undefined) return "终端";
  return names[agent] ?? agent;
}
