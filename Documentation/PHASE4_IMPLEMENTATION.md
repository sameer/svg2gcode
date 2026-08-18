# Phase 4: Systemd Integration, History & Webhooks - Implementation

## Overview

Phase 4 enhances the SVG-to-G-code system with comprehensive label tracking, archival, and external system notifications. This document describes the implementation details, architecture, and usage.

## Architecture

### Components

#### 1. Label History Database (`label_history.py`)
SQLite database module that tracks all printed labels with metadata.

**Key Classes:**
- `LabelRecord`: Data model for individual label records
- `LabelHistoryDB`: Database interface with CRUD operations

**Schema:**
```sql
CREATE TABLE label_history (
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
```

**Features:**
- Automatic timestamp recording
- Quick lookup by piece_id (indexed)
- Search by pattern, date range, and status
- Export to CSV and JSON
- Automatic cleanup of old records
- Statistics and analytics

**Example Usage:**
```python
from label_history import LabelHistoryDB, LabelRecord

db = LabelHistoryDB("/var/lib/svg-to-gcode/labels.db")

# Add a label
record = LabelRecord(
    pattern_name="shirt_v2",
    piece_name="Front Panel",
    piece_id="abc123",
    qr_code_data="QR_DATA",
    job_id="job_001"
)
record_id = db.add_label(record)

# Search labels
results = db.search(
    pattern="shirt",
    status="pending",
    limit=50
)

# Get statistics
stats = db.get_statistics()
print(f"Total: {stats['total_labels']}")

db.close()
```

#### 2. Label Archiver (`label_archiver.py`)
Organizes completed jobs into date/pattern-based archives.

**Key Class:**
- `LabelArchiver`: Manages archive creation and organization

**Archive Structure:**
```
/mnt/raid1/label-archive/
├── 2026/
│   ├── 08/
│   │   ├── shirt_v2/
│   │   │   ├── job_001/
│   │   │   │   ├── manifest.json
│   │   │   │   ├── labels/
│   │   │   │   │   ├── label_000.tspl.gz
│   │   │   │   │   └── label_001.tspl.gz
│   │   │   │   └── previews/
│   │   │   │       ├── label_000.txt
│   │   │   │       └── label_001.txt
```

**Features:**
- Auto-organize by year/month/pattern/job_id
- Optional gzip compression
- Manifest files with metadata
- Statistics and indexing
- Automatic cleanup of old archives

**Example Usage:**
```python
from label_archiver import LabelArchiver

archiver = LabelArchiver(
    base_path="/mnt/raid1/label-archive",
    compression="gzip",
    cleanup_days=2555  # 7 years
)

# Archive a job
result = archiver.archive_job(
    job_id="job_001",
    pattern_name="shirt_v2",
    label_files=["/tmp/label_000.tspl", "/tmp/label_001.tspl"],
    preview_files=["/tmp/label_000.txt"],
    metadata={"created_by": "daemon", "version": "1.0"}
)

# Retrieve archive
archive = archiver.get_job_archive("job_001")
labels = archiver.list_job_labels("job_001")

# Get statistics
stats = archiver.get_statistics()
```

#### 3. Webhook Notifier (`webhook_notifier.py`)
Sends notifications to external systems on key events.

**Key Classes:**
- `WebhookEvent`: Event data model
- `WebhookNotifier`: Webhook management and delivery

**Event Types:**
- `job.started` - Job processing started
- `job.completed` - Conversion completed
- `labels.printed` - Labels printed
- `job.failed` - Processing failed
- `archive.created` - Archive created

**Features:**
- Multiple endpoint support
- Event filtering
- HMAC-SHA256 request signing
- Automatic retry with exponential backoff
- Async queue processing
- Webhook statistics

**Example Usage:**
```python
from webhook_notifier import WebhookNotifier, WebhookEvent
from datetime import datetime

notifier = WebhookNotifier(
    timeout_seconds=10,
    max_retries=3
)

# Register webhook
webhook = notifier.register(
    url="http://external-system:8080/webhook",
    events=["job.completed"],
    secret="webhook-secret"
)

# Send event
event = WebhookEvent(
    event_type="job.completed",
    timestamp=datetime.now().isoformat(),
    job_id="job_001",
    data={"files": 3, "status": "success"}
)

result = notifier.notify(event, async_delivery=True)

notifier.stop()
```

