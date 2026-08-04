# 로컬에서 전체 소스 올리기

이 저장소에는 핵심 구조와 밸런스/네트워킹 파일이 올라가 있습니다.
아트 번들(`art/art.js`)과 빌드 산출물(`index.html`)은 용량 때문에 `.gitignore` 에 두었습니다.

## 전체 프로젝트 푸시 (로컬)

```bash
cd "C:\\Users\\nonoj\\AI Gen\\files\\files\\tank-src\\tankfort"
git init
git remote add origin https://github.com/nonojin99/Fortress.git
git fetch origin
git checkout -b main
# 또는 기존 원격 main 과 합치기
git add -A
git commit -m "feat: full TankFort source"
git push -u origin main
```

## 빌드

```bash
python build.py
```

`shell.html` 의 `window.TF_SUPABASE` 에 URL/KEY 를 채운 뒤 온라인 대전을 사용하세요.
