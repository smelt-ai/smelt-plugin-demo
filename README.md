[English](README.md) | [简体中文](README.zh-CN.md)

# smelt-plugin-demo

A minimal example plugin for [smelt](https://github.com/smelt-ai/smelt): **Project Stats** counts the files in the current project and breaks them down by extension — file count, line count and size.

It is meant to be read. Copy it as the starting point of your own plugin.

## Install

Requires smelt 0.9.1 or later.

```bash
git clone https://github.com/smelt-ai/smelt-plugin-demo ~/.smelt/plugins/project-stats
```

Restart smelt (or reopen the workspace window). A **项目统计** tab appears in the right-hand Tool Panel (`Opt+Cmd+B`).

To uninstall, delete the directory.

## How a smelt plugin works

A smelt plugin is a [gpui-shell](https://github.com/longbridge/gpui-kit/tree/main/crates/shell) script application. There is no web page and no Node.js: the script describes the interface, and GPUI draws it natively with the same theme as the rest of smelt.

| File | Purpose |
| --- | --- |
| `gpui-shell.json` | Manifest: `id` (unique), `name` (tab title), `version`, `entry` |
| `main.js` | Entry. Default-exports a `View` subclass; smelt mounts one instance as a Tool Panel tab |
| `stats.js` | The scanning logic. Plain async functions over `fs/promises`, testable in Node |
| `tests/` | `node --test tests/` |

smelt loads plugins from, in order (the first one wins for a given `id`):

1. `~/.smelt/plugins/<dir>/` — installed by you
2. plugins bundled with the app

### Modules a plugin can import

- `gpui-kit`, `gpui-base` — `View`, `div`, `v_flex`, `h_flex` and the style methods
- `gpui-component` — styled controls (`Button`, `Input`, `Empty`, `ErrorAlert`, …)
- gpui-shell's standard runtime — `fs/promises`, `path`, `fetch`, …
- `smelt-workspace` — provided by smelt:
  - `context()` → `{ home, project_root, generation }`. `generation` increases each time the current project changes; poll it with `cx.timer.every`
  - `pick_directory(prompt?)` → a system folder picker
- `smelt-fs` — provided by smelt: symlink-aware file operations (`lstat`, `readlink`, `realpath`, `symlink`, `rename`, `unlink`, `exchange`, `copy`)

### Rules worth following

- **`render` only reads memory.** smelt redraws often. Do disk work in `init`, timers or event handlers inside `cx.spawn`, cache the result on the view, call `cx.notify()`, and let `render` draw the cache.
- **Use `gpui-component` controls** and theme colors from `cx.theme().colors`, and don't paint a page background. smelt paints the panel.
- **Every plugin is trusted code** and shares one permission set: file access is limited to your home directory. `capabilities` in the manifest are ignored.

## Limitations today

- A plugin can only contribute one Tool Panel tab, and it can only see the current project path. Conversations, agents and the event bus are not exposed yet.
- There is no hot reload. Restart smelt or reopen the workspace window after editing.
- Projects outside your home directory cannot be read.

## Development

```bash
node --test tests/
```

`stats.js` only imports `fs/promises` and `path`, which Node also provides, so the scanning logic runs under Node unchanged. `main.js` imports `smelt-workspace` and only runs inside smelt.

## License

[Apache-2.0](LICENSE)
