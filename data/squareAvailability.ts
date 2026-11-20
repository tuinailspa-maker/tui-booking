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

export async function listActiveSquareTeamMemberIds(locationId: string): Promise<Set<string>> {
  const activeIds = new Set<string>();
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ status: "ACTIVE", limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${squareBaseUrl()}/team-members?${params}`, { headers: headers() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Square could not list active team members.");
    for (const member of data.team_members ?? []) {
      if (member.status === "ACTIVE" && (!Array.isArray(member.location_ids) || member.location_ids.includes(locationId))) {
        activeIds.add(member.id);
      }
    }
    cursor = data.cursor;
  } while (cursor);
  return activeIds;
}

export async function isSquareSlotAvailable(teamMemberId: string, startMs: number, durationMinutes: number, locationId: string): Promise<boolean> {
  const variation = await resolveSquareBookingVariation();
  const response = await fetch(`${squareBaseUrl()}/bookings/availability/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      query: {
        filter: {
          start_at_range: {
            start_at: new Date(startMs - DAY_MS / 2).toISOString(),
            end_at: new Date(startMs + DAY_MS / 2).toISOString(),
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

  return (data.availabilities ?? []).some((availability: {
    start_at?: string;
    appointment_segments?: { duration_minutes?: number; team_member_id?: string }[];
  }) => {
    const slotStart = Date.parse(availability.start_at ?? "");
    const segment = availability.appointment_segments?.find((item) => item.team_member_id === teamMemberId);
    const slotDuration = segment?.duration_minutes ?? 0;
    return slotStart === startMs && slotDuration >= durationMinutes;
  });
}
