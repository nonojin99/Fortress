/* logic/items.js — 보급 상자와 아이템.

   포트리스2의 방식을 따른다: **헬기가 상자를 떨어뜨리고, 그걸 주우러 가야 한다.**
   상자를 쏴서 부수면 안의 아이템도 사라지므로, 적이 못 줍게 만드는 견제가 성립한다.
   (처음엔 턴 시작에 조용히 지급했는데, 그건 포트리스가 아니라 그냥 난수 보상이었다.
    상자로 바꾸면서 이동이 조준 말고 두 번째 목적을 얻었다 — 쟁탈.)

   떨어지는 자리는 뒤처진 쪽에 가깝게 잡는다. 확률로 몰아주는 대신 **거리로 유리를 준다** —
   앞선 쪽도 달려와 주울 수 있으니 공짜가 아니라 선택이 된다.
   이 비대칭이 없으면 아이템은 그저 이긴 쪽이 더 빨리 이기는 장치가 된다.

   아이템 자체는 턴을 쓰지 않는다. 쓰고 나서 그 턴에 그대로 쏜다 —
   턴을 잡아먹으면 "회복하려다 한 대 더 맞는" 구조가 되어 아무도 안 쓴다.

   kind
     shot    : 다음 발사에 실린다. 쏘는 순간 소모 (physics.js 의 fire 가 처리)
     instant : 쓰는 즉시 효과가 난다
   weight  : 상자 내용물 추첨 가중치
   cap     : 한 번에 지닐 수 있는 최대 개수 */
