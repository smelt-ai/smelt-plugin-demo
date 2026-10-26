// 「熔炉」：smelt 的官方示例插件。你在 smelt 里开着的每个智能体会话，都是炉边的一个铁匠：
// 干活时抡锤打铁，等你批准或输入时摇铃，歇着时打盹。每干完一件活，打出一块铁锭；
// 铁锭攒多了，炉子升级。点一下铁匠，跳到那个会话。
//
// 用到的宿主能力：
// - `smelt-workspace.sessions()`：侧栏里全部会话和它们的状态。只读内存，可以频繁轮询，
//   `generation` 没变就说明什么都没变。
// - `smelt-workspace.open_session(id)`：跳到会话。
// - 文件：铁锭账本写在插件自己的数据目录里（store.js）。
//
// 规矩：render 只读内存。读会话在定时器里，写账本在任务里，做完 `cx.notify()`。

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Tag } from "gpui-component";
import { context, open_session, sessions } from "smelt-workspace";
import { basename } from "path";

import { FRAMES, INGOT, runs } from "./sprites.js";
import { STATUS_LABELS, agentLabel, dayKey, levelFor, observe, order } from "./forge.js";
import { credit, emptyLedger, ledgerPath, loadLedger, saveLedger } from "./store.js";

const SPACE = { xs: 4, sm: 8, md: 12, lg: 16 };
/** 一个像素画多大。 */
const PIXEL = 3;
/** 动画一拍。 */
const TICK_MS = 250;
/** 每种状态几拍换一帧：打铁快，摇铃中等，打盹慢。 */
const FRAME_TICKS = { running: 1, needs_you: 2, idle: 4 };
/** 铁锭堆最多画这么多块，再多写数字。 */
const PILE_MAX = 24;
/** 打出铁锭后过这么久再写账本，连着打出几块只写一次。 */
const SAVE_DELAY_MS = 2000;
const STATUS_TAGS = { running: "warning", needs_you: "danger", idle: "secondary" };

export default class Forge extends View {
  init(_props, cx) {
    this.home = context().home;
    this.sessions = [];
    this.generation = -1;
    /** 会话 id → 上次看到的状态，用来发现「干完一件活」。 */
    this.previous = new Map();
    this.today = dayKey(Date.now());
    /** 今天每个会话打出几块。只在内存里，重开 smelt 从零数。 */
    this.forged = new Map();
    this.ledger = emptyLedger();
    this.loaded = false;
    /** 账本还没读进来时就打出的铁锭，读进来后补记。 */
    this.pending = 0;
    this.tick = 0;
    this.saveTimer = null;

    this.poll(cx);
    cx.spawn(async (cx) => {
      const ledger = await loadLedger(ledgerPath(this.home));
      this.ledger = this.pending > 0 ? credit(ledger, this.today, this.pending) : ledger;
      if (this.pending > 0) this.scheduleSave(cx);
      this.pending = 0;
      this.loaded = true;
      cx.notify();
    });
    this.timer = cx.timer.every(TICK_MS, (cx) => {
      this.tick += 1;
      const changed = this.poll(cx);
      // 有人在打铁或摇铃就每拍重画；都歇着时一秒画一次，够 z 慢慢飘。
      const busy = this.sessions.some((session) => session.status !== "idle");
      if (changed || busy || this.tick % FRAME_TICKS.idle === 0) cx.notify();
    });
  }

  /// 读一次会话。有变化返回 true，顺便把干完活的记成铁锭。
  poll(cx) {
    const snapshot = sessions();
    if (snapshot.generation === this.generation) return false;
    this.generation = snapshot.generation;
    const { finished, seen } = observe(this.previous, snapshot.sessions);
    this.previous = seen;
    this.sessions = snapshot.sessions;
    if (finished.length > 0) this.forge(finished, cx);
    return true;
  }

  forge(finished, cx) {
    const day = dayKey(Date.now());
    if (day !== this.today) {
      this.today = day;
      this.forged = new Map();
    }
    for (const id of finished) this.forged.set(id, (this.forged.get(id) ?? 0) + 1);
    if (!this.loaded) {
      this.pending += finished.length;
      return;
    }
    this.ledger = credit(this.ledger, day, finished.length);
    this.scheduleSave(cx);
  }

  scheduleSave(cx) {
    if (this.saveTimer !== null) return;
    this.saveTimer = cx.timer.after(SAVE_DELAY_MS, (cx) => {
      this.saveTimer = null;
      const ledger = this.ledger;
      cx.spawn(async () => {
        try {
          await saveLedger(ledgerPath(this.home), ledger);
        } catch (error) {
          console.error(`[forge] 账本没存上：${error}`);
        }
      });
    });
  }

  // ---------------------------------------------------------------- 界面

  render(cx) {
    const colors = cx.theme().colors;
    const shown = order(this.sessions);
    return v_flex()
      .size_full()
      .text_color(colors.foreground)
      .child(this.header(cx))
      .child(
        v_flex()
          .flex_1()
          .min_h_0()
          .overflow_y_scrollbar()
          .p(SPACE.lg)
          .gap(SPACE.lg)
          .child(this.pile(cx))
          .child(
            shown.length === 0
              ? empty("炉子还冷着", "在 smelt 里开一个智能体会话，铁匠就来了。")
              : h_flex()
                  .flex_wrap()
                  .gap(SPACE.md)
                  .children(shown.map((session, index) => this.smith(session, index, cx))),
          ),
      );
  }

