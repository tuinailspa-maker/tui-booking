"use client";

import { useState } from "react";
import useSWR from "swr";
import type { CatalogComparison, CatalogCreation, CatalogSyncChange, CatalogSyncPlan } from "@/data/squareCatalogSync";
import { CatalogComparisonTable } from "@/components/admin/catalog-comparison";

type SyncError = Error & { code?: string };
type ApplyResult = CatalogSyncPlan & { updatedCount: number; createdCount: number; taxFixCount: number; categoryFixCount?: number; before: CatalogComparison; after: CatalogComparison };

async function fetchPlan(url: string): Promise<CatalogSyncPlan> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { code: data.code });
  return data;
}

const money = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
const minutes = (value: number | null) => (value === null ? "—" : `${value} min`);

const CREATION_REASON: Record<CatalogCreation["reason"], string> = {
  split_shared: "Separated from a shared variation",
  missing_variation: "Mapped variation was deleted",
  unmapped: "Not on Square yet",
  surcharge: "Option surcharge — new Square variation",
};

function ChangeRow({ change }: { change: CatalogSyncChange }) {
  return <tr>
    <td><strong>{change.squareName}</strong><small>{change.internalServices.join(", ")}</small>{change.warnings.map((warning) => <small key={warning} className="catalog-sync-warning">{warning}</small>)}</td>
    <td className={change.priceChanged ? "is-changed" : ""}>{money(change.currentPriceCents)}{change.priceChanged && <> → <b>{money(change.targetPriceCents)}</b></>}</td>
    <td className={change.durationChanged ? "is-changed" : ""}>{minutes(change.currentDurationMinutes)}{change.durationChanged && <> → <b>{minutes(change.targetDurationMinutes)}</b></>}</td>
  </tr>;
}

function CreationRow({ creation }: { creation: CatalogCreation }) {
  return <tr>
    <td>
      <strong>{creation.name}</strong>
      <small>{creation.newItem ? "New Square service" : "New variation in"}: {creation.squareItemName}{creation.newItem ? "" : ` → ${creation.variationName}`}</small>
      <small className="catalog-sync-warning">{CREATION_REASON[creation.reason]}</small>
      {creation.createdVariationId && <small>Created {creation.createdVariationId}</small>}
    </td>
    <td className="is-changed"><b>{money(creation.priceCents)}</b></td>
    <td className="is-changed"><b>{minutes(creation.durationMinutes)}</b></td>
  </tr>;
}

