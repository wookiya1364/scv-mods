---
title: scv-mods 릴리스 관리 — 버전 · 노트 · 태그 · 두 갈래
slug: 20261023-wookiya1364-scv-mods-release
author: wookiya1364
created_at: 2026-10-23
status: testing
kind: feature
lang: korean
tags: [release, mods]
raw_sources:
  - scv/conversations/20261022-102049-read-shared-claude-link.md
refs: []
invariants:
  - "SCV 칸(scv-dashboard, 옛 이름 scv-hello)의 동작은 그대로 — 모드 기능을 바꾸지 않는다"
  - "지금 있는 시험 72개가 계속 통과한다"
  - "버전은 릴리스 스크립트로만 바뀐다 — 보통 커밋에서는 바꾸지 않는다"
  - "main 은 앞당기기(fast-forward)로만 움직인다 — 강제 push 없음"
  - "저장소는 비공개 — 올리기 전 비밀 값 검사"
  - "gh 설치·로그인을 대신하지 않는다"
  - "모드는 프로젝트 파일을 바꾸지 않는다"
---

# scv-mods 릴리스 관리 — 버전 · 노트 · 태그 · 두 갈래

## Summary

지금 모드 버전은 커밋 번호(`84ae8d4b5ca9`)로만 보여서, 어느 것이 무엇인지 헷갈린다(확인함: `/scv:mods` 목록). SCV처럼 모드마다 버전 번호를 적고, 버전마다 노트를 두고, 공식 태그를 붙이고, 이 일을 릴리스 스크립트 하나로 한 번에 한다. 일은 develop 에 쌓고 main 은 릴리스 때만 앞당긴다. 태그를 올리면 GitHub 릴리스 페이지가 노트로 자동 생긴다. 첫 릴리스 전에 모드 이름을 scv-hello 에서 scv-dashboard 로 바꾸고(사용자 결정), 지금 구현된 그대로 scv-dashboard 0.1.0 을 낸다.

## Goals / Non-Goals

- **Goals**
  - 모드 설정 파일(plugin.json)에 버전을 적는다. 마켓 목록(marketplace.json)에는 적지 않는다 — 공식 문서가 두 곳에 적지 말라고 하고, 설정 파일 쪽이 이긴다(확인함).
  - 버전마다 노트를 둔다: `docs/releases/<mod>/<version>.md` — 쉬운 말로 무엇이 들었는지.
  - 태그는 Claude Code 공식 형식 `<mod>--v<version>` 을 `claude plugin tag` 로 만든다(임시 복사본에서 `scv-hello--v0.1.0` 형식 확인함 — 이름을 바꾼 뒤에는 `scv-dashboard--v0.1.0`).
  - 이름 바꾸기 scv-hello → scv-dashboard (첫 릴리스 전, 사용자 결정)
    - 모드 폴더 · 설정 파일 · 코드 · 시험 · 문서의 이름, 명령 `/scv-dashboard`, 단계 신호 도구 `mcp__scv-dashboard__scv_step`.
    - 마켓 목록에서 scv-hello 를 빼고 옛 이름 → 새 이름 표(`renames`)를 남긴다 — 옛 설치가 '못 찾음' 오류를 내지 않게.
    - 다른 계획 7개의 시험 명령은 경로 한 줄씩만 고친다. 보관된 3개도 사용자가 고른 예외로 경로만 고치고, 시험 내용과 다른 기록은 그대로 둔다.
    - 이 세션의 개발용 사본도 새 이름으로 맞춘다(안 하면 칸이 둘).
  - 릴리스 스크립트 `scripts/release.sh <mod> <version> [--dry-run | --push]`
    - 확인을 먼저 모두 하고 틀린 것을 한꺼번에 보인다: 모드가 있는지, develop 갈래인지, 커밋 안 한 변경이 없는지, 번호 형식(x.y.z, x.y.z-rc.1)과 지금보다 큰지, 노트가 있고 비어 있지 않은지, main 이 develop 안에 있는지(앞당길 수 있는지), 태그가 아직 없는지.
    - 그다음 차례로: 모드 시험 → 버전 적기 → 검사(validate) → 커밋 `release: <mod> <version>` → 태그 → main 앞당기기 → (`--push` 일 때만) develop · main · 태그를 한 번에(atomic) 올리기.
    - 중간에 틀리면 이번에 바꾼 것을 되돌리고 멈춘다 — 올리기 전 단계는 모두 되돌릴 수 있다.
    - 올리기만 실패하면 로컬 릴리스는 남고, 같은 명령에 `--push` 를 다시 주면 올리기만 한다.
    - `--dry-run` 은 확인과 할 일만 보이고 아무것도 바꾸지 않는다.
  - 두 갈래: develop 에서 일하고, main 은 릴리스 때만 develop 으로 앞당긴다. 마켓은 main 을 읽으니, 같은 번호면 늘 같은 파일이다.
  - GitHub 자동 작업: `*--v*` 태그가 올라오면 그 노트로 릴리스 페이지를 만든다. 이 컴퓨터에 gh 가 없어도 된다(GitHub 실행기에 있다). 번호에 `-` 가 있으면 미리 보기 릴리스(prerelease)로 만든다.
  - README 에 버전 · 업데이트 · 릴리스 안내를, `docs/RELEASING.md` 에 릴리스 하는 법을 둔다.
  - 첫 릴리스 scv-dashboard 0.1.0 을 내고, 이 맥에서 옛 scv-hello 를 지우고 새로 설치해 `/scv:mods` 목록으로 확인한다.
