#!/bin/bash

# Installation script for Phase 4: Systemd Integration, History & Webhooks
# This script sets up all Phase 4 components

set -e

echo "=== Phase 4 Installation ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_USER="svg2gcode"
INSTALL_GROUP="svg2gcode"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    echo "Error: This script must be run as root"
    exit 1
fi

echo "Step 1: Creating user and group..."
if ! id "$INSTALL_USER" &>/dev/null; then
    groupadd -r "$INSTALL_GROUP" 2>/dev/null || true
    useradd -r -g "$INSTALL_GROUP" -s /bin/false "$INSTALL_USER" 2>/dev/null || true
    echo "  ✓ Created $INSTALL_USER user/group"
else
    echo "  ✓ User $INSTALL_USER already exists"
fi

echo ""
echo "Step 2: Creating directories..."

# Create required directories
mkdir -p /opt/svg-to-gcode
mkdir -p /etc/svg-to-gcode
mkdir -p /var/lib/svg-to-gcode
mkdir -p /var/log/svg-to-gcode
mkdir -p /mnt/raid1/label-archive
mkdir -p /mnt/raid1/gcode

echo "  ✓ Created application directories"

echo ""
echo "Step 3: Setting up permissions..."

# Set ownership
chown -R "$INSTALL_USER:$INSTALL_GROUP" /opt/svg-to-gcode
chown -R "$INSTALL_USER:$INSTALL_GROUP" /var/lib/svg-to-gcode
chown -R "$INSTALL_USER:$INSTALL_GROUP" /var/log/svg-to-gcode
chown -R "$INSTALL_USER:$INSTALL_GROUP" /mnt/raid1/gcode
chown -R "$INSTALL_USER:$INSTALL_GROUP" /mnt/raid1/label-archive

# Set permissions
chmod 750 /var/lib/svg-to-gcode
chmod 750 /var/log/svg-to-gcode
chmod 755 /mnt/raid1/gcode
chmod 755 /mnt/raid1/label-archive

echo "  ✓ Set directory permissions"

echo ""
echo "Step 4: Installing Python modules..."

# Copy Python modules
cp "$SCRIPT_DIR/label_history.py" /opt/svg-to-gcode/
cp "$SCRIPT_DIR/label_archiver.py" /opt/svg-to-gcode/
cp "$SCRIPT_DIR/webhook_notifier.py" /opt/svg-to-gcode/
cp "$SCRIPT_DIR/svg-to-gcode-daemon.py" /opt/svg-to-gcode/

chmod 755 /opt/svg-to-gcode/svg-to-gcode-daemon.py
echo "  ✓ Copied Python modules"

echo ""
echo "Step 5: Installing configuration..."

# Copy configuration (only if not exists to preserve user changes)
if [ ! -f /etc/svg-to-gcode/config.json ]; then
    cp "$SCRIPT_DIR/svg-to-gcode-config.json" /etc/svg-to-gcode/config.json
    chmod 600 /etc/svg-to-gcode/config.json
    chown "$INSTALL_USER:$INSTALL_GROUP" /etc/svg-to-gcode/config.json
    echo "  ✓ Installed default configuration"
else
    echo "  ⓘ Configuration file already exists, skipping"
fi

echo ""
echo "Step 6: Installing systemd units..."

# Copy systemd units
cp "$SCRIPT_DIR/svg-to-gcode.service" /etc/systemd/system/
cp "$SCRIPT_DIR/svg-to-gcode.path" /etc/systemd/system/

# Reload systemd
systemctl daemon-reload
echo "  ✓ Installed systemd units and reloaded daemon"

echo ""
echo "Step 7: Initializing label history database..."

# Initialize database by creating it
python3 << PYTHON_SCRIPT
import sys
sys.path.insert(0, '/opt/svg-to-gcode')

from label_history import LabelHistoryDB

try:
    db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
    stats = db.get_statistics()
    db.close()
    print(f"  ✓ Database initialized (Total labels: {stats['total_labels']})")
except Exception as e:
    print(f"  ✗ Failed to initialize database: {e}")
    sys.exit(1)
PYTHON_SCRIPT

# Set proper ownership of database
chown "$INSTALL_USER:$INSTALL_GROUP" /var/lib/svg-to-gcode/labels.db 2>/dev/null || true

echo ""
echo "Step 8: Verifying installation..."

# Verify files exist
for file in /opt/svg-to-gcode/{label_history.py,label_archiver.py,webhook_notifier.py,svg-to-gcode-daemon.py}; do
    if [ -f "$file" ]; then
        echo "  ✓ Found $(basename $file)"
    else
        echo "  ✗ Missing $(basename $file)"
        exit 1
    fi
done

# Verify systemd units
if systemctl list-unit-files | grep -q svg-to-gcode.service; then
    echo "  ✓ Service unit installed"
else
    echo "  ✗ Service unit not found"
    exit 1
fi

if systemctl list-unit-files | grep -q svg-to-gcode.path; then
    echo "  ✓ Path unit installed"
else
    echo "  ✗ Path unit not found"
    exit 1
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Next steps:"
echo "  1. Review configuration: sudo nano /etc/svg-to-gcode/config.json"
echo "  2. Enable path unit: sudo systemctl enable svg-to-gcode.path"
echo "  3. Start path unit: sudo systemctl start svg-to-gcode.path"
echo "  4. Check status: sudo systemctl status svg-to-gcode.path svg-to-gcode.service"
echo ""
echo "Useful commands:"
echo "  View logs: sudo journalctl -u svg-to-gcode.service -f"
echo "  Check health: curl http://localhost:8765/health"
echo "  List labels: curl http://localhost:8765/api/labels"
echo ""
