"""按资源域拆分的 API 路由。"""

from file_pilot.api.routers.history import router as history_router
from file_pilot.api.routers.icon_workbench import router as icon_workbench_router
from file_pilot.api.routers.sessions import router as sessions_router
from file_pilot.api.routers.settings import router as settings_router
from file_pilot.api.routers.target_profiles import router as target_profiles_router
from file_pilot.api.routers.utils import router as utils_router

__all__ = [
    "history_router",
    "icon_workbench_router",
    "sessions_router",
    "settings_router",
    "target_profiles_router",
    "utils_router",
]
