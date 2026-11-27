"use client";

import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import styles from "./technician-tips-summary.module.css";

type TipRecord = {
  id: string;
  transactedAt: string;
  businessDate: string;
  guestName: string;
  technician: string;
  services: Array<{ name: string; amount: number }>;
  serviceSubtotal: string;
  tipAmount: string;
  paymentMethod: "Card" | "Cash";
  squareOrderId: string | null;
};
type TipsPayload = { records: TipRecord[]; role: "owner" | "staff"; viewer: string };
type Period = "thisWeek" | "lastWeek" | "currentPay" | "previousPay" | "custom";
type Lang = "en" | "fr";
type TechnicianRow = { name: string; bills: TipRecord[]; subtotal: number; tips: number; tippedBills: number };

// First day of a known 14-day pay period (a Monday). Every pay period repeats every 14 days from here.
const PAY_PERIOD_ANCHOR = "2026-01-05";
const TIMEZONE = "America/Toronto";
const EMPTY: TipRecord[] = [];

const COPY = {
  en: {
    eyebrow: "PAYROLL · CREDIT TIPS",
    title: "Technician Tips Summary",
    subtitle: "Card / Square payments only · cash excluded · Montréal time",
    staffSubtitle: "Your card tips only · cash excluded · Montréal time",
    thisWeek: "This Week",
    lastWeek: "Last Week",
    currentPay: "Current Pay Period",
    previousPay: "Previous Pay Period",
    custom: "Custom",
    from: "From",
    to: "To",
    totalTips: "Total Credit Tips",
    tippedBills: "Card Transactions with Tips",
    topTech: "Top Technician by Tips",
    none: "—",
    technician: "Technician Name",
    billCount: "Card Bills Count",
    subtotal: "Total Service Subtotal (Card)",
    tips: "Total Credit Tips",
    action: "Action",
    viewDetails: "View Details",
    hideDetails: "Hide Details",
    grandTotal: "Grand Total",
    dateTime: "Date & Time",
    client: "Client Name",
    services: "Services",
    method: "Payment Method",
    serviceAmount: "Service Amount",
    tipAmount: "Tip Amount",
    empty: "No card bills in this period.",
    printA4: "Print Summary · A4",
    print58: "Print Summary · 58mm",
    printSlip: "Print slip",
    exportCsv: "Export CSV",
    loadError: "Tips could not be loaded.",
    retry: "Try again",
    loading: "Loading tips…",
    slipTitle: "Tip Payout Slip",
    period: "Period",
    printedAt: "Printed",
    signature: "Technician signature",
    bills: "bills",
    card: "Card / Square",
    language: "Language",
  },
  fr: {
    eyebrow: "PAIE · POURBOIRES CARTE",
    title: "Sommaire des pourboires par technicienne",
    subtitle: "Paiements carte / Square seulement · comptant exclu · heure de Montréal",
    staffSubtitle: "Vos pourboires carte seulement · comptant exclu · heure de Montréal",
    thisWeek: "Cette semaine",
    lastWeek: "Semaine dernière",
    currentPay: "Période de paie actuelle",
    previousPay: "Période de paie précédente",
    custom: "Personnalisé",
    from: "Du",
    to: "Au",
    totalTips: "Total des pourboires carte",
    tippedBills: "Transactions carte avec pourboire",
    topTech: "Meilleure technicienne (pourboires)",
    none: "—",
    technician: "Technicienne",
    billCount: "Nombre de factures carte",
    subtotal: "Sous-total services (carte)",
    tips: "Total des pourboires carte",
    action: "Action",
    viewDetails: "Voir le détail",
    hideDetails: "Masquer le détail",
    grandTotal: "Total général",
    dateTime: "Date et heure",
    client: "Cliente",
    services: "Services",
    method: "Mode de paiement",
    serviceAmount: "Montant des services",
    tipAmount: "Pourboire",
    empty: "Aucune facture carte pour cette période.",
    printA4: "Imprimer le sommaire · A4",
    print58: "Imprimer le sommaire · 58 mm",
    printSlip: "Imprimer le relevé",
    exportCsv: "Exporter CSV",
    loadError: "Impossible de charger les pourboires.",
    retry: "Réessayer",
    loading: "Chargement des pourboires…",
    slipTitle: "Relevé de pourboires",
    period: "Période",
    printedAt: "Imprimé le",
    signature: "Signature de la technicienne",
    bills: "factures",
    card: "Carte / Square",
    language: "Langue",
  },
} as const;

