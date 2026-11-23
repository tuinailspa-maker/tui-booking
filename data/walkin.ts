import { selectedServiceDuration, serviceById, serviceDisplayNameWithAddOn, type ServiceLeaf } from "@/data/serviceTree";

const KIOSK_SERVICE_PATTERN = /^(hands-|enhancement-|feet-|removal-|repair-|cut-|treatment-|add-on-|waxing-)/;
const MAX_WALKIN_SERVICES = 12;

/** Services a kiosk guest may pick; returns null when the list is empty, too long, or contains unknown ids. */
export function parseWalkinServices(value: unknown): ServiceLeaf[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WALKIN_SERVICES) return null;
  const ids = Array.from(new Set(value));
  const services = ids.map((id) => (typeof id === "string" && KIOSK_SERVICE_PATTERN.test(id) ? serviceById.get(id) : undefined));
  if (services.some((service) => !service || service.priceCad <= 0)) return null;
  return services as ServiceLeaf[];
}

export function parseGuestCount(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3 ? Number(value) : null;
}

export function walkinDurationMinutes(services: ServiceLeaf[]) {
  return services.reduce((sum, service) => sum + selectedServiceDuration(service), 0);
}

export function walkinServiceSummary(services: ServiceLeaf[]) {
  return services.map((service) => `${serviceDisplayNameWithAddOn(service, "en")} — $${service.priceCad} (${selectedServiceDuration(service)} min)`).join("; ");
}
