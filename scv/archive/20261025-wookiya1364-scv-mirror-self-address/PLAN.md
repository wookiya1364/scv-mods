---
title: SCV 칸 — 거울 자기 주소 막기와 실패해도 거울 유지
slug: 20261025-wookiya1364-scv-mirror-self-address
author: wookiya1364
created_at: 2026-10-25
status: testing
kind: feature
lang: korean
tags: [mod, dashboard, mirror]
raw_sources:
  - scv/conversations/20261025-142147-scv-mirror-self-address.md
refs: []
invariants:
  - "다른 세션 주소로 거는 거울은 지금과 똑같이 동작한다 (기존 시험 85개)"
  - "거울 메시지는 어느 쪽 모델에도 가지 않는다"
---

# SCV 칸 — 거울 자기 주소 막기와 실패해도 거울 유지

## Summary

맥프로와 맥미니 두 세션에서 각자 `/scv-dashboard` 가 알려 준 자기 주소로 `/scv-mirror` 를 쳤다가 영어 오류("…is this session itself…")가 났고, 그 실패가 걸려 있던 거울까지 꺼 버렸다(확인: register.tsx 의 실패 경로가 mirror 를 null 로). 자기 주소는 보내기 전에 쉬운 말로 거절하고, 실패해도 걸려 있던 거울은 두며, `/scv-dashboard` 안내를 다른 기기의 세션에서 치라고 분명히 한다.

| 경우 | 지금 (0.2.2) | 바뀐 뒤 |
|---|---|---|
| 자기 주소 | 영어 오류, 보내기 시도함 | 보내지 않고 한국어로 거절 + 다른 세션 주소 안내 |
| 걸려 있던 거울 | 꺼짐 | 그대로 |
| 상대에게 못 보냄 | 거울 꺼짐 | 걸려 있던 거울 그대로, 실패 이유만 |
| /scv-dashboard 안내 | "그 앱이 직접 연 세션에서" | "다른 기기에서 연 다른 세션에서" |

## Goals / Non-Goals

- **Goals**: 위 표의 네 줄.
- **Non-Goals**: 거울 메시지 형식·전송 간격·ACT 동작. `/scv-mirror stop` 과 인자 없는 `/scv-mirror`.

## Approach Overview

- 순수 함수 `isOwnAddress(asked, own)` — 받은 주소(앞의 `bridge:` 는 떼고)가 이 세션의 Remote Control 주소나 로컬 id 와 같은지.
- `/scv-mirror <주소>` 는 보내기 전에 이것으로 거른다.
- `askMirror` 는 바꾸기 전 거울 값을 돌려주고, 보내기에 실패하면 그 값으로 되돌린다.

## 순수함수 · 파이프라인 (Pure functions & pipeline)

```
flow(
  ownAddress,     // $ → { address, localId }      (입구: 세션 파일 읽기)
  isOwnAddress,   // (asked, own) → boolean
)                 // 출구: 거절 문구, 또는 askMirror(보내기 · 실패 시 이전 거울 되돌림)
```

| # | 단계 | 받는 값 → 돌려주는 값 | 순수/부수효과 |
|---|---|---|---|
| 1 | ownAddress | $ → 주소들 | 부수효과 (입구) |
| 2 | isOwnAddress | 주소, 주소들 → boolean | 순수 |
| 3 | askMirror | 주소 → 전송 결과, 이전 거울 | 부수효과 (출구) |

- 재사용: 기존 `mirrorAddress`, `askMirror`.

## Guardrails

- 다른 세션 주소로 거는 거울, 전송 간격, ACT, stop 동작은 바꾸지 않는다.
- 자기 주소일 때는 아무 메시지도 보내지 않는다.

## Exit criteria

- TESTS.md 시나리오와 기존 시험 85개가 통과한다. validate · 타입 검사 통과.

## Suggested path

1. model.ts: `isOwnAddress` 와 시험.
2. register.tsx: `/scv-mirror` 자기 주소 거절, 실패 시 이전 거울 되돌림, `/scv-dashboard` 문구.
3. 시험 · validate · 타입 검사.

## Risks / Open Questions

- 로컬 id 와 Remote Control 주소 외의 다른 표기(예: 세션 이름)로 자기 자신을 가리키면 거르지 못한다 — 그 경우는 지금처럼 보내기 실패로 끝나고, 이번 수정으로 거울은 유지된다.
