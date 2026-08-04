/* logic/tanks.js — 전차 10종.
   스탯은 서로를 상쇄하도록 짜여 있다. 높은 HP는 낮은 기동과 묶이고, 강한 한 방은 긴 딜레이와 묶인다. */
(function (root) {
  'use strict';

  var TANKS = [
    {
      id: 'raven', name: '레이븐', role: '표준',
      hp: 100, armor: 0.00, mass: 1.00, fuel: 100, climb: 16, power: 1.00, angle: [0, 88],
      main: 'shell', sub: 'cluster',
      note: '기준선. 모든 전차의 설계값이 이 전차를 기준으로 맞춰진다.',
      shape: { hull: [[-22, 0], [-20, -11], [0, -15], [18, -11], [22, -3], [22, 0]], barrel: [28, 6], pivot: [-1, -13], wheels: 5, skin: '#3A4A5C', trim: '#5AA9E6' }
    },
    {
      id: 'titan', name: '타이탄', role: '집중',
      hp: 118, armor: 0.10, mass: 1.28, fuel: 68, climb: 12, power: 0.94, angle: [0, 80],
      main: 'slug', sub: 'breaker',
      note: '느리고 단단하고 아프다. 자리를 잡으면 그 자리에서 이긴다. 대신 자리를 못 옮긴다.',
      shape: { hull: [[-26, 0], [-24, -14], [-8, -19], [16, -17], [26, -6], [26, 0]], barrel: [34, 8], pivot: [0, -16], wheels: 6, skin: '#6B4A2E', trim: '#FFB86B' }
    },
    {
      id: 'volcano', name: '볼케이노', role: '범위',
      hp: 106, armor: 0.05, mass: 1.06, fuel: 92, climb: 15, power: 1.00, angle: [8, 89],
      main: 'spread', sub: 'rain',
      note: '넓게 덮는다. 엄폐를 지우는 것이 본업이다.',
      shape: { hull: [[-23, 0], [-21, -12], [-2, -16], [18, -13], [23, -4], [23, 0]], barrel: [26, 7], pivot: [-2, -14], wheels: 5, skin: '#6B3030', trim: '#FF6B6B' }
    },
    {
      id: 'driller', name: '드릴러', role: '돌파',
      hp: 104, armor: 0.05, mass: 1.12, fuel: 90, climb: 20, power: 0.96, angle: [0, 84],
      main: 'bore', sub: 'mole',
      note: '단차 20px 까지 기어오른다. 지형을 뚫고 지형을 오른다 — 엄폐 무시형 돌파 전차.',
      shape: { hull: [[-24, 0], [-21, -13], [-4, -17], [20, -12], [24, -3], [24, 0]], barrel: [32, 10], pivot: [-1, -13], wheels: 6, skin: '#5E5326', trim: '#C9A227' }
    },
    {
      id: 'stinger', name: '스팅어', role: '저지연',
      hp: 86, armor: 0.00, mass: 0.80, fuel: 142, climb: 20, power: 1.06, angle: [0, 88],
      main: 'needle', sub: 'volley',
      note: '딜레이가 짧다. 상대가 한 번 쉴 때 두 번 쏜다.',
      shape: { hull: [[-19, 0], [-17, -9], [12, -12], [19, -4], [19, 0]], barrel: [28, 4], pivot: [1, -11], wheels: 4, skin: '#3F5E33', trim: '#B7F062' }
    },
    {
      id: 'guardian', name: '가디언', role: '방어',
      hp: 148, armor: 0.22, mass: 1.55, fuel: 58, climb: 11, power: 0.92, angle: [16, 89],
      main: 'mortar', sub: 'bulwark',
      note: '최저각 16° — 가까이 붙은 상대를 못 쏜다. 대신 절벽 옆에서는 충격파 한 방이 곧 승리다.',
      shape: { hull: [[-27, 0], [-26, -15], [-10, -21], [14, -19], [27, -7], [27, 0]], barrel: [24, 11], pivot: [-4, -18], wheels: 6, skin: '#2F5449', trim: '#6BE0C0' }
    },
    {
      id: 'phantom', name: '팬텀', role: '유도',
      hp: 108, armor: 0.04, mass: 0.90, fuel: 132, climb: 22, power: 1.04, angle: [0, 89],
      main: 'wisp', sub: 'hunter',
      note: '가장 잘 휘는 탄과 가장 잘 도망가는 차체. 유도 보정과 저지연으로 꾸준히 깎는다.',
      shape: { hull: [[-20, 0], [-18, -10], [-2, -15], [14, -12], [20, -3], [20, 0]], barrel: [27, 5], pivot: [-1, -13], wheels: 5, skin: '#4A3A66', trim: '#C79BFF' }
    },
    {
      id: 'kraken', name: '크라켄', role: '범위',
      hp: 112, armor: 0.07, mass: 1.14, fuel: 88, climb: 18, power: 0.99, angle: [6, 89],
      main: 'tentacle', sub: 'maelstrom',
      note: '착탄점에서 다시 튀는 탄. 참호를 파고 숨는 상대에게 유일하게 유효하다.',
      shape: { hull: [[-24, 0], [-22, -12], [-6, -18], [16, -15], [24, -4], [24, 0]], barrel: [25, 8], pivot: [-3, -16], wheels: 5, skin: '#26555C', trim: '#5FD3C7' }
    },
    {
      id: 'nova', name: '노바', role: '집중',
      hp: 96, armor: 0.03, mass: 0.94, fuel: 96, climb: 16, power: 1.10, angle: [0, 72],
      main: 'lance', sub: 'novaburst',
      note: '최대각 72° — 언덕 너머를 못 친다. 시야가 트인 자리에서만 이 전차는 최강이다.',
      shape: { hull: [[-21, 0], [-19, -10], [2, -16], [18, -11], [21, -3], [21, 0]], barrel: [36, 5], pivot: [-2, -13], wheels: 5, skin: '#6B5A22', trim: '#FFE27A' }
    },
    {
      id: 'zephyr', name: '제피르', role: '장거리',
      hp: 88, armor: 0.00, mass: 0.74, fuel: 124, climb: 20, power: 1.08, angle: [0, 89],
      main: 'glide', sub: 'tempest',
      note: '바람이 곧 사거리다. 순풍 맵에서는 맵 반대편까지 닿고, 역풍에서는 아무것도 못 한다.',
      shape: { hull: [[-20, 0], [-18, -9], [-4, -14], [14, -11], [20, -3], [20, 0]], barrel: [30, 4], pivot: [-2, -12], wheels: 4, skin: '#2E5866', trim: '#9FE8FF' }
    }
  ];

  var byId = {};
  for (var i = 0; i < TANKS.length; i++) byId[TANKS[i].id] = TANKS[i];

  root.TFTanks = {
    list: TANKS,
    get: function (id) { return byId[id] || TANKS[0]; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
