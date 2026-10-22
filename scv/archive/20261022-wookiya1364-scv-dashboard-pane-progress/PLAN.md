---
title: 앱 오른쪽 SCV 대시보드 칸 — 진행률·단계 흐름·막힘·시험 결과
slug: 20261022-wookiya1364-scv-dashboard-pane-progress
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

# 앱 오른쪽 SCV 대시보드 칸 — 진행률·단계 흐름·막힘·시험 결과

## Summary

마냥 기다리지 않도록, 세션이 열린 프로젝트의 SCV 계획이 지금 몇 단계까지 왔는지, 어디서 막혔는지, 시험 결과가 어떤지를 앱 오른쪽 SCV 칸에 항상 보여 준다. scv-hello 모드(0.4.0, 자리 시험 끝)를 대시보드로 키운다.

## Goals / Non-Goals

- **Goals**
  - 진행률: 지금 계획의 '진행 경로'(Suggested path) 단계 중 끝난 수 / 전체 (예: 5/11)와 막대
  - 단계 흐름: 누를 수 있는 단계 노드가 선(완료 실선 │, 그 뒤 점선 ┆)으로 이어진 목록 — 그림(SVG) 안은 누른 곳이 모드에 전달되지 않아 노드 목록으로 그림 — 완료(초록) · 진행(노랑, 고리 — 신호등) · 막힘(빨강) · 대기(회색 점선), 지금 멈춘 곳에 '지금 여기' 표시 (사용자 요청으로 그래프화, 0.6.0)
  - 막힌 작업 카드: (1) Claude가 내 답을 기다릴 때(선택 창), (2) 시험이 실패했을 때 — 무엇 때문인지 함께
  - 시험 결과 목록: TESTS.md 시나리오(T1…)마다 통과 · 실패 · 결과 없음
  - 막힘은 지금 단계에만: 시작 안 한 단계는 표시와 상관없이 대기, 내 답 대기·시험 실패면 지금 단계가 막힘(빨강) (0.7.0)
  - 클릭: 단계 노드를 누르면 그 단계가 하는 일(계획서 파이프라인 표의 '하는 일' 칸, 쉬운 말 — 없으면 받는 값·내놓는 값)과 이 세션에서 그 단계 동안 한 일이 보임 (0.7.0) · 시험·막힘 카드 펼쳐 보기 · 계획이 여러 개면 선택 항목으로 고르기
  - 단계 줄 표기 약속: N. 단계 설명 — `파이프라인이름` … (이름이 없으면 단계 설명에 든 이름으로 찾음)
  - 항상 표시: 세션 시작 때 열고, 닫아도 다음 메시지 때 다시 연다
  - 맨 위 한 줄 요약(지금 어디 · 막힘 · 남은 시간)과 '다음: …' + 명령 복사 단추, 상태는 쉬운 말(시작 전 · 만드는 중 · 단계 끝 · 시험 확인 중 · 끝남 · 보관됨)
  - 시험 결과는 모드 전용 저장소에 프로젝트 폴더별로 남겨 새 세션에서도 보임(프로젝트 파일은 안 씀)
  - 내 답 대기 · 시험 실패 때 알림 한 번(앱 알림이 안 되면 시스템 알림 — 맥 osascript, 리눅스 notify-send)
  - 진행률 막대도 신호등 색, 계획 고르기가 있으면 제목은 한 번만
- **Non-Goals**
  - 터미널에서 보이게 하기
  - 프로젝트 파일 쓰기 · SCV 플러그인(/scv:work) 고치기
  - 지금 작업 상세 · 예상 시간(→ live 계획), dreams(→ dreams 계획)

## Approach Overview

- 자료는 세션 작업 폴더의 `scv/promote/*/PLAN.md`·`TESTS.md`를 몇 초마다 읽는다(읽기만).
- 계획 고르기: 상태가 in_progress → testing → planned 순으로 가장 앞선 것을 기본으로, 여러 개면 선택 항목.
- 단계 상태: PLAN '진행 경로' 줄의 표시(`[x]`/✅ 완료, `[~]`/🔄 진행, `[!]`/⛔ 막힘)를 먼저 따르고, 표시가 없으면 계획 상태로 짐작(done → 전부 완료, planned → 전부 대기, in_progress/testing → 첫 미완료 단계를 진행으로).
- 시험 결과: 세션의 Bash 호출 중 시험 명령(계획의 How to run 명령, 또는 test/pytest/vitest/jest/playwright/`claude plugin test`)을 지켜보고, 끝나면 출력에서 시나리오 번호(T1…)별 통과/실패를 읽는다. 번호가 안 보이면 '전체 실행' 결과로만 보인다.
- 막힘: AskUserQuestion 이 답을 기다리는 동안, 그리고 마지막 시험 실행이 실패했을 때.
- 그리기: 데스크톱 요소(Box·Text·Button·Select)만 쓴다.

