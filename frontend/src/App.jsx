import { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";
import './index.css';
import VideoCall from "./VideoCall";

const SOCKET_URL = "http://localhost:5000"; // Backend URL

function generateRoomCode() {
  // Simple random code generator (6 uppercase letters/numbers)
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function App() {
  const [mode, setMode] = useState(null); // 'create' | 'join' | null
  const [room, setRoom] = useState("");
  const [createdRoom, setCreatedRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef(null);
  const [copied, setCopied] = useState(false);

  // Connect to socket when joining
  useEffect(() => {
    if (joined && room) {
      if (!socketRef.current) {
        socketRef.current = io(SOCKET_URL);
      }
      const socket = socketRef.current;
      socket.on("connect", () => setSocketConnected(true));
      socket.emit("join-room", room);
      // Clean up on unmount
      return () => {
        socket.disconnect();
        socketRef.current = null;
      };
    }
  }, [joined, room]);

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

  const handleCreate = () => {
    const code = generateRoomCode();
    setCreatedRoom(code);
    setRoom(code);
    setMode('create');
    setError("");
    // Clear previous state
    localStorage.setItem('activeRoom', code);
    localStorage.setItem('joined', 'false');
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (room.trim().length < 3) {
      setError("Room code must be at least 3 characters");
      return;
    }
    setError("");
    setJoined(true);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(createdRoom);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Landing page: Choose Create or Join
  if (!mode && !joined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-800 to-purple-900 p-4">
        <div className="bg-white bg-opacity-10 rounded-3xl shadow-2xl p-10 w-full max-w-lg flex flex-col gap-8 border border-white border-opacity-20">
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 bg-blue-500 rounded-2xl shadow-lg mb-2">
              <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4f9.png" alt="Video" className="w-12 h-12" />
            </div>
            <h1 className="text-5xl font-extrabold text-white text-center tracking-tight">Modern Meet</h1>
            <p className="text-blue-100 text-center text-base font-medium">Seamless video meetings. No sign up required.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-6 w-full justify-center">
            <button
              className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-2xl shadow-lg font-semibold text-xl hover:bg-blue-700 transition-all duration-300 flex flex-col items-center gap-2"
              onClick={handleCreate}
            >
              <span className="text-2xl">✨</span>
              Create Room
            </button>
            <button
              className="flex-1 px-6 py-4 bg-green-600 text-white rounded-2xl shadow-lg font-semibold text-xl hover:bg-green-700 transition-all duration-300 flex flex-col items-center gap-2"
              onClick={() => setMode('join')}
            >
              <span className="text-2xl">🔑</span>
              Join Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Create Room view
  if (mode === 'create' && !joined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-800 to-purple-900 p-4">
        <div className="bg-white bg-opacity-10 rounded-3xl shadow-2xl p-10 w-full max-w-md flex flex-col gap-8 border border-white border-opacity-20 items-center">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-3 bg-blue-600 rounded-xl shadow-lg">
              <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4f9.png" alt="Video" className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-white text-center">Share Room Code</h2>
          </div>
          
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="w-full bg-black bg-opacity-20 rounded-2xl border border-white border-opacity-10 p-6 flex items-center justify-center">
              <span className="font-mono text-3xl text-blue-100 tracking-widest select-all">{createdRoom}</span>
            </div>
            
            <button
              className={`w-full px-4 py-3 ${copied ? 'bg-green-500' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-xl shadow font-medium text-lg transition-all duration-300 flex items-center justify-center gap-2`}
              onClick={copyToClipboard}
            >
              {copied ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy Code
                </>
              )}
            </button>
            
            <button
              className="w-full mt-2 px-4 py-4 bg-green-600 text-white rounded-xl shadow font-semibold text-lg hover:bg-green-700 transition-all duration-300 flex items-center justify-center gap-2"
              onClick={(e) => { setJoined(true); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 10l5 5-5 5" />
                <path d="M4 4v7a4 4 0 004 4h12" />
              </svg>
              Start Meeting
            </button>
          </div>
          
          <button 
            className="text-blue-200 hover:text-white mt-4 transition-all duration-200 flex items-center gap-1" 
            onClick={() => { setMode(null); setCreatedRoom(""); setRoom(""); }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Join Room view
  if (mode === 'join' && !joined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-800 to-purple-900 p-4">
        <div className="bg-white bg-opacity-10 rounded-3xl shadow-2xl p-10 w-full max-w-md flex flex-col gap-8 border border-white border-opacity-20 items-center">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-3 bg-green-600 rounded-xl shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white text-center">Join a Room</h2>
          </div>
          
          <form onSubmit={handleJoin} className="flex flex-col gap-6 w-full">
            <div className="relative">
              <input
                type="text"
                placeholder="ENTER ROOM CODE"
                value={room}
                onChange={(e) => setRoom(e.target.value.toUpperCase())}
                className="w-full px-6 py-4 rounded-xl border border-white border-opacity-20 focus:border-blue-400 outline-none text-xl text-white bg-black bg-opacity-20 placeholder-blue-300 transition tracking-widest text-center font-mono"
                required
                maxLength={32}
                autoFocus
              />
              {room && (
                <button 
                  type="button"
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-blue-300 hover:text-white"
                  onClick={() => setRoom("")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M15 9l-6 6M9 9l6 6" />
                  </svg>
                </button>
              )}
            </div>
            
            <button
              type="submit"
              className="px-4 py-4 bg-green-600 text-white rounded-xl shadow font-semibold text-lg hover:bg-green-700 transition-all duration-300 flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
              </svg>
              Join Meeting
            </button>
          </form>
          
          {error && (
            <div className="w-full p-4 bg-red-500 bg-opacity-20 border border-red-500 border-opacity-30 rounded-xl">
              <p className="text-red-200 text-center font-medium flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </p>
            </div>
          )}
          
          <button 
            className="text-blue-200 hover:text-white mt-4 transition-all duration-200 flex items-center gap-1" 
            onClick={() => { setMode(null); setRoom(""); setError(""); }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Meeting room placeholder
  if (joined) {
    return (
      <VideoCall room={room} socket={socketRef.current} onLeave={() => {
        setJoined(false);
        setMode(null);
        setRoom("");
        setCreatedRoom("");
        localStorage.removeItem('activeRoom');
        localStorage.removeItem('joined');
      }} />
    );
  }
}