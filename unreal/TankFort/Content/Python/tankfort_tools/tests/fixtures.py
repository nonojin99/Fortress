"""테스트용 카탈로그 조각.

실제 catalog.json 을 읽지 않는 이유: 그 파일은 게임 밸런싱에 따라 계속 바뀐다.
표가 바뀔 때마다 툴셋 테스트가 깨지면 테스트가 아니라 알람이 된다.
여기 값들은 툴이 무엇을 해야 하는지만 보여 주는 최소한이다.
"""

import json
import os
import tempfile


def _weapon(wid, kind, wtype, dmg, delay, ammo=0, value=0.5):
    return {
        "id": wid, "name": wid, "kind": kind, "type": wtype,
        "dmg": dmg, "radius": 40, "push": 1.0, "delay": delay,
        "ammo": ammo, "shots": 1, "spread": 0,
        "gravity_mul": 1, "wind_mul": 1, "speed_mul": 1,
        "homing": wtype == "유도", "drill_px": 72 if wtype == "돌파" else 0,
        "split_count": 0, "split_at": "", "pierce_tanks": 0,
        "effective_value": value, "description": "",
    }


def _tank(tid, hp, width, main, sub):
    return {
        "id": tid, "name": tid, "role": "표준",
        "hp": hp, "armor": 0.0, "mass": 1.0, "fuel": 100, "climb": 16,
        "power_mul": 1.0, "angle_min": 0, "angle_max": 88,
        "main_weapon": main, "sub_weapon": sub,
        "hull_width": width, "skin": "#000000", "trim": "#FFFFFF",
        "note": "",
    }


HEALTHY = {
    "tanks": [
        _tank("scout", 90, 38, "needle", "swarm"),
        _tank("heavy", 130, 52, "slug", "breaker"),
    ],
    "weapons": [
        _weapon("needle", "main", "표준", 34, 64, value=0.60),
        _weapon("slug", "main", "집중", 58, 108, value=0.70),
        _weapon("swarm", "sub", "유도", 27, 134, ammo=5, value=0.52),
        _weapon("breaker", "sub", "돌파", 96, 178, ammo=3, value=0.72),
        _weapon("burst", "sub", "범위", 40, 120, ammo=4, value=0.66),
    ],
    "maps": [{
        "id": "flat", "name": "평지", "width": 2200, "height": 900,
        "gravity": 540, "wind_max": 5, "settles": True,
        "base": 0.62, "void_y": 900, "spawn_count": 4, "note": "",
    }],
}


def write_catalog(data=None) -> str:
    """카탈로그를 임시 파일로 쓰고 경로를 돌려준다."""
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(HEALTHY if data is None else data, handle, ensure_ascii=False)
    handle.close()
    return handle.name


def remove(path: str) -> None:
    if path and os.path.isfile(path):
        os.unlink(path)
