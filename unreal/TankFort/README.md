# TankFort Tools — 언리얼 에디터 툴셋

강철 포화의 전차·무기 표를 조회·감사하고, 전장 배치를 레벨에서 편집해 맵 사양으로 내보낸다.
`ToolsetRegistry` 에 등록되어 unreal-mcp 로 노출되므로, 에디터 안의 에이전트가 직접 호출할 수 있다.

> ⚠ **이 툴셋은 언리얼 에디터에서 실행 검증하지 못했다.**
> 제작 환경에 언리얼 프로젝트가 없어 `list_toolsets` / `describe_toolset` 조회도, 테스트 실행도 하지 못했다.
> 코드는 문서화된 `unreal` 파이썬 API 를 기준으로 작성됐고, 테스트도 함께 들어 있지만 **한 번도 돌지 않았다.**
> 처음 붙일 때 아래 "처음 켤 때" 절차를 그대로 밟고, 실패하면 그 지점부터 고치면 된다.

---

## 왜 파이썬인가

`create-toolset` 스킬의 기본 권고를 따랐다. 이 툴셋이 하는 일은 JSON 읽기, 액터 스폰과 트랜스폼 읽기,
파일 쓰기뿐이고 셋 다 파이썬 스텁에 다 있다. C++ 로 갈 이유는 스텁에 없는 API 가 필요할 때인데
여기엔 그런 게 없다. 반복 속도만 손해다.

**C++ 로 옮겨야 할 때**: 지형 마스크를 프로시저럴 메시로 실시간 미리보기 하거나,
스폰한 액터에 커스텀 컴포넌트를 붙여야 할 때. 그때는 `TankFortMapToolset` 만 C++ 로 내리면 된다.

## 설치

1. 이 폴더(`TankFort/`)를 프로젝트의 `Plugins/` 아래에 둔다.
2. **Edit → Project Settings → Plugins → Python** 에서
   - **Developer Mode** 켜기 (스텁 생성 — 툴셋 작업에는 사실상 필수)
   - **Enable Remote Execution** 켜기 (테스트 재로드에 필요)
3. 에디터를 다시 시작한다. `init_unreal.py` 가 툴셋을 등록한다.

## 처음 켤 때

```
1) MCP 로 list_toolsets  →  TankFortCatalogToolset, TankFortMapToolset 이 보이는가
2) describe_toolset TankFortCatalogToolset  →  툴 7개의 스키마가 나오는가
3) load_catalog(<저장소>/tank-src/tankfort/docs/catalog.json)
      → "전차 10종 · 무기 25종 · 맵 10종"
4) audit_balance()  →  problems 가 빈 목록인가
```

3번에서 막히면 `catalog.json` 이 없는 것이다. 게임 저장소에서 개발 서버를 띄우고
`tools/export-catalog.html` 을 한 번 열면 만들어진다.

## 툴셋 둘

### TankFortCatalogToolset — 전차·무기 표

읽기 전용이다. **표의 진실은 게임 저장소의 `logic/tanks.js` · `logic/weapons.js` 이고
`catalog.json` 은 그 사본이다.** 여기서 값을 고칠 수 있게 만들면 두 개의 진실이 생기고, 반드시 갈라진다.
그래서 setter 가 없다.

| 툴 | 하는 일 |
|---|---|
| `load_catalog` | 카탈로그를 올린다. 다른 툴보다 먼저 불러야 한다 |
| `list_tanks` / `get_tank` | 전차 조회 |
| `list_weapons` / `get_weapon` | 무기 조회 (kind·type 로 거를 수 있다) |
| `get_tank_loadout` | 전차가 실제로 드는 무기 두 종 |
| `audit_balance` | 표만 보고 낼 수 있는 판정 전부 |

`audit_balance` 가 잡는 것:

- 무기 실효값 편차가 2.2배를 넘는가 (특정 무기가 지배적인가)
- 기획이 요구한 4분류(유도·범위·돌파·집중)가 다 있는가
- 보조 무기에 탄약 제한이 걸려 있는가, 메인에 잘못 걸려 있지 않은가
- 없는 무기를 가리키는 전차가 있는가
- **차체가 넓은데 체력이 낮은 전차가 있는가** — 실루엣이 성능을 거짓말하면 플레이어가 상대를 잘못 읽는다

