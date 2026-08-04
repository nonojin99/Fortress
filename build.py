# build.py — logic/render/net 을 shell.html 에 인라인해 단일 파일 게임을 만든다.
#   python build.py
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
    return text.replace('</script', '<\\/script')

parts = []
for f in FILES:
    parts.append('/* ===== %s ===== */\n%s' % (f, inline_safe(read(f))))
bundle = '\n'.join(parts)

shell = read('shell.html')
if '<!--SCRIPTS-->' not in shell:
    sys.exit('shell.html 에 <!--SCRIPTS--> 자리표시자가 없습니다')

art_tag = ''
art_path = os.path.join(ROOT, 'art', 'art.js')
if os.path.exists(art_path):
    with io.open(art_path, encoding='utf-8') as f:
        art_tag = '<script>\n%s\n</script>\n' % inline_safe(f.read())
    print('art/art.js 포함  %.1f KB' % (os.path.getsize(art_path) / 1024))
else:
    print('art/art.js 없음 — 벡터 전차로 빌드')

out = shell.replace('<!--SCRIPTS-->', art_tag + '<script>\n' + bundle + '\n</script>')

if '</script' in bundle:
    sys.exit('빌드 중단: 번들에 이스케이프되지 않은 </script 가 남아 있습니다')
for marker in ('TFCore', 'TFTerrain', 'TFMatch', 'TFArt', 'TFApp'):
    if marker not in out:
        sys.exit('빌드 중단: %s 가 산출물에 없습니다 — 번들이 잘렸습니다' % marker)

for path in (OUT_LOCAL, OUT_REPO):
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('%s  %.1f KB' % (os.path.relpath(path, ROOT), len(out) / 1024.0))

# dev.html: 분리 로드용 복사본 유지
dev = os.path.join(ROOT, 'dev.html')
if os.path.exists(dev):
    print('dev.html  (원본 스크립트 분리 로드)')
