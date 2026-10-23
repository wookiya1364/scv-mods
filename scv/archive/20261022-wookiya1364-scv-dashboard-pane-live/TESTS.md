# Test Plan — 앱 오른쪽 SCV 대시보드 칸 — 지금 작업 상세·예상 완료 시간

## Overview

진행 중 카드(단계 이름 + 도구·대상 + 지난 시간), 일하는 중/쉬는 중, 할 일 목록 n/N, 예상 완료 시간(추정)을 검증한다.

## Test scenarios

### T1. 진행 중 카드에 지금 단계 이름 + 도구 + 대상 파일

- **Setup**: 진행 단계 '화면 만들기', Edit 도구가 `hooks/register.tsx` 를 고치는 중
- **Run**: 칸 그리기
- **Expected**: '화면 만들기' 와 'Edit' 와 'register.tsx' 가 보인다
- **Pass criterion**: 세 글자가 모두 화면에 있다

### T2. 도구가 끝나면 '쉬는 중'으로, 차례가 다시 시작되면 '일하는 중'

- **Setup**: turn.start → turn.complete 순서
- **Run**: 각 시점에 칸 그리기
- **Expected**: 시작 뒤 '일하는 중', 끝난 뒤 '쉬는 중'
- **Pass criterion**: 상태 글이 바뀐다

### T3. Bash 는 설명을 먼저, 없으면 명령 앞부분만

- **Setup**: description 있는 Bash / 없는 긴 Bash(200자)
- **Run**: describeTool
- **Expected**: 첫째는 설명, 둘째는 60자 이내로 잘린 명령
- **Pass criterion**: 대상 글이 기대와 같다

### T4. 할 일 목록 n/N 과 지금 항목

- **Setup**: TodoWrite 입력 3개 중 1개 완료, 1개 진행
- **Run**: 칸 그리기
- **Expected**: '할 일 1/3' 과 진행 항목 글
- **Pass criterion**: 두 글이 보인다

### T5. 예상 완료 시간은 단계당 평균 × 남은 단계, '추정' 표시

- **Setup**: 단계 2개가 각각 4분, 6분 걸림, 남은 단계 3
- **Run**: estimateEta
- **Expected**: 약 15분, 근거 '단계 2개 평균'
- **Pass criterion**: 분 값 15, 화면에 '추정'

### T6. 자료가 없으면 '아직 추정 불가'

- **Setup**: 완료 기록 없음
- **Run**: estimateEta + 그리기
- **Expected**: '아직 추정 불가'
- **Pass criterion**: 그 글이 보인다

### T7. 지난 시간 글자 형식

- **Setup**: 130000ms
- **Run**: formatDuration
- **Expected**: '2분 10초'
- **Pass criterion**: 같은 글

## How to run

```bash
cd marketplace/mods/scv-dashboard && claude plugin test .
```

## Pass criteria

- T1~T7 전부 통과

## Related Documents