  header(cx) {
    const colors = cx.theme().colors;
    const level = levelFor(this.ledger.total + this.pending);
    const working = this.sessions.filter((session) => session.status === "running").length;
    const waiting = this.sessions.filter((session) => session.status === "needs_you").length;
    const parts = [];
    if (working > 0) parts.push(`${working} 位在打铁`);
    if (waiting > 0) parts.push(`${waiting} 位在等你`);
    return v_flex()
      .gap(SPACE.xs)
      .px(SPACE.lg)
      .py(SPACE.sm)
      .border_b(1)
      .border_color(colors.border)
      .child(
        h_flex()
          .items_center()
          .gap(SPACE.sm)
          .child(div().text_sm().font_semibold().child("熔炉"))
          .child(tag(`Lv.${level.index + 1} ${level.name}`, "warning"))
          .child(div().flex_1())
          .child(hint(parts.length > 0 ? parts.join(" · ") : "都歇着", cx)),
      )
      .child(
        h_flex()
          .items_center()
          .gap(SPACE.sm)
          .child(
            div()
              .flex_1()
              .h(4)
              .rounded(2)
              .bg(colors.muted)
              .child(div().h_full().rounded(2).bg(colors.primary).w(`${Math.round(level.progress * 100)}%`)),
          )
          .child(
            hint(level.next === null ? "满级了" : `离${level.next.name}还差 ${level.next.remaining} 块`, cx),
          ),
      );
  }

  /// 今天打出的铁锭堆。
  pile(cx) {
    const count = (this.ledger.days[this.today] ?? 0) + this.pending;
    if (count === 0) {
      return hint("今天还没打出铁锭。智能体每干完一件活，这里就多一块。", cx);
    }
    const ingots = Array.from({ length: Math.min(count, PILE_MAX) }, () => sprite(INGOT, PIXEL));
    return v_flex()
      .gap(SPACE.xs)
      .child(hint(`今天打出 ${count} 块铁锭，一共 ${this.ledger.total + this.pending} 块`, cx))
      .child(
        h_flex()
          .flex_wrap()
          .items_end()
          .gap(2)
          .children(ingots)
          .when(count > PILE_MAX, (el) => el.child(hint(`+${count - PILE_MAX}`, cx))),
      );
  }

  /// 一个铁匠：像素小人、会话标题、智能体、状态。点一下跳到那个会话。
  smith(session, index, cx) {
    const colors = cx.theme().colors;
    const frames = FRAMES[session.status] ?? FRAMES.idle;
    // 错开相位，几个铁匠不会整齐划一地抡锤。
    const step = Math.floor(this.tick / (FRAME_TICKS[session.status] ?? 4)) + index;
    const forged = this.forged.get(session.id) ?? 0;
    const waiting = session.status === "needs_you";
    return Button.new(`smith-${session.id}`)
      .ghost()
      .w(156)
      .h("auto")
      .p(SPACE.sm)
      .rounded(8)
      .border(waiting ? 2 : 1)
      .border_color(waiting ? colors.destructive : colors.border)
      .when(session.viewing, (el) => el.bg(colors.accent))
      .on_click(() => open_session(session.id))
      .child(
        v_flex()
          .w_full()
          .gap(SPACE.xs)
          .items_center()
          .child(sprite(frames[step % frames.length], PIXEL))
          .child(div().w_full().text_sm().font_semibold().truncate().child(session.title))
          .child(
            h_flex()
              .gap(SPACE.xs)
              .child(tag(agentLabel(session.agent), "secondary"))
              .child(tag(STATUS_LABELS[session.status] ?? session.status, STATUS_TAGS[session.status] ?? "secondary")),
          )
          .child(
            hint(
              [session.cwd ? basename(session.cwd) : null, forged > 0 ? `今天 ${forged} 块` : null]
                .filter((part) => part !== null)
                .join(" · ") || " ",
              cx,
            ),
          ),
      );
  }
}

/// 画一帧像素画：每行同色的连续像素并成一个色块。
function sprite(frame, pixel) {
  return v_flex()
    .flex_none()
    .children(
      frame.map((row) =>
        h_flex()
          .h(pixel)
          .children(
            runs(row).map((block) => {
              const cell = div().h(pixel).w(block.length * pixel);
              return block.color === null ? cell : cell.bg(block.color);
            }),
          ),
      ),
    );
}

function tag(text, variant) {
  return Tag.new().variant(variant).outline().size("xsmall").flex_none().child(text);
}

function hint(text, cx) {
  return div().text_xs().whitespace_normal().text_color(cx.theme().colors.muted_foreground).child(text);
}

function empty(title, description) {
  return Empty.new().header(
    EmptyHeader.new().title(EmptyTitle.new().child(title)).description(EmptyDescription.new().child(description)),
  );
}
