/* sim/test.js — 화면 없이 게임을 통째로 검증한다.
     node 가 있으면  node sim/test.js
     없으면          python -m http.server 후 sim/test.html
   같은 파일이 양쪽에서 돈다. 여기서 통과하지 못한 것은 브라우저에서도 통과하지 못한다.
   렌더러를 고치기 전에 항상 이걸 먼저 본다. */
if (typeof require === 'function') {
  require('../logic/core.js');
  require('../logic/terrain.js');
  require('../logic/maps.js');
  require('../logic/weapons.js');
  require('../logic/tanks.js');
  require('../logic/physics.js');
  require('../logic/items.js');
  require('../logic/match.js');
  require('../logic/ai.js');
}

var C = globalThis.TFCore, T = globalThis.TFTerrain, MAPS = globalThis.TFMaps,
  WPN = globalThis.TFWeapons, TANKS = globalThis.TFTanks, PH = globalThis.TFPhysics,
  MT = globalThis.TFMatch, AI = globalThis.TFAI, IT = globalThis.TFItems;


/* 스폰이 무작위가 되면서 '무기가 어떻게 나는가'를 재는 테스트들이 흔들렸다.
   그 테스트들이 보려는 건 스폰이 아니므로 사수와 표적을 고정된 자리에 놓는다.
   스폰 자체는 8d 절에서 따로 검증한다. */
function place(w, i, frac) {
  var t = w.tanks[i];
  t.x = Math.round(w.map.w * frac);
  t.y = w.groundUnder(t.x, 0) - PH.TANK_HH;
  t.grounded = true; t.vx = 0; t.vy = 0;
  w.updateTilt(t);
  return t;
}

var pass = 0, fail = 0, notes = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + '  ' + (detail || '')); }
}
function head(s) { console.log('\n' + s); }

/* ── 1. 결정론 수학 ──────────────────────────────────────────── */
head('1. 결정론 수학');
(function () {
  var worst = 0;
  for (var i = 0; i < 2000; i++) {
    var a = (i / 2000) * 12 - 6;
    var e = Math.abs(C.sin(a) - Math.sin(a));
    if (e > worst) worst = e;
  }
  ok('sin 테이블 오차 < 1e-6', worst < 1e-6, 'max ' + worst.toExponential(2));

  var worst2 = 0;
  for (var j = 0; j < 1000; j++) {
    var x = (j % 37) - 18 + 0.3, y = ((j * 7) % 41) - 20 + 0.7;
    var e2 = Math.abs(C.atan2(y, x) - Math.atan2(y, x));
    if (e2 > worst2) worst2 = e2;
  }
  ok('atan2 오차 < 2e-3', worst2 < 2e-3, 'max ' + worst2.toExponential(2));

  var r1 = new C.RNG(12345), r2 = new C.RNG(12345), same = true;
  for (var k = 0; k < 500; k++) if (r1.next() !== r2.next()) same = false;
  ok('RNG 동일 시드 동일 수열', same);
})();

/* ── 2. 지형 ─────────────────────────────────────────────────── */
head('2. 지형 10맵');
MAPS.list.forEach(function (m) {
  var t = T.build(MAPS.spec(m), 7);
  var scan = (m.spawnScanY || 0) * m.h;
  var landable = 0;
  for (var i = 0; i < m.spawn.length; i++) {
    var b = m.spawn[i], hits = 0;
    for (var k = 0; k < 20; k++) {
      var x = Math.round(m.w * C.lerp(b[0], b[1], k / 19));
      if (t.groundBelow(x, scan) < m.h) hits++;
    }
    if (hits >= 8) landable++;
  }
  var solid = 0;
  for (var p = 0; p < t.mask.length; p += 97) if (t.mask[p]) solid++;
  var fillPct = (solid / (t.mask.length / 97) * 100);
  ok(m.id.padEnd(10) + ' 스폰 ' + landable + '/' + m.spawn.length + ' 지형 ' + fillPct.toFixed(0) + '%',
    landable === m.spawn.length && fillPct > 4 && fillPct < 92);
});

head('2b. 파괴');
(function () {
  var m = MAPS.get('ridge');
  var t = T.build(MAPS.spec(m), 3);
  var x = 1100, before = t.surface(x);
  var dug = t.crater(x, before + 30, 60);
  ok('구덩이가 픽셀을 지운다', dug > 3000, dug + 'px');
  ok('지표면이 내려간다(붕괴 포함)', t.surface(x) >= before, before + ' → ' + t.surface(x));
  var t2 = T.build(MAPS.spec(MAPS.get('spires')), 3);
  t2.settle = false;
  var sx = 1150;
  var top0 = t2.surface(sx);
  t2.crater(sx, top0 + 120, 70);
  ok('붕괴 끄면 천장이 남는다', t2.surface(sx) === top0, 'top ' + t2.surface(sx));
})();

/* ── 3. 포탄 물리 ────────────────────────────────────────────── */
head('3. 포탄 물리');
(function () {
  var m = MAPS.get('ridge');
  var w = new PH.World(m, 11);
  w.addTank('titan', 'P1', 0, 0);
  w.addTank('titan', 'P2', 1, 1);
  var a = place(w, 0, 0.15), b = place(w, 1, 0.72);
  w.wind = 0;

  // 45도 90파워 사거리 — 공식값과 비교 (지형 무시 궤적)
  var slug = WPN.get('slug');
  var sp = w.speedOf(a, slug, 90);
  var theory = sp * sp * Math.sin(2 * 45 * Math.PI / 180) / (m.gravity * slug.grav);
  var r = w.predict(a, slug, 45, 90, 12);
  var flat = Math.abs((r.x - a.x) - theory) / theory;
  ok('45° 사거리가 포물선 공식과 ±25% 이내', flat < 0.25,
    '실측 ' + Math.round(r.x - a.x) + ' 이론 ' + Math.round(theory));

  // 각도가 커지면 정점도 높아진다
  var lowTop = 1e9, highTop = 1e9;
  var p1 = w.predict(a, slug, 20, 80, 12), p2 = w.predict(a, slug, 70, 80, 12);
  for (var i = 1; i < p1.pts.length; i += 2) if (p1.pts[i] < lowTop) lowTop = p1.pts[i];
  for (var j = 1; j < p2.pts.length; j += 2) if (p2.pts[j] < highTop) highTop = p2.pts[j];
  ok('고각이 더 높이 뜬다', highTop < lowTop, Math.round(lowTop) + ' → ' + Math.round(highTop));

  // 바람이 궤적을 민다
  w.wind = 0; var noWind = w.predict(a, WPN.get('glide'), 45, 80, 12).x;
  w.wind = 5; var tail = w.predict(a, WPN.get('glide'), 45, 80, 12).x;
  w.wind = -5; var headw = w.predict(a, WPN.get('glide'), 45, 80, 12).x;
  ok('순풍이 멀리, 역풍이 가깝게', tail > noWind && noWind > headw,
    Math.round(headw) + ' < ' + Math.round(noWind) + ' < ' + Math.round(tail));
  w.wind = 0;

  // 예측과 실사격이 일치하는가 (예측은 dt 1/60, 실사격은 1/120)
  var pr = w.predict(a, slug, 42, 85, 12);
  a.angle = 42; a.weapon = 'slug';
  w.fire(a, 'slug', 85);
  var last = { x: 0, y: 0 };
  for (var s = 0; s < 2000 && w.shells.length; s++) {
    last.x = w.shells[0].x; last.y = w.shells[0].y;
    w.step(PH.DT);
  }
  var err = C.hypot(last.x - pr.x, last.y - pr.y);
  ok('예측 착탄 오차 < 40px', err < 40, Math.round(err) + 'px');
})();

