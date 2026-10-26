[English](README.md) | [简体中文](README.zh-CN.md)

# smelt-plugin-demo

Example plugins for [smelt](https://github.com/smelt-ai/smelt). Each directory is one plugin; copy one as the starting point of your own.

| Plugin | Level | What it shows |
| --- | --- | --- |
| [`forge/`](forge) Forge | Official demo | Every agent you have open is a pixel smith at the forge: hammering while it works, ringing a bell when it needs your approval, and turning out an ingot each time it finishes a task. Ingots level up the forge. Click a smith to jump to its session |
| [`project-stats/`](project-stats) Project Stats | Beginner | One page: read the current project, scan files in the background, draw with styled controls |
| [`code-quiz/`](code-quiz) Code Quiz | Advanced | A small game: pull a real snippet from your project and guess which file it is in, who wrote it and when |

Code Quiz uses the patterns a real plugin needs:

| Pattern | Where |
| --- | --- |
| Running commands (`process.run` with git) | `git.js` |
| Network (`fetch` to GitHub, host declared in the manifest) | `github.js`, `gpui-shell.json` |
| Reading and writing files (a leaderboard in the plugin's own data directory) | `scores.js` |
| Async work and cancellation (next question prepared in the background; a project switch abandons the round) | `roundId` in `main.js` |
| Timers (the countdown) | `show` / `tick` in `main.js` |
| Keyboard (1–4 to answer, Space for next, Esc to quit) | `onKey` in `main.js` |
| Several pages, a confirmation dialog, a filter input, clipboard, opening links | `main.js` |
| Pure logic split out and tested under Node | `quiz.js`, `tests/` |

## Install

Requires a smelt build with the Panel Plugins settings page.

```bash
git clone https://github.com/smelt-ai/smelt-plugin-demo
```

In smelt, open **Settings → General → 面板插件 (Panel Plugins)**, click **导入插件目录 (Import plugin directory)** and pick one of the directories. The plugin appears as a tab in the right-hand Tool Panel (`Opt+Cmd+B`).

To edit and see changes, link it instead of copying:

```bash
ln -s "$PWD/smelt-plugin-demo/forge" ~/.smelt/plugins/forge
```

After editing, click **重新加载 (Reload)** on the Panel Plugins page. No restart needed.

## What a smelt plugin is

A [gpui-shell](https://github.com/longbridge/gpui-kit/tree/main/crates/shell) script application: `gpui-shell.json` names the entry script, which default-exports a `View` subclass, and smelt mounts it as a Tool Panel tab. There is no web page and no Node.js: the script runs on QuickJS and describes the interface, and GPUI draws it natively in smelt's theme.

### What a plugin can use

Plugins are trusted code and run without restrictions, like smelt itself:

- **Files**: any path, through `fs/promises`.
- **Commands**: any command, through `process.run` / `process.spawn`. Children start with an empty environment and are looked up on PATH.
- **Environment variables**: all of them, in `process.env`.
- **Clipboard**: `cx.read_from_clipboard()` / `cx.write_to_clipboard()`.
- **Network**: `fetch` / `WebSocket`, but list the hosts in the manifest (gpui-shell only accepts exact host names, no wildcards):

  ```json
  "capabilities": { "network": { "hosts": ["api.github.com"] } }
  ```

- **No** `localStorage`: every plugin shares one permission set, so storage would collide. Write your own files instead, e.g. under `~/.smelt/plugin-data/<plugin id>/`.

Modules a plugin can import:

- `gpui-kit`, `gpui-base`: `View`, `div`, `v_flex`, `h_flex` and the style methods.
- `gpui-component`: styled controls (`Button`, `Input`, `Tag`, `AlertDialog`, `Empty`, …).
- gpui-shell's standard runtime: `fs/promises`, `path`, `process`, `os`, `fetch`, …
- `smelt-workspace` (from smelt):
  - `context()` returns `{ home, project_root, generation }`; `generation` increases each time the current project changes.
  - `sessions()` returns every agent session in the sidebar as `{ sessions, generation }`. Each has `id`, `title`, `agent` (`claude`, `codex`, …), `status` (`running` / `needs_you` / `idle`), `cwd` and `viewing`. It reads memory only, so poll it as often as you like.
  - `open_session(id)` jumps to a session and brings the main window forward.
  - `pick_directory(prompt?)` shows the system folder picker.
- `smelt-fs` (from smelt): file operations on a symlink itself (`lstat`, `readlink`, `realpath`, `symlink`, `rename`, `unlink`, `exchange`, `copy`).

### Rules worth following

- **`render` only reads memory.** smelt redraws often. Read files, run commands and fetch inside `cx.spawn` from `init`, a timer or an event handler, keep the result on the view, then call `cx.notify()`.
- **Check that an async result is still wanted.** The user can switch projects or quit a round at any moment. Carry an increasing id and drop results that no longer match (see `roundId` in `code-quiz/main.js`).
- **Use `gpui-component` controls** and colors from `cx.theme().colors`, and don't paint a page background.
- **Confirm with `AlertDialog`.** gpui-shell's own `window.open_dialog` is not available inside the smelt workspace.

## Development

Open a plugin directory in your editor. Each time smelt loads the plugin it writes `gpui-kit.d.ts` and `jsconfig.json` there, so the editor can complete and check every module. They are generated, and `.gitignore` keeps them out of the repository.

Keep pure logic in modules that don't touch the interface, and test them with Node:

```bash
cd forge && node --test tests/
cd code-quiz && node --test tests/
cd project-stats && node --test tests/
```

Those modules import only `fs/promises`, `path` and the like, which Node also provides, so they run under Node unchanged. Modules that import `gpui-kit` or `smelt-workspace` only run inside smelt.

## License

[Apache-2.0](LICENSE)
