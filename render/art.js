/* render/art.js — 스프라이트가 있으면 얹고, 없으면 아무 일도 하지 않는다.
   아트는 게임의 전제가 아니라 덧칠이다. 파일이 없어도, 로드에 실패해도, 반만 들어와도
   게임은 조용히 벡터 전차로 계속 돈다. 콘솔에 경고 한 줄 남기지 않는다.

   붙이는 규약:
     window.TFArtSrc = {
       tanks: { raven: "data:image/png;base64,...", ... },
       maps:  { ridge: "data:image/jpeg;base64,...", ... },  // 원경 배경 (선택)
       weapons: { ... }
     }
   build.py 는 art/art.js 가 있으면 이 파일보다 먼저 인라인한다.

   ⚠ 전차 스프라이트에 포신을 그리면 안 된다. 포신은 render/draw.js 가 따로 그린다. */
(function (root) {
  'use strict';

  var art = { tanks: {}, weapons: {}, maps: {}, ready: 0, total: 0 };
  var src = root.TFArtSrc;

  function load(bag, id, s) {
    if (typeof s !== 'string' || s.length < 32) return;
    art.total++;
    var im = new Image();
    im.onload = function () { art.ready++; bag[id] = im; };
    im.onerror = function () { delete bag[id]; };
    im.src = s;
  }

  if (src && typeof Image !== 'undefined') {
    var tanks = src.tanks || src;
    var weapons = src.weapons || {};
    var maps = src.maps || {};
    for (var a in tanks) if (Object.prototype.hasOwnProperty.call(tanks, a)) load(art.tanks, a, tanks[a]);
    for (var b in weapons) if (Object.prototype.hasOwnProperty.call(weapons, b)) load(art.weapons, b, weapons[b]);
    for (var c in maps) if (Object.prototype.hasOwnProperty.call(maps, c)) load(art.maps, c, maps[c]);
  }

  root.TFArt = art;
})(typeof globalThis !== 'undefined' ? globalThis : this);
