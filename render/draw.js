/* render/draw.js — 장면을 그린다. 시뮬레이션은 손대지 않는다.
   지형은 매 프레임 다시 칠하지 않는다. 월드 크기 오프스크린 캔버스에 한 번 칠해 두고,
   terrain.dirty 로 표시된 사각형만 다시 칠한 뒤 통째로 blit 한다.
   2400×1000 짜리 마스크를 프레임마다 순회하면 그것만으로 60fps 가 무너진다. */
(function (root) {
  'use strict';
  var C = root.TFCore, T = root.TFTerrain, PH = root.TFPhysics;

  function hex(h) {
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }

  function Scene(world, map) {
    this.world = world; this.map = map;
    this.cv = document.createElement('canvas');
    this.cv.width = map.w; this.cv.height = map.h;
    this.cx = this.cv.getContext('2d');
    this.pal = {};
    for (var k in map.pal) this.pal[k] = hex(map.pal[k]);
    this.bg = this.makeSky();
    /* 지형 질감 — 맵 배경 하단을 샘플해 깔고, 마스크가 비는 순간 같이 사라진다. */
    this.tex = null; this.texData = null; this.texW = 0; this.texH = 0;
    this.ensureGroundTex();
    this.repaintAll();
  }

  /* 하늘 + 원경. 스크롤할 때 시차가 없으면 맵이 좁아 보인다. */
  Scene.prototype.makeSky = function () {
    var m = this.map, cv = document.createElement('canvas');
    cv.width = 960; cv.height = m.h;
    var g = cv.getContext('2d');

    /* 맵 전용 원경 이미지가 있으면 그것을 먼저 깐다.
       지형 마스크는 그대로 파괴 가능 — 배경은 빈 하늘 자리를 채울 뿐이다. */
    var artBg = root.TFArt && root.TFArt.maps && root.TFArt.maps[m.id];
    if (artBg && artBg.complete && artBg.naturalWidth) {
      /* 이미지를 맵 높이에 맞추고 가로로 타일. 밝기를 살짝 내려 전차·지형이 앞에 서게 한다. */
      var iw = artBg.naturalWidth, ih = artBg.naturalHeight;
      var scale = m.h / ih;
      var dw = Math.max(1, Math.round(iw * scale));
      g.globalAlpha = 0.92;
      for (var x = 0; x < 960 + dw; x += dw) {
        g.drawImage(artBg, x, 0, dw, m.h);
      }
      g.globalAlpha = 1;
      /* 하단을 지형 팔레트 톤으로 살짝 물들여 이음매를 부드럽게 */
      var fade = g.createLinearGradient(0, m.h * 0.55, 0, m.h);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, m.sky[2] || '#000');
      g.fillStyle = fade;
      g.globalAlpha = 0.35;
      g.fillRect(0, m.h * 0.55, 960, m.h * 0.45);
      g.globalAlpha = 1;
      return cv;
    }

    /* 폴백: 기존 그라데이션 + 원경 능선 */
    var grd = g.createLinearGradient(0, 0, 0, m.h);
    grd.addColorStop(0, m.sky[0]); grd.addColorStop(0.55, m.sky[1]); grd.addColorStop(1, m.sky[2]);
    g.fillStyle = grd; g.fillRect(0, 0, 960, m.h);

    var TW = 960;
    var K = [[3, 7], [2, 5], [4, 9]];
    for (var L = 0; L < 3; L++) {
      g.globalAlpha = 0.20 + L * 0.11;
      g.fillStyle = L === 0 ? m.sky[0] : (L === 1 ? m.sky[1] : m.pal[3]);
      g.beginPath();
      var base = m.h * (0.52 + L * 0.09);
      var f1 = C.TAU * K[L][0] / TW, f2 = C.TAU * K[L][1] / TW;
      g.moveTo(-24, m.h);
      for (var x = -24; x <= TW + 24; x += 12) {
        var y = base - (C.sin(x * f1 + L * 2.1) * 34 + C.sin(x * f2 + L) * 17) * (1 - L * 0.2);
        g.lineTo(x, y);
      }
      g.lineTo(TW + 24, m.h); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    return cv;
  };

  /* 맵 배경 이미지에서 지형 질감 샘플을 만든다.
     배경이 아직 로드 전이면 false — render 루프에서 다시 시도한다. */
  /* 지형 질감. 배경 아트에서 '색'만 가져오고 '그림'은 가져오지 않는다.

     원래는 배경 이미지의 아래쪽 45%를 256×256 으로 찌그러뜨려 그대로 타일로 깔았다.
     그 조각에는 산·용암·구름이 알아볼 수 있는 형태로 들어 있어서, 땅에 풍경 사진이
     격자로 반복해 찍히고 타일 경계가 그대로 드러났다 — 분화구 맵에서 땅이
     사각형 덩어리로 흩어져 보인 게 이것 때문이다.

     지금은 그 영역의 평균색만 뽑아 그 색 주변의 잡음 타일을 만든다.
     맵마다 땅 색이 배경과 어울리는 효과는 그대로 남고, 반복되는 형태는 사라진다. */
  Scene.prototype.ensureGroundTex = function () {
    if (this.texData) return true;
    var artBg = root.TFArt && root.TFArt.maps && root.TFArt.maps[this.map.id];
    if (!artBg || !artBg.complete || !artBg.naturalWidth) return false;

    // 1) 배경 아래쪽에서 평균색을 뽑는다 (작게 줄여 그리면 그 자체가 평균이다)
    var probe = document.createElement('canvas');
    probe.width = 8; probe.height = 8;
    var pg = probe.getContext('2d', { willReadFrequently: true });
    var sw = artBg.naturalWidth, sh = artBg.naturalHeight;
    var sy = Math.floor(sh * 0.55);
    pg.drawImage(artBg, 0, sy, sw, sh - sy, 0, 0, 8, 8);
    var pd = pg.getImageData(0, 0, 8, 8).data;
    var ar = 0, ag = 0, ab = 0;
    for (var p = 0; p < pd.length; p += 4) { ar += pd[p]; ag += pd[p + 1]; ab += pd[p + 2]; }
    var n8 = pd.length / 4;
    ar = ar / n8 * 0.88; ag = ag / n8 * 0.88; ab = ab / n8 * 0.88;   // 땅은 하늘보다 어둡다

    // 2) 그 색 주변의 잡음 타일. 형태가 없으므로 이어 붙여도 경계가 안 보인다
    var tw = 64, th = 64;
    var cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    var g = cv.getContext('2d');
    var img = g.createImageData(tw, th), d = img.data;
    var rng = new C.RNG(0x9E37 ^ (this.map.w * 31 + this.map.h));
    for (var i = 0; i < tw * th; i++) {
      var jitter = (rng.next() - 0.5) * 26;
      d[i * 4] = C.clamp(ar + jitter, 0, 255);
      d[i * 4 + 1] = C.clamp(ag + jitter, 0, 255);
      d[i * 4 + 2] = C.clamp(ab + jitter, 0, 255);
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.tex = cv;
    this.texData = d;
    this.texW = tw; this.texH = th;
    return true;
  };

  Scene.prototype.repaintAll = function () {
    this.paintRect(0, 0, this.map.w - 1, this.map.h - 1);
    this.world.terrain.dirty = null;
  };

  Scene.prototype.sync = function () {
    var d = this.world.terrain.dirty;
    if (!d) return;
    this.paintRect(d.x0, d.y0, d.x1, d.y1);
    this.world.terrain.dirty = null;
  };

  Scene.prototype.paintRect = function (x0, y0, x1, y1) {
    var tr = this.world.terrain, W = this.map.w, H = this.map.h;
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(W - 1, x1 | 0); y1 = Math.min(H - 1, y1 | 0);
    var w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return;
    var img = this.cx.createImageData(w, h), d = img.data, m = tr.mask, pal = this.pal;

    for (var y = y0; y <= y1; y++) {
      var row = y * W, drow = (y - y0) * w * 4;
      for (var x = x0; x <= x1; x++) {
        var v = m[row + x], i = drow + (x - x0) * 4;
        if (!v) { d[i + 3] = 0; continue; }
        var c = pal[v] || pal[2];
        var r = c[0], g = c[1], b = c[2];

        /* 배경 질감 블렌드 — 마스크가 있는 픽셀에만 입혀지므로 파면 같이 사라진다 */
        if (this.texData) {
          var tx = x % this.texW; if (tx < 0) tx += this.texW;
          var ty = y % this.texH; if (ty < 0) ty += this.texH;
          var ti = (ty * this.texW + tx) * 4;
          r = (r * 0.42 + this.texData[ti] * 0.58) | 0;
          g = (g * 0.42 + this.texData[ti + 1] * 0.58) | 0;
          b = (b * 0.42 + this.texData[ti + 2] * 0.58) | 0;
        } else if ((x + y) % 47 === 0) {
          this.ensureGroundTex();
        }

        // 표면에 가까울수록 밝게 — 파인 자리의 단면이 저절로 드러난다
        var up1 = y > 0 ? m[row - W + x] : 1;
        if (!up1) { r += 46; g += 46; b += 42; }
        else if (y > 1 && !m[row - 2 * W + x]) { r += 22; g += 22; b += 20; }

        /* 아래가 허공이면 어둡게. 동굴 천장은 위쪽 하이라이트를 못 받아서
           이게 없으면 천장과 빈 공간의 경계가 뭉개진다. */
        var dn1 = y < H - 1 ? m[row + W + x] : 1;
        if (!dn1) { r *= 0.58; g *= 0.58; b *= 0.60; }
        else if (y < H - 2 && !m[row + 2 * W + x]) { r *= 0.76; g *= 0.76; b *= 0.78; }

        // 깊이 그림자
        var dep = (y - tr.colTop[x]);
        if (dep > 120) { var s = Math.min(0.42, (dep - 120) / 900); r *= (1 - s); g *= (1 - s); b *= (1 - s); }

        // 결. 없으면 단색 덩어리로 보인다
        var n = ((x * 73856093) ^ (y * 19349663)) & 15;
        r += n - 7; g += n - 7; b += n - 7;

        d[i] = r < 0 ? 0 : (r > 255 ? 255 : r);
        d[i + 1] = g < 0 ? 0 : (g > 255 ? 255 : g);
        d[i + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
        d[i + 3] = 255;
      }
    }
    this.cx.putImageData(img, x0, y0);
  };

  /* ── 전차 ──────────────────────────────────────────────────── */

  /* 차체 폴리곤의 가로 폭. 벡터로 그리든 스프라이트를 얹든 이 값이 전차의 크기를 정한다.
     logic/tanks.js 의 hull 이 유일한 출처다 — 렌더러가 따로 크기표를 들면 반드시 갈라진다. */
  function tankSpriteWidth(def) {
    var h = def.shape.hull, min = h[0][0], max = h[0][0];
    for (var i = 1; i < h.length; i++) {
      if (h[i][0] < min) min = h[i][0];
      if (h[i][0] > max) max = h[i][0];
    }
    return (max - min) * 1.18;
  }

  /* 탄체 크기 — 원작(포트리스2 블루 아케이드) 화면에서 직접 잰 값이 근거다.
     640px 폭 화면에서 탱크가 약 50px(7.8%), 날아가는 미사일이 **탱크와 거의 같은 크기**였다.
     탄이 탱크의 4분의 1짜리 점이면 어디로 날아가는지 눈으로 못 쫓는다 —
     원작이 탄을 그렇게 크게 그린 건 멋이 아니라 가독성 때문이다.

     다만 '탱크와 같은 크기'까지다. 우리 전차 폭은 76~108px 이므로 탄 전장은 60~70px 이 맞다.
     1.55 배로 뒀더니 전장 120px 이 나와 탱크보다 큰 탄이 됐다 — 0.85 배면 전장 65px 다. */
  var TSC = (root.TFTanks && root.TFTanks.SCALE) || 1;
  var SHELL_SCALE = TSC * 0.85;

  /* 궤적 스타일. w=선 굵기 배수, a=불투명도, tail=최근 N개 점만, dash=점선 패턴,
     puff=연기 뭉치 간격(점 개수). 원작의 궤적은 가는 실선이 아니라
     굵은 크림색 곡선 + 뒤따르는 동그란 연기 뭉치였다. */
  var TRAIL = {
    '유도': { w: 3.0, a: 0.75, puff: 7 },
    '돌파': { w: 3.4, a: 0.8, tail: 60, puff: 6 },
    '범위': { w: 4.2, a: 0.6, puff: 5 },
    '집중': { w: 2.4, a: 0.8 },
    '이동': { w: 2.6, a: 0.7, dash: [5, 6] },
    '표준': { w: 3.0, a: 0.7, puff: 8 }
  };

  /* 궤적을 따라 동그란 연기 뭉치를 남긴다. 오래된 것일수록 크고 옅다. */
  function smokePuffs(ctx, tr, every, sh) {
    var n = tr.length / 2;
    ctx.save();
    for (var i = 0; i < n; i += every) {
      var age = 1 - i / n;                       // 0=오래됨, 1=최근
      var r = (2.2 + (1 - age) * 5.5) * sh;
      var a = 0.5 * (0.25 + age * 0.75);
      var x = tr[i * 2], y = tr[i * 2 + 1];
      /* 연기도 테두리를 두른다. 밝은 회색 원만 찍으면 밝은 하늘에서 아무것도 안 보인다. */
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = '#2A323C';
      ctx.beginPath(); ctx.arc(x, y, r * 1.22, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#E6EAF0';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  /* 같은 색의 밝기만 바꾼다. 날개·꼬리를 몸통보다 어둡게 해 부품이 따로 읽히게 하는 용도. */
  function shade(hexc, k) {
    var c = hex(hexc);
    var f = k < 0 ? (1 + k) : 1;
    var add = k > 0 ? 255 * k : 0;
    return 'rgb(' + Math.round(C.clamp(c[0] * f + add, 0, 255)) + ',' +
      Math.round(C.clamp(c[1] * f + add, 0, 255)) + ',' +
      Math.round(C.clamp(c[2] * f + add, 0, 255)) + ')';
  }

  function polyline(ctx, tr, from) {
    ctx.beginPath();
    ctx.moveTo(tr[from], tr[from + 1]);
    for (var k = from + 2; k < tr.length; k += 2) ctx.lineTo(tr[k], tr[k + 1]);
    ctx.stroke();
  }

  /* 이미 만들어 둔 경로에 어두운 테두리를 먼저 두르고 색을 채운다.
     밝은 하늘 위에서도 탄이 배경에 묻히지 않게 하는 것이 전부다. */
  function inkFill(ctx, col, sh) {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(8,11,16,0.9)';
    ctx.lineWidth = 2.2 + 1.4 * (sh || 1);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = col;
    ctx.fill();
  }

  /* 전차 모양에서 궤도 바닥은 y = +TRACK_BOTTOM 이다(차체 바닥 y=0 기준).
     지면은 t.y + TANK_HH 이므로, 그 둘이 만나도록 원점을 내려 준다. */
  var TRACK_BOTTOM = 6 * TSC;
  var FOOT_DY = ((root.TFPhysics && root.TFPhysics.TANK_HH) || 13) - TRACK_BOTTOM;

  function drawTank(ctx, t, opt) {
    var s = t.def.shape;
    ctx.save();
    /* 물리는 t.y 를 충돌 상자의 '중심'으로 쓰고, 전차 모양은 y=0 을 '차체 바닥'으로 그린다.
       두 기준이 다르므로 그대로 그리면 전차가 지면 위에 떠 보인다.
       배율 1일 때는 그 간격이 7px 라 눈에 안 띄었는데, 2배가 되면서 14px 로 벌어져 드러났다.
       지면(= t.y + TANK_HH)에 궤도 바닥이 닿도록 내려 준다. */
    ctx.translate(t.x, t.y + FOOT_DY);
    ctx.rotate(t.tilt);
    ctx.scale(t.dir, 1);

    var art = root.TFArt && root.TFArt.tanks && root.TFArt.tanks[t.defId];

    // 포신 — 차체 뒤에 그려야 포탑에 자연스럽게 물린다
    ctx.save();
    ctx.translate(s.pivot[0], s.pivot[1]);
    ctx.rotate(-t.angle * C.DEG);
    ctx.fillStyle = '#20252E';
    ctx.fillRect(-4, -s.barrel[1] / 2, s.barrel[0] + 4, s.barrel[1]);
    ctx.fillStyle = s.trim;
    ctx.fillRect(s.barrel[0] - 6, -s.barrel[1] / 2, 6, s.barrel[1]);
    ctx.restore();

    if (art && art.complete && art.naturalWidth) {
      /* 스프라이트 폭은 그 전차의 실제 차체 폭에서 뽑는다. 상수로 박으면
         가디언(54)과 스팅어(38)가 같은 크기로 그려져, 폭으로 무게를 읽게 만든 설계가 통째로 무너진다.
         1.18 은 궤도가 차체보다 조금 넓게 나오는 몫이다. */
      var sw = tankSpriteWidth(t.def), sh = sw * art.naturalHeight / art.naturalWidth;
      ctx.drawImage(art, -sw / 2, -sh + TRACK_BOTTOM, sw, sh);
    } else {
      /* 궤도. 여기 숫자들도 차체와 같은 배율을 먹어야 한다 —
         상수로 두면 차체만 두 배가 되고 궤도는 그대로라 전차가 접시 위에 얹힌 모양이 된다. */
      ctx.fillStyle = '#191D24';
      var lw = s.hull[0][0], rw = s.hull[s.hull.length - 1][0];
      var k = TSC;
      ctx.beginPath();
      ctx.moveTo(lw - 2 * k, -3 * k); ctx.lineTo(rw + 2 * k, -3 * k);
      ctx.quadraticCurveTo(rw + 7 * k, 2 * k, rw - 2 * k, 6 * k);
      ctx.lineTo(lw + 2 * k, 6 * k);
      ctx.quadraticCurveTo(lw - 7 * k, 2 * k, lw - 2 * k, -3 * k);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2E3440';
      for (var i = 0; i < s.wheels; i++) {
        var wx = lw + 3 * k + (rw - lw - 6 * k) * (i / (s.wheels - 1));
        ctx.beginPath(); ctx.arc(wx, 1.5 * k, 3.4 * k, 0, 6.2832); ctx.fill();
      }
      // 차체
      ctx.beginPath();
      ctx.moveTo(s.hull[0][0], s.hull[0][1]);
      for (var k = 1; k < s.hull.length; k++) ctx.lineTo(s.hull[k][0], s.hull[k][1]);
      ctx.closePath();
      var grd = ctx.createLinearGradient(0, -22, 0, 2);
      grd.addColorStop(0, s.trim); grd.addColorStop(0.28, s.skin); grd.addColorStop(1, '#161A21');
      ctx.fillStyle = grd; ctx.fill();
      ctx.strokeStyle = '#0E1116'; ctx.lineWidth = 1.4; ctx.stroke();
      // 포탑
      ctx.beginPath();
      ctx.arc(s.pivot[0], s.pivot[1] + 1, 8.5, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = s.skin; ctx.fill();
      ctx.strokeStyle = '#0E1116'; ctx.stroke();
      ctx.fillStyle = s.trim;
      ctx.fillRect(s.pivot[0] - 6, s.pivot[1] - 1, 12, 2);

      // 카툰식 눈 (포트리스 스타일) — 진행 방향 앞쪽에 큼직하게
      var eyeX = (s.hull[0][0] + s.hull[s.hull.length - 1][0]) * 0.35 + 4;
      var eyeY = s.pivot[1] - 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(eyeX, eyeY, 4.2, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#1A1E28'; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.fillStyle = '#1A1E28';
      ctx.beginPath(); ctx.arc(eyeX + 1.1, eyeY + 0.4, 2.1, 0, 6.2832); ctx.fill();
      // 하이라이트
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(eyeX + 0.2, eyeY - 1.2, 1.0, 0, 6.2832); ctx.fill();
    }
    ctx.restore();

    // 체력/이름 — 회전 없이 화면 기준으로
    if (opt && opt.bar) {
      var bw = 44, bx = t.x - bw / 2, by = t.y - 40;
      ctx.fillStyle = 'rgba(6,9,14,.82)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
      var f = t.hp / t.hpMax;
      ctx.fillStyle = f > 0.55 ? '#5FD37A' : (f > 0.25 ? '#E0C24A' : '#E0574A');
      ctx.fillRect(bx, by, bw * f, 5);
      if (opt.teamColor) { ctx.fillStyle = opt.teamColor; ctx.fillRect(bx - 1, by + 7, bw + 2, 2); }
      if (opt.name) {
        ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.strokeText(opt.name, t.x, by - 5); ctx.fillStyle = '#DCE4EE';
        ctx.fillText(opt.name, t.x, by - 5);
      }
    }
  }

  /* ── 전체 프레임 ───────────────────────────────────────────── */

  Scene.prototype.render = function (ctx, cam, view, ui) {
    var m = this.map, w = this.world;
    /* 배경 이미지 로드가 늦으면 질감이 비어 있다. 준비되는 순간 전 지형을 다시 칠한다. */
    if (!this.texData && this.ensureGroundTex()) this.repaintAll();
    ctx.save();
    ctx.clearRect(0, 0, view.w, view.h);

    /* 하늘 — 원경 이미지는 타일하지 않고 cover 한 장만 (이음매 없음). */
    var artBg = root.TFArt && root.TFArt.maps && root.TFArt.maps[m.id];
    if (artBg && artBg.complete && artBg.naturalWidth) {
      var iw = artBg.naturalWidth, ih = artBg.naturalHeight;
      var sc = Math.max(view.w / iw, view.h / ih);
      var dw = Math.ceil(iw * sc), dh = Math.ceil(ih * sc);
      var maxOx = Math.max(0, dw - view.w), maxOy = Math.max(0, dh - view.h);
      var ox = Math.round(C.clamp(cam.x * 0.18, 0, maxOx));
      var oy = Math.round(C.clamp(cam.y * 0.10, 0, maxOy));
      ctx.drawImage(artBg, -ox, -oy, dw, dh);
    } else {
      var sx = Math.round(-(cam.x * 0.25) % 960);
      var sy = Math.round(-cam.y * 0.25);
      ctx.drawImage(this.bg, sx, sy, 960, m.h);
      ctx.drawImage(this.bg, sx + 959, sy, 960, m.h);
      if (sx > 0) ctx.drawImage(this.bg, sx - 961, sy, 960, m.h);
    }

    ctx.translate(-cam.x, -cam.y);

    // 지형
    this.sync();
    ctx.drawImage(this.cv, 0, 0);

    // 낙사선
    var vy = w.voidY;
    if (vy < m.h) {
      ctx.save();
      var g2 = ctx.createLinearGradient(0, vy - 40, 0, vy + 60);
      g2.addColorStop(0, 'rgba(224,87,74,0)'); g2.addColorStop(1, 'rgba(224,87,74,.5)');
      ctx.fillStyle = g2; ctx.fillRect(0, vy - 40, m.w, 100);
      ctx.restore();
    }

    // 보급 상자. 떨어지는 동안은 낙하산을 단다 — 어디로 내려오는지 미리 읽히게 하려는 것이다
    var IT = root.TFItems;
    for (var ci = 0; ci < w.crates.length; ci++) {
      var cr = w.crates[ci];
      var def = IT && IT.get(cr.item);
      ctx.save();
      ctx.translate(cr.x, cr.y);
      if (!cr.grounded) {
        ctx.strokeStyle = 'rgba(230,240,250,.75)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-9, -10); ctx.lineTo(-13, -24);
        ctx.moveTo(9, -10); ctx.lineTo(13, -24);
        ctx.stroke();
        ctx.fillStyle = 'rgba(235,245,255,.9)';
        ctx.beginPath(); ctx.arc(0, -24, 15, Math.PI, 0); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#3A4250';
      ctx.fillRect(-11, -11, 22, 22);
      ctx.strokeStyle = def ? def.color : '#C9A227'; ctx.lineWidth = 2;
      ctx.strokeRect(-10, -10, 20, 20);
      if (def) {
        ctx.fillStyle = def.color;
        ctx.font = '700 13px system-ui,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(def.mark, 0, 1);
      }
      ctx.restore();
    }

    /* 포탄 — 무기 type 별로 궤적·실루엣이 다르다. 시뮬레이션 값은 건드리지 않는다.

       모든 탄체와 궤적은 **어두운 외곽선을 먼저 깔고** 그 위에 색을 얹는다.
       초원 능선처럼 하늘이 밝은 전장에서 밝은 탄(레이븐 하늘색, 타이탄 주황)이
       배경에 묻혀 어디로 날아가는지 안 보였다. 색만 바꿔서는 어떤 배경에서도 안전할 수 없다 —
       배경이 밝으면 어두운 테두리가, 어두우면 밝은 본체가 눈에 걸린다. */
    for (var i = 0; i < w.shells.length; i++) {
      var s = w.shells[i], tr = s.trail, ww = s.w || {};
      var col = ww.color || '#FFB86B';
      var typ = ww.type || '표준';
      var isChild = !!s.gen;
      var SH = isChild ? SHELL_SCALE * 0.62 : SHELL_SCALE;

      /* ── 궤적. 연기 뭉치 → 어두운 밑선 → 크림색 심 → 무기색 순으로 겹친다.
         원작의 궤적은 밝은 크림색이라 어떤 배경에서도 눈에 걸렸다.
         무기색만 쓰면 밝은 하늘에서 밝은 탄이 그대로 묻힌다 —
         그래서 심은 항상 크림색으로 두고, 무기색은 그 위에 얇게 얹어 구별용으로만 쓴다. */
      if (tr.length > 3) {
        var style = TRAIL[typ] || TRAIL['표준'];
        var from = style.tail ? Math.max(0, tr.length - style.tail) : 0;
        if (style.puff && !isChild) smokePuffs(ctx, tr, style.puff, SH);
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (style.dash) ctx.setLineDash(style.dash);
        /* 어두운 테두리(굵게) → 무기색 심 → 흰 하이라이트(가늘게).
           크림색을 심으로 썼다가 밝은 하늘 전장에서 통째로 사라졌다.
           원작 배경은 어두운 보라였으니 크림이 통했던 것이고, 우리 배경은 밝다.
           어떤 배경에서도 남는 건 '진한 테두리 + 채도 높은 심'이다. */
        ctx.strokeStyle = 'rgba(18,24,32,0.8)';
        ctx.lineWidth = style.w * SH + 5;
        ctx.globalAlpha = style.a * 0.9;
        polyline(ctx, tr, from);
        ctx.strokeStyle = col;
        ctx.lineWidth = style.w * SH;
        ctx.globalAlpha = Math.min(1, style.a * 1.3);
        polyline(ctx, tr, from);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = style.w * SH * 0.32;
        ctx.globalAlpha = style.a * 0.8;
        polyline(ctx, tr, from);
        ctx.restore();
      }

      // ── 탄체
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(s.vy, s.vx));

      /* 탄체에는 '해부학'이 있어야 한다. 원작의 미사일은 멀리서 봐도
         드릴 노즈 / 몸통 밴드 / 꼬리날개가 각각 읽혔다. 단색 덩어리는 그냥 점으로 보인다. */
      if (typ === '돌파') {                       // 천공 미사일 — 나선 노즈 + 몸통 + 날개
        var L = 22 * SH, hh = 5.0 * SH;
        ctx.beginPath();                          // 꼬리날개
        ctx.moveTo(-L * 0.52, 0);
        ctx.lineTo(-L * 0.80, hh * 1.7);
        ctx.lineTo(-L * 0.44, hh * 0.9);
        ctx.lineTo(-L * 0.44, -hh * 0.9);
        ctx.lineTo(-L * 0.80, -hh * 1.7);
        ctx.closePath();
        inkFill(ctx, shade(col, -0.25), SH);
        ctx.beginPath();                          // 몸통 + 원뿔 노즈
        ctx.moveTo(L, 0);
        ctx.lineTo(L * 0.42, hh);
        ctx.lineTo(-L * 0.55, hh);
        ctx.lineTo(-L * 0.55, -hh);
        ctx.lineTo(L * 0.42, -hh);
        ctx.closePath();
        inkFill(ctx, col, SH);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';   // 나선 홈
        ctx.lineWidth = 1.3 * SH;
        for (var d = 0; d < 3; d++) {
          ctx.beginPath();
          ctx.moveTo(L * (0.45 + d * 0.16), -hh * 0.85);
          ctx.lineTo(L * (0.62 + d * 0.16), hh * 0.85);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(20,24,30,0.5)';          // 몸통 밴드
        ctx.fillRect(-L * 0.24, -hh, 3.5 * SH, hh * 2);
      } else if (typ === '유도') {                // 유도 미사일 — 짧은 노즈 + 긴 몸통 + 꼬리날개
        var L2 = 17 * SH, h2 = 4.6 * SH;
        ctx.beginPath();                          // 부스터 화염
        ctx.moveTo(-L2 * 0.9, 0);
        ctx.lineTo(-L2 * 1.5, h2 * 0.6);
        ctx.lineTo(-L2 * 1.25, 0);
        ctx.lineTo(-L2 * 1.5, -h2 * 0.6);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,206,120,0.9)'; ctx.fill();
        ctx.beginPath();                          // 꼬리날개 (몸통 뒤쪽에 붙는다)
        ctx.moveTo(-L2 * 0.55, h2 * 0.9);
        ctx.lineTo(-L2 * 1.0, h2 * 2.0);
        ctx.lineTo(-L2 * 0.9, h2 * 0.9);
        ctx.lineTo(-L2 * 0.9, -h2 * 0.9);
        ctx.lineTo(-L2 * 1.0, -h2 * 2.0);
        ctx.lineTo(-L2 * 0.55, -h2 * 0.9);
        ctx.closePath();
        inkFill(ctx, shade(col, -0.32), SH);
        ctx.beginPath();                          // 몸통 + 짧은 원뿔 노즈
        ctx.moveTo(L2, 0);
        ctx.lineTo(L2 * 0.62, h2);
        ctx.lineTo(-L2 * 0.9, h2);
        ctx.lineTo(-L2 * 0.9, -h2);
        ctx.lineTo(L2 * 0.62, -h2);
        ctx.closePath();
        inkFill(ctx, col, SH);
        ctx.fillStyle = 'rgba(20,24,30,0.45)';    // 몸통 밴드 두 줄
        ctx.fillRect(-L2 * 0.05, -h2, 2.6 * SH, h2 * 2);
        ctx.fillRect(-L2 * 0.45, -h2, 2.6 * SH, h2 * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';  // 노즈 하이라이트
        ctx.beginPath();
        ctx.moveTo(L2 * 0.95, 0); ctx.lineTo(L2 * 0.6, -h2 * 0.55); ctx.lineTo(L2 * 0.6, h2 * 0.1);
        ctx.closePath(); ctx.fill();
      } else if (typ === '범위') {                // 클러스터 폭탄 — 뭉툭한 통에 꼬리날개
        var rr = 9.5 * SH;
        ctx.beginPath();                          // 꼬리날개
        ctx.moveTo(-rr * 0.7, 0);
        ctx.lineTo(-rr * 1.9, rr * 0.95);
        ctx.lineTo(-rr * 1.9, -rr * 0.95);
        ctx.closePath();
        inkFill(ctx, shade(col, -0.3), SH);
        ctx.beginPath();                          // 통
        ctx.ellipse(0, 0, rr * 1.25, rr, 0, 0, 6.2832);
        inkFill(ctx, col, SH);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(-rr * 0.3, -rr * 0.32, rr * 0.36, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(20,24,30,0.45)';    // 분리선 — 갈라지는 탄임을 알린다
        ctx.fillRect(-rr * 0.15, -rr, 2.6 * SH, rr * 2);
      } else if (typ === '집중') {                // 철갑탄 — 가늘고 길고 금속질
        var L3 = 20 * SH, h3 = 3.0 * SH;
        ctx.beginPath();
        ctx.moveTo(L3, 0);
        ctx.lineTo(L3 * 0.5, h3);
        ctx.lineTo(-L3 * 0.75, h3 * 0.8);
        ctx.lineTo(-L3 * 0.75, -h3 * 0.8);
        ctx.lineTo(L3 * 0.5, -h3);
        ctx.closePath();
        inkFill(ctx, col, SH);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';   // 관통자 심
        ctx.fillRect(L3 * 0.15, -h3 * 0.3, L3 * 0.5, h3 * 0.6);
      } else if (typ === '이동') {                // 텔레포트탄 — 이중 고리
        var q = 8 * SH;
        ctx.beginPath(); ctx.arc(0, 0, q, 0, 6.2832);
        inkFill(ctx, col, SH);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2.0 * SH;
        ctx.beginPath(); ctx.arc(0, 0, q * 0.55, 0, 6.2832); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, q * 1.35, -0.9, 0.9); ctx.stroke();
      } else {                                    // 표준 — 구형 포탄 + 짧은 꼬리
        var rad = 7.5 * SH;
        ctx.beginPath();
        ctx.moveTo(-rad * 0.6, 0);
        ctx.lineTo(-rad * 1.8, rad * 0.7);
        ctx.lineTo(-rad * 1.8, -rad * 0.7);
        ctx.closePath();
        inkFill(ctx, shade(col, -0.3), SH);
        ctx.beginPath(); ctx.arc(0, 0, rad, 0, 6.2832);
        inkFill(ctx, col, SH);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(-rad * 0.3, -rad * 0.3, rad * 0.34, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }

    // 조준 보조선 — 전체 궤적이 아니라 포구 앞 짧은 구간만. 다 보여 주면 게임이 아니라 계산기가 된다
    if (ui && ui.aimTank && !ui.aimTank.dead) {
      var t = ui.aimTank, mu = w.muzzle(t);
      ctx.save();
      ctx.setLineDash([5, 6]); ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.moveTo(mu.x, mu.y);
      var a = t.angle * C.DEG, L = 46 + (ui.power || 0) * 0.9;
      ctx.lineTo(mu.x + C.cos(a) * L * t.dir, mu.y - C.sin(a) * L);
      ctx.stroke();
      ctx.restore();
      // 현재 사수 표시기
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.5 * C.sin(ui.time * 6);
      ctx.fillStyle = '#C9A227';
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - 52); ctx.lineTo(t.x - 7, t.y - 64); ctx.lineTo(t.x + 7, t.y - 64);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // 전차
    for (var j = 0; j < w.tanks.length; j++) {
      var tk = w.tanks[j];
      if (tk.dead) continue;
      drawTank(ctx, tk, {
        bar: true, name: tk.label,
        teamColor: ui && ui.teamColors ? ui.teamColors[tk.team] : null
      });
    }

    if (ui && ui.fx) { ui.fx.draw(ctx); ui.fx.drawText(ctx); }

    ctx.restore();

    // 화면 밖 전차 방향 표시 — 스크롤 맵에서 상대가 어디 있는지 놓치지 않게
    if (ui && ui.markers !== false) {
      for (var q = 0; q < w.tanks.length; q++) {
        var tt = w.tanks[q];
        if (tt.dead) continue;
        var sxp = tt.x - cam.x;
        if (sxp >= -10 && sxp <= view.w + 10) continue;
        var edge = sxp < 0 ? 16 : view.w - 16;
        var yy = C.clamp(tt.y - cam.y, 40, view.h - 100);
        ctx.save();
        ctx.fillStyle = (ui.teamColors && ui.teamColors[tt.team]) || '#C9A227';
        ctx.beginPath();
        var d2 = sxp < 0 ? -1 : 1;
        ctx.moveTo(edge + d2 * 9, yy); ctx.lineTo(edge - d2 * 6, yy - 8); ctx.lineTo(edge - d2 * 6, yy + 8);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    if (ui && ui.fx && ui.fx.flash > 0.004) {
      ctx.save();
      ctx.globalAlpha = ui.fx.flash; ctx.fillStyle = '#FFE9C0';
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.restore();
    }
  };

  root.TFDraw = { Scene: Scene, drawTank: drawTank, tankSpriteWidth: tankSpriteWidth };
})(typeof globalThis !== 'undefined' ? globalThis : this);
