# Test Plan — SCV 칸 — 거울 자기 주소 막기와 실패해도 거울 유지

## Overview

자기 주소는 보내지 않고 거절하는지, 실패해도 걸려 있던 거울이 남는지, 안내 문구가 바뀌었는지 확인한다.

## Test scenarios

### T1. 자기 주소 판단

- **Setup**: own = { address: 'session_me', localId: 'local-id' }.
- **Run**: `isOwnAddress` 에 'session_me', 'bridge:session_me', ' local-id ', 'session_other'.
- **Expected**: true, true, true, false.
- **Pass criterion**: 네 값이 기대와 같다.

### T2. 자기 주소로 /scv-mirror 를 치면 보내지 않고 한국어로 거절한다

- **Setup**: Remote Control 주소가 session_viewer 인 세션.
- **Run**: `/scv-mirror session_viewer`, `/scv-mirror bridge:session_viewer`.
- **Expected**: 보낸 메시지 0건, 답에 '이 세션 자신의 주소' 와 '다른 세션' 이 들어 있다. 칸에 거울 줄이 없다.
- **Pass criterion**: env.sent 길이 0, 답 문구 포함.

### T3. 걸려 있던 거울은 자기 주소 실수에도 그대로 남는다

- **Setup**: session_host 를 거울로 보고 상태를 받은 보기 세션.
- **Run**: `/scv-mirror session_viewer`(자기 주소).
- **Expected**: 칸에 여전히 '거울: session_host' 와 작업 세션 계획이 그려진다.
- **Pass criterion**: 그린 글에 두 문구가 있다.

### T4. 다른 세션으로 보내기에 실패해도 걸려 있던 거울은 그대로다

- **Setup**: session_host 를 거울로 보는 보기 세션. 이후 보내기가 실패하도록(isDelivered false).
- **Run**: `/scv-mirror session_gone`.
- **Expected**: 답은 '거울 요청을 보내지 못했습니다', 칸은 여전히 '거울: session_host'.
- **Pass criterion**: 답 문구와 그린 글.

### T5. /scv-dashboard 안내가 다른 기기의 세션에서 치라고 말한다

- **Run**: `/scv-dashboard`.
- **Expected**: 답에 '다른 기기' 와 '다른 세션' 과 '/scv-mirror session_viewer' 가 있다.
- **Pass criterion**: 문구 포함.

## How to run

```bash
cd marketplace/mods/scv-dashboard && claude plugin test .
```

## Pass criteria

- T1~T5 와 기존 시험 85개가 모두 통과한다.
