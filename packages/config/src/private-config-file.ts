import fs from "node:fs";

/** Config documents and their copies can contain plaintext credentials. */
export const PRIVATE_CONFIG_FILE_MODE = 0o600;

/** Tighten existing POSIX files as well as newly created ones. */
export function restrictConfigFileSync(filePath: string): void {
  if (process.platform !== "win32")
    fs.chmodSync(filePath, PRIVATE_CONFIG_FILE_MODE);
}

/** Restrict access before truncating or writing any secret-bearing content. */
export function writePrivateConfigFileSync(
  filePath: string,
  content: string | Buffer,
  exclusive = false,
): void {
  const fd = fs.openSync(
    filePath,
    exclusive ? "wx" : "a",
    PRIVATE_CONFIG_FILE_MODE,
  );
  try {
    fs.fchmodSync(fd, PRIVATE_CONFIG_FILE_MODE);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}
