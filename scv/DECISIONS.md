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

## [2026-10-23 00:09] wookiya1364 — SCV 칸 — 진행률이 실제 작업 중에 움직이기

- verdict: adopted
- why: Claude가 단계를 시작·끝낼 때 모드 도구로 신호를 보내고 모드는 그 신호를 자기 저장소에만 둔다 — 계획서 표시와 합쳐 진행률·단계 흐름·예상 시간이 작업 중에 움직인다. 프로젝트 파일을 바꾸지 않는 길이라 골랐다.
- discarded alternatives: Claude가 계획서에 ✓를 적기 — 계획서 파일이 바뀜 / SCV가 단계 완료를 직접 기록 — 이 모드만으로 못 함 / Claude 할 일 목록으로 세기 — 이 세션에 할 일 도구가 없음 / 파일 변화로 단계 맞히기 — 추측
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-step-signal/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-23 00:09] wookiya1364 — SCV 칸 — 끝·오류·허락 기다림 알림과 휴대폰 알림

- verdict: adopted
- why: 2분 넘게 걸린 메인 차례의 끝, 오류·거절 멈춤, 허락 창을 알리고 Claude 자체 알림 도구로 휴대폰(원격 연결 시)까지 보낸다. 에이전트 차례를 메인 차례로 착각하지 않게 한다.
- discarded alternatives: 매번 알림 — 짧은 답마다 울림 / 5분 기준 — 2~5분짜리 일의 끝을 놓침 / 외부 알림 서비스 — 내용이 밖으로 나감
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-alerts/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-23 00:09] wookiya1364 — SCV 칸 — 자리 비운 사이 요약과 에이전트별 줄

- verdict: adopted
- why: 마지막 메시지 뒤에 생긴 일(끝난 단계·시험·기다림·멈춤)을 세 줄로 묶고, 동시에 일하는 에이전트마다 한 줄씩(5줄까지) 보인다. 다음 메시지를 보내면 요약이 새로 시작해 쌓이지 않는다.
- discarded alternatives: 지난 1시간 기준 — 오래 비우면 앞부분이 빠짐 / 에이전트별 줄은 나중으로 — 사용자가 1~7 모두 구현을 고름
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-work-view/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-23 00:09] wookiya1364 — SCV 칸 — 다음 할 일 입력창 넣기와 사용 한도

- verdict: adopted
- why: 다음 명령을 입력창에 넣되 사용자 글은 지우지 않고(못 넣으면 복사), 차례 끝에 Tab 제안을 띄운다. 5시간·7일 한도 %와 초기화 시각을 보이고 90%에서 기간마다 한 번 알린다.
- discarded alternatives: 80% 기준 — 이른 알림 / 표시만 — 한도 직전을 놓칠 수 있음 / 복사 버튼만 유지 — 붙여 넣기 단계가 남음
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-prompt-usage/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-23 08:05] wookiya1364 — SCV 칸 다음 기능 — 구현하며 배운 것

