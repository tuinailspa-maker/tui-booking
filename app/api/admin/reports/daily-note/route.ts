import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/data/teamAccess";
import { MAX_NOTE_LENGTH, readDailyNote, saveDailyNote } from "@/data/dailyNotes";

const noStore = { "Cache-Control": "no-store" };

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function GET(request: Request) {
  const session = await verifyAdminSession(request);
  if (!session) return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: noStore });
  const date = new URL(request.url).searchParams.get("date");
  if (!isDate(date)) return NextResponse.json({ error: "Provide a valid date." }, { status: 400, headers: noStore });
  try {
    return NextResponse.json({ ...(await readDailyNote(session.name, date)), technician: session.name }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Notes storage is temporarily unavailable." }, { status: 503, headers: noStore });
  }
}

export async function PUT(request: Request) {
  const session = await verifyAdminSession(request);
  if (!session) return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: noStore });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: noStore }); }
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isDate(payload.date) || typeof payload.note !== "string") return NextResponse.json({ error: "Provide a date and note." }, { status: 400, headers: noStore });
  if (payload.note.length > MAX_NOTE_LENGTH) return NextResponse.json({ error: `Notes are limited to ${MAX_NOTE_LENGTH} characters.` }, { status: 400, headers: noStore });
  try {
    return NextResponse.json({ ...(await saveDailyNote(session.name, payload.date, payload.note)), technician: session.name }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Notes storage is temporarily unavailable." }, { status: 503, headers: noStore });
  }
}
