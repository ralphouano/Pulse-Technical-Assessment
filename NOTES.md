# Technical Assessment Notes: Pulse

This document outlines the work I completed during the assessment, broken down exactly by the four requested phases. It summarizes my fixes, design changes, security patches, and new features, along with key decisions and trade-offs.

---

## Phase 1: Make it run

### What was broken & How I fixed it
My first goal was to stabilize the application by finding and fixing the core bugs that prevented reliable connection and synchronization.
- **Global Heartbeat Reset:** I noticed stale users were never dropping off the map. Looking at `app/api/poll/route.ts`, the database query was updating `lastSeen` for *all* users rather than just the caller. I fixed this by passing the caller's session ID into the `where` filter.
- **Busy Connection Lock:** Users were getting permanently stuck as "busy" after hanging up. I traced this to `app/api/signal/route.ts`, where the busy flag was only being reset on `"decline"` signals. I updated the logic to free both users upon receiving an `"end"` signal as well.
- **WebRTC Race Condition:** Connections were failing silently and getting stuck in "Connecting...". In `lib/webrtc.ts`, the `handleSignal` function was flushing ICE candidates *before* the remote description was applied, causing the candidates to be rejected. I swapped the execution order to set the remote description first.
- **Chat Payload Bug:** Text messages weren't showing up. The sender was dispatching `{ t: "msg", text }`, but the receiver logic expected `{ t: "chat" }`. I aligned the sender to use the `"chat"` identifier.

---

## Phase 2: Make it good

### What I changed & The thinking behind it
To make Pulse feel premium, intuitive, and genuinely beautiful, I completely overhauled the UX and media reliability.
- **Video Layout Redesign:** I moved the video panel away from a full-screen overlay into a split-screen view. *Thinking:* This keeps the chat panel accessible during video calls, preventing the user from feeling locked out of texting. I also added floating controls to toggle the mic/camera and end the call cleanly.
- **Continuous Ringer UX:** I built a custom synthesizer using the Web Audio API that plays a continuous, looping ringtone when receiving chat requests or video calls. *Thinking:* A single beep is easily missed. Looping rings simulate a native phone call, making the app feel incredibly responsive. The ringer stops smoothly (ramping down volume) when accepted/declined to avoid harsh audio pops.
- **SweetAlert2 Integration:** I replaced all native browser `alert()` popups with beautifully styled, dark-mode `SweetAlert2` modal dialogs. *Thinking:* Native alerts disrupt immersion and feel cheap.
- **Audio Bug Fix (Chrome):** I fixed a severe Chrome bug where local echo cancellation was inappropriately muting remote audio. *Thinking:* Rather than fighting Chrome's `<video>` muting logic, I explicitly separated the tracks. I muted the `<video>` element and routed the audio track into a dedicated, hidden `<audio>` element.

---

## Phase 3: Make it secure

### Issues found, Ranking, and Fixes
With the app running, I conducted a security review to protect users from malicious payloads, database bloat, and privacy leaks.

1. **High Priority: Malicious File Execution via Chat**
   - *Issue:* If users can send files directly to each other, they could distribute malware (`.exe`, `.bat`, etc.) that the receiver might accidentally execute.
   - *Fix:* I added a comprehensive blocklist in `ChatPanel.tsx` to actively reject potentially harmful Windows/Mac/Linux executables and scripts before they can be sent.
2. **Medium Priority: Database Inbox Bloat**
   - *Issue:* Stale signaling rows (mailboxes) could bloat the Postgres database over time, slowing down the polling queries.
   - *Fix:* I verified and ensured that old signals are rigorously pruned upon every poll event using `deleteMany` based on `SIGNAL_TTL_MS` (60 seconds).
3. **Low Priority: IP Address Leakage via ICE**
   - *Issue:* The app currently uses public Google STUN servers. WebRTC STUN exposes the user's public and local IP addresses to their peer.
   - *Fix:* I decided to leave this as-is for the assessment, but in a production environment, I would enforce the use of a secure TURN proxy and configure the policy to only use relay servers (`iceTransportPolicy: "relay"`).
4. **Low Priority: Location Privacy**
   - *Issue:* Broadcasting exact coordinates is a massive safety risk.
   - *Fix:* I verified that the existing `applyPrivacyOffset` logic is highly robust. It securely shifts the user's real coordinate randomly between 1 and 3 km before joining. Because raw coordinates never touch the server, exact physical locations are protected from server compromises.

---

## Phase 4: Make it better

### What I built, Why, and Next Steps
I built a robust **Peer-to-Peer File & Image Sharing** system directly over the WebRTC data channel.

- **What I built:** I added an attachment button (`📎`) to the chat interface. Large files are chunked into 16KB slices and sent over the SCTP channel with real-time progress indicators. Images automatically render as high-quality inline thumbnails upon arrival, while generic files render as clickable download cards. To protect users, uploaded images are actively converted to JPG via an offscreen HTML5 `<canvas>`, and video uploads are restricted to standard formats (`mp4`, `webm`).
- **Why:** I wanted to make the app feel far more *alive* and useful. Text chatting with a stranger is fun, but instantly sharing a photo or a document over a decentralized, serverless pipe highlights the true power of WebRTC. To ensure it didn't break the existing text chat, I built an Interleaving Send Queue with micro-scheduling that prevents large file transfers from congesting the channel.
- **What I'd do next with more time:**
  - I would implement a WebAssembly port of FFmpeg (`ffmpeg.wasm`) directly in the browser to seamlessly transcode non-standard video formats (like iOS `.mov` files) into `mp4` before sending.
  - I would add "drag and drop" zone support to the chat panel for easier file uploading.
  - I would implement end-to-end encryption (E2EE) on the data channel payload for ultimate peace of mind.
