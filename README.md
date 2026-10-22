# scv-mods

Claude Code mods for the SCV workflow.

## Mods

- **scv-hello** — opens an "SCV" pane when a session starts, showing which surface draws it and where it is placed (dock or inline), with a button that raises a toast. A placement test for the SCV dashboard pane.

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
