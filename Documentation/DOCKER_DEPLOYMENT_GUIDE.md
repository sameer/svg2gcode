# Docker Deployment Guide: Phase 1-3 & Phase 4

Complete guide for deploying the SVG-to-G-code laser engraving system with both conversion and tracking components in Docker.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Network                           │
│  (svg2gcode-network - custom bridge)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐          ┌──────────────────┐         │
│  │  Phase 1-3       │          │  Phase 4         │         │
│  │  Converter       │          │  Tracking        │         │
│  │  (Rust/CLI)      │          │  (Python/Flask)  │         │
│  │                  │          │                  │         │
│  │ • Watches SVGs   │          │ • REST API       │         │
│  │ • Converts G-code│          │ • Label DB       │         │
│  │ • 1 CPU, 1GB RAM │          │ • Webhooks       │         │
│  │ • Port: internal │          │ • Archives       │         │
│  │                  │          │ • Port: 8765     │         │
│  └──────────────────┘          └──────────────────┘         │
│         ↕ (shared mounts)              ↕                    │
└─────────────────────────────────────────────────────────────┘
         ↓                                ↓
    /mnt/raid1/gcode              /mnt/raid1/label-archive
    (SVG input, G-code output)    (Label archives)
```

---

## Prerequisites

1. **Docker** (v20.10+) with Compose v2
   ```bash
   docker --version
   docker compose version
   ```

2. **RAID Storage** mounted and accessible
   ```bash
   ls -la /mnt/raid1/gcode/
   ls -la /mnt/raid1/label-archive/
   ```

3. **Build dependencies** (on build machine - not needed for final deployment)
   ```bash
   # For Phase 1-3 (Rust)
   rustc --version    # Usually pre-installed in build image
   
   # For Phase 4 (Python)
   python3 --version  # Included in Docker image
   ```

---

## Installation Steps

### Step 1: Prepare Deployment Directory

```bash
# Create deployment directory on /raid3
mkdir -p /mnt/raid3/cnc_related/svg_deployment
cd /mnt/raid3/cnc_related/svg_deployment

# Create subdirectories for configuration
mkdir -p config data/db data/logs data/archives
```

### Step 2: Copy Application Files

Copy these files from the repository:

```bash
# From workspace root to deployment directory
cp svg2gcode/{
  Dockerfile,
  Dockerfile.phase1,
  docker-compose.yml,
  svg2gcode-watcher.sh,
  label_history.py,
  label_archiver.py,
  webhook_notifier.py,
  svg-to-gcode-daemon.py,
  requirements.txt,
  .dockerignore
} /mnt/raid3/cnc_related/svg_deployment/

# Copy configuration
cp svg2gcode/config/config.json /mnt/raid3/cnc_related/svg_deployment/config/

# Set proper permissions
chmod +x /mnt/raid3/cnc_related/svg_deployment/svg2gcode-watcher.sh
chown -R 1000:1000 /mnt/raid3/cnc_related/svg_deployment/
```

### Step 3: Verify File Structure

```bash
tree /mnt/raid3/cnc_related/svg_deployment/

# Expected output:
# svg_deployment/
# ├── Dockerfile
# ├── Dockerfile.phase1
# ├── docker-compose.yml
# ├── svg2gcode-watcher.sh
# ├── label_history.py
# ├── label_archiver.py
# ├── webhook_notifier.py
# ├── svg-to-gcode-daemon.py
# ├── requirements.txt
# ├── .dockerignore
# └── config/
#     └── config.json
```

### Step 4: Build Docker Images

```bash
cd /mnt/raid3/cnc_related/svg_deployment

# Build both images
docker compose build

# Monitor output:
# - svg2gcode-converter: building Rust binary (may take 3-5 min)
# - svg2gcode-daemon: installing Python dependencies
```

### Step 5: Start Services

```bash
# Start in background
docker compose up -d

# Monitor startup
docker compose logs -f

