# Playwright base ships with Chromium + all required system libs preinstalled.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install Python deps first (better layer caching)
COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install \
        "fastapi>=0.115" \
        "uvicorn[standard]>=0.32" \
        "httpx>=0.27" \
        "playwright>=1.48" \
        "playwright-stealth>=1.0.6" \
        "python-dotenv>=1.0" \
        "pydantic>=2.9" \
        "pydantic-settings>=2.6" \
        "rapidfuzz>=3.10"

COPY src/ ./src/
COPY scripts/ ./scripts/

# Non-root user (matches homelab convention)
RUN useradd -m -u 1000 grocery && \
    mkdir -p /app/data && \
    chown -R grocery:grocery /app
USER grocery

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