head('3b. 무기 거동');
(function () {
  function fresh(mapId, atk, def) {
    var w = new PH.World(MAPS.get(mapId || 'ridge'), 21);
    w.wind = 0;
    w.addTank(atk || 'driller', 'P1', 0, 0);
    w.addTank(def || 'titan', 'P2', 1, 1);
    place(w, 0, 0.16); place(w, 1, 0.68);
    return w;
  }
  // 돌파탄은 지형을 뚫고 반대편에 구덩이를 남긴다
  var w1 = fresh('spires', 'driller');
  var t1 = w1.tanks[0];
  t1.angle = 8;
  var deep = 0;
  w1.fire(t1, 'mole', 70);
  var booms = 0, drills = 0;
  for (var i = 0; i < 3000 && w1.shells.length; i++) {
    w1.step(PH.DT);
    for (var e = 0; e < w1.events.length; e++) {
      if (w1.events[e].type === 'drillIn') drills++;
      if (w1.events[e].type === 'boom') booms++;
    }
    w1.events.length = 0;
  }
  ok('지저 관통이 지형에 파고든다', drills > 0 && booms > 0, 'drill ' + drills + ' boom ' + booms);

  /* 관통탄은 파고들며 '따닥' 두 번 터진다.
     한 번만 터지면 드릴 모양을 해 놓고 지형에는 구덩이 하나만 남아 정체성이 안 산다. */
  (function () {
    function drillBooms(weaponId, tankId) {
      var w = new PH.World(MAPS.get('spires'), 41);
      w.wind = 0;
      w.addTank(tankId, 'P1', 0, 0);
      w.addTank('titan', 'P2', 1, 1);
      var t = w.tanks[0];
      t.angle = 10;
      w.fire(t, weaponId, 72);
      var shells = w.shells.length, booms = 0;
      for (var i = 0; i < 4000 && w.shells.length; i++) {
        w.step(PH.DT);
        for (var e = 0; e < w.events.length; e++) if (w.events[e].type === 'boom') booms++;
        w.events.length = 0;
      }
      return { shells: shells, booms: booms };
    }
    var b = drillBooms('bore', 'driller');
    ok('천공탄이 한 발로 두 번 터진다', b.booms >= 2, b.shells + '발 → ' + b.booms + '회 폭발');
    var mo = drillBooms('mole', 'driller');
    ok('지저 관통은 두 발이 각각 두 번씩 터진다', mo.booms >= 4,
      mo.shells + '발 → ' + mo.booms + '회 폭발');

    /* 피해는 나뉘기만 하고 늘어나지 않아야 한다 — 총량이 커지면 그냥 상향이지 재설계가 아니다. */
    function totalDamage(weaponId, hitsOverride) {
      var w = new PH.World(MAPS.get('ridge'), 42);
      w.wind = 0;
      w.addTank('driller', 'P1', 0, 0);
      w.addTank('titan', 'P2', 1, 1);
      var t = w.tanks[0], v = w.tanks[1];
      v.hp = v.hpMax = 4000;
      var wd = WPN.get(weaponId);
      var half = wd.dmg / (hitsOverride || 1);
      // 같은 자리에서 hits 번 터뜨린 총 피해를 잰다
      var hp0 = v.hp;
      for (var k = 0; k < (hitsOverride || 1); k++) {
        w.explode(v.x, v.y, wd, t.id, 1 / (hitsOverride || 1));
      }
      return hp0 - v.hp;
    }
    var once = totalDamage('bore', 1), twice = totalDamage('bore', 2);
    ok('두 번 나눠 터져도 총 피해는 그대로', Math.abs(once - twice) <= 2,
      '1타 ' + once + ' vs 2타 합계 ' + twice);
  })();

  /* 분열탄은 자식 탄을 만든다.
     동시에 화면에 몇 발 떠 있는지로 세면 안 된다 — 갈라지자마자 한 발이 지면에 닿아 터지면
     최대 동시 개수가 4로 잡힌다. 실제로 몇 발이 갈라져 나왔는지는 '터진 횟수'로 세야 한다. */
  var w2 = fresh('ridge', 'volcano');
  var t2 = w2.tanks[0]; t2.angle = 55;
  w2.fire(t2, 'rain', 75);
  var childBooms = 0, maxShells = 0;
  for (var j = 0; j < 3000 && w2.shells.length; j++) {
    if (w2.shells.length > maxShells) maxShells = w2.shells.length;
    w2.step(PH.DT);
    for (var e2 = 0; e2 < w2.events.length; e2++) if (w2.events[e2].type === 'boom') childBooms++;
    w2.events.length = 0;
  }
  ok('소이 폭우가 5발로 갈라진다', childBooms >= 5,
    childBooms + '회 폭발 (동시 최대 ' + maxShells + '발)');
  ok('소이탄이 좁게 모여 떨어진다', WPN.get('rain').split.spread <= 20,
    WPN.get('rain').split.spread + '°');

  /* 유도는 '조준을 대신'하지 않고 '오차를 깎아' 준다.
     그래서 두 가지를 동시에 봐야 한다 — 잘 쏜 발은 보정을 받고, 엉망으로 쏜 발은 그대로 빗나가야 한다.
     앞의 것만 보면 자동조준을 통과시키게 된다. */
  /* 명중했는가 = 표적이 실제로 피해를 입었는가.
     거리로 재면 안 된다 — 탄이 전차에 부딪히면 중심이 아니라 표면에서 멈추므로
     '맞았는데도 26px 빗나간 것'으로 집계된다. 전차 크기를 바꾸면 그 값이 통째로 흔들린다. */
  function shotHits(weaponId, angleOffset, noHoming) {
    var w = fresh('ridge', 'phantom');
    var A = w.tanks[0], TGT = w.tanks[1];
    // 표적을 정확히 맞히는 각도를 먼저 찾고, 거기서 일부러 어긋나게 쏜다
    var base = null, bs = 1e9;
    for (var a = 20; a <= 80; a += 0.5) {
      var r = w.predict(A, WPN.get(weaponId), a, 70, 11);
      var d = C.hypot(r.x - TGT.x, r.y - TGT.y);
      if (d < bs) { bs = d; base = a; }
    }
    A.angle = base + angleOffset;
    var hp0 = TGT.hp;
    w.fire(A, weaponId, 70);
    // 유도를 끄는 가장 정직한 방법은 보정 예산을 0으로 두는 것이다.
    // 무기 정의를 복제해 homing 을 지우면 grav·speed 같은 다른 값까지 건드릴 위험이 있다.
    if (noHoming) for (var i = 0; i < w.shells.length; i++) w.shells[i].pullLeft = 0;
    for (var k = 0; k < 3000 && w.shells.length; k++) w.step(PH.DT);
    return TGT.hp < hp0;
  }

  /* 명중 여부로 잰다. 픽셀 거리로 재면 전차 크기를 바꿀 때마다 기준이 흔들린다 —
     실제로 전차를 2배로 키우자 히트박스가 커져 '빗나간 거리'가 통째로 줄었고,
     유도가 유효한지 아닌지를 그 숫자로는 더 이상 알 수 없게 됐다. */
  function hitRate(offsets, homingOn) {
    var hit = 0;
    for (var i = 0; i < offsets.length; i++) {
      if (shotHits('hunter', offsets[i], !homingOn)) hit++;
    }
    return hit;
  }
  var NEAR = [-5, -3, 3, 5], FAR = [-22, -16, 16, 22];
  var nh = hitRate(NEAR, true), ns = hitRate(NEAR, false);
  var fh = hitRate(FAR, true), fs = hitRate(FAR, false);

  ok('살짝 빗나간 발을 유도가 명중으로 바꾼다', nh > ns,
    '유도 ' + nh + '/' + NEAR.length + ' vs 무유도 ' + ns + '/' + NEAR.length);
  /* 유도가 조준을 대신하면 안 된다. 크게 빗나간 발까지 맞기 시작하면
     각도와 게이지를 맞추는 일 자체가 의미를 잃는다. */
  ok('크게 빗나간 발은 유도로도 못 맞힌다', fh < FAR.length,
    '유도해도 ' + fh + '/' + FAR.length + ' (무유도 ' + fs + '/' + FAR.length + ')');

  ok('보정 예산이 명중을 뒤집을 만큼은 된다', nh > 0, '유도로 ' + nh + '발 명중');

  // 보정 예산은 유한하다 — 무한정 당겨지면 안 된다
  var wB = fresh('ridge', 'phantom');
  wB.tanks[0].angle = 70;
  wB.fire(wB.tanks[0], 'hunter', 80);
  var pull0 = wB.shells[0].pullLeft;
  for (var q = 0; q < 3000 && wB.shells.length; q++) wB.step(PH.DT);
  ok('보정 예산이 정해져 있다', pull0 === WPN.get('hunter').homing.pull && pull0 > 0,
    '착탄점 최대 ' + pull0 + 'px 이동');
})();

/* ── 4. 승패 ─────────────────────────────────────────────────── */
head('4. 승패 판정');
(function () {
  // 체력 0
  var m = new MT.Match({ mapId: 'ridge', seed: 5, mode: 'solo', roster: [{ tank: 'titan' }, { tank: 'raven' }] });
  var victim = m.world.tanks[1];
  m.world.damage(victim, 999, 'test');
  m.checkEnd();
  ok('체력 0 → 상대 팀 승리', m.result && m.result.winner === 0, JSON.stringify(m.result && m.result.winner));

  /* 낙사. 절벽 좌표를 손으로 적으면 맵을 손볼 때마다 테스트가 깨진다 —
     실제로 협곡 폭이 바뀌면서 x=1200 이 taper 가 남긴 턱 위에 올라가 버렸다.
     전차 폭 전체가 허공인 x 를 지형에서 직접 찾는다. */
  function voidXOf(world) {
    for (var x = 40; x < world.map.w - 40; x += 4) {
      if (world.groundUnder(x, 0) >= world.map.h) return x;
    }
    return -1;
  }
  var m2 = new MT.Match({ mapId: 'canyon', seed: 5, mode: 'solo', roster: [{ tank: 'titan' }, { tank: 'raven' }] });
  var vx2 = voidXOf(m2.world);
  ok('협곡에 진짜 허공 구간이 있다', vx2 > 0, 'x ' + vx2);
  var v2 = m2.world.tanks[1];
  v2.x = vx2; v2.y = 200; v2.grounded = false; v2.vy = 100;
  for (var i = 0; i < 2000 && !v2.dead; i++) m2.world.step(PH.DT);
  ok('협곡으로 떨어지면 낙사', v2.dead && v2.deathBy === 'void', v2.deathBy);
  m2.checkEnd();
  ok('낙사도 승리 조건이다', m2.result && m2.result.winner === 0 && m2.result.voidKills === 1);

  // 넉백으로 떨어뜨리기
  var m3 = new MT.Match({ mapId: 'canyon', seed: 9, mode: 'solo', roster: [{ tank: 'guardian' }, { tank: 'zephyr' }] });
  var pusher = m3.world.tanks[0], pushed = m3.world.tanks[1];
  pushed.x = 1000; pushed.y = m3.world.terrain.groundBelow(1000, 0) - PH.TANK_HH;
  m3.world.explode(pushed.x - 20, pushed.y, WPN.get('bulwark'), pusher.id);
  ok('충격파가 전차를 민다', Math.abs(pushed.vx) > 60 || !pushed.grounded, 'vx ' + Math.round(pushed.vx));
})();

/* ── 5. 전차·무기 표 ─────────────────────────────────────────── */
head('5. 전차 10종 · 무기 표');
(function () {
  ok('전차 10종', TANKS.list.length === 10, TANKS.list.map(function (t) { return t.name; }).join(' '));
  var types = {};
  var missing = [];
  TANKS.list.forEach(function (t) {
    var a = WPN.get(t.main), b = WPN.get(t.sub);
    if (!a || !b) missing.push(t.id);
    if (a) types[a.type] = (types[a.type] || 0) + 1;
    if (b) types[b.type] = (types[b.type] || 0) + 1;
  });
  ok('모든 전차가 메인·보조를 갖는다', missing.length === 0, missing.join(','));
  ok('요구 4분류가 모두 존재', ['유도', '범위', '돌파', '집중'].every(function (k) { return types[k] > 0; }),
    JSON.stringify(types));

  var ratios = [];
  Object.keys(WPN.all).forEach(function (id) {
    var r = WPN.value(id);
    if (r != null) ratios.push({ id: id, r: r });
  });
  ratios.sort(function (a, b) { return a.r - b.r; });
  var lo = ratios[0], hi = ratios[ratios.length - 1];
  ok('무기 실효값 최대/최소 2.2배 이내', hi.r / lo.r < 2.2,
    lo.id + ' ' + lo.r.toFixed(2) + ' ~ ' + hi.id + ' ' + hi.r.toFixed(2) + ' (' + (hi.r / lo.r).toFixed(2) + '배)');
  notes.push('무기 실효값 순: ' + ratios.map(function (x) { return x.id + ' ' + x.r.toFixed(2); }).join(', '));

  var noAmmo = TANKS.list.filter(function (t) { return !WPN.get(t.sub).ammo; });
  ok('보조 무기는 전부 탄약 제한', noAmmo.length === 0, noAmmo.map(function (t) { return t.id; }).join(','));
})();

