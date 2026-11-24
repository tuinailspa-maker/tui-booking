import { NextResponse } from "next/server";
import { getBookableTechnicians } from "@/data/squareStaff";

export async function GET() {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) {
    return NextResponse.json({ error: "Square is not configured." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const technicians = await getBookableTechnicians(locationId);
    return NextResponse.json(
      { technicians: technicians.map(({ teamMemberId, name, imageUrl }) => ({ id: teamMemberId, name, imageUrl })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[v0] Technician list failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load technicians." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
