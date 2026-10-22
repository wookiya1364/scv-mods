---
name: decisions-log
version: 1.0.0
status: active
last_updated: 2026-08-07
tags: [decisions, append-only, attribution]
standard_version: 1.0.0
merge_policy: preserve
---

# DECISIONS — append-only 결정 로그

> 단일 리포의 결정 전용 기록입니다 (멀티리포 root 전용인 `scv/decisions/` 와
> 별개). 결정에 이르는 대화 원문은 `scv/journal/` 과 `scv/conversations/` 에,
> 결정 자체는 여기에 구조화되어 쌓입니다.

## 규약

- **append-only** — 기존 엔트리의 수정·삭제 금지. 번복도 새 엔트리로 append
  합니다 (이전 엔트리를 refs 로 가리키면 됩니다).
- **author 필수** — 모든 엔트리는 작성자 귀속. 익명 엔트리 금지.
- 교훈(lessons)도 별도 문서가 아니라 엔트리 타입으로 여기에 흡수합니다.
- 자동 append 지점 3곳 (프로토콜이 수행): `action:promote` 계획 승인(채택
  방향 + 버린 대안), `action:work` archive(reason 의 결정 승격 + 계획 대비
  실제 경로), `action:regression` obsolete 판정(왜 폐기인지).

## 엔트리 스키마 (handoff decision 포맷 재사용)

```markdown
## [YYYY-MM-DD HH:MM] <author> — <제목>

- verdict: adopted | archived | obsolete | needed | maybe | not-needed | lesson
- why: <1–3줄 — 근거>
- discarded alternatives: <버린 대안 — 없으면 생략>
- path delta: <Suggested path(legacy: Steps) 대비 실제로 간 경로와 이탈 이유.
  `action:work` archive 엔트리에서는 필수 — 그대로 갔으면 "as planned">
- refs: <관련 PLAN/PR/티켓 경로·URL — 없으면 생략>
- conversation: <scv/conversations/... 또는 scv/journal/... 링크 — 없으면 생략>
```

<!-- append entries below this line — never edit or delete existing ones -->

## [2026-10-22 14:05] wookiya1364 — 앱 오른쪽 SCV 대시보드 칸 — 진행률·단계 흐름·막힘·시험 결과

- verdict: adopted
- why: 앱 오른쪽 별도 SCV 칸(모드 pane)에 표시 — 환경 카드·세션 목록 안은 모드가 그릴 수 없음(문서 확인). 닫힘은 다음 메시지 때 다시 열기로 해결.
- discarded alternatives: 환경 카드 안/커넥터 밑 카드: 모드 그리기 자리 15곳에 없음 · 세션 목록: 같은 이유 · 입력칸 위 띠만: 좁아 대시보드 못 담음 · 닫기 막기: 잠깐 치울 수 없음
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-pane-progress/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-22 14:05] wookiya1364 — 앱 오른쪽 SCV 대시보드 칸 — 지금 작업 상세·예상 완료 시간

- verdict: adopted
- why: 앱 오른쪽 별도 SCV 칸(모드 pane)에 표시 — 환경 카드·세션 목록 안은 모드가 그릴 수 없음(문서 확인). 닫힘은 다음 메시지 때 다시 열기로 해결.
- discarded alternatives: 환경 카드 안/커넥터 밑 카드: 모드 그리기 자리 15곳에 없음 · 세션 목록: 같은 이유 · 입력칸 위 띠만: 좁아 대시보드 못 담음 · 닫기 막기: 잠깐 치울 수 없음
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-pane-live/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-22 14:05] wookiya1364 — 앱 오른쪽 SCV 대시보드 칸 — scv:dreams

- verdict: adopted
- why: 앱 오른쪽 별도 SCV 칸(모드 pane)에 표시 — 환경 카드·세션 목록 안은 모드가 그릴 수 없음(문서 확인). 닫힘은 다음 메시지 때 다시 열기로 해결.
- discarded alternatives: 환경 카드 안/커넥터 밑 카드: 모드 그리기 자리 15곳에 없음 · 세션 목록: 같은 이유 · 입력칸 위 띠만: 좁아 대시보드 못 담음 · 닫기 막기: 잠깐 치울 수 없음
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-pane-dreams/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-22 16:09] wookiya1364 — 앱 오른쪽 SCV 대시보드 칸 — 진행률·단계 흐름·막힘·시험 결과 archived

- verdict: archived
- why: SCV 계획 진행을 앱 오른쪽 별도 칸에 상시 표시(모드 pane, 데스크톱 로컬 세션에서만 그려짐 — 원격 보기 세션엔 안 그려짐). 단계 흐름은 누를 수 있는 신호등 노드(앱이 단추 안 글자색을 덮어 색 원은 단추 밖 작은 그림), 막힘은 지금 단계에만, 단계 상세는 계획서 파이프라인 표의 '하는 일' 문장. 맨 위 요약·다음 할 일·시험 결과 저장소 기억 추가.
- path delta: SVG 그래프로 갔다가 노드 클릭 불가(그림 안 누름은 모드에 안 옴) → 누르는 노드 목록으로; 함수 이름 표시는 사용자 요청으로 '하는 일' 문장으로; 진행 경로 줄 끝 — `이름` 약속과 표의 '하는 일' 칸을 새로 둠; 세 계획을 한 모드에 합쳐 구현
- refs: scv/archive/20261022-wookiya1364-scv-dashboard-pane-progress/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-22 16:09] wookiya1364 — 앱 오른쪽 SCV 대시보드 칸 — 지금 작업 상세·예상 완료 시간 archived

- verdict: archived
- why: 진행 중 카드(단계·도구·대상·지난 시간·할 일 n/N)와 예상 완료 시간(단계당 평균 × 남은 단계, 늘 '추정')을 같은 칸에 넣음. 단계 완료 시각은 그 세션에서 본 것만 앎.
- path delta: progress 와 한 모드로 합쳐 구현; 예상 시간은 맨 위 요약 줄에도 표시
- refs: scv/archive/20261022-wookiya1364-scv-dashboard-pane-live/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-22 16:09] wookiya1364 — 앱 오른쪽 SCV 대시보드 칸 — scv:dreams archived

- verdict: archived
- why: 최신 드림 요약·개선점 펼치기·보고서 열기 단추. 요약을 ' · ' 로 나눌 때 괄호 안은 나누지 않음(실제 형식에서 잘리던 결함 고침).
- path delta: as planned (progress 와 한 모드로 합쳐 구현)
- refs: scv/archive/20261022-wookiya1364-scv-dashboard-pane-dreams/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md
