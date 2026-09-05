import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashOtp(otpCode: string): string {
  return createHash("sha256").update(`sos-otp:${otpCode}`).digest("hex");
}

export function otpEquals(provided: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(provided));
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function httpError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