# Expected output:
# svg2gcode-converter  | [2026-08-17 10:00:00] SVG to G-code Watcher started
# svg2gcode-daemon    | 2026-08-17 10:00:01 - werkzeug - INFO - Running on 0.0.0.0:8765
```

### Step 6: Verify Both Services

```bash
# Check container status
docker compose ps

# Expected output:
# NAME                      STATUS              PORTS
# svg2gcode-converter       Up 2 minutes
# svg2gcode-daemon          Up 1 minute         0.0.0.0:8765->8765/tcp

# Test Phase 4 API
curl http://localhost:8765/health

# Expected response:
# {"status": "healthy"}
```

---

## Configuration

### Phase 1-3 Converter Settings

Edit docker-compose.yml environment section:

```yaml
svg2gcode-converter:
  environment:
    - FEEDRATE=1000        # Machine feed rate (mm/min)
    - TOLERANCE=0.5        # Curve interpolation tolerance (mm)
    - DPI=96               # Dots per inch (pixel scaling)
    - LOG_LEVEL=INFO       # Debug, Info, Warning, Error
```

### Phase 4 Tracking Settings

Edit `config/config.json`:

```json
{
  "daemon": {
    "api_port": 8765,
    "log_level": "INFO",
    "watch_dir": "/mnt/raid1/gcode",
    "archive_base": "/mnt/raid1/label-archive"
  },
  "webhooks": {
    "endpoint": "https://your-webhook-receiver.com/svg2gcode",
    "secret": "your-webhook-secret"
  }
}
```

Also set via environment variables:

```bash
docker compose down
docker compose up -d -e SVG2GCODE_LOG_LEVEL=DEBUG
```

---

## Usage

### 1. Monitor File Processing

**Watch logs for both services:**

```bash
# Phase 1-3 (Converter) - shows SVG→G-code conversions
docker compose logs -f svg2gcode-converter

# Phase 4 (Tracking) - shows label tracking and webhooks
docker compose logs -f svg2gcode-daemon

# Both services
docker compose logs -f
```

### 2. Add SVG Files for Processing

```bash
# Copy SVG files to watch directory
cp my_design.svg /mnt/raid1/gcode/

# Within 2 seconds, converter detects and processes:
# [2026-08-17 10:05:30] Converting: my_design.svg
# [2026-08-17 10:05:32] ✓ Generated: my_design.gcode

# Result file appears alongside SVG
ls -lh /mnt/raid1/gcode/my_design.*
# -rw-r--r-- 1 svg2gcode svg2gcode 2.5K Aug 17 10:05 my_design.gcode
# -rw-r--r-- 1 svg2gcode svg2gcode  45K Aug 17 10:05 my_design.svg
```

### 3. Query Label History (Phase 4 API)

```bash
# Get all labels
curl http://localhost:8765/api/labels

# Create a label
curl -X POST http://localhost:8765/api/labels \
  -H "Content-Type: application/json" \
  -d '{
    "pattern_name": "testPattern",
    "piece_name": "quiltBlock01",
    "piece_id": "QB001",
    "qr_code_data": "https://example.com/QB001"
  }'

# Search labels
curl "http://localhost:8765/api/labels/search?pattern=quilt"

# Get statistics
curl http://localhost:8765/api/labels/stats
```

### 4. Export Data

```bash
# Export label history to CSV
curl http://localhost:8765/api/labels/export/csv > labels.csv

# Export to JSON
curl http://localhost:8765/api/labels/export/json > labels.json

# View exported files
ls -lh /mnt/raid1/label-archive/
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Phase 4 health endpoint
curl -v http://localhost:8765/health

# Docker health status
docker compose ps | grep -E "healthy|unhealthy"

# Container resource usage
docker stats svg2gcode-converter svg2gcode-daemon

# Expected resource usage:
# svg2gcode-converter:  ~50-100MB RAM, <5% CPU (idle)
# svg2gcode-daemon:     ~80-120MB RAM, <2% CPU (idle)
```

### Logs Management

```bash
# View live logs with timestamps
docker compose logs -f --timestamps

