#!/usr/bin/env bash
# release.sh — scv-mods 의 모드 릴리스: 확인 · 시험 · 버전 적기 · 검사 · 커밋 · 태그 · main 앞당기기 · (고르면) 올리기를 한 번에.
#
# SCV 의 릴리스(버전 스크립트 + 승격 workflow)를 이 저장소 크기로 옮긴 것이다.
# - 버전은 모드의 .claude-plugin/plugin.json 한 곳에만 적는다. 마켓 목록(marketplace.json)에는 적지 않는다 — 두 곳에
#   적지 말라는 공식 권고이고, 둘 다 있으면 plugin.json 이 이긴다. 버전을 바꾸는 것은 이 스크립트뿐이다.
# - 일은 develop 에 쌓고, main 은 릴리스 때만 develop 으로 앞당긴다(fast-forward 만). 마켓은 main 을 읽는다.
# - 태그는 Claude Code 의 공식 형식 <mod>--v<version> 이고 `claude plugin tag` 가 만든다.
# - 올리기(push)는 --push 를 줄 때만 한다. 그 앞 단계는 틀리면 이번 실행이 바꾼 것을 모두 되돌린다.
#
# 흐름(순수 단계는 가운데, 부수효과는 양 끝):
#   사실 읽기(부수, main) → release_state(순수) → release_checks(순수) → release_steps(순수) → run_steps(부수)
#
# Usage:
#   release.sh <mod> <version>             # 확인 → 시험 → 버전 적기 → 검사 → 커밋 → 태그 → main 앞당기기 (올리지 않음)
#   release.sh <mod> <version> --dry-run   # 확인과 할 일만 보이고 아무것도 바꾸지 않는다
#   release.sh <mod> <version> --push      # 위와 같고, 끝에 develop · main · 태그를 한 번에(atomic) 올린다
#   release.sh tag-info <tag>              # GitHub 자동 작업용: 태그에서 모드 · 번호 · 노트 · 제목을 뽑는다
#
# Env:
#   SCV_CLAUDE_BIN        claude 실행 파일 (기본 claude) — 시험용.
#   SCV_RELEASE_REMOTE    올릴 원격 (기본 origin).
#   SCV_RELEASE_TRAILERS  릴리스 커밋 메시지 끝에 붙일 줄들 (예: Co-Authored-By: …).
#
# Output (stdout, 한 줄에 하나):
#   RELEASE: <mod> <지금 버전|none> -> <version> (tag <tag>)
#   CHECK: <규칙> ok | CHECK: <규칙> fail <이유>
#   STEP: <단계> ok|fail|planned
#   RESULT: released <mod> <version> | pushed <mod> <version> | preview | failed <단계|check>
#   NEXT: <할 일 한 줄>
#
# Exit: 0 성공, 1 실패(확인 · 단계), 2 사용법 오류.

set -uo pipefail

CLAUDE_BIN="${SCV_CLAUDE_BIN:-claude}"
REMOTE="${SCV_RELEASE_REMOTE:-origin}"
WORK_BRANCH=develop
RELEASE_BRANCH=main

usage() { echo 'usage: release.sh <mod> <version> [--dry-run | --push]  |  release.sh tag-info <tag>' >&2; exit 2; }

# ── 순수 단계 ────────────────────────────────────────────────────────────────

# version_valid <v> → 0 이면 x.y.z 또는 x.y.z-<미리 보기 이름> (x.y.z 는 앞자리 0 없음)
version_valid() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]
}

