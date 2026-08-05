/* render/app.js — 화면·입력·루프. 규칙은 한 줄도 여기 없다.
   승패를 정하는 것은 전부 logic/ 아래에 있고, 이 파일은 그것을 보여 주고 명령을 넣을 뿐이다.
   그래서 sim/test.js 가 통과한 판은 여기서도 같은 결과가 나온다. */
(function (root, doc) {
  'use strict';
  var C = root.TFCore, MAPS = root.TFMaps, TANKS = root.TFTanks, WPN = root.TFWeapons,
    PH = root.TFPhysics, MT = root.TFMatch, AI = root.TFAI, DRAW = root.TFDraw, FXM = root.TFFX;

  var VIEW = { w: 1280, h: 720 };
  var TEAM_COLORS = ['#5AA9E6', '#E6705A', '#7ED957', '#C79BFF'];
  var $ = function (id) { return doc.getElementById(id); };

  var cfg = {
    mode: 'solo', play: 'ai', ai: 1, mapId: 'random',
    picks: ['raven', 'titan', 'volcano', 'driller'], slot: 0
  };

  var G = {
    match: null, scene: null, fx: null, cam: { x: 0, y: 0 },
    ctx: null, raf: 0, last: 0, time: 0,
    charging: false, power: 0, held: {}, ai: null,
    seats: [], room: null, isHost: false, online: false,
    ended: false, toastT: 0,
    /* 마우스/터치 드래그로 맵을 탐색한다. 드래그 중에는 자동 추종을 끈다. */
    drag: null,
    camFollow: true,
    camFollowT: 0,
    /* 전차별로 '지난 턴에 채웠던 게이지'. 게이지 위 화살표가 이걸 가리킨다. */
    lastPower: {},
    mySeat: 0
  };

  /* ── 메뉴 ─────────────────────────────────────────────────── */

  /* 싱글과 온라인을 한 줄에 섞어 두면, 온라인을 고른 뒤에도 'AI 실력' 칩이 계속 보인다.
     고르는 축이 다르므로 칸을 나눈다 — 위 칸은 혼자 도는 판, 아래 칸은 방을 여는 판. */
  var SOLO_OPTS = [
    { mode: 'solo', play: 'ai', label: '1 : 1  vs 컴퓨터' },
    { mode: 'solo', play: 'local', label: '1 : 1  한 화면' },
    { mode: 'duo', play: 'ai', label: '2 : 2  팀전' },
    { mode: 'ffa', play: 'ai', label: '1 : 1 : 1 : 1  난전' }
  ];
  var ONLINE_OPTS = [
    { mode: 'solo', label: '1 : 1' },
    { mode: 'duo', label: '2 : 2  팀전' },
    { mode: 'ffa', label: '1 : 1 : 1 : 1  난전' }
  ];

  function seatCount() { return MT.MODES[cfg.mode].n; }
  function isOnline() { return cfg.play === 'online'; }

  function chip(label, pressed, onClick, disabled) {
    var b = doc.createElement('button');
    b.className = 'chip'; b.textContent = label;
    b.setAttribute('aria-pressed', String(!!pressed));
    b.disabled = !!disabled;
    if (disabled) { b.style.opacity = '.4'; b.style.cursor = 'not-allowed'; }
    b.onclick = onClick;
    return b;
  }

  function buildMenu() {
    var mr = $('modeRow');
    mr.innerHTML = '';
    SOLO_OPTS.forEach(function (o) {
      mr.appendChild(chip(o.label, !isOnline() && cfg.mode === o.mode && cfg.play === o.play, function () {
        if (G.room) leaveRoom();
        cfg.mode = o.mode; cfg.play = o.play; cfg.slot = 0;
        buildMenu();
      }));
    });

    var ar = $('aiRow');
    ar.innerHTML = '<span class="note" style="align-self:center;margin-right:4px">컴퓨터 실력</span>';
    AI.LEVELS.forEach(function (L, i) {
      ar.appendChild(chip(L.name, cfg.ai === i, function () { cfg.ai = i; buildMenu(); }));
    });
    ar.style.display = (!isOnline() && cfg.play === 'ai') ? '' : 'none';

    /* 온라인 모드는 방 정원을 바꾼다. 이미 사람이 들어와 있는 방에서는 호스트만 바꿀 수 있고,
       게스트가 바꾸면 자기 화면만 다른 모드가 되어 시작하는 순간 갈린다. */
    var nr = $('netModeRow');
    nr.innerHTML = '';
    var lockedForGuest = !!(G.room && !G.isHost);
    ONLINE_OPTS.forEach(function (o) {
      nr.appendChild(chip(o.label, isOnline() && cfg.mode === o.mode, function () {
        cfg.mode = o.mode; cfg.play = 'online'; cfg.slot = 0;
        if (G.room && G.isHost) G.room.setMode(o.mode, MT.MODES[o.mode].n);
        buildMenu();
      }, lockedForGuest));
    });

    $('soloCard').classList.toggle('picked', !isOnline());
    $('onlineCard').classList.toggle('picked', isOnline());
    $('btnLeave').style.display = G.room ? '' : 'none';

    if (!$('tankGrid').childElementCount) buildTanks();
    if (!$('mapGrid').childElementCount) buildMaps();
    buildSlots();
    buildLobby();
    markPicks();
    $('startNote').textContent = isOnline()
      ? (G.room
        ? (G.room.full()
          ? (G.isHost ? '정원이 찼다. 전투 개시를 누르면 전원이 같이 시작한다.' : '호스트가 시작하기를 기다린다.')
          : ('참가자 ' + G.room.peers.length + ' / ' + seatCount() + ' — 아직 자리가 빈다.'))
        : '방을 만들거나 코드를 넣고 참가한다.')
      : MT.MODES[cfg.mode].label + ' · ' + (cfg.play === 'local' ? '한 기기에서 번갈아' : '컴퓨터 ' + AI.LEVELS[cfg.ai].name);
  }

  /* 온라인에서 내 자리는 호스트가 정한다 — 아무 자리나 눌러 남의 전차를 고를 수 없다. */
  function mySeatIndex() {
    if (!isOnline()) return cfg.slot;
    return G.room ? Math.max(0, G.room.seat()) : 0;
  }

  function buildSlots() {
    var sr = $('slotRow'); sr.innerHTML = '';
    var n = seatCount(), mine = mySeatIndex();
    if (isOnline()) cfg.slot = mine;
    var label = doc.createElement('span');
    label.className = 'note'; label.style.alignSelf = 'center'; label.style.marginRight = '4px';
    label.textContent = isOnline() ? '내 자리의 전차만 고를 수 있다'
      : (n > 1 ? '자리를 고르고 전차를 누른다' : '');
    sr.appendChild(label);
    for (var i = 0; i < n; i++) (function (i) {
      var t = MT.MODES[cfg.mode].teams[i];
      var who = cfg.play === 'local' ? ('P' + (i + 1))
        : (isOnline() ? (i === mine ? '나' : ('P' + (i + 1)))
          : (i === 0 ? '나' : (cfg.mode === 'duo' && t === 0 ? '아군 AI' : 'AI')));
      var b = doc.createElement('button');
      b.className = 'chip';
      b.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' +
        TEAM_COLORS[t] + ';margin-right:6px"></span>' + who + ' · ' + pickName(i);
      b.setAttribute('aria-pressed', String(cfg.slot === i));
      b.disabled = isOnline() && i !== mine;
      b.onclick = function () { cfg.slot = i; buildMenu(); };
      sr.appendChild(b);
    })(i);
  }

  /* 온라인에서 남의 자리는 방이 알려 준 것만 쓴다.
     cfg.picks 로 흘러가면 아직 아무도 안 고른 자리에 내 로컬 기본값(볼케이노·드릴러)이 뜨고,
     상대가 그 전차를 고른 줄 알고 카운터를 맞추게 된다. */
  function pickName(i) {
    var p;
    if (isOnline()) p = (G.room && G.room.picks[i]) || (i === mySeatIndex() ? cfg.picks[i] : null);
    else p = cfg.picks[i];
    return !p || p === 'random' ? '랜덤' : TANKS.get(p).name;
  }

  /* 로비 — 누가 어느 자리에 앉았고 무엇을 골랐는지. 정원이 차야 시작할 수 있다. */
  function buildLobby() {
    var host = $('lobby');
    host.innerHTML = '';
    if (!isOnline() || !G.room) return;
    var n = seatCount(), mine = G.room.seat();
    for (var i = 0; i < n; i++) {
      var taken = i < G.room.peers.length;
      var d = doc.createElement('div');
      d.className = 'seat' + (i === mine ? ' me' : '') + (taken ? '' : ' empty');
      d.innerHTML = '<span class="dot" style="background:' + TEAM_COLORS[MT.MODES[cfg.mode].teams[i]] + '"></span>' +
        '<span class="who">' + (i === mine ? '나' : (i === 0 ? '호스트' : 'P' + (i + 1))) + '</span>' +
        '<span class="tk">' + (taken ? pickName(i) : '빈자리') + '</span>';
      host.appendChild(d);
    }
  }

  /* 전차 선택 한 곳. 온라인이면 내 자리에만 쓰고, 그 사실을 방에 알린다 —
     알리지 않으면 호스트가 내 선택을 모른 채 판을 시작해 내가 안 고른 전차로 싸우게 된다. */
  function choosePick(id) {
    var i = mySeatIndex();
    cfg.picks[i] = id;
    if (isOnline() && G.room) G.room.pick(id);
    buildMenu();
  }

  /* 'random' 은 전차 id 가 아니라 자리표시자다. 판을 시작할 때 실제 전차로 바뀌고,
     온라인이면 그 결과를 상대에게 보낸다 — 양쪽이 각자 뽑으면 서로 다른 전차로 싸우게 된다. */
  function resolvePicks(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var p = cfg.picks[i];
      out.push(p === 'random' ? TANKS.list[(Math.random() * TANKS.list.length) | 0].id : p);
    }
    return out;
  }

  function buildTanks() {
    var g = $('tankGrid'); g.innerHTML = '';

    var rb = doc.createElement('button');
    rb.className = 'tank'; rb.dataset.id = 'random';
    rb.innerHTML = '<div class="nm"><span style="width:9px;height:9px;border-radius:2px;background:var(--brass)"></span>랜덤</div>' +
      '<div class="rl">매 판 다른 전차</div>' +
      '<canvas width="320" height="92"></canvas>' +
      '<div class="st"><span>10종 중 하나</span></div>' +
      '<div class="wp">고르기 어려울 때. 시작할 때 정해진다.</div>';
    rb.title = '판을 시작할 때 10종 중 하나로 정해진다';
    rb.onclick = function () { choosePick('random'); };
    g.appendChild(rb);
    (function (cv) {
      var x = cv.getContext('2d');
      x.fillStyle = '#C9A227'; x.font = '700 40px system-ui'; x.textAlign = 'center';
      x.fillText('?', cv.width / 2, cv.height / 2 + 16);
    })(rb.querySelector('canvas'));

    TANKS.list.forEach(function (t) {
      var main = WPN.get(t.main), sub = WPN.get(t.sub);
      var b = doc.createElement('button');
      b.className = 'tank'; b.dataset.id = t.id;
      b.innerHTML =
        '<div class="nm"><span style="width:9px;height:9px;border-radius:2px;background:' + t.shape.trim + '"></span>' + t.name + '</div>' +
        '<div class="rl">' + t.role + '</div>' +
        '<canvas width="320" height="92"></canvas>' +
        '<div class="st"><span>HP ' + t.hp + '</span><span>장갑 ' + Math.round(t.armor * 100) + '%</span>' +
        '<span>연료 ' + t.fuel + '</span><span>각 ' + t.angle[0] + '~' + t.angle[1] + '°</span></div>' +
        '<div class="wp"><b>' + main.name + '</b> <span style="color:var(--brass)">' + main.type + '</span> ' + main.dmg + '/딜' + main.delay + '<br>' +
        '<b>' + sub.name + '</b> <span style="color:var(--brass)">' + sub.type + '</span> ' + sub.dmg + '×' + sub.ammo + '발</div>';
      b.title = t.note;
      b.onclick = function () { choosePick(t.id); };
      g.appendChild(b);
      drawTankPreview(b.querySelector('canvas'), t);
    });
  }

  function drawTankPreview(cv, def) {
    var x = cv.getContext('2d');
    x.clearRect(0, 0, cv.width, cv.height);
    // 전차 표가 이미 커졌으므로 미리보기에서 또 키우면 카드 밖으로 넘친다
    x.save(); x.translate(cv.width / 2, cv.height - 12); x.scale(1, 1);
    var fake = { x: 0, y: 0, def: def, defId: def.id, dir: 1, tilt: 0, angle: 38, hp: 1, hpMax: 1, dead: false };
    DRAW.drawTank(x, fake, { bar: false });
    x.restore();
  }

  var thumbQueue = [];
  function buildMaps() {
    var g = $('mapGrid'); g.innerHTML = '';
    var opts = [{ id: 'random', name: '랜덤', note: '매 판 다른 전장' }].concat(MAPS.list);
    opts.forEach(function (m) {
      var b = doc.createElement('button');
      b.className = 'mapc'; b.dataset.id = m.id;
      b.innerHTML = '<canvas width="300" height="128"></canvas><div class="mi"><div class="mn">' + m.name +
        '</div><div class="mm">' + (m.id === 'random' ? '— ' : ('중력 ' + m.gravity + ' · 바람 ±' + m.wind)) + '</div></div>';
      b.title = m.note;
      b.onclick = function () { cfg.mapId = m.id; markPicks(); };
      g.appendChild(b);
      if (m.id === 'random') drawRandomThumb(b.querySelector('canvas'));
      else thumbQueue.push({ cv: b.querySelector('canvas'), map: m });
    });
    pumpThumbs();
  }

  function drawRandomThumb(cv) {
    var x = cv.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, cv.height);
    g.addColorStop(0, '#1A2330'); g.addColorStop(1, '#0D1219');
    x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#C9A227'; x.font = '700 34px system-ui'; x.textAlign = 'center';
    x.fillText('?', cv.width / 2, cv.height / 2 + 12);
  }

  /* 축소 지형을 한 프레임에 하나씩 만든다. 열 개를 한 번에 하면 메뉴가 통째로 멈춘다. */
  function pumpThumbs() {
    if (!thumbQueue.length) return;
    var job = thumbQueue.shift();
    try {
      var m = job.map, k = 0.22;
      var tr = root.TFTerrain.build(MAPS.thumbSpec(m, k), 99);
      var cv = job.cv, x = cv.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, cv.height);
      g.addColorStop(0, m.sky[0]); g.addColorStop(1, m.sky[2]);
      x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
      var sx = cv.width / tr.w, sy = cv.height / tr.h;
      x.fillStyle = m.pal[2];
      for (var col = 0; col < tr.w; col++) {
        var y0 = -1;
        for (var row = 0; row < tr.h; row++) {
          var solid = tr.mask[row * tr.w + col] !== 0;
          if (solid && y0 < 0) y0 = row;
          else if (!solid && y0 >= 0) { x.fillRect(col * sx, y0 * sy, Math.ceil(sx), (row - y0) * sy); y0 = -1; }
        }
        if (y0 >= 0) x.fillRect(col * sx, y0 * sy, Math.ceil(sx), (tr.h - y0) * sy);
      }
      x.fillStyle = m.pal[1];
      for (var c2 = 0; c2 < tr.w; c2++) {
        var t2 = tr.colTop[c2];
        if (t2 < tr.h) x.fillRect(c2 * sx, t2 * sy, Math.ceil(sx), 3);
      }
    } catch (e) { /* 썸네일 실패는 게임을 막지 않는다 */ }
    requestAnimationFrame(pumpThumbs);
  }

  function markPicks() {
    var g = $('tankGrid').children;
    for (var i = 0; i < g.length; i++)
      g[i].setAttribute('aria-pressed', String(g[i].dataset.id === cfg.picks[cfg.slot]));
    var mg = $('mapGrid').children;
    for (var j = 0; j < mg.length; j++)
      mg[j].setAttribute('aria-pressed', String(mg[j].dataset.id === cfg.mapId));
  }

  /* ── 전투 시작 ────────────────────────────────────────────── */

  function makeRoster(seed) {
    var n = seatCount(), teams = MT.MODES[cfg.mode].teams, out = [];
    for (var i = 0; i < n; i++) {
      /* 온라인에서는 자리가 전부 사람이다. 사람이 덜 찼으면 애초에 시작할 수 없으므로
         빈자리를 AI 로 메우지 않는다 — 그러면 클라이언트마다 AI 가 따로 굴러 판이 갈린다. */
      var isMe = cfg.play === 'local' ? true
        : (isOnline() ? i === G.mySeat : i === 0);
      out.push({
        tank: cfg.picks[i], ai: !isMe && !isOnline(), aiLevel: cfg.ai,
        team: teams[i],
        label: TANKS.get(cfg.picks[i]).name
      });
    }
    return out;
  }

  function start(shared) {
    var seed = shared ? shared.seed : ((Math.random() * 0x7FFFFFFF) | 0);
    var mapId = shared ? shared.mapId : (cfg.mapId === 'random' ? MAPS.list[(Math.random() * MAPS.list.length) | 0].id : cfg.mapId);
    if (shared) { cfg.mode = shared.mode; cfg.picks = shared.picks.slice(); }

    /* 내 자리는 호스트가 확정한 자리표에서 읽는다. 여기서 한 번 고정해 두면
       판이 도는 동안 자리표가 바뀌어도(누가 나가도) 조종 대상이 흔들리지 않는다. */
    G.mySeat = isOnline() && G.room ? Math.max(0, G.room.seat()) : 0;

    /* 호스트는 각자가 고른 전차를 자리표에서 모아 온다. 안 고른 자리는 랜덤으로 남는다. */
    if (isOnline() && G.isHost && G.room) {
      for (var qi = 0; qi < seatCount(); qi++) cfg.picks[qi] = G.room.picks[qi] || 'random';
    }

    /* 랜덤 선택을 여기서 확정한다. shared 가 있으면 호스트가 이미 정한 것을 그대로 쓴다. */
    var picks = shared ? shared.picks.slice() : resolvePicks(seatCount());
    for (var pi = 0; pi < picks.length; pi++) cfg.picks[pi] = picks[pi];

    var roster = makeRoster(seed);
    G.match = new MT.Match({ mapId: mapId, seed: seed, mode: cfg.mode, roster: roster });
    G.scene = new DRAW.Scene(G.match.world, G.match.map);
    G.fx = new FXM.FX();
    G.ai = null; G.charging = false; G.power = 0; G.ended = false;
    G.lastPower = {};
    G.seats = [];
    for (var i = 0; i < roster.length; i++) if (!roster[i].ai) G.seats.push(i);
    if (isOnline()) G.seats = [G.mySeat];

    var a = G.match.actor();
    G.cam.x = C.clamp(a.x - VIEW.w / 2, 0, G.match.map.w - VIEW.w);
    G.cam.y = C.clamp(a.y - VIEW.h * 0.55, 0, Math.max(0, G.match.map.h - VIEW.h));

    $('menu').style.display = 'none';
    $('battle').style.display = 'block';
    $('overlay').classList.remove('on');
    $('battleNote').textContent = G.match.map.name + ' — ' + G.match.map.note;
    buildWeaponBar();
    buildRoster();
    buildItems();
    toast(G.match.map.name);

    if (G.online && G.isHost && !shared) {
      G.room.start({ seed: seed, mapId: mapId, mode: cfg.mode, picks: cfg.picks.slice(0, seatCount()) });
    }
    if (!G.raf) { G.last = performance.now(); G.raf = requestAnimationFrame(loop); }
  }

  function toMenu() {
    $('battle').style.display = 'none';
    $('menu').style.display = 'block';
    if (G.raf) { cancelAnimationFrame(G.raf); G.raf = 0; }
    if (G.room) { G.room.close(); G.room = null; G.online = false; }
    buildMenu();
  }

  /* ── HUD ──────────────────────────────────────────────────── */

  function buildWeaponBar() {
    var w = $('wpns'); w.innerHTML = '';
    var t = G.match.actor();
    if (!t) return;
    [t.def.main, t.def.sub].forEach(function (id, i) {
      var d = WPN.get(id);
      var b = doc.createElement('button');
      b.className = 'wbtn';
      // 아트가 있으면 아이콘을 얹는다. 없으면 이 줄만 빠지고 나머지는 그대로다.
      var icon = root.TFArt && root.TFArt.weapons && root.TFArt.weapons[id];
      if (icon) b.style.backgroundImage = 'url(' + icon.src + ')';
      b.classList.toggle('hasicon', !!icon);
      /* 충전형 무기는 지금 누르면 무엇이 일어나는지 버튼에 그대로 적는다 —
         한 번 눌러도 탄이 안 나가면 고장으로 오해한다. */
      var chg = d.chargeTurns
        ? (t.charge >= d.chargeTurns ? ' · 발사 준비됨' : ' · 누르면 기 모으기(' + t.charge + '/' + d.chargeTurns + ')')
        : '';
      /* 탄약이 유한한 보조무기는 남은 발수를 이름 옆에 붙인다.
         아래 줄에만 적어 두면 조준하는 동안 눈이 가지 않아 마지막 한 발을 모르고 쓴다. */
      var left = d.ammo ? (t.ammo[id] || 0) : -1;
      var badge = left < 0 ? ''
        : ' <span style="color:' + (left > 0 ? 'var(--brass)' : 'var(--alert)') + '">' + left + '발</span>';
      b.innerHTML = '<div class="wn">' + (i + 1) + '. ' + d.name + badge + '</div><div class="wt">' + d.type +
        ' · 딜레이 ' + d.delay + chg + '</div><div class="wa">' +
        (left < 0 ? '탄약 무한' : ('남은 ' + left + ' / ' + d.ammo + '발')) +
        ' · 피해 ' + d.dmg + ' · 반경 ' + d.rad + '</div>';
      b.title = d.desc || '';
      b.disabled = !!d.ammo && !(t.ammo[id] > 0);
      b.setAttribute('aria-pressed', String(t.weapon === id));
      b.onclick = function () { doCmd({ t: 'weapon', w: id }); buildWeaponBar(); };
      w.appendChild(b);
    });
  }

  /* 아이템 막대. 가진 것만 보여 준다 — 없는 칸을 회색으로 늘어놓으면
     "왜 못 쓰지"를 매번 확인하게 되고, 정작 생겼을 때 눈에 안 띈다. */
  /* 아이템 막대와 단축키(3~9)가 같은 목록을 봐야 한다.
     따로 만들면 발동한 버프가 목록에 남는 순간 번호가 하나씩 밀려 엉뚱한 것이 쓰인다. */
  function ownedItems(t) {
    var IT = root.TFItems;
    if (!IT || !t) return [];
    return IT.order.filter(function (id) {
      return (t.items[id] || 0) > 0 || (t.buff && t.buff[id]);
    });
  }

  function buildItems() {
    var host = $('items');
    var IT = root.TFItems;
    if (!host || !IT) return;
    host.innerHTML = '';
    var t = G.match.actor();
    if (!t) return;
    var mine = myTurn();
    /* 발동해 둔 탄 버프는 개수가 0이어도 남긴다.
       강화탄을 마지막 하나로 켜면 items[id] 가 0이 되어 목록에서 빠졌고,
       그러면 '지금 쏘면 1.6배가 실린다'는 사실이 화면 어디에도 없었다. */
    var owned = ownedItems(t);
    if (!owned.length) {
      host.innerHTML = '<span class="none">아이템 없음 — 뒤처질수록 자주 나온다</span>';
      return;
    }
    owned.forEach(function (id, i) {
      var d = IT.get(id);
      var left = t.items[id] || 0;
      var armed = !!(t.buff && t.buff[id]);
      var b = doc.createElement('button');
      b.className = 'ibtn' + (armed ? ' on armed' : '');
      /* 남은 개수와 '지금 장전됨'은 다른 정보다. 둘을 한 숫자로 합치면
         켜 놓은 것을 안 켰다고 읽거나 그 반대로 읽는다. */
      b.title = d.desc + (armed ? '\n\n지금 발사에 실려 있다.' : '') + '\n남은 개수 ' + left;
      b.disabled = !mine || (left <= 0);
      b.innerHTML = '<span class="k">' + (i + 3) + '</span>' +
        '<span class="mk" style="color:' + d.color + '">' + d.mark + '</span>' +
        '<span class="nm">' + d.name + '</span>' +
        '<span class="ct">' + (armed ? '장전 · ' : '') + '남은 ' + left + '</span>';
      b.onclick = function () { useItem(id); };
      host.appendChild(b);
    });
  }

  function useItem(id) {
    if (!myTurn()) return;
    if (doCmd({ t: 'item', i: id })) { buildItems(); buildRoster(); }
  }

  function buildRoster() {
    var r = $('roster'); r.innerHTML = '';
    G.match.world.tanks.forEach(function (t) {
      var d = doc.createElement('div');
      d.className = 'pl' + (t.dead ? ' out' : '') + (t.id === G.match.current ? ' now' : '');
      d.id = 'pl' + t.id;
      d.innerHTML = '<span class="dl">D' + Math.round(t.delay) + '</span>' +
        '<span>' + t.def.name + '</span>' +
        '<span class="hpb"><i style="width:' + (100 * t.hp / t.hpMax) + '%"></i></span>' +
        '<span class="dot" style="background:' + TEAM_COLORS[t.team] + '"></span>';
      r.appendChild(d);
    });
  }

  function updateHUD() {
    var m = G.match, t = m.actor();
    if (!t) return;
    var wind = m.world.wind, mx = m.map.wind || 1;
    var pct = C.clamp(Math.abs(wind) / mx, 0, 1) * 50;
    var bar = $('windBar');
    bar.style.left = wind >= 0 ? '50%' : (50 - pct) + '%';
    bar.style.width = pct + '%';
    bar.style.background = wind >= 0 ? 'var(--t2)' : 'var(--t1)';
    $('windTxt').textContent = (wind > 0 ? '▶ ' : (wind < 0 ? '◀ ' : '  ')) + Math.abs(wind).toFixed(1);

    var tl = Math.max(0, Math.ceil(m.timeLeft));
    var tm = $('timer'); tm.textContent = tl;
    tm.classList.toggle('low', tl <= 5 && m.state === 'aim');

    $('angBox').innerHTML = Math.round(t.angle) + '°<small>' + (t.dir > 0 ? 'ANGLE ▶' : '◀ ANGLE') + '</small>';
    var p = G.charging ? G.power : (G.ai && G.ai.showPower || 0);
    $('gBar').style.width = p + '%';
    $('gVal').textContent = Math.round(p);
    $('gLabel').textContent = G.charging ? '충전 중 — 떼면 발사' : '게이지';

    /* 이 사수가 지난번에 쏜 게이지. 자리를 안 옮겼다면 같은 값이 같은 곳에 떨어진다. */
    var prev = G.lastPower[t.id];
    var mk = $('gMark');
    if (prev == null) mk.style.display = 'none';
    else {
      mk.style.display = 'block';
      mk.style.left = prev + '%';
      mk.title = '지난 발사 ' + Math.round(prev);
    }
    $('fBar').style.width = (100 * t.fuel / t.fuelMax) + '%';
    $('fVal').textContent = Math.round(t.fuel);

    m.world.tanks.forEach(function (tk) {
      var el = $('pl' + tk.id);
      if (!el) return;
      el.className = 'pl' + (tk.dead ? ' out' : '') + (tk.id === m.current ? ' now' : '');
      el.querySelector('.hpb i').style.width = (100 * tk.hp / tk.hpMax) + '%';
      el.querySelector('.dl').textContent = 'D' + Math.round(tk.delay);
    });
  }

  function toast(s, ms) {
    var el = $('toast');
    el.textContent = s; el.classList.add('on');
    G.toastT = (ms || 1400) / 1000;
  }

  /* ── 명령 경로 — 로컬이든 온라인이든 반드시 여기를 통과한다 ── */

  function myTurn() {
    var m = G.match;
    if (!m || m.state !== 'aim' || m.result) return false;
    return G.seats.indexOf(m.current) >= 0;
  }

  function doCmd(c, fromNet) {
    var m = G.match;
    if (!m) return false;
    /* 발사 게이지는 명령이 통과하기 *전에* 사수를 잡아 둬야 한다 —
       command 가 턴을 넘겨 버리면 그 값이 다음 사람 앞으로 기록된다. */
    var firer = c.t === 'fire' ? m.actor() : null;
    var okc = m.command(c);
    if (okc && firer) G.lastPower[firer.id] = C.clamp(c.p, 0, 100);
    if (okc && !fromNet && G.online) G.room.cmd(c);
    return okc;
  }

  /* ── 입력 ─────────────────────────────────────────────────── */

  function bindInput() {
    doc.addEventListener('keydown', function (e) {
      if ($('battle').style.display === 'none') return;
      var k = e.key;
      if (k === ' ' || k.indexOf('Arrow') === 0) e.preventDefault();
      if (G.held[k]) return;
      G.held[k] = true;
      if (!myTurn()) return;
      if (k === ' ') { G.charging = true; G.power = 0; }
      else if (k === '1') { doCmd({ t: 'weapon', w: G.match.actor().def.main }); buildWeaponBar(); }
      else if (k === '2') { doCmd({ t: 'weapon', w: G.match.actor().def.sub }); buildWeaponBar(); }
      else if (k >= '3' && k <= '9') {
        var tk = G.match.actor();
        if (tk) {
          var pick = ownedItems(tk)[+k - 3];
          if (pick && (tk.items[pick] || 0) > 0) useItem(pick);
        }
      }
      else if (k === 'z' || k === 'Z' || k === 'ㅋ') doCmd({ t: 'dir', d: -G.match.actor().dir });
      else if (k === 'Enter') doCmd({ t: 'pass' });
    });
    doc.addEventListener('keyup', function (e) {
      G.held[e.key] = false;
      if (e.key === ' ' && G.charging) releaseFire();
    });
    window.addEventListener('blur', function () { G.held = {}; });

    var t = $('touch');
    Array.prototype.forEach.call(t.querySelectorAll('button'), function (b) {
      var key = b.dataset.k;
      var down = function (e) {
        e.preventDefault();
        if (!myTurn()) return;
        if (key === 'fire') { G.charging = true; G.power = 0; }
        else G.held['touch:' + key] = true;
      };
      var up = function (e) {
        e.preventDefault();
        if (key === 'fire' && G.charging) releaseFire();
        G.held['touch:' + key] = false;
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });

    /* 캔버스 드래그로 맵 탐색 — 상대 위치를 눈으로 확인하기 위해 필요 */
    var cv = $('cv');
    if (cv) {
      cv.style.cursor = 'grab';
      cv.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        // 터치 버튼 영역이나 UI 위에서는 무시
        if (e.target !== cv) return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        G.drag = { px: e.clientX, py: e.clientY, cx: G.cam.x, cy: G.cam.y };
        G.camFollow = false;
        cv.style.cursor = 'grabbing';
      });
      cv.addEventListener('pointermove', function (e) {
        if (!G.drag) return;
        var m = G.match;
        if (!m) return;
        var scaleX = VIEW.w / cv.clientWidth;
        var scaleY = VIEW.h / cv.clientHeight;
        var dx = (e.clientX - G.drag.px) * scaleX;
        var dy = (e.clientY - G.drag.py) * scaleY;
        G.cam.x = C.clamp(G.drag.cx - dx, 0, Math.max(0, m.map.w - VIEW.w));
        G.cam.y = C.clamp(G.drag.cy - dy, 0, Math.max(0, m.map.h - VIEW.h));
      });
      var endDrag = function (e) {
        if (!G.drag) return;
        G.drag = null;
        G.camFollow = false;
        G.camFollowT = 2.2;   // 2.2초 뒤 자동 추종 재개
        cv.style.cursor = 'grab';
        try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
      };
      cv.addEventListener('pointerup', endDrag);
      cv.addEventListener('pointercancel', endDrag);
    }

    $('btnStart').onclick = function () {
      if (isOnline()) {
        if (!G.room) { $('netMsg').textContent = '먼저 방을 만들거나 참가하세요.'; return; }
        if (!G.isHost) { $('netMsg').textContent = '호스트가 시작합니다.'; return; }
        if (!G.room.full()) {
          $('netMsg').textContent = '정원이 아직 안 찼습니다 (' +
            G.room.peers.length + '/' + seatCount() + ').';
          return;
        }
      }
      start(null);
    };
    $('btnMenu').onclick = toMenu;
    $('btnAgain').onclick = function () { if (!G.online || G.isHost) start(null); };
    $('btnHost').onclick = function () { openRoom(true); };
    $('btnJoin').onclick = function () { openRoom(false); };
    $('btnLeave').onclick = function () { leaveRoom(); buildMenu(); };
  }

  function heldDir() {
    if (G.held['ArrowLeft'] || G.held['touch:left']) return -1;
    if (G.held['ArrowRight'] || G.held['touch:right']) return 1;
    return 0;
  }
  function heldAim() {
    if (G.held['ArrowUp'] || G.held['touch:up']) return 1;
    if (G.held['ArrowDown'] || G.held['touch:down']) return -1;
    return 0;
  }

  function releaseFire() {
    G.charging = false;
    if (!myTurn()) { G.power = 0; return; }
    var t = G.match.actor();
    var mu = G.match.world.muzzle(t);
    if (doCmd({ t: 'fire', p: Math.max(2, Math.round(G.power)) })) {
      var ww = WPN.get(t.weapon);
      G.fx.muzzle(mu.x, mu.y, t.angle * C.DEG, t.dir, ww.color, ww.type);
    }
    G.power = 0;
  }

  /* ── AI 재생 ──────────────────────────────────────────────── */

  function stepAI(dt) {
    var m = G.match, t = m.actor();
    if (!t || m.state !== 'aim' || m.result) { G.ai = null; return; }
    if (!t.ai) return;
    if (!G.ai) {
      var p = AI.plan(m);
      G.ai = { p: p, phase: 'think', t: 0, showPower: 0, mi: 0 };
      if (p && p.fire) {
        doCmd({ t: 'weapon', w: p.weapon });
        (p.items || []).forEach(function (id) { doCmd({ t: 'item', i: id }); });
      }
      buildWeaponBar(); buildItems();
    }
    var a = G.ai;
    a.t += dt;
    if (!a.p || !a.p.fire) { if (a.t > 0.6) { doCmd({ t: 'pass' }); G.ai = null; } return; }

    if (a.phase === 'think') {
      if (a.t > 0.55) { a.phase = 'move'; a.t = 0; doCmd({ t: 'dir', d: a.p.dir }); }
    } else if (a.phase === 'move') {
      var mv = a.p.moves[a.mi];
      if (!mv || mv.px <= 0) { a.phase = 'aim'; a.t = 0; return; }
      var step = Math.min(mv.px, Math.ceil(90 * dt));
      doCmd({ t: 'move', d: mv.d, px: step });
      mv.px -= step;
      if (mv.px <= 0) a.mi++;
    } else if (a.phase === 'aim') {
      var d = a.p.angle - t.angle;
      var mx = 62 * dt;
      if (Math.abs(d) <= mx) { doCmd({ t: 'aim', a: a.p.angle }); a.phase = 'charge'; a.t = 0; }
      else doCmd({ t: 'aim', a: t.angle + (d > 0 ? mx : -mx) });
    } else if (a.phase === 'charge') {
      a.showPower = Math.min(a.p.power, a.showPower + 105 * dt);
      if (a.showPower >= a.p.power - 0.5) {
        var mu = m.world.muzzle(t);
        if (doCmd({ t: 'fire', p: a.p.power })) {
          var ww = WPN.get(t.weapon);
          G.fx.muzzle(mu.x, mu.y, t.angle * C.DEG, t.dir, ww.color, ww.type);
        }
        G.ai = null;
      }
    }
  }

  /* ── 이벤트 → 이펙트 ──────────────────────────────────────── */

  function drainEvents() {
    var evs = G.match.world.events;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      switch (e.type) {
        case 'boom': G.fx.boom(e.x, e.y, e.r, e.color); break;
        case 'split': G.fx.spawn(e.x, e.y, 16, { color: e.color, smax: 180, lmax: 0.5 }); break;
        case 'drillIn': G.fx.spawn(e.x, e.y, 10, { color: '#C9A227', smax: 120, lmax: 0.4 }); break;
        case 'dmg': G.fx.text(e.x, e.y, '-' + e.n, e.cause === 'fall' ? '#9FC0E0' : '#FF9A8A'); break;
        case 'land': G.fx.spawn(e.x, e.y + 12, 8, { color: '#9AA8B8', smax: 90, lmax: 0.4, g: 500 }); break;
        case 'dead':
          G.fx.boom(e.x, e.y, 46, '#FFD37A');
          toast(e.cause === 'void' ? '낙사!' : '격파!', 1100);
          buildRoster();
          break;
        case 'item':
          G.fx.text(e.x, e.y - 46, '＋' + root.TFItems.get(e.item).name, root.TFItems.get(e.item).color);
          buildItems();
          break;
        case 'crateDrop':
          toast('보급 투하', 900);
          break;
        case 'charging':
          toast('기 모으는 중 — 다음 차례에 발사', 1300);
          G.fx.text(e.x, e.y - 46, '충전', '#7FC8E8');
          G.fx.spawn(e.x, e.y - 10, 26, { color: '#7FC8E8', smax: 150, lmax: 0.8, g: -40 });
          buildWeaponBar();
          break;
        case 'chargeBreak':
          toast('기가 풀렸다', 1100);
          G.fx.text(e.x, e.y - 46, '충전 해제', '#E0574A');
          buildWeaponBar();
          break;
        case 'burnTick':
          G.fx.text(e.x, e.y - 52, '화염 ' + e.n, '#FF9F45');
          G.fx.spawn(e.x, e.y - 6, 14, { color: '#FF9F45', smax: 120, lmax: 0.6, g: -60 });
          break;
        case 'burnOn':
          G.fx.spawn(e.x, e.y - 6, 10, { color: '#FF6B6B', smax: 100, lmax: 0.5, g: -40 });
          break;
        case 'streak':
          if (e.n > 1) G.fx.text(e.x, e.y - 56, '연속 ×' + e.n, '#C79BFF');
          break;
        case 'crateLand':
          G.fx.spawn(e.x, e.y + 10, 10, { color: '#9AA8B8', smax: 90, lmax: 0.4, g: 400 });
          break;
        case 'cratePick':
          G.fx.spawn(e.x, e.y, 18, { color: root.TFItems.get(e.item).color, smax: 170, lmax: 0.6, g: 100 });
          break;
        case 'crateBust':
          G.fx.text(e.x, e.y - 20, '보급 파괴', '#E0574A');
          G.fx.spawn(e.x, e.y, 22, { color: '#8B99AB', smax: 200, lmax: 0.7 });
          break;
        case 'itemFull':
          G.fx.text(e.x, e.y - 40, '소지 한도', '#E0C24A');
          break;
        case 'sudden':
          toast('서든데스 −' + e.dmg, 1100);
          break;
        case 'useItem':
          var di = root.TFItems.get(e.item);
          G.fx.text(e.x, e.y - 40, di.mark + ' ' + di.name, di.color);
          G.fx.spawn(e.x, e.y - 10, 20, { color: di.color, smax: 160, lmax: 0.7, g: 120 });
          buildItems();
          break;
        case 'shield':
          G.fx.spawn(e.x, e.y - 10, 22, { color: '#6BE0C0', smax: 190, lmax: 0.5, g: 60 });
          break;
        case 'warpOut':
          G.fx.spawn(e.x, e.y - 8, 26, { color: '#C79BFF', smax: 220, lmax: 0.6, g: 40 });
          break;
        case 'warpIn':
          G.fx.spawn(e.x, e.y - 8, 30, { color: '#C79BFF', smax: 240, lmax: 0.7, g: 40 });
          if (!e.safe) G.fx.text(e.x, e.y - 44, '허공!', '#E0574A');
          break;
        case 'warpMiss':
          G.fx.text(e.x, e.y - 40, '이송 실패', '#E0574A');
          break;
        case 'turn':
          buildWeaponBar(); buildRoster(); buildItems();
          G.ai = null; G.power = 0; G.charging = false;
          var who = G.match.world.tanks[e.id];
          toast(who.def.name + ' 차례', 900);
          if (G.online && G.isHost) G.room.sync(G.match.snapshot(), G.match.hash());
          break;
        case 'over': G.ended = true; showResult(); break;
      }
    }
    evs.length = 0;
  }

  function showResult() {
    var m = G.match, r = m.result;
    var mine = G.seats.length ? m.world.tanks[G.seats[0]] : null;
    var win = mine ? (mine.team === r.winner) : false;
    $('ovTitle').textContent = cfg.play === 'local'
      ? ('팀 ' + (r.winner + 1) + ' 승리')
      : (win ? '승리' : '패배');
    $('ovTitle').style.color = win || cfg.play === 'local' ? 'var(--brass)' : 'var(--alert)';
    $('ovBody').textContent = r.turns + '턴 · 낙사 ' + r.voidKills + '기 · 생존 ' +
      r.survivors.map(function (s) { return s.name + ' ' + s.hp; }).join(', ');
    $('overlay').classList.add('on');
  }

  /* ── 카메라 ───────────────────────────────────────────────── */

  var TRANSIT_SPEED = 0.8;   // 착탄 후 다음 사수로 넘어가는 이동의 속도 배율

  function camera(dt) {
    var m = G.match;
    if (!m) return;

    // 드래그 직후에는 잠깐 자동 추종을 끈다 (시야 확인용)
    if (!G.camFollow) {
      G.camFollowT -= dt;
      if (G.camFollowT <= 0) G.camFollow = true;
      return;
    }
    // 드래그 중이면 따라가지 않는다
    if (G.drag) return;

    var tx, ty;
    var s = m.world.shells[0];
    if (s) { tx = s.x; ty = s.y; }
    else {
      var a = m.actor();
      if (!a) return;
      tx = a.x + a.dir * 90; ty = a.y - 60;
    }
    var gx = C.clamp(tx - VIEW.w / 2, 0, Math.max(0, m.map.w - VIEW.w));
    var gy = C.clamp(ty - VIEW.h / 2, 0, Math.max(0, m.map.h - VIEW.h));
    /* 포탄을 쫓을 때는 빠르게 붙어야 탄이 화면 밖으로 안 샌다.
       탄이 다 떨어진 뒤 다음 사수로 넘어가는 이동은 그럴 필요가 없고, 오히려 확 튀면
       무엇이 부서졌는지 못 보고 지나간다. 그 구간만 80% 속도로 늦춘다. */
    var k = 1 - Math.pow(s ? 0.00006 : 0.0009, dt * (s ? 1 : TRANSIT_SPEED));
    G.cam.x += (gx - G.cam.x) * k;
    G.cam.y += (gy - G.cam.y) * k;
  }

  /* ── 루프 ─────────────────────────────────────────────────── */

  function loop(ts) {
    G.raf = requestAnimationFrame(loop);
    var dt = Math.min(0.05, (ts - G.last) / 1000);
    G.last = ts; G.time += dt;
    var m = G.match;
    if (!m) return;

    if (myTurn()) {
      var d = heldDir();
      if (d) doCmd({ t: 'move', d: d, px: Math.max(1, Math.round(160 * dt)) });
      var ad = heldAim();
      if (ad) doCmd({ t: 'aim', a: m.actor().angle + ad * 52 * dt });
      if (G.charging) {
        G.power = Math.min(100, G.power + 78 * dt);
        if (m.timeLeft < 0.12) releaseFire();     // 시간이 끊기기 전에 쏜다
      }
    }
    stepAI(dt);

    m.update(dt);
    drainEvents();
    G.fx.step(dt);
    camera(dt);

    if (G.toastT > 0) { G.toastT -= dt; if (G.toastT <= 0) $('toast').classList.remove('on'); }

    var off = G.fx.offset();
    G.scene.render(G.ctx, { x: G.cam.x - off.x, y: G.cam.y - off.y }, VIEW, {
      fx: G.fx, time: G.time, teamColors: TEAM_COLORS,
      aimTank: myTurn() ? m.actor() : (m.actor() && m.actor().ai && m.state === 'aim' ? m.actor() : null),
      power: G.charging ? G.power : (G.ai ? G.ai.showPower : 0)
    });
    updateHUD();
  }

  /* ── 온라인 ───────────────────────────────────────────────── */

  function openRoom(asHost) {
    var code = ($('roomCode').value || '').toUpperCase().trim();
    if (asHost && !code) { code = root.TFNet.makeCode(); $('roomCode').value = code; }
    if (!code) { $('netMsg').textContent = '방 코드를 입력하세요.'; return; }
    if (G.room) leaveRoom();
    cfg.play = 'online';
    G.isHost = asHost;
    G.room = new root.TFNet.Room();
    /* 정원은 모드가 정한다. 호스트는 자기가 고른 모드로 열고, 게스트는 들어가서 자리표를 받아 맞춘다 —
       게스트가 미리 정한 정원을 우기면 인원이 다 찼는지 서로 다르게 판단한다. */
    G.room.mode = cfg.mode;
    G.room.capacity = MT.MODES[cfg.mode].n;
    $('netMsg').textContent = '연결 중…';
    G.room.open(code, asHost ? 'host' : 'guest', function (err) {
      if (err) { $('netMsg').textContent = err.message; G.room = null; buildMenu(); return; }
      G.online = true;
      $('netMsg').textContent = asHost ? ('방 ' + code + ' — 참가자를 기다립니다') : (code + ' 방에 들어갔습니다');

      G.room.onPeer = function () { buildMenu(); };
      /* 자리표가 오면 모드도 그것에 맞춘다. 호스트가 2:2 로 연 방에 1:1 화면으로 앉아 있으면
         전차를 둘만 만들고 나머지 둘의 명령을 버린다 — 그 순간 판이 갈린다. */
      G.room.onSeats = function () {
        if (!asHost && MT.MODES[G.room.mode]) cfg.mode = G.room.mode;
        $('netMsg').textContent = '참가 ' + G.room.peers.length + ' / ' + G.room.capacity +
          (G.room.full() ? ' — 준비 완료' : ' — 대기 중');
        buildMenu();
      };
      G.room.onStart = function (shared) { if (!asHost) start(shared); };
      G.room.onCmd = function (c) { if (G.match) doCmd(c, true); };
      G.room.onSync = function (snap, h) {
        if (!G.match || asHost) return;
        if (G.match.hash() !== h) {
          G.match.restore(snap); G.room.divergences++;
          root.TFApp.refresh();          // 아이템·탄약이 스냅샷으로 바뀌었으면 HUD 도 따라가야 한다
        }
      };
      G.room.onError = function (e) { $('netMsg').textContent = e.message; buildMenu(); };
      if (asHost) G.room.publishSeats();
      buildMenu();
    });
  }

  function leaveRoom() {
    if (G.room) { G.room.close(); G.room = null; }
    G.online = false; G.isHost = false; G.mySeat = 0;
    $('netMsg').textContent = '';
  }

  /* ── 부팅 ─────────────────────────────────────────────────── */

  function boot() {
    var cv = $('cv');
    G.ctx = cv.getContext('2d');
    buildMenu();
    bindInput();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* refresh 는 HUD 를 상태와 다시 맞춘다. 평소에는 루프가 이벤트를 받아 알아서 하지만,
     루프 밖에서 상태를 건드린 경우(스냅샷 복구, 검증 스크립트)에는 부를 곳이 필요하다. */
  root.TFApp = {
    G: G, cfg: cfg, start: start, VIEW: VIEW,
    /* updateHUD 까지 부른다. 스냅샷으로 복구하면 바람·타이머·게이지 표식도 옛 값이고,
       루프가 다음 프레임에 고쳐 주긴 하지만 그 한 프레임을 사람이 본다. */
    refresh: function () { if (G.match) { buildWeaponBar(); buildRoster(); buildItems(); updateHUD(); } }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this, document);
