/* logic/terrain.js — 파괴되는 픽셀 지형.
   높이맵이 아니라 비트마스크다. 높이맵으로 하면 포탄이 판 굴이 곧바로 메워져서
   "위를 넘겨 쏘던 언덕이 아래로 뚫린다"는 포트리스의 핵심 재미가 사라진다.

   mask[i]  0=허공, 그 외=재질 id (1 표층, 2 본체, 3 심층, 4 그을음)
   colTop[x] 그 열의 최상단 solid y. 없으면 H. 전차 착지·AI 조준이 매 프레임 쓰므로 캐시한다.
   DOM 참조 0 — node 에서 그대로 돈다. */
(function (root) {
  'use strict';
  var C = root.TFCore;

  var EMPTY = 0, TOP = 1, BODY = 2, CORE = 3, SCORCH = 4;

  function Terrain(w, h) {
    this.w = w; this.h = h;
    this.mask = new Uint8Array(w * h);
    this.colTop = new Int32Array(w);
    this.settle = true;              // 파인 자리 위의 흙이 무너지는가
    this.dirty = null;               // {x0,y0,x1,y1} 렌더러가 소비하고 비운다
    for (var x = 0; x < w; x++) this.colTop[x] = h;
  }

  Terrain.prototype.solid = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.mask[(y * this.w + x) | 0] !== EMPTY;
  };

  Terrain.prototype.at = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return EMPTY;
    return this.mask[(y * this.w + x) | 0];
  };

  /* 그 열의 지표면. 전차를 올려놓거나 AI 가 표적 높이를 잴 때 쓴다. */
  Terrain.prototype.surface = function (x) {
    x = x | 0;
    if (x < 0 || x >= this.w) return this.h;
    return this.colTop[x];
  };

  /* fromY 아래로 처음 만나는 solid. 전차가 공중에서 떨어질 때 쓴다 (동굴 지형 대응) */
  Terrain.prototype.groundBelow = function (x, fromY) {
    x = x | 0;
    if (x < 0 || x >= this.w) return this.h;
    var w = this.w, m = this.mask;
    for (var y = fromY < 0 ? 0 : fromY | 0; y < this.h; y++) {
      if (m[y * w + x] !== EMPTY) return y;
    }
    return this.h;
  };

  Terrain.prototype.recalcCol = function (x) {
    var w = this.w, m = this.mask, h = this.h;
    for (var y = 0; y < h; y++) { if (m[y * w + x] !== EMPTY) { this.colTop[x] = y; return; } }
    this.colTop[x] = h;
  };

  Terrain.prototype.markDirty = function (x0, y0, x1, y1) {
    var d = this.dirty;
    if (!d) { this.dirty = { x0: x0, y0: y0, x1: x1, y1: y1 }; return; }
    if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0;
    if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1;
  };

  /* 폭발 구덩이. 지운 픽셀 수를 돌려준다 (허공에 터지면 0 → "빗나감" 판정에 쓸 수 있다) */
  Terrain.prototype.crater = function (cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    var w = this.w, h = this.h, m = this.mask;
    var x0 = C.clamp(cx - r - 2, 0, w - 1), x1 = C.clamp(cx + r + 2, 0, w - 1);
    var y0 = C.clamp(cy - r - 2, 0, h - 1), y1 = C.clamp(cy + r + 2, 0, h - 1);
    var r2 = r * r, rim2 = (r + 2) * (r + 2), removed = 0;

    for (var y = y0; y <= y1; y++) {
      var dy = y - cy, dy2 = dy * dy, row = y * w;
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, d2 = dx * dx + dy2;
        if (d2 > rim2) continue;
        var i = row + x;
        if (d2 <= r2) { if (m[i] !== EMPTY) { m[i] = EMPTY; removed++; } }
        else if (m[i] !== EMPTY) m[i] = SCORCH;     // 테두리 그을음
      }
    }
    for (var xx = x0; xx <= x1; xx++) this.recalcCol(xx);
    if (this.settle) this.settleRange(x0, x1, y0);
    this.markDirty(x0, y0, x1, y1);
    return removed;
  };

  /* 구덩이 위에 떠 있던 흙을 아래로 내린다. 열 단위 — 실제 낙하 애니메이션은 렌더가 흉내낸다.
     이걸 넣지 않으면 지형이 스위스 치즈가 되고, 전차가 얇은 천장 위에서 무적이 된다. */
  Terrain.prototype.settleRange = function (x0, x1, yFrom) {
    var w = this.w, h = this.h, m = this.mask;
    for (var x = x0; x <= x1; x++) {
      var write = h - 1, changed = false;
      for (var y = h - 1; y >= 0; y--) {
        var v = m[y * w + x];
        if (v !== EMPTY) {
          if (write !== y) { m[write * w + x] = v; m[y * w + x] = EMPTY; changed = true; }
          write--;
        }
      }
      if (changed) this.recalcCol(x);
    }
    this.markDirty(x0, yFrom, x1, h - 1);
  };

  /* ── 생성 ─────────────────────────────────────────────────────────── */

  function valueNoise(rng, n) {           // n개 제어점 → [0,1] 배열
    var a = new Float64Array(n);
    for (var i = 0; i < n; i++) a[i] = rng.next();
    return a;
  }
  function sampleNoise(a, t) {            // t ∈ [0,1), 코사인 보간
    var n = a.length, f = t * n, i = f | 0, fr = f - i;
    var s = 0.5 - 0.5 * C.cos(fr * C.TAU / 2);
    return a[i % n] + (a[(i + 1) % n] - a[i % n]) * s;
  }

  /* spec: { w,h, ground:[{amp,freq}...], base, ops:[...] } */
  function build(spec, seed) {
    var rng = new C.RNG(seed);
    var t = new Terrain(spec.w, spec.h);
    t.settle = spec.settle !== false;

    var w = spec.w, h = spec.h;
    var height = new Float64Array(w);
    var layers = spec.ground || [{ amp: 90, freq: 3 }, { amp: 40, freq: 7 }, { amp: 14, freq: 17 }];
    var noises = layers.map(function (L) { return valueNoise(rng, Math.max(2, L.freq | 0)); });

    for (var x = 0; x < w; x++) {
      var v = spec.base * h;
      for (var k = 0; k < layers.length; k++) {
        v += (sampleNoise(noises[k], x / w) - 0.5) * 2 * layers[k].amp;
      }
      // 상한을 h 위로 열어 둔다. base 를 1 이상으로 주면 그 맵은 바닥이 아예 없다 (부유 군도·교량).
      height[x] = C.clamp(v, 60, h + 400);
    }

    // 열 채우기
    var m = t.mask;
    for (var x2 = 0; x2 < w; x2++) {
      var top = Math.round(height[x2]);
      for (var y = top; y < h; y++) {
        var depth = y - top;
        m[y * w + x2] = depth < 7 ? TOP : (depth < 90 ? BODY : CORE);
      }
    }

    var ops = spec.ops || [];
    for (var i = 0; i < ops.length; i++) applyOp(t, ops[i], rng, height);

    for (var x3 = 0; x3 < w; x3++) t.recalcCol(x3);
    t.dirty = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    return t;
  }

  function fillEllipse(t, cx, cy, rx, ry, mat) {
    var w = t.w, h = t.h, m = t.mask;
    var x0 = C.clamp(Math.round(cx - rx), 0, w - 1), x1 = C.clamp(Math.round(cx + rx), 0, w - 1);
    var y0 = C.clamp(Math.round(cy - ry), 0, h - 1), y1 = C.clamp(Math.round(cy + ry), 0, h - 1);
    for (var y = y0; y <= y1; y++) {
      var ny = (y - cy) / ry;
      for (var x = x0; x <= x1; x++) {
        var nx = (x - cx) / rx;
        if (nx * nx + ny * ny <= 1) {
          if (mat === EMPTY) m[y * w + x] = EMPTY;
          else if (m[y * w + x] === EMPTY) m[y * w + x] = mat;
        }
      }
    }
  }

  /* 공중 섬. 정직한 타원으로 만들면 열 개를 늘어놓았을 때 접시 열 개로 보인다.
     열마다 반지름을 흔들고 아래쪽을 더 깊게 늘여 "떠 있는 암반"의 실루엣을 만든 뒤,
     맨 위 몇 픽셀만 표층으로 덮는다. 표층은 반드시 채우기가 끝난 다음에 얹어야 한다 —
     먼저 얹으면 본체 채우기가 그 위를 덮어써서 잔디가 사라진다. */
  function island(t, cx, cy, rx, ry, rng) {
    var w = t.w, h = t.h, m = t.mask;
    var x0 = C.clamp(Math.round(cx - rx), 0, w - 1), x1 = C.clamp(Math.round(cx + rx), 0, w - 1);
    var seed = new C.RNG((cx * 7919 + cy * 104729) >>> 0);
    var a = valueNoise(seed, 9), b = valueNoise(seed, 23);
    for (var x = x0; x <= x1; x++) {
      var nx = (x - cx) / rx;
      var k = 1 - nx * nx;
      if (k <= 0) continue;
      var half = ry * Math.sqrt(k);
      var tt = (x - x0) / (x1 - x0 + 1);
      var wob = 0.86 + 0.28 * sampleNoise(a, tt) + 0.10 * sampleNoise(b, tt);
      var top = Math.round(cy - half * (0.9 + 0.2 * sampleNoise(b, tt)));
      var bot = Math.round(cy + half * 1.45 * wob);
      for (var y = top; y <= bot; y++) {
        if (y < 0 || y >= h) continue;
        var depth = y - top;
        m[y * w + x] = depth < 6 ? TOP : (depth < 70 ? BODY : CORE);
      }
    }
  }

  function applyOp(t, op, rng, height) {
    var w = t.w, h = t.h, m = t.mask, x, y;
    switch (op.op) {
      case 'gap':                                   // 낙사 구간. 바닥까지 뚫린 허공
        for (x = C.clamp(op.x0 | 0, 0, w - 1); x <= C.clamp(op.x1 | 0, 0, w - 1); x++) {
          var soft = 0;
          if (op.taper) {                            // 가장자리를 사선으로 깎아 절벽을 만든다
            var dl = x - op.x0, dr = op.x1 - x, dd = dl < dr ? dl : dr;
            soft = dd < op.taper ? (op.taper - dd) * 3 : 0;
          }
          for (y = Math.round((height ? height[x] : 0) + soft); y < h; y++) m[y * w + x] = EMPTY;
        }
        break;
      case 'cave':
        fillEllipse(t, op.cx * w, op.cy * h, op.rx, op.ry, EMPTY);
        break;
      case 'island':                                 // 공중 섬
        island(t, op.cx * w, op.cy * h, op.rx, op.ry, rng);
        break;
      case 'pillar':
        /* 윗면을 자로 그은 듯 평평하게 두면 대지·기둥 맵이 직각 블록 더미로 보인다.
           높이만 살짝 흔들어 준다 — 전차가 오르내리는 단차(climb)보다 작게 잡아야
           보기에만 영향을 주고 이동 가능 여부는 바뀌지 않는다. */
        var px = op.cx * w, pw = op.w;
        var px0 = C.clamp(Math.round(px - pw / 2), 0, w - 1);
        var px1 = C.clamp(Math.round(px + pw / 2), 0, w - 1);
        var pn = valueNoise(new C.RNG((px * 2654435761 + op.top * 40503) >>> 0), 7);
        var flat = Math.round(op.top * h);
        for (x = px0; x <= px1; x++) {
          var span = px1 - px0 + 1;
          var edge = Math.min(x - px0, px1 - x);
          var soft = edge < 5 ? (5 - edge) * 1.6 : 0;          // 모서리를 살짝 깎는다
          var top = Math.round(flat + (sampleNoise(pn, (x - px0) / span) - 0.5) * 9 + soft);
          for (y = top; y < h; y++) if (m[y * w + x] === EMPTY) m[y * w + x] = BODY;
          for (y = top; y < top + 6; y++) if (y >= 0 && y < h) m[y * w + x] = TOP;
        }
        break;
      case 'arch':                                   // 다리 — 아래로 통과 가능한 구조물
        var ax = op.cx * w, ay = op.cy * h;
        for (x = C.clamp(Math.round(ax - op.rx), 0, w - 1); x <= C.clamp(Math.round(ax + op.rx), 0, w - 1); x++) {
          for (y = Math.round(ay); y < Math.round(ay + op.thick); y++) if (y >= 0 && y < h) m[y * w + x] = y < ay + 6 ? TOP : BODY;
        }
        fillEllipse(t, ax, ay + op.thick + op.rise, op.rx * 0.8, op.rise, EMPTY);
        break;
      case 'roughen':                                // 잔파편. 지형이 너무 매끈하면 도탄 재미가 없다
        for (var i = 0; i < op.count; i++) {
          var rx2 = rng.next() * w, ry2 = rng.range(op.y0 * h, op.y1 * h);
          fillEllipse(t, rx2, ry2, rng.range(6, op.size), rng.range(4, op.size * 0.7), op.dig ? EMPTY : BODY);
        }
        break;
    }
  }

  root.TFTerrain = {
    Terrain: Terrain, build: build,
    EMPTY: EMPTY, TOP: TOP, BODY: BODY, CORE: CORE, SCORCH: SCORCH
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
