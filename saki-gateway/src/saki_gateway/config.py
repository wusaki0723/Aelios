from __future__ import annotations

import json
import os
import hashlib
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class ApiProviderConfig:
    enabled: bool = False
    label: str = ""
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    stream: bool = True


@dataclass
class ActionRuntimeConfig:
    enabled: bool = True
    backend_type: str = "managed"
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    allow_subagents: bool = False
    enable_mcp: bool = True


@dataclass
class PersonaConfig:
    partner_name: str = "TA"
    partner_role: str = "AI 伴侣"
    call_user: str = "你"
    core_identity: str = "温柔、亲密、生活化，避免客服腔。"
    boundaries: str = "不使用僵硬客服话术，不过度说教。"


@dataclass
class MemoryConfig:
    enabled: bool = True
    database_path: str = "./data/memories.db"
    operational_db_path: str = "./data/gateway.db"
    event_log_path: str = "./data/raw/events.jsonl"
    hot_memory_path: str = "./data/active_memory.md"
    core_memory_path: str = "./data/core_profile.md"
    digest_run_state_path: str = "./data/digest_run_state.json"
    vector_weight: float = 0.7
    keyword_weight: float = 0.3
    default_limit: int = 8


@dataclass
class SessionConfig:
    enabled: bool = True
    idle_rotation_minutes: int = 360
    recent_message_limit: int = 30


@dataclass
class SchedulerConfig:
    enabled: bool = True
    poll_interval_seconds: int = 15
    local_timezone: str = ""
    proactive_enabled: bool = False
    proactive_idle_hours: int = 72
    proactive_idle_minutes: int = 0
    proactive_cooldown_hours: int = 24
    proactive_max_profiles_per_tick: int = 2
    proactive_day_start_hour: int = 8
    proactive_day_end_hour: int = 22


@dataclass
class ChannelConfig:
    feishu_enabled: bool = False
    napcat_enabled: bool = False
    qqbot_enabled: bool = False
    web_enabled: bool = True
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    qqbot_app_id: str = ""
    qqbot_token: str = ""
    napcat_base_url: str = "http://127.0.0.1:3000"
    napcat_access_token: str = ""
    feishu_auto_reconnect: bool = True
    feishu_debug: bool = False
    feishu_card_title: str = "AI 伴侣"
    feishu_patch_interval_ms: int = 450
    feishu_patch_min_chars: int = 24


@dataclass
class DashboardSecurityConfig:
    enabled: bool = True
    password: str = (
        "sha256:240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"
    )


@dataclass
class NotionSyncConfig:
    enabled: bool = False
    token: str = ""
    database_id: str = ""
    sync_frequency_minutes: int = 180


@dataclass
class TriliumConfig:
    enabled: bool = False
    url: str = ""
    token: str = ""
    timeout_seconds: int = 10


@dataclass
class McpServerConfig:
    name: str
    command: str = ""
    args: List[str] = field(default_factory=list)
    enabled: bool = False


@dataclass
class AppConfig:
    host: str = "0.0.0.0"
    port: int = 3457
    debug: bool = True
    persona: PersonaConfig = field(default_factory=PersonaConfig)
    chat_api: ApiProviderConfig = field(
        default_factory=lambda: ApiProviderConfig(enabled=False, label="chat")
    )
    action_api: ActionRuntimeConfig = field(default_factory=ActionRuntimeConfig)
    search_api: ApiProviderConfig = field(
        default_factory=lambda: ApiProviderConfig(enabled=False, label="search")
    )
    tts_api: ApiProviderConfig = field(
        default_factory=lambda: ApiProviderConfig(enabled=False, label="tts")
    )
    image_api: ApiProviderConfig = field(
        default_factory=lambda: ApiProviderConfig(enabled=False, label="image")
    )
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    session: SessionConfig = field(default_factory=SessionConfig)
    scheduler: SchedulerConfig = field(default_factory=SchedulerConfig)
    notion_sync: NotionSyncConfig = field(default_factory=NotionSyncConfig)
    trilium: TriliumConfig = field(default_factory=TriliumConfig)
    channels: ChannelConfig = field(default_factory=ChannelConfig)
    dashboard_security: DashboardSecurityConfig = field(
        default_factory=DashboardSecurityConfig
    )
    mcp_servers: List[McpServerConfig] = field(default_factory=list)


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def normalize_dashboard_password(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return DashboardSecurityConfig().password
    if text.startswith("sha256:"):
        return text
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def resolve_data_path(root: Path, configured_path: str, default_relative: str) -> Path:
    raw = str(configured_path or "").strip()
    candidate = Path(raw).expanduser() if raw else Path(default_relative)
    if raw and re.match(r"^[A-Za-z]:[\\/]", raw):
        candidate = Path(default_relative)
    if not candidate.is_absolute():
        resolved = (root / candidate).resolve()
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            return (root / default_relative).resolve()

    resolved = candidate.resolve()
    if resolved.exists():
        return resolved
    try:
        resolved.relative_to(root)
        return resolved
    except ValueError:
        pass

    if "/data/" in resolved.as_posix():
        suffix = resolved.as_posix().split("/data/", 1)[1]
        return (root / "data" / suffix).resolve()

    return (root / default_relative).resolve()


def _apply_env_overrides(config: AppConfig) -> AppConfig:
    config.host = os.getenv("SAKI_HOST", config.host)
    config.port = _env_int("SAKI_PORT", config.port)
    config.debug = _env_flag("SAKI_DEBUG", config.debug)

    config.channels.feishu_enabled = _env_flag(
        "SAKI_FEISHU_ENABLED", config.channels.feishu_enabled
    )
    config.channels.feishu_app_id = os.getenv(
        "SAKI_FEISHU_APP_ID", config.channels.feishu_app_id
    )
    config.channels.feishu_app_secret = os.getenv(
        "SAKI_FEISHU_APP_SECRET", config.channels.feishu_app_secret
    )
    config.channels.qqbot_enabled = _env_flag(
        "SAKI_QQBOT_ENABLED", config.channels.qqbot_enabled
    )
    config.channels.qqbot_app_id = os.getenv(
        "SAKI_QQBOT_APP_ID", config.channels.qqbot_app_id
    )
    config.channels.qqbot_token = os.getenv(
        "SAKI_QQBOT_TOKEN", config.channels.qqbot_token
    )
    config.channels.napcat_enabled = _env_flag(
        "SAKI_NAPCAT_ENABLED", config.channels.napcat_enabled
    )
    config.channels.napcat_base_url = os.getenv(
        "SAKI_NAPCAT_BASE_URL", config.channels.napcat_base_url
    )
    config.channels.napcat_access_token = os.getenv(
        "SAKI_NAPCAT_ACCESS_TOKEN", config.channels.napcat_access_token
    )
    config.dashboard_security.enabled = _env_flag(
        "SAKI_DASHBOARD_AUTH_ENABLED", config.dashboard_security.enabled
    )
    config.dashboard_security.password = normalize_dashboard_password(
        os.getenv("SAKI_DASHBOARD_PASSWORD", config.dashboard_security.password)
    )

    config.chat_api.base_url = os.getenv("SAKI_CHAT_BASE_URL", config.chat_api.base_url)
    config.chat_api.api_key = os.getenv("SAKI_CHAT_API_KEY", config.chat_api.api_key)
    config.chat_api.model = os.getenv("SAKI_CHAT_MODEL", config.chat_api.model)

    config.action_api.base_url = os.getenv(
        "SAKI_ACTION_BASE_URL", config.action_api.base_url
    )
    config.action_api.api_key = os.getenv(
        "SAKI_ACTION_API_KEY", config.action_api.api_key
    )
    config.action_api.model = os.getenv("SAKI_ACTION_MODEL", config.action_api.model)

    config.search_api.base_url = os.getenv(
        "SAKI_SEARCH_BASE_URL", config.search_api.base_url
    )
    config.search_api.api_key = os.getenv(
        "SAKI_SEARCH_API_KEY", config.search_api.api_key
    )
    config.search_api.model = os.getenv("SAKI_SEARCH_MODEL", config.search_api.model)

    config.notion_sync.enabled = _env_flag(
        "SAKI_NOTION_ENABLED", config.notion_sync.enabled
    )
    config.notion_sync.token = os.getenv("SAKI_NOTION_TOKEN", config.notion_sync.token)
    config.notion_sync.database_id = os.getenv(
        "SAKI_NOTION_DATABASE_ID", config.notion_sync.database_id
    )
    config.notion_sync.sync_frequency_minutes = _env_int(
        "SAKI_NOTION_SYNC_FREQUENCY_MINUTES",
        config.notion_sync.sync_frequency_minutes,
    )
    config.trilium.enabled = _env_flag("TRILIUM_ENABLED", config.trilium.enabled)
    config.trilium.url = os.getenv("TRILIUM_URL", config.trilium.url)
    config.trilium.token = os.getenv(
        "TRILIUM_ETAPI_TOKEN", os.getenv("TRILIUM_TOKEN", config.trilium.token)
    )
    config.trilium.timeout_seconds = _env_int(
        "TRILIUM_TIMEOUT_SECONDS", config.trilium.timeout_seconds
    )
    config.scheduler.enabled = _env_flag(
        "SAKI_SCHEDULER_ENABLED", config.scheduler.enabled
    )
    config.scheduler.poll_interval_seconds = _env_int(
        "SAKI_SCHEDULER_POLL_INTERVAL_SECONDS", config.scheduler.poll_interval_seconds
    )
    config.scheduler.local_timezone = os.getenv(
        "SAKI_LOCAL_TIMEZONE", config.scheduler.local_timezone
    )
    config.scheduler.proactive_enabled = _env_flag(
        "SAKI_PROACTIVE_ENABLED", config.scheduler.proactive_enabled
    )
    config.scheduler.proactive_idle_hours = _env_int(
        "SAKI_PROACTIVE_IDLE_HOURS", config.scheduler.proactive_idle_hours
    )
    config.scheduler.proactive_idle_minutes = _env_int(
        "SAKI_PROACTIVE_IDLE_MINUTES", config.scheduler.proactive_idle_minutes
    )
    config.scheduler.proactive_cooldown_hours = _env_int(
        "SAKI_PROACTIVE_COOLDOWN_HOURS", config.scheduler.proactive_cooldown_hours
    )
    config.scheduler.proactive_max_profiles_per_tick = _env_int(
        "SAKI_PROACTIVE_MAX_PROFILES_PER_TICK",
        config.scheduler.proactive_max_profiles_per_tick,
    )
    config.scheduler.proactive_day_start_hour = _env_int(
        "SAKI_PROACTIVE_DAY_START_HOUR", config.scheduler.proactive_day_start_hour
    )
    config.scheduler.proactive_day_end_hour = _env_int(
        "SAKI_PROACTIVE_DAY_END_HOUR", config.scheduler.proactive_day_end_hour
    )
    return config


def _merge_dataclass(instance: Any, payload: Dict[str, Any]) -> Any:
    for key, value in payload.items():
        if not hasattr(instance, key):
            continue
        current = getattr(instance, key)
        if hasattr(current, "__dataclass_fields__") and isinstance(value, dict):
            _merge_dataclass(current, value)
        elif isinstance(current, list) and key == "mcp_servers":
            instance.mcp_servers = [McpServerConfig(**item) for item in value]
        else:
            setattr(instance, key, value)
    return instance


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._config = AppConfig()
        if self.path.exists():
            self.load()
        else:
            example_path = self.path.with_name("config.example.json")
            if example_path.exists():
                self.path.write_text(
                    example_path.read_text(encoding="utf-8"), encoding="utf-8"
                )
                self.load()
            else:
                self.save()

    @property
    def config(self) -> AppConfig:
        return self._config

    def load(self) -> AppConfig:
        payload = json.loads(self.path.read_text(encoding="utf-8") or "{}")
        self._config = _apply_env_overrides(_merge_dataclass(AppConfig(), payload))
        self._config.dashboard_security.password = normalize_dashboard_password(
            self._config.dashboard_security.password
        )
        return self._config

    def save(self) -> None:
        self.path.write_text(
            json.dumps(asdict(self._config), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def update(self, payload: Dict[str, Any]) -> AppConfig:
        self._config = _merge_dataclass(self._config, payload)
        self._config.dashboard_security.password = normalize_dashboard_password(
            self._config.dashboard_security.password
        )
        self.save()
        self._config = _apply_env_overrides(self._config)
        return self._config


def default_config_path(root: Path) -> Path:
    env_path = os.getenv("SAKI_CONFIG_PATH", "").strip()
    if env_path:
        return Path(env_path).expanduser().resolve()
    return root / "data" / "config.json"
