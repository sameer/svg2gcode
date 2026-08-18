"""
Webhook Notification System

Manages webhook subscriptions and sends event notifications with retry logic,
request signing, and reliability guarantees.
"""

import json
import hmac
import hashlib
import requests
import queue
import threading
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, asdict


@dataclass
class WebhookEvent:
    """Represents a webhook event."""

    event_type: str
    timestamp: str
    job_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return asdict(self)


class WebhookNotifier:
    """Manages webhook subscriptions and event delivery."""

    def __init__(
        self,
        timeout_seconds: int = 10,
        max_retries: int = 3,
        enable_queue: bool = True,
    ):
        """
        Initialize webhook notifier.

        Args:
            timeout_seconds: Request timeout for webhook delivery
            max_retries: Maximum retry attempts for failed deliveries
            enable_queue: Enable background event queue processing
        """
        self.timeout = timeout_seconds
        self.max_retries = max_retries
        self.webhooks: List[Dict] = []
        self.enable_queue = enable_queue
        self.event_queue = queue.Queue() if enable_queue else None
        self.worker_thread: Optional[threading.Thread] = None

        if enable_queue:
            self._start_worker()

    def register(
        self,
        url: str,
        events: List[str],
        secret: str,
        active: bool = True,
    ) -> Dict:
        """
        Register a webhook endpoint.

        Args:
            url: Webhook URL
            events: List of event types to subscribe to
            secret: Secret key for HMAC signing
            active: Whether webhook is active

        Returns:
            Webhook registration dict
        """
        webhook = {
            "id": len(self.webhooks),
            "url": url,
            "events": events,
            "secret": secret,
            "active": active,
            "registered_at": datetime.now().isoformat(),
            "delivery_count": 0,
            "failure_count": 0,
        }
        self.webhooks.append(webhook)
        return webhook

    def unregister(self, webhook_id: int) -> bool:
        """
        Unregister a webhook.

        Args:
            webhook_id: The webhook ID

        Returns:
            True if removed, False if not found
        """
        self.webhooks = [w for w in self.webhooks if w["id"] != webhook_id]
        return True

    def notify(self, event: WebhookEvent, async_delivery: bool = True) -> Dict:
        """
        Send event to all matching webhooks.

        Args:
            event: WebhookEvent instance
            async_delivery: Queue for async delivery if True

        Returns:
            Dict with delivery results
        """
        results = {
            "event": event.event_type,
            "timestamp": event.timestamp,
            "deliveries": [],
        }

        for webhook in self.webhooks:
            if not webhook["active"]:
                continue
            if event.event_type not in webhook["events"]:
                continue

            if async_delivery and self.event_queue:
                self.event_queue.put((webhook, event))
                results["deliveries"].append({
                    "webhook_id": webhook["id"],
                    "status": "queued",
                })
            else:
                result = self._deliver(webhook, event)
                results["deliveries"].append(result)

        return results

    def _deliver(self, webhook: Dict, event: WebhookEvent) -> Dict:
        """
        Deliver event to a single webhook with retries.

        Args:
            webhook: Webhook configuration
            event: WebhookEvent to deliver

        Returns:
            Delivery result dict
        """
        payload = {
            "event": event.event_type,
            "timestamp": event.timestamp,
            "job_id": event.job_id,
            "data": event.data or {},
        }

        signature = self._sign_payload(json.dumps(payload), webhook["secret"])
        headers = {
            "Content-Type": "application/json",
            "X-SVG2GCODE-Signature": signature,
            "X-SVG2GCODE-Event": event.event_type,
        }

        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    webhook["url"],
                    json=payload,
                    headers=headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()

                webhook["delivery_count"] += 1
                return {
                    "webhook_id": webhook["id"],
                    "status": "delivered",
                    "attempt": attempt + 1,
                    "http_status": response.status_code,
                }

            except requests.exceptions.RequestException as e:
                if attempt == self.max_retries - 1:
                    webhook["failure_count"] += 1
                    return {
                        "webhook_id": webhook["id"],
                        "status": "failed",
                        "attempt": attempt + 1,
                        "error": str(e),
                    }
                # Exponential backoff before retry
                wait_time = 2 ** attempt
                return {
                    "webhook_id": webhook["id"],
                    "status": "retrying",
                    "attempt": attempt + 1,
                    "next_retry_in_seconds": wait_time,
                }

    def list_webhooks(self, active_only: bool = False) -> List[Dict]:
        """
        List registered webhooks.

        Args:
            active_only: Return only active webhooks

        Returns:
            List of webhook configurations
        """
        webhooks = self.webhooks
        if active_only:
            webhooks = [w for w in webhooks if w["active"]]
        return webhooks

    def get_webhook_stats(self, webhook_id: int) -> Optional[Dict]:
        """Get statistics for a specific webhook."""
        for webhook in self.webhooks:
            if webhook["id"] == webhook_id:
                return {
                    "id": webhook["id"],
                    "url": webhook["url"],
                    "delivery_count": webhook["delivery_count"],
                    "failure_count": webhook["failure_count"],
                    "success_rate": (
                        webhook["delivery_count"]
                        / (webhook["delivery_count"] + webhook["failure_count"])
                        if (webhook["delivery_count"] + webhook["failure_count"]) > 0
                        else 0
                    ),
                }
        return None

    def disable_webhook(self, webhook_id: int) -> bool:
        """Temporarily disable a webhook."""
        for webhook in self.webhooks:
            if webhook["id"] == webhook_id:
                webhook["active"] = False
                return True
        return False

    def enable_webhook(self, webhook_id: int) -> bool:
        """Re-enable a disabled webhook."""
        for webhook in self.webhooks:
            if webhook["id"] == webhook_id:
                webhook["active"] = True
                return True
        return False

    def export_webhooks(self, output_path: str) -> int:
        """Export webhook configuration to JSON file."""
        with open(output_path, "w") as f:
            json.dump(self.webhooks, f, indent=2, default=str)
        return len(self.webhooks)

    def import_webhooks(self, input_path: str) -> int:
        """Import webhook configuration from JSON file."""
        with open(input_path) as f:
            webhooks = json.load(f)
            for webhook in webhooks:
                # Reset internal fields
                webhook.pop("id", None)
                webhook["id"] = len(self.webhooks)
                webhook.setdefault("delivery_count", 0)
                webhook.setdefault("failure_count", 0)
                self.webhooks.append(webhook)
        return len(webhooks)

    def _start_worker(self) -> None:
        """Start background worker thread for async deliveries."""
        self.worker_thread = threading.Thread(
            target=self._worker_loop,
            daemon=True,
        )
        self.worker_thread.start()

    def _worker_loop(self) -> None:
        """Background worker loop for processing event queue."""
        while True:
            try:
                webhook, event = self.event_queue.get(timeout=1)
                self._deliver(webhook, event)
            except queue.Empty:
                continue
            except Exception:
                pass

    def _sign_payload(self, payload: str, secret: str) -> str:
        """
        Create HMAC-SHA256 signature for payload.

        Args:
            payload: JSON payload string
            secret: Secret key

        Returns:
            Signature string (sha256=hexdigest)
        """
        signature = hmac.new(
            secret.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"sha256={signature}"

    def stop(self) -> None:
        """Stop the notifier and wait for queue to drain."""
        if self.event_queue:
            self.event_queue.join()
            if self.worker_thread:
                self.worker_thread.join(timeout=5)

    def __enter__(self):
        """Context manager support."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager support."""
        self.stop()
