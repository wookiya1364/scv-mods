# scv-mods

Claude Code mods for the SCV workflow.

## Mods

- **scv-hello** — the SCV dashboard, in an "SCV" pane beside the chat in the Claude desktop app (local sessions). It reads the session folder's `scv/promote/*/PLAN.md` and `TESTS.md` (read only) and shows:
  - plan progress (Suggested path steps done / total) with a bar, and the stage flow (done · doing · blocked · waiting); steps are read from `[x]` / `[~]` / `[!]` marks, else estimated from the plan status
  - what Claude is doing now: the step, the tool and its file or command, elapsed time, the todo list
  - an estimated finish time (always marked as an estimate)
  - blocked cards: waiting for your answer, a failed test run
  - test results per TESTS.md scenario, from test commands run in this session
  - the latest `/scv:dreams` summary, its improvement items, and a button that opens the report
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