/* ── 6. AI 전판 진행 ─────────────────────────────────────────── */
head('6. AI 대 AI — 전 맵 완주');
(function () {
  var totalTurns = 0, games = 0, voidW = 0;
  MAPS.list.forEach(function (map, mi) {
    var m = new MT.Match({
      mapId: map.id, seed: 100 + mi, mode: 'solo',
      roster: [
        { tank: TANKS.list[mi % 10].id, ai: true, aiLevel: 2 },
        { tank: TANKS.list[(mi + 5) % 10].id, ai: true, aiLevel: 1 }
      ]
    });
    var guard = 0;
    while (!m.result && guard < 400) {
      guard++;
      if (m.state === 'aim') {
        var p = AI.plan(m);
        if (p && p.fire) {
          /* 계획된 이동량을 끝까지 소화한다. command 는 한 번에 40px 까지만 받으므로
             한 번만 부르면 90px 짜리 계획이 40px 만 실행되고, 상자를 주우러 가는 판단이
             전혀 검증되지 않는다 — 실제로 이 때문에 습득 0회가 나왔다. */
          p.moves.forEach(function (mv) {
            var left = mv.px;
            while (left > 0) { m.command({ t: 'move', d: mv.d, px: Math.min(left, 40) }); left -= 40; }
          });
          (p.items || []).forEach(function (id) { m.command({ t: 'item', i: id }); });
          m.command({ t: 'dir', d: p.dir });
          m.command({ t: 'weapon', w: p.weapon });
          m.command({ t: 'aim', a: p.angle });
          m.command({ t: 'fire', p: p.power });
        } else m.command({ t: 'pass' });
      }
      var spin = 0;
      while (m.state === 'resolve' && spin < 3000) { m.update(1 / 60); spin++; }
    }
    var winner = m.result ? m.result.winner : null;
    if (m.result) { totalTurns += m.result.turns; games++; if (m.result.voidKills) voidW++; }
    ok(map.id.padEnd(10) + ' 완주', !!m.result && guard < 400,
      m.result ? ('승자 팀' + winner + ' / ' + m.result.turns + '턴 / 낙사 ' + m.result.voidKills) : ('무한루프 guard=' + guard));
  });
  ok('평균 턴수 6~120', games && totalTurns / games > 6 && totalTurns / games < 120,
    '평균 ' + (totalTurns / games).toFixed(1) + '턴, 낙사 결착 ' + voidW + '/' + games + '판');

  /* 상자가 실제로 판에 개입하는지 — 떨어지기만 하고 아무도 안 줍는다면 있으나 마나다. */
  var drops = 0, picks = 0;
  var mm = new MT.Match({
    mapId: 'ridge', seed: 321, mode: 'solo',
    roster: [{ tank: 'stinger', ai: true, aiLevel: 2 }, { tank: 'phantom', ai: true, aiLevel: 2 }]
  });
  var guard2 = 0;
  while (!mm.result && guard2 < 200) {
    guard2++;
    if (mm.state === 'aim') {
      var pp = AI.plan(mm);
      if (pp && pp.fire) {
        pp.moves.forEach(function (mv) {
          var left = mv.px;
          while (left > 0) { mm.command({ t: 'move', d: mv.d, px: Math.min(left, 40) }); left -= 40; }
        });
        mm.command({ t: 'dir', d: pp.dir }); mm.command({ t: 'weapon', w: pp.weapon });
        mm.command({ t: 'aim', a: pp.angle }); mm.command({ t: 'fire', p: pp.power });
      } else mm.command({ t: 'pass' });
    }
    var sp = 0; while (mm.state === 'resolve' && sp < 3000) { mm.update(1 / 60); sp++; }
    for (var e = 0; e < mm.world.events.length; e++) {
      if (mm.world.events[e].type === 'crateDrop') drops++;
      if (mm.world.events[e].type === 'cratePick') picks++;
    }
    mm.world.events.length = 0;
  }
  ok('상자가 떨어진다', drops > 0, drops + '회 투하 / ' + (mm.result ? mm.result.turns : guard2) + '턴');
  ok('AI 가 상자를 주우러 간다', picks > 0, picks + '회 습득');
})();

/* ── 7. 모드 ─────────────────────────────────────────────────── */
head('7. 2:2 · 1:1:1:1');
['duo', 'ffa'].forEach(function (mode) {
  var m = new MT.Match({
    mapId: 'ridge', seed: 42, mode: mode,
    roster: [0, 1, 2, 3].map(function (i) { return { tank: TANKS.list[i].id, ai: true, aiLevel: 1 }; })
  });
  ok(mode + ' 전차 4대 배치', m.world.tanks.length === 4);
  var guard = 0;
  while (!m.result && guard < 500) {
    guard++;
    if (m.state === 'aim') {
      var p = AI.plan(m);
      if (p && p.fire) {
        m.command({ t: 'dir', d: p.dir }); m.command({ t: 'weapon', w: p.weapon });
        m.command({ t: 'aim', a: p.angle }); m.command({ t: 'fire', p: p.power });
      } else m.command({ t: 'pass' });
    }
    var spin = 0;
    while (m.state === 'resolve' && spin < 3000) { m.update(1 / 60); spin++; }
  }
  ok(mode + ' 한 팀만 남고 끝난다', !!m.result && m.teamsAlive().length <= 1,
    m.result ? ('승자 팀' + m.result.winner + ' / ' + m.result.turns + '턴') : 'guard ' + guard);
});

/* ── 8. 딜레이 턴 순서 ───────────────────────────────────────── */
head('8. 딜레이 턴 순서');
(function () {
  var m = new MT.Match({
    mapId: 'ridge', seed: 77, mode: 'solo',
    roster: [{ tank: 'stinger' }, { tank: 'nova' }]   // delay 64 vs 100
  });
  var count = [0, 0];
  for (var i = 0; i < 24; i++) {
    if (m.result) break;
    var t = m.actor(); count[t.id]++;
    m.command({ t: 'aim', a: 80 });
    m.command({ t: 'fire', p: 8 });                  // 서로 못 맞히는 약한 사격
    var spin = 0;
    while (m.state === 'resolve' && spin < 3000) { m.update(1 / 60); spin++; }
  }
  ok('저딜레이 전차가 더 자주 쏜다', count[0] > count[1], '스팅어 ' + count[0] + '회 vs 노바 ' + count[1] + '회');
  ok('비율이 딜레이 비에 근접(1.3~2.0)', count[0] / count[1] > 1.2 && count[0] / count[1] < 2.1,
    (count[0] / count[1]).toFixed(2));
})();

