/* logic/core.js — 결정론 수학 기반.
   포탄 궤적은 두 클라이언트에서 픽셀 단위로 같아야 한다. 안 그러면 "내 화면에선 맞았는데"가 나온다.
   Math.sin/cos/pow 는 엔진마다 마지막 자리가 갈릴 수 있으므로 여기서 전부 대체한다.
   +,-,*,/ 와 Math.sqrt 만 IEEE754 로 완전히 규정되어 있다. 그 넷만 쓴다. */
(function (root) {
  'use strict';

  var TAU = 6.283185307179586;
  var N = 4096;                       // 사인 테이블 분해능. 각도 오차 최대 0.044°
  var SIN = new Float64Array(N + 1);

  /* 테이블 자체는 Math.sin 으로 만든다 — 여기서 갈리지 않나? 갈리지 않는다.
     테이블은 빌드 시점이 아니라 각 클라이언트에서 만들어지지만, 우리는 테이블 "값"을 쓰는 게 아니라
     테이블 + 선형보간의 결과를 쓴다. 마지막 비트가 달라지면 궤적이 갈린다.
     그래서 테이블도 다항식으로 직접 채운다. Math 는 손대지 않는다. */
  (function fill() {
    for (var i = 0; i <= N; i++) {
      // x ∈ [0, 2π) 를 [-π/2, π/2] 로 접고 최소최대 근사 다항식(홀수차 7항)을 쓴다.
      var x = TAU * i / N;
      SIN[i] = polySin(x);
    }
  })();

  function polySin(x) {
    // 범위 축약: x → [-π, π]
    var PI = 3.141592653589793, TWO = 6.283185307179586;
    while (x > PI) x -= TWO;
    while (x < -PI) x += TWO;
    // [-π,π] → [-π/2, π/2] (sin(π-x) = sin x)
    if (x > PI / 2) x = PI - x;
    else if (x < -PI / 2) x = -PI - x;
    var x2 = x * x;
    /* Taylor 13차. 9차로 끊으면 x=π/2 에서 오차가 3.7e-6 까지 올라가고,
       그게 테이블 보간 오차(2.9e-7)를 열 배 넘게 덮어써 버린다. 항 두 개를 더 쓰면 1e-9 아래로 떨어진다. */
    return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880
      + x2 * (-1 / 39916800 + x2 / 6227020800))))));
  }

  function sin(a) {
    var t = a / TAU;
    t = t - Math.floor(t);              // Math.floor 는 정확한 연산이다
    var f = t * N, i = f | 0, fr = f - i;
    var s0 = SIN[i], s1 = SIN[i + 1];
    return s0 + (s1 - s0) * fr;
  }
  function cos(a) { return sin(a + TAU / 4); }

  function atan2(y, x) {
    // 결정론 atan2. 유도탄 조준각 계산에만 쓰인다.
    if (x === 0 && y === 0) return 0;
    var ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
    var a = (ax < ay ? ax / ay : ay / ax);
    var s = a * a;
    var r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
    if (ay > ax) r = 1.57079632679489661923 - r;
    if (x < 0) r = 3.14159265358979323846 - r;
    if (y < 0) r = -r;
    return r;
  }

  function sqrt(v) { return Math.sqrt(v); }        // 정확히 규정된 연산
  function hypot(x, y) { return Math.sqrt(x * x + y * y); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* pow 대신 정수 거듭제곱만 쓴다 */
  function ipow(b, e) { var r = 1; while (e-- > 0) r *= b; return r; }

  /* mulberry32 — 32bit 상태, 시드 하나로 두 클라이언트가 같은 맵·바람을 만든다 */
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
  }
  RNG.prototype.next = function () {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  RNG.prototype.int = function (a, b) { return a + ((this.next() * (b - a + 1)) | 0); };
  RNG.prototype.pick = function (arr) { return arr[(this.next() * arr.length) | 0]; };

  root.TFCore = {
    TAU: TAU, DEG: TAU / 360,
    sin: sin, cos: cos, atan2: atan2, sqrt: sqrt, hypot: hypot,
    clamp: clamp, lerp: lerp, ipow: ipow, RNG: RNG
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
