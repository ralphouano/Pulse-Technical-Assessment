export const SAFE_DOCUMENT_EXTS = [
  ".pdf", ".txt", ".rtf", ".csv", ".md",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"
];

export const SAFE_IMAGE_EXTS = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif"
];

export const SAFE_VIDEO_EXTS = [
  ".mp4", ".mkv", ".mov", ".avi", ".webm"
];

export const SAFE_ARCHIVE_EXTS = [
  ".zip", ".rar", ".7z", ".tar", ".gz"
];

export const ALL_SAFE_EXTS = [
  ...SAFE_DOCUMENT_EXTS,
  ...SAFE_IMAGE_EXTS,
  ...SAFE_VIDEO_EXTS,
  ...SAFE_ARCHIVE_EXTS
];

export const EXT_TO_MIME: Record<string, string> = {
  // Documents
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  
  // Images
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  
  // Videos
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  
  // Archives
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip"
};

export function getSafeMimeType(name: string): string {
  const nameLower = name.toLowerCase();
  for (const ext of ALL_SAFE_EXTS) {
    if (nameLower.endsWith(ext)) {
      return EXT_TO_MIME[ext] || "application/octet-stream";
    }
  }
  return "application/octet-stream";
}

export function checkIsVideo(name: string, mimeType: string): boolean {
  const nameLower = name.toLowerCase();
  return mimeType.startsWith("video/") || SAFE_VIDEO_EXTS.some(ext => nameLower.endsWith(ext));
}

export function checkIsImage(name: string, mimeType: string): boolean {
  const nameLower = name.toLowerCase();
  return mimeType.startsWith("image/") || SAFE_IMAGE_EXTS.some(ext => nameLower.endsWith(ext));
}

export function verifyMagicBytes(headerBytes: Uint8Array, ext: string): boolean {
  const hex = Array.from(headerBytes)
    .map(b => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");

  // Check magic signatures based on extension
  if (ext === ".jpg" || ext === ".jpeg") {
    return hex.startsWith("FF D8 FF");
  }
  if (ext === ".png") {
    return hex.startsWith("89 50 4E 47 0D 0A 1A 0A");
  }
  if (ext === ".gif") {
    return hex.startsWith("47 49 46 38");
  }
  if (ext === ".webp") {
    return hex.startsWith("52 49 46 46") && hex.substring(24, 35) === "57 45 42 50";
  }
  if (ext === ".bmp") {
    return hex.startsWith("42 4D");
  }
  if (ext === ".pdf") {
    return hex.startsWith("25 50 44 46");
  }
  if (ext === ".mp4") {
    return hex.substring(12, 23) === "66 74 79 70";
  }
  if (ext === ".webm" || ext === ".mkv") {
    return hex.startsWith("1A 45 DF A3");
  }
  if (ext === ".avi") {
    return hex.startsWith("52 49 46 46") && hex.substring(24, 35) === "41 56 49 20";
  }
  if (ext === ".mov") {
    return hex.substring(12, 23) === "66 74 79 70" || hex.includes("6D 6F 6F 76");
  }
  if (ext === ".zip") {
    return hex.startsWith("50 4B 03 04") || hex.startsWith("50 4B 05 06") || hex.startsWith("50 4B 07 08");
  }
  
  return true;
}
