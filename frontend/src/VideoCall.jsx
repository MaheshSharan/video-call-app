import { useEffect, useRef, useState } from "react";
import { useWebRTCConnection } from "./utils/connection";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

export default function VideoCall({ room, socket, onLeave }) {
  const localVideoRef = useRef(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [, forceUpdate] = useState(0);

  // Use the connection hook
  const { localStream, remoteStreams } = useWebRTCConnection({
    room,
    socket,
    onRemoteStream: (socketId, stream) => {
      forceUpdate(n => n + 1);
    },
    onUserLeft: (socketId) => {
      forceUpdate(n => n + 1);
    }
  });

  // Set local video stream
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Handle chat messages
  const handleChatMessage = ({ sender, message }) => {
    setChatMessages(prev => [...prev, { sender, message }]);
  };

  // Setup chat event listener
  useEffect(() => {
    if (!socket) return;
    
    socket.on("chat-message", handleChatMessage);
    return () => {
      socket.off("chat-message", handleChatMessage);
    };
  }, [socket]);

  // Handle meeting ended
  useEffect(() => {
    if (!socket) return;
    
    const handleMeetingEnded = () => {
      alert('The host has ended the meeting.');
      if (onLeave) onLeave();
    };
    
    socket.on('meeting-ended', handleMeetingEnded);
    return () => {
      socket.off('meeting-ended', handleMeetingEnded);
    };
  }, [socket, onLeave]);

  // Chat send function
  function sendChat(e) {
    e.preventDefault();
    if (chatInput.trim()) {
      socket.emit("chat-message", { roomId: room, message: chatInput });
      setChatMessages(prev => [...prev, { sender: socket.id, message: chatInput }]);
      setChatInput("");
    }
  }

  // Controls
  function toggleMute() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    });
  }

  function toggleCamera() {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled;
      setCameraOn(track.enabled);
    });
  }

  function leaveCall() {
    if (onLeave) onLeave();
    else window.location.reload();
  }

  // Remote Video Component
  function RemoteVideo({ stream, id }) {
    const videoRef = useRef(null);
    useEffect(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    }, [stream]);
    return (
      <div className="relative rounded-2xl overflow-hidden shadow-2xl aspect-video flex items-center justify-center border-4 border-indigo-600 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover bg-black transition-all duration-300"
        />
        <span className="absolute bottom-3 left-3 px-3 py-1 bg-indigo-600/80 text-white text-xs rounded-full font-bold shadow-lg">{id.slice(-5)}</span>
      </div>
    );
  }

  // UI
  return (
    <div className="flex flex-col min-h-screen w-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 text-white">
      {/* Video Grid */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 w-full max-w-5xl">
          {/* Local video */}
          <div className="relative rounded-2xl overflow-hidden shadow-2xl aspect-video flex items-center justify-center border-4 border-indigo-600 bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover bg-black transition-all duration-300"
              style={{filter: cameraOn ? 'none' : 'grayscale(1) brightness(0.4)'}}
            />
            <span className="absolute bottom-3 left-3 px-3 py-1 bg-indigo-600/80 text-white text-xs rounded-full font-bold shadow-lg">You</span>
            {!cameraOn && <span className="absolute inset-0 flex items-center justify-center text-5xl text-white/80"><svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='48' height='48'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z' /></svg></span>}
          </div>
          {/* Remote videos */}
          {Object.entries(remoteStreams).map(([id, stream]) => (
            <RemoteVideo key={id} stream={stream} id={id} />
          ))}
        </div>
        {/* Controls Bar */}
        <div className="mt-8 flex gap-8 justify-center items-center bg-black/50 rounded-xl p-4 shadow-xl">
          <button className={`flex items-center px-6 py-3 rounded-full shadow-lg text-lg font-semibold transition-all duration-300 ${muted ? 'bg-gray-500' : 'bg-blue-700 hover:bg-blue-800'}`} onClick={toggleMute} title="Mute/Unmute">
            {muted ? <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='28' height='28'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M9 9v6h4l5 5V4l-5 5H9z' /></svg> : <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='28' height='28'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M9 9v6h4l5 5V4l-5 5H9z' /></svg>}
          </button>
          <button className={`flex items-center px-6 py-3 rounded-full shadow-lg text-lg font-semibold transition-all duration-300 ${cameraOn ? 'bg-purple-700 hover:bg-purple-800' : 'bg-gray-500'}`} onClick={toggleCamera} title="Camera On/Off">
            {cameraOn ? <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='28' height='28'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z' /></svg> : <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='28' height='28'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z' /></svg>}
          </button>
          <button className="flex items-center px-6 py-3 rounded-full shadow-lg text-lg font-semibold transition-all duration-300 bg-red-600 hover:bg-red-700" onClick={leaveCall} title="Leave">
            <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='28' height='28'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M17 16l4-4m0 0l-4-4m4 4H7' /></svg>
            <span className="ml-2">Leave</span>
          </button>
        </div>
      </div>
      {/* Chat Sidebar */}
      <div className="w-full md:w-96 bg-white/80 backdrop-blur-md border-l border-purple-200 flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={msg.sender === socket.id ? "text-right" : "text-left"}>
              <span className="inline-block px-3 py-2 rounded-lg shadow text-sm " style={{background: msg.sender === socket.id ? '#a5b4fc' : '#e0e7ff', color: '#3730a3'}}>
                <b>{msg.sender === socket.id ? "Me" : msg.sender.slice(-5)}</b>: {msg.message}
              </span>
            </div>
          ))}
        </div>
        <form onSubmit={sendChat} className="flex p-2 border-t border-purple-200 bg-white/90">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 rounded-l-lg border border-purple-200 focus:ring-2 focus:ring-purple-400 outline-none text-base bg-purple-50"
          />
          <button type="submit" className="bg-purple-500 text-white px-5 py-2 rounded-r-lg hover:bg-purple-600 transition">Send</button>
        </form>
      </div>
    </div>
  );
}
