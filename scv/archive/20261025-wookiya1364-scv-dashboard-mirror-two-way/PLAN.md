---
title: SCV 칸 — 거울 줄 줄이기와 거울 칸 동작 넘기기
slug: 20261025-wookiya1364-scv-dashboard-mirror-two-way
author: wookiya1364
created_at: 2026-10-25
status: testing
kind: feature
lang: korean
tags: [mod, dashboard, mirror]
raw_sources: []
refs: []
invariants:
  - "거울 메시지(HELLO·BYE·STATE·ACT)는 어느 쪽 모델에도 가지 않는다 — consumed"
  - "모드가 직접 보내는 것만 허락 없이 나가고, 모델의 SendMessage 는 허락 검사를 그대로 받는다"
---

# SCV 칸 — 거울 줄 줄이기와 거울 칸 동작 넘기기

## Summary

다른 컴퓨터의 세션끼리 거울을 쓸 때, 상태 메시지가 하나 올 때마다 데스크톱 앱이 '다음 발신자로부터 메시지 수신 · 다른 세션' 줄을 하나씩 그린다. 지금은 바뀐 게 없어도 30초마다 보내서 줄이 쌓인다. 모드가 메시지를 consumed 로 받아도 이 줄은 남는다(확인함: 보기 세션 기록 파일에 거울 메시지 0건인데 줄은 보임). 그래서 메시지 수를 줄인다. 함께, 거울 칸에서 누른 '입력창에 넣기'와 '보고서 열기'가 보기 세션이 아니라 작업 세션 쪽에서 실행되게 한다.

## Goals / Non-Goals

- **Goals**
  - 작업 세션은 상태가 바뀌었을 때만, 직전 전송에서 최소 10초 지난 뒤 보낸다. 바뀐 게 없으면 보내지 않는다.
  - 보기 세션은 소식이 없어도 60초마다 다시 요청하지 않는다. 10분 동안 아무것도 못 받았을 때만 다시 요청한다.
  - 작업 세션의 시청자 목록은 모드가 다시 읽혀도(hot reload) 남는다.
  - 거울 칸의 '입력창에 넣기'는 작업 세션의 입력창에 그 계획의 다음 명령을 넣는다. 넣을 명령은 작업 세션이 자기 상태로 다시 계산한다.
  - 거울 칸의 '보고서 열기'는 작업 세션 컴퓨터에서 드림 보고서를 연다.
- **Non-Goals**
  - 줄을 0개로 만드는 것. 앱이 그리는 줄이라 세션 메시지를 쓰는 한 모드로는 막을 수 없다.
  - 원격(Remote Control) 앱이 같은 세션의 SCV 칸을 그리게 하는 것. 앱이 그려 주지 않는 한계로 보이며 범위 밖이다.
  - 명령을 작업 세션에서 실행(제출)하는 것. 입력창에 넣기만 한다.
  - '명령 복사', 접기·펼치기, 계획 고르기, 단계 누르기. 이것들은 보는 사람 쪽에서 그대로 동작한다.

## Approach Overview

- 메시지에 `ACT` 종류를 더한다: `SCV-MIRROR ACT <보기 주소> {json}`. json 은 `{do:'fill', slug}` 또는 `{do:'open-report'}`. 모르는 형태는 버린다.
- 작업 세션은 보낼지 말지를 순수 함수 `isMirrorDue(last, body, at, gap)` 로 정한다. 3초마다 도는 새로 고침이 그대로 이 판단을 부른다.
- 시청자 목록을 모듈 변수에서 `$.state` 의 `viewers` 로 옮긴다(계약 types/index.d.ts 에 추가).
- 보기 세션의 다시 요청 간격을 `MIRROR_ASK_MS`(10분)으로 따로 둔다.
- 보기 세션 칸에서 두 버튼은 거울 중일 때 ACT 를 보내고, 칸 아래에 '작업 세션으로 보냄' 같은 메모를 남긴다.
- 작업 세션은 시청자 목록에 있는 주소의 ACT 만 받는다. fill 은 그 slug 의 다음 행동을 자기 상태로 계산해 명령이 있을 때만 입력창에 넣는다.

## 순수함수 · 파이프라인 (Pure functions & pipeline)

보내는 쪽(작업 세션):

```
flow(
  mirrorState,   // $.state → 상태 JSON 문자열        (입구: 상태 읽기)
  isMirrorDue,   // (직전 전송, 문자열, 지금, 간격) → 보낼지
  mirrorText,    // MirrorMessage → 보낼 글
)                // 출구: $.session.send, viewers 갱신
```

받는 쪽(양쪽):

```
flow(
  parseMirror,   // 받은 글 → MirrorMessage | null
  route,         // hello/bye/state/act 별로 나눔
)                // 출구: viewers·mirror 갱신, 입력창 넣기, 보고서 열기
```

| # | 단계 | 받는 값 → 돌려주는 값 | 순수/부수효과 |
|---|---|---|---|
| 1 | mirrorState | $.state → 상태 객체 | 부수효과 (입구, 읽기만) |
| 2 | isMirrorDue | {sent, at}, body, at, gap → boolean | 순수 |
| 3 | mirrorText | MirrorMessage → string | 순수 |
| 4 | parseMirror | string → MirrorMessage \| null | 순수 |
| 5 | nextAction | slug·상태 → {text, command} | 순수 (기존) |
| 6 | 보내기·입력창·열기 | 메시지 → 전송/입력창/프로세스 | 부수효과 (출구) |

- 부수효과 위치: 상태 읽기(입구), `$.session.send`·`$.prompt.fill`·`$.process.run`·`$.state` 쓰기(출구).
- 재사용: `mirrorText`·`parseMirror`·`nextAction`·`planPromptFill` 을 그대로 쓰고 늘린다.

## Guardrails

- 거울 메시지는 어느 쪽 모델에도 가지 않는다(모든 종류 consumed).
- 모델의 SendMessage 허락 검사는 그대로 둔다. 모드 자신의 전송만 허락 없이 나간다.
- ACT 의 내용을 명령으로 믿지 않는다. 명령 글자는 메시지에 싣지 않고, 작업 세션이 자기 상태로 계산한다.
- 시청자 목록에 없는 주소의 ACT 는 버린다.
- 거울을 쓰지 않는 세션의 칸과 동작은 바뀌지 않는다.
- 입력창에 넣기만 한다. 제출하지 않는다.

## Exit criteria

- TESTS.md 시나리오가 모두 통과하고, 기존 시험 75개도 계속 통과한다.
- `claude plugin validate` 와 타입 검사가 통과한다.
- 상태가 그대로면 작업 세션이 10분 동안 보기 세션으로 한 번도 보내지 않는다(시험으로 확인).

## Suggested path

1. model.ts: ACT 메시지 형식, `parseAct`, `isMirrorDue` 와 시험.
2. register.tsx + 계약: viewers 를 `$.state` 로, 박동 대신 `isMirrorDue`, 다시 요청 10분.
3. register.tsx: 작업 세션의 ACT 처리(fill·open-report), 보기 세션 버튼이 ACT 를 보냄.
4. 시험·validate·타입 검사.

## Related Documents

- FEATURE_ARCHITECTURE.md

## Risks / Open Questions

- 작업 중에는 상태(도구 이름 등)가 자주 바뀌어 1분에 최대 6줄 정도는 계속 생긴다.
- 쉬는 동안 보기 칸의 '몇 분 전 받음'이 계속 늘어난다. 고장이 아니라 바뀐 게 없다는 뜻인데, 헷갈릴 수 있다.
- 작업 세션이 꺼진 경우 보기 세션이 알아채는 데 최대 10분 걸린다.
- 실제 두 컴퓨터 사이 동작은 시험 하네스로만 확인하고, 실물 확인은 배포 뒤 사람이 한다.

## Links

- Raw originals: 없음 — 2026-10-25 SCV mirror session 대화(두 컴퓨터 화면 확인)
- Related PRs:
