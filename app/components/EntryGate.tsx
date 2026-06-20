"use client";

import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";

export default function EntryGate({
  onReady,
}: {
  onReady: (lat: number, lng: number) => void;
}) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function enter() {
    setLocating(true);
    setError(null);
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not supported by your browser.");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onReady(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        console.warn(`Geolocation error (${err.code}): ${err.message}`);
        setError("Couldn't get your location. Please check your browser's location permissions in the address bar and try again.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 bg-zinc-950 p-6 text-zinc-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Pulse</h1>
        <p className="mt-2 max-w-sm text-zinc-400">
          A living globe of anonymous strangers. Drop onto the map and connect.
        </p>
      </div>

      <button
        onClick={enter}
        disabled={locating}
        className="flex w-full max-w-[200px] items-center justify-center gap-2 rounded-full bg-emerald-400 px-8 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:opacity-60"
      >
        {locating ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Locating...
          </>
        ) : (
          <>
            <MapPin className="h-5 w-5" />
            Enter Pulse
          </>
        )}
      </button>

      {error && (
        <p className="max-w-sm text-center text-sm text-red-400">{error}</p>
      )}

      <p className="max-w-sm text-center text-xs text-zinc-500">
        No sign-up. Your dot is placed 1–3&nbsp;km from your real location.
        Nothing is stored — closing the tab ends everything.
      </p>
    </div>
  );
}
