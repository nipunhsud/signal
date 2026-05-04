#!/usr/bin/env python3
"""Generate docker-compose.yml with N tier services."""
import sys

def generate_docker_compose(num_tiers: int) -> str:
    header = """version: '3.8'

services:
  # PostgreSQL database
  postgres:
    image: postgres:15-alpine
    container_name: signal-forge-db
    environment:
      POSTGRES_USER: ${DB_USER:-nipunsud}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
      POSTGRES_DB: signal_forge
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-nipunsud}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Dashboard server
  dashboard:
    build:
      context: .
      dockerfile: apps/breakout-agent/Dockerfile
      target: dashboard
    container_name: signal-forge-dashboard
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://${DB_USER:-nipunsud}:${DB_PASSWORD:-postgres}@postgres:5432/signal_forge
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
    command: node server.js

"""

    tiers = ""
    for i in range(1, num_tiers + 1):
        tiers += f"""  # Breakout Agent - Tier {i}
  agent-tier-{i}:
    build:
      context: .
      dockerfile: apps/breakout-agent/Dockerfile
    env_file: .env.tiers/.env.tier-{i}
    environment:
      - DATABASE_URL=postgresql://${{DB_USER:-nipunsud}}:${{DB_PASSWORD:-postgres}}@postgres:5432/signal_forge
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
    command: npm start
    restart: on-failure

"""

    footer = """volumes:
  postgres_data:
    driver: local
"""

    return header + tiers + footer

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python generate-docker-compose.py <num_tiers>")
        sys.exit(1)

    num_tiers = int(sys.argv[1])
    print(generate_docker_compose(num_tiers))
