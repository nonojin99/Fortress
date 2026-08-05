/* sim/net-test.js — 온라인 대전 프로토콜 검증. 전송체 없이 루프백으로만 돈다.
   여기서 통과한다는 것은 "규약이 옳다"는 뜻이지 "Supabase 가 연결된다"는 뜻이 아니다.
   실제 연결이 안 되면 원인은 net/supabase-transport.js 의 URL/KEY 이지 이 파일이 아니다.

     node sim/net-test.js   또는   sim/net-test.html */
if (typeof require === 'function') {
  require('../logic/core.js');
  require('../logic/terrain.js');
  require('../logic/maps.js');
  require('../logic/weapons.js');
  require('../logic/tanks.js');
  require('../logic/physics.js');
  require('../logic/items.js');
  require('../logic/match.js');
  require('../logic/ai.js');
  require('../net/room.js');
}

var MT = globalThis.TFMatch, NET = globalThis.TFNet;

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + '  ' + (detail || '')); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* 두 쪽이 같은 설정으로 각자 Match 를 만든다. 실제 앱과 같은 경로다. */
function makeMatch(cfg) {
  return new MT.Match({
    mapId: cfg.mapId, seed: cfg.seed, mode: cfg.mode,
    roster: cfg.picks.map(function (p) { return { tank: p }; })
  });
}
function settle(m) {
  var n = 0;
  while (m.state === 'resolve' && n < 4000) { m.update(1 / 60); n++; }
}

