/* logic/physics.js — 세계. 전차 몸체와 포탄이 여기서 움직인다.
   DOM 참조 0. 렌더러는 World 를 읽기만 하고, 그릴 거리는 world.events 큐로 받아 간다.
   고정 스텝(1/120초)으로만 전진한다 — 프레임레이트가 궤적을 바꾸면 네트워크 대전이 성립하지 않는다.

   좌표계: x 오른쪽, y 아래쪽. 각도는 "수평에서 위로" 가 양수(도).
   따라서 발사 속도는 (cos·향, -sin) 이다. 이 부호를 헷갈리면 포탄이 땅으로 처박힌다. */
(function (root) {
  'use strict';
  var C = root.TFCore, T = root.TFTerrain, WPN = root.TFWeapons, TDEF = root.TFTanks;
  /* items.js 는 선택 의존이다. 없으면 상자를 주워도 인벤토리에 안 들어갈 뿐 게임은 돈다.
     반대 방향(items → physics)이 아니라 이 방향인 이유: 상자는 물리 객체이고 아이템은 규칙이다. */

  var DT = 1 / 120;
  /* 히트박스는 반드시 전차 표의 배율을 따라간다.
     여기에 숫자를 따로 적으면 그림은 커졌는데 맞는 판정은 그대로인 상태가 되고,
     "분명 맞았는데 안 맞았다"가 나온다. 눈에 보이는 것과 맞는 것은 같아야 한다. */
  var TSCALE = (root.TFTanks && root.TFTanks.SCALE) || 1;
  var TANK_HW = Math.round(13 * TSCALE), TANK_HH = Math.round(13 * TSCALE);

  /* 화염 — 볼케이노 계열이 남기는 지속 피해.
     맞은 전차는 '자기 턴이 올 때' 탄다. 상대 턴에 조용히 닳으면 무슨 일이 벌어졌는지 안 보인다. */
  /* 누적 1당 턴 시작 피해. 7로 뒀더니 볼케이노가 타이탄에게 2승 8패였다 —
     화염은 뒤늦게 들어오는 피해라, 판이 10턴 안에 끝나면 값을 다 치르기 전에 끝난다. */
  var BURN_DMG = 9;
  var BURN_MAX = 5;        // 누적 상한. 없으면 소이 폭우 한 방으로 게임이 끝난다

  /* 연속 명중 — 팬텀 계열. 같은 표적을 계속 맞히면 피해가 커지고, 빗나가면 처음으로 돌아간다.
     레이븐은 '빗나가도 붙여 주는' 유도이고, 팬텀은 '안 빗나가면 보상하는' 유도다. */
  var STREAK_STEP = 0.18;  // 연속 1회마다 늘어나는 비율
  var STREAK_MAX = 3;      // 배율 상한 = 1 + 0.18*(3-1) = 1.36배
  var SHELL_STEP = 2.5;               // 포탄 부분 스텝 길이(px). 얇은 지형을 지나치지 않게 한다
  var FALL_DMG_V = 420;               // 이 속도 이상으로 착지하면 낙하 피해
  var MAX_SHELL_LIFE = 14;            // 초. 화면 밖으로 영영 나간 탄 회수

  function World(mapDef, seed) {
    this.map = mapDef;
    this.seed = seed >>> 0;
    /* rng 는 판정에 관여하는 난수 전용이다 — 지금은 바람 추첨 하나뿐이고, 양쪽 클라이언트가
       같은 순서로 같은 횟수만 뽑아야 한다. 한쪽에만 있는 AI 가 여기서 한 번이라도 뽑으면
       그 다음 턴의 바람이 갈라지고, 판 전체가 어긋난다.
       그래서 AI·연출처럼 한쪽에만 도는 것들은 반드시 arng 를 쓴다. */
    this.rng = new C.RNG(seed ^ 0x9E3779B9);
    this.arng = new C.RNG(seed ^ 0x5BF03635);
    this.terrain = T.build(root.TFMaps.spec(mapDef), seed);
    this.g = mapDef.gravity;
    this.voidY = (mapDef.voidY || 1) * mapDef.h;
    this.tanks = [];
    this.shells = [];
    this.crates = [];
    this.crateSeq = 0;
    this.events = [];
    this.wind = 0;
    this.time = 0;
    this.tick = 0;
  }

  World.prototype.emit = function (e) { this.events.push(e); };

  /* ── 전차 ──────────────────────────────────────────────────── */

  function Tank(id, defId, owner, team) {
    var d = TDEF.get(defId);
    this.id = id; this.defId = d.id; this.def = d;
    this.owner = owner; this.team = team;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.hp = d.hp; this.hpMax = d.hp;
    this.fuel = d.fuel; this.fuelMax = d.fuel;
    this.angle = 45; this.dir = 1;           // dir: 1 오른쪽 조준, -1 왼쪽
    this.power = 0;
    this.grounded = false; this.tilt = 0;
    this.dead = false; this.deathBy = null;
    this.delay = 0;                          // 누적 턴 딜레이
    this.items = {};                         // 아이템 id → 개수
    this.buff = null;                        // 다음 발사에 실릴 버프. 쏘면 사라진다
    this.shield = 0;                         // 남은 차폐막 횟수
    this.burn = 0;                           // 화염 누적. 자기 턴 시작에 이만큼 곱해 탄다
    this.charge = 0;                         // 기 모으기 진행도 (폭풍탄)
    this.streak = 0;                         // 같은 표적 연속 명중 수 (팬텀 계열)
    this.streakOn = -1;                      // 그 표적의 id
    this.ammo = {};
    this.ammo[d.sub] = WPN.get(d.sub).ammo;
    this.weapon = d.main;
  }
  Tank.prototype.aliveAt = function () { return !this.dead; };

  /* 설 수 있는 자리인가.
     지면이 있고, 평평하고, 머리 위가 트여 있어야 한다.
     머리 위 확인이 핵심이다 — 이게 없으면 지하 공동 맵에서 암반 속에 파묻힌 자리나
     공동 위 지붕이 후보로 잡힌다. 지붕은 하늘이 트여 있어 머리 위 검사만으로는 못 거르므로,
     맵이 spawnScanY 를 주면 그 아래에서만 지면을 찾는다. */
  World.prototype.spawnSpot = function (x, scan) {
    var tr = this.terrain, H = this.map.h;
    var gy = tr.groundBelow(x, scan);
    if (gy >= H) return null;
    if (gy < scan) return null;                       // 스캔선 위 = 지붕. 지하 맵에서 걸러진다

    var need = TANK_HH * 2 + 6;                       // 전차가 들어갈 높이
    for (var dy = 4; dy <= need; dy += 4) {
      if (tr.solid(x, gy - dy)) return null;          // 천장에 눌려 못 선다
    }
    var l = tr.groundBelow(x - TANK_HW, scan), r = tr.groundBelow(x + TANK_HW, scan);
    if (l >= H || r >= H) return null;                // 한쪽 발이 허공
    var flat = Math.abs(l - gy) + Math.abs(r - gy);
    if (flat > 26) return null;
    return { x: x, y: gy, flat: flat };
  };

  World.prototype.addTank = function (defId, owner, team, slot) {
    var t = new Tank(this.tanks.length, defId, owner, team);
    var scan = (this.map.spawnScanY || 0) * this.map.h;
    var W = this.map.w;

    /* 맵 전체에서 설 수 있는 자리를 모은다.
       예전에는 슬롯마다 정해진 구역(왼쪽 끝/오른쪽 끝)에서만 골라서 매판 같은 자리에서 시작했다.
       이제는 전 구간을 훑고, 이미 배치된 전차와의 최소 간격만 지킨다. */
    var step = 12, edge = Math.max(110, TANK_HW * 4), cands = [];
    for (var x = edge; x < W - edge; x += step) {
      var spot = this.spawnSpot(x, scan);
      if (spot) cands.push(spot);
    }
    if (!cands.length) {                              // 설 자리를 못 찾으면 예전 방식으로 되돌아간다
      var band = this.map.spawn[slot % this.map.spawn.length];
      var fx = Math.round(W * (band[0] + band[1]) / 2);
      t.x = fx; t.y = this.terrain.groundBelow(fx, scan) - TANK_HH;
      t.dir = t.x < W / 2 ? 1 : -1; t.grounded = true;
      this.tanks.push(t); return t;
    }

    /* 간격은 넉넉하게 시작해 후보가 없으면 좁혀 간다.
       처음부터 좁게 잡으면 두 전차가 나란히 붙어 시작하는 판이 나온다. */
    var minGap = Math.max(260, W * 0.22), pool = [];
    var self = this;
    for (var g = 0; g < 6 && !pool.length; g++) {
      pool = cands.filter(function (c) {
        for (var j = 0; j < self.tanks.length; j++) {
          if (Math.abs(self.tanks[j].x - c.x) < minGap) return false;
        }
        return true;
      });
      minGap *= 0.65;
    }
    if (!pool.length) pool = cands;

    /* 자리 고르기에는 반드시 this.rng 를 쓴다. Math.random 을 쓰면 두 클라이언트가
       서로 다른 자리에서 시작하고, 그 순간 온라인 대전이 끝난다. */
    var pick = pool[(this.rng.next() * pool.length) | 0];
    t.x = pick.x; t.y = pick.y - TANK_HH;
    t.dir = t.x < W / 2 ? 1 : -1;
    t.grounded = true;
    this.updateTilt(t);
    this.tanks.push(t);
    return t;
  };

  /* 전차가 그 위치에 설 수 있는가 — 몸통이 지형에 박히지 않는가 */
  World.prototype.blocked = function (x, y) {
    var tr = this.terrain;
    for (var dx = -TANK_HW; dx <= TANK_HW; dx += 4) {
      if (tr.solid(Math.round(x + dx), Math.round(y))) return true;
      if (tr.solid(Math.round(x + dx), Math.round(y - TANK_HH + 3))) return true;
    }
    return false;
  };

  World.prototype.groundUnder = function (x, y) {
    var tr = this.terrain, best = this.map.h;
    for (var dx = -TANK_HW; dx <= TANK_HW; dx += 4) {
      var g = tr.groundBelow(Math.round(x + dx), Math.round(y));
      if (g < best) best = g;
    }
    return best;
  };

  /* 좌우 이동. 연료를 쓴다. 벽에 막히면 false 를 돌려주고 연료도 안 쓴다.
     noPickup: AI 가 "여기로 가면 어떨까"를 시험할 때 쓴다.
     이게 없으면 상상만 한 이동이 실제로 상자를 먹어 치우고, 그 순간 온라인 대전이 갈린다 —
     AI 는 한쪽에만 돌기 때문이다. */
  World.prototype.moveTank = function (t, dir, px, noPickup) {
    if (t.dead || !t.grounded || t.fuel <= 0) return false;
    var step = Math.min(px, t.fuel), moved = 0, climb = t.def.climb;
    for (var i = 0; i < step; i++) {
      var nx = t.x + dir;
      if (nx < TANK_HW || nx > this.map.w - TANK_HW) break;
      var gy = this.groundUnder(nx, t.y - TANK_HH + 2);
      var up = (t.y + TANK_HH) - gy;               // 양수면 올라가야 함
      if (up > climb) break;                        // 벽
      if (up < -6) {                                // 내리막 — 붙어서 내려간다. 절벽이면 낙하
        if (up < -climb * 2.2) { t.x = nx; t.grounded = false; t.vx = dir * 40; moved++; break; }
      }
      if (gy >= this.map.h) { t.x = nx; t.grounded = false; t.vy = 0; moved++; break; }
      var ny = gy - TANK_HH;
      if (this.blocked(nx, ny + TANK_HH - 1)) break;
      t.x = nx; t.y = ny; moved++;
      if (!noPickup) this.collectCrates(t);   // 지나가면서 줍는다
    }
    t.fuel -= moved;
    if (moved > 0) this.updateTilt(t);
    return moved > 0;
  };

  World.prototype.updateTilt = function (t) {
    var l = this.terrain.groundBelow(Math.round(t.x - TANK_HW), Math.round(t.y - TANK_HH));
    var r = this.terrain.groundBelow(Math.round(t.x + TANK_HW), Math.round(t.y - TANK_HH));
    if (l >= this.map.h || r >= this.map.h) return;
    var a = C.atan2(r - l, TANK_HW * 2);
    t.tilt = C.clamp(a, -0.7, 0.7);
  };

  /* 공중에 뜬 전차 낙하. 넉백으로 밀렸거나 발판이 사라졌을 때 돈다. */
  World.prototype.stepTankBody = function (t, dt) {
    if (t.dead) return;
    var gy = this.groundUnder(t.x, t.y - TANK_HH + 2);
    if (t.grounded) {
      if (gy > t.y + TANK_HH + 2) { t.grounded = false; t.vy = 0; }   // 발밑이 파였다
      else { t.y = gy - TANK_HH; return; }
    }
    t.vy += this.g * dt;
    t.vx *= 0.995;
    t.x += t.vx * dt; t.y += t.vy * dt;
    t.x = C.clamp(t.x, TANK_HW, this.map.w - TANK_HW);

    if (t.y - TANK_HH > this.voidY) { this.kill(t, 'void'); return; }

    var g2 = this.groundUnder(t.x, t.y - TANK_HH);
    if (t.y + TANK_HH >= g2 && g2 < this.map.h) {
      t.y = g2 - TANK_HH;
      if (t.vy > FALL_DMG_V) {
        var dmg = Math.round((t.vy - FALL_DMG_V) / 12);
        if (dmg > 0) this.damage(t, dmg, 'fall');
      }
      t.vx = 0; t.vy = 0; t.grounded = true;
      this.updateTilt(t);
      this.emit({ type: 'land', x: t.x, y: t.y });
    }
  };

  World.prototype.damage = function (t, amount, cause) {
    if (t.dead || amount <= 0) return 0;
    var real = Math.round(amount * (1 - t.def.armor));
    /* 차폐막은 '다음 한 방'을 반으로 줄인다. 폭발 한 번에 여러 번 damage 가 불리지 않으므로
       여기서 소모해도 한 발에 두 번 깎이지 않는다. 낙하 피해에는 걸리지 않는다 —
       스스로 떨어진 것까지 막아 주면 낙사 압박이 사라진다. */
    /* 맞으면 모으던 기가 풀린다. 이게 없으면 '한 턴 모으고 한 방'이 아무 위험 없는 선택이 된다 —
       상대는 그걸 보고도 막을 방법이 없다. */
    if (t.charge > 0 && (cause === 'blast' || cause === 'pierce')) {
      t.charge = 0;
      this.emit({ type: 'chargeBreak', id: t.id, x: t.x, y: t.y });
    }
    if (t.shield > 0 && (cause === 'blast' || cause === 'pierce')) {
      t.shield--;
      real = Math.round(real * 0.5);
      this.emit({ type: 'shield', id: t.id, x: t.x, y: t.y });
    }
    if (real < 1) real = 1;
    t.hp -= real;
    this.emit({ type: 'dmg', id: t.id, x: t.x, y: t.y - 20, n: real, cause: cause });
    if (t.hp <= 0) { t.hp = 0; this.kill(t, cause); }
    return real;
  };

  World.prototype.kill = function (t, cause) {
    if (t.dead) return;
    t.dead = true; t.deathBy = cause; t.hp = 0;
    this.emit({ type: 'dead', id: t.id, x: t.x, y: t.y, cause: cause });
    if (cause !== 'void') this.terrain.crater(t.x, t.y, 34);
  };

  /* ── 보급 상자 ─────────────────────────────────────────────────
     포트리스2는 게임 중 헬기가 상자를 떨어뜨리고, 그걸 주우러 가야 한다.
     상자를 쏴서 부수면 안의 아이템도 사라진다 — 못 줍게 만드는 견제가 성립한다.
     이 방식이 조용히 지급하는 것보다 나은 이유는 하나 더 있다:
     지금 이동은 조준 각도를 바꾸는 용도뿐인데, 상자가 생기면 이동에 두 번째 목적이 붙는다. */

  var CRATE_HW = Math.round(11 * TSCALE), CRATE_HH = Math.round(11 * TSCALE);
  var CRATE_FALL = 190;          // 낙하 속도(px/s). 낙하산이라 느리다

  function Crate(id, x, y, item) {
    this.id = id; this.x = x; this.y = y;
    this.item = item; this.grounded = false; this.dead = false;
  }

  World.prototype.dropCrate = function (x, item) {
    x = C.clamp(Math.round(x), CRATE_HW + 2, this.map.w - CRATE_HW - 2);
    var c = new Crate(this.crateSeq++, x, -CRATE_HH * 2, item);
    this.crates.push(c);
    this.emit({ type: 'crateDrop', x: x, item: item, id: c.id });
    return c;
  };

  World.prototype.stepCrates = function (dt) {
    var out = [];
    for (var i = 0; i < this.crates.length; i++) {
      var c = this.crates[i];
      if (c.dead) continue;
      if (!c.grounded) {
        c.y += CRATE_FALL * dt;
        var g = this.terrain.groundBelow(Math.round(c.x), Math.round(c.y));
        if (c.y + CRATE_HH >= g && g < this.map.h) {
          c.y = g - CRATE_HH; c.grounded = true;
          this.emit({ type: 'crateLand', x: c.x, y: c.y, id: c.id });
        } else if (c.y - CRATE_HH > this.voidY) {
          // 낙사 구간으로 떨어진 상자는 아무도 못 줍는다. 그것도 결과다
          this.emit({ type: 'crateLost', x: c.x, y: c.y, id: c.id });
          continue;
        }
      } else {
        // 발밑이 파였으면 다시 떨어진다
        var g2 = this.terrain.groundBelow(Math.round(c.x), Math.round(c.y));
        if (g2 > c.y + CRATE_HH + 2) c.grounded = false;
      }
      out.push(c);
    }
    this.crates = out;
  };

  /* 전차가 상자에 닿으면 줍는다. 이동 중에도, 넉백으로 밀려가다가도 주울 수 있다. */
  World.prototype.collectCrates = function (t) {
    if (t.dead) return null;
    var got = null;
    for (var i = 0; i < this.crates.length; i++) {
      var c = this.crates[i];
      if (c.dead) continue;
      if (Math.abs(c.x - t.x) > TANK_HW + CRATE_HW) continue;
      if (Math.abs(c.y - t.y) > TANK_HH + CRATE_HH + 6) continue;
      c.dead = true;
      got = c.item;
      this.emit({ type: 'cratePick', id: t.id, item: c.item, x: c.x, y: c.y });
      // 인벤토리 규칙은 items.js 가 안다. 없으면 상자만 사라지고 게임은 계속 돈다.
      if (root.TFItems) root.TFItems.receive(this, t, c.item);
    }
    if (got) this.crates = this.crates.filter(function (c) { return !c.dead; });
    return got;
  };

  /* 폭발이 상자를 부순다. 안의 아이템은 사라진다 — 적이 못 줍게 하는 유일한 수단이다. */
  World.prototype.bustCrates = function (x, y, rad) {
    var hit = 0, keep = [];
    for (var i = 0; i < this.crates.length; i++) {
      var c = this.crates[i];
      if (!c.dead && C.hypot(c.x - x, c.y - y) <= rad + CRATE_HW) {
        this.emit({ type: 'crateBust', x: c.x, y: c.y, item: c.item, id: c.id });
        hit++;
      } else keep.push(c);
    }
    this.crates = keep;
    return hit;
  };

  /* ── 발사 ──────────────────────────────────────────────────── */

  function Shell(w, x, y, vx, vy, ownerId, gen, dmgMul) {
    this.w = w; this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.px = x; this.py = y;
    this.owner = ownerId; this.gen = gen || 0;
    this.life = 0; this.split = false; this.drilled = -1; this.pierce = w.pierceTanks || 0;
    this.drillStage = 0;                            // 관통 중 몇 번 터졌는가
    this.dmgMul = dmgMul == null ? 1 : dmgMul;      // 아이템 강화탄 배율
    this.pullLeft = w.homing ? w.homing.pull : 0;   // 착탄점을 옮길 수 있는 남은 거리(px)
    this.hit = {};
    this.trail = [];
    this.splitAtLife = 0;  // frac 모드용: 이 life 시점에 분열
  }

  World.prototype.muzzle = function (t) {
    var a = t.angle * C.DEG * t.dir + t.tilt * (t.dir > 0 ? 1 : -1) * 0;
    var s = t.def.shape;
    var bx = t.x + (s.pivot[0]) * t.dir, by = t.y + s.pivot[1];
    var len = s.barrel[0];
    return {
      x: bx + C.cos(t.angle * C.DEG) * len * t.dir,
      y: by - C.sin(t.angle * C.DEG) * len,
      bx: bx, by: by, a: a
    };
  };

  /* power 0..100 → 초속 */
  World.prototype.speedOf = function (t, w, power) {
    return (150 + power * 8.7) * t.def.power * (w.speed || 1);
  };

  World.prototype.fire = function (t, weaponId, power) {
    var w = WPN.get(weaponId);
    if (!w || t.dead) return null;

    /* 텔레포트탄은 그 턴의 공격을 통째로 대신한다. 무기 탄약을 쓰지 않고 피해도 없다.
       버프를 여기서 먼저 읽는 이유: 탄약 차감보다 앞서야 보조 무기 탄을 낭비하지 않는다. */
    var warping = t.buff && t.buff.teleport;
    if (warping) w = WPN.get('warp');
    else if (w.kind === 'sub') {
      if (!t.ammo[weaponId] || t.ammo[weaponId] <= 0) return null;

      /* 기 모으기. 첫 번째 발사는 탄을 쏘지 않고 힘을 모으는 데 쓴다 —
         그 턴을 통째로 내주고, 다음 차례에 같은 무기를 쏘면 모아 둔 힘이 나간다.
         맞으면 모으던 힘이 풀린다(damage 참고). 그래서 상대에게도 대응할 여지가 있다. */
      if (w.chargeTurns && t.charge < w.chargeTurns) {
        t.charge++;
        t.delay += Math.round(w.delay * 0.55);
        this.emit({ type: 'charging', id: t.id, x: t.x, y: t.y, n: t.charge, need: w.chargeTurns });
        return w;                                     // 탄약도 안 쓰고, 탄도 안 나간다
      }
      t.ammo[weaponId]--;
      t.charge = 0;
    }
    /* 아이템 버프는 발사 순간에 소모된다. 조준 중에는 아무것도 바뀌지 않으므로
       버프를 켜 두고 마음이 바뀌어도 손해가 없다 — 대신 한 번 쏘면 사라진다. */
    var buff = t.buff || {};
    t.buff = null;
    var mul = buff.power ? 1.6 : 1;

    var m = this.muzzle(t);
    var sp = this.speedOf(t, w, power);
    // 텔레포트탄은 한 발뿐이다. 더블샷과 겹쳐도 두 번 이동할 수는 없다.
    var n = warping ? 1 : (w.shots || 1) * (buff.double ? 2 : 1);
    var spread = w.spread || (buff.double ? 3.2 : 0);
    for (var i = 0; i < n; i++) {
      var off = n === 1 ? 0 : ((i - (n - 1) / 2) * spread);
      var ang = (t.angle + off) * C.DEG;
      var vx = C.cos(ang) * sp * t.dir, vy = -C.sin(ang) * sp;
      var sh = new Shell(w, m.x, m.y, vx, vy, t.id, 0, mul);
      sh.noWind = !!buff.windless;
      if (warping) sh.warp = t.id;
      // frac 분열: 대략적인 비행 시간의 지정 비율에서 터진다 (정점보다 늦은 하강 구간)
      if (w.split && w.split.at === 'frac') {
        var g = this.map.gravity * (w.grav || 1);
        var tApex = vy < 0 ? (-vy / g) : 0.15;          // 정점까지
        var est = Math.max(0.6, tApex * 2.15 + 0.35);   // 왕복 + 여유
        sh.splitAtLife = est * (w.split.frac != null ? w.split.frac : 0.8);
      }
      this.shells.push(sh);
    }
    if (w.selfPush) {                                 // 반동 — 초신성이 자기를 민다
      t.vx -= C.cos(t.angle * C.DEG) * 210 * w.selfPush * t.dir / t.def.mass;
      t.vy += C.sin(t.angle * C.DEG) * 150 * w.selfPush / t.def.mass;
      t.grounded = false;
    }
    t.delay += Math.round(w.delay * (buff.double && !warping ? 1.5 : 1));
    this.emit({ type: 'fire', x: m.x, y: m.y, id: t.id, w: w.id, buff: buff });
    return w;
  };

  /* ── 포탄 전진 ─────────────────────────────────────────────── */

  World.prototype.stepShells = function (dt, target) {
    var out = [];
    for (var i = 0; i < this.shells.length; i++) {
      var s = this.shells[i];
      if (this.stepShell(s, dt, target)) out.push(s);
    }
    this.shells = out;
  };

  World.prototype.stepShell = function (s, dt, target) {
    var w = s.w;
    s.life += dt;
    if (s.life > MAX_SHELL_LIFE) return false;

    /* 유도. 조준을 대신하지 않고 '조준 오차를 깎아 준다'.
       예산(budget)이 없으면 유도탄은 아무리 빗나가게 쏴도 결국 표적에 붙는다 —
       각도와 게이지를 맞추는 일이 게임의 전부인데 그 전부를 무료로 건너뛰게 된다.
       총 회전량을 라디안으로 제한하면, 잘 쏜 한 발은 보정을 받고 엉망으로 쏜 한 발은 그대로 빗나간다.
       꺾는 동안 속도도 조금씩 잃는다 — 크게 꺾을수록 사거리를 대가로 낸다. */
    /* 유도 — 방향을 돌리는 게 아니라 **착탄점을 옮긴다.**

       처음엔 표적 쪽으로 속도를 돌리게 했다가 두 번 실패했다.
       (1) 표적을 곧장 겨냥하면 중력 낙차만큼 반드시 못 미친다.
       (2) 낙차를 보정해 조준점을 올려도, 포물선을 타는 탄의 속도 방향은 매 프레임 바뀌므로
           그걸 쫓아 돌리는 것만으로 궤적이 흔들려 오히려 더 빗나갔다.

       그래서 매 프레임 '이대로 두면 어디에 떨어지는가'를 풀고, 그 지점을 표적 쪽으로 민다.
       pull 은 옮길 수 있는 총량(px)이다 — 이 값이 곧 "얼마나 못 쏴도 봐 주는가"이고,
       그래서 유도는 조준을 대신하지 않는다. 크게 빗나간 발은 예산을 다 써도 표적에 못 닿는다. */
    if (w.homing && s.life > w.homing.after && s.pullLeft > 0) {
      var tgt = target || this.nearestEnemy(s);
      if (tgt) {
        var gEff = this.g * (w.grav == null ? 1 : w.grav);
        var dy = (tgt.y - 6) - s.y;
        var disc = s.vy * s.vy + 2 * gEff * dy;
        if (disc > 0 && C.hypot(tgt.x - s.x, dy) < w.homing.range) {
          var tof = (-s.vy + C.sqrt(disc)) / gEff;      // 표적 높이에 닿기까지 남은 시간
          if (tof > 0.05) {
            var err = tgt.x - (s.x + s.vx * tof);       // 그대로 두면 이만큼 빗나간다
            var step = w.homing.rate * dt;              // 한 프레임에 옮길 수 있는 거리(px)
            var shift = err > step ? step : (err < -step ? -step : err);
            var mag = shift < 0 ? -shift : shift;
            if (mag > s.pullLeft) { shift = shift < 0 ? -s.pullLeft : s.pullLeft; mag = s.pullLeft; }
            s.pullLeft -= mag;
            s.vx += shift / tof;
          }
        }
      }
    }

    var prevVy = s.vy;
    s.vy += this.g * (w.grav == null ? 1 : w.grav) * dt;
    if (!s.noWind) s.vx += this.wind * 15 * (w.wind == null ? 1 : w.wind) * dt;

    // 정점 분열
    if (w.split && w.split.at === 'apex' && !s.split && prevVy <= 0 && s.vy > 0) {
      s.split = true;
      this.doSplit(s, w.split, 0);
      return false;
    }
    // 비행 비율 기반 분열 (볼케이노 소이 폭우 등) — 정점이 아니라 하강 구간 80% 부근
    if (w.split && w.split.at === 'frac' && !s.split && s.splitAtLife > 0 && s.life >= s.splitAtLife) {
      s.split = true;
      this.doSplit(s, w.split, 0);
      return false;
    }

    // 부분 스텝 이동 — 얇은 벽을 뚫고 지나가지 않게 한다
    var mx = s.vx * dt, my = s.vy * dt;
    var dist = C.hypot(mx, my);
    var steps = Math.max(1, Math.ceil(dist / SHELL_STEP));
    var sx = mx / steps, sy = my / steps;
    s.px = s.x; s.py = s.y;

    for (var k = 0; k < steps; k++) {
      s.x += sx; s.y += sy;

      if (s.x < -400 || s.x > this.map.w + 400) { if (s.warp != null) this.warpFail(s); return false; }
      if (s.y > this.map.h + 300) { if (s.warp != null) this.warpFail(s); return false; }
      if (s.y < -3000) { if (s.warp != null) this.warpFail(s); return false; }

      /* 텔레포트탄은 지형에만 반응한다. 전차를 통과시키는 이유는
         상대 자리에 겹쳐 착지하는 상황을 아예 만들지 않기 위해서다. */
      if (s.warp != null) {
        if (this.terrain.solid(Math.round(s.x), Math.round(s.y))) { this.warpTo(s, s.x, s.y); return false; }
        continue;
      }

      // 전차 명중
      var t = this.tankAt(s.x, s.y, s.owner, s.hit);
      if (t) {
        s.hit[t.id] = 1;
        if (s.pierce > 0) { s.pierce--; this.damage(t, w.dmg * s.dmgMul * 0.55, 'pierce'); continue; }
        this.explode(s.x, s.y, w, s.owner, s.dmgMul);
        if (w.split && w.split.at === 'impact') this.doSplit(s, w.split, 1);
        return false;
      }

      var isSolid = this.terrain.solid(Math.round(s.x), Math.round(s.y));

      /* 관통탄은 한 번 박히면 '자기가 판 구덩이'와 무관하게 정해진 거리만큼 전진한다.
         지형이 단단한지로 계속할지를 판단하면 안 된다 — 첫 폭발이 반경 40 짜리 구덩이를 만드는 순간
         탄은 허공에 놓이고, 곧바로 '뚫고 나왔다'로 처리되어 두 번째 폭발이 1px 옆에서 터진다.
         실제로 그렇게 나왔고, 화면에는 구덩이가 하나로만 보였다. */
      if (w.drill && (isSolid || s.drilled >= 0)) {
        /* 첫 타는 '닿는 순간', 마지막 타는 '다 파고든 지점'이다 — 그래서 구덩이가 drill 만큼 떨어져 두 개 남는다.
           깊이를 등분해 중간부터 터뜨리면 얇은 지형에서 첫 임계에 닿지도 못해 한 번밖에 안 터진다.
           총 피해는 타수로 나누므로 상향이 아니라 분산이다. */
        if (s.drilled < 0) { s.drilled = 0; this.emit({ type: 'drillIn', x: s.x, y: s.y }); }
        else s.drilled += SHELL_STEP;
        if ((s.drilled | 0) % 8 < SHELL_STEP) this.terrain.crater(s.x, s.y, 7 * TSCALE);
        var hits = w.drillHits || 1;
        var mark = hits > 1 ? w.drill * s.drillStage / (hits - 1) : w.drill;
        if (s.drilled >= mark) {
          s.drillStage++;
          this.explode(s.x, s.y, w, s.owner, s.dmgMul / hits);
          if (s.drillStage >= hits) return false;
        }
        continue;                                    // 계속 파고든다
      }

      if (isSolid) {
        this.explode(s.x, s.y, w, s.owner, s.dmgMul);
        if (w.split && w.split.at === 'impact') this.doSplit(s, w.split, 1);
        return false;
      }
    }

    s.trail.push(s.x, s.y);
    if (s.trail.length > 160) s.trail.splice(0, 2);
    return true;
  };

  /* 텔레포트탄이 땅에 닿았다 — 쏜 전차를 그 자리로 옮긴다.
     지형을 파지도, 피해를 주지도 않는다. 오직 이동이다. */
  World.prototype.warpTo = function (s, x, y) {
    var t = this.tanks[s.warp];
    if (!t || t.dead) return;
    var gy = this.terrain.groundBelow(Math.round(x), Math.round(y) - 2);
    this.emit({ type: 'warpOut', x: t.x, y: t.y, id: t.id });
    t.x = C.clamp(Math.round(x), TANK_HW, this.map.w - TANK_HW);
    if (gy < this.map.h) {
      t.y = gy - TANK_HH; t.grounded = true; this.updateTilt(t);
    } else {
      /* 착지할 땅이 없다 — 그대로 허공에 놓는다. 떨어져 죽는 것까지가 이 아이템의 위험이다.
         안전한 자리로 몰래 옮겨 주면 낙사 맵에서 무적 탈출기가 된다. */
      t.y = y; t.grounded = false; t.vx = 0; t.vy = 0;
    }
    this.collectCrates(t);
    this.emit({ type: 'warpIn', x: t.x, y: t.y, id: t.id, safe: gy < this.map.h });
  };

  World.prototype.warpFail = function (s) {
    var t = this.tanks[s.warp];
    this.emit({ type: 'warpMiss', id: s.warp, x: t ? t.x : 0, y: t ? t.y : 0 });
  };

  World.prototype.doSplit = function (s, sp, impact) {
    var child = WPN.get(sp.child);
    var base = C.atan2(s.vy, s.vx);
    var spd = C.hypot(s.vx, s.vy);
    if (impact) { base = -1.5707963; spd = sp.up || 240; }
    for (var i = 0; i < sp.n; i++) {
      var off = (i - (sp.n - 1) / 2) * (sp.spread || 0) * C.DEG;
      var a = base + off;
      var m = 0.85 + 0.3 * ((i % 3) / 3);
      var ch = new Shell(child, s.x, s.y, C.cos(a) * spd * m, C.sin(a) * spd * m, s.owner, s.gen + 1, s.dmgMul);
      ch.noWind = s.noWind;                    // 강화·무풍은 자탄까지 이어진다
      this.shells.push(ch);
    }
    this.emit({ type: 'split', x: s.x, y: s.y, color: s.w.color });
  };

  World.prototype.tankAt = function (x, y, ownerId, hit) {
    for (var i = 0; i < this.tanks.length; i++) {
      var t = this.tanks[i];
      if (t.dead || (hit && hit[t.id])) continue;
      if (x > t.x - TANK_HW && x < t.x + TANK_HW && y > t.y - TANK_HH && y < t.y + TANK_HH) return t;
    }
    return null;
  };

  World.prototype.nearestEnemy = function (s) {
    var me = this.tanks[s.owner], best = null, bd = 1e9;
    for (var i = 0; i < this.tanks.length; i++) {
      var t = this.tanks[i];
      if (t.dead || t.id === s.owner) continue;
      if (me && me.team != null && t.team === me.team) continue;
      var d = C.hypot(t.x - s.x, t.y - s.y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };

  World.prototype.explode = function (x, y, w, ownerId, mul) {
    mul = mul == null ? 1 : mul;
    var rad = w.rad;
    var removed = this.terrain.crater(x, y, rad);
    this.emit({ type: 'boom', x: x, y: y, r: rad, color: w.color || '#FFB86B', dug: removed });
    this.bustCrates(x, y, rad);

    var shooter = this.tanks[ownerId];
    var streakMul = 1, hitEnemy = false;
    if (w.streak && shooter) {
      // 이번 폭발이 지난번과 같은 표적을 또 맞히는가에 따라 배율이 정해진다
      streakMul = 1 + STREAK_STEP * Math.min(shooter.streak, STREAK_MAX - 1);
    }

    var reach = rad + 14;
    for (var i = 0; i < this.tanks.length; i++) {
      var t = this.tanks[i];
      if (t.dead) continue;
      var dx = t.x - x, dy = (t.y) - y;
      var d = C.hypot(dx, dy);
      if (d > reach) continue;
      var f = 1 - d / reach;                      // 0..1
      var dmg = w.dmg * mul * (0.25 + 0.75 * f);
      var foe = shooter && t.id !== ownerId && (shooter.team == null || t.team !== shooter.team);
      if (foe && w.streak) dmg *= streakMul;
      if (t.id === ownerId) dmg *= 0.6;           // 자해는 60%
      this.damage(t, dmg, 'blast');

      // 화염은 살아 있는 표적에만 붙는다. 죽은 전차를 태울 이유가 없다
      if (w.burn && !t.dead && t.id !== ownerId) {
        t.burn = Math.min(BURN_MAX, t.burn + w.burn);
        this.emit({ type: 'burnOn', id: t.id, x: t.x, y: t.y, n: t.burn });
      }
      if (foe) hitEnemy = true;
      if (t.dead) continue;
      var push = w.push * 300 * f / t.def.mass;
      var nx = d < 0.5 ? 0 : dx / d, ny = d < 0.5 ? -1 : dy / d;
      t.vx += nx * push;
      t.vy += ny * push - push * 0.55;            // 위로 살짝 띄운다. 이게 없으면 지형에 갈려서 안 밀린다
      t.grounded = false;
    }

    /* 연속 명중 갱신. 적을 못 맞혔으면 처음으로 돌아간다 —
       "빗나가지 않는 한 계속 강해진다"가 이 계열의 정체성이므로, 한 번 빗나가면 대가를 치러야 한다. */
    if (w.streak && shooter) {
      if (!hitEnemy) { shooter.streak = 0; shooter.streakOn = -1; }
      else {
        var near = null, nd = 1e9;
        for (var q = 0; q < this.tanks.length; q++) {
          var o = this.tanks[q];
          if (o.id === ownerId || (shooter.team != null && o.team === shooter.team)) continue;
          var od = C.hypot(o.x - x, o.y - y);
          if (od < nd) { nd = od; near = o; }
        }
        if (near) {
          shooter.streak = (shooter.streakOn === near.id) ? shooter.streak + 1 : 1;
          shooter.streakOn = near.id;
          this.emit({ type: 'streak', id: ownerId, n: shooter.streak, x: shooter.x, y: shooter.y });
        }
      }
    }
  };

  /* 자기 턴 시작에 탄다. match.pickNext 가 부른다. */
  World.prototype.tickBurn = function (t) {
    if (!t || t.dead || t.burn <= 0) return 0;
    var dmg = t.burn * BURN_DMG;
    this.emit({ type: 'burnTick', id: t.id, x: t.x, y: t.y, n: t.burn, dmg: dmg });
    this.damage(t, dmg, 'burn');
    t.burn--;                                  // 한 턴에 한 겹씩 꺼진다
    return dmg;
  };

  /* ── 전체 전진 ─────────────────────────────────────────────── */

  World.prototype.step = function (dt) {
    this.time += dt; this.tick++;
    this.stepShells(dt, null);
    this.stepCrates(dt);
    for (var i = 0; i < this.tanks.length; i++) {
      this.stepTankBody(this.tanks[i], dt);
      this.collectCrates(this.tanks[i]);      // 넉백으로 밀려가다 줍는 것도 인정한다
    }
  };

  World.prototype.settled = function () {
    if (this.shells.length) return false;
    for (var i = 0; i < this.tanks.length; i++) {
      var t = this.tanks[i];
      if (!t.dead && !t.grounded) return false;
    }
    // 떨어지는 중인 상자가 있으면 아직 끝나지 않았다 — 착지 지점이 다음 턴의 판단에 들어간다
    for (var k = 0; k < this.crates.length; k++) if (!this.crates[k].grounded) return false;
    return true;
  };

  /* AI·조준 보조용 순수 예측. 유도/분열은 무시한다 — 그건 예측 대상이 아니라 보너스다. */
  World.prototype.predict = function (t, w, angleDeg, power, maxT) {
    var m = this.muzzle(t), sp = this.speedOf(t, w, power);
    var a = angleDeg * C.DEG;
    var x = m.x, y = m.y, vx = C.cos(a) * sp * t.dir, vy = -C.sin(a) * sp;
    var g = this.g * (w.grav == null ? 1 : w.grav), wd = this.wind * 15 * (w.wind == null ? 1 : w.wind);
    var dt = 1 / 60, tt = 0, lim = maxT || 12;
    var pts = [];
    while (tt < lim) {
      vy += g * dt; vx += wd * dt;
      var mx = vx * dt, my = vy * dt;
      var steps = Math.max(1, Math.ceil(C.hypot(mx, my) / 4));
      var sx = mx / steps, sy = my / steps;
      for (var k = 0; k < steps; k++) {
        x += sx; y += sy;
        if (x < -200 || x > this.map.w + 200 || y > this.map.h + 200) return { x: x, y: y, hit: 'out', pts: pts, t: tt };
        if (this.terrain.solid(Math.round(x), Math.round(y))) return { x: x, y: y, hit: 'ground', pts: pts, t: tt };
        var h = this.tankAt(x, y, t.id, null);
        if (h) return { x: x, y: y, hit: 'tank', tank: h, pts: pts, t: tt };
      }
      pts.push(x, y);
      tt += dt;
    }
    return { x: x, y: y, hit: 'none', pts: pts, t: tt };
  };

  root.TFPhysics = {
    World: World, Tank: Tank, Crate: Crate, DT: DT,
    TANK_HW: TANK_HW, TANK_HH: TANK_HH, CRATE_HW: CRATE_HW, CRATE_HH: CRATE_HH,
    BURN_DMG: BURN_DMG, BURN_MAX: BURN_MAX, STREAK_STEP: STREAK_STEP, STREAK_MAX: STREAK_MAX
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
