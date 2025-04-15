import { useEffect, useRef, useState } from 'react';

interface ConnectionProps {
  room: string;
  socket: any;
  onRemoteStream: (socketId: string, stream: MediaStream) => void;
  onUserLeft: (socketId: string) => void;
}

const ICE_SERVERS = [
  // Google STUN servers
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  
  // Free TURN servers
  {
    urls: [
      "turn:a.relay.metered.ca:80",
      "turn:a.relay.metered.ca:80?transport=tcp",
      "turn:a.relay.metered.ca:443",
      "turn:a.relay.metered.ca:443?transport=tcp"
    ],
    username: "free", // Free TURN server credentials
    credential: "free"
  },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:80?transport=tcp",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp"
    ],
    username: "openrelayproject",
    credential: "openrelayproject"
  }
];

export const useWebRTCConnection = ({ room, socket, onRemoteStream, onUserLeft }: ConnectionProps) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const peersRef = useRef<{ [key: string]: RTCPeerConnection }>({});
  const remoteStreamsRef = useRef<{ [key: string]: MediaStream }>({});
  const candidateQueueRef = useRef<{ [key: string]: RTCIceCandidate[] }>({});
  const [, forceUpdate] = useState(0);

  // Helper: Add remote stream
  function addRemoteStream(socketId: string, stream: MediaStream) {
    if (!stream) {
      console.warn("Attempted to add remote stream for", socketId, "but stream is undefined/null");
      return;
    }
    remoteStreamsRef.current[socketId] = stream;
    forceUpdate(n => n + 1); // Force re-render
    console.log("Added remote stream for", socketId, stream);
  }

  // --- 1. Acquire Local Stream FIRST ---
  useEffect(() => {
    let isMounted = true;
    async function getStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (isMounted) {
          setLocalStream(stream);
        }
      } catch (err) {
        console.error('Could not access camera/mic:', err);
      }
    }
    getStream();
    return () => { isMounted = false; };
  }, []);

  // --- 2. Register Handlers & Join Room ONLY after localStream is set ---
  useEffect(() => {
    if (!socket || !room || !localStream) return;
    let joined = false;
    const cleanupHandlers: (() => void)[] = [];

    // Listen for meeting-ended event
    const handleMeetingEnded = () => {
      // Stop all tracks before we're notified through the VideoCall component
      if (localStream) {
        localStream.getTracks().forEach(track => {
          try {
            track.stop();
            console.log(`Stopped ${track.kind} track from connection utility`);
          } catch (e) {
            console.error(`Error stopping ${track.kind} track:`, e);
          }
        });
      }
      
      // Close all peer connections
      Object.values(peersRef.current).forEach(pc => {
        try {
          pc.close();
        } catch (e) {
          console.error("Error closing peer connection:", e);
        }
      });
    };
    socket.on('meeting-ended', handleMeetingEnded);
    cleanupHandlers.push(() => socket.off('meeting-ended', handleMeetingEnded));

    const handleUserJoined = async (socketId: string) => {
      if (!localStream) {
        console.warn('handleUserJoined called but localStream not ready, waiting...');
        return;
      }
      console.log('User joined:', socketId);
      if (peersRef.current[socketId]) return; // Already connected
      const pc = createPeerConnection(socketId);
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      console.log('Added local tracks for new peer connection with', socketId);
      peersRef.current[socketId] = pc;
      // Create an offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('Created and set local description (offer) for', socketId);
      socket.emit("signal", {
        roomId: room,
        data: { type: "offer", offer, to: socketId }
      });
      console.log('Sent offer to', socketId);
    };

    const handleSignal = async ({ sender, data }: { sender: string, data: any }) => {
      if (!localStream) {
        console.warn('handleSignal called but localStream not ready, waiting...');
        return;
      }
      console.log("handleSignal called", sender, data);
      console.log('Received signal from', sender, data);
      if (data.to && data.to !== socket.id) return; // Not for me
      let pc = peersRef.current[sender];
      if (!pc) {
        pc = createPeerConnection(sender);
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        console.log('Added local tracks for new peer connection with', sender);
        peersRef.current[sender] = pc;
      }
      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log('Set remote description (offer) from', sender);
        // Ensure local tracks are added (even if pc existed before)
        const senders = pc.getSenders().map(s => s.track);
        localStream.getTracks().forEach(track => {
          if (!senders.includes(track)) {
            pc.addTrack(track, localStream);
            console.log('Defensively added missing local track on offer', track);
          }
        });
        // Process any queued ICE candidates
        if (candidateQueueRef.current[sender] && candidateQueueRef.current[sender].length > 0) {
          console.log(`Processing ${candidateQueueRef.current[sender].length} queued ICE candidates for`, sender);
          for (const candidate of candidateQueueRef.current[sender]) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              console.log('Added queued ICE candidate for', sender);
            } catch (e) {
              console.warn('Error adding queued ICE candidate for', sender, e);
            }
          }
          candidateQueueRef.current[sender] = [];
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('Created and set local description (answer) for', sender);
        socket.emit("signal", {
          roomId: room,
          data: { type: "answer", answer, to: sender }
        });
        console.log('Sent answer to', sender);
      } else if (data.type === "answer") {
        // Defensive: Ensure local tracks are present (offerer side)
        const senders = pc.getSenders().map(s => s.track);
        localStream.getTracks().forEach(track => {
          if (!senders.includes(track)) {
            pc.addTrack(track, localStream);
            console.log('Defensively added missing local track on answer', track);
          }
        });
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('Set remote description (answer) from', sender);
        // Process any queued ICE candidates
        if (candidateQueueRef.current[sender] && candidateQueueRef.current[sender].length > 0) {
          console.log(`Processing ${candidateQueueRef.current[sender].length} queued ICE candidates for`, sender);
          for (const candidate of candidateQueueRef.current[sender]) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              console.log('Added queued ICE candidate for', sender);
            } catch (e) {
              console.warn('Error adding queued ICE candidate for', sender, e);
            }
          }
          candidateQueueRef.current[sender] = [];
        }
      } else if (data.type === "candidate") {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('Added ICE candidate from', sender);
          } catch (e) { console.warn('ICE candidate error', e); }
        } else {
          // Queue the candidate until remote description is set
          if (!candidateQueueRef.current[sender]) candidateQueueRef.current[sender] = [];
          candidateQueueRef.current[sender].push(data.candidate);
          console.log('Queued ICE candidate from', sender);
        }
      }
    };

    const handleUserLeft = (socketId: string) => {
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
        delete remoteStreamsRef.current[socketId];
        forceUpdate(n => n + 1);
        console.log('User left:', socketId);
      }
    };

    socket.on("user-joined", handleUserJoined);
    socket.on("signal", handleSignal);
    socket.on("user-left", handleUserLeft);
    cleanupHandlers.push(
      () => socket.off("user-joined", handleUserJoined),
      () => socket.off("signal", handleSignal),
      () => socket.off("user-left", handleUserLeft)
    );

    // Only after handlers and stream are ready, join the room
    if (!joined) {
      socket.emit("join-room", room);
      joined = true;
    }

    // --- Handle all-users event ---
    socket.on("all-users", (users: string[]) => {
      console.log('Received all-users:', users);
      users.forEach(async (socketId) => {
        await handleUserJoined(socketId);
      });
    });

    return () => {
      cleanupHandlers.forEach(fn => fn());
      socket.off("all-users");
    };
  }, [socket, room, localStream]);

  // --- Helper: Create Peer Connection ---
  function createPeerConnection(socketId: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", {
          roomId: room,
          data: { type: "candidate", candidate: event.candidate, to: socketId }
        });
        console.log('Sent ICE candidate to', socketId);
      }
    };

    pc.ontrack = (event) => {
      console.log('Received ontrack event from', socketId, event);
      if (!event.streams || !event.streams[0]) {
        console.warn('ontrack fired but no stream present for', socketId, event);
        return;
      }
      addRemoteStream(socketId, event.streams[0]);
      console.log('Received remote track from', socketId, event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      console.log('Peer connection state with', socketId, ':', pc.connectionState);
    };

    return pc;
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(peersRef.current).forEach(pc => pc.close());
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    localStream,
    remoteStreams: remoteStreamsRef.current
  };
}; 