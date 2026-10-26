// 「项目统计」：smelt 插件示例。统计当前项目里各类文件的数量、行数和大小。
//
// 一个 smelt 插件就是一个 gpui-shell 脚本应用：`gpui-shell.json` 指向入口脚本，
// 入口默认导出一个 `View` 子类，smelt 把它挂成右侧 Tool Panel 的一个 tab。
// 界面由 GPUI 原生绘制，脚本只描述长什么样。
//
// 这个示例演示插件最常用的几件事：
// - 从 smelt 宿主模块 `smelt-workspace` 读当前项目；
// - 用标准模块 `fs/promises` 异步读盘（统计逻辑在 stats.js）；
// - 磁盘操作放在 `cx.spawn` 里，结果缓存在视图上，`render` 只读缓存；
// - 用 `"gpui-component"` 的控件，外观跟 smelt 主界面同一套主题。

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, ErrorAlert } from "gpui-component";
import { context } from "smelt-workspace";
import { scan, formatBytes, formatCount, message, NO_EXTENSION, MAX_FILES, SKIPPED_DIRS } from "./stats.js";

const SPACE = { xs: 4, sm: 8, md: 12, lg: 16 };
const MONO = "SF Mono, Menlo, monospace";
/** 列表最多显示这么多种扩展名，其余合成一行。 */
const TOP = 12;

export default class ProjectStats extends View {
  init(_props, cx) {
    this.home = "";
    this.projectRoot = null;
    /** 上次扫描的结果；没扫过或没有项目时是 null。 */
    this.result = null;
    this.error = null;
    /** 正在扫描时是已数过的文件数，没在扫描时是 null。 */
    this.progress = null;
    /** 每次扫描递增。项目切换后，旧扫描的结果对不上号就丢掉。 */
    this.scanId = 0;
    /** 宿主每次切换项目都会递增它；-1 保证第一次一定会扫。 */
    this.generation = -1;

    // 第一次画之前就开始扫；init 之后自然会 render，这里不用 notify。
    this.sync(cx);
    // 插件收不到宿主的通知，只能轮询。`context()` 读的是内存，不碰磁盘，每秒一次没有负担。
    this.watch = cx.timer.every(1000, (cx) => {
      if (this.sync(cx)) cx.notify();
    });
  }

  /// 当前项目变了就重扫。返回是否变了。
  sync(cx) {
    const ctx = context();
    if (ctx.generation === this.generation) return false;
    this.generation = ctx.generation;
    this.home = ctx.home;
    this.projectRoot = ctx.project_root;
    this.startScan(cx);
    return true;
  }

  /// 「重新统计」按钮。
  rescan(cx) {
    this.startScan(cx);
    cx.notify();
  }

  /// 清掉旧结果，在后台扫当前项目。扫完自己 notify；调用方负责这一刻的重画。
  startScan(cx) {
    const id = ++this.scanId;
    const root = this.projectRoot;
    this.result = null;
    this.error = null;
    this.progress = root === null ? null : 0;
    if (root === null) return;

    cx.spawn(async (cx) => {
      const current = () => id === this.scanId;
      try {
        const result = await scan(root, {
          onProgress: (files) => {
            if (!current()) return;
            this.progress = files;
            cx.notify();
          },
        });
        if (current()) this.result = result;
      } catch (error) {
        if (current()) this.error = `读取失败：${message(error)}`;
      }
      if (current()) this.progress = null;
      cx.notify();
    });
  }

  render(cx) {
    const colors = cx.theme().colors;
    return v_flex()
      .size_full()
      .text_color(colors.foreground)
      .child(this.header(cx))
      .child(v_flex().flex_1().min_h_0().overflow_y_scrollbar().p(SPACE.lg).gap(SPACE.lg).children(this.body(cx)));
  }

  header(cx) {
    const colors = cx.theme().colors;
    return h_flex()
      .items_center()
      .gap(SPACE.sm)
      .px(SPACE.lg)
      .py(SPACE.sm)
      .border_b(1)
      .border_color(colors.border)
      .child(div().text_sm().font_semibold().child("项目统计"))
      .child(div().flex_1().min_w_0().text_xs().text_color(colors.muted_foreground).truncate().child(this.prettyRoot()))
      .child(
        Button.new("rescan")
          .label(this.progress === null ? "重新统计" : "统计中…")
          .size("xsmall")
          .ghost()
          .disabled(this.projectRoot === null || this.progress !== null)
          .on_click((_event, cx) => this.rescan(cx)),
      );
  }

