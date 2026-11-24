"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { REPORTS_CACHE_PREFIX, SPA, cents, discountMoney, escapeHtml, fetcher, money, printDocument, toRow, type ReportRecord } from "./end-of-day-report";
import "./my-daily-report.css";

type NotePayload = { note: string; updatedAt: string | null; technician: string };
type BillCard = ReturnType<typeof toRow> & { targetMinutes: number | null; actualMinutes: number | null; paymentMethod: string };
type Summary = { count: number; revenue: number; tips: number; total: number; targetMinutes: number; actualMinutes: number };

const MAX_NOTE_LENGTH = 2000;

async function noteFetcher([url]: readonly [string, string]): Promise<NotePayload> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Note could not be loaded.");
  return body as NotePayload;
}

function actualMinutes(record: ReportRecord) {
  if (!record.appointmentAt) return null;
  const minutes = Math.round((Date.parse(record.transactedAt) - Date.parse(record.appointmentAt)) / 60000);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 12 * 60 ? minutes : null;
}

function formatMinutes(minutes: number | null) {
  if (!minutes) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest} min`;
}

function minutesDelta(target: number, actual: number) {
  const delta = actual - target;
  if (delta === 0) return "on target";
  return `${delta > 0 ? "+" : "−"}${formatMinutes(Math.abs(delta))} ${delta > 0 ? "over" : "under"}`;
}

function summaryLines(summary: Summary) {
  return [
    ["Completed", String(summary.count)],
    ["Service revenue", money(summary.revenue)],
    ["Tips", money(summary.tips)],
    ["Target time", formatMinutes(summary.targetMinutes)],
    ["Actual time", formatMinutes(summary.actualMinutes)],
  ] as const;
}

function thermalHtml(technician: string, dateLabel: string, bills: BillCard[], summary: Summary, note: string) {
  const line = (left: string, right: string, bold = false) => `<div class="ln${bold ? " b" : ""}"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`;
  const items = bills.map((bill) => `<div class="item">${line(`${bill.time} ${bill.client}`, money(bill.total), true)}
    <div class="sm">${escapeHtml(bill.service)}</div>
    <div class="sm">Svc ${money(bill.price)} · Disc ${discountMoney(bill.discount)} · Tip ${money(bill.tips)} · Paid ${escapeHtml(bill.paymentMethod)}</div>
    <div class="sm">Time ${formatMinutes(bill.actualMinutes)} / target ${formatMinutes(bill.targetMinutes)}</div></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>My Daily Report ${escapeHtml(dateLabel)}</title><style>
    @page { size: 80mm auto; margin: 3mm; } * { box-sizing: border-box; }
    body { margin: 0; width: 72mm; font: 11px/1.35 "Courier New", ui-monospace, monospace; color: #000; }
    .hd { text-align: center; } .hd h1 { font-size: 15px; margin: 0 0 2px; } .hd p { margin: 0; font-size: 10px; }
    .title { text-align: center; font-weight: 700; margin: 6px 0 2px; } .rule { border-top: 1px dashed #000; margin: 5px 0; }
    .ln { display: flex; justify-content: space-between; gap: 6px; } .ln span:first-child { overflow-wrap: anywhere; }
    .b { font-weight: 700; } .item { margin-bottom: 5px; } .sm { font-size: 10px; } .note { white-space: pre-wrap; font-size: 10px; }
  </style></head><body>
    <div class="hd"><h1>${SPA.name}</h1><p>${escapeHtml(SPA.address)}</p><p>Tel: ${SPA.phone}</p></div>
    <div class="rule"></div><div class="title">MY DAILY REPORT</div>${line("Technician", technician)}${line("Date", dateLabel)}
    <div class="rule"></div>${items || "<p>No checkouts recorded.</p>"}
    <div class="rule"></div>${summaryLines(summary).map(([label, value]) => line(label, value)).join("")}${line("TOTAL", money(summary.total), true)}
    ${note.trim() ? `<div class="rule"></div><div class="b">Reflection</div><div class="note">${escapeHtml(note)}</div>` : ""}
    <div class="rule"></div><p class="sm" style="text-align:center">Printed ${escapeHtml(new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" }))}</p>
  </body></html>`;
}

function a4Html(technician: string, dateLabel: string, bills: BillCard[], summary: Summary, note: string) {
  const rows = bills.map((bill) => `<tr><td><strong>${escapeHtml(bill.client)}</strong><br><small>${escapeHtml(bill.time)} · ${escapeHtml(bill.service)}</small></td><td>${money(bill.price)}</td><td>${discountMoney(bill.discount)}</td><td>${money(bill.tips)}</td><td>${money(bill.total)}</td><td>Paid · ${escapeHtml(bill.paymentMethod)}</td><td>${formatMinutes(bill.actualMinutes)}<br><small>target ${formatMinutes(bill.targetMinutes)}</small></td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>My Daily Report ${escapeHtml(dateLabel)}</title><style>
    @page { size: A4; margin: 14mm; } * { box-sizing: border-box; }
    body { margin: 0; font: 11px/1.4 Arial, Helvetica, sans-serif; color: #111; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
    header h1 { margin: 0; font-size: 20px; } header p { margin: 1px 0; }
    .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 14px; }
    .grid div { border: 1px solid #bbb; padding: 6px; } .grid span { display: block; font-size: 9px; text-transform: uppercase; color: #555; } .grid strong { font-size: 13px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 5px 6px; text-align: right; vertical-align: top; overflow-wrap: anywhere; }
    th:first-child, td:first-child { text-align: left; width: 32%; } th { background: #f1f1f1; } small { color: #444; } tr { break-inside: avoid; }
    h2 { font-size: 13px; margin: 16px 0 6px; } .note { white-space: pre-wrap; border: 1px solid #bbb; padding: 8px; min-height: 40px; }
  </style></head><body>
    <header><div><h1>${SPA.name}</h1><p>${escapeHtml(SPA.address)} · Tel: ${SPA.phone}</p></div><div style="text-align:right"><strong>My Daily Report · ${escapeHtml(technician)}</strong><p>${escapeHtml(dateLabel)}</p></div></header>
    <div class="grid">${[...summaryLines(summary), ["Total", money(summary.total)] as const].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>
    ${rows ? `<table><thead><tr><th>Client</th><th>Service</th><th>Discount</th><th>Tips</th><th>Total</th><th>Status</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No checkouts recorded for this day.</p>"}
    <h2>Daily reflection</h2><div class="note">${escapeHtml(note) || "—"}</div>
  </body></html>`;
}

export function MyDailyReport({ date, viewerName, bookingDurations }: { date: string; viewerName: string; bookingDurations: Record<string, number> }) {
  const report = useSWR([`${REPORTS_CACHE_PREFIX}?from=${date}&to=${date}`, "staff", viewerName] as const, fetcher, { revalidateOnFocus: true, refreshInterval: 60000 });
  const noteKey = [`${REPORTS_CACHE_PREFIX}/daily-note?date=${date}`, viewerName] as const;
  const savedNote = useSWR(noteKey, noteFetcher, { revalidateOnFocus: false });
  const [draft, setDraft] = useState<{ date: string; text: string } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const bills = useMemo<BillCard[]>(() => {
    if (report.data?.role !== "staff") return [];
    return report.data.records
      .filter((record) => record.technician === viewerName)
      .map((record) => ({
        ...toRow(record),
        targetMinutes: record.bookingId && bookingDurations[record.bookingId] ? bookingDurations[record.bookingId] : null,
        actualMinutes: actualMinutes(record),
        paymentMethod: record.paymentMethod || "Paid",
      }));
  }, [report.data, viewerName, bookingDurations]);

  const summary = useMemo<Summary>(() => bills.reduce<Summary>((totals, bill) => ({
    count: totals.count + 1,
    revenue: cents(totals.revenue + bill.price - bill.discount),
    tips: cents(totals.tips + bill.tips),
    total: cents(totals.total + bill.total),
    targetMinutes: totals.targetMinutes + (bill.targetMinutes ?? 0),
    actualMinutes: totals.actualMinutes + (bill.actualMinutes ?? 0),
  }), { count: 0, revenue: 0, tips: 0, total: 0, targetMinutes: 0, actualMinutes: 0 }), [bills]);

  const noteText = draft?.date === date ? draft.text : savedNote.data?.note ?? "";
  const isDirty = draft?.date === date && draft.text !== (savedNote.data?.note ?? "");
  const dateLabel = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  async function saveNote() {
    setSaveState("saving");
    try {
      const response = await fetch(`${REPORTS_CACHE_PREFIX}/daily-note`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, note: noteText }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error);
      await savedNote.mutate(body as NotePayload, { revalidate: false });
      setDraft(null);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return <section className="mdr" aria-labelledby="mdr-title">
    <div className="mdr-heading">
      <div>
        <p className="admin-eyebrow">BÁO CÁO CỦA TÔI</p>
        <h2 id="mdr-title">My Daily Report</h2>
        <p>{viewerName} · {dateLabel}</p>
      </div>
      <div className="mdr-print">
        <button type="button" className="admin-secondary-button" onClick={() => printDocument(thermalHtml(viewerName, dateLabel, bills, summary, noteText))}>Print My Report · 80mm</button>
        <button type="button" className="admin-primary-button" onClick={() => printDocument(a4Html(viewerName, dateLabel, bills, summary, noteText))}>Print My Report · A4</button>
      </div>
    </div>

    <dl className="mdr-summary">
      <div><dt>Completed</dt><dd>{summary.count}</dd></div>
      <div><dt>Service revenue</dt><dd>{money(summary.revenue)}</dd></div>
      <div><dt>Tips</dt><dd>{money(summary.tips)}</dd></div>
      <div className="mdr-time">
        <dt>Target vs actual</dt>
        <dd>{formatMinutes(summary.targetMinutes)} <span aria-hidden="true">/</span><span className="sr-only">versus</span> {formatMinutes(summary.actualMinutes)}</dd>
        {summary.targetMinutes > 0 && summary.actualMinutes > 0 && <small>{minutesDelta(summary.targetMinutes, summary.actualMinutes)}</small>}
      </div>
    </dl>

    {report.isLoading && <p className="mdr-status">Loading your checkouts…</p>}
    {report.error && <p className="mdr-status is-error" role="alert">{report.error.message}</p>}
    {!report.isLoading && !report.error && bills.length === 0 && <p className="mdr-status">No checkouts recorded for you on this day yet.</p>}

    {bills.length > 0 && <ul className="mdr-bills">
      {bills.map((bill) => <li key={bill.id} className="mdr-bill">
        <div className="mdr-bill-top">
          <div><strong>{bill.client}</strong><span>{bill.time}</span></div>
          <span className="mdr-paid">Paid · {bill.paymentMethod}</span>
        </div>
        <p className="mdr-services">{bill.service}</p>
        <dl className="mdr-bill-lines">
          <div><dt>Service</dt><dd>{money(bill.price)}</dd></div>
          {bill.discount > 0 && <div><dt>Discount</dt><dd>{discountMoney(bill.discount)}</dd></div>}
          <div><dt>Tips</dt><dd>{money(bill.tips)}</dd></div>
          <div><dt>Duration</dt><dd>{formatMinutes(bill.actualMinutes)}{bill.targetMinutes !== null && <small> / {formatMinutes(bill.targetMinutes)}</small>}</dd></div>
          <div className="mdr-bill-total"><dt>Total</dt><dd>{money(bill.total)}</dd></div>
        </dl>
      </li>)}
    </ul>}

    <div className="mdr-note">
      <label htmlFor="mdr-note-input">Daily reflection</label>
      <textarea id="mdr-note-input" rows={4} maxLength={MAX_NOTE_LENGTH} placeholder="What went well today? Anything to improve tomorrow?" value={noteText} disabled={savedNote.isLoading} onChange={(event) => { setDraft({ date, text: event.target.value }); setSaveState("idle"); }} />
      <div className="mdr-note-actions">
        <span aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Could not save. Try again." : savedNote.error ? "Notes are unavailable right now." : `${noteText.length}/${MAX_NOTE_LENGTH}`}</span>
        <button type="button" className="admin-primary-button" disabled={!isDirty || saveState === "saving"} onClick={() => void saveNote()}>Save note</button>
      </div>
    </div>
  </section>;
}
