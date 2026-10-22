# Test Plan — SCV 칸 — 자리 비운 사이 요약과 에이전트별 줄

## Overview

다음을 검증한다.

- 마지막 메시지 뒤에 생긴 일만 세 줄 안으로 묶어 보인다.
- 다음 메시지를 보내면 요약이 새로 시작된다.
- 여러 에이전트가 동시에 일하면 에이전트마다 한 줄씩 보이고, 끝나면 그 줄이 사라진다.

## Test scenarios

### T1. 메시지 뒤에 생긴 일을 세 줄로 요약한다

- **Setup**: 메시지를 보낸 뒤 단계 2개 끝, 시험 2번(실패 1번 뒤 통과), 질문 1개 기다림
- **Run**: 칸을 그린다
- **Expected**: '단계 2개 끝 — …', '시험 2번 — 실패 1번 뒤 통과', '질문 1개 기다림'
- **Pass criterion**: 세 줄이 기대와 같다

### T2. 메시지를 새로 보내면 요약이 비고 카드가 숨겨진다

- **Setup**: T1 상태에서 메시지를 보낸다
- **Run**: 칸을 그린다
- **Expected**: '그 사이' 카드가 없다
- **Pass criterion**: 카드 글자가 화면에 없다

### T3. 그 사이 아무 일도 없으면 카드가 없다

- **Setup**: 메시지를 보낸 뒤 아무 사건 없음
- **Run**: 칸을 그린다
- **Expected**: 카드가 없다
- **Pass criterion**: 카드 글자가 화면에 없다

### T4. 메시지를 보내기 전 일은 들어가지 않는다

- **Setup**: 메시지 1분 전에 시험 1번, 메시지 1분 뒤에 시험 1번
- **Run**: 칸을 그린다
- **Expected**: '시험 1번'
- **Pass criterion**: 기준 시각 뒤 것만 센다

### T5. 오류 멈춤과 허락 기다림도 셋째 줄에 나온다

- **Setup**: 메시지 뒤에 오류로 멈춤 / 허락 기다림
- **Run**: 칸을 그린다
- **Expected**: '오류로 멈춤' / '허락 기다림 — Bash'
- **Pass criterion**: 셋째 줄이 기대와 같다

### T6. 에이전트 2개가 동시에 도구를 쓰면 메인 줄과 에이전트 줄 2개가 보인다

- **Setup**: 메인은 Read, 에이전트 A는 Grep, 에이전트 B는 Bash를 쓰는 중
- **Run**: 칸을 그린다
- **Expected**: 메인 줄 + 에이전트 2줄(이름 · 도구 · 대상 · 지난 시간)
- **Pass criterion**: 세 줄이 모두 보인다

### T7. 에이전트가 끝나면 그 줄이 사라진다

- **Setup**: T6에서 에이전트 A가 끝난다
- **Run**: 칸을 그린다
- **Expected**: 에이전트 B 줄만 남는다
- **Pass criterion**: A의 줄이 없다

### T8. 에이전트가 6개면 5줄과 '+1개 더'

- **Setup**: 에이전트 6개가 일하는 중
- **Run**: 칸을 그린다
- **Expected**: 에이전트 줄 5개 + '+1개 더'
- **Pass criterion**: 줄 수와 글이 같다

### T9. 에이전트 안 도구가 메인 줄을 덮어쓰지 않는다

- **Setup**: 메인은 Edit 중, 에이전트가 Read를 시작한다
- **Run**: 칸을 그린다
- **Expected**: 메인 줄은 여전히 Edit, 에이전트 줄은 Read
- **Pass criterion**: 두 줄이 서로 다르다

### T10. 지금 있는 시험이 계속 통과한다

- **Run**: 시험 전체를 돌린다
- **Pass criterion**: 기존 시험이 모두 통과한다

## How to run

```bash
cd marketplace/mods/scv-hello && claude plugin test .
```

## Pass criteria

- T1~T10 전부 통과
- 맥 앱 확인(PLAN의 Exit criteria)

## Related Documents

- PLAN.md