#### 4. Daemon Integration (`svg-to-gcode-daemon.py`)
Main daemon process that integrates all Phase 4 features.

**Key Class:**
- `SVGToGcodeDaemon`: Main daemon with Flask API

**Features:**
- Initializes all Phase 4 modules
- Provides REST API for querying history/archives
- Sends webhook notifications
- Records labels to database
- Archives completed jobs

**API Endpoints:**

Health:
- `GET /health` - Daemon health check

Label History:
- `GET /api/labels` - List labels (paginated)
- `GET /api/labels/{piece_id}` - Get label details
- `GET /api/labels/search` - Search labels
- `GET /api/labels/stats` - Get statistics

Archives:
- `GET /api/archive` - List all archives
- `GET /api/archive/{job_id}` - Get job archive details

Webhooks:
- `GET /api/webhooks` - List registered webhooks
- `POST /api/webhooks` - Register new webhook
- `GET /api/webhooks/{id}` - Get webhook stats
- `DELETE /api/webhooks/{id}` - Remove webhook

**Example Usage:**
```python
daemon = SVGToGcodeDaemon("/etc/svg-to-gcode/config.json")

# Record a label
daemon.record_label(
    pattern_name="shirt_v2",
    piece_name="Front Panel",
    piece_id="abc123",
    qr_code_data="QR_DATA",
    job_id="job_001"
)

# Archive completed job
daemon.archive_job_labels(
    job_id="job_001",
    pattern_name="shirt_v2",
    label_files=["/tmp/label_000.tspl"],
    metadata={"pieces": 5}
)

# Send webhook notification
daemon.notify_webhooks(
    event_type="job.completed",
    job_id="job_001",
    data={"pieces": 5, "status": "success"}
)

daemon.run(host="0.0.0.0", port=8765)
```

### Systemd Integration

#### Service (`svg-to-gcode.service`)
- Runs daemon as unprivileged user
- Auto-restart on failure
- Integrated logging to systemd journal
- Resource limits and security hardening

#### Path Unit (`svg-to-gcode.path`)
- Watches for SVG files in watch directory
- Triggers service on file changes
- Auto-creates watch directory
- Debounce delay (500ms)

### Configuration

Configuration file: `/etc/svg-to-gcode/config.json`

```json
{
  "daemon": {
    "watch_dir": "/mnt/raid1/gcode",
    "api_port": 8765,
    "log_level": "INFO",
    "log_file": "/var/log/svg-to-gcode/daemon.log"
  },
  "label_history": {
    "enabled": true,
    "db_path": "/var/lib/svg-to-gcode/labels.db",
    "retention_days": 730
  },
  "label_archive": {
    "enabled": true,
    "base_path": "/mnt/raid1/label-archive",
    "compression": "gzip",
    "cleanup_days": 2555
  },
  "webhooks": {
    "enabled": true,
    "endpoints": [
      {
        "url": "http://external-system:8080/webhook",
        "events": ["job.completed", "labels.printed"],
        "secret": "webhook-secret",
        "active": true
      }
    ],
    "timeout_seconds": 10,
    "max_retries": 3
  }
}
```

## Installation

### Quick Install
```bash
cd /workspace/svg2gcode
sudo bash install-phase4.sh
```

### Manual Installation Steps

1. **Create user/group:**
```bash
sudo useradd -r -s /bin/false svg2gcode
```

2. **Create directories:**
```bash
sudo mkdir -p /opt/svg-to-gcode
sudo mkdir -p /etc/svg-to-gcode
sudo mkdir -p /var/lib/svg-to-gcode
sudo mkdir -p /var/log/svg-to-gcode
sudo mkdir -p /mnt/raid1/label-archive
```

3. **Copy files:**
```bash
sudo cp *.py /opt/svg-to-gcode/
sudo cp svg-to-gcode-config.json /etc/svg-to-gcode/config.json
sudo cp svg-to-gcode.service /etc/systemd/system/
sudo cp svg-to-gcode.path /etc/systemd/system/
```

4. **Set permissions:**
```bash
sudo chown -R svg2gcode:svg2gcode /opt/svg-to-gcode
sudo chown -R svg2gcode:svg2gcode /var/lib/svg-to-gcode
sudo chown -R svg2gcode:svg2gcode /var/log/svg-to-gcode
sudo chmod 750 /var/lib/svg-to-gcode
sudo chmod 750 /var/log/svg-to-gcode
```