# version_cmp <a> <b> → -1 | 0 | 1 — semver 순서 (미리 보기 번호는 같은 x.y.z 보다 앞)
version_cmp() {
  awk -v a="$1" -v b="$2" '
    function core(v,  i) { i = index(v, "-"); return i ? substr(v, 1, i - 1) : v }
    function pre(v,  i) { i = index(v, "-"); return i ? substr(v, i + 1) : "" }
    function num(s) { return s ~ /^[0-9]+$/ }
    function say(r) { print r; exit }
    BEGIN {
      split(core(a), x, "."); split(core(b), y, ".")
      for (i = 1; i <= 3; i++) {
        if (x[i] + 0 < y[i] + 0) say(-1)
        if (x[i] + 0 > y[i] + 0) say(1)
      }
      pa = pre(a); pb = pre(b)
      if (pa == pb) say(0)
      if (pa == "") say(1)
      if (pb == "") say(-1)
      n = split(pa, p, "."); m = split(pb, q, ".")
      for (i = 1; i <= n && i <= m; i++) {
        if (p[i] "" == q[i] "") continue
        if (num(p[i]) && num(q[i])) { r = (p[i] + 0 < q[i] + 0) ? -1 : 1; say(r) }
        if (num(p[i])) say(-1)
        if (num(q[i])) say(1)
        r = (p[i] "" < q[i] "") ? -1 : 1; say(r)
      }
      r = (n < m) ? -1 : ((n > m) ? 1 : 0); say(r)
    }'
}

# release_tag <mod> <version> → `claude plugin tag` 가 만드는 이름
release_tag() { printf '%s--v%s\n' "$1" "$2"; }

# notes_path <mod> <version> → 그 번호의 노트
notes_path() { printf 'docs/releases/%s/%s.md\n' "$1" "$2"; }

# tag_info <tag> → MOD · VERSION · NOTES · TITLE · PRERELEASE 줄. 릴리스 태그가 아니면 이유 한 줄과 1
tag_info() {
  local tag=$1 mod ver
  mod="${tag%--v*}"; ver="${tag##*--v}"
  if [[ "$tag" != *--v* || ! "$mod" =~ ^[a-z0-9][a-z0-9-]*$ ]] || ! version_valid "$ver"; then
    echo "릴리스 태그가 아닙니다: $tag (형식: <mod>--v<x.y.z>)"; return 1
  fi
  echo "MOD: $mod"
  echo "VERSION: $ver"
  echo "NOTES: $(notes_path "$mod" "$ver")"
  echo "TITLE: $mod $ver"
  if [[ "$ver" == *-* ]]; then echo "PRERELEASE: yes"; else echo "PRERELEASE: no"; fi
}

# release_state <current> <version> <tag_at_head:0|1> <main_at_head:0|1> → released | new
#   released: 이 번호로 로컬 릴리스를 이미 마쳤다(버전 · 태그 · main 이 모두 HEAD) — 올리기만 남는다.
release_state() {
  if [[ "$1" == "$2" && $3 -eq 1 && $4 -eq 1 ]]; then echo released; else echo new; fi
}

