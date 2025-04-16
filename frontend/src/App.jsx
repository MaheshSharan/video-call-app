import { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";
import './index.css';
import VideoCall from "./VideoCall";
import { NotificationProvider, useNotification } from "./contexts/NotificationContext";
import Loader from "./components/Loader";
import { Analytics } from '@vercel/analytics/react';

const SOCKET_URL = import.meta.env.VITE_HOST === 'prod' 
  ? 'https://video-call-app-yfcb.onrender.com'
  : import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

console.log('🌐 Environment:', import.meta.env.VITE_HOST);
console.log('🔌 Backend URL:', SOCKET_URL);
console.log('🚀 Running in:', import.meta.env.DEV ? 'Development' : 'Production');
console.log('📡 Socket URL:', SOCKET_URL);
console.log('🔍 Environment Variables:', {
  VITE_HOST: import.meta.env.VITE_HOST,
  VITE_SOCKET_URL: import.meta.env.VITE_SOCKET_URL,
  NODE_ENV: import.meta.env.NODE_ENV
});

function generateRoomCode() {
  // Simple random code generator (6 uppercase letters/numbers)
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function AppContent() {
  const [mode, setMode] = useState(null); // 'create' | 'join' | null
  const [room, setRoom] = useState("");
  const [createdRoom, setCreatedRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const socketRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const { addNotification } = useNotification();
  const connectionNotificationRef = useRef(null);

  // Add room validation function
  const validateRoom = async (roomCode) => {
    try {
      const response = await fetch(`${SOCKET_URL}/validate-room/${roomCode}`);
      const data = await response.json();
      return data.exists;
    } catch (error) {
      console.error('Error validating room:', error);
      return false;
    }
  };

  // Socket connection logic
  useEffect(() => {
    let mounted = true;

    const connectSocket = () => {
      if (!socketRef.current && joined && room) {
        console.log('🔄 Connecting to backend...');
        const socket = io(SOCKET_URL, {
          transports: ['websocket', 'polling'],
          upgrade: true,
          forceNew: true,
          secure: true,
          rejectUnauthorized: false,
          path: '/socket.io/',
          timeout: 20000,
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          withCredentials: true,
          extraHeaders: {
            'Access-Control-Allow-Origin': '*'
          },
          rememberUpgrade: true,
          perMessageDeflate: {
            threshold: 1024
          }
        });

        socketRef.current = socket;

        socket.on('connect', () => {
          console.log('✅ Connected to backend:', socket.id);
          if (mounted) {
            setSocketConnected(true);
            if (!connectionNotificationRef.current) {
              connectionNotificationRef.current = addNotification("Connected to the server", "success");
            }
            socket.emit("join-room", room);
          }
        });

        socket.on('connect_error', (error) => {
          console.error('⚠️ Connection error:', error.message);
          console.error('Error details:', error);
          if (mounted) {
            addNotification("Connection error: " + error.message, "error");
          }
        });

        socket.on('disconnect', (reason) => {
          console.log('❌ Disconnected:', reason);
          if (reason === 'io server disconnect') {
            socket.connect();
          }
          if (mounted) {
            setSocketConnected(false);
            connectionNotificationRef.current = null;
            addNotification("Disconnected from server", "warning");
          }
        });

        socket.on('error', (error) => {
          console.error('❌ Socket error:', error);
          if (mounted) {
            addNotification("Socket error: " + error.message, "error");
          }
        });
      }
    };

    connectSocket();

    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketConnected(false);
        connectionNotificationRef.current = null;
      }
    };
  }, [joined, room, addNotification]);

  useEffect(() => {
    // On mount, check if there is a room in localStorage
    const storedRoom = localStorage.getItem('activeRoom');
    const storedJoined = localStorage.getItem('joined') === 'true';
    if (storedRoom && storedJoined && !joined) {
      setRoom(storedRoom);
      setJoined(true);
    }
  }, []);

  useEffect(() => {
    // Persist room and joined state
    if (joined && room) {
      localStorage.setItem('activeRoom', room);
      localStorage.setItem('joined', 'true');
    } else {
      localStorage.removeItem('activeRoom');
      localStorage.removeItem('joined');
    }
  }, [joined, room]);

  useEffect(() => {
    if (joined && !socketConnected) {
      setShowLoader(true);
      const timer = setTimeout(() => {
        setShowLoader(false);
      }, 3000);
      return () => clearTimeout(timer);
    } else if (socketConnected) {
      setShowLoader(false);
    }
  }, [joined, socketConnected]);

  const handleCreate = () => {
    const code = generateRoomCode();
    setCreatedRoom(code);
    setRoom(code);
    setMode('create');
    setError("");
    localStorage.setItem('activeRoom', code);
    localStorage.setItem('joined', 'false');
    addNotification("Room created successfully", "success");
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    
    // Basic validation
    if (room.trim().length < 3) {
      setError("Room code must be at least 3 characters");
      addNotification("Room code must be at least 3 characters", "error");
      return;
    }

    // Show loading state
    setShowLoader(true);
    addNotification("Checking room availability...", "info");

    try {
      // Validate room existence
      const roomExists = await validateRoom(room);
      
      if (!roomExists) {
        setError("Room does not exist or is invalid");
        addNotification("Room does not exist or is invalid", "error");
        setShowLoader(false);
        return;
      }

      // Room exists, proceed with joining
      setError("");
      setJoined(true);
      addNotification("Joining room...", "success");
      
      // Hide loader after 3 seconds
      setTimeout(() => {
        setShowLoader(false);
      }, 3000);
    } catch (error) {
      console.error('Error joining room:', error);
      setError("Error checking room availability");
      addNotification("Error checking room availability", "error");
      setShowLoader(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(createdRoom);
    setCopied(true);
    addNotification("Room code copied to clipboard", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  // Landing page with responsive design
  if (!mode && !joined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 page-transition">
        <div className="container mx-auto px-4 py-8 sm:py-16">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-8 sm:mb-16 animate-fade-in">
              <div className="inline-block p-3 sm:p-4 bg-indigo-600 rounded-2xl shadow-lg mb-4 sm:mb-6 transform hover:scale-105 transition-transform duration-300 hover-lift">
                <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4f9.png" alt="Video" className="w-12 h-12 sm:w-16 sm:h-16" />
              </div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-4 tracking-tight animate-slide-in">
                Modern Meet
              </h1>
              <p className="text-lg sm:text-xl text-indigo-200 max-w-2xl mx-auto animate-fade-in px-4">
                Professional video meetings with crystal clear quality. No sign up required.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 sm:gap-8 max-w-4xl mx-auto px-4">
              <div className="glass-effect rounded-2xl p-6 sm:p-8 hover:border-indigo-500/50 transition-all duration-300 animate-scale-in hover-lift">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-indigo-600 rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white">Create Meeting</h2>
                </div>
                <p className="text-indigo-200 mb-6">
                  Start a new meeting and invite others with a simple room code.
                </p>
                <button
                  onClick={handleCreate}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 button-hover"
                >
                  <span className="text-xl">✨</span>
                  Create Room
                </button>
              </div>

              <div className="glass-effect rounded-2xl p-6 sm:p-8 hover:border-indigo-500/50 transition-all duration-300 animate-scale-in hover-lift">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-green-600 rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white">Join Meeting</h2>
                </div>
                <p className="text-indigo-200 mb-6">
                  Join an existing meeting with a room code from the host.
                </p>
                <button
                  onClick={() => setMode('join')}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 button-hover"
                >
                  <span className="text-xl">🔑</span>
                  Join Room
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Create Room view with responsive design
  if (mode === 'create' && !joined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 page-transition">
        <div className="container mx-auto px-4 py-8 sm:py-16">
          <div className="max-w-2xl mx-auto">
            <div className="glass-effect rounded-2xl p-6 sm:p-8 animate-scale-in">
              <div className="flex items-center gap-4 mb-8 animate-slide-in">
                <div className="p-3 bg-indigo-600 rounded-xl">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-white">Share Room Code</h2>
              </div>

              <div className="space-y-6">
                <div className="bg-black/20 rounded-xl p-6 border border-white/10 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-3xl text-indigo-200 tracking-widest">{createdRoom}</span>
                    <button
                      onClick={copyToClipboard}
                      className={`p-2 rounded-lg transition-all duration-300 ${
                        copied ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-700'
                      } button-hover`}
                    >
                      {copied ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setJoined(true)}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 button-hover"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z" />
                  </svg>
                  Start Meeting
                </button>

                <button
                  onClick={() => { setMode(null); setCreatedRoom(""); setRoom(""); }}
                  className="text-indigo-300 hover:text-white transition-all duration-300 flex items-center gap-2 justify-center button-hover"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Join Room view with responsive design
  if (mode === 'join' && !joined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 page-transition">
        <div className="container mx-auto px-4 py-8 sm:py-16">
          <div className="max-w-2xl mx-auto">
            <div className="glass-effect rounded-2xl p-6 sm:p-8 animate-scale-in">
              <div className="flex items-center gap-4 mb-8 animate-slide-in">
                <div className="p-3 bg-green-600 rounded-xl">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-white">Join a Meeting</h2>
              </div>

              <form onSubmit={handleJoin} className="space-y-6">
                <div className="relative animate-fade-in">
                  <input
                    type="text"
                    placeholder="ENTER ROOM CODE"
                    value={room}
                    onChange={(e) => setRoom(e.target.value.toUpperCase())}
                    className="w-full px-6 py-4 rounded-xl border border-white/20 focus:border-indigo-500 outline-none text-xl text-white bg-black/20 placeholder-indigo-300 transition tracking-widest text-center font-mono input-focus"
                    required
                    maxLength={32}
                    autoFocus
                  />
                  {room && (
                    <button
                      type="button"
                      onClick={() => setRoom("")}
                      className="absolute right-4 top-1/2 transform -translate-y-1/2 text-indigo-300 hover:text-white transition-colors duration-300 button-hover"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 button-hover"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z" />
                  </svg>
                  Join Meeting
                </button>

                {error && (
                  <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 animate-fade-in">
                    <p className="text-red-200 text-center font-medium flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {error}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => { setMode(null); setRoom(""); }}
                  className="text-indigo-300 hover:text-white transition-all duration-300 flex items-center gap-2 justify-center button-hover"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to Home
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Meeting room with loader
  if (joined) {
    return (
      <>
        {showLoader && !socketConnected && <Loader />}
        {socketConnected && (
          <VideoCall 
            room={room} 
            socket={socketRef.current} 
            onLeave={() => {
              setJoined(false);
              setMode(null);
              setRoom("");
              setCreatedRoom("");
              localStorage.removeItem('activeRoom');
              localStorage.removeItem('joined');
            }} 
          />
        )}
      </>
    );
  }

  return null;
}

export default function App() {
  return (
    <NotificationProvider>
      <AppContent />
      <Analytics />
    </NotificationProvider>
  );
}