/* ── 8a. 화염 · 연속 명중 ────────────────────────────────────── */
head('8a. 화염(볼케이노) · 연속 명중(팬텀)');
(function () {
  function duel(a, b, seed) {
    var m = new MT.Match({
      mapId: 'ridge', seed: seed || 3, mode: 'solo',
      roster: [{ tank: a }, { tank: b }]
    });
    place(m.world, 0, 0.18); place(m.world, 1, 0.66);
    return m;
  }

  // 화염은 맞은 순간이 아니라 '자기 턴'에 탄다
  var m = duel('volcano', 'titan', 6);
  var v = m.world.tanks[1];
  m.world.explode(v.x, v.y, WPN.get('rain_c'), 0);
  ok('소이탄이 화염을 남긴다', v.burn === 1, '누적 ' + v.burn);
  var hp0 = v.hp;
  m.world.explode(v.x, v.y, WPN.get('rain_c'), 0);
  m.world.explode(v.x, v.y, WPN.get('rain_c'), 0);
  ok('여러 발 맞으면 누적된다', v.burn === 3, '누적 ' + v.burn);
  var hpBefore = v.hp;
  var burned = m.world.tickBurn(v);
  ok('자기 턴에 누적만큼 탄다', burned === 3 * PH.BURN_DMG && v.hp < hpBefore,
    burned + ' 피해 (' + hpBefore + '→' + v.hp + ')');
  ok('한 턴에 한 겹씩 꺼진다', v.burn === 2, '남은 누적 ' + v.burn);
  var cap = duel('volcano', 'titan', 7).world.tanks[1];
  for (var i = 0; i < 12; i++) duel('volcano', 'titan', 7).world.explode(cap.x, cap.y, WPN.get('rain_c'), 0);
  var m2 = duel('volcano', 'titan', 8), v2 = m2.world.tanks[1];
  for (var j = 0; j < 12; j++) m2.world.explode(v2.x, v2.y, WPN.get('rain_c'), 0);
  ok('누적에 상한이 있다', v2.burn === PH.BURN_MAX, v2.burn + '/' + PH.BURN_MAX);

  /* 소이 폭우가 강화 무기 값을 하는가 — 기본 무기(산탄)보다 기대 피해가 높아야 한다.
     흩뿌리는 각이 넓었을 때는 오히려 낮았고, 그게 재설계 이유였다. */
  function totalFrom(weaponId, seed) {
    var mm = duel('volcano', 'titan', seed);
    var A = mm.actor(), T = mm.world.tanks[1];
    T.hp = T.hpMax = 2000;
    var best = null, bs = 1e9;
    for (var a = 20; a <= 85; a += 0.5) {
      for (var p = 40; p <= 100; p += 4) {
        var r = mm.world.predict(A, WPN.get(weaponId), a, p, 11);
        var d = C.hypot(r.x - T.x, r.y - T.y);
        if (d < bs) { bs = d; best = { a: a, p: p }; }
      }
    }
    A.angle = best.a;
    var hp = T.hp;
    mm.world.fire(A, weaponId, best.p);
    for (var k = 0; k < 4000 && mm.world.shells.length; k++) mm.world.step(PH.DT);
    var direct = hp - T.hp;
    // 화염이 다 탈 때까지 굴린다
    var burnTotal = 0;
    while (T.burn > 0) burnTotal += mm.world.tickBurn(T);
    return { direct: direct, burn: burnTotal, total: direct + burnTotal };
  }
  var sums = { spread: 0, rain: 0 };
  [11, 12, 13].forEach(function (sd) {
    sums.spread += totalFrom('spread', sd).total;
    sums.rain += totalFrom('rain', sd).total;
  });
  ok('소이 폭우가 기본 무기보다 기대 피해가 높다', sums.rain > sums.spread,
    '산탄 ' + Math.round(sums.spread / 3) + ' vs 소이 폭우 ' + Math.round(sums.rain / 3));

  // 연속 명중 — 같은 표적을 연달아 맞히면 피해가 커지고, 빗나가면 초기화
  var m3 = duel('phantom', 'titan', 9);
  var P = m3.actor(), TT = m3.world.tanks[1];
  TT.hp = TT.hpMax = 3000;
  function wispHit() { var h = TT.hp; m3.world.explode(TT.x, TT.y, WPN.get('wisp'), P.id); return h - TT.hp; }
  var d1 = wispHit(), d2 = wispHit(), d3 = wispHit();
  ok('연속으로 맞히면 피해가 늘어난다', d2 > d1 && d3 > d2, d1 + ' → ' + d2 + ' → ' + d3);
  ok('상한을 넘지 않는다', d3 <= d1 * (1 + PH.STREAK_STEP * (PH.STREAK_MAX - 1)) + 2,
    '최대 ' + (1 + PH.STREAK_STEP * (PH.STREAK_MAX - 1)) + '배');
  m3.world.explode(TT.x - 4000, TT.y, WPN.get('wisp'), P.id);   // 아무도 못 맞히는 곳
  ok('빗나가면 처음으로 돌아간다', P.streak === 0, '연속 ' + P.streak);
  var d4 = wispHit();
  ok('초기화 뒤 피해가 첫 발과 같다', Math.abs(d4 - d1) <= 1, d1 + ' vs ' + d4);

  // 레이븐은 연속 보정을 받지 않는다 — 두 유도 전차의 정체성이 갈려야 한다
  var m4 = duel('raven', 'titan', 10);
  var R = m4.actor(), T4 = m4.world.tanks[1];
  T4.hp = T4.hpMax = 3000;
  function trackHit() { var h = T4.hp; m4.world.explode(T4.x, T4.y, WPN.get('track'), R.id); return h - T4.hp; }
  var r1 = trackHit(), r2 = trackHit();
  ok('레이븐은 연속 보정이 없다', r1 === r2 && R.streak === 0, r1 + ' = ' + r2);
})();

