---
title: 앱 오른쪽 SCV 대시보드 칸 — scv:dreams
slug: 20261022-wookiya1364-scv-dashboard-pane-dreams
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

# 앱 오른쪽 SCV 대시보드 칸 — scv:dreams

## Summary

SCV 드림(사용 습관 돌아보기)의 최신 요약 한 줄을 SCV 칸에 보여 주고, 개선점 목록을 펼쳐 보거나 보고서를 바로 열 수 있게 한다.

## Goals / Non-Goals

- **Goals**
  - 최신 드림 요약 한 줄(날짜 포함)
  - '개선점 펼치기' 버튼 → 요약의 항목들을 줄마다 보이기
  - '보고서 열기' 버튼 → 보고서 HTML 을 이 컴퓨터의 기본 브라우저로 열기
  - 드림이 아직 없으면 '아직 드림 없음 — /scv:dreams 로 만들기' 안내
- **Non-Goals**
  - 드림 만들기(/scv:dreams 실행) 자체
  - 파일 쓰기, 터미널 표시

## Approach Overview

- `scv/dreams/latest.json`(date · summary · report)을 몇 초마다 읽는다(확인함: 이 파일이 있음).
- summary 를 ' · ' 기준으로 나눠 항목을 만든다. 앞머리 '[SCV 드림]' 은 뗀다.
- 보고서 열기는 `xdg-open`(리눅스) / `open`(맥)으로 연다 — 파일을 바꾸지 않는다.

## 순수함수 · 파이프라인 (Pure functions & pipeline)

```
flow(
  readDreams,      // cwd → latest.json 글 | 없음        ← 부수효과(입구)
  parseDreams,     // 글 → Dreams { date, headline, items[], reportPath } | 없음
  buildDreamsView, // (Dreams, 펼침 여부) → DreamsView
)
render(DreamsView) // 부수효과(출구)
openReport(path)   // 부수효과(출구: 브라우저 열기)
```

| # | 단계 | 하는 일 | 받는 값 → 돌려주는 값 | 순수/부수효과 |
|---|---|---|---|---|
| 1 | readDreams | 최신 드림 요약 파일을 읽어 온다(읽기만) | 작업 폴더 → 글 | 부수효과 (입구) |
| 2 | parseDreams | 드림 요약을 날짜와 개선점 항목들로 나눈다 | 글 → Dreams | 순수 |
| 3 | buildDreamsView | 요약 한 줄과 펼친 개선점을 보여 줄 모양으로 만든다 | Dreams, 펼침 → View | 순수 |
| 4 | openReport | 드림 보고서를 이 컴퓨터의 브라우저로 연다 | 경로 → 브라우저 | 부수효과 (출구) |

- 재사용: progress 계획의 새로 고침 · 상태 저장소

## Guardrails

- 보고서 열기 실패 시 화면에 짧게 알리고(경로 함께) 다른 기능은 그대로.
- 파일을 쓰지 않는다.

## Exit criteria

- All TESTS.md scenarios pass
- 앱에서 드림 요약과 펼친 개선점이 보이는 화면 사진 1장

## Suggested path

1. [x] parseDreams 순수 함수 + 단위 시험 — `parseDreams`
2. [x] 드림 칸 영역 그리기 + 펼치기 버튼 — `buildDreamsView`
3. [x] 보고서 열기 버튼 — `openReport`
4. [x] 자동 시험 · 올리기

## Related Documents

- 같은 묶음: progress, live 계획

## Risks / Open Questions

- 개선점 '목록'은 요약 한 줄을 나눈 것이다 — 보고서 안의 자세한 목록은 HTML 이라 읽지 않는다.
- 데스크톱 앱에서 브라우저 열기가 막혀 있을 수 있다(추정) — 그때는 경로를 보여 준다.

## Links

- Raw originals: (listed in frontmatter)
- Related PRs:
