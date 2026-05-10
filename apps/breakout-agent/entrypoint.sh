#!/bin/sh
set -e

echo "Starting dashboard..."
cd /app/apps/breakout-agent
node server.js
