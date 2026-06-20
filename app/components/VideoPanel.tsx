"use client";

import { useEffect, useRef, useState } from "react";

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onEnd: () => void;
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
    el.srcObject = remoteStream;
    el.play().catch(() => {});
  }, [remoteStream]);

  // Audio playback through a dedicated <audio> element — far more reliable
  // than relying on the <video> element's audio output in Chrome.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !remoteStream) return;
    el.srcObject = remoteStream;
    el.volume = 1;
    el.play()
      .then(() => console.log("[AudioEl] play() succeeded"))
      .catch((err) => console.error("[AudioEl] play() FAILED:", err));
  }, [remoteStream]);

  function toggleMic() {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
    }
  }

  function toggleCam() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
    }
  }

  return (
    /* On md+ screens, leave 28rem (max-w-md) on the right for the ChatPanel.
       On small screens, go full-width behind the ChatPanel (z-10 < z-20). */
    <div className="absolute inset-y-0 left-0 right-0 md:right-[28rem] z-10 flex flex-col bg-zinc-950">
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
          className="absolute top-4 left-4 h-36 w-24 rounded-xl border border-zinc-700 bg-zinc-800 object-cover shadow-lg"
        />

        {/* Floating controls bar (bottom-center) */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-full bg-zinc-900/80 px-5 py-3 backdrop-blur shadow-xl">
          {/* Mute / Unmute Mic */}
          <button
            onClick={toggleMic}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-base transition ${
              micOn
                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                : "bg-red-500 text-white hover:bg-red-400"
            }`}
            title={micOn ? "Mute mic" : "Unmute mic"}
          >
            {micOn ? "🎤" : "🔇"}
          </button>

          {/* Toggle Camera */}
          <button
            onClick={toggleCam}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-base transition ${
              camOn
                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                : "bg-red-500 text-white hover:bg-red-400"
            }`}
            title={camOn ? "Turn off camera" : "Turn on camera"}
          >
            {camOn ? "📹" : "🚫"}
          </button>

          {/* End Video */}
          <button
            onClick={onEnd}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-lg text-white shadow-md hover:bg-red-400 transition"
            title="End video"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
