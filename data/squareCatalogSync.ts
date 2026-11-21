import { randomUUID } from "node:crypto";
import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { resolveServiceVariation, squareMappingFor, squareSkuFor } from "@/data/squareServiceMap";
import { allServices, serviceDisplayName, serviceTree, type ServiceLeaf, type ServiceNode } from "@/data/serviceTree";
import { TPS_RATE_PERCENT, TVQ_RATE_PERCENT } from "@/data/billing";
import { clearSquareVariationCache } from "@/data/squareVariations";

const PRODUCTION_URL = "https://connect.squareup.com";
const SANDBOX_URL = "https://connect.squareupsandbox.com";
const REQUIRED_SCOPE = "ITEMS_WRITE";

type SquareError = { code?: string; category?: string; detail?: string };

type VariationData = {
  item_id?: string;
  name?: string;
  sku?: string;
  pricing_type?: string;
  price_money?: { amount?: number; currency?: string };
  service_duration?: number;
  available_for_booking?: boolean;
  team_member_ids?: string[];
  location_overrides?: { location_id?: string; price_money?: { amount?: number; currency?: string }; [key: string]: unknown }[];
  [key: string]: unknown;
};

type SquareVariationObject = {
  type: "ITEM_VARIATION";
  id: string;
  version?: number;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_variation_data?: VariationData;
  [key: string]: unknown;
};

type SquareItemObject = {
  type: "ITEM";
  id: string;
  version?: number;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_data?: { name?: string; product_type?: string; tax_ids?: string[]; variations?: SquareVariationObject[]; [key: string]: unknown };
  [key: string]: unknown;
};

type SquareTaxObject = {
  type: "TAX";
  id: string;
  is_deleted?: boolean;
  tax_data?: { name?: string; percentage?: string; enabled?: boolean; inclusion_type?: string };
};

type Catalog = {
  items: Map<string, SquareItemObject>;
  variations: Map<string, SquareVariationObject>;
  bySku: Map<string, SquareVariationObject>;
  taxes: SquareTaxObject[];
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

export type CatalogCreation = {
  serviceId: string;
  name: string;
  reason: "split_shared" | "missing_variation" | "unmapped";
  squareItemName: string;
  newItem: boolean;
  variationName: string;
  priceCents: number;
  durationMinutes: number;
  sharedVariationId: string | null;
  createdVariationId?: string;
};

export type CatalogTaxFix = { itemId: string; itemName: string; enable: string[]; disable: string[] };

export type ServiceComparisonStatus =
  | "match"
  | "price_mismatch"
  | "duration_mismatch"
  | "price_and_duration_mismatch"
  | "shared_variation"
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
  summary: { total: number; match: number; mismatched: number; shared: number; missingVariation: number; unmapped: number; customLines: number; taxIssues: number };
};

export type CatalogSyncPlan = {
  environment: "production" | "sandbox";
  comparison: CatalogComparison;
  permission: { status: "granted" | "missing" | "unknown"; scopes: string[] | null; message: string };
  changes: CatalogSyncChange[];
  creations: CatalogCreation[];
  taxFixes: CatalogTaxFix[];
  taxes: { tps: string | null; tvq: string | null; missing: string[] };
  inSync: CatalogSyncChange[];
  addOnModifiers: { serviceId: string; name: string; priceCents: number }[];
  pendingCount: number;
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

async function squareRequest<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as T & { errors?: SquareError[] };
  if (!response.ok || data.errors?.length) {
    if (isPermissionError(response.status, data.errors)) {
      throw new SquareCatalogSyncError(MISSING_PERMISSION_MESSAGE, 403, "MISSING_PERMISSION");
    }
    if (data.errors?.some((error) => error.code === "VERSION_MISMATCH")) {
      throw new SquareCatalogSyncError("A service changed on Square while syncing. Re-check and run the sync again.", 409, "VERSION_MISMATCH");
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
    const data = (await response.json().catch(() => ({}))) as { scopes?: string[] };
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

async function fetchCatalog(): Promise<Catalog> {
  const catalog: Catalog = { items: new Map(), variations: new Map(), bySku: new Map(), taxes: [] };
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ types: "ITEM,TAX", ...(cursor ? { cursor } : {}) });
    const page = await squareRequest<{ objects?: (SquareItemObject | SquareTaxObject)[]; cursor?: string }>("GET", `/v2/catalog/list?${query}`);
    for (const object of page.objects ?? []) {
      if (object.is_deleted) continue;
      if (object.type === "TAX") {
        catalog.taxes.push(object);
        continue;
      }
      catalog.items.set(object.id, object);
      for (const variation of object.item_data?.variations ?? []) {
        if (variation.is_deleted) continue;
        catalog.variations.set(variation.id, variation);
        const sku = variation.item_variation_data?.sku?.trim();
        if (sku && !catalog.bySku.has(sku)) catalog.bySku.set(sku, variation);
      }
    }
    cursor = page.cursor;
  } while (cursor);
  return catalog;
}

type ServiceTarget = {
  service: ServiceLeaf;
  id: string;
  name: string;
  nameFr: string;
  group: string;
  isAddOn: boolean;
  priceCents: number;
  durationMinutes: number;
  sku: string;
};

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

function internalTargets(): ServiceTarget[] {
  const groups = serviceGroups();
  return allServices.map((service) => {
    const group = groups.get(service.id) ?? { path: "", isAddOn: false };
    return {
      service,
      id: service.id,
      name: serviceDisplayName(service, "en"),
      nameFr: serviceDisplayName(service, "fr"),
      group: group.path,
      isAddOn: group.isAddOn,
      priceCents: Math.round(service.priceCad * 100),
      durationMinutes: service.durationMinutes,
      sku: squareSkuFor(service.id),
    };
  });
}

const variationPrice = (variation: SquareVariationObject) => {
  const amount = variation.item_variation_data?.price_money?.amount;
  return typeof amount === "number" ? amount : null;
};
const variationMinutes = (variation: SquareVariationObject) => {
  const duration = variation.item_variation_data?.service_duration;
  return typeof duration === "number" ? Math.round(duration / 60_000) : null;
};
const variationLabel = (target: ServiceTarget) => `${target.name} — ${target.nameFr}`.slice(0, 255);

type Assignment = {
  /** Variation id -> internal services that currently resolve to it (more than one = shared). */
  byVariation: Map<string, ServiceTarget[]>;
  /** Billable services with no usable variation, plus the shared/seeded variation they could be split from. */
  unresolved: { target: ServiceTarget; template: SquareVariationObject | null }[];
  free: ServiceTarget[];
};

function assign(catalog: Catalog, targets: ServiceTarget[]): Assignment {
  const byVariation = new Map<string, ServiceTarget[]>();
  const unresolved: Assignment["unresolved"] = [];
  const free: ServiceTarget[] = [];
  for (const target of targets) {
    if (target.priceCents <= 0) {
      free.push(target);
      continue;
    }
    const variation = resolveServiceVariation(target.id, catalog.bySku, catalog.variations, (item) => item.item_variation_data?.sku?.trim());
    if (variation) {
      const list = byVariation.get(variation.id) ?? [];
      list.push(target);
      byVariation.set(variation.id, list);
    } else {
      const seededId = squareMappingFor(target.id)?.variationId;
      unresolved.push({ target, template: seededId ? catalog.variations.get(seededId) ?? null : null });
    }
  }
  return { byVariation, unresolved, free };
}

/** The service that keeps a shared variation: the one already tagged, else the one Square's price already matches. */
function pickKeeper(variation: SquareVariationObject, services: ServiceTarget[]) {
  const sku = variation.item_variation_data?.sku?.trim();
  return services.find((service) => service.sku === sku)
    ?? services.find((service) => service.priceCents === variationPrice(variation) && service.durationMinutes === variationMinutes(variation))
    ?? services[0];
}

function serviceTaxIds(catalog: Catalog) {
  const active = catalog.taxes.filter((tax) => tax.tax_data?.enabled !== false);
  const byRate = (rate: string) => active.find((tax) => Number(tax.tax_data?.percentage) === Number(rate) && tax.tax_data?.inclusion_type !== "INCLUSIVE")?.id ?? null;
  const tps = byRate(TPS_RATE_PERCENT);
  const tvq = byRate(TVQ_RATE_PERCENT);
  const missing = [!tps && `TPS ${TPS_RATE_PERCENT}%`, !tvq && `TVQ ${TVQ_RATE_PERCENT}%`].filter(Boolean) as string[];
  return { tps, tvq, missing, required: [tps, tvq].filter(Boolean) as string[] };
}

function itemTaxFix(item: SquareItemObject, required: string[]): CatalogTaxFix | null {
  const current = item.item_data?.tax_ids ?? [];
  const enable = required.filter((id) => !current.includes(id));
  const disable = current.filter((id) => !required.includes(id));
  return enable.length || disable.length ? { itemId: item.id, itemName: item.item_data?.name ?? item.id, enable, disable } : null;
}

function compare(catalog: Catalog): CatalogComparison {
  const targets = internalTargets();
  const { byVariation, unresolved } = assign(catalog, targets);
  const variationByService = new Map<string, SquareVariationObject>();
  for (const [variationId, services] of byVariation) {
    for (const service of services) variationByService.set(service.id, catalog.variations.get(variationId)!);
  }
  const unresolvedById = new Map(unresolved.map((entry) => [entry.target.id, entry]));
  const { required } = serviceTaxIds(catalog);
  const rows: ServiceComparisonRow[] = [];

  for (const target of targets) {
    const base = {
      serviceId: target.id,
      name: target.name,
      group: target.group,
      isAddOn: target.isAddOn,
      internalPriceCents: target.priceCents,
      internalDurationMinutes: target.durationMinutes,
    };
    const empty = { squarePriceCents: null, squareCurrency: null, squareDurationMinutes: null };

    if (target.priceCents <= 0) {
      rows.push({ ...base, ...empty, variationId: null, squareName: null, status: "custom_line", issues: ["Free option ($0) — nothing to bill on Square."] });
    } else if (!variationByService.has(target.id)) {
      const entry = unresolvedById.get(target.id);
      const status: ServiceComparisonStatus = entry?.template ? "shared_variation" : squareMappingFor(target.id) ? "missing_variation" : "unmapped";
      rows.push({
        ...base, ...empty,
        variationId: entry?.template?.id ?? null,
        squareName: entry?.template?.item_variation_data?.name ?? null,
        status,
        issues: [status === "unmapped"
          ? "No Square variation exists for this service. Sync will create a new Square service for it."
          : status === "missing_variation"
            ? "The mapped Square variation was deleted. Sync will create a new Square service for it."
            : "Its seeded Square variation now belongs to another service. Sync will create its own variation."],
      });
    } else {
      const variation = variationByService.get(target.id)!;
      const data = variation.item_variation_data ?? {};
      const sharedWith = byVariation.get(variation.id)!.filter((service) => service.id !== target.id);
      const squarePriceCents = variationPrice(variation);
      const squareCurrency = data.price_money?.currency ?? null;
      const squareDurationMinutes = variationMinutes(variation);
      const issues: string[] = [];
      let priceMismatch = false;
      if (data.pricing_type !== "FIXED_PRICING" || squarePriceCents === null) {
        priceMismatch = true;
        issues.push("Square uses variable pricing (no fixed price).");
      } else if (squarePriceCents !== target.priceCents) {
        priceMismatch = true;
        issues.push(`Price differs by ${formatCents(squarePriceCents - target.priceCents)}.`);
      }
      if (squareCurrency && squareCurrency !== "CAD") {
        priceMismatch = true;
        issues.push(`Square price is in ${squareCurrency}, not CAD.`);
      }
      if (data.location_overrides?.some((override) => override.price_money)) {
        priceMismatch = true;
        issues.push("A Square location price override replaces the internal price at a location.");
      }
      const durationMismatch = squareDurationMinutes !== target.durationMinutes;
      if (durationMismatch) {
        issues.push(squareDurationMinutes === null ? "Square has no service duration set." : `Duration differs by ${squareDurationMinutes - target.durationMinutes} min.`);
      }
      const item = data.item_id ? catalog.items.get(data.item_id) : undefined;
      if (item && itemTaxFix(item, required)) issues.push("Square item taxes differ from TPS 5% + TVQ 9.975%.");

      let status: ServiceComparisonStatus = priceMismatch && durationMismatch ? "price_and_duration_mismatch" : priceMismatch ? "price_mismatch" : durationMismatch ? "duration_mismatch" : "match";
      if (sharedWith.length) {
        status = "shared_variation";
        issues.unshift(`Shares one Square variation with ${sharedWith.map((service) => service.name).join(", ")}. Sync will give each service its own variation.`);
      }
      rows.push({ ...base, variationId: variation.id, squareName: data.name ?? null, squarePriceCents, squareCurrency, squareDurationMinutes, status, issues });
    }

    if (target.service.addOn) {
      rows.push({
        serviceId: `${target.id}:${target.service.addOn.key}`,
        name: `${target.name} + ${target.service.addOn.nameEn}`,
        group: target.group,
        isAddOn: true,
        variationId: null,
        squareName: null,
        internalPriceCents: Math.round(target.service.addOn.priceCad * 100),
        squarePriceCents: null,
        squareCurrency: null,
        internalDurationMinutes: target.service.addOn.durationMinutes,
        squareDurationMinutes: null,
        status: "custom_line",
        issues: ["Option surcharge — billed as its own CAD line on the Square order next to the service."],
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
      shared: count("shared_variation"),
      missingVariation: count("missing_variation"),
      unmapped: count("unmapped"),
      customLines: count("custom_line"),
      taxIssues: rows.filter((row) => row.issues.some((issue) => issue.startsWith("Square item taxes"))).length,
    },
  };
}

function formatCents(cents: number) {
  return `${cents < 0 ? "-" : "+"}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function isPresentAt(object: { present_at_all_locations?: boolean; present_at_location_ids?: string[]; absent_at_location_ids?: string[] }, locationId: string) {
  return object.present_at_all_locations
    ? !object.absent_at_location_ids?.includes(locationId)
    : Boolean(object.present_at_location_ids?.includes(locationId));
}

function withLocation<T extends { present_at_all_locations?: boolean; present_at_location_ids?: string[]; absent_at_location_ids?: string[] }>(object: T, locationId: string): T {
  if (isPresentAt(object, locationId)) return object;
  return object.present_at_all_locations
    ? { ...object, absent_at_location_ids: object.absent_at_location_ids?.filter((id) => id !== locationId) }
    : { ...object, present_at_location_ids: [...(object.present_at_location_ids ?? []), locationId] };
}

/** Fields a new variation inherits from the variation it is split from (booking staff, channels, no-show fee...). */
function inheritedData(template: SquareVariationObject | null): VariationData {
  if (!template?.item_variation_data) return {};
  const { sku: _sku, ordinal: _ordinal, location_overrides: _overrides, image_ids: _images, item_option_values: _options, name: _name, price_money: _price, service_duration: _duration, item_id: _item, ...rest } = template.item_variation_data;
  return rest;
}

function targetVariationData(target: ServiceTarget, base: VariationData, name: string): VariationData {
  const allTeamMembers = Object.values(SQUARE_TEAM_MEMBER_IDS);
  return {
    ...base,
    name,
    sku: target.sku,
    pricing_type: "FIXED_PRICING",
    price_money: { amount: target.priceCents, currency: "CAD" },
    service_duration: target.durationMinutes * 60_000,
    available_for_booking: true,
    team_member_ids: base.team_member_ids?.length ? base.team_member_ids : allTeamMembers,
    ...(base.location_overrides ? { location_overrides: base.location_overrides.map(({ price_money: _price, ...override }) => override) } : {}),
  };
}

async function buildPlan() {
  const [permission, catalog] = await Promise.all([checkPermission(), fetchCatalog()]);
  const locationId = process.env.SQUARE_LOCATION_ID ?? "";
  const targets = internalTargets();
  const comparison = compare(catalog);
  const { byVariation, unresolved } = assign(catalog, targets);
  const taxes = serviceTaxIds(catalog);

  const changes: CatalogSyncChange[] = [];
  const inSync: CatalogSyncChange[] = [];
  const creations: CatalogCreation[] = [];
  const updates: SquareVariationObject[] = [];
  const newVariations: SquareVariationObject[] = [];
  const newItems: SquareItemObject[] = [];
  const touchedItemIds = new Set<string>();

  const planUpdate = (target: ServiceTarget, variation: SquareVariationObject, renameTo?: string) => {
    const data = variation.item_variation_data ?? {};
    const currentPriceCents = variationPrice(variation);
    const currentDurationMinutes = variationMinutes(variation);
    const priceChanged = currentPriceCents !== target.priceCents || data.pricing_type !== "FIXED_PRICING" || (data.price_money?.currency ?? "CAD") !== "CAD";
    const durationChanged = currentDurationMinutes !== target.durationMinutes;
    const warnings: string[] = [];
    if (data.location_overrides?.some((override) => override.price_money)) warnings.push("Clears the location price override so every location uses the internal price.");
    if (renameTo && data.name !== renameTo) warnings.push(`Renames the variation to "${renameTo}" (it was shared by several services).`);
    if (data.sku?.trim() !== target.sku) warnings.push(`Tags the variation with SKU ${target.sku} to link it to this service.`);
    if (data.available_for_booking !== true) warnings.push("Enables online booking for this variation.");
    if (locationId && !isPresentAt(variation, locationId)) warnings.push("Enables the variation at the salon location.");
    if (data.item_id) touchedItemIds.add(data.item_id);

    const entry: CatalogSyncChange = {
      variationId: variation.id,
      squareName: data.name ?? variation.id,
      internalServices: [target.name],
      currentPriceCents,
      targetPriceCents: target.priceCents,
      currentDurationMinutes,
      targetDurationMinutes: target.durationMinutes,
      priceChanged,
      durationChanged,
      warnings,
    };
    if (!priceChanged && !durationChanged && warnings.length === 0) {
      inSync.push(entry);
      return;
    }
    changes.push(entry);
    const object = locationId ? withLocation(variation, locationId) : variation;
    updates.push({ ...object, item_variation_data: targetVariationData(target, data, renameTo ?? data.name ?? target.name) });
  };

  const planCreate = (target: ServiceTarget, template: SquareVariationObject | null, reason: CatalogCreation["reason"]) => {
    const parentItem = template?.item_variation_data?.item_id ? catalog.items.get(template.item_variation_data.item_id) : undefined;
    const name = variationLabel(target);
    if (parentItem) {
      touchedItemIds.add(parentItem.id);
      newVariations.push({
        type: "ITEM_VARIATION",
        id: `#tui-var-${target.id}`,
        present_at_all_locations: parentItem.present_at_all_locations ?? true,
        ...(parentItem.present_at_location_ids ? { present_at_location_ids: parentItem.present_at_location_ids } : {}),
        item_variation_data: { ...targetVariationData(target, inheritedData(template), name), item_id: parentItem.id },
      });
    } else {
      const itemId = `#tui-item-${target.id}`;
      newItems.push({
        type: "ITEM",
        id: itemId,
        present_at_all_locations: true,
        item_data: {
          name: `${target.service.nameEn} / ${target.service.nameFr}`.slice(0, 255),
          product_type: "APPOINTMENTS_SERVICE",
          ...(taxes.required.length ? { tax_ids: taxes.required } : {}),
          variations: [{
            type: "ITEM_VARIATION",
            id: `#tui-var-${target.id}`,
            present_at_all_locations: true,
            item_variation_data: { ...targetVariationData(target, {}, "Regular"), item_id: itemId },
          }],
        },
      });
    }
    creations.push({
      serviceId: target.id,
      name: target.name,
      reason,
      squareItemName: parentItem?.item_data?.name ?? `${target.service.nameEn} / ${target.service.nameFr}`,
      newItem: !parentItem,
      variationName: parentItem ? name : "Regular",
      priceCents: target.priceCents,
      durationMinutes: target.durationMinutes,
      sharedVariationId: template?.id ?? null,
    });
  };

  for (const [variationId, services] of byVariation) {
    const variation = catalog.variations.get(variationId)!;
    if (services.length === 1) {
      planUpdate(services[0], variation);
      continue;
    }
    const keeper = pickKeeper(variation, services);
    planUpdate(keeper, variation, variationLabel(keeper));
    for (const service of services) {
      if (service !== keeper) planCreate(service, variation, "split_shared");
    }
  }
  for (const { target, template } of unresolved) {
    planCreate(target, template, template ? "split_shared" : squareMappingFor(target.id) ? "missing_variation" : "unmapped");
  }

  const taxFixes = [...touchedItemIds]
    .map((id) => catalog.items.get(id))
    .filter((item): item is SquareItemObject => Boolean(item))
    .map((item) => itemTaxFix(item, taxes.required))
    .filter((fix): fix is CatalogTaxFix => Boolean(fix));

  const addOnModifiers = targets
    .filter((target) => target.service.addOn)
    .map((target) => ({ serviceId: target.id, name: `${target.name} + ${target.service.addOn!.nameEn}`, priceCents: Math.round(target.service.addOn!.priceCad * 100) }));

  const plan: CatalogSyncPlan = {
    environment: environment(),
    comparison,
    permission,
    changes,
    creations,
    taxFixes: taxes.missing.length ? [] : taxFixes,
    taxes: { tps: taxes.tps, tvq: taxes.tvq, missing: taxes.missing },
    inSync,
    addOnModifiers,
    pendingCount: changes.length + creations.length + (taxes.missing.length ? 0 : taxFixes.length),
  };
  return { plan, updates, newVariations, newItems };
}

