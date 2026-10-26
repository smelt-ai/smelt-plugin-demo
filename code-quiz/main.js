// 「代码猜猜看」：从当前项目里抽一段真实代码，猜它在哪个文件、是谁写的、什么时候写的。
//
// 这是 smelt 的进阶插件示例，把一个真实插件常用的写法都用上了：
// - 宿主模块：`smelt-workspace` 读当前项目，项目一换就作废这一局；
// - 运行命令：`process.run` 跑 git 出题（git.js）；
// - 网络：`fetch` 查提交在 GitHub 上的账号，主机在 gpui-shell.json 里声明（github.js）；
// - 文件：排行榜写在插件自己的数据目录里（scores.js）；
// - 异步：出题、联网都在 `cx.spawn` 里，答这一题时下一题已经在后台出好；
// - 定时器：倒计时用 `cx.timer.every`，答完就取消；
// - 键盘：`cx.focus_handle()` + `track_focus` + `on_key_down`，1–4 作答，空格下一题；
// - 多页面：一个 `page` 字段切换，render 只看内存里的状态；
// - 剪贴板、打开链接、确认弹窗、输入框筛选。
//
// 规矩只有一条：render 只读内存。读盘、跑命令、联网都在事件或任务里做，做完 `cx.notify()`。

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  AlertDialog,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  ErrorAlert,
  Input,
  InputState,
} from "gpui-component";
import { context } from "smelt-workspace";
import { basename } from "path";

import { loadRepo, nextQuestion } from "./git.js";
import { commitUrl, lookupCommit } from "./github.js";
import { QUESTION_MS, ROUND_SIZE, availableKinds, pick, scoreFor, shareText } from "./quiz.js";
import { addScore, bestFor, loadScores, rankOf, saveScores, scoresPath } from "./scores.js";
import {
  MONO,
  SPACE,
  button,
  card,
  codeBlock,
  formatDate,
  hint,
  keycap,
  message,
  stat,
  tag,
  timerBar,
} from "./ui.js";

const ANSWER_KEYS = ["1", "2", "3", "4"];

export default class CodeQuiz extends View {
  init(_props, cx) {
    /** @type {"home" | "loading" | "question" | "reveal" | "summary" | "scores"} */
    this.page = "home";
    this.home = "";
    this.projectRoot = null;
    this.generation = -1;
    this.error = null;
    this.notice = null;
    this.noticeTimer = null;

    // 一局的状态。`roundId` 每开一局、每作废一局都加一：异步任务回来时对不上号就丢掉结果。
    this.roundId = 0;
    this.round = null;
    this.ticker = null;
    // 揭晓页的 GitHub 查询结果。
    this.github = null;

    this.scores = [];
    this.lastEntry = null;
    this.search = InputState.new("按项目名筛选");
    this.query = "";
    // 键盘要有落点：根元素 track_focus 这个句柄，开局时把焦点移过来。
    this.focus = cx.focus_handle();

    this.sync();
    cx.spawn(async (cx) => {
      this.scores = await loadScores(scoresPath(this.home));
      cx.notify();
    });
    // 插件收不到宿主的通知，只能轮询。`context()` 读的是内存，每秒一次没有负担。
    this.watch = cx.timer.every(1000, (cx) => {
      if (!this.sync()) return;
      // 换项目了：正在玩的这一局题目都来自旧项目，作废。
      if (this.round !== null) this.abandon();
      cx.notify();
    });
  }

  /// 读宿主给的当前项目。变了返回 true。
  sync() {
    const ctx = context();
    if (ctx.generation === this.generation) return false;
    this.generation = ctx.generation;
    this.home = ctx.home;
    this.projectRoot = ctx.project_root;
    return true;
  }

  projectName() {
    return this.projectRoot === null ? "" : basename(this.projectRoot);
  }

  // ---------------------------------------------------------------- 一局的流程