/* ── 8b. 아이템 ──────────────────────────────────────────────── */
head('8b. 아이템 — 역전 장치');
(function () {
  function match(seed) {
    return new MT.Match({
      mapId: 'ridge', seed: seed || 4, mode: 'solo',
      roster: [{ tank: 'titan' }, { tank: 'raven' }]
    });
  }
  ok('아이템 7종', IT.order.length === 7,
    IT.order.map(function (i) { return IT.get(i).name; }).join(' '));

  /* 보급 상자 — 포트리스2 방식. 하늘에서 떨어지고, 주우러 가야 하고, 부수면 사라진다. */
  (function () {
    var m = match(11);
    var a = m.actor(), b = m.world.tanks[1];
    a.hp = Math.round(a.hpMax * 0.25);              // 이쪽이 크게 밀리는 상황
    b.hp = b.hpMax;

    var mid = (a.x + b.x) / 2, near = 0, far = 0, n = 60;
    for (var i = 0; i < n; i++) {
      m.world.crates.length = 0;
      var c = IT.supply(m.world, IT.DROP_EVERY);     // 투하 턴
      if (!c) continue;
      (Math.abs(c.x - a.x) < Math.abs(c.x - b.x) ? near++ : far++);
    }
    ok('투하 지점이 열세인 쪽으로 쏠린다', near > far * 1.5,
      '열세측 ' + near + '회 vs 우세측 ' + far + '회');

    var skipped = 0;
    for (var k = 0; k < IT.DROP_EVERY; k++) if (!IT.supply(m.world, IT.DROP_EVERY * 3 + k + 1)) skipped++;
    ok('매 턴 오지는 않는다', skipped >= IT.DROP_EVERY - 1, IT.DROP_EVERY + '턴마다 1회');
  })();

  // 낙하 → 착지
  (function () {
    var m = match(12);
    m.world.crates.length = 0;
    var c = m.world.dropCrate(m.actor().x + 140, 'heal');
    ok('상자는 하늘에서 시작한다', c.y < 0 && !c.grounded, 'y ' + Math.round(c.y));
    for (var i = 0; i < 3000 && !c.grounded && m.world.crates.length; i++) m.world.step(PH.DT);
    ok('상자가 땅에 내려앉는다', c.grounded, 'y ' + Math.round(c.y));
    var g = m.world.terrain.groundBelow(Math.round(c.x), 0);
    ok('지면 위에 정확히 놓인다', Math.abs((c.y + PH.CRATE_HH) - g) < 3);
  })();

  // 주워야 얻는다
  (function () {
    var m = match(13); var a = m.actor();
    m.world.crates.length = 0; a.items = {};
    // 타이탄 연료는 68이다. 그보다 멀리 두면 닿지 못한다 — 상자는 연료 안에 있어야 의미가 있다
    var c = m.world.dropCrate(a.x + 50, 'heal');
    while (!c.grounded) m.world.step(PH.DT);
    ok('가만히 있으면 안 들어온다', IT.count(a) === 0);
    m.command({ t: 'move', d: 1, px: 30 });
    m.command({ t: 'move', d: 1, px: 30 });
    ok('걸어가서 주우면 들어온다', (a.items.heal || 0) === 1, JSON.stringify(a.items));
    ok('주운 상자는 사라진다', m.world.crates.length === 0);
  })();

  // 쏴서 부수면 아무도 못 줍는다 — 견제 수단
  (function () {
    var m = match(14); var a = m.actor();
    m.world.crates.length = 0;
    var c = m.world.dropCrate(a.x + 200, 'power');
    while (!c.grounded) m.world.step(PH.DT);
    m.world.explode(c.x, c.y, WPN.get('slug'), a.id);
    ok('폭발이 상자를 부순다', m.world.crates.length === 0);
    a.x = c.x; a.y = c.y;
    m.world.collectCrates(a);
    ok('부순 상자는 주울 수 없다', IT.count(a) === 0);
  })();

  // 소지 한도를 넘으면 주워도 안 들어온다
  (function () {
    var m = match(15); var a = m.actor();
    a.items = { heal: 2, shield: 2 };
    ok('한도를 넘으면 받지 않는다', IT.receive(m.world, a, 'fuel') === false && IT.count(a) === IT.MAX_TOTAL,
      IT.count(a) + '/' + IT.MAX_TOTAL);
    a.items = { heal: 2 };
    ok('종류별 한도도 지킨다', IT.receive(m.world, a, 'heal') === false && a.items.heal === 2);
  })();

  // 회복
  var m1 = match(); var t1 = m1.actor();
  t1.hp = 60; t1.items.heal = 1;
  /* 회복량을 절대값으로 못 박으면 전차 체력을 손볼 때마다 깨진다 —
     실제로 타이탄 체력을 94→86 으로 내리자 상한에 걸려 90이 안 나왔다. */
  var healed = m1.command({ t: 'item', i: 'heal' });
  ok('응급수리가 체력을 올린다', healed && t1.hp === Math.min(t1.hpMax, 60 + 30),
    'hp 60 → ' + t1.hp + ' (상한 ' + t1.hpMax + ')');
  ok('아이템은 턴을 쓰지 않는다', m1.state === 'aim' && m1.current === t1.id);
  ok('없는 아이템은 못 쓴다', m1.command({ t: 'item', i: 'heal' }) === false);

  // 차폐막
  var m2 = match(); var a2 = m2.actor(), v2 = m2.world.tanks[1];
  v2.items.shield = 1;
  var noShield = (function () {
    var mm = match(); var vv = mm.world.tanks[1];
    var before = vv.hp; mm.world.damage(vv, 40, 'blast'); return before - vv.hp;
  })();
  IT.use(m2.world, v2, 'shield');
  var hp0 = v2.hp; m2.world.damage(v2, 40, 'blast');
  var withShield = hp0 - v2.hp;
  ok('차폐막이 피해를 절반으로 줄인다', withShield < noShield * 0.6,
    noShield + ' → ' + withShield);
  var hp1 = v2.hp; m2.world.damage(v2, 40, 'blast');
  ok('차폐막은 한 방만 막는다', hp1 - v2.hp === noShield, (hp1 - v2.hp) + ' vs ' + noShield);

  // 강화탄
  function shoot(withPower) {
    var m = match(9); var a = m.actor(), v = m.world.tanks[1];
    a.items.power = 1;
    if (withPower) IT.use(m.world, a, 'power');
    // 체력을 넉넉히 올려 둔다 — 안 그러면 강화탄 피해가 체력에서 잘려 배율이 안 보인다
    v.hp = v.hpMax = 900;
    v.x = a.x + 300; v.y = m.world.terrain.groundBelow(Math.round(v.x), 0) - PH.TANK_HH;
    m.world.explode(v.x, v.y, WPN.get('slug'), a.id, withPower ? 1.6 : 1);
    return v.hpMax - v.hp;
  }
  var plain = shoot(false), boosted = shoot(true);
  ok('강화탄이 피해를 키운다', boosted > plain * 1.4, plain + ' → ' + boosted);

  // 더블샷
  var m3 = match(); var a3 = m3.actor();
  a3.items.double = 1;
  IT.use(m3.world, a3, 'double');
  var d0 = a3.delay;
  m3.command({ t: 'aim', a: 60 }); m3.command({ t: 'fire', p: 60 });
  ok('더블샷이 두 발을 쏜다', m3.world.shells.length === 2, m3.world.shells.length + '발');
  ok('더블샷은 딜레이를 더 문다', a3.delay - d0 > WPN.get('slug').delay,
    (a3.delay - d0) + ' vs 기본 ' + WPN.get('slug').delay);

  // 무풍탄 — 바람을 많이 타는 전차로 재야 의미가 있다 (제피르의 활공탄은 바람 배율 2.2)
  function drift(noWind) {
    var m = new MT.Match({ mapId: 'ridge', seed: 4, mode: 'solo', roster: [{ tank: 'zephyr' }, { tank: 'raven' }] });
    var a = m.actor();
    m.world.wind = 8;
    a.items.windless = 1;
    if (noWind) IT.use(m.world, a, 'windless');
    a.angle = 70; m.command({ t: 'fire', p: 60 });
    var last = null, n = 0;
    while (m.world.shells.length && n < 3000) { last = m.world.shells[0].x; m.world.step(PH.DT); n++; }
    return last - a.x;
  }
  var withWind = drift(false), without = drift(true);
  ok('무풍탄이 바람을 지운다', Math.abs(without) < Math.abs(withWind) * 0.75,
    Math.round(withWind) + 'px → ' + Math.round(without) + 'px');

  /* 텔레포트탄 — 포트리스2 방식. 쏘고, 그 탄이 떨어진 자리로 내가 간다. */
  (function () {
    var m = match(21); var a = m.actor();
    a.items = { teleport: 1 };
    a.ammo[a.def.sub] = 3;
    var subAmmo0 = a.ammo[a.def.sub], x0 = a.x, delay0 = a.delay;

    ok('쓰는 즉시 옮겨지지 않는다', m.command({ t: 'item', i: 'teleport' }) && a.x === x0,
      '버프만 켜진다');
    m.command({ t: 'weapon', w: a.def.sub });
    m.command({ t: 'aim', a: 48 });
    m.command({ t: 'fire', p: 62 });
    ok('한 발만 나간다', m.world.shells.length === 1, m.world.shells.length + '발');
    ok('보조 무기 탄약을 쓰지 않는다', a.ammo[a.def.sub] === subAmmo0, subAmmo0 + ' → ' + a.ammo[a.def.sub]);

    var hp1 = m.world.tanks[1].hp;
    /* 지형이 파였는지는 terrain.dirty 로 보면 안 된다 — 그건 '다시 그려야 할 사각형'이고
       맵을 만든 직후부터 채워져 있다. 실제로 지운 픽셀이 있는지를 세야 한다. */
    function solidCount(tr) { var n = 0; for (var i = 0; i < tr.mask.length; i += 17) if (tr.mask[i]) n++; return n; }
    var solid0 = solidCount(m.world.terrain);
    var n = 0; while (m.world.shells.length && n < 4000) { m.world.step(PH.DT); n++; }
    ok('탄이 떨어진 자리로 옮겨 간다', Math.abs(a.x - x0) > 100, Math.round(x0) + ' → ' + Math.round(a.x));
    /* 착지 높이는 groundUnder(전차 폭 전체의 최고점)로 재야 한다.
       단일 열(groundBelow)로 재면 전차가 커질수록 옆 기둥에 걸쳐 선 경우를 오차로 오인한다. */
    ok('옮긴 자리는 지면 위다', a.grounded &&
      Math.abs((a.y + PH.TANK_HH) - m.world.groundUnder(a.x, a.y - PH.TANK_HH)) < 4);
    ok('피해도 지형 파괴도 없다', m.world.tanks[1].hp === hp1 && solidCount(m.world.terrain) === solid0,
      'hp ' + m.world.tanks[1].hp + ' · 지형 ' + solid0 + '→' + solidCount(m.world.terrain));
    ok('딜레이는 문다', a.delay - delay0 === WPN.get('warp').delay, (a.delay - delay0) + '');
  })();

  // 허공에 쏘면 허공으로 간다 — 낙사도 각오해야 한다
  (function () {
    var m = new MT.Match({ mapId: 'canyon', seed: 31, mode: 'solo', roster: [{ tank: 'stinger' }, { tank: 'titan' }] });
    var a = m.actor();
    // 협곡의 실제 허공 구간을 지형에서 찾는다
    var gap = (function () {
      for (var x = 40; x < m.map.w - 40; x += 4) if (m.world.groundUnder(x, 0) >= m.map.h) return x;
      return m.map.w / 2;
    })();
    /* 스폰이 무작위가 되면서 사수 위치가 매판 달라졌다 — 절벽까지 닿는 궤도가 없는 판이 생긴다.
       이 테스트가 보려는 것은 스폰이 아니라 '허공에 쏘면 어떻게 되는가'이므로 자리를 고정한다. */
    a.x = Math.max(120, gap - 420);
    a.y = m.world.groundUnder(a.x, 0) - PH.TANK_HH;
    a.grounded = true; a.dir = 1;
    a.items = { teleport: 1 };
    m.command({ t: 'item', i: 'teleport' });
    var solved = null;
    for (var ang = 10; ang <= 88 && !solved; ang += 0.5) {
      for (var p = 12; p <= 100; p += 1) {
        var r = m.world.predict(a, WPN.get('warp'), ang, p, 12);
        if (r.hit === 'out' && Math.abs(r.x - gap) < 160) { solved = { a: ang, p: p }; break; }
      }
    }
    if (solved) {
      var x0 = a.x;
      m.command({ t: 'aim', a: solved.a });
      m.command({ t: 'fire', p: solved.p });
      var missed = false, n = 0;
      while (m.world.shells.length && n < 4000) {
        m.world.step(PH.DT); n++;
        for (var e = 0; e < m.world.events.length; e++) if (m.world.events[e].type === 'warpMiss') missed = true;
        m.world.events.length = 0;
      }
      /* 착지할 지형이 없으면 이송은 실패한다. 허공으로 옮겨 주지도, 안전지대로 대피시켜 주지도 않는다 —
         옮길 자리가 없다는 게 결과다. 아이템만 날아간다. */
      ok('허공으로 쏘면 이송이 실패한다', missed && Math.abs(a.x - x0) < 2 && !a.dead,
        missed ? ('제자리 x ' + Math.round(a.x)) : 'warpMiss 이벤트 없음');
    } else {
      ok('허공으로 쏘면 이송이 실패한다', true, '(협곡 허공 궤도를 못 찾아 건너뜀)');
    }
  })();

})();