# release_checks — 사실을 받아 규칙마다 CHECK 줄 하나. 틀린 것을 한꺼번에 보인다.
#   args: <mod> <version> <mod_dir|""> <mods> <branch> <dirty:0|1> <current|""> <notes:ok|empty|missing>
#         <main:ok|missing|diverged> <tag_exists:0|1> <state:new|released> <remote:ok|missing|na>
release_checks() {
  local mod=$1 ver=$2 dir=$3 mods=$4 branch=$5 dirty=$6 cur=$7 notes=$8 main=$9 tagx=${10} state=${11} remote=${12}
  local np; np="$(notes_path "$mod" "$ver")"
  if [[ -n "$dir" ]]; then echo "CHECK: mod ok"
  else echo "CHECK: mod fail 그런 모드가 없습니다: $mod — 있는 모드: ${mods:-없음}"; fi
  if [[ "$branch" == "$WORK_BRANCH" ]]; then echo "CHECK: branch ok"
  else echo "CHECK: branch fail $WORK_BRANCH 갈래에서만 릴리스합니다 (지금: ${branch:-갈래 없음})"; fi
  if [[ $dirty -eq 0 ]]; then echo "CHECK: clean ok"
  else echo "CHECK: clean fail 커밋하지 않은 변경이 있습니다 — 커밋하거나 치운 뒤 다시"; fi
  if [[ "$state" == released ]]; then echo "CHECK: version ok (이미 로컬에 낸 $ver — 올리기만 남음)"
  elif ! version_valid "$ver"; then echo "CHECK: version fail 번호 형식은 0.1.0 처럼 x.y.z 입니다 (받은 값: ${ver:-빈 값})"
  elif [[ -n "$cur" ]] && ! version_valid "$cur"; then echo "CHECK: version fail 지금 버전이 형식에 맞지 않습니다: $cur"
  elif [[ -n "$cur" && "$(version_cmp "$ver" "$cur")" != 1 ]]; then echo "CHECK: version fail $ver 은 지금 버전 $cur 보다 커야 합니다"
  else echo "CHECK: version ok"; fi
  case "$notes" in
    ok) echo "CHECK: notes ok" ;;
    empty) echo "CHECK: notes fail 노트가 비어 있습니다: $np" ;;
    *) echo "CHECK: notes fail 노트가 없습니다: $np — 무엇이 들었는지 적어 커밋한 뒤 다시" ;;
  esac
  case "$main" in
    ok) echo "CHECK: main ok" ;;
    missing) echo "CHECK: main fail $RELEASE_BRANCH 갈래가 없습니다 — git fetch $REMOTE $RELEASE_BRANCH:$RELEASE_BRANCH" ;;
    *) echo "CHECK: main fail $RELEASE_BRANCH 에 $WORK_BRANCH 에 없는 커밋이 있어 앞당길 수 없습니다 — $RELEASE_BRANCH 를 $WORK_BRANCH 에 합친 뒤 다시" ;;
  esac
  if [[ "$state" == released || $tagx -eq 0 ]]; then echo "CHECK: tag ok"
  else echo "CHECK: tag fail 태그가 이미 있습니다: $(release_tag "$mod" "$ver")"; fi
  case "$remote" in
    ok) echo "CHECK: remote ok" ;;
    missing) echo "CHECK: remote fail 원격이 없습니다: $REMOTE" ;;
  esac
}

# checks_failed <CHECK 줄들> → 0 이면 fail 이 하나라도 있다
checks_failed() { grep -q '^CHECK: [a-z-]* fail ' <<<"$1"; }

# release_steps <state> <push:0|1> → 할 일 이름들, 차례대로
release_steps() {
  if [[ "$1" == new ]]; then printf '%s\n' test write-version validate commit tag advance-main; fi
  if [[ $2 -eq 1 ]]; then echo push; fi
  return 0
}

# commit_message <mod> <version> <trailers> → 릴리스 커밋 메시지
commit_message() {
  if [[ -n "$3" ]]; then printf 'release: %s %s\n\n%s\n' "$1" "$2" "$3"; else printf 'release: %s %s\n' "$1" "$2"; fi
}

# ── 부수효과 (양 끝) ─────────────────────────────────────────────────────────

# mod_dir <mod> → 마켓 목록에서 그 모드의 폴더(상대 경로), 없으면 빈 값
mod_dir() {
  jq -r --arg m "$1" '.plugins[]? | select(.name == $m) | .source | select(type == "string")' \
    .claude-plugin/marketplace.json 2>/dev/null | head -n 1 | sed 's#^\./##'
}

# mod_names → 마켓 목록의 모드 이름들
mod_names() { jq -r '[.plugins[]?.name] | join(", ")' .claude-plugin/marketplace.json 2>/dev/null; }

# write_version <plugin.json> <version> — version 을 name 바로 뒤에 둔다 (다른 키와 순서는 그대로)
write_version() {
  local tmp="$1.release.$$"
  if jq --arg v "$2" '{name: .name, version: $v} + del(.name, .version)' "$1" > "$tmp"; then mv "$tmp" "$1"
  else rm -f "$tmp"; return 1; fi
}

