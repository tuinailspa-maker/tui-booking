import { NextResponse } from "next/server";
import { getStaffRoster } from "@/data/squareStaff";
import { OWNER_SESSION_NAME, isValidPin, listTeamMembers, pinInUse, removeTeamMember, saveTeamMember, isVerifiedOwner } from "@/data/teamAccess";

const NO_STORE = { "Cache-Control": "no-store" };
const ADMIN_LOCATION_ID = "R73A64VPAR34X";
const NAME_PATTERN = /^[\p{L}\p{N} .'-]{1,40}$/u;

function forbidden() {
  return NextResponse.json({ error: "Only the owner can manage team access codes." }, { status: 403, headers: NO_STORE });
}

async function technicianNames() {
  const roster = await getStaffRoster(ADMIN_LOCATION_ID);
  return roster.filter((member) => member.kind === "real").map((member) => member.name);
}

export async function GET(request: Request) {
  if (!await isVerifiedOwner(request)) return forbidden();
  try {
    const [members, technicians] = await Promise.all([listTeamMembers(), technicianNames()]);
    return NextResponse.json({ members, technicians }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Team access codes could not be loaded." }, { status: 503, headers: NO_STORE });
  }
}

export async function PUT(request: Request) {
  if (!await isVerifiedOwner(request)) return forbidden();
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = body?.role;
  const pin = body?.pin;
  if (!NAME_PATTERN.test(name) || name.toLowerCase() === OWNER_SESSION_NAME.toLowerCase() || (role !== "owner" && role !== "staff")) {
    return NextResponse.json({ error: "Enter a valid team member name and role." }, { status: 400, headers: NO_STORE });
  }
  if (!isValidPin(pin)) return NextResponse.json({ error: "Access codes must be exactly 4 digits." }, { status: 400, headers: NO_STORE });
  try {
    if (role === "staff" && !(await technicianNames()).includes(name)) {
      return NextResponse.json({ error: "Technician access codes must match a Square team member." }, { status: 400, headers: NO_STORE });
    }
    if (await pinInUse(pin, name)) {
      return NextResponse.json({ error: "That code is already used by another team member. Choose a different code." }, { status: 409, headers: NO_STORE });
    }
    await saveTeamMember(name, role, pin);
    return NextResponse.json({ members: await listTeamMembers() }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "The access code could not be saved." }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(request: Request) {
  if (!await isVerifiedOwner(request)) return forbidden();
  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!NAME_PATTERN.test(name)) return NextResponse.json({ error: "Choose a team member." }, { status: 400, headers: NO_STORE });
  try {
    await removeTeamMember(name);
    return NextResponse.json({ members: await listTeamMembers() }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "The access code could not be removed." }, { status: 503, headers: NO_STORE });
  }
}
