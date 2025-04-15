import { useState, useRef, useEffect } from "react";
import { useNotification } from "./contexts/NotificationContext";
import { FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, FaPhone, FaExpand, FaCompress } from "react-icons/fa";

const VideoCall = ({ room, socket, onLeave }) => {
  const [stream, setStream] = useState(null);
  const [peers, setPeers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activePeer, setActivePeer] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const localVideoRef = useRef(null);
  const peersRef = useRef([]);
  const { addNotification } = useNotification();

  // Debug logs
  useEffect(() => {
    console.log("🚀 VideoCall component mounted");
    console.log("📡 Socket connected:", socket?.connected);
    console.log("🎥 Stream status:", stream ? "Active" : "Not active");
    console.log("👥 Current peers:", peers.length);
  }, [socket, stream, peers]);

  // Initialize media stream
  useEffect(() => {
    const initMedia = async () => {
      try {
        console.log("🎥 Initializing media stream...");
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.log("🎥 Media stream obtained successfully");
        setStream(mediaStream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = mediaStream;
        }
      } catch (error) {
        console.error("❌ Error accessing media devices:", error);
        addNotification("Error accessing camera/microphone", "error");
      }
    };

    initMedia();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const createPeer = (userToSignal, callerID, stream) => {
    console.log("🎮 Creating peer connection for:", userToSignal);
    const peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
        {
          urls: "turn:global.relay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    });

    console.log("🎮 Adding local tracks to peer connection");
    stream.getTracks().forEach(track => {
      console.log("🎮 Adding track:", track.kind);
      peer.addTrack(track, stream);
    });

    peer.onicecandidate = (event) => {
      console.log("❄️ ICE candidate generated");
      if (event.candidate) {
        console.log("❄️ Sending ICE candidate to:", userToSignal);
        socket.emit("sending-signal", {
          userToSignal,
          callerID,
          signal: { candidate: event.candidate },
        });
      }
    };

    peer.ontrack = (event) => {
      console.log("📹 Received remote track:", event.track.kind);
      const peerObj = peersRef.current.find(p => p.peerID === userToSignal);
      if (peerObj && peerObj.videoRef.current) {
        console.log("📹 Setting remote stream for peer:", userToSignal);
        peerObj.videoRef.current.srcObject = event.streams[0];
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("🔌 Peer connection state:", peer.connectionState);
    };

    peer.onsignalingstatechange = () => {
      console.log("📡 Peer signaling state:", peer.signalingState);
    };

    return peer;
  };

  // Handle peer connections
  useEffect(() => {
    if (!socket || !stream) return;

    console.log("🔌 Setting up socket listeners...");

    socket.on("user-joined", ({ peerID, userName }) => {
      console.log("👋 New user joined:", peerID);
      console.log("🎥 Current stream status:", stream.getTracks().map(t => t.kind));
      const peer = createPeer(peerID, socket.id, stream);
      peersRef.current.push({
        peerID,
        peer,
        videoRef: useRef(),
      });
      setPeers(users => [...users, { peerID, videoRef: useRef() }]);
    });

    socket.on("receiving-returned-signal", ({ signal, callerID }) => {
      console.log("📡 Receiving returned signal from:", callerID);
      console.log("📡 Signal type:", signal.type || "ICE candidate");
      const item = peersRef.current.find(p => p.peerID === callerID);
      if (item) {
        console.log("📡 Setting remote description for peer:", callerID);
        item.peer.signal(signal);
      } else {
        console.error("❌ Peer not found for signal:", callerID);
      }
    });

    socket.on("user-left", ({ peerID }) => {
      console.log("👋 User left:", peerID);
      const peerObj = peersRef.current.find(p => p.peerID === peerID);
      if (peerObj) {
        console.log("🧹 Cleaning up peer connection for:", peerID);
        peerObj.peer.destroy();
      }
      const peers = peersRef.current.filter(p => p.peerID !== peerID);
      peersRef.current = peers;
      setPeers(users => users.filter(user => user.peerID !== peerID));
    });

    return () => {
      console.log("🧹 Cleaning up socket listeners");
      socket.off("user-joined");
      socket.off("receiving-returned-signal");
      socket.off("user-left");
    };
  }, [socket, stream]);

  // Check if mobile on resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const toggleMute = () => {
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (stream) {
      stream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const handlePeerClick = (peerId) => {
    setActivePeer(activePeer === peerId ? null : peerId);
  };

  // Calculate grid layout based on number of peers
  const getGridClass = () => {
    const totalPeers = peers.length + 1; // +1 for local video
    if (isMobile) {
      return "grid-cols-1";
    }
    if (totalPeers <= 2) return "grid-cols-1";
    if (totalPeers <= 4) return "grid-cols-2";
    return "grid-cols-3";
  };

  return (
    <div className="relative w-full h-screen bg-black">
      {/* Video Grid */}
      <div className={`grid ${getGridClass()} gap-4 p-4 h-full`}>
        {/* Local Video */}
        <div 
          className={`relative ${activePeer === 'local' ? 'col-span-2 row-span-2' : ''} 
            ${isMobile ? 'aspect-video' : 'h-full'} rounded-lg overflow-hidden`}
          onClick={() => handlePeerClick('local')}
        >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-2">
            <p className="text-white text-sm truncate">You</p>
          </div>
        </div>

        {/* Peer Videos */}
        {peers.map((peer) => (
          <div
            key={peer.peerID}
            className={`relative ${activePeer === peer.peerID ? 'col-span-2 row-span-2' : ''} 
              ${isMobile ? 'aspect-video' : 'h-full'} rounded-lg overflow-hidden`}
            onClick={() => handlePeerClick(peer.peerID)}
          >
            <video
              ref={peer.videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-2">
              <p className="text-white text-sm truncate">{peer.peerID}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-4">
        <div className="flex justify-center items-center gap-4">
          {/* Mute Button */}
          <button
            onClick={toggleMute}
            className={`p-3 rounded-full ${isMuted ? 'bg-red-600' : 'bg-gray-700'} 
              hover:bg-gray-600 transition-colors duration-200`}
          >
            {isMuted ? (
              <FaMicrophoneSlash className="text-white text-xl" />
            ) : (
              <FaMicrophone className="text-white text-xl" />
            )}
          </button>

          {/* Video Toggle Button */}
          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full ${isVideoOff ? 'bg-red-600' : 'bg-gray-700'} 
              hover:bg-gray-600 transition-colors duration-200`}
          >
            {isVideoOff ? (
              <FaVideoSlash className="text-white text-xl" />
            ) : (
              <FaVideo className="text-white text-xl" />
            )}
          </button>

          {/* End Call Button */}
          <button
            onClick={onLeave}
            className="p-3 rounded-full bg-red-600 hover:bg-red-700 
              transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-6 h-6">
              <path fill="white" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.23-2.67 2.14-.26.3-.42.48-.42.7 0 .2.15.4.42.7.8.91 1.69 1.65 2.67 2.14.33.16.56.51.56.9v3.1C7.85 21.8 9.4 22 11 22c5.5 0 10-4.5 10-10S17.5 2 12 2z"/>
            </svg>
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 
              transition-colors duration-200"
          >
            {isFullscreen ? (
              <FaCompress className="text-white text-xl" />
            ) : (
              <FaExpand className="text-white text-xl" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall; 