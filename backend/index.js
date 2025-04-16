import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'https://newmeetingfinal.vercel.app',
  'http://localhost:5173',
  'https://*.vercel.app'  // Allow all Vercel subdomains
];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.some(allowed => {
        if (allowed.includes('*')) {
          const pattern = new RegExp('^' + allowed.replace('*', '.*') + '$');
          return pattern.test(origin);
        }
        return allowed === origin;
      })) {
        callback(null, true);
      } else {
        console.log('CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false,
  allowUpgrades: true,
  perMessageDeflate: {
    threshold: 1024
  }
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = new RegExp('^' + allowed.replace('*', '.*') + '$');
        return pattern.test(origin);
      }
      return allowed === origin;
    })) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
}));

app.get('/', (req, res) => {
  res.send('Video Call Backend Running');
});

// Test endpoint with detailed logging
app.get('/test', (req, res) => {
  try {
    console.log('Test endpoint hit!');
    console.log('Request headers:', req.headers);
    console.log('Request origin:', req.headers.origin);
    
    res.json({
      status: 'success',
      message: 'Backend is accessible!',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      host: req.headers.host
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check ping received at:', new Date().toISOString());
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Room metadata storage
const roomMetadata = new Map();

// Room cleanup interval (24 hours)
const ROOM_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Function to clean up expired rooms
const cleanupExpiredRooms = () => {
  const now = Date.now();
  for (const [roomId, metadata] of roomMetadata.entries()) {
    if (now - metadata.lastActivity > ROOM_EXPIRY_TIME) {
      console.log(`Cleaning up expired room: ${roomId}`);
      roomMetadata.delete(roomId);
      // Notify all users in the room that it's expired
      io.to(roomId).emit('room-expired');
      // Force disconnect all users in the room
      io.in(roomId).disconnectSockets(true);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredRooms, 60 * 60 * 1000);

// Room validation endpoint with enhanced metadata
app.get('/validate-room/:roomId', (req, res) => {
  const { roomId } = req.params;
  console.log('Validating room:', roomId);
  
  try {
    // Check if room exists in active rooms
    const roomExists = io.sockets.adapter.rooms.has(roomId);
    const metadata = roomMetadata.get(roomId);
    
    if (roomExists && metadata) {
      // Update last activity time
      metadata.lastActivity = Date.now();
      roomMetadata.set(roomId, metadata);
      
      res.json({
        exists: true,
        roomId: roomId,
        createdAt: metadata.createdAt,
        lastActivity: metadata.lastActivity,
        participants: Array.from(io.sockets.adapter.rooms.get(roomId) || []).length,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        exists: false,
        roomId: roomId,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error validating room:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Room management and signaling
const roomHosts = {};
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('join-room', (roomId) => {
    try {
      socket.join(roomId);
      
      // Initialize or update room metadata
      if (!roomMetadata.has(roomId)) {
        roomMetadata.set(roomId, {
          createdAt: Date.now(),
          lastActivity: Date.now(),
          host: socket.id
        });
      } else {
        const metadata = roomMetadata.get(roomId);
        metadata.lastActivity = Date.now();
        roomMetadata.set(roomId, metadata);
      }

      const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(id => id !== socket.id);
      console.log(`[${socket.id}] joined room ${roomId}. Existing users:`, clients);
      
      socket.emit('all-users', clients);
      socket.to(roomId).emit('user-joined', socket.id);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('signal', ({ roomId, data }) => {
    console.log(`[${socket.id}] signaling in room ${roomId}:`, data.type, '->', data.to || 'all');
    if (data.to) {
      // Send only to the intended recipient
      io.to(data.to).emit('signal', { sender: socket.id, data });
    } else {
      // Broadcast to everyone else in the room (except sender)
      socket.to(roomId).emit('signal', { sender: socket.id, data });
    }
  });

  // Handle media status changes (camera/mic on/off)
  socket.on('media-status-change', ({ roomId, audioEnabled, videoEnabled }) => {
    console.log(`[${socket.id}] media status changed in room ${roomId}:`, { audioEnabled, videoEnabled });
    // Relay to all other users in the room
    socket.to(roomId).emit('media-status-change', { 
      senderId: socket.id, 
      audioEnabled, 
      videoEnabled 
    });
  });

  socket.on('chat-message', ({ roomId, message }) => {
    console.log(`[${socket.id}] chat in room ${roomId}:`, message);
    io.to(roomId).emit('chat-message', { sender: socket.id, message });
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        console.log(`[${socket.id}] leaving room ${roomId}`);
        socket.to(roomId).emit('user-left', socket.id);
        
        // Update room metadata
        if (roomMetadata.has(roomId)) {
          const metadata = roomMetadata.get(roomId);
          metadata.lastActivity = Date.now();
          roomMetadata.set(roomId, metadata);
        }
      }
    }
    // Check if this socket is the host
    for (const roomId of socket.rooms) {
      if (roomHosts[roomId] === socket.id) {
        // Notify all users meeting is ended
        socket.to(roomId).emit('meeting-ended');
        delete roomHosts[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Backend running on http://${HOST}:${PORT}`);
});
