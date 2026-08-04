/* logic/maps.js — 전장 10종 (전체 재구성).
   맵이 바꾸는 것은 그림이 아니라 계산이다. 중력·바람·낙사 구간 세 개가 사거리표를 전부 뒤집는다.
   그래서 맵마다 "어떤 무기가 유리한가"를 note 에 적어 둔다.

   base   : 지표 평균 높이 비율 (0=꼭대기, 1=바닥). 1.0 초과면 바닥 없는 부유 전장
   gravity: px/s². 표준 540
   wind   : 매 턴 재추첨되는 바람 세기의 최대 절댓값
   voidY  : 낙사선 비율 (기본 1.0 = 맵 바닥). 용암 맵은 더 위로 올린다
   settle : 파인 자리 위 흙이 무너지는가
   spawn  : 슬롯별 [lo, hi] 비율 밴드 — 넓을수록 시작 위치가 다양해진다 */
(function (root) {
  'use strict';

  var MAPS = [
    /* ── 1. 초원 능선 ─────────────────────────────────────────
       입문·기준선. 완만한 언덕, 모든 무기가 설계값대로 먹힌다. */
    {
      id: 'ridge', name: '초원 능선', note: '표준 전장. 모든 무기가 설계값대로 동작한다. 사거리 감을 잡는 곳.',
      w: 2200, h: 900, base: 0.60, gravity: 540, wind: 5, settle: true,
      sky: ['#2A4A6E', '#5A8AB0', '#B8D4E8'],
      pal: { 1: '#6B9E45', 2: '#7A5E38', 3: '#4E3A24', 4: '#2C2116' },
      ground: [{ amp: 110, freq: 2.5 }, { amp: 42, freq: 7 }, { amp: 14, freq: 17 }],
      ops: [
        { op: 'roughen', count: 8, y0: 0.68, y1: 0.96, size: 24, dig: false }
      ],
      spawn: [[0.05, 0.28], [0.72, 0.95], [0.28, 0.46], [0.54, 0.72]]
    },

    /* ── 2. 단절 협곡 ─────────────────────────────────────────
       중앙 거대 절벽. 넉백·낙사가 체력보다 강하다. */
    {
      id: 'canyon', name: '단절 협곡', note: '중앙이 바닥까지 뚫려 있다. 넉백 한 방이 체력 100보다 강하다.',
      w: 2500, h: 980, base: 0.52, gravity: 560, wind: 7, settle: true,
      sky: ['#3A1E2E', '#7A4058', '#D49878'],
      pal: { 1: '#A07840', 2: '#8A5634', 3: '#5A3224', 4: '#2E1810' },
      ground: [{ amp: 70, freq: 3.5 }, { amp: 28, freq: 10 }],
      ops: [
        { op: 'gap', x0: 1080, x1: 1420, taper: 110 },
        { op: 'roughen', count: 6, y0: 0.55, y1: 0.82, size: 20, dig: true },
        { op: 'pillar', cx: 0.22, w: 70, top: 0.48 },
        { op: 'pillar', cx: 0.78, w: 70, top: 0.48 }
      ],
      spawn: [[0.04, 0.26], [0.74, 0.96], [0.12, 0.24], [0.76, 0.88]]
    },

    /* ── 3. 부유 군도 ─────────────────────────────────────────
       바닥 없음. 섬 사이를 밀고 당기는 넉백 싸움. */
    {
      id: 'isles', name: '부유 군도', note: '바닥이 없다. 빗맞아도 밀어내면 이긴다. 유도탄과 넉백이 왕.',
      w: 2500, h: 1050, base: 1.45, gravity: 490, wind: 9, settle: false,
      sky: ['#101828', '#243860', '#6A88B8'],
      pal: { 1: '#7A9A5C', 2: '#5C6478', 3: '#3A4054', 4: '#1E222E' },
      ground: [{ amp: 0, freq: 2 }],
      ops: [
        { op: 'island', cx: 0.12, cy: 0.64, rx: 200, ry: 80 },
        { op: 'island', cx: 0.88, cy: 0.64, rx: 200, ry: 80 },
        { op: 'island', cx: 0.50, cy: 0.48, rx: 160, ry: 64 },
        { op: 'island', cx: 0.30, cy: 0.76, rx: 120, ry: 50 },
        { op: 'island', cx: 0.70, cy: 0.76, rx: 120, ry: 50 },
        { op: 'island', cx: 0.42, cy: 0.88, rx: 70, ry: 32 },
        { op: 'island', cx: 0.58, cy: 0.88, rx: 70, ry: 32 }
      ],
      spawn: [[0.06, 0.18], [0.82, 0.94], [0.26, 0.36], [0.64, 0.74]]
    },

    /* ── 4. 첨탑 지대 ─────────────────────────────────────────
       높은 기둥들이 시야·직사를 막는다. 곡사 또는 돌파. */
    {
      /* 비활성. 중앙 기둥(top 0.14, 폭 140)이 사실상 천장까지 닿는 벽이라
         양쪽이 20~30턴 동안 서로가 아니라 기둥만 두들기는 판이 나왔다.
         데이터는 남겨 둔다 — 기둥 높이만 낮추면 살릴 수 있는 맵이다. */
      disabled: true,
      id: 'spires', name: '첨탑 지대', note: '기둥이 시야를 막는다. 곡사로 넘기거나 돌파탄으로 뚫거나 — 둘 중 하나.',
      w: 2400, h: 1050, base: 0.78, gravity: 540, wind: 5, settle: false,
      sky: ['#1A1428', '#3E2E58', '#A888B0'],
      pal: { 1: '#8A8098', 2: '#5C546C', 3: '#3A3448', 4: '#1E1A28' },
      ground: [{ amp: 36, freq: 5 }, { amp: 14, freq: 13 }],
      ops: [
        { op: 'pillar', cx: 0.20, w: 88, top: 0.22 },
        { op: 'pillar', cx: 0.38, w: 64, top: 0.38 },
        { op: 'pillar', cx: 0.50, w: 140, top: 0.14 },
        { op: 'pillar', cx: 0.62, w: 64, top: 0.38 },
        { op: 'pillar', cx: 0.80, w: 88, top: 0.22 },
        { op: 'pillar', cx: 0.30, w: 48, top: 0.52 },
        { op: 'pillar', cx: 0.70, w: 48, top: 0.52 },
        { op: 'roughen', count: 5, y0: 0.70, y1: 0.92, size: 16, dig: false }
      ],
      spawn: [[0.04, 0.16], [0.84, 0.96], [0.22, 0.34], [0.66, 0.78]]
    },

    /* ── 5. 건조 대지 ─────────────────────────────────────────
       계단식 고지대. 고지 선점 + 연료 관리. */
    {
      id: 'mesa', name: '건조 대지', note: '계단식 평지. 사거리 싸움. 이동 연료를 아껴 고지대를 선점하는 쪽이 유리하다.',
      w: 2400, h: 950, base: 0.70, gravity: 530, wind: 6, settle: true,
      sky: ['#4A3020', '#8A6040', '#E0B888'],
      pal: { 1: '#C89850', 2: '#A07040', 3: '#6A4830', 4: '#3A2818' },
      ground: [{ amp: 20, freq: 3 }, { amp: 8, freq: 11 }],
      ops: [
        { op: 'pillar', cx: 0.18, w: 420, top: 0.48 },
        { op: 'pillar', cx: 0.82, w: 420, top: 0.48 },
        { op: 'pillar', cx: 0.50, w: 340, top: 0.34 },
        { op: 'pillar', cx: 0.34, w: 160, top: 0.58 },
        { op: 'pillar', cx: 0.66, w: 160, top: 0.58 },
        { op: 'roughen', count: 7, y0: 0.70, y1: 0.94, size: 18, dig: false }
      ],
      spawn: [[0.05, 0.20], [0.80, 0.95], [0.28, 0.40], [0.60, 0.72]]
    },

    /* ── 6. 지하 공동 ─────────────────────────────────────────
       천장 있는 동굴. 고각이 막힌다 → 직사·돌파의 무대. */
    {
      id: 'undercave', name: '지하 공동', note: '천장이 있다. 고각 곡사가 자기 머리 위 천장에 막힌다. 직사·돌파탄의 무대. 천장 위는 허공이다.',
      w: 2300, h: 1000, base: 0.78, gravity: 560, wind: 3, settle: false, spawnScanY: 0.55,
      sky: ['#0E1018', '#1A2030', '#3A4860'],
      pal: { 1: '#5A6A58', 2: '#3E4848', 3: '#2A3038', 4: '#141820' },
      ground: [{ amp: 12, freq: 5 }],
      ops: [
        /* top: 0.14 → 천장 윗면이 맵 상단이 아니라 14% 지점. 그 위는 하늘(허공). */
        { op: 'pillar', cx: 0.50, w: 2300, top: 0.14 },
        { op: 'cave', cx: 0.50, cy: 0.48, rx: 1000, ry: 210 },
        { op: 'cave', cx: 0.18, cy: 0.56, rx: 340, ry: 150 },
        { op: 'cave', cx: 0.82, cy: 0.56, rx: 340, ry: 150 },
        { op: 'cave', cx: 0.50, cy: 0.68, rx: 300, ry: 100 },
        { op: 'roughen', count: 14, y0: 0.38, y1: 0.70, size: 28, dig: true }
      ],
      spawn: [[0.08, 0.24], [0.76, 0.92], [0.26, 0.40], [0.60, 0.74]]
    },

    /* ── 7. 강철 교량 ─────────────────────────────────────────
       다리 하나만 연결. 다리를 끊으면 발판이 죽는다. */
    {
      id: 'bridge', name: '강철 교량', note: '다리 밑이 전부 허공이다. 다리를 끊으면 상대가 아니라 발판이 죽는다.',
      w: 2500, h: 1000, base: 1.35, gravity: 520, wind: 7, settle: false,
      sky: ['#1A2038', '#3A5080', '#88A0C8'],
      pal: { 1: '#6A7A8A', 2: '#4A5468', 3: '#303848', 4: '#181C28' },
      ground: [{ amp: 0, freq: 2 }],
      ops: [
        { op: 'island', cx: 0.09, cy: 0.60, rx: 190, ry: 130 },
        { op: 'island', cx: 0.91, cy: 0.60, rx: 190, ry: 130 },
        { op: 'arch', cx: 0.50, cy: 0.48, rx: 680, thick: 38, rise: 160 },
        { op: 'pillar', cx: 0.32, w: 48, top: 0.50 },
        { op: 'pillar', cx: 0.50, w: 56, top: 0.46 },
        { op: 'pillar', cx: 0.68, w: 48, top: 0.50 },
        { op: 'island', cx: 0.50, cy: 0.78, rx: 90, ry: 40 }
      ],
      spawn: [[0.04, 0.16], [0.84, 0.96], [0.08, 0.18], [0.82, 0.92]]
    },

    /* ── 8. 빙하 균열 ─────────────────────────────────────────
       좁은 크레바스 여러 개. 빗나간 한 발이 무덤이 된다. */
    {
      id: 'glacier', name: '빙하 균열', note: '좁은 크레바스가 여럿. 한 발 빗나가면 그 자리가 곧 무덤이 된다.',
      w: 2500, h: 920, base: 0.58, gravity: 510, wind: 8, settle: true,
      sky: ['#1A3048', '#4A78A0', '#C0D8F0'],
      pal: { 1: '#A8C8D8', 2: '#7898B0', 3: '#4A6880', 4: '#283848' },
      ground: [{ amp: 50, freq: 4 }, { amp: 18, freq: 12 }],
      ops: [
        { op: 'gap', x0: 620, x1: 730, taper: 36 },
        { op: 'gap', x0: 1080, x1: 1210, taper: 42 },
        { op: 'gap', x0: 1580, x1: 1700, taper: 38 },
        { op: 'gap', x0: 2000, x1: 2100, taper: 32 },
        { op: 'roughen', count: 6, y0: 0.62, y1: 0.88, size: 16, dig: false }
      ],
      spawn: [[0.04, 0.20], [0.84, 0.96], [0.30, 0.42], [0.58, 0.72]]
    },

    /* ── 9. 분화구 ────────────────────────────────────────────
       무거운 중력 + 그릇형 지형 + 높은 낙사선(용암). 근접 난전. */
    {
      id: 'caldera', name: '분화구', note: '중력이 무겁고 지형이 그릇이다. 사거리가 짧아지고 근접 난전이 된다. 바닥은 용암.',
      w: 2300, h: 1000, base: 0.68, gravity: 680, wind: 4, settle: true,
      sky: ['#2A0C10', '#6E2018', '#D05838'],
      pal: { 1: '#8A4030', 2: '#6A3024', 3: '#421C14', 4: '#200E0A' },
      ground: [{ amp: 0, freq: 2 }],
      ops: [
        { op: 'pillar', cx: 0.08, w: 380, top: 0.38 },
        { op: 'pillar', cx: 0.92, w: 380, top: 0.38 },
        { op: 'pillar', cx: 0.26, w: 280, top: 0.54 },
        { op: 'pillar', cx: 0.74, w: 280, top: 0.54 },
        { op: 'pillar', cx: 0.50, w: 480, top: 0.70 },
        { op: 'roughen', count: 9, y0: 0.58, y1: 0.88, size: 24, dig: false }
      ],
      voidY: 0.92,
      spawn: [[0.04, 0.18], [0.82, 0.96], [0.22, 0.36], [0.64, 0.78]]
    },

    /* ── 10. 폐허 도시 ────────────────────────────────────────
       부서지는 엄폐물이 가득. 범위탄으로 엄폐를 지우는 게 첫 수순. */
    {
      id: 'ruins', name: '폐허 도시', note: '엄폐물이 많고 전부 부서진다. 범위탄으로 엄폐를 지우는 게 첫 수순.',
      w: 2600, h: 960, base: 0.76, gravity: 540, wind: 5, settle: false,
      sky: ['#24201C', '#52483C', '#A89880'],
      pal: { 1: '#A89E90', 2: '#787064', 3: '#504840', 4: '#2A2620' },
      ground: [{ amp: 30, freq: 4.5 }, { amp: 12, freq: 13 }],
      ops: [
        { op: 'pillar', cx: 0.14, w: 130, top: 0.40 },
        { op: 'pillar', cx: 0.26, w: 90,  top: 0.52 },
        { op: 'pillar', cx: 0.38, w: 150, top: 0.32 },
        { op: 'pillar', cx: 0.50, w: 100, top: 0.46 },
        { op: 'pillar', cx: 0.62, w: 150, top: 0.32 },
        { op: 'pillar', cx: 0.74, w: 90,  top: 0.52 },
        { op: 'pillar', cx: 0.86, w: 130, top: 0.40 },
        { op: 'pillar', cx: 0.20, w: 55,  top: 0.62 },
        { op: 'pillar', cx: 0.80, w: 55,  top: 0.62 },
        { op: 'roughen', count: 16, y0: 0.36, y1: 0.76, size: 26, dig: true }
      ],
      spawn: [[0.03, 0.14], [0.86, 0.97], [0.32, 0.44], [0.56, 0.68]]
    }
  ];

  var byId = {};
  for (var i = 0; i < MAPS.length; i++) byId[MAPS[i].id] = MAPS[i];

  /* list 는 '고를 수 있는 전장'이다. disabled 를 여기서 한 번만 걸러 두면
     메뉴·랜덤 선택·검증 스크립트가 전부 같은 목록을 본다.
     get() 은 걸러진 것도 돌려준다 — 예전 설정이나 저장된 판이 그 id 를 가리킬 수 있다. */
  var PLAYABLE = MAPS.filter(function (m) { return !m.disabled; });

  root.TFMaps = {
    list: PLAYABLE,
    all: MAPS,
    get: function (id) { return byId[id] || PLAYABLE[0]; },
    /* 맵 정의 → 지형 spec */
    spec: function (m) {
      return { w: m.w, h: m.h, base: m.base, ground: m.ground, ops: m.ops, settle: m.settle };
    },

    /* 축소판. 메뉴 미리보기에 실물을 그대로 쓰면 10맵 래스터화에 1초 넘게 잡아먹는다.
       cx/cy 는 비율이라 그대로 두고, 픽셀 단위로 적힌 값만 배율을 먹인다. */
    thumbSpec: function (m, k) {
      function sc(o) {
        var n = {}, px = { rx: 1, ry: 1, w: 1, thick: 1, rise: 1, size: 1, taper: 1, x0: 1, x1: 1 };
        for (var key in o) n[key] = px[key] ? o[key] * k : o[key];
        return n;
      }
      return {
        w: Math.round(m.w * k), h: Math.round(m.h * k), base: m.base, settle: false,
        ground: (m.ground || []).map(function (g) { return { amp: g.amp * k, freq: g.freq }; }),
        ops: (m.ops || []).map(sc)
      };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
