/* net/supabase-transport.js — Supabase Realtime 브로드캐스트 전송체.
   ⚠ 이 파일의 실제 통신은 검증하지 못했다. 제작 환경에서 supabase.co 접속이 차단되어 있어서다.
      프로토콜(net/room.js)은 루프백으로 검증됨. 여기서 깨진다면 원인은 프로토콜이 아니라 연결이다.

   쓰는 법:
     1) 아래 URL / KEY 를 채운다 (anon key 면 충분하다)
     2) Supabase 대시보드에서 Realtime 이 켜져 있으면 끝. 테이블은 필요 없다 — 브로드캐스트만 쓴다.
     3) 단일 파일 빌드(tank-fortress.html)를 쓴다면 supabase-js 를 먼저 실어야 한다:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

   Render 등 다른 백엔드를 쓸 거면 이 파일만 갈아끼운다 (docs/SERVER.md 에 WebSocket 판 전문이 있다).
   요구 조건은 하나: root.makeTransport(code, role, cb) 가
   cb(null, {send(obj), close(), onMessage}) 를 돌려주는 것. */
(function (root) {
  'use strict';

  var URL = '';   // 예: 'https://xxxxx.supabase.co'
  var KEY = '';   // 예: 'eyJhbGciOi...'

  root.makeTransport = function (code, role, cb) {
    if (!URL || !KEY) { cb(new Error('net/supabase-transport.js 에 URL/KEY를 채워 주세요')); return; }
    if (!root.supabase || !root.supabase.createClient) { cb(new Error('supabase-js 가 로드되지 않았습니다')); return; }

    var client = root.supabase.createClient(URL, KEY);
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