export async function previewCatalogSync(): Promise<CatalogSyncPlan> {
  return (await buildPlan()).plan;
}

async function upsert(objects: (SquareVariationObject | SquareItemObject)[]) {
  if (objects.length === 0) return new Map<string, string>();
  const result = await squareRequest<{ id_mappings?: { client_object_id?: string; object_id?: string }[] }>("POST", "/v2/catalog/batch-upsert", {
    idempotency_key: randomUUID(),
    batches: [{ objects }],
  });
  return new Map((result.id_mappings ?? []).map((mapping) => [mapping.client_object_id ?? "", mapping.object_id ?? ""]));
}

export async function applyCatalogSync() {
  const { plan, updates, newVariations, newItems } = await buildPlan();
  if (plan.permission.status === "missing") {
    throw new SquareCatalogSyncError(MISSING_PERMISSION_MESSAGE, 403, "MISSING_PERMISSION");
  }
  const before = plan.comparison;
  if (plan.pendingCount === 0) return { plan, updatedCount: 0, createdCount: 0, taxFixCount: 0, before, after: before };

  // Existing variations first (they carry versions), then new variations/items, then item taxes, so one
  // change cannot invalidate the version of another in the same request.
  await upsert(updates);
  const ids = await upsert([...newVariations, ...newItems]);
  for (const creation of plan.creations) creation.createdVariationId = ids.get(`#tui-var-${creation.serviceId}`);

  for (const fix of plan.taxFixes) {
    await squareRequest("POST", "/v2/catalog/update-item-taxes", {
      item_ids: [fix.itemId],
      ...(fix.enable.length ? { taxes_to_enable: fix.enable } : {}),
      ...(fix.disable.length ? { taxes_to_disable: fix.disable } : {}),
    });
  }

  clearSquareVariationCache();
  const after = compare(await fetchCatalog());
  return { plan, updatedCount: updates.length, createdCount: newVariations.length + newItems.length, taxFixCount: plan.taxFixes.length, before, after };
}
