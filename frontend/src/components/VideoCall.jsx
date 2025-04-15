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

  // Add console log to verify deployment
  useEffect(() => {
    console.log("🚀 VideoCall component mounted - Testing latest deployment");
  }, []);

  // Check if mobile on resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ... existing socket connection and peer connection code ...

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