# Test Plan — SCV 칸 — 거울 줄 줄이기와 거울 칸 동작 넘기기

## Overview

거울 메시지가 바뀔 때만, 너무 잦지 않게 오가는지와 거울 칸의 두 버튼이 작업 세션 쪽에서 실행되는지를 모드 시험 하네스로 확인한다. 기존 거울 시험(T1~T3)과 나머지 72개도 그대로 통과해야 한다.

## Test scenarios

### T1. ACT 메시지는 봉투 안에서도 읽히고, 모르는 형태는 버린다

- **Setup**: `mirrorText({kind:'act', address:'session_v', act:{do:'fill', slug:'a'}})` 와 `{do:'open-report'}` 를 봉투로 감싼다.
- **Run**: `parseMirror` 로 읽는다. `{do:'run'}`, slug 가 빈 fill, 깨진 JSON, 주소 없는 ACT 도 읽는다.
- **Expected**: 앞의 둘은 원래 값 그대로 나오고, 뒤의 넷은 null.
- **Pass criterion**: toEqual / toBeNull 이 모두 맞다.

### T2. 보낼지 판단 — 바뀌었고 간격이 지났을 때만

- **Setup**: `isMirrorDue({sent:'x', at:0}, …, gap=10000)`.
- **Run**: 같은 글 · 다른 글 5초 뒤 · 다른 글 10초 뒤 · 처음(sent '', at 0).
- **Expected**: false · false · true · true.
- **Pass criterion**: 네 값이 기대와 같다.

### T3. 작업 세션은 바뀐 게 없으면 보내지 않고, 바뀌면 간격을 두고 보낸다

- **Setup**: 계획 하나가 있는 작업 세션. HELLO 를 받아 상태를 1번 보낸 뒤.
- **Run**: 시계를 10분 앞으로 돌리며 새로 고침을 여러 번 돈다. 그다음 계획 파일을 바꾸고 새로 고침, 3초 뒤 또 바꾸고 새로 고침, 10초 뒤 새로 고침.
- **Expected**: 10분 동안 추가 전송 0건. 첫 변경 뒤 1건, 3초 뒤 변경은 그때 안 보내고, 10초 지난 새로 고침에서 1건.
- **Pass criterion**: `env.sent` 길이가 1 → 1 → 2 → 2 → 3.

### T4. 시청자 목록은 모드가 다시 읽혀도 남는다

- **Setup**: 작업 세션이 HELLO 를 받는다.
- **Run**: `$.state` 의 viewers 를 읽는다.
- **Expected**: 보기 주소가 들어 있다. BYE 를 받으면 빠진다.
- **Pass criterion**: viewers 키 존재 → 부재.

### T5. 보기 세션은 소식이 없어도 10분 전에는 다시 요청하지 않는다

- **Setup**: 보기 세션이 /scv-mirror 로 HELLO 1건을 보낸 상태.
- **Run**: 시계를 9분 앞으로 → 새로 고침, 그다음 11분으로 → 새로 고침.
- **Expected**: 9분까지 추가 HELLO 0건, 11분에 1건.
- **Pass criterion**: `env.sent` 길이 1 → 1 → 2.

### T6. 거울 칸 '입력창에 넣기'는 작업 세션으로 ACT 를 보낸다

- **Setup**: 보기 세션이 '시작하기'(/scv:work p) 상태의 계획을 받아 그린다.
- **Run**: 칸의 next-fill 버튼을 누른다.
- **Expected**: 작업 세션 주소로 `SCV-MIRROR ACT session_viewer {"do":"fill","slug":"p"}` 1건, 보기 세션 자기 입력창은 비어 있고, 칸에 '입력창(작업 세션)에 넣으라고 보냄' 메모.
- **Pass criterion**: 보낸 글·입력창·메모가 기대와 같다.

### T7. 작업 세션은 시청자의 fill 만 받아, 자기 상태로 계산한 명령을 입력창에 넣는다

- **Setup**: 계획 a('시작하기')가 있는 작업 세션, session_viewer 의 HELLO 를 받음.
- **Run**: session_viewer 의 ACT fill a 를 받는다. 이어서 목록에 없는 session_other 의 ACT fill a 를 받는다.
- **Expected**: 첫 번째: consumed, 입력창에 `/scv:work a`. 두 번째: consumed, 입력창은 바뀌지 않음.
- **Pass criterion**: consumed 이유와 입력창 내용이 기대와 같다.

### T8. 거울 칸 '보고서 열기'는 작업 세션에서 연다

- **Setup**: 드림 보고서가 있는 상태를 보기 세션이 받아 그린다. 작업 세션은 그 보고서 경로를 갖고 있다.
- **Run**: 보기 세션에서 dreams-report 버튼을 누르고, 그 ACT 를 작업 세션이 받는다.
- **Expected**: 보기 세션은 프로세스를 실행하지 않고 ACT open-report 를 보냄. 작업 세션은 자기 보고서 경로로 여는 프로세스를 실행.
- **Pass criterion**: 보기 쪽 프로세스 0건, 작업 쪽 open 명령 1건(경로 일치).

### T9. 거울 메시지는 모델에 안 가고, 모델의 SendMessage 는 여전히 검사받는다

- **Setup**: 기존 mirror T3 와 같은 조건.
- **Run**: ACT 를 받는다. 모델의 SendMessage 허락 검사를 부른다.
- **Expected**: ACT 는 consumed, SendMessage 는 'ask'.
- **Pass criterion**: 둘 다 기대와 같다.

## How to run

```bash
cd marketplace/mods/scv-dashboard && claude plugin test .
```

## Pass criteria

- T1~T9 와 기존 시험 75개가 모두 통과한다.
- `claude plugin validate marketplace/mods/scv-dashboard` 에 오류가 없다.

## Related Documents

- PLAN.md · FEATURE_ARCHITECTURE.md
