# 아트 파이프라인 — 나노바나나2

```
나노바나나2 (시트 1장 생성)  →  tools/sheet-studio.html (키잉·N등분·QC)  →  art/art.js  →  python build.py
```

아트가 없으면 게임은 **아무 말 없이 벡터 전차로 돈다.** 아트는 전제가 아니라 덧칠이다.
`render/art.js` 가 실패한 항목만 벡터로 되돌리므로, 열 대 중 세 대만 그려도 그 세 대만 스프라이트가 된다.

---

## 규칙 네 가지

**0. 시점이 가장 자주 깨진다. 그래서 프롬프트 맨 앞에 둔다.**
실제로 시트 A는 3/4 투시, 시트 B는 **정면도**로 나온 적이 있다. 같은 프롬프트, 같은 문장이었는데 갈렸다.
원인은 `straight-on orthographic SIDE elevation` — 모델이 `straight-on` 을 한 번은 "비스듬히 정직하게",
한 번은 "정면으로" 읽었다. 두 시트를 맞추려던 문장이 오히려 갈라놓은 것이다.

시점은 취향 문제가 아니다. 게임은 차체를 지형 경사에 따라 회전시키고 좌우로 뒤집으며,
포신을 2D 평면에서 따로 돌려 그린다. **정측면이 아니면 이 셋이 전부 어긋난다.**
아래 프롬프트의 `CAMERA` 문단은 반드시 편성 목록보다 **앞**에 둔다.

**1. 포신을 그리지 마라.**
포신은 각도에 따라 회전해야 해서 `render/draw.js` 가 차체 뒤에 따로 그린다.
시트에 포신이 있으면 포신이 두 개인 전차가 된다. **차체와 궤도만.**

**2. 한 장에 다섯 대를 같이 그린다.**
다섯 번 따로 생성하면 조명·재질·비례가 매번 어긋나고, 그 불일치는 같은 화면에 올렸을 때 바로 티가 난다.
한 이미지 안에 넣으면 모델이 알아서 내부 일관성을 맞춘다.
열 대를 한 장에 넣지 않는 이유는 반대다 — 열 개가 되면 개별 해상도가 떨어져 32px 궤도가 뭉갠다.

> 다섯 대·한 행은 **권장이지 요구가 아니다.** 시트 스튜디오는 행 수와 개수를 자동으로 잡고,
> 어느 조각을 어느 전차로 쓸지는 사람이 고른다. 7대 2행이 나와도, 같은 행이 두 번 반복돼도 그대로 쓰면 된다.
> 남는 개체는 &lsquo;사용 안 함&rsquo;으로 두면 된다 — **모델에게 정확한 개수를 강요하느라 재생성하는 것이 언제나 더 비싸다.**

**3. 시트 안에서 폭 순서를 지킨다.**
게임은 전차 폭으로 무게와 체력을 읽게 만들어져 있다(`logic/tanks.js` 의 `shape.hull`).
그림이 이 순서를 어기면 플레이어가 상대를 잘못 읽는다.

**4. 카툰 스타일 + 눈 (포트리스 참조).**
사실적 금속 질감 대신 **둥글고 읽기 쉬운 카툰 군용 하드웨어**로 그린다.
각 전차 앞쪽(진행 방향)에 **큼직한 눈 한 개**를 넣는다 — 흰자 + 검은 동공 + 작은 하이라이트.
눈은 포탑 링 앞, 차체 상단에 붙인다. 표정은 중립~살짝 씩씩한 정도.
스타일 키워드 예: `chunky cartoon military hardware, Fortress / Worms style, big expressive eye on the front of the hull, clean readable shapes, soft cel shading, no realistic metal scratches`.

---

## 시트 A — 경량·중형 5종

폭 순서: 스팅어 38 < 팬텀 40 = 제피르 40 < 노바 42 < 레이븐 44 (px, 게임 내 차체 폭)

