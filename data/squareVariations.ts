import { SQUARE_API_VERSION } from "@/data/squareConfig";

const PRODUCTION_URL = "https://connect.squareup.com/v2";
const SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
const CACHE_TTL_MS = 10 * 60 * 1000;
const PREFERRED_SERVICE_NAMES = new Set(["web appointment", "online booking"]);

type SquareCatalogVariation = {
  id?: string;
  type?: string;
  is_deleted?: boolean;
  version?: number;
  item_variation_data?: {
    name?: string;
    service_duration?: number;
    available_for_booking?: boolean;
    price_money?: { amount?: number; currency?: string };
  };
};

type SquareCatalogItem = {
  id?: string;
  type?: string;
  item_data?: {
    name?: string;
    variations?: SquareCatalogVariation[];
  };
};

type SquareCatalogResponse = {
  objects?: (SquareCatalogItem | SquareCatalogVariation)[];
  related_objects?: SquareCatalogVariation[];
  cursor?: string;
  errors?: { detail?: string }[];
};

export type SquareServiceVariation = {
  serviceName: string;
  variationName: string;
  variationId: string;
  version: number;
  durationMinutes: number | null;
  priceCents: number | null;
};

let cachedVariations: { expiresAt: number; variations: SquareServiceVariation[] } | undefined;
let pendingVariations: Promise<SquareServiceVariation[]> | undefined;

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? SANDBOX_URL : PRODUCTION_URL;
}

async function searchSquareCatalog(): Promise<SquareServiceVariation[]> {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) throw new Error("SQUARE_ACCESS_TOKEN is missing.");

  const variations = new Map<string, SquareCatalogVariation>();
  const serviceNamesByVariation = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const response = await fetch(`${squareBaseUrl()}/catalog/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        object_types: ["ITEM"],
        include_related_objects: true,
        ...(cursor ? { cursor } : {}),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as SquareCatalogResponse;
    if (!response.ok) {
      const detail = result.errors?.map((error) => error.detail).filter(Boolean).join("; ");
      throw new Error(detail || `Square catalog search failed (${response.status}).`);
    }

    for (const object of result.objects ?? []) {
      if (object.type !== "ITEM") continue;
      const item = object as SquareCatalogItem;
      if (!item.item_data?.name) continue;
      for (const reference of item.item_data.variations ?? []) {
        if (reference.id) {
          serviceNamesByVariation.set(reference.id, item.item_data.name);
          const relatedVariation = (result.related_objects ?? []).find((related) => related.id === reference.id);
          const variation = reference.type === "ITEM_VARIATION" ? reference : relatedVariation;
          if (variation) variations.set(reference.id, variation);
        }
      }
    }

    for (const related of result.related_objects ?? []) {
      if (related.type === "ITEM_VARIATION" && related.id && !variations.has(related.id)) {
        variations.set(related.id, related);
      }
    }
    cursor = result.cursor;
  } while (cursor);

  const allVariations = [...variations.values()]
    .filter((variation) => {
      const duration = variation.item_variation_data?.service_duration;
      return variation.id && serviceNamesByVariation.has(variation.id) && typeof variation.version === "number" && variation.is_deleted !== true &&
        (variation.item_variation_data?.available_for_booking === true || (typeof duration === "number" && duration > 0));
    })
    .map((variation) => {
      const data = variation.item_variation_data!;
      return {
        serviceName: serviceNamesByVariation.get(variation.id!)!,
        variationName: data.name?.trim() || "Default",
        variationId: variation.id!,
        version: variation.version!,
        durationMinutes: typeof data.service_duration === "number" && data.service_duration > 0
          ? Math.round(data.service_duration / 60_000)
          : null,
        priceCents: typeof data.price_money?.amount === "number" ? data.price_money.amount : null,
      };
    });

  return allVariations;
}

export function clearSquareVariationCache() {
  cachedVariations = undefined;
}

export async function listSquareServiceVariations(): Promise<SquareServiceVariation[]> {
  if (cachedVariations && cachedVariations.expiresAt > Date.now()) return cachedVariations.variations;
  if (!pendingVariations) {
    pendingVariations = searchSquareCatalog().then((variations) => {
      cachedVariations = { variations, expiresAt: Date.now() + CACHE_TTL_MS };
      return variations;
    }).finally(() => {
      pendingVariations = undefined;
    });
  }
  return pendingVariations;
}

/** Live catalog variations keyed by id, used to confirm the current version and price of mapped services. */
export async function getLiveSquareVariationsById(): Promise<Map<string, SquareServiceVariation>> {
  const variations = await listSquareServiceVariations();
  return new Map(variations.map((variation) => [variation.variationId, variation]));
}

export async function resolveSquareBookingVariation() {
  const configuredId = process.env.SQUARE_DEFAULT_SERVICE_VARIATION_ID?.trim();
  if (configuredId) {
    const response = await fetch(`${squareBaseUrl()}/catalog/batch-retrieve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": SQUARE_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ object_ids: [configuredId] }),
    });
    const result = (await response.json().catch(() => ({}))) as SquareCatalogResponse;
    const variation = result.objects?.find((object) => object.type === "ITEM_VARIATION") as SquareCatalogVariation | undefined;
    if (!response.ok || !variation?.id || typeof variation.version !== "number") {
      throw new Error(result.errors?.map((error) => error.detail).filter(Boolean).join("; ") || "The configured Square service variation was not found.");
    }
    return { id: variation.id, version: variation.version };
  }

  const variations = await listSquareServiceVariations();
  const preferred = variations.find((variation) => PREFERRED_SERVICE_NAMES.has(variation.serviceName.trim().toLowerCase()));
  const selected = preferred ?? variations[0];
  if (!selected) throw new Error("No active Square service variation that supports booking was found.");
  return { id: selected.variationId, version: selected.version };
}
