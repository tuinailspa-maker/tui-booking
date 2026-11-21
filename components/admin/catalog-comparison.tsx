"use client";

import { useState } from "react";
import type { CatalogComparison, ServiceComparisonRow, ServiceComparisonStatus } from "@/data/squareCatalogSync";

const STATUS_LABEL: Record<ServiceComparisonStatus, string> = {
  match: "Match",
  price_mismatch: "Price mismatch",
  duration_mismatch: "Duration mismatch",
  price_and_duration_mismatch: "Price + duration mismatch",
  shared_variation: "Shared variation",
  missing_variation: "Missing on Square",
  unmapped: "Not mapped",
  custom_line: "Custom line",
};

const money = (cents: number | null, currency?: string | null) =>
  cents === null ? "—" : `$${(cents / 100).toFixed(2)}${currency && currency !== "CAD" ? ` ${currency}` : ""}`;
const minutes = (value: number | null) => (value === null ? "—" : `${value} min`);

const isIssue = (row: ServiceComparisonRow) => row.status !== "custom_line" && (row.status !== "match" || row.issues.length > 0);

function statusTone(status: ServiceComparisonStatus) {
  if (status === "match") return "is-ok";
  if (status === "custom_line") return "is-info";
  return "is-bad";
}

type Props = {
  title: string;
  comparison: CatalogComparison;
  previous?: CatalogComparison;
};

export function CatalogComparisonTable({ title, comparison, previous }: Props) {
  const [filter, setFilter] = useState<"issues" | "all" | "add-ons">(comparison.rows.some(isIssue) ? "issues" : "all");
  const previousById = new Map(previous?.rows.map((row) => [row.serviceId, row]));
  const rows = comparison.rows.filter((row) => (filter === "issues" ? isIssue(row) : filter === "add-ons" ? row.isAddOn : true));
  const { summary } = comparison;
  const headingId = `catalog-compare-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return <div className="catalog-compare" aria-labelledby={headingId}>
    <div className="catalog-compare-head">
      <div>
        <h3 id={headingId}>{title}</h3>
        <p>
          {summary.total} rows · <span className="is-ok">{summary.match} match</span>
          {" · "}<span className={summary.mismatched ? "is-bad" : ""}>{summary.mismatched} price/duration mismatch</span>
          {" · "}<span className={summary.shared ? "is-bad" : ""}>{summary.shared} shared variation</span>
          {" · "}<span className={summary.missingVariation ? "is-bad" : ""}>{summary.missingVariation} missing on Square</span>
          {" · "}<span className={summary.unmapped ? "is-bad" : ""}>{summary.unmapped} not mapped</span>
          {" · "}<span className={summary.taxIssues ? "is-bad" : ""}>{summary.taxIssues} tax issues</span>
          {" · "}{summary.customLines} custom add-on lines · checked {new Date(comparison.checkedAt).toLocaleTimeString()}
        </p>
      </div>
      <div className="catalog-compare-filter" role="group" aria-label={`Filter ${title}`}>
        {(["issues", "all", "add-ons"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "issues" ? "Issues only" : value === "all" ? "All services" : "Add-ons"}
          </button>
        ))}
      </div>
    </div>

    {rows.length === 0 ? <p className="catalog-compare-empty">{filter === "issues" ? "No mismatches — every mapped service matches Square." : "No rows."}</p> :
      <div className="catalog-compare-scroll">
        <table className="catalog-sync-table">
          <thead><tr>
            <th scope="col">Internal service</th>
            <th scope="col">Internal price</th>
            <th scope="col">Square price</th>
            <th scope="col">Internal duration</th>
            <th scope="col">Square duration</th>
            <th scope="col">Status</th>
          </tr></thead>
          <tbody>{rows.map((row) => {
            const before = previousById.get(row.serviceId);
            const priceBad = row.status === "price_mismatch" || row.status === "price_and_duration_mismatch";
            const durationBad = row.status === "duration_mismatch" || row.status === "price_and_duration_mismatch";
            return <tr key={row.serviceId}>
              <td>
                <strong>{row.name}{row.isAddOn && <span className="catalog-compare-tag">Add-on</span>}</strong>
                <small>{row.group}</small>
                {row.squareName && <small>Square: {row.squareName}</small>}
                {row.issues.map((issue) => <small key={issue} className={isIssue(row) ? "catalog-sync-warning" : ""}>{issue}</small>)}
              </td>
              <td>{money(row.internalPriceCents)}</td>
              <td className={priceBad ? "is-bad" : ""}>{money(row.squarePriceCents, row.squareCurrency)}{before && before.squarePriceCents !== row.squarePriceCents && <small>was {money(before.squarePriceCents, before.squareCurrency)}</small>}</td>
              <td>{minutes(row.internalDurationMinutes)}</td>
              <td className={durationBad ? "is-bad" : ""}>{minutes(row.squareDurationMinutes)}{before && before.squareDurationMinutes !== row.squareDurationMinutes && <small>was {minutes(before.squareDurationMinutes)}</small>}</td>
              <td><span className={`catalog-compare-status ${statusTone(row.status)}`}>{STATUS_LABEL[row.status]}</span>{before && before.status !== row.status && <small>was {STATUS_LABEL[before.status]}</small>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </div>;
}
