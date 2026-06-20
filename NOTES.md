# Developer Notes — Pulse

Here are the notes on what I fixed and built during this assessment, grouped by the requested phases.

---

## Phase 1: Make it run

### Bug Fixes
My main goal was getting connection requests and chat working properly.
- **Global Heartbeat Reset:** I noticed inactive users stayed stuck on the map. The heartbeat handler in `app/api/poll/route.ts` was updating `lastSeen` for every database record instead of filtering by the caller's session ID. I added a `where: { id }` constraint to the query.
- **Busy Connection Lock:** Hanging up left users locked in a "busy" status. The API in `app/api/signal/route.ts` was only resetting this status on connection declines. I updated it to also reset the user's status when an `"end"` signal is received.
- **WebRTC Race Condition:** Connections got stuck in "Connecting..." indefinitely. In `lib/webrtc.ts`, `handleSignal` tried to add remote ICE candidates before the session description was set. I reordered it to apply the description first and buffer candidate additions.
- **Chat Message Bug:** Chat messages sent over WebRTC were not rendering. The sender was dispatching packet type `msg` but the receiver was listening for type `chat`. I aligned both to use `chat`.

---

## Phase 2: Make it good

### Layout & Audio Adjustments
I updated the layout, added micro-interactions, and added sound cues.
- **Video Layout Redesign:** I moved the video call interface from a full-screen block to a split-screen view. This lets you keep typing in the chat panel while talking on video. I also added buttons to toggle audio/video and hang up.
- **Ringtone & Audio Feedback:** I built a synthesizer helper using the Web Audio API. It plays a looping phone-like ringtone for connection requests and video calls, plus simple chime sound effects for text messages, connection success, disconnections, clicks, and errors. To bypass browser auto-play blocks, it starts when the user shares their location. I also made ringtones fade out smoothly to avoid pops.
- **Modals:** I swapped browser alert prompts with custom styled dark-mode popups using `SweetAlert2` so they blend with the dark interface.
- **Panel Alignment:** I placed the chat panel on the right side of the screen and the video panel on the left. This feels more familiar like standard messaging apps and leaves space for the map.
- **UI Styling:** I updated the styling to use subtle dark gradients and rounded borders. I replaced text emojis with SVG icons from `lucide-react`, made the self marker a pulsing blue dot, and added standard spin loaders.

---

## Phase 3: Make it secure

### Security & Performance
I audited the API, file-sharing flows, and DB performance for exploits.

1. **API Auth Check (Critical IDOR):**
   - *Symptom:* The database used public user UUIDs as both lookup keys and authorization tokens. Since `/api/poll` broadcasted all active user IDs, anyone could intercept signals, spoof requests, or force connections closed.
   - *Fix:* I added a private `secret` column to the database. The client generates this `sessionSecret` on load and passes it in headers/payloads. The server verifies this secret before processing updates or polling requests.
2. **Malicious File Upload Filtering:**
   - *Symptom:* Users could send executable files or script files directly to strangers.
   - *Fix:* I added validation in `ChatPanel.tsx` that blocks common Windows, macOS, and Linux scripts and executables (like `.exe`, `.dmg`, `.sh`, `.bat`) from being uploaded.
3. **Database Signaling Bloat:**
   - *Symptom:* Signal records remained in the DB, causing size to grow and slow down fast polling.
   - *Fix:* I added a cleanup script inside the poll handler that deletes signals older than 60 seconds on every poll tick.
4. **Triangulation via Location Offset Regeneration:**
   - *Symptom:* The map randomly offsets location coordinates by 1-3km to protect privacy, but this offset was recalculated on every poll, allowing someone to average coordinates and find a user's real house.
   - *Fix:* I modified `app/api/join/route.ts` to calculate the random coordinates offset only once per session, returning static coordinates for the user.
5. **IP Leakage over STUN:**
   - *Symptom:* Google's public STUN servers reveal peer IP addresses to each other.
   - *Fix:* I documented this as a low-priority risk. A production deployment should configure a relay TURN server and disable direct host candidates to completely hide user IPs.

