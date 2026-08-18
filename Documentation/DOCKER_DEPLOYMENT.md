# Phase 4 Docker Deployment Guide

## Quick Start

Deploy Phase 4 as a Docker container in 5 minutes:

```bash
# 1. Prepare deployment directory
mkdir -p /raid3/cnc_related/svg_deployment/config
cd /raid3/cnc_related/svg_deployment

# 2. Copy files from workspace
cp /workspace/svg2gcode/Dockerfile .
cp /workspace/svg2gcode/docker-compose.yml .
cp /workspace/svg2gcode/requirements.txt .
cp /workspace/svg2gcode/.dockerignore .
cp /workspace/svg2gcode/*.py .
cp /workspace/svg2gcode/svg-to-gcode-config.json config/config.json

# 3. Build and start
docker-compose build
docker-compose up -d

# 4. Verify
curl http://localhost:8765/health
docker-compose logs svg2gcode
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│ Docker Daemon (main infrastructure)             │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─ svg2gcode-daemon container ──────────────┐ │
│  │ ├─ Python 3.11-slim base                  │ │
│  │ ├─ Flask REST API (port 8765)             │ │
│  │ ├─ Label history database                 │ │
│  │ ├─ Archive manager                        │ │
│  │ ├─ Webhook notifier                       │ │
│  │ └─ File watcher (polling, 2s interval)    │ │
│  │                                            │ │
│  │ Volumes:                                  │ │
│  │ ├─ svg2gcode-db → /var/lib/svg-to-gcode  │ │
│  │ ├─ svg2gcode-logs → /var/log/svg-to-gcode│ │
│  │ ├─ /raid1/gcode (bind mount)              │ │
│  │ └─ /raid1/label-archive (bind mount)      │ │
│  └──────────────────────────────────────────── │
│                                                 │
│  Network: svg2gcode-network (bridge)           │
└─────────────────────────────────────────────────┘
        ↓
  File System
  /raid1/gcode → SVG watch directory
  /raid1/label-archive → Job archives
```

## Directory Structure

```
/raid3/cnc_related/svg_deployment/
├── Dockerfile                    # Container image definition
├── docker-compose.yml            # Orchestration config
├── requirements.txt              # Python dependencies
├── .dockerignore                 # Build exclusions
├── label_history.py              # Label database module
├── label_archiver.py             # Archive manager module
├── webhook_notifier.py           # Webhook notification module
├── svg-to-gcode-daemon.py        # Main daemon with file watching
├── config/
│   └── config.json               # Runtime configuration (mounted)
└── data/                         # Docker-managed data
    ├── db/                       # Label history database (volume)
    ├── logs/                     # Application logs (volume)
    └── archives/                 # Symlink to /raid1/label-archive
```

## File Watching Mechanism

Phase 4 includes a **polling-based file watcher** that replaces systemd.path:

```python
# Runs in background thread
def _watch_directory(watch_dir, polling_interval=2):
    """Poll watch directory every N seconds for new .svg/.SVG files"""
    
    # Every 2 seconds (configurable via WATCH_INTERVAL):
    1. List files in /mnt/raid1/gcode matching *.svg, *.SVG
    2. Compare with previously seen files
    3. For each new file: Log detection and process
    4. Update seen files set
```

**Characteristics:**
- **Latency**: ~2-5 seconds (configurable)
- **CPU Impact**: Minimal (simple directory listing every 2s)
- **Memory**: <1MB for watcher thread
- **Reliability**: Survives container restarts, robust error handling

## Configuration

### Environment Variables

Override config.json settings via environment variables:

```bash
# In docker-compose.yml environment section
SVG2GCODE_LOG_LEVEL=INFO              # DEBUG, INFO, WARNING, ERROR
ENABLE_FILE_WATCH=true                # Enable/disable file watcher
WATCH_INTERVAL=2                      # Polling interval in seconds
SVG2GCODE_DB_PATH=/custom/path/db     # Override database path
SVG2GCODE_ARCHIVE_BASE_PATH=/custom   # Override archive path
```

### Config File (config.json)

Mounted as read-only at `/etc/svg-to-gcode/config.json`:

```json
{
  "daemon": {
    "watch_dir": "/mnt/raid1/gcode",
    "api_port": 8765,
    "log_level": "INFO"
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
    "endpoints": [{
      "url": "http://external-system:8080/webhooks/svg2gcode",
      "events": ["job.completed", "labels.printed"],
      "secret": "your-webhook-secret"
    }],
    "timeout_seconds": 10,
    "max_retries": 3
  }
}
```

## Common Operations

### Start/Stop Service

```bash
# Start container
docker-compose up -d

# Stop container (graceful shutdown, 30s timeout)
docker-compose down

# Restart container
docker-compose restart

# Check status
docker-compose ps

# View logs
docker-compose logs -f svg2gcode
```

### API Testing

```bash
# Health check
curl http://localhost:8765/health

# List labels
curl http://localhost:8765/api/labels

# Get label statistics
curl http://localhost:8765/api/labels/stats

# List archives
curl http://localhost:8765/api/archive

# Register webhook
curl -X POST http://localhost:8765/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://webhook.example.com:8080/svg2gcode",
    "events": ["job.completed"],
    "secret": "your-secret"
  }'
```

### Database Operations

```bash
# Access database in container
docker-compose exec svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/app')
from label_history import LabelHistoryDB

db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
stats = db.get_statistics()
print(f"Total labels: {stats['total_labels']}")
print(f"Completed: {stats['completed']}")
db.close()
EOF

# Export labels to CSV
docker-compose exec svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/app')
from label_history import LabelHistoryDB

db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
db.export_csv('/var/log/svg-to-gcode/labels.csv')
print("Exported to labels.csv")
db.close()
EOF
```

### File Watcher Control

```bash
# Disable file watcher (API only mode)
docker-compose down
docker-compose up -d -e ENABLE_FILE_WATCH=false

# Change polling interval to 5 seconds
docker-compose down
docker-compose up -d -e WATCH_INTERVAL=5
```

## Monitoring

### Container Health

```bash
# Real-time resource monitoring
docker stats svg2gcode-daemon

# Health check status
docker-compose ps
# Healthy status shows: Up 2 minutes (healthy)
# Unhealthy: Up 2 minutes (unhealthy)

# Health check details
docker inspect --format='{{json .State.Health}}' svg2gcode-daemon | python3 -m json.tool
```

### Logs

```bash
# Stream logs
docker-compose logs -f svg2gcode

# Last 100 lines
docker-compose logs --tail=100 svg2gcode

# Since specific time
docker-compose logs --since=10m svg2gcode

# Specific pattern
docker-compose logs svg2gcode | grep "Detected new SVG"
```

### Performance Metrics

```bash
# Memory and CPU
docker stats svg2gcode-daemon --no-stream

# Network
docker inspect svg2gcode-daemon | grep -A 10 NetworkSettings

# Volume usage
docker system df
docker volume inspect svg2gcode-db
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs svg2gcode

# Verify image exists
docker images | grep svg2gcode

# Rebuild image
docker-compose build --no-cache

# Check port conflicts
netstat -tuln | grep 8765
```

### Health Check Failing

```bash
# Test health endpoint directly
docker-compose exec svg2gcode curl http://localhost:8765/health

# Check Flask startup
docker-compose logs svg2gcode | grep "Starting SVG-to-GCode daemon"

# Verify config file accessible
docker-compose exec svg2gcode cat /etc/svg-to-gcode/config.json

# Check database initialization
docker-compose exec svg2gcode ls -la /var/lib/svg-to-gcode/
```

### File Watching Not Detecting Files

```bash
# Check watcher is running
docker-compose logs svg2gcode | grep "File watcher thread started"

# Check watch directory accessible
docker-compose exec svg2gcode ls -la /mnt/raid1/gcode

# Create test file
echo '<svg></svg>' > /raid1/gcode/test.svg

# Monitor logs for detection
docker-compose logs -f svg2gcode | grep "Detected"

# Check watch interval
docker-compose logs svg2gcode | grep "polling_interval"
```

### Database Issues

```bash
# Check database file exists
docker-compose exec svg2gcode ls -la /var/lib/svg-to-gcode/labels.db

# Verify database is not locked
docker-compose exec svg2gcode fuser /var/lib/svg-to-gcode/labels.db

# Check database integrity
docker-compose exec svg2gcode python3 << 'EOF'
import sqlite3
db = sqlite3.connect('/var/lib/svg-to-gcode/labels.db')
cursor = db.cursor()
cursor.execute("PRAGMA integrity_check")
print(cursor.fetchone())
db.close()
EOF
```

### Webhook Delivery Issues

