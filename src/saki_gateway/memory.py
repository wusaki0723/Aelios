from __future__ import annotations

import json
import math
import sqlite3
import struct
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, List, Optional


def pack_embedding(values: Iterable[float]) -> bytes:
    values = list(values)
    if not values:
        return b""
    return struct.pack(f"<{len(values)}f", *values)


def unpack_embedding(blob: bytes) -> List[float]:
    if not blob:
        return []
    count = len(blob) // 4
    return list(struct.unpack(f"<{count}f", blob))


def cosine_similarity(left: List[float], right: List[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(v * v for v in left))
    right_norm = math.sqrt(sum(v * v for v in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


@dataclass
class MemoryRecord:
    id: str
    key: str
    content: str
    memory_kind: str
    category: str
    importance: float
    session_id: str
    created_at: str
    updated_at: str
    final_score: float = 0.0
    vector_score: float = 0.0
    keyword_score: float = 0.0


class MemoryStore:
    def __init__(
        self, db_path: Path, vector_weight: float = 0.7, keyword_weight: float = 0.3
    ):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.vector_weight = vector_weight
        self.keyword_weight = keyword_weight
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
            CREATE TABLE IF NOT EXISTS memories (
              id TEXT PRIMARY KEY,
              key TEXT NOT NULL,
              content TEXT NOT NULL,
              memory_kind TEXT NOT NULL DEFAULT 'long_term',
              category TEXT NOT NULL,
              importance REAL DEFAULT 0.5,
              session_id TEXT DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              embedding BLOB DEFAULT X''
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
              key,
              content,
              content='memories',
              content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
              INSERT INTO memories_fts(rowid, key, content)
              VALUES (new.rowid, new.key, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
              INSERT INTO memories_fts(memories_fts, rowid, key, content)
              VALUES ('delete', old.rowid, old.key, old.content);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
              INSERT INTO memories_fts(memories_fts, rowid, key, content)
              VALUES ('delete', old.rowid, old.key, old.content);
              INSERT INTO memories_fts(rowid, key, content)
              VALUES (new.rowid, new.key, new.content);
            END;

            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
                """
            )
            columns = {
                str(row["name"])
                for row in self.conn.execute("PRAGMA table_info(memories)").fetchall()
            }
            if "memory_kind" not in columns:
                self.conn.execute(
                    "ALTER TABLE memories ADD COLUMN memory_kind TEXT NOT NULL DEFAULT 'long_term'"
                )
            self.conn.commit()

    def add_event(self, event_type: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO events(event_type, payload, created_at) VALUES(?, ?, ?)",
                (
                    event_type,
                    json.dumps(payload, ensure_ascii=False),
                    datetime.utcnow().isoformat(),
                ),
            )
            self.conn.commit()

    def list_events(self, limit: int = 20) -> List[dict[str, Any]]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT id, event_type, payload, created_at FROM events ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        items: List[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(row["payload"] or "{}")
            except json.JSONDecodeError:
                payload = {"raw": row["payload"]}
            items.append(
                {
                    "id": row["id"],
                    "event_type": row["event_type"],
                    "payload": payload,
                    "created_at": row["created_at"],
                }
            )
        return items

    def upsert_memory(
        self,
        *,
        memory_id: str,
        key: str,
        content: str,
        memory_kind: str = "long_term",
        category: str = "other",
        importance: float = 0.5,
        session_id: str = "",
        embedding: Optional[List[float]] = None,
    ) -> MemoryRecord:
        now = datetime.utcnow().isoformat()
        with self._lock:
            created_at = self.conn.execute(
                "SELECT created_at FROM memories WHERE id = ?",
                (memory_id,),
            ).fetchone()
            self.conn.execute(
                """
            INSERT INTO memories(id, key, content, memory_kind, category, importance, session_id, created_at, updated_at, embedding)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              key=excluded.key,
              content=excluded.content,
              memory_kind=excluded.memory_kind,
              category=excluded.category,
              importance=excluded.importance,
              session_id=excluded.session_id,
              updated_at=excluded.updated_at,
              embedding=excluded.embedding
            """,
                (
                    memory_id,
                    key,
                    content,
                    memory_kind,
                    category,
                    importance,
                    session_id,
                    created_at[0] if created_at else now,
                    now,
                    pack_embedding(embedding or []),
                ),
            )
            self.conn.commit()
            row = self.conn.execute(
                "SELECT * FROM memories WHERE id = ?", (memory_id,)
            ).fetchone()
        return self._row_to_record(row)

    def list_memories(
        self, limit: int = 50, memory_kind: str = "long_term"
    ) -> List[MemoryRecord]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT * FROM memories WHERE memory_kind = ? ORDER BY updated_at DESC LIMIT ?",
                (memory_kind, limit),
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def list_all_memories(self, limit: int = 50) -> List[MemoryRecord]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def get_memory(self, memory_id: str) -> Optional[MemoryRecord]:
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM memories WHERE id = ?", (memory_id,)
            ).fetchone()
        if row is None:
            return None
        return self._row_to_record(row)

    def delete_memory(self, memory_id: str) -> bool:
        with self._lock:
            cursor = self.conn.execute(
                "DELETE FROM memories WHERE id = ?", (memory_id,)
            )
            self.conn.commit()
        return cursor.rowcount > 0

    def delete_memories(self, memory_kinds: Optional[Iterable[str]] = None) -> int:
        with self._lock:
            if memory_kinds is None:
                cursor = self.conn.execute("DELETE FROM memories")
            else:
                kinds = [str(kind) for kind in memory_kinds if str(kind).strip()]
                if not kinds:
                    return 0
                placeholders = ", ".join("?" for _ in kinds)
                cursor = self.conn.execute(
                    f"DELETE FROM memories WHERE memory_kind IN ({placeholders})",
                    tuple(kinds),
                )
            self.conn.commit()
        return max(cursor.rowcount, 0)

    def search(
        self,
        query: str,
        query_embedding: Optional[List[float]] = None,
        limit: int = 8,
        memory_kind: str = "long_term",
    ) -> List[MemoryRecord]:
        fallback_limit = max(limit * 6, 24)
        tokens = [token.strip() for token in query.replace("，", " ").replace(",", " ").split() if token.strip()]
        try:
            with self._lock:
                keyword_rows = self.conn.execute(
                    """
                SELECT m.*, bm25(memories_fts) AS keyword_score
                FROM memories_fts
                JOIN memories m ON m.rowid = memories_fts.rowid
                WHERE memories_fts MATCH ? AND m.memory_kind = ?
                ORDER BY keyword_score
                LIMIT ?
                    """,
                    (" OR ".join(dict.fromkeys(tokens)) or query, memory_kind, fallback_limit),
                ).fetchall()
        except sqlite3.Error:
            keyword_rows = []

        if not keyword_rows:
            like_clauses = []
            params: list[Any] = [memory_kind]
            search_terms = tokens or [query]
            for token in search_terms[:8]:
                like_clauses.append("key LIKE ? OR content LIKE ?")
                params.extend([f"%{token}%", f"%{token}%"])
            where_clause = " OR ".join(f"({clause})" for clause in like_clauses) or "(key LIKE ? OR content LIKE ?)"
            if not like_clauses:
                params.extend([f"%{query}%", f"%{query}%"])
            params.append(fallback_limit)
            with self._lock:
                keyword_rows = self.conn.execute(
                    f"""
                SELECT *, 0.5 AS keyword_score
                FROM memories
                WHERE memory_kind = ? AND ({where_clause})
                ORDER BY updated_at DESC
                LIMIT ?
                    """,
                    tuple(params),
                ).fetchall()

        keyword_hits = []
        if keyword_rows:
            max_score = (
                max(abs(float(row["keyword_score"])) for row in keyword_rows) or 1.0
            )
            for row in keyword_rows:
                normalized = 1.0 - min(
                    abs(float(row["keyword_score"])) / max_score, 1.0
                )
                record = self._row_to_record(row)
                record.keyword_score = normalized
                keyword_hits.append(record)

        vector_hits = []
        if query_embedding:
            with self._lock:
                rows = self.conn.execute(
                    "SELECT * FROM memories WHERE memory_kind = ? AND length(embedding) > 0",
                    (memory_kind,),
                ).fetchall()
            for row in rows:
                score = cosine_similarity(
                    query_embedding, unpack_embedding(row["embedding"])
                )
                if score <= 0.0:
                    continue
                record = self._row_to_record(row)
                record.vector_score = score
                vector_hits.append(record)
            vector_hits.sort(key=lambda item: item.vector_score, reverse=True)
            vector_hits = vector_hits[: max(limit * 3, limit)]

        merged = {}
        for record in keyword_hits:
            merged[record.id] = record
        for record in vector_hits:
            current = merged.get(record.id)
            if current:
                current.vector_score = max(current.vector_score, record.vector_score)
            else:
                merged[record.id] = record

        items = []
        for record in merged.values():
            record.final_score = (
                self.vector_weight * record.vector_score
                + self.keyword_weight * record.keyword_score
            )
            items.append(record)
        items.sort(key=lambda item: item.final_score, reverse=True)
        return items[:limit]

    def _row_to_record(self, row: sqlite3.Row) -> MemoryRecord:
        return MemoryRecord(
            id=row["id"],
            key=row["key"],
            content=row["content"],
            memory_kind=row["memory_kind"]
            if "memory_kind" in row.keys()
            else "long_term",
            category=row["category"],
            importance=float(row["importance"]),
            session_id=row["session_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
