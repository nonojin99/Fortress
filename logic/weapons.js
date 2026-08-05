/* logic/weapons.js — 무기 표.
   포트리스의 균형추는 데미지가 아니라 delay 다. 딜레이가 곧 "다음 내 차례가 언제 오는가"이므로
   120 데미지 한 방보다 60 데미지 두 방이 강할 수 있다. 그래서 모든 수치는 dmg/delay 비로 읽는다.
   기준선: 표준탄 dmg 42 / delay 88 → 0.477 dmg per delay. 이 값에서 크게 벗어나면 밸런스가 깨진 것이다.

   type  : 유도 | 범위 | 돌파 | 집중 | 표준   (기획 요구 4분류 + 기준선)
   kind  : main(무한 탄약) | sub(제한 탄약) | child(분열체, 직접 선택 불가)
   dmg   : 폭심 데미지. 반경 끝에서 25%까지 감쇠
   rad   : 폭발 반경 = 지형이 파이는 반경이기도 하다
   push  : 넉백 계수. 낙사 맵에서는 이 값이 dmg 보다 중요하다
   delay : 턴 딜레이. 낮을수록 자주 쏜다
   grav/wind: 중력·바람 배율. 1 이 표준 */
(function (root) {
  'use strict';

  function W(o) {
    o.kind = o.kind || 'main';
    o.type = o.type || '표준';
    o.rad = o.rad || 40; o.push = o.push == null ? 1 : o.push;
    o.grav = o.grav == null ? 1 : o.grav;
    o.wind = o.wind == null ? 1 : o.wind;
    o.speed = o.speed == null ? 1 : o.speed;
    o.shots = o.shots || 1; o.spread = o.spread || 0;
    return o;
  }

  var WEAPONS = {
    /* ── 레이븐 : 유도 ───────────────────────────────────────── */
    track: W({
      id: 'track', name: '추적탄', type: '유도', dmg: 51, rad: 47, push: 1.0, delay: 84,
      homing: { rate: 320, after: 0.40, range: 900, pull: 120 }, color: '#7FD4FF',
      desc: '착탄점을 120px까지 끌어당긴다. 그 이상 빗나간 발은 그대로 빗나간다 — 조준을 대신해 주지 않는다.'
    }),
    swarm: W({
      id: 'swarm', name: '군체 미사일', kind: 'sub', type: '유도', dmg: 27, rad: 34, push: 0.7,
      delay: 111, ammo: 4, shots: 3, spread: 9,
      homing: { rate: 350, after: 0.35, range: 900, pull: 110 }, color: '#9AE6FF',
      desc: '세 발이 각자 착탄점을 110px까지 당긴다. 넓게 흩뿌려도 한둘은 붙지만, 크게 빗나가면 셋 다 빗나간다.'
    }),

    /* ── 타이탄 : 집중 ───────────────────────────────────────── */
    slug: W({
      id: 'slug', name: '중포탄', type: '집중', dmg: 44, rad: 41, push: 1.3, delay: 114,
      color: '#FFB86B', desc: '무겁고 곧다. 바람을 조금 덜 탄다.', wind: 0.8, grav: 1.15
    }),
    breaker: W({
      id: 'breaker', name: '파쇄 관통탄', kind: 'sub', type: '집중', dmg: 33, rad: 30, push: 1.0,
      delay: 168, ammo: 3, shots: 2, spread: 2.6, pierceTanks: 2, wind: 0.75, grav: 1.15,
      color: '#FF8A3D',
      desc: '중포탄의 3분의 2 크기 탄을 두 발 연발한다. 둘 다 전차를 뚫고 지나가므로 일직선에 둘이 서면 넷을 때린다.'
    }),

    /* ── 볼케이노 : 범위 ─────────────────────────────────────── */
    /* 볼케이노는 '지금 아프게' 하는 게 아니라 '계속 아프게' 하는 전차다.
       burn 은 누적 겹수 — 맞은 전차는 자기 턴이 올 때마다 겹수×9 만큼 타고 한 겹씩 꺼진다. */
    spread: W({
      id: 'spread', name: '산탄', type: '범위', dmg: 16, rad: 33, push: 0.6, delay: 98,
      split: { at: 'apex', n: 3, spread: 22, child: 'spread_c' }, color: '#FF6B6B',
      desc: '정점에서 셋으로 갈라지고 각각 화염을 남긴다. 한 점을 못 뚫는 대신 오래 태운다.'
    }),
    spread_c: W({ id: 'spread_c', kind: 'child', name: '산탄 파편', dmg: 22, rad: 41, push: 0.7, burn: 1, color: '#FF6B6B' }),
    rain: W({
      id: 'rain', name: '소이 폭우', kind: 'sub', type: '범위', dmg: 8, rad: 24, push: 0.3,
      delay: 146, ammo: 4,
      /* 좌우로 넓게 흩뿌리면 제대로 조준해도 한 발밖에 안 닿는다 — 실제로 기본 무기보다 기대값이 낮았다.
         이제는 표적 바로 위에서 아래로 쏟아진다: 흩어지는 각을 14°로 좁히고 위로 던져 낙하시킨다.
         제대로 조준하면 다섯 발 중 두세 발이 닿고, 그만큼 화염이 겹친다. */
      split: { at: 'frac', frac: 0.86, n: 5, spread: 14, child: 'rain_c' }, color: '#FF9F45',
      desc: '표적 머리 위에서 다섯 발로 쏟아진다. 한 발당 피해는 5뿐이지만 화염이 한 겹씩 쌓인다 — 두세 발만 닿아도 이후 세 턴을 계속 태운다.'
    }),
    rain_c: W({ id: 'rain_c', kind: 'child', name: '소이탄', dmg: 5, rad: 35, push: 0.35, burn: 1, color: '#FF9F45' }),

    /* ── 드릴러 : 돌파 ───────────────────────────────────────── */
    bore: W({
      id: 'bore', name: '천공탄', type: '돌파', dmg: 38, rad: 41, push: 0.9, delay: 104,
      drill: 84, drillHits: 2, color: '#C9A227',
      desc: '지형에 박힌 뒤 파고들며 따닥 두 번 터진다. 피해는 절반씩 나뉘지만 구덩이는 두 개 생긴다 — 언덕을 뚫어 길을 낸다.'
    }),
    mole: W({
      id: 'mole', name: '지저 관통', kind: 'sub', type: '돌파', dmg: 32, rad: 54, push: 1.0,
      delay: 164, ammo: 3, shots: 2, spread: 3.2, drill: 280, drillHits: 2, color: '#E0B93A',
      desc: '두 발이 각각 암반을 파고들며 두 번씩 터진다 — 한 번 쏘면 구덩이 넷. 피해는 낮지만 발판을 통째로 들어낸다.'
    }),

    /* ── 스팅어 : 표준 저지연 ────────────────────────────────── */
    needle: W({
      id: 'needle', name: '침탄', type: '표준', dmg: 41, rad: 32, push: 0.8, delay: 64,
      speed: 1.12, color: '#B7F062', desc: '딜레이 64. 상대가 한 번 쏘는 동안 두 번 쏜다.'
    }),
    volley: W({
      id: 'volley', name: '연사 사격', kind: 'sub', type: '표준', dmg: 24, rad: 30, push: 0.5,
      delay: 122, ammo: 5, shots: 4, spread: 5, speed: 1.12, color: '#D4FF8A',
      desc: '네 발이 좁게 퍼진다. 좁은 발판 위의 상대에게 최소 둘은 닿는다.'
    }),

    /* ── 가디언 : 범위 / 넉백 ────────────────────────────────── */
    /* 가디언은 맞아 가며 땅을 깎는 전차다. 피해로 이기지 않고, 발판을 지워서 이긴다. */
    mortar: W({
      id: 'mortar', name: '곡사포', type: '범위', dmg: 25, rad: 76, push: 1.5, delay: 124,
      grav: 1.35, color: '#8FD98F',
      desc: '피해는 낮고 반경이 넓다. 상대를 죽이는 게 아니라 상대가 선 자리를 지우는 용도다.'
    }),
    bulwark: W({
      id: 'bulwark', name: '충격파', kind: 'sub', type: '범위', dmg: 22, rad: 112, push: 3.0,
      delay: 168, ammo: 4, grav: 1.2, color: '#6BE0C0',
      desc: '이 게임에서 가장 넓은 반경과 가장 센 넉백. 피해는 거의 없다시피 하지만 절벽 옆 상대는 이 한 방으로 끝난다.'
    }),

    /* ── 팬텀 : 유도 저지연 ──────────────────────────────────── */
    /* 팬텀은 같은 유도지만 레이븐과 반대 방향이다.
       레이븐은 '빗나가도 붙여 주는' 관용이고, 팬텀은 '안 빗나가면 보상하는' 정밀이다.
       streak: 같은 표적을 연속으로 맞힐수록 피해가 20%씩 늘고(최대 1.40배), 한 번 빗나가면 처음으로 돌아간다.
       그래서 유도 보정폭(pull)은 레이븐보다 오히려 좁게 잡는다 — 관용까지 주면 두 전차가 같아진다. */
    wisp: W({
      id: 'wisp', name: '유령탄', type: '유도', dmg: 24, rad: 35, push: 0.7, delay: 86,
      homing: { rate: 300, after: 0.3, range: 1000, pull: 70 }, grav: 0.8, streak: true,
      color: '#C79BFF',
      desc: '같은 표적을 연달아 맞힐수록 피해가 커진다(최대 1.40배). 한 번이라도 빗나가면 처음으로 돌아간다.'
    }),
    hunter: W({
      id: 'hunter', name: '추격자', kind: 'sub', type: '유도', dmg: 43, rad: 39, push: 1.1,
      delay: 166, ammo: 3, homing: { rate: 420, after: 0.25, range: 1200, pull: 120 },
      grav: 0.75, streak: true, color: '#A06BFF',
      desc: '유령탄으로 쌓아 둔 연속 명중을 그대로 이어받는다. 세 번째 명중이라면 이 한 방이 1.40배로 들어간다.'
    }),

    /* ── 크라켄 : 범위 다탄두 ────────────────────────────────── */
    /* 컨셉은 그대로 두고 수치만 내렸다. 착탄 분열은 모탄이 이미 맞은 뒤에 자탄이 더해지므로
       기대 피해가 다른 무기의 두 배 가까이 나왔다 — 퍼지는 무기가 단발 무기보다 세면 조준할 이유가 없다. */
    tentacle: W({
      id: 'tentacle', name: '촉수탄', type: '범위', dmg: 22, rad: 40, push: 0.9, delay: 104,
      split: { at: 'impact', n: 2, spread: 60, up: 260, child: 'tentacle_c' }, color: '#5FD3C7',
      desc: '착탄 지점에서 둘이 튀어 올라 좌우로 다시 떨어진다. 참호를 무시한다.'
    }),
    tentacle_c: W({ id: 'tentacle_c', kind: 'child', name: '촉수 파편', dmg: 13, rad: 34, push: 0.7, color: '#5FD3C7' }),
    maelstrom: W({
      id: 'maelstrom', name: '대와류', kind: 'sub', type: '범위', dmg: 8, rad: 24, push: 0.4,
      delay: 182, ammo: 3, split: { at: 'apex', n: 9, spread: 62, child: 'mael_c' }, color: '#3FB8C8',
      desc: '아홉 발. 맵 한 구간을 통째로 파낸다. 발판이 좁은 맵에서 반칙에 가깝다.'
    }),
    mael_c: W({ id: 'mael_c', kind: 'child', name: '와류 파편', dmg: 12, rad: 36, push: 0.6, color: '#3FB8C8' }),

    /* ── 노바 : 집중 직사 ────────────────────────────────────── */
    lance: W({
      id: 'lance', name: '광창', type: '집중', dmg: 44, rad: 32, push: 1.0, delay: 106,
      grav: 0.55, speed: 1.25, wind: 0.3, color: '#FFE27A',
      desc: '거의 직선으로 날아간다. 조준이 쉬운 대신 언덕을 못 넘는다.'
    }),
    novaburst: W({
      id: 'novaburst', name: '초신성', kind: 'sub', type: '집중', dmg: 88, rad: 50, push: 1.8,
      delay: 206, ammo: 2, grav: 0.6, speed: 1.2, wind: 0.3, selfPush: 1.4, color: '#FFF3B0',
      desc: '한 턴에 낼 수 있는 최대 단발 피해. 반동으로 자기 자신도 밀린다 — 절벽 앞에서 쏘지 마라.'
    }),

    /* ── 제피르 : 바람 특화 장거리 ───────────────────────────── */
    glide: W({
      id: 'glide', name: '활공탄', type: '표준', dmg: 38, rad: 40, push: 0.9, delay: 92,
      wind: 2.2, grav: 0.8, color: '#9FE8FF',
      desc: '바람을 두 배로 탄다. 순풍이면 맵 끝까지, 역풍이면 발밑에 떨어진다.'
    }),
    /* 제피르는 '한 턴 기를 모아 한 방'을 쏘는 전차다.
       처음엔 딜레이를 340으로 키워 흉내 냈는데, 그건 '쏘고 나서 오래 쉬는' 것이라 방향이 반대였다.
       지금은 첫 발사가 충전이고 다음 차례에 실제로 나간다 — 모으는 동안 맞으면 풀린다. */
    tempest: W({
      id: 'tempest', name: '폭풍탄', kind: 'sub', type: '집중', dmg: 108, rad: 56, push: 1.4,
      delay: 150, ammo: 2, chargeTurns: 1, wind: 3.0, grav: 0.8, color: '#7FC8E8',
      desc: '한 번 눌러 기를 모으고, 다음 차례에 눌러 쏜다. 가벼운 전차는 이 한 발로 끝난다 — 다만 모으는 동안 맞으면 힘이 풀린다.'
    }),
    tempest_c: W({ id: 'tempest_c', kind: 'child', name: '폭풍 파편', dmg: 22, rad: 44, push: 0.6, wind: 2.0, color: '#7FC8E8' }),

    /* ── 텔레포트탄 ────────────────────────────────────────────
       아이템으로만 나가는 특수탄. 그 턴의 공격을 대신한다.
       피해도 지형 파괴도 없다 — 오직 자기 자신을 떨어진 자리로 옮긴다.
       탄약을 쓰지 않는 대신 딜레이는 문다. 공짜 이동이 되면 낙사 압박이 사라진다. */
    warp: W({
      id: 'warp', name: '텔레포트탄', kind: 'special', type: '이동',
      dmg: 0, rad: 0, push: 0, delay: 85, grav: 0.95, color: '#C79BFF',
      desc: '탄이 떨어진 자리로 순간이동한다. 땅에 닿지 못하고 맵 밖으로 나가면 이송은 실패하고 아이템만 날아간다.'
    })
  };

  /* 다탄두는 전부 맞지 않는다. 표적 하나를 상대로 실제 꽂히는 비율.
     첫 발은 조준한 것이므로 1.0, 나머지는 흩어진 각도만큼 빗나간다.
     흩어짐 각도를 안 보면 14°로 쏟아붓는 소이 폭우와 62°로 흩뿌리는 대와류가 같은 값이 된다. */
  function hitFrac(w) {
    if (w.homing) return 0.5;
    var sp = w.split ? (w.split.spread || 0) : (w.spread || 0);
    if (sp <= 20) return 0.55;
    if (sp <= 40) return 0.35;
    return 0.22;
  }

  /* 지형을 파는 것 자체가 값이다 — 발판을 지워 낙사시키는 것이 이 게임의 두 승리 조건 중 하나다.
     이걸 안 세면 대와류·지저 관통처럼 '피해는 낮고 땅은 많이 파는' 무기가
     쓰레기로 집계된다. 기준 반경 40px 짜리 한 발을 6점으로 잡고 면적에 비례시킨다. */
  function digValue(w) {
    var child = w.split ? WEAPONS[w.split.child] : null;
    var r = child ? child.rad : w.rad;
    /* 자탄은 표적을 빗나가도 땅은 판다 — 그래서 여기서는 '명중 기대수'가 아니라 '전체 발수'를 쓴다.
       기대수로 세면 아홉 발을 흩뿌리는 대와류의 지형 파괴가 3분의 1로 과소평가된다. */
    var n = w.split ? (w.split.n || 1) : (w.shots || 1);
    n *= (w.drillHits || 1);          // 관통탄은 한 발이 여러 번 터진다 — 그만큼 더 판다
    if (!r) return 0;
    return (r / 40) * (r / 40) * n * 6;
  }

  root.TFWeapons = {
    all: WEAPONS,
    get: function (id) { return WEAPONS[id]; },
    hitFrac: hitFrac,

    /* 밸런스 감사용 실효값 = (기대 데미지 + 넉백 가치) / 딜레이.
       단순 dmg/delay 로 재면 아홉 발 뿌리는 대와류가 최강으로 나오고(전부 맞을 리가 없다),
       넉백 전용인 충격파가 최약으로 나온다(그 무기의 값은 데미지가 아니다). 둘 다 사실이 아니다.
       검증 스크립트는 이 값의 최대/최소 비를 본다. */
    value: function (id) {
      var w = WEAPONS[id];
      if (!w || !w.delay) return null;
      // 고를 수 없는 것은 밸런스 비교 대상이 아니다 — 자탄과 특수탄(텔레포트)이 그렇다.
      if (w.kind !== 'main' && w.kind !== 'sub') return null;
      var n = w.shots || 1;
      var f = hitFrac(w);
      var dmg = w.dmg * (1 + (n - 1) * f);
      var child = w.split ? WEAPONS[w.split.child] : null;
      var kids = 0;
      if (w.split) {
        var k = w.split.n || 1, cd = child ? child.dmg : 0;
        /* 정점·비행중 분열은 모탄이 터지지 않는다 — 자식만 센다.
           착탄 분열은 모탄이 이미 명중한 뒤 갈라지므로 모탄 전탄 + 자식 기대치를 더한다. */
        kids = w.split.at === 'impact' ? k * f : (1 + (k - 1) * f);
        dmg = w.split.at === 'impact' ? w.dmg + cd * kids : cd * kids;
      }

      /* 화염은 맞은 순간이 아니라 그 뒤 여러 턴에 걸쳐 들어온다.
         겹수 b 는 b, b-1, … 1 순으로 타므로 총 피해는 BURN_DMG × b(b+1)/2 다.
         이걸 안 세면 소이 폭우가 '피해 5짜리 쓰레기'로 집계된다. */
      var burnPer = (w.burn || 0) + (child ? (child.burn || 0) : 0);
      if (burnPer > 0) {
        var stacks = w.split ? Math.min(5, Math.round(kids * burnPer)) : burnPer;
        dmg += 9 * stacks * (stacks + 1) / 2;   // physics.js 의 BURN_DMG 와 같은 값
      }

      // 연속 명중은 평균적으로 두 번째 명중쯤에서 유지된다고 보고 1.3배로 잡는다
      if (w.streak) dmg *= 1.3;

      var push = (w.push || 0) * 20;          // 넉백 1.0 ≈ 데미지 20 의 가치로 환산
      /* 충전형은 쏘기까지 턴을 더 쓴다. 그 턴에는 아무 일도 못 하므로
         실질 딜레이는 충전 턴만큼 늘어난다 — 안 세면 폭풍탄이 최강 무기로 집계된다. */
      var eff = w.delay * (1 + (w.chargeTurns || 0) * 0.9);
      return (dmg + push + digValue(w)) / eff;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
