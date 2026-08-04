/* net/room.js — 온라인 대전의 규약. 전송 수단은 모른다.
   필요한 것은 딱 하나: root.makeTransport(code, role, cb) 가 cb(null, {send, close, onMessage}) 를 주는 것.
   그래서 Supabase Realtime 이든 Render 위의 WebSocket 이든, 이 파일은 손대지 않고 갈아끼운다.

   권위 모델: 호스트 권위.
     · 두 쪽 모두 같은 시드로 같은 Match 를 만든다 → 지형·바람·물리가 같다
     · 조작하는 쪽이 명령({t:'aim'}...)을 보내고, 받는 쪽은 자기 Match 에 그대로 먹인다
     · 턴이 바뀔 때마다 호스트가 스냅샷을 흘려보낸다. 어긋남은 한 턴 안에서 끝난다
   상태 전체를 매 프레임 보내지 않는 이유는 대역폭이 아니라 지연이다.
   포탄이 나는 3초를 네트워크로 중계하면 그 3초가 통째로 렉이 된다. 명령만 보내면 각자 자기 화면에서 즉시 난다. */
(function (root) {
  'use strict';

  function Room() {
    this.tr = null; this.role = null; this.code = null;
    this.onStart = null; this.onCmd = null; this.onSync = null;
    this.onPeer = null; this.onError = null;
    this.ready = false; this.peerReady = false;
    this.divergences = 0;
  }

  Room.prototype.open = function (code, role, cb) {
    var self = this;
    if (typeof root.makeTransport !== 'function') {
      cb(new Error('전송체가 없습니다. net/supabase-transport.js 에 URL/KEY 를 채우세요.'));
      return;
    }
    this.code = String(code || '').toUpperCase();
    this.role = role;
    root.makeTransport(this.code, role, function (err, tr) {
      if (err) { cb(err); return; }
      self.tr = tr;
      tr.onMessage = function (msg) { self.recv(msg); };
      self.ready = true;
      tr.send({ t: 'hello', role: role });
      cb(null, self);
    });
  };

  Room.prototype.recv = function (m) {
    if (!m || !m.t) return;
    switch (m.t) {
      case 'hello':
        this.peerReady = true;
        if (this.tr) this.tr.send({ t: 'hi', role: this.role });
        if (this.onPeer) this.onPeer(m.role);
        break;
      case 'hi':
        this.peerReady = true;
        if (this.onPeer) this.onPeer(m.role);
        break;
      case 'start': if (this.onStart) this.onStart(m.cfg); break;
      case 'cmd': if (this.onCmd) this.onCmd(m.c); break;
      case 'sync': if (this.onSync) this.onSync(m.s, m.h); break;
      case 'bye': if (this.onError) this.onError(new Error('상대가 나갔습니다')); break;
    }
  };

  Room.prototype.send = function (o) { if (this.tr) this.tr.send(o); };
  Room.prototype.start = function (cfg) { this.send({ t: 'start', cfg: cfg }); };
  Room.prototype.cmd = function (c) { this.send({ t: 'cmd', c: c }); };
  Room.prototype.sync = function (snap, hash) { this.send({ t: 'sync', s: snap, h: hash }); };
  Room.prototype.close = function () {
    if (this.tr) { try { this.tr.send({ t: 'bye' }); this.tr.close(); } catch (e) {} }
    this.tr = null; this.ready = false;
  };

  function loopback() {
    var a = new Room(), b = new Room();
    a.tr = { send: function (o) { setTimeout(function () { b.recv(JSON.parse(JSON.stringify(o))); }, 0); }, close: function () {} };
    b.tr = { send: function (o) { setTimeout(function () { a.recv(JSON.parse(JSON.stringify(o))); }, 0); }, close: function () {} };
    a.role = 'host'; b.role = 'guest'; a.ready = b.ready = true;
    return { host: a, guest: b };
  }

  function makeCode() {
    var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', o = '';
    for (var i = 0; i < 5; i++) o += s[(Math.random() * s.length) | 0];
    return o;
  }

  root.TFNet = { Room: Room, loopback: loopback, makeCode: makeCode };
})(typeof globalThis !== 'undefined' ? globalThis : this);
