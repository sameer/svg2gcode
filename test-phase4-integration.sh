#!/bin/bash

# Phase 4 Integration Tests
# Tests label history, archival, webhooks, and daemon integration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="/tmp/svg2gcode-test-$$"
PYTHON_PATH="$SCRIPT_DIR"

cleanup() {
    echo "Cleaning up test directory..."
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

echo "=== Phase 4 Integration Tests ==="
echo ""

# Create test directory
mkdir -p "$TEST_DIR"
export PYTHONPATH="$PYTHON_PATH:$PYTHONPATH"

echo "Test 1: Label History Database"
echo "================================"

python3 << 'PYTHON_SCRIPT'
import sys
sys.path.insert(0, '/workspace/svg2gcode')

from label_history import LabelHistoryDB, LabelRecord
from datetime import datetime, timedelta
import tempfile
import os

# Create test database
test_db = os.path.join('/tmp/svg2gcode-test-$$', 'test_labels.db')
db = LabelHistoryDB(test_db)

# Test 1.1: Add labels
print("  Test 1.1: Adding labels...")
record1 = LabelRecord(
    pattern_name="shirt_v2",
    piece_name="Front Panel",
    piece_id="piece_001",
    qr_code_data="QR123",
    job_id="job_001"
)
id1 = db.add_label(record1)
print(f"    ✓ Added label: {id1}")

record2 = LabelRecord(
    pattern_name="shirt_v2",
    piece_name="Back Panel",
    piece_id="piece_002",
    qr_code_data="QR124",
    job_id="job_001"
)
id2 = db.add_label(record2)
print(f"    ✓ Added label: {id2}")

# Test 1.2: Retrieve label
print("  Test 1.2: Retrieving labels...")
retrieved = db.get_label("piece_001")
assert retrieved is not None
assert retrieved.pattern_name == "shirt_v2"
print(f"    ✓ Retrieved label by piece_id")

# Test 1.3: List labels
print("  Test 1.3: Listing labels...")
labels = db.list_labels(limit=10)
assert len(labels) == 2
print(f"    ✓ Listed {len(labels)} labels")

# Test 1.4: Search
print("  Test 1.4: Searching labels...")
results = db.search(pattern="shirt")
assert len(results) == 2
print(f"    ✓ Found {len(results)} labels matching 'shirt'")

# Test 1.5: Update status
print("  Test 1.5: Updating status...")
updated = db.update_status("piece_001", "completed")
assert updated
retrieved = db.get_label("piece_001")
assert retrieved.print_status == "completed"
print(f"    ✓ Updated status to 'completed'")

# Test 1.6: Statistics
print("  Test 1.6: Getting statistics...")
stats = db.get_statistics()
assert stats["total_labels"] == 2
assert stats["completed"] == 1
assert stats["pending"] == 1
print(f"    ✓ Statistics: {stats['total_labels']} total, {stats['completed']} completed")

db.close()
print("  ✓ Label History Database: PASSED")
PYTHON_SCRIPT

echo ""
echo "Test 2: Label Archiver"
echo "======================"

python3 << 'PYTHON_SCRIPT'
import sys
sys.path.insert(0, '/workspace/svg2gcode')

from label_archiver import LabelArchiver
import tempfile
import os

# Create test files
test_archive_dir = '/tmp/svg2gcode-test-$$'
test_labels_dir = os.path.join(test_archive_dir, 'labels')
os.makedirs(test_labels_dir, exist_ok=True)

# Create dummy label files
label_files = []
for i in range(3):
    label_file = os.path.join(test_labels_dir, f'label_{i:03d}.tspl')
    with open(label_file, 'w') as f:
        f.write('SIZE 100,150\n')
        f.write(f'TEXT 10,10,"Label {i}"\n')
    label_files.append(label_file)

# Test 2.1: Archive job
print("  Test 2.1: Archiving job...")
archiver = LabelArchiver(base_path=os.path.join(test_archive_dir, 'archive'))
result = archiver.archive_job(
    job_id="job_001",
    pattern_name="shirt_v2",
    label_files=label_files,
    metadata={"created_by": "test", "version": "1.0"}
)
assert result["files_archived"] == 3
print(f"    ✓ Archived {result['files_archived']} files")

# Test 2.2: Retrieve archive
print("  Test 2.2: Retrieving archive...")
archive = archiver.get_job_archive("job_001")
assert archive is not None
print(f"    ✓ Retrieved archive from {archive['path']}")

# Test 2.3: List job labels
print("  Test 2.3: Listing job labels...")
labels = archiver.list_job_labels("job_001")
assert len(labels) == 3
print(f"    ✓ Found {len(labels)} archived labels")

# Test 2.4: Organize by pattern
print("  Test 2.4: Organizing by pattern...")
by_pattern = archiver.organize_by_pattern()
assert "shirt_v2" in by_pattern
print(f"    ✓ Found pattern: {list(by_pattern.keys())}")

# Test 2.5: Statistics
print("  Test 2.5: Getting statistics...")
stats = archiver.get_statistics()
assert stats["total_archives"] >= 1
print(f"    ✓ Statistics: {stats['total_archives']} archives, {stats['total_size_mb']} MB")

print("  ✓ Label Archiver: PASSED")
PYTHON_SCRIPT

echo ""
echo "Test 3: Webhook Notifier"
echo "======================="

python3 << 'PYTHON_SCRIPT'
import sys
sys.path.insert(0, '/workspace/svg2gcode')

from webhook_notifier import WebhookNotifier, WebhookEvent
from datetime import datetime

# Test 3.1: Register webhook
print("  Test 3.1: Registering webhook...")
notifier = WebhookNotifier(timeout_seconds=5, max_retries=1)
webhook = notifier.register(
    url="http://localhost:8080/webhook",
    events=["job.completed", "labels.printed"],
    secret="test-secret"
)
assert webhook["id"] == 0
print(f"    ✓ Registered webhook with ID: {webhook['id']}")

# Test 3.2: Create event
print("  Test 3.2: Creating event...")
event = WebhookEvent(
    event_type="job.completed",
    timestamp=datetime.now().isoformat(),
    job_id="job_001",
    data={"files": 3, "status": "success"}
)
print(f"    ✓ Created event: {event.event_type}")

# Test 3.3: List webhooks
print("  Test 3.3: Listing webhooks...")
webhooks = notifier.list_webhooks()
assert len(webhooks) == 1
print(f"    ✓ Found {len(webhooks)} registered webhooks")

# Test 3.4: Get webhook stats
print("  Test 3.4: Getting webhook stats...")
stats = notifier.get_webhook_stats(0)
assert stats is not None
assert "success_rate" in stats
print(f"    ✓ Webhook stats: {stats['delivery_count']} deliveries")

# Test 3.5: Disable/enable webhook
print("  Test 3.5: Testing disable/enable...")
notifier.disable_webhook(0)
webhooks = notifier.list_webhooks(active_only=True)
assert len(webhooks) == 0
notifier.enable_webhook(0)
webhooks = notifier.list_webhooks(active_only=True)
assert len(webhooks) == 1
print(f"    ✓ Webhook state management working")

notifier.stop()
print("  ✓ Webhook Notifier: PASSED")
PYTHON_SCRIPT

echo ""
echo "Test 4: Configuration Loading"
echo "============================="

python3 << 'PYTHON_SCRIPT'
import json
import os

config_file = '/workspace/svg2gcode/svg-to-gcode-config.json'

# Test 4.1: Load config
print("  Test 4.1: Loading configuration...")
with open(config_file) as f:
    config = json.load(f)
assert "daemon" in config
assert "label_history" in config
assert "label_archive" in config
assert "webhooks" in config
print(f"    ✓ Loaded all configuration sections")

# Test 4.2: Validate daemon config
print("  Test 4.2: Validating daemon config...")
daemon_config = config["daemon"]
assert daemon_config["api_port"] == 8765
assert daemon_config["log_level"] in ["DEBUG", "INFO", "WARNING", "ERROR"]
print(f"    ✓ Daemon config valid (port: {daemon_config['api_port']})")

# Test 4.3: Validate label_history config
print("  Test 4.3: Validating label_history config...")
lh_config = config["label_history"]
assert lh_config["enabled"] in [True, False]
assert lh_config["retention_days"] > 0
print(f"    ✓ Label history config valid (retention: {lh_config['retention_days']} days)")

# Test 4.4: Validate label_archive config
print("  Test 4.4: Validating label_archive config...")
la_config = config["label_archive"]
assert la_config["enabled"] in [True, False]
assert la_config["compression"] in ["gzip", "none"]
print(f"    ✓ Label archive config valid (compression: {la_config['compression']})")

# Test 4.5: Validate webhooks config
print("  Test 4.5: Validating webhooks config...")
wh_config = config["webhooks"]
assert wh_config["enabled"] in [True, False]
assert wh_config["timeout_seconds"] > 0
assert len(wh_config["endpoints"]) >= 0
print(f"    ✓ Webhooks config valid ({len(wh_config['endpoints'])} endpoints)")

print("  ✓ Configuration: PASSED")
PYTHON_SCRIPT

echo ""
echo "=== All Tests Passed ==="
echo ""
echo "Summary:"
echo "  ✓ Label History Database"
echo "  ✓ Label Archiver"
echo "  ✓ Webhook Notifier"
echo "  ✓ Configuration Loading"
echo ""
echo "Phase 4 integration tests completed successfully!"
