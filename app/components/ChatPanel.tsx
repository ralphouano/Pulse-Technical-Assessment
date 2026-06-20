"use client";

import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { Paperclip, FileText, Download, Send, Video, PhoneOff, Upload } from "lucide-react";
import { playFeedback } from "@/lib/audio";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
  fileId?: string;
  isOutgoing?: boolean;
  isIncoming?: boolean;
  downloadUrl?: string;
  isImage?: boolean;
  isVideo?: boolean;
}

export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  onSend,
  onStartVideo,
  onEnd,
  onSendFile,
  onCancelFile,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
  onSendFile: (file: File) => void;
  onCancelFile: (fileId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!connected) return;
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    if (!connected) return;

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    await handleFile(file);
  }

  async function handleFile(file: File) {
    // Block malicious formats comprehensively (Windows/Mac/Linux executables & scripts)
    const badExts = [
      ".exe", ".com", ".dll", ".sys", ".cpl", ".ocx", ".scr", ".pif", ".msi", ".msp", 
      ".bat", ".cmd", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".ps1", ".ps1xml", 
      ".ps2", ".ps2xml", ".psc1", ".psc2", ".msh", ".msh1", ".msh2", ".mshxml", ".msh1xml", 
      ".msh2xml", ".scf", ".lnk", ".inf", ".reg", 
      ".app", ".dmg", ".pkg", ".appimage", ".run", ".bin", ".elf", ".sh", ".bash", ".zsh", ".csh", ".tcsh", ".ksh"
    ];
    const nameLower = file.name.toLowerCase();
    if (badExts.some(ext => nameLower.endsWith(ext))) {
      Swal.fire({
        icon: "error",
        title: "Security Risk",
        text: "This file type is not allowed for security reasons.",
        background: "#18181b",
        color: "#f4f4f5",
        confirmButtonColor: "#3f3f46",
      });
      return;
    }

    let fileToSend = file;

    // Reject non-MP4/WebM videos (standard/globally recognized formats)
    if (file.type.startsWith("video/") && !["video/mp4", "video/webm"].includes(file.type)) {
      Swal.fire({
        icon: "warning",
        title: "Unsupported Format",
        text: "Please use a standard or globally recognized video format (like MP4 or WebM).",
        background: "#18181b",
        color: "#f4f4f5",
        confirmButtonColor: "#3f3f46",
      });
      return;
    }

    // Convert images to JPG
    if (file.type.startsWith("image/") && file.type !== "image/jpeg" && file.type !== "image/gif") {
      try {
        const bmp = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bmp, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
          if (blob) {
            // Replace extension with .jpg
            const baseName = file.name.includes('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name;
            fileToSend = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
          }
        }
      } catch (err) {
        console.error("Failed to convert image to JPG:", err);
      }
    }

    onSendFile(fileToSend);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !connected) return;
    playFeedback("click");
    onSend(draft);
    setDraft("");
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col bg-zinc-950/85 backdrop-blur-xl border-l border-zinc-800/50 shadow-[0_0_30px_rgba(0,0,0,0.5)] text-zinc-100 relative"
    >
      {isDragging && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-zinc-950/95 border-2 border-dashed border-emerald-500 rounded-2xl m-2 backdrop-blur-sm pointer-events-none">
          <Upload className="w-12 h-12 text-emerald-400 animate-bounce mb-2" />
          <p className="text-emerald-400 font-semibold text-base">Drop file to instantly share</p>
          <p className="text-zinc-400 text-xs mt-1">P2P transfer directly in chat</p>
        </div>
      )}
      <header className="flex items-center justify-between border-b border-zinc-800/50 px-4 py-3 bg-zinc-950/50">
        <div>
          <p className="font-semibold text-lg">Stranger</p>
          <p className="text-xs font-medium text-emerald-400">
            {connected ? "Connected" : "Connecting…"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-800/50 px-3 py-1.5 text-sm hover:bg-zinc-700 hover:border-zinc-500 transition-colors disabled:opacity-40"
          >
            <Video className="w-4 h-4" />
            Video
          </button>
          <button
            onClick={onEnd}
            className="flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400 transition-colors"
          >
            <PhoneOff className="w-4 h-4" />
            End
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500">
            Say hello. Messages are peer-to-peer and never stored.
          </p>
        )}
        {messages.map((m) => {
          const showPreview = m.downloadUrl && !m.isOutgoing && !m.isIncoming;
          const isImageFile = showPreview && m.isImage;
          const isVideoFile = showPreview && m.isVideo;
          const isGenericFile = showPreview && !m.isImage && !m.isVideo;

          return (
            <div
              key={m.id}
              className={`flex ${m.mine ? "justify-end" : "justify-start"} mb-2`}
            >
              <span
                className={`max-w-[80%] px-4 py-2 text-sm shadow-sm ${
                  m.mine
                    ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-emerald-950 font-medium rounded-t-2xl rounded-bl-2xl rounded-br-sm"
                    : "bg-zinc-800/90 text-zinc-100 rounded-t-2xl rounded-br-2xl rounded-bl-sm"
                }`}
              >
                {/* Progress / Loading UI */}
                {m.isOutgoing && m.fileId && !m.downloadUrl && (
                  <div className="flex flex-col gap-1">
                    <span>{m.text}</span>
                    <button
                      type="button"
                      onClick={() => onCancelFile(m.fileId!)}
                      className="mt-1 text-xs text-red-500 font-bold self-end hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Simple static spinner for incoming file (Telegram style) */}
                {m.isIncoming && m.fileId && !m.downloadUrl && !m.text.includes("canceled") && (
                  <div className="flex items-center gap-2">
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full" />
                    <span>{m.text}</span>
                  </div>
                )}

                {/* Render regular message text */}
                {!m.isOutgoing && !m.isIncoming && !m.downloadUrl && <span>{m.text}</span>}

                {/* Complete Image Preview CARD */}
                {isImageFile && (
                  <div className="flex flex-col gap-2">
                    <img
                      src={m.downloadUrl}
                      alt="P2P shared pic"
                      className="max-h-60 max-w-full rounded-lg object-contain border border-zinc-700 bg-black cursor-pointer"
                      onClick={() => window.open(m.downloadUrl, "_blank")}
                    />
                    <a
                      href={m.downloadUrl}
                      download={m.text.replace("File ready: ", "").replace("File sent: ", "").replace("📁 ", "")}
                      className="text-xs text-emerald-950 hover:underline flex items-center gap-1 mt-1 justify-end font-bold"
                    >
                      <Download className="w-3 h-3" /> Save Image
                    </a>
                  </div>
                )}

                {/* Complete Video Preview CARD */}
                {isVideoFile && (
                  <div className="flex flex-col gap-2">
                    <video
                      src={m.downloadUrl}
                      controls
                      className="max-h-60 max-w-full rounded-lg border border-zinc-700 bg-black"
                    />
                    <a
                      href={m.downloadUrl}
                      download={m.text.replace("File ready: ", "").replace("File sent: ", "").replace("📁 ", "")}
                      className="text-xs text-emerald-950 hover:underline flex items-center gap-1 mt-1 justify-end font-bold"
                    >
                      <Download className="w-3 h-3" /> Save Video
                    </a>
                  </div>
                )}

                {/* Complete Generic File CARD */}
                {isGenericFile && (
                  <div className="flex items-center gap-3 p-1">
                    <FileText className="w-6 h-6 opacity-80" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate text-xs">{m.text.replace("File ready: ", "").replace("File sent: ", "").replace("📁 ", "")}</p>
                      <a
                        href={m.downloadUrl}
                        download={m.text.replace("File ready: ", "").replace("File sent: ", "").replace("📁 ", "")}
                        className={`text-xs hover:underline font-bold flex items-center gap-1 mt-0.5 ${m.mine ? "text-emerald-950" : "text-emerald-400"}`}
                      >
                        <Download className="w-3 h-3" /> Download File
                      </a>
                    </div>
                  </div>
                )}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-zinc-800/50 bg-zinc-900/40 p-4 items-center">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!connected}
          className="p-2.5 rounded-full border border-zinc-700/80 bg-zinc-800/50 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 flex items-center justify-center cursor-pointer transition-colors"
          title="Attach File"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="flex-1 rounded-full bg-zinc-800/80 border border-zinc-700/50 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 transition-all text-white"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="p-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 disabled:opacity-40 cursor-pointer transition-colors shadow-lg shadow-emerald-500/20"
          title="Send Message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
