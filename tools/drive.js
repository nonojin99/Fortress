/* tools/drive.js — 개발용 무대 감독.
   브라우저 패널을 띄울 수 없는 환경에서는 requestAnimationFrame 이 돌지 않는다.
   그래서 앱의 루프를 쓰지 않고 여기서 직접 시간을 밀어 준 뒤 캔버스를 서버로 보낸다.
   게임 코드에는 이 파일을 향한 참조가 한 줄도 없다. 빌드에도 들어가지 않는다.

   콘솔에서:  await fetch('tools/drive.js').then(r=>r.text()).then(eval)
   그 다음:   await TFDrive.scene({map:'canyon', shot:'canyon'})            */
(function (root) {
  'use strict';
  var TEAM = ['#5AA9E6', '#E6705A', '#7ED957', '#C79BFF'];

  function G() { return root.TFApp.G; }

  /* 이벤트를 이펙트로 옮긴다. app.js 의 drainEvents 와 같은 일을 한다 —
     같은 로직을 두 곳에 두는 건 좋지 않지만, app.js 에 개발 전용 훅을 뚫는 것보다는 낫다. */
  function drain() {
    var g = G(), evs = g.match.world.events;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.type === 'boom') g.fx.boom(e.x, e.y, e.r, e.color);
      else if (e.type === 'dmg') g.fx.text(e.x, e.y, '-' + e.n, e.cause === 'fall' ? '#9FC0E0' : '#FF9A8A');
      else if (e.type === 'split') g.fx.spawn(e.x, e.y, 16, { color: e.color, smax: 180, lmax: 0.5 });
      else if (e.type === 'drillIn') g.fx.spawn(e.x, e.y, 10, { color: '#C9A227', smax: 120, lmax: 0.4 });
      else if (e.type === 'turn') { g.ai = null; }
    }
    evs.length = 0;
  }

  /* 사람 대신 조준해서 쏜다. AI 계획을 그대로 쓰되 즉시 실행한다. */
  function autoFire(jitter) {
    var g = G(), m = g.match, t = m.actor();
    if (!t || m.state !== 'aim') return null;
    var p = root.TFAI.plan(m);
    if (!p || !p.fire) { m.command({ t: 'pass' }); return null; }
    m.command({ t: 'weapon', w: p.weapon });
    m.command({ t: 'dir', d: p.dir });
    m.command({ t: 'aim', a: p.angle + (jitter || 0) });
    var mu = m.world.muzzle(t);
    m.command({ t: 'fire', p: p.power });
    g.fx.muzzle(mu.x, mu.y, t.angle * root.TFCore.DEG, t.dir, root.TFWeapons.get(t.weapon).color);
    return p;
  }

  function step(frames, dt) {
    var g = G(), m = g.match, V = root.TFApp.VIEW;
    dt = dt || 1 / 60;
    for (var i = 0; i < frames; i++) {
      m.update(dt);
      drain();
      g.fx.step(dt);
      var s = m.world.shells[0], tx, ty;
      if (s) { tx = s.x; ty = s.y; }
      else { var a = m.actor(); if (!a) break; tx = a.x + a.dir * 90; ty = a.y - 60; }
      var gx = Math.max(0, Math.min(m.map.w - V.w, tx - V.w / 2));
      var gy = Math.max(0, Math.min(Math.max(0, m.map.h - V.h), ty - V.h / 2));
      var k = s ? 0.30 : 0.10;
      g.cam.x += (gx - g.cam.x) * k;
      g.cam.y += (gy - g.cam.y) * k;
      g.time += dt;
    }
  }

  function paint(opts) {
    var g = G(), m = g.match, V = root.TFApp.VIEW;
    var off = g.fx.offset();
    g.scene.render(g.ctx, { x: g.cam.x - off.x, y: g.cam.y - off.y }, V, {
      fx: g.fx, time: g.time, teamColors: TEAM,
      aimTank: (opts && opts.aim === false) ? null : m.actor(),
      power: (opts && opts.power) || 55
    });
  }

  function shot(name) {
    var data = document.getElementById('cv').toDataURL('image/png');
    return fetch('/_shot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, data: data })
    }).then(function (r) { return r.json(); });
  }

  /* 한 장면을 통째로 연출한다.
     {map, tanks:[id,id], fires:n, frames, shot} */
  function scene(o) {
    o = o || {};
    var A = root.TFApp;
    A.cfg.mapId = o.map || 'ridge';
    A.cfg.mode = o.mode || 'solo';
    A.cfg.play = 'ai';
    if (o.tanks) for (var i = 0; i < o.tanks.length; i++) A.cfg.picks[i] = o.tanks[i];
    A.start(null);
    if (A.G.raf) { cancelAnimationFrame(A.G.raf); A.G.raf = 0; }   // rAF 가 돌더라도 우리가 시간을 쥔다
    step(30);
    var fires = o.fires == null ? 1 : o.fires;
    for (var f = 0; f < fires; f++) {
      autoFire(o.jitter);
      var guard = 0;
      while (A.G.match.state === 'resolve' && guard < (o.maxFrames || 900)) { step(1); guard++; }
      if (o.holdAt && f === fires - 1) step(o.holdAt);
    }
    step(o.frames == null ? 20 : o.frames);
    paint(o);
    return shot(o.shot || 'scene');
  }

  /* 포탄이 나는 도중을 잡는다 — 폭발 뒤가 아니라 궤적이 보이는 순간 */
  function midflight(o) {
    o = o || {};
    var A = root.TFApp;
    A.cfg.mapId = o.map || 'ridge'; A.cfg.mode = o.mode || 'solo'; A.cfg.play = 'ai';
    if (o.tanks) for (var i = 0; i < o.tanks.length; i++) A.cfg.picks[i] = o.tanks[i];
    A.start(null);
    if (A.G.raf) { cancelAnimationFrame(A.G.raf); A.G.raf = 0; }
    step(20);
    if (o.weapon) { A.G.match.command({ t: 'weapon', w: o.weapon }); }
    var p = root.TFAI.plan(A.G.match);
    var m = A.G.match, t = m.actor();
    m.command({ t: 'dir', d: p.dir });
    if (o.weapon) m.command({ t: 'weapon', w: o.weapon });
    m.command({ t: 'aim', a: p.angle });
    var mu = m.world.muzzle(t);
    m.command({ t: 'fire', p: p.power });
    A.G.fx.muzzle(mu.x, mu.y, t.angle * root.TFCore.DEG, t.dir, '#FFE27A');
    step(o.at == null ? 45 : o.at);
    paint(o);
    return shot(o.shot || 'midflight');
  }

  /* 폭발 직후를 잡는다. 정착까지 다 돌려 버리면 파티클이 이미 다 꺼져 있어서
     "터졌다"는 사실만 남고 "터지는 중"이 안 찍힌다. boom 이벤트를 보고 멈춘다. */
  function impact(o) {
    o = o || {};
    var A = root.TFApp;
    A.cfg.mapId = o.map || 'ridge'; A.cfg.mode = o.mode || 'solo'; A.cfg.play = 'ai';
    if (o.tanks) for (var i = 0; i < o.tanks.length; i++) A.cfg.picks[i] = o.tanks[i];
    A.start(null);
    if (A.G.raf) { cancelAnimationFrame(A.G.raf); A.G.raf = 0; }
    step(20);
    var m = A.G.match, t = m.actor();
    var p = root.TFAI.plan(m);
    m.command({ t: 'dir', d: p.dir });
    if (o.weapon) m.command({ t: 'weapon', w: o.weapon });
    m.command({ t: 'aim', a: p.angle });
    var mu = m.world.muzzle(t);
    m.command({ t: 'fire', p: p.power });
    A.G.fx.muzzle(mu.x, mu.y, t.angle * root.TFCore.DEG, t.dir, '#FFE27A');

    var guard = 0, boomed = false;
    while (!boomed && guard < 1200) {
      var evs = m.world.events, had = false;
      m.update(1 / 60);
      for (var k = 0; k < evs.length; k++) if (evs[k].type === 'boom') had = true;
      drain(); A.G.fx.step(1 / 60);
      var s = m.world.shells[0], V = root.TFApp.VIEW, g = A.G;
      var tx = s ? s.x : mu.x, ty = s ? s.y : mu.y;
      g.cam.x += (Math.max(0, Math.min(m.map.w - V.w, tx - V.w / 2)) - g.cam.x) * 0.3;
      g.cam.y += (Math.max(0, Math.min(Math.max(0, m.map.h - V.h), ty - V.h / 2)) - g.cam.y) * 0.3;
      g.time += 1 / 60;
      boomed = had; guard++;
    }
    step(o.after == null ? 8 : o.after);
    paint(o);
    return shot(o.shot || 'impact');
  }

  root.TFDrive = { scene: scene, midflight: midflight, impact: impact, step: step, paint: paint, shot: shot, autoFire: autoFire, drain: drain };
  return 'TFDrive ready';
})(typeof globalThis !== 'undefined' ? globalThis : this);
