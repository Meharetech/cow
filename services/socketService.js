const { Server } = require('socket.io');
const tokenService = require('./tokenService');
const Admin = require('../models/Admin');
const Citizen = require('../models/Citizen');
const NGO = require('../models/NGO');
const logger = require('../utils/logger');

class SocketService {
    constructor() {
        this.io = null;
        this.connectedUsers = new Map(); // userId -> socketId mapping
    }

    initialize(server) {
        this.io = new Server(server, {
            cors: {
                origin: process.env.CORS_ORIGIN || '*',
                methods: ['GET', 'POST'],
                credentials: true
            },
            pingTimeout: 60000,
            pingInterval: 25000,
            transports: ['websocket', 'polling']
        });

        // Authentication middleware
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

                if (!token) {
                    return next(new Error('Authentication token required'));
                }

                const { valid, decoded } = tokenService.verifyAccessToken(token);

                if (!valid) {
                    return next(new Error('Invalid or expired token'));
                }

                // Verify user exists and is active based on role
                let user;
                if (decoded.role === 'admin') {
                    user = await Admin.findById(decoded.userId).select('-password -refreshToken');
                } else if (decoded.role === 'ngo' || decoded.role === 'shelter') {
                    user = await NGO.findById(decoded.userId).select('-password -refreshToken');
                } else {
                    user = await Citizen.findById(decoded.userId).select('-password -refreshToken');
                }

                if (!user || !user.isActive || user.isBlocked) {
                    return next(new Error('User not found or inactive'));
                }

                // Attach user data to socket
                socket.userId = decoded.userId;
                socket.userRole = decoded.role;
                socket.userCity = user.city;
                socket.userState = user.state;
                socket.userData = user;

                next();
            } catch (error) {
                logger.error('Socket authentication error:', error);
                next(new Error('Authentication failed'));
            }
        });

        // Connection handler
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });

        logger.info('Socket.IO initialized successfully');
    }

    handleConnection(socket) {
        const userId = socket.userId;
        const role = socket.userRole;
        const city = socket.userCity;

        logger.info(`User connected: ${userId} (${role}) from ${city}`);

        // Store connection
        this.connectedUsers.set(userId, socket.id);

        // Join role-based room
        socket.join(`role:${role}`);

        // Join city-based room for NGOs and citizens
        if (city) {
            socket.join(`city:${city}`);
            socket.join(`${role}:city:${city}`); // e.g., ngo:city:pune
        }

        // Join user's personal room
        socket.join(`user:${userId}`);

        // Emit user online status
        this.io.to(`role:${role}`).emit('user:online', {
            userId,
            role,
            city,
            timestamp: new Date()
        });

        // Send connection success
        socket.emit('connected', {
            success: true,
            message: 'Connected to real-time server',
            userId,
            role,
            rooms: Array.from(socket.rooms)
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            this.handleDisconnection(socket);
        });

        // Handle custom events
        this.registerEventHandlers(socket);
    }

    handleDisconnection(socket) {
        const userId = socket.userId;
        const role = socket.userRole;

        logger.info(`User disconnected: ${userId} (${role})`);

        // Remove from connected users
        this.connectedUsers.delete(userId);

        // Emit user offline status
        this.io.to(`role:${role}`).emit('user:offline', {
            userId,
            role,
            timestamp: new Date()
        });
    }

    registerEventHandlers(socket) {
        // Ping-pong for connection health
        socket.on('ping', () => {
            socket.emit('pong', { timestamp: new Date() });
        });

        // NGO sharing location for live tracking
        socket.on('responder:location:update', (data) => {
            const { caseId, citizenId, location } = data;
            if (!caseId || !citizenId || !location) return;

            // Send to citizen's room
            this.io.to(`user:${citizenId}`).emit('case:location:update', {
                caseId,
                location,
                timestamp: new Date()
            });
        });

        // Join specific room
        socket.on('join:room', (roomName) => {
            socket.join(roomName);
            socket.emit('room:joined', { room: roomName });
        });

        // Leave specific room
        socket.on('leave:room', (roomName) => {
            socket.leave(roomName);
            socket.emit('room:left', { room: roomName });
        });
    }

    // Emit new case to NGOs in the same city
    emitNewCase(caseData) {
        if (!this.io) return;

        const city = caseData.city;
        const room = `ngo:city:${city}`;

        logger.info(`Emitting new case to room: ${room}`);

        this.io.to(room).emit('case:new', {
            type: 'case_new',
            data: caseData,
            timestamp: new Date()
        });

        // Also emit to all NGOs
        this.io.to('role:ngo').emit('case:new', {
            type: 'case_new',
            data: caseData,
            timestamp: new Date()
        });
    }

    // Emit case update to citizen
    emitCaseUpdate(citizenId, caseData) {
        if (!this.io) return;

        const room = `user:${citizenId}`;

        logger.info(`Emitting case update to user: ${citizenId}`);

        this.io.to(room).emit('case:update', {
            type: 'case_update',
            data: caseData,
            timestamp: new Date()
        });
    }

    // Emit case accepted to citizen
    emitCaseAccepted(citizenId, ngo, caseData) {
        if (!this.io) return;

        const room = `user:${citizenId}`;

        logger.info(`Emitting case accepted to user: ${citizenId}`);

        this.io.to(room).emit('case:accepted', {
            type: 'case_accepted',
            data: {
                ...caseData,
                ngo: {
                    _id: ngo._id,
                    organizationName: ngo.organizationName,
                    contactPerson: ngo.contactPerson,
                    mobile: ngo.mobile
                }
            },
            timestamp: new Date()
        });
    }

    // Emit treatment update to citizen
    emitTreatmentUpdate(citizenId, caseData) {
        if (!this.io) return;

        const room = `user:${citizenId}`;

        logger.info(`Emitting treatment update to user: ${citizenId}`);

        this.io.to(room).emit('treatment:update', {
            type: 'treatment_update',
            data: caseData,
            timestamp: new Date()
        });
    }

    // Emit case assignment
    emitCaseAssignment(citizenId, ngoId, caseData) {
        if (!this.io) return;

        // Notify citizen
        this.io.to(`user:${citizenId}`).emit('case:assigned', {
            type: 'case_assigned',
            data: caseData,
            timestamp: new Date()
        });

        // Notify NGO
        this.io.to(`user:${ngoId}`).emit('case:accepted', {
            type: 'case_accepted',
            data: caseData,
            timestamp: new Date()
        });
    }

    // Emit notification to specific user
    emitNotification(userId, notification) {
        if (!this.io) return;

        this.io.to(`user:${userId}`).emit('notification:new', {
            type: 'notification',
            data: notification,
            timestamp: new Date()
        });
    }

    // Broadcast to all users in a role
    broadcastToRole(role, event, data) {
        if (!this.io) return;

        this.io.to(`role:${role}`).emit(event, {
            data,
            timestamp: new Date()
        });
    }

    // Broadcast to all users in a city
    broadcastToCity(city, event, data) {
        if (!this.io) return;

        this.io.to(`city:${city}`).emit(event, {
            data,
            timestamp: new Date()
        });
    }

    // Get connected users count
    getConnectedUsersCount() {
        return this.connectedUsers.size;
    }

    // Check if user is online
    isUserOnline(userId) {
        return this.connectedUsers.has(userId);
    }

    // Get all connected users
    getConnectedUsers() {
        return Array.from(this.connectedUsers.keys());
    }
}

module.exports = new SocketService();
