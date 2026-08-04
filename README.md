# 강철 포화 (Tank Fortress)

포트리스2 방식의 2D 전차 포격 게임. 각도와 게이지로 쏘고, 땅이 파이며, 낙사로도 이긴다.

## 플레이

1. `python build.py` 로 `index.html` 생성
2. 브라우저에서 `index.html` 또는 `dev.html` 열기

온라인 대전은 Supabase Realtime 사용 — `shell.html` 의 `window.TF_SUPABASE` 에 URL/KEY 를 채운다. 자세한 내용은 [docs/SERVER.md](docs/SERVER.md).

## 조작

| 키 | 동작 |
|---|---|
| ← → | 이동 (연료) |
| ↑ ↓ | 포신 각도 |
| Space | 길게 눌러 게이지, 떼면 발사 |
| 1 / 2 | 메인 / 보조 무기 |
| 3~9 | 아이템 |
| Z | 좌우 전환 |
| Enter | 턴 넘기기 |

## 구성

- `logic/` — 맵·전차·무기·물리·AI (결정론)
- `render/` — 화면·카메라·이펙트
- `net/` — 방 프로토콜 + Supabase 전송체
- `art/` — 카툰 전차 스프라이트·맵 배경
- `server/` — Render WebSocket 중계 (선택)
