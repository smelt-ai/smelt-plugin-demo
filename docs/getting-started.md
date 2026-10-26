[English](getting-started.md) | [简体中文](getting-started.zh-CN.md)

# Writing your first smelt plugin

Write a plugin from scratch, install it in smelt, then edit it, see the result and read its logs. About ten minutes.

## 0. What a plugin is

A smelt plugin is a [gpui-shell](https://github.com/longbridge/gpui-kit/tree/main/crates/shell) script application: a directory with a manifest, `gpui-shell.json`, and an entry script. smelt mounts it as a tab in the right-hand Tool Panel.

**It is not a web page and not Node.js.** There is no DOM, no HTML or CSS, no `require` and no npm packages. The script runs on QuickJS, describes the interface with builder calls, and GPUI draws it natively in smelt's look.

## 1. Copy the template

```bash
git clone https://github.com/smelt-ai/smelt-plugin-demo
cp -R smelt-plugin-demo/hello ~/code/my-plugin
```

Open `~/code/my-plugin/gpui-shell.json` and make `id` and `name` your own:

```json
{
  "id": "com.yourname.my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "entry": "main.js"
}
```

- `id`: the plugin's identity. Lowercase letters, digits and `.-_` only, starting and ending with a letter or digit. Reverse-DNS is a good habit. Don't change it later.
- `name`: the tab title.
- `entry`: the entry script.

## 2. Install it

While developing, link it so edits need no reinstall:

```bash
ln -s ~/code/my-plugin ~/.smelt/plugins/my-plugin
```

Then open **Settings → General → 面板插件 (Panel Plugins)** in smelt and click **重新加载 (Reload)**. A "My Plugin" tab appears in the Tool Panel (`Opt+Cmd+B`).

For a plugin you won't edit any more, use **导入插件目录 (Import plugin directory)** on the same page. It copies the directory into `~/.smelt/plugins/`, independent of the original.

## 3. Edit and see the result

Open `main.js`, change "你好，smelt" to something else, save, and click Reload on the settings page. No restart needed.

When a plugin fails to load, its tab shows why: a bad manifest, a syntax error, an import that doesn't exist.

## 4. Read the logs

`console.log` / `console.warn` / `console.error` in a plugin, and exceptions or promise rejections the script didn't catch, go to `~/.smelt/app.log`, marked `[plugin]`:

```bash
tail -f ~/.smelt/app.log | grep '\[plugin\]'
```

The Panel Plugins page also has an **打开日志 (Open log)** button. Every plugin writes to the same file, so prefix your messages with the plugin's name, e.g. `console.log("[my-plugin] ...")`.

## 5. How a plugin works

```js
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Button } from "gpui-component";

export default class MyPlugin extends View {
  init(_props, cx) {
    this.count = 0; // assign all state in init
  }

  render(cx) {
    return v_flex()
      .p(16)
      .gap(8)
      .child(div().child(`Clicked ${this.count} times`))
      .child(
        Button.new("add")
          .label("Add one")
          .on_click((_event, cx) => {
            this.count += 1;
            cx.notify(); // state changed: ask for a redraw
          }),
      );
  }
}
```

- The entry default-exports a `View` subclass. `init` runs once; `render` runs in full on every redraw.
- Call `cx.notify()` after changing state, or nothing redraws.
- The interface is built with builder calls: `v_flex()` stacks vertically, `h_flex()` horizontally, `div()` is a general box. Style methods keep GPUI's Rust names in snake_case: `text_sm()`, `items_center()`, `gap(8)`, `p(16)`. Numbers are pixels; a string can be `"50%"`.
- Take colors from the theme: `cx.theme().colors.foreground`, `.muted_foreground`, `.border`, `.primary`, `.accent`, `.destructive`. Hard-coded `#rrggbb` breaks dark mode.
- Use the styled controls from `gpui-component`: `Button`, `Input`, `Tag`, `AlertDialog`, `Empty`, … the same ones smelt's own interface uses.

## 6. Doing common things

**Files** (any path):

```js
import * as fs from "fs/promises";
const text = await fs.readFile("/path/to/file", "utf8");
await fs.writeFile("/path/to/out.txt", text);
```

**Commands**:

```js
import process from "process";
const { code, stdout, stderr } = await process.run("git", ["log", "-1", "--format=%s"], { cwd: root });
```

Children start with an empty environment and are found on PATH. A smelt started from Finder has a short PATH, so commands installed with Homebrew, mise or nvm may not be found; an absolute path is safer. Use `process.spawn` for a command whose output you read as it runs.

**Network**: list the hosts in the manifest first (exact host names only, no wildcards):

```json
"capabilities": { "network": { "hosts": ["api.github.com"] } }
```

```js
const response = await fetch("https://api.github.com/repos/smelt-ai/smelt");
const repo = await response.json();
```

**Async work**: read files, run commands and fetch inside `cx.spawn`, keep the result on the view, then call `cx.notify()`:

```js
cx.spawn(async (cx) => {
  this.result = await loadSomething();
  cx.notify();
});
```

The `cx` a `cx.spawn` callback receives stays usable across `await`. The `cx` given to `render` and to event handlers is valid for that one call only; don't keep it.

**Timers**:

```js
this.timer = cx.timer.every(1000, (cx) => { /* every second */ });
this.timer.cancel();
cx.timer.after(2000, (cx) => { /* once, two seconds from now */ });
```

**Saving data**: smelt gives plugins no `localStorage` (every plugin shares one permission set, so keys would collide). Write your own files under `~/.smelt/plugin-data/<your plugin id>/`; get the home directory from `context().home` in `smelt-workspace`. See `forge/store.js`.

**The current project**:

```js
import { context } from "smelt-workspace";
const { home, project_root, generation } = context();
```

Plugins aren't notified by the host. Check `generation` once a second with a timer; a change means the project changed. `context()` only reads memory, so polling costs nothing.

**Agent sessions**:

```js
import { sessions, open_session } from "smelt-workspace";
const { sessions: list, generation } = sessions();
// list[i]: { id, title, agent, status: "running" | "needs_you" | "idle", cwd, viewing }
open_session(list[0].id); // jump to the session
```

See `forge/main.js`.

**Clipboard and links**:

```js
cx.write_to_clipboard("text");
cx.open_url("https://example.com");
```

**Confirmation**: use `AlertDialog` from `gpui-component`; it is its own trigger button:

```js
AlertDialog.new("clear", "Clear", (error, cx) => console.error(error))
  .title("Clear the history?")
  .description("This can't be undone.")
  .show_cancel(true)
  .on_ok((cx) => this.clear(cx));
```

**Keyboard**:

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
// Call this.focus.focus() from a click to move the keyboard to the plugin.
```

## 7. Where to look things up

- **`gpui-kit.d.ts`**: the first time smelt loads your plugin, it writes this file and `jsconfig.json` into the plugin directory. Open the directory in an editor such as VS Code and every module gets completion and type checking. It is the most accurate API reference. Don't commit the two files; the template's `.gitignore` already excludes them.
- **gpui-shell docs**: the [README](https://github.com/longbridge/gpui-kit/tree/main/crates/shell), the [design document](https://github.com/longbridge/gpui-kit/blob/main/docs/gpui-shell.md) and [Getting Started](https://gpui-kit.com/shell/getting-started).
- **The examples here**: `hello/` is the smallest, `project-stats/` scans files in the background, `code-quiz/` shows commands, network, keyboard and several pages, and `forge/` shows the sessions API and animation.

## 8. Easy mistakes

- **State as class fields**: a class field like `count = 0;` runs after `init` and overwrites what `init` assigned with `undefined`. Assign everything in `init`.
- **IO in `render`**: smelt redraws often, and `render` may only read memory. Read files, run commands and fetch inside `cx.spawn`.
- **`cx.notify()` inside `render`**: it throws.
- **Reusing elements**: an element can be used once. Don't keep one on `this` or put the same one in two places; build it again in each `render`.
- **Unstable control ids**: interactive controls need ids that are stable and unique among siblings, e.g. ``Button.new(`delete-${item.id}`)``.
- **Stale async results**: the user can switch projects or leave a page at any moment. Note an increasing number when a task starts and drop its result if it no longer matches. See `roundId` in `code-quiz/main.js`.
- **Constructing with `new`**: always `Type.new(...)`, e.g. `Button.new("id")`, never `new Button(...)`.
- **`window.open_dialog`**: gpui-shell's own dialog isn't available inside the smelt workspace. Use `AlertDialog`.
- **Page background**: don't paint one; smelt does.

## 9. Testing

Put logic that doesn't touch the interface in its own modules, importing only modules Node also has, such as `fs/promises` and `path`, and test them with Node:

```bash
node --test tests/
```

Modules that import `gpui-kit` or `smelt-workspace` only run inside smelt. See `code-quiz/tests/`.

## 10. Sharing a plugin

Push the plugin directory to a git repository. Others clone it and pick it with **导入插件目录 (Import plugin directory)** on the Panel Plugins page. Plugins run without restrictions, like smelt itself: they can read and write any file and run any command. Install plugins only from people you trust, and say in your README what yours does.
