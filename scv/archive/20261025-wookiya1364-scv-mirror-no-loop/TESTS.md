# Test Plan — SCV 칸 — 서로 거울 거는 고리 막기

## Overview

나를 보고 있는 세션으로 거울을 걸면 거절하는지, 그 밖에는 그대로인지 확인한다.

## Test scenarios

### T1. 시청자인지 판단

- **Run**: `isViewerOf` 에 시청자 목록 { session_v } 와 'session_v', 'bridge:session_v', ' session_v ', 'session_x'.
- **Expected**: true, true, true, false.
- **Pass criterion**: 네 값이 기대와 같다.

### T2. 나를 보고 있는 세션으로 /scv-mirror 를 치면 보내지 않고 거절한다

- **Setup**: session_viewer 의 HELLO 를 받아 상태를 1번 보낸 작업 세션.
- **Run**: `/scv-mirror session_viewer`.
- **Expected**: 추가로 보낸 메시지 0건, 답에 '이 세션을 거울로 보고 있' 과 '/scv-mirror stop' 이 있다. 칸에 거울 줄이 없다(자기 계획을 계속 그린다).
- **Pass criterion**: env.sent 길이 1 그대로, 답 문구 포함, 그린 글에 '거울:' 없음.

### T3. 나를 보지 않는 세션으로는 그대로 걸린다

- **Setup**: 위와 같음.
- **Run**: `/scv-mirror session_other`.
- **Expected**: HELLO 1건이 session_other 로 나가고 답은 '거울 요청을 보냈습니다'.
- **Pass criterion**: 보낸 글과 답 문구.

## How to run

```bash
cd marketplace/mods/scv-dashboard && claude plugin test .
```

## Pass criteria

- T1~T3 와 기존 시험 90개가 모두 통과한다.
