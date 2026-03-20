/**
 * Binary file detection by extension and content inspection.
 */

const BINARY_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".tiff", ".tif",
  // Fonts
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  // Documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  // Archives
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".zst",
  // Compiled / binaries
  ".exe", ".dll", ".so", ".dylib", ".wasm", ".class", ".pyc", ".pyo",
  ".o", ".obj", ".a", ".lib", ".bin",
  // Media
  ".mp3", ".mp4", ".mov", ".avi", ".wav", ".flac", ".ogg", ".webm", ".mkv",
  // Data / databases
  ".dat", ".db", ".sqlite", ".sqlite3",
  // Lock files (often huge, machine-generated)
  ".lock",
  // Source maps
  ".map",
  // Java archives
  ".jar", ".war", ".ear",
  // .NET
  ".nupkg",
]);

/**
 * Check if a file extension is known to be binary.
 */
export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Inspect raw bytes for null characters — a strong binary indicator.
 * Checks the first 8KB of content.
 */
export function contentLooksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0x00) return true;
  }
  return false;
}
