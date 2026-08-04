"""TankFortMapToolset 테스트. 레벨에 액터를 만들므로 에디터 컨텍스트가 필요하다."""

import os
import tempfile

from toolset_registry.tests import ToolCallTestCase

from ..map_toolset import TankFortMapToolset
from ..types import TankFortMapOp, TankFortMapSpec
from . import fixtures

_SCALE = 5.0


def _spec(map_id="flat", ops=None) -> TankFortMapSpec:
    spec = TankFortMapSpec()
    spec.map_id = map_id
    spec.display_name = "평지"
    spec.width = 2200
    spec.height = 900
    spec.gravity = 540.0
    spec.wind_max = 5.0
    spec.base = 0.62
    spec.void_y = 900.0
    spec.settles = True
    spec.note = ""
    spec.ops = ops if ops is not None else [_pillar(0.5, 130, 0.30)]
    return spec


def _pillar(cx, width, top) -> TankFortMapOp:
    op = TankFortMapOp()
    op.op = "pillar"
    op.center_x = cx
    op.center_y = top
    op.radius_x = width
    return op


def _gap(x0, x1) -> TankFortMapOp:
    op = TankFortMapOp()
    op.op = "gap"
    op.span_x0 = x0
    op.span_x1 = x1
    return op


def _island(cx, cy, rx, ry) -> TankFortMapOp:
    op = TankFortMapOp()
    op.op = "island"
    op.center_x = cx
    op.center_y = cy
    op.radius_x = rx
    op.radius_y = ry
    return op


