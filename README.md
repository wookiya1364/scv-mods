# scv-mods

Claude Code mods for the SCV workflow.

## Mods

- **scv-hello** — the SCV dashboard, in an "SCV" pane beside the chat in the Claude desktop app (local sessions). It reads the session folder's `scv/promote/*/PLAN.md` and `TESTS.md` (read only; with no plan in progress, the newest archived plans under `scv/archive/` stand in) and shows:
  - a one-line summary at the top (where the work stands · anything stuck · time left) and the next thing to do, with buttons that put its command in the prompt box (keeping what you typed; copied instead where the box will not take it) or copy it, and the same command offered as the prompt box's dim suggestion (Tab) when a turn ends; the plan status in plain words
  - plan progress (Suggested path steps done / total) with a traffic-light bar, and the stage flow as connected step nodes (done · doing · blocked · waiting, with a "지금 여기" tag where the work stands); steps are read from `[x]` / `[~]` / `[!]` marks merged with the step signals Claude sends while it works (the `scv_step` tool the mod registers, which asks no permission and changes no file; Claude is told about it only while a plan is open in `scv/promote`), else estimated from the plan status
  - what Claude is doing now: the step, the tool and its file or command, elapsed time, the todo list, and one line per subagent at work (five at most, the rest counted)
  - while you were away: what happened since your last message — steps finished, test runs and their outcome, and what waits on you
  - an estimated finish time from how long the steps took (always marked as an estimate)
  - blocked cards: waiting for your answer, waiting for your permission, a turn stopped by an error or a refusal, a failed test run
  - test results per TESTS.md scenario, from test commands run in a session; the last results are kept in the mod's own store per project folder, so a new session still shows them
  - the usage limits: how much of the 5-hour and 7-day windows is used and when the 5-hour one resets
  - alerts when Claude waits for your answer or your permission, a test run fails, a turn of 2 minutes or more finishes, a turn stops on an error or a refusal, or a usage window passes 90% (once per window): the app's notification, else the system's own, and Claude's own notification tool, which also reaches your phone while Remote Control is connected
  - the project is the nearest folder at or above the session's folder that holds `scv/`, so a session opened in a subfolder still sees its plans
  - the latest `/scv:dreams` summary, its improvement items, and a button that opens the report
  - press a step node to see what that step does, in plain words from the plan's pipeline table (its 하는 일 column), and what was done during it in this session; a step line names its pipeline steps after a dash: `3. Draw the pane — \`render\``
  - a plan picker when there are several plans; buttons to expand each section

  It opens when a session starts; if you close it, it reopens on your next message, or type `/scv-hello`. The terminal is not a target.

## Install

At the prompt of a terminal session:

```
/plugin install scv-hello --marketplace wookiya1364/scv-mods
```

From a shell:

```
claude plugin install scv-hello --marketplace wookiya1364/scv-mods
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `wookiya1364/scv-mods`, then Add plugin.

This repository is private: the install works only for GitHub accounts that can read it, on a machine that already holds a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Update

```
claude plugin marketplace update scv-mods
claude plugin update scv-hello@scv-mods
```

Then run `/reload-plugins` in an open session.