export function SquareCatalogSync() {
  const plan = useSWR<CatalogSyncPlan, SyncError>("/api/admin/square-catalog-sync", fetchPlan, { revalidateOnFocus: false });
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<SyncError | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const error = applyError ?? plan.error;
  const permissionMissing = error?.code === "MISSING_PERMISSION" || plan.data?.permission.status === "missing";
  const data = plan.data;
  const pending = data?.pendingCount ?? 0;

  async function runSync() {
    if (!data) return;
    const summary = [
      data.changes.length && `update ${data.changes.length} variation(s)`,
      data.creations.length && `create ${data.creations.length} variation(s)`,
      data.taxFixes.length && `fix taxes on ${data.taxFixes.length} item(s)`,
      data.categoryCreations.length && `create ${data.categoryCreations.length} category(ies)`,
      data.categoryFixes.length && `assign categories on ${data.categoryFixes.length} item(s)`,
    ].filter(Boolean).join(", ");
    if (!window.confirm(`Make Square (${data.environment}) match the internal price list: ${summary}?`)) return;
    setBusy(true);
    setApplyError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/square-catalog-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(body.error || `Sync failed (${response.status}).`), { code: body.code });
      setResult(body);
      await plan.mutate();
    } catch (caught) {
      setApplyError(caught as SyncError);
      await plan.mutate();
    } finally {
      setBusy(false);
    }
  }

  return <section className="catalog-sync" aria-labelledby="catalog-sync-title">
    <header className="catalog-sync-header">
      <div>
        <h2 id="catalog-sync-title">Square service catalog sync</h2>
        <p>The internal price list is the source of truth. Sync updates prices (CAD) and durations, separates shared variations, creates missing services and add-ons, clears location price overrides, and applies TPS 5% + TVQ 9.975% on Square.</p>
      </div>
      <div className="catalog-sync-actions">
        <button type="button" className="admin-secondary-button" onClick={() => { setApplyError(null); void plan.mutate(); }} disabled={plan.isValidating || busy}>{plan.isValidating ? "Checking…" : "Re-check"}</button>
        <button type="button" className="admin-primary-button" onClick={runSync} disabled={busy || plan.isLoading || permissionMissing || pending === 0}>{busy ? "Syncing…" : pending ? `Sync ${pending} to Square` : "Square is in sync"}</button>
      </div>
    </header>

    {permissionMissing && <div className="admin-alert catalog-sync-permission" role="alert">
      <strong>Missing Square permission: ITEMS_WRITE</strong>
      <span>{error?.code === "MISSING_PERMISSION" ? error.message : data?.permission.message}</span>
    </div>}
    {error && !permissionMissing && <div className="admin-alert" role="alert"><strong>Couldn&apos;t sync the Square catalog.</strong><span>{error.message}</span><button type="button" onClick={() => { setApplyError(null); void plan.mutate(); }}>Try again</button></div>}
    {data && data.taxes.missing.length > 0 && <div className="admin-alert" role="alert"><strong>Square tax missing</strong><span>{data.taxes.missing.join(" and ")} is not set up in Square, so item taxes can&apos;t be assigned. Create it under Square Dashboard › Settings › Taxes, then re-check.</span></div>}
    {result && <div className="catalog-sync-success" role="status">{result.updatedCount + result.createdCount + result.taxFixCount + (result.categoryFixCount ?? 0)
      ? `Done: ${result.updatedCount} updated, ${result.createdCount} created, ${result.taxFixCount} item tax fixes, ${result.categoryFixCount ?? 0} category assignments.`
      : "Nothing to change — Square already matches."}</div>}
    {plan.isLoading && <div className="admin-loading" role="status"><span className="admin-spinner" />Comparing with the Square catalog…</div>}

    {result && <CatalogComparisonTable title="After sync — internal vs Square" comparison={result.after} previous={result.before} />}

    {data && <>
      {!result && <CatalogComparisonTable title="Current check — internal vs Square (read-only)" comparison={data.comparison} />}
      <p className="catalog-sync-meta">Environment: <b>{data.environment}</b> · {data.changes.length} to update · {data.creations.length} to create · {data.taxFixes.length} tax fixes · {data.categoryCreations.length + data.categoryFixes.length} category fixes · {data.inSync.length} already match{data.permission.status !== "missing" && <> · {data.permission.message}</>}</p>

      {(data.changes.length > 0 || data.creations.length > 0) && <table className="catalog-sync-table">
        <thead><tr><th scope="col">Square service</th><th scope="col">Price</th><th scope="col">Duration</th></tr></thead>
        <tbody>
          {data.changes.map((change) => <ChangeRow key={change.variationId} change={change} />)}
          {data.creations.map((creation) => <CreationRow key={creation.serviceId} creation={creation} />)}
        </tbody>
      </table>}

      {data.taxFixes.length > 0 && <div className="catalog-sync-notes">
        <h3>Item taxes to fix</h3>
        <ul>{data.taxFixes.map((fix) => <li key={fix.itemId}>{fix.itemName} — {fix.enable.length ? `enable ${fix.enable.length}` : ""}{fix.enable.length && fix.disable.length ? ", " : ""}{fix.disable.length ? `disable ${fix.disable.length} other tax(es)` : ""}</li>)}</ul>
      </div>}

      {(data.categoryCreations.length > 0 || data.categoryFixes.length > 0) && <div className="catalog-sync-notes">
        <h3>Categories to organize (existing categories on items are kept)</h3>
        <ul>
          {data.categoryCreations.map((category) => <li key={`new-${category.key}`}>Create category: {category.name}</li>)}
          {data.categoryFixes.map((fix) => <li key={fix.itemId}>{fix.itemName} → {fix.categoryName}</li>)}
        </ul>
      </div>}

      {data.addOnModifiers.length > 0 && <div className="catalog-sync-notes">
        <h3>Option surcharges (synced as their own Square variations, billed next to the service)</h3>
        <ul>{data.addOnModifiers.map((addOn) => <li key={addOn.serviceId}>{addOn.name} ({money(addOn.priceCents)})</li>)}</ul>
      </div>}
    </>}
  </section>;
}
