[English](README.md) | [简体中文](README.zh-CN.md)

# smelt-plugin-demo

[smelt](https://github.com/smelt-ai/smelt) 的插件示例。每个子目录是一个插件，写自己的插件时可以直接复制一份改。

**第一次写插件，从 [写第一个 smelt 插件](docs/getting-started.zh-CN.md) 开始**：复制模板、装进 smelt、改代码、看日志，十分钟走一遍。

| 插件 | 适合 | 演示了什么 |
| --- | --- | --- |
| [`forge/`](forge) 熔炉 | 官方示例 | 你开着的每个智能体都是炉边的一个像素铁匠：干活时打铁，等你批准时摇铃，干完一件活打出一块铁锭，铁锭攒多了炉子升级。点铁匠跳到那个会话 |
| [`hello/`](hello) 你好 | 模板 | 最小的插件，三十几行：状态、界面、按钮、日志。复制它开始写 |
| [`project-stats/`](project-stats) 项目统计 | 入门 | 一个页面：读当前项目、后台读盘、用控件画界面 |
| [`code-quiz/`](code-quiz) 代码猜猜看 | 进阶 | 一个小游戏：从项目里抽真实代码，猜它在哪个文件、是谁写的、什么时候写的 |

「代码猜猜看」把真实插件常用的写法都用上了：

| 写法 | 在哪 |
| --- | --- |
| 运行命令（`process.run` 跑 git） | `git.js` |
| 网络（`fetch` 查 GitHub，在清单里声明主机） | `github.js`、`gpui-shell.json` |
| 读写文件（排行榜存在插件自己的数据目录） | `scores.js` |
| 异步与作废（后台预先出题，换项目就作废这一局） | `main.js` 的 `roundId` |
| 定时器（倒计时） | `main.js` 的 `show` / `tick` |
| 键盘（1–4 作答、空格下一题、Esc 退出） | `main.js` 的 `onKey` |
| 多个页面、确认弹窗、输入框筛选、剪贴板、打开链接 | `main.js` |
| 纯逻辑拆出来用 Node 测试 | `quiz.js`、`tests/` |

## 安装

需要带「面板插件」设置页的 smelt。

```bash
git clone https://github.com/smelt-ai/smelt-plugin-demo
```

打开 smelt 的 **设置 → 通用 → 面板插件**，点「导入插件目录」，选其中一个子目录。插件会出现在右侧 Tool Panel（`Opt+Cmd+B`）。

想边改边看，就别复制，建一条软链：

```bash
ln -s "$PWD/smelt-plugin-demo/forge" ~/.smelt/plugins/forge
```

改完脚本，在「面板插件」页点「重新加载」，不用重启。

## smelt 插件是什么

一个 [gpui-shell](https://github.com/longbridge/gpui-kit/tree/main/crates/shell) 脚本应用：`gpui-shell.json` 指向入口脚本，入口默认导出一个 `View` 子类，smelt 把它挂成 Tool Panel 的一个页签。没有网页，也没有 Node.js：脚本跑在 QuickJS 里，描述界面，GPUI 原生绘制，主题和 smelt 一致。

### 能用什么

插件按可信代码运行，和 smelt 本身一样不受限制：

- **文件**：任意路径，用 `fs/promises`。
- **命令**：任意命令，用 `process.run` / `process.spawn`。子进程的环境变量是空的，命令按 PATH 找。
- **环境变量**：`process.env` 里都有。
- **剪贴板**：`cx.read_from_clipboard()` / `cx.write_to_clipboard()`。
- **网络**：`fetch` / `WebSocket`，但要在清单里列出主机（gpui-shell 只认逐个列出的主机名，不支持通配）：

  ```json
  "capabilities": { "network": { "hosts": ["api.github.com"] } }
  ```

- **不提供** `localStorage`：所有插件共用一份权限，存储会互相覆盖。要存东西就自己写文件，比如 `~/.smelt/plugin-data/<插件 id>/`。

能导入的模块：

- `gpui-kit`、`gpui-base`：`View`、`div`、`v_flex`、`h_flex` 和样式方法。
- `gpui-component`：带样式的控件（`Button`、`Input`、`Tag`、`AlertDialog`、`Empty`……）。
- gpui-shell 标准运行时：`fs/promises`、`path`、`process`、`os`、`fetch`……
- `smelt-workspace`（smelt 提供）：
  - `context()` 返回 `{ home, project_root, generation }`，当前项目每换一次 `generation` 加一。
  - `sessions()` 返回侧栏里的全部智能体会话 `{ sessions, generation }`，每个会话有 `id`、`title`、`agent`（`claude`、`codex`……）、`status`（`running` / `needs_you` / `idle`）、`cwd`、`viewing`。只读内存，可以频繁轮询。
  - `open_session(id)` 跳到会话，并把主窗口提到前面。
  - `pick_directory(prompt?)` 弹系统的目录选择框。
- `smelt-fs`（smelt 提供）：作用于软链本身的文件操作（`lstat`、`readlink`、`realpath`、`symlink`、`rename`、`unlink`、`exchange`、`copy`）。

### 值得遵守的规矩

- **`render` 只读内存。** smelt 重画很频繁。读盘、跑命令、联网都放在 `init`、定时器或事件回调的 `cx.spawn` 里，结果存在视图上，再 `cx.notify()`。
- **异步结果回来要对号。** 用户随时会换项目、退出这一局，带一个递增的编号，对不上就丢掉（见 `code-quiz/main.js` 的 `roundId`）。
- **控件用 `gpui-component`**，颜色取 `cx.theme().colors`，不要画页面底色。
- **确认框用 `AlertDialog`。** gpui-shell 自己的 `window.open_dialog` 在 smelt 工作台里用不了。

## 开发

插件里 `console.log` 的输出和脚本错误写在 `~/.smelt/app.log`，带 `[plugin]` 标记，「面板插件」设置页有「打开日志」按钮：

```bash
tail -f ~/.smelt/app.log | grep '\[plugin\]'
```

用编辑器打开插件目录。smelt 每次加载插件都会在里面写出 `gpui-kit.d.ts` 和 `jsconfig.json`，编辑器据此补全和检查所有模块的用法。它们是生成文件，`.gitignore` 已经排除。

纯逻辑放在不依赖界面的模块里，用 Node 测：

```bash
cd forge && node --test tests/
cd code-quiz && node --test tests/
cd project-stats && node --test tests/
```

这些模块只导入 `fs/promises`、`path` 这类 Node 也有的模块，所以能原样在 Node 里跑。导入了 `gpui-kit`、`smelt-workspace` 的模块只能在 smelt 里运行。

## 许可

[Apache-2.0](LICENSE)
