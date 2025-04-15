import { useState, useRef, useEffect, useCallback } from "react";
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
  const queuedIceCandidatesRef = useRef({});
  const [messages, setMessages] = useState([]);

  // Debug logs
  useEffect(() => {
    console.log("🚀 VideoCall component mounted");
    console.log("📡 Socket connected:", socket?.connected);
    console.log("🎥 Stream status:", stream ? "Active" : "Not active");
    console.log("👥 Current peers:", peers.length);
  }, [socket, stream, peers]);

  // Initialize media stream with explicit logging
  useEffect(() => {
    const initMedia = async () => {
      try {
        console.log("🎥 Starting media initialization...");
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.log("🎥 Media stream obtained:", {
          video: mediaStream.getVideoTracks().length > 0,
          audio: mediaStream.getAudioTracks().length > 0,
          tracks: mediaStream.getTracks().map(t => t.kind)
        });
        setStream(mediaStream);
        if (localVideoRef.current) {
          console.log("🎥 Setting local video stream");
          localVideoRef.current.srcObject = mediaStream;
        }
      } catch (error) {
        console.error("❌ Media initialization error:", error);
        addNotification("Error accessing camera/microphone", "error");
      }
    };

    console.log("🎥 Initializing media stream...");
    initMedia();

    return () => {
      if (stream) {
        console.log("🧹 Cleaning up media stream");
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const createPeer = (userToSignal, callerID, stream) => {
    console.log("🎮 Starting peer creation for:", userToSignal);
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
      console.log(`🎮 Adding ${track.kind} track to peer`);
      peer.addTrack(track, stream);
    });

    peer.onicecandidate = (event) => {
      console.log("❄️ ICE candidate event:", event.candidate ? "New candidate" : "End of candidates");
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
      console.log("📹 Received remote track event:", {
        kind: event.track.kind,
        streamCount: event.streams.length,
        streams: event.streams.map(s => s.id)
      });
      const peerObj = peersRef.current.find(p => p.peerID === userToSignal);
      if (peerObj && peerObj.videoRef.current) {
        console.log("📹 Setting remote stream for peer:", userToSignal);
        peerObj.videoRef.current.srcObject = event.streams[0];
      } else {
        console.error("❌ Could not find peer or video element for:", userToSignal);
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("🔌 Peer connection state changed:", peer.connectionState);
    };

    peer.onsignalingstatechange = () => {
      console.log("📡 Peer signaling state changed:", peer.signalingState);
    };

    return peer;
  };

  const handleSignal = useCallback((userId, signal) => {
    console.log('handleSignal called', userId, signal);
    if (!peersRef.current[userId]) {
      console.log('Creating new peer connection for', userId);
      const peer = createPeer(userId, socket.id, stream);
      peersRef.current[userId] = peer;
    }

    const peer = peersRef.current[userId];
    
    if (signal.type === 'offer') {
      console.log('Received offer from', userId);
      if (peer.signalingState === 'stable') {
        console.log('Setting remote description (offer) from', userId);
        peer.setRemoteDescription(new RTCSessionDescription(signal))
          .then(() => {
            console.log('Creating and setting local description (answer) for', userId);
            return peer.createAnswer();
          })
          .then(answer => {
            console.log('Setting local description (answer) for', userId);
            return peer.setLocalDescription(answer);
          })
          .then(() => {
            console.log('Sending answer to', userId);
            socket.emit('signal', { userId, signal: peer.localDescription });
          })
          .catch(error => {
            console.error('Error handling offer:', error);
          });
      } else {
        console.log('Peer connection not in stable state, current state:', peer.signalingState);
      }
    } else if (signal.type === 'answer') {
      console.log('Received answer from', userId);
      if (peer.signalingState === 'have-local-offer') {
        console.log('Setting remote description (answer) from', userId);
        peer.setRemoteDescription(new RTCSessionDescription(signal))
          .catch(error => {
            console.error('Error setting remote description:', error);
          });
      } else {
        console.log('Peer connection not in have-local-offer state, current state:', peer.signalingState);
      }
    } else if (signal.type === 'candidate') {
      console.log('Received ICE candidate from', userId);
      if (peer.remoteDescription) {
        console.log('Adding ICE candidate from', userId);
        peer.addIceCandidate(new RTCIceCandidate(signal.candidate))
          .catch(error => {
            console.error('Error adding ICE candidate:', error);
          });
      } else {
        console.log('Queueing ICE candidate from', userId);
        if (!queuedIceCandidatesRef.current[userId]) {
          queuedIceCandidatesRef.current[userId] = [];
        }
        queuedIceCandidatesRef.current[userId].push(signal.candidate);
      }
    }
  }, [socket, createPeer, stream]);

  // Handle peer connections with explicit logging
  useEffect(() => {
    if (!socket || !stream) {
      console.log("⚠️ Socket or stream not ready:", { socket: !!socket, stream: !!stream });
      return;
    }

    console.log("🔌 Setting up socket listeners with stream:", {
      video: stream.getVideoTracks().length > 0,
      audio: stream.getAudioTracks().length > 0,
      tracks: stream.getTracks().map(t => t.kind)
    });

    const handleUserJoined = ({ peerID, userName }) => {
      console.log("👋 New user joined event:", { peerID, userName });
      console.log("🎥 Current stream status:", stream.getTracks().map(t => t.kind));
      const peer = createPeer(peerID, socket.id, stream);
      peersRef.current.push({
        peerID,
        peer,
        videoRef: useRef(),
      });
      setPeers(users => [...users, { peerID, videoRef: useRef() }]);
    };

    const handleReturnedSignal = ({ signal, callerID }) => {
      console.log("📡 Receiving signal from:", callerID, "Type:", signal.type || "ICE candidate");
      const item = peersRef.current.find(p => p.peerID === callerID);
      if (item) {
        console.log("📡 Setting remote description for peer:", callerID);
        item.peer.signal(signal);
      } else {
        console.error("❌ Peer not found for signal:", callerID);
      }
    };

    const handleUserLeft = ({ peerID }) => {
      console.log("👋 User left event:", peerID);
      const peerObj = peersRef.current.find(p => p.peerID === peerID);
      if (peerObj) {
        console.log("🧹 Cleaning up peer connection for:", peerID);
        peerObj.peer.destroy();
      }
      const peers = peersRef.current.filter(p => p.peerID !== peerID);
      peersRef.current = peers;
      setPeers(users => users.filter(user => user.peerID !== peerID));
    };

    socket.on("user-joined", handleUserJoined);
    socket.on("receiving-returned-signal", handleReturnedSignal);
    socket.on("user-left", handleUserLeft);

    return () => {
      console.log("🧹 Cleaning up socket listeners");
      socket.off("user-joined", handleUserJoined);
      socket.off("receiving-returned-signal", handleReturnedSignal);
      socket.off("user-left", handleUserLeft);
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

  // Handle chat messages
  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = ({ sender, message }) => {
      console.log('Received chat message:', { sender, message });
      // Only add message if it's not from the current user
      if (sender !== socket.id) {
        setMessages(prev => [...prev, { sender, message }]);
      }
    };

    socket.on('chat-message', handleChatMessage);

    return () => {
      socket.off('chat-message', handleChatMessage);
    };
  }, [socket]);

  const sendMessage = (message) => {
    if (!message.trim() || !socket || !room) return;
    
    console.log('Sending chat message:', message);
    // Add message to local state first
    setMessages(prev => [...prev, { sender: socket.id, message }]);
    
    // Then emit to others
    socket.emit('chat-message', { room, message });
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