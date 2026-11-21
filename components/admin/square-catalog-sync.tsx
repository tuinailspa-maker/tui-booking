"use client";

import { useState } from "react";
import useSWR from "swr";
import type { CatalogSyncChange, CatalogSyncPlan } from "@/data/squareCatalogSync";

type SyncError = Error & { code?: string };
type ApplyResult = CatalogSyncPlan & { updatedCount: number };

async function fetchPlan(url: string): Promise<CatalogSyncPlan> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { code: data.code });
  return data;
}

const money = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
const minutes = (value: number | null) => (value === null ? "—" : `${value} min`);

function ChangeRow({ change }: { change: CatalogSyncChange }) {
  return <tr>
    <td><strong>{change.squareName}</strong><small>{change.internalServices.join(", ")}</small>{change.warnings.map((warning) => <small key={warning} className="catalog-sync-warning">{warning}</small>)}</td>
    <td className={change.priceChanged ? "is-changed" : ""}>{money(change.currentPriceCents)}{change.priceChanged && <> → <b>{money(change.targetPriceCents)}</b></>}</td>
    <td className={change.durationChanged ? "is-changed" : ""}>{minutes(change.currentDurationMinutes)}{change.durationChanged && <> → <b>{minutes(change.targetDurationMinutes)}</b></>}</td>
  </tr>;
}

export function SquareCatalogSync() {
  const plan = useSWR<CatalogSyncPlan, SyncError>("/api/admin/square-catalog-sync", fetchPlan, { revalidateOnFocus: false });
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<SyncError | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const error = applyError ?? plan.error;
  const permissionMissing = error?.code === "MISSING_PERMISSION" || plan.data?.permission.status === "missing";
  const changes = plan.data?.changes ?? [];

  async function runSync() {
    if (!window.confirm(`Update ${changes.length} service ${changes.length === 1 ? "variation" : "variations"} on Square (${plan.data?.environment}) to match the internal price list?`)) return;
    setBusy(true);
    setApplyError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/square-catalog-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || `Sync failed (${response.status}).`), { code: data.code });
      setResult(data);
      await plan.mutate();
    } catch (caught) {
      setApplyError(caught as SyncError);
    } finally {
      setBusy(false);
    }
  }

  return <section className="catalog-sync" aria-labelledby="catalog-sync-title">
    <header className="catalog-sync-header">
      <div>
        <h2 id="catalog-sync-title">Square service catalog sync</h2>
        <p>Pushes the internal price list (prices in CAD and durations) to the mapped Square service variations, including add-on services.</p>
      </div>
      <div className="catalog-sync-actions">
        <button type="button" className="admin-secondary-button" onClick={() => { setApplyError(null); void plan.mutate(); }} disabled={plan.isValidating || busy}>{plan.isValidating ? "Checking…" : "Re-check"}</button>
        <button type="button" className="admin-primary-button" onClick={runSync} disabled={busy || plan.isLoading || permissionMissing || changes.length === 0}>{busy ? "Syncing…" : changes.length ? `Sync ${changes.length} to Square` : "Square is in sync"}</button>
      </div>
    </header>

    {permissionMissing && <div className="admin-alert catalog-sync-permission" role="alert">
      <strong>Missing Square permission: ITEMS_WRITE</strong>
      <span>{error?.code === "MISSING_PERMISSION" ? error.message : plan.data?.permission.message}</span>
    </div>}
    {error && !permissionMissing && <div className="admin-alert" role="alert"><strong>Couldn&apos;t sync the Square catalog.</strong><span>{error.message}</span><button type="button" onClick={() => { setApplyError(null); void plan.mutate(); }}>Try again</button></div>}
    {result && <div className="catalog-sync-success" role="status">{result.updatedCount ? `Updated ${result.updatedCount} Square service ${result.updatedCount === 1 ? "variation" : "variations"}.` : "Nothing to update — Square already matches."}</div>}
    {plan.isLoading && <div className="admin-loading" role="status"><span className="admin-spinner" />Comparing with the Square catalog…</div>}

    {plan.data && <>
      <p className="catalog-sync-meta">Environment: <b>{plan.data.environment}</b> · {plan.data.changes.length} to update · {plan.data.inSync.length} already match · {plan.data.conflicts.length} conflicts{plan.data.permission.status !== "missing" && <> · {plan.data.permission.message}</>}</p>

      {changes.length > 0 && <table className="catalog-sync-table">
        <thead><tr><th scope="col">Square service</th><th scope="col">Price</th><th scope="col">Duration</th></tr></thead>
        <tbody>{changes.map((change) => <ChangeRow key={change.variationId} change={change} />)}</tbody>
      </table>}

      {plan.data.conflicts.length > 0 && <div className="catalog-sync-notes">
        <h3>Skipped: shared Square variation</h3>
        {plan.data.conflicts.map((conflict) => <div key={conflict.variationId}>
          <strong>{conflict.squareName}</strong>
          <ul>{conflict.services.map((service) => <li key={service.id}>{service.name} — {money(service.priceCents)}, {service.durationMinutes} min</li>)}</ul>
          <small>{conflict.reason}</small>
        </div>)}
      </div>}

      {(plan.data.unmappedServices.length > 0 || plan.data.addOnModifiers.length > 0 || plan.data.missingOnSquare.length > 0) && <div className="catalog-sync-notes">
        <h3>Not synced</h3>
        <ul>
          {plan.data.missingOnSquare.map((item) => <li key={item.variationId}>{item.services.join(", ")} — mapped variation {item.variationId} no longer exists on Square</li>)}
          {plan.data.unmappedServices.map((service) => <li key={service.id}>{service.name} — no Square variation mapped (billed as a custom line)</li>)}
          {plan.data.addOnModifiers.map((addOn) => <li key={addOn.serviceId}>{addOn.name} ({money(addOn.priceCents)}) — option surcharge, billed as a custom line</li>)}
        </ul>
      </div>}
    </>}
  </section>;
}
