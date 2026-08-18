# Docker Compose Setup Guide

Your server has Docker installed but `docker-compose` is not found. Here's how to fix it.

## Quick Fix (5 minutes)

### Step 1: Check Your Docker Version

```bash
docker --version
```

### Step 2: Choose the Right Solution

**If Docker version >= 20.10:**
```bash
# Just use 'docker compose' instead of 'docker-compose'
docker compose up -d
docker compose ps
docker compose logs svg2gcode
```

**If Docker version < 20.10:**
```bash
# Install standalone docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

## Your Situation

```bash
# Check what you have
docker --version
docker ps  # This works
docker-compose --version  # This doesn't work
```

## Solution A: Install docker-compose (Recommended)

### For Linux (your server):

```bash
# Download latest docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose

# Make it executable
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker-compose --version
# Should output: Docker Compose version X.X.X
```

### Or via package manager:

**CentOS/RHEL:**
```bash
sudo yum install docker-compose
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install docker-compose
```

**Alpine:**
```bash
sudo apk add docker-compose
```

## Solution B: Use integrated docker compose (if Docker >= 20.10)

If you have Docker 20.10 or newer, you can use the integrated `docker compose` command:

```bash
# Check Docker version
docker --version

# Use directly (no hyphen!)
docker compose up -d
docker compose ps
docker compose logs svg2gcode
docker compose down
```

## Solution C: Use wrapper script

We've provided a wrapper script that handles both versions:

```bash
# Make it executable
chmod +x docker-compose-wrapper.sh

# Use it like docker-compose
./docker-compose-wrapper.sh up -d
./docker-compose-wrapper.sh ps
./docker-compose-wrapper.sh logs svg2gcode
./docker-compose-wrapper.sh down
```

## Once Fixed

### Start Your Service

```bash
cd /mnt/raid3/cnc_related/svg_deployment

# If using docker-compose
docker-compose up -d

# OR if using docker compose (new version)
docker compose up -d
```

### Verify It's Running

```bash
# Check container status
docker-compose ps
# or
docker compose ps

# Check health
curl http://localhost:8765/health

# View logs
docker-compose logs -f svg2gcode
# or
docker compose logs -f svg2gcode
```

## Common Commands

### Using docker-compose (standalone):
```bash
docker-compose build              # Build image
docker-compose up -d              # Start container
docker-compose down               # Stop container
docker-compose restart            # Restart
docker-compose ps                 # Show status
docker-compose logs -f svg2gcode  # Follow logs
docker-compose exec svg2gcode curl http://localhost:8765/health  # Run command
```

### Using docker compose (integrated):
```bash
docker compose build              # Build image
docker compose up -d              # Start container
docker compose down               # Stop container
docker compose restart            # Restart
docker compose ps                 # Show status
docker compose logs -f svg2gcode  # Follow logs
docker compose exec svg2gcode curl http://localhost:8765/health  # Run command
```

## Troubleshooting

### Permission Denied Error

```bash
# If you get "Permission denied" after installation:
sudo chmod +x /usr/local/bin/docker-compose

# Or run with sudo:
sudo docker-compose up -d
```

### Still Not Found

```bash
# Verify installation location
which docker-compose
# Should output: /usr/local/bin/docker-compose

# Or check if it's elsewhere
find /usr -name docker-compose 2>/dev/null

# If found elsewhere, create symlink:
sudo ln -s /path/to/docker-compose /usr/local/bin/docker-compose
```

### Version Mismatch

```bash
# Ensure versions match
docker --version      # Should be recent
docker-compose --version  # Should match Docker

# Update if needed
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## Quick Start After Installation

Once docker-compose is installed:

```bash
cd /mnt/raid3/cnc_related/svg_deployment

# Build the image
docker-compose build

# Start the container
docker-compose up -d

# Check status
docker-compose ps
# Should show: svg2gcode-daemon  Up

# Test the API
curl http://localhost:8765/health
# Should return: {"status": "healthy", "timestamp": "..."}

# View logs
docker-compose logs -f svg2gcode
```

## Next Steps

1. Install docker-compose using Solution A or B above
2. Return to `/mnt/raid3/cnc_related/svg_deployment/`
3. Run `docker-compose up -d`
4. Verify with `curl http://localhost:8765/health`

---

**Need Help?**
- Check Docker is running: `docker ps`
- Check permissions: `ls -la /usr/local/bin/docker-compose`
- Check system PATH: `echo $PATH`
- Try with full path: `/usr/local/bin/docker-compose up -d`
