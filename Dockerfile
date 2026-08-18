FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python modules
COPY label_history.py label_archiver.py webhook_notifier.py svg-to-gcode-daemon.py ./

# Create requirements.txt and install dependencies
RUN echo "Flask>=2.0.0\nrequests>=2.28.0" > requirements.txt && \
    pip install --no-cache-dir -r requirements.txt

# Create non-root user (matching systemd deployment)
RUN useradd -r -s /bin/false svg2gcode && \
    chown -R svg2gcode:svg2gcode /app

# Create required directories
RUN mkdir -p /var/lib/svg-to-gcode /var/log/svg-to-gcode /etc/svg-to-gcode && \
    chown -R svg2gcode:svg2gcode /var/lib/svg-to-gcode /var/log/svg-to-gcode /etc/svg-to-gcode

USER svg2gcode

EXPOSE 8765

# Health check (using REST API health endpoint)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

# Entry point: run daemon directly (Flask development server)
ENTRYPOINT ["python3", "svg-to-gcode-daemon.py"]
CMD ["--config", "/etc/svg-to-gcode/config.json", "--host", "0.0.0.0", "--port", "8765"]
