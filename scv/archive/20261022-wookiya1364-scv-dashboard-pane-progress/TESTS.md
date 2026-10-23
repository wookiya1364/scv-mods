# Test Plan — 앱 오른쪽 SCV 대시보드 칸 — 진행률·단계 흐름·막힘·시험 결과

## Overview

대화에서 정한 기능(진행률 n/N, 단계 흐름 4가지 상태, 막힘 카드 2종, 시험 결과 목록, 펼쳐 보기, 계획 고르기, 항상 표시)이 데스크톱 화면에서 그려지고 눌리는지 검증한다. 순수 함수는 단위 시험, 화면은 `claude-code/testing` 의 mount 로 데스크톱 표면에서 검증한다.

## Test scenarios

### T1. 진행률은 진행 경로 단계 중 끝난 수 / 전체

- **Setup**: 진행 경로 11단계 중 5단계에 완료 표시가 있는 PLAN.md, 상태 in_progress
- **Run**: 칸을 desktop 표면으로 그린다
- **Expected**: '5/11' 글자와 막대가 보인다
- **Pass criterion**: 화면에서 '5/11' Text 를 찾는다

### T2. 단계 흐름이 완료·진행·막힘·대기를 구분

- **Setup**: 완료 표시 2개, 진행 표시 1개, 막힘 표시 1개, 나머지 표시 없음
- **Run**: deriveStages + 화면 그리기
- **Expected**: 각 단계가 완료/진행/막힘/대기 로 나온다
- **Pass criterion**: 단계 상태 배열이 기대값과 같고, 화면에 네 상태 이름이 모두 보인다

### T2b. 단계 흐름 — 누를 수 있는 노드가 선으로 이어지고 지금 멈춘 곳에 표시

- **Setup**: 완료 · 진행 · 대기 3단계
- **Run**: 칸 그리기
- **Expected**: 단계마다 신호등 색 원(작은 그림, 완료 초록·진행 노랑·막힘 빨강·대기 빈 회색)과 다음 단계로 가는 선(완료 뒤 실선, 그 밖 점선), 단계 이름은 누를 수 있는 단추, 상태 글도 같은 색, '지금 여기' 는 진행 단계에 1번
- **Pass criterion**: 노드 버튼 3개와 각 글, 연결선, '지금 여기' 1개

### T2c. 막힘은 지금 단계에만

- **Setup**: 완료 뒤 [!] 단계 / 진행 단계 뒤 [!] 단계 / 내 답 대기 중
- **Run**: deriveStages · applyBlocks · 화면 그래프
- **Expected**: 지금 단계의 [!] 만 막힘, 그 뒤 [!] 는 대기, 답 대기 중엔 지금 단계가 막힘으로 그려짐
- **Pass criterion**: 상태 배열 + 그래프 alt 가 기대와 같다

### T3. 표시가 없으면 계획 상태로 짐작하고 '추정'을 붙인다

- **Setup**: 표시 없는 PLAN, 상태 planned / in_progress / done 각각
- **Run**: deriveStages
- **Expected**: planned → 전부 대기, in_progress → 1단계 진행·나머지 대기, done → 전부 완료, 화면에 '추정'
- **Pass criterion**: 세 경우 모두 기대 상태 + 화면에 '추정' Text

### T4. 내 답을 기다리면 막힘 카드

- **Setup**: AskUserQuestion 호출이 답을 기다리는 중(질문 'X 할까요?')
- **Run**: 칸 그리기
- **Expected**: '답을 기다리는 중' 막힘 카드에 질문 글이 보인다. 답이 오면 카드가 사라진다
- **Pass criterion**: 호출 중엔 카드 Text 가 있고, 끝난 뒤엔 없다

### T5. 시험이 실패하면 막힘 카드 + 실패한 시나리오

- **Setup**: 시험 명령(Bash) 실행이 실패로 끝나고 출력에 '(fail) T2 ...'
- **Run**: 칸 그리기
- **Expected**: '시험 실패' 막힘 카드에 T2 가 보인다
- **Pass criterion**: 카드 Text 에 'T2' 포함

### T6. 시험 결과 목록은 TESTS.md 시나리오마다 통과·실패·결과 없음

- **Setup**: TESTS.md 에 T1~T3, 시험 출력에 T1 통과·T2 실패, T3 언급 없음
- **Run**: mergeTests + 화면
- **Expected**: T1 통과, T2 실패, T3 결과 없음
- **Pass criterion**: 세 줄의 결과 글이 기대와 같다

### T7. 단계 노드를 누르면 그 단계가 하는 일과 한 일이 보인다

- **Setup**: 파이프라인 표에 '하는 일' 칸(쉬운 말), 단계 줄 끝의 — `parsePlans`, — `render`, 진행 중 단계에서 Edit 한 번
- **Run**: 칸 그리기 → 1단계 노드 누름 → 다시 누름
- **Expected**: 기본은 지금 단계 상세(• 정리된 값을 오른쪽 칸 화면으로 그린다, Edit: view.tsx), 함수 이름·순수/부수효과 글은 보이지 않음, 1 누르면 1단계 상세, 다시 누르면 닫힘. '하는 일' 칸이 없으면 '받음: … · 내놓음: …'
- **Pass criterion**: press 전후 상세 Text 가 기대와 같다

### T8. 계획이 여러 개면 선택 항목으로 고른다

- **Setup**: promote 폴더 2개(in_progress, planned)
- **Run**: 기본 화면 → Select 로 다른 계획 선택
- **Expected**: 기본은 in_progress 계획, 고른 뒤 그 계획 제목이 보인다
- **Pass criterion**: select 뒤 제목 Text 가 바뀐다

### T9. 항상 표시 — 세션 시작 때 열리고 닫혀도 다음 메시지 때 다시 열림

- **Setup**: 칸 닫힌 상태
- **Run**: 세션 시작, 메시지 제출
- **Expected**: 두 경우 모두 ui.open 이 불린다. 열려 있으면 다시 열지 않는다
- **Pass criterion**: ui.open 호출 기록

### T10. 프로젝트 파일을 쓰지 않는다

- **Setup**: 위 시나리오 전체
- **Run**: 모듈 소스 검사
- **Expected**: `$.fs.write` 호출이 없다
- **Pass criterion**: 소스에 `fs.write` 문자열 없음

### T11. 계획이 없으면 확인한 폴더 경로를 보여 준다

- **Setup**: scv/promote 가 빈 폴더
- **Run**: 칸 그리기
- **Expected**: '계획이 없습니다' 안내와 '확인한 곳: <작업 폴더>/scv/promote'
- **Pass criterion**: 두 Text 가 보인다

### T12. 맨 위 한 줄 요약 · 상태 쉬운 말 · 다음 할 일과 명령 복사

- **Setup**: 단계 모두 완료 + 상태 testing
- **Run**: 칸 그리기 → '명령 복사' 누름
- **Expected**: '모든 단계 끝 · 막힘 없음 · 남은 단계 없음', '상태: 단계 끝 · 시험 확인 중', '다음: 모든 단계 끝 — 보관하기', 복사된 글 '/scv:work <slug> --archive'
- **Pass criterion**: 세 Text + 복사 기록

### T13. 시험 결과는 세션을 넘어 기억된다

- **Setup**: 모드 저장소에 이 폴더의 2시간 전 통과 기록
- **Run**: 세션 시작 → 칸 그리기 → 시험 한 번 더
- **Expected**: '마지막 실행: 통과 · 2시간 0분 전', 저장소 기록 2개
- **Pass criterion**: Text + 저장소 길이

### T14. 답 대기 · 시험 실패 때 알림 한 번

- **Setup**: 질문 하나, 실패하는 시험 하나
- **Run**: 두 호출 → 앱 알림이 안 되는 경우 한 번 더
- **Expected**: 알림 글 '답을 기다리는 중 — Q?', '시험 실패 — T2'; 앱 알림이 안 되면 시스템 알림 명령
- **Pass criterion**: 알림 기록 + 프로세스 기록

### T15. 진행률 막대도 신호등 색

- **Setup**: 모두 완료 / 진행 중 / 막힘
- **Run**: barColor
- **Expected**: 초록 / 노랑 / 빨강
- **Pass criterion**: 색 값 일치

## How to run

```bash
cd marketplace/mods/scv-dashboard && claude plugin test .
```

## Pass criteria

- T1~T15(T2b·T2c 포함) 전부 통과, 타입 검사 통과, `claude plugin validate` 통과

## Related Documents