(function (root) {
  'use strict';
  var C = root.TFCore;

  var MAX_TOTAL = 4;          // 전차 하나가 지닐 수 있는 총 개수. 쌓아 두고 몰아 쓰는 것을 막는다
  var DROP_EVERY = 3;         // 몇 턴마다 헬기가 오는가
  var DROP_BIAS = 2.2;        // 열세인 전차가 뽑힐 가중치 배수 (체력 0일 때)
  /* 투하 거리는 고른 전차의 연료에 비례해야 한다.
     고정값(60~190px)으로 뒀더니 연료 58인 가디언은 물론 연료 142인 스팅어도 못 닿는 상자가 생겼다.
     실측 습득 0회. 연료의 일부만 쓰면 닿도록 잡되, 최소 45px 은 떨어뜨려
     '가만히 앉아서 줍는' 상황은 만들지 않는다. */
  var DROP_MIN = 45;          // 절대 최소 거리
  var DROP_LO = 0.30;         // 연료 대비 최소 비율
  var DROP_HI = 0.75;         // 연료 대비 최대 비율

  var ITEMS = {
    double: {
      id: 'double', name: '더블샷', kind: 'shot', weight: 9, cap: 2, mark: '⚡', color: '#FFE27A',
      desc: '이번 발사가 두 발로 나간다. 대신 딜레이가 1.5배 — 다음 차례가 그만큼 늦다.'
    },
    power: {
      id: 'power', name: '강화탄', kind: 'shot', weight: 9, cap: 2, mark: '✸', color: '#FF8A3D',
      desc: '이번 발사의 피해가 1.6배. 맞힐 자신이 있을 때만 값을 한다.'
    },
    windless: {
      id: 'windless', name: '무풍탄', kind: 'shot', weight: 7, cap: 2, mark: '≋', color: '#9FE8FF',
      desc: '이번 발사는 바람을 무시한다. 바람이 센 전장에서 한 발을 확실하게 만든다.'
    },
    heal: {
      id: 'heal', name: '응급수리', kind: 'instant', weight: 12, cap: 2, mark: '✚', color: '#5FD37A',
      desc: '체력을 30 회복한다. 턴을 쓰지 않으므로 쓰고 나서 그대로 쏜다.'
    },
    fuel: {
      id: 'fuel', name: '예비연료', kind: 'instant', weight: 9, cap: 2, mark: '⛁', color: '#5AA9E6',
      desc: '이동력을 가득 채운다. 절벽에서 물러나거나 엄폐 뒤로 숨는 데 쓴다.'
    },
    shield: {
      id: 'shield', name: '차폐막', kind: 'instant', weight: 8, cap: 2, mark: '◈', color: '#6BE0C0',
      desc: '다음에 맞는 한 방의 피해가 절반이 된다. 낙하 피해는 막지 못한다.'
    },
    teleport: {
      id: 'teleport', name: '텔레포트탄', kind: 'shot', weight: 6, cap: 1, mark: '➹', color: '#C79BFF',
      desc: '이번 발사가 텔레포트탄이 된다. 탄이 떨어진 자리로 내가 옮겨 간다 — 그 턴의 공격은 포기한다. 절벽 밖으로 나가면 이송 실패.'
    }
  };

  var ORDER = ['heal', 'shield', 'fuel', 'double', 'power', 'windless', 'teleport'];

  function count(t) {
    var n = 0;
    for (var k in t.items) if (t.items[k] > 0) n += t.items[k];
    return n;
  }

  function has(t, id) { return (t.items[id] || 0) > 0; }

  /* ── 보급 ───────────────────────────────────────────────────
     match.pickNext 가 턴 시작마다 부른다. 양쪽 클라이언트가 같은 순서로 같은 횟수를 뽑아야 하므로
     반드시 world.rng(판정용)를 쓴다. AI 전용 난수(arng)를 쓰면 온라인에서 갈린다. */

  function rollItem(world) {
    var pool = [], total = 0;
    for (var k = 0; k < ORDER.length; k++) { pool.push(ITEMS[ORDER[k]]); total += ITEMS[ORDER[k]].weight; }
    var r = world.rng.next() * total;
    for (var j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) return pool[j].id;
    }
    return pool[pool.length - 1].id;
  }

  /* 헬기가 올 차례인가. 온다면 어디에 떨어뜨릴지까지 정해서 상자를 만든다. */
  function supply(world, turn) {
    if (turn % DROP_EVERY !== 0) return null;
    var alive = world.tanks.filter(function (t) { return !t.dead; });
    if (alive.length < 2) return null;

    /* 투하 지점은 '어느 전차 근처인가'로 정한다.
       처음엔 전차들의 가중 평균 위치에 떨어뜨렸는데, 그건 정의상 두 전차의 한가운데다 —
       간격이 1500px 인데 연료는 130 이라 아무도 닿지 못했다(실측 습득 0회).
       체력이 낮은 전차가 뽑힐 확률을 높이고, 그 전차에서 연료로 닿는 거리에 떨어뜨린다. */
    var wsum = 0, weights = [];
    for (var i = 0; i < alive.length; i++) {
      var frac = C.clamp(alive[i].hp / alive[i].hpMax, 0, 1);
      var w = 1 + (DROP_BIAS - 1) * (1 - frac);
      weights.push(w); wsum += w;
    }
    var r = world.rng.next() * wsum, pick = alive[alive.length - 1];
    for (var j = 0; j < alive.length; j++) { r -= weights[j]; if (r <= 0) { pick = alive[j]; break; } }

    var side = world.rng.next() < 0.5 ? -1 : 1;
    var reach = pick.fuelMax * (DROP_LO + world.rng.next() * (DROP_HI - DROP_LO));
    var dist = Math.max(DROP_MIN, reach);
    var x = pick.x + side * dist;
    // 맵 밖으로 나가면 반대편으로 접는다. 가장자리 전차에게 불리해지지 않게.
    if (x < 40 || x > world.map.w - 40) x = pick.x - side * dist;

    return world.dropCrate(x, rollItem(world));
  }

  /* 상자를 주웠을 때 실제로 인벤토리에 넣는다. 한도를 넘으면 버려진다 — 주웠는데 사라지는 게
     이상해 보일 수 있지만, 한도가 없으면 아이템을 쌓아 두고 한 턴에 몰아 쓰는 판이 된다. */
  function receive(world, t, id) {
    var it = ITEMS[id];
    if (!it || t.dead) return false;
    if (count(t) >= MAX_TOTAL || (t.items[id] || 0) >= it.cap) {
      world.emit({ type: 'itemFull', id: t.id, item: id, x: t.x, y: t.y });
      return false;
    }
    t.items[id] = (t.items[id] || 0) + 1;
    world.emit({ type: 'item', id: t.id, item: id, x: t.x, y: t.y });
    return true;
  }

  /* ── 사용 ─────────────────────────────────────────────────── */
  function use(world, t, id) {
    var it = ITEMS[id];
    if (!it || t.dead || !has(t, id)) return false;

    if (it.kind === 'shot') {
      t.buff = t.buff || {};
      if (t.buff[id]) return false;               // 같은 버프를 두 번 켜도 효과가 겹치지 않는다
      t.buff[id] = true;
    } else if (id === 'heal') {
      if (t.hp >= t.hpMax) return false;
      t.hp = Math.min(t.hpMax, t.hp + 30);
    } else if (id === 'fuel') {
      if (t.fuel >= t.fuelMax) return false;
      t.fuel = t.fuelMax;
    } else if (id === 'shield') {
      t.shield += 1;
    }

    t.items[id]--;
    world.emit({ type: 'useItem', id: t.id, item: id, x: t.x, y: t.y });
    return true;
  }

  /* 텔레포트의 실제 이동은 physics.js 의 warpTo 가 한다 —
     탄이 어디 떨어졌는지는 포탄만 알기 때문이다. 여기서는 버프를 켜는 것까지만 한다. */

  root.TFItems = {
    all: ITEMS, order: ORDER, MAX_TOTAL: MAX_TOTAL, DROP_EVERY: DROP_EVERY,
    get: function (id) { return ITEMS[id]; },
    count: count, has: has, use: use,
    supply: supply, receive: receive, rollItem: rollItem
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