- verdict: lesson
- why: 신호는 세션 값이 아니라 모드 저장소를 먼저 읽고 한 번에 하나씩 쓴다 — 연달아·동시에 온 신호가 사라지는 것을 시험(T5·T3b)이 잡음. 예상 시간은 단계마다 시작 신호부터 재고, 30초 안에 몰아 보고한 끝은 시간으로 치지 않는다 — 몰아 보내면 '약 1초 남음'이 나왔을 것. 칸은 세션 뿌리(셸 cd 로 안 움직임)에서 가장 가까운 scv 폴더를 따른다 — 이 세션에서 모드가 하위 폴더 기준으로 다시 시작돼 계획을 못 찾은 것을 확인함(다시 시작된 이유는 확인 못 함). 시험 틀에서는 시험용 도구 안에서 다시 도구를 부를 수 없어, 허락 기다림 시험은 실제 순서(허락 요청 → 도구 끝)로 썼다.
- path delta: ① 저장소 우선 기록 · 한 번에 하나씩 · 단계 시간 계산(stepTimesFromSignals → stepDurationsFromSignals) · 세션 뿌리에서 scv 폴더 찾기를 더함. ② 계획대로(허락 기다림은 허락 요청 신호로, 알림은 휴대폰 길 추가). ③ 계획대로(그 사이 기준 시각에 그때 끝나 있던 단계도 함께 저장). ④ 계획대로(7일 한도는 90% 넘을 때만 초기화 날짜 표시).
- refs: scv/promote/20261022-wookiya1364-scv-dashboard-step-signal/PLAN.md, scv/promote/20261022-wookiya1364-scv-dashboard-alerts/PLAN.md, scv/promote/20261022-wookiya1364-scv-dashboard-work-view/PLAN.md, scv/promote/20261022-wookiya1364-scv-dashboard-prompt-usage/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-23 10:29] wookiya1364 — scv-mods 릴리스 관리 — 버전 · 노트 · 태그 · 두 갈래

- verdict: adopted
- why: 모드 버전이 커밋 번호로만 보여 헷갈린다. SCV처럼 버전 번호(모드 설정 파일 한 곳) · 버전별 노트 · 공식 태그(claude plugin tag) · 릴리스 스크립트 하나로 한 번에 한다. develop 에서 일하고 main 은 릴리스 때만 앞당겨, 같은 번호면 늘 같은 파일이 된다.
- discarded alternatives: main 하나 그대로 — 새로 설치하는 컴퓨터가 같은 번호로 다른 파일을 받을 수 있음; SCV와 똑같은 세 갈래 · 자동 승격 — gh 가 있어야 하고 혼자 쓰는 비공개 저장소에 무거움; 마켓 목록에도 버전 — 공식 문서가 두 곳에 적지 말라고 함; SCV식 v0.1.0 태그 — 모드가 여럿이면 이름이 겹침; 릴리스 페이지 없이 — 사용자가 자동 생성을 고름
- refs: scv/promote/20261023-wookiya1364-scv-mods-release/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-23 11:07] wookiya1364 — scv-hello → scv-dashboard 이름 변경 · 저장소 공개 유지 · 첫 릴리스 페이지

- verdict: adopted
- why: 사용자가 'scv-hello' 이름을 싫어해 첫 릴리스 전에 scv-dashboard 로 바꿨다(마켓에 renames 표). 보관된 계획 3개의 시험 명령은 사용자가 고른 예외로 경로 한 줄만 고쳤다(내용 · 다른 기록 그대로). 저장소가 공개로 확인됐고, 사용자는 다른 사람도 쓰게 공개를 유지하기로 했다. 첫 태그는 자동 작업이 놓쳐(실행 0건) 같은 명령을 로그인된 gh 로 돌려 페이지를 만들고, 손으로 돌리는 버튼(workflow_dispatch)을 더했다.
- discarded alternatives: 옛 이름 연결(링크) 하나 남기기 — 싫어하는 이름이 저장소에 남음(사용자가 경로 고침을 고름); 폴더 이름은 그대로 — 폴더와 모드 이름이 달라 헷갈림; 보이는 이름(displayName)만 — /scv:mods · 도구 · 명령에 옛 이름이 남음; 비공개로 되돌리기 — 다른 사람이 설치 못 함; 0.1.0 페이지를 다음 릴리스까지 미룸 — 사용자가 지금 만들기를 고름
- refs: scv/promote/20261023-wookiya1364-scv-mods-release/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-23 11:13] wookiya1364 — scv-mods 릴리스 관리 — 버전 · 노트 · 태그 · 두 갈래 archived

