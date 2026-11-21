import { randomUUID } from "node:crypto";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { squareMappingFor } from "@/data/squareServiceMap";
import { allServices, serviceDisplayName, serviceTree, type ServiceNode } from "@/data/serviceTree";
import { clearSquareVariationCache } from "@/data/squareVariations";

const PRODUCTION_URL = "https://connect.squareup.com";
const SANDBOX_URL = "https://connect.squareupsandbox.com";
const REQUIRED_SCOPE = "ITEMS_WRITE";

type SquareError = { code?: string; category?: string; detail?: string };

type SquareVariationObject = {
  type: "ITEM_VARIATION";
  id: string;
  version?: number;
  is_deleted?: boolean;
  item_variation_data?: {
    item_id?: string;
    name?: string;
    pricing_type?: string;
    price_money?: { amount?: number; currency?: string };
    service_duration?: number;
    location_overrides?: { location_id?: string; price_money?: { amount?: number } }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type CatalogSyncChange = {
  variationId: string;
  squareName: string;
  internalServices: string[];
  currentPriceCents: number | null;
  targetPriceCents: number;
  currentDurationMinutes: number | null;
  targetDurationMinutes: number;
  priceChanged: boolean;
  durationChanged: boolean;
  warnings: string[];
};

export type CatalogSyncConflict = {
  variationId: string;
  squareName: string;
  reason: string;
  services: { id: string; name: string; priceCents: number; durationMinutes: number }[];
};

export type ServiceComparisonStatus =
  | "match"
  | "price_mismatch"
  | "duration_mismatch"
  | "price_and_duration_mismatch"
  | "missing_variation"
  | "unmapped"
  | "custom_line";

export type ServiceComparisonRow = {
  serviceId: string;
  name: string;
  group: string;
  isAddOn: boolean;
  variationId: string | null;
  squareName: string | null;
  internalPriceCents: number;
  squarePriceCents: number | null;
  squareCurrency: string | null;
  internalDurationMinutes: number | null;
  squareDurationMinutes: number | null;
  status: ServiceComparisonStatus;
  issues: string[];
};

export type CatalogComparison = {
  checkedAt: string;
  rows: ServiceComparisonRow[];
  summary: { total: number; match: number; mismatched: number; missingVariation: number; unmapped: number; customLines: number };
};

export type CatalogSyncPlan = {
  environment: "production" | "sandbox";
  comparison: CatalogComparison;
  permission: { status: "granted" | "missing" | "unknown"; scopes: string[] | null; message: string };
  changes: CatalogSyncChange[];
  inSync: CatalogSyncChange[];
  conflicts: CatalogSyncConflict[];
  missingOnSquare: { variationId: string; services: string[] }[];
  unmappedServices: { id: string; name: string }[];
  addOnModifiers: { serviceId: string; name: string; priceCents: number }[];
};

export class SquareCatalogSyncError extends Error {
  constructor(message: string, readonly status: number, readonly code: "MISSING_PERMISSION" | "NOT_CONFIGURED" | "VERSION_MISMATCH" | "SQUARE_ERROR") {
    super(message);
  }
}

export const MISSING_PERMISSION_MESSAGE =
  "The Square access token is missing the ITEMS_WRITE permission, so service prices and durations cannot be updated. In the Square Developer Dashboard, open your application > OAuth (or generate a new personal access token) and grant ITEMS_WRITE (and ITEMS_READ), then update SQUARE_ACCESS_TOKEN in the project's environment variables.";

function environment(): "production" | "sandbox" {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

function baseUrl() {
  return environment() === "sandbox" ? SANDBOX_URL : PRODUCTION_URL;
}

function accessToken() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new SquareCatalogSyncError("Square is not configured. Set SQUARE_ACCESS_TOKEN.", 503, "NOT_CONFIGURED");
  return token;
}

function isPermissionError(status: number, errors: SquareError[] | undefined) {
  return status === 401 || status === 403 || Boolean(errors?.some((error) =>
    error.code === "INSUFFICIENT_SCOPES" || error.code === "FORBIDDEN" || error.category === "AUTHENTICATION_ERROR"));
}

async function squarePost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { errors?: SquareError[] };
  if (!response.ok || data.errors?.length) {
    if (isPermissionError(response.status, data.errors)) {
      throw new SquareCatalogSyncError(MISSING_PERMISSION_MESSAGE, 403, "MISSING_PERMISSION");
    }
    if (data.errors?.some((error) => error.code === "VERSION_MISMATCH")) {
      throw new SquareCatalogSyncError("A service changed on Square while syncing. Reload the preview and run the sync again.", 409, "VERSION_MISMATCH");
    }
    const detail = data.errors?.map((error) => error.detail || error.code).filter(Boolean).join("; ");
    throw new SquareCatalogSyncError(detail || `Square returned HTTP ${response.status}.`, 502, "SQUARE_ERROR");
  }
  return data;
}

async function checkPermission(): Promise<CatalogSyncPlan["permission"]> {
  try {
    const response = await fetch(`${baseUrl()}/oauth2/token/status`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken()}`, "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json" },
    });
    const data = (await response.json().catch(() => ({}))) as { scopes?: string[]; errors?: SquareError[] };
    if (!response.ok) {
      return { status: "unknown", scopes: null, message: "Square did not report token permissions. ITEMS_WRITE will be confirmed when the sync runs." };
    }
    if (!Array.isArray(data.scopes)) {
      return { status: "unknown", scopes: null, message: "Personal access tokens do not list scopes. ITEMS_WRITE will be confirmed when the sync runs." };
    }
    return data.scopes.includes(REQUIRED_SCOPE)
      ? { status: "granted", scopes: data.scopes, message: "The Square token has ITEMS_WRITE permission." }
      : { status: "missing", scopes: data.scopes, message: MISSING_PERMISSION_MESSAGE };
  } catch (error) {
    if (error instanceof SquareCatalogSyncError) throw error;
    return { status: "unknown", scopes: null, message: "Couldn't check token permissions. ITEMS_WRITE will be confirmed when the sync runs." };
  }
}

type InternalTarget = { id: string; name: string; priceCents: number; durationMinutes: number; squareName: string };

function internalTargetsByVariation() {
  const targets = new Map<string, InternalTarget[]>();
  const unmappedServices: CatalogSyncPlan["unmappedServices"] = [];
  const addOnModifiers: CatalogSyncPlan["addOnModifiers"] = [];

  for (const service of allServices) {
    const name = serviceDisplayName(service, "en");
    if (service.addOn) {
      addOnModifiers.push({ serviceId: service.id, name: `${name} + ${service.addOn.nameEn}`, priceCents: Math.round(service.addOn.priceCad * 100) });
    }
    const mapping = squareMappingFor(service.id);
    if (!mapping) {
      if (service.priceCad > 0) unmappedServices.push({ id: service.id, name });
      continue;
    }
    const list = targets.get(mapping.variationId) ?? [];
    list.push({ id: service.id, name, priceCents: Math.round(service.priceCad * 100), durationMinutes: service.durationMinutes, squareName: mapping.squareName });
    targets.set(mapping.variationId, list);
  }
  return { targets, unmappedServices, addOnModifiers };
}

async function retrieveVariations(ids: string[]) {
  const byId = new Map<string, SquareVariationObject>();
  for (let index = 0; index < ids.length; index += 1000) {
    const result = await squarePost<{ objects?: SquareVariationObject[] }>("/v2/catalog/batch-retrieve", { object_ids: ids.slice(index, index + 1000) });
    for (const object of result.objects ?? []) {
      if (object.type === "ITEM_VARIATION" && !object.is_deleted) byId.set(object.id, object);
    }
  }
  return byId;
}

function serviceGroups() {
  const groups = new Map<string, { path: string; isAddOn: boolean }>();
  const walk = (nodes: ServiceNode[], path: string[], isAddOn: boolean) => {
    for (const node of nodes) {
      if (node.type === "branch") {
        walk(node.children, [...path, node.nameEn], isAddOn || node.id === "add-on" || node.id === "variable-add-ons");
      } else {
        groups.set(node.id, { path: path.join(" › "), isAddOn });
      }
    }
  };
  walk(serviceTree, [], false);
  return groups;
}

function compareServicesWithSquare(live: Map<string, SquareVariationObject>): CatalogComparison {
  const groups = serviceGroups();
  const rows: ServiceComparisonRow[] = [];

  for (const service of allServices) {
    const name = serviceDisplayName(service, "en");
    const group = groups.get(service.id) ?? { path: "", isAddOn: false };
    const internalPriceCents = Math.round(service.priceCad * 100);
    const mapping = squareMappingFor(service.id);
    const base = {
      serviceId: service.id,
      name,
      group: group.path,
      isAddOn: group.isAddOn,
      internalPriceCents,
      internalDurationMinutes: service.durationMinutes,
    };

    if (!mapping) {
      rows.push({
        ...base, variationId: null, squareName: null, squarePriceCents: null, squareCurrency: null, squareDurationMinutes: null,
        status: internalPriceCents > 0 ? "unmapped" : "custom_line",
        issues: [internalPriceCents > 0
          ? "No Square variation is mapped in data/squareServiceMap.ts."
          : "Free option ($0) — nothing to bill on Square."],
      });
    } else {
      const object = live.get(mapping.variationId);
      if (!object) {
        rows.push({
          ...base, variationId: mapping.variationId, squareName: mapping.squareName, squarePriceCents: null, squareCurrency: null, squareDurationMinutes: null,
          status: "missing_variation",
          issues: [`Mapped variation ${mapping.variationId} was not found on Square (deleted or wrong ID).`],
        });
      } else {
        const data = object.item_variation_data ?? {};
        const squarePriceCents = typeof data.price_money?.amount === "number" ? data.price_money.amount : null;
        const squareCurrency = data.price_money?.currency ?? null;
        const squareDurationMinutes = typeof data.service_duration === "number" ? Math.round(data.service_duration / 60_000) : null;
        const issues: string[] = [];
        let priceMismatch = false;
        if (data.pricing_type !== "FIXED_PRICING" || squarePriceCents === null) {
          priceMismatch = true;
          issues.push("Square uses variable pricing (no fixed price).");
        } else if (squarePriceCents !== internalPriceCents) {
          priceMismatch = true;
          issues.push(`Price differs by ${formatCents(squarePriceCents - internalPriceCents)}.`);
        }
        if (squareCurrency && squareCurrency !== "CAD") {
          priceMismatch = true;
          issues.push(`Square price is in ${squareCurrency}, not CAD.`);
        }
        if (data.location_overrides?.some((override) => typeof override.price_money?.amount === "number" && override.price_money.amount !== internalPriceCents)) {
          priceMismatch = true;
          issues.push("A Square location price override differs from the internal price.");
        }
        const durationMismatch = squareDurationMinutes !== service.durationMinutes;
        if (durationMismatch) {
          issues.push(squareDurationMinutes === null ? "Square has no service duration set." : `Duration differs by ${squareDurationMinutes - service.durationMinutes} min.`);
        }
        rows.push({
          ...base, variationId: mapping.variationId, squareName: mapping.squareName,
          squarePriceCents, squareCurrency, squareDurationMinutes,
          status: priceMismatch && durationMismatch ? "price_and_duration_mismatch" : priceMismatch ? "price_mismatch" : durationMismatch ? "duration_mismatch" : "match",
          issues,
        });
      }
    }

    if (service.addOn) {
      rows.push({
        serviceId: `${service.id}:${service.addOn.key}`,
        name: `${name} + ${service.addOn.nameEn}`,
        group: group.path,
        isAddOn: true,
        variationId: null,
        squareName: null,
        internalPriceCents: Math.round(service.addOn.priceCad * 100),
        squarePriceCents: null,
        squareCurrency: null,
        internalDurationMinutes: service.addOn.durationMinutes ?? null,
        squareDurationMinutes: null,
        status: "custom_line",
        issues: ["Option surcharge — billed as a custom CAD line on the Square order, not a catalog variation."],
      });
    }
  }

  const count = (...statuses: ServiceComparisonStatus[]) => rows.filter((row) => statuses.includes(row.status)).length;
  return {
    checkedAt: new Date().toISOString(),
    rows,
    summary: {
      total: rows.length,
      match: count("match"),
      mismatched: count("price_mismatch", "duration_mismatch", "price_and_duration_mismatch"),
      missingVariation: count("missing_variation"),
      unmapped: count("unmapped"),
      customLines: count("custom_line"),
    },
  };
}

function formatCents(cents: number) {
  return `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

async function buildPlanWithObjects() {
  const [permission, { targets, unmappedServices, addOnModifiers }] = await Promise.all([checkPermission(), Promise.resolve(internalTargetsByVariation())]);
  const live = await retrieveVariations([...targets.keys()]);
  const comparison = compareServicesWithSquare(live);

  const changes: CatalogSyncChange[] = [];
  const inSync: CatalogSyncChange[] = [];
  const conflicts: CatalogSyncConflict[] = [];
  const missingOnSquare: CatalogSyncPlan["missingOnSquare"] = [];
  const objectsToUpsert = new Map<string, SquareVariationObject>();

  for (const [variationId, services] of targets) {
    const squareName = services[0].squareName;
    const object = live.get(variationId);
    if (!object) {
      missingOnSquare.push({ variationId, services: services.map((service) => service.name) });
      continue;
    }
    const prices = new Set(services.map((service) => service.priceCents));
    const durations = new Set(services.map((service) => service.durationMinutes));
    if (prices.size > 1 || durations.size > 1) {
      conflicts.push({
        variationId,
        squareName,
        reason: "Several internal services with different prices or durations share this one Square variation. Square can only hold one price per variation, so create a separate Square variation for each and map it in data/squareServiceMap.ts.",
        services: services.map(({ id, name, priceCents, durationMinutes }) => ({ id, name, priceCents, durationMinutes })),
      });
      continue;
    }

    const data = object.item_variation_data ?? {};
    const targetPriceCents = services[0].priceCents;
    const targetDurationMinutes = services[0].durationMinutes;
    const currentPriceCents = typeof data.price_money?.amount === "number" ? data.price_money.amount : null;
    const currentDurationMinutes = typeof data.service_duration === "number" ? Math.round(data.service_duration / 60_000) : null;
    const priceChanged = currentPriceCents !== targetPriceCents || data.pricing_type !== "FIXED_PRICING" || (data.price_money?.currency ?? "CAD") !== "CAD";
    const durationChanged = currentDurationMinutes !== targetDurationMinutes;
    const warnings: string[] = [];
    if (data.location_overrides?.some((override) => typeof override.price_money?.amount === "number" && override.price_money.amount !== targetPriceCents)) {
      warnings.push("A location price override on Square differs; it will be cleared so every location uses this price.");
    }

    const entry: CatalogSyncChange = {
      variationId,
      squareName,
      internalServices: services.map((service) => service.name),
      currentPriceCents,
      targetPriceCents,
      currentDurationMinutes,
      targetDurationMinutes,
      priceChanged,
      durationChanged,
      warnings,
    };

    if (!priceChanged && !durationChanged && warnings.length === 0) {
      inSync.push(entry);
      continue;
    }
    changes.push(entry);
    objectsToUpsert.set(variationId, {
      ...object,
      item_variation_data: {
        ...data,
        pricing_type: "FIXED_PRICING",
        price_money: { amount: targetPriceCents, currency: "CAD" },
        service_duration: targetDurationMinutes * 60_000,
        ...(data.location_overrides ? {
          location_overrides: data.location_overrides.map(({ price_money: _price, ...override }) => ({ ...override })),
        } : {}),
      },
    });
  }

  const plan: CatalogSyncPlan = { environment: environment(), comparison, permission, changes, inSync, conflicts, missingOnSquare, unmappedServices, addOnModifiers };
  return { plan, objectsToUpsert };
}

export async function previewCatalogSync(): Promise<CatalogSyncPlan> {
  return (await buildPlanWithObjects()).plan;
}

export async function applyCatalogSync() {
  const { plan, objectsToUpsert } = await buildPlanWithObjects();
  if (plan.permission.status === "missing") {
    throw new SquareCatalogSyncError(MISSING_PERMISSION_MESSAGE, 403, "MISSING_PERMISSION");
  }
  const objects = [...objectsToUpsert.values()];
  const before = plan.comparison;
  if (objects.length === 0) return { plan, updatedCount: 0, before, after: before };

  await squarePost("/v2/catalog/batch-upsert", {
    idempotency_key: randomUUID(),
    batches: [{ objects }],
  });
  clearSquareVariationCache();
  const after = compareServicesWithSquare(await retrieveVariations([...internalTargetsByVariation().targets.keys()]));
  return { plan, updatedCount: objects.length, before, after };
}