5. **Initialize database:**
```bash
cd /opt/svg-to-gcode
python3 -c "from label_history import LabelHistoryDB; db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')"
```

6. **Reload systemd:**
```bash
sudo systemctl daemon-reload
```

## Usage

### Starting the Service

```bash
# Enable path unit (auto-watch)
sudo systemctl enable svg-to-gcode.path
sudo systemctl start svg-to-gcode.path

# Check status
sudo systemctl status svg-to-gcode.path
sudo systemctl status svg-to-gcode.service
```

### API Examples

**Check health:**
```bash
curl http://localhost:8765/health
```

**List recent labels:**
```bash
curl "http://localhost:8765/api/labels?limit=10"
```

**Search labels:**
```bash
curl "http://localhost:8765/api/labels/search?pattern=shirt&status=completed"
```

**Get label details:**
```bash
curl "http://localhost:8765/api/labels/abc123"
```

**Get label statistics:**
```bash
curl http://localhost:8765/api/labels/stats
```

**Register webhook:**
```bash
curl -X POST http://localhost:8765/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://external-system:8080/webhook",
    "events": ["job.completed"],
    "secret": "my-secret"
  }'
```

**List webhooks:**
```bash
curl http://localhost:8765/api/webhooks
```

### Webhook Signature Verification

Webhook requests include an `X-SVG2GCODE-Signature` header with HMAC-SHA256 signature.

**Python example:**
```python
import hmac
import hashlib

def verify_signature(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(
        f"sha256={expected}",
        signature
    )
```

## Monitoring and Maintenance

### View Logs

```bash
# Recent logs
sudo journalctl -u svg-to-gcode.service -n 50

# Follow logs
sudo journalctl -u svg-to-gcode.service -f

# Filter by date
sudo journalctl -u svg-to-gcode.service --since "2 hours ago"
```

### Database Maintenance

```bash
# Get statistics
python3 << 'EOF'
from label_history import LabelHistoryDB
db = LabelHistoryDB("/var/lib/svg-to-gcode/labels.db")
stats = db.get_statistics()
for key, value in stats.items():
    print(f"{key}: {value}")
db.close()
EOF

# Export data
python3 << 'EOF'
from label_history import LabelHistoryDB
db = LabelHistoryDB("/var/lib/svg-to-gcode/labels.db")
db.export_csv("/tmp/labels.csv")
db.export_json("/tmp/labels.json")
db.close()
EOF

# Cleanup old records (>730 days)
python3 << 'EOF'
from label_history import LabelHistoryDB
db = LabelHistoryDB("/var/lib/svg-to-gcode/labels.db")
deleted = db.cleanup_old_records(days=730)
print(f"Deleted {deleted} old records")
db.close()
EOF
```

### Archive Maintenance

```bash
# Get archive statistics
curl http://localhost:8765/api/archive

# List job labels
curl "http://localhost:8765/api/archive/job_001"

# Manual cleanup (>2555 days)
python3 << 'EOF'
from label_archiver import LabelArchiver
archiver = LabelArchiver("/mnt/raid1/label-archive")
deleted = archiver.cleanup_old_archives()
print(f"Deleted {deleted} old archives")
EOF
```

### Webhook Troubleshooting

```bash
# List webhooks
curl http://localhost:8765/api/webhooks

# Get webhook stats
curl "http://localhost:8765/api/webhooks/0"

# Disable webhook (temporarily)
curl -X POST http://localhost:8765/api/webhooks/0/disable

# Enable webhook
curl -X POST http://localhost:8765/api/webhooks/0/enable
```

## Testing

Run the integration test suite:

```bash
bash test-phase4-integration.sh
```

This tests:
- Label history CRUD operations
- Label archival and retrieval
- Webhook registration and management
- Configuration validation

## Troubleshooting

### Service won't start
```bash
# Check logs
sudo journalctl -u svg-to-gcode.service -n 20

# Check configuration
sudo python3 -c "import json; json.load(open('/etc/svg-to-gcode/config.json'))"

# Check permissions
ls -la /var/lib/svg-to-gcode/
ls -la /var/log/svg-to-gcode/
```

