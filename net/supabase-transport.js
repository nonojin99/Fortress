/* net/supabase-transport.js — Supabase Realtime 브로드캐스트 전송체.

   실제 통신 검증됨(2026-08-06): 브라우저 두 개로 같은 방에 붙여
   hello → seats → pick → cmd → start 전 경로가 오갔다. 자리 배정도 호스트 0 / 게스트 1 로 갈렸다.
   프로토콜 자체는 net/room.js 루프백으로 21/21 (4인 방 포함).

   설정 우선순위:
     1) window.TF_SUPABASE = { url, key }   ← 다시 빌드하지 않고 바꿀 수 있다
     2) 아래 URL / KEY 상수                 ← 빌드에 박히는 기본값

   키를 소스에 두는 이유: 키는 어차피 빌드 결과물(index.html)에 그대로 들어가고,
   `sb_publishable_` 은 이름 그대로 클라이언트에 공개되는 키다. 소스에 없으면
   build.py 를 돌릴 때마다 손으로 다시 넣어야 하고, 한 번 잊으면 온라인이 조용히 죽는다.
   실제로 그렇게 한 번 날아갔다 — 빌드 결과물에만 키가 있었고 다음 빌드가 지웠다.
   ※ service_role 키는 절대 여기 두지 않는다. 그건 서버 전용이다.

   CDN 은 반드시 **UMD 빌드**를 써야 window.supabase 가 생긴다.
   기본 배포판(ESM)을 <script src> 로 부르면 전역이 안 생겨 '로드되지 않았습니다' 가 뜬다.
   shell.html 의 <head> 가 그 태그를 싣는다.

   Render 등 다른 백엔드를 쓸 거면 이 파일만 갈아끼운다 (docs/SERVER.md 에 WebSocket 판 전문이 있다).
   요구 조건은 하나: root.makeTransport(code, role, cb) 가
   cb(null, {send(obj), close(), onMessage}) 를 돌려주는 것. */
(function (root) {
  'use strict';

  var URL = 'https://ijmmqmarbkkkssciagof.supabase.co';
  var KEY = 'sb_publishable_-Yw_iVRLOGF0W1CFj_v9SA_PLm301S6';

  function cfg() {
    var c = root.TF_SUPABASE || {};
    return {
      url: (c.url || URL || '').trim(),
      key: (c.key || KEY || '').trim()
    };
  }

  /* supabase-js 는 버전·번들 방식마다 전역 모양이 다르다.
     createClient 가 바로 붙어 있기도 하고 default 아래 있기도 하다.
     한 가지만 가정하면 CDN 버전을 올리는 날 조용히 깨진다. */
  function resolveCreateClient() {
    var s = root.supabase;
    if (!s) return null;
    if (typeof s.createClient === 'function') return s.createClient.bind(s);
    if (s.default && typeof s.default.createClient === 'function') return s.default.createClient.bind(s.default);
    if (typeof s === 'function') return s;
    return null;
  }

  root.makeTransport = function (code, role, cb) {
    var conf = cfg();
    if (!conf.url || !conf.key) {
      cb(new Error('Supabase URL/KEY 가 없습니다. index.html 의 window.TF_SUPABASE 를 채우세요.'));
      return;
    }
    var createClient = resolveCreateClient();
    if (!createClient) {
      cb(new Error('supabase-js 가 로드되지 않았습니다. 네트워크/CDN 차단 여부를 확인하세요.'));
      return;
    }

    var client = createClient(conf.url, conf.key);
    var ch = client.channel('tankfort-' + String(code).toUpperCase(), {
      config: { broadcast: { self: false, ack: true } }
    });

    var tr = {
      onMessage: null,
      send: function (o) { ch.send({ type: 'broadcast', event: 'm', payload: o }); },
      close: function () { try { client.removeChannel(ch); } catch (e) {} }
    };

    ch.on('broadcast', { event: 'm' }, function (p) {
      if (tr.onMessage) tr.onMessage(p.payload);
    });

    var done = false;
    ch.subscribe(function (status) {
      if (done) return;
      if (status === 'SUBSCRIBED') { done = true; cb(null, tr); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        done = true; cb(new Error('채널 연결 실패: ' + status));
      }
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
