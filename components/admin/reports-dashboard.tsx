"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import styles from "./reports-dashboard.module.css";

type ReportRecord = {
  id: string;
  bookingId: string;
  guestIndex: number;
  transactedAt: string;
  businessDate: string;
  guestName: string;
  technician: string;
  services: Array<{ name: string; amount: number }>;
  serviceSubtotal: string;
  tipAmount: string;
  paymentMethod: "Card" | "Cash";
  squareOrderId: string | null;
  squareTipAmount: string | null;
};

type ReportsPayload = { records: ReportRecord[]; webhookConfigured: boolean };
type Period = "today" | "week" | "biweekly" | "custom";
const TECHNICIANS = ["Jenny", "Melika", "Nana"];
const EMPTY_REPORTS: ReportRecord[] = [];
const fetcher = async (url: string): Promise<ReportsPayload> => {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load reports.");
  return data;
};

function montrealToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function dateRange(period: Period, today: string, customFrom: string, customTo: string) {
  if (period === "custom") return { from: customFrom || today, to: customTo || today };
  if (period === "today") return { from: today, to: today };
  if (period === "biweekly") return { from: shiftDate(today, -13), to: today };
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return { from: shiftDate(today, mondayOffset), to: shiftDate(today, mondayOffset + 6) };
}
function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}
function exportCsv(records: ReportRecord[]) {
  const rows = [["Date (Montreal)", "Booking ID", "Guest", "Technician", "Services", "Pre-tax Service Sales (CAD)", "Tip (CAD)", "Payment Method", "Square Order ID"]];
  for (const record of records) rows.push([
    new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(record.transactedAt)),
    record.bookingId,
    record.guestName,
    record.technician,
    record.services.map((service) => service.name).join("; "),
    Number(record.serviceSubtotal).toFixed(2),
    Number(record.tipAmount).toFixed(2),
    record.paymentMethod,
    record.squareOrderId ?? "",
  ]);
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `tui-revenue-${montrealToday()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsDashboard() {
  const [period, setPeriod] = useState<Period>("today");
  const [customFrom, setCustomFrom] = useState(montrealToday);
  const [customTo, setCustomTo] = useState(montrealToday);
  const [technicianFilter, setTechnicianFilter] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const today = montrealToday();
  const range = dateRange(period, today, customFrom, customTo);
  const key = range.from && range.to && range.from <= range.to ? `/api/admin/reports?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null;
  const reports = useSWR<ReportsPayload>(key, fetcher, { revalidateOnFocus: false });
  const records = reports.data?.records ?? EMPTY_REPORTS;
  const unassigned = records.filter((record) => !TECHNICIANS.includes(record.technician));
  const technicianRows = [...TECHNICIANS.map((name) => ({ name, records: records.filter((record) => record.technician === name) })), { name: "Unassigned", records: unassigned }, { name: "Total", records }];
  const visibleRecords = useMemo(() => records.filter((record) => !technicianFilter || (technicianFilter === "Unassigned" ? !TECHNICIANS.includes(record.technician) : technicianFilter === "Total" || record.technician === technicianFilter)), [records, technicianFilter]);

  async function syncTips() {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/reports/sync-tips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(range) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sync Square tips.");
      setNotice(`Square tip sync complete: ${result.syncedRecords} guest records updated across ${result.syncedOrders} orders.`);
      await reports.mutate();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Could not sync Square tips.");
    } finally {
      setSyncing(false);
    }
  }

  return <section className={`reports-panel ${styles.root}`} aria-labelledby="reports-title">
    <div className="reports-heading"><div><span className="admin-eyebrow">REVENUE & PAYROLL</span><h2 id="reports-title">Service reports</h2><p>Checkout totals, tips, and technician turns · all dates in Montréal time</p></div><div className="reports-actions"><button type="button" className="admin-secondary-button" onClick={() => void syncTips()} disabled={syncing || !records.some((record) => record.squareOrderId)}>{syncing ? "Syncing tips…" : "Sync Tips from Square"}</button><button type="button" className="admin-primary-button" onClick={() => exportCsv(visibleRecords)} disabled={visibleRecords.length === 0}>Export CSV</button></div></div>
    <div className="reports-filters" role="group" aria-label="Report date range">
      {[{ id: "today", label: "Today" }, { id: "week", label: "This Week" }, { id: "biweekly", label: "Bi-Weekly · 14 days" }, { id: "custom", label: "Custom range" }].map((option) => <button key={option.id} type="button" className={period === option.id ? "is-active" : ""} aria-pressed={period === option.id} onClick={() => setPeriod(option.id as Period)}>{option.label}</button>)}
      {period === "custom" && <div className="reports-custom-range"><label>From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
      <span className="reports-range-label">{range.from} — {range.to}</span>
    </div>
    {reports.data && !reports.data.webhookConfigured && <div className="reports-setup-banner" role="status"><strong>Google Sheets delivery is not configured.</strong><span>Checkouts are still stored safely in Neon and appear here. Add <code>GOOGLE_SHEETS_REPORTS_WEBHOOK_URL</code> in project Vars to also send them to your Apps Script web app.</span></div>}
    {error && <div className="admin-alert" role="alert"><strong>Report action failed.</strong><span>{error}</span></div>}
    {notice && <p className="reports-notice" role="status">{notice}</p>}
    {reports.error && <div className="admin-alert" role="alert"><strong>Reports could not be loaded.</strong><span>{reports.error.message}</span><button type="button" onClick={() => void reports.mutate()}>Try again</button></div>}
    <div className="reports-cards" aria-label="Technician revenue summary">
      {technicianRows.map(({ name, records: rowRecords }) => {
        const sales = rowRecords.reduce((sum, record) => sum + Number(record.serviceSubtotal), 0);
        const cardTips = rowRecords.filter((record) => record.paymentMethod === "Card").reduce((sum, record) => sum + Number(record.tipAmount), 0);
        const cashTips = rowRecords.filter((record) => record.paymentMethod === "Cash").reduce((sum, record) => sum + Number(record.tipAmount), 0);
        const guests = rowRecords.length;
        const selected = technicianFilter === name || (!technicianFilter && name === "Total");
        return <button key={name} type="button" className={`reports-card${selected ? " is-selected" : ""}`} onClick={() => setTechnicianFilter((current) => current === name ? null : name)} aria-pressed={selected}>
          <span className="reports-card-name">{name}</span><strong className="reports-card-sales">{money(sales)}</strong><small>Pre-tax service sales</small>
          <span className="reports-card-tips"><span>Card tips <b>{money(cardTips)}</b></span><span>Cash tips <b>{money(cashTips)}</b></span><span>Total tips <b>{money(cardTips + cashTips)}</b></span></span>
          <span className="reports-card-stats"><span>{guests} {guests === 1 ? "guest" : "guests"}</span><span>{(sales / 15).toFixed(1)} estimated turns</span></span>
        </button>;
      })}
    </div>
    <div className="reports-table-heading"><div><h3>{technicianFilter ? `${technicianFilter} transactions` : "All transactions"}</h3><span>{visibleRecords.length} guest {visibleRecords.length === 1 ? "record" : "records"}</span></div><button type="button" className="reports-clear-filter" onClick={() => setTechnicianFilter(null)} disabled={!technicianFilter}>Clear technician filter</button></div>
    <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Date / time</th><th>Guest</th><th>Technician</th><th>Services</th><th>Service sales</th><th>Tip</th><th>Payment</th><th>Square order</th></tr></thead><tbody>
      {visibleRecords.map((record) => <tr key={record.id}><td>{new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(record.transactedAt))}</td><td>{record.guestName}<small>{record.bookingId}</small></td><td>{record.technician}</td><td>{record.services.map((service) => service.name).join(", ") || "—"}</td><td>{money(Number(record.serviceSubtotal))}</td><td>{money(Number(record.tipAmount))}{record.squareTipAmount !== null && <small>Square synced</small>}</td><td><span className={`reports-payment is-${record.paymentMethod.toLowerCase()}`}>{record.paymentMethod}</span></td><td>{record.squareOrderId ?? "—"}</td></tr>)}
      {visibleRecords.length === 0 && <tr><td className="reports-empty" colSpan={8}>{reports.isLoading ? "Loading transactions…" : "No checkout transactions in this date range yet."}</td></tr>}
    </tbody></table></div>
    <p className="reports-payroll-note">Estimated turns = pre-tax service sales ÷ $15. Square tip sync refreshes recorded tips for matching orders; payment method remains the staff selection made at checkout.</p>
  </section>;
}
