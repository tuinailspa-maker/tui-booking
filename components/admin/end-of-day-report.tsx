"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import "./end-of-day-report.css";

type ReportRecord = {
  id: string;
  guestName: string;
  technician: string;
  services: Array<{ name: string; amount: number }>;
  serviceSubtotal: string;
  tipAmount: string;
  squareTipAmount: string | null;
  discountAmount: string | null;
  appointmentAt: string | null;
  transactedAt: string;
};

type ReportPayload = { records: ReportRecord[]; role: "owner" | "staff"; viewer: string };

type ReportRow = { id: string; client: string; time: string; service: string; price: number; discount: number; tax: number; tips: number; total: number };
type Totals = { count: number; price: number; discount: number; tax: number; tips: number; total: number };
type TechnicianSection = { technician: string; rows: ReportRow[]; totals: Totals };

const SPA = {
  name: "Tui Nail Spa",
  address: "1570 Rue Saint-Timothée, Montréal, QC H2L 3N9",
  phone: "438-777-7043",
  gst: "770848539RT0001",
  qst: "4019625996TQ0001",
};

const cents = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => `$${value.toFixed(2)}`;

async function fetcher(url: string): Promise<ReportPayload> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "End of day report could not be loaded.");
  return body as ReportPayload;
}

function torontoTime(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function toRow(record: ReportRecord): ReportRow {
  const subtotal = Number(record.serviceSubtotal) || 0;
  const discount = Number(record.discountAmount ?? 0) || 0;
  const tax = cents(cents(subtotal * 0.05) + cents(subtotal * 0.09975));
  const tips = Number(record.squareTipAmount ?? record.tipAmount) || 0;
  const price = cents(subtotal + discount);
  return {
    id: record.id,
    client: record.guestName,
    time: torontoTime(record.appointmentAt ?? record.transactedAt),
    service: record.services.map((service) => service.name).join(", ") || "Service",
    price,
    discount,
    tax,
    tips,
    total: cents(price - discount + tax + tips),
  };
}

function sumRows(rows: ReportRow[]): Totals {
  return rows.reduce<Totals>((totals, row) => ({
    count: totals.count + 1,
    price: cents(totals.price + row.price),
    discount: cents(totals.discount + row.discount),
    tax: cents(totals.tax + row.tax),
    tips: cents(totals.tips + row.tips),
    total: cents(totals.total + row.total),
  }), { count: 0, price: 0, discount: 0, tax: 0, tips: 0, total: 0 });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function printDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  view.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => { view.focus(); view.print(); setTimeout(() => frame.isConnected && frame.remove(), 60000); }, 250);
}

function thermalHtml(dateLabel: string, sections: TechnicianSection[], grand: Totals | null) {
  const line = (left: string, right: string) => `<div class="ln"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`;
  const body = sections.map((section) => `
    <div class="sec"><div class="tech">${escapeHtml(section.technician)}</div>
    ${section.rows.map((row) => `<div class="item"><div class="ln b"><span>${escapeHtml(row.time)} ${escapeHtml(row.client)}</span><span>${money(row.total)}</span></div>
      <div class="svc">${escapeHtml(row.service)}</div>
      <div class="sm">Px ${money(row.price)} · Disc -${money(row.discount)} · Tax ${money(row.tax)} · Tip ${money(row.tips)}</div></div>`).join("")}
    <div class="rule"></div>
    ${line("Clients", String(section.totals.count))}${line("Service price", money(section.totals.price))}${line("Discount", `-${money(section.totals.discount)}`)}${line("Tax (GST+QST)", money(section.totals.tax))}${line("Tips", money(section.totals.tips))}
    <div class="ln b big"><span>TECH TOTAL</span><span>${money(section.totals.total)}</span></div></div>`).join("");
  const grandBlock = grand ? `<div class="rule dbl"></div><div class="tech">ALL STAFF</div>${line("Clients", String(grand.count))}${line("Service price", money(grand.price))}${line("Discount", `-${money(grand.discount)}`)}${line("Tax (GST+QST)", money(grand.tax))}${line("Tips", money(grand.tips))}<div class="ln b big"><span>GRAND TOTAL</span><span>${money(grand.total)}</span></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>End of Day ${escapeHtml(dateLabel)}</title><style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { margin: 0; width: 72mm; font: 11px/1.35 "Courier New", ui-monospace, monospace; color: #000; }
    .hd { text-align: center; } .hd h1 { font-size: 15px; margin: 0 0 2px; } .hd p { margin: 0; font-size: 10px; }
    .title { text-align: center; font-weight: 700; margin: 6px 0 2px; letter-spacing: .5px; }
    .rule { border-top: 1px dashed #000; margin: 5px 0; } .rule.dbl { border-top: 2px solid #000; }
    .tech { font-weight: 700; font-size: 12px; text-transform: uppercase; margin: 6px 0 3px; }
    .ln { display: flex; justify-content: space-between; gap: 6px; } .ln span:first-child { overflow-wrap: anywhere; }
    .b { font-weight: 700; } .big { font-size: 12px; margin-top: 2px; }
    .item { margin-bottom: 4px; } .svc, .sm { font-size: 10px; } .ft { text-align: center; font-size: 10px; margin-top: 8px; }
  </style></head><body>
    <div class="hd"><h1>${SPA.name}</h1><p>${escapeHtml(SPA.address)}</p><p>Tel: ${SPA.phone}</p><p>GST: ${SPA.gst}</p><p>QST: ${SPA.qst}</p></div>
    <div class="rule"></div><div class="title">END OF DAY · TỔNG KẾT NGÀY</div><div class="ln"><span>Date</span><span>${escapeHtml(dateLabel)}</span></div>
    <div class="rule"></div>${body || "<p>No checkouts recorded.</p>"}${grandBlock}
    <div class="rule"></div><div class="ft">Printed ${escapeHtml(new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" }))}</div>
  </body></html>`;
}