  start(cx) {
    if (this.projectRoot === null) return;
    this.abandon();
    const id = this.roundId;
    this.page = "loading";
    this.error = null;
    this.focus.focus();
    cx.notify();

    const root = this.projectRoot;
    cx.spawn(async (cx) => {
      try {
        const repo = await loadRepo(root);
        const kinds = availableKinds(repo);
        if (kinds.length === 0) throw new Error("这个项目的代码文件太少，出不了题。");
        if (id !== this.roundId) return;
        this.round = {
          repo,
          kinds,
          index: 0,
          results: [],
          score: 0,
          streak: 0,
          bestStreak: 0,
          question: null,
          chosen: null,
          next: null,
          deadline: 0,
          msLeft: QUESTION_MS,
        };
        const first = await this.generate();
        if (id !== this.roundId) return;
        this.show(first, cx);
      } catch (error) {
        if (id !== this.roundId) return;
        this.round = null;
        this.page = "home";
        this.error = message(error);
      }
      cx.notify();
    });
  }

  /// 出一道随机类型的题。
  generate() {
    const round = this.round;
    return nextQuestion(round.repo, pick(round.kinds, Math.random), Math.random);
  }

  /// 亮出一道题，开始倒计时，同时在后台出好下一题。
  show(question, cx) {
    const round = this.round;
    round.question = question;
    round.chosen = null;
    round.deadline = Date.now() + QUESTION_MS;
    round.msLeft = QUESTION_MS;
    this.page = "question";
    this.github = null;
    // 先接住失败，等用到时再报：没人 await 的 Promise 失败会被当成未处理的错误。
    round.next =
      round.index + 1 < ROUND_SIZE ? this.generate().then((value) => ({ value }), (error) => ({ error })) : null;
    this.ticker?.cancel();
    this.ticker = cx.timer.every(100, (cx) => this.tick(cx));
  }

  tick(cx) {
    if (this.page !== "question" || this.round === null) return;
    this.round.msLeft = this.round.deadline - Date.now();
    if (this.round.msLeft <= 0) this.answer(null, cx);
    else cx.notify();
  }

  /// 作答。`choice` 为 null 是超时。
  answer(choice, cx) {
    const round = this.round;
    if (this.page !== "question" || round === null) return;
    this.ticker?.cancel();
    this.ticker = null;

    const question = round.question;
    const correct = choice === question.answer;
    round.chosen = choice;
    round.streak = correct ? round.streak + 1 : 0;
    round.bestStreak = Math.max(round.bestStreak, round.streak);
    const points = scoreFor(correct, round.msLeft, round.streak);
    round.score += points;
    round.results.push({ correct, points, timeout: choice === null });
    this.page = "reveal";
    this.lookup(question, cx);
    cx.notify();
  }

  /// 揭晓时联网查这次提交的 GitHub 账号。查到之前页面先显示「查询中」。
  lookup(question, cx) {
    const github = this.round.repo.github;
    if (github === null) {
      this.github = { state: "local" };
      return;
    }
    this.github = { state: "loading" };
    cx.spawn(async (cx) => {
      let result;
      try {
        result = await lookupCommit(github, question.commit.sha);
      } catch (error) {
        result = { state: "error", text: message(error) };
      }
      // 已经翻到下一题了，这个结果就不要了。
      if (this.round?.question !== question) return;
      this.github = result;
      cx.notify();
    });
  }

  next(cx) {
    const round = this.round;
    if (this.page !== "reveal" || round === null) return;
    round.index += 1;
    if (round.index >= ROUND_SIZE) {
      this.finish(cx);
      return;
    }
    const id = this.roundId;
    const pending = round.next;
    this.page = "loading";
    cx.notify();
    cx.spawn(async (cx) => {
      const outcome = await pending;
      if (id !== this.roundId) return;
      if (outcome.error) {
        this.round = null;
        this.page = "home";
        this.error = message(outcome.error);
      } else {
        this.show(outcome.value, cx);
      }
      cx.notify();
    });
  }

  finish(cx) {
    const round = this.round;
    const entry = {
      score: round.score,
      correct: round.results.filter((result) => result.correct).length,
      total: round.results.length,
      streak: round.bestStreak,
      project: this.projectName(),
      at: Date.now(),
    };
    this.scores = addScore(this.scores, entry);
    this.lastEntry = entry;
    this.page = "summary";
    cx.notify();
    const scores = this.scores;
    cx.spawn(async (cx) => {
      try {
        await saveScores(scoresPath(this.home), scores);
      } catch (error) {
        this.say(`成绩没存上：${message(error)}`, cx);
      }
    });
  }

