import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { resolveSquareBookingVariation } from "@/data/squareVariations";

const PRODUCTION_URL = "https://connect.squareup.com/v2";
const SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
const DAY_MS = 24 * 60 * 60 * 1000;

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? SANDBOX_URL : PRODUCTION_URL;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
    "Square-Version": SQUARE_API_VERSION,
    "Content-Type": "application/json",
  };
}

export async function getSquareAvailableStarts(teamMemberId: string, rangeStartMs: number, rangeEndMs: number, locationId: string): Promise<Map<number, number>> {
  const variation = await resolveSquareBookingVariation();
  const response = await fetch(`${squareBaseUrl()}/bookings/availability/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      query: {
        filter: {
          start_at_range: {
            start_at: new Date(rangeStartMs).toISOString(),
            end_at: new Date(rangeEndMs).toISOString(),
          },
          location_id: locationId,
          segment_filters: [{
            service_variation_id: variation.id,
            team_member_id_filter: { any: [teamMemberId] },
          }],
        },
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errors?.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ") || "Square availability search failed.");

  return new Map<number, number>((data.availabilities ?? []).flatMap((availability: {
    start_at?: string;
    appointment_segments?: { duration_minutes?: number; team_member_id?: string }[];
  }) => {
    const start = Date.parse(availability.start_at ?? "");
    const segment = availability.appointment_segments?.find((item) => item.team_member_id === teamMemberId);
    return Number.isFinite(start) && segment ? [[start, segment.duration_minutes ?? 0]] : [];
  }));
}

export async function isSquareSlotAvailable(teamMemberId: string, startMs: number, durationMinutes: number, locationId: string): Promise<boolean> {
  const rangeStart = Math.max(Date.now(), startMs - DAY_MS / 2);
  const starts = await getSquareAvailableStarts(teamMemberId, rangeStart, rangeStart + DAY_MS, locationId);
  for (let offsetMinutes = 0; offsetMinutes < durationMinutes; offsetMinutes += 30) {
    if (!starts.has(startMs + offsetMinutes * 60_000)) return false;
  }
  return true;
}