### Database locked
```bash
# Check for running processes
ps aux | grep svg-to-gcode

# Verify single daemon instance
sudo systemctl status svg-to-gcode.service

# Restart service
sudo systemctl restart svg-to-gcode.service
```

### Webhooks not delivering
```bash
# Check webhook stats
curl http://localhost:8765/api/webhooks

# Check logs
sudo journalctl -u svg-to-gcode.service | grep webhook

# Test webhook URL manually
curl -X POST http://external-system:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Performance Characteristics

- **Label History**: Sub-millisecond lookups by piece_id (indexed)
- **Archival**: ~10MB/s file copy with gzip compression
- **Webhooks**: Async queue with background workers
- **API**: <100ms response time for list operations

## Backward Compatibility

✅ Fully compatible with Phase 1-3
- All existing features unchanged
- New features are optional (configurable)
- Graceful degradation if components disabled
- Database auto-created on first run

## Security Considerations

1. **Database**: SQLite file has restricted permissions (600)
2. **Webhook Signing**: HMAC-SHA256 signatures prevent tampering
3. **Service Hardening**: 
   - Runs as unprivileged user
   - PrivateTmp, NoNewPrivileges enabled
   - ReadWritePaths restricted
4. **Secret Management**: Webhook secrets in config file (not in code)

## Docker Deployment (Alternative)

Phase 4 can be deployed as a Docker container instead of systemd service. This is ideal for environments with containerized infrastructure.

### Docker Entry Point

The daemon includes a file watching mechanism (polling-based) that replaces systemd.path functionality:

```python
# In svg-to-gcode-daemon.py
def _watch_directory(self, watch_dir, polling_interval=2):
    """Poll watch directory for new SVG files every N seconds"""
    # Detects new .svg/.SVG files and processes them
    # Configurable via WATCH_INTERVAL environment variable
```

### Docker Image Build

```bash
cd /workspace/svg2gcode
docker build -t svg2gcode:latest .
```

**Image Details:**
- Base: python:3.11-slim (~150MB)
- Includes: Flask, requests dependencies
- User: Non-root `svg2gcode`
- Port: 8765 (REST API)

### Docker Compose Deployment

```bash
# From /raid3/svg_deployment directory
docker-compose up -d
docker-compose logs -f svg2gcode

# Test API
curl http://localhost:8765/health
curl http://localhost:8765/api/labels
```

**Configuration via Environment Variables:**
- `SVG2GCODE_LOG_LEVEL` - Logging level (default: INFO)
- `ENABLE_FILE_WATCH` - Enable file watching (default: true)
- `WATCH_INTERVAL` - Polling interval in seconds (default: 2)
- `SVG2GCODE_DB_PATH` - Database path override
- `SVG2GCODE_ARCHIVE_BASE_PATH` - Archive path override

### Volume Mounts

**Required Mounts:**
```yaml
volumes:
  - ./config/config.json:/etc/svg-to-gcode/config.json:ro
  - svg2gcode-db:/var/lib/svg-to-gcode               # Database
  - svg2gcode-logs:/var/log/svg-to-gcode             # Logs
  - /raid1/gcode:/mnt/raid1/gcode:rw                 # Watch directory
  - /raid1/label-archive:/mnt/raid1/label-archive:rw # Archives
```

### Docker vs. Systemd Comparison

| Feature | Systemd | Docker |
|---------|---------|--------|
| **File Watching** | inotify (systemd.path) | Polling (2s default) |
| **Latency** | <100ms | ~2-5s |
| **Resource Usage** | Minimal | ~50-100MB memory |
| **Deployment** | Host system | Container |
| **Scaling** | Single instance | Multiple replicas |
| **Volume Mounts** | Direct filesystem | Docker volumes + bind mounts |

### Deployment Directory Structure

```
/raid3/svg_deployment/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .dockerignore
├── config/
│   └── config.json
├── data/
│   ├── db/                 # Docker volume
│   └── logs/               # Docker volume
└── [Python modules]
```

### Health Checks

Docker health check endpoint:
```bash
curl http://localhost:8765/health
# Returns: {"status": "healthy", "timestamp": "2026-08-17T..."}
```

Container automatically restarts if health check fails (3 retries, 30s interval).

## Future Enhancements

- PostgreSQL support for larger scale
- Webhook delivery analytics dashboard
- Label QR code validation
- Multi-site synchronization
- API authentication and rate limiting
