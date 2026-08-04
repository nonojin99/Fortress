# 서버 — Supabase 와 Render 중 하나

온라인 대전에 서버가 하는 일은 **한 가지뿐이다: 같은 방 코드끼리 메시지를 되뿌리는 것.**
승패 판정도, 물리 계산도, 지형 파괴도 서버는 모른다. 전부 클라이언트가 한다.

## A. Supabase (권장)

1. supabase.com 에서 프로젝트 생성
2. Settings → API 에서 Project URL 과 anon public 키 복사
3. `shell.html` / `index.html` 의 `window.TF_SUPABASE` 에 채운다

```js
window.TF_SUPABASE = {
  url: 'https://xxxxxxxx.supabase.co',
  key: 'eyJhbGciOi...'
};
```

테이블/RLS 불필요. Realtime 브로드캐스트만 사용.

## B. Render WebSocket

`server/` 폴더를 Render Web Service 로 배포 후 `net/render-transport.js` 의 WSS_URL 을 채운다.