- verdict: archived
- why: 모드 버전은 plugin.json 한 곳에만 적고 scripts/release.sh 로만 바꾼다. 확인을 모두 먼저 하고, 시험 · 버전 적기 · 검사 · 커밋 · 공식 태그(<mod>--v<version>) · main 앞당기기를 한 번에 하며, 올리기 전 단계가 틀리면 되돌린다. 일은 develop, main 은 릴리스 때만. 첫 릴리스 scv-dashboard 0.1.0 — 버전을 고정하면 번호가 바뀔 때만 업데이트되니, 다른 컴퓨터에서 새 작업을 확인하려면 릴리스가 필요하다. 앞으로 깨면 안 되는 것: 보통 커밋에서 버전을 바꾸지 않기, main 은 앞당기기로만.
- path delta: 올리기 직전 사용자가 이름을 문제 삼아, 첫 릴리스 전에 scv-hello → scv-dashboard 로 바꿨다(마켓 renames, 다른 계획 7개 시험 명령 경로 — 보관된 3개는 사용자 예외). 끝 기준 '84ae8d4b5ca9 → 0.1.0 업데이트'는 '새 이름으로 설치'로 바뀌었고, 실제로는 마켓 갱신 때 Claude Code 가 옛 설치를 스스로 지워 지우기 단계가 필요 없었다. 자동 작업은 같은 push 에서 1초 늦게 등록돼 첫 태그를 놓쳤고(실행 0건), 0.1.0 페이지는 사용자 승인 뒤 로그인된 gh 로 같은 명령을 돌려 만들었다. 손으로 돌리기(workflow_dispatch)는 develop 에만 있고 main 에는 다음 릴리스 때. 저장소는 비공개가 아니라 공개였고 사용자가 공개를 유지하기로 했다.
- refs: scv/archive/20261023-wookiya1364-scv-mods-release/PLAN.md
- conversation: scv/conversations/20261022-102049-read-shared-claude-link.md

## [2026-10-25 14:11] wooki — SCV 칸 — 거울 줄 줄이기와 거울 칸 동작 넘기기

- verdict: adopted
- why: 앱이 컴퓨터 간 세션 메시지마다 '다른 세션' 줄을 그리고 consumed 로도 못 막으므로, 바뀔 때만·최소 10초 간격으로 보내 줄 수를 줄인다. 거울 칸의 입력창 넣기·보고서 열기는 ACT 로 작업 세션에 맡기고, 명령은 작업 세션이 자기 상태로 계산한다.
- discarded alternatives: 줄 0개 — 세션 메시지를 쓰는 한 모드로 불가 / 같은 컴퓨터 $.store 통로 — 이번 구성은 두 컴퓨터라 해당 없음 / ACT 에 명령 글자 싣기 — 메시지를 믿게 되어 버림 / fast-path — 함수 여러 개라 기준 밖
- refs: scv/promote/20261025-wookiya1364-scv-dashboard-mirror-two-way/PLAN.md

## [2026-10-25 14:16] wooki — SCV 칸 — 거울 줄 줄이기와 거울 칸 동작 넘기기 archived

- verdict: archived
- why: 작업 세션은 바뀐 상태만 최소 10초 간격으로 보내고, 보기 세션은 10분 무소식일 때만 다시 요청한다. 시청자 목록은 $.state 에 있어 모드 재적재에도 남는다. 거울 칸의 입력창 넣기·보고서 열기는 ACT 로 작업 세션이 하고, 명령은 작업 세션이 slug 로 다시 계산한다 — 메시지의 글자를 명령으로 믿지 않는 것은 앞으로도 지킨다.
- path delta: 시험을 먼저 실패시키지 않고 구현 뒤에 붙였다(순서만 다름). 시험 하네스에 mock.clock 옵션을 더해 3초 새로 고침을 직접 돌렸다. viewer 메모는 '입력창(작업 세션)…' 으로 시작하게 바꿔 기존 메모 분류(isActionNote)에 맞췄다.
- refs: scv/archive/20261025-wookiya1364-scv-dashboard-mirror-two-way/PLAN.md
