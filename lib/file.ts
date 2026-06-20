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

export function checkIsVideo(name: string, mimeType: string): boolean {
  const nameLower = name.toLowerCase();
  return mimeType.startsWith("video/") || SAFE_VIDEO_EXTS.some(ext => nameLower.endsWith(ext));
}

export function checkIsImage(name: string, mimeType: string): boolean {
  const nameLower = name.toLowerCase();
  return mimeType.startsWith("image/") || SAFE_IMAGE_EXTS.some(ext => nameLower.endsWith(ext));
}
