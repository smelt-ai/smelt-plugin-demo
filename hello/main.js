// 最小的 smelt 插件：显示当前项目，点按钮计数。复制这个目录，开始写你自己的插件。
// 一步步的说明见仓库里的 docs/getting-started.zh-CN.md。

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Button } from "gpui-component";
import { context } from "smelt-workspace";

export default class Hello extends View {
  // 状态在 init 里赋值。写成类字段会在 init 之后被覆盖成 undefined。
  init(_props, _cx) {
    this.count = 0;
  }

  // render 只读内存，每次重画都会整段重跑。改了状态之后调 cx.notify() 才会重画。
  render(cx) {
    const colors = cx.theme().colors;
    const project = context().project_root ?? "没有打开项目";
    return v_flex()
      .size_full()
      .p(16)
      .gap(12)
      .text_color(colors.foreground)
      .child(div().text_sm().font_semibold().child("你好，smelt"))
      .child(div().text_xs().text_color(colors.muted_foreground).child(`当前项目：${project}`))
      .child(
        Button.new("count")
          .label(`点了 ${this.count} 次`)
          .on_click((_event, cx) => {
            this.count += 1;
            // 输出写在 ~/.smelt/app.log，带 [plugin] 标记。
            console.log(`[hello] 点了 ${this.count} 次`);
            cx.notify();
          }),
      );
  }
}
