# Docker Architecture: SVG-to-G-code System

Technical architecture for containerized Phase 1-3 (Converter) and Phase 4 (Tracking).

---

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Host Machine                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  Docker Engine (v20.10+)                   │ │
│  │                                                            │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │  svg2gcode-network (bridge network)               │  │ │
│  │  │                                                    │  │ │
│  │  │  ┌──────────────────┐    ┌──────────────────────┐ │  │ │
│  │  │  │ svg2gcode-       │    │  svg2gcode-daemon    │ │  │ │
│  │  │  │ converter        │    │                      │ │  │ │
│  │  │  │                  │    │  Python Flask REST   │ │  │ │
│  │  │  │ Rust binary      │    │  • Label History DB  │ │  │ │
│  │  │  │ • svg2gcode-cli  │    │  • Archive Manager   │ │  │ │
│  │  │  │                  │    │  • Webhook Notifier  │ │  │ │
│  │  │  │ Bash watcher     │    │                      │ │  │ │
│  │  │  │ • Polls /data    │    │  Port: 8765          │ │  │ │
│  │  │  │ • Converts SVGs  │    │                      │ │  │ │
│  │  │  │                  │    │ Health check: /health│ │  │ │
│  │  │  │ Mounts: 1.0 CPU  │    │                      │ │  │ │
│  │  │  │           1.0 GB │    │ Mounts: 0.5 CPU      │ │  │ │
│  │  │  │                  │    │         0.5 GB       │ │  │ │
│  │  │  └──────────────────┘    └──────────────────────┘ │  │ │
│  │  │           ↕                        ↕              │  │ │
│  │  │    (shared Docker network for inter-service communication)  │  │ │
│  │  │                                                    │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │                                                            │ │
│  │  Volumes:                                                 │ │
│  │  • svg2gcode-db (persistent)    → /var/lib/svg-to-gcode │ │
│  │  • svg2gcode-logs (persistent)  → /var/log/svg-to-gcode │ │
│  └────────────────────────────────────────────────────────┘ │
│                      ↕              ↕                         │
│                   (bind mount)  (bind mount)                  │
│  /mnt/raid1/gcode          /mnt/raid1/label-archive          │
│  (SVG input, G-code)       (Labels, archives, backups)       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   Other Containers                     │ │
│  │              (CNCjs, Shopfloor Tablet, etc)           │ │
│  │         Running on svg2gcode-network or host          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Phase 1-3: SVG to G-code Converter

### Container Image

**Base:** `debian:bookworm-slim`
**Size:** ~150-200MB (Rust binary statically linked, minimal runtime)

### Image Layers

```dockerfile
FROM rust:1.75-slim AS builder
  ↓
  Compile svg2gcode-cli (release mode, ~10MB binary)
  ↓
FROM debian:bookworm-slim
  ↓
  Copy svg2gcode-cli binary
  Copy svg2gcode-watcher.sh
  Install lsof (for file locking detection)
  Create non-root user (svg2gcode)
  ↓
Final image with:
  • /usr/local/bin/svg2gcode-cli     (Rust CLI tool)
  • /usr/local/bin/svg2gcode-watcher.sh (Polling script)
  • lsof utility (for lock detection)
```

### Entry Point

```bash
ENTRYPOINT ["/usr/local/bin/svg2gcode-watcher.sh"]
CMD ["/data", "2"]
```

Executes watcher script with:
- Watch directory: `/data` (mounted to `/mnt/raid1/gcode` on host)
- Poll interval: `2` seconds

### Watcher Script Logic

```
Loop every 2 seconds:
  ↓
  Find all *.svg files in /data
  ↓
  For each file:
    ├─ Check if already processed (skip if yes)
    ├─ Check if file is locked (still being written)
    │  ├─ If locked: Wait (skip this pass)
    │  └─ If unlocked: Mark as processed
    └─ Call svg2gcode-cli:
       ├─ Input: /data/design.svg
       ├─ Output: /data/design.gcode
       ├─ Settings: feedrate, tolerance, dpi
       └─ Log: "[timestamp] ✓ Generated: design.gcode"
```

### File Flow

```
User copies SVG to /mnt/raid1/gcode/
  ↓
Container bind mount sees file at /data/design.svg
  ↓
Watcher detects new SVG (within 2 seconds)
  ↓
svg2gcode-cli converts:
  design.svg (input)  → design.gcode (output)
  ↓
User finds .gcode alongside .svg in /mnt/raid1/gcode/
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `FEEDRATE` | 1000 | Machine feed rate (mm/min) |
| `TOLERANCE` | 0.5 | Curve interpolation tolerance (mm) |
| `DPI` | 96 | Dots per inch (pixel scaling) |
| `LOG_LEVEL` | INFO | Logging verbosity |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Startup time | 2-3 seconds |
| Memory (idle) | 50-80 MB |
| CPU (idle) | <1% |
| Conversion time | 0.5-5 sec per SVG (depends on complexity) |
| Throughput | ~100-200 files/day (single instance) |

### Health Status

No dedicated health check endpoint. Container is healthy if:
- Process still running
- Watch directory readable
- svg2gcode-cli binary executable

---

## Phase 4: Label Tracking & Webhooks

### Container Image

**Base:** `python:3.11-slim`
**Size:** ~180-220MB (Python runtime + Flask dependencies)

### Image Layers

```dockerfile
FROM python:3.11-slim
  ↓
  Install dependencies: curl (for health checks)
  ↓
  Copy Python modules:
    • svg-to-gcode-daemon.py (Flask app, file watcher, threading)
    • label_history.py (SQLite label database)
    • label_archiver.py (Archive management)
    • webhook_notifier.py (Async webhook delivery)
  ↓
  Install Python dependencies: Flask, requests
  ↓
  Create non-root user (svg2gcode)
  Create directories: /var/lib/svg-to-gcode, /var/log/svg-to-gcode
  ↓
Final image with:
  • Python 3.11 runtime
  • Flask web framework
  • requests library (HTTP client)
```

### Entry Point

```bash
ENTRYPOINT ["python3", "svg-to-gcode-daemon.py"]
CMD ["--config", "/etc/svg-to-gcode/config.json", "--host", "0.0.0.0", "--port", "8765"]
```

Starts Flask REST API server listening on port 8765.

### REST API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health check (returns 200 if healthy) |
| GET | `/api/labels` | List all labels (paginated) |
| POST | `/api/labels` | Create new label record |
| GET | `/api/labels/:id` | Get label by database ID |
| GET | `/api/labels/search` | Search labels by pattern/date/status |
| PUT | `/api/labels/:id/status` | Update label print status |
| GET | `/api/labels/stats` | Get label statistics |
| POST | `/api/labels/archive` | Archive completed job |
| GET | `/api/labels/export/csv` | Export all labels as CSV |
| GET | `/api/labels/export/json` | Export all labels as JSON |
| POST | `/api/labels/cleanup` | Delete old label records |
| POST | `/webhooks/subscribe` | Subscribe to events |
| GET | `/webhooks/subscriptions` | List subscriptions |
| POST | `/webhooks/test` | Test webhook delivery |

### Database Schema

SQLite database at `/var/lib/svg-to-gcode/labels.db`:

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
);

CREATE INDEX idx_piece_id ON label_history(piece_id);
CREATE INDEX idx_timestamp ON label_history(timestamp);
CREATE INDEX idx_pattern ON label_history(pattern_name);
```

### Archive Structure

Completed jobs archived to `/mnt/raid1/label-archive/`:

```
label-archive/
├── 2026/
│   └── 08/
│       ├── pattern_a/
│       │   └── job_20260817_143025/
│       │       ├── labels/
│       │       │   ├── label_001.json
│       │       │   ├── label_002.json
│       │       │   └── ...
│       │       ├── previews/
│       │       │   ├── design_001.png
│       │       │   └── ...
│       │       ├── gcode/
│       │       │   ├── design_001.gcode
│       │       │   └── ...
│       │       └── manifest.json
│       │           {
│       │             "job_id": "job_20260817_143025",
│       │             "pattern": "pattern_a",
│       │             "created": "2026-08-17T14:30:25",
│       │             "labels_count": 2,
│       │             "status": "completed"
│       │           }
│       └── pattern_b/
│           └── ...
│   └── 09/
│       └── ...
```

### Webhook Delivery

When events occur, webhook notifier:

1. Formats event payload (JSON)
2. Computes HMAC-SHA256 signature
3. Sends POST request with signature header
4. Retries on failure (exponential backoff)
5. Logs delivery status

**Signature format:**
```
X-SVG2GCODE-Signature: sha256=<hex-encoded-hmac>
```

**Example webhook payload:**
```json
{
  "event": "job.completed",
  "job_id": "job_20260817_143025",
  "timestamp": "2026-08-17T14:35:00Z",
  "pattern": "pattern_a",
  "labels": [
    {
      "piece_id": "AB001",
      "piece_name": "block_a",
      "status": "completed"
    }
  ]
}
```

### File Watching in Phase 4

Phase 4 optionally watches the same `/mnt/raid1/gcode` directory:

```python
def _watch_directory(watch_dir, polling_interval=2):
    """Poll directory for new SVG files"""
    seen_files = set()
    while True:
        current_files = {f for f in os.listdir(watch_dir) 
                        if f.endswith(('.svg', '.SVG'))}
        new_files = current_files - seen_files
        for filename in new_files:
            logger.info(f"Detected new SVG: {filename}")
            # Process file (create label record, etc.)
        seen_files = current_files
        time.sleep(polling_interval)
```

This is run in a background thread so REST API remains responsive.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SVG2GCODE_LOG_LEVEL` | INFO | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `ENABLE_FILE_WATCH` | true | Enable directory polling |
| `WATCH_INTERVAL` | 2 | Poll interval (seconds) |
| `SVG2GCODE_API_PORT` | 8765 | REST API port |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Startup time | 3-5 seconds |
| Memory (idle) | 80-120 MB |
| CPU (idle) | <1% |
| API response time | 20-50 ms |
| Database query time | <10 ms |
| Webhook delivery | 1-3 sec |

### Health Check

```bash
curl http://localhost:8765/health
{"status": "healthy"}
```

Checks:
- Flask app responsive
- Database accessible
- All modules loaded

---

## Data Flow: Complete Workflow

### Scenario: User converts and tracks an SVG

```
User places design.svg in /mnt/raid1/gcode/
  ↓
Phase 1-3 Container (Converter):
  ├─ Watcher detects design.svg (2 sec poll)
  ├─ Checks if file is locked (still being written)
  ├─ Calls svg2gcode-cli design.svg -o design.gcode
  ├─ Writes design.gcode to /mnt/raid1/gcode/
  └─ Logs: "[2026-08-17 10:05:30] ✓ Generated: design.gcode"
  ↓
User sees both files in /mnt/raid1/gcode/:
  design.svg    (45 KB)
  design.gcode  (2.5 KB)
  ↓
User creates label via API:
  POST /api/labels
  {
    "pattern_name": "quiltBlock",
    "piece_name": "block01",
    "piece_id": "QB001"
  }
  ↓
Phase 4 Container (Tracking):
  ├─ Flask receives POST request
  ├─ Creates LabelRecord instance
  ├─ Inserts into SQLite database
  ├─ Returns {"id": 1, "piece_id": "QB001", ...}
  └─ Logs: "Label created: QB001"
  ↓
User archives the job:
  POST /api/labels/archive
  {
    "job_id": "job_20260817_100530",
    "pattern": "quiltBlock",
    "labels": [1]
  }
  ↓
Phase 4 Container:
  ├─ Creates archive directory:
  │   /mnt/raid1/label-archive/2026/08/quiltBlock/job_20260817_100530/
  ├─ Copies label JSON to labels/ subdirectory
  ├─ Writes manifest.json with job metadata
  ├─ Triggers webhook (if configured)
  └─ Logs: "Archive created: job_20260817_100530"
  ↓
If webhooks enabled:
  ├─ Constructs event payload (JSON)
  ├─ Computes HMAC-SHA256 signature
  ├─ POSTs to configured webhook endpoint
  ├─ Includes X-SVG2GCODE-Signature header
  └─ Logs delivery success/failure
```

---

## Networking & Communication

### Docker Network: svg2gcode-network

Custom bridge network allowing:

```
Phase 1-3 ←→ Phase 4 (via internal network, no port exposure)
    ↓            ↓
Host can reach Phase 4 at localhost:8765
Host cannot directly reach Phase 1-3 (internal only)
```

### Port Mappings

| Service | Container Port | Host Port | Access |
|---------|----------------|-----------|----|
| Phase 4 (Flask API) | 8765 | 8765 | `curl http://localhost:8765/health` |
| Phase 1-3 | (none) | (none) | Internal only (no port exposed) |

### Inter-container Communication

Services can address each other by hostname:

```bash
# From Phase 4 container, reach Phase 1-3:
curl http://svg2gcode-converter:8765/  # (if it had API)

# From Phase 1-3, reach Phase 4:
curl http://svg2gcode-daemon:8765/health
```

