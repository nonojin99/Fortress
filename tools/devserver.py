# tools/devserver.py — 정적 서버 + 캔버스 회수 엔드포인트.
#   python tools/devserver.py [port]
# 브라우저 화면을 캡처할 수 없는 환경에서 렌더 결과를 확인하려고 만들었다.
# 페이지가 canvas.toDataURL() 결과를 POST /_shot 으로 보내면 shots/ 에 PNG 로 떨어진다.
# 게임 코드는 이 서버를 전혀 모른다 — 개발용 도구일 뿐이고 빌드 산출물에는 들어가지 않는다.
import base64, json, os, sys, posixpath
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shots')
os.makedirs(SHOTS, exist_ok=True)


class H(SimpleHTTPRequestHandler):
    # 캐시를 끈다. 브라우저가 logic/*.js 를 재검증 없이 재사용하면
    # "고쳤는데 화면이 안 바뀐다"에 시간을 통째로 날리게 된다.
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        SimpleHTTPRequestHandler.end_headers(self)

    def translate_path(self, path):
        path = unquote(path.split('?', 1)[0].split('#', 1)[0])
        parts = [p for p in posixpath.normpath(path).split('/') if p and p not in ('.', '..')]
        return os.path.join(ROOT, *parts)

    def do_POST(self):
        if self.path == '/_shot':
            self._write_shot(); return
        if self.path == '/_file':
            self._write_file(); return
        self.send_error(404)

    def _body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n).decode('utf-8'))

    def _ok(self, payload):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def _write_shot(self):
        body = self._body()
        name = ''.join(c for c in body.get('name', 'shot') if c.isalnum() or c in '-_')
        out = os.path.join(SHOTS, name + '.png')
        with open(out, 'wb') as f:
            f.write(base64.b64decode(body['data'].split(',', 1)[-1]))
        self._ok({'ok': True, 'path': out, 'bytes': os.path.getsize(out)})

    # 페이지가 만들어 낸 텍스트를 저장소 안 지정 경로에 쓴다.
    # catalog.json 처럼 "게임 코드가 진실이고 파일은 그 사본"인 산출물을 뽑는 데 쓴다.
    def _write_file(self):
        body = self._body()
        rel = posixpath.normpath(body.get('path', '')).lstrip('/')
        parts = [p for p in rel.split('/') if p and p != '..']
        if not parts:
            self.send_error(400); return
        out = os.path.join(ROOT, *parts)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(body.get('text', ''))
        self._ok({'ok': True, 'path': out, 'bytes': os.path.getsize(out)})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    print('serving %s on http://127.0.0.1:%d   shots -> %s' % (ROOT, port, os.path.abspath(SHOTS)))
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
