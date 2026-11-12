# The Corpo Mailer backend as a container. Built by deploy/docker-compose.yml.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv

WORKDIR /app

# Dependencies first (cached until the lock file changes). No dev tools in the image.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini entrypoint.sh ./
COPY migrations ./migrations
COPY app ./app

# Run as an ordinary user, not root.
RUN useradd --system --uid 10001 --no-create-home corpo \
    && chown -R corpo /app \
    && chmod +x entrypoint.sh
USER corpo

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

ENTRYPOINT ["./entrypoint.sh"]
