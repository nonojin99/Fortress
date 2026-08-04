/* render/fx.js — 파티클과 화면 흔들림.
   시뮬레이션에는 일절 관여하지 않는다. 여기 있는 어떤 값도 승패를 바꾸지 않는다 —
   그래서 프레임이 밀려 이펙트를 통째로 건너뛰어도 두 클라이언트의 판은 갈라지지 않는다. */
(function (root) {
  'use strict';
  var C = root.TFCore;

  function FX() {
    this.p = [];        // 파티클
    this.rings = [];    // 폭발 충격파
    this.texts = [];    // 데미지 숫자
    this.shake = 0;
    this.flash = 0;
    this.rng = new C.RNG(0xC0FFEE);
  }

  FX.prototype.spawn = function (x, y, n, opt) {
    opt = opt || {};
    for (var i = 0; i < n; i++) {
      var a = this.rng.next() * C.TAU;
      var s = this.rng.range(opt.smin || 40, opt.smax || 300);
      this.p.push({
        x: x, y: y,
        vx: C.cos(a) * s + (opt.vx || 0), vy: C.sin(a) * s + (opt.vy || 0),
        life: this.rng.range(opt.lmin || 0.3, opt.lmax || 1.1), t: 0,
        r: this.rng.range(opt.rmin || 1, opt.rmax || 3.5),
        c: opt.color || '#FFB86B', g: opt.g == null ? 620 : opt.g,
        fade: opt.fade == null ? 1 : opt.fade
      });
    }
  };

  FX.prototype.boom = function (x, y, r, color) {
    this.rings.push({ x: x, y: y, r: r, t: 0, life: 0.5, c: color });
    this.spawn(x, y, Math.min(90, 18 + (r | 0)), { color: color, smin: 60, smax: r * 9, rmin: 1.5, rmax: 4.5, lmax: 1.4 });
    this.spawn(x, y, Math.min(50, 10 + (r / 2 | 0)), { color: '#3A2A20', smin: 30, smax: r * 5, rmin: 2, rmax: 6, lmax: 1.8, g: 420 });
    this.shake = Math.min(26, this.shake + r * 0.32);
    this.flash = Math.min(0.55, this.flash + r / 260);
  };

  FX.prototype.muzzle = function (x, y, a, dir, color, type) {
    var n = 18, smin = 120, smax = 420, lmin = 0.1, lmax = 0.3;
    var spread = 0.28;
    type = type || '표준';
    if (type === '집중') { n = 26; smin = 180; smax = 520; spread = 0.16; }
    else if (type === '돌파') { n = 22; smin = 90; smax = 360; spread = 0.12; }
    else if (type === '범위') { n = 28; smin = 80; smax = 340; spread = 0.42; lmax = 0.45; }
    else if (type === '유도') { n = 14; smin = 100; smax = 300; spread = 0.22; }
    for (var i = 0; i < n; i++) {
      var sp = this.rng.range(smin, smax);
      var ang = a * dir + this.rng.range(-spread, spread);
      this.p.push({
        x: x, y: y, vx: C.cos(ang) * sp * dir, vy: -C.sin(ang) * sp,
        life: this.rng.range(lmin, lmax), t: 0, r: this.rng.range(1, type === '범위' ? 4 : 3),
        c: color || '#FFE27A', g: type === '범위' ? 120 : 200, fade: 1
      });
    }
    this.shake = Math.min(14, this.shake + (type === '집중' ? 4.5 : 3.2));
  };

  FX.prototype.text = function (x, y, s, color) {
    this.texts.push({ x: x, y: y, s: s, t: 0, life: 1.3, c: color || '#FFFFFF' });
  };

  FX.prototype.step = function (dt) {
    var out = [];
    for (var i = 0; i < this.p.length; i++) {
      var q = this.p[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      q.vy += q.g * dt;
      q.vx *= 0.985;
      q.x += q.vx * dt; q.y += q.vy * dt;
      out.push(q);
    }
    this.p = out;

    var rr = [];
    for (var j = 0; j < this.rings.length; j++) {
      var g = this.rings[j]; g.t += dt;
      if (g.t < g.life) rr.push(g);
    }
    this.rings = rr;

    var tt = [];
    for (var k = 0; k < this.texts.length; k++) {
      var x = this.texts[k]; x.t += dt; x.y -= 34 * dt;
      if (x.t < x.life) tt.push(x);
    }
    this.texts = tt;

    this.shake *= Math.pow(0.0035, dt);
    if (this.shake < 0.05) this.shake = 0;
    this.flash *= Math.pow(0.002, dt);
    if (this.flash < 0.004) this.flash = 0;
  };

  FX.prototype.draw = function (ctx) {
    ctx.save();
    for (var i = 0; i < this.p.length; i++) {
      var q = this.p[i];
      var k = 1 - q.t / q.life;
      ctx.globalAlpha = q.fade ? k : 1;
      ctx.fillStyle = q.c;
      var r = q.r * (0.4 + k * 0.6);
      ctx.fillRect(q.x - r, q.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    for (var j = 0; j < this.rings.length; j++) {
      var g = this.rings[j], t = g.t / g.life;
      ctx.globalAlpha = (1 - t) * 0.75;
      ctx.strokeStyle = g.c; ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (0.35 + t * 1.5), 0, 6.2832); ctx.stroke();
    }
    ctx.restore();
  };

  FX.prototype.drawText = function (ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (var k = 0; k < this.texts.length; k++) {
      var x = this.texts[k], t = x.t / x.life;
      ctx.globalAlpha = t < 0.75 ? 1 : (1 - t) * 4;
      ctx.font = '700 20px ui-monospace,monospace';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(x.s, x.x, x.y); ctx.fillStyle = x.c; ctx.fillText(x.s, x.x, x.y);
    }
    ctx.restore();
  };

  FX.prototype.offset = function () {
    if (!this.shake) return { x: 0, y: 0 };
    var a = this.rng.next() * C.TAU;
    return { x: C.cos(a) * this.shake, y: C.sin(a) * this.shake };
  };

  root.TFFX = { FX: FX };
})(typeof globalThis !== 'undefined' ? globalThis : this);
