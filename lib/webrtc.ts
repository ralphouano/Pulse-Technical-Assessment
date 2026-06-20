export type DescType = "offer" | "answer" | "ice";
export type PeerControl =
  | "video-request"
  | "video-accept"
  | "video-decline"
  | "video-end";

export type WebRTCPacket =
  | { t: "chat"; text: string }
  | { t: "ctrl"; ctrl: PeerControl }
  | { t: "file-meta"; fileId: string; name: string; size: number; mimeType: string }
  | { t: "file-chunk"; fileId: string; chunkIndex: number; data: string }
  | { t: "file-end"; fileId: string }
  | { t: "file-cancel"; fileId: string };

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => void;
  onChat: (text: string) => void;
  onControl: (ctrl: PeerControl) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  onFileMeta: (fileId: string, name: string, size: number, mimeType: string) => void;
  onFileChunk: (fileId: string, chunkIndex: number, data: string) => void;
  onFileEnd: (fileId: string) => void;
  onFileCancel: (fileId: string) => void;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private fileSendQueue: { fileId: string; chunkIndex: number; data: string }[] = [];
  private sendingFileId: string | null = null;
  private isSendingQueue = false;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private localStream: MediaStream | null = null;
  private inboundTracks: MediaStreamTrack[] = [];
  private closed = false;
  private readonly cb: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(initiator: boolean, cb: PeerCallbacks) {
    this.cb = cb;
    this.polite = !initiator;
    this.pc = new RTCPeerConnection(ICE_CONFIG);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.onSignal("ice", JSON.stringify(candidate));
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.cb.onSignal("offer", JSON.stringify(this.pc.localDescription));
        }
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = ({ track }) => {
      console.log(`[WebRTC] ontrack fired: kind=${track.kind}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      if (!this.inboundTracks.some((t) => t.id === track.id)) {
        this.inboundTracks.push(track);
      }
      const stream = new MediaStream(this.inboundTracks);
      console.log(`[WebRTC] Remote stream now has ${stream.getAudioTracks().length} audio, ${stream.getVideoTracks().length} video tracks`);
      this.cb.onRemoteStream(stream);
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState(this.pc.connectionState);
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat");
      this.wireDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.wireDataChannel(this.dc);
      };
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => this.cb.onChannelOpen();
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as WebRTCPacket;
        if (msg.t === "chat" && typeof msg.text === "string") {
          this.cb.onChat(msg.text);
        } else if (msg.t === "ctrl" && typeof msg.ctrl === "string") {
          this.cb.onControl(msg.ctrl as PeerControl);
        } else if (msg.t === "file-meta") {
          this.cb.onFileMeta(msg.fileId, msg.name, msg.size, msg.mimeType);
        } else if (msg.t === "file-chunk") {
          this.cb.onFileChunk(msg.fileId, msg.chunkIndex, msg.data);
        } else if (msg.t === "file-end") {
          this.cb.onFileEnd(msg.fileId);
        } else if (msg.t === "file-cancel") {
          this.cb.onFileCancel(msg.fileId);
        }
      } catch {}
    };
  }

  async handleSignal(type: DescType, payload: string) {
    if (this.closed) return;
    const data = JSON.parse(payload);

    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(data);
        return;
      }
      try {
        await this.pc.addIceCandidate(data);
      } catch {}
      return;
    }

    const desc = data as RTCSessionDescriptionInit;
    const offerCollision =
      desc.type === "offer" &&
      (this.makingOffer || this.pc.signalingState !== "stable");
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    await this.pc.setRemoteDescription(desc);
    await this.flushPendingCandidates();
    if (desc.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.cb.onSignal("answer", JSON.stringify(this.pc.localDescription));
      }
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {}
    }
  }

  sendChat(text: string) {
    this.safeSend({ t: "chat", text });
  }

  sendControl(ctrl: PeerControl) {
    this.safeSend({ t: "ctrl", ctrl });
  }

  private safeSend(obj: unknown) {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(obj));
    }
  }

  async startVideo(): Promise<MediaStream> {
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      for (const track of this.localStream.getTracks()) {
        console.log(`[WebRTC] Adding local track: kind=${track.kind}, enabled=${track.enabled}, muted=${track.muted}`);
        this.pc.addTrack(track, this.localStream);
      }
      console.log(`[WebRTC] Local stream has ${this.localStream.getAudioTracks().length} audio, ${this.localStream.getVideoTracks().length} video tracks`);
    }
    return this.localStream;
  }

  stopVideo() {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      for (const sender of this.pc.getSenders()) {
        if (sender.track) {
          try {
            this.pc.removeTrack(sender);
          } catch {}
        }
      }
      this.localStream = null;
    }
  }

  sendFile(file: File, fileId: string, onProgress: (sentBytes: number) => void) {
    const chunkSize = 16384; // 16KB
    const reader = new FileReader();

    // First, send metadata
    this.safeSend({
      t: "file-meta",
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type,
    });

    let offset = 0;
    let chunkIndex = 0;

    const readNext = () => {
      if (offset >= file.size) {
        this.safeSend({ t: "file-end", fileId });
        return;
      }
      const slice = file.slice(offset, offset + chunkSize);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      if (!arrayBuffer) return;

      // Convert buffer to Base64 to survive JSON serialization
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);

      this.fileSendQueue.push({
        fileId,
        chunkIndex,
        data: base64Data,
      });

      offset += chunkSize;
      chunkIndex++;

      // Update progress callback
      onProgress(offset > file.size ? file.size : offset);

      if (!this.isSendingQueue) {
        this.processSendQueue();
      }
      readNext();
    };

    readNext();
  }

  cancelFileSend(fileId: string) {
    this.fileSendQueue = this.fileSendQueue.filter((q) => q.fileId !== fileId);
    if (this.sendingFileId === fileId) {
      this.sendingFileId = null;
    }
    this.safeSend({ t: "file-cancel", fileId });
  }

  private processSendQueue() {
    if (this.fileSendQueue.length === 0) {
      this.isSendingQueue = false;
      return;
    }

    this.isSendingQueue = true;
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") {
      this.isSendingQueue = false;
      return;
    }

    // Congestion control: if buffer is full (> 64KB), wait for bufferedamountlow
    const BUFFER_LIMIT = 65536;
    if (dc.bufferedAmount > BUFFER_LIMIT) {
      const onLow = () => {
        dc.removeEventListener("bufferedamountlow", onLow);
        this.processSendQueue();
      };
      dc.addEventListener("bufferedamountlow", onLow);
      return;
    }

    const nextItem = this.fileSendQueue.shift();
    if (nextItem) {
      this.sendingFileId = nextItem.fileId;
      this.safeSend({
        t: "file-chunk",
        fileId: nextItem.fileId,
        chunkIndex: nextItem.chunkIndex,
        data: nextItem.data,
      });
    }

    // Schedule next chunk using micro-delay to let CPU breathe and interleave chats
    setTimeout(() => this.processSendQueue(), 2);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    try {
      this.pc.close();
    } catch {}
  }
}
