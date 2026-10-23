# Test Plan — scv-mods 릴리스 관리 — 버전 · 노트 · 태그 · 두 갈래

## Overview

다음을 검증한다.

- 모드마다 버전 번호가 한 곳(설정 파일)에 있고, 그 번호의 노트가 있다.
- 릴리스 스크립트가 확인을 먼저 모두 하고, 버전 적기 · 커밋 · 태그 · main 앞당기기를 한 번에 하며, 틀리면 되돌린다.
- 올리기는 `--push` 일 때만, develop · main · 태그를 한 번에 올린다.
- 태그를 올리면 GitHub 릴리스 페이지를 만드는 자동 작업이 있다.
- 모드 기능과 지금 시험 72개는 그대로다.
- 모드 이름이 scv-dashboard 로 바뀌고, 옛 이름 scv-hello 는 옮기는 법을 적은 곳에만 남는다.
- 이 맥에서 옛 scv-hello 를 지우고 scv-dashboard 0.1.0 을 받는다(끝 기준).

## Test scenarios

### T1. 번호 형식을 가린다

- **Setup**: 번호 `0.1.0` `1.2.3` `1.0.0-rc.1` 과 `0.1` `v0.1.0` `01.0.0` `0.1.0-` 빈 값
- **Run**: 확인의 번호 규칙
- **Expected**: 앞의 셋만 통과하고, 뒤의 다섯은 '번호 형식은 0.1.0 처럼 x.y.z 입니다'로 거절된다
- **Pass criterion**: 통과 3, 거절 5

### T2. 새 번호는 지금 버전보다 커야 한다

- **Setup**: (지금 → 새) 없음 → 0.1.0 · 0.1.0 → 0.1.1 · 0.9.0 → 0.10.0 · 1.0.0-rc.1 → 1.0.0 · 0.1.0 → 0.1.0 · 0.1.0 → 0.0.9 · 1.0.0 → 1.0.0-rc.1
- **Run**: 확인의 크기 규칙
- **Expected**: 앞의 넷은 통과, 뒤의 셋은 '<새> 은 지금 버전 <지금> 보다 커야 합니다'
- **Pass criterion**: 일곱 경우가 모두 맞다

### T3. 확인은 틀린 것을 한꺼번에 보인다

- **Setup**: 사실 — 갈래 main, 커밋 안 한 변경 있음, 노트 없음, main 에 develop 에 없는 커밋 있음, 태그 이미 있음 / 따로: 없는 모드, 빈 노트
- **Run**: 확인
- **Expected**: 규칙마다 fail 줄이 하나씩, 이유와 함께 나온다 — 'develop 갈래에서만 릴리스합니다 (지금: main)', '커밋하지 않은 변경이 있습니다', '노트가 없습니다: docs/releases/<mod>/<번호>.md', 'main 에 develop 에 없는 커밋이 있어 앞당길 수 없습니다', '태그가 이미 있습니다: <태그>', '그런 모드가 없습니다: <이름> — 있는 모드: …', '노트가 비어 있습니다: …'. 사실이 모두 맞으면 fail 이 0
- **Pass criterion**: fail 줄 수와 이유가 같다

### T4. 미리 보기는 아무것도 바꾸지 않는다

- **Setup**: 임시 저장소(가짜 원격 포함), develop 갈래, 노트 커밋됨
- **Run**: `release.sh demo 0.1.0 --dry-run`
- **Expected**: CHECK 줄이 모두 ok, 할 일 줄이 planned, `RESULT: preview`. 작업 트리 · 커밋 · 태그 · 설정 파일은 그대로
- **Pass criterion**: git 상태 빈 값, HEAD 그대로, 태그 0개

### T5. 릴리스는 버전 적기부터 main 앞당기기까지 한 번에 한다

- **Setup**: T4 와 같다
- **Run**: `release.sh demo 0.1.0` (올리기 없음)
- **Expected**: 설정 파일 version 이 0.1.0 이고 마켓 목록에는 version 이 없다. 마지막 커밋 'release: demo 0.1.0' 이 설정 파일 하나만 바꾼다. 주석 태그 `demo--v0.1.0` 이 HEAD 에 있다. main 이 develop 과 같다. 원격은 그대로다. NEXT 에 `--push` 로 올리라는 줄이 있다
- **Pass criterion**: 위 여섯이 모두 맞다

### T6. --push 는 develop · main · 태그를 한 번에 올리고, 다시 하면 올리기만 한다

- **Setup**: (가) T4 상태 (나) (가) 뒤 (다) T5 상태(로컬 릴리스만 함)
- **Run**: 각각 `release.sh demo 0.1.0 --push`
- **Expected**: (가) 원격에 develop · main · 태그가 같은 커밋으로 있다 (나)(다) 새 커밋 · 새 태그 없이 올리기만 한다
- **Pass criterion**: 원격 refs 세 개가 같은 커밋, 커밋 수가 늘지 않는다

