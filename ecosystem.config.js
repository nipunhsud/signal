module.exports = {
  apps: [
    {
      name: 'signal-forge-scan',
      script: '/bin/bash',
      args: '-c "docker-compose up --build agent-tier-1 agent-tier-2 agent-tier-3 agent-tier-4 agent-tier-5"',
      cwd: '/Users/nipunsud/github/signal-forge',
      watch: false,
      autorestart: true,
      max_memory_restart: '4G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
