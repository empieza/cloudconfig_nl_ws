module.exports = {
    apps: [{
      name: 'curwe-cloudconfig-ws',
      script: 'server.js',
      instances: process.env.PM2_INSTANCES || 2,
      exec_mode: 'cluster',
      max_memory_restart: process.env.PM2_MAX_MEMORY || '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0'
      },
      error_file: '/var/log/curwe-cloudconfig/err.log',
      out_file: '/var/log/curwe-cloudconfig/out.log',
      log_file: '/var/log/curwe-cloudconfig/combined.log',
      time: true,
      autorestart: true,
      watch: false,
      kill_timeout: 5000,
      listen_timeout: 5000,
      merge_logs: true
    }]
  };