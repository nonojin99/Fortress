"""툴셋이 주고받는 구조체.

전부 catalog.json(전차·무기·맵 표)과 맵 사양을 그대로 옮긴 형태다.
필드 이름은 게임 쪽 이름을 따르되 파이썬 표기로만 바꿨다 — 두 이름표를 유지하면 언젠가 갈라진다.
"""

import unreal


@unreal.ustruct()
class TankFortTank(unreal.StructBase):
    """전차 한 종의 성능표."""

    tank_id = unreal.uproperty(str)
    """logic/tanks.js 의 id. 아트 파일명과 스프라이트 슬롯 키가 이 값이다."""

    display_name = unreal.uproperty(str)
    role = unreal.uproperty(str)
    """설계 역할: 유도 · 집중 · 범위 · 돌파 · 속사 · 방어 · 장거리."""

    hp = unreal.uproperty(int)
    armor = unreal.uproperty(float)
    """받는 피해 감쇠율. 0.0~1.0."""

    mass = unreal.uproperty(float)
    """넉백 저항. 1.0 이 표준. 클수록 덜 밀린다."""

    fuel = unreal.uproperty(int)
    """한 턴 이동 가능량. 1 = 수평 1px."""

    climb = unreal.uproperty(int)
    """넘을 수 있는 단차(px). 이보다 높으면 벽으로 막힌다."""

    power_mul = unreal.uproperty(float)
    """같은 게이지에서 나가는 포구 초속 배율."""

    angle_min = unreal.uproperty(float)
    angle_max = unreal.uproperty(float)
    """포신 각도 한계(도). 직사형은 최대각이 낮아 언덕을 못 넘는다."""

    main_weapon = unreal.uproperty(str)
    sub_weapon = unreal.uproperty(str)
    hull_width = unreal.uproperty(float)
    """차체 폭(px). 아트 시트의 크기 위계가 이 순서를 따라야 한다."""

    note = unreal.uproperty(str)


@unreal.ustruct()
class TankFortWeapon(unreal.StructBase):
    """무기 한 종의 성능표."""

    weapon_id = unreal.uproperty(str)
    display_name = unreal.uproperty(str)

    kind = unreal.uproperty(str)
    """main(무한 탄약) · sub(제한 탄약) · child(분열체, 직접 선택 불가)."""

    weapon_type = unreal.uproperty(str)
    """유도 · 범위 · 돌파 · 집중 · 표준."""

    damage = unreal.uproperty(float)
    """폭심 피해. 반경 끝에서 25%까지 감쇠한다."""

    radius = unreal.uproperty(float)
    """폭발 반경(px). 지형이 파이는 반경이기도 하다."""

    push = unreal.uproperty(float)
    """넉백 계수. 낙사 맵에서는 damage 보다 중요하다."""

    delay = unreal.uproperty(int)
    """턴 딜레이. 누적 딜레이가 가장 낮은 전차가 다음에 쏜다. child 는 0."""

    ammo = unreal.uproperty(int)
    """sub 무기의 소지 탄수. main·child 는 0(무제한 또는 해당 없음)."""

    shots = unreal.uproperty(int)
    split_count = unreal.uproperty(int)
    """분열 자탄 수. 0 이면 분열하지 않는다."""

    homing = unreal.uproperty(bool)
    drill_px = unreal.uproperty(float)
    """지형에 박힌 뒤 더 파고드는 거리(px). 0 이면 착탄 즉시 폭발."""

    effective_value = unreal.uproperty(float)
    """(기대 피해 + 넉백 환산) / 딜레이. 밸런스 감사의 단일 지표."""

    description = unreal.uproperty(str)


@unreal.ustruct()
class TankFortMapOp(unreal.StructBase):
    """전장 지형을 만드는 연산 하나. logic/terrain.js 가 순서대로 적용한다."""

    op = unreal.uproperty(str)
    """gap · cave · island · pillar · arch · roughen."""

    center_x = unreal.uproperty(float)
    """맵 폭에 대한 비율(0.0~1.0). gap 은 이 값 대신 span_x0/span_x1 을 쓴다."""

    center_y = unreal.uproperty(float)
    """맵 높이에 대한 비율(0.0~1.0)."""

    radius_x = unreal.uproperty(float)
    """px. pillar 는 기둥 폭, arch 는 다리 반길이로 읽힌다."""

    radius_y = unreal.uproperty(float)
    span_x0 = unreal.uproperty(float)
    """gap 전용. 절대 px."""

    span_x1 = unreal.uproperty(float)


@unreal.ustruct()
class TankFortMapSpec(unreal.StructBase):
    """전장 한 판의 사양. logic/maps.js 의 항목 하나에 대응한다."""

    map_id = unreal.uproperty(str)
    display_name = unreal.uproperty(str)
    width = unreal.uproperty(int)
    height = unreal.uproperty(int)

    gravity = unreal.uproperty(float)
    """px/s². 표준 540. 사거리표를 통째로 바꾸는 값이다."""

    wind_max = unreal.uproperty(float)
    """매 턴 재추첨되는 바람 세기의 최대 절댓값."""

    base = unreal.uproperty(float)
    """지표 평균 높이 비율. 1.0 을 넘으면 그 맵은 바닥이 없다(부유 전장)."""

    void_y = unreal.uproperty(float)
    """이 y 아래로 떨어지면 낙사(px)."""

    settles = unreal.uproperty(bool)
    """파인 자리 위의 흙이 무너지는가."""

    ops = unreal.uproperty(unreal.Array(TankFortMapOp))
    note = unreal.uproperty(str)


@unreal.ustruct()
class TankFortBalanceReport(unreal.StructBase):
    """전차·무기 표 감사 결과. 게임을 돌리지 않고 표만 보고 낼 수 있는 판정이다."""

    weapon_value_min = unreal.uproperty(float)
    weapon_value_max = unreal.uproperty(float)
    weapon_value_spread = unreal.uproperty(float)
    """최대/최소 비. 2.2 를 넘으면 특정 무기가 지배적이라는 뜻이다."""

    weakest_weapon = unreal.uproperty(str)
    strongest_weapon = unreal.uproperty(str)

    missing_weapon_types = unreal.uproperty(unreal.Array(str))
    """기획이 요구한 4분류(유도·범위·돌파·집중) 중 표에 없는 것."""

    problems = unreal.uproperty(unreal.Array(str))
    """사람이 읽고 고칠 수 있는 문장. 비어 있으면 표는 건강하다."""
