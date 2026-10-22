# scv-mods

Claude Code mods for the SCV workflow.

## Mods

- **scv-hello** — the SCV dashboard, in an "SCV" pane beside the chat in the Claude desktop app (local sessions). It reads the session folder's `scv/promote/*/PLAN.md` and `TESTS.md` (read only) and shows:
  - a one-line summary at the top (where the work stands · anything stuck · time left) and the next thing to do, with a button that copies its command; the plan status in plain words
  - plan progress (Suggested path steps done / total) with a traffic-light bar, and the stage flow as connected step nodes (done · doing · blocked · waiting, with a "지금 여기" tag where the work stands); steps are read from `[x]` / `[~]` / `[!]` marks, else estimated from the plan status
  - what Claude is doing now: the step, the tool and its file or command, elapsed time, the todo list
  - an estimated finish time (always marked as an estimate)
  - blocked cards: waiting for your answer, a failed test run
  - test results per TESTS.md scenario, from test commands run in a session; the last results are kept in the mod's own store per project folder, so a new session still shows them
  - an alert when Claude waits for your answer or a test run fails (the app's notification, else the system's own)
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
