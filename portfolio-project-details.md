# Project Case Study: Pulse — Ephemeral P2P Chat & Video Connection Platform

Pulse is a real-time, privacy-first anonymous connection web application. Users appear as randomized location dots on a live interactive world map and can instantly connect with strangers for text chat, file transfers, and video calls. Designed with a completely stateless architecture, no data persists between sessions; once a browser tab is closed, all traces disappear.

---

## 🚀 Technical Architecture & Core Tech Stack

*   **Frontend Framework**: React 19 & Next.js 16 (App Router)
*   **Database & ORM**: Prisma 7 with PostgreSQL (Neon / Vercel Postgres)
*   **P2P Communication**: WebRTC (RTCPeerConnection & RTCDataChannel)
*   **Geospatial Visualization**: Mapbox GL (Mapbox GL JS)
*   **Audio UX**: Web Audio API (transient real-time sound/ringtone synthesis)
*   **Component styling**: Vanilla CSS styled for dark-mode glassmorphism and custom animation effects
*   **Deployment Environment**: Vercel Serverless

---

## 💡 Engineering Challenges & Solutions

### 1. WebRTC Congestion Control for P2P File Transfers
*   **The Problem**: Sending files over WebRTC data channels in chunks would randomly freeze or crash the browser once the transfer buffer exceeded the default 64KB threshold.
*   **The Solution**: Implemented a custom queuing system. Configured the channel's `bufferedAmountLowThreshold` to 64KB and used the `onbufferedamountlow` event handler to throttle chunk transmission dynamically. The receiver also performs chunk-presence validation to verify all parts arrived intact before reconstituting the final file blob.

### 2. File Sharing Security, MIME-type Spoofing & Polyglot Prevention
*   **The Problem**: Allowing P2P file transfers introduces security risks where users could send malicious scripts or polyglot files (e.g. an HTML/JS file renamed to `.png`) that execute inside the receiver's browser origin.
*   **The Solution**:
    *   Replaced file blacklists with an explicit, safe extension whitelist.
    *   Neutralized MIME-type spoofing by overriding all browser-reported types with a strict extension-to-MIME mapping on both client ends.
    *   Built a binary header inspector checking the first 16 bytes (magic numbers) of incoming files to verify that their content matches their extension (e.g., validating PNG, JPEG, WebP, PDF, ZIP signatures). Transfers with mismatched signatures are immediately blocked.

### 3. Dynamic HEIC/HEIF Image Conversion
*   **The Problem**: Modern mobile devices capture photos in HEIC/HEIF formats, which modern browsers (like Chrome and Firefox on Windows/Linux/Android) cannot render natively, breaking chat image previews.
*   **The Solution**: Integrated the client-side `heic2any` library via dynamic lazy-loading. When a HEIC/HEIF image is uploaded, the sender's browser dynamically loads the package, converts the file to a standard JPEG `.jpg` blob, and transmits it, allowing cross-platform previews in the custom image slider.

### 4. Location Privacy and Anti-Triangulation Offset
*   **The Problem**: To protect privacy, coordinates are randomized by 1–3 km. However, if the random offset is recalculated on every database poll, an attacker could log coordinates over time and average them to triangulate the user's exact home address.
*   **The Solution**: Modified the coordinates generation to calculate the random privacy offset exactly once when joining the map. The offset is pinned to the user's session identifier, maintaining a static (but offset) position for the session's duration.

### 5. API Authentication & IDOR Hardening
*   **The Problem**: The app initially used public session UUIDs as both database lookup keys and authentication tokens, enabling users to spoof signals or force-disconnect strangers.
*   **The Solution**: Created a session secret model. The client generates a private cryptographic secret on load, which is verified by server-side headers on every signaling API request. Added an automatic signal table garbage collector that purges stale signaling mailboxes older than 60 seconds on every poll tick.

### 6. Dynamic Polling Rate & Signal Flow Optimization
*   **The Problem**: Continuous database polling hammered the server and slowed performance.
*   **The Solution**: Implemented a dynamic polling throttle. The client defaults to a relaxed 1800ms polling rate, but throttles down to 300ms during active signaling handshakes to ensure connection handshakes are fast and responsive, scaling back up once connection is established.

### 7. Synthesized Sound Design (Web Audio API)
*   **The Problem**: Modern browsers block auto-playing audio assets, and loading external sound files adds latency and bandwidth overhead.
*   **The Solution**: Designed an interactive sound system using the browser's Web Audio API. It programmatically synthesizes custom ringtones (using oscillator and gain nodes) and chime sound effects (for messages, errors, and successful connections) directly in memory once location consent is granted.

---

## 🎨 Layout & Interaction Highlights

*   **P2P Image Slider Preview**: Clicking shared images opens a focused, full-screen gallery. Users can cycle through images using left/right arrow keys or close the view with the Escape key, operating 100% client-side.
*   **User Interface**: Styled with glassmorphism, responsive split panels for simultaneous video/chat calls, pulsing map indicators, and SweetAlert2 dark-mode dialogs.
*   **Top-Left Online Counter**: Online count represents `{peers.length + 1}` to include the local user, decorated with a pulsing green indicator.
