#!/usr/bin/env python3
"""
SVG-to-GCode Daemon

Main daemon process that watches for SVG files, converts them to G-code,
tracks label history, archives completed jobs, and sends webhook notifications.
"""

import json
import logging
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional
from flask import Flask, jsonify, request

from label_history import LabelHistoryDB, LabelRecord
from label_archiver import LabelArchiver
from webhook_notifier import WebhookNotifier, WebhookEvent


class SVGToGcodeDaemon:
    """Main daemon application."""

    def __init__(self, config_path: str):
        """
        Initialize daemon.

        Args:
            config_path: Path to configuration file
        """
        self.config_path = Path(config_path)
        self.config = self._load_config()
        self._setup_logging()
        self.logger = logging.getLogger(__name__)

        # Initialize modules
        self.history_db: Optional[LabelHistoryDB] = None
        self.archiver: Optional[LabelArchiver] = None
        self.webhooks: Optional[WebhookNotifier] = None

        self._initialize_modules()

        # Flask API
        self.app = Flask(__name__)
        self._setup_routes()

    def _load_config(self) -> Dict:
        """Load configuration from JSON file with environment variable overrides."""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.config_path}")

        with open(self.config_path) as f:
            config = json.load(f)

        # Environment variable overrides for Docker compatibility
        if os.getenv('SVG2GCODE_LOG_LEVEL'):
            config.setdefault('daemon', {})['log_level'] = os.getenv('SVG2GCODE_LOG_LEVEL')
        if os.getenv('SVG2GCODE_API_PORT'):
            config.setdefault('daemon', {})['api_port'] = int(os.getenv('SVG2GCODE_API_PORT'))
        if os.getenv('SVG2GCODE_WATCH_DIR'):
            config.setdefault('daemon', {})['watch_dir'] = os.getenv('SVG2GCODE_WATCH_DIR')
        if os.getenv('SVG2GCODE_DB_PATH'):
            config.setdefault('label_history', {})['db_path'] = os.getenv('SVG2GCODE_DB_PATH')
        if os.getenv('SVG2GCODE_ARCHIVE_BASE_PATH'):
            config.setdefault('label_archive', {})['base_path'] = os.getenv('SVG2GCODE_ARCHIVE_BASE_PATH')

        return config

    def _setup_logging(self) -> None:
        """Configure logging."""
        config = self.config.get("daemon", {})
        log_level = config.get("log_level", "INFO")
        log_file = config.get("log_file", "/var/log/svg-to-gcode/daemon.log")

        # Ensure log directory exists
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        logging.basicConfig(
            level=getattr(logging, log_level),
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler(sys.stdout),
            ],
        )

    def _initialize_modules(self) -> None:
        """Initialize label history, archiver, and webhooks."""
        # Label history database
        if self.config.get("label_history", {}).get("enabled"):
            db_path = self.config["label_history"].get(
                "db_path",
                "/var/lib/svg-to-gcode/labels.db",
            )
            self.history_db = LabelHistoryDB(db_path)
            self.logger.info(f"Initialized label history database: {db_path}")

        # Label archiver
        if self.config.get("label_archive", {}).get("enabled"):
            base_path = self.config["label_archive"].get(
                "base_path",
                "/mnt/raid1/label-archive",
            )
            compression = self.config["label_archive"].get("compression", "gzip")
            cleanup_days = self.config["label_archive"].get("cleanup_days", 2555)

            self.archiver = LabelArchiver(
                base_path,
                compression=compression,
                cleanup_days=cleanup_days,
            )
            self.logger.info(f"Initialized label archiver: {base_path}")

        # Webhook notifier
        if self.config.get("webhooks", {}).get("enabled"):
            webhook_config = self.config["webhooks"]
            self.webhooks = WebhookNotifier(
                timeout_seconds=webhook_config.get("timeout_seconds", 10),
                max_retries=webhook_config.get("max_retries", 3),
            )

            # Register webhooks from config
            for endpoint in webhook_config.get("endpoints", []):
                self.webhooks.register(
                    url=endpoint.get("url"),
                    events=endpoint.get("events", []),
                    secret=endpoint.get("secret", ""),
                    active=endpoint.get("active", True),
                )
            self.logger.info(
                f"Initialized webhook notifier with "
                f"{len(self.webhooks.webhooks)} endpoints"
            )

    def record_label(
        self,
        pattern_name: str,
        piece_name: str,
        piece_id: str,
        qr_code_data: Optional[str] = None,
        print_status: str = "pending",
        job_id: Optional[str] = None,
        printer_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Optional[int]:
        """
        Record a label in the history database.

        Args:
            pattern_name: Name of the pattern
            piece_name: Name of the piece
            piece_id: Unique piece identifier
            qr_code_data: QR code data if applicable
            print_status: Current print status
            job_id: Associated job ID
            printer_id: Printer that printed the label
            notes: Optional notes

        Returns:
            Record ID if successful, None if history not enabled
        """
        if not self.history_db:
            return None

        record = LabelRecord(
            pattern_name=pattern_name,
            piece_name=piece_name,
            piece_id=piece_id,
            qr_code_data=qr_code_data,
            print_status=print_status,
            job_id=job_id,
            printer_id=printer_id,
            notes=notes,
        )

        try:
            record_id = self.history_db.add_label(record)
            self.logger.info(f"Recorded label: {piece_id} (ID: {record_id})")
            return record_id
        except Exception as e:
            self.logger.error(f"Failed to record label {piece_id}: {e}")
            return None

    def archive_job_labels(
        self,
        job_id: str,
        pattern_name: str,
        label_files: list,
        preview_files: Optional[list] = None,
        metadata: Optional[Dict] = None,
    ) -> Optional[Dict]:
        """
        Archive completed job labels.

        Args:
            job_id: Unique job identifier
            pattern_name: Pattern name
            label_files: List of label file paths
            preview_files: Optional preview files
            metadata: Optional metadata

        Returns:
            Archive result dict if successful, None if archiver not enabled
        """
        if not self.archiver:
            return None

        try:
            result = self.archiver.archive_job(
                job_id=job_id,
                pattern_name=pattern_name,
                label_files=label_files,
                preview_files=preview_files,
                metadata=metadata,
            )
            self.logger.info(f"Archived job {job_id} with {result['files_archived']} labels")
            return result
        except Exception as e:
            self.logger.error(f"Failed to archive job {job_id}: {e}")
            return None

    def notify_webhooks(
        self,
        event_type: str,
        job_id: Optional[str] = None,
        data: Optional[Dict] = None,
    ) -> Optional[Dict]:
        """
        Send webhook notification.

        Args:
            event_type: Type of event (e.g., 'job.completed')
            job_id: Associated job ID
            data: Event-specific data

        Returns:
            Notification result dict if successful, None if webhooks not enabled
        """
        if not self.webhooks:
            return None

        event = WebhookEvent(
            event_type=event_type,
            timestamp=datetime.now().isoformat(),
            job_id=job_id,
            data=data or {},
        )

        result = self.webhooks.notify(event, async_delivery=True)
        self.logger.info(
            f"Sent webhook notification for {event_type}: "
            f"{len(result['deliveries'])} deliveries"
        )
        return result

    def _setup_routes(self) -> None:
        """Setup Flask API routes."""

        @self.app.route("/health", methods=["GET"])
        def health():
            return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()})

        @self.app.route("/api/labels", methods=["GET"])
        def list_labels():
            if not self.history_db:
                return jsonify({"error": "Label history not enabled"}), 503

            limit = request.args.get("limit", 100, type=int)
            offset = request.args.get("offset", 0, type=int)

            labels = self.history_db.list_labels(limit=limit, offset=offset)
            return jsonify([label.to_dict() for label in labels])

        @self.app.route("/api/labels/<piece_id>", methods=["GET"])
        def get_label(piece_id):
            if not self.history_db:
                return jsonify({"error": "Label history not enabled"}), 503

            label = self.history_db.get_label(piece_id)
            if not label:
                return jsonify({"error": "Label not found"}), 404

            return jsonify(label.to_dict())

        @self.app.route("/api/labels/search", methods=["GET"])
        def search_labels():
            if not self.history_db:
                return jsonify({"error": "Label history not enabled"}), 503

            pattern = request.args.get("pattern")
            status = request.args.get("status")
            limit = request.args.get("limit", 100, type=int)

            labels = self.history_db.search(
                pattern=pattern,
                status=status,
                limit=limit,
            )
            return jsonify([label.to_dict() for label in labels])

        @self.app.route("/api/labels/stats", methods=["GET"])
        def label_stats():
            if not self.history_db:
                return jsonify({"error": "Label history not enabled"}), 503

            stats = self.history_db.get_statistics()
            return jsonify(stats)

        @self.app.route("/api/archive", methods=["GET"])
        def list_archives():
            if not self.archiver:
                return jsonify({"error": "Label archive not enabled"}), 503

            pattern = request.args.get("pattern")
            year = request.args.get("year")

            stats = self.archiver.get_statistics()
            return jsonify(stats)

        @self.app.route("/api/archive/<job_id>", methods=["GET"])
        def get_archive(job_id):
            if not self.archiver:
                return jsonify({"error": "Label archive not enabled"}), 503

            archive = self.archiver.get_job_archive(job_id)
            if not archive:
                return jsonify({"error": "Archive not found"}), 404

            labels = self.archiver.list_job_labels(job_id)
            return jsonify({
                "job_id": job_id,
                "archive_path": archive["path"],
                "manifest": archive["manifest"],
                "labels": labels,
            })

        @self.app.route("/api/webhooks", methods=["GET"])
        def list_webhooks():
            if not self.webhooks:
                return jsonify({"error": "Webhooks not enabled"}), 503

            active_only = request.args.get("active_only", "false").lower() == "true"
            webhooks = self.webhooks.list_webhooks(active_only=active_only)
            return jsonify(webhooks)

        @self.app.route("/api/webhooks", methods=["POST"])
        def register_webhook():
            if not self.webhooks:
                return jsonify({"error": "Webhooks not enabled"}), 503

            data = request.get_json()
            webhook = self.webhooks.register(
                url=data.get("url"),
                events=data.get("events", []),
                secret=data.get("secret", ""),
            )
            return jsonify(webhook), 201

        @self.app.route("/api/webhooks/<int:webhook_id>", methods=["GET"])
        def get_webhook(webhook_id):
            if not self.webhooks:
                return jsonify({"error": "Webhooks not enabled"}), 503

            stats = self.webhooks.get_webhook_stats(webhook_id)
            if not stats:
                return jsonify({"error": "Webhook not found"}), 404

            return jsonify(stats)

        @self.app.route("/api/webhooks/<int:webhook_id>", methods=["DELETE"])
        def delete_webhook(webhook_id):
            if not self.webhooks:
                return jsonify({"error": "Webhooks not enabled"}), 503

            if self.webhooks.unregister(webhook_id):
                return "", 204
            return jsonify({"error": "Webhook not found"}), 404

    def _watch_directory(self, watch_dir: str, polling_interval: int = 2) -> None:
        """
        Poll watch directory for new SVG files (Docker-native alternative to systemd.path).

        Args:
            watch_dir: Directory to watch for SVG files
            polling_interval: Seconds between directory checks
        """
        seen_files = set()
        self.logger.info(f"Starting directory watcher on {watch_dir} with {polling_interval}s interval")

        while True:
            try:
                if os.path.exists(watch_dir):
                    current_files = {
                        f for f in os.listdir(watch_dir)
                        if f.endswith(('.svg', '.SVG'))
                    }
                    new_files = current_files - seen_files
                    for filename in new_files:
                        self.logger.info(f"Detected new SVG file: {filename}")
                        self._process_svg(os.path.join(watch_dir, filename))
                    seen_files = current_files
                time.sleep(polling_interval)
            except Exception as e:
                self.logger.error(f"Watch directory error: {e}")
                time.sleep(polling_interval)

    def _process_svg(self, filepath: str) -> None:
        """
        Process detected SVG file.

        Note: Phase 4 focuses on label tracking and archival.
        SVG conversion is handled by Phase 1-3 components.

        Args:
            filepath: Path to SVG file detected
        """
        self.logger.info(f"Processing SVG file: {filepath}")
        # Placeholder for SVG processing logic
        # Real conversion logic is implemented in Phase 1-3 (Rust-based)

    def run(self, host: str = "0.0.0.0", port: Optional[int] = None) -> None:
        """
        Start the daemon.

        Args:
            host: Host to bind to
            port: Port to bind to (uses config if not specified)
        """
        if port is None:
            port = self.config.get("daemon", {}).get("api_port", 8765)

        # Start file watcher in background thread (if enabled)
        if os.getenv('ENABLE_FILE_WATCH', 'true').lower() == 'true':
            watch_dir = self.config.get('daemon', {}).get('watch_dir', '/mnt/raid1/gcode')
            watch_interval = int(os.getenv('WATCH_INTERVAL', '2'))
            watcher_thread = threading.Thread(
                target=self._watch_directory,
                args=(watch_dir, watch_interval),
                daemon=True
            )
            watcher_thread.start()
            self.logger.info(f"File watcher thread started")

        self.logger.info(f"Starting SVG-to-GCode daemon on {host}:{port}")
        self.app.run(host=host, port=port, debug=False)

    def cleanup(self) -> None:
        """Cleanup resources."""
        if self.history_db:
            self.history_db.close()
        if self.webhooks:
            self.webhooks.stop()
        self.logger.info("Daemon cleanup complete")


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="SVG-to-GCode Daemon")
    parser.add_argument(
        "--config",
        default="/etc/svg-to-gcode/config.json",
        help="Path to configuration file",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="Port to bind to",
    )

    args = parser.parse_args()

    try:
        daemon = SVGToGcodeDaemon(args.config)
        daemon.run(host=args.host, port=args.port)
    except KeyboardInterrupt:
        print("\nShutting down...")
        daemon.cleanup()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