```
CAMERA — READ THIS FIRST AND OBEY IT ABOVE EVERYTHING ELSE:
Pure flat LEFT-SIDE PROFILE, like a technical blueprint elevation drawing.
The viewer stands directly beside each vehicle, at hull mid-height.
You must NOT see the front of any vehicle. You must NOT see the top deck. You must NOT see the rear.
Exactly ONE track run is visible per vehicle — the near side only.
The far-side track is completely hidden behind the hull.
No perspective, no vanishing point, no foreshortening, no three-quarter angle, no isometric view.
Every vehicle is roughly TWICE AS WIDE AS IT IS TALL.

A single wide sheet showing five battle tank hulls in one horizontal row,
evenly spaced with clear empty gaps between them, all facing RIGHT,
left to right in this exact order:

1. STINGER  — the smallest and lowest. A lean scout hull on four small road wheels,
              flat sloped deck, thin armor plates, a low turret ring. Narrowest of all.
2. PHANTOM  — a light stealth hull on five wheels, faceted angular plating,
              a raised sensor cowl behind the turret ring. Slightly wider than the scout.
3. ZEPHYR   — a long-range light hull on four large wheels, tall thin side skirts,
              two folded aerial masts lying flat along the rear deck.
4. NOVA     — a mid-weight hull on five wheels, heavy front glacis plate,
              exposed capacitor coils and heat fins along both flanks.
5. RAVEN    — the widest here. A balanced mid hull on five wheels, boxy missile-guidance
              module bolted on the rear deck, small radar dish folded down flat.

CRITICAL: every vehicle has an EMPTY turret ring — a bare circular mount on top of the hull.
NO gun barrel, NO cannon, NO missile tube, NO weapon of any kind protruding from any vehicle.
The mount is empty and clearly visible.

Style: chunky cartoon military hardware in Fortress / Worms style, clean readable shapes,
soft cel shading, single unified material treatment across all five.
Each hull has ONE big expressive cartoon eye (white sclera + black pupil + tiny highlight)
on the front upper side of the hull, facing the direction of travel. No realistic metal scratches.
Lighting: one single key light from the upper LEFT on every vehicle, soft shadow side on the right.
Identical lighting direction and intensity across all five. No rim light from the right.
Camera: exactly as specified at the top — flat side profile, one visible track run, twice as wide as tall.

All five rest their tracks on one common invisible ground line.
Heights stay within a narrow band — these are all light-to-medium vehicles.
Widths must increase left to right in the order listed.

Background: completely flat uniform chroma magenta (#E0179B), no gradient, no vignette, no texture.
No magenta, pink, or purple anywhere on the vehicles themselves.
No cast shadows, no ground plane, no base or platform under the vehicles.
No text, no insignia lettering, no frame, no border.

Aspect ratio 3:1, highest resolution available.
```

## 시트 B — 중량·특수 5종

**CAMERA 문단을 통째로, 한 글자도 바꾸지 않고 맨 앞에 붙인다.** Style / Lighting / Background 도 같다.
바꾸는 것은 편성 목록과 폭 순서 문장뿐이다.

시트 B는 실제로 정면도로 나온 적이 있다. **두 시트를 따로 생성하면 시점이 갈릴 위험이 항상 있으므로,
받은 즉시 두 장을 나란히 놓고 눈으로 비교한다.** 한 장이라도 정측면이 아니면 그 장만 다시 만든다.
시트 스튜디오의 *가로세로비(시점)* 검사가 이걸 자동으로 잡는다 — 정측면 1.8~2.8, 3/4 투시 1.4~1.8, 정면도 1.0~1.3.

폭 순서: 볼케이노 46 < 드릴러 48 = 크라켄 48 < 타이탄 52 < 가디언 54

```
1. VOLCANO  — a squat bombardment hull on five wheels, wide flat deck built to carry
              a mortar, thick fenders, scorch staining around the turret ring.
2. DRILLER  — an engineering hull on six wheels, aggressive toothed track guards,
              a heavy hydraulic ram folded against the front glacis, reinforced nose.
3. KRAKEN   — a wide multi-launch hull on five wheels, honeycomb cell block low on the
              rear deck, thick cable runs along both flanks.
4. TITAN    — a heavy assault hull on six large wheels, deep sloped front armor,
              layered applique plates, tall hull sides. Second widest.
5. GUARDIAN — the widest and heaviest. A bunker-like hull on six wheels, slab armor skirts
              covering the entire running gear, blast deflector ridges on the deck.

Widths must increase left to right in the order listed; GUARDIAN is clearly the broadest.
Heights stay within a narrow band — these are all heavy vehicles, all taller than a scout.
```

## 시트 C — 보조 무기 아이콘 10종 (선택)

HUD 무기 버튼에 얹힌다. 없으면 버튼은 글자만 나온다.

