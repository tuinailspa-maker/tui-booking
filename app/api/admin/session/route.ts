import { NextResponse } from "next/server";
import { canAttemptPin, clearAdminSession, clearPinFailures, isAdminRequestAuthorized, issueAdminSession, recordPinFailure, validateAdminPin } from "@/data/adminAuth";

function clientKey(request: Request) {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(request: Request) {
  const key = clientKey(request);
  if (!canAttemptPin(key)) {
    return NextResponse.json({ error: "Too many PIN attempts. Try again in 15 minutes." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const body = await request.json().catch(() => null);
  if (!validateAdminPin(body?.pin)) {
    recordPinFailure(key);
    return NextResponse.json({ error: "Incorrect PIN." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  clearPinFailures(key);
  const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  issueAdminSession(response);
  return response;
}

export async function GET(request: Request) {
  const authenticated = isAdminRequestAuthorized(request);
  return NextResponse.json({ authenticated }, {
    status: authenticated ? 200 : 401,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  clearAdminSession(response);
  return response;
}