const fetcher = async (url: string): Promise<TipsPayload> => {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load tips.");
  return data;
};

function montrealToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}
function resolveRange(period: Period, today: string, customFrom: string, customTo: string) {
  if (period === "custom") return { from: customFrom || today, to: customTo || today };
  if (period === "thisWeek" || period === "lastWeek") {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const monday = shiftDate(today, weekday === 0 ? -6 : 1 - weekday);
    const start = period === "thisWeek" ? monday : shiftDate(monday, -7);
    return { from: start, to: shiftDate(start, 6) };
  }
  const currentStart = shiftDate(PAY_PERIOD_ANCHOR, Math.floor(daysBetween(PAY_PERIOD_ANCHOR, today) / 14) * 14);
  const start = period === "currentPay" ? currentStart : shiftDate(currentStart, -14);
  return { from: start, to: shiftDate(start, 13) };
}
function money(value: number, lang: Lang) {
  return new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA", { style: "currency", currency: "CAD" }).format(value);
}
function dateTime(value: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}
function sumCents(values: number[]) {
  return values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
}

function buildRows(records: TipRecord[], roster: string[]): TechnicianRow[] {
  const cardBills = records.filter((record) => record.paymentMethod === "Card");
  const names = Array.from(new Set([...roster, ...cardBills.map((record) => record.technician)])).filter(Boolean);
  return names.map((name) => {
    const bills = cardBills.filter((record) => record.technician === name);
    return {
      name,
      bills,
      subtotal: sumCents(bills.map((bill) => Number(bill.serviceSubtotal))),
      tips: sumCents(bills.map((bill) => Number(bill.tipAmount))),
      tippedBills: bills.filter((bill) => Number(bill.tipAmount) > 0).length,
    };
  }).sort((left, right) => right.tips - left.tips || left.name.localeCompare(right.name));
}

function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => { win.focus(); win.print(); setTimeout(() => frame.isConnected && frame.remove(), 60_000); }, 150);
}

