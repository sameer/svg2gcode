# Phase 4 Deployment Verification Checklist

**Deployment Date**: _______________
**Deployed By**: _______________
**Server**: _______________
**Environment**: [ ] Fresh Install  [ ] Upgrade from Phase 1-3

## Deployment Method Selection (Required)

Choose your deployment approach:

- [ ] **Systemd on Host** - Deploy as systemd service on host system
  - Uses: install-phase4.sh, systemd units
  - Best for: Traditional Linux servers
  
- [ ] **Docker Container** - Deploy as Docker container
  - Uses: docker-compose.yml, Dockerfile
  - Best for: Containerized infrastructure
  - Location: /raid3/svg_deployment/

**Note:** Both methods can coexist. This checklist covers both paths separately below.

---

## PHASE 1: PRE-INSTALLATION ASSESSMENT & PREREQUISITES
**Estimated Time: 30 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 1.1 Infrastructure Pre-flight Checks
- [ ] `/mnt/raid1` mounted and writable
- [ ] `/mnt/raid1` has 20GB+ free space (actual: _______ GB)
- [ ] Python 3.8+ installed: `python3 --version` ✓
- [ ] pip3 available: `pip3 --version` ✓
- [ ] systemd available: `systemctl --version` ✓
- [ ] journalctl available: `journalctl --version` ✓
- [ ] `/var/lib` has 1GB+ free space (actual: _______ GB)
- [ ] `/var/log` has 5GB+ free space (actual: _______ GB)
- [ ] Network connectivity verified to webhook endpoints
- [ ] Firewall allows port 8765 (or custom port: _______)

**Issues Found**:
```




```

### 1.2 Dependency Installation
- [ ] flask installed: `python3 -c "import flask; print(flask.__version__)"`
- [ ] requests installed: `python3 -c "import requests; print(requests.__version__)"`

**Versions Installed**:
- Flask: _______
- Requests: _______

### 1.3 Check Existing System Status (if upgrading)
- [ ] Phase 1-3 service not running: `sudo systemctl status svg-to-gcode.service`
- [ ] Existing database location: _______________________
- [ ] Existing configuration backed up
- [ ] Existing logs backed up

### 1.4 Backup Strategy (if applicable)
- [ ] Backup directory created: _______________________
- [ ] Database backed up: `sudo cp /var/lib/svg-to-gcode/labels.db <BACKUP>`
- [ ] Configuration backed up: `sudo cp /etc/svg-to-gcode/config.json <BACKUP>`
- [ ] Application backed up: `sudo cp -r /opt/svg-to-gcode <BACKUP>`
- [ ] Backup manifest created with timestamp

**Backup Location**: _______________________________

---

## PHASE 2: INSTALLATION
**Estimated Time: 5-10 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 2.1 Automated Installation (Recommended)
- [ ] Navigated to `/workspace/svg2gcode`
- [ ] Reviewed `install-phase4.sh` for correctness
- [ ] Executed: `sudo bash install-phase4.sh`
- [ ] Installation completed without errors
- [ ] All modules installed successfully

**Installation Output**:
```




```

### 2.2 Manual Installation (if script failed)
- [ ] User created: `svg2gcode` with group `svg2gcode`
- [ ] Directory `/opt/svg-to-gcode` created
- [ ] Directory `/etc/svg-to-gcode` created
- [ ] Directory `/var/lib/svg-to-gcode` created (mode 750)
- [ ] Directory `/var/log/svg-to-gcode` created (mode 750)
- [ ] Directory `/mnt/raid1/label-archive` created
- [ ] Directory `/mnt/raid1/gcode` created
- [ ] Python modules copied to `/opt/svg-to-gcode/`
- [ ] Configuration file installed to `/etc/svg-to-gcode/config.json`
- [ ] Systemd units installed
- [ ] `systemctl daemon-reload` executed
- [ ] Database initialized successfully
- [ ] Ownership set to `svg2gcode:svg2gcode`

---