궤적·명중·승패는 **여기서 계산하지 않는다.** 그건 `sim/test.js` 가 실제 물리로 돌린다.
같은 물리를 파이썬으로 다시 쓰면 두 구현이 갈라지고, 갈라진 순간 이 툴의 판정은 거짓말이 된다.

### TankFortMapToolset — 전장 배치

전장 사양의 `ops` 배열을 레벨 액터로 펼쳐 마우스로 옮기고, 다시 사양으로 거둔다.
**지형 생성기 자체는 게임(`logic/terrain.js`)에 있고 여기서 흉내내지 않는다.**
이 툴셋이 다루는 것은 생성기에 넘길 지시서다 — 절벽을 어디에 낼지, 기둥을 몇 개 세울지.

| 툴 | 하는 일 |
|---|---|
| `load_map_spec` | 카탈로그에서 전장 하나를 읽는다 |
| `spawn_map_layout` | 연산마다 상자 액터 하나를 레벨에 놓는다 |
| `read_map_layout` | 액터를 읽어 사양으로 되돌린다 |
| `clear_map_layout` | 펼친 액터를 지운다 |
| `validate_map_spec` | 플레이 가능한 사양인지 검사한다 |
| `export_map_spec` | `logic/maps.js` 에 붙여 넣을 형태로 파일에 쓴다 |

전형적인 작업 흐름:

```
load_map_spec(catalog, "canyon")
  → spawn_map_layout(spec)
  → (에디터에서 상자를 드래그해 절벽 위치와 기둥 높이를 조정)
  → read_map_layout(spec)
  → validate_map_spec(spec)          # 통과 못 하면 export 가 거부한다
  → export_map_spec(spec, "canyon.js")
  → 내용을 logic/maps.js 에 붙여 넣고 python build.py
```

**좌표계**: 게임은 2D 이고 y 가 아래로 커진다. 언리얼에서는 XZ 평면에 눕힌다 —
게임 `(x, y)` → 언리얼 `(x·scale, 0, -y·scale)`. 기본 `world_scale` 은 5.0 이라
2400px 전장이 12000uu 가 되어 에디터에서 다루기 좋은 크기가 된다.
`read_map_layout` 에는 **`spawn_map_layout` 때와 같은 scale** 을 넘겨야 한다.

**액터 라벨을 바꾸면 안 된다.** 연산 종류를 라벨의 마지막 토막(`TF_canyon_03_pillar`)에서 읽는다.

## 테스트

```
# 라이브 에디터 (권장)
DiscoverTests  →  ListTests(filter="TankFort")  →  RunTests  →  GetTestResults

# 파이썬을 고친 뒤에는 반드시 리로드 후 force_rediscover
python Engine/Plugins/Experimental/ToolsetRegistry/Content/Python/toolset_registry/tests/reload_remote.py TankFort
```

테스트는 실제 `catalog.json` 을 읽지 않는다. 그 파일은 밸런싱에 따라 계속 바뀌고,
표가 바뀔 때마다 툴셋 테스트가 깨지면 테스트가 아니라 알람이 된다.
`tests/fixtures.py` 의 최소 표를 쓴다.

`TankFortMapToolset` 테스트는 레벨에 액터를 만든다. 에디터 컨텍스트가 필요하고,
비어 있는 레벨에서 돌리는 게 안전하다. 각 테스트는 `addCleanup` 으로 자기가 만든 액터를 지운다.

## 알려진 한계

- **지형 미리보기가 없다.** 배치 상자는 지시서를 보여 줄 뿐 실제 파괴 지형이 아니다.
  실물을 보려면 게임 쪽 `tools/devserver.py` + `dev.html` 이 빠르다.
- **`roughen` 연산은 왕복이 정확하지 않다.** 난수로 파편을 뿌리는 연산이라
  액터 하나로 표현할 수 없다. 개수·크기만 상자로 잡고 분포는 시드가 정한다.
- **스폰 지점(`spawn`)은 다루지 않는다.** 지형이 바뀌면 게임이 알아서 평평한 자리를 다시 고른다.
