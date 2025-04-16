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

// Room validation endpoint
app.get('/validate-room/:roomId', (req, res) => {
  const { roomId } = req.params;
  console.log('Validating room:', roomId);
  
  // Check if room exists in active rooms
  const roomExists = io.sockets.adapter.rooms.has(roomId);
  
  res.json({
    exists: roomExists,
    roomId: roomId,
    timestamp: new Date().toISOString()
  });
});

// Room management and signaling
const roomHosts = {};
const activeConnections = new Map(); // Track active peer connections

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  activeConnections.set(socket.id, {
    rooms: new Set(),
    lastPing: Date.now()
  });

  // Handle ping/pong for connection health
  socket.on('ping', () => {
    const connection = activeConnections.get(socket.id);
    if (connection) {
      connection.lastPing = Date.now();
    }
  });

  socket.on('join-room', (roomId) => {
    try {
      socket.join(roomId);
      const connection = activeConnections.get(socket.id);
      if (connection) {
        connection.rooms.add(roomId);
      }

      const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(id => id !== socket.id);
      
      // Assign host if room is empty
      if (!roomHosts[roomId]) {
        roomHosts[roomId] = socket.id;
        console.log(`[${socket.id}] assigned as host for room ${roomId}`);
      }

      console.log(`[${socket.id}] joined room ${roomId}. Existing users:`, clients);
      
      // Send room info to the new user
      socket.emit('room-info', {
        roomId,
        isHost: roomHosts[roomId] === socket.id,
        existingUsers: clients
      });

      // Notify existing users
      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        isHost: roomHosts[roomId] === socket.id
      });
    } catch (error) {
      console.error(`Error in join-room for ${socket.id}:`, error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('signal', ({ roomId, data }) => {
    try {
      console.log(`[${socket.id}] signaling in room ${roomId}:`, data.type, '->', data.to || 'all');
      
      if (data.to) {
        // Verify the target user is in the same room
        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket && targetSocket.rooms.has(roomId)) {
          targetSocket.emit('signal', { 
            sender: socket.id, 
            data,
            roomId 
          });
        } else {
          console.warn(`Target user ${data.to} not found in room ${roomId}`);
        }
      } else {
        socket.to(roomId).emit('signal', { 
          sender: socket.id, 
          data,
          roomId 
        });
      }
    } catch (error) {
      console.error(`Error in signal handling for ${socket.id}:`, error);
      socket.emit('error', { message: 'Failed to process signal' });
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
    // Only broadcast to other users in the room, not to the sender
    socket.to(roomId).emit('chat-message', { 
      sender: socket.id, 
      message 
    });
  });

  socket.on('disconnecting', () => {
    try {
      const connection = activeConnections.get(socket.id);
      if (connection) {
        for (const roomId of connection.rooms) {
          console.log(`[${socket.id}] leaving room ${roomId}`);
          socket.to(roomId).emit('user-left', {
            userId: socket.id,
            wasHost: roomHosts[roomId] === socket.id
          });

          // Handle host transfer if needed
          if (roomHosts[roomId] === socket.id) {
            const roomMembers = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
            const newHost = roomMembers.find(id => id !== socket.id);
            if (newHost) {
              roomHosts[roomId] = newHost;
              io.to(newHost).emit('host-transferred', { roomId });
            } else {
              delete roomHosts[roomId];
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error in disconnecting handler for ${socket.id}:`, error);
    } finally {
      activeConnections.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Backend running on http://${HOST}:${PORT}`);
});
