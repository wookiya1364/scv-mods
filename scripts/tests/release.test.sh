#!/usr/bin/env bash
# release.test.sh — scripts/release.sh 검사.
#
# 순수 함수(번호 · 확인 · 상태 · 단계 · 태그 정보)는 source 해서 바로 부른다. 미리 보기 · 릴리스 · 올리기 · 되돌리기는
# 임시 폴더에 작은 가짜 마켓과 가짜 원격(bare 저장소)을 만들어 실제 git 과 실제 `claude plugin tag` · `validate` 로 돌린다.
# 모드 시험(plugin test)만 가짜다. 이 저장소의 버전 기록(설정 파일 한 곳 · 그 번호의 노트)과 릴리스 페이지 자동 작업도 본다.
# Run: bash scripts/tests/release.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
R="$ROOT/scripts/release.sh"
PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✖ FAIL: $1"; FAIL=$((FAIL + 1)); }
[[ -f "$R" ]] || { echo "✖ 없음: $R"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq 없음 — 이 검사는 jq 가 필요하다" >&2; exit 1; }
REAL_CLAUDE="$(command -v claude)" || { echo "claude 없음 — 이 검사는 claude 가 필요하다" >&2; exit 1; }
W="$(mktemp -d "${TMPDIR:-/tmp}/scv-release-test.XXXXXX")"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"

# shellcheck source=../release.sh
source "$R"

# 가짜 claude — plugin test 는 가짜(FAKE_TEST_EXIT, 기본 0), validate · tag 는 FAKE_VALIDATE_EXIT · FAKE_TAG_EXIT 가
# 있을 때만 가짜, 나머지는 진짜 claude 로 넘긴다.
cat > "$W/bin/claude" <<'FC'
#!/usr/bin/env bash
case "$1 $2" in
  "plugin test") echo " 1 pass"; echo " 0 fail"; exit "${FAKE_TEST_EXIT:-0}" ;;
  "plugin validate") [[ -n "${FAKE_VALIDATE_EXIT:-}" ]] && { echo "✘ Validation failed (fake)"; exit "$FAKE_VALIDATE_EXIT"; } ;;
  "plugin tag") [[ -n "${FAKE_TAG_EXIT:-}" ]] && { echo "✘ tag failed (fake)"; exit "$FAKE_TAG_EXIT"; } ;;
esac
exec "$REAL_CLAUDE" "$@"
FC
chmod +x "$W/bin/claude"

# fixture <name> → 작업 저장소 경로: develop 갈래, 노트 커밋됨, main · develop 이 가짜 원격에 있음
fixture() {
  local d="$W/$1"
  rm -rf "$d"; mkdir -p "$d"
  git init -q --bare "$d/origin.git"
  git init -q -b main "$d/work"
  (
    cd "$d/work" || exit 1
    git config user.name t; git config user.email t@example.invalid
    git config commit.gpgsign false; git config tag.gpgsign false
    mkdir -p .claude-plugin marketplace/mods/demo/.claude-plugin docs/releases/demo
    printf '%s\n' '{' '  "name": "demo-mods",' '  "owner": { "name": "t" },' '  "plugins": [' \
      '    { "name": "demo", "source": "./marketplace/mods/demo" }' '  ]' '}' > .claude-plugin/marketplace.json
    printf '%s\n' '{' '  "name": "demo",' '  "description": "demo mod"' '}' > marketplace/mods/demo/.claude-plugin/plugin.json
    git add -A; git commit -q -m init
    git remote add origin "$d/origin.git"; git push -q origin main
    git switch -q -c develop
    echo "- 첫 릴리스" > docs/releases/demo/0.1.0.md
    git add -A; git commit -q -m notes
    git push -q origin develop
  ) >/dev/null 2>&1
  echo "$d/work"
}

