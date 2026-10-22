---
title: 앱 오른쪽 SCV 대시보드 칸 — 지금 작업 상세·예상 완료 시간
slug: 20261022-wookiya1364-scv-dashboard-pane-live
author: wookiya1364
created_at: 2026-10-22
status: done
kind: feature
lang: korean
epic: 20261022-scv-dashboard-pane
tags: [mod, dashboard]
raw_sources:
  - scv/conversations/20261022-102049-read-shared-claude-link.md
refs: []
invariants:
  - "Claude 앱(데스크톱) 로컬 세션의 오른쪽 SCV 칸에서 제대로 보인다 — 터미널 표시는 범위 밖"
  - "SCV 칸을 X로 닫아도 다음 메시지 때 다시 열린다 (0.4.0 동작)"
  - "대시보드는 프로젝트 파일을 바꾸지 않는다 — 읽기만"
---

# 앱 오른쪽 SCV 대시보드 칸 — 지금 작업 상세·예상 완료 시간

## Summary

지금 Claude가 무엇을 하고 있는지(단계 이름 + 쓰는 도구·파일 + 지난 시간)와 남은 시간 추정을 SCV 칸 맨 위 '진행 중' 카드로 보여 준다. 일하는 중인지 멈춘 건지 한눈에 구분하게 한다.

## Goals / Non-Goals

- **Goals**
  - 진행 중 카드: 지금 단계 이름(progress 계획의 진행 단계) + 지금 쓰는 도구와 대상(파일 경로 · 명령 설명) + 그 도구가 돈 시간
  - Claude 상태: 일하는 중 / 쉬는 중(차례 끝) 구분, 차례 시작 후 지난 시간
  - 할 일 목록(TodoWrite/Task 도구)이 있으면 그 n/N 과 지금 항목
  - 예상 완료 시간: 지금까지 단계당 걸린 시간 × 남은 단계 — 늘 '추정' 표시, 자료가 없으면 '아직 추정 불가'
- **Non-Goals**
  - 정확한 완료 시각 약속
  - 터미널 표시, 파일 쓰기

## Approach Overview

- tool.call 훅으로 도구 시작/끝을 기록한다(도구 이름, file_path/path/command/description 중 사람이 읽을 대상).
- turn.start / turn.complete 로 일하는 중/쉬는 중을 기록한다.
- TodoWrite 입력의 todos, TaskCreate/TaskUpdate 입력을 모아 할 일 목록을 만든다.
- 단계 완료 시각은 progress 계획의 완료 수가 늘 때 기록하고, 그 간격 평균으로 남은 시간을 짐작한다.
- 지난 시간 글자는 몇 초마다 다시 그린다.

## 순수함수 · 파이프라인 (Pure functions & pipeline)

```
flow(
  describeTool,    // (도구 이름, 입력) → { tool, target }
  applyTaskEvent,  // (TaskList, 도구 입력) → TaskList
  recordStepTimes, // (StepHistory, 완료 수, now) → StepHistory
  estimateEta,     // (StepHistory, 남은 단계, now) → { minutes, basis } | 추정 불가
  buildLiveView,   // 위 값들 → LiveView
)
```

| # | 단계 | 하는 일 | 받는 값 → 돌려주는 값 | 순수/부수효과 |
|---|---|---|---|---|
| 1 | 도구·차례 관찰 | Claude가 어떤 도구를 언제 쓰는지, 일하는 중인지 쉬는 중인지 지켜본다 | 훅 이벤트 → 기록 | 부수효과 (입구) |
| 2 | describeTool | 도구 호출을 사람이 읽을 한 줄(파일 이름·명령 설명)로 바꾼다 | 도구 이름·입력 → 읽을 대상 | 순수 |
| 3 | applyTaskEvent | 할 일 목록이 바뀔 때마다 지금 목록을 새로 맞춘다 | 할 일 목록, 입력 → 새 목록 | 순수 |
| 4 | recordStepTimes | 단계가 하나 끝날 때마다 끝난 시각을 적어 둔다 | 기록, 완료 수, 시각 → 기록 | 순수 |
| 5 | estimateEta | 단계당 걸린 평균 시간으로 남은 시간을 짐작한다 | 기록, 남은 단계, 시각 → 추정 | 순수 |
| 6 | formatDuration | 걸린 시간을 "2분 10초"처럼 읽기 쉬운 글로 바꾼다 | 밀리초 → '2분 10초' | 순수 |
| 7 | render | 진행 중 카드와 예상 완료 시간을 화면에 그린다 | View → 화면 | 부수효과 (출구) |

- 부수효과 위치: 훅 관찰 · 시계(입구), 그리기(출구)
- 재사용: progress 계획의 Stage[] 와 상태 저장소를 그대로 쓴다

## Guardrails

- 예상 시간은 반드시 '추정'으로 표시한다. 근거(단계 몇 개 평균)를 같이 보인다.
- 도구 입력 중 비밀이 섞일 수 있는 긴 명령은 앞부분만 보이고, 설명(description)이 있으면 설명을 먼저 쓴다.
- 파일을 쓰지 않는다.

## Exit criteria

- All TESTS.md scenarios pass
- 앱에서 Claude가 일하는 동안 진행 중 카드에 도구·파일·시간이 바뀌는 화면 사진 1장

## Suggested path

1. [x] describeTool · applyTaskEvent · estimateEta · formatDuration 순수 함수 + 단위 시험 — `describeTool` `applyTaskEvent` `estimateEta` `formatDuration`
2. [x] tool.call / turn 훅으로 상태 기록 — `도구·차례 관찰` `recordStepTimes`
3. [x] 진행 중 카드 · 예상 시간 그리기, 몇 초마다 다시 그리기 — `render`
4. [x] 자동 시험 · 올리기

## Related Documents

- 같은 묶음: progress, dreams 계획

## Risks / Open Questions

- 단계 완료 시각은 이 세션에서 본 것만 안다 — 세션 시작 직후엔 '아직 추정 불가'.
- 하위 에이전트 안의 도구 호출은 보이지 않을 수 있다(추정).

## Links

- Raw originals: (listed in frontmatter)
- Related PRs:
