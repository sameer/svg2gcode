# Docker Quick Start: Phase 1-3 & Phase 4

Get SVG-to-G-code laser engraving system running in Docker in 5 minutes.

## Pre-flight Checklist

- [ ] Docker installed: `docker --version` shows v20.10+
- [ ] Docker Compose installed: `docker compose version` shows v2.0+
- [ ] RAID storage mounted: `ls /mnt/raid1/gcode/` returns files
- [ ] SSH access to server or console ready

## Deploy (5 minutes)

### 1. Prepare Directory (1 min)

```bash
mkdir -p /mnt/raid3/cnc_related/svg_deployment
cd /mnt/raid3/cnc_related/svg_deployment
```

### 2. Copy Files (1 min)

From the workspace repository:

```bash
# Copy application files
cp /workspace/svg2gcode/{Dockerfile,Dockerfile.phase1,docker-compose.yml,\
svg2gcode-watcher.sh,label_history.py,label_archiver.py,webhook_notifier.py,\
svg-to-gcode-daemon.py,requirements.txt,.dockerignore} \
/mnt/raid3/cnc_related/svg_deployment/

# Copy config
mkdir -p config
cp /workspace/svg2gcode/config/config.json config/

# Set permissions
chmod +x svg2gcode-watcher.sh
```

### 3. Build & Start (3 min)

```bash
cd /mnt/raid3/cnc_related/svg_deployment

# Build images (takes ~3 min, Rust compilation included)
docker compose build

# Start services
docker compose up -d

# Verify both running
docker compose ps
```

## Done! 

Both Phase 1-3 (converter) and Phase 4 (tracking) are now running.

---

## Test It Works

### Test Phase 1-3 (Converter)

```bash
# Place an SVG in the watch directory
cp ~/my_design.svg /mnt/raid1/gcode/

# Watch for conversion (within 2 seconds)
docker compose logs -f svg2gcode-converter

# Should see:
# [2026-08-17 10:05:30] Converting: my_design.svg
# [2026-08-17 10:05:32] ✓ Generated: my_design.gcode

# Verify G-code was created
ls -lh /mnt/raid1/gcode/my_design.*
```

### Test Phase 4 (API)

```bash
# Check health
curl http://localhost:8765/health
# {"status": "healthy"}

# Get empty label list
curl http://localhost:8765/api/labels
# []

# Create a label
curl -X POST http://localhost:8765/api/labels \
  -H "Content-Type: application/json" \
  -d '{"pattern_name": "test", "piece_name": "p1", "piece_id": "123"}'

# Get labels
curl http://localhost:8765/api/labels
# [{"id": 1, "pattern_name": "test", ...}]
```

---

## Stop & Start

```bash
# Stop all services
docker compose down

# Start again (preserves database)
docker compose up -d

# View logs
docker compose logs -f
```

---

## Configuration

### Change Converter Settings

Edit `docker-compose.yml`, find `svg2gcode-converter` section:

```yaml
svg2gcode-converter:
  environment:
    - FEEDRATE=1000        # Change feed rate
    - TOLERANCE=0.5        # Change tolerance
    - DPI=96               # Change DPI
```

Then restart:
```bash
docker compose down
docker compose up -d
```

### Change Tracking Settings

Edit `config/config.json`:

```json
{
  "daemon": {
    "log_level": "INFO"    # Change to "DEBUG" for verbose logs
  },
  "webhooks": {
    "endpoint": "https://your-server.com/webhook"
  }
}
```

Then restart:
```bash
docker compose restart svg2gcode-daemon
```

---

## Common Commands

```bash
# View logs
docker compose logs -f                              # Both services
docker compose logs -f svg2gcode-converter         # Converter only
docker compose logs -f svg2gcode-daemon            # Tracking only

# Check status
docker compose ps                                   # See if running
docker stats                                        # See CPU/memory

# Access container
docker compose exec svg2gcode-daemon bash          # Enter daemon container
docker compose exec svg2gcode-converter sh         # Enter converter container

# Restart one service
docker compose restart svg2gcode-converter

# View full logs (history)
docker compose logs svg2gcode-converter | head -50
docker compose logs svg2gcode-daemon | tail -100

# Clean up everything (WARNING: removes volumes!)
docker compose down -v
```

---

## Troubleshooting

### "docker compose: command not found"

Use integrated Docker Compose (no hyphen):
```bash
# NOT docker-compose up -d
docker compose up -d        # Correct
```

### Converter not detecting SVG files

```bash
# Check logs
docker compose logs svg2gcode-converter | tail -20

# Verify watch directory is accessible
ls /mnt/raid1/gcode/

# Try placing a test file
touch /mnt/raid1/gcode/test.svg
docker compose logs svg2gcode-converter | grep test.svg
```

### API returns error

```bash
# Check daemon logs
docker compose logs svg2gcode-daemon | grep -i error

# Test database
docker compose exec svg2gcode-daemon \
  sqlite3 /var/lib/svg-to-gcode/labels.db "SELECT 1;"
```

### Container keeps restarting

```bash
# View full error output
docker compose up svg2gcode-daemon    # Run in foreground (Ctrl+C to stop)

# Check logs for errors
docker compose logs svg2gcode-daemon
```

---

## Next Steps

1. **Monitor in production**
   ```bash
   docker stats           # Watch resource usage
   docker compose logs -f # Watch for errors
   ```

2. **Set up webhooks** (optional)
   - Edit `config/config.json`
   - Set webhook endpoint and secret
   - Restart: `docker compose restart svg2gcode-daemon`

3. **Backup label database**
   ```bash
   docker compose exec svg2gcode-daemon \
     cp /var/lib/svg-to-gcode/labels.db \
     /mnt/raid1/label-archive/backup.db
   ```

4. **Read full documentation**
   - See `DOCKER_DEPLOYMENT_GUIDE.md` for detailed guide
   - See `config/config.json` comments for all options

---

## Docker Compose File Location

```
/mnt/raid3/cnc_related/svg_deployment/
├── docker-compose.yml     ← Main config (defines services)
├── Dockerfile             ← Phase 4 image
├── Dockerfile.phase1      ← Phase 1-3 image
├── config/
│   └── config.json        ← Phase 4 settings
└── [Python/Bash source files]
```

To manage services, always `cd` to this directory first:
```bash
cd /mnt/raid3/cnc_related/svg_deployment
docker compose up -d
docker compose logs
```

---

## Advanced: Multiple Converter Instances

For high-volume, run 2+ converters in parallel:

Edit `docker-compose.yml`, duplicate `svg2gcode-converter` service and rename:

```yaml
services:
  svg2gcode-converter-1:
    # ... existing converter config ...

  svg2gcode-converter-2:
    build:
      context: .
      dockerfile: Dockerfile.phase1
    container_name: svg2gcode-converter-2
    environment:
      - FEEDRATE=1000
    volumes:
      - /mnt/raid1/gcode:/data:rw
    networks:
      - svg2gcode-network
```

Then:
```bash
docker compose up -d
docker compose ps    # Shows both converters running
```

---

## Emergency: Access Container Shell

```bash
# Get into Phase 4 daemon
docker compose exec svg2gcode-daemon bash
# Now you can run commands: sqlite3, curl, etc.

# Get into Phase 1-3 converter
docker compose exec svg2gcode-converter sh
# Now you can test svg2gcode-cli manually

# Exit container (Ctrl+D or type exit)
```

---

**Questions?** See full documentation in `DOCKER_DEPLOYMENT_GUIDE.md`