```
A single sheet showing ten circular weapon emblem icons arranged in two rows of five,
evenly spaced with clear empty gaps, each icon a flat circular badge:

Row 1: 1. three small missiles fanning outward from one point (swarm)
       2. one massive armor-piercing dart with a splitting crack (breaker)
       3. seven small bomblets raining down in an arc (cluster rain)
       4. a drill bit boring through a layered rock cross-section (earth borer)
       5. four thin darts in a tight volley spread (rapid volley)
Row 2: 6. a wide concentric shockwave ring pushing a small block sideways (concussion)
       7. a single missile bending in a hooked curve toward a crosshair (hunter)
       8. nine specks scattering in a wide spiral (maelstrom)
       9. a dense star burst with sharp radiating spikes (supernova)
      10. a dart riding three swept wind streaks (tempest)

Style: flat two-tone vector emblems, thick confident strokes, no gradients, no 3D shading.
Each emblem uses warm amber (#C9A227) shapes on a dark slate (#1A222D) circular field.
Identical stroke weight, identical circle diameter, identical inner margin on all ten.
Camera: straight-on flat, no perspective.

Background outside the circles: completely flat uniform chroma magenta (#E0179B),
no gradient, no texture. No magenta or pink inside the emblems.
No text, no numbers, no frame, no border.

Aspect ratio 5:2, highest resolution available.
```

---

## 배경색을 이 색으로 고른 이유

배경은 **말/차체에 절대 안 쓰이는 색**으로 골라야 키잉이 대상을 먹지 않는다.
전차 팔레트는 청록·갈색·황금·연두로 짜여 있고, 마젠타는 그 어디에도 없다.

| 배경 | 가장 가까운 전차 색 | RGB 거리 |
|---|---|---|
| `#E0179B` 마젠타 | 볼케이노 트림 `#FF6B6B` | 102 |
| | 팬텀 트림 `#C79BFF` | 167 |
| | 타이탄 스킨 `#6B4A2E` | 216 |

**거리 100 아래로 내려가면 안 된다.** 그 아래부터 배경을 지우다 차체 색까지 먹는다.
프롬프트에 `No magenta, pink, or purple anywhere on the vehicles` 를 반드시 남겨 둔다 —
이 한 줄이 생성 단계에서 거리를 벌어 준다.

## 배경 제거 강도

**권장 32~42. 기본값 36에서 시작한다.** (시트 스튜디오 상태줄의 *실루엣 잠식률* 을 본다)

강도를 올려도 **궤도 사이나 차체 밑처럼 갇힌 구멍은 뚫리지 않는다.** 배경 제거는 네 모서리에서
색이 비슷한 곳을 따라 번져 나가는 방식이라 사방이 막힌 구멍에는 애초에 닿지 않는다.
거기서 강도를 90까지 올리면 구멍이 뚫리는 게 아니라 **차체 실루엣이 깎인다.**

| 증상 | 조치 |
|---|---|
| 배경이 덜 지워짐 | 강도를 42까지만 올린다. 그래도 남으면 배경 chroma 를 바꿔 재생성 |
| 궤도 사이가 안 뚫림 | 강도를 올리지 않는다. `갇힌 구멍 N개 제거` 표시를 확인 |
| 차체가 얇아지거나 뜯김 | 강도를 낮춘다. 잠식률이 0%에 가깝게 |

## 탈락했을 때 무엇을 고칠 것인가

**프롬프트를 통째로 다시 쓰지 말고 해당 줄만 고친다.**

