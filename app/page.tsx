"use client";

import Swal from "sweetalert2";
import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import { join, leave, poll, sendSignal } from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg } from "@/lib/types";
import { startConnectionRing, startVideoRing, stopRing, playMessageBell, playFeedback } from "@/lib/audio";
import { checkIsVideo, checkIsImage, getSafeMimeType, verifyMagicBytes } from "@/lib/file";

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

  const [chatCollapsed, _setChatCollapsed] = useState(false);
  const chatCollapsedRef = useRef(chatCollapsed);
  const setChatCollapsed = (val: boolean) => {
    chatCollapsedRef.current = val;
    _setChatCollapsed(val);
    if (!val) {
      setUnreadCount(0);
    }
  };
  const [unreadCount, setUnreadCount] = useState(0);

  const [activeImageId, setActiveImageId] = useState<number | null>(null);

  const viewableImages = messages.filter(
    (m) => m.downloadUrl && !m.isOutgoing && !m.isIncoming && m.isImage
  );

  const activeIndex = viewableImages.findIndex((m) => m.id === activeImageId);
  const activeImage = activeIndex !== -1 ? viewableImages[activeIndex] : null;

  const handleNext = () => {
    if (activeIndex < viewableImages.length - 1) {
      setActiveImageId(viewableImages[activeIndex + 1].id);
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setActiveImageId(viewableImages[activeIndex - 1].id);
    }
  };

  const handleClose = () => {
    setActiveImageId(null);
  };

  useEffect(() => {
    if (activeImageId === null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        if (activeIndex < viewableImages.length - 1) {
          setActiveImageId(viewableImages[activeIndex + 1].id);
        }
      } else if (e.key === "ArrowLeft") {
        if (activeIndex > 0) {
          setActiveImageId(viewableImages[activeIndex - 1].id);
        }
      } else if (e.key === "Escape") {
        setActiveImageId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeImageId, activeIndex, viewableImages]);

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    if (!mine) {
      playMessageBell();
      if (chatCollapsedRef.current) {
        setUnreadCount((c) => c + 1);
      }
    }
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function teardown(reason?: string) {
    if (reason && connRef.current.kind !== "idle") {
      showNotice(reason);
      playFeedback("disconnect");
    }
    stopRing();
    if (requestTimer.current) clearTimeout(requestTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    setChatCollapsed(false);
    setUnreadCount(0);
  }

  // Graceful error handling for UNAUTHORIZED
  const handleAuthError = (e: { message?: string }) => {
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
        playFeedback("success");
        setConn({ kind: "connected", peerId });
      },
      onFileMeta: (fileId, name, size, mimeType) => {
        incomingFilesRef.current[fileId] = { name, size, mimeType, chunks: [] };
        
        // Add a system announcement message into chat
        setMessages((prev) => [
          ...prev,
          { id: msgId.current++, mine: false, text: `Incoming file: ${name} (${(size / 1024 / 1024).toFixed(2)} MB)...`, fileId, isIncoming: true }
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

        const expectedChunks = Math.ceil(file.size / 16384);
        let hasMissing = false;
        for (let i = 0; i < expectedChunks; i++) {
          if (file.chunks[i] === undefined) {
            hasMissing = true;
            break;
          }
        }

        if (hasMissing) {
          console.error(`[WebRTC] File transfer incomplete. Expected ${expectedChunks} chunks, but received ${file.chunks.filter(Boolean).length}`);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.fileId === fileId
                ? { ...msg, text: "File transfer failed (incomplete chunks).", isIncoming: false }
                : msg
            )
          );
          return;
        }

        // Verify Magic Bytes for security (against polyglots / MIME spoofing)
        const firstChunk = file.chunks[0];
        if (firstChunk) {
          try {
            const decoded = atob(firstChunk);
            const headerBytes = new Uint8Array(Math.min(16, decoded.length));
            for (let i = 0; i < headerBytes.length; i++) {
              headerBytes[i] = decoded.charCodeAt(i);
            }
            const dotIdx = file.name.lastIndexOf(".");
            const ext = dotIdx !== -1 ? file.name.substring(dotIdx).toLowerCase() : "";
            if (!verifyMagicBytes(headerBytes, ext)) {
              console.error(`[WebRTC] File verification failed. Magic byte mismatch for extension: ${ext}`);
              delete incomingFilesRef.current[fileId];

              setMessages((prev) =>
                prev.map((msg) =>
                  msg.fileId === fileId
                    ? { ...msg, text: `File blocked (extension/content signature mismatch).`, isIncoming: false }
                    : msg
                )
              );

              Swal.fire({
                icon: "error",
                title: "Security Threat Blocked",
                text: "The incoming file's content signature does not match its extension.",
                background: "#18181b",
                color: "#f4f4f5",
                confirmButtonColor: "#3f3f46",
              });
              return;
            }
          } catch (err) {
            console.error("[WebRTC] Failed to verify magic bytes:", err);
          }
        }

        // Reconstitute Base64 chunks back to binary file blob
        const binaryStrings = file.chunks.map(chunk => atob(chunk));
        const byteArrays = binaryStrings.map(str => {
          const arr = new Uint8Array(str.length);
          for (let i = 0; i < str.length; i++) {
            arr[i] = str.charCodeAt(i);
          }
          return arr;
        });
        const safeMimeType = getSafeMimeType(file.name);
        const blob = new Blob(byteArrays, { type: safeMimeType });
        const downloadUrl = URL.createObjectURL(blob);

        // Replace the incoming file system announcement with the download card
        setMessages((prev) =>
          prev.map((msg) =>
            msg.fileId === fileId
              ? { 
                  ...msg, 
                  text: `File ready: ${file.name}`, 
                  downloadUrl, 
                  isImage: checkIsImage(file.name, safeMimeType),
                  isVideo: checkIsVideo(file.name, safeMimeType),
                  isIncoming: false
                }
              : msg
          )
        );
      },
      onFileCancel: (fileId) => {
        delete incomingFilesRef.current[fileId];

        setMessages((prev) =>
          prev.map((msg) =>
            msg.fileId === fileId ? { ...msg, text: "File transfer canceled by sender.", isIncoming: false } : msg
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
          startVideoRing();
          setVideo("incoming");
        }
        break;
      case "video-accept":
        stopRing();
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
        stopRing();
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        stopRing();
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        setChatCollapsed(false);
        setUnreadCount(0);
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
    stopRing();
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    sendSignal(sessionId, sessionSecret, peerId, "accept").catch(handleAuthError);
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    stopRing();
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
    stopRing();
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
    stopRing();
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
    setChatCollapsed(false);
    setUnreadCount(0);
  }

  function sendFile(file: File) {
    if (!peerRef.current) return;
    const fileId = crypto.randomUUID();

    // Sanitize MIME type based on extension mapping for outbound security
    const safeMimeType = getSafeMimeType(file.name);
    const sanitizedFile = file.type === safeMimeType ? file : new File([file], file.name, { type: safeMimeType });

    // Add upload card inside sender's chat messages state
    const downloadUrl = URL.createObjectURL(sanitizedFile);
    const isImage = checkIsImage(sanitizedFile.name, safeMimeType);
    const isVideo = checkIsVideo(sanitizedFile.name, safeMimeType);

    setMessages((prev) => [
      ...prev,
      { 
        id: msgId.current++, 
        mine: true, 
        text: `Sending ${sanitizedFile.name}...`, 
        fileId, 
        isOutgoing: true,
        downloadUrl,
        isImage,
        isVideo
      }
    ]);

    peerRef.current.sendFile(sanitizedFile, fileId, (sentBytes) => {
      const progress = Math.round((sentBytes / file.size) * 100);

      // Dynamically update the upload percentage text
      setMessages((prev) =>
        prev.map((msg) =>
          msg.fileId === fileId
            ? { 
                ...msg, 
                text: progress === 100 ? `File sent: ${file.name}` : `Sending ${file.name}: ${progress}%`,
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
        msg.fileId === fileId ? { ...msg, text: "File transfer canceled." } : msg
      )
    );
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          startConnectionRing();
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          sendSignal(sessionId, sessionSecret, sig.fromId, "decline", "busy").catch(() => {});
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
          if (sig.payload === "busy") {
            teardown("User is busy or connected with another user.");
          } else if (sig.payload === "offline") {
            teardown("User went offline.");
          } else {
            teardown("Request declined.");
          }
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
    let backoffMs = POLL_INTERVAL_MS;

    const tick = async () => {
      try {
        const data = await poll(sessionId, sessionSecret);
        if (!active) return;
        setPeers((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(data.peers)) return prev;
          return data.peers;
        });
        for (const s of data.signals) processSignalRef.current(s);
        // Reset backoff on successful query
        backoffMs = POLL_INTERVAL_MS;
      } catch (e) {
        const err = e as { message?: string };
        if (err.message === "UNAUTHORIZED") {
          active = false;
          handleAuthError(err);
          return;
        }
        // Exponential backoff on database/server errors to prevent DDoS-ing the recovering DB
        backoffMs = Math.min(30000, backoffMs * 2);
        console.warn(`[Poller] Poll failed, backing off for ${backoffMs}ms:`, e);
      }
      if (active) {
        // Adaptive polling: poll fast (300ms) during active signaling negotiation if no errors occurred
        const isNegotiating = ["requesting", "incoming", "connecting"].includes(connRef.current.kind);
        const delay = backoffMs > POLL_INTERVAL_MS ? backoffMs : (isNegotiating ? 300 : POLL_INTERVAL_MS);
        timer = setTimeout(tick, delay);
      }
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId, sessionSecret]);

  useEffect(() => {
    if (!sessionId || !sessionSecret || phase !== "live") return;
    const onLeave = () => leave(sessionId, sessionSecret);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, sessionSecret, phase]);

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

      {inChat && (
        <div className={`absolute inset-0 z-20 flex flex-col md:flex-row transition-all duration-300 ${
          video === "active" ? "bg-zinc-950/95" : "pointer-events-none"
        }`}>
          {/* Video Panel Container */}
          {video === "active" && (
            <div className={`flex-1 min-h-0 relative bg-zinc-950 pointer-events-auto transition-all duration-300 ${
              chatCollapsed ? "h-full w-full" : "h-[40vh] md:h-full w-full"
            }`}>
              <VideoPanel
                localStream={localStream}
                remoteStream={remoteStream}
                onEnd={endVideo}
                chatCollapsed={chatCollapsed}
                onToggleChat={() => setChatCollapsed(!chatCollapsed)}
                unreadCount={unreadCount}
              />
            </div>
          )}

          {/* Chat Panel Container */}
          <div className={`
            flex flex-col text-zinc-100 pointer-events-auto transition-all duration-300 ease-in-out overflow-hidden
            ${video === "active"
              ? chatCollapsed
                ? "h-0 md:h-full w-full md:w-0 md:min-w-0 border-t-0 md:border-l-0 opacity-0"
                : "h-[60vh] md:h-full w-full md:w-[28rem] md:min-w-[28rem] border-t md:border-t-0 md:border-l border-zinc-800/50 shadow-[0_0_30px_rgba(0,0,0,0.5)] bg-zinc-950/85 backdrop-blur-xl"
              : "absolute inset-y-0 right-0 w-full md:w-[28rem] md:min-w-[28rem] border-l border-zinc-800/50 shadow-[0_0_30px_rgba(0,0,0,0.5)] bg-zinc-950/85 backdrop-blur-xl"
            }
          `}>
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
              onImageClick={(id) => setActiveImageId(id)}
              onCollapse={video === "active" ? () => setChatCollapsed(true) : undefined}
            />
          </div>
        </div>
      )}

      {activeImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image Preview"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-md transition-all duration-300"
          onClick={handleClose}
        >
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-2.5 rounded-full bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/80 text-zinc-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>

          {activeIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-4 p-3 rounded-full bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/80 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {activeIndex < viewableImages.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-4 p-3 rounded-full bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/80 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              aria-label="Next image"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          <div
            className="relative max-h-[80vh] max-w-[85vw] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={activeImage.downloadUrl}
              alt={activeImage.text}
              className="max-h-[80vh] max-w-[85vw] object-contain rounded-lg border border-zinc-800 shadow-[0_0_50px_rgba(0,0,0,0.8)]"
            />
          </div>

          <div className="absolute bottom-6 flex flex-col items-center gap-1 select-none">
            <p className="text-sm font-semibold text-zinc-200">
              {activeImage.text.replace("File ready: ", "").replace("File sent: ", "")}
            </p>
            <p className="text-xs text-zinc-500 font-medium">
              Image {activeIndex + 1} of {viewableImages.length}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