### Performance Tweaks
- **Polling Loop Throttle:** The client was polling the DB every 300ms. I throttled this to 1800ms by default, but set it to dynamically scale up to 300ms only during active signal negotiation so connection requests are still fast without hammering the server.
- **State Update Filter:** The polling tick previously forced a React map re-render on every request. I added a JSON serialization comparison to skip state updates if peer coordinates have not changed.

---

## Phase 4: Make it better

### File Sharing & Image Slider Modal
I implemented peer-to-peer file sharing and visual improvements.
- **P2P File Sharing:** I added a file attachment button and support for dragging and dropping files on the chat box. Large files are split into 16KB parts, converted to base64, and sent through the WebRTC data channel with progress updates.
- **Safe File Formats Whitelist:** To comprehensively secure peer-to-peer file sharing, I replaced the blacklisting approach with an explicit whitelist. The client only accepts safe productivity and media extensions, including documents (.pdf, .txt, .rtf, .csv, .md, .doc, .docx, .xls, .xlsx, .ppt, .pptx), images (.jpg, .jpeg, .png, .gif, .webp, .bmp, .heic, .heif), videos (.mp4, .mkv, .mov, .avi, .webm), and archive packages (.zip, .rar, .7z, .tar, .gz).
- **Expanded Video Formats:** I expanded the supported video formats to accept and categorize `.mp4`, `.mkv`, `.mov`, `.avi`, and `.webm` files. I updated the file classification logic to check both filename extensions and MIME types so these formats are correctly rendered as video messages even when a client's browser doesn't report a standard video MIME type.
- **Dynamic HEIC/HEIF Image Support:** I integrated the `heic2any` library to enable native-like previewing of HEIC/HEIF images. When a user uploads a `.heic` or `.heif` image, the sender's client dynamically loads the converter and converts it to a standard `.jpg` JPEG blob before WebRTC transmission, allowing cross-platform previews and seamless integration into the image slider.
- **Reliable Congestion Control:** Fixed large file transfers (>64KB) freezing. I set `dc.bufferedAmountLowThreshold` to 64KB and added an `onbufferedamountlow` event handler to pause/resume sending chunks, keeping the queue flow healthy. I also added a check on the receiver to verify all chunks arrived before assembling the file.
- **Image Slider Preview Modal:** Clicking an image in chat now opens a full-screen preview. I added keyboard arrow bindings (`ArrowLeft`, `ArrowRight`, `Escape`) to cycle through all viewable images in the active session without using external APIs or servers.
- **Layout Adjustments:** Moved the preview modal to the page root level so it centers correctly over the entire screen instead of being trapped by the chat panel's blur filters. I also moved the user counter to the top-left, enlarged it, added a pulsing green dot, and corrected the count math (`peers.length + 1`) to include the user.
- **Busy/Offline User Connection Feedback:** Added detailed payloads to the auto-decline signals (`busy` and `offline`). When a third user attempts to connect to someone already in a call, or if the recipient's client is not idle, the server and client tag the decline signal with `"busy"`. The initiator parses this payload to display a clear notice (`"User is busy or connected with another user."` or `"User went offline."`) instead of the generic `"Request declined."` alert.

---

## AI Collaboration Approach

To get these tasks done, I used an AI coding assistant. Here is how I prompted the AI to keep the work clean and efficient:
- **Strict Guidelines (CLAUDE.md / AGENTS.md):** I set up rules forcing the AI to keep code changes minimal and surgical (only edit what is needed, no random refactoring), verify success using actual command outputs before claiming completion, and follow a strict systematic debugging workflow (diagnose root cause first).
- **Incremental and Iterative Instructions:** I guided the UI and functionality updates in small, sequential steps (e.g. shifting panel alignments, fixing specific received message rendering bugs, resolving buffer freezes, centering previews, repositioning map elements) rather than asking for massive changes all at once.