class TankFortMapToolsetTestCase(ToolCallTestCase):
    """전장 배치 펼치기와 거두기."""

    def setUp(self):
        super().setUp()
        self.catalog = fixtures.write_catalog()
        self.addCleanup(fixtures.remove, self.catalog)
        self.addCleanup(TankFortMapToolset.clear_map_layout, "flat")

    # ── load_map_spec ─────────────────────────────────────────

    def test_load_map_spec_reads_map(self):
        spec = TankFortMapToolset.load_map_spec(self.catalog, "flat")
        self.assertEqual(spec.width, 2200)
        self.assertEqual(spec.gravity, 540.0)

    def test_load_map_spec_raises_on_missing_file(self):
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.load_map_spec("/no/such/catalog.json", "flat")

    def test_load_map_spec_raises_on_unknown_map(self):
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.load_map_spec(self.catalog, "nonexistent")

    # ── spawn / read / clear ──────────────────────────────────

    def test_spawn_map_layout_creates_bounds_and_one_actor_per_op(self):
        actors = TankFortMapToolset.spawn_map_layout(_spec(ops=[_pillar(0.3, 100, 0.4), _gap(900, 1200)]), _SCALE)
        self.assertEqual(len(actors), 3)
        self.assertTrue(actors[0].get_actor_label().endswith("bounds"))

    def test_spawn_map_layout_replaces_previous_layout(self):
        TankFortMapToolset.spawn_map_layout(_spec(ops=[_pillar(0.3, 100, 0.4)]), _SCALE)
        actors = TankFortMapToolset.spawn_map_layout(_spec(ops=[_pillar(0.3, 100, 0.4)]), _SCALE)
        self.assertEqual(len(actors), 2)

    def test_spawn_map_layout_raises_on_empty_map_id(self):
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.spawn_map_layout(_spec(map_id=""), _SCALE)

    def test_spawn_map_layout_raises_on_bad_scale(self):
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.spawn_map_layout(_spec(), 0.0)

    def test_read_map_layout_round_trips_a_pillar(self):
        original = _spec(ops=[_pillar(0.5, 130, 0.30)])
        TankFortMapToolset.spawn_map_layout(original, _SCALE)
        result = TankFortMapToolset.read_map_layout(original, _SCALE)
        self.assertEqual(len(result.ops), 1)
        self.assertAlmostEqual(result.ops[0].center_x, 0.5, places=2)
        self.assertAlmostEqual(result.ops[0].radius_x, 130.0, delta=1.0)

    def test_read_map_layout_round_trips_a_gap(self):
        original = _spec(ops=[_gap(1010, 1390)])
        TankFortMapToolset.spawn_map_layout(original, _SCALE)
        result = TankFortMapToolset.read_map_layout(original, _SCALE)
        self.assertAlmostEqual(result.ops[0].span_x0, 1010.0, delta=1.0)
        self.assertAlmostEqual(result.ops[0].span_x1, 1390.0, delta=1.0)

    def test_read_map_layout_keeps_values_actors_cannot_carry(self):
        original = _spec()
        TankFortMapToolset.spawn_map_layout(original, _SCALE)
        result = TankFortMapToolset.read_map_layout(original, _SCALE)
        self.assertEqual(result.gravity, original.gravity)
        self.assertEqual(result.wind_max, original.wind_max)

    def test_read_map_layout_raises_when_nothing_is_spawned(self):
        TankFortMapToolset.clear_map_layout("flat")
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.read_map_layout(_spec(), _SCALE)

    def test_read_map_layout_raises_on_bad_scale(self):
        TankFortMapToolset.spawn_map_layout(_spec(), _SCALE)
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.read_map_layout(_spec(), -1.0)

    def test_clear_map_layout_removes_actors(self):
        TankFortMapToolset.spawn_map_layout(_spec(ops=[_pillar(0.3, 100, 0.4)]), _SCALE)
        self.assertEqual(TankFortMapToolset.clear_map_layout("flat"), 2)
        self.assertEqual(TankFortMapToolset.clear_map_layout("flat"), 0)

    def test_clear_map_layout_raises_on_empty_id(self):
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.clear_map_layout("")

    # ── validate_map_spec ─────────────────────────────────────

    def test_validate_map_spec_passes_a_sane_map(self):
        self.assertEqual(TankFortMapToolset.validate_map_spec(_spec()), [])

    def test_validate_map_spec_flags_narrow_map(self):
        spec = _spec()
        spec.width = 1400
        self.assertTrue(any("횡스크롤" in p for p in TankFortMapToolset.validate_map_spec(spec)))

    def test_validate_map_spec_flags_zero_gravity(self):
        spec = _spec()
        spec.gravity = 0.0
        self.assertTrue(any("중력" in p for p in TankFortMapToolset.validate_map_spec(spec)))

    def test_validate_map_spec_flags_floorless_map_without_islands(self):
        spec = _spec(ops=[])
        spec.base = 1.4
        self.assertTrue(any("발판" in p for p in TankFortMapToolset.validate_map_spec(spec)))

    def test_validate_map_spec_accepts_floorless_map_with_islands(self):
        spec = _spec(ops=[_island(0.2, 0.6, 190, 74), _island(0.8, 0.6, 190, 74)])
        spec.base = 1.4
        self.assertEqual(TankFortMapToolset.validate_map_spec(spec), [])

    def test_validate_map_spec_flags_reversed_gap(self):
        spec = _spec(ops=[_gap(1200, 900)])
        self.assertTrue(any("뒤집혀" in p for p in TankFortMapToolset.validate_map_spec(spec)))

    def test_validate_map_spec_flags_gap_wider_than_half_the_map(self):
        spec = _spec(ops=[_gap(200, 1600)])
        self.assertTrue(any("절반" in p for p in TankFortMapToolset.validate_map_spec(spec)))

    def test_validate_map_spec_flags_unknown_op(self):
        op = TankFortMapOp()
        op.op = "teleporter"
        self.assertTrue(any("모른다" in p for p in TankFortMapToolset.validate_map_spec(_spec(ops=[op]))))

    def test_validate_map_spec_flags_center_outside_the_field(self):
        spec = _spec(ops=[_island(1.8, 0.5, 100, 40)])
        self.assertTrue(any("전장 밖" in p for p in TankFortMapToolset.validate_map_spec(spec)))

    # ── export_map_spec ───────────────────────────────────────

    def test_export_map_spec_writes_pastable_javascript(self):
        path = os.path.join(tempfile.mkdtemp(), "flat.js")
        text = TankFortMapToolset.export_map_spec(_spec(), path)
        self.assertTrue(os.path.isfile(path))
        self.assertIn("id: 'flat'", text)
        self.assertIn("op: 'pillar'", text)
        self.assertIn("gravity: 540", text)

    def test_export_map_spec_raises_on_invalid_spec(self):
        spec = _spec()
        spec.gravity = 0.0
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.export_map_spec(spec, os.path.join(tempfile.mkdtemp(), "bad.js"))

    def test_export_map_spec_raises_on_empty_path(self):
        with self.assertToolRaisesRuntimeError():
            TankFortMapToolset.export_map_spec(_spec(), "")