### T7. 시험이나 검사가 틀리면 아무것도 남기지 않고 멈춘다

- **Setup**: (가) 모드 시험 실패 (나) 검사(validate) 실패
- **Run**: `release.sh demo 0.1.0`
- **Expected**: (가) 버전 적기 전에 멈춘다 (나) 적은 버전을 되돌리고 멈춘다. 둘 다 `RESULT: failed <단계>`
- **Pass criterion**: git 상태 빈 값, HEAD 그대로, 태그 0개

### T8. 태그에서 모드 · 번호 · 노트를 뽑는다 (자동 작업이 쓰는 것)

- **Setup**: 태그 `scv-dashboard--v0.1.0`, `scv-dashboard--v1.0.0-rc.1`, `v0.1.0`, `scv-dashboard--v0.1`, `scv-dashboard-0.1.0`, 노트가 없는 `demo--v9.9.9`
- **Run**: `release.sh tag-info <태그>`
- **Expected**: 첫째는 MOD scv-dashboard · VERSION 0.1.0 · NOTES docs/releases/scv-dashboard/0.1.0.md · TITLE 'scv-dashboard 0.1.0' · PRERELEASE no, 둘째는 PRERELEASE yes, 나머지는 거절(exit 1)
- **Pass criterion**: 줄 값과 exit 코드가 같다

### T9. 릴리스 페이지 자동 작업이 태그로 돈다

- **Setup**: `.github/workflows/release.yml`
- **Run**: 파일 내용 확인
- **Expected**: `*--v*` 태그 push 와 손으로 돌리기(workflow_dispatch, 태그 입력)에 돌고, contents: write 권한을 가지며, `scripts/release.sh tag-info` 로 노트를 얻고, 넣은 태그를 꺼내 그 노트로 `gh release create … --verify-tag --notes-file` 하거나, 페이지가 이미 있으면 `gh release edit` 로 고친다
- **Pass criterion**: 여섯 가지가 파일에 있다. 실제 페이지는 `gh release view` 로 확인한다

### T10. 저장소의 버전 기록이 한 곳이고, 그 번호의 노트가 있다

- **Setup**: 이 저장소
- **Run**: 설정 파일 · 마켓 목록 · 노트 · validate
- **Expected**: 모드마다 설정 파일 이름이 마켓 목록 이름과 같다. 설정 파일에 version 이 있으면 그 번호의 노트가 있고 비어 있지 않다. 마켓 목록 항목에는 version 이 없다. 바꾼 이름 표(renames)는 마켓 목록에 있는 모드를 가리킨다. 모드마다 · 마켓 validate 가 통과한다
- **Pass criterion**: 다섯 모두 맞다

### T11. 모드 시험은 그대로 통과한다

- **Setup**: 이 저장소
- **Run**: `claude plugin test marketplace/mods/scv-dashboard`
- **Expected**: 72 pass, 0 fail
- **Pass criterion**: 실패 0

### T12. 이 맥에서 옛 scv-hello 를 지우고 scv-dashboard 0.1.0 을 받는다 (끝 기준 — 실제 확인)

- **Setup**: 0.1.0 을 올린 뒤
- **Run**: `/scv:mods-install` 로 scv-dashboard (엔진 mods.sh) — scv-hello 가 목록에 남아 있으면 `/scv:mods-remove` 로 먼저 지운다, `/scv:mods` 목록, `git ls-remote --tags origin`
- **Expected**: `MOD: scv-dashboard installed 0.1.0`, 목록에 scv-hello 없음, 원격에 `scv-dashboard--v0.1.0`
- **Pass criterion**: 목록 줄과 태그가 있고 옛 이름이 없다

### T13. 옛 이름은 모드 · 문서 · 스크립트에 남지 않는다

- **Setup**: 이 저장소
- **Run**: 모드 폴더 · README · docs · scripts · 마켓 목록에서 `scv-hello` 찾기
- **Expected**: 모드 폴더와 scripts 에는 없다. 남는 곳은 마켓 목록의 바꾼 이름 표, README 와 0.1.0 노트의 '옛 이름에서 옮기는 법' 뿐이다. 지나간 계획서 · 대화 · 결정 기록은 기록이라 그대로 둔다
- **Pass criterion**: 정해진 세 곳 밖에서 찾은 것이 0

## How to run

```bash
bash scripts/tests/release.test.sh && claude plugin test marketplace/mods/scv-dashboard
```

## Pass criteria

- T1–T11 과 T13 이 자동 시험으로 통과한다(How to run 이 0 으로 끝난다).
- T12 는 0.1.0 을 올린 뒤 이 맥에서 실제로 돌려 확인한다.
- 릴리스 페이지(T9 의 실제 결과)는 사용자가 웹에서 확인한다.

## Related Documents

- [`PLAN.md`](./PLAN.md)
