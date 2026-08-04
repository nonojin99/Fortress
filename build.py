# build.py — logic/render/net 을 shell.html 에 인라인해 단일 파일 게임을 만든다.
#   python build.py
# 이 저장소에는 node 가 없어서 build.js 대신 이 경로를 쓴다. 하는 일은 같다.
# 로직을 HTML 에 직접 복붙하면 검증 스크립트(sim/test.js)와 실제 화면이 갈라진다. 반드시 이 경로만 쓴다.
import os, sys, io

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_LOCAL = os.path.join(ROOT, 'index.html')
OUT_REPO = os.path.abspath(os.path.join(ROOT, '..', '..', 'tank-fortress.html'))

FILES = [
    'logic/core.js',
    'logic/terrain.js',
    'logic/maps.js',
    'logic/weapons.js',
    'logic/tanks.js',
    'logic/physics.js',
    'logic/items.js',
    'logic/match.js',
    'logic/ai.js',
    'net/room.js',
    'net/supabase-transport.js',
    'render/art.js',
    'render/fx.js',
    'render/draw.js',
    'render/app.js',
]

def read(p):
    with io.open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

def inline_safe(text):
    """인라인 <script> 안에 넣어도 안전하게 만든다.

    HTML 파서는 스크립트 내용을 파싱하지 않고 그냥 첫 `</script` 에서 블록을 끊는다.
    주석이든 문자열이든 상관없다. net/supabase-transport.js 의 사용법 주석에
    `<script src=...>` 예시가 들어 있어서, 이걸 처리하지 않으면 빌드된 게임이 그 지점에서
    통째로 잘려 나간다 — 콘솔에는 오류 하나 안 뜬다. 조용히 깨지는 종류라 반드시 여기서 막는다.
    """
    return text.replace('</script', '<\\/script')


def check_comments(text, path):
    """블록 주석의 짝을 센다.

    실제로 주석을 닫은 뒤에 본문을 더 붙여 `*/` 가 하나 남은 적이 있다.
    브라우저는 SyntaxError 를 내고 번들 전체가 죽는데, 화면에는 빈 페이지만 뜨고
    콘솔에도 안 잡히는 경우가 있어 원인을 찾는 데 한참 걸린다. 여기서 먼저 막는다.
    문자열·정규식 안의 기호까지 따지지는 않는다 — 이 저장소 코드에는 그런 게 없고,
    완전한 파서를 여기에 넣을 이유도 없다.
    """
    depth, i, n = 0, 0, len(text)
    while i < n - 1:
        two = text[i:i + 2]
        if two == '/*':
            depth += 1; i += 2; continue
        if two == '*/':
            depth -= 1
            if depth < 0:
                sys.exit('빌드 중단: %s 에 짝 없는 */ 가 있습니다 (%d번째 글자 근처)' % (path, i))
            i += 2; continue
        i += 1
    if depth != 0:
        sys.exit('빌드 중단: %s 의 블록 주석이 닫히지 않았습니다' % path)


parts = []
for f in FILES:
    src = read(f)
    check_comments(src, f)
    parts.append('/* ===== %s ===== */\n%s' % (f, inline_safe(src)))
bundle = '\n'.join(parts)

shell = read('shell.html')
if '<!--SCRIPTS-->' not in shell:
    sys.exit('shell.html 에 <!--SCRIPTS--> 자리표시자가 없습니다')

# art.js 는 선택이다. 있으면 로직보다 먼저 실려 스프라이트를 얹고, 없으면 조용히 벡터로 돈다.
art_tag = ''
art_path = os.path.join(ROOT, 'art', 'art.js')
if os.path.exists(art_path):
    with io.open(art_path, encoding='utf-8') as f:
        art_tag = '<script>\n%s\n</script>\n' % inline_safe(f.read())
    print('art/art.js 포함  %.1f KB' % (os.path.getsize(art_path) / 1024))
else:
    print('art/art.js 없음 — 벡터 전차로 빌드')

out = shell.replace('<!--SCRIPTS-->', art_tag + '<script>\n' + bundle + '\n</script>')

# 잘려 나간 빌드를 내보내지 않는다.
# 블록을 끊을 수 있는 것은 `</script` 뿐이다 — 주석 속 `<script src=...>` 는 아무 힘이 없으므로 세지 않는다.
if '</script' in bundle:
    sys.exit('빌드 중단: 번들에 이스케이프되지 않은 </script 가 남아 있습니다')
# 번들 맨 끝 모듈까지 살아 있는지 확인한다. escape 가 언젠가 우회당해도 여기서 걸린다.
for marker in ('TFCore', 'TFTerrain', 'TFMatch', 'TFArt', 'TFApp'):
    if marker not in out:
        sys.exit('빌드 중단: %s 가 산출물에 없습니다 — 번들이 잘렸습니다' % marker)

for path in (OUT_LOCAL, OUT_REPO):
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('%s  %.1f KB' % (os.path.relpath(path, ROOT), len(out.encode('utf-8')) / 1024))

# 개발용 — 스크립트를 따로 불러 브라우저 디버거에서 원본 줄 번호가 보이게 한다
dev = shell.replace('<!--SCRIPTS-->',
                    '\n'.join('<script src="%s"></script>' % f for f in FILES))
with io.open(os.path.join(ROOT, 'dev.html'), 'w', encoding='utf-8') as f:
    f.write(dev)
print('dev.html  (원본 스크립트 분리 로드)')
