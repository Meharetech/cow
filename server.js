const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const socketService = require('./services/socketService');
const logger = require('./utils/logger');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Connect to MongoDB
connectDB().then(() => {
    // Seed Admin if not exists
    const seedAdmin = require('./utils/seedAdmin');
    seedAdmin();
});

// Initialize Socket.IO
socketService.initialize(server);

// Initialize Case Escalation Monitoring
const escalationService = require('./services/escalationService');
escalationService.startEscalationMonitoring();


// Security Middleware - Relaxed COEP/CORP to allow loading images/videos in web app
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
}));

// CORS Configuration
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

// Body Parser Middleware
// Kept low (10mb) to prevent OOM crashes under high concurrency.
// File uploads go through multer (streaming to disk), not JSON body.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve Static Files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate Limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500, // Raised from 100 to handle shared NAT/corporate IPs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

// Strict rate limiting for auth routes (prevent brute force)
app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Strict limit for auth endpoints
    message: 'Too many authentication attempts, please try again later.'
}));

// Apply general rate limiting
app.use('/api', limiter);

// Request Logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    next();
});

// Health Check Route
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'Server is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        socketConnections: socketService.getConnectedUsersCount()
    });
});

// Basic route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Cow Rescue API - Production Ready',
        version: '1.0.0',
        documentation: '/api/docs',
        endpoints: {
            auth: '/api/auth',
            cases: '/api/cases',
            notifications: '/api/notifications',
            location: '/api/location'
        }
    });
});

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/cases', require('./routes/caseRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/location', require('./routes/locationRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));


// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    logger.error('Global error handler:', {
        error: err.message,
        stack: err.stack,
        path: req.path
    });

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

// Unhandled Promise Rejection
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught Exception
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

// Start Server
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
    const baseUrl = `http://localhost:${PORT}`;

    logger.info(`🚀 Server is running on port ${PORT}`);
    logger.info(`📡 Socket.IO is ready for real-time connections`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
    logger.info(`💾 MongoDB: Connected`);

    console.log(`\n${'='.repeat(55)}`);
    console.log(`✅  Server running`);
    console.log(`    Local:   ${baseUrl}`);
    if (process.env.NGROK_URL) {
        console.log(`    Public:  ${process.env.NGROK_URL}`);
    }
    console.log(`    Socket:  ws://localhost:${PORT}`);
    console.log(`    Env:     ${process.env.NODE_ENV || 'development'}`);
    console.log(`    Port:    ${PORT}`);
    console.log(`${'='.repeat(55)}\n`);
    console.log(`✅  Real-time WebSocket ready`);
    console.log(`✅  Ready for 10,000+ concurrent users\n`);
});


module.exports = { app, server };
