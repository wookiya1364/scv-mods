# Test Plan — 앱 오른쪽 SCV 대시보드 칸 — scv:dreams

## Overview

드림 요약 한 줄, 개선점 펼치기, 보고서 열기, 드림 없음 안내를 검증한다.

## Test scenarios

### T1. 최신 드림 요약 한 줄이 보인다

- **Setup**: latest.json `{date:"20261022", summary:"[SCV 드림] 아직 셀 것이 없음(…) · 개선점: 완료 기준 비율 0/7(0%) · 보고서 scv/dreams/x.html", report:"scv/dreams/x.html"}`
- **Run**: 칸 그리기
- **Expected**: 첫 항목(아직 셀 것이 없음…)과 날짜 2026-10-22 가 보인다
- **Pass criterion**: 두 글이 화면에 있다

### T2. 개선점 펼치기

- **Setup**: T1 과 같음, 접힌 상태
- **Run**: '개선점 펼치기' 누름
- **Expected**: '개선점: 완료 기준 비율 0/7(0%)' 줄이 나타남, 다시 누르면 사라짐
- **Pass criterion**: press 뒤 줄 유무가 바뀐다

### T3. 보고서 열기 버튼이 보고서 경로로 브라우저를 연다

- **Setup**: T1 과 같음
- **Run**: '보고서 열기' 누름
- **Expected**: 열기 명령(xdg-open 또는 open)이 보고서의 전체 경로로 불린다
- **Pass criterion**: 프로세스 호출 인자에 '<작업 폴더>/scv/dreams/x.html'

### T4. 드림이 없으면 안내

- **Setup**: latest.json 없음
- **Run**: 칸 그리기
- **Expected**: '아직 드림 없음' 과 '/scv:dreams' 안내
- **Pass criterion**: 안내 글이 보인다

### T5. parseDreams 는 앞머리를 떼고 ' · ' 로 나눈다

- **Setup**: T1 의 summary
- **Run**: parseDreams
- **Expected**: 항목 3개, 첫 항목에 '[SCV 드림]' 없음, 보고서 항목은 목록에서 빠지고 reportPath 로
- **Pass criterion**: 배열이 기대와 같다

## How to run

```bash
cd marketplace/mods/scv-hello && claude plugin test .
```

## Pass criteria

- T1~T5 전부 통과

## Related Documents
