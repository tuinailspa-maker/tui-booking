import { connection, NextResponse } from "next/server";
import { getSquareSyncVersion } from "@/data/squareSync";

export async function GET() {
  await connection();
  try {
    const version = await getSquareSyncVersion();
    return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[v0] Square sync version lookup failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ version: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
