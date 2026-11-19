import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "tui_admin_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 8;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.SQUARE_ACCESS_TOKEN || process.env.ADMIN_PIN || "1570";
}

function signature(expiresAt: string) {
  return createHmac("sha256", sessionSecret()).update(`tui-admin:${expiresAt}`).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateAdminPin(value: unknown) {
  const expected = process.env.ADMIN_PIN || "1570";
  return typeof value === "string" && /^\d{4}$/.test(expected) && /^\d{4}$/.test(value) && safeEqual(value, expected);
}

export function isAdminRequestAuthorized(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  const token = cookie?.slice(ADMIN_SESSION_COOKIE.length + 1);
  if (!token) return false;
  const [expiresAt, suppliedSignature] = token.split(".");
  if (!expiresAt || !suppliedSignature || !/^\d{13}$/.test(expiresAt) || Number(expiresAt) <= Date.now()) return false;
  return safeEqual(suppliedSignature, signature(expiresAt));
}

export function issueAdminSession(response: NextResponse) {
  const expiresAt = String(Date.now() + SESSION_LIFETIME_SECONDS * 1000);
  response.cookies.set(ADMIN_SESSION_COOKIE, `${expiresAt}.${signature(expiresAt)}`, {
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
