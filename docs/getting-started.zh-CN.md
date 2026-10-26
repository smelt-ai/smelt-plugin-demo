[English](getting-started.md) | [简体中文](getting-started.zh-CN.md)

# 写第一个 smelt 插件

从零写一个插件，装进 smelt，改代码、看效果、看日志。大约十分钟。

## 0. 插件是什么

smelt 插件是一个 [gpui-shell](https://github.com/longbridge/gpui-kit/tree/main/crates/shell) 脚本应用：一个目录，里面一个清单 `gpui-shell.json`，一个入口脚本。smelt 把它挂成右侧 Tool Panel 的一个页签。

**这不是网页，也不是 Node.js。** 没有 DOM，没有 HTML/CSS，没有 `require` 和 npm 包。脚本跑在 QuickJS 里，用链式调用描述界面，GPUI 原生绘制，样子和 smelt 一致。

## 1. 复制模板

```bash
git clone https://github.com/smelt-ai/smelt-plugin-demo
cp -R smelt-plugin-demo/hello ~/code/my-plugin
```

打开 `~/code/my-plugin/gpui-shell.json`，把 `id` 和 `name` 改成你自己的：

```json
{
  "id": "com.yourname.my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "entry": "main.js"
}
```

- `id`：插件的身份，只能用小写字母、数字和 `.-_`，首尾必须是字母或数字。建议用反向域名。之后不要再改。
- `name`：页签上显示的名字。
- `entry`：入口脚本。

## 2. 装进 smelt

开发时用软链，改了代码不用重新装：

```bash
ln -s ~/code/my-plugin ~/.smelt/plugins/my-plugin
```

然后打开 smelt 的 **设置 → 通用 → 面板插件**，点「重新加载」。Tool Panel（`Opt+Cmd+B`）里会多出「我的插件」页签。

不打算再改的插件，用同一页的「导入插件目录」装：它会复制一份进 `~/.smelt/plugins/`，和原目录无关。

## 3. 改代码，看效果

打开 `main.js`，把「你好，smelt」改成别的，保存，回到设置页点「重新加载」。不用重启 smelt。

插件加载失败时，页签里直接显示错误原因：清单写错、语法错误、import 了不存在的东西，都会在这里看到。

## 4. 看日志

插件里的 `console.log` / `console.warn` / `console.error`，以及脚本里没接住的异常、Promise 失败，都写在 `~/.smelt/app.log`，带 `[plugin]` 标记：

```bash
tail -f ~/.smelt/app.log | grep '\[plugin\]'
```

「面板插件」设置页也有「打开日志」按钮。所有插件的输出写在同一个文件里，建议在每条消息前加上插件名，比如 `console.log("[my-plugin] ...")`。

## 5. 一个插件怎么运作

```js
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Button } from "gpui-component";

export default class MyPlugin extends View {
  init(_props, cx) {
    this.count = 0; // 状态都在 init 里赋值
  }

  render(cx) {
    return v_flex()
      .p(16)
      .gap(8)
      .child(div().child(`点了 ${this.count} 次`))
      .child(
        Button.new("add")
          .label("加一")
          .on_click((_event, cx) => {
            this.count += 1;
            cx.notify(); // 状态变了，请求重画
          }),
      );
  }
}
```

- 入口默认导出一个 `View` 子类。`init` 只跑一次，`render` 在每次重画时整段重跑。
- 改了状态以后调 `cx.notify()`，界面才会重画。
- 界面是链式调用搭出来的：`v_flex()` 竖排、`h_flex()` 横排、`div()` 通用块。样式方法和 Rust 版 GPUI 同名，用下划线命名：`text_sm()`、`items_center()`、`gap(8)`、`p(16)`。数字是像素，字符串可以写 `"50%"`。
- 颜色从主题取：`cx.theme().colors.foreground`、`.muted_foreground`、`.border`、`.primary`、`.accent`、`.destructive`。不要写死 `#rrggbb`，深色模式下会不对。
- 控件用 `gpui-component` 里带样式的：`Button`、`Input`、`Tag`、`AlertDialog`、`Empty`……和 smelt 自己的界面是同一套。

## 6. 常见的事怎么做

**读写文件**（任意路径）：

```js
import * as fs from "fs/promises";
const text = await fs.readFile("/path/to/file", "utf8");
await fs.writeFile("/path/to/out.txt", text);
```

**运行命令**：

```js
import process from "process";
const { code, stdout, stderr } = await process.run("git", ["log", "-1", "--format=%s"], { cwd: root });
```

子进程的环境变量是空的，命令按 PATH 找。从访达启动的 smelt PATH 很短，用 Homebrew、mise、nvm 装的命令可能找不到，写绝对路径更稳。要持续读输出的命令用 `process.spawn`。

**联网**：先在清单里列出要访问的主机（只认完整主机名，不支持通配）：

```json
"capabilities": { "network": { "hosts": ["api.github.com"] } }
```

```js
const response = await fetch("https://api.github.com/repos/smelt-ai/smelt");
const repo = await response.json();
```

**异步**：读盘、跑命令、联网都放在 `cx.spawn` 里，做完存到视图上，再 `cx.notify()`：

```js
cx.spawn(async (cx) => {
  this.result = await loadSomething();
  cx.notify();
});
```

`cx.spawn` 的回调拿到的 `cx` 跨 `await` 也能用。`render` 和事件回调收到的 `cx` 只在那一次调用里有效，不能存起来。

**定时器**：

```js
this.timer = cx.timer.every(1000, (cx) => { /* 每秒一次 */ });
this.timer.cancel();
cx.timer.after(2000, (cx) => { /* 两秒后一次 */ });
```

**存数据**：smelt 不给插件 `localStorage`（所有插件共用一份权限，键会互相覆盖）。自己写文件，放在 `~/.smelt/plugin-data/<你的插件 id>/` 下面；主目录从 `smelt-workspace` 的 `context().home` 取。参考 `forge/store.js`。

**当前项目**：

```js
import { context } from "smelt-workspace";
const { home, project_root, generation } = context();
```

插件收不到宿主的通知，用定时器每秒看一次 `generation`，变了说明换了项目。`context()` 只读内存，轮询没有负担。

**智能体会话**：

```js
import { sessions, open_session } from "smelt-workspace";
const { sessions: list, generation } = sessions();
// list[i]：{ id, title, agent, status: "running" | "needs_you" | "idle", cwd, viewing }
open_session(list[0].id); // 跳到会话
```

参考 `forge/main.js`。

**剪贴板、打开链接**：

```js
cx.write_to_clipboard("文本");
cx.open_url("https://example.com");
```

**确认弹窗**：用 `gpui-component` 的 `AlertDialog`，它本身就是触发按钮：

```js
AlertDialog.new("clear", "清空", (error, cx) => console.error(error))
  .title("清空记录？")
  .description("不能恢复。")
  .show_cancel(true)
  .on_ok((cx) => this.clear(cx));
```

**键盘**：

```js
init(_props, cx) {
  this.focus = cx.focus_handle();
}
render(cx) {
  return v_flex()
    .track_focus(this.focus)
    .on_key_down((event, cx) => {
      if (event.key === "enter") this.start(cx);
    });
}
// 在某个点击里调 this.focus.focus()，把键盘焦点移到插件上。
```

## 7. 去哪查 API

- **`gpui-kit.d.ts`**：smelt 第一次加载你的插件后，会在插件目录里生成它和 `jsconfig.json`。用 VS Code 之类的编辑器打开插件目录，所有模块就有补全和类型检查。这是最准的 API 参考。不要提交这两个文件，模板仓库的 `.gitignore` 已经排除了。
- **gpui-shell 文档**：[README](https://github.com/longbridge/gpui-kit/tree/main/crates/shell)、[设计文档](https://github.com/longbridge/gpui-kit/blob/main/docs/gpui-shell.md)、[入门](https://gpui-kit.com/shell/getting-started)。
- **本仓库的示例**：`hello/` 最小，`project-stats/` 演示后台读盘，`code-quiz/` 演示命令、网络、键盘、多页面，`forge/` 演示会话接口和动画。

## 8. 容易踩的坑

- **状态写成类字段**：`count = 0;` 这种类字段会在 `init` 之后执行，把 `init` 里赋的值覆盖成 `undefined`。一律在 `init` 里赋值。
- **在 `render` 里做 IO**：smelt 重画很频繁，`render` 只能读内存。读盘、跑命令、联网放在 `cx.spawn` 里。
- **在 `render` 里调 `cx.notify()`**：会直接报错。
- **元素复用**：元素只能用一次，不要存到 `this` 上，也不要同一个放两处。每次 `render` 里重新建。
- **控件 id 不稳定**：可交互的控件要有稳定、同级唯一的 id，比如 ``Button.new(`delete-${item.id}`)``。
- **异步结果过时**：用户随时会换项目、退出页面。异步任务开始时记一个递增编号，回来时对不上就丢掉结果。参考 `code-quiz/main.js` 的 `roundId`。
- **用 `new` 构造**：一律用 `Type.new(...)`，比如 `Button.new("id")`，不要写 `new Button(...)`。
- **`window.open_dialog`**：gpui-shell 自己的弹窗在 smelt 工作台里用不了，用 `AlertDialog`。
- **页面底色**：不要给页面铺底色，smelt 会铺。

## 9. 测试

把不碰界面的逻辑拆成单独的模块，只导入 `fs/promises`、`path` 这类 Node 也有的模块，就能用 Node 测：

```bash
node --test tests/
```

导入了 `gpui-kit`、`smelt-workspace` 的模块只能在 smelt 里运行。参考 `code-quiz/tests/`。

## 10. 分享插件

把插件目录推到一个 git 仓库。别人 clone 下来，在 **设置 → 面板插件** 点「导入插件目录」选它就装好了。插件和 smelt 本身一样不受限制，能读写任意文件、运行任意命令，所以只装信任的人写的插件；你写的插件也请在 README 里说清它会做什么。