## PHASE 3: PRE-START CONFIGURATION & VALIDATION
**Estimated Time: 10-15 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 3.1 Configuration Review
Review `/etc/svg-to-gcode/config.json`:

| Setting | Default | Current Value | Approved |
|---------|---------|---|---|
| `daemon.watch_dir` | /mnt/raid1/gcode | _____________ | [ ] |
| `daemon.api_port` | 8765 | _____________ | [ ] |
| `daemon.log_level` | INFO | _____________ | [ ] |
| `label_history.enabled` | true | _____________ | [ ] |
| `label_history.retention_days` | 730 | _____________ | [ ] |
| `label_archive.enabled` | true | _____________ | [ ] |
| `label_archive.compression` | gzip | _____________ | [ ] |
| `label_archive.cleanup_days` | 2555 | _____________ | [ ] |
| `webhooks.enabled` | true | _____________ | [ ] |
| `webhooks.timeout_seconds` | 10 | _____________ | [ ] |
| `webhooks.max_retries` | 3 | _____________ | [ ] |

**Configuration Issues**:
```




```

### 3.2 Webhook Configuration (if enabled)
- [ ] Webhook endpoint URL: _______________________________
- [ ] Webhook secret changed from default: **REQUIRED**
  - Original: `default-webhook-secret-change-me`
  - New secret: (verify changed, don't record here)
- [ ] Events configured: [ ] job.completed  [ ] labels.printed  [ ] job.failed
- [ ] Webhook endpoint is accessible and responding
- [ ] Test request to endpoint succeeded

### 3.3 Network Configuration
- [ ] Firewall allows port 8765: `sudo ufw status` or `sudo firewall-cmd --list-all`
- [ ] Port 8765 not in use: `sudo netstat -tuln | grep 8765`
- [ ] DNS resolution working for webhook endpoints
- [ ] Network latency to webhooks acceptable (< 500ms)

### 3.4 Directory Structure Verification
```bash
sudo bash << 'EOF'
echo "Application Directory:"; ls -lh /opt/svg-to-gcode/ | grep -E "\.py$"
echo "Configuration:"; ls -lh /etc/svg-to-gcode/
echo "Database Directory:"; ls -lh /var/lib/svg-to-gcode/
echo "Log Directory:"; ls -lh /var/log/svg-to-gcode/
echo "Archive Directory:"; ls -lh /mnt/raid1/label-archive/
echo "Watch Directory:"; ls -lh /mnt/raid1/gcode/
EOF
```

- [ ] `/opt/svg-to-gcode/label_history.py` exists
- [ ] `/opt/svg-to-gcode/label_archiver.py` exists
- [ ] `/opt/svg-to-gcode/webhook_notifier.py` exists
- [ ] `/opt/svg-to-gcode/svg-to-gcode-daemon.py` exists
- [ ] `/etc/svg-to-gcode/config.json` exists
- [ ] `/var/lib/svg-to-gcode/` writable
- [ ] `/var/log/svg-to-gcode/` writable
- [ ] `/mnt/raid1/label-archive/` writable

### 3.5 Permission Verification
```bash
sudo bash << 'EOF'
echo "Checking application files:"; sudo -u svg2gcode test -r /opt/svg-to-gcode/label_history.py && echo "✓ Can read label_history.py" || echo "✗ Cannot read"
sudo -u svg2gcode test -x /opt/svg-to-gcode/svg-to-gcode-daemon.py && echo "✓ Can execute daemon" || echo "✗ Cannot execute"
echo "Checking database directory:"; sudo -u svg2gcode test -w /var/lib/svg-to-gcode && echo "✓ Can write" || echo "✗ Cannot write"
echo "Checking log directory:"; sudo -u svg2gcode test -w /var/log/svg-to-gcode && echo "✓ Can write" || echo "✗ Cannot write"
echo "Checking archive directory:"; sudo -u svg2gcode test -w /mnt/raid1/label-archive && echo "✓ Can write" || echo "✗ Cannot write"
EOF
```

- [ ] `svg2gcode` user can read Python modules
- [ ] `svg2gcode` user can execute daemon
- [ ] `svg2gcode` user can write to database directory
- [ ] `svg2gcode` user can write to log directory
- [ ] `svg2gcode` user can write to archive directory

---

## PHASE 4: SERVICE STARTUP & VERIFICATION
**Estimated Time: 5-10 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 4.1 Enable and Start Services
```bash
sudo systemctl enable svg-to-gcode.path
sudo systemctl start svg-to-gcode.path
sudo systemctl status svg-to-gcode.path
```

- [ ] Path unit enabled
- [ ] Path unit started
- [ ] Path unit active (waiting)

### 4.2 Verify Service Health
```bash
sudo systemctl status svg-to-gcode.service
curl http://localhost:8765/health
```

- [ ] Service started successfully
- [ ] Health endpoint responding (HTTP 200)
- [ ] Health response contains status: "healthy"

**Health Check Output**:
```
{
  "status": "healthy",
  "timestamp": "___________________"
}
```

### 4.3 Database Validation
```bash
sudo -u svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/opt/svg-to-gcode')
from label_history import LabelHistoryDB
db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
stats = db.get_statistics()
print(f"Total labels: {stats['total_labels']}")
db.close()
EOF
```

- [ ] Database accessible
- [ ] Database readable by `svg2gcode` user
- [ ] Initial statistics retrieved
- [ ] Total labels count: _______

### 4.4 Archive Directory Validation
```bash
sudo -u svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/opt/svg-to-gcode')
from label_archiver import LabelArchiver
archiver = LabelArchiver('/mnt/raid1/label-archive')
stats = archiver.get_statistics()
print(f"Archives: {stats['total_archives']}")
EOF
```

- [ ] Archive directory accessible
- [ ] Archive directory readable by `svg2gcode` user
- [ ] Initial statistics retrieved
- [ ] Total archives count: _______

### 4.5 Systemd Journal Check
```bash
sudo journalctl -u svg-to-gcode.service -n 20 --no-pager
```

- [ ] Journal entries present
- [ ] No critical errors in logs
- [ ] Service started successfully message present

---

## PHASE 5: WEBHOOK CONFIGURATION
**Estimated Time: 15-20 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 5.1 Webhook Registration (if enabled)
```bash
curl -X POST http://localhost:8765/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://your-endpoint:8080/webhook",
    "events": ["job.completed", "labels.printed"],
    "secret": "your-webhook-secret"
  }'
```

- [ ] Webhook registered successfully
- [ ] Response contains webhook ID
- [ ] Webhook ID recorded: _______
- [ ] Events configured correctly

### 5.2 Webhook Verification
```bash
curl http://localhost:8765/api/webhooks
```

- [ ] List includes registered webhook
- [ ] URL correct: _______________________________
- [ ] Events correct: [ ] job.completed  [ ] labels.printed  [ ] job.failed
- [ ] Active status: [ ] true

### 5.3 Webhook Endpoint Accessibility
```bash
curl -v http://your-webhook-endpoint:port/path
```

- [ ] Webhook endpoint accessible
- [ ] Endpoint responding (HTTP 200)
- [ ] No network timeouts
- [ ] DNS resolves correctly

### 5.4 Webhook Testing
- [ ] Test payload signature verified at endpoint
- [ ] Python verification script tested (if external system)
- [ ] Event filtering working correctly
- [ ] Webhook logs show activity

---

## PHASE 6: PERFORMANCE & SECURITY VALIDATION
**Estimated Time: 10-15 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 6.1 Security Hardening Verification
```bash
ps aux | grep svg-to-gcode-daemon | grep -v grep
sudo systemctl show svg-to-gcode.service -p ProtectSystem
sudo systemctl show svg-to-gcode.service -p NoNewPrivileges
sudo systemctl show svg-to-gcode.service -p PrivateTmp
```

- [ ] Service running as user `svg2gcode` (not root)
- [ ] ProtectSystem: _________________ (should be strict)
- [ ] NoNewPrivileges: _____________ (should be yes)
- [ ] PrivateTmp: _________________ (should be yes)
- [ ] ProtectHome: _________________ (should be yes)

### 6.2 Database File Permissions
```bash
ls -la /var/lib/svg-to-gcode/labels.db
```

- [ ] File permissions: _________ (should be 600 or 640)
- [ ] Owner: svg2gcode (not root)
- [ ] Group: svg2gcode (not root)
- [ ] File size reasonable (< 1GB for new install)

### 6.3 Configuration File Permissions
```bash
ls -la /etc/svg-to-gcode/config.json
```

- [ ] File permissions: _________ (should be 600)
- [ ] Owner: svg2gcode (not root)
- [ ] Webhook secret not readable by unprivileged users

### 6.4 Resource Limits
```bash
sudo systemctl show svg-to-gcode.service -p MemoryMax
sudo systemctl show svg-to-gcode.service -p CPUQuota
```

- [ ] MemoryMax configured: _________________ (recommend 512M)
- [ ] CPUQuota configured: _________________ (recommend 50%)
- [ ] Limits appropriate for workload

### 6.5 Database Performance
```bash
du -h /var/lib/svg-to-gcode/labels.db
```

- [ ] Database size: _________________ (should be small for new install)
- [ ] No obvious performance issues
- [ ] Indexes created successfully

---

## PHASE 7: MONITORING & LOGGING SETUP
**Estimated Time: 10 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 7.1 Systemd Journal Configuration
```bash
journalctl --disk-usage
sudo journalctl -u svg-to-gcode.service -n 50 --no-pager
```

- [ ] Journal contains recent logs
- [ ] Disk usage reasonable
- [ ] Log entries readable and formatted correctly

### 7.2 Log Rotation Setup
```bash
sudo cat /etc/logrotate.d/svg-to-gcode 2>/dev/null || echo "Not configured"
```

- [ ] Logrotate configuration file exists: `/etc/logrotate.d/svg-to-gcode`
- [ ] Rotation policy: daily rotate _________ (recommend 30)
- [ ] Compression enabled

### 7.3 Monitoring Dashboard (Optional)
```bash
sudo /tmp/svg2gcode-monitor.sh
```

- [ ] Dashboard script created
- [ ] Dashboard displays service status
- [ ] Dashboard displays resource usage
- [ ] Dashboard updates regularly

---

## PHASE 8: TESTING & VALIDATION
**Estimated Time: 15-20 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 8.1 Run Integration Test Suite
```bash
cd /workspace/svg2gcode && bash test-phase4-integration.sh
```

- [ ] Label History Database: ✓ PASSED
- [ ] Label Archiver: ✓ PASSED
- [ ] Webhook Notifier: ✓ PASSED
- [ ] Configuration: ✓ PASSED

**Test Output**:
```




```

### 8.2 Manual API Testing

#### Health Check
```bash
curl -s http://localhost:8765/health | python3 -m json.tool
```
- [ ] Response: HTTP 200 ✓
- [ ] Status: "healthy"

#### List Labels
```bash
curl -s "http://localhost:8765/api/labels?limit=5" | python3 -m json.tool
```
- [ ] Response: HTTP 200 ✓
- [ ] Returns array of labels

#### Label Statistics
```bash
curl -s http://localhost:8765/api/labels/stats | python3 -m json.tool
```
- [ ] Response: HTTP 200 ✓
- [ ] Contains total_labels, completed, pending

#### Archive Listing
```bash
curl -s http://localhost:8765/api/archive | python3 -m json.tool
```
- [ ] Response: HTTP 200 ✓
- [ ] Contains archive statistics

#### Webhooks
```bash
curl -s http://localhost:8765/api/webhooks | python3 -m json.tool
```
- [ ] Response: HTTP 200 ✓
- [ ] Lists registered webhooks

### 8.3 End-to-End Workflow Test
```bash
# Copy test SVG to watch directory
sudo cp /workspace/svg2gcode/test_layers.svg /mnt/raid1/gcode/test_e2e.svg
sleep 5
# Check service activity
sudo journalctl -u svg-to-gcode.service -n 10 --no-pager
# Verify labels
curl -s http://localhost:8765/api/labels
```

- [ ] SVG file detected by path unit
- [ ] Service activity logged
- [ ] Processing attempted (check logs for errors/success)
- [ ] Labels can be queried from API

### 8.4 Load Test (if applicable)
```bash
cd /workspace/svg2gcode && python3 << 'EOF'
# Creates 100 test labels
import sys
import time
sys.path.insert(0, '/opt/svg-to-gcode')
from label_history import LabelHistoryDB, LabelRecord
db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
start = time.time()
for i in range(100):
    record = LabelRecord(
        pattern_name=f"test_{i % 5}",
        piece_name=f"Test {i}",
        piece_id=f"test_{i:04d}"
    )
    db.add_label(record)
elapsed = time.time() - start
print(f"Added 100 labels in {elapsed:.2f}s")
db.close()
EOF
```

- [ ] Load test completed
- [ ] Throughput: _________________ labels/second
- [ ] No errors during load test
- [ ] Performance acceptable (recommend >100 labels/sec)

---

## PHASE 9: BACKUP & DISASTER RECOVERY
**Estimated Time: 5 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 9.1 Automated Backup Schedule
```bash
sudo crontab -l | grep svg2gcode-backup
```

- [ ] Backup script created: `/usr/local/bin/svg2gcode-backup.sh`
- [ ] Cron job configured
- [ ] Backup schedule: Daily at _________ (2 AM recommended)
- [ ] Backup location: _______________________________

### 9.2 Automated Cleanup Schedule
```bash
sudo crontab -l | grep svg2gcode-cleanup
```

- [ ] Cleanup script created: `/usr/local/bin/svg2gcode-cleanup.sh`
- [ ] Cron job configured
- [ ] Cleanup schedule: Monthly on _________ (1st at 3 AM recommended)
- [ ] Retention policies set

### 9.3 Test Backup
```bash
sudo /usr/local/bin/svg2gcode-backup.sh
ls -lh /mnt/raid1/backups/
```

- [ ] Backup executed successfully
- [ ] Backup directory created: _______________________________
- [ ] Database backup file exists and has size
- [ ] Configuration backup file exists
- [ ] Manifest file created with timestamp

---

## PHASE 10: ROLLBACK PROCEDURE
**Estimated Time: 10-15 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### 10.1 Rollback Procedure Setup
- [ ] Rollback script created and tested: `/usr/local/bin/svg2gcode-rollback.sh`
- [ ] Tested with sample backup directory
- [ ] Procedure documented: _______________________________

### 10.2 Rollback Test (if desired)
```bash
sudo /usr/local/bin/svg2gcode-rollback.sh <BACKUP_PATH>
```

- [ ] Rollback script executed without errors
- [ ] Services stopped gracefully
- [ ] Database restored from backup
- [ ] Configuration restored
- [ ] Services restarted successfully
- [ ] Verified rollback was successful
- [ ] Rolled forward again to current version

### 10.3 Rollback Documentation
- [ ] Rollback procedure documented in runbook
- [ ] Backup locations documented: _______________________________
- [ ] Emergency contacts listed
- [ ] Recovery time objective (RTO): _________ minutes
- [ ] Recovery point objective (RPO): _________ hours

---

## PHASE 11: PRODUCTION HANDOFF CHECKLIST
**Estimated Time: 5 minutes**
**Status**: [ ] In Progress  [ ] Complete  [ ] Failed

### Pre-Deployment Verification
- [ ] Python 3.8+ and dependencies verified
- [ ] /mnt/raid1 mounted with adequate space
- [ ] Database backed up (if upgrading)
- [ ] Network connectivity to webhook endpoints confirmed
- [ ] Firewall rules configured for port 8765

### Installation Verification
- [ ] Installation script completed without errors
- [ ] All files present in `/opt/svg-to-gcode/`
- [ ] Systemd units installed and reloaded
- [ ] Database initialized successfully

### Post-Installation Verification
- [ ] config.json reviewed and production values set
- [ ] Webhook secret changed from default
- [ ] Directory permissions verified
- [ ] Services started successfully

### Validation Verification
- [ ] Health endpoint responding
- [ ] API endpoints tested successfully
- [ ] Label history database accessible
- [ ] Archive directory accessible
- [ ] Webhook registration successful

### Security Verification
- [ ] Service running as unprivileged user
- [ ] Database file permissions restrictive (600)
- [ ] Config file permissions restrictive (600)
- [ ] Systemd security hardening enabled
- [ ] Resource limits configured

### Monitoring Verification
- [ ] Systemd journal configured
- [ ] Log rotation configured
- [ ] Backup schedule configured and tested
- [ ] Cleanup schedule configured
- [ ] Monitoring dashboard operational

### Testing Verification
- [ ] Integration tests passed
- [ ] Manual API tests passed
- [ ] End-to-end workflow tested
- [ ] Load test passed (if applicable)

### Documentation Verification
- [ ] Backup locations documented
- [ ] Webhook endpoints documented
- [ ] Production configuration documented
- [ ] Rollback procedure tested
- [ ] Runbook created and reviewed

---

## PHASE 12: OPERATIONAL RUNBOOK
**Status**: [ ] In Progress  [ ] Complete

### 12.1 Runbook Created
- [ ] File created: `/opt/svg-to-gcode/RUNBOOK.md`
- [ ] Common tasks documented
- [ ] Troubleshooting procedures documented
- [ ] Maintenance procedures documented
- [ ] Emergency procedures documented

### 12.2 Operator Training
- [ ] Operations team briefed on Phase 4
- [ ] Runbook reviewed with operators
- [ ] Common commands demonstrated
- [ ] Troubleshooting scenarios practiced
- [ ] Escalation procedures defined

### 12.3 Documentation Handoff
- [ ] All documentation reviewed
- [ ] Checklist provided to operations
- [ ] Contact information updated
- [ ] Escalation paths defined
- [ ] Support procedures documented

---

## DOCKER DEPLOYMENT (If Using Docker Option)

**Only complete if deploying to Docker. Skip if using Systemd on host.**

### Docker Pre-deployment Checks
**Estimated Time: 10 minutes**

- [ ] Docker installed: `docker --version`
- [ ] Docker daemon running: `docker ps`
- [ ] docker-compose installed: `docker-compose --version`
- [ ] Sufficient disk space: `docker system df`
- [ ] `/raid3/svg_deployment` directory created
- [ ] `/raid1/gcode` mount point exists
- [ ] `/raid1/label-archive` mount point exists

### Docker Image Build
**Estimated Time: 5 minutes**

```bash
cd /workspace/svg2gcode
docker build -t svg2gcode:latest .
```

- [ ] Docker image builds without errors
- [ ] Image size reasonable: `docker images svg2gcode` (< 200MB)
- [ ] Image tagged as `svg2gcode:latest`
- [ ] Base image verified: python:3.11-slim

### Docker Compose Setup
**Estimated Time: 5 minutes**

- [ ] `docker-compose.yml` copied to `/raid3/svg_deployment/`
- [ ] `Dockerfile` copied to `/raid3/svg_deployment/`
- [ ] `requirements.txt` copied to `/raid3/svg_deployment/`
- [ ] `.dockerignore` copied to `/raid3/svg_deployment/`
- [ ] All Python modules copied to `/raid3/svg_deployment/`
- [ ] `config/config.json` created in `/raid3/svg_deployment/config/`

### Docker Container Startup
**Estimated Time: 10 minutes**

```bash
cd /raid3/svg_deployment
docker-compose build
docker-compose up -d
docker-compose ps
```

- [ ] Container builds successfully
- [ ] Container starts without errors
- [ ] Container status: `Up` (not `Exited` or `Restarting`)
- [ ] Port 8765 accessible: `curl http://localhost:8765/health`
- [ ] Health check passing: `docker-compose ps` shows healthy status

### Docker API Testing
**Estimated Time: 10 minutes**

```bash
# Test health endpoint
curl -s http://localhost:8765/health | python3 -m json.tool

# Test label endpoints
curl -s http://localhost:8765/api/labels | python3 -m json.tool

# Test archive endpoints
curl -s http://localhost:8765/api/archive | python3 -m json.tool

# Check logs
docker-compose logs svg2gcode | head -50
```

- [ ] Health endpoint responds with status "healthy"
- [ ] `/api/labels` returns empty array or list of labels
- [ ] `/api/archive` returns archive statistics
- [ ] Container logs show no errors
- [ ] "File watcher thread started" message in logs

### Docker Volume Persistence
**Estimated Time: 5 minutes**

```bash
# Verify volumes created
docker volume ls | grep svg2gcode

# Check volume mounts
docker-compose exec svg2gcode ls -la /var/lib/svg-to-gcode
docker-compose exec svg2gcode ls -la /var/log/svg-to-gcode
docker-compose exec svg2gcode ls -la /mnt/raid1/gcode
```

- [ ] `svg2gcode-db` volume exists
- [ ] `svg2gcode-logs` volume exists
- [ ] Database file accessible in container
- [ ] Log directory accessible in container
- [ ] RAID mounts visible inside container

### Docker File Watching Test
**Estimated Time: 10 minutes**

```bash
# Create test SVG file
echo '<svg><circle cx="50" cy="50" r="40"/></svg>' > /raid1/gcode/test.svg

# Check logs for detection
docker-compose logs svg2gcode | grep "Detected new SVG"

# Verify via API
curl -s http://localhost:8765/api/labels/stats | python3 -m json.tool
```

- [ ] Test SVG file detected by polling watcher
- [ ] "Detected new SVG" message in logs
- [ ] No errors in container logs
- [ ] File detection latency acceptable (< 10 seconds)

### Docker Resource Limits
**Estimated Time: 5 minutes**

```bash
# Check resource limits
docker stats svg2gcode-daemon --no-stream

# Monitor for extended period
watch -n 1 'docker stats svg2gcode-daemon --no-stream'
```

- [ ] Memory usage < 512M limit
- [ ] CPU usage < 50% quota
- [ ] Container stable over 5 minute monitoring period
- [ ] No memory leaks observed

### Docker Container Restart Test
**Estimated Time: 10 minutes**

```bash
# Restart container
docker-compose restart svg2gcode

# Verify restart
docker-compose ps

# Test API after restart
curl http://localhost:8765/health

# Verify database persistence
docker-compose exec svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/app')
from label_history import LabelHistoryDB
db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
print(f"Labels: {db.get_statistics()['total_labels']}")
db.close()
EOF
```

- [ ] Container restarts cleanly
- [ ] Health endpoint accessible after restart
- [ ] Database data persists across restart
- [ ] All volumes remounted correctly

### Docker Compose Down/Up Cycle
**Estimated Time: 5 minutes**

```bash
docker-compose down
docker-compose up -d
docker-compose ps
```

- [ ] Container stops gracefully (`docker-compose down`)
- [ ] Container starts successfully (`docker-compose up`)
- [ ] No orphaned containers remain
- [ ] Clean startup from persistent volumes

### Docker Integration with Host
**Estimated Time: 5 minutes**

```bash
# Check container in main docker ps
docker ps | grep svg2gcode

# Verify network connectivity
docker ps --format="table {{.Names}}\t{{.Ports}}" | grep svg2gcode

# Test from another container (if applicable)
docker run --rm --network svg2gcode-network curlimages/curl http://svg2gcode:8765/health
```

- [ ] Container appears in `docker ps` output
- [ ] Port 8765 properly mapped
- [ ] Container accessible via name in custom network
- [ ] Integration with other Docker services possible

### Docker Logging
**Estimated Time: 5 minutes**

```bash
# View logs
docker-compose logs -f svg2gcode --tail 50

# Check log driver
docker inspect svg2gcode-daemon | grep -A 5 LogDriver

# Verify log rotation
docker-compose exec svg2gcode ls -la /var/log/svg-to-gcode/
```

- [ ] Container logs output to stdout/stderr
- [ ] Log driver configured as json-file
- [ ] Log rotation configured (10m max size, 3 files)
- [ ] Logs accessible via `docker-compose logs`

### Docker Cleanup
**Estimated Time: 5 minutes**

```bash
# Prune unused images
docker image prune -f

# Check system usage
docker system df
```

- [ ] Build cache cleaned up
- [ ] Unused images removed
- [ ] System disk space reclaimed
- [ ] Only necessary images retained

---

## FINAL SIGN-OFF

### Deployment Summary
- **Start Time**: _______________________
- **End Time**: _______________________
- **Total Duration**: _________ minutes
- **Planned Time (Systemd)**: 150-180 minutes
- **Planned Time (Docker)**: 120-150 minutes
- **Deployment Method Used**: [ ] Systemd  [ ] Docker  [ ] Both
- **Status**: [ ] On Schedule  [ ] Ahead  [ ] Behind

### Issues and Resolutions
```
Issue 1: _________________________________________________
Resolution: _____________________________________________

Issue 2: _________________________________________________
Resolution: _____________________________________________

Issue 3: _________________________________________________
Resolution: _____________________________________________
```

### Performance Metrics (Baseline)
- **Database Size**: _____________ MB
- **Label Insert Rate**: _____________ labels/sec
- **API Response Time**: _____________ ms
- **Memory Usage**: _____________ MB
- **CPU Usage**: _____________ %

### Sign-Off
- **Deployed By**: ___________________________________
- **Reviewed By**: ___________________________________
- **Approved By**: ___________________________________
- **Date**: _______________________
- **Time**: _______________________

### Go-Live Status
- [ ] APPROVED FOR GO-LIVE
- [ ] APPROVED WITH RESTRICTIONS: _________________
- [ ] NOT APPROVED - ISSUES PENDING

### Known Limitations/Caveats
```




```

### Next Steps
1. _________________________________________________
2. _________________________________________________
3. _________________________________________________

---

## APPENDIX: Quick Reference Commands

### Service Management
```bash
# Check status
sudo systemctl status svg-to-gcode.path
sudo systemctl status svg-to-gcode.service

# Start/Stop
sudo systemctl start svg-to-gcode.path
sudo systemctl stop svg-to-gcode.service

# View logs
sudo journalctl -u svg-to-gcode.service -f
```

### API Testing
```bash
# Health check
curl http://localhost:8765/health

# List labels
curl http://localhost:8765/api/labels

# List webhooks
curl http://localhost:8765/api/webhooks

# Get stats
curl http://localhost:8765/api/labels/stats
```

### Database Management
```bash
# Backup
sudo cp /var/lib/svg-to-gcode/labels.db /mnt/raid1/backups/labels.db.backup

# Restore
sudo cp /mnt/raid1/backups/labels.db.backup /var/lib/svg-to-gcode/labels.db

# Export
python3 << 'EOF'
import sys
sys.path.insert(0, '/opt/svg-to-gcode')
from label_history import LabelHistoryDB
db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
db.export_csv('/tmp/labels.csv')
db.export_json('/tmp/labels.json')
EOF
```

### Troubleshooting
```bash
# Check permissions
ls -la /var/lib/svg-to-gcode/
ls -la /etc/svg-to-gcode/
ls -la /opt/svg-to-gcode/

# Check config validity
python3 -m json.tool < /etc/svg-to-gcode/config.json

# Check database
sudo -u svg2gcode python3 << 'EOF'
import sys
sys.path.insert(0, '/opt/svg-to-gcode')
from label_history import LabelHistoryDB
db = LabelHistoryDB('/var/lib/svg-to-gcode/labels.db')
print(db.get_statistics())
EOF
```

---

**End of Deployment Checklist**

Print this document and mark items as you progress through the deployment.
Keep this checklist with your deployment documentation for audit purposes.