```bash
# Check registered webhooks
curl http://localhost:8765/api/webhooks

# Get webhook statistics
curl http://localhost:8765/api/webhooks/0

# Check logs for webhook errors
docker-compose logs svg2gcode | grep webhook

# Test webhook URL manually
curl -X POST http://your-webhook-endpoint:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Backup & Recovery

### Backup Database

```bash
# Docker volume location
docker volume inspect svg2gcode-db

# Backup command
docker run --rm \
  -v svg2gcode-db:/data \
  -v /raid3/backups:/backup \
  alpine tar czf /backup/labels.db.tar.gz -C /data .

# Or use docker cp
docker-compose exec svg2gcode tar czf /var/lib/svg-to-gcode/backup.tar.gz \
  -C /var/lib svg-to-gcode/labels.db

# Copy out of container
docker cp svg2gcode-daemon:/var/lib/svg-to-gcode/backup.tar.gz /raid3/backups/
```

### Restore Database

```bash
# Stop container
docker-compose down

# Remove corrupted volume
docker volume rm svg2gcode-db

# Restore backup
docker volume create svg2gcode-db
docker run --rm \
  -v svg2gcode-db:/data \
  -v /raid3/backups:/backup \
  alpine tar xzf /backup/labels.db.tar.gz -C /data

# Start container
docker-compose up -d
```

## Performance Tuning

### Adjust Polling Interval

```bash
# Faster detection (higher CPU)
WATCH_INTERVAL=1

# Slower detection (lower CPU)
WATCH_INTERVAL=10

# Set in docker-compose.yml environment section
```

### Resource Limits

Current limits in docker-compose.yml:
- **Memory**: 512M hard limit, 256M reservation
- **CPU**: 0.5 cores limit, 0.25 core reservation

Adjust if needed:
```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'      # Increase to 1 core
      memory: 1G       # Increase to 1GB
    reservations:
      cpus: '0.5'
      memory: 512M
```

### Log Rotation

Docker log rotation configured:
- Max file size: 10MB
- Max files: 3
- Auto cleanup of old logs

## Security

### Secrets Management

**Current approach:** Webhook secrets in config.json (mounted read-only)

**For production:** Use Docker secrets:
```bash
echo "your-webhook-secret" | docker secret create webhook_secret -

# Then reference in docker-compose.yml
secrets:
  webhook_secret:
    external: true
```

### Network Isolation

- Container runs on custom network `svg2gcode-network`
- Only port 8765 exposed to host
- Network can be restricted per docker-compose.yml

### User Permissions

- Container runs as non-root user `svg2gcode`
- No privilege escalation (`no-new-privileges: true`)
- Minimal capabilities required

## Scaling

### Multiple Instances

Docker Compose doesn't support multi-instance well due to SQLite. For multiple instances:

1. **Use PostgreSQL** - Replace SQLite with PostgreSQL for shared database
2. **Use Kubernetes** - StatefulSets with persistent volumes
3. **Separate instances** - Different databases, different watch directories

### Docker Swarm/Kubernetes

For production orchestration:

```bash
# Initialize swarm (single node)
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml svg2gcode
```

## FAQ

**Q: Why polling instead of inotify in Docker?**
A: Systemd's inotify-based path units don't work across container boundaries. Polling is simple, reliable, and platform-independent.

**Q: How long does file detection take?**
A: Default 2 seconds. Configurable via `WATCH_INTERVAL` environment variable.

**Q: Can I use this with Kubernetes?**
A: Yes, convert docker-compose.yml to Kubernetes manifests. Note: SQLite limits to single replica.

**Q: What if /raid1 becomes unavailable?**
A: File watcher continues running but logs errors. Archives won't write. Restart container when mount is restored.

**Q: How do I integrate with existing Docker services?**
A: Use the custom network `svg2gcode-network`. Other containers can reach svg2gcode on `http://svg2gcode:8765`.

**Q: Can I run both systemd and Docker versions?**
A: Yes, they're independent. Different ports if needed (change api_port in config).

## Next Steps

1. Review `/workspace/svg2gcode/DEPLOYMENT_CHECKLIST.md` - Docker section
2. Copy files to `/raid3/cnc_related/svg_deployment/`
3. Update config file for your environment
4. Run `docker-compose up -d`
5. Verify with health check: `curl http://localhost:8765/health`

---

**For more information:**
- `PHASE4_IMPLEMENTATION.md` - Technical architecture
- `PHASE4_SUMMARY.md` - Feature overview
- `DEPLOYMENT_CHECKLIST.md` - Complete verification steps
