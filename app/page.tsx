"use client";

import Swal from "sweetalert2";
import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import { join, leave, poll, sendSignal } from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const REQUEST_TIMEOUT_MS = 30_000;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [sessionSecret] = useState(() => crypto.randomUUID());
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const incomingFilesRef = useRef<Record<string, { name: string; size: number; mimeType: string; chunks: string[] }>>({});

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRingerRef = useRef<(() => void) | null>(null);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function teardown(message?: string) {
    stopRinging();
    if (requestTimer.current) clearTimeout(requestTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  // Graceful error handling for UNAUTHORIZED
  const handleAuthError = (e: any) => {
    if (e.message === "UNAUTHORIZED") {
      Swal.fire({
        title: "Session Expired",
        text: "Your session was disconnected due to unauthorized activity. The page will now reload.",
        icon: "error",
        background: "#111",
        color: "#fff",
        confirmButtonColor: "#3b82f6",
      }).then(() => {
        window.location.reload();
      });
    }
  };

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        sendSignal(sessionId, sessionSecret, peerId, type, payload).catch(handleAuthError);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") {
          teardown("Connection failed (network).");
        }
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
      onFileMeta: (fileId, name, size, mimeType) => {
        incomingFilesRef.current[fileId] = { name, size, mimeType, chunks: [] };
        
        // Add a system announcement message into chat
        setMessages((prev) => [
          ...prev,
          { id: msgId.current++, mine: false, text: `📁 Incoming file: ${name} (${(size / 1024 / 1024).toFixed(2)} MB)...`, fileId, isIncoming: true }
        ]);
      },
      onFileChunk: (fileId, chunkIndex, data) => {
        const file = incomingFilesRef.current[fileId];
        if (file) {
          file.chunks[chunkIndex] = data;
        }
      },
      onFileEnd: (fileId) => {
        const file = incomingFilesRef.current[fileId];
        if (!file) return;

        // Reconstitute Base64 chunks back to binary file blob
        const binaryStrings = file.chunks.map(chunk => atob(chunk));
        const byteArrays = binaryStrings.map(str => {
          const arr = new Uint8Array(str.length);
          for (let i = 0; i < str.length; i++) {
            arr[i] = str.charCodeAt(i);
          }
          return arr;
        });
        const blob = new Blob(byteArrays, { type: file.mimeType });
        const downloadUrl = URL.createObjectURL(blob);



        // Replace the incoming file system announcement with the download card
        setMessages((prev) =>
          prev.map((msg) =>
            msg.fileId === fileId
              ? { ...msg, text: `📁 File ready: ${file.name}`, downloadUrl, isImage: file.mimeType.startsWith("image/") }
              : msg
          )
        );
      },
      onFileCancel: (fileId) => {
        delete incomingFilesRef.current[fileId];

        setMessages((prev) =>
          prev.map((msg) =>
            msg.fileId === fileId ? { ...msg, text: "❌ File transfer canceled by sender." } : msg
          )
        );
      }
    });
    peerRef.current = ps;
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") {
          startRinging();
          setVideo("incoming");
        }
        break;
      case "video-accept":
        stopRinging();
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        stopRinging();
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        stopRinging();
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    sendSignal(sessionId, sessionSecret, peerId, "request").catch(handleAuthError);
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        sendSignal(sessionId, sessionSecret, peerId, "end").catch(() => {});
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      sendSignal(sessionId, sessionSecret, connRef.current.peerId, "end").catch(() => {});
    }
    teardown();
  }

  function acceptIncoming() {
    stopRinging();
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    sendSignal(sessionId, sessionSecret, peerId, "accept").catch(handleAuthError);
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    stopRinging();
    if (connRef.current.kind !== "incoming") return;
    sendSignal(sessionId, sessionSecret, connRef.current.peerId, "decline").catch(() => {});
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      sendSignal(sessionId, sessionSecret, c.peerId, "end").catch(() => {});
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    stopRinging();
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    stopRinging();
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function sendFile(file: File) {
    if (!peerRef.current) return;
    const fileId = crypto.randomUUID();


    // Add upload card inside sender's chat messages state
    setMessages((prev) => [
      ...prev,
      { id: msgId.current++, mine: true, text: `📁 Sending ${file.name}...`, fileId, isOutgoing: true }
    ]);

    peerRef.current.sendFile(file, fileId, (sentBytes) => {
      const progress = Math.round((sentBytes / file.size) * 100);

      // Dynamically update the upload percentage text
      setMessages((prev) =>
        prev.map((msg) =>
          msg.fileId === fileId
            ? { 
                ...msg, 
                text: progress === 100 ? `✅ File sent: ${file.name}` : `📁 Sending ${file.name}: ${progress}%`,
                isOutgoing: progress !== 100 
              }
            : msg
        )
      );
    });
  }

  function cancelFileSend(fileId: string) {
    peerRef.current?.cancelFileSend(fileId);

    setMessages((prev) =>
      prev.map((msg) =>
        msg.fileId === fileId ? { ...msg, text: "❌ File transfer canceled." } : msg
      )
    );
  }

  function startRinging() {
    if (activeRingerRef.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      let active = true;
      let timeoutId: any;
      let currentGain: GainNode | null = null;
      let currentOsc: OscillatorNode | null = null;

      function playRing() {
        if (!active) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
        
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.0);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 1.0);
        
        currentOsc = osc;
        currentGain = gain;
        
        timeoutId = setTimeout(playRing, 2000); // Repeat every 2 seconds
      }
      
      playRing();

      activeRingerRef.current = () => {
        active = false;
        clearTimeout(timeoutId);
        if (currentGain) {
          // Smoothly ramp down volume to avoid popping
          currentGain.gain.cancelScheduledValues(ctx.currentTime);
          currentGain.gain.setValueAtTime(currentGain.gain.value, ctx.currentTime);
          currentGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
        }
        if (currentOsc) {
          currentOsc.stop(ctx.currentTime + 0.1);
        }
        setTimeout(() => ctx.close(), 200);
      };
    } catch (err) {
      console.warn("Could not play ringer:", err);
    }
  }

  function stopRinging() {
    if (activeRingerRef.current) {
      activeRingerRef.current();
      activeRingerRef.current = null;
    }
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          startRinging();
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          sendSignal(sessionId, sessionSecret, sig.fromId, "decline").catch(() => {});
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  useEffect(() => {
    if (phase !== "live" || !sessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionId, sessionSecret);
        if (!active) return;
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);
      } catch (e: any) {
        if (e.message === "UNAUTHORIZED") {
          active = false;
          handleAuthError(e);
          return;
        }
      }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId]);

  useEffect(() => {
    if (!sessionId || !sessionSecret || phase !== "live") return;
    const onLeave = () => leave(sessionId, sessionSecret);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, phase]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    await join(sessionId, sessionSecret, lat, lng);
    setPhase("live");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle"}
      />

      {notice && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-zinc-800/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur">
          {notice}
        </div>
      )}

      {conn.kind === "requesting" && (
        <div className="absolute left-1/2 top-20 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-800/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur">
          <span>Requesting connection…</span>
          <button
            onClick={cancelRequest}
            className="rounded-full bg-zinc-700 px-3 py-1 text-xs hover:bg-zinc-600"
          >
            Cancel
          </button>
        </div>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A stranger wants to connect"
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
          onSendFile={sendFile}
          onCancelFile={cancelFileSend}
        />
      )}

      {video === "requesting" && (
        <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-zinc-800/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur">
          Waiting for stranger to accept video…
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="The stranger wants to turn on video."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
