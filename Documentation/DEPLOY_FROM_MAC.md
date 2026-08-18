# Deploying Phase 4 Docker from Your Mac

This guide shows how to deploy Phase 4 to your server at `fileserver.applebaum.treehouse` using your existing workflow.

## Option 1: Simple Deployment Script (Recommended)

### Setup (One-time)

```bash
cd /Users/james/Documents/CNCJS/NewDocs/appletots-laser/svg2gcode/
chmod +x deploy-phase4.sh
```

### Deploy

```bash
# Deploy to your server with full Docker setup
./deploy-phase4.sh \
  --ssh-key ~/.ssh/HP@treehouse \
  --user james \
  --host fileserver.applebaum.treehouse \
  --remote-path /mnt/raid3/cnc_related/svg_deployment

# This will:
# 1. Zip the svg2gcode directory (with Docker files included)
# 2. Copy to server via SCP
# 3. Extract on server
# 4. Build Docker image
# 5. Start Docker container
# 6. Verify health checks
```

## Option 2: Your Existing Workflow (Manual Steps)

If you prefer your original workflow with manual steps:

### Step 1: Zip and Copy

```bash
echo 'Zipped the svg2gcode Directory'
cd /Users/james/Documents/CNCJS/NewDocs/appletots-laser/svg2gcode/
zip -vr svg2gcode.zip . \
  -x ".git/*" \
     ".github/*" \
     ".git*" \
     "examples/*" \
     "__pycache__/*" \
     "*.md" \
     ".DS_Store" \
     "svg2gcode.zip"

echo 'Copied the svg2gcode Directory to the file server'
scp -i ~/.ssh/HP@treehouse /Users/james/Documents/CNCJS/NewDocs/appletots-laser/svg2gcode/svg2gcode.zip \
  james@fileserver.applebaum.treehouse:/mnt/raid3/cnc_related/svg_deployment/

echo 'Remove the zip file from the local system'
rm /Users/james/Documents/CNCJS/NewDocs/appletots-laser/svg2gcode/svg2gcode.zip
```

### Step 2: Extract and Setup on Server

```bash
ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse

# On the server:
cd /mnt/raid3/cnc_related/svg_deployment
unzip -o svg2gcode.zip
rm svg2gcode.zip

# Create config directory if needed
mkdir -p config

# Verify files
ls -la | head -20
```

### Step 3: Build and Start Docker

```bash
# On the server:
cd /mnt/raid3/cnc_related/svg_deployment

# Build the Docker image
docker-compose build

# Start the container
docker-compose up -d

# Verify it's running
docker-compose ps

# Check logs
docker-compose logs -f svg2gcode
```

### Step 4: Verify Health

```bash
# On server or from your Mac:
curl http://fileserver.applebaum.treehouse:8765/health

# Should return:
# {"status": "healthy", "timestamp": "2026-08-17T..."}
```

## Option 3: Bash Alias (Most Convenient)

Add this to your `~/.zshrc` or `~/.bash_profile`:

```bash
alias deploy-svg2gcode='cd /Users/james/Documents/CNCJS/NewDocs/appletots-laser/svg2gcode && \
  ./deploy-phase4.sh \
  --ssh-key ~/.ssh/HP@treehouse \
  --user james \
  --host fileserver.applebaum.treehouse \
  --remote-path /mnt/raid3/cnc_related/svg_deployment'
```

Then just run:
```bash
deploy-svg2gcode
```

## What Gets Deployed

The zip file includes:

**Docker Files (NEW):**
- `Dockerfile` - Container image
- `docker-compose.yml` - Orchestration
- `requirements.txt` - Python deps
- `.dockerignore` - Build optimization

**Core Python Modules:**
- `label_history.py` - Label database
- `label_archiver.py` - Archive manager
- `webhook_notifier.py` - Webhooks
- `svg-to-gcode-daemon.py` - Main daemon (with file watching)

