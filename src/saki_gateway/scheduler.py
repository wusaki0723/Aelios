from __future__ import annotations

import threading
from datetime import datetime
from typing import Callable, Dict, Optional

from .config import SchedulerConfig
from .runtime_store import RuntimeStore


ReminderCallback = Callable[[str], None]
ProactiveCallback = Callable[[str], None]
DigestCallback = Callable[[], None]


class GatewayScheduler:
    def __init__(
        self,
        store: RuntimeStore,
        config_getter: Callable[[], SchedulerConfig],
        on_due_reminder: ReminderCallback,
        on_proactive_ping: ProactiveCallback,
        on_memory_digest: Optional[DigestCallback] = None,
    ):
        self.store = store
        self.config_getter = config_getter
        self.on_due_reminder = on_due_reminder
        self.on_proactive_ping = on_proactive_ping
        self.on_memory_digest = on_memory_digest
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._last_error = ""
        self._tick_count = 0
        self._last_digest_hour: int = -1

    def start(self) -> None:
        config = self.config_getter()
        if not config.enabled:
            return
        if self._thread and self._thread.is_alive():
            return
        self._thread = None
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_forever, name="gateway-scheduler", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if (
            thread is not None
            and thread.is_alive()
            and thread is not threading.current_thread()
        ):
            thread.join(timeout=max(self.config_getter().poll_interval_seconds, 3) + 1)
        if self._thread is thread:
            self._thread = None

    def status(self) -> Dict[str, object]:
        config = self.config_getter()
        return {
            "enabled": config.enabled,
            "running": bool(self._thread and self._thread.is_alive()),
            "poll_interval_seconds": config.poll_interval_seconds,
            "proactive_enabled": config.proactive_enabled,
            "last_error": self._last_error,
            "tick_count": self._tick_count,
        }

    def _run_forever(self) -> None:
        try:
            while not self._stop_event.is_set():
                self._tick_count += 1
                try:
                    self._tick()
                    self._last_error = ""
                except Exception as error:
                    self._last_error = str(error)
                interval = max(self.config_getter().poll_interval_seconds, 3)
                self._stop_event.wait(interval)
        finally:
            self._thread = None

    def _tick(self) -> None:
        self._deliver_due_reminders()
        self._send_proactive_pings()
        self._run_memory_digest()

    def _deliver_due_reminders(self) -> None:
        due = self.store.list_due_reminders(limit=10)
        for reminder in due:
            self.on_due_reminder(reminder.reminder_id)

    def _send_proactive_pings(self) -> None:
        config = self.config_getter()
        if not config.proactive_enabled:
            return
        current_hour = datetime.now().hour
        day_start = max(0, min(23, int(config.proactive_day_start_hour)))
        day_end = max(0, min(23, int(config.proactive_day_end_hour)))
        if day_start <= day_end:
            in_window = day_start <= current_hour <= day_end
        else:
            in_window = current_hour >= day_start or current_hour <= day_end
        if not in_window:
            return
        candidates = self.store.list_inactive_profiles(
            idle_hours=config.proactive_idle_hours,
            idle_minutes=config.proactive_idle_minutes,
            proactive_cooldown_hours=config.proactive_cooldown_hours,
            limit=config.proactive_max_profiles_per_tick,
        )
        for candidate in candidates:
            profile_id = str(candidate.get("profile_id", ""))
            if profile_id:
                self.on_proactive_ping(profile_id)

    def _run_memory_digest(self) -> None:
        if self.on_memory_digest is None:
            return
        current_hour = datetime.now().hour
        if current_hour == self._last_digest_hour:
            return
        if current_hour not in (3, 9, 15, 21):
            return
        self._last_digest_hour = current_hour
        try:
            self.on_memory_digest()
        except Exception:
            pass
