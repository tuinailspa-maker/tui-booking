import { NextResponse } from "next/server";
import { listSquareServiceVariations } from "@/data/squareVariations";

export async function GET() {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Square is not configured." }, { status: 500 });
  }

  try {
    return NextResponse.json({ variations: await listSquareServiceVariations() });
  } catch (error) {
    console.error("[v0] Square variation lookup failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load Square service variations." }, { status: 502 });
  }
}
