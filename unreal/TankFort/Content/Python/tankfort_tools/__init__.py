"""강철 포화 에디터 툴셋.

등록은 자동이 아니다. init_unreal.py 가 register_toolsets() 를 부른다.
"""

import unreal

from .catalog_toolset import TankFortCatalogToolset
from .map_toolset import TankFortMapToolset
from .types import (
    TankFortBalanceReport,
    TankFortMapOp,
    TankFortMapSpec,
    TankFortTank,
    TankFortWeapon,
)

_TOOLSETS = (TankFortCatalogToolset, TankFortMapToolset)


def register_toolsets() -> None:
    for toolset in _TOOLSETS:
        unreal.ToolsetRegistry.register_toolset_class(toolset)


def unregister_toolsets() -> None:
    for toolset in _TOOLSETS:
        unreal.ToolsetRegistry.unregister_toolset_class(toolset)


__all__ = [
    "TankFortCatalogToolset",
    "TankFortMapToolset",
    "TankFortBalanceReport",
    "TankFortMapOp",
    "TankFortMapSpec",
    "TankFortTank",
    "TankFortWeapon",
    "register_toolsets",
    "unregister_toolsets",
]
