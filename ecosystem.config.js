module.exports = {
    apps: [{
        name: 'cow-rescue-api',
        script: './server.js',
        instances: 'max', // Use all CPU cores
        exec_mode: 'cluster',
        env: {
            NODE_ENV: 'production'
        },
        env_development: {
            NODE_ENV: 'development'
        },
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        min_uptime: '10s',
        max_restarts: 10,
        restart_delay: 4000
    }]
};
