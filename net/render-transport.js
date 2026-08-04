/* net/render-transport.js — Render(또는 아무 WebSocket 호스트) 용 전송체.
   supabase-transport.js 와 완전히 교체 가능하다. 둘 중 하나만 로드하면 된다.
   빌드에 넣으려면 build.py 의 FILES 에서 supabase-transport.js 를 이 파일로 바꾼다.

   서버는 server/relay.js 다. 하는 일은 하나 — 같은 방 코드끼리 메시지를 그대로 되뿌린다.
   게임 규칙을 서버가 알 필요는 없다. 판정은 양쪽 클라이언트가 각자 하고,
   호스트 스냅샷으로 맞춘다 (net/room.js 참고).

   WSS_URL 을 채운다. 예: 'wss://tankfort-relay.onrender.com'          */
(function (root) {
  'use strict';

  var WSS_URL = '';        // 예: 'wss://tankfort-relay.onrender.com'
  var RETRY_MS = 1200;

  root.makeTransport = function (code, role, cb) {
    if (!WSS_URL) { cb(new Error('net/render-transport.js 에 WSS_URL 을 채워 주세요')); return; }

    var url = WSS_URL.replace(/\/+$/, '') + '/ws?room=' + encodeURIComponent(String(code).toUpperCase()) +
      '&role=' + encodeURIComponent(role);
    var ws, done = false, closed = false;
    var queue = [];

    var tr = {
      onMessage: null,
      send: function (o) {
        var s = JSON.stringify(o);
        if (ws && ws.readyState === 1) ws.send(s);
        else queue.push(s);              // 재접속 중이면 쌓아 둔다. 명령은 하나도 버리면 안 된다
      },
      close: function () { closed = true; if (ws) try { ws.close(); } catch (e) {} }
    };

    function connect() {
      ws = new WebSocket(url);
      ws.onopen = function () {
        while (queue.length) ws.send(queue.shift());
        if (!done) { done = true; cb(null, tr); }
      };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && m.t === '_pong') return;
        if (tr.onMessage) tr.onMessage(m);
      };
      ws.onerror = function () {
        if (!done) { done = true; cb(new Error('릴레이 연결 실패: ' + url)); }
      };
      ws.onclose = function () {
        /* Render 무료 플랜은 유휴 인스턴스를 재우고, 그때 소켓이 끊긴다.
           끊김 자체는 정상 동작으로 보고 다시 붙는다 — 판은 클라이언트에 있으므로 이어서 계속된다. */
        if (!closed) setTimeout(connect, RETRY_MS);
      };
    }
    connect();

    /* 유휴 종료 방지. Render 는 일정 시간 트래픽이 없으면 인스턴스를 내린다. */
    setInterval(function () {
      if (!closed && ws && ws.readyState === 1) ws.send('{"t":"_ping"}');
    }, 25000);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
