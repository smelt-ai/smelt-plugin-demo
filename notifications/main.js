// 演示 smelt-plugin-api 的系统通知：只在点击事件里调用宿主。
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Button } from "gpui-component";
import { notify } from "smelt-plugin-api";

export default class NotificationsDemo extends View {
  render(cx) {
    const colors = cx.theme().colors;
    return v_flex()
      .size_full()
      .p(16)
      .gap(12)
      .text_color(colors.foreground)
      .child(div().text_sm().font_semibold().child("系统通知演示"))
      .child(
        div()
          .text_xs()
          .text_color(colors.muted_foreground)
          .child("点击按钮发送系统通知。通知能否显示取决于系统授权和设置。"),
      )
      .child(
        Button.new("notify-success")
          .label("发送成功通知")
          .on_click(() => {
            notify("完成", "这是一条来自 JS 插件的成功通知。");
          }),
      )
      .child(
        Button.new("notify-error")
          .label("发送错误通知")
          .on_click(() => {
            notify("错误", "这是一条来自 JS 插件的错误通知。");
          }),
      );
  }
}