| 탈락 항목 | 실제 원인 | 프롬프트 수정 |
|---|---|---|
| **가로세로비 1.0~1.3** | **정면도로 나왔다** (실제 발생) | `CAMERA` 문단을 맨 앞으로. `You must NOT see the front` 와 `ONE track run is visible` 를 반드시 포함 |
| **가로세로비 1.4~1.8** | **3/4 투시로 나왔다** (실제 발생) | 같은 문단에 `no three-quarter angle, no isometric` 과 `TWICE AS WIDE AS IT IS TALL` 유지 |
| **차체 위로 무기가 튀어나옴** | 대공포·미사일 박스·레이더 접시 (실제 발생) | 그 개체만 &lsquo;사용 안 함&rsquo;으로 두고 다른 개체를 쓴다. 다시 뽑을 거면 `nothing may protrude above the hull deck` 추가 |
| 차량 개수가 안 맞음 | — | **재생성하지 않는다.** 스튜디오가 개수·행 수를 자동으로 잡는다. 남는 건 안 쓰면 된다 |
| 차체끼리 붙어서 한 조각으로 잘림 | 간격 부족 | `evenly spaced with clear empty gaps` 강조, `no overlapping vehicles` 추가 |
| 조각에 반짝이 별표가 섞임 | 생성기 워터마크(✦)가 구석에 찍힘 | **수정 불필요.** 스튜디오가 워터마크만 있는 행을 통째로 버린다 |
| **한 행이 통째로 조각 하나가 됨** | 시트에 **가로 접지선이 실제로 그려짐** (실제 발생) | **수정 불필요.** `invisible ground line` 이라고 써도 모델이 선을 그리는 일이 잦아, 스튜디오가 열 높이 6% 미만인 가로선은 무시하도록 되어 있다 |
| 배경 균일도 σ 초과 | 모델이 그라데이션·비네트를 넣음 | `flat uniform` 앞에 `absolutely` 추가, `studio backdrop` 같은 단어 제거 |
| 헤일로 제거 비율 초과 | 차체 색이 배경색과 가까움 | 배경 chroma 를 반대편 색상으로 교체 |
| 실루엣 평균 IoU 초과 | 다섯이 다 비슷한 상자 | 각 차량의 **형태 클래스**를 명시 — 낮음/각짐/스커트/육중을 서로 겹치지 않게 |
| 최악 쌍 IoU 초과 | 특정 두 대가 닮음 (대개 타이탄/가디언) | 그 둘의 종횡비를 정반대로 지시. 타이탄은 `tall hull sides`, 가디언은 `slab skirts covering the running gear` |
| 조명 방향 불일치 | 일부가 반대편에서 조명 | `Identical lighting direction ... No rim light from the right` 줄을 맨 앞으로 이동 |
| **포신이 달려 나옴** | 모델이 전차의 상식을 따름 | `CRITICAL: EMPTY turret ring` 문단을 **편성 목록보다 앞으로** 옮기고 대문자 유지 |

포신 문제는 가장 자주 나온다. 모델에게 전차는 포신이 있는 물건이기 때문이다.
두 번 실패하면 문장을 바꾸지 말고 **위치를 옮겨라** — 프롬프트 맨 앞이 가장 강하다.

---

## art.js 형식

시트 스튜디오가 뱉는 파일을 `art/art.js` 로 두면 `python build.py` 가 알아서 인라인한다.

```js
/* art/art.js */
window.TFArtSrc = {
  tanks: {
    raven:    "data:image/png;base64,...",
    titan:    "data:image/png;base64,...",
    volcano:  "data:image/png;base64,...",
    driller:  "data:image/png;base64,...",
    stinger:  "data:image/png;base64,...",
    guardian: "data:image/png;base64,...",
    phantom:  "data:image/png;base64,...",
    kraken:   "data:image/png;base64,...",
    nova:     "data:image/png;base64,...",
    zephyr:   "data:image/png;base64,..."
  },
  weapons: {                       // 선택. 없으면 버튼은 글자만 나온다
    swarm: "data:image/png;base64,...", breaker: "...", rain: "...", mole: "...",
    volley: "...", bulwark: "...", hunter: "...", maelstrom: "...",
    novaburst: "...", tempest: "..."
  }
};
```

**전차 id 는 `logic/tanks.js` 의 `id` 와 정확히 같아야 한다.** 오타가 나면 그 전차만 벡터로 남는다 —
오류는 나지 않고 조용히 벡터가 된다. 열 대 중 한 대만 벡터로 보이면 이 이름부터 확인한다.

## 스프라이트 배치 규격

`render/draw.js` 가 이렇게 그린다.

- 가로 **66px** 로 강제 축소, 세로는 원본 비율 유지
- 가로 중심 = 전차 중심, **바닥 = 전차 원점 + 4px** (궤도가 지면에 살짝 묻힌다)
- 차체는 `tilt`(지형 경사)와 `dir`(좌우 반전)을 따라 회전·반전된다

따라서 시트에서 잘라낸 이미지는 **궤도 바닥이 이미지 아래 끝에 닿아 있어야 한다.**
아래쪽에 여백이 남으면 전차가 공중에 뜬다. 시트 스튜디오의 바운딩 박스 크롭이 이걸 처리하지만,
수동으로 자를 거면 반드시 확인한다.

**가로 크기는 시트가 정하지 않는다.** `render/draw.js` 가 각 전차의 차체 폭(`logic/tanks.js` 의 `hull`)에
맞춰 다시 잰다. 그래서 조각을 균일한 크기로 맞춰 내보내면 안 된다 —
스팅어와 가디언이 같은 크기로 그려져 폭으로 무게를 읽게 만든 설계가 무너진다.
시트 스튜디오는 각 조각을 **자기 종횡비 그대로** 잘라 낸다.
