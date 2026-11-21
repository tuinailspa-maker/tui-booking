import { buildBillLines } from "@/data/billing";
import { serviceById, type ServiceAddOnKey } from "@/data/serviceTree";
import { surchargeLinkKey } from "@/data/squareServiceMap";
import type { SquareServiceVariation } from "@/data/squareVariations";

export type AppointmentSegment = { duration_minutes: number; service_variation_id: string; service_variation_version: number; team_member_id: string };

export class SegmentMappingError extends Error {
  constructor(
    readonly code: "SERVICE_VARIATION_NOT_FOUND" | "SURCHARGE_VARIATION_NOT_FOUND" | "NO_BOOKABLE_SERVICE",
    readonly field: string | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One segment per service at its base duration, followed by a segment for its option surcharge
 * (e.g. "+ Extra Strong Calcium gel") at the add-on's duration, so Square bills base + surcharge.
 * Prices and minutes come from serviceTree; a missing surcharge variation fails rather than under-billing.
 */
export function buildGuestSegments(
  serviceIds: string[],
  addOns: Record<string, ServiceAddOnKey>,
  live: Map<string, SquareServiceVariation>,
  teamMemberId: string,
): AppointmentSegment[] {
  const segments: AppointmentSegment[] = [];
  let unmappedMinutes = 0;
  for (const line of buildBillLines([serviceIds], [addOns])[0] ?? []) {
    const service = serviceById.get(line.serviceId);
    const variation = live.get(line.serviceId);
    if (!service || !variation) {
      if (line.square) {
        throw new SegmentMappingError("SERVICE_VARIATION_NOT_FOUND", line.serviceId, `"${line.nameEn}" has no bookable Square variation. Run the Square catalog sync in the admin.`);
      }
      unmappedMinutes += line.durationMinutes;
      continue;
    }
    const addOnMinutes = line.addOnKey && service.addOn ? service.addOn.durationMinutes : 0;
    segments.push({ duration_minutes: line.durationMinutes - addOnMinutes, service_variation_id: variation.variationId, service_variation_version: variation.version, team_member_id: teamMemberId });
    if (line.addOnKey) {
      const surcharge = live.get(surchargeLinkKey(line.serviceId, line.addOnKey));
      if (!surcharge) {
        throw new SegmentMappingError(
          "SURCHARGE_VARIATION_NOT_FOUND",
          surchargeLinkKey(line.serviceId, line.addOnKey),
          `"${line.nameEn} + ${line.addOnNameEn ?? line.addOnKey}" has no Square surcharge variation. Run the Square catalog sync in the admin.`,
        );
      }
      segments.push({ duration_minutes: addOnMinutes, service_variation_id: surcharge.variationId, service_variation_version: surcharge.version, team_member_id: teamMemberId });
    }
  }
  if (segments.length === 0) {
    throw new SegmentMappingError("NO_BOOKABLE_SERVICE", null, "No selected service exists in the Square booking catalog.");
  }
  segments[segments.length - 1].duration_minutes += unmappedMinutes;
  return segments;
}
