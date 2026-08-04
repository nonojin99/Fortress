/* logic/tanks.js — 전차 10종.
   스탯은 서로를 상쇄하도록 짰다. 체력이 높으면 이동력이 낮고, 유도를 가지면 단발이 약하다.
   armor 는 감쇠율(0.20 이면 20% 경감), mass 는 넉백 저항 — 낙사 맵에서 armor 보다 mass 가 더 중요하다.

   angle : 포신이 낼 수 있는 각도 범위(도). 직사형은 높은 각을 못 준다 = 언덕을 못 넘는다.
   fuel  : 한 턴에 쓸 수 있는 이동량. 1 fuel ≈ 1px 수평 이동
   climb : 넘을 수 있는 단차(px). 이걸 넘으면 벽으로 막힌다
   power : 같은 게이지에서 나가는 초속 배율

   shape 는 벡터 폴백용이다. art.js 가 로드되면 스프라이트가 이 자리를 대신하고,
   없으면 게임은 아무 말 없이 벡터로 계속 돈다. (character-chess 와 같은 규약) */
(function (root) {
  'use strict';

  /* 전차 크기 배율.
     원작은 800×600 화면이었고 우리는 1280×720이다. 같은 픽셀 크기로 두면
     화면에서 차지하는 비율이 원작의 절반 남짓으로 줄어 전차가 '멀리 있는 점'처럼 보인다.
     계산: 가디언 54px ÷ 1280 = 4.2%. 원작에서 탱크가 45~55px 였다면 800px 기준 5.6~6.9%.
     그 비율을 1280px 에서 맞추려면 약 1.8~2.0배가 필요하다.

     이 값을 올리면 피격 판정도 같이 커진다 — 맞히기 쉬워지고 판이 짧아진다.
     그래서 시각 크기만 키우지 않고 물리 히트박스와 함께 움직인다. 한 곳에서만 고친다. */
  var SCALE = 2.0;

  function scaleShape(s) {
    return {
      hull: s.hull.map(function (p) { return [p[0] * SCALE, p[1] * SCALE]; }),
      barrel: [s.barrel[0] * SCALE, s.barrel[1] * SCALE],
      pivot: [s.pivot[0] * SCALE, s.pivot[1] * SCALE],
      wheels: s.wheels, skin: s.skin, trim: s.trim
    };
  }

  var TANKS = [
    {
      id: 'raven', name: '레이븐', role: '유도',
      hp: 82, armor: 0.00, mass: 1.00, fuel: 100, climb: 16, power: 1.00, angle: [0, 88],
      main: 'track', sub: 'swarm',
      note: '표준 체격에 유도를 얹었다. 조준이 서툴러도 맞는 대신, 한 방으로 끝내지 못한다.',
      shape: { hull: [[-22, 0], [-18, -11], [14, -13], [22, -4], [22, 0]], barrel: [30, 5], pivot: [2, -12], wheels: 5, skin: '#3E5C74', trim: '#7FD4FF' }
    },
    {
      id: 'titan', name: '타이탄', role: '집중',
      hp: 86, armor: 0.05, mass: 1.30, fuel: 68, climb: 12, power: 0.96, angle: [0, 80],
      main: 'slug', sub: 'breaker',
      note: '느리고 단단하고 아프다. 자리를 잡으면 그 자리에서 이긴다. 대신 자리를 못 옮긴다.',
      shape: { hull: [[-26, 0], [-24, -14], [-8, -19], [16, -17], [26, -6], [26, 0]], barrel: [34, 8], pivot: [0, -16], wheels: 6, skin: '#6B4A2E', trim: '#FFB86B' }
    },
    {
      id: 'volcano', name: '볼케이노', role: '범위',
      hp: 80, armor: 0.05, mass: 1.06, fuel: 92, climb: 15, power: 1.00, angle: [8, 89],
      main: 'spread', sub: 'rain',
      note: '한 점을 못 뚫는다. 대신 넓게 덮어 엄폐를 지우고 상대를 열린 곳으로 몰아낸다.',
      shape: { hull: [[-23, 0], [-20, -12], [-2, -18], [18, -14], [23, -3], [23, 0]], barrel: [26, 9], pivot: [-2, -15], wheels: 5, skin: '#7A3630', trim: '#FF6B6B' }
    },
    {
      id: 'driller', name: '드릴러', role: '돌파',
      hp: 82, armor: 0.06, mass: 1.18, fuel: 96, climb: 26, power: 0.98, angle: [0, 84],
      main: 'bore', sub: 'mole',
      note: '단차 26px 까지 기어오른다. 지형을 뚫고 지형을 오른다 — 엄폐가 의미 없는 유일한 전차.',
      shape: { hull: [[-24, 0], [-21, -13], [-4, -17], [20, -12], [24, -3], [24, 0]], barrel: [32, 10], pivot: [-1, -13], wheels: 6, skin: '#5E5326', trim: '#C9A227' }
    },
    {
      id: 'stinger', name: '스팅어', role: '속사',
      hp: 76, armor: 0.00, mass: 0.80, fuel: 142, climb: 20, power: 1.06, angle: [0, 88],
      main: 'needle', sub: 'volley',
      note: '딜레이 64 — 이 게임에서 가장 자주 쏜다. 종잇장 같은 체력을 이동력으로 메운다.',
      shape: { hull: [[-19, 0], [-17, -9], [12, -12], [19, -4], [19, 0]], barrel: [28, 4], pivot: [1, -11], wheels: 4, skin: '#3F5E33', trim: '#B7F062' }
    },
    {
      id: 'guardian', name: '가디언', role: '방어',
      hp: 116, armor: 0.17, mass: 1.55, fuel: 58, climb: 11, power: 0.92, angle: [16, 89],
      main: 'mortar', sub: 'bulwark',
      note: '최저각 16° — 가까이 붙은 상대를 못 쏜다. 대신 절벽 옆에서는 충격파 한 방이 곧 승리다.',
      shape: { hull: [[-27, 0], [-26, -15], [-10, -21], [14, -19], [27, -7], [27, 0]], barrel: [24, 11], pivot: [-4, -18], wheels: 6, skin: '#2F5449', trim: '#6BE0C0' }
    },
    {
      id: 'phantom', name: '팬텀', role: '유도',
      hp: 76, armor: 0.00, mass: 0.86, fuel: 132, climb: 22, power: 1.02, angle: [0, 89],
      main: 'wisp', sub: 'hunter',
      note: '가장 잘 휘는 탄과 가장 잘 도망가는 차체. 정면 화력이 없어 장기전으로 끌어야 한다.',
      shape: { hull: [[-20, 0], [-18, -10], [-2, -15], [14, -12], [20, -3], [20, 0]], barrel: [27, 5], pivot: [-1, -13], wheels: 5, skin: '#4A3A66', trim: '#C79BFF' }
    },
    {
      id: 'kraken', name: '크라켄', role: '범위',
      hp: 84, armor: 0.07, mass: 1.14, fuel: 88, climb: 18, power: 0.99, angle: [6, 89],
      main: 'tentacle', sub: 'maelstrom',
      note: '착탄점에서 다시 튀는 탄. 참호를 파고 숨는 상대에게 유일하게 유효하다.',
      shape: { hull: [[-24, 0], [-22, -12], [-6, -18], [16, -15], [24, -4], [24, 0]], barrel: [25, 8], pivot: [-3, -16], wheels: 5, skin: '#26555C', trim: '#5FD3C7' }
    },
    {
      id: 'nova', name: '노바', role: '집중',
      hp: 80, armor: 0.03, mass: 0.94, fuel: 96, climb: 16, power: 1.10, angle: [0, 72],
      main: 'lance', sub: 'novaburst',
      note: '최대각 72° — 언덕 너머를 못 친다. 시야가 트인 자리에서만 이 전차는 최강이다.',
      shape: { hull: [[-21, 0], [-19, -10], [2, -16], [18, -11], [21, -3], [21, 0]], barrel: [36, 5], pivot: [-2, -13], wheels: 5, skin: '#6B5A22', trim: '#FFE27A' }
    },
    {
      id: 'zephyr', name: '제피르', role: '장거리',
      hp: 74, armor: 0.00, mass: 0.74, fuel: 124, climb: 20, power: 1.08, angle: [0, 89],
      main: 'glide', sub: 'tempest',
      note: '바람이 곧 사거리다. 순풍 맵에서는 맵 반대편까지 닿고, 역풍에서는 아무것도 못 한다.',
      shape: { hull: [[-20, 0], [-18, -9], [-4, -14], [14, -11], [20, -3], [20, 0]], barrel: [30, 4], pivot: [-2, -12], wheels: 4, skin: '#2E5866', trim: '#9FE8FF' }
    }
  ];

  /* 표는 배율 1 기준으로 적고, 여기서 한 번에 키운다.
     각 항목에 큰 수를 직접 적으면 나중에 배율을 바꿀 때 열 군데를 손대야 하고,
     그러다 한 대만 빠뜨리면 폭 위계가 조용히 어긋난다. */
  for (var s = 0; s < TANKS.length; s++) {
    TANKS[s].shape = scaleShape(TANKS[s].shape);
    TANKS[s].climb = Math.round(TANKS[s].climb * SCALE);   // 커진 만큼 넘을 수 있는 단차도 커진다
  }

  var byId = {};
  for (var i = 0; i < TANKS.length; i++) byId[TANKS[i].id] = TANKS[i];

  root.TFTanks = {
    list: TANKS,
    SCALE: SCALE,
    get: function (id) { return byId[id] || TANKS[0]; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
