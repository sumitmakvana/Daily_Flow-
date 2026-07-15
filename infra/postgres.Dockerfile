FROM postgres:16-bookworm

RUN apt-get update && \
    apt-get install -y postgresql-16-cron curl && \
    rm -rf /var/lib/apt/lists/*
