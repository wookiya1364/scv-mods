# Releasing a mod

A release gives a mod a version number, notes that say what is in it, and a tag, and it is the only way a change reaches the machines that already have the mod. Do not edit a version by hand: `scripts/release.sh` is what keeps the version, the commit, the tag and `main` in step.

## Why a release is needed

A mod's version lives in one place, its `.claude-plugin/plugin.json`. The marketplace entry carries none: Claude Code's docs say not to set it in both places, and `plugin.json` wins when both are set. Once a version is set, `claude plugin update` moves a user only when that string changes, so commits pushed under the same version do not reach anyone. Ordinary work therefore never touches the version; a release does.

## Branches

- `develop` is where work goes. Commit and push there.
- `main` is what the marketplace serves. It moves only when a release fast-forwards it to `develop`, so one version number always means the same files.

## Cutting a release

On `develop`, with everything committed:

1. Write the notes, `docs/releases/<mod>/<version>.md`: what the version holds, in plain words. Commit them.
2. Preview with `scripts/release.sh <mod> <version> --dry-run`. It prints every check and the steps it would take, and changes nothing.
3. Release with `scripts/release.sh <mod> <version> --push`.

The script checks everything first and reports every failure at once: the mod exists, you are on `develop`, the tree is clean, the version is `x.y.z` (or `x.y.z-rc.1`) and greater than the current one, the notes exist and are not empty, `main` can be fast-forwarded to `develop`, and the tag does not exist yet. Then, in order: the mod's tests, the version written into `plugin.json`, `claude plugin validate`, the commit `release: <mod> <version>`, the tag `<mod>--v<version>` (made by `claude plugin tag`), `main` fast-forwarded to `develop`, and with `--push`, `develop`, `main` and the tag pushed in one atomic push.

A step that fails before the push undoes what this run changed and stops. If only the push fails, the release stays local; run the same command with `--push` again and it only pushes. Without `--push` the release is made locally, and the last line says how to push it.

`SCV_RELEASE_TRAILERS` adds lines to the end of the release commit message, such as a `Co-Authored-By:` line.

## The release page

Pushing a `<mod>--v<version>` tag runs `.github/workflows/release.yml`, which publishes a GitHub release from the notes, and a version with a `-` (such as `1.0.0-rc.1`) as a prerelease. It runs on GitHub's runner, so `gh` is not needed on your machine.

If it fails, or a push did not start it, the tag and the notes are still there: run it by hand from the Actions tab (release, then Run workflow) with the tag. A page that already exists is updated from the notes rather than made twice. The first release, scv-dashboard 0.1.0, is such a case: its tag went up in the same push that added the workflow, GitHub did not start a run, and its page was published with the same command from a machine where `gh` was signed in.

## Getting a release

On each machine, run `/scv:mods` (SCV 0.70.0 or later), or from a shell:

```
claude plugin marketplace update scv-mods
claude plugin update scv-dashboard@scv-mods
```

Then run `/reload-plugins` in an open session.

## Tests

`bash scripts/tests/release.test.sh` checks the script against a throwaway marketplace and remote, with the real `git` and the real `claude plugin tag` and `claude plugin validate`.
