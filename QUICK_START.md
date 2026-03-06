# Cow Rescue Backend - Quick Start Guide

## Installation

```bash
npm install
```

## Environment Setup

The `.env` file is already configured. Key variables:

- **MongoDB**: Connected to your Atlas cluster
- **JWT Secrets**: Change these in production!
- **Email**: Configured for OTP sending
- **Port**: 5000

## Running the Server

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Cluster Mode (for 10,000+ users)
```bash
npm run cluster
```

## API Endpoints

### Base URL
```
http://localhost:5000
```

### Authentication

#### Citizen Registration
```http
POST /api/auth/citizen/register
Content-Type: application/json

{
  "name": "John Doe",
  "mobile": "9876543210",
  "email": "john@example.com",
  "password": "password123",
  "dob": "15 / 5 / 1990",
  "state": "Maharashtra",
  "city": "Pune",
  "pincode": "411001",
  "address": "123 Main Street"
}
```

#### Verify OTP
```http
POST /api/auth/citizen/verify-otp
Content-Type: application/json

{
  "email": "john@example.com",
  "otp": "123456"
}
```

#### Citizen Login
```http
POST /api/auth/citizen/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

#### NGO Registration
```http
POST /api/auth/ngo/register
Content-Type: application/json

{
  "organizationName": "Animal Welfare NGO",
  "registrationNumber": "NGO123456",
  "mobile": "9876543210",
  "email": "ngo@example.com",
  "password": "password123",
  "orgType": "NGO",
  "yearEstablished": "2010",
  "capacity": 50,
  "state": "Maharashtra",
  "city": "Pune",
  "pincode": "411001",
  "address": "456 NGO Street",
  "contactPersonName": "Jane Smith",
  "contactPersonDesignation": "Director",
  "contactPersonMobile": "9876543211"
}
```

#### NGO Login
```http
POST /api/auth/ngo/login
Content-Type: application/json

{
  "email": "ngo@example.com",
  "password": "password123"
}
```

### Cases

#### Create Case (Citizen)
```http
POST /api/cases
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "condition": "Injured cow on road",
  "latitude": 18.5204,
  "longitude": 73.8567,
  "address": "MG Road, Pune",
  "landmark": "Near City Mall",
  "photoUrls": ["url1", "url2"],
  "videoUrl": "video_url"
}
```

#### Get All Cases (NGO)
```http
GET /api/cases?status=pending&page=1&limit=20
Authorization: Bearer <access_token>
```

#### Get Nearby Cases (NGO)
```http
GET /api/cases/nearby?latitude=18.5204&longitude=73.8567&radius=10
Authorization: Bearer <access_token>
```

#### Accept Case (NGO)
```http
PATCH /api/cases/:id/accept
Authorization: Bearer <access_token>
```

#### Update Case Status (NGO)
```http
PATCH /api/cases/:id/status
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "status": "in_progress",
  "message": "Team is on the way"
}
```

#### Get My Reports (Citizen)
```http
GET /api/cases/my-reports
Authorization: Bearer <access_token>
```

### Notifications

#### Get Notifications
```http
GET /api/notifications?page=1&limit=20&unreadOnly=false
Authorization: Bearer <access_token>
```

#### Mark as Read
```http
PATCH /api/notifications/:id/read
Authorization: Bearer <access_token>
```

## WebSocket Connection

### Connect to Socket.IO

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: {
    token: 'your_access_token_here'
  },
  transports: ['websocket', 'polling']
});

// Connection events
socket.on('connected', (data) => {
  console.log('Connected:', data);
});

// Real-time case events
socket.on('case:new', (data) => {
  console.log('New case:', data);
});

socket.on('case:update', (data) => {
  console.log('Case updated:', data);
});

socket.on('case:assigned', (data) => {
  console.log('Case assigned:', data);
});

// Notification events
socket.on('notification:new', (data) => {
  console.log('New notification:', data);
});

// User presence
socket.on('user:online', (data) => {
  console.log('User online:', data);
});

socket.on('user:offline', (data) => {
  console.log('User offline:', data);
});
```

### For Flutter/Dart

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

IO.Socket socket = IO.io('http://10.0.2.2:5000', <String, dynamic>{
  'transports': ['websocket'],
  'autoConnect': false,
  'auth': {'token': 'your_access_token_here'}
});

socket.connect();

socket.on('connected', (data) => print('Connected: $data'));
socket.on('case:new', (data) => print('New case: $data'));
socket.on('case:update', (data) => print('Case update: $data'));
socket.on('notification:new', (data) => print('Notification: $data'));
```

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error (dev only)"
}
```

## Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Server Error

## Testing

### Health Check
```bash
curl http://localhost:5000/health
```

### Test Registration
```bash
curl -X POST http://localhost:5000/api/auth/citizen/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "mobile": "9876543210",
    "email": "test@example.com",
    "password": "password123",
    "state": "Maharashtra",
    "city": "Pune"
  }'
```

## Production Deployment

1. Update JWT secrets in `.env`
2. Set `NODE_ENV=production`
3. Use PM2 cluster mode: `npm run cluster`
4. Set up NGINX reverse proxy
5. Enable HTTPS
6. Configure Redis for Socket.IO scaling (optional)

## Monitoring

```bash
# PM2 monitoring
pm2 monit

# View logs
pm2 logs

# Check status
pm2 status
```

## Troubleshooting

### MongoDB Connection Issues
- Check if IP is whitelisted in MongoDB Atlas
- Verify connection string

### Socket.IO Not Connecting
- Ensure server is running
- Check CORS settings
- Verify JWT token is valid

### Email OTP Not Sending
- Check Gmail app password
- Verify EMAIL_USER and EMAIL_PASS in .env

---

**Your production-grade real-time backend is ready! 🚀**
