/* logic/match.js — 턴 진행과 승패. 네트워크 대전의 권위도 여기 있다.
   렌더러는 이 파일을 읽기만 한다. 반대로 이 파일은 렌더러를 전혀 모른다 —
   그래서 node 에서 화면 없이 한 판을 끝까지 돌릴 수 있고, 그게 검증 스크립트의 전제다.

   턴 순서는 포트리스와 같은 "딜레이" 방식이다. 순서대로 도는 게 아니라
   누적 딜레이가 가장 낮은 전차가 다음에 쏜다. 그래서 딜레이 64짜리 스팅어는
   딜레이 206짜리 노바가 한 번 쏘는 동안 세 번 쏜다. 무기 선택 = 다음 차례를 사는 일이다.

   모드
     solo 1:1  / duo 2:2 / ffa 1:1:1:1
   승리
     상대 팀 전멸. 사인은 hp 0(blast·fall·pierce) 또는 낙사(void). 둘을 구분해 기록한다. */
(function (root) {
  'use strict';
  var C = root.TFCore, PH = root.TFPhysics, WPN = root.TFWeapons, MAPS = root.TFMaps;

  var TURN_TIME = 30;        // 초
  var SETTLE_HOLD = 0.8;     // 포탄이 다 사라진 뒤 이만큼 더 굴려서 낙하·붕괴를 끝낸다
  var IDLE_DELAY = 120;      // 시간 초과로 못 쏘면 먹는 딜레이
  var SUDDEN_TURN = 70;      // 이 턴을 넘기면 서든데스가 시작된다
  var SUDDEN_STEP = 1.5;     // 턴마다 늘어나는 피해량

  var MODES = {
    solo: { n: 2, teams: [0, 1], label: '1 : 1' },
    duo: { n: 4, teams: [0, 1, 0, 1], label: '2 : 2' },
    ffa: { n: 4, teams: [0, 1, 2, 3], label: '1 : 1 : 1 : 1' }
  };

  function Match(cfg) {
    this.mode = MODES[cfg.mode] ? cfg.mode : 'solo';
    var M = MODES[this.mode];
    this.seed = (cfg.seed >>> 0) || 1;
    this.mapId = cfg.mapId || MAPS.list[this.seed % MAPS.list.length].id;
    this.map = MAPS.get(this.mapId);
    this.world = new PH.World(this.map, this.seed);
    this.turnTime = cfg.turnTime || TURN_TIME;

    var roster = cfg.roster || [];
    for (var i = 0; i < M.n; i++) {
      var r = roster[i] || {};
      var t = this.world.addTank(r.tank || root.TFTanks.list[i % 10].id,
        r.owner || ('P' + (i + 1)), M.teams[i], i);
      t.ai = !!r.ai; t.aiLevel = r.aiLevel || 2; t.label = r.label || t.def.name;
    }
    this.state = 'aim';
    this.turn = 0;
    this.current = -1;
    this.timeLeft = this.turnTime;
    this.settleT = 0;
    this.result = null;
    this.log = [];
    this.rollWind();
    this.pickNext(true);
  }

  Match.prototype.modeInfo = function () { return MODES[this.mode]; };

  Match.prototype.rollWind = function () {
    var w = this.map.wind;
    this.world.wind = Math.round((this.world.rng.range(-w, w)) * 10) / 10;
  };

  Match.prototype.alive = function () {
    return this.world.tanks.filter(function (t) { return !t.dead; });
  };

  Match.prototype.teamsAlive = function () {
    var s = {}, out = [];
    var a = this.alive();
    for (var i = 0; i < a.length; i++) if (!s[a[i].team]) { s[a[i].team] = 1; out.push(a[i].team); }
    return out;
  };

  /* 누적 딜레이 최소값 → 다음 사수. 동률이면 인덱스 순. */
  Match.prototype.pickNext = function (first) {
    /* 서든데스. 아이템 회복이 들어오면서 양쪽이 서로를 못 죽이는 판이 실제로 나왔다
       (지하 공동에서 400턴을 넘겨도 안 끝났다). 판이 끝난다는 보장은 규칙이 져야 한다.
       턴이 갈수록 피해가 커지므로 아무리 회복해도 결국 결착이 난다. */
    if (!first && this.turn > SUDDEN_TURN) {
      var dmg = Math.ceil((this.turn - SUDDEN_TURN) * SUDDEN_STEP);
      var living = this.alive();
      for (var s = 0; s < living.length; s++) this.world.damage(living[s], dmg, 'sudden');
      this.world.emit({ type: 'sudden', turn: this.turn, dmg: dmg });
      if (this.checkEnd()) return;
    }

    var a = this.alive();
    if (!a.length) { this.finish(null); return; }
    var min = Infinity;
    for (var i = 0; i < a.length; i++) if (a[i].delay < min) min = a[i].delay;
    for (var j = 0; j < this.world.tanks.length; j++) this.world.tanks[j].delay -= min;  // 정규화
    var best = null;
    for (var k = 0; k < a.length; k++) if (!best || a[k].delay < best.delay) best = a[k];
    this.current = best.id;
    this.turn++;
    best.fuel = best.fuelMax;
    best.power = 0;
    best.buff = null;                          // 지난 턴에 켜 두고 안 쏜 버프는 남기지 않는다

    /* 화염은 자기 턴 시작에 탄다. 상대 턴에 조용히 닳으면 무슨 일이 벌어졌는지 안 보인다.
       여기서 죽을 수도 있으므로 바로 승패를 확인한다. */
    this.world.tickBurn(best);
    if (best.dead) { if (this.checkEnd()) return; this.pickNext(false); return; }

    /* 보급 헬기. 반드시 사수가 정해진 뒤, 바람을 뽑기 전에 부른다 —
       난수를 뽑는 순서가 두 클라이언트에서 같아야 하므로 위치를 옮기면 안 된다. */
    if (root.TFItems && !first) root.TFItems.supply(this.world, this.turn);
    if (!first) this.rollWind();
    this.state = 'aim';
    this.timeLeft = this.turnTime;
    this.world.emit({ type: 'turn', id: best.id, turn: this.turn, wind: this.world.wind });
  };

  Match.prototype.actor = function () {
    return this.current >= 0 ? this.world.tanks[this.current] : null;
  };

  /* ── 명령 ──────────────────────────────────────────────────────
     네트워크로 오가는 것은 오직 이 형태다. 상태 전체를 보내지 않는다.
     {t:'move', d:±1, px}  {t:'aim', a}  {t:'dir', d}  {t:'weapon', w}  {t:'fire', p}  {t:'pass'} */
  Match.prototype.command = function (cmd) {
    var t = this.actor();
    if (!t || this.state !== 'aim' || this.result) return false;
    switch (cmd.t) {
      case 'move':
        return this.world.moveTank(t, cmd.d > 0 ? 1 : -1, Math.min(cmd.px || 1, 40));
      case 'dir':
        t.dir = cmd.d > 0 ? 1 : -1; return true;
      case 'aim':
        t.angle = C.clamp(cmd.a, t.def.angle[0], t.def.angle[1]); return true;
      case 'weapon':
        if (cmd.w !== t.def.main && cmd.w !== t.def.sub) return false;
        if (cmd.w === t.def.sub && !(t.ammo[cmd.w] > 0)) return false;
        t.weapon = cmd.w; return true;
      case 'item':
        /* 아이템은 턴을 쓰지 않는다. 성공하면 true 를 돌려주지만 state 는 그대로 aim 이다. */
        if (!root.TFItems) return false;
        return root.TFItems.use(this.world, t, cmd.i);
      case 'fire':
        var p = C.clamp(cmd.p, 1, 100);
        var w = this.world.fire(t, t.weapon, p);
        if (!w) return false;
        this.log.push({ turn: this.turn, id: t.id, w: w.id, a: t.angle, p: p, d: t.dir, wind: this.world.wind });
        this.state = 'resolve';
        this.settleT = 0;
        return true;
      case 'pass':
        t.delay += IDLE_DELAY;
        this.log.push({ turn: this.turn, id: t.id, w: null });
        this.state = 'resolve'; this.settleT = SETTLE_HOLD;
        return true;
    }
    return false;
  };

  /* 실시간 dt 를 받아 고정 스텝으로 쪼개 돌린다. 프레임레이트와 무관한 결과를 보장한다. */
  Match.prototype.update = function (dt) {
    if (this.result) return;
    if (dt > 0.25) dt = 0.25;                    // 탭 전환 등으로 크게 튀면 잘라 낸다
    var acc = (this._acc || 0) + dt;
    var DTs = PH.DT, n = 0;
    while (acc >= DTs && n < 600) { this.world.step(DTs); acc -= DTs; n++; }
    this._acc = acc;

    if (this.state === 'aim') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.command({ t: 'pass' });
    } else if (this.state === 'resolve') {
      if (this.world.settled()) {
        this.settleT += dt;
        if (this.settleT >= SETTLE_HOLD) {
          if (!this.checkEnd()) this.pickNext(false);
        }
      } else this.settleT = 0;
    }
  };

  Match.prototype.checkEnd = function () {
    var ts = this.teamsAlive();
    if (ts.length <= 1) { this.finish(ts.length ? ts[0] : null); return true; }
    return false;
  };

  Match.prototype.finish = function (team) {
    this.state = 'over';
    var voids = this.world.tanks.filter(function (t) { return t.deathBy === 'void'; }).length;
    this.result = {
      winner: team,
      turns: this.turn,
      voidKills: voids,
      survivors: this.alive().map(function (t) { return { id: t.id, hp: t.hp, name: t.def.name }; })
    };
    this.world.emit({ type: 'over', winner: team });
  };

  /* ── 동기화 ───────────────────────────────────────────────────
     호스트 권위 방식. 게스트는 명령만 보내고, 호스트가 매 턴 끝에 스냅샷을 흘려보낸다.
     명령 재생만으로도 대개 일치하지만, 어긋났을 때 되돌릴 기준점이 없으면 복구가 불가능하다. */
  Match.prototype.snapshot = function () {
    return {
      seed: this.seed, map: this.mapId, mode: this.mode, turn: this.turn,
      cur: this.current, wind: this.world.wind, state: this.state,
      cs: this.world.crates.map(function (c) {
        return { i: c.id, x: Math.round(c.x), y: Math.round(c.y), it: c.item, g: c.grounded };
      }),
      cseq: this.world.crateSeq,
      tanks: this.world.tanks.map(function (t) {
        return {
          i: t.id, x: Math.round(t.x * 4) / 4, y: Math.round(t.y * 4) / 4, hp: t.hp,
          d: t.delay, dir: t.dir, a: t.angle, dead: t.dead, by: t.deathBy,
          am: t.ammo, w: t.weapon, it: t.items, bf: t.buff, sh: t.shield, fu: t.fuel,
          bn: t.burn, st: t.streak, so: t.streakOn, cg: t.charge
        };
      })
    };
  };

  Match.prototype.restore = function (s) {
    this.world.wind = s.wind; this.turn = s.turn; this.current = s.cur; this.state = s.state;
    if (s.cs) {
      this.world.crates = s.cs.map(function (c) {
        var n = new (root.TFPhysics.Crate)(c.i, c.x, c.y, c.it);
        n.grounded = c.g; return n;
      });
      this.world.crateSeq = s.cseq || this.world.crateSeq;
    }
    for (var i = 0; i < s.tanks.length; i++) {
      var a = s.tanks[i], t = this.world.tanks[a.i];
      if (!t) continue;
      t.x = a.x; t.y = a.y; t.hp = a.hp; t.delay = a.d; t.dir = a.dir; t.angle = a.a;
      t.dead = a.dead; t.deathBy = a.by; t.ammo = a.am; t.weapon = a.w;
      t.items = a.it || {}; t.buff = a.bf || null; t.shield = a.sh || 0;
      t.burn = a.bn || 0; t.streak = a.st || 0; t.streakOn = a.so == null ? -1 : a.so;
      t.charge = a.cg || 0;
      if (a.fu != null) t.fuel = a.fu;
      t.vx = 0; t.vy = 0; t.grounded = true;
    }
  };

  /* 지형까지 포함한 싸구려 해시. 두 클라이언트가 갈렸는지 한 줄로 판별한다. */
  Match.prototype.hash = function () {
    var h = 2166136261 >>> 0;
    function mix(v) { h ^= (v | 0); h = Math.imul(h, 16777619) >>> 0; }
    mix(this.turn); mix(Math.round(this.world.wind * 10));
    for (var i = 0; i < this.world.tanks.length; i++) {
      var t = this.world.tanks[i];
      mix(Math.round(t.x)); mix(Math.round(t.y)); mix(t.hp); mix(Math.round(t.delay)); mix(t.dead ? 1 : 0);
      mix(t.shield); mix(t.burn); mix(t.streak); mix(t.streakOn); mix(t.charge);
      // 아이템도 판정에 영향을 주므로 해시에 넣는다. 키 순서가 흔들리지 않게 고정 순서로 돈다.
      var ord = root.TFItems ? root.TFItems.order : [];
      for (var k = 0; k < ord.length; k++) {
        mix(t.items[ord[k]] || 0);
        mix(t.buff && t.buff[ord[k]] ? 1 : 0);
      }
    }
    // 상자도 판정에 영향을 준다 — 위치가 갈리면 누가 줍는지가 갈린다
    for (var c = 0; c < this.world.crates.length; c++) {
      var cr = this.world.crates[c];
      mix(cr.id); mix(Math.round(cr.x)); mix(Math.round(cr.y)); mix(cr.grounded ? 1 : 0);
    }
    var m = this.world.terrain.mask, step = Math.max(1, (m.length / 4096) | 0);
    for (var k = 0; k < m.length; k += step) mix(m[k]);
    return h >>> 0;
  };

  root.TFMatch = { Match: Match, MODES: MODES, TURN_TIME: TURN_TIME, SUDDEN_TURN: SUDDEN_TURN };
})(typeof globalThis !== 'undefined' ? globalThis : this);
