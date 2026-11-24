import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "tui_admin_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 8;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

export type AdminRole = "owner" | "staff";
export type AdminSession = { role: AdminRole; name: string; issuedAt?: number };

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.SQUARE_ACCESS_TOKEN || process.env.ADMIN_PIN || "1570";
}

function encodePart(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(expiresAt: string, role: string, name: string) {
  return createHmac("sha256", sessionSecret()).update(`tui-admin:v2:${expiresAt}:${role}:${name}`).digest("hex");
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function ownerMasterPin() {
  return process.env.ADMIN_PIN || "1570";
}

export function validateAdminPin(value: unknown) {
  const expected = ownerMasterPin();
  return typeof value === "string" && /^\d{4}$/.test(expected) && /^\d{4}$/.test(value) && safeEqual(value, expected);
}

export function getAdminSession(request: Request): AdminSession | null {
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  const token = cookie?.slice(ADMIN_SESSION_COOKIE.length + 1);
  if (!token) return null;
  const [expiresAt, encodedRole, encodedName, suppliedSignature] = token.split(".");
  if (!expiresAt || !encodedRole || !encodedName || !suppliedSignature || !/^\d{13}$/.test(expiresAt) || Number(expiresAt) <= Date.now()) return null;
  let role: string;
  let name: string;
  try {
    role = decodePart(encodedRole);
    name = decodePart(encodedName);
  } catch {
    return null;
  }
  if ((role !== "owner" && role !== "staff") || !name) return null;
  if (!safeEqual(suppliedSignature, signature(expiresAt, role, name))) return null;
  return { role, name, issuedAt: Number(expiresAt) - SESSION_LIFETIME_SECONDS * 1000 };
}

export function isAdminRequestAuthorized(request: Request) {
  return getAdminSession(request) !== null;
}

export function isOwnerRequest(request: Request) {
  return getAdminSession(request)?.role === "owner";
}

export function issueAdminSession(response: NextResponse, session: AdminSession) {
  const expiresAt = String(Date.now() + SESSION_LIFETIME_SECONDS * 1000);
  const token = [expiresAt, encodePart(session.role), encodePart(session.name), signature(expiresAt, session.role, session.name)].join(".");
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });
}

export function clearAdminSession(response: NextResponse) {
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export function canAttemptPin(clientKey: string) {
  const now = Date.now();
  const attempt = failedAttempts.get(clientKey);
  if (!attempt || attempt.resetAt <= now) {
    failedAttempts.set(clientKey, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  return attempt.count < 5;
}

export function recordPinFailure(clientKey: string) {
  const attempt = failedAttempts.get(clientKey);
  if (attempt) attempt.count += 1;
}

export function clearPinFailures(clientKey: string) {
  failedAttempts.delete(clientKey);
}
