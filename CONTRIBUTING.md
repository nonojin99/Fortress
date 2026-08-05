# 고치고 배포하기

## 배포에 필요한 것은 `index.html` 하나다

아트(1.1MB)·로직·렌더러가 전부 인라인된 자립형 파일이다.
GitHub Pages 든 정적 호스팅이든 이 파일만 있으면 게임이 돈다.

나머지 폴더는 전부 소스·빌드·개발 도구다.

| 경로 | 배포 | 무엇 |
|---|---|---|
| `index.html` | **필수** | 빌드 산출물. 이것만으로 게임이 돈다 |
| `logic/` `render/` `net/` | — | 소스. `index.html` 에 인라인됨 |
| `art/art.js` | — | 스프라이트 번들. 빌드 입력 |
| `shell.html` `build.py` | — | 빌드 입력·스크립트 |
| `sim/` `tools/` `dev.html` | — | 테스트·개발 도구 |
| `docs/` | — | 문서 |
| `server/` | Render 쓸 때만 | WebSocket 중계기. Supabase 를 쓰면 불필요 |
| `unreal/` | — | 별개 언리얼 플러그인 |

외부 런타임 의존은 supabase-js CDN 하나뿐이고(온라인 대전용, unpkg 폴백 포함),
막혀도 싱글 대전은 그대로 돈다.

## 고치는 순서

```bash
python build.py
```

`shell.html` + `logic/` `render/` `net/` `art/art.js` 를 묶어
`index.html`, `dev.html`, 그리고 상위 폴더의 `tank-fortress.html` 을 만든다.

**소스를 고쳤으면 반드시 다시 빌드하고 `index.html` 을 같이 커밋한다.**
빌드를 빼먹으면 저장소의 소스와 배포본이 갈리고, 그 상태는 겉으로 안 보인다.
실제로 한 번 그렇게 배포본이 소스보다 몇 주 앞선 채로 굳었다.

### 빌드 산출물만 손대지 말 것

`index.html` 을 직접 편집하면 다음 `python build.py` 가 조용히 지운다.
Supabase 키를 빌드 결과물에만 넣었다가 그렇게 한 번 날아갔다.
바꿀 것은 언제나 소스 쪽이다 — 키는 `net/supabase-transport.js`,
`<head>` 태그는 `shell.html`.

키만 빠르게 바꿔 보고 싶으면 다시 빌드하지 않고 이렇게도 된다:

```html
<script>window.TF_SUPABASE = { url: '...', key: '...' };</script>
```

## 검증

브라우저에서 두 파일을 연다. 서버가 필요하면 `python tools/devserver.py 8731`.

| 파일 | 무엇을 보는가 |
|---|---|
| `sim/test.html` | 물리·지형·승패·아이템·밸런스 게이트 (114) |
| `sim/net-test.html` | 온라인 프로토콜, 4인 방 자리 배정, 결정론 (21) |

제목 표시줄이 `ALL PASS` 가 되어야 한다.

`sim/test.html` 의 8c 절은 전차 10종을 8판 × 3맵으로 맞붙여 실제 승률을 잰다.
표본이 좁으면 이 게이트는 밸런스가 아니라 잡음을 재게 되므로 줄이지 말 것 —
한때 한 맵 3판이었고, 같은 코드가 85% 와 63% 를 오갔다.

## 온라인 대전

Supabase Realtime 브로드캐스트만 쓴다. 테이블도 RLS 도 필요 없다.
서버가 하는 일은 같은 방 코드끼리 메시지를 되뿌리는 것뿐이고,
물리·승패는 전부 클라이언트가 각자 계산한다. 자세한 것은 [docs/SERVER.md](docs/SERVER.md).

CDN 은 반드시 **UMD 빌드**여야 한다(`dist/umd/supabase.js`).
기본 배포판은 ESM 이라 `<script src>` 로 불러도 `window.supabase` 전역이 안 생기고,
그러면 온라인만 조용히 죽는다.