(Phase 1-3 doesn't expose API, so no practical use case)

---

## Volume Mounts

### Named Volumes (Docker-managed)

| Name | Mount Point | Purpose | Persistent |
|------|-------------|---------|-----------|
| `svg2gcode-db` | `/var/lib/svg-to-gcode/` | SQLite label database | Yes |
| `svg2gcode-logs` | `/var/log/svg-to-gcode/` | Application logs | Yes |

Docker stores these under `/var/lib/docker/volumes/` on host.

### Bind Mounts (Host-managed)

| Host Path | Container Path | Container | Purpose | Read-write |
|-----------|----------------|-----------|---------|-----------|
| `/mnt/raid1/gcode` | `/data` | Phase 1-3 | SVG input, G-code output | RW |
| `/mnt/raid1/gcode` | `/mnt/raid1/gcode` | Phase 4 | Watch directory | RW |
| `/mnt/raid1/label-archive` | `/mnt/raid1/label-archive` | Phase 4 | Archive storage | RW |
| `./config/config.json` | `/etc/svg-to-gcode/config.json` | Phase 4 | Config file (read-only) | RO |

---

## Resource Management

### CPU Limits

```yaml
svg2gcode-converter:
  deploy:
    resources:
      limits:
        cpus: '1.0'           # Max 100% of 1 CPU core
      reservations:
        cpus: '0.5'           # Reserve 50% of 1 CPU

svg2gcode-daemon:
  deploy:
    resources:
      limits:
        cpus: '0.5'           # Max 50% of 1 CPU core
      reservations:
        cpus: '0.25'          # Reserve 25% of 1 CPU
```

### Memory Limits

```yaml
svg2gcode-converter:
  deploy:
    resources:
      limits:
        memory: 1G            # Max 1 GB RAM
      reservations:
        memory: 512M          # Reserve 512 MB RAM

svg2gcode-daemon:
  deploy:
    resources:
      limits:
        memory: 512M          # Max 512 MB RAM
      reservations:
        memory: 256M          # Reserve 256 MB RAM
```

---

## Security

### Non-root Users

Both containers run as `svg2gcode` (non-root) user:
- UID/GID: 1000 (unprivileged)
- No password login
- No shell access

### Security Options

```yaml
security_opt:
  - no-new-privileges:true    # Prevent privilege escalation
```

### File Permissions

```
/etc/svg-to-gcode/config.json:ro   (read-only)
/var/lib/svg-to-gcode/              (read-write, owned by svg2gcode)
/var/log/svg-to-gcode/              (read-write, owned by svg2gcode)
/mnt/raid1/gcode/                   (read-write, RAID storage)
```

### Network Isolation

- Custom bridge network (`svg2gcode-network`)
- Only Phase 4 port (8765) exposed to host
- Phase 1-3 internal only
- No direct internet access (unless webhook endpoint external)

---

## Logging

### Log Destinations

| Source | Location | Format |
|--------|----------|--------|
| Phase 1-3 | `/var/log/svg-to-gcode/` | Text with timestamps |
| Phase 4 | `/var/log/svg-to-gcode/` | Flask logs + custom logs |
| Docker Daemon | `docker logs <container>` | JSON (structured logging) |

### Log Rotation

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"    # Rotate when file reaches 10 MB
    max-file: "3"      # Keep 3 log files (30 MB total)
```

---

## Comparison: Docker vs Systemd Deployment

| Aspect | Docker | Systemd |
|--------|--------|---------|
| **Installation** | Pre-built images | Compile from source |
| **File watching** | Polling (2 sec latency) | inotify (instant) |
| **Isolation** | Container process namespace | Host process namespace |
| **Resource limits** | CPU/memory enforced | Soft limits via cgroups |
| **Portability** | Works on any Docker host | Linux + systemd only |
| **Upgrades** | Rebuild image, restart container | Rebuild binaries, restart service |
| **Data persistence** | Docker volumes + bind mounts | Host filesystem |
| **Logging** | JSON-structured | systemd journal |
| **Scaling** | Run multiple containers | Manual service instances |
| **Startup time** | ~3-5 seconds | ~1-2 seconds |
| **Complexity** | docker-compose commands | systemctl commands |

---

## Deployment Topology

```
Production Server Layout:

/mnt/
  ├── raid1/
  │   ├── gcode/                 (SVG + G-code files)
  │   └── label-archive/         (Archives + backups)
  │
  └── raid3/
      └── cnc_related/
          └── svg_deployment/    (Docker deployment)
              ├── docker-compose.yml
              ├── Dockerfile
              ├── Dockerfile.phase1
              ├── config/
              │   └── config.json
              └── [Python/Bash source]

/var/lib/docker/volumes/
  ├── svg2gcode-db/              (Label database)
  └── svg2gcode-logs/            (Application logs)

/etc/docker/daemon.json           (Docker config, if needed)
```

---

## Monitoring & Observability

### Docker Stats

```bash
docker stats --no-stream

NAME                      CPU %     MEM USAGE / LIMIT      MEM %
svg2gcode-converter       0.5%      75MB / 1GB             7.3%
svg2gcode-daemon          0.1%      95MB / 512MB           18.6%
```

### Health Checks

```bash
# Phase 4 health endpoint
curl http://localhost:8765/health
{"status": "healthy"}

# Docker health status
docker compose ps | grep health

# Container inspect
docker inspect svg2gcode-daemon --format='{{.State.Health.Status}}'
```

### Log Queries

```bash
# Last 50 lines from both services
docker compose logs --tail=50

# Errors only
docker compose logs | grep -i error

# Specific timestamp range
docker compose logs --since 30m --until 5m

# Follow live logs
docker compose logs -f
```

---

**End of Architecture Document**