# run <작업 저장소> <release.sh 인자…>
run() {
  local d=$1; shift
  (cd "$d" && REAL_CLAUDE="$REAL_CLAUDE" SCV_CLAUDE_BIN="$W/bin/claude" FAKE_TEST_EXIT="${FAKE_TEST_EXIT:-0}" \
    FAKE_VALIDATE_EXIT="${FAKE_VALIDATE_EXIT:-}" FAKE_TAG_EXIT="${FAKE_TAG_EXIT:-}" \
    SCV_RELEASE_TRAILERS="${SCV_RELEASE_TRAILERS:-}" bash "$R" "$@" 2>&1)
}
has()  { grep -qF -- "$2" <<<"$1"; }
pj_version() { jq -r '.version // "none"' "$1/marketplace/mods/demo/.claude-plugin/plugin.json"; }
untouched() { # <작업 저장소> <처음 HEAD> → 작업 트리 깨끗 · HEAD 그대로 · 태그 없음 · 버전 없음
  [[ -z "$(git -C "$1" status --porcelain)" && "$(git -C "$1" rev-parse HEAD)" == "$2" \
    && -z "$(git -C "$1" tag -l)" && "$(pj_version "$1")" == none ]]
}

echo "── [T1] 번호 형식 ──"
for v in 0.1.0 1.2.3 1.0.0-rc.1; do
  o="$(release_checks demo "$v" d demo develop 0 "" ok ok 0 new na)"
  has "$o" "CHECK: version ok" && ok "통과: $v" || fail "통과해야 함: $v → $o"
done
for v in 0.1 v0.1.0 01.0.0 0.1.0- ""; do
  o="$(release_checks demo "$v" d demo develop 0 "" ok ok 0 new na)"
  has "$o" "CHECK: version fail 번호 형식은 0.1.0 처럼 x.y.z 입니다" && ok "거절: '$v'" || fail "거절해야 함: '$v' → $o"
done

echo "── [T2] 지금 버전보다 커야 한다 ──"
for p in "|0.1.0|ok" "0.1.0|0.1.1|ok" "0.9.0|0.10.0|ok" "1.0.0-rc.1|1.0.0|ok" "0.1.0|0.1.0|fail" "0.1.0|0.0.9|fail" "1.0.0|1.0.0-rc.1|fail"; do
  IFS='|' read -r cur new want <<<"$p"
  o="$(release_checks demo "$new" d demo develop 0 "$cur" ok ok 0 new na | grep '^CHECK: version')"
  if [[ "$want" == ok ]]; then
    [[ "$o" == "CHECK: version ok" ]] && ok "${cur:-없음} → $new 통과" || fail "${cur:-없음} → $new 통과해야 함: $o"
  else
    [[ "$o" == "CHECK: version fail $new 은 지금 버전 $cur 보다 커야 합니다" ]] && ok "$cur → $new 거절" || fail "$cur → $new 거절해야 함: $o"
  fi