- **Non-Goals**
  - SCV 플러그인 수정(`/scv:mods` 는 그대로 쓴다)
  - 모드 기능 변경
  - stage 갈래 · 보호 규칙(rulesets) · PR 강제 · 자동 승격
  - 마켓 목록에 버전 적기
  - 앱 확인 전에 계획 4개 보관

## Approach Overview

- 스크립트는 SCV 의 `mods.sh` 처럼 순수 단계를 가운데, 부수효과를 양 끝에 둔다. `source` 하면 함수만 실려 시험이 함수를 바로 부른다.
- 사실 읽기(모드 폴더 · 갈래 · 작업 트리 · 지금 버전 · 노트 · main 위치 · 태그)를 먼저 하고, 순수 함수가 그 사실로 확인 줄과 할 일 목록을 만든다. 실행은 목록대로 한다.
- main 앞당기기는 `git fetch . develop:main` 이다 — 앞당기기가 아니면 git 이 거절한다.
- 올리기는 `git push --atomic` 한 번이다 — 셋 중 하나라도 거절되면 아무것도 올라가지 않는다.
- 자동 작업은 같은 스크립트의 `tag-info` 로 태그에서 노트 경로와 제목을 얻는다 — 규칙이 한 곳에 있다.
- 시험은 가짜 원격(bare 저장소)과 작은 가짜 마켓을 임시 폴더에 만들어, 실제 git 과 실제 `claude plugin tag` · `validate` 로 돌린다. 모드 시험(`plugin test`)만 가짜로 바꾼다.

## 순수함수 · 파이프라인 (Pure functions & pipeline)

```
flow(
  read_facts,       // (모드, 번호) → 사실: 모드 폴더 · 갈래 · 작업 트리 · 지금 버전 · 노트 · main · 태그
  release_state,    // (사실, 번호) → new | released
  release_checks,   // (사실, 번호) → CHECK 줄들 (틀린 것 모두)
  release_steps,    // (상태, push 여부) → 할 일 목록
  run_steps,        // (할 일 목록) → STEP 줄 · 되돌리기 · RESULT · NEXT
)
tag_info            // (태그) → 모드 · 번호 · 노트 경로 · 제목 · 미리 보기 여부
```

| # | 단계 | 하는 일 | 받는 값 → 돌려주는 값 | 순수/부수효과 |
|---|---|---|---|---|
| 1 | read_facts | 마켓 목록 · git · 설정 파일 · 노트를 읽는다 | 모드, 번호 → 사실 | 부수효과 (입구) |
| 2 | release_state | 이미 로컬에 낸 릴리스인지(올리기만 남음) 가린다 | 사실, 번호 → new / released | 순수 |
| 3 | release_checks | 규칙마다 ok / fail 과 이유를 낸다 | 사실, 번호 → CHECK 줄 | 순수 |
| 4 | release_steps | 상태와 --push 로 할 일 목록을 만든다 | 상태, push → 단계 이름들 | 순수 |
| 5 | run_steps | 시험 · 버전 적기 · 검사 · 커밋 · 태그 · 앞당기기 · 올리기를 하고, 틀리면 되돌린다 | 할 일 → 결과 줄 | 부수효과 (출구) |
| 6 | tag_info | 태그 이름에서 모드 · 번호 · 노트 경로 · 제목을 뽑는다 | 태그 → 줄들 / 거절 | 순수 |

