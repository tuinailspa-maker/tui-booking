import { NextResponse } from "next/server";
import { canAttemptPin, clearAdminSession, clearPinFailures, issueAdminSession, recordPinFailure } from "@/data/adminAuth";
import { resolveTeamPin, verifyAdminSession } from "@/data/teamAccess";

const NO_STORE = { "Cache-Control": "no-store" };

function clientKey(request: Request) {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(request: Request) {
  const key = clientKey(request);
  if (!canAttemptPin(key)) {
    return NextResponse.json({ error: "Too many PIN attempts. Try again in 15 minutes." }, { status: 429, headers: NO_STORE });
  }
  const body = await request.json().catch(() => null);
  let session;
  try {
    session = await resolveTeamPin(body?.pin);
  } catch {
    return NextResponse.json({ error: "Staff access is temporarily unavailable. Try again shortly." }, { status: 503, headers: NO_STORE });
  }
  if (!session) {
    recordPinFailure(key);
    return NextResponse.json({ error: "Incorrect PIN." }, { status: 401, headers: NO_STORE });
  }
  clearPinFailures(key);
  const response = NextResponse.json({ authenticated: true, ...session }, { headers: NO_STORE });
  issueAdminSession(response, session);
  return response;
}

export async function GET(request: Request) {
  let session;
  try {
    session = await verifyAdminSession(request);
  } catch {
    return NextResponse.json({ error: "Staff access is temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(session ? { authenticated: true, ...session } : { authenticated: false }, {
    status: session ? 200 : 401,
    headers: NO_STORE,
  });
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  clearAdminSession(response);
  return response;
}
