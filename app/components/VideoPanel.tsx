"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare } from "lucide-react";
import { playFeedback } from "@/lib/audio";

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
  chatCollapsed,
  onToggleChat,
  unreadCount,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onEnd: () => void;
  chatCollapsed: boolean;
  onToggleChat: () => void;
  unreadCount: number;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Video-only: the <video> element handles display, muted so it doesn't
  // double-up with the <audio> element below.
  useEffect(() => {
    const el = remoteRef.current;
    if (!el || !remoteStream) return;
    if (el.srcObject !== remoteStream) {
      el.srcObject = remoteStream;
      el.play().catch(() => {});
    }
  }, [remoteStream]);

  // Audio playback through a dedicated <audio> element — far more reliable
  // than relying on the <video> element's audio output in Chrome.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !remoteStream) return;
    if (el.srcObject !== remoteStream) {
      el.srcObject = remoteStream;
      el.volume = 1;
      el.play().catch((err) => {
        if (err.name !== "AbortError") {
          console.error("[AudioEl] play() FAILED:", err);
        }
      });
    }
  }, [remoteStream]);

  const toggleMic = () => {
    playFeedback("click");
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMicOn(audioTrack.enabled);
    }
  };

  const toggleCam = () => {
    playFeedback("click");
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setCamOn(videoTrack.enabled);
    }
  };

  return (
    /* On md+ screens, leave 28rem (max-w-md) on the right for the ChatPanel.
       On small screens, go full-width behind the ChatPanel (z-10 < z-20). */
    <div className="w-full h-full flex flex-col bg-zinc-950 relative">
      {/* Hidden audio element for reliable audio playback */}
      <audio ref={audioRef} autoPlay />

      <div className="relative flex-1 min-h-0">
        {/* Remote video (fills the container) — muted because audio
            is handled by the <audio> element above */}
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full bg-zinc-900 object-cover"
        />
        {!remoteStream && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
            Waiting for stranger&rsquo;s video&hellip;
          </div>
        )}

        {/* Local self-view PIP (top-left) */}
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="absolute top-4 left-4 h-24 w-16 md:h-36 md:w-24 rounded-xl border border-zinc-700 bg-zinc-800 object-cover shadow-lg"
        />

        {/* Floating controls bar (bottom-center) */}
        <div className="absolute bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 md:gap-3 rounded-full bg-zinc-900/80 px-4 py-2.5 md:px-5 md:py-3 backdrop-blur shadow-xl">
          {/* Mute / Unmute Mic */}
          <button
            onClick={toggleMic}
            className={`flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-full text-sm md:text-base transition ${
              micOn
                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                : "bg-red-500 text-white hover:bg-red-400"
            }`}
            title={micOn ? "Mute mic" : "Unmute mic"}
          >
            {micOn ? <Mic className="w-4 h-4 md:w-5 md:h-5" /> : <MicOff className="w-4 h-4 md:w-5 md:h-5" />}
          </button>

          {/* Toggle Camera */}
          <button
            onClick={toggleCam}
            className={`flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-full text-sm md:text-base transition ${
              camOn
                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                : "bg-red-500 text-white hover:bg-red-400"
            }`}
            title={camOn ? "Turn off camera" : "Turn on camera"}
          >
            {camOn ? <Video className="w-4 h-4 md:w-5 md:h-5" /> : <VideoOff className="w-4 h-4 md:w-5 md:h-5" />}
          </button>

          {/* End Video */}
          <button
            onClick={onEnd}
            className="flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full bg-red-500 text-base md:text-lg text-white shadow-md hover:bg-red-400 transition"
            title="End video"
          >
            <PhoneOff className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>

        {/* Floating Chat Button Overlay when chat is collapsed */}
        {chatCollapsed && (
          <button
            onClick={onToggleChat}
            className="absolute top-4 right-4 z-20 flex h-11 w-11 md:h-12 md:w-12 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-900/80 text-white hover:bg-zinc-800 transition-colors shadow-2xl backdrop-blur cursor-pointer"
            title="Open Chat"
          >
            <MessageSquare className="w-4 h-4 md:w-5 md:h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-zinc-950 animate-pulse">
                {unreadCount}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
