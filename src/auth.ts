import * as crypto from "crypto";
import { IncomingMessage } from "http";
import { TLSSocket } from "tls";

const SESSION_COOKIE_NAME = "multiprox_session";

export interface SessionResult {
  valid: boolean;
  userId?: string;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(str: string): Buffer | null {
  try {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad === 2) b64 += "==";
    else if (pad === 3) b64 += "=";
    else if (pad === 1) return null;
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

export function verifyPassword(password: string, expectedHash: string): boolean {
  const hash = hashPassword(password);
  return timingSafeEqualHex(hash, expectedHash.toLowerCase());
}

export function createSessionToken(userId: string, secret: string, ttlSec: number): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${userId}|${expiry}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const token = `${payload}|${sig}`;
  return base64UrlEncode(Buffer.from(token, "utf8"));
}

export function validateSessionToken(token: string, secret: string): SessionResult {
  const decoded = base64UrlDecode(token);
  if (!decoded) {
    return { valid: false };
  }

  const parts = decoded.toString("utf8").split("|");
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [userId, expiryStr, sig] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (!userId || !Number.isFinite(expiry)) {
    return { valid: false };
  }

  const payload = `${userId}|${expiry}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (!timingSafeEqualHex(sig, expectedSig)) {
    return { valid: false };
  }

  if (Math.floor(Date.now() / 1000) > expiry) {
    return { valid: false };
  }

  return { valid: true, userId };
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export function getSessionFromCookies(
  cookieHeader: string | undefined,
  secret: string
): SessionResult {
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return { valid: false };
  }
  return validateSessionToken(token, secret);
}

export function getSessionTokenFromCookies(cookieHeader: string | undefined): string | null {
  const cookies = parseCookies(cookieHeader);
  return cookies[SESSION_COOKIE_NAME] ?? null;
}

export function isSecureRequest(req: IncomingMessage): boolean {
  const socket = req.socket;
  if (socket instanceof TLSSocket && socket.encrypted) {
    return true;
  }
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.split(",")[0].trim().toLowerCase() === "https") {
    return true;
  }
  return false;
}

export function setSessionCookie(
  secret: string,
  ttlSec: number,
  userId = "user",
  secure = false
): string {
  const token = createSessionToken(userId, secret, ttlSec);
  const expires = new Date(Date.now() + ttlSec * 1000).toUTCString();
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires}${secureFlag}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
