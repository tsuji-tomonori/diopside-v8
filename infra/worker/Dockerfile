FROM python:3.12-slim-bookworm

ARG UV_VERSION=0.11.33

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates ffmpeg nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir "uv==${UV_VERSION}" \
    && useradd --create-home --uid 10001 worker

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --locked --no-dev

USER 10001

ENTRYPOINT ["python", "-m", "diopside_ingestion.worker"]