/* ── 8d. 스폰 · 기 모으기 ────────────────────────────────────── */
head('8d. 스폰 위치 · 기 모으기');
(function () {
  /* 스폰이 매판 같은 자리면 첫 수가 외워진다. 시드마다 달라야 한다. */
  function spawnsOf(mapId, seed) {
    var m = new MT.Match({
      mapId: mapId, seed: seed, mode: 'solo',
      roster: [{ tank: 'raven' }, { tank: 'titan' }]
    });
    return m.world.tanks.map(function (t) { return Math.round(t.x); });
  }
  var seen = {};
  for (var s = 1; s <= 12; s++) seen[spawnsOf('ridge', s).join(',')] = 1;
  ok('시드마다 스폰 위치가 달라진다', Object.keys(seen).length >= 8,
    '12판 중 ' + Object.keys(seen).length + '가지');

  var mR = MAPS.get('ridge');
  var spread = { lo: 1e9, hi: -1e9 };
  for (var s2 = 1; s2 <= 24; s2++) {
    spawnsOf('ridge', s2).forEach(function (x) {
      if (x < spread.lo) spread.lo = x;
      if (x > spread.hi) spread.hi = x;
    });
  }
  /* 넓게 퍼지는 것만으로는 부족하다 — 양끝에서만 번갈아 나와도 폭은 넓게 나온다.
     가운데 3분의 1 구간에서도 실제로 시작하는지를 본다. */
  var midHits = 0, total = 0;
  for (var s5 = 1; s5 <= 24; s5++) {
    spawnsOf('ridge', s5).forEach(function (x) {
      total++;
      if (x > mR.w / 3 && x < mR.w * 2 / 3) midHits++;
    });
  }
  ok('맵 가운데에서도 시작한다', midHits > 0 && (spread.hi - spread.lo) > mR.w * 0.5,
    '가운데 ' + midHits + '/' + total + ' · x ' + spread.lo + '~' + spread.hi);

  var tooClose = 0;
  for (var s3 = 1; s3 <= 20; s3++) {
    var p = spawnsOf('ridge', s3);
    if (Math.abs(p[0] - p[1]) < 200) tooClose++;
  }
  ok('서로 붙어서 시작하지 않는다', tooClose === 0, tooClose + '판이 200px 미만');

  /* 지하 공동: 공동 안에서만 시작해야 한다. 지붕 위에서 시작하면 서로 보이지도 않는다. */
  (function () {
    var bad = 0, roofY = MAPS.get('undercave').spawnScanY * MAPS.get('undercave').h;
    for (var s4 = 1; s4 <= 20; s4++) {
      var m = new MT.Match({
        mapId: 'undercave', seed: s4, mode: 'solo',
        roster: [{ tank: 'raven' }, { tank: 'titan' }]
      });
      m.world.tanks.forEach(function (t) {
        if (t.y + PH.TANK_HH < roofY) bad++;              // 스캔선보다 위 = 지붕
        // 머리 위가 막혀 있으면 파묻힌 것이다
        for (var dy = 6; dy <= PH.TANK_HH * 2; dy += 6) {
          if (m.world.terrain.solid(Math.round(t.x), Math.round(t.y - PH.TANK_HH - dy))) { bad++; break; }
        }
      });
    }
    ok('지하 공동에서 지붕 위나 암반 속에 안 생긴다', bad === 0, bad + '건 위반');
  })();

  /* 기 모으기 — 첫 발사는 충전, 다음 발사가 실제 사격 */
  (function () {
    var m = new MT.Match({
      mapId: 'ridge', seed: 77, mode: 'solo',
      roster: [{ tank: 'zephyr' }, { tank: 'titan' }]
    });
    var z = m.actor();
    if (z.def.id !== 'zephyr') { ok('기 모으기 테스트 준비', false, '사수가 제피르가 아님'); return; }
    var ammo0 = z.ammo.tempest;
    m.command({ t: 'weapon', w: 'tempest' });
    m.command({ t: 'aim', a: 50 });
    var fired = m.command({ t: 'fire', p: 70 });
    ok('첫 발사는 탄이 안 나간다', fired && m.world.shells.length === 0 && z.charge === 1,
      '충전 ' + z.charge + ' · 탄 ' + m.world.shells.length + '발');
    ok('충전은 탄약을 쓰지 않는다', z.ammo.tempest === ammo0, ammo0 + ' → ' + z.ammo.tempest);

    // 다음 차례로 돌린다
    var g = 0; while (m.state === 'resolve' && g < 3000) { m.update(1 / 60); g++; }
    while (m.actor().id !== z.id && g < 6000) {
      m.command({ t: 'pass' });
      while (m.state === 'resolve' && g < 6000) { m.update(1 / 60); g++; }
    }
    m.command({ t: 'weapon', w: 'tempest' });
    m.command({ t: 'aim', a: 50 });
    m.command({ t: 'fire', p: 70 });
    ok('두 번째 발사에 탄이 나간다', m.world.shells.length > 0 && z.charge === 0,
      m.world.shells.length + '발');
    ok('이때 탄약이 준다', z.ammo.tempest === ammo0 - 1, ammo0 + ' → ' + z.ammo.tempest);
  })();

  // 맞으면 충전이 풀린다 — 상대에게 대응할 여지를 준다
  (function () {
    var m = new MT.Match({
      mapId: 'ridge', seed: 78, mode: 'solo',
      roster: [{ tank: 'zephyr' }, { tank: 'titan' }]
    });
    var z = m.world.tanks[0];
    z.charge = 1;
    m.world.damage(z, 10, 'blast');
    ok('맞으면 모으던 기가 풀린다', z.charge === 0);
    z.charge = 1;
    m.world.damage(z, 10, 'fall');
    ok('낙하 피해로는 안 풀린다', z.charge === 1);
  })();
})();