# Show last 100 lines
docker compose logs --tail=100

# Show logs from specific time range
docker compose logs --since 10m     # Last 10 minutes
docker compose logs --until 5m      # Until 5 minutes ago

# Log files are rotated automatically:
# Max file size: 10MB
# Max files: 3 (keeps 30MB total)
```

### Database Backup

```bash
# Backup label history database
docker cp svg2gcode-daemon:/var/lib/svg-to-gcode/labels.db ./labels.db.backup

# Backup is saved to /mnt/raid1/label-archive automatically

# Verify backup integrity
sqlite3 ./labels.db.backup "SELECT COUNT(*) FROM label_history;"
```

### Database Cleanup

```bash
# Remove old label records (>2 years)
curl -X POST http://localhost:8765/api/labels/cleanup \
  -H "Content-Type: application/json" \
  -d '{"days": 730}'
```

---

## Troubleshooting

### Issue: Converter not detecting SVG files

```bash
# Check watch directory exists and is accessible
ls -la /mnt/raid1/gcode/

# Check converter logs
docker compose logs svg2gcode-converter | tail -20

# Verify file permissions
touch /mnt/raid1/gcode/test.svg
docker compose logs svg2gcode-converter | grep "test.svg"

# If not detected, check lsof is installed in container
docker compose exec svg2gcode-converter which lsof
```

### Issue: API endpoint returns 500 error

```bash
# Check daemon logs for errors
docker compose logs svg2gcode-daemon | grep -i error

# Verify database file exists
docker compose exec svg2gcode-daemon ls -la /var/lib/svg-to-gcode/

# Check database connectivity
docker compose exec svg2gcode-daemon sqlite3 \
  /var/lib/svg-to-gcode/labels.db \
  "SELECT COUNT(*) FROM label_history;"
```

### Issue: Container keeps restarting

```bash
# Check container health
docker compose ps svg2gcode-daemon

# View full error logs
docker compose logs svg2gcode-daemon

# If crashed, restart manually with debug
docker compose up svg2gcode-daemon    # No -d flag to see output

# Check resource limits
docker stats
# If memory approaching 512M, increase limits in docker-compose.yml
```

### Issue: Conversion fails silently

```bash
# Enable debug logging
docker compose down
docker compose up -d -e LOG_LEVEL=DEBUG

# Check if svg2gcode-cli is working
docker compose exec svg2gcode-converter \
  svg2gcode-cli --help

# Test conversion manually
docker compose exec svg2gcode-converter \
  svg2gcode-cli /data/test.svg -o /data/test.gcode

# Check file permissions in /mnt/raid1/gcode
ls -l /mnt/raid1/gcode/
chmod 777 /mnt/raid1/gcode/    # If needed
```

---

## Scaling & Performance Tuning

### Running Multiple Converters

For high-volume processing, run multiple converter instances:

```yaml
# In docker-compose.yml
services:
  svg2gcode-converter-1:
    # ... existing configuration ...
    volumes:
      - /mnt/raid1/gcode:/data:rw

  svg2gcode-converter-2:
    build:
      context: .
      dockerfile: Dockerfile.phase1
    container_name: svg2gcode-converter-2
    # ... same as converter-1 ...

  # Repeat for converter-3, converter-4, etc.
```

Then start with:
```bash
docker compose up -d
```

### Tuning Polling Interval

In `docker-compose.yml`:

```yaml
svg2gcode-converter:
  command: ["/data", "1"]   # 1 second poll (more responsive, higher CPU)
  # vs
  command: ["/data", "5"]   # 5 seconds (less responsive, lower CPU)
```

### Resource Limits Adjustment

For high-throughput systems:

```yaml
svg2gcode-converter:
  deploy:
    resources:
      limits:
        cpus: '2.0'         # Increase to 2 cores
        memory: 2G          # Increase to 2GB
