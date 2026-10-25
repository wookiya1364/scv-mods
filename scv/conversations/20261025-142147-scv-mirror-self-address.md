---
slug: scv-mirror-self-address
started_at: 2026-10-25T05:21:47Z
status: promoted
promoted_to: scv/promote/20261025-wookiya1364-scv-mirror-self-address
---

## Turn 1 — 2026-10-25T05:21:47Z
protocol: 6dd4ea5c

**User**: 첫번째 이미지는 왼쪽이 맥프로, 오른쪽 맥미니 원격이고, 두번째 이미지는 맥미니야 (두 세션 모두에서 /scv-dashboard 로 나온 자기 주소로 /scv-mirror 를 쳤더니 '이 세션 자신' 오류)

**Claude Code**: 두 번 다 자기 주소를 넣어 실패했다. 주소는 보여 줄 작업 세션의 것을, 명령은 볼 세션에서 쳐야 한다. 맥미니 세션에서 맥프로를 보려면 맥미니 세션에서 /scv-mirror session_01Ch9Fr1MTZxpbwbtdQHDy9P. 실패한 요청이 기존 거울을 지워(register.tsx:477) 맥미니 칸이 '계획 없음'으로 돌아갔다(확인). 맥프로 작업 세션 주소가 이전(session_01WGaex…)과 달라짐(확인). 자기 주소 막기·실패 시 기존 거울 유지를 고칠지 선택 창으로 물음.

## Turn 2 — 2026-10-25T05:23:50Z
protocol: 6dd4ea5c

**User**: 추천대로 고치면 뭐가 달라져? → (설명 뒤) 고치기

**Claude Code**: 고치면 (1) 자기 주소를 넣으면 쉬운 한국어로 거절하고 다른 세션 주소를 넣으라고 안내, (2) 요청이 실패해도 걸려 있던 거울은 유지(지금은 꺼짐), (3) /scv-dashboard 안내 문구를 '다른 기기의 세션에서 치세요'로 분명히. 나머지 거울 동작은 그대로(기존 시험 85개). 사용자가 '고치기' 선택 → promote 로 넘김.