function fullReportHtml(dateLabel: string, sections: TechnicianSection[], grand: Totals | null) {
  const totalsCells = (totals: Totals) => `<td>${money(totals.price)}</td><td>-${money(totals.discount)}</td><td>${money(totals.tax)}</td><td>${money(totals.tips)}</td><td>${money(totals.total)}</td>`;
  const tables = sections.map((section) => `<section><h2>${escapeHtml(section.technician)}</h2><table><thead><tr><th>Client</th><th>Service Price</th><th>Discount</th><th>Tax</th><th>Tips</th><th>Total</th></tr></thead><tbody>
    ${section.rows.map((row) => `<tr><td><strong>${escapeHtml(row.client)}</strong><br><small>${escapeHtml(row.time)} · ${escapeHtml(row.service)}</small></td><td>${money(row.price)}</td><td>-${money(row.discount)}</td><td>${money(row.tax)}</td><td>${money(row.tips)}</td><td>${money(row.total)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td>${escapeHtml(section.technician)} daily summary · ${section.totals.count} ${section.totals.count === 1 ? "client" : "clients"}</td>${totalsCells(section.totals)}</tr></tfoot></table></section>`).join("");
  const grandTable = grand ? `<section><h2>All Staff Grand Total</h2><table><thead><tr><th>Clients</th><th>Service Price</th><th>Discount</th><th>Tax</th><th>Tips</th><th>Total</th></tr></thead><tbody><tr class="grand"><td>${grand.count}</td>${totalsCells(grand)}</tr></tbody></table></section>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>End of Day Report ${escapeHtml(dateLabel)}</title><style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 11px/1.4 Arial, Helvetica, sans-serif; color: #111; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
    header h1 { margin: 0; font-size: 20px; } header p { margin: 1px 0; }
    h2 { font-size: 13px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .4px; }
    section { break-inside: avoid-page; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 5px 6px; text-align: right; vertical-align: top; overflow-wrap: anywhere; }
    th:first-child, td:first-child { text-align: left; width: 40%; }
    th { background: #f1f1f1; font-weight: 700; } small { color: #444; }
    tfoot td, tr.grand td { font-weight: 700; background: #f7f7f7; }
    tr { break-inside: avoid; }
  </style></head><body>
    <header><div><h1>${SPA.name}</h1><p>${escapeHtml(SPA.address)} · Tel: ${SPA.phone}</p><p>GST: ${SPA.gst} · QST: ${SPA.qst}</p></div><div style="text-align:right"><strong>End of Day Report · Tổng kết ngày</strong><p>${escapeHtml(dateLabel)}</p></div></header>
    ${tables || "<p>No checkouts recorded for this day.</p>"}${grandTable}
  </body></html>`;
}

export function EndOfDayReport({ initialDate, role, viewerName, technicians }: { initialDate: string; role: "owner" | "staff"; viewerName: string; technicians: string[] }) {
  const [date, setDate] = useState(initialDate);
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const report = useSWR(`/api/admin/reports?from=${date}&to=${date}`, fetcher, { revalidateOnFocus: true, refreshInterval: 60000 });

  const sections = useMemo<TechnicianSection[]>(() => {
    const grouped = new Map<string, ReportRow[]>();
    for (const record of report.data?.records ?? []) {
      if (role === "owner" && technicianFilter !== "all" && record.technician !== technicianFilter) continue;
      const rows = grouped.get(record.technician) ?? [];
      rows.push(toRow(record));
      grouped.set(record.technician, rows);
    }
    const order = [...technicians, ...[...grouped.keys()].filter((name) => !technicians.includes(name)).sort()];
    return order.filter((name) => grouped.has(name)).map((name) => {
      const rows = grouped.get(name)!;
      return { technician: name, rows, totals: sumRows(rows) };
    });
  }, [report.data, role, technicianFilter, technicians]);

  const showGrandTotal = role === "owner" && technicianFilter === "all";
  const grand = showGrandTotal ? sumRows(sections.flatMap((section) => section.rows)) : null;
  const dateLabel = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const filterOptions = useMemo(() => {
    const recorded = (report.data?.records ?? []).map((record) => record.technician);
    return [...new Set([...technicians, ...recorded])];
  }, [report.data, technicians]);

  return <section className="eod-report" aria-labelledby="eod-title">
    <div className="eod-heading">
      <div>
        <p className="admin-eyebrow">TỔNG KẾT NGÀY</p>
        <h2 id="eod-title">End of Day Report</h2>
        <p>{role === "staff" ? `${viewerName} · your checkouts only` : "Every checkout recorded in the dashboard, grouped by technician"}</p>
      </div>
      <div className="eod-print-actions">
        <button type="button" className="admin-secondary-button" disabled={sections.length === 0} onClick={() => printDocument(thermalHtml(dateLabel, sections, grand))}>Print Thermal Slip (80mm / Star mPOP)</button>
        <button type="button" className="admin-primary-button" disabled={sections.length === 0} onClick={() => printDocument(fullReportHtml(dateLabel, sections, grand))}>Print Full Report (A4 / PDF)</button>
      </div>
    </div>

    <div className="eod-filters" role="group" aria-label="Report filters">
      <label>Date<input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></label>
      {role === "owner" && <label>Technician<select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)}>
        <option value="all">All Staff</option>
        {filterOptions.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>}
      {date !== initialDate && <button type="button" className="admin-secondary-button" onClick={() => setDate(initialDate)}>Today</button>}
    </div>

    {report.error && <div className="admin-alert" role="alert"><strong>Report could not be loaded.</strong><span>{report.error.message}</span><button type="button" onClick={() => void report.mutate()}>Try again</button></div>}
    {report.isLoading && <div className="admin-loading" role="status"><span className="admin-spinner" />Loading checkouts…</div>}
    {!report.isLoading && !report.error && sections.length === 0 && <div className="admin-empty"><span aria-hidden="true">—</span><h3>No checkouts for {dateLabel}</h3><p>Checked-out tickets appear here as soon as they are paid.</p></div>}

    {sections.map((section) => <article key={section.technician} className="eod-section" aria-label={`${section.technician} end of day`}>
      <header className="eod-section-header"><h3>{section.technician}</h3><span>{section.totals.count} {section.totals.count === 1 ? "client" : "clients"}</span></header>
      <div className="eod-table-scroll">
        <table className="eod-table">
          <thead><tr><th scope="col">Client</th><th scope="col">Service Price</th><th scope="col">Discount</th><th scope="col">Tax</th><th scope="col">Tips</th><th scope="col">Total</th></tr></thead>
          <tbody>{section.rows.map((row) => <tr key={row.id}>
            <th scope="row"><strong>{row.client}</strong><small>{row.time} · {row.service}</small></th>
            <td>{money(row.price)}</td><td>{row.discount > 0 ? `-${money(row.discount)}` : money(0)}</td><td>{money(row.tax)}</td><td>{money(row.tips)}</td><td className="eod-total-cell">{money(row.total)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <dl className="eod-summary" aria-label={`${section.technician} daily summary`}>
        <div><dt>Clients</dt><dd>{section.totals.count}</dd></div>
        <div><dt>Service price</dt><dd>{money(section.totals.price)}</dd></div>
        <div><dt>Discount</dt><dd>-{money(section.totals.discount)}</dd></div>
        <div><dt>Tax (GST + QST)</dt><dd>{money(section.totals.tax)}</dd></div>
        <div><dt>Tips</dt><dd>{money(section.totals.tips)}</dd></div>
        <div className="eod-summary-total"><dt>Technician total</dt><dd>{money(section.totals.total)}</dd></div>
      </dl>
    </article>)}

    {grand && sections.length > 0 && <article className="eod-grand" aria-label="All staff grand total">
      <h3>All Staff Grand Total</h3>
      <dl className="eod-summary">
        <div><dt>Clients</dt><dd>{grand.count}</dd></div>
        <div><dt>Service price</dt><dd>{money(grand.price)}</dd></div>
        <div><dt>Discount</dt><dd>-{money(grand.discount)}</dd></div>
        <div><dt>Tax (GST + QST)</dt><dd>{money(grand.tax)}</dd></div>
        <div><dt>Tips</dt><dd>{money(grand.tips)}</dd></div>
        <div className="eod-summary-total"><dt>Grand total</dt><dd>{money(grand.total)}</dd></div>
      </dl>
    </article>}
  </section>;
}