## 순수함수 · 파이프라인 (Pure functions & pipeline)

```
flow(
  readSources,     // (cwd, clock) → Snapshot { plans: [{path, planText, testsText}], now }   ← 부수효과(입구)
  parsePlans,      // Snapshot → Plan[] { slug, title, status, steps[] }
  pickPlan,        // (Plan[], chosenSlug?) → Plan | undefined
  deriveStages,    // Plan → Stage[] { name, state: done|doing|blocked|waiting }
  mergeTests,      // (TESTS 시나리오, TestRun[]) → TestRow[] { id, name, result }
  findBlocks,      // (Stage[], TestRow[], waiting?) → Block[]
  buildProgressView, // 위 값들 → ProgressView
)
render(ProgressView)  // 부수효과(출구): 칸 그리기
```

| # | 단계 | 하는 일 | 받는 값 → 돌려주는 값 | 순수/부수효과 |
|---|---|---|---|---|
| 1 | readSources | 세션 폴더의 SCV 계획서와 시험 목록 파일을 읽어 온다(읽기만) | 작업 폴더 → 계획 파일 글 | 부수효과 (입구: 파일 읽기) |
| 2 | parsePlans | 계획서 글에서 제목·상태·단계 목록·시험 목록을 뽑아 정리한다 | 글 → Plan[] | 순수 |
| 3 | pickPlan | 여러 계획 중 지금 보여 줄 하나를 고른다(진행 중인 것 먼저) | Plan[], 고른 slug → Plan | 순수 |
| 4 | deriveStages | 각 단계가 완료·진행·막힘·대기 중 어디에 있는지 정한다 | Plan → Stage[] | 순수 |
| 5 | parseTestOutput | 시험 명령의 출력을 읽어 시나리오별 통과·실패를 가려낸다 | 명령 출력·성공 여부 → TestRun | 순수 |
| 6 | mergeTests | 시험 목록과 마지막 시험 결과를 맞춰 줄마다 결과를 붙인다 | 시나리오, TestRun[] → TestRow[] | 순수 |
| 7 | findBlocks | 답을 기다리거나 시험이 실패한 곳을 찾아 막힌 작업으로 모은다 | Stage[], TestRow[], 대기 질문 → Block[] | 순수 |
| 8 | render | 정리된 내용을 오른쪽 SCV 칸 화면으로 그린다 | View → 화면 | 부수효과 (출구) |

- 부수효과 위치: 파일 읽기 · 시계(입구), Bash/AskUserQuestion 호출 관찰(입구), 그리기(출구)
- 재사용: 2~7은 live·dreams 계획도 그대로 쓴다

## Guardrails

- 프로젝트 파일을 쓰지 않는다(`$.fs.write` 금지).
- 0.4.0의 '닫아도 다음 메시지 때 다시 열림'을 깨지 않는다.
- 터미널 표시를 위해 데스크톱 화면을 타협하지 않는다(터미널은 깨져도 됨).
- 짐작한 값(계획 상태로 짐작한 단계 등)은 화면에 '추정'으로 표시한다.

## Exit criteria

- All TESTS.md scenarios pass
- 리눅스 Claude 앱 로컬 세션에서 이 폴더 계획을 고르면 진행률·단계 흐름·시험 목록이 보이는 화면 사진 1장

## Suggested path

1. [x] 순수 함수(파싱·단계·시험·막힘) 만들고 단위 시험 — `parsePlans` `pickPlan` `deriveStages` `parseTestOutput` `mergeTests` `findBlocks`
2. [x] 파일 읽기 + 몇 초마다 새로 고침 + 칸 그리기 — `readSources` `render`
3. [x] Bash·AskUserQuestion 관찰로 시험 결과·막힘 반영 — `parseTestOutput` `findBlocks`
4. [x] 펼쳐 보기 · 계획 고르기 클릭 — `render`
5. [x] 자동 시험 · 비밀 값 검사 · 저장소 올리기

## Related Documents

- 같은 묶음: live, dreams 계획

## Risks / Open Questions

- SCV(/scv:work)는 지금 단계별 완료를 파일에 적지 않는다(확인함). 표시가 없으면 단계 상태는 계획 상태로 '추정'만 된다 — 정확히 하려면 /scv:work 가 진행 경로 줄에 표시를 남겨야 함(범위 밖, 다음 결정).
- 시험 결과를 저장하는 SCV 파일이 없다(확인함). 그래서 이 세션에서 돌린 시험만 보인다 — 세션을 새로 열면 결과 없음으로 시작.

## Links

- Raw originals: (listed in frontmatter)
- Related PRs:
