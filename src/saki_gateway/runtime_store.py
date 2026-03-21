from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


@dataclass
class SessionRecord:
    session_id: str
    profile_id: str
    channel: str
    channel_user_id: str
    chat_id: str
    thread_id: str
    status: str
    created_at: str
    updated_at: str
    last_activity_at: str


@dataclass
class ReminderRecord:
    reminder_id: str
    profile_id: str
    content: str
    trigger_at: str
    status: str
    channel: str
    created_at: str
    updated_at: str
    metadata: Dict[str, Any]
    delivered_at: str = ""


class RuntimeStore:
    def __init__(self, db_path: Path, event_log_path: Path):
        self.db_path = db_path
        self.event_log_path = event_log_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.event_log_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")
            self.conn.execute("PRAGMA busy_timeout=5000")
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            self.conn.executescript(
                """
            CREATE TABLE IF NOT EXISTS profiles (
              profile_id TEXT PRIMARY KEY,
              last_channel TEXT DEFAULT '',
              channel_user_id TEXT DEFAULT '',
              chat_id TEXT DEFAULT '',
              thread_id TEXT DEFAULT '',
              last_session_id TEXT DEFAULT '',
              last_interaction_at TEXT NOT NULL,
              last_proactive_at TEXT DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
              session_id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL,
              channel TEXT DEFAULT '',
              channel_user_id TEXT DEFAULT '',
              chat_id TEXT DEFAULT '',
              thread_id TEXT DEFAULT '',
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_activity_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_profile_activity
            ON sessions(profile_id, last_activity_at DESC);

            CREATE TABLE IF NOT EXISTS session_messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              profile_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              channel TEXT DEFAULT '',
              metadata TEXT DEFAULT '{}',
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
            ON session_messages(session_id, id DESC);

            CREATE TABLE IF NOT EXISTS reminders (
              reminder_id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL,
              content TEXT NOT NULL,
              trigger_at TEXT NOT NULL,
              status TEXT NOT NULL,
              channel TEXT DEFAULT '',
              metadata TEXT DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              delivered_at TEXT DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_reminders_trigger
            ON reminders(status, trigger_at);

            CREATE TABLE IF NOT EXISTS gateway_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL,
              profile_id TEXT DEFAULT '',
              session_id TEXT DEFAULT '',
              channel TEXT DEFAULT '',
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
                """
            )
            self.conn.commit()

    def resolve_session(
        self,
        *,
        profile_id: str,
        channel: str = "",
        channel_user_id: str = "",
        chat_id: str = "",
        thread_id: str = "",
        idle_rotation_minutes: int = 360,
    ) -> SessionRecord:
        now = utcnow_iso()
        with self._lock:
            profile = self.conn.execute(
                "SELECT last_session_id FROM profiles WHERE profile_id = ?",
                (profile_id,),
            ).fetchone()
            row = None
            session_id = ""
            last_session_id = (
                str(profile["last_session_id"]).strip()
                if profile is not None and profile["last_session_id"]
                else ""
            )

            def _parse_iso(value: str) -> Optional[datetime]:
                raw = str(value or "").strip()
                if not raw:
                    return None
                try:
                    dt = datetime.fromisoformat(raw)
                except ValueError:
                    return None
                if dt.tzinfo is None:
                    return dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)

            now_dt = _parse_iso(now) or datetime.now(timezone.utc)
            idle_limit = max(1, int(idle_rotation_minutes or 0))

            def _matches_target(candidate: sqlite3.Row) -> bool:
                if candidate is None:
                    return False
                # 跨 channel 共享上下文：对于 local-user，忽略所有 channel 相关参数
                if profile_id == "local-user":
                    return True
                if channel and str(candidate["channel"] or "") != channel:
                    return False
                if channel_user_id and str(candidate["channel_user_id"] or "") != channel_user_id:
                    return False
                if chat_id and str(candidate["chat_id"] or "") != chat_id:
                    return False
                if thread_id and str(candidate["thread_id"] or "") != thread_id:
                    return False
                if not chat_id and str(candidate["chat_id"] or ""):
                    return False
                if not thread_id and str(candidate["thread_id"] or ""):
                    return False
                return True

            def _is_expired(candidate: sqlite3.Row) -> bool:
                if candidate is None:
                    return True
                last_activity = _parse_iso(str(candidate["last_activity_at"] or ""))
                if last_activity is None:
                    return False
                return now_dt - last_activity > timedelta(minutes=idle_limit)

            if last_session_id:
                candidate = self.conn.execute(
                    "SELECT * FROM sessions WHERE session_id = ? AND profile_id = ?",
                    (last_session_id, profile_id),
                ).fetchone()
                if _matches_target(candidate) and not _is_expired(candidate):
                    row = candidate

            if row is None:
                clauses = ["profile_id = ?"]
                params: List[Any] = [profile_id]
                # 跨 channel 共享上下文：对于 local-user，只按 profile_id 查找
                if profile_id != "local-user":
                    if channel:
                        clauses.append("channel = ?")
                        params.append(channel)
                    if channel_user_id:
                        clauses.append("channel_user_id = ?")
                        params.append(channel_user_id)
                    if chat_id:
                        clauses.append("chat_id = ?")
                        params.append(chat_id)
                    else:
                        clauses.append("COALESCE(chat_id, '') = ''")
                    if thread_id:
                        clauses.append("thread_id = ?")
                        params.append(thread_id)
                    else:
                        clauses.append("COALESCE(thread_id, '') = ''")
                candidate = self.conn.execute(
                    f"SELECT * FROM sessions WHERE {' AND '.join(clauses)} ORDER BY last_activity_at DESC LIMIT 1",
                    tuple(params),
                ).fetchone()
                if candidate is not None and not _is_expired(candidate):
                    row = candidate

            if row is not None:
                session_id = str(row["session_id"])
                self.conn.execute(
                    """
                    UPDATE sessions
                    SET channel = ?, channel_user_id = ?, chat_id = ?, thread_id = ?, updated_at = ?, last_activity_at = ?
                    WHERE session_id = ?
                    """,
                    (
                        channel,
                        channel_user_id,
                        chat_id,
                        thread_id,
                        now,
                        now,
                        session_id,
                    ),
                )

            if not session_id:
                session_id = f"sess_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
                self.conn.execute(
                    """
                    INSERT INTO sessions(session_id, profile_id, channel, channel_user_id, chat_id, thread_id, status, created_at, updated_at, last_activity_at)
                    VALUES(?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
                    """,
                    (
                        session_id,
                        profile_id,
                        channel,
                        channel_user_id,
                        chat_id,
                        thread_id,
                        now,
                        now,
                        now,
                    ),
                )
            self._touch_profile(
                profile_id=profile_id,
                channel=channel,
                channel_user_id=channel_user_id,
                chat_id=chat_id,
                thread_id=thread_id,
                session_id=session_id,
                interaction_at=now,
            )
            self.conn.commit()
        return self.get_session(session_id)

    def get_session(self, session_id: str) -> SessionRecord:
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row is None:
            raise KeyError("session not found")
        return self._row_to_session(row)

    def list_sessions(
        self, profile_id: str = "", limit: int = 20
    ) -> List[SessionRecord]:
        with self._lock:
            if profile_id:
                rows = self.conn.execute(
                    "SELECT * FROM sessions WHERE profile_id = ? ORDER BY last_activity_at DESC LIMIT ?",
                    (profile_id, limit),
                ).fetchall()
            else:
                rows = self.conn.execute(
                    "SELECT * FROM sessions ORDER BY last_activity_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        return [self._row_to_session(row) for row in rows]

    def append_message(
        self,
        *,
        session_id: str,
        profile_id: str,
        role: str,
        content: str,
        channel: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        now = utcnow_iso()
        with self._lock:
            self.conn.execute(
                """
                INSERT INTO session_messages(session_id, profile_id, role, content, channel, metadata, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    profile_id,
                    role,
                    content,
                    channel,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    now,
                ),
            )
            self.conn.execute(
                "UPDATE sessions SET updated_at = ?, last_activity_at = ? WHERE session_id = ?",
                (now, now, session_id),
            )
            self._touch_profile(
                profile_id=profile_id,
                channel=channel,
                session_id=session_id,
                interaction_at=now,
            )
            self.conn.commit()

    def list_recent_messages(
        self, session_id: str, limit: int = 50
    ) -> List[Dict[str, str]]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT role, content, created_at FROM session_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
                (session_id, limit),
            ).fetchall()
        items = [
            {
                "role": str(row["role"]),
                "content": str(row["content"]),
                "created_at": str(row["created_at"] or ""),
            }
            for row in reversed(rows)
        ]
        return items

    def list_messages_between(
        self,
        *,
        profile_id: str = "",
        session_id: str = "",
        start_at: str = "",
        end_at: str = "",
        limit: int = 2000,
    ) -> List[Dict[str, Any]]:
        clauses: List[str] = []
        values: List[Any] = []
        if profile_id:
            clauses.append("profile_id = ?")
            values.append(profile_id)
        if session_id:
            clauses.append("session_id = ?")
            values.append(session_id)
        if start_at:
            clauses.append("created_at >= ?")
            values.append(start_at)
        if end_at:
            clauses.append("created_at < ?")
            values.append(end_at)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            rows = self.conn.execute(
                f"""
                SELECT id, session_id, profile_id, role, content, channel, metadata, created_at
                FROM session_messages
                {where}
                ORDER BY id ASC
                LIMIT ?
                """,
                (*values, limit),
            ).fetchall()
        items: List[Dict[str, Any]] = []
        for row in rows:
            try:
                metadata = json.loads(str(row["metadata"] or "{}"))
            except json.JSONDecodeError:
                metadata = {"raw": row["metadata"]}
            items.append(
                {
                    "id": int(row["id"]),
                    "session_id": str(row["session_id"]),
                    "profile_id": str(row["profile_id"]),
                    "role": str(row["role"]),
                    "content": str(row["content"]),
                    "channel": str(row["channel"] or ""),
                    "metadata": metadata,
                    "created_at": str(row["created_at"]),
                }
            )
        return items

    def count_messages_between(
        self,
        *,
        profile_id: str = "",
        session_id: str = "",
        start_at: str = "",
        end_at: str = "",
    ) -> int:
        clauses: List[str] = []
        values: List[Any] = []
        if profile_id:
            clauses.append("profile_id = ?")
            values.append(profile_id)
        if session_id:
            clauses.append("session_id = ?")
            values.append(session_id)
        if start_at:
            clauses.append("created_at >= ?")
            values.append(start_at)
        if end_at:
            clauses.append("created_at < ?")
            values.append(end_at)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            row = self.conn.execute(
                f"SELECT COUNT(*) AS count FROM session_messages {where}",
                tuple(values),
            ).fetchone()
        return int(row["count"]) if row is not None else 0

    def add_event(
        self,
        event_type: str,
        payload: Dict[str, Any],
        *,
        profile_id: str = "",
        session_id: str = "",
        channel: str = "",
    ) -> None:
        now = utcnow_iso()
        payload_text = json.dumps(payload, ensure_ascii=False)
        with self._lock:
            self.conn.execute(
                """
                INSERT INTO gateway_events(event_type, profile_id, session_id, channel, payload, created_at)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (event_type, profile_id, session_id, channel, payload_text, now),
            )
            self.conn.commit()
            log_entry = {
                "event_type": event_type,
                "profile_id": profile_id,
                "session_id": session_id,
                "channel": channel,
                "payload": payload,
                "created_at": now,
            }
            with self.event_log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

    def list_events(
        self, profile_id: str = "", session_id: str = "", limit: int = 50
    ) -> List[Dict[str, Any]]:
        clauses: List[str] = []
        values: List[Any] = []
        if profile_id:
            clauses.append("profile_id = ?")
            values.append(profile_id)
        if session_id:
            clauses.append("session_id = ?")
            values.append(session_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            rows = self.conn.execute(
                f"SELECT * FROM gateway_events {where} ORDER BY id DESC LIMIT ?",
                (*values, limit),
            ).fetchall()
        items: List[Dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload"] or "{}"))
            except json.JSONDecodeError:
                payload = {"raw": row["payload"]}
            items.append(
                {
                    "id": int(row["id"]),
                    "event_type": str(row["event_type"]),
                    "profile_id": str(row["profile_id"] or ""),
                    "session_id": str(row["session_id"] or ""),
                    "channel": str(row["channel"] or ""),
                    "payload": payload,
                    "created_at": str(row["created_at"]),
                }
            )
        return items

    def create_reminder(
        self,
        *,
        reminder_id: str,
        profile_id: str,
        content: str,
        trigger_at: str,
        channel: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ReminderRecord:
        now = utcnow_iso()
        with self._lock:
            self.conn.execute(
                """
                INSERT INTO reminders(reminder_id, profile_id, content, trigger_at, status, channel, metadata, created_at, updated_at, delivered_at)
                VALUES(?, ?, ?, ?, 'pending', ?, ?, ?, ?, '')
                """,
                (
                    reminder_id,
                    profile_id,
                    content,
                    trigger_at,
                    channel,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            self.conn.commit()
        return self.get_reminder(reminder_id)

    def get_reminder(self, reminder_id: str) -> ReminderRecord:
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM reminders WHERE reminder_id = ?", (reminder_id,)
            ).fetchone()
        if row is None:
            raise KeyError("reminder not found")
        return self._row_to_reminder(row)

    def list_reminders(
        self, profile_id: str = "", status: str = "", limit: int = 100
    ) -> List[ReminderRecord]:
        clauses: List[str] = []
        values: List[Any] = []
        if profile_id:
            clauses.append("profile_id = ?")
            values.append(profile_id)
        if status:
            clauses.append("status = ?")
            values.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            rows = self.conn.execute(
                f"SELECT * FROM reminders {where} ORDER BY trigger_at ASC LIMIT ?",
                (*values, limit),
            ).fetchall()
        return [self._row_to_reminder(row) for row in rows]

    def list_due_reminders(
        self, now_iso: Optional[str] = None, limit: int = 20
    ) -> List[ReminderRecord]:
        moment = now_iso or utcnow_iso()
        with self._lock:
            rows = self.conn.execute(
                """
                SELECT * FROM reminders
                WHERE status = 'pending' AND trigger_at <= ?
                ORDER BY trigger_at ASC
                LIMIT ?
                """,
                (moment, limit),
            ).fetchall()
        return [self._row_to_reminder(row) for row in rows]

    def mark_reminder_delivered(self, reminder_id: str) -> None:
        now = utcnow_iso()
        with self._lock:
            self.conn.execute(
                "UPDATE reminders SET status = 'delivered', updated_at = ?, delivered_at = ? WHERE reminder_id = ?",
                (now, now, reminder_id),
            )
            self.conn.commit()

    def delete_reminder(self, reminder_id: str) -> bool:
        with self._lock:
            cursor = self.conn.execute(
                "DELETE FROM reminders WHERE reminder_id = ?", (reminder_id,)
            )
            self.conn.commit()
        return cursor.rowcount > 0

    def list_inactive_profiles(
        self,
        *,
        idle_hours: int,
        proactive_cooldown_hours: int,
        limit: int = 10,
        idle_minutes: int = 0,
    ) -> List[Dict[str, str]]:
        idle_delta = timedelta(
            minutes=max(idle_minutes, 0),
            hours=max(idle_hours, 0),
        )
        if idle_delta.total_seconds() <= 0:
            idle_delta = timedelta(hours=1)
        cutoff = (datetime.utcnow() - idle_delta).isoformat()
        cooldown_cutoff = (
            datetime.utcnow() - timedelta(hours=max(proactive_cooldown_hours, 1))
        ).isoformat()
        with self._lock:
            rows = self.conn.execute(
                """
                SELECT * FROM profiles
                WHERE last_interaction_at <= ?
                  AND (last_proactive_at = '' OR last_proactive_at <= ?)
                  AND channel_user_id != ''
                ORDER BY last_interaction_at ASC
                LIMIT ?
                """,
                (cutoff, cooldown_cutoff, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def mark_proactive_sent(self, profile_id: str) -> None:
        now = utcnow_iso()
        with self._lock:
            self.conn.execute(
                "UPDATE profiles SET last_proactive_at = ?, updated_at = ? WHERE profile_id = ?",
                (now, now, profile_id),
            )
            self.conn.commit()

    def profile_state(self, profile_id: str) -> Dict[str, Any]:
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM profiles WHERE profile_id = ?", (profile_id,)
            ).fetchone()
        if row is None:
            return {}
        return dict(row)

    def stats(self) -> Dict[str, int]:
        with self._lock:
            return {
                "profiles": self._count("profiles"),
                "sessions": self._count("sessions"),
                "reminders": self._count("reminders"),
                "events": self._count("gateway_events"),
            }

    def _count(self, table: str) -> int:
        with self._lock:
            row = self.conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
        return int(row["count"]) if row is not None else 0

    def _touch_profile(
        self,
        *,
        profile_id: str,
        channel: str = "",
        channel_user_id: str = "",
        chat_id: str = "",
        thread_id: str = "",
        session_id: str = "",
        interaction_at: Optional[str] = None,
    ) -> None:
        now = interaction_at or utcnow_iso()
        existing = self.conn.execute(
            "SELECT * FROM profiles WHERE profile_id = ?", (profile_id,)
        ).fetchone()
        if existing is None:
            self.conn.execute(
                """
                INSERT INTO profiles(profile_id, last_channel, channel_user_id, chat_id, thread_id, last_session_id, last_interaction_at, last_proactive_at, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, '', ?, ?)
                """,
                (
                    profile_id,
                    channel,
                    channel_user_id,
                    chat_id,
                    thread_id,
                    session_id,
                    now,
                    now,
                    now,
                ),
            )
            return
        self.conn.execute(
            """
            UPDATE profiles
            SET last_channel = ?,
                channel_user_id = CASE WHEN ? != '' THEN ? ELSE channel_user_id END,
                chat_id = CASE WHEN ? != '' THEN ? ELSE chat_id END,
                thread_id = CASE WHEN ? != '' THEN ? ELSE thread_id END,
                last_session_id = CASE WHEN ? != '' THEN ? ELSE last_session_id END,
                last_interaction_at = ?,
                updated_at = ?
            WHERE profile_id = ?
            """,
            (
                channel or str(existing["last_channel"]),
                channel_user_id,
                channel_user_id,
                chat_id,
                chat_id,
                thread_id,
                thread_id,
                session_id,
                session_id,
                now,
                now,
                profile_id,
            ),
        )

    def _row_to_session(self, row: sqlite3.Row) -> SessionRecord:
        return SessionRecord(
            session_id=str(row["session_id"]),
            profile_id=str(row["profile_id"]),
            channel=str(row["channel"] or ""),
            channel_user_id=str(row["channel_user_id"] or ""),
            chat_id=str(row["chat_id"] or ""),
            thread_id=str(row["thread_id"] or ""),
            status=str(row["status"]),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            last_activity_at=str(row["last_activity_at"]),
        )

    def _row_to_reminder(self, row: sqlite3.Row) -> ReminderRecord:
        try:
            metadata = json.loads(str(row["metadata"] or "{}"))
        except json.JSONDecodeError:
            metadata = {"raw": row["metadata"]}
        return ReminderRecord(
            reminder_id=str(row["reminder_id"]),
            profile_id=str(row["profile_id"]),
            content=str(row["content"]),
            trigger_at=str(row["trigger_at"]),
            status=str(row["status"]),
            channel=str(row["channel"] or ""),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            metadata=metadata,
            delivered_at=str(row["delivered_at"] or ""),
        )

    def _parse_time(self, value: str) -> datetime:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return datetime.utcnow()
