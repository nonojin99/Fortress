"""전차·무기 표를 읽고 감사하는 툴셋."""

import json
import os

import unreal
from toolset_registry import toolset_registry

from .types import TankFortBalanceReport, TankFortTank, TankFortWeapon

_REQUIRED_TYPES = ("유도", "범위", "돌파", "집중")
_VALUE_SPREAD_LIMIT = 2.2

# load_catalog 가 채운다. 툴 호출은 static 이므로 상태는 여기 모아 둔다.
_catalog = None
_catalog_path = ""


def _require_catalog() -> dict:
    if _catalog is None:
        raise RuntimeError("카탈로그가 아직 로드되지 않았습니다. 먼저 load_catalog 를 호출하세요.")
    return _catalog


@unreal.uclass()
class TankFortCatalogToolset(unreal.ToolsetDefinition):
    """강철 포화의 전차·무기 표를 다룬다. 표를 로드해 조회하고, 밸런스가 무너진 곳을 짚어 낸다.

    표의 진실은 게임 저장소의 logic/*.js 이고 이 툴셋이 읽는 catalog.json 은 그 사본이다.
    그래서 조회와 감사만 있고 쓰기가 없다 — 여기서 고친 값은 게임에 반영되지 않는다.
    """

    @toolset_registry.tool_call
    @staticmethod
    def load_catalog(catalog_path: str) -> str:
        """카탈로그 파일을 읽어 이후 호출이 쓸 수 있게 올린다.

        Args:
            catalog_path: docs/catalog.json 의 절대 경로.
                          게임 저장소에서 tools/export-catalog.html 로 생성한다.

        Returns:
            "전차 N종 · 무기 N종 · 맵 N종" 형태의 요약.
        """
        global _catalog, _catalog_path
        if not catalog_path:
            raise ValueError("catalog_path 가 비어 있습니다.")
        if not os.path.isfile(catalog_path):
            raise FileNotFoundError("카탈로그 파일이 없습니다: {}".format(catalog_path))

        with open(catalog_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        for key in ("tanks", "weapons", "maps"):
            if key not in data:
                raise ValueError("카탈로그에 '{}' 항목이 없습니다: {}".format(key, catalog_path))

        _catalog = data
        _catalog_path = catalog_path
        return "전차 {}종 · 무기 {}종 · 맵 {}종".format(
            len(data["tanks"]), len(data["weapons"]), len(data["maps"])
        )

    @toolset_registry.tool_call
    @staticmethod
    def list_tanks() -> list[TankFortTank]:
        """모든 전차를 표에 적힌 순서로 돌려준다."""
        return [_to_tank(row) for row in _require_catalog()["tanks"]]

    @toolset_registry.tool_call
    @staticmethod
    def get_tank(tank_id: str) -> TankFortTank:
        """전차 하나를 id 로 찾는다.

        Args:
            tank_id: logic/tanks.js 의 id (예: "titan").
        """
        for row in _require_catalog()["tanks"]:
            if row["id"] == tank_id:
                return _to_tank(row)
        raise LookupError("그런 전차가 없습니다: {}".format(tank_id))

    @toolset_registry.tool_call
    @staticmethod
    def list_weapons(kind: str = "", weapon_type: str = "") -> list[TankFortWeapon]:
        """무기를 조건에 맞춰 돌려준다.

        Args:
            kind: main · sub · child 중 하나. 비우면 전부.
            weapon_type: 유도 · 범위 · 돌파 · 집중 · 표준 중 하나. 비우면 전부.

        Returns:
            조건에 맞는 무기. 없으면 빈 목록.
        """
        rows = _require_catalog()["weapons"]
        if kind:
            rows = [r for r in rows if r["kind"] == kind]
        if weapon_type:
            rows = [r for r in rows if r["type"] == weapon_type]
        return [_to_weapon(r) for r in rows]

    @toolset_registry.tool_call
    @staticmethod
    def get_weapon(weapon_id: str) -> TankFortWeapon:
        """무기 하나를 id 로 찾는다.

        Args:
            weapon_id: logic/weapons.js 의 id (예: "novaburst").
        """
        for row in _require_catalog()["weapons"]:
            if row["id"] == weapon_id:
                return _to_weapon(row)
        raise LookupError("그런 무기가 없습니다: {}".format(weapon_id))

    @toolset_registry.tool_call
    @staticmethod
    def get_tank_loadout(tank_id: str) -> list[TankFortWeapon]:
        """전차가 실제로 들고 나가는 무기 두 종을 메인·보조 순으로 돌려준다.

        Args:
            tank_id: logic/tanks.js 의 id.
        """
        tank = TankFortCatalogToolset.get_tank(tank_id)
        return [
            TankFortCatalogToolset.get_weapon(tank.main_weapon),
            TankFortCatalogToolset.get_weapon(tank.sub_weapon),
        ]

    @toolset_registry.tool_call
    @staticmethod
    def audit_balance() -> TankFortBalanceReport:
        """표만 보고 낼 수 있는 밸런스 판정을 모아 돌려준다.

        검사하는 것: 무기 실효값 편차, 요구 4분류 누락, 보조 무기 탄약 제한,
        전차 폭과 체력의 역전, 존재하지 않는 무기 참조.

        Returns:
            problems 가 비어 있으면 표는 건강하다.
        """
        catalog = _require_catalog()
        weapons = catalog["weapons"]
        tanks = catalog["tanks"]
        problems: list[str] = []

        selectable = [w for w in weapons if w["kind"] in ("main", "sub")]
        if not selectable:
            raise ValueError("선택 가능한 무기가 표에 하나도 없습니다.")

        ranked = sorted(selectable, key=lambda w: w["effective_value"])
        weakest, strongest = ranked[0], ranked[-1]
        spread = strongest["effective_value"] / weakest["effective_value"] if weakest["effective_value"] else 0.0
        if spread > _VALUE_SPREAD_LIMIT:
            problems.append(
                "무기 실효값 편차 {:.2f}배 — 상한 {:.1f}배. {} 가 {} 보다 지나치게 강하다.".format(
                    spread, _VALUE_SPREAD_LIMIT, strongest["id"], weakest["id"]
                )
            )

        present = {w["type"] for w in selectable}
        missing = [t for t in _REQUIRED_TYPES if t not in present]
        for t in missing:
            problems.append("요구 분류 '{}' 에 해당하는 무기가 없다.".format(t))

        by_id = {w["id"]: w for w in weapons}
        for tank in tanks:
            for slot in ("main_weapon", "sub_weapon"):
                wid = tank[slot]
                if wid not in by_id:
                    problems.append("{} 의 {} 가 없는 무기를 가리킨다: {}".format(tank["id"], slot, wid))
                    continue
                weapon = by_id[wid]
                if slot == "sub_weapon" and weapon["ammo"] <= 0:
                    problems.append("{} 의 보조 무기 {} 에 탄약 제한이 없다.".format(tank["id"], wid))
                if slot == "main_weapon" and weapon["ammo"] > 0:
                    problems.append("{} 의 메인 무기 {} 에 탄약 제한이 걸려 있다.".format(tank["id"], wid))

        for tank in tanks:
            for other in tanks:
                if tank["id"] >= other["id"]:
                    continue
                wider = tank if tank["hull_width"] > other["hull_width"] else other
                narrower = other if wider is tank else tank
                if wider["hull_width"] - narrower["hull_width"] >= 6 and wider["hp"] < narrower["hp"]:
                    problems.append(
                        "{} 가 {} 보다 넓은데 체력이 낮다 — 실루엣이 성능을 거짓말한다.".format(
                            wider["id"], narrower["id"]
                        )
                    )

        report = TankFortBalanceReport()
        report.weapon_value_min = weakest["effective_value"]
        report.weapon_value_max = strongest["effective_value"]
        report.weapon_value_spread = spread
        report.weakest_weapon = weakest["id"]
        report.strongest_weapon = strongest["id"]
        report.missing_weapon_types = missing
        report.problems = problems
        return report


def _to_tank(row: dict) -> TankFortTank:
    tank = TankFortTank()
    tank.tank_id = row["id"]
    tank.display_name = row["name"]
    tank.role = row["role"]
    tank.hp = int(row["hp"])
    tank.armor = float(row["armor"])
    tank.mass = float(row["mass"])
    tank.fuel = int(row["fuel"])
    tank.climb = int(row["climb"])
    tank.power_mul = float(row["power_mul"])
    tank.angle_min = float(row["angle_min"])
    tank.angle_max = float(row["angle_max"])
    tank.main_weapon = row["main_weapon"]
    tank.sub_weapon = row["sub_weapon"]
    tank.hull_width = float(row["hull_width"])
    tank.note = row.get("note", "")
    return tank


def _to_weapon(row: dict) -> TankFortWeapon:
    weapon = TankFortWeapon()
    weapon.weapon_id = row["id"]
    weapon.display_name = row["name"]
    weapon.kind = row["kind"]
    weapon.weapon_type = row["type"]
    weapon.damage = float(row["dmg"])
    weapon.radius = float(row["radius"])
    weapon.push = float(row["push"])
    weapon.delay = int(row["delay"])
    weapon.ammo = int(row["ammo"])
    weapon.shots = int(row["shots"])
    weapon.split_count = int(row["split_count"])
    weapon.homing = bool(row["homing"])
    weapon.drill_px = float(row["drill_px"])
    weapon.effective_value = float(row["effective_value"])
    weapon.description = row.get("description", "")
    return weapon
