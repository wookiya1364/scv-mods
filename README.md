# scv-mods

Claude Code mods for the SCV workflow.

## Mods

- **scv-hello** — shows a one-line status (`scv-hello: on (<surfaces>)`) and a short toast when a session starts. A smoke test that the mod loads on this machine.

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
