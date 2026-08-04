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

  console.log('\n' + '─'.repeat(56));
  console.log('통과 ' + pass + ' / 실패 ' + fail);
  console.log(fail ? '### FAIL ###' : '### ALL PASS ###');
  if (typeof document !== 'undefined') document.title = fail ? ('FAIL ' + fail) : 'ALL PASS';
  if (typeof process !== 'undefined' && process.exit) process.exit(fail ? 1 : 0);
}

run();
