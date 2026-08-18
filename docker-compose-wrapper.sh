#!/bin/bash

# Docker Compose Wrapper Script
# Handles both 'docker-compose' (standalone) and 'docker compose' (integrated)
#
# This wrapper automatically detects which version is available
# and uses it for docker-compose commands.
#
# Usage: Same as docker-compose
#   ./docker-compose-wrapper.sh up -d
#   ./docker-compose-wrapper.sh ps
#   ./docker-compose-wrapper.sh logs svg2gcode

# Detect which docker-compose command is available
if command -v docker-compose &> /dev/null; then
    # Use standalone docker-compose
    exec docker-compose "$@"
elif docker --version &> /dev/null && docker compose version &> /dev/null; then
    # Use integrated docker compose
    exec docker compose "$@"
else
    echo "ERROR: Neither 'docker-compose' nor 'docker compose' found!"
    echo ""
    echo "To fix this, run one of the following:"
    echo ""
    echo "Option 1: Install standalone docker-compose"
    echo "  sudo curl -L \"https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker-compose"
    echo "  sudo chmod +x /usr/local/bin/docker-compose"
    echo ""
    echo "Option 2: Use newer Docker (20.10+) with integrated compose"
    echo "  docker compose up -d   # Instead of docker-compose up -d"
    echo ""
    echo "Option 3: Install via package manager"
    echo "  sudo yum install docker-compose     # CentOS/RHEL"
    echo "  sudo apt-get install docker-compose # Ubuntu/Debian"
    echo ""
    exit 1
fi