  /// 作废进行中的一局，回到首页。还在路上的出题、联网结果回来时对不上 `roundId`，会被丢掉。
  abandon() {
    this.roundId += 1;
    this.ticker?.cancel();
    this.ticker = null;
    this.round = null;
    this.github = null;
    this.page = "home";
  }

  clearScores(cx) {
    this.scores = [];
    this.lastEntry = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await saveScores(scoresPath(this.home), []);
      } catch (error) {
        this.say(`清空失败：${message(error)}`, cx);
      }
    });
  }

  copy(text, cx) {
    cx.write_to_clipboard(text);
    this.say("已复制", cx);
  }

  /// 顶部一行提示，两秒后自己消失。
  say(text, cx) {
    this.notice = text;
    this.noticeTimer?.cancel();
    this.noticeTimer = cx.timer.after(2000, (cx) => {
      this.notice = null;
      cx.notify();
    });
    cx.notify();
  }

  // ---------------------------------------------------------------- 键盘

  onKey(event, cx) {
    const key = event.key;
    if (this.page === "question") {
      const index = ANSWER_KEYS.indexOf(key);
      if (index >= 0 && index < this.round.question.choices.length) {
        this.answer(this.round.question.choices[index], cx);
        return;
      }
    }
    if (this.page === "reveal" && (key === "space" || key === "enter")) {
      this.next(cx);
      return;
    }
    if ((this.page === "home" || this.page === "summary") && key === "enter") {
      this.start(cx);
      return;
    }
    if (key === "escape" && this.page !== "home") {
      this.abandon();
      cx.notify();
    }
  }

  // ---------------------------------------------------------------- 界面

  render(cx) {
    const colors = cx.theme().colors;
    return v_flex()
      .size_full()
      .track_focus(this.focus)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .text_color(colors.foreground)
      .child(this.header(cx))
      .child(
        v_flex()
          .flex_1()
          .min_h_0()
          .overflow_y_scrollbar()
          .p(SPACE.lg)
          .gap(SPACE.lg)
          .children(this.body(cx)),
      );
  }

  header(cx) {
    const colors = cx.theme().colors;
    const round = this.round;
    const inRound = round !== null && (this.page === "question" || this.page === "reveal");
    return h_flex()
      .items_center()
      .gap(SPACE.sm)
      .px(SPACE.lg)
      .py(SPACE.sm)
      .border_b(1)
      .border_color(colors.border)
      .child(div().text_sm().font_semibold().child("代码猜猜看"))
      .child(div().flex_1())
      .when(inRound, (el) =>
        el
          .child(hint(`第 ${round.index + 1}/${ROUND_SIZE} 题`, cx))
          .child(div().text_sm().font_semibold().child(`${round.score} 分`))
          .when(round.streak >= 2, (el) => el.child(tag(`🔥 连对 ${round.streak}`, "warning"))),
      )
      .when(this.page === "home", (el) => el.child(button("open-scores", "排行榜", (cx) => this.openScores(cx))));
  }

  openScores(cx) {
    this.page = "scores";
    cx.notify();
  }

  body(cx) {
    const parts = [];
    if (this.notice !== null) parts.push(hint(this.notice, cx));
    switch (this.page) {
      case "home":
        return [...parts, ...this.homePage(cx)];
      case "loading":
        return [...parts, hint("正在出题…", cx)];
      case "question":
        return [...parts, ...this.questionPage(cx)];
      case "reveal":
        return [...parts, ...this.revealPage(cx)];
      case "summary":
        return [...parts, ...this.summaryPage(cx)];
      case "scores":
        return [...parts, ...this.scoresPage(cx)];
    }
    return parts;
  }

  homePage(cx) {
    if (this.projectRoot === null) {
      return [empty("没有打开项目", "在 smelt 里打开一个 git 项目，就能用它的代码出题。")];
    }
    const best = bestFor(this.scores, this.projectName());
    const parts = [];
    if (this.error !== null) parts.push(ErrorAlert.new("error", this.error).size("small"));
    parts.push(
      card(
        [
          div().text_lg().font_semibold().child(this.projectName()),
          hint(
            `从这个项目里随机抽 ${ROUND_SIZE} 段代码，猜它在哪个文件、是谁写的、什么时候写的。` +
              `每题 ${QUESTION_MS / 1000} 秒，答得越快分越高，连对还有加成。`,
            cx,
          ),
          hint(best === null ? "这个项目还没玩过。" : `这个项目的最高分：${best}`, cx),
        ],
        cx,
      ),
      h_flex()
        .gap(SPACE.sm)
        .items_center()
        .child(button("start", "开始", (cx) => this.start(cx), "primary"))
        .child(keycap("Enter", cx)),
      v_flex()
        .gap(SPACE.xs)
        .child(keyHint(["1", "2", "3", "4"], "作答", cx))
        .child(keyHint(["空格"], "下一题", cx))
        .child(keyHint(["Esc"], "退出这一局", cx)),
    );
    return parts;
  }

  questionPage(cx) {
    const round = this.round;
    const question = round.question;
    return [
      timerBar(round.msLeft, QUESTION_MS, cx),
      div().text_base().font_semibold().child(question.prompt),
      // 文件题不能把文件名亮出来；另外两种给出文件名当线索。
      question.kind === "file" ? null : hint(question.snippet.file, cx),
      codeBlock(question.snippet, question.kind === "file" ? null : question.focusLine, cx),
      v_flex()
        .gap(SPACE.sm)
        .children(
          question.choices.map((choice, index) =>
            Button.new(`choice-${index}`)
              .outline()
              .w_full()
              .on_click((_event, cx) => this.answer(choice, cx))
              .child(
                h_flex()
                  .w_full()
                  .gap(SPACE.sm)
                  .items_center()
                  .child(keycap(ANSWER_KEYS[index], cx))
                  .child(div().flex_1().min_w_0().truncate().child(choice)),
              ),
          ),
        ),
    ].filter((part) => part !== null);
  }

  revealPage(cx) {
    const round = this.round;
    const question = round.question;
    const last = round.results[round.results.length - 1];
    const commit = question.commit;
    const github = round.repo.github;
    const verdict = last.correct
      ? tag(`答对了 +${last.points}`, "success")
      : tag(last.timeout ? "时间到" : "答错了", "danger");

    return [
      h_flex().gap(SPACE.sm).items_center().child(verdict).child(hint(question.prompt, cx)),
      card(
        [
          hint("答案", cx),
          div().text_base().font_semibold().whitespace_normal().child(question.answer),
          round.chosen !== null && !last.correct ? hint(`你选的是：${round.chosen}`, cx) : null,
        ].filter((part) => part !== null),
        cx,
      ),
      hint(`${question.snippet.file}:${question.focusLine}`, cx),
      codeBlock(question.snippet, question.focusLine, cx),
      card(
        [
          h_flex()
            .gap(SPACE.sm)
            .items_center()
            .child(div().text_xs().font_family(MONO).child(commit.sha.slice(0, 7)))
            .child(div().text_sm().child(commit.author))
            .child(hint(formatDate(commit.time), cx)),
          div().text_sm().whitespace_normal().child(commit.summary),
          this.githubLine(cx),
        ],
        cx,
      ),
      h_flex()
        .gap(SPACE.sm)
        .flex_wrap()
        .items_center()
        .child(button("next", round.index + 1 >= ROUND_SIZE ? "看成绩" : "下一题", (cx) => this.next(cx), "primary"))
        .child(keycap("空格", cx))
        .when(github !== null, (el) =>
          el.child(
            button("open-commit", "在 GitHub 打开", (cx) =>
              cx.open_url(this.github?.url ?? commitUrl(github, commit.sha)),
            ),
          ),
        )
        .child(
          button("copy-location", "复制位置", (cx) => this.copy(`${question.snippet.file}:${question.focusLine}`, cx)),
        ),
    ];
  }

  githubLine(cx) {
    const github = this.github;
    if (github === null) return hint("", cx);
    switch (github.state) {
      case "loading":
        return hint("正在查 GitHub…", cx);
      case "found":
        return hint(github.login ? `GitHub：@${github.login}` : "GitHub 上没关联账号", cx);
      case "unpushed":
        return hint("这个提交还没推到 GitHub。", cx);
      case "local":
        return hint("不是 GitHub 仓库，不联网查询。", cx);
      default:
        return hint(github.text, cx);
    }
  }

  summaryPage(cx) {
    const entry = this.lastEntry;
    const results = this.round?.results ?? [];
    const rank = rankOf(this.scores, entry);
    const text = shareText(entry.project, results, entry.score);
    return [
      card(
        [
          div().text_lg().font_semibold().child(`${entry.score} 分`),
          h_flex()
            .gap(SPACE.md)
            .child(stat("答对", `${entry.correct}/${entry.total}`, cx))
            .child(stat("最长连对", entry.streak, cx))
            .child(stat("排行榜", rank === null ? "未上榜" : `第 ${rank} 名`, cx)),
          div().text_lg().child(results.map((result) => (result.correct ? "🟩" : "🟥")).join("")),
        ],
        cx,
      ),
      h_flex()
        .gap(SPACE.sm)
        .flex_wrap()
        .items_center()
        .child(button("again", "再来一局", (cx) => this.start(cx), "primary"))
        .child(keycap("Enter", cx))
        .child(button("share", "复制成绩单", (cx) => this.copy(text, cx)))
        .child(button("scores", "排行榜", (cx) => this.openScores(cx))),
    ];
  }

  scoresPage(cx) {
    const colors = cx.theme().colors;
    const query = this.query.trim().toLowerCase();
    const shown = this.scores
      .map((entry, index) => ({ entry, rank: index + 1 }))
      .filter(({ entry }) => query === "" || entry.project.toLowerCase().includes(query));

    const toolbar = h_flex()
      .gap(SPACE.sm)
      .items_center()
      .child(button("back", "返回", (cx) => {
        this.page = "home";
        cx.notify();
      }))
      .child(
        div()
          .flex_1()
          .child(
            Input.new(this.search)
              .aria_label("按项目名筛选")
              .on_change((text, cx) => {
                this.query = text;
                cx.notify();
              }),
          ),
      )
      .when(this.scores.length > 0, (el) =>
        el.child(
          // 确认框本身就是触发按钮；点「确定」时 on_ok 收到这次点击的 cx。
          AlertDialog.new("clear-scores", "清空", (error, cx) => this.say(error, cx))
            .title("清空排行榜？")
            .description("所有项目的成绩都会删除，不能恢复。")
            .show_cancel(true)
            .on_ok((cx) => this.clearScores(cx)),
        ),
      );

    if (this.scores.length === 0) {
      return [toolbar, empty("还没有成绩", "玩一局，成绩会记在这里。")];
    }
    if (shown.length === 0) {
      return [toolbar, empty("没有匹配的成绩", `项目名里没有「${this.query.trim()}」。`)];
    }
    return [
      toolbar,
      v_flex().children(
        shown.map(({ entry, rank }) =>
          h_flex()
            .gap(SPACE.md)
            .items_center()
            .py(SPACE.sm)
            .border_b(1)
            .border_color(colors.border)
            .when(entry === this.lastEntry, (el) => el.bg(colors.accent))
            .child(div().w(28).flex_none().text_sm().text_color(colors.muted_foreground).child(`#${rank}`))
            .child(div().w(64).flex_none().text_sm().font_semibold().child(`${entry.score}`))
            .child(div().flex_1().min_w_0().text_sm().truncate().child(entry.project))
            .child(hint(`${entry.correct}/${entry.total}`, cx))
            .child(hint(formatDate(entry.at), cx)),
        ),
      ),
    ];
  }
}

function keyHint(keys, label, cx) {
  return h_flex()
    .gap(SPACE.xs)
    .items_center()
    .children(keys.map((key) => keycap(key, cx)))
    .child(hint(label, cx));
}

function empty(title, description) {
  return Empty.new().header(
    EmptyHeader.new().title(EmptyTitle.new().child(title)).description(EmptyDescription.new().child(description)),
  );
}