async function run() {
  console.log('\n1. 연결과 방 개설');
  var lb = NET.loopback();
  var host = lb.host, guest = lb.guest;

  var peerSeen = { host: false, guest: false };
  host.onPeer = function () { peerSeen.host = true; };
  guest.onPeer = function () { peerSeen.guest = true; };
  host.send({ t: 'hello', role: 'host' });
  guest.send({ t: 'hello', role: 'guest' });
  await wait(20);
  ok('양쪽이 서로를 인식한다', peerSeen.host && peerSeen.guest);

  var code = NET.makeCode();
  ok('방 코드가 5자리 대문자·숫자', /^[A-Z2-9]{5}$/.test(code), code);

  console.log('\n2. 시작 설정 전파');
  var cfg = { seed: 20260803, mapId: 'glacier', mode: 'solo', picks: ['nova', 'guardian'] };
  var guestCfg = null;
  guest.onStart = function (c) { guestCfg = c; };
  host.start(cfg);
  await wait(20);
  ok('게스트가 호스트의 시드·맵·전차를 받는다',
    guestCfg && guestCfg.seed === cfg.seed && guestCfg.mapId === cfg.mapId &&
    guestCfg.picks.join() === cfg.picks.join(), JSON.stringify(guestCfg));

  var A = makeMatch(cfg), B = makeMatch(guestCfg);
  ok('같은 설정 → 같은 초기 해시', A.hash() === B.hash(), A.hash().toString(16));

  console.log('\n3. 명령 중계 — 조작하는 쪽만 보낸다');
  host.onCmd = function (c) { A.command(c); settle(A); };
  guest.onCmd = function (c) { B.command(c); settle(B); };

  async function act(who, other, mine, theirs, c) {
    mine.command(c); settle(mine);
    who.cmd(c);
    await wait(10);
    return mine.hash() === theirs.hash();
  }

  var sync1 = await act(host, guest, A, B, { t: 'aim', a: 54 });
  var sync2 = await act(host, guest, A, B, { t: 'fire', p: 72 });
  ok('호스트 조준·발사가 게스트에 그대로 재현된다', sync1 && sync2,
    'A ' + A.hash().toString(16) + ' / B ' + B.hash().toString(16));

  ok('턴이 넘어가 사수가 바뀐다', A.current === B.current && A.turn === B.turn,
    'turn ' + A.turn + ' cur ' + A.current);

  // 이번엔 게스트 차례라고 가정하고 반대 방향으로 흘려 본다
  var sync3 = await act(guest, host, B, A, { t: 'move', d: -1, px: 22 });
  var sync4 = await act(guest, host, B, A, { t: 'fire', p: 58 });
  ok('게스트 명령도 같은 경로로 되돌아온다', sync3 && sync4,
    'A ' + A.hash().toString(16) + ' / B ' + B.hash().toString(16));

  console.log('\n4. 어긋남 감지와 복구');
  B.world.tanks[0].hp -= 17;                 // 인위적으로 갈라 놓는다
  B.world.tanks[1].x += 9;
  ok('해시가 어긋남을 잡아낸다', A.hash() !== B.hash());

  var repaired = false;
  guest.onSync = function (snap, h) {
    if (B.hash() !== h) { B.restore(snap); repaired = true; }
  };
  host.sync(JSON.parse(JSON.stringify(A.snapshot())), A.hash());
  await wait(20);
  ok('호스트 스냅샷으로 복구된다', repaired && A.hash() === B.hash(),
    'A ' + A.hash().toString(16) + ' / B ' + B.hash().toString(16));

  console.log('\n5. 한 판 전체를 중계로 끝내기');
  var cfg2 = { seed: 777, mapId: 'ridge', mode: 'solo', picks: ['stinger', 'kraken'] };
  var C1 = makeMatch(cfg2), C2 = makeMatch(cfg2);
  var lb2 = NET.loopback();
  lb2.guest.onCmd = function (c) { C2.command(c); settle(C2); };
  lb2.host.onSync = function () {};
  var guard = 0, drift = 0;
  while (!C1.result && guard < 120) {
    guard++;
    var p = globalThis.TFAI.plan(C1);
    var cmds = p && p.fire
      ? [{ t: 'dir', d: p.dir }, { t: 'weapon', w: p.weapon }, { t: 'aim', a: p.angle }, { t: 'fire', p: p.power }]
      : [{ t: 'pass' }];
    for (var i = 0; i < cmds.length; i++) {
      C1.command(cmds[i]);
      lb2.host.cmd(cmds[i]);
    }
    settle(C1);
    await wait(0);
    if (C1.hash() !== C2.hash()) drift++;
  }
  ok('중계만으로 한 판이 끝난다', !!C1.result, C1.result ? (C1.result.turns + '턴, 승자 팀' + C1.result.winner) : 'guard ' + guard);
  ok('전 턴 무이탈 동기화', drift === 0 && C1.hash() === C2.hash(), '어긋난 턴 ' + drift + '회');

  console.log('\n6. 전송체 부재 처리');
  var saved = globalThis.makeTransport;
  globalThis.makeTransport = undefined;
  var r = new NET.Room(), errMsg = null;
  r.open('ABCDE', 'host', function (e) { errMsg = e && e.message; });
  ok('전송체가 없으면 조용히 실패하지 않고 이유를 말한다',
    !!errMsg && errMsg.indexOf('전송체') >= 0, errMsg);
  globalThis.makeTransport = saved;

  console.log('\n7. 네 자리 방 — 2:2 와 1:1:1:1');
  /* 2인 방에서만 맞는 '호스트=0, 게스트=1' 규칙으로는 셋 이상을 못 앉힌다.
     여기서 보는 것은 자리가 겹치지 않는가, 그리고 넋이 끝까지 같은 판을 보는가 두 가지다. */
  var lb4 = NET.loopback(4), R4 = lb4.rooms;
  R4[0].setMode('ffa', 4);
  for (var q = 1; q < 4; q++) R4[q].send({ t: 'hello', role: 'guest', pid: R4[q].pid });
  await wait(40);

  var seats = R4.map(function (r) { return r.seat(); });
  ok('넷이 서로 다른 자리에 앉는다', seats.join() === '0,1,2,3', seats.join());
  ok('정원이 찼다고 전원이 같이 판단한다', R4.every(function (r) { return r.full(); }));
  ok('모드가 그대로 전파된다 (정원만으로는 duo/ffa 를 못 가린다)',
    R4.every(function (r) { return r.mode === 'ffa'; }), R4.map(function (r) { return r.mode; }).join());

  var want = ['nova', 'guardian', 'kraken', 'zephyr'];
  R4.forEach(function (r) { r.pick(want[r.seat()]); });
  await wait(60);
  ok('각자 고른 전차가 한 표로 모인다', R4[0].picks.join() === want.join(), R4[0].picks.join());
  ok('그 표를 전원이 똑같이 본다',
    R4.every(function (r) { return r.picks.join() === want.join(); }));

  // 명령은 브로드캐스트다 — 보낸 사람만 빼고 전원에게 가야 한다
  var heard = [0, 0, 0, 0];
  R4.forEach(function (r, i) { r.onCmd = function () { heard[i]++; }; });
  R4[2].cmd({ t: 'aim', a: 40 });
  await wait(30);
  ok('명령이 보낸 사람 빼고 전원에게 간다', heard.join() === '1,1,0,1', heard.join());

  /* 넋이 각자 자기 전차만 조작해도 네 판이 같은 상태로 굴러야 한다.
     하나라도 어긋나면 그 클라이언트만 다른 지형을 보게 되고 되돌릴 방법이 없다. */
  var cfg4 = { seed: 4242, mapId: 'canyon', mode: 'duo', picks: ['titan', 'phantom', 'stinger', 'kraken'] };
  var M4 = R4.map(function () { return makeMatch(cfg4); });
  R4.forEach(function (r, i) { r.onCmd = function (c) { M4[i].command(c); settle(M4[i]); }; });
  ok('네 클라이언트의 초기 해시가 같다',
    M4.every(function (m) { return m.hash() === M4[0].hash(); }), M4[0].hash().toString(16));

  for (var tn = 0; tn < 8 && !M4[0].result; tn++) {
    var owner = M4[0].current;                       // 자리 번호 = 전차 번호
    var seq = [{ t: 'aim', a: 38 + tn * 3 }, { t: 'fire', p: 55 + tn * 2 }];
    for (var si = 0; si < seq.length; si++) {
      M4[owner].command(seq[si]); settle(M4[owner]);
      R4[owner].cmd(seq[si]);
      await wait(8);
    }
  }
  ok('8턴을 돌려도 네 판이 한 글자도 안 어긋난다',
    M4.every(function (m) { return m.hash() === M4[0].hash(); }),
    M4.map(function (m) { return m.hash().toString(16); }).join(' '));


  /* 게스트가 호스트보다 먼저 들어온 경우.
     먼저 온 사람은 호스트의 hello 에 hi 로 답하므로,
     hello 만 보고 자리를 주면 그 사람은 영원히 방에 못 앉는다. */
  var lbE = NET.loopback(2);
  var early = lbE.rooms[1], late = lbE.rooms[0];
  early.send({ t: 'hello', role: 'guest', pid: early.pid });   // 호스트가 없을 때 외친다
  await wait(20);
  late.peers = [late.pid];
  late.send({ t: 'hello', role: 'host', pid: late.pid });      // 뒤달아 방을 열었다
  await wait(40);
  ok('호스트보다 먼저 온 사람도 자리를 받는다',
    late.peers.length === 2 && early.seat() === 1,
    '인원 ' + late.peers.length + ' / 자리 ' + early.seat());

  console.log('\n' + '─'.repeat(56));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  console.log(fail ? '### FAIL ###' : '### ALL PASS ###');
  if (typeof document !== 'undefined') document.title = fail ? ('FAIL ' + fail) : 'ALL PASS';
  if (typeof process !== 'undefined' && process.exit) process.exit(fail ? 1 : 0);
}

run();
