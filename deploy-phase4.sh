#!/bin/bash

# Phase 4 Docker Deployment Script
# Zips svg2gcode directory, copies to server, and sets up Docker deployment
#
# Usage:
#   ./deploy-phase4.sh [--ssh-key /path/to/key] [--user username] [--host hostname] [--no-copy]
#
# Examples:
#   ./deploy-phase4.sh --ssh-key ~/.ssh/HP@treehouse --user james --host fileserver.applebaum.treehouse
#   ./deploy-phase4.sh --no-copy  # Just zip locally

set -e

# Configuration (override with command-line args)
SSH_KEY="${SSH_KEY:-.ssh/id_rsa}"
REMOTE_USER="${REMOTE_USER:-james}"
REMOTE_HOST="${REMOTE_HOST:-fileserver.applebaum.treehouse}"
REMOTE_PATH="${REMOTE_PATH:-/mnt/raid3/cnc_related/svg_deployment}"
COPY_TO_SERVER="true"
EXTRACT_ON_SERVER="true"
START_DOCKER="true"

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --ssh-key)
            SSH_KEY="$2"
            shift 2
            ;;
        --user)
            REMOTE_USER="$2"
            shift 2
            ;;
        --host)
            REMOTE_HOST="$2"
            shift 2
            ;;
        --remote-path)
            REMOTE_PATH="$2"
            shift 2
            ;;
        --no-copy)
            COPY_TO_SERVER="false"
            shift
            ;;
        --no-extract)
            EXTRACT_ON_SERVER="false"
            shift
            ;;
        --no-docker-start)
            START_DOCKER="false"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--ssh-key KEY] [--user USER] [--host HOST] [--remote-path PATH] [--no-copy] [--no-extract] [--no-docker-start]"
            exit 1
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Phase 4 Docker Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Step 1: Zip the directory
echo -e "${YELLOW}Step 1: Zipping svg2gcode directory...${NC}"
if [ -f "svg2gcode.zip" ]; then
    echo "  Removing old svg2gcode.zip..."
    rm -f svg2gcode.zip
fi

zip -qr svg2gcode.zip . \
  -x ".git/*" \
     ".github/*" \
     ".git*" \
     "examples/*" \
     "__pycache__/*" \
     "*.md" \
     ".DS_Store" \
     "*.pyc" \
     "svg2gcode.zip" \
     "Cargo.lock" \
     "Cargo.toml" \
     "target/*"

ZIP_SIZE=$(du -h svg2gcode.zip | cut -f1)
echo -e "${GREEN}✓ Created svg2gcode.zip ($ZIP_SIZE)${NC}"
echo ""

# Step 2: Copy to server (if enabled)
if [ "$COPY_TO_SERVER" = "true" ]; then
    echo -e "${YELLOW}Step 2: Copying to file server...${NC}"
    echo "  Server: $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
    echo "  SSH Key: $SSH_KEY"

    scp -i "$SSH_KEY" svg2gcode.zip "$REMOTE_USER@$REMOTE_HOST:/tmp/svg2gcode.zip"

    echo -e "${GREEN}✓ Copied to /tmp/svg2gcode.zip${NC}"
    echo ""

    # Step 3: Extract and setup on server (if enabled)
    if [ "$EXTRACT_ON_SERVER" = "true" ]; then
        echo -e "${YELLOW}Step 3: Setting up on remote server...${NC}"

        ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" << 'REMOTE_SCRIPT'
echo "Creating deployment directory..."
mkdir -p /mnt/raid3/cnc_related/svg_deployment
mkdir -p /mnt/raid3/cnc_related/svg_deployment/config

echo "Extracting files..."
cd /mnt/raid3/cnc_related/svg_deployment
unzip -q /tmp/svg2gcode.zip
rm /tmp/svg2gcode.zip

echo "Setting proper ownership..."
# Note: May require sudo on some systems
# sudo chown -R docker:docker .

echo "Deployment files extracted to /mnt/raid3/cnc_related/svg_deployment"
ls -la | head -20

REMOTE_SCRIPT

        echo -e "${GREEN}✓ Extracted on remote server${NC}"
        echo ""

        # Step 4: Start Docker (if enabled)
        if [ "$START_DOCKER" = "true" ]; then
            echo -e "${YELLOW}Step 4: Starting Docker service...${NC}"

            ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" << 'DOCKER_SCRIPT'
cd /mnt/raid3/cnc_related/svg_deployment

echo "Building Docker image..."
docker-compose build

echo "Starting container..."
docker-compose up -d

echo "Waiting for container to be healthy..."
for i in {1..30}; do
    if docker-compose exec svg2gcode curl -s http://localhost:8765/health > /dev/null 2>&1; then
        echo "✓ Container is healthy"
        break
    fi
    echo "  Waiting... ($i/30)"
    sleep 1
done

echo ""
echo "Container status:"
docker-compose ps

echo ""
echo "Recent logs:"
docker-compose logs --tail=20 svg2gcode

DOCKER_SCRIPT

            echo -e "${GREEN}✓ Docker container started${NC}"
            echo ""
        fi
    fi
else
    echo -e "${YELLOW}Step 2: Skipping remote copy (--no-copy flag set)${NC}"
    echo ""
    echo "To copy manually:"
    echo "  scp -i $SSH_KEY svg2gcode.zip $REMOTE_USER@$REMOTE_HOST:/mnt/raid3/cnc_related/svg_deployment/"
    echo ""
fi

# Step 5: Cleanup local zip
echo -e "${YELLOW}Step 5: Cleaning up local files...${NC}"
rm -f svg2gcode.zip
echo -e "${GREEN}✓ Removed local svg2gcode.zip${NC}"
echo ""

# Final summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""
if [ "$COPY_TO_SERVER" = "true" ] && [ "$START_DOCKER" = "true" ]; then
    echo "✓ Deployment complete on remote server"
    echo "✓ Docker container running at http://$REMOTE_HOST:8765"
    echo ""
    echo -e "${YELLOW}Verification:${NC}"
    echo "  ssh -i $SSH_KEY $REMOTE_USER@$REMOTE_HOST"
    echo "  cd /mnt/raid3/cnc_related/svg_deployment"
    echo "  docker-compose ps"
    echo "  docker-compose logs -f svg2gcode"
    echo ""
    echo -e "${YELLOW}Test API:${NC}"
    echo "  curl http://$REMOTE_HOST:8765/health"
    echo "  curl http://$REMOTE_HOST:8765/api/labels"
else
    echo "⚠ Deployment not fully completed"
    echo ""
    echo "To complete:"
    echo "1. Copy zip to server:"
    echo "   scp -i $SSH_KEY svg2gcode.zip $REMOTE_USER@$REMOTE_HOST:/mnt/raid3/cnc_related/svg_deployment/"
    echo ""
    echo "2. Extract and setup on server:"
    echo "   ssh -i $SSH_KEY $REMOTE_USER@$REMOTE_HOST"
    echo "   cd /mnt/raid3/cnc_related/svg_deployment"
    echo "   unzip svg2gcode.zip"
    echo ""
    echo "3. Start Docker:"
    echo "   docker-compose build"
    echo "   docker-compose up -d"
fi
echo ""
