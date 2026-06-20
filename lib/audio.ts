"use client";

// Shared Web Audio Context. We initialize it lazily to avoid auto-play blocking.
let audioCtx: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
  }
  // If the context was suspended (e.g. created before a user gesture), wake it up.
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// --- Ringer State ---
let activeRingerTimeout: ReturnType<typeof setTimeout> | null = null;
let activeGain: GainNode | null = null;
let activeOscs: OscillatorNode[] = [];

/** Smoothly stops any currently playing continuous ringer. */
export function stopRing() {
  if (activeRingerTimeout) {
    clearTimeout(activeRingerTimeout);
    activeRingerTimeout = null;
  }
  if (activeGain && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      activeGain.gain.cancelScheduledValues(now);
      activeGain.gain.setValueAtTime(activeGain.gain.value, now);
      activeGain.gain.linearRampToValueAtTime(0, now + 0.1);
    } catch {}
    activeGain = null;
  }
  activeOscs.forEach(osc => {
    try {
      osc.stop(audioCtx!.currentTime + 0.1);
    } catch {}
  });
  activeOscs = [];
}

/** Plays a warm, pulsing dual-tone sine wave for text connections. */
export function startConnectionRing() {
  stopRing(); // Ensure only one ringer plays
  const ctx = getContext();
  if (!ctx) return;

  function playPulse() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();

    // Warm, slightly detuned sine waves for a rich pulse
    osc1.type = "sine";
    osc2.type = "sine";
    osc1.frequency.value = 440; // A4
    osc2.frequency.value = 444; // Beating effect

    gain.gain.setValueAtTime(0, now);
    // Swell up
    gain.gain.linearRampToValueAtTime(0.3, now + 0.2);
    // Swell down
    gain.gain.linearRampToValueAtTime(0, now + 1.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.2);
    osc2.stop(now + 1.2);

    activeGain = gain;
    activeOscs = [osc1, osc2];

    activeRingerTimeout = setTimeout(playPulse, 2000); // 2 second interval
  }

  playPulse();
}

/** Plays a sharp, marimba-like trill for video calls. */
export function startVideoRing() {
  stopRing();
  const ctx = getContext();
  if (!ctx) return;

  function playTrill() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();

    osc.type = "triangle";
    
    // Quick trill sequence
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1046.50, now + 0.1); // C6
    osc.frequency.setValueAtTime(1318.51, now + 0.2); // E6
    osc.frequency.setValueAtTime(1046.50, now + 0.3); // C6

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);

    activeGain = gain;
    activeOscs = [osc];

    activeRingerTimeout = setTimeout(playTrill, 1500); // 1.5 second interval
  }

  playTrill();
}

/** Plays a high-pitched glass "ding" for new messages. */
export function playMessageBell() {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(1567.98, now); // G6

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 1.0);
}

/** Plays distinct UI feedback sounds. */
export function playFeedback(type: "click" | "success" | "disconnect" | "error") {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();

  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === "click") {
    // Tiny wooden tap
    osc.type = "square";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.05);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    
    osc.start(now);
    osc.stop(now + 0.05);
  } else if (type === "success") {
    // Two-tone rising chime (e.g. entering app or accepting call)
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now); // A4
    osc.frequency.setValueAtTime(554.37, now + 0.15); // C#5

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.setValueAtTime(0.2, now + 0.15);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);

    osc.start(now);
    osc.stop(now + 0.8);
  } else if (type === "disconnect") {
    // Deep, descending thud
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === "error") {
    // Harsh buzz
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(100, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    osc.start(now);
    osc.stop(now + 0.3);
  }
}