# undo_local <head> <plugin.json> <tag> <committed:0|1> <tagged:0|1> — 올리기 전 단계가 틀렸을 때 이번 실행이 바꾼 것을 되돌린다
undo_local() {
  [[ $5 -eq 1 ]] && git tag -d "$3" >/dev/null 2>&1
  if [[ $4 -eq 1 ]]; then git reset -q --keep "$1"; else git checkout -q HEAD -- "$2" 2>/dev/null; fi
  return 0
}

# run_steps <mod> <version> <dir> <tag> <head> <steps> — 할 일을 차례로 하고, 틀리면 되돌리고 멈춘다
run_steps() {
  local mod=$1 ver=$2 dir=$3 tag=$4 head=$5 steps=$6
  local pj="$3/.claude-plugin/plugin.json" committed=0 tagged=0 pushed=0 step out rc detail
  while IFS= read -r step; do
    [[ -n "$step" ]] || continue
    detail=""
    case "$step" in
      test)          out="$("$CLAUDE_BIN" plugin test "$dir" 2>&1)"; rc=$?
                     detail="$(grep -Eo '[0-9]+ pass' <<<"$out" | head -n 1)" ;;
      write-version) out="$(write_version "$pj" "$ver" 2>&1)"; rc=$? ;;
      validate)      out="$("$CLAUDE_BIN" plugin validate "$dir" 2>&1)"; rc=$? ;;
      commit)        out="$(git commit -q -F - -- "$pj" <<<"$(commit_message "$mod" "$ver" "${SCV_RELEASE_TRAILERS:-}")" 2>&1)"; rc=$?
                     [[ $rc -eq 0 ]] && committed=1 ;;
      tag)           out="$("$CLAUDE_BIN" plugin tag "$dir" 2>&1)"; rc=$?
                     [[ $rc -eq 0 ]] && { tagged=1; detail="$tag"; } ;;
      advance-main)  out="$(git fetch -q . "HEAD:refs/heads/$RELEASE_BRANCH" 2>&1)"; rc=$? ;;
      push)          out="$(git push -q --atomic -u "$REMOTE" "refs/heads/$WORK_BRANCH:refs/heads/$WORK_BRANCH" \
                       "refs/heads/$RELEASE_BRANCH:refs/heads/$RELEASE_BRANCH" "refs/tags/$tag:refs/tags/$tag" 2>&1)"; rc=$?
                     [[ $rc -eq 0 ]] && pushed=1 ;;
      *)             out="모르는 단계: $step"; rc=1 ;;
    esac
    if [[ $rc -eq 0 ]]; then echo "STEP: $step ok${detail:+ ($detail)}"; continue; fi
    echo "STEP: $step fail"
    printf '%s\n' "$out" | tail -n 6 | sed 's/^/  | /'
    if [[ "$step" == push ]]; then
      echo "RESULT: failed push"
      echo "NEXT: 로컬 릴리스는 남았습니다 — 원인을 고친 뒤 다시: scripts/release.sh $mod $ver --push"
    else
      undo_local "$head" "$pj" "$tag" "$committed" "$tagged"
      echo "RESULT: failed $step"
      echo "NEXT: 이번 실행이 바꾼 것은 되돌렸습니다 — 원인을 고친 뒤 다시: scripts/release.sh $mod $ver"
    fi
    return 1
  done <<<"$steps"
  if [[ $pushed -eq 1 ]]; then
    echo "RESULT: pushed $mod $ver"
    echo "NEXT: 다른 컴퓨터에서 /scv:mods 로 받습니다 (SCV 0.70.0 이상) — 그다음 /reload-plugins 또는 새 세션"
    echo "NEXT: 릴리스 페이지는 GitHub 저장소의 Releases 에 자동으로 생깁니다 (.github/workflows/release.yml)"
  else
    echo "RESULT: released $mod $ver"
    echo "NEXT: 로컬에만 냈습니다 — 올릴 때: scripts/release.sh $mod $ver --push"
  fi
  return 0
}

# ── 진입 ────────────────────────────────────────────────────────────────────

main() {
  [[ $# -ge 1 ]] || usage
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "RESULT: failed not-a-git-repository"; return 1; }
  cd "$root" || return 1

  if [[ "$1" == tag-info ]]; then
    [[ $# -eq 2 ]] || usage
    local info notes
    info="$(tag_info "$2")" || { echo "$info" >&2; return 1; }
    notes="$(sed -n 's/^NOTES: //p' <<<"$info")"
    [[ -s "$notes" ]] || { echo "노트가 없습니다: $notes" >&2; return 1; }
    echo "$info"
    return 0
  fi

  [[ $# -ge 2 && $# -le 3 ]] || usage
  local mod=$1 ver=$2 mode=${3:-run} push=0
  case "$mode" in run|--dry-run) ;; --push) push=1 ;; *) usage ;; esac
  command -v jq >/dev/null 2>&1 || { echo "RESULT: failed jq-missing"; echo "NEXT: jq 를 설치한다"; return 1; }

  # 사실 읽기 (입구)
  local dir mods branch dirty=0 cur="" np notes head mainst tag tagx=0 tag_at_head=0 main_at_head=0 remote=na
  dir="$(mod_dir "$mod")"; [[ -n "$dir" && -f "$dir/.claude-plugin/plugin.json" ]] || dir=""
  mods="$(mod_names)"
  branch="$(git symbolic-ref -q --short HEAD 2>/dev/null)"
  [[ -n "$(git status --porcelain 2>/dev/null)" ]] && dirty=1
  [[ -n "$dir" ]] && cur="$(jq -r '.version // empty' "$dir/.claude-plugin/plugin.json" 2>/dev/null)"
  np="$(notes_path "$mod" "$ver")"
  if [[ -s "$np" ]]; then notes=ok; elif [[ -e "$np" ]]; then notes=empty; else notes=missing; fi
  head="$(git rev-parse -q --verify HEAD 2>/dev/null)"
  if ! git rev-parse -q --verify "refs/heads/$RELEASE_BRANCH" >/dev/null; then mainst=missing
  elif git merge-base --is-ancestor "refs/heads/$RELEASE_BRANCH" HEAD 2>/dev/null; then mainst=ok
  else mainst=diverged; fi
  tag="$(release_tag "$mod" "$ver")"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    tagx=1
    [[ "$(git rev-parse -q --verify "refs/tags/$tag^{commit}")" == "$head" ]] && tag_at_head=1
  fi
  [[ "$(git rev-parse -q --verify "refs/heads/$RELEASE_BRANCH")" == "$head" ]] && main_at_head=1
  if [[ $push -eq 1 ]]; then
    if git remote get-url "$REMOTE" >/dev/null 2>&1; then remote=ok; else remote=missing; fi
  fi

  # 판단 (순수)
  local state checks steps
  state="$(release_state "$cur" "$ver" "$tag_at_head" "$main_at_head")"
  checks="$(release_checks "$mod" "$ver" "$dir" "$mods" "$branch" "$dirty" "$cur" "$notes" "$mainst" "$tagx" "$state" "$remote")"
  steps="$(release_steps "$state" "$push")"

  echo "RELEASE: $mod ${cur:-none} -> $ver (tag $tag)"
  echo "$checks"
  if checks_failed "$checks"; then echo "RESULT: failed check"; return 1; fi
  if [[ "$mode" == --dry-run ]]; then
    [[ -n "$steps" ]] && awk 'NF { print "STEP: " $0 " planned" }' <<<"$steps"
    echo "RESULT: preview"
    echo "NEXT: 미리 보기 — 아무것도 바꾸지 않았습니다. 낼 때: scripts/release.sh $mod $ver --push"
    return 0
  fi
  if [[ -z "$steps" ]]; then
    echo "RESULT: released $mod $ver"
    echo "NEXT: 이미 로컬에 냈습니다 — 올릴 때: scripts/release.sh $mod $ver --push"
    return 0
  fi
  run_steps "$mod" "$ver" "$dir" "$tag" "$head" "$steps"
}

# source 될 때는(시험) 함수만 싣는다.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; exit $?; fi