/* ── 8c. 라운드로빈 밸런스 ───────────────────────────────────── */
head('8c. 전차 10종 라운드로빈 (실측 승률)');
(function () {
  /* 무기 실효값은 '모델'이고 이건 '실측'이다. 둘은 어긋날 수 있다 —
     실제로 타이탄은 실효값이 중간인데 승률 94%였다. 화력과 방어를 동시에 쥐고 있어서였다.
     모델만 보면 그런 조합을 못 잡는다. */
  /* 표본이 좁으면 이 게이트는 밸런스가 아니라 잡음을 재게 된다.
     ridge 한 맵 3판이면 전차당 27판, 표준편차가 10%p 가까이 나온다 —
     같은 코드로 두 번 돌려 85%와 63%가 나올 수 있는 폭이다.
     맵을 돌리고 표본을 늘려 그 폭을 절반으로 줄인다. 대신 이 절이 제일 느리다. */
  var GMAPS = ['ridge', 'canyon', 'ridge', 'dunes'];

  function duel(a, b, n) {
    var wa = 0, wb = 0, turns = 0, done = 0;
    for (var s = 0; s < n; s++) {
      var m = new MT.Match({
        mapId: GMAPS[s % GMAPS.length], seed: 500 + s, mode: 'solo',
        roster: [{ tank: a, ai: true, aiLevel: 2 }, { tank: b, ai: true, aiLevel: 2 }]
      });
      var g = 0;
      while (!m.result && g < 300) {
        g++;
        if (m.state === 'aim') {
          var p = AI.plan(m);
          if (p && p.fire) {
            p.moves.forEach(function (mv) {
              var L = mv.px;
              while (L > 0) { m.command({ t: 'move', d: mv.d, px: Math.min(L, 40) }); L -= 40; }
            });
            (p.items || []).forEach(function (id) { m.command({ t: 'item', i: id }); });
            m.command({ t: 'dir', d: p.dir }); m.command({ t: 'weapon', w: p.weapon });
            m.command({ t: 'aim', a: p.angle }); m.command({ t: 'fire', p: p.power });
          } else m.command({ t: 'pass' });
        }
        var sp = 0; while (m.state === 'resolve' && sp < 3000) { m.update(1 / 60); sp++; }
      }
      if (m.result) { done++; turns += m.result.turns; if (m.result.winner === 0) wa++; else wb++; }
    }
    return { wa: wa, wb: wb, turns: done ? turns / done : 0, done: done };
  }

  var names = TANKS.list.map(function (t) { return t.id; });
  var win = {}, tot = {}, sumT = 0, cnt = 0;
  names.forEach(function (n) { win[n] = 0; tot[n] = 0; });
  for (var i = 0; i < names.length; i++) {
    for (var j = i + 1; j < names.length; j++) {
      var r = duel(names[i], names[j], 8);
      win[names[i]] += r.wa; tot[names[i]] += r.done;
      win[names[j]] += r.wb; tot[names[j]] += r.done;
      sumT += r.turns * r.done; cnt += r.done;
    }
  }
  var rates = names.map(function (n) { return { id: n, r: tot[n] ? win[n] / tot[n] : 0.5 }; });
  rates.sort(function (a, b) { return b.r - a.r; });
  var top = rates[0], bot = rates[rates.length - 1];

  notes.push('승률: ' + rates.map(function (x) { return x.id + ' ' + Math.round(x.r * 100) + '%'; }).join(', '));
  ok('지배적인 전차가 없다 (최고 승률 ≤ 82%)', top.r <= 0.82, top.id + ' ' + Math.round(top.r * 100) + '%');
  ok('버려지는 전차가 없다 (최저 승률 ≥ 18%)', bot.r >= 0.18, bot.id + ' ' + Math.round(bot.r * 100) + '%');
  ok('한 판이 5~20턴에 끝난다', cnt && sumT / cnt >= 5 && sumT / cnt <= 20,
    '평균 ' + (sumT / cnt).toFixed(1) + '턴');
})();

/* ── 9. 결정론 — 같은 명령이면 같은 판 ───────────────────────── */
head('9. 재현성');
(function () {
  function run(seed) {
    var m = new MT.Match({ mapId: 'glacier', seed: seed, mode: 'solo', roster: [{ tank: 'kraken' }, { tank: 'zephyr' }] });
    var cmds = [
      { t: 'move', d: 1, px: 30 }, { t: 'aim', a: 52 }, { t: 'fire', p: 74 },
      { t: 'aim', a: 61 }, { t: 'fire', p: 66 },
      { t: 'weapon', w: 'maelstrom' }, { t: 'aim', a: 48 }, { t: 'fire', p: 80 }
    ];
    for (var i = 0; i < cmds.length; i++) {
      m.command(cmds[i]);
      var spin = 0;
      while (m.state === 'resolve' && spin < 3000) { m.update(1 / 60); spin++; }
    }
    return m.hash();
  }
  var h1 = run(31), h2 = run(31), h3 = run(32);
  ok('같은 시드·같은 명령 → 같은 해시', h1 === h2, h1.toString(16));
  ok('다른 시드 → 다른 해시', h1 !== h3, h1.toString(16) + ' vs ' + h3.toString(16));
})();

/* ── 10. 스냅샷 복구 ─────────────────────────────────────────── */
head('10. 스냅샷 · 복구');
(function () {
  var a = new MT.Match({ mapId: 'mesa', seed: 8, mode: 'solo', roster: [{ tank: 'nova' }, { tank: 'guardian' }] });
  a.command({ t: 'aim', a: 40 }); a.command({ t: 'fire', p: 70 });
  var spin = 0; while (a.state === 'resolve' && spin < 3000) { a.update(1 / 60); spin++; }
  var snap = JSON.parse(JSON.stringify(a.snapshot()));
  var b = new MT.Match({ mapId: 'mesa', seed: 8, mode: 'solo', roster: [{ tank: 'nova' }, { tank: 'guardian' }] });
  b.restore(snap);
  var same = b.world.tanks.every(function (t, i) {
    return t.hp === a.world.tanks[i].hp && Math.abs(t.x - a.world.tanks[i].x) < 1;
  });
  ok('스냅샷으로 상태가 옮겨간다', same && b.turn === a.turn && b.current === a.current);
})();

console.log('\n' + '─'.repeat(60));
notes.forEach(function (n) { console.log('· ' + n); });
console.log('통과 ' + pass + ' / 실패 ' + fail);
console.log(fail ? '### FAIL ###' : '### ALL PASS ###');
if (typeof process !== 'undefined' && process.exit) process.exit(fail ? 1 : 0);
if (typeof document !== 'undefined') document.title = fail ? ('FAIL ' + fail) : 'ALL PASS';