function buildSlipHtml(rows: TechnicianRow[], format: "a4" | "58mm", range: { from: string; to: string }, lang: Lang) {
  const t = COPY[lang];
  const printed = dateTime(new Date().toISOString(), lang);
  const thermal = format === "58mm";
  const slips = rows.map((row) => {
    const lines = row.bills.map((bill) => thermal
      ? `<div class="line"><span>${escapeHtml(dateTime(bill.transactedAt, lang))}<br>${escapeHtml(bill.guestName)}</span><b>${money(Number(bill.tipAmount), lang)}</b></div>`
      : `<tr><td>${escapeHtml(dateTime(bill.transactedAt, lang))}</td><td>${escapeHtml(bill.guestName)}</td><td>${escapeHtml(bill.services.map((service) => service.name).join(", "))}</td><td class="num">${money(Number(bill.serviceSubtotal), lang)}</td><td class="num">${money(Number(bill.tipAmount), lang)}</td></tr>`).join("");
    const body = thermal
      ? `${lines || `<p>${t.empty}</p>`}`
      : `<table><thead><tr><th>${t.dateTime}</th><th>${t.client}</th><th>${t.services}</th><th class="num">${t.serviceAmount}</th><th class="num">${t.tipAmount}</th></tr></thead><tbody>${lines || `<tr><td colspan="5">${t.empty}</td></tr>`}</tbody></table>`;
    return `<section class="slip">
      <header><strong>Tui Nail Spa</strong><span>${t.slipTitle}</span></header>
      <div class="meta"><div><span>${t.technician}</span><b>${escapeHtml(row.name)}</b></div><div><span>${t.period}</span><b>${range.from} → ${range.to}</b></div></div>
      ${body}
      <div class="totals"><div><span>${t.billCount}</span><b>${row.bills.length}</b></div><div><span>${t.subtotal}</span><b>${money(row.subtotal, lang)}</b></div><div class="grand"><span>${t.tips}</span><b>${money(row.tips, lang)}</b></div></div>
      <footer><div class="sign">${t.signature}</div><small>${t.printedAt} ${escapeHtml(printed)} · ${t.card}</small></footer>
    </section>`;
  }).join("");
  const css = thermal
    ? `@page{size:58mm auto;margin:0}html,body{margin:0;padding:0;background:#fff;color:#000}body{width:48mm;padding:1mm 2mm;font:800 12px/1.3 "Courier New",ui-monospace,monospace;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}*{color:#000!important;box-sizing:border-box}
      .slip{padding-bottom:6mm;margin-bottom:4mm;border-bottom:2px dashed #000;break-inside:avoid}header{display:flex;flex-direction:column;align-items:center;gap:2px;padding-bottom:4px;border-bottom:2px solid #000}header strong{font-size:17px;font-weight:900}header span{font-size:12px}
      .meta{display:grid;gap:3px;padding:5px 0;border-bottom:1px dashed #000}.meta div{display:flex;flex-direction:column}.meta span{font-size:10px}.meta b{font-size:14px;overflow-wrap:anywhere}
      .line{display:flex;justify-content:space-between;gap:4px;padding:3px 0;border-bottom:1px dotted #000;font-size:11px}.line span{min-width:0;overflow-wrap:anywhere}.line b{flex:0 0 auto;white-space:nowrap}
      .totals{display:grid;gap:2px;padding-top:5px}.totals div{display:flex;justify-content:space-between;gap:4px;font-size:11px}.totals b{white-space:nowrap}.totals .grand{margin-top:3px;padding-top:4px;border-top:2px solid #000;font-size:15px;font-weight:900}
      footer{padding-top:14px}.sign{padding-top:16px;border-top:1px solid #000;font-size:10px}footer small{display:block;margin-top:6px;font-size:9px}`
    : `@page{size:A4;margin:14mm}html,body{margin:0;background:#fff;color:#111}body{font:12px/1.45 Arial,Helvetica,sans-serif;font-variant-numeric:tabular-nums}*{box-sizing:border-box}
      .slip{break-after:page;padding-bottom:8mm}.slip:last-child{break-after:auto}header{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;border-bottom:2px solid #111}header strong{font-size:20px}header span{font-size:14px;font-weight:700}
      .meta{display:flex;gap:40px;padding:12px 0}.meta div{display:flex;flex-direction:column}.meta span{color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.meta b{font-size:15px}
      table{width:100%;border-collapse:collapse;margin-top:4px}th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{background:#f3f4f3;font-size:10px;text-transform:uppercase;letter-spacing:.03em}.num{text-align:right;white-space:nowrap}tr{break-inside:avoid}
      .totals{display:grid;gap:4px;width:300px;margin:14px 0 0 auto}.totals div{display:flex;justify-content:space-between}.totals .grand{padding-top:6px;border-top:2px solid #111;font-size:16px;font-weight:700}
      footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px}.sign{width:260px;padding-top:6px;border-top:1px solid #111;font-size:11px}footer small{color:#555}`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${t.slipTitle} ${range.from} – ${range.to}</title><style>${css}</style></head><body>${slips}</body></html>`;
}

function exportCsv(rows: TechnicianRow[], range: { from: string; to: string }, lang: Lang) {
  const t = COPY[lang];
  const header = [t.technician, t.billCount, `${t.subtotal} (CAD)`, `${t.tips} (CAD)`, t.from, t.to];
  const body = rows.map((row) => [row.name, String(row.bills.length), row.subtotal.toFixed(2), row.tips.toFixed(2), range.from, range.to]);
  const grand = [t.grandTotal, String(rows.reduce((sum, row) => sum + row.bills.length, 0)), sumCents(rows.map((row) => row.subtotal)).toFixed(2), sumCents(rows.map((row) => row.tips)).toFixed(2), range.from, range.to];
  const csv = [header, ...body, grand].map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `tui-credit-tips-${range.from}_${range.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TechnicianTipsSummary({ technicians = [] }: { technicians?: string[] }) {
  const [lang, setLang] = useState<Lang>("en");
  const [period, setPeriod] = useState<Period>("currentPay");
  const [customFrom, setCustomFrom] = useState(montrealToday);
  const [customTo, setCustomTo] = useState(montrealToday);
  const [expanded, setExpanded] = useState<string | null>(null);
  const t = COPY[lang];
  const today = montrealToday();
  const range = resolveRange(period, today, customFrom, customTo);
  const validRange = Boolean(range.from && range.to && range.from <= range.to);
  const tips = useSWR<TipsPayload>(validRange ? `/api/admin/reports?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null, fetcher, { revalidateOnFocus: false });
  const records = tips.data?.records ?? EMPTY;
  const isStaff = tips.data?.role === "staff";
  const roster = useMemo(() => isStaff ? [tips.data?.viewer ?? ""] : technicians.filter((name) => name && name !== "Walk-in" && !/^Option\s/i.test(name)), [isStaff, tips.data?.viewer, technicians]);
  const rows = useMemo(() => buildRows(records, roster), [records, roster]);
  const totalTips = sumCents(rows.map((row) => row.tips));
  const totalSubtotal = sumCents(rows.map((row) => row.subtotal));
  const totalBills = rows.reduce((sum, row) => sum + row.bills.length, 0);
  const totalTipped = rows.reduce((sum, row) => sum + row.tippedBills, 0);
  const top = rows[0] && rows[0].tips > 0 ? rows[0] : null;
  const periods: Array<{ id: Period; label: string }> = [
    { id: "thisWeek", label: t.thisWeek },
    { id: "lastWeek", label: t.lastWeek },
    { id: "currentPay", label: t.currentPay },
    { id: "previousPay", label: t.previousPay },
    { id: "custom", label: t.custom },
  ];

  return <section className={`reports-panel ${styles.root}`} aria-labelledby="tips-summary-title">
    <div className="reports-heading">
      <div><span className="admin-eyebrow">{t.eyebrow}</span><h2 id="tips-summary-title">{t.title}</h2><p>{isStaff ? t.staffSubtitle : t.subtitle}</p></div>
      <div className="reports-actions">
        <div className={styles.lang} role="group" aria-label={t.language}>
          {(["en", "fr"] as const).map((option) => <button key={option} type="button" aria-pressed={lang === option} className={lang === option ? styles.langActive : undefined} onClick={() => setLang(option)}>{option.toUpperCase()}</button>)}
        </div>
        <button type="button" className="admin-secondary-button" onClick={() => printHtml(buildSlipHtml(rows, "a4", range, lang))} disabled={!rows.length}>{t.printA4}</button>
        <button type="button" className="admin-secondary-button" onClick={() => printHtml(buildSlipHtml(rows, "58mm", range, lang))} disabled={!rows.length}>{t.print58}</button>
        <button type="button" className="admin-primary-button" onClick={() => exportCsv(rows, range, lang)} disabled={!rows.length}>{t.exportCsv}</button>
      </div>
    </div>

    <div className="reports-filters" role="group" aria-label={t.period}>
      {periods.map((option) => <button key={option.id} type="button" className={period === option.id ? "is-active" : ""} aria-pressed={period === option.id} onClick={() => setPeriod(option.id)}>{option.label}</button>)}
      {period === "custom" && <div className="reports-custom-range"><label>{t.from}<input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>{t.to}<input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
      <span className="reports-range-label">{range.from} — {range.to}</span>
    </div>

    {tips.error && <div className="admin-alert" role="alert"><strong>{t.loadError}</strong><span>{tips.error.message}</span><button type="button" onClick={() => void tips.mutate()}>{t.retry}</button></div>}

    <div className={styles.cards}>
      <div className={styles.card}><span>{t.totalTips}</span><strong>{money(totalTips, lang)}</strong></div>
      <div className={styles.card}><span>{t.tippedBills}</span><strong>{totalTipped}</strong><small>{totalBills} {t.bills}</small></div>
      <div className={styles.card}><span>{t.topTech}</span><strong>{top ? top.name : t.none}</strong>{top && <small>{money(top.tips, lang)}</small>}</div>
    </div>

    <div className="reports-table-wrap">
      <table className={`reports-table ${styles.table}`}>
        <thead><tr><th scope="col">{t.technician}</th><th scope="col">{t.billCount}</th><th scope="col">{t.subtotal}</th><th scope="col">{t.tips}</th><th scope="col">{t.action}</th></tr></thead>
        <tbody>
          {tips.isLoading && <tr><td colSpan={5}>{t.loading}</td></tr>}
          {!tips.isLoading && rows.length === 0 && <tr><td colSpan={5}>{t.empty}</td></tr>}
          {rows.map((row) => {
            const open = expanded === row.name;
            const detailId = `tips-detail-${row.name.replace(/\W+/g, "-")}`;
            return <Fragment key={row.name}>
              <tr className={open ? styles.openRow : undefined}>
                <th scope="row">{row.name}</th>
                <td>{row.bills.length}</td>
                <td>{money(row.subtotal, lang)}</td>
                <td><b>{money(row.tips, lang)}</b></td>
                <td><div className={styles.rowActions}>
                  <button type="button" className={styles.linkButton} aria-expanded={open} aria-controls={detailId} onClick={() => setExpanded(open ? null : row.name)}>{open ? t.hideDetails : t.viewDetails}</button>
                  <button type="button" className={styles.linkButton} onClick={() => printHtml(buildSlipHtml([row], "58mm", range, lang))}>{t.printSlip} 58mm</button>
                  <button type="button" className={styles.linkButton} onClick={() => printHtml(buildSlipHtml([row], "a4", range, lang))}>A4</button>
                </div></td>
              </tr>
              {open && <tr id={detailId} className={styles.detailRow}><td colSpan={5}>
                {row.bills.length === 0 ? <p className={styles.detailEmpty}>{t.empty}</p> : <table className={styles.detailTable}>
                  <thead><tr><th scope="col">{t.dateTime}</th><th scope="col">{t.client}</th><th scope="col">{t.services}</th><th scope="col">{t.method}</th><th scope="col">{t.serviceAmount}</th><th scope="col">{t.tipAmount}</th></tr></thead>
                  <tbody>{row.bills.map((bill) => <tr key={bill.id}>
                    <td>{dateTime(bill.transactedAt, lang)}</td>
                    <td>{bill.guestName}</td>
                    <td>{bill.services.map((service) => service.name).join(", ")}</td>
                    <td>{bill.squareOrderId ? "Card · Square" : "Card"}</td>
                    <td>{money(Number(bill.serviceSubtotal), lang)}</td>
                    <td><b>{money(Number(bill.tipAmount), lang)}</b></td>
                  </tr>)}</tbody>
                </table>}
              </td></tr>}
            </Fragment>;
          })}
        </tbody>
        {rows.length > 0 && <tfoot><tr className={styles.grandRow}><th scope="row">{t.grandTotal}</th><td>{totalBills}</td><td>{money(totalSubtotal, lang)}</td><td><b>{money(totalTips, lang)}</b></td><td /></tr></tfoot>}
      </table>
    </div>
  </section>;
}
