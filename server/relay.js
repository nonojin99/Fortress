/* server/relay.js — 방 코드로 짝지어 메시지를 되뿌리는 것만 하는 서버.
   Render 에 그대로 올라간다. 의존성은 ws 하나뿐이다.

   왜 이렇게 얇은가: 게임 판정을 서버로 올리면 포탄이 나는 3초가 통째로 지연이 된다.
   판정은 양쪽 클라이언트가 각자 돌리고(logic/ 은 결정론이다), 호스트가 턴마다 스냅샷으로 맞춘다.
   서버가 알아야 할 것은 "누가 같은 방인가" 뿐이다.

   배포:
     Render → New Web Service → 이 폴더 → Build: npm install / Start: node relay.js
     환경변수는 없어도 된다. PORT 는 Render 가 넣어 준다.
   확인:
     curl https://<서비스>.onrender.com/health   →  {"ok":true,...}  */
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_ROOM = 4;                 // 1:1:1:1 까지
const IDLE_MS = 30 * 60 * 1000;     // 30분 조용하면 방을 버린다

const rooms = new Map();            // code -> { peers:Set, touched:number }

function room(code) {
  let r = rooms.get(code);
  if (!r) { r = { peers: new Set(), touched: Date.now() }; rooms.set(code, r); }
  r.touched = Date.now();
  return r;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
      uptime: Math.round(process.uptime())
    }));
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const code = (url.searchParams.get('room') || '').toUpperCase().slice(0, 12);
  const role = (url.searchParams.get('role') || 'guest').slice(0, 10);
  if (!code) { ws.close(1008, 'no room'); return; }

  const r = room(code);
  if (r.peers.size >= MAX_ROOM) { ws.close(1008, 'room full'); return; }
  r.peers.add(ws);
  ws.__room = code; ws.__role = role; ws.__alive = true;

  ws.on('pong', () => { ws.__alive = true; });

  ws.on('message', (buf) => {
    const s = buf.toString();
    r.touched = Date.now();
    // 클라이언트가 인스턴스를 깨우려고 보내는 신호. 되뿌리지 않는다
    if (s === '{"t":"_ping"}') { try { ws.send('{"t":"_pong"}'); } catch (e) {} return; }
    if (s.length > 256 * 1024) return;                 // 스냅샷도 이보다 크지 않다
    for (const p of r.peers) {
      if (p !== ws && p.readyState === 1) { try { p.send(s); } catch (e) {} }
    }
  });

  const bye = () => {
    r.peers.delete(ws);
    for (const p of r.peers) {
      if (p.readyState === 1) { try { p.send(JSON.stringify({ t: 'bye', role })); } catch (e) {} }
    }
    if (!r.peers.size) rooms.delete(code);
  };
  ws.on('close', bye);
  ws.on('error', bye);
});

/* 죽은 소켓 청소. Render 무료 플랜에서 인스턴스가 잠들었다 깨면 유령 연결이 남는다. */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.__alive) { try { ws.terminate(); } catch (e) {} return; }
    ws.__alive = false;
    try { ws.ping(); } catch (e) {}
  });
  const now = Date.now();
  for (const [code, r] of rooms) if (now - r.touched > IDLE_MS) rooms.delete(code);
}, 30000);

server.listen(PORT, () => console.log('tankfort relay on :' + PORT));
