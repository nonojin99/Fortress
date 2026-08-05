/* net/room.js — 온라인 대전의 규약. 전송 수단은 모른다.
   필요한 것은 딱 하나: root.makeTransport(code, role, cb) 가 cb(null, {send, close, onMessage}) 를 주는 것.
   그래서 Supabase Realtime 이든 Render 위의 WebSocket 이든, 이 파일은 손대지 않고 갈아끼운다.

   권위 모델: 호스트 권위.
     · 두 쪽 모두 같은 시드로 같은 Match 를 만든다 → 지형·바람·물리가 같다
     · 조작하는 쪽이 명령({t:'aim'}...)을 보내고, 받는 쪽은 자기 Match 에 그대로 먹인다
     · 턴이 바뀔 때마다 호스트가 스냅샷을 흘려보낸다. 어긋남은 한 턴 안에서 끝난다
   상태 전체를 매 프레임 보내지 않는 이유는 대역폭이 아니라 지연이다.
   포탄이 나는 3초를 네트워크로 중계하면 그 3초가 통째로 렉이 된다. 명령만 보내면 각자 자기 화면에서 즉시 난다.

   ── 자리(seat) ──────────────────────────────────────────────
   2:2 와 1:1:1:1 은 참가자가 넷이다. '호스트=0번, 게스트=1번' 이라는 암묵 규칙으로는 셋 이상을 못 앉힌다.
   그래서 각 클라이언트가 pid 를 하나 만들고, **호스트만** 들어온 순서대로 자리를 확정해
   전원에게 같은 배열을 뿌린다. 각자 자기 pid 의 위치가 곧 자기 자리다.
   자리를 각자 계산하면 브로드캐스트 도착 순서가 달라 두 사람이 같은 자리에 앉는다 —
   그러면 한 전차를 둘이 조종하고 다른 전차는 아무도 안 움직인다. */
(function (root) {
  'use strict';

  function newPid() {
    return (Date.now() % 0xFFFFFF).toString(36) + '-' +
      Math.floor(Math.random() * 0xFFFFFF).toString(36);
  }

  function Room() {
    this.tr = null; this.role = null; this.code = null;
    this.onStart = null; this.onCmd = null; this.onSync = null;
    this.onPeer = null; this.onError = null; this.onSeats = null;
    this.ready = false; this.peerReady = false;
    this.divergences = 0;

    this.pid = newPid();
    this.peers = [];        // 호스트가 확정한 참가 순서. 인덱스 = 자리 번호
    this.picks = [];        // 자리별 전차 선택 (호스트가 모아서 start 에 실어 보낸다)
    this.capacity = 2;      // 이 방의 정원 — 모드가 정한다
    this.mode = 'solo';     // 정원만으로는 모드를 못 정한다 (2:2 와 1:1:1:1 은 둘 다 4명)
  }

  Room.prototype.seat = function () { return this.peers.indexOf(this.pid); };
  Room.prototype.full = function () { return this.peers.length >= this.capacity; };
  Room.prototype.isHost = function () { return this.role === 'host'; };

  /* 호스트만 부른다. 자리표를 다시 짜고 전원에게 뿌린다. */
  Room.prototype.publishSeats = function () {
    if (!this.isHost()) return;
    this.send({ t: 'seats', peers: this.peers.slice(), picks: this.picks.slice(), cap: this.capacity, mode: this.mode });
    if (this.onSeats) this.onSeats();
  };

  /* 호스트가 정원을 바꾼다(모드 변경). 넘치는 인원은 잘라 낸다 —
     정원 2인 방에 넷이 앉아 있으면 시작할 수 없고, 누가 빠져야 하는지도 알 수 없다. */
  Room.prototype.setMode = function (mode, n) {
    this.mode = mode;
    this.capacity = n;
    if (this.isHost()) {
      if (this.peers.length > n) this.peers.length = n;
      this.publishSeats();
    }
  };

  Room.prototype.open = function (code, role, cb) {
    var self = this;
    if (typeof root.makeTransport !== 'function') {
      cb(new Error('전송체가 없습니다. net/supabase-transport.js 에 URL/KEY 를 채우세요.'));
      return;
    }
    this.code = String(code || '').toUpperCase();
    this.role = role;
    if (role === 'host') this.peers = [this.pid];
    root.makeTransport(this.code, role, function (err, tr) {
      if (err) { cb(err); return; }
      self.tr = tr;
      tr.onMessage = function (msg) { self.recv(msg); };
      self.ready = true;
      tr.send({ t: 'hello', role: role, pid: self.pid });
      cb(null, self);
    });
  };

  /* 호스트만. 처음 보는 pid 면 뒷자리에 앉힌다. */
  Room.prototype.admit = function (pid) {
    if (!this.isHost() || !pid) return false;
    if (this.peers.indexOf(pid) >= 0 || this.peers.length >= this.capacity) return false;
    this.peers.push(pid);
    return true;
  };

  Room.prototype.recv = function (m) {
    if (!m || !m.t) return;
    switch (m.t) {
      case 'hello':
        this.peerReady = true;
        if (this.isHost()) {
          this.admit(m.pid);
          this.publishSeats();                       // 자리표가 곧 'hi' 를 겸한다
        } else if (this.tr) {
          this.tr.send({ t: 'hi', role: this.role, pid: this.pid });
        }
        if (this.onPeer) this.onPeer(m.role);
        break;
      case 'hi':
        /* 먼저 들어와 있던 게스트는 호스트의 hello 에 hi 로 답한다.
           여기서 안 앉히면, 방을 열기 전에 도착한 사람은 영원히 자리를 못 받는다. */
        this.peerReady = true;
        if (this.isHost() && this.admit(m.pid)) this.publishSeats();
        if (this.onPeer) this.onPeer(m.role);
        break;
      case 'seats':
        // 자리표는 호스트만 만든다. 게스트가 받은 것을 그대로 쓴다.
        if (!this.isHost()) {
          this.peers = (m.peers || []).slice();
          this.picks = (m.picks || []).slice();
          if (m.cap) this.capacity = m.cap;
          if (m.mode) this.mode = m.mode;
        }
        if (this.onSeats) this.onSeats();
        break;
      case 'pick':
        // 게스트가 고른 전차. 자리 번호는 호스트가 다시 확인한다 — 남의 자리를 덮어쓰지 못하게.
        if (this.isHost() && m.pid) {
          var s = this.peers.indexOf(m.pid);
          if (s >= 0) { this.picks[s] = m.tank; this.publishSeats(); }
        }
        break;
      case 'start': if (this.onStart) this.onStart(m.cfg); break;
      case 'cmd': if (this.onCmd) this.onCmd(m.c); break;
      case 'sync': if (this.onSync) this.onSync(m.s, m.h); break;
      case 'bye':
        if (this.isHost() && m.pid) {
          var i = this.peers.indexOf(m.pid);
          if (i > 0) { this.peers.splice(i, 1); this.picks.splice(i, 1); this.publishSeats(); }
        }
        if (this.onError) this.onError(new Error('상대가 나갔습니다'));
        break;
    }
  };

  Room.prototype.send = function (o) { if (this.tr) this.tr.send(o); };
  Room.prototype.start = function (cfg) { this.send({ t: 'start', cfg: cfg }); };
  Room.prototype.cmd = function (c) { this.send({ t: 'cmd', c: c }); };
  Room.prototype.sync = function (snap, hash) { this.send({ t: 'sync', s: snap, h: hash }); };
  Room.prototype.pick = function (tank) {
    var s = this.seat();
    if (s >= 0) this.picks[s] = tank;
    if (this.isHost()) this.publishSeats();
    else this.send({ t: 'pick', pid: this.pid, tank: tank });
  };
  Room.prototype.close = function () {
    if (this.tr) { try { this.tr.send({ t: 'bye', pid: this.pid }); this.tr.close(); } catch (e) {} }
    this.tr = null; this.ready = false;
  };

  /* 전송체 없이 프로토콜만 검증하는 루프백.
     브로드캐스트를 흉내 낸다 — 보낸 사람 빼고 전원에게 간다. 실제 Supabase 채널이 그렇게 동작하고,
     둘만 있는 방에서만 맞는 '상대에게 보낸다' 로 짜면 넷이 되는 순간 갈라진다. */
  function loopback(n) {
    var rooms = [], i;
    for (i = 0; i < (n || 2); i++) rooms.push(new Room());
    rooms.forEach(function (r, idx) {
      r.role = idx === 0 ? 'host' : 'guest';
      r.ready = true;
      r.tr = {
        send: function (o) {
          var copy = JSON.parse(JSON.stringify(o));
          rooms.forEach(function (other, j) {
            if (j !== idx) setTimeout(function () { other.recv(JSON.parse(JSON.stringify(copy))); }, 0);
          });
        },
        close: function () {}
      };
    });
    rooms[0].peers = [rooms[0].pid];
    return { host: rooms[0], guest: rooms[1], rooms: rooms };
  }

  function makeCode() {
    var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', o = '';
    for (var i = 0; i < 5; i++) o += s[(Math.random() * s.length) | 0];
    return o;
  }

  root.TFNet = { Room: Room, loopback: loopback, makeCode: makeCode, newPid: newPid };
})(typeof globalThis !== 'undefined' ? globalThis : this);