done
order=(1.0.0-alpha 1.0.0-alpha.1 1.0.0-alpha.beta 1.0.0-beta 1.0.0-beta.2 1.0.0-beta.11 1.0.0-rc.1 1.0.0 1.0.1 1.1.0 2.0.0)
okc=1
for ((i = 0; i + 1 < ${#order[@]}; i++)); do
  [[ "$(version_cmp "${order[i]}" "${order[i+1]}")" == -1 && "$(version_cmp "${order[i+1]}" "${order[i]}")" == 1 ]] || { okc=0; fail "순서: ${order[i]} < ${order[i+1]}"; }
done
[[ "$(version_cmp 0.1.0 0.1.0)" == 0 ]] || { okc=0; fail "같은 번호는 0"; }
[[ $okc -eq 1 ]] && ok "semver 순서 ${#order[@]}개 (미리 보기는 같은 번호보다 앞, 숫자는 수로 비교)"

echo "── [T3] 확인은 틀린 것을 한꺼번에 보인다 ──"
o="$(release_checks demo 0.1.0 marketplace/mods/demo demo main 1 "" missing diverged 1 new na)"
for line in "CHECK: branch fail develop 갈래에서만 릴리스합니다 (지금: main)" \
            "CHECK: clean fail 커밋하지 않은 변경이 있습니다" \
            "CHECK: notes fail 노트가 없습니다: docs/releases/demo/0.1.0.md" \
            "CHECK: main fail main 에 develop 에 없는 커밋이 있어 앞당길 수 없습니다" \
            "CHECK: tag fail 태그가 이미 있습니다: demo--v0.1.0"; do
  has "$o" "$line" && ok "${line#CHECK: }" || fail "없음: $line"
done
[[ "$(grep -c ' fail ' <<<"$o")" == 5 ]] && ok "fail 줄 5개 — 첫 실패에서 멈추지 않음" || fail "fail 줄 수: $(grep -c ' fail ' <<<"$o")"
o="$(release_checks nope 0.1.0 "" "demo, scv-dashboard" develop 0 "" empty ok 0 new missing)"
has "$o" "CHECK: mod fail 그런 모드가 없습니다: nope — 있는 모드: demo, scv-dashboard" && ok "없는 모드는 있는 모드를 알려 줌" || fail "모드 줄: $o"
has "$o" "CHECK: notes fail 노트가 비어 있습니다: docs/releases/nope/0.1.0.md" && ok "빈 노트 거절" || fail "빈 노트 줄: $o"
has "$o" "CHECK: remote fail 원격이 없습니다: origin" && ok "올릴 원격이 없으면 거절" || fail "원격 줄: $o"
o="$(release_checks demo 0.1.0 marketplace/mods/demo demo develop 0 "" ok ok 0 new ok)"
checks_failed "$o" && fail "모두 맞는데 fail 이 있음: $o" || ok "사실이 모두 맞으면 fail 0"
[[ "$(release_state 0.1.0 0.1.0 1 1)" == released && "$(release_state 0.1.0 0.1.0 0 1)" == new && "$(release_state "" 0.1.0 0 0)" == new ]] \
  && ok "이미 낸 릴리스(버전 · 태그 · main 이 HEAD)만 released" || fail "release_state"
[[ "$(release_steps new 0 | tr '\n' ' ')" == "test write-version validate commit tag advance-main " \
  && "$(release_steps new 1 | tail -n 1)" == push && "$(release_steps released 1)" == push && -z "$(release_steps released 0)" ]] \
  && ok "할 일 차례: 시험 → 버전 적기 → 검사 → 커밋 → 태그 → main 앞당기기 (→ 올리기)" || fail "release_steps"

echo "── [T4] 미리 보기는 아무것도 바꾸지 않는다 ──"
d="$(fixture t4)"; h="$(git -C "$d" rev-parse HEAD)"
o="$(run "$d" demo 0.1.0 --dry-run)"
has "$o" "RESULT: preview" && ok "RESULT: preview" || fail "미리 보기 결과: $o"
checks_failed "$o" && fail "fail 이 있음: $o" || ok "CHECK 모두 ok"
[[ "$(grep -c ' planned$' <<<"$o")" == 6 ]] && ok "할 일 6개를 planned 로 보임" || fail "planned 줄: $o"
untouched "$d" "$h" && ok "작업 트리 · HEAD · 태그 · 설정 파일 그대로" || fail "미리 보기가 무언가를 바꿈"

echo "── [T5] 릴리스는 버전 적기부터 main 앞당기기까지 한 번에 ──"
d5="$(fixture t5)"; h="$(git -C "$d5" rev-parse HEAD)"; remote_main="$(git --git-dir "$W/t5/origin.git" rev-parse main)"
o="$(SCV_RELEASE_TRAILERS='Co-Authored-By: t <t@example.invalid>' run "$d5" demo 0.1.0)"
has "$o" "RESULT: released demo 0.1.0" && ok "RESULT: released demo 0.1.0" || fail "릴리스 결과: $o"
[[ "$(pj_version "$d5")" == 0.1.0 ]] && ok "설정 파일 version 0.1.0" || fail "설정 파일 version: $(pj_version "$d5")"
[[ "$(jq -r 'keys_unsorted | .[0:2] | join(",")' "$d5/marketplace/mods/demo/.claude-plugin/plugin.json")" == "name,version" ]] \
  && ok "version 은 name 바로 뒤" || fail "키 순서"
[[ "$(jq '[.plugins[] | has("version")] | any' "$d5/.claude-plugin/marketplace.json")" == false ]] && ok "마켓 목록에는 version 없음" || fail "마켓 목록에 version 이 생김"
[[ "$(git -C "$d5" log -1 --format=%s)" == "release: demo 0.1.0" ]] && ok "커밋 'release: demo 0.1.0'" || fail "커밋 제목: $(git -C "$d5" log -1 --format=%s)"
[[ "$(git -C "$d5" show --name-only --format= HEAD)" == "marketplace/mods/demo/.claude-plugin/plugin.json" ]] && ok "커밋은 설정 파일 하나만 바꿈" || fail "커밋 파일: $(git -C "$d5" show --name-only --format= HEAD)"
[[ "$(git -C "$d5" rev-parse HEAD~1)" == "$h" ]] && ok "커밋 하나만 늘어남" || fail "HEAD~1 이 처음 HEAD 가 아님"
[[ "$(git -C "$d5" cat-file -t demo--v0.1.0 2>/dev/null)" == tag && "$(git -C "$d5" rev-parse 'demo--v0.1.0^{commit}')" == "$(git -C "$d5" rev-parse HEAD)" ]] \
  && ok "주석 태그 demo--v0.1.0 이 HEAD" || fail "태그"
[[ "$(git -C "$d5" tag -l --format='%(contents:subject)' demo--v0.1.0)" == "demo 0.1.0" ]] && ok "태그 메시지 'demo 0.1.0'" || fail "태그 메시지: $(git -C "$d5" tag -l --format='%(contents:subject)' demo--v0.1.0)"
[[ "$(git -C "$d5" rev-parse main)" == "$(git -C "$d5" rev-parse HEAD)" ]] && ok "main 이 develop 으로 앞당겨짐" || fail "main 이 HEAD 가 아님"
[[ "$(git --git-dir "$W/t5/origin.git" rev-parse main)" == "$remote_main" && -z "$(git --git-dir "$W/t5/origin.git" tag -l)" ]] \
  && ok "원격은 그대로 (올리지 않음)" || fail "원격이 바뀜"
has "$o" "NEXT: 로컬에만 냈습니다 — 올릴 때: scripts/release.sh demo 0.1.0 --push" && ok "NEXT 에 --push 줄" || fail "NEXT: $o"
[[ -z "$(git -C "$d5" status --porcelain)" ]] && ok "작업 트리 깨끗" || fail "작업 트리: $(git -C "$d5" status --porcelain)"
[[ "$(git -C "$d5" log -1 --format=%b | sed '/^$/d')" == "Co-Authored-By: t <t@example.invalid>" ]] && ok "커밋 끝에 덧붙일 줄(SCV_RELEASE_TRAILERS)" || fail "커밋 본문: $(git -C "$d5" log -1 --format=%b)"
o="$(run "$d5" demo 0.1.0 --dry-run)"
has "$o" "CHECK: version ok (이미 로컬에 낸 0.1.0 — 올리기만 남음)" && ok "다시 부르면 '이미 낸 릴리스'로 봄" || fail "다시 부름: $o"

echo "── [T6] --push 는 develop · main · 태그를 한 번에, 다시 하면 올리기만 ──"
d="$(fixture t6)"
o="$(run "$d" demo 0.1.0 --push)"
has "$o" "RESULT: pushed demo 0.1.0" && ok "RESULT: pushed demo 0.1.0" || fail "올리기 결과: $o"
g="$W/t6/origin.git"; hd="$(git -C "$d" rev-parse HEAD)"
[[ "$(git --git-dir "$g" rev-parse develop)" == "$hd" && "$(git --git-dir "$g" rev-parse main)" == "$hd" \
  && "$(git --git-dir "$g" rev-parse 'demo--v0.1.0^{commit}')" == "$hd" ]] && ok "원격 develop · main · 태그가 같은 커밋" || fail "원격 refs"
n="$(git -C "$d" rev-list --count HEAD)"
o="$(run "$d" demo 0.1.0 --push)"
[[ "$(grep -c '^STEP: ' <<<"$o")" == 1 ]] && has "$o" "STEP: push ok" && ok "다시 하면 올리기만 (단계 1개)" || fail "다시 올리기: $o"
[[ "$(git -C "$d" rev-list --count HEAD)" == "$n" && "$(git -C "$d" tag -l | wc -l | tr -d ' ')" == 1 ]] && ok "새 커밋 · 새 태그 없음" || fail "커밋이나 태그가 늘어남"
o="$(run "$d5" demo 0.1.0 --push)"
[[ "$(grep -c '^STEP: ' <<<"$o")" == 1 ]] && has "$o" "RESULT: pushed demo 0.1.0" && ok "로컬에만 낸 릴리스는 --push 로 올리기만" || fail "T5 상태에서 올리기: $o"
[[ "$(git --git-dir "$W/t5/origin.git" rev-parse 'demo--v0.1.0^{commit}')" == "$(git -C "$d5" rev-parse HEAD)" ]] && ok "T5 원격에 태그" || fail "T5 원격 태그"

echo "── [T7] 시험 · 검사 · 태그 · 앞당기기가 틀리면 아무것도 남기지 않는다 ──"
d="$(fixture t7a)"; h="$(git -C "$d" rev-parse HEAD)"
o="$(FAKE_TEST_EXIT=1 run "$d" demo 0.1.0)"
has "$o" "STEP: test fail" && has "$o" "RESULT: failed test" && ok "시험 실패 → 멈춤" || fail "시험 실패: $o"
has "$o" "STEP: write-version" && fail "시험 실패 뒤에 버전을 적음" || ok "버전 적기 전에 멈춤"
untouched "$d" "$h" && ok "그대로 (시험 실패)" || fail "시험 실패 뒤 무언가 남음"
d="$(fixture t7b)"; h="$(git -C "$d" rev-parse HEAD)"
o="$(FAKE_VALIDATE_EXIT=1 run "$d" demo 0.1.0)"
has "$o" "STEP: write-version ok" && has "$o" "STEP: validate fail" && has "$o" "RESULT: failed validate" && ok "검사 실패 → 멈춤" || fail "검사 실패: $o"
untouched "$d" "$h" && ok "적은 버전을 되돌림" || fail "검사 실패 뒤 무언가 남음"
d="$(fixture t7c)"; h="$(git -C "$d" rev-parse HEAD)"
o="$(FAKE_TAG_EXIT=1 run "$d" demo 0.1.0)"
has "$o" "STEP: commit ok" && has "$o" "STEP: tag fail" && ok "태그 실패 → 멈춤" || fail "태그 실패: $o"
untouched "$d" "$h" && [[ "$(git -C "$d" rev-parse main)" == "$(git -C "$d" rev-parse HEAD~1)" ]] && ok "커밋을 되돌리고 main 그대로" || fail "태그 실패 뒤 무언가 남음"
d="$(fixture t7d)"; h="$(git -C "$d" rev-parse HEAD)"; m="$(git -C "$d" rev-parse main)"
git -C "$d" worktree add -q "$W/t7d/main-wt" main >/dev/null 2>&1   # 다른 곳에서 main 을 열어 두면 앞당기기를 git 이 거절한다
o="$(run "$d" demo 0.1.0)"
has "$o" "STEP: tag ok" && has "$o" "STEP: advance-main fail" && ok "앞당기기 실패 → 멈춤" || fail "앞당기기 실패: $o"
untouched "$d" "$h" && [[ "$(git -C "$d" rev-parse main)" == "$m" ]] && ok "태그 · 커밋을 되돌리고 main 그대로" || fail "앞당기기 실패 뒤 무언가 남음"
git -C "$d" worktree remove --force "$W/t7d/main-wt" >/dev/null 2>&1

echo "── [T8] 태그에서 모드 · 번호 · 노트를 뽑는다 ──"
o="$(tag_info scv-dashboard--v0.1.0)"
[[ "$o" == $'MOD: scv-dashboard\nVERSION: 0.1.0\nNOTES: docs/releases/scv-dashboard/0.1.0.md\nTITLE: scv-dashboard 0.1.0\nPRERELEASE: no' ]] && ok "scv-dashboard--v0.1.0" || fail "tag_info: $o"
has "$(tag_info scv-dashboard--v1.0.0-rc.1)" "PRERELEASE: yes" && ok "rc 는 미리 보기 릴리스" || fail "rc"
for t in v0.1.0 scv-dashboard--v0.1 scv-dashboard-0.1.0; do
  tag_info "$t" >/dev/null && fail "거절해야 함: $t" || ok "거절: $t"
done
o="$(run "$d5" tag-info demo--v0.1.0)"; rc=$?
[[ $rc -eq 0 ]] && has "$o" "NOTES: docs/releases/demo/0.1.0.md" && ok "노트가 있으면 줄을 냄 (exit 0)" || fail "tag-info: $o"
run "$d5" tag-info demo--v9.9.9 >/dev/null && fail "노트가 없는데 통과" || ok "노트가 없으면 거절 (exit 1)"

echo "── [T9] 릴리스 페이지 자동 작업 ──"
WF="$ROOT/.github/workflows/release.yml"
if [[ -f "$WF" ]]; then
  grep -qF "tags: ['*--v*']" "$WF" && ok "*--v* 태그 push 에 돈다" || fail "태그 조건"
  grep -qE '^\s*contents: write' "$WF" && ok "contents: write" || fail "권한"
  grep -qF 'bash scripts/release.sh tag-info "$TAG"' "$WF" && ok "노트를 release.sh tag-info 로 얻는다" || fail "tag-info 호출"
  grep -qF 'gh release create "$TAG" --verify-tag' "$WF" && grep -qF -- '--notes-file "$notes"' "$WF" && ok "gh release create --verify-tag --notes-file" || fail "release create"
  grep -qE '^\s*workflow_dispatch:' "$WF" && grep -qF 'TAG: ${{ inputs.tag || github.ref_name }}' "$WF" && grep -qF 'ref: ${{ inputs.tag || github.ref }}' "$WF" \
    && ok "손으로 돌리기(workflow_dispatch): 넣은 태그를 꺼내 그 노트로" || fail "workflow_dispatch"
  grep -qF 'gh release edit "$TAG"' "$WF" && ok "페이지가 이미 있으면 고침 (둘로 만들지 않음)" || fail "release edit"
else fail "없음: .github/workflows/release.yml"; fi

echo "── [T10] 이 저장소의 버전 기록 ──"
MK="$ROOT/.claude-plugin/marketplace.json"
while IFS=$'\t' read -r name src; do
  pjf="$ROOT/${src#./}/.claude-plugin/plugin.json"
  [[ "$(jq -r '.name' "$pjf")" == "$name" ]] && ok "$name: 설정 파일 이름이 마켓 목록과 같음" || fail "$name: 설정 파일 이름이 다름 ($(jq -r '.name' "$pjf"))"
  v="$(jq -r '.version // empty' "$pjf")"
  if [[ -z "$v" ]]; then ok "$name: 아직 릴리스 전 (version 없음)"
  elif [[ -s "$ROOT/docs/releases/$name/$v.md" ]]; then ok "$name $v: 노트 있음"
  else fail "$name $v: 노트가 없음 — docs/releases/$name/$v.md"; fi
  (cd "$ROOT" && "$REAL_CLAUDE" plugin validate "${src#./}" >/dev/null 2>&1) && ok "validate: $name" || fail "validate: $name"
done < <(jq -r '.plugins[] | [.name, .source] | @tsv' "$MK")
[[ "$(jq '[.plugins[] | has("version")] | any' "$MK")" == false ]] && ok "마켓 목록 항목에 version 없음 (한 곳만)" || fail "마켓 목록에 version 이 있음"
[[ "$(jq -r '(.renames // {}) | to_entries | map(select(.value != null)) | map(.value) | .[]' "$MK" | sort -u \
  | comm -23 - <(jq -r '.plugins[].name' "$MK" | sort -u))" == "" ]] && ok "바꾼 이름 표(renames)는 있는 모드를 가리킴" || fail "renames 가 없는 모드를 가리킴"
(cd "$ROOT" && "$REAL_CLAUDE" plugin validate . >/dev/null 2>&1) && ok "validate: 마켓" || fail "validate: 마켓"

echo "── [T13] 옛 이름은 정해진 곳에만 남는다 ──"
old="scv-""hello"   # 이 파일이 스스로 걸리지 않게 나눠 쓴다
hits="$(cd "$ROOT" && git ls-files -z --cached --others --exclude-standard -- marketplace scripts docs .github .claude-plugin README.md \
  | xargs -0 grep -l -- "$old" 2>/dev/null | sort)"
want="$(printf '%s\n' .claude-plugin/marketplace.json README.md docs/releases/scv-dashboard/0.1.0.md | sort)"
[[ "$hits" == "$want" ]] && ok "바꾼 이름 표 · README · 0.1.0 노트의 옮기는 법에만" || fail "옛 이름이 남은 곳: $(tr '\n' ' ' <<<"$hits")"

echo
echo "PASS $PASS · FAIL $FAIL"
[[ $FAIL -eq 0 ]]