  body(cx) {
    if (this.projectRoot === null) {
      return [empty("没有打开项目", "在 smelt 里打开一个项目，这里会统计它的文件。")];
    }
    if (this.error !== null) {
      return [
        ErrorAlert.new("error", this.error).size("small"),
        hint("插件只能读用户主目录里的文件。项目不在主目录下时会读取失败。", cx),
      ];
    }
    if (this.result === null) {
      return [hint(`正在统计… 已数过 ${formatCount(this.progress ?? 0)} 个文件`, cx)];
    }
    return [this.summary(cx), this.table(cx), this.footnote(cx)];
  }

  summary(cx) {
    const { total } = this.result;
    return h_flex()
      .gap(SPACE.sm)
      .child(card("文件", formatCount(total.files), cx))
      .child(card("行数", formatCount(total.lines), cx))
      .child(card("大小", formatBytes(total.bytes), cx));
  }

  table(cx) {
    const colors = cx.theme().colors;
    const groups = this.result.byExtension;
    const top = groups.slice(0, TOP);
    const rest = groups.slice(TOP);
    if (rest.length > 0) {
      top.push({
        ext: `其余 ${rest.length} 种`,
        files: sum(rest, "files"),
        lines: sum(rest, "lines"),
        bytes: sum(rest, "bytes"),
        other: true,
      });
    }
    const most = Math.max(1, ...top.map((group) => group.lines));
    return v_flex()
      .gap(SPACE.xs)
      .child(
        row(
          div().child("类型"),
          div().child("文件"),
          div().child("行数"),
          div().child("大小"),
        )
          .text_xs()
          .text_color(colors.muted_foreground)
          .pb(SPACE.xs)
          .border_b(1)
          .border_color(colors.border),
      )
      .children(
        top.map((group) =>
          v_flex()
            .gap(2)
            .child(
              row(
                div().font_family(MONO).truncate().child(label(group)),
                div().child(formatCount(group.files)),
                div().child(formatCount(group.lines)),
                div().child(formatBytes(group.bytes)),
              ).text_xs(),
            )
            // 条长按行数占比画：一眼看出项目主要是什么语言。
            .child(
              div()
                .h(3)
                .rounded(2)
                .bg(colors.primary)
                .opacity(group.other ? 0.4 : 0.8)
                .w(`${Math.round((group.lines / most) * 100)}%`),
            ),
        ),
      );
  }

  footnote(cx) {
    const { total, truncated } = this.result;
    const notes = [`没有统计 ${[...SKIPPED_DIRS].join("、")} 目录和软链。`];
    if (total.binary > 0) notes.push(`${formatCount(total.binary)} 个二进制文件只计大小。`);
    if (truncated) notes.push(`文件超过 ${formatCount(MAX_FILES)} 个，后面的没有统计。`);
    return hint(notes.join(" "), cx);
  }

  prettyRoot() {
    const root = this.projectRoot;
    if (root === null) return "";
    // Windows 上分隔符是 `\`。
    const rest = root.slice(this.home.length);
    return this.home && root.startsWith(this.home) && /^[\\/]/.test(rest) ? `~${rest}` : root;
  }
}

function label(group) {
  if (group.other) return group.ext;
  return group.ext === NO_EXTENSION ? "（无扩展名）" : group.ext;
}

function sum(groups, key) {
  return groups.reduce((total, group) => total + group[key], 0);
}

/// 表格的一行：第一列占满剩余宽度，数字列定宽右对齐。
function row(name, files, lines, bytes) {
  return h_flex()
    .items_center()
    .gap(SPACE.sm)
    .child(name.flex_1().min_w_0())
    .child(files.w(56).flex_none().text_right())
    .child(lines.w(72).flex_none().text_right())
    .child(bytes.w(72).flex_none().text_right());
}

function card(title, value, cx) {
  const colors = cx.theme().colors;
  return v_flex()
    .flex_1()
    .min_w_0()
    .gap(2)
    .p(SPACE.md)
    .border(1)
    .border_color(colors.border)
    .rounded(8)
    .child(div().text_xs().text_color(colors.muted_foreground).child(title))
    .child(div().text_sm().font_semibold().truncate().child(value));
}

function hint(text, cx) {
  const colors = cx.theme().colors;
  return div().text_xs().whitespace_normal().text_color(colors.muted_foreground).child(text);
}

function empty(title, description) {
  return Empty.new().header(
    EmptyHeader.new().title(EmptyTitle.new().child(title)).description(EmptyDescription.new().child(description)),
  );
}
