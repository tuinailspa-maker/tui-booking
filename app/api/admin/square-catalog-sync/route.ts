import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { applyCatalogSync, previewCatalogSync, SquareCatalogSyncError } from "@/data/squareCatalogSync";

const NO_STORE = { "Cache-Control": "no-store" };

function unauthorized() {
  return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: NO_STORE });
}

function failure(error: unknown) {
  if (error instanceof SquareCatalogSyncError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
  }
  const message = error instanceof Error ? error.message : "Unable to sync the Square catalog.";
  return NextResponse.json({ error: message, code: "SQUARE_ERROR" }, { status: 502, headers: NO_STORE });
}

/** Read-only: per-service comparison (`comparison`) and the sync plan, without changing anything on Square. */
export async function GET(request: Request) {
  if (!isAdminRequestAuthorized(request)) return unauthorized();
  try {
    return NextResponse.json(await previewCatalogSync(), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

/** Applies the internal prices and durations to Square via catalog batch-upsert. */
export async function POST(request: Request) {
  if (!isAdminRequestAuthorized(request)) return unauthorized();
  const body = await request.json().catch(() => null);
  if (body?.confirm !== true) {
    return NextResponse.json({ error: "Confirm the sync by sending { \"confirm\": true }." }, { status: 400, headers: NO_STORE });
  }
  try {
    const { plan, updatedCount, before, after } = await applyCatalogSync();
    return NextResponse.json({ ...plan, updatedCount, before, after }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
