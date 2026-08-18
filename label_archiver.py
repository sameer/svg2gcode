"""
Label Archival System

Organizes completed label jobs into archives by date and pattern.
Supports compression and automatic cleanup of old archives.
"""

import json
import shutil
import gzip
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional


class LabelArchiver:
    """Manages archival of completed label jobs."""

    def __init__(
        self,
        base_path: str,
        compression: str = "gzip",
        cleanup_days: int = 2555,
    ):
        """
        Initialize archiver.

        Args:
            base_path: Base directory for archives (e.g., /mnt/raid1/label-archive)
            compression: Compression method ('gzip', 'none')
            cleanup_days: Days to retain archives before cleanup (default 7 years)
        """
        self.base_path = Path(base_path)
        self.compression = compression
        self.cleanup_days = cleanup_days
        self.base_path.mkdir(parents=True, exist_ok=True)

    def archive_job(
        self,
        job_id: str,
        pattern_name: str,
        label_files: List[str],
        preview_files: Optional[List[str]] = None,
        metadata: Optional[Dict] = None,
    ) -> Dict:
        """
        Archive a completed job.

        Args:
            job_id: Unique job identifier
            pattern_name: Name of the pattern (e.g., 'shirt_v2')
            label_files: List of paths to TSPL label files
            preview_files: Optional list of preview text files
            metadata: Optional metadata dict (timestamps, counts, etc.)

        Returns:
            Dict with archive info (path, files_archived, size)

        Raises:
            FileNotFoundError: If label files don't exist
        """
        now = datetime.now()
        year = str(now.year)
        month = f"{now.month:02d}"

        archive_dir = (
            self.base_path / year / month / pattern_name / job_id
        )
        archive_dir.mkdir(parents=True, exist_ok=True)

        labels_dir = archive_dir / "labels"
        labels_dir.mkdir(exist_ok=True)

        previews_dir = archive_dir / "previews"
        previews_dir.mkdir(exist_ok=True)

        archived_count = 0

        for label_file in label_files:
            source = Path(label_file)
            if not source.exists():
                raise FileNotFoundError(f"Label file not found: {label_file}")

            dest = labels_dir / source.name
            if self.compression == "gzip":
                self._compress_file(source, dest)
            else:
                shutil.copy2(source, dest)
            archived_count += 1

        if preview_files:
            for preview_file in preview_files:
                source = Path(preview_file)
                if source.exists():
                    dest = previews_dir / source.name
                    shutil.copy2(source, dest)

        manifest = {
            "job_id": job_id,
            "pattern_name": pattern_name,
            "archived_at": now.isoformat(),
            "label_count": len(label_files),
            "preview_count": len(preview_files) if preview_files else 0,
            "compression": self.compression,
        }

        if metadata:
            manifest.update(metadata)

        manifest_path = archive_dir / "manifest.json"
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        total_size = sum(
            f.stat().st_size for f in archive_dir.rglob("*") if f.is_file()
        )

        return {
            "archive_path": str(archive_dir),
            "files_archived": archived_count,
            "total_size": total_size,
            "manifest": manifest,
        }

    def organize_by_date(self) -> Dict[str, int]:
        """
        Count and list archives organized by date.

        Returns:
            Dict with year/month keys and archive counts
        """
        counts = {}
        for year_dir in self.base_path.glob("*/"):
            if not year_dir.is_dir():
                continue
            year = year_dir.name
            for month_dir in year_dir.glob("*/"):
                if not month_dir.is_dir():
                    continue
                month = month_dir.name
                key = f"{year}-{month}"
                count = len(list(month_dir.rglob("manifest.json")))
                counts[key] = count
        return counts

    def organize_by_pattern(self) -> Dict[str, int]:
        """
        Count and list archives organized by pattern.

        Returns:
            Dict with pattern names and archive counts
        """
        counts = {}
        for manifest_file in self.base_path.rglob("manifest.json"):
            try:
                with open(manifest_file) as f:
                    manifest = json.load(f)
                    pattern = manifest.get("pattern_name", "unknown")
                    counts[pattern] = counts.get(pattern, 0) + 1
            except (json.JSONDecodeError, IOError):
                pass
        return counts

    def get_job_archive(self, job_id: str) -> Optional[Dict]:
        """
        Retrieve information about a specific job archive.

        Args:
            job_id: The job identifier

        Returns:
            Dict with archive info if found, None otherwise
        """
        for manifest_file in self.base_path.rglob("manifest.json"):
            try:
                with open(manifest_file) as f:
                    manifest = json.load(f)
                    if manifest.get("job_id") == job_id:
                        return {
                            "path": str(manifest_file.parent),
                            "manifest": manifest,
                            "archive_dir": manifest_file.parent,
                        }
            except (json.JSONDecodeError, IOError):
                pass
        return None

    def list_job_labels(self, job_id: str) -> List[Dict]:
        """
        List all labels for a specific job.

        Args:
            job_id: The job identifier

        Returns:
            List of dicts with label info (name, size, compression)
        """
        archive = self.get_job_archive(job_id)
        if not archive:
            return []

        labels = []
        labels_dir = archive["archive_dir"] / "labels"
        if labels_dir.exists():
            for label_file in labels_dir.iterdir():
                if label_file.is_file():
                    labels.append({
                        "name": label_file.name,
                        "size": label_file.stat().st_size,
                        "path": str(label_file),
                    })

        return sorted(labels, key=lambda x: x["name"])

    def cleanup_old_archives(self) -> int:
        """
        Delete archives older than cleanup_days.

        Returns:
            Number of archives deleted
        """
        cutoff_date = datetime.now() - timedelta(days=self.cleanup_days)
        deleted_count = 0

        for archive_dir in self.base_path.rglob("manifest.json"):
            try:
                job_path = archive_dir.parent
                # Check modification time of manifest
                mtime = datetime.fromtimestamp(archive_dir.stat().st_mtime)
                if mtime < cutoff_date:
                    shutil.rmtree(job_path)
                    deleted_count += 1
            except (OSError, IOError):
                pass

        return deleted_count

    def get_statistics(self) -> Dict:
        """Get summary statistics about archives."""
        manifests = list(self.base_path.rglob("manifest.json"))

        total_size = 0
        for manifest_file in manifests:
            try:
                archive_dir = manifest_file.parent
                total_size += sum(
                    f.stat().st_size
                    for f in archive_dir.rglob("*")
                    if f.is_file()
                )
            except (OSError, IOError):
                pass

        patterns = self.organize_by_pattern()
        dates = self.organize_by_date()

        return {
            "total_archives": len(manifests),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "patterns": patterns,
            "by_date": dates,
        }

    def export_archive_index(self, output_path: str) -> int:
        """
        Export index of all archives to JSON file.

        Args:
            output_path: Path to output JSON file

        Returns:
            Number of archives indexed
        """
        archives = []
        for manifest_file in self.base_path.rglob("manifest.json"):
            try:
                with open(manifest_file) as f:
                    manifest = json.load(f)
                    archives.append({
                        "path": str(manifest_file.parent),
                        "manifest": manifest,
                    })
            except (json.JSONDecodeError, IOError):
                pass

        with open(output_path, "w") as f:
            json.dump(archives, f, indent=2)

        return len(archives)

    def _compress_file(self, source: Path, dest: Path) -> None:
        """Compress file using gzip."""
        with open(source, "rb") as f_in:
            with gzip.open(f"{dest}.gz", "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)

    def __repr__(self) -> str:
        return f"LabelArchiver(base_path={self.base_path}, compression={self.compression})"
