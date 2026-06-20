# Technical Assessment Notes: Pulse

This document lists the work I did during this assessment. It is organized by the four phases requested, explaining what I fixed, the changes I made, and my choices.

---

## Phase 1: Make it run

### What was broken & How I fixed it
My first goal was to get the app working reliably by fixing bugs in the connection logic.
- **Global Heartbeat Reset:** I found that inactive users stayed on the map forever. In `app/api/poll/route.ts`, the database query was updating the `lastSeen` timestamp for every user instead of just the caller. I fixed this by passing the caller's session ID into the `where` filter.
- **Busy Connection Lock:** Users got stuck as "busy" after hanging up. In `app/api/signal/route.ts`, the busy flag was only reset on `"decline"` signals. I updated it to also clear the busy flag when an `"end"` signal is received.
- **WebRTC Race Condition:** Connections failed and got stuck in "Connecting...". In `lib/webrtc.ts`, the `handleSignal` function was setting ICE candidates before applying the remote description, which caused the candidates to be ignored. I changed the order to set the remote description first.
- **Chat Message Bug:** Text messages were not displaying. The sender was sending `{ t: "msg", text }`, but the receiver was looking for `{ t: "chat" }`. I updated the sender to use the `"chat"` type.

---

## Phase 2: Make it good

### What I changed & The thinking behind it
To make the app easy to use, look nice, and run reliably, I improved the layout, styles, and added audio feedback.
- **Video Layout Redesign:** I moved the video panel from a full-screen overlay into a split-screen view. *Thinking:* This lets users keep typing in the chat panel while on a video call, instead of being locked out of the chat. I also added buttons to mute the mic, turn off the camera, and end the call.
- **Ringtone & Audio Feedback:** I added sound effects using the Web Audio API. When you get a call or connection request, it plays a continuous looping sound. *Thinking:* A single beep is too easy to miss. The loop behaves like a regular phone call. I made the ringtone fade out gently when accepted or declined so there are no sudden clicks or pops. I also added simple sound effects for clicks (tapping map dots, clicking mic/camera buttons), sound cues when you get a chat message, when a connection succeeds, and when a call ends. Since web browsers block audio from playing automatically, the audio starts only after the user clicks the initial location button.
- **Custom Modals:** I replaced the browser's default `alert()` popups with styled dark-mode popups using `SweetAlert2`. *Thinking:* Standard browser popups look outdated and disrupt the app's look.
- **UI Styling Updates:** I updated the styling to use clean gradients, rounded borders, and semi-transparent dark backgrounds. I replaced all text emojis (`📍`, `📎`, etc.) with clean SVG icons using the `lucide-react` library. The user's own marker on the map is now a pulsing blue dot, and the loading screens have standard spinning indicators. *Thinking:* Custom icons and markers make the app look finished and custom-made, rather than relying on browser defaults.

---

## Phase 3: Make it secure

### Issues found, Ranking, and Fixes
Once the app was running, I checked for security problems, data leaks, and database performance issues.

1. **High Priority: API Authorization (Critical IDOR)**
   - *Issue:* The API used the public UUID `id` as both a routing identifier and an authorization token. Since `/api/poll` broadcasted every user's `id` to the map, anyone could read these IDs and use them to intercept messages or force disconnections.
   - *Fix:* I added a second token. I added a private `secret` to the database schema and updated the frontend to send this `sessionSecret` with every API request. The server now checks the secret before changing any data, which stops attackers from making fake requests.
2. **High Priority: Malicious File Execution via Chat**
   - *Issue:* Because users can send files directly to each other, someone could send harmful files (like `.exe` or `.bat`) that a receiver might run.
   - *Fix:* I added a list of forbidden file extensions in `ChatPanel.tsx` to block Windows, Mac, and Linux scripts and executable files before they are sent.
3. **Medium Priority: Database Inbox Bloat**
   - *Issue:* Old signal data left in the database could slow down polling queries over time.
   - *Fix:* I made sure that old signal data is cleaned up from the database every time a user polls, deleting everything older than 60 seconds.
4. **Critical Priority: Location Triangulation via Rapid Joins**
   - *Issue:* The map shifts location coordinates by 1-3km to protect privacy, but this shift was recalculated on every update. An attacker could update their location repeatedly to get many different offsets and average them out to find the user's real location.
   - *Fix:* I changed the logic in `app/api/join/route.ts` so the random offset is calculated only once per session instead of every time the user updates. This stops triangulation.
5. **Low Priority: IP Address Leakage via ICE**
   - *Issue:* Using Google STUN servers exposes a user's IP address to their peer.
   - *Fix:* I left this as-is for the assessment, but in a real release, I would route WebRTC traffic through a proxy server (a TURN server) and configure it to only use relay paths to hide IP addresses.

### Performance Audit
1. **High Priority: Over-Aggressive Database Polling vs. Connection Latency**
   - *Issue:* The database was being polled every 300ms, which would overload the server. However, slowing it down to 1800ms made WebRTC connections take too long to connect.
   - *Fix:* I changed the frontend to adjust how fast it polls the database. When trying to connect, it polls quickly (every 300ms) to make the WebRTC connection start fast. Once connected or when just looking at the map, it slows down to poll every 1800ms. This keeps connection times short without overloading the database.
2. **Medium Priority: React Re-render Thrashing**
   - *Issue:* The polling loop updated state on every tick, which forced the map to redraw itself constantly even when nothing changed.
   - *Fix:* I added a check to skip updating the React state if the peer data is the same as the previous poll.

---

## Phase 4: Make it better

### What I built, Why, and Next Steps
I added a file and image sharing feature that sends files directly between users using the WebRTC data channel.

- **What I built:** I added a file attachment button (`📎`). Large files are split into small 16KB parts and sent with progress bars. Received images show up as preview thumbnails, and other files show up as download links. To stay safe, sent images are converted to JPG in the background, and videos are limited to standard formats (`mp4` and `webm`).
- **Why:** Sharing photos and documents directly between browsers makes the chat much more useful. To make sure large files don't block text messages while sending, I added a queue that mixes file parts and text messages so text always goes through immediately.
