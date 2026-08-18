"""
Label History Database Module

Tracks all printed labels with metadata including timestamp, pattern, piece info,
QR codes, and print status. Supports searching, filtering, and export to CSV/JSON.
"""

import sqlite3
import json
import csv
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple


class LabelRecord:
    """Data model for a printed label record."""

    def __init__(
        self,
        pattern_name: str,
        piece_name: str,
        piece_id: str,
        qr_code_data: Optional[str] = None,
        print_status: str = "pending",
        job_id: Optional[str] = None,
        printer_id: Optional[str] = None,
        notes: Optional[str] = None,
        timestamp: Optional[datetime] = None,
        id: Optional[int] = None,
    ):
        self.id = id
        self.timestamp = timestamp or datetime.now()
        self.pattern_name = pattern_name
        self.piece_name = piece_name
        self.piece_id = piece_id
        self.qr_code_data = qr_code_data
        self.print_status = print_status
        self.job_id = job_id
        self.printer_id = printer_id
        self.notes = notes

    def to_dict(self) -> Dict:
        """Convert record to dictionary."""
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "pattern_name": self.pattern_name,
            "piece_name": self.piece_name,
            "piece_id": self.piece_id,
            "qr_code_data": self.qr_code_data,
            "print_status": self.print_status,
            "job_id": self.job_id,
            "printer_id": self.printer_id,
            "notes": self.notes,
        }


class LabelHistoryDB:
    """SQLite database for label history tracking."""

    def __init__(self, db_path: str):
        """Initialize database connection and create schema if needed."""
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False allows SQLite to be used across multiple threads
        # (safe when using a single connection object, as we do here)
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._create_schema()

    def _create_schema(self):
        """Create database schema if it doesn't exist."""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS label_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                pattern_name TEXT NOT NULL,
                piece_name TEXT NOT NULL,
                piece_id TEXT NOT NULL UNIQUE,
                qr_code_data TEXT,
                print_status TEXT DEFAULT 'pending',
                job_id TEXT,
                printer_id TEXT,
                notes TEXT
            )
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_piece_id ON label_history(piece_id)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_timestamp ON label_history(timestamp)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_pattern ON label_history(pattern_name)
            """
        )
        self.conn.commit()

    def add_label(self, record: LabelRecord) -> int:
        """
        Add a new label record to the database.

        Args:
            record: LabelRecord instance

        Returns:
            The ID of the inserted record

        Raises:
            sqlite3.IntegrityError: If piece_id already exists
        """
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO label_history
            (timestamp, pattern_name, piece_name, piece_id, qr_code_data,
             print_status, job_id, printer_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.timestamp,
                record.pattern_name,
                record.piece_name,
                record.piece_id,
                record.qr_code_data,
                record.print_status,
                record.job_id,
                record.printer_id,
                record.notes,
            ),
        )
        self.conn.commit()
        return cursor.lastrowid

    def get_label(self, piece_id: str) -> Optional[LabelRecord]:
        """
        Get a label by piece_id.

        Args:
            piece_id: The unique piece identifier

        Returns:
            LabelRecord if found, None otherwise
        """
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM label_history WHERE piece_id = ?", (piece_id,))
        row = cursor.fetchone()
        if row:
            return self._row_to_record(row)
        return None

    def get_label_by_id(self, label_id: int) -> Optional[LabelRecord]:
        """
        Get a label by database ID.

        Args:
            label_id: The database record ID

        Returns:
            LabelRecord if found, None otherwise
        """
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM label_history WHERE id = ?", (label_id,))
        row = cursor.fetchone()
        if row:
            return self._row_to_record(row)
        return None

    def list_labels(
        self, limit: int = 100, offset: int = 0, reverse: bool = True
    ) -> List[LabelRecord]:
        """
        List labels with pagination.

        Args:
            limit: Number of records to return
            offset: Number of records to skip
            reverse: Sort by timestamp descending if True

        Returns:
            List of LabelRecord instances
        """
        order = "DESC" if reverse else "ASC"
        cursor = self.conn.cursor()
        cursor.execute(
            f"""
            SELECT * FROM label_history
            ORDER BY timestamp {order}
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        return [self._row_to_record(row) for row in cursor.fetchall()]

    def search(
        self,
        pattern: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> List[LabelRecord]:
        """
        Search labels with multiple filters.

        Args:
            pattern: Filter by pattern name (substring match)
            start_date: Filter by start date (inclusive)
            end_date: Filter by end date (inclusive)
            status: Filter by print status
            limit: Maximum number of results

        Returns:
            List of matching LabelRecord instances
        """
        conditions = []
        params = []

        if pattern:
            conditions.append("pattern_name LIKE ?")
            params.append(f"%{pattern}%")

        if start_date:
            conditions.append("timestamp >= ?")
            params.append(start_date)

        if end_date:
            conditions.append("timestamp <= ?")
            params.append(end_date)

        if status:
            conditions.append("print_status = ?")
            params.append(status)

        where_clause = " AND ".join(conditions) if conditions else "1=1"
        params.append(limit)

        cursor = self.conn.cursor()
        cursor.execute(
            f"""
            SELECT * FROM label_history
            WHERE {where_clause}
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            params,
        )
        return [self._row_to_record(row) for row in cursor.fetchall()]

    def update_status(self, piece_id: str, status: str) -> bool:
        """
        Update the print status of a label.

        Args:
            piece_id: The unique piece identifier
            status: New status value (e.g., 'completed', 'failed')

        Returns:
            True if updated, False if piece_id not found
        """
        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE label_history SET print_status = ? WHERE piece_id = ?",
            (status, piece_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def count_by_pattern(self, pattern: str) -> int:
        """Count labels for a specific pattern."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM label_history WHERE pattern_name = ?", (pattern,)
        )
        return cursor.fetchone()[0]

    def count_by_status(self, status: str) -> int:
        """Count labels with a specific status."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM label_history WHERE print_status = ?", (status,)
        )
        return cursor.fetchone()[0]

    def cleanup_old_records(self, days: int = 730) -> int:
        """
        Delete records older than specified days.

        Args:
            days: Number of days to retain

        Returns:
            Number of records deleted
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        cursor = self.conn.cursor()
        cursor.execute(
            "DELETE FROM label_history WHERE timestamp < ?",
            (cutoff_date,),
        )
        self.conn.commit()
        return cursor.rowcount

    def export_csv(self, output_path: str) -> int:
        """
        Export all records to CSV file.

        Args:
            output_path: Path to output CSV file

        Returns:
            Number of records exported
        """
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM label_history ORDER BY timestamp DESC")
        rows = cursor.fetchall()

        with open(output_path, "w", newline="") as f:
            if rows:
                writer = csv.DictWriter(f, fieldnames=dict(rows[0]).keys())
                writer.writeheader()
                for row in rows:
                    writer.writerow(dict(row))

        return len(rows)

    def export_json(self, output_path: str) -> int:
        """
        Export all records to JSON file.

        Args:
            output_path: Path to output JSON file

        Returns:
            Number of records exported
        """
        records = self.list_labels(limit=999999)
        data = [record.to_dict() for record in records]

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

        return len(data)

    def get_statistics(self) -> Dict:
        """Get summary statistics about label history."""
        cursor = self.conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM label_history")
        total = cursor.fetchone()[0]

        cursor.execute(
            "SELECT COUNT(*) FROM label_history WHERE print_status = 'completed'"
        )
        completed = cursor.fetchone()[0]

        cursor.execute(
            "SELECT COUNT(DISTINCT pattern_name) FROM label_history"
        )
        patterns = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT pattern_name, COUNT(*) as count
            FROM label_history
            GROUP BY pattern_name
            ORDER BY count DESC
            LIMIT 5
            """
        )
        top_patterns = [dict(row) for row in cursor.fetchall()]

        return {
            "total_labels": total,
            "completed": completed,
            "pending": total - completed,
            "distinct_patterns": patterns,
            "top_patterns": top_patterns,
        }

    def close(self):
        """Close database connection."""
        self.conn.close()

    def _row_to_record(self, row: sqlite3.Row) -> LabelRecord:
        """Convert database row to LabelRecord."""
        timestamp = datetime.fromisoformat(row["timestamp"])
        return LabelRecord(
            id=row["id"],
            timestamp=timestamp,
            pattern_name=row["pattern_name"],
            piece_name=row["piece_name"],
            piece_id=row["piece_id"],
            qr_code_data=row["qr_code_data"],
            print_status=row["print_status"],
            job_id=row["job_id"],
            printer_id=row["printer_id"],
            notes=row["notes"],
        )

    def __enter__(self):
        """Context manager support."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager support."""
        self.close()
