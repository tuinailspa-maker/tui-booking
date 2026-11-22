export type SquareServiceMapping = {
  variationId: string;
  version: number;
  priceCents: number;
  durationMinutes: number;
  squareName: string;
};

/**
 * Internal service id -> exact Square catalog variation (production catalog, reconciled 2026-11-22
 * after the catalog items were recreated). Prices and durations are owned by serviceTree; these
 * values are the Square snapshot. `version` is a fallback; the live catalog version is resolved by
 * variation id at booking time.
 * Services set to null have no matching Square variation and are billed as custom line items.
 */
export const SQUARE_SERVICE_MAP: Record<string, SquareServiceMapping | null> = {
  "hands-manicure-no-polish": { variationId: "AUWT5PU54JOUEA7SIC6KXFOX", version: 1795346741725, priceCents: 2000, durationMinutes: 15, squareName: "Natural Nails / Ongles Naturels / Manicure - No Polish / Manucure - Sans Vernis" },
  "hands-manicure-regular-polish": { variationId: "SWKU7IAWSF3QGJ7CQ5GNNAV7", version: 1795346741725, priceCents: 2500, durationMinutes: 20, squareName: "Natural Nails / Ongles Naturels / Manicure - Regular Polish / Manucure - Vernis Régulier" },
  "hands-manicure-shellac": { variationId: "CQYFF6LVZW6X7CVVMDZHFPB4", version: 1795346741725, priceCents: 3500, durationMinutes: 20, squareName: "Natural Nails / Ongles Naturels / Manicure - Shellac / Manucure - Shellac" },
  "hands-touch-up-regular": { variationId: "OOULVCRLFFWF2UAS6JGGL3DB", version: 1795346741725, priceCents: 1800, durationMinutes: 15, squareName: "Natural Nails / Ongles Naturels / Touch - Up _ Regular Polish / Retouche _ Vernis Régulier" },
  "hands-touch-up-shellac": { variationId: "BO6ERC35I64I5BJWIEBWFGMJ", version: 1795346741725, priceCents: 3000, durationMinutes: 20, squareName: "Natural Nails / Ongles Naturels / Touch - Up _ Shellac / Retouche - Shellac" },
  "enhancement-new-no-polish": { variationId: "TLQZV3NBEQYG4KLNSVZVW5ZN", version: 1795348644615, priceCents: 4000, durationMinutes: 60, squareName: "Nail Enhancement : Acrylic / Builder Gel / Gel X / New set - No polish / Pose Complète _ Sans vernis" },
  "enhancement-new-regular-polish": { variationId: "F6GAKRGNRD7OQGVDAVVYB5GC", version: 1795348644615, priceCents: 5000, durationMinutes: 60, squareName: "Nail Enhancement : Acrylic / Builder Gel / Gel X / New Set / Regular polish — Pose Complète / Vernis Régulier" },
  "enhancement-new-shellac": { variationId: "V7U7NFU2NIUA7PX6DFF3YMP2", version: 1795348644615, priceCents: 5500, durationMinutes: 60, squareName: "Nail Enhancement : Acrylic / Builder Gel / Gel X / New set - Shellac / Pose Complète _ Shellac" },
  "enhancement-refill-no-polish": { variationId: "FBHSKRCUWSBCY6VA6VYYM5KF", version: 1795348644615, priceCents: 3200, durationMinutes: 50, squareName: "Nail Enhancement : Acrylic / Builder Gel / Gel X / Refill - No polish / Remplissage _ Sans vernis" },
  "enhancement-refill-regular-polish": { variationId: "F2PQ63O7B7P77QJVP4QXMQZQ", version: 1795348644615, priceCents: 4200, durationMinutes: 50, squareName: "Nail Enhancement : Acrylic / Builder Gel / Gel X / Refill/ Regular polish — Remplissage / Vernis Régulier" },
  "enhancement-refill-shellac": { variationId: "2TF3PY3HYV4P67HWZNG7JO3U", version: 1795348644615, priceCents: 4700, durationMinutes: 50, squareName: "Nail Enhancement : Acrylic / Builder Gel / Gel X / Refill/ Shellac — Remplissage / Shellac" },
  "feet-pedicure-no-polish": { variationId: "KKSZ7UOXWT36J6ZCD4W67FWN", version: 1795349376211, priceCents: 3500, durationMinutes: 30, squareName: "Les Orteils / Pedicure No Polish / Pédicure Sans Vernis" },
  "feet-pedicure-regular-polish": { variationId: "CAGWBEZKVI6HXRRB6HIUXXTN", version: 1795349376211, priceCents: 4000, durationMinutes: 35, squareName: "Les Orteils / Pedicure Regular Polish / Pédicure Vernis Régulier" },
  "feet-pedicure-shellac": { variationId: "PKRJZPJ3CZXKSSMN3RR2336P", version: 1795349376211, priceCents: 5000, durationMinutes: 35, squareName: "Les Orteils / Pedicure Shellac / Pédicure Shellac" },
  "feet-touch-up-regular-polish": { variationId: "BAYDNRAJ7QO3OS4LKRSU2ZSY", version: 1795349376211, priceCents: 2200, durationMinutes: 15, squareName: "Les Orteils / Touch - Up Regular Polish / Retouche Vernis Régulier" },
  "feet-touch-up-shellac": { variationId: "KRU6WD6X5PKWI7DVOVHGL2Q4", version: 1795349376211, priceCents: 3200, durationMinutes: 20, squareName: "Les Orteils / Touch - Up Shellac / Retouche Shellac" },
  "removal-shellac": { variationId: "ZOFFW6LU7HND66OJCZFQUFBI", version: 1795350957909, priceCents: 1500, durationMinutes: 15, squareName: "Removal / Retrait / Shellac / Gel Polish" },
  "removal-enhancement": { variationId: "3I62NHQKZ72KGDFUJ4TLUUA5", version: 1795350957909, priceCents: 2000, durationMinutes: 30, squareName: "Removal / Retrait / Nail Enhancements (Acrylic, Gel X .. )" },
  "repair-1-2-nails": { variationId: "XELNVF2NFBOYD7VP7RJ42YBA", version: 1795236860219, priceCents: 1000, durationMinutes: 15, squareName: "Nails Repair / 1-3 nails" },
  "repair-5-nails-plus": { variationId: "MJQK47AEBOI5NCZAW5RQFHQK", version: 1795236860219, priceCents: 1500, durationMinutes: 25, squareName: "Nails Repair / 5 nails and plus" },
  "cut-nails-option-1": { variationId: "QUOBFYFCM6G6BEDZPVEZDPUJ", version: 1795351072535, priceCents: 1500, durationMinutes: 10, squareName: "Nails Cut - File / Option 1" },
  "cut-nails-option-2": { variationId: "E3BKHQOXLBTM7KXTCPZCC6PW", version: 1795351072535, priceCents: 2000, durationMinutes: 20, squareName: "Nails Cut - File / Option 2" },
  "treatment-paraffin-feet": { variationId: "RKS3EXGDYZM6CNDDKFZ7GXMO", version: 1795351971231, priceCents: 1500, durationMinutes: 10, squareName: "Treatment / Traitement / Paraffin Feets / Paraffine Pieds" },
  "treatment-paraffin-hands": { variationId: "IIACFORY5MG3YPM5MLTJ6TWA", version: 1795351971231, priceCents: 1200, durationMinutes: 10, squareName: "Treatment / Traitement / Paraffin Hands / Paraffine Mains" },
  "treatment-collagen": { variationId: "JT62UYGDQNNMXQZWLXLGPWAJ", version: 1795351971231, priceCents: 1000, durationMinutes: 10, squareName: "Treatment / Traitement / Collagen Hand - Feets / Collagène Pieds - Mains" },
  "add-on-basic-art": { variationId: "BO4HCO22VQRI3EAKO45FZ7QW", version: 1795236860219, priceCents: 1000, durationMinutes: 15, squareName: "Nails Design / Basic Art: French tips, simple lines, or dots." },
  "add-on-chrome-cat-eye": { variationId: "JBY2JV24PUVEJSWCSL4BRSSR", version: 1795236860219, priceCents: 1500, durationMinutes: 15, squareName: "Nails Design / Ombré, chrome," },
  "add-on-custom-art": { variationId: "FKYVPE2GSPSEDP6K3B7NWGKV", version: 1795236860219, priceCents: 2500, durationMinutes: 45, squareName: "Nails Design / Hand-painting or 3D gems/charms." },
  "add-on-cuticle-clean-up": { variationId: "DMJWCOKMAHZQLGNGHTNBIKDY", version: 1795349628428, priceCents: 1000, durationMinutes: 5, squareName: "Cuticle Clean-up / Nettoyage des Cuticules / Regular" },
  "waxing-underarm": { variationId: "KLYUGM7NVANI52JASG2A2EEZ", version: 1795353198618, priceCents: 1500, durationMinutes: 10, squareName: "Body Waxing / Épilation du Corps / Under Arm / Aisselles" },
  "waxing-half-arm": { variationId: "62OI6DVZSH35XHEOG47CNFJ7", version: 1795353004719, priceCents: 2500, durationMinutes: 20, squareName: "Body Waxing / Épilation du Corps / Half Arm / Demi Bras" },
  "waxing-full-arm": { variationId: "U5X2LFI2MHS2WECQ2FJQFKVD", version: 1795353004719, priceCents: 3000, durationMinutes: 25, squareName: "Body Waxing / Épilation du Corps / Full Arm / Bras Complet" },
  "waxing-back": { variationId: "HHVXHRVYCOKPV264TFPI7YRO", version: 1795353004719, priceCents: 3500, durationMinutes: 30, squareName: "Body Waxing / Épilation du Corps / Back / Dos" },
  "waxing-half-chest": { variationId: "DT6G3DULXQPPFMYTVND55NU7", version: 1795353004719, priceCents: 2500, durationMinutes: 15, squareName: "Body Waxing / Épilation du Corps / Half Chest / Torse Demi" },
  "waxing-full-chest": { variationId: "IDEQM5OMS4XW2SBJHZZTVLMX", version: 1795353004719, priceCents: 4000, durationMinutes: 25, squareName: "Body Waxing / Épilation du Corps / Full Chest / Torse Complet" },
  "waxing-half-leg": { variationId: "56ZK4LPBPQYUK5A3HKUUSNXF", version: 1795353004719, priceCents: 3000, durationMinutes: 20, squareName: "Body Waxing / Épilation du Corps / Half Legs / Demi-Jambes" },
  "waxing-half-leg-extra": { variationId: "QJZTCM4XBVIGEL6F43WRH5C5", version: 1795353004719, priceCents: 3500, durationMinutes: 25, squareName: "Body Waxing / Épilation du Corps / (Extra time ) Legs / Demi-Jambes" },
  "waxing-full-leg": { variationId: "RKPWJ5TLQXT6N6PPNIXUF574", version: 1795353198618, priceCents: 4000, durationMinutes: 30, squareName: "Body Waxing / Épilation du Corps / Full Legs / Jambes Complètes" },
  "waxing-full-leg-extra": { variationId: "G756OCKDOESPFVBKRBK4LCYS", version: 1795353198618, priceCents: 4500, durationMinutes: 35, squareName: "Body Waxing / Épilation du Corps / ( Extra Time ) Full Legs / Jambes Complètes" },
  "waxing-neck": { variationId: "RC3PGYVPYP5FXSKTXKBV7DZW", version: 1795353198618, priceCents: 1500, durationMinutes: 15, squareName: "Body Waxing / Épilation du Corps / Neck / Cou" },
  "waxing-chin": { variationId: "RAL2CZQ7A5VGZ6FMB5HQVNDW", version: 1795354272774, priceCents: 1500, durationMinutes: 10, squareName: "Facial waxing / Visage Épilation / Chin / Menton" },
  "waxing-upper-lip": { variationId: "BSMI4NIOLGG4JEJDUR3IKF54", version: 1795354272774, priceCents: 1000, durationMinutes: 5, squareName: "Facial waxing / Visage Épilation / Upper Lip / Lèvre Supérieure" },
  "waxing-eyebrow": { variationId: "ROHCC52F6XXA5VEDXAMD2FNN", version: 1795354272774, priceCents: 1200, durationMinutes: 10, squareName: "Facial waxing / Visage Épilation / Eyebrow / Sourcils" },
  "waxing-bikini-line": { variationId: "LIITOVATJH4WU6HT26CW4CBZ", version: 1795354831758, priceCents: 2000, durationMinutes: 15, squareName: "Intimate Waxing / Intime Épilation / Bikini Line / Bikini Ligne" },
  "waxing-bikini-full": { variationId: "VM6FC37N23MV7VQ3E3TXPQWJ", version: 1795354831758, priceCents: 3000, durationMinutes: 25, squareName: "Intimate Waxing / Intime Épilation / Full Bikini / Intégral Complet" },
  "waxing-brazilian-regular": { variationId: "PL5GGL7QO5A3AGJ6JK2JSEDF", version: 1795354831758, priceCents: 4000, durationMinutes: 30, squareName: "Intimate Waxing / Intime Épilation / Brazilian / Brésilien" },
  "waxing-brazilian-extra": { variationId: "CWTECOKPFJNCIYZCNSTXLM5R", version: 1795354831758, priceCents: 4500, durationMinutes: 35, squareName: "Intimate Waxing / Intime Épilation / ( Extra Time ) Brazilian / Brésilien" },
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

export const SURCHARGE_SKU_MARKER = "--addon-";

/** Option surcharges (e.g. "+ Extra Strong Calcium gel") get their own SKU-tagged Square variation. */
export function squareSurchargeSkuFor(serviceId: string, addOnKey: string) {
  return `${SQUARE_SKU_PREFIX}${serviceId}${SURCHARGE_SKU_MARKER}${addOnKey}`;
}

export const surchargeLinkKey = (serviceId: string, addOnKey: string) => `${serviceId}:${addOnKey}`;

/**
 * The reconciled map wins whenever its variation still exists, because SKU tags on Square can be
 * stale (a recreated item can carry another service's tag). The SKU tag is only the fallback for
 * variations the catalog sync created itself.
 */
export function resolveServiceVariation<T>(serviceId: string, bySku: Map<string, T>, byId: Map<string, T>): T | null {
  const mapping = squareMappingFor(serviceId);
  const seeded = mapping ? byId.get(mapping.variationId) : undefined;
  return seeded ?? bySku.get(squareSkuFor(serviceId)) ?? null;
}
