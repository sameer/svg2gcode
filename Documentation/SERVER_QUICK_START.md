# Phase 4 Docker - Server Quick Start Guide

**Your Server:** Docker Compose v2.25.0 (integrated version)

**Important:** Use `docker compose` (no hyphen) for all commands

## 🚀 Start Service

```bash
cd /mnt/raid3/cnc_related/svg_deployment

# Build image (first time only)
docker compose build

# Start container
docker compose up -d

# Verify it's running
docker compose ps
```

Expected output:
```
NAME                  IMAGE               STATUS
svg2gcode-daemon      svg2gcode:latest    Up 2 minutes (healthy)
```

## 🔍 Check Status & Logs

```bash
# See running containers
docker compose ps

# Follow logs in real-time
docker compose logs -f svg2gcode

# View last 50 lines
docker compose logs --tail=50 svg2gcode

# Search logs for specific text
docker compose logs svg2gcode | grep "File watcher"
```

## ✅ Test API

```bash
# Health check
curl http://localhost:8765/health

# List labels
curl http://localhost:8765/api/labels

# Get statistics
curl http://localhost:8765/api/labels/stats

# List archives
curl http://localhost:8765/api/archive
```

## 🔄 Container Management

```bash
# Restart container
docker compose restart

# Stop container
docker compose down

# Remove everything (including volumes)
docker compose down -v

# Rebuild and restart
docker compose build --no-cache
docker compose up -d
```

## 📊 Monitor Resources

```bash
# Real-time stats
docker stats svg2gcode-daemon

# Or watch mode (updates every 2 seconds)
watch -n 2 'docker stats svg2gcode-daemon --no-stream'
```

## 🧪 Test File Watcher

```bash
# Create test SVG file
echo '<svg><circle cx="50" cy="50" r="40"/></svg>' > /raid1/gcode/test.svg

# Check if detected in logs
docker compose logs svg2gcode | grep "Detected new SVG"

# Clean up
rm /raid1/gcode/test.svg
```

## 🔧 Run Commands in Container

```bash
# Run command inside container
docker compose exec svg2gcode ls -la /var/lib/svg-to-gcode

# Access Python
docker compose exec svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/app')
from label_history import LabelHistoryDB
db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
stats = db.get_statistics()
print(f"Total labels: {stats['total_labels']}")
db.close()
EOF

# Check config
docker compose exec svg2gcode cat /etc/svg-to-gcode/config.json
```

## 🛠️ Troubleshooting

### Container won't start
```bash
docker compose logs svg2gcode
docker compose ps  # Check status
```

### Health check failing
```bash
docker compose exec svg2gcode curl http://localhost:8765/health
docker compose logs svg2gcode | head -30
```

### File watching not detecting files
```bash
# Check watcher started
docker compose logs svg2gcode | grep "File watcher thread started"

# Check watch directory accessible
docker compose exec svg2gcode ls -la /mnt/raid1/gcode

# Monitor for detection
docker compose logs -f svg2gcode | grep "Detected"
```

### Database issues
```bash
# Check database file
docker compose exec svg2gcode ls -la /var/lib/svg-to-gcode/labels.db

# Verify database integrity
docker compose exec svg2gcode python3 -c "
import sqlite3
db = sqlite3.connect('/var/lib/svg-to-gcode/labels.db')
print('Database OK')
db.close()
"
```

### Port already in use
```bash
# Check what's using port 8765
netstat -tuln | grep 8765
lsof -i :8765

# Edit docker-compose.yml and change port:
# ports:
#   - "8766:8765"  # Changed from 8765:8765

docker compose up -d
```

## 📋 All Commands Reference

| Command | Purpose |
|---------|---------|
| `docker compose build` | Build image |
| `docker compose up -d` | Start service |
| `docker compose down` | Stop service |
| `docker compose restart` | Restart service |
| `docker compose ps` | Show status |
| `docker compose logs` | View all logs |
| `docker compose logs -f` | Follow logs live |
| `docker compose logs --tail=50` | Last 50 lines |
| `docker compose exec svg2gcode COMMAND` | Run command in container |
| `docker stats svg2gcode-daemon` | Monitor resources |
| `docker compose config` | Show config |
| `docker compose pull` | Pull new image version |
| `docker compose build --no-cache` | Rebuild without cache |

## 🔐 Security Notes

- Service runs as non-root user (svg2gcode)
- Database file permissions: 600 (read/write by owner only)
- Config file mounted read-only
- Network isolated (custom bridge network)
- Resource limits: 512MB memory, 0.5 CPU cores

## 📈 Performance

- Memory usage: 50-100MB typical
- CPU usage: <1% idle
- File detection latency: 2-5 seconds
- API response time: <100ms

## 🚨 Emergency Commands

```bash
# Kill and remove all (nuclear option)
docker compose down -v
docker volume rm svg2gcode-db svg2gcode-logs

# Full rebuild from scratch
docker compose build --no-cache
docker compose up -d

# Check disk usage
docker system df
docker system prune -f  # Clean up unused data
```

## 📝 Next Steps

1. **Start the service:**
   ```bash
   cd /mnt/raid3/cnc_related/svg_deployment
   docker compose up -d
   ```

2. **Verify it's working:**
   ```bash
   curl http://localhost:8765/health
   ```

3. **Monitor logs:**
   ```bash
   docker compose logs -f svg2gcode
   ```

4. **Test API:**
   ```bash
   curl http://localhost:8765/api/labels
   ```

---

**Documentation:**
- `DOCKER_DEPLOYMENT.md` - Full admin guide
- `DEPLOY_FROM_MAC.md` - Mac deployment guide
- `PHASE4_IMPLEMENTATION.md` - Technical reference
- `DEPLOYMENT_CHECKLIST.md` - Verification checklist
