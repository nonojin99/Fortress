/* logic/ai.js — 컴퓨터 사수.
   사람이 하는 것과 같은 방식으로 푼다: 각도를 정하고, 게이지를 조절해 보고, 빗나간 만큼 고친다.
   포물선 공식을 역산해서 "무조건 명중"을 만들면 상대할 가치가 없어진다. 그래서 탐색 + 오차 주입이다.
   오차는 마지막에 한 번만 얹는다 — 탐색 중에 흔들면 난이도가 아니라 무작위가 된다. */
(function (root) {
  'use strict';
  var C = root.TFCore, WPN = root.TFWeapons;

  var LEVELS = [
    { name: '신병', da: 9.0, dp: 12, subChance: 0.15, moveWill: 0.2, itemWill: 0.45 },
    { name: '숙련', da: 3.2, dp: 4.5, subChance: 0.45, moveWill: 0.5, itemWill: 0.8 },
    { name: '교관', da: 1.1, dp: 1.6, subChance: 0.8, moveWill: 0.8, itemWill: 1.0 }
  ];

  function pickTarget(m, me) {
    var best = null, bs = -1e9;
    for (var i = 0; i < m.world.tanks.length; i++) {
      var t = m.world.tanks[i];
      if (t.dead || t.id === me.id) continue;
      if (me.team != null && t.team === me.team) continue;
      var d = C.hypot(t.x - me.x, t.y - me.y);
      // 체력이 낮을수록, 가까울수록, 낭떠러지에 가까울수록 매력적
      var s = (150 - t.hp) * 1.4 - d * 0.06 + cliffRisk(m, t) * 60;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }

  /* 그 전차가 낙사 위험에 얼마나 노출돼 있는가 (0..1). 넉백 무기 선택에 쓴다. */
  function cliffRisk(m, t) {
    var tr = m.world.terrain, h = m.map.h, risk = 0;
    for (var dx = -70; dx <= 70; dx += 14) {
      if (dx === 0) continue;
      var g = tr.groundBelow(Math.round(t.x + dx), Math.round(t.y - 20));
      if (g >= h) risk += 0.16;
      else if (g - t.y > 160) risk += 0.07;
    }
    return C.clamp(risk, 0, 1);
  }

  /* 주우러 갈 만한 상자. 아직 떨어지는 중인 상자는 무시한다 —
     착지 지점이 확정되지 않았는데 달려가면 헛걸음이 된다. */
  function nearestCrate(m, me) {
    var best = null, bd = 1e9;
    var cs = m.world.crates;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (!c.grounded) continue;
      var d = Math.abs(c.x - me.x);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function score(m, me, tgt, r) {
    if (r.hit === 'tank') return r.tank.id === tgt.id ? 0 : (r.tank.team === me.team ? 900 : 40);
    return C.hypot(r.x - tgt.x, r.y - tgt.y);
  }

  function solve(m, me, tgt, w, a0, a1, aStep, p0, p1, pStep) {
    var best = null;
    for (var a = a0; a <= a1; a += aStep) {
      for (var p = p0; p <= p1; p += pStep) {
        var r = m.world.predict(me, w, a, p, 11);
        var s = score(m, me, tgt, r);
        if (!best || s < best.s) best = { s: s, a: a, p: p, r: r };
      }
    }
    return best;
  }

  /* 한 턴의 계획을 통째로 돌려준다. 앱은 이걸 시간에 걸쳐 재생만 한다. */
  function plan(m) {
    var me = m.actor();
    if (!me) return null;
    var lv = LEVELS[C.clamp((me.aiLevel | 0), 0, 2)];
    var tgt = pickTarget(m, me);
    if (!tgt) return { fire: false };

    var dir = tgt.x >= me.x ? 1 : -1;
    me.dir = dir;

    // 무기 선택 — 낭떠러지 옆이면 넉백, 죽일 수 있으면 최대 화력, 아니면 메인
    var sub = WPN.get(me.def.sub), main = WPN.get(me.def.main);
    var wid = me.def.main;
    if (me.ammo[me.def.sub] > 0 && m.world.arng.next() < lv.subChance) {
      var risk = cliffRisk(m, tgt);
      var lethal = sub.dmg * (1 - tgt.def.armor) >= tgt.hp;
      if (lethal || risk > 0.3 || sub.type === '유도') wid = me.def.sub;
    }
    var w = WPN.get(wid);

    var lo = me.def.angle[0], hi = me.def.angle[1];
    var coarse = solve(m, me, tgt, w, lo, hi, 5, 25, 100, 7);
    var fine = solve(m, me, tgt, w,
      C.clamp(coarse.a - 6, lo, hi), C.clamp(coarse.a + 6, lo, hi), 1.5,
      C.clamp(coarse.p - 9, 5, 100), C.clamp(coarse.p + 9, 5, 100), 2);
    var best = fine.s < coarse.s ? fine : coarse;

    // 크게 빗나가면 자리를 옮겨 보고 다시 푼다 (지형에 막힌 경우가 대부분이다)
    /* 보급 상자가 연료 안에 있으면 주우러 간다. 조준보다 먼저 판단한다 —
       주운 다음에 조준해야 아이템을 그 턴에 쓸 수 있기 때문이다. */
    var moves = [];
    var crate = nearestCrate(m, me);
    if (crate) {
      var cd = crate.x - me.x;
      var need = Math.abs(cd);
      if (need <= me.fuel * 0.92) {
        moves.push({ d: cd > 0 ? 1 : -1, px: Math.ceil(need) });
        var save0 = { x: me.x, y: me.y, fuel: me.fuel, tilt: me.tilt, grounded: me.grounded, vx: me.vx, vy: me.vy };
        m.world.moveTank(me, cd > 0 ? 1 : -1, Math.ceil(need), true);
        best = solve(m, me, tgt, w, lo, hi, 4, 25, 100, 6);   // 옮긴 자리에서 다시 푼다
        me.x = save0.x; me.y = save0.y; me.fuel = save0.fuel; me.tilt = save0.tilt;
        me.grounded = save0.grounded; me.vx = save0.vx; me.vy = save0.vy;
      }
    }

    /* 자리를 옮겨 보는 시뮬레이션. moveTank 는 절벽을 만나면 grounded·vx·vy 까지 건드리므로
       x/y/fuel 만 되돌리면 "생각만 했는데 실제로 떨어지는" 전차가 나온다. 전부 되돌린다. */
    if (best.s > 140 && m.world.arng.next() < lv.moveWill && me.fuel > 20) {
      var save = {
        x: me.x, y: me.y, fuel: me.fuel, tilt: me.tilt,
        grounded: me.grounded, vx: me.vx, vy: me.vy
      };
      var restore = function () {
        me.x = save.x; me.y = save.y; me.fuel = save.fuel; me.tilt = save.tilt;
        me.grounded = save.grounded; me.vx = save.vx; me.vy = save.vy;
      };
      var tryDir = [dir, -dir], bestMove = null;
      for (var k = 0; k < 2; k++) {
        restore();
        var used = 0;
        for (var s2 = 0; s2 < 3; s2++) {
          if (!m.world.moveTank(me, tryDir[k], 18, true)) break;
          used += 18;
          var c2 = solve(m, me, tgt, w, lo, hi, 6, 25, 100, 9);
          if (c2.s < best.s * 0.7 && (!bestMove || c2.s < bestMove.s)) {
            bestMove = { s: c2.s, d: tryDir[k], px: used, a: c2.a, p: c2.p };
          }
        }
      }
      restore();
      if (bestMove) {
        moves.push({ d: bestMove.d, px: bestMove.px });
        best = { s: bestMove.s, a: bestMove.a, p: bestMove.p };
      }
    }

    var jitterA = (m.world.arng.next() * 2 - 1) * lv.da;
    var jitterP = (m.world.arng.next() * 2 - 1) * lv.dp;
    return {
      fire: true, weapon: wid, dir: dir, moves: moves,
      items: pickItems(m, me, tgt, w, best, lv),
      angle: C.clamp(best.a + jitterA, lo, hi),
      power: C.clamp(best.p + jitterP, 5, 100),
      target: tgt.id, level: lv.name
    };
  }

  /* 어떤 아이템을 쓸 것인가. 순서가 곧 우선순위다 —
     살아남는 것(회복·차폐·이송)이 먼저고, 화력 증폭은 맞힐 수 있을 때만 쓴다.
     신병은 절반만 쓴다. 다 쓰게 두면 초보 난이도에서 아이템 때문에 지는 일이 생긴다. */
  function pickItems(m, me, tgt, w, best, lv) {
    var IT = root.TFItems;
    if (!IT) return [];
    var out = [], hp = me.hp / me.hpMax;
    var use = lv.itemWill == null ? 1 : lv.itemWill;
    function want(id, cond) {
      if (!cond || !IT.has(me, id)) return;
      if (m.world.arng.next() > use) return;
      out.push(id);
    }

    var risk = cliffRisk(m, me);
    want('heal', hp < 0.55);
    want('shield', hp < 0.5);
    want('teleport', risk > 0.35 && hp < 0.6);
    want('fuel', me.fuel < me.fuelMax * 0.3 && risk > 0.25);

    // 맞을 것 같을 때만 화력을 얹는다. 빗나갈 각이면 아껴 둔다.
    var willHit = best.s < 60;
    var lethal = w.dmg * 1.6 * (1 - tgt.def.armor) >= tgt.hp;
    want('power', willHit && (lethal || tgt.hp < 70));
    want('double', willHit && !lethal);
    want('windless', Math.abs(m.world.wind) > (m.map.wind || 1) * 0.55 && (w.wind == null || w.wind >= 1));
    return out;
  }

  root.TFAI = { plan: plan, LEVELS: LEVELS, cliffRisk: cliffRisk };
})(typeof globalThis !== 'undefined' ? globalThis : this);