- 부수효과 위치: 입구(마켓 목록 · git · 파일 읽기), 출구(파일 쓰기 · git commit/tag/fetch/push · claude plugin test/validate/tag)
- 재사용: SCV `mods.sh` 의 줄 형식(STEP · RESULT · NEXT)과 `SCV_CLAUDE_BIN` 시험 방식, Claude Code 의 `claude plugin tag`

## Guardrails

- 버전은 이 스크립트만 바꾼다. 보통 커밋에서는 설정 파일의 버전을 손대지 않는다.
- main 은 앞당기기로만 움직이고, 강제 push 는 하지 않는다.
- 올리기는 `--push` 를 줄 때만 한다 — 사람이 미리 보기를 본 뒤 고른다.
- 저장소는 비공개로 두고, 올리기 전에 비밀 값을 검사하고, gh 설치·로그인은 대신하지 않는다.
- 모드 코드와 지금 시험 72개는 그대로 둔다.

## Exit criteria

- All TESTS.md scenarios pass
- 원격(origin)에 `scv-dashboard--v0.1.0` 태그가 있고, develop · main 이 같은 커밋이다.
- 이 맥에서 `/scv:mods` 목록이 `scv-dashboard installed 0.1.0` 이고 scv-hello 는 없다(이름을 바꿔 '84ae8d4b5ca9 → 0.1.0' 대신 지우고 새로 설치).
- GitHub 저장소의 Releases 에 'scv-dashboard 0.1.0' 페이지가 노트와 함께 생긴다 — 사용자가 웹에서 확인한다(이 컴퓨터에서 gh 를 쓰지 않음).

## Suggested path

1. [x] 릴리스 순수 함수 + 시험 — `release_state` `release_checks` `release_steps` `tag_info`
2. [x] 릴리스 스크립트와 미리 보기 · 되돌리기 — `read_facts` `run_steps`
3. [x] GitHub 릴리스 페이지 자동 작업 · 0.1.0 노트 · README · 릴리스 안내 — `tag_info`
4. [~] develop 갈래로 옮기고, 이름을 scv-dashboard 로 바꾸고, 0.1.0 미리 보기 → (확인 뒤) 올리기 — `run_steps`
5. [ ] 이 맥에서 /scv:mods 로 0.1.0 확인 · 메모리 갱신

## Related Documents

- SCV 의 릴리스 안내: SCV 저장소(wookiya1364/scv-claude-code)의 릴리스 문서와 갈래 문서 (이 계획이 따라 한 것)
- Claude Code 공식 문서: plugins/loading (Versions and updates), plugins/host-marketplace (Release a new version)

## Risks / Open Questions

- GitHub 자동 작업은 첫 태그를 올리기 전까지 돌려 볼 수 없다. 실패해도 태그와 노트는 남고, Actions 에서 다시 돌리면 된다.
- 비공개 저장소의 GitHub Actions 는 계정의 무료 시간 안에서 돈다(추정: 한 번에 1분 안쪽).
- 리눅스에서 `/scv:mods` 를 쓰려면 SCV 0.70.0 이 먼저 있어야 한다(확인함: 0.69.1 에는 없다).
- 0.1.0 의 모드 파일은 지금 설치된 `84ae8d4b5ca9` 에서 이름(38곳)과 버전 한 줄만 다르다 — 기능은 그대로이고, 그 사이 다른 커밋은 기록 파일만 바꿨다(확인함).
- 이름을 바꾸면 이름별로 두던 모드 기억(지난 시험 결과 · 단계 신호)이 새 이름에서 처음부터 다시 쌓인다(확인함: 기억 파일 이름에 모드 이름이 들어 있음). 끝난 단계는 계획서의 ✓ 표시가 대신 보인다.
- 데스크톱 앱이 칸 자리를 칸 이름(id)으로 기억한다면, 새 이름의 칸은 처음 한 번 자리를 다시 잡는다(추정).
- 앞으로 리눅스에서 새 기능을 확인하려면 릴리스가 필요하다. main 에 올리는 것만으로는 이미 설치한 컴퓨터에 가지 않는다(공식 문서로 확인함).

## Links

- Raw originals: (listed in frontmatter)
- Related PRs:
