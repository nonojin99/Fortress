"""TankFortCatalogToolset 테스트."""

import copy

from toolset_registry.tests import ToolCallTestCase

from .. import catalog_toolset
from ..catalog_toolset import TankFortCatalogToolset
from . import fixtures


class TankFortCatalogToolsetTestCase(ToolCallTestCase):
    """전차·무기 표 조회와 감사."""

    def setUp(self):
        super().setUp()
        self.path = fixtures.write_catalog()
        self.addCleanup(fixtures.remove, self.path)
        TankFortCatalogToolset.load_catalog(self.path)

    # ── load_catalog ──────────────────────────────────────────

    def test_load_catalog_reports_counts(self):
        summary = TankFortCatalogToolset.load_catalog(self.path)
        self.assertIn("전차 2종", summary)
        self.assertIn("무기 5종", summary)

    def test_load_catalog_raises_on_empty_path(self):
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.load_catalog("")

    def test_load_catalog_raises_on_missing_file(self):
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.load_catalog("/no/such/catalog.json")

    def test_load_catalog_raises_when_section_missing(self):
        broken = fixtures.write_catalog({"tanks": [], "weapons": []})
        self.addCleanup(fixtures.remove, broken)
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.load_catalog(broken)

    def test_queries_raise_before_catalog_is_loaded(self):
        catalog_toolset._catalog = None
        self.addCleanup(TankFortCatalogToolset.load_catalog, self.path)
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.list_tanks()

    # ── 조회 ──────────────────────────────────────────────────

    def test_list_tanks_returns_every_tank(self):
        tanks = TankFortCatalogToolset.list_tanks()
        self.assertEqual([t.tank_id for t in tanks], ["scout", "heavy"])

    def test_get_tank_returns_stats(self):
        tank = TankFortCatalogToolset.get_tank("heavy")
        self.assertEqual(tank.hp, 130)
        self.assertEqual(tank.main_weapon, "slug")

    def test_get_tank_raises_on_unknown_id(self):
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.get_tank("nonexistent")

    def test_list_weapons_without_filter_returns_all(self):
        self.assertEqual(len(TankFortCatalogToolset.list_weapons()), 5)

    def test_list_weapons_filters_by_kind(self):
        subs = TankFortCatalogToolset.list_weapons(kind="sub")
        self.assertEqual({w.weapon_id for w in subs}, {"swarm", "breaker", "burst"})

    def test_list_weapons_filters_by_type(self):
        homing = TankFortCatalogToolset.list_weapons(weapon_type="유도")
        self.assertEqual([w.weapon_id for w in homing], ["swarm"])

    def test_list_weapons_returns_empty_when_nothing_matches(self):
        self.assertEqual(TankFortCatalogToolset.list_weapons(kind="child"), [])

    def test_get_weapon_returns_stats(self):
        weapon = TankFortCatalogToolset.get_weapon("breaker")
        self.assertEqual(weapon.ammo, 3)
        self.assertEqual(weapon.weapon_type, "돌파")

    def test_get_weapon_raises_on_unknown_id(self):
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.get_weapon("nonexistent")

    def test_get_tank_loadout_returns_main_then_sub(self):
        loadout = TankFortCatalogToolset.get_tank_loadout("scout")
        self.assertEqual([w.weapon_id for w in loadout], ["needle", "swarm"])

    def test_get_tank_loadout_raises_on_unknown_tank(self):
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.get_tank_loadout("nonexistent")

    # ── audit_balance ─────────────────────────────────────────

    def test_audit_balance_passes_on_healthy_table(self):
        report = TankFortCatalogToolset.audit_balance()
        self.assertEqual(report.problems, [])
        self.assertEqual(report.missing_weapon_types, [])
        self.assertEqual(report.weakest_weapon, "swarm")
        self.assertEqual(report.strongest_weapon, "breaker")

    def test_audit_balance_flags_wide_value_spread(self):
        data = copy.deepcopy(fixtures.HEALTHY)
        data["weapons"][0]["effective_value"] = 4.0
        path = fixtures.write_catalog(data)
        self.addCleanup(fixtures.remove, path)
        TankFortCatalogToolset.load_catalog(path)
        report = TankFortCatalogToolset.audit_balance()
        self.assertGreater(report.weapon_value_spread, 2.2)
        self.assertTrue(any("편차" in p for p in report.problems))

    def test_audit_balance_flags_missing_required_type(self):
        data = copy.deepcopy(fixtures.HEALTHY)
        data["weapons"] = [w for w in data["weapons"] if w["type"] != "돌파"]
        data["tanks"][1]["sub_weapon"] = "burst"
        path = fixtures.write_catalog(data)
        self.addCleanup(fixtures.remove, path)
        TankFortCatalogToolset.load_catalog(path)
        report = TankFortCatalogToolset.audit_balance()
        self.assertIn("돌파", report.missing_weapon_types)

    def test_audit_balance_flags_sub_weapon_without_ammo(self):
        data = copy.deepcopy(fixtures.HEALTHY)
        data["weapons"][2]["ammo"] = 0
        path = fixtures.write_catalog(data)
        self.addCleanup(fixtures.remove, path)
        TankFortCatalogToolset.load_catalog(path)
        report = TankFortCatalogToolset.audit_balance()
        self.assertTrue(any("탄약 제한이 없다" in p for p in report.problems))

    def test_audit_balance_flags_dangling_weapon_reference(self):
        data = copy.deepcopy(fixtures.HEALTHY)
        data["tanks"][0]["sub_weapon"] = "ghost"
        path = fixtures.write_catalog(data)
        self.addCleanup(fixtures.remove, path)
        TankFortCatalogToolset.load_catalog(path)
        report = TankFortCatalogToolset.audit_balance()
        self.assertTrue(any("없는 무기를 가리킨다" in p for p in report.problems))

    def test_audit_balance_flags_silhouette_lying_about_hp(self):
        data = copy.deepcopy(fixtures.HEALTHY)
        data["tanks"][1]["hp"] = 40           # 가장 넓은데 가장 약하다
        path = fixtures.write_catalog(data)
        self.addCleanup(fixtures.remove, path)
        TankFortCatalogToolset.load_catalog(path)
        report = TankFortCatalogToolset.audit_balance()
        self.assertTrue(any("실루엣이 성능을 거짓말한다" in p for p in report.problems))

    def test_audit_balance_raises_when_no_selectable_weapons(self):
        data = copy.deepcopy(fixtures.HEALTHY)
        for weapon in data["weapons"]:
            weapon["kind"] = "child"
        path = fixtures.write_catalog(data)
        self.addCleanup(fixtures.remove, path)
        TankFortCatalogToolset.load_catalog(path)
        with self.assertToolRaisesRuntimeError():
            TankFortCatalogToolset.audit_balance()
