# Production-Grade Real-Time Cow Rescue Backend

## Architecture Overview

```
Flutter App (Citizen/NGO)
        ↓
   NGINX/Load Balancer
        ↓
   Node.js Cluster (PM2)
        ↓
   Socket.IO + Redis Adapter
        ↓
   MongoDB Atlas (Indexed)
```

## Tech Stack
- **Runtime**: Node.js 18+ (Cluster Mode)
- **Framework**: Express.js
- **Database**: MongoDB + Mongoose
- **Real-time**: Socket.IO + Redis Adapter
- **Auth**: JWT (Access + Refresh Tokens)
- **Email**: Nodemailer (OTP Verification)
- **Security**: Helmet, Rate Limiting, bcrypt
- **File Upload**: Multer + Cloud Storage Ready

## Features Implemented

### Authentication System
- ✅ Citizen Registration with Email OTP
- ✅ NGO/Shelter Registration (Pending Admin Approval)
- ✅ JWT Access + Refresh Token Rotation
- ✅ Role-Based Access Control (RBAC)
- ✅ Password Encryption (bcrypt)

### Real-Time System
- ✅ WebSocket Authentication
- ✅ Room-based Broadcasting (by role + city)
- ✅ Live Case Updates (No Refresh)
- ✅ Live Notifications
- ✅ Scalable to 10,000+ concurrent users

### Case Management
- ✅ Citizen: Report Case with Location + Media
- ✅ NGO: View Live Cases in Real-Time
- ✅ NGO: Accept/Reject Cases
- ✅ Status Updates Push Instantly to Citizen
- ✅ Geospatial Queries (Nearby Cases)

## Database Schemas

### User Schema
- Citizen: name, mobile, email, password, dob, state, city, pincode, address
- NGO/Shelter: organizationName, registrationNumber, mobile, email, orgType, yearEstablished, capacity, state, city, pincode, address, contactPerson, verificationStatus

### Case Schema
- condition, latitude, longitude, address, landmark, photoUrls, videoUrl, status, citizenId, assignedNGO, timeline

### Notification Schema
- userId, type, message, caseId, read status

## Scaling Strategy

### For 10,000+ Concurrent Users:
1. **Node.js**: PM2 Cluster Mode (4-8 instances)
2. **WebSocket**: Redis Pub/Sub Adapter
3. **Database**: MongoDB Indexes + Connection Pooling
4. **Load Balancer**: NGINX with sticky sessions
5. **Caching**: Redis for sessions + real-time state
6. **Rate Limiting**: Per IP + Per User

## Security Best Practices
- Helmet.js for HTTP headers
- CORS configuration
- Input validation & sanitization
- SQL injection prevention (Mongoose)
- XSS protection
- Rate limiting on auth endpoints
- JWT secret rotation
- Password hashing with salt rounds

## Real-Time Event Flow

```
Citizen submits case
  → Socket emits to room: ngo:city:pune
    → All NGOs in Pune receive instantly
      → NGO accepts case
        → Socket emits to citizen
          → Citizen UI updates (no refresh)
```

## API Endpoints

### Auth
- POST /api/auth/citizen/register
- POST /api/auth/citizen/verify-otp
- POST /api/auth/citizen/login
- POST /api/auth/ngo/register
- POST /api/auth/ngo/login
- POST /api/auth/refresh-token
- POST /api/auth/logout

### Cases
- POST /api/cases (Citizen)
- GET /api/cases (NGO - with filters)
- GET /api/cases/nearby (NGO - geospatial)
- PATCH /api/cases/:id/accept (NGO)
- PATCH /api/cases/:id/status (NGO)
- GET /api/cases/my-reports (Citizen)

### WebSocket Events
- connection (with JWT auth)
- case:new
- case:update
- case:assign
- notification:new
- user:online
- user:offline

## Environment Variables
See `.env` file for configuration

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start  # Uses PM2 cluster mode
```

## Performance Optimizations
- MongoDB indexes on frequently queried fields
- Lean queries for read operations
- Projection to limit data transfer
- Redis caching for hot data
- Connection pooling
- Compression middleware

## Monitoring & Logging
- Winston for structured logging
- PM2 monitoring dashboard
- Error tracking ready
- Performance metrics

---

**This is a production-grade system designed for real-world scale.**
