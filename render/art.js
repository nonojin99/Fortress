/* render/art.js — 스프라이트가 있으면 얹고, 없으면 아무 일도 하지 않는다.
   window.TFArtSrc = { tanks: {...}, maps: {...} } */
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
