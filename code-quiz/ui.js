// 各页面共用的小部件。控件用 `"gpui-component"` 里带样式的组件，和 smelt 主界面同一套
// 主题；颜色一律取 `cx.theme().colors`，不写死，深浅色都对。

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { Button, Tag } from "gpui-component";

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const MONO = "SF Mono, Menlo, monospace";

/// 紧凑按钮。回调用它自己收到的 cx：render 的 cx 只在那一次 render 里有效。
/**
 * @param {"ghost" | "outline" | "primary"} [variant]
 */
export function button(id, label, onClick, variant = "ghost") {
  return Button.new(id)
    .label(label)
    .size("small")
    [variant]()
    .on_click((_event, cx) => onClick(cx));
}

/// 键帽：提示这个操作有快捷键。
export function keycap(text, cx) {
  const colors = cx.theme().colors;
  return div()
    .px(5)
    .min_w(18)
    .flex()
    .justify_center()
    .text_xs()
    .font_family(MONO)
    .text_color(colors.muted_foreground)
    .border(1)
    .border_color(colors.border)
    .rounded(4)
    .child(text);
}

export function hint(text, cx) {
  return div().text_xs().whitespace_normal().text_color(cx.theme().colors.muted_foreground).child(text);
}

/// @param {"secondary" | "danger" | "info" | "warning" | "success"} variant
export function tag(text, variant) {
  return Tag.new().variant(variant).outline().size("small").flex_none().child(text);
}

/// 有边框的一块。
export function card(children, cx) {
  const colors = cx.theme().colors;
  return v_flex()
    .gap(SPACE.sm)
    .p(SPACE.md)
    .border(1)
    .border_color(colors.border)
    .rounded(8)
    .children(children);
}

/// 一个数字指标：小标题在上，数字在下。
export function stat(label, value, cx) {
  return v_flex()
    .flex_1()
    .min_w_0()
    .gap(2)
    .child(hint(label, cx))
    .child(div().text_lg().font_semibold().truncate().child(String(value)));
}

/// 带行号的代码块。`focusLine` 那一行垫底色。
export function codeBlock(snippet, focusLine, cx) {
  const colors = cx.theme().colors;
  return v_flex()
    .py(SPACE.sm)
    .border(1)
    .border_color(colors.border)
    .rounded(8)
    .bg(colors.muted)
    .children(
      snippet.lines.map((line, index) => {
        const number = snippet.start + index;
        return h_flex()
          .px(SPACE.sm)
          .gap(SPACE.md)
          .text_xs()
          .font_family(MONO)
          .when(number === focusLine, (el) => el.bg(colors.accent).text_color(colors.accent_foreground))
          .child(div().w(32).flex_none().text_right().text_color(colors.muted_foreground).child(String(number)))
          .child(div().flex_1().min_w_0().truncate().child(line === "" ? " " : line));
      }),
    );
}

/// 倒计时条。剩得越少越短，最后五秒变成警示色。
export function timerBar(msLeft, totalMs, cx) {
  const colors = cx.theme().colors;
  const ratio = Math.max(0, Math.min(1, msLeft / totalMs));
  return div()
    .h(4)
    .w_full()
    .rounded(2)
    .bg(colors.muted)
    .child(
      div()
        .h_full()
        .rounded(2)
        .bg(msLeft <= 5000 ? colors.destructive : colors.primary)
        .w(`${(ratio * 100).toFixed(1)}%`),
    );
}

export function formatDate(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function message(error) {
  return error && error.message ? error.message : String(error);
}
