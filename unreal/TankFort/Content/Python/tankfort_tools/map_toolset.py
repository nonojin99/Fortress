"""전장 배치를 레벨에서 편집하는 툴셋."""

import json
import os

import unreal
from toolset_registry import toolset_registry

from .types import TankFortMapOp, TankFortMapSpec

# 엔진 기본 큐브의 한 변(uu). 배치 액터의 스케일을 이 값으로 나눠 잡는다.
_CUBE_UU = 100.0
_CUBE_PATH = "/Engine/BasicShapes/Cube.Cube"

# 게임 1px 당 언리얼 uu. 2400px 짜리 전장이 12000uu 가 되어 에디터에서 다루기 좋은 크기가 된다.
_DEFAULT_SCALE = 5.0

_LABEL_PREFIX = "TF"
_OP_KINDS = ("gap", "cave", "island", "pillar", "arch", "roughen")


def _label(map_id: str, index: int, op: str) -> str:
    return "{}_{}_{:02d}_{}".format(_LABEL_PREFIX, map_id, index, op)


def _label_prefix(map_id: str) -> str:
    return "{}_{}_".format(_LABEL_PREFIX, map_id)


def _actor_subsystem() -> unreal.EditorActorSubsystem:
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if subsystem is None:
        raise RuntimeError("에디터 액터 서브시스템을 얻지 못했습니다. 에디터에서 실행 중인지 확인하세요.")
    return subsystem


def _layout_actors(map_id: str) -> list[unreal.Actor]:
    prefix = _label_prefix(map_id)
    return [a for a in _actor_subsystem().get_all_level_actors() if a.get_actor_label().startswith(prefix)]


@unreal.uclass()
class TankFortMapToolset(unreal.ToolsetDefinition):
    """강철 포화의 전장 배치를 레벨 액터로 펼쳐 편집하고 다시 맵 사양으로 거둔다.

    지형 생성 자체는 게임(logic/terrain.js)이 하고 여기서는 흉내내지 않는다.
    이 툴셋이 다루는 것은 그 생성기에 넘길 연산 목록 — 절벽을 어디에 낼지, 기둥을 몇 개 세울지다.
    좌표는 게임 2D 평면을 언리얼 XZ 평면에 눕힌다: 게임 (x, y) → 언리얼 (x*scale, 0, -y*scale).
    """

    @toolset_registry.tool_call
    @staticmethod
    def load_map_spec(catalog_path: str, map_id: str) -> TankFortMapSpec:
        """카탈로그에서 전장 하나의 사양을 읽는다.

        Args:
            catalog_path: docs/catalog.json 의 절대 경로.
            map_id: logic/maps.js 의 id (예: "canyon").
        """
        if not os.path.isfile(catalog_path):
            raise FileNotFoundError("카탈로그 파일이 없습니다: {}".format(catalog_path))
        with open(catalog_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        for row in data.get("maps", []):
            if row["id"] == map_id:
                return _to_spec(row)
        raise LookupError("그런 전장이 없습니다: {}".format(map_id))

    @toolset_registry.tool_call
    @staticmethod
    def spawn_map_layout(spec: TankFortMapSpec, world_scale: float = _DEFAULT_SCALE) -> list[unreal.Actor]:
        """전장 사양을 레벨에 상자 액터로 펼친다. 액터를 옮기고 크기를 바꾼 뒤 read_map_layout 으로 거둔다.

        전장 경계를 나타내는 얇은 판 하나와 연산마다 상자 하나가 생긴다.
        같은 map_id 로 이미 펼쳐진 액터가 있으면 먼저 지운다.

        Args:
            spec: 펼칠 전장 사양.
            world_scale: 게임 1px 당 언리얼 uu.

        Returns:
            생성된 액터. 첫 항목이 경계판이다.
        """
        if not spec.map_id:
            raise ValueError("spec.map_id 가 비어 있습니다.")
        if world_scale <= 0.0:
            raise ValueError("world_scale 은 0보다 커야 합니다.")

        TankFortMapToolset.clear_map_layout(spec.map_id)

        cube = unreal.EditorAssetLibrary.load_asset(_CUBE_PATH)
        if cube is None:
            raise RuntimeError("기본 큐브 메시를 찾지 못했습니다: {}".format(_CUBE_PATH))

        subsystem = _actor_subsystem()
        spawned: list[unreal.Actor] = []

        bounds = subsystem.spawn_actor_from_object(
            cube,
            unreal.Vector(spec.width * world_scale * 0.5, 0.0, -spec.height * world_scale * 0.5),
        )
        bounds.set_actor_label(_label(spec.map_id, 0, "bounds"))
        bounds.set_actor_scale3d(
            unreal.Vector(spec.width * world_scale / _CUBE_UU, 0.02, spec.height * world_scale / _CUBE_UU)
        )
        spawned.append(bounds)

        for index, op in enumerate(spec.ops, start=1):
            center, extent = _op_box(op, spec, world_scale)
            actor = subsystem.spawn_actor_from_object(cube, center)
            actor.set_actor_label(_label(spec.map_id, index, op.op))
            actor.set_actor_scale3d(
                unreal.Vector(
                    max(extent.x, 1.0) / _CUBE_UU, 0.04, max(extent.z, 1.0) / _CUBE_UU
                )
            )
            spawned.append(actor)

        return spawned

    @toolset_registry.tool_call
    @staticmethod
    def read_map_layout(
        base_spec: TankFortMapSpec, world_scale: float = _DEFAULT_SCALE
    ) -> TankFortMapSpec:
        """레벨에 펼쳐진 액터를 읽어 전장 사양으로 되돌린다.

        중력·바람처럼 액터로 표현되지 않는 값은 base_spec 것을 그대로 쓴다.
        연산 종류는 액터 라벨의 마지막 토막에서 읽으므로 라벨을 바꾸면 안 된다.

        Args:
            base_spec: 액터로 표현되지 않는 값을 가져올 원본 사양.
            world_scale: spawn_map_layout 에 넘겼던 값과 같아야 한다.

        Returns:
            액터 위치가 반영된 사양.
        """
        if world_scale <= 0.0:
            raise ValueError("world_scale 은 0보다 커야 합니다.")

        actors = _layout_actors(base_spec.map_id)
        if not actors:
            raise LookupError(
                "'{}' 로 펼쳐진 액터가 없습니다. 먼저 spawn_map_layout 을 호출하세요.".format(base_spec.map_id)
            )

        result = TankFortMapSpec()
        result.map_id = base_spec.map_id
        result.display_name = base_spec.display_name
        result.width = base_spec.width
        result.height = base_spec.height
        result.gravity = base_spec.gravity
        result.wind_max = base_spec.wind_max
        result.base = base_spec.base
        result.void_y = base_spec.void_y
        result.settles = base_spec.settles
        result.note = base_spec.note

        ops: list[TankFortMapOp] = []
        for actor in sorted(actors, key=lambda a: a.get_actor_label()):
            kind = actor.get_actor_label().rsplit("_", 1)[-1]
            if kind not in _OP_KINDS:
                continue
            ops.append(_box_to_op(kind, actor, base_spec, world_scale))
        result.ops = ops
        return result

    @toolset_registry.tool_call
    @staticmethod
    def clear_map_layout(map_id: str) -> int:
        """레벨에서 그 전장의 배치 액터를 모두 지운다.

        Args:
            map_id: logic/maps.js 의 id.

        Returns:
            지운 액터 수. 펼쳐진 것이 없으면 0.
        """
        if not map_id:
            raise ValueError("map_id 가 비어 있습니다.")
        actors = _layout_actors(map_id)
        subsystem = _actor_subsystem()
        for actor in actors:
            subsystem.destroy_actor(actor)
        return len(actors)

    @toolset_registry.tool_call
    @staticmethod
    def validate_map_spec(spec: TankFortMapSpec) -> list[str]:
        """전장 사양이 실제로 플레이 가능한지 검사한다.

        Args:
            spec: 검사할 사양.

        Returns:
            사람이 읽고 고칠 수 있는 문제 문장. 비어 있으면 통과.
        """
        problems: list[str] = []

        if spec.width < 1600:
            problems.append("폭 {}px 는 화면(1280px)보다 조금 넓을 뿐이라 횡스크롤이 의미가 없다.".format(spec.width))
        if spec.height < 700:
            problems.append("높이 {}px 는 고각 곡사가 화면 밖으로 나간다.".format(spec.height))
        if spec.gravity <= 0.0:
            problems.append("중력이 0 이하다 — 포탄이 떨어지지 않는다.")
        if spec.wind_max < 0.0:
            problems.append("바람 최대치가 음수다.")
        if spec.void_y <= 0.0:
            problems.append("낙사선이 0 이하라 시작하자마자 전원 낙사한다.")

        floorless = spec.base > 1.0
        gaps = [o for o in spec.ops if o.op == "gap"]
        islands = [o for o in spec.ops if o.op == "island"]
        if floorless and not islands:
            problems.append("base 가 1.0 을 넘어 바닥이 없는데 발판(island)이 하나도 없다.")

        for index, op in enumerate(spec.ops):
            if op.op not in _OP_KINDS:
                problems.append("{}번 연산의 종류를 모른다: '{}'".format(index, op.op))
            if op.op == "gap":
                if op.span_x1 <= op.span_x0:
                    problems.append("{}번 gap 의 구간이 뒤집혀 있다.".format(index))
                elif op.span_x1 - op.span_x0 > spec.width * 0.5:
                    problems.append(
                        "{}번 gap 이 전장 폭의 절반을 넘는다 — 어느 쪽도 상대에게 닿지 못한다.".format(index)
                    )
            elif op.op in ("cave", "island", "arch"):
                if op.radius_x <= 0.0 or op.radius_y <= 0.0:
                    problems.append("{}번 {} 의 반지름이 0 이하다.".format(index, op.op))
            if op.op != "gap" and not (0.0 <= op.center_x <= 1.0 and 0.0 <= op.center_y <= 1.0):
                problems.append("{}번 {} 의 중심이 전장 밖이다.".format(index, op.op))

        gap_span = sum(max(0.0, o.span_x1 - o.span_x0) for o in gaps)
        if not floorless and gap_span > spec.width * 0.6:
            problems.append("절벽이 전장 폭의 60%를 넘는다 — 설 자리가 남지 않는다.")

        return problems

    @toolset_registry.tool_call
    @staticmethod
    def export_map_spec(spec: TankFortMapSpec, file_path: str) -> str:
        """전장 사양을 logic/maps.js 에 그대로 붙여 넣을 수 있는 형태로 파일에 쓴다.

        검사를 통과하지 못한 사양은 쓰지 않는다.

        Args:
            spec: 내보낼 사양.
            file_path: 쓸 파일의 절대 경로.

        Returns:
            쓴 내용.
        """
        problems = TankFortMapToolset.validate_map_spec(spec)
        if problems:
            raise ValueError("검사를 통과하지 못했습니다: {}".format(" / ".join(problems)))
        if not file_path:
            raise ValueError("file_path 가 비어 있습니다.")

        lines = [
            "{",
            "  id: '{}', name: '{}', note: '{}',".format(spec.map_id, spec.display_name, spec.note),
            "  w: {}, h: {}, base: {:.3f}, gravity: {:.0f}, wind: {:.1f}, settle: {},".format(
                spec.width, spec.height, spec.base, spec.gravity, spec.wind_max,
                "true" if spec.settles else "false",
            ),
            "  ops: [",
        ]
        for op in spec.ops:
            lines.append("    " + _op_to_js(op) + ",")
        lines.append("  ]")
        lines.append("}")
        text = "\n".join(lines)

        directory = os.path.dirname(file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return text


def _to_spec(row: dict) -> TankFortMapSpec:
    spec = TankFortMapSpec()
    spec.map_id = row["id"]
    spec.display_name = row["name"]
    spec.width = int(row["width"])
    spec.height = int(row["height"])
    spec.gravity = float(row["gravity"])
    spec.wind_max = float(row["wind_max"])
    spec.base = float(row["base"])
    spec.void_y = float(row["void_y"])
    spec.settles = bool(row["settles"])
    spec.note = row.get("note", "")
    spec.ops = []
    return spec


def _op_box(op: TankFortMapOp, spec: TankFortMapSpec, scale: float):
    """연산 하나를 (중심 위치, 크기) 상자로 바꾼다. 게임 y 는 아래로 커지므로 Z 는 음수다."""
    if op.op == "gap":
        cx = (op.span_x0 + op.span_x1) * 0.5
        cy = spec.height * 0.75
        ex = max(op.span_x1 - op.span_x0, 8.0)
        ez = spec.height * 0.5
    elif op.op == "pillar":
        cx = op.center_x * spec.width
        cy = (op.center_y * spec.height + spec.height) * 0.5
        ex = max(op.radius_x, 8.0)
        ez = max(spec.height - op.center_y * spec.height, 8.0)
    else:
        cx = op.center_x * spec.width
        cy = op.center_y * spec.height
        ex = max(op.radius_x * 2.0, 8.0)
        ez = max(op.radius_y * 2.0, 8.0)
    return (
        unreal.Vector(cx * scale, 0.0, -cy * scale),
        unreal.Vector(ex * scale, 1.0, ez * scale),
    )


def _box_to_op(kind: str, actor: unreal.Actor, spec: TankFortMapSpec, scale: float) -> TankFortMapOp:
    """_op_box 의 역변환. 액터를 옮기거나 늘린 결과가 연산 값에 반영된다."""
    location = actor.get_actor_location()
    actor_scale = actor.get_actor_scale3d()
    cx_px = location.x / scale
    cy_px = -location.z / scale
    ex_px = actor_scale.x * _CUBE_UU / scale
    ez_px = actor_scale.z * _CUBE_UU / scale

    op = TankFortMapOp()
    op.op = kind
    if kind == "gap":
        op.span_x0 = cx_px - ex_px * 0.5
        op.span_x1 = cx_px + ex_px * 0.5
    elif kind == "pillar":
        op.center_x = cx_px / spec.width if spec.width else 0.0
        op.center_y = (cy_px - ez_px * 0.5) / spec.height if spec.height else 0.0
        op.radius_x = ex_px
    else:
        op.center_x = cx_px / spec.width if spec.width else 0.0
        op.center_y = cy_px / spec.height if spec.height else 0.0
        op.radius_x = ex_px * 0.5
        op.radius_y = ez_px * 0.5
    return op


def _op_to_js(op: TankFortMapOp) -> str:
    if op.op == "gap":
        return "{{ op: 'gap', x0: {:.0f}, x1: {:.0f}, taper: 60 }}".format(op.span_x0, op.span_x1)
    if op.op == "pillar":
        return "{{ op: 'pillar', cx: {:.3f}, w: {:.0f}, top: {:.3f} }}".format(
            op.center_x, op.radius_x, op.center_y
        )
    if op.op == "arch":
        return "{{ op: 'arch', cx: {:.3f}, cy: {:.3f}, rx: {:.0f}, thick: 34, rise: 150 }}".format(
            op.center_x, op.center_y, op.radius_x
        )
    return "{{ op: '{}', cx: {:.3f}, cy: {:.3f}, rx: {:.0f}, ry: {:.0f} }}".format(
        op.op, op.center_x, op.center_y, op.radius_x, op.radius_y
    )
