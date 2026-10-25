---
title: SCV 칸 — 서로 거울 거는 고리 막기
slug: 20261025-wookiya1364-scv-mirror-no-loop
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
  - "나를 보고 있지 않은 세션으로 거는 거울은 지금과 똑같다 (기존 시험 90개)"
---

# SCV 칸 — 서로 거울 거는 고리 막기

## Summary

맥미니 세션이 맥프로 작업 세션(액프로_scv-core)을 거울로 보는 중에, 작업 세션에서 다시 맥미니 세션으로 거울을 걸어 서로 베끼는 고리가 생겼다(확인: 스크린샷). 거울 중인 세션은 자기 파일을 읽지 않으므로(register.tsx 의 refresh 거울 분기) 두 칸 모두 진행이 멈춘다. 지금 이 세션을 보고 있는 세션으로는 거울을 걸지 못하게 거절한다.

| 경우 | 지금 (0.2.3) | 바뀐 뒤 |
|---|---|---|
| 나를 보고 있는 세션으로 /scv-mirror | 요청이 나가고 고리가 생겨 둘 다 멈춤 | 보내지 않고 "그 세션은 지금 이 세션을 거울로 보고 있습니다 …" 로 거절, 걸려 있던 거울 그대로 |
| 그 밖의 세션 | — | 그대로 |

## Goals / Non-Goals

- **Goals**: 위 표.
- **Non-Goals**: 셋 이상이 도는 긴 고리(A→B→C→A) 감지. 이미 생긴 고리를 자동으로 푸는 것(`/scv-mirror stop` 으로 푼다).

## Approach Overview

- 순수 함수 `isViewerOf(asked, viewers)` — 받은 주소(앞의 `bridge:` 는 떼고)가 이 세션의 시청자 목록에 있는지.
- `/scv-mirror <주소>` 는 자기 주소 검사 다음에 이것으로 거른다.

## 순수함수 · 파이프라인 (Pure functions & pipeline)

```
flow(
  readViewers,   // $ → Viewers           (입구: $.state 읽기)
  isViewerOf,    // (asked, viewers) → boolean
)                // 출구: 거절 문구, 또는 기존 askMirror
```

| # | 단계 | 받는 값 → 돌려주는 값 | 순수/부수효과 |
|---|---|---|---|
| 1 | read viewers | $ → Viewers | 부수효과 (입구) |
| 2 | isViewerOf | 주소, Viewers → boolean | 순수 |
| 3 | 거절 또는 askMirror | — | 부수효과 (출구) |

## Guardrails

- 거절할 때는 아무 메시지도 보내지 않고, 걸려 있던 거울도 바꾸지 않는다.
- 그 밖의 거울 동작은 바꾸지 않는다.

## Exit criteria

- TESTS.md 와 기존 시험 90개 통과, validate · 타입 검사 통과.

## Suggested path

1. 시험 먼저(실패 확인). 2. model.ts `isViewerOf`, register.tsx 거절. 3. 시험 · validate · 타입 검사.

## Risks / Open Questions

- 시청자 목록은 HELLO 를 받아야 생기므로, 상대가 아직 HELLO 를 보내기 전(같은 순간 동시에 거는 경우)은 막지 못한다.
- 셋 이상이 도는 고리는 막지 못한다.
