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
  process.env.FRONTEND_URL || 'http://localhost:5173', // Vercel frontend URL
  'https://newmeetingfinal.vercel.app' // Your Vercel frontend URL
];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true
}));

app.get('/', (req, res) => {
  res.send('Video Call Backend Running');
});

// Room management and signaling
const roomHosts = {};
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(id => id !== socket.id);
    // Assign host if room is empty
    if (!roomHosts[roomId]) {
      roomHosts[roomId] = socket.id;
    }
    console.log(`[${socket.id}] joined room ${roomId}. Existing users:`, clients);
    socket.emit('all-users', clients);
    socket.to(roomId).emit('user-joined', socket.id);
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
