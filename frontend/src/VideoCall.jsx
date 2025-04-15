import { useEffect, useRef, useState } from "react";
import { useWebRTCConnection } from "./utils/connection";
import { useNotification } from "./contexts/NotificationContext";

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
  const { addNotification } = useNotification();
  const [activeTab, setActiveTab] = useState("chat"); // "chat" or "participants"
  const [remoteUserStatus, setRemoteUserStatus] = useState({}); // Track remote users' audio/video status
  const trackListenersRef = useRef({}); // For keeping track of event listeners across renders

  // Use the connection hook
  const { localStream, remoteStreams } = useWebRTCConnection({
    room,
    socket,
    onRemoteStream: (socketId, stream) => {
      // Set up status tracking for this new stream
      updateRemoteStreamStatus(socketId, stream);
      forceUpdate(n => n + 1);
    },
    onUserLeft: (socketId) => {
      // Clean up status when user leaves
      setRemoteUserStatus(prev => {
        const newStatus = {...prev};
        delete newStatus[socketId];
        return newStatus;
      });
      
      // Clean up track listeners
      if (trackListenersRef.current[socketId]) {
        delete trackListenersRef.current[socketId];
      }
      
      forceUpdate(n => n + 1);
    }
  });

  // Function to update remote stream status
  const updateRemoteStreamStatus = (socketId, stream) => {
    // First check audio tracks
    const audioTracks = stream.getAudioTracks();
    const audioEnabled = audioTracks.length > 0 && audioTracks[0].enabled;
    
    // Then check video tracks
    const videoTracks = stream.getVideoTracks();
    const videoEnabled = videoTracks.length > 0 && videoTracks[0].enabled;
    
    // Update the status
    setRemoteUserStatus(prev => ({
      ...prev,
      [socketId]: { audioEnabled, videoEnabled }
    }));
  };

  // Set up track change listeners for remote streams
  useEffect(() => {
    // Function to set up listeners for a single stream
    const setupTrackListeners = (socketId, stream) => {
      // Skip if we already have listeners for this stream
      if (trackListenersRef.current[socketId]) {
        return;
      }
      
      // Create a new entry for this socket
      trackListenersRef.current[socketId] = { audioListeners: [], videoListeners: [] };
      
      // Add listeners for audio tracks
      stream.getAudioTracks().forEach(track => {
        const onTrackEnabledChange = () => {
          console.log(`Remote audio track for ${socketId} changed: ${track.enabled}`);
          setRemoteUserStatus(prev => ({
            ...prev,
            [socketId]: { 
              ...prev[socketId], 
              audioEnabled: track.enabled 
            }
          }));
        };
        
        // WebRTC doesn't have direct events for enabled/disabled, so we need to poll
        const interval = setInterval(() => {
          setRemoteUserStatus(prev => {
            if (!prev[socketId] || prev[socketId].audioEnabled !== track.enabled) {
              console.log(`Detected audio change for ${socketId}: ${track.enabled}`);
              return {
                ...prev,
                [socketId]: { 
                  ...prev[socketId] || {}, 
                  audioEnabled: track.enabled 
                }
              };
            }
            return prev;
          });
        }, 500);
        
        // Save the interval ID so we can clear it later
        trackListenersRef.current[socketId].audioListeners.push(interval);
      });
      
      // Add listeners for video tracks
      stream.getVideoTracks().forEach(track => {
        const onTrackEnabledChange = () => {
          console.log(`Remote video track for ${socketId} changed: ${track.enabled}`);
          setRemoteUserStatus(prev => ({
            ...prev, 
            [socketId]: { 
              ...prev[socketId], 
              videoEnabled: track.enabled 
            }
          }));
        };
        
        // WebRTC doesn't have direct events for enabled/disabled, so we need to poll
        const interval = setInterval(() => {
          setRemoteUserStatus(prev => {
            if (!prev[socketId] || prev[socketId].videoEnabled !== track.enabled) {
              console.log(`Detected video change for ${socketId}: ${track.enabled}`);
              return {
                ...prev,
                [socketId]: { 
                  ...prev[socketId] || {}, 
                  videoEnabled: track.enabled 
                }
              };
            }
            return prev;
          });
        }, 500);
        
        // Save the interval ID so we can clear it later
        trackListenersRef.current[socketId].videoListeners.push(interval);
      });
    };
    
    // Set up listeners for all streams
    Object.entries(remoteStreams).forEach(([socketId, stream]) => {
      setupTrackListeners(socketId, stream);
    });
    
    // Cleanup function
    return () => {
      // Clear all polling intervals
      Object.entries(trackListenersRef.current).forEach(([socketId, listeners]) => {
        listeners.audioListeners.forEach(interval => clearInterval(interval));
        listeners.videoListeners.forEach(interval => clearInterval(interval));
      });
      trackListenersRef.current = {};
    };
  }, [remoteStreams]);

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
      // Use custom notification instead of alert
      addNotification("The host has ended the meeting", "warning");
      
      // Force stop all tracks before leaving
        if (localStream) {
        localStream.getTracks().forEach(track => {
          try {
            // First disable the track
            track.enabled = false;
            // Then stop it
            track.stop();
            console.log(`Stopped ${track.kind} track from meeting-ended handler`);
          } catch (e) {
            console.error(`Error stopping ${track.kind} track:`, e);
          }
        });
      }
      
      // Reset video element srcObject to null
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      
      // Slight delay to let notification be visible
      setTimeout(() => {
        if (onLeave) onLeave();
      }, 1500);
    };
    
    socket.on('meeting-ended', handleMeetingEnded);
    return () => {
      socket.off('meeting-ended', handleMeetingEnded);
    };
  }, [socket, onLeave, localStream, addNotification]);

  // Ensure proper cleanup of media tracks
  useEffect(() => {
    return () => {
      // Clean up all media tracks when component unmounts
      if (localStream) {
        localStream.getTracks().forEach(track => {
          try {
            // First disable the track
            track.enabled = false;
            // Then stop it
            track.stop();
            console.log(`Stopped ${track.kind} track from cleanup effect`);
          } catch (e) {
            console.error(`Error stopping ${track.kind} track:`, e);
          }
        });
      }
      
      // Reset video element srcObject to null
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    };
  }, [localStream]);

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
    const newMutedState = !muted;
    console.log("Toggling local mute state to:", newMutedState);
    
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !newMutedState;
      console.log(`Local audio track enabled: ${track.enabled}`);
    });
    setMuted(newMutedState);
    
    // Try to notify others about status change
    try {
      socket.emit("media-status-change", { 
        roomId: room, 
        senderId: socket.id,
        audioEnabled: !newMutedState, 
        videoEnabled: cameraOn 
      });
      console.log("Sent media-status-change event for audio:", !newMutedState);
    } catch (e) {
      console.warn("Could not emit media status change event", e);
    }
  }

  function toggleCamera() {
    if (!localStream) return;
    const newCameraState = !cameraOn;
    console.log("Toggling local camera state to:", newCameraState);
    
    localStream.getVideoTracks().forEach(track => {
      track.enabled = newCameraState;
      console.log(`Local video track enabled: ${track.enabled}`);
    });
    setCameraOn(newCameraState);
    
    // Try to notify others about status change
    try {
      socket.emit("media-status-change", { 
        roomId: room, 
        senderId: socket.id,
        audioEnabled: !muted, 
        videoEnabled: newCameraState 
      });
      console.log("Sent media-status-change event for video:", newCameraState);
    } catch (e) {
      console.warn("Could not emit media status change event", e);
    }
  }

  // Handle media status changes from remote users (if server implements it)
  useEffect(() => {
    if (!socket) return;
    
    const handleMediaStatusChange = ({ senderId, audioEnabled, videoEnabled }) => {
      console.log(`Received media-status-change from ${senderId}:`, { audioEnabled, videoEnabled });
      
      // If we have a stream for this sender, try to manually update its tracks
      if (remoteStreams[senderId]) {
        const stream = remoteStreams[senderId];
        
        try {
          // Update audio tracks
          stream.getAudioTracks().forEach(track => {
            if (track.enabled !== audioEnabled) {
              console.log(`Updating remote audio track for ${senderId} to ${audioEnabled}`);
              track.enabled = audioEnabled;
            }
          });
          
          // Update video tracks
          stream.getVideoTracks().forEach(track => {
            if (track.enabled !== videoEnabled) {
              console.log(`Updating remote video track for ${senderId} to ${videoEnabled}`);
              track.enabled = videoEnabled;
            }
          });
        } catch (e) {
          console.error("Error updating remote tracks:", e);
        }
      }
      
      // Force update to re-render components
      forceUpdate(n => n + 1);
    };
    
    socket.on("media-status-change", handleMediaStatusChange);
    return () => {
      socket.off("media-status-change", handleMediaStatusChange);
    };
  }, [socket, remoteStreams]);

  function leaveCall() {
    // Stop all media tracks before leaving
    if (localStream) {
      localStream.getTracks().forEach(track => {
        try {
          // First disable the track
          track.enabled = false;
          // Then stop it
          track.stop();
          console.log(`Stopped ${track.kind} track from leaveCall`);
        } catch (e) {
          console.error(`Error stopping ${track.kind} track:`, e);
        }
      });
    }
    
    // Reset video element srcObject to null
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    
    if (onLeave) onLeave();
    else window.location.reload();
  }

  // Remote Video Component
  function RemoteVideo({ stream, id }) {
    const videoRef = useRef(null);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);
    
    // Setup polling to check track status
    useEffect(() => {
      if (!stream) return;
      
      const checkTrackStatus = () => {
        // Check audio tracks
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          const currentAudioEnabled = audioTracks[0].enabled;
          if (currentAudioEnabled !== audioEnabled) {
            console.log(`Remote audio track for ${id} changed to:`, currentAudioEnabled);
            setAudioEnabled(currentAudioEnabled);
          }
        }
        
        // Check video tracks
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          const currentVideoEnabled = videoTracks[0].enabled;
          if (currentVideoEnabled !== videoEnabled) {
            console.log(`Remote video track for ${id} changed to:`, currentVideoEnabled);
            setVideoEnabled(currentVideoEnabled);
          }
        }
      };
      
      // Set source on video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      // Initial check right away
      checkTrackStatus();
      
      // Then poll frequently (200ms)
      const intervalId = setInterval(checkTrackStatus, 200);
      
      return () => {
        clearInterval(intervalId);
      };
    }, [stream, id, audioEnabled, videoEnabled]);
    
    return (
      <div className="relative rounded-2xl overflow-hidden shadow-lg aspect-video flex items-center justify-center border-2 border-indigo-600/50 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover bg-black transition-all duration-300"
          style={{filter: videoEnabled ? 'none' : 'grayscale(1) brightness(0.4)'}}
        />
        {/* Status indicators in top right corner */}
        <div className="absolute top-3 right-3 flex gap-2 z-10">
          <div className={`p-2 rounded-full ${audioEnabled ? 'bg-green-500' : 'bg-red-500'} transition-colors duration-300 flex items-center justify-center`}>
            {audioEnabled ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            )}
          </div>
          <div className={`p-2 rounded-full ${videoEnabled ? 'bg-green-500' : 'bg-red-500'} transition-colors duration-300 flex items-center justify-center`}>
            {videoEnabled ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z"></path>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
            )}
          </div>
        </div>
        <span className="absolute bottom-3 left-3 px-3 py-1 bg-indigo-600/80 text-white text-xs rounded-full font-bold shadow-lg">{id.slice(-5)}</span>
        {!videoEnabled && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="p-4 bg-black/70 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-14 w-14 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Define participant list component
  function ParticipantsList() {
    // Combine local user with remote participants
    const participants = [
      { id: socket.id, isLocal: true }
    ];
    
    // Add remote participants
    Object.keys(remoteStreams).forEach(id => {
      participants.push({ id, isLocal: false });
    });
    
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <h3 className="font-medium text-lg text-gray-800 mb-4">
          Participants ({Object.keys(remoteStreams).length + 1})
        </h3>
        
        {/* Participant list */}
        <div className="space-y-3">
          {/* Local participant */}
          <div className="p-4 rounded-xl bg-white border border-indigo-600/20 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">
                You
              </div>
              <div>
                <p className="font-medium text-gray-800">You (Host)</p>
                <p className="text-xs text-gray-600">Local participant</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`p-1.5 rounded-full ${!muted ? 'bg-green-500' : 'bg-red-500'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </span>
              <span className={`p-1.5 rounded-full ${cameraOn ? 'bg-green-500' : 'bg-red-500'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
                </svg>
              </span>
            </div>
          </div>
          
          {/* Remote participants */}
          {participants.map((participant) => {
            let status;
            
            if (participant.isLocal) {
              // For local participant, use local state
              status = { audioEnabled: !muted, videoEnabled: cameraOn };
            } else {
              // For remote participants, check the stream directly if status tracking isn't available
              const stream = remoteStreams[participant.id];
              const defaultAudioEnabled = stream?.getAudioTracks().length > 0 && 
                                          stream?.getAudioTracks()[0].enabled;
              const defaultVideoEnabled = stream?.getVideoTracks().length > 0 && 
                                          stream?.getVideoTracks()[0].enabled;
              
              // Use status from our tracking system, or fall back to direct stream status
              status = remoteUserStatus[participant.id] || {
                audioEnabled: defaultAudioEnabled,
                videoEnabled: defaultVideoEnabled
              };
            }
            
            return (
              <div key={participant.id} className="p-4 rounded-xl bg-white border border-indigo-600/20 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">
                    {participant.isLocal ? "You" : participant.id.slice(-2)}
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">
                      {participant.isLocal ? "You" : `User ${participant.id.slice(-5)}`}
                    </p>
                    <p className="text-xs text-gray-600">
                      {participant.isLocal ? "(Host)" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`p-1.5 rounded-full ${status.audioEnabled ? 'bg-green-500' : 'bg-red-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </span>
                  <span className={`p-1.5 rounded-full ${status.videoEnabled ? 'bg-green-500' : 'bg-red-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
                    </svg>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // UI with 70/30 split
  return (
    <div className="flex flex-col h-screen w-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 text-white overflow-hidden">
      {/* Single Header */}
      <div className="p-4 flex items-center justify-between bg-[rgb(30_41_59/80%)] backdrop-blur-md border-b border-indigo-600/20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-lg border border-indigo-600/20">
            <span className="text-indigo-200 text-sm">Meeting ID:</span>
            <span className="text-white font-medium">{room}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(room);
                addNotification("Meeting ID copied to clipboard", "success");
              }}
              className="p-1.5 rounded-full hover:bg-indigo-600/50 transition-colors"
              title="Copy Meeting ID"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Network Status Indicator */}
          <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-lg border border-indigo-600/20">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
            </div>
            <span className="text-green-400 text-sm font-medium">Good</span>
          </div>
          
          {/* Participants Count */}
          <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-lg border border-indigo-600/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span className="text-indigo-200 text-sm">Participants:</span>
            <span className="text-white font-medium">{Object.keys(remoteStreams).length + 1}</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main Video Area (70%) */}
        <div className="w-[70%] h-full flex flex-col relative">
          {/* Remote videos container */}
          <div className="h-[calc(100%-12rem)] p-4 pt-4 flex items-center justify-center">
            <div className={`grid ${Object.keys(remoteStreams).length <= 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-4 w-full max-w-6xl h-full`}>
              {Object.entries(remoteStreams).map(([id, stream]) => (
                <div key={id} className="h-full">
                  <RemoteVideo stream={stream} id={id} />
                </div>
              ))}
              {Object.keys(remoteStreams).length === 0 && (
                <div className="flex flex-col items-center justify-center h-full bg-black/20 rounded-2xl border-2 border-dashed border-indigo-600/30">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-indigo-500/50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                  </svg>
                  <p className="text-indigo-300 text-lg">Waiting for others to join...</p>
                  <p className="text-indigo-300/70 text-sm mt-2">Share your room code to invite others</p>
                </div>
              )}
            </div>
          </div>

          {/* Local Video PIP */}
          <div className="absolute bottom-24 right-4 w-64 h-36 rounded-2xl overflow-hidden shadow-lg border-2 border-indigo-600/50 bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>

          {/* Controls */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-black/20 px-6 py-3 rounded-xl border border-indigo-600/20 backdrop-blur-sm">
            <button
              onClick={toggleMute}
              className={`p-3 rounded-full transition-colors ${
                muted ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
              title={muted ? "Unmute" : "Mute"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
          </button>
            <button
              onClick={toggleCamera}
              className={`p-3 rounded-full transition-colors ${
                !cameraOn ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
              title={cameraOn ? "Turn off camera" : "Turn on camera"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
              </svg>
          </button>
            <button
              onClick={leaveCall}
              className="p-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors"
              title="Leave call"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 17l-4-4m0 0l-4 4m4-4V3" />
              </svg>
          </button>
        </div>
      </div>

        {/* Sidebar (30%) */}
        <div className="w-[30%] h-full flex flex-col relative">
          <div className="absolute inset-0 bg-[rgb(244_244_244/80%)] backdrop-blur-md shadow-inner m-4 rounded-2xl flex flex-col">
            {/* Sidebar Tabs */}
            <div className="flex p-3 gap-2 rounded-t-2xl bg-[rgb(244_244_244/80%)]">
              <button 
                onClick={() => setActiveTab("chat")}
                className={`flex-1 py-3 px-4 font-medium text-center transition-all duration-200 rounded-xl ${
                  activeTab === "chat" 
                    ? 'bg-indigo-600 text-white shadow-md' 
                    : 'text-gray-800 bg-white hover:bg-gray-100 border border-indigo-600/50'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                  {chatMessages.length > 0 && 
                    <span className="ml-1 px-2 py-0.5 bg-indigo-600 text-white text-xs rounded-full font-bold shadow-sm">
                      {chatMessages.length}
                    </span>
                  }
                </div>
              </button>
              <button 
                onClick={() => setActiveTab("participants")}
                className={`flex-1 py-3 px-4 font-medium text-center transition-all duration-200 rounded-xl ${
                  activeTab === "participants" 
                    ? 'bg-indigo-600 text-white shadow-md' 
                    : 'text-gray-800 bg-white hover:bg-gray-100 border border-indigo-600/50'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Participants
                  <span className="ml-1 px-2 py-0.5 bg-indigo-600 text-white text-xs rounded-full font-bold shadow-sm">
                    {Object.keys(remoteStreams).length + 1}
              </span>
                </div>
              </button>
            </div>
            
            {/* Separator Line */}
            <div className="border-b border-gray-300/50"></div>
            
            {/* Tab Content */}
            <div className="flex-1 flex flex-col overflow-hidden p-4">
              {activeTab === "chat" ? (
                <>
                  {/* Chat Messages */}
                  <div className="flex-1 overflow-y-auto space-y-3">
                    {chatMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <p className="text-gray-800 font-medium">No messages yet</p>
                        <p className="text-gray-600 text-sm mt-2">Start the conversation!</p>
                      </div>
                    ) : (
                      chatMessages.map((msg, idx) => (
                        <div key={idx} className={`${msg.sender === socket.id ? "text-right ml-12" : "text-left mr-12"} animate-fade-in`}>
                          <div className={`inline-block px-4 py-2.5 rounded-2xl shadow-sm text-sm ${
                            msg.sender === socket.id 
                              ? 'bg-indigo-600 text-white' 
                              : 'bg-white text-gray-800'
                          }`}>
                            <div className="font-semibold mb-1">
                              {msg.sender === socket.id ? "You" : `User ${msg.sender.slice(-5)}`}
                            </div>
                            <div>{msg.message}</div>
                          </div>
                        </div>
                      ))
                    )}
        </div>
                  
                  {/* Chat Input */}
                  <form onSubmit={sendChat} className="mt-4">
                    <div className="flex rounded-xl shadow-sm overflow-hidden bg-white border border-gray-300 focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-indigo-400">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="Type a message..."
                        className="flex-1 px-4 py-3 outline-none text-gray-800 placeholder-gray-400 bg-transparent"
                      />
                      <button 
                        type="submit" 
                        className="bg-indigo-600 text-white px-5 flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:bg-indigo-400"
                        disabled={!chatInput.trim()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13"></line>
                          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                      </button>
                    </div>
        </form>
                </>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <h3 className="font-medium text-lg text-gray-800 mb-4">
                    Participants ({Object.keys(remoteStreams).length + 1})
                  </h3>
                  
                  {/* Participant list */}
                  <div className="space-y-3">
                    {/* Local participant */}
                    <div className="p-4 rounded-xl bg-white border border-indigo-600/20 shadow-sm flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">
                          You
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">You (Host)</p>
                          <p className="text-xs text-gray-600">Local participant</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`p-1.5 rounded-full ${!muted ? 'bg-green-500' : 'bg-red-500'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        </span>
                        <span className={`p-1.5 rounded-full ${cameraOn ? 'bg-green-500' : 'bg-red-500'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    
                    {/* Remote participants */}
                    {Object.entries(remoteStreams).map(([id, stream]) => (
                      <div key={id} className="p-4 rounded-xl bg-white border border-indigo-600/20 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">
                            {id.slice(-2)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800">User {id.slice(-5)}</p>
                            <p className="text-xs text-gray-600">Remote participant</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`p-1.5 rounded-full ${remoteUserStatus[id]?.audioEnabled ? 'bg-green-500' : 'bg-red-500'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                          </span>
                          <span className={`p-1.5 rounded-full ${remoteUserStatus[id]?.videoEnabled ? 'bg-green-500' : 'bg-red-500'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
