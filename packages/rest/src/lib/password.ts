import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await new Promise<string>((resolve, reject) => {
    scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      resolve(derived.toString("hex"));
    });
  });
  return `${salt}:${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      resolve(derived);
    });
  });
  return timingSafeEqual(Buffer.from(hash, "hex"), derived);
}