**Configuration & Utilities:**
- `svg-to-gcode-config.json` - Config template
- `test-phase4-integration.sh` - Tests
- `install-phase4.sh` - Systemd option
- Various documentation files

**Excluded:**
- `.git/` and `.github/` directories
- `examples/` directory
- `__pycache__/` and `.pyc` files
- `.md` documentation files
- `.DS_Store` and other macOS files

## Post-Deployment

Once deployed and running:

### View Logs

```bash
ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse
cd /mnt/raid3/cnc_related/svg_deployment
docker-compose logs -f svg2gcode
```

### Test API Endpoints

```bash
# Health check
curl http://fileserver.applebaum.treehouse:8765/health

# List labels
curl http://fileserver.applebaum.treehouse:8765/api/labels

# Get statistics
curl http://fileserver.applebaum.treehouse:8765/api/labels/stats

# Register webhook
curl -X POST http://fileserver.applebaum.treehouse:8765/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://your-webhook-endpoint:8080/webhook",
    "events": ["job.completed"],
    "secret": "your-secret"
  }'
```

### Stop/Restart Container

```bash
ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse
cd /mnt/raid3/cnc_related/svg_deployment

# Stop
docker-compose down

# Restart
docker-compose up -d

# Full rebuild
docker-compose build --no-cache
docker-compose up -d
```

### Monitor Resource Usage

```bash
ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse
docker stats svg2gcode-daemon
```

## Troubleshooting

### Container won't start

```bash
docker-compose logs svg2gcode
docker-compose ps
```

### Port 8765 already in use

```bash
# Edit docker-compose.yml and change port mapping:
# ports:
#   - "8766:8765"  # Changed from 8765:8765

docker-compose up -d
```

### File detection not working

```bash
docker-compose logs svg2gcode | grep "File watcher"
docker-compose logs svg2gcode | grep "Detected new SVG"
```

### Database issues

```bash
docker-compose exec svg2gcode ls -la /var/lib/svg-to-gcode/
docker-compose exec svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/app')
from label_history import LabelHistoryDB
db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
print(db.get_statistics())
db.close()
EOF
```

## Switching Between Systemd and Docker

You can run both deployment methods on the same server:

**Systemd Option:**
- Location: `/opt/svg-to-gcode`
- Setup: `sudo bash install-phase4.sh`
- Service: `sudo systemctl start svg-to-gcode.path`
- Logs: `sudo journalctl -u svg-to-gcode.service -f`

**Docker Option:**
- Location: `/mnt/raid3/cnc_related/svg_deployment`
- Setup: `docker-compose up -d`
- Container: `docker-compose ps`
- Logs: `docker-compose logs -f svg2gcode`

Use different ports if running both:
- Systemd: 8765 (default)
- Docker: 8766 (change in docker-compose.yml)

## Next Deployments

For future deployments:

```bash
# If only code changed (no new Docker files):
./deploy-phase4.sh --user james --host fileserver.applebaum.treehouse

# If just testing locally:
./deploy-phase4.sh --no-copy

# If you want to rebuild Docker image on server:
ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse
cd /mnt/raid3/cnc_related/svg_deployment
docker-compose build --no-cache
docker-compose up -d
```

## Quick Reference

| Task | Command |
|------|---------|
| Deploy everything | `./deploy-phase4.sh --ssh-key ~/.ssh/HP@treehouse --user james --host fileserver.applebaum.treehouse` |
| Just zip | `./deploy-phase4.sh --no-copy` |
| View status | `ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse 'cd /mnt/raid3/cnc_related/svg_deployment && docker-compose ps'` |
| View logs | `ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse 'cd /mnt/raid3/cnc_related/svg_deployment && docker-compose logs -f svg2gcode'` |
| Restart | `ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse 'cd /mnt/raid3/cnc_related/svg_deployment && docker-compose restart'` |
| Stop | `ssh -i ~/.ssh/HP@treehouse james@fileserver.applebaum.treehouse 'cd /mnt/raid3/cnc_related/svg_deployment && docker-compose down'` |