```

---

## Integration Examples

### With External Webhook Service

**Configure webhook in config.json:**

```json
{
  "webhooks": {
    "enabled": true,
    "endpoint": "https://example.com/api/jobs/notify",
    "secret": "your-hmac-secret",
    "events": [
      "job.started",
      "job.completed",
      "archive.created"
    ]
  }
}
```

**Incoming webhook signature verification:**

```python
import hmac
import hashlib

def verify_webhook(request_body, signature_header, secret):
    expected = hmac.new(
        secret.encode(),
        request_body.encode() if isinstance(request_body, str) else request_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

### With CI/CD Pipeline

```bash
#!/bin/bash
# Deploy script for CI/CD

cd /mnt/raid3/cnc_related/svg_deployment

# Pull latest code
git pull origin main

# Rebuild images
docker compose build --no-cache

# Perform rolling restart
docker compose up -d --no-deps --scale svg2gcode-converter=2

# Wait for health
sleep 10
docker compose ps | grep healthy || exit 1

# Run integration tests
./tests/integration-test.sh

echo "Deployment successful!"
```

---

## Upgrade Procedure

```bash
cd /mnt/raid3/cnc_related/svg_deployment

# Backup current state
docker compose exec svg2gcode-daemon \
  cp /var/lib/svg-to-gcode/labels.db \
  /mnt/raid1/label-archive/backup-$(date +%s).db

# Pull new code
git pull origin main

# Rebuild images (old images kept, tagged as <none>)
docker compose build

# Test new containers without affecting running services
docker run --rm -it svg2gcode:latest python3 -c "import flask; print(f'Flask {flask.__version__}')"

# Perform graceful shutdown and restart
docker compose down
docker compose up -d

# Verify upgrade
docker compose logs --tail=50
curl http://localhost:8765/health
```

---

## Security Considerations

### Firewall Rules

```bash
# Only expose Phase 4 API port internally
sudo ufw allow from 192.168.1.0/24 to any port 8765

# Or via iptables
sudo iptables -A INPUT -p tcp --dport 8765 -s 192.168.1.0/24 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8765 -j DROP
```

### Network Isolation

The docker-compose.yml creates a custom bridge network (`svg2gcode-network`) where:
- Phase 1-3 and Phase 4 communicate internally
- Only Phase 4 port (8765) is exposed to host

### Secrets Management

```bash
# Store webhook secret in Docker secrets (Swarm) or env file
echo "your-secret" | docker secret create svg2gcode_webhook_secret -

# Or use .env file (git-ignored)
echo "WEBHOOK_SECRET=your-secret" > .env
docker compose --env-file .env up -d
```

### Access Control

```bash
# Restrict API access via reverse proxy (nginx, Traefik)
# Example: require authentication before reaching Phase 4 API

# Or use firewall rules as shown above
```

---

## Appendix: Docker Commands Reference

```bash
# Manage containers
docker compose up -d              # Start in background
docker compose down               # Stop and remove containers
docker compose restart            # Restart services
docker compose ps                 # List containers

# View logs
docker compose logs -f            # Follow logs
docker compose logs --tail=100    # Last 100 lines
docker compose logs svg2gcode-converter  # Specific service

# Execute commands inside container
docker compose exec svg2gcode-daemon bash
docker compose exec svg2gcode-converter sh

# Manage images
docker compose build              # Build images
docker compose build --no-cache   # Force rebuild
docker image ls | grep svg2gcode  # List images
docker image rm <image>           # Remove image

# Monitor resources
docker stats                      # CPU/memory usage
docker compose logs --timestamps  # Timestamped logs

# Clean up
docker compose down -v            # Remove containers AND volumes
docker system prune               # Clean unused images/networks
```

---

## Support & Documentation

- **Phase 1-3 (svg2gcode):** https://github.com/sameer/svg2gcode
- **Phase 4 Source:** See `/workspace/svg2gcode/`
- **Docker Docs:** https://docs.docker.com/compose/
- **SQLite Guide:** https://www.sqlite.org/cli.html
