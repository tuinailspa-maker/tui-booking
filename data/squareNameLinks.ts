import { allServices, serviceDisplayName } from "@/data/serviceTree";
import { SQUARE_SKU_PREFIX } from "@/data/squareServiceMap";

/** What the matcher needs to know about one Square variation, whatever shape the caller holds it in. */
export type NameLinkCandidate = {
  id: string;
  /** Variation name, item name, and combinations of both. */
  names: string[];
  sku: string | null;
};

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2012-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Every spelling under which a service may already exist in Square: EN, FR, and the bilingual label the sync writes. */
function serviceNameKeys(serviceId: string): string[] {
  const service = allServices.find((item) => item.id === serviceId);
  if (!service) return [];
  const en = serviceDisplayName(service, "en");
  const fr = serviceDisplayName(service, "fr");
  return Array.from(new Set([en, fr, `${en} - ${fr}`, `${en} / ${fr}`].map(normalizeName)));
}

/** Names a Square variation can be recognised by: its own name, its item's name, and "item / variation". */
export function variationNameKeys(itemName: string | undefined, variationName: string | undefined, itemHasSingleVariation: boolean): string[] {
  const item = itemName?.trim() ?? "";
  const variation = variationName?.trim() ?? "";
  const names = [variation];
  if (item && itemHasSingleVariation) names.push(item);
  if (item && variation) names.push(`${item} / ${variation}`, `${item} - ${variation}`, `${item} ${variation}`);
  return names.filter(Boolean).map(normalizeName);
}

/**
 * Links services that have no SKU/seeded variation yet to an existing Square variation with the same
 * name, so the catalog sync adopts a hand-made variation (tagging it with the service SKU) instead of
 * creating a duplicate. Only exact normalized names match, a variation is never given to two services,
 * and variations that already belong to another service (a TUI- SKU) are left alone.
 */
export function linkServicesByName<T>(pendingServiceIds: string[], variations: T[], describe: (variation: T) => NameLinkCandidate, claimedVariationIds: Set<string>): Map<string, T> {
  const byName = new Map<string, T[]>();
  for (const variation of variations) {
    const candidate = describe(variation);
    if (claimedVariationIds.has(candidate.id)) continue;
    if (candidate.sku?.startsWith(SQUARE_SKU_PREFIX)) continue;
    for (const name of new Set(candidate.names)) {
      const list = byName.get(name) ?? [];
      list.push(variation);
      byName.set(name, list);
    }
  }

  const links = new Map<string, T>();
  const taken = new Set<string>();
  for (const serviceId of pendingServiceIds) {
    for (const key of serviceNameKeys(serviceId)) {
      const match = byName.get(key)?.find((variation) => !taken.has(describe(variation).id));
      if (!match) continue;
      links.set(serviceId, match);
      taken.add(describe(match).id);
      break;
    }
  }
  return links;
}
