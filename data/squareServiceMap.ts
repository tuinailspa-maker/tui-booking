export type SquareServiceMapping = {
  variationId: string;
  version: number;
  priceCents: number;
  durationMinutes: number;
  squareName: string;
};

/**
 * Internal service id -> exact Square catalog variation (production catalog, synced 2026-11-20).
 * Durations here are the Square catalog durations and are applied to the internal menu, so
 * booked appointment length always equals Square. `version` is a fallback; the live catalog
 * version is resolved by variation id at booking time.
 * Services set to null have no matching Square variation and are billed as custom line items.
 */
export const SQUARE_SERVICE_MAP: Record<string, SquareServiceMapping | null> = {
  "hands-manicure-no-polish": { variationId: "AUWT5PU54JOUEA7SIC6KXFOX", version: 1771179712471, priceCents: 2000, durationMinutes: 30, squareName: "Natural Manicure - No Polish / Manicure No Polish" },
  "hands-manicure-regular-polish": { variationId: "PKOOHSC73ENLJAQOROD7IO7X", version: 1792895639204, priceCents: 2500, durationMinutes: 30, squareName: "Natural Manicure - Regular Polish / Manicure Regular Polish" },
  "hands-manicure-shellac": { variationId: "WRJQ6JQGLQ6W35ALKZVXR4L6", version: 1774057169506, priceCents: 3500, durationMinutes: 30, squareName: "Natural Manicure - Gel Polish / Manicure Shellac" },
  "hands-touch-up-regular": { variationId: "TOXMDVIPSVMBX342YIIPTMYK", version: 1769569759725, priceCents: 1800, durationMinutes: 20, squareName: "Polish Change - Hands / Regular Polish" },
  "hands-touch-up-shellac": { variationId: "ZSHWQDCDUOG5BX7I7FIHQCT2", version: 1770871124112, priceCents: 3000, durationMinutes: 30, squareName: "Polish Change - Hands / Shellac / Gel Polish" },
  "enhancement-new-no-polish": { variationId: "F3RADO6S7U4OU3D6FJYBK3JS", version: 1793181108126, priceCents: 5500, durationMinutes: 60, squareName: "Nail Enhancement (Acrylic) / New Set" },
  "enhancement-new-regular-polish": { variationId: "F3RADO6S7U4OU3D6FJYBK3JS", version: 1793181108126, priceCents: 5500, durationMinutes: 60, squareName: "Nail Enhancement (Acrylic) / New Set" },
  "enhancement-new-shellac": { variationId: "F3RADO6S7U4OU3D6FJYBK3JS", version: 1793181108126, priceCents: 5500, durationMinutes: 60, squareName: "Nail Enhancement (Acrylic) / New Set" },
  "enhancement-refill-no-polish": { variationId: "LZ3DQGK5CYHYVEFCLDTL4PLF", version: 1792895639204, priceCents: 4700, durationMinutes: 60, squareName: "Nail Enhancement (Acrylic) / Refill" },
  "enhancement-refill-regular-polish": { variationId: "LZ3DQGK5CYHYVEFCLDTL4PLF", version: 1792895639204, priceCents: 4700, durationMinutes: 60, squareName: "Nail Enhancement (Acrylic) / Refill" },
  "enhancement-refill-shellac": { variationId: "LZ3DQGK5CYHYVEFCLDTL4PLF", version: 1792895639204, priceCents: 4700, durationMinutes: 60, squareName: "Nail Enhancement (Acrylic) / Refill" },
  "feet-pedicure-no-polish": { variationId: "7QAOQ7KM6K6VEUN7UJN5NPZR", version: 1770871124112, priceCents: 3500, durationMinutes: 30, squareName: "Pedicure - No Polish / Classic Pedicure" },
  "feet-pedicure-regular-polish": { variationId: "LEWKVQPZ6VEV7KVB4P46SQAI", version: 1770871124112, priceCents: 4000, durationMinutes: 45, squareName: "Pedicure - Regular Polish / Pedicure Regular Polish" },
  "feet-pedicure-shellac": { variationId: "PKRJZPJ3CZXKSSMN3RR2336P", version: 1772026879189, priceCents: 5000, durationMinutes: 45, squareName: "Pedicure - Gel Polish / Pedicure Shellac / Gel Polish" },
  "feet-touch-up-regular-polish": { variationId: "JGXKUGNEHH3TF5Q7TMHNN4XK", version: 1769569240821, priceCents: 2200, durationMinutes: 20, squareName: "Polish Change - Feets / Regular Polish" },
  "feet-touch-up-shellac": { variationId: "H727FHXRLSTN2EX4M5S564QX", version: 1769569240821, priceCents: 3200, durationMinutes: 30, squareName: "Polish Change - Feets / Shellac / Gel Polish" },
  "removal-none": null,
  "removal-shellac": { variationId: "ZOFFW6LU7HND66OJCZFQUFBI", version: 1769575946672, priceCents: 1500, durationMinutes: 15, squareName: "Nails Removal / Shellac / Gel Polish" },
  "removal-enhancement": { variationId: "3I62NHQKZ72KGDFUJ4TLUUA5", version: 1769575946672, priceCents: 2000, durationMinutes: 30, squareName: "Nails Removal / Nail Enhancements" },
  "repair-1-2-nails": { variationId: "XELNVF2NFBOYD7VP7RJ42YBA", version: 1792895639204, priceCents: 1000, durationMinutes: 20, squareName: "Nails Repair / 1-3 nails" },
  "repair-5-nails-plus": { variationId: "MJQK47AEBOI5NCZAW5RQFHQK", version: 1792895639204, priceCents: 1500, durationMinutes: 30, squareName: "Nails Repair / 5 nails and plus" },
  "cut-nails-option-1": { variationId: "QUOBFYFCM6G6BEDZPVEZDPUJ", version: 1769575292435, priceCents: 1500, durationMinutes: 10, squareName: "Nails Cut - File / Natural Nails" },
  "cut-nails-option-2": { variationId: "J53TZ27VU7TQSZWP3YEIXWKP", version: 1769575292435, priceCents: 2000, durationMinutes: 20, squareName: "Nails Cut - File / Fake nails" },
  "treatment-paraffin-feet": { variationId: "RKS3EXGDYZM6CNDDKFZ7GXMO", version: 1769797417358, priceCents: 1500, durationMinutes: 15, squareName: "Paraffin Treatment / Feets" },
  "treatment-paraffin-hands": { variationId: "IIACFORY5MG3YPM5MLTJ6TWA", version: 1769797417358, priceCents: 1200, durationMinutes: 15, squareName: "Paraffin Treatment / Hands" },
  "treatment-collagen": { variationId: "YIKQK4W7IHGO7XIUT2DR4IRO", version: 1792895639204, priceCents: 1000, durationMinutes: 10, squareName: "Collagen Gloves Traitement / Regular" },
  "treatment-extra-callus-remover": { variationId: "HXKENUCX5BSYCMYI36KZZXYV", version: 1770871124112, priceCents: 2000, durationMinutes: 30, squareName: "Dry & Cracked Skin Repair Treatment / Regular" },
  "add-on-basic-art": { variationId: "BO4HCO22VQRI3EAKO45FZ7QW", version: 1792895639204, priceCents: 1000, durationMinutes: 10, squareName: "Nails Design / Basic Art" },
  "add-on-chrome-cat-eye": { variationId: "JBY2JV24PUVEJSWCSL4BRSSR", version: 1792895639204, priceCents: 1500, durationMinutes: 15, squareName: "Nails Design / Ombré, chrome" },
  "add-on-custom-art": { variationId: "FKYVPE2GSPSEDP6K3B7NWGKV", version: 1792895639204, priceCents: 2500, durationMinutes: 30, squareName: "Nails Design / Hand-painting or 3D gems/charms" },
  "add-on-cuticle-clean-up": { variationId: "DMJWCOKMAHZQLGNGHTNBIKDY", version: 1792895639204, priceCents: 1000, durationMinutes: 10, squareName: "Cuticle Clean-up / Regular" },
  "add-on-calcium-gel": null,
  "waxing-underarm": { variationId: "OTUHLLD345E22WECP25ST6HW", version: 1793180882624, priceCents: 1500, durationMinutes: 10, squareName: "Body Waxing - Under Arm" },
  "waxing-half-arm": { variationId: "TYUFGXFXAXIQ7R6OE6TU637O", version: 1793180882624, priceCents: 2500, durationMinutes: 20, squareName: "Body Waxing - Arms / Half Arm" },
  "waxing-full-arm": { variationId: "BZ6KKYWMUI5KEDR6LZF6SU5K", version: 1793180882624, priceCents: 3000, durationMinutes: 25, squareName: "Body Waxing - Arms / Full Arm" },
  "waxing-back": { variationId: "4OL26RGHBAJISQOTYQ4MNFFV", version: 1793180882624, priceCents: 3500, durationMinutes: 30, squareName: "Body Waxing - Back" },
  "waxing-half-chest": { variationId: "57XHLACQFVJJ2JX3KNOVVVDB", version: 1793180882624, priceCents: 2500, durationMinutes: 15, squareName: "Body Waxing - Chest / Half Chest" },
  "waxing-full-chest": { variationId: "XX45YD3JF6USKFFE6MOO7NVG", version: 1793180882624, priceCents: 4000, durationMinutes: 25, squareName: "Body Waxing - Chest / Full Chest" },
  "waxing-half-leg": { variationId: "4AGE3LTXCFTN6JJVN6XCWYAL", version: 1793180882624, priceCents: 3000, durationMinutes: 20, squareName: "Body Waxing - Legs / Half Legs" },
  "waxing-half-leg-extra": { variationId: "3BQEMSZASRB3M7ARP3DOZXCI", version: 1793180882624, priceCents: 3500, durationMinutes: 25, squareName: "Body Waxing - Legs / Half Legs (Extra Time)" },
  "waxing-full-leg": { variationId: "BQA3QRWG5GIJJQPIEAIYXEQ2", version: 1793180882624, priceCents: 4000, durationMinutes: 30, squareName: "Body Waxing - Legs / Full Legs" },
  "waxing-full-leg-extra": { variationId: "R46MRBVKRXLCZIOZP7P37MQH", version: 1793180882624, priceCents: 4500, durationMinutes: 35, squareName: "Body Waxing - Legs / Full Legs (Extra time)" },
  "waxing-neck": { variationId: "KLYUGM7NVANI52JASG2A2EEZ", version: 1793180882624, priceCents: 1500, durationMinutes: 15, squareName: "Body Waxing - Neck" },
  "waxing-chin": { variationId: "BSMI4NIOLGG4JEJDUR3IKF54", version: 1793180882624, priceCents: 1500, durationMinutes: 15, squareName: "Facial waxing - Chin" },
  "waxing-upper-lip": { variationId: "JPMU6DQMCPYIZZY743N2TE7X", version: 1793180882624, priceCents: 1000, durationMinutes: 10, squareName: "Facial Waxing - Upper Lips" },
  "waxing-eyebrow": { variationId: "FRT3XCB2Y6UNFIGAQXMV3LWT", version: 1793180882624, priceCents: 1200, durationMinutes: 10, squareName: "Facial Waxing - Eyebrows" },
  "waxing-bikini-line": { variationId: "LIITOVATJH4WU6HT26CW4CBZ", version: 1792895639204, priceCents: 2000, durationMinutes: 15, squareName: "Intimate Waxing - Bikini / Line Bikini" },
  "waxing-bikini-full": { variationId: "VM6FC37N23MV7VQ3E3TXPQWJ", version: 1793181108126, priceCents: 3000, durationMinutes: 30, squareName: "Intimate Waxing - Bikini / Full Bikini" },
  "waxing-brazilian-regular": { variationId: "64XZNZPGFUWT5TYTY7IYY4PT", version: 1793180882624, priceCents: 4000, durationMinutes: 30, squareName: "Intimate Waxing - Brazillian / Regular" },
  "waxing-brazilian-extra": { variationId: "EN7F336UB4DWTKWCZXGFDIQK", version: 1793180882624, priceCents: 4500, durationMinutes: 45, squareName: "Intimate Waxing - Brazillian / Extra times" },
};

export function squareMappingFor(serviceId: string): SquareServiceMapping | null {
  return SQUARE_SERVICE_MAP[serviceId] ?? null;
}

/**
 * The catalog sync tags each Square variation with the SKU `TUI-<serviceId>`, so the link between an
 * internal service and its Square variation lives on Square itself and survives variations the sync
 * creates (split shared variations, missing services). The static map above is only the seed.
 */
export const SQUARE_SKU_PREFIX = "TUI-";

export function squareSkuFor(serviceId: string) {
  return `${SQUARE_SKU_PREFIX}${serviceId}`;
}

export function resolveServiceVariation<T>(
  serviceId: string,
  bySku: Map<string, T>,
  byId: Map<string, T>,
  skuOf: (variation: T) => string | null | undefined,
): T | null {
  const tagged = bySku.get(squareSkuFor(serviceId));
  if (tagged) return tagged;
  const mapping = squareMappingFor(serviceId);
  const seeded = mapping ? byId.get(mapping.variationId) : undefined;
  if (!seeded) return null;
  return skuOf(seeded)?.startsWith(SQUARE_SKU_PREFIX) ? null : seeded;
}
