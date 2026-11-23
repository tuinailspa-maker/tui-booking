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

export const MAX_WALKIN_DAYS_AHEAD = 60;

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A real YYYY-MM-DD date from today (Toronto) up to MAX_WALKIN_DAYS_AHEAD; null otherwise. */
export function parseWalkinDate(value: unknown, today: string): string | null {
  if (value === undefined || value === null || value === "") return today;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (addDays(value, 0) !== value) return null;
  return value >= today && value <= addDays(today, MAX_WALKIN_DAYS_AHEAD) ? value : null;
}

/** "25/11/2026 - 2:15 PM" in Toronto time, for owner SMS and Telegram notices. */
export function ownerDateTimeLabel(iso: string) {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Toronto", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return `${date} - ${time}`;
}

export function walkinDurationMinutes(services: ServiceLeaf[]) {
  return services.reduce((sum, service) => sum + selectedServiceDuration(service), 0);
}

export function walkinServiceSummary(services: ServiceLeaf[]) {
  return services.map((service) => `${serviceDisplayNameWithAddOn(service, "en")} — $${service.priceCad} (${selectedServiceDuration(service)} min)`).join("; ");
}
