[English](README.md) | [简体中文](README.zh-CN.md)

# smelt-plugin-demo

[smelt](https://github.com/smelt-ai/smelt) 的最小插件示例：**项目统计**统计当前项目里的文件，按扩展名列出文件数、行数和大小。

它是写给人读的。写自己的插件时可以直接复制一份改。

## 安装

需要 smelt 0.9.1 或更新版本。

```bash
git clone https://github.com/smelt-ai/smelt-plugin-demo ~/.smelt/plugins/project-stats
```

重启 smelt（或重开工作台窗口），右侧 Tool Panel（`Opt+Cmd+B`）会多出「项目统计」tab。

卸载就删掉这个目录。

## smelt 插件是什么

smelt 插件是一个 [gpui-shell](https://github.com/longbridge/gpui-kit/tree/main/crates/shell) 脚本应用。没有网页，也没有 Node.js：脚本描述界面，GPUI 原生绘制，主题和 smelt 主界面一致。

| 文件 | 作用 |
| --- | --- |
| `gpui-shell.json` | 清单：`id`（唯一）、`name`（tab 标题）、`version`、`entry` |
| `main.js` | 入口。默认导出一个 `View` 子类，smelt 把它挂成 Tool Panel 的一个 tab |
| `stats.js` | 扫描逻辑。基于 `fs/promises` 的普通异步函数，能在 Node 里测 |
| `tests/` | `node --test tests/` |

smelt 按这个顺序找插件，同一个 `id` 先找到的生效：

1. `~/.smelt/plugins/<目录>/`：你自己装的
2. App 自带的插件

### 插件能导入的模块

- `gpui-kit`、`gpui-base`：`View`、`div`、`v_flex`、`h_flex` 和样式方法
- `gpui-component`：带样式的控件（`Button`、`Input`、`Empty`、`ErrorAlert` 等）
- gpui-shell 标准运行时：`fs/promises`、`path`、`fetch` 等
- `smelt-workspace`（smelt 提供）：
  - `context()` → `{ home, project_root, generation }`。当前项目每变一次 `generation` 加一，用 `cx.timer.every` 轮询它
  - `pick_directory(prompt?)` → 系统的目录选择框
- `smelt-fs`（smelt 提供）：作用于软链本身的文件操作（`lstat`、`readlink`、`realpath`、`symlink`、`rename`、`unlink`、`exchange`、`copy`）

### 值得遵守的规矩

- **`render` 只读内存。** smelt 重画很频繁。读盘放在 `init`、定时器或事件回调的 `cx.spawn` 里，结果缓存在视图上，再 `cx.notify()`，`render` 只画缓存。
- **控件用 `gpui-component`**，颜色取 `cx.theme().colors`，不要画页面底色，底色由 smelt 铺。
- **插件都当可信代码**，共用同一份权限：文件访问限在用户主目录内。清单里的 `capabilities` 不生效。

## 目前的限制

- 插件只能在 Tool Panel 里占一个 tab，只能拿到当前项目路径。对话、智能体、事件总线还没有开放。
- 没有热重载。改完要重启 smelt 或重开工作台窗口。
- 主目录以外的项目读不了。

## 开发

```bash
node --test tests/
```

`stats.js` 只导入 `fs/promises` 和 `path`，Node 也有这两个模块，所以扫描逻辑可以原样在 Node 里跑。`main.js` 导入了 `smelt-workspace`，只能在 smelt 里运行。

## 许可

[Apache-2.0](LICENSE)
