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
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" strokeDasharray="2 2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </div>
          <div className={`p-2 rounded-full ${videoEnabled ? 'bg-green-500' : 'bg-red-500'} transition-colors duration-300 flex items-center justify-center`}>
            {videoEnabled ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" strokeDasharray="2 2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </div>
        </div>
        <span className="absolute bottom-3 left-3 px-3 py-1 bg-indigo-600/80 text-white text-xs rounded-full font-bold shadow-lg">{id.slice(-5)}</span>
        {!videoEnabled && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="p-4 bg-black/70 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-14 w-14 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" strokeDasharray="2 2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
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
        <h3 className="text-lg font-semibold text-indigo-900 mb-4">Participants ({participants.length})</h3>
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
            <div key={participant.id} className="flex items-center justify-between p-3 rounded-lg bg-white/80 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">
                  {participant.isLocal ? "You" : participant.id.slice(-2)}
                </div>
                <div>
                  <p className="font-medium text-indigo-900">
                    {participant.isLocal ? "You" : `User ${participant.id.slice(-5)}`}
                  </p>
                  <p className="text-xs text-indigo-700 opacity-75">
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
    );
  }

  // UI with 70/30 split
  return (
    <div className="flex flex-row h-screen w-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 text-white overflow-hidden">
      {/* Main Video Area (70%) */}
      <div className="w-[70%] h-full flex flex-col relative">
        {/* Remote videos container */}
        <div className="flex-1 p-4 flex items-center justify-center">
          <div className={`grid ${Object.keys(remoteStreams).length <= 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-4 w-full max-w-6xl`}>
            {Object.entries(remoteStreams).map(([id, stream]) => (
              <RemoteVideo key={id} stream={stream} id={id} />
            ))}
            {Object.keys(remoteStreams).length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 bg-black/20 rounded-2xl border-2 border-dashed border-indigo-600/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-indigo-500/50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
                <p className="text-indigo-300 text-lg">Waiting for others to join...</p>
                <p className="text-indigo-300/70 text-sm mt-2">Share your room code to invite others</p>
              </div>
            )}
          </div>
        </div>

        {/* Controls Bar */}
        <div className="flex justify-center mb-6">
          <div className="flex gap-6 items-center bg-black/50 backdrop-blur-md rounded-xl p-3 shadow-xl">
            <button className={`flex items-center px-6 py-3 rounded-full shadow-lg text-lg font-semibold transition-all duration-300 ${muted ? 'bg-gray-500' : 'bg-blue-700 hover:bg-blue-800'}`} onClick={toggleMute} title="Mute/Unmute">
              {muted ? 
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" strokeDasharray="2 2" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
                :
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              }
            </button>
            <button className={`flex items-center px-6 py-3 rounded-full shadow-lg text-lg font-semibold transition-all duration-300 ${cameraOn ? 'bg-purple-700 hover:bg-purple-800' : 'bg-gray-500'}`} onClick={toggleCamera} title="Camera On/Off">
              {cameraOn ? 
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
                </svg>
                :
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 9v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2H7a2 2 0 00-2 2z" strokeDasharray="2 2" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              }
            </button>
            <button className="flex items-center px-6 py-3 rounded-full shadow-lg text-lg font-semibold transition-all duration-300 bg-red-600 hover:bg-red-700" onClick={leaveCall} title="Leave">
              <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='28' height='28'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M17 16l4-4m0 0l-4-4m4 4H7' />
              </svg>
              <span className="ml-2">Leave</span>
            </button>
          </div>
        </div>
        
        {/* Local Video PIP */}
        <div className="absolute bottom-20 right-5 w-[15%] max-w-[240px] min-w-[180px] z-10">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl aspect-video flex items-center justify-center border-2 border-indigo-600/80 bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover bg-black transition-all duration-300"
              style={{filter: cameraOn ? 'none' : 'grayscale(1) brightness(0.4)'}}
            />
            <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-indigo-600/80 text-white text-xs rounded-full font-bold shadow-lg">You</span>
            {!cameraOn && <span className="absolute inset-0 flex items-center justify-center text-5xl text-white/80">
              <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' width='48' height='48'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d='M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6v12a2 2 0 002 2h8a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2z' />
              </svg>
            </span>}
          </div>
        </div>
      </div>

      {/* Sidebar (30%) */}
      <div className="w-[30%] h-full bg-white/90 backdrop-blur-md border-l border-purple-200 flex flex-col">
        {/* Sidebar Tabs */}
        <div className="flex border-b border-purple-200">
          <button 
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-4 font-medium text-center transition-colors ${activeTab === "chat" ? 'bg-purple-100 text-purple-800 border-b-2 border-purple-600' : 'text-gray-600 hover:bg-purple-50'}`}
          >
            <div className="flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Chat
              {chatMessages.length > 0 && <span className="ml-1 px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full">{chatMessages.length}</span>}
            </div>
          </button>
          <button 
            onClick={() => setActiveTab("participants")}
            className={`flex-1 py-4 font-medium text-center transition-colors ${activeTab === "participants" ? 'bg-purple-100 text-purple-800 border-b-2 border-purple-600' : 'text-gray-600 hover:bg-purple-50'}`}
          >
            <div className="flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Participants
              <span className="ml-1 px-2 py-0.5 bg-indigo-600 text-white text-xs rounded-full">{Object.keys(remoteStreams).length + 1}</span>
            </div>
          </button>
        </div>
        
        {/* Tab Content */}
        {activeTab === "chat" ? (
          <>
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-indigo-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-indigo-800">No messages yet</p>
                  <p className="text-indigo-500 text-sm mt-2">Start the conversation!</p>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div key={idx} className={msg.sender === socket.id ? "text-right" : "text-left"}>
                    <span className="inline-block px-3 py-2 rounded-lg shadow text-sm" 
                      style={{
                        background: msg.sender === socket.id ? '#a5b4fc' : '#e0e7ff', 
                        color: '#3730a3'
                      }}
                    >
                      <b>{msg.sender === socket.id ? "You" : msg.sender.slice(-5)}</b>: {msg.message}
                    </span>
                  </div>
                ))
              )}
            </div>
            
            {/* Chat Input */}
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
          </>
        ) : (
          <ParticipantsList />
        )}
      </div>
    </div>
  );
}
