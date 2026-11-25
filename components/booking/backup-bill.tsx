"use client";

import { useEffect, useId, useRef, useState } from "react";
import { openAppUrl, printReturnUrl } from "@/lib/print-return";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { billRequestPayload, calculateBill, centsToDollars, TIP_CHOICES, type BillInput, type TipChoice } from "@/data/billing";
import { allServices, selectedServiceDuration, selectedServicePrice, serviceById, serviceDisplayName, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import type { SquarePaymentSummary } from "@/data/squarePayment";
import type { Language } from "./copy";

type BackupBillProps = {
  language: Language;
  date: string;
  time: string;
  selections: string[][];
  serviceAddOns: Record<string, ServiceAddOnKey>[];
  technicians?: string[];
  customerName?: string;
  customerPhone?: string;
  squareServiceReference?: string[];
  triggerLabel?: string;
  markCheckedOutLabel?: string;
  bookingId?: string;
  terminalEnabled?: boolean;
  manualDiscountAmount?: number;
  onMarkCheckedOut?: (checkout: { tipAmount: number; paymentMethod: "Card" | "Cash" }) => void | Promise<void>;
  onBillSelectionChange?: (selections: string[][], addOns: Record<string, ServiceAddOnKey>[]) => void;
  squarePayment?: SquarePaymentSummary | null;
  onSyncFromSquare?: () => Promise<void>;
};

function formatCents(cents: number) {
  return `$${centsToDollars(cents).toFixed(2)}`;
}

const labels = {
  en: {
    title: "Tui Nail Spa",
    trigger: "Backup Bill",
    close: "Close",
    copy: "Copy Bill",
    copied: "Copied",
    print: "Print / PDF (Mac)",
    printStar: "Print Star mPOP (iPad)",
    technician: "Technician",
    markCheckedOut: "Mark checked out",
    guest: "GUEST",
    minutes: "min",
    subtotal: "Subtotal",
    comboDiscount: "Combo Discount",
    tps: "GST / TPS (5%)",
    tvq: "QST / TVQ (9.975%)",
    beforeTip: "Total before tip",
    tip: "Tip",
    grandTotal: "Grand Total",
    tipChoices: { none: "No tips", "15": "15%", "20": "20%", "25": "25%", custom: "Custom" } as Record<TipChoice, string>,
    customLabel: "Custom tip amount",
    empty: "No services selected.",
    date: "Date",
    catalog: "Internal service menu",
    catalogSearch: "Search internal services",
    squareReference: "Square booking reference only — select services from the internal menu below",
    currencyLocale: "en-CA",
  },
  fr: {
    title: "Tui Nail Spa",
    trigger: "Facture de secours",
    close: "Fermer",
    copy: "Copier le reçu",
    copied: "Copié",
    print: "Imprimer / PDF (Mac)",
    printStar: "Imprimer Star mPOP (iPad)",
    technician: "Technicienne",
    markCheckedOut: "Marquer comme payé",
    guest: "CLIENT",
    minutes: "min",
    subtotal: "Sous-total",
    comboDiscount: "Rabais combo",
    tps: "GST / TPS (5%)",
    tvq: "QST / TVQ (9.975%)",
    beforeTip: "Total avant pourboire",
    tip: "Pourboire",
    grandTotal: "Total",
    tipChoices: { none: "Sans pourboire", "15": "15%", "20": "20%", "25": "25%", custom: "Autre" } as Record<TipChoice, string>,
    customLabel: "Montant du pourboire",
    empty: "Aucun service sélectionné.",
    date: "Date",
    catalog: "Menu de services interne",
    catalogSearch: "Rechercher dans les services internes",
    squareReference: "Référence du rendez-vous Square uniquement — choisissez les services dans le menu interne ci-dessous",
    currencyLocale: "fr-CA",
  },
};

const RECEIPT_ADDRESS = "Residence Dupuis, 100-1570 Rue Saint-Timothée, Montréal, QC H2L 3N9";
const RECEIPT_PHONE = "(438) 777-7043";
const RECEIPT_GST = "GST/HST: 770848539RT0001";
const RECEIPT_QST = "PST/RST/QST: 4019625996TQ0001";
const RECEIPT_HEADER_TITLE = "Tui Nail Spa";
const RECEIPT_HEADER_LINES = [
  "100-1570 Saint timothée, Montréal, QC, H2L 3N9",
  "(438) 777-7043",
  "GST/HST : 770848539RT0001",
  "PST/RST/QST : 4019625996TQ0001",
];
const RETURN_POLICY_FR = "Return Policy: Nous avons une politique de NON-REMBOURSEMENT pour tous les services du salon. Dans le cas où vous n'êtes pas entièrement satisfait, merci de nous le faire savoir au moment de votre prestation où au plus tard 48h après.";
const RETURN_POLICY_EN = "We have a NO REFUND policy for all services of the salon. In the event that you are not completely satisfied, please let us know at the time of your service or no later than 48 hours after.";

function toCents(amount: number) {
  return Math.round(amount * 100) / 100;
}

function sanitizeCustomTip(raw: string) {
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? toCents(parsed) : 0;
}

function formatReceiptTimestamp(date: string, time: string) {
  const dateMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(time.trim());
  if (!dateMatch || !timeMatch) return [date, time].filter(Boolean).join(" ");
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const meridiem = timeMatch[3]?.toUpperCase();
  if (minutes > 59 || hours > (meridiem ? 12 : 23) || (meridiem && hours === 0)) return [date, time].filter(Boolean).join(" ");
  if (meridiem) hours = (hours % 12) + (meridiem === "PM" ? 12 : 0);
  return `${dateMatch[1]}-${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

type StarReceiptData = {
  dateTime: string;
  orderCode: string;
  paymentInfo: string;
  customerName?: string;
  customerPhone?: string;
  guests: Array<{
    name?: string;
    technician: string;
    discount: number;
    items: Array<{ name: string; duration: number; price: number; addOnName?: string; addOnPrice?: number }>;
  }>;
  subtotal: number;
  tps: number;
  tvq: number;
  tip: number;
  grandTotal: number;
};

export function buildPrintableReceiptHtml(receiptData: StarReceiptData, lang: Language) {
  const copy = lang === "en"
    ? { date: "Date / Time", guest: "Guest", technician: "Technician", minutes: "min", discount: "Combo Discount", subtotal: "Subtotal", tps: "GST 5%", tvq: "QST 9.975%", beforeTip: "Total before tip", tip: "Tip", total: "TOTAL", hours: "Appointments daily · 8:00 AM–6:00 PM", thanks: "Thank you for visiting!", thanksFr: "Merci de votre visite !", policyEn: "We have a NO REFUND policy for all salon services. Please tell us at the time of service or within 48 hours if you are not completely satisfied.", policyFr: "Nous avons une politique de NON-REMBOURSEMENT pour tous les services du salon. Merci de nous le faire savoir pendant votre prestation ou dans les 48 heures." }
    : { date: "Date / heure", guest: "Client", technician: "Technicienne", minutes: "min", discount: "Rabais combo", subtotal: "Sous-total", tps: "TPS 5%", tvq: "TVQ 9,975%", beforeTip: "Total avant pourboire", tip: "Pourboire", total: "TOTAL", hours: "Rendez-vous tous les jours · 8 h–18 h", thanks: "Merci de votre visite !", thanksFr: "Thank you for visiting!", policyEn: "We have a NO REFUND policy for all salon services. Please let us know at the time of service or within 48 hours.", policyFr: "Nous avons une politique de NON-REMBOURSEMENT pour tous les services du salon. Avisez-nous pendant votre prestation ou dans les 48 heures." };
  const money = (amount: number) => new Intl.NumberFormat(lang === "en" ? "en-CA" : "fr-CA", { style: "currency", currency: "CAD" }).format(amount);
  const guestRows = receiptData.guests.map((guest, index) => `<section class="guest"><strong>${escapeHtml(guest.name || `${copy.guest} ${index + 1}`)}</strong><div class="meta">${copy.technician}: ${escapeHtml(guest.technician || "—")}</div>${guest.items.map((item) => `<div class="row item"><span>${escapeHtml(item.name)}${item.addOnName ? `<small>${escapeHtml(item.addOnName)} +${money(item.addOnPrice ?? 0)}</small>` : ""}<small>${item.duration} ${copy.minutes}</small></span><b>${money(item.price)}</b></div>`).join("")}${guest.discount > 0 ? `<div class="row"><span>${copy.discount}</span><b>-${money(guest.discount)}</b></div>` : ""}</section>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tui Nail Spa receipt</title><style>@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{width:384px;max-width:384px;margin:0;padding:0;overflow:hidden;background:#fff;color:#000}body{font:12px/1.25 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.receipt{width:100%;max-width:384px;margin:0;padding:1mm 2.5mm 1mm 1.5mm;overflow:hidden}.topline{display:flex;justify-content:space-between;align-items:flex-start;gap:2mm;border-bottom:0;padding-bottom:1.5mm}.topline strong{font-size:13px;font-weight:700}.topline .id{display:flex;flex-direction:column;flex:1 1 auto;min-width:0}.topline .id b{font-size:16px;font-weight:800;line-height:1.2}.topline .id small{display:block;font-size:10px;font-weight:700;line-height:1.3;white-space:nowrap;letter-spacing:-0.1px;font-variant-numeric:tabular-nums}.topline .id strong{margin-top:0.8mm;font-size:16px;font-weight:900;font-variant-numeric:tabular-nums}.topline .when{flex:0 0 auto;text-align:right;font-size:11px;font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums}.brand{display:block;padding-top:2mm;border-top:1px dashed #000}.store b{display:block;font-size:13px}.store address,.store a{color:#000;font:normal 10px/1.25 Arial,sans-serif;text-decoration:none}.row{display:flex;justify-content:space-between;gap:2mm;margin:0.8mm 0}.row span{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}.row b{flex:0 0 auto;white-space:nowrap;font-variant-numeric:tabular-nums}.item{align-items:flex-start;color:#000;font-size:18px;font-weight:800;line-height:1.25;margin:1.4mm 0;font-variant-numeric:tabular-nums}.item span,.item small,.item b{color:#000}.item small{display:block;font-size:18px;font-weight:800;line-height:1.25}.item b{font-size:18px;font-weight:800;white-space:nowrap;text-align:right}.guest{padding:1.5mm 0;border-top:2px solid #000;border-bottom:2px solid #000}.guest>strong{display:block;color:#000;font-size:14px;font-weight:700;line-height:1.2}.meta{font-size:11px;font-weight:700}.totals{padding-top:1.5mm}.tax-id{padding-top:1mm;font-size:10px}.grand{margin-top:1.5mm;padding-top:1.5mm;border-top:1px dashed #000;font-size:15px;font-weight:700}.grand span,.grand b{font-size:15px;font-weight:700}.meta-line{font-size:10px}.footer{padding-top:1.5mm;text-align:center;font-size:10px}.footer b{display:block;font-size:12px}.policy{margin-top:1mm;text-align:left;font-size:9px;line-height:1.2}.site{font-weight:700}</style></head><body><main id="star-mpop-receipt" class="receipt"><div class="topline"><div class="id"><b>${escapeHtml(RECEIPT_HEADER_TITLE)}</b>${RECEIPT_HEADER_LINES.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}</div><span class="when">#${escapeHtml(receiptData.orderCode)}<br>${escapeHtml(receiptData.dateTime)}</span></div>${guestRows}<section class="totals"><div class="row"><span>Purchase Subtotal</span><b>${money(receiptData.subtotal)}</b></div><div class="row"><span>TVQ (9.975%)</span><b>${money(receiptData.tvq)}</b></div><div class="row"><span>TPS (5%)</span><b>${money(receiptData.tps)}</b></div><div class="row"><span>Tip</span><b>${money(receiptData.tip)}</b></div><div class="row grand"><span>Total</span><b>${money(receiptData.grandTotal)}</b></div></section><header class="brand"><div class="store"><b>Tui nail spa</b><address>Residence Dupuis, 100-1570 Rue Saint-Timothée, Montréal, QC H2L 3N9<br><a href="tel:4387777043">(438) 777-7043</a></address></div></header><div class="meta-line">${escapeHtml(receiptData.paymentInfo)}</div><div class="tax-id">GST/HST: 770848539RT0001<br>PST/RST/QST: 4019625996TQ0001</div><footer class="footer"><b>${copy.thanks}</b><div>${copy.thanksFr}</div><div>Nous apprécions vos affaires !<br>We appreciate your business!</div><div class="policy">${copy.policyFr}<br>${copy.policyEn}</div></footer></main></body></html>`;
}

export function buildStarMpopReceiptHtml(receiptData: StarReceiptData, lang: Language) {
  return buildPrintableReceiptHtml(receiptData, lang);
}

export function buildLegacyStarMpopReceiptHtml(receiptData: StarReceiptData, lang: Language) {
  const copy = lang === "en"
    ? { dateTime: "Date / Time", guest: "Guest", technician: "Technician", minutes: "min", discount: "Combo Discount", subtotal: "Subtotal", tps: "GST 5%", tvq: "QST 9.975%", tip: "Tip", total: "Grand Total", hours: "Appointments daily · 8:00 AM–6:00 PM", thanks: "Thank you for visiting!" }
    : { dateTime: "Date / heure", guest: "Client", technician: "Technicienne", minutes: "min", discount: "Rabais combo", subtotal: "Sous-total", tps: "TPS 5%", tvq: "TVQ 9,975%", tip: "Pourboire", total: "Total", hours: "Rendez-vous tous les jours · 8 h–18 h", thanks: "Merci de votre visite !" };
  const money = (amount: number) => new Intl.NumberFormat(lang === "en" ? "en-CA" : "fr-CA", { style: "currency", currency: "CAD" }).format(amount);
  const guestsHtml = receiptData.guests.map((guest, index) => `<section class="guest"><div class="guest-title">${escapeHtml(guest.name || `${copy.guest} ${index + 1}`)}</div><div class="meta">${escapeHtml(copy.technician)}: ${escapeHtml(guest.technician || "—")}</div>${guest.items.map((item) => `<div class="item"><span>${escapeHtml(item.name)}${item.addOnName ? `<br><small>+ ${escapeHtml(item.addOnName)} +${money(item.addOnPrice ?? 0)}</small>` : ""}<br><small>${item.duration} ${copy.minutes}</small></span><strong>${money(item.price)}</strong></div>`).join("")}${guest.discount > 0 ? `<div class="row"><span>${escapeHtml(copy.discount)}</span><strong>-${money(guest.discount)}</strong></div>` : ""}</section>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tui Nail Spa receipt</title><style>@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{width:58mm;margin:0;padding:0;background:#fff;color:#000}body{font:10px/1.35 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.receipt{width:58mm;padding:2.5mm 3mm}.brand{display:grid;grid-template-columns:1fr 2fr;align-items:center;gap:2mm;padding-bottom:2mm;border-bottom:1px solid #000}.logo{width:100%;height:auto}.store strong{display:block;font-size:13px;line-height:1.1}.store address,.store a{font:normal 8px/1.3 Arial,sans-serif;color:#000;text-decoration:none}.hours{padding:2mm 0;border-bottom:1px dashed #000;font-size:8px}.receipt-meta{padding:2mm 0}.row,.item{display:flex;justify-content:space-between;gap:2mm;margin:1.2mm 0}.row span,.item span{min-width:0;overflow-wrap:anywhere}.item{align-items:flex-start}.item strong,.row strong{white-space:nowrap}.guest{padding:1.5mm 0;border-top:1px dashed #000}.guest-title{font-weight:700}.meta,small{font-size:8px}.totals{padding-top:2mm;border-top:1px solid #000}.grand{margin-top:2mm;padding-top:2mm;border-top:1px solid #000;font-size:12px;font-weight:700}.tax-id{padding-top:2mm;border-top:1px dashed #000;font-size:8px}.thank{text-align:center;padding-top:2mm;font-weight:700}@media print{html,body{width:58mm}body{margin:0}}</style></head><body><main id="star-mpop-receipt" class="receipt"><div class="topline"><strong>Tui nail spa · ${escapeHtml(RECEIPT_QST)}</strong><span>#${escapeHtml(receiptData.orderCode)}<br>${escapeHtml(receiptData.dateTime)}</span></div><header class="brand"><svg class="logo" viewBox="0 0 100 100" role="img" aria-label="Tui Nail Spa"><circle cx="50" cy="50" r="46" fill="none" stroke="#000" stroke-width="3"/><text x="50" y="59" text-anchor="middle" font-family="Georgia,serif" font-size="42" font-weight="bold" fill="#000">Tui</text></svg><div class="store"><strong>Tui Nail Spa</strong><address>1570 Rue Saint-Timothée, Ste 100<br>Montréal, QC H2L 3N9<br><a href="tel:4387777043">438-777-7043</a></address></div></header><div class="hours">${escapeHtml(copy.hours)}</div><div class="receipt-meta">${receiptData.dateTime ? `<div class="row"><span>${copy.dateTime}</span><strong>${escapeHtml(receiptData.dateTime)}</strong></div>` : ""}${receiptData.customerName || receiptData.customerPhone ? `<div>${escapeHtml([receiptData.customerName, receiptData.customerPhone].filter(Boolean).join(" · "))}</div>` : ""}</div>${guestsHtml}<section class="totals"><div class="row"><span>${copy.subtotal}</span><strong>${money(receiptData.subtotal)}</strong></div><div class="row"><span>${copy.tps}</span><strong>${money(receiptData.tps)}</strong></div><div class="row"><span>${copy.tvq}</span><strong>${money(receiptData.tvq)}</strong></div><div class="row"><span>${copy.tip}</span><strong>${money(receiptData.tip)}</strong></div><div class="row grand"><span>${copy.total}</span><strong>${money(receiptData.grandTotal)}</strong></div></section><div class="tax-id">GST/HST: 770848539RT0001<br>QST: 4019625996TQ0001<br>${escapeHtml(receiptData.paymentInfo)}</div><footer class="thank">${copy.thanks}</footer></main></body></html>`;
}

export function BackupBill({ language, date, time, selections, serviceAddOns, technicians = [], customerName, customerPhone, squareServiceReference = [], triggerLabel, markCheckedOutLabel, bookingId, terminalEnabled = false, manualDiscountAmount = 0, onMarkCheckedOut, onBillSelectionChange, squarePayment, onSyncFromSquare }: BackupBillProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [squareSyncBusy, setSquareSyncBusy] = useState(false);
  const [squareSyncMessage, setSquareSyncMessage] = useState("");
  const titleId = useId();
  const catalogSearchId = useId();
  const [receiptLanguage, setReceiptLanguage] = useState<Language>(language);
  const [tipChoice, setTipChoice] = useState<TipChoice>(() => squarePayment && squarePayment.tipCents > 0 ? "custom" : "none");
  const [customTip, setCustomTip] = useState(() => squarePayment && squarePayment.tipCents > 0 ? (squarePayment.tipCents / 100).toFixed(2) : "");
  const squareTipKey = squarePayment ? `${squarePayment.orderId}:${squarePayment.tipCents}` : "";
  const [appliedSquareTipKey, setAppliedSquareTipKey] = useState(squareTipKey);
  if (squarePayment && squareTipKey !== appliedSquareTipKey) {
    setAppliedSquareTipKey(squareTipKey);
    setTipChoice(squarePayment.tipCents > 0 ? "custom" : "none");
    setCustomTip(squarePayment.tipCents > 0 ? (squarePayment.tipCents / 100).toFixed(2) : "");
  }
  const [customSubtotal, setCustomSubtotal] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"Interac" | "Card" | "Cash">("Card");
  const [paymentAuth, setPaymentAuth] = useState("");
  const [paymentDateTime, setPaymentDateTime] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState("");
  const [terminalStatusMessage, setTerminalStatusMessage] = useState("");
  const [terminalPairingCode, setTerminalPairingCode] = useState("");
  const [paymentLinkFallback, setPaymentLinkFallback] = useState<{ idempotencyKey: string } | null>(null);
  const [openDrawer, setOpenDrawer] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [copied, setCopied] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [activeBillGuest, setActiveBillGuest] = useState(0);
  const [localSelections, setLocalSelections] = useState(() => selections.map((ids) => [...ids]));
  const [localServiceAddOns, setLocalServiceAddOns] = useState(() => serviceAddOns.map((items) => ({ ...items })));
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPaymentDateTime(new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date()));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const billSelections = onBillSelectionChange ? selections : localSelections;
  const billServiceAddOns = onBillSelectionChange ? serviceAddOns : localServiceAddOns;
  const text = labels[receiptLanguage];
  const receiptDate = date;
  const receiptDateTime = [receiptDate, time].filter(Boolean).join(" ");
  const printReceiptDateTime = formatReceiptTimestamp(receiptDate, time);
  const receiptCode = titleId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();

  const money = (amount: number) =>
    new Intl.NumberFormat(text.currencyLocale, { style: "currency", currency: "CAD" }).format(amount);

  const currentSelections = billSelections[activeBillGuest] ?? [];
  const currentAddOns = billServiceAddOns[activeBillGuest] ?? {};
  const visibleServices = allServices.filter((service) => serviceDisplayName(service, receiptLanguage).toLowerCase().includes(catalogSearch.toLowerCase()));
  const guests = billSelections.map((ids, guestIndex) => ids.flatMap((id) => {
    const service = serviceById.get(id);
    return service ? [{ service, addOnKey: billServiceAddOns[guestIndex]?.[id] }] : [];
  }));
  const billInput: BillInput = {
    selections: billSelections,
    addOns: billServiceAddOns,
    manualDiscountCents: Math.round(manualDiscountAmount * 100),
    subtotalOverrideCents: customSubtotal ? Math.round(sanitizeCustomTip(customSubtotal) * 100) : null,
    tipChoice,
    customTipCents: Math.round(sanitizeCustomTip(customTip) * 100),
  };
  const bill = calculateBill(billInput);
  const comboDiscount = centsToDollars(bill.comboDiscountCents);
  const subtotal = centsToDollars(bill.subtotalCents);
  const tps = centsToDollars(bill.tpsCents);
  const tvq = centsToDollars(bill.tvqCents);
  const totalBeforeTip = centsToDollars(bill.totalBeforeTipCents);
  const tipAmount = centsToDollars(bill.tipCents);
  const grandTotal = centsToDollars(bill.grandTotalCents);

  function updateBillSelections(nextSelections: string[][], nextAddOns = billServiceAddOns) {
    if (onBillSelectionChange) {
      onBillSelectionChange(nextSelections, nextAddOns);
      return;
    }
    setLocalSelections(nextSelections);
    setLocalServiceAddOns(nextAddOns);
  }

  function toggleBillService(serviceId: string) {
    const nextSelections = billSelections.map((ids, guestIndex) => guestIndex !== activeBillGuest
      ? ids
      : ids.includes(serviceId) ? ids.filter((id) => id !== serviceId) : [...ids, serviceId]);
    const nextAddOns = billServiceAddOns.map((items, guestIndex) => {
      if (guestIndex !== activeBillGuest || nextSelections[guestIndex]?.includes(serviceId)) return items;
      const remaining = { ...items };
      delete remaining[serviceId];
      return remaining;
    });
    updateBillSelections(nextSelections, nextAddOns);
  }

  function changeBillAddOn(serviceId: string, value: ServiceAddOnKey | "") {
    const nextAddOns = billServiceAddOns.map((items, guestIndex) => {
      if (guestIndex !== activeBillGuest) return items;
      const next = { ...items };
      if (value) next[serviceId] = value;
      else delete next[serviceId];
      return next;
    });
    updateBillSelections(billSelections, nextAddOns);
  }

  async function syncFromSquare() {
    if (!onSyncFromSquare) return;
    setSquareSyncBusy(true);
    setSquareSyncMessage("");
    try {
      await onSyncFromSquare();
      setSquareSyncMessage("Synced with Square.");
    } catch (error) {
      setSquareSyncMessage(error instanceof Error ? error.message : "Could not sync from Square.");
    } finally {
      setSquareSyncBusy(false);
    }
  }

  function openBill() {
    dialogRef.current?.showModal();
    if (onSyncFromSquare && !squareSyncBusy) void syncFromSquare();
  }

  function closeBill() {
    dialogRef.current?.close();
  }

  async function sendToSquareCheckout() {
    if (checkoutBusy) return;
    const popup = window.open("about:blank", "_blank");
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      const response = await fetch("/api/square/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...billRequestPayload(billInput), bookingId, customerName, customerPhone, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.url !== "string") throw new Error(result?.error || "Could not create a Square checkout link.");
      if (popup) popup.location.href = result.url;
      else window.location.assign(result.url);
    } catch (error) {
      popup?.close();
      setCheckoutError(error instanceof Error ? error.message : "Could not create a Square checkout link.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  function billCheckoutPayload() {
    return {
      ...billRequestPayload(billInput),
    };
  }

  async function postTerminal(body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetch("/api/square/terminal-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(error instanceof DOMException && error.name === "TimeoutError" ? "Square did not respond within 30 seconds." : "Could not reach the server. Check the internet connection.");
    }
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const reason = typeof result.error === "string" ? result.error : `Square Terminal request failed (HTTP ${response.status}).`;
      throw Object.assign(new Error(reason), { pairingCode: typeof result.pairingCode === "string" ? result.pairingCode : "", fallbackAvailable: result.fallbackAvailable !== false });
    }
    return result;
  }

  async function openPaymentLinkFallback() {
    if (checkoutBusy || !paymentLinkFallback) return;
    const popup = window.open("about:blank", "_blank");
    setCheckoutBusy(true);
    setTerminalStatus("");
    try {
      const result = await postTerminal({ action: "payment-link", bookingId, customerName, customerPhone, ...billCheckoutPayload(), idempotencyKey: paymentLinkFallback.idempotencyKey });
      if (typeof result.url !== "string") throw new Error("Square did not return a payment link.");
      if (popup) popup.location.href = result.url;
      else window.location.assign(result.url);
      setTerminalStatusMessage(`Square payment link opened for ${money(Number(result.amountCents) / 100)}. After the card is paid, choose "Mark checked out".`);
    } catch (error) {
      popup?.close();
      setCheckoutError(`Square payment link failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function sendToSquareTerminal() {
    if (!terminalEnabled || !bookingId || !onMarkCheckedOut || checkoutBusy) return;
    if (grandTotal <= 0) { setCheckoutError("The bill total must be greater than $0.00."); return; }
    setCheckoutBusy(true);
    setCheckoutError("");
    setPaymentLinkFallback(null);
    setTerminalPairingCode("");
    setTerminalStatus("CONNECTING");
    setTerminalStatusMessage(`Looking for a Square Terminal and sending ${money(grandTotal)}…`);
    const idempotencyKey = crypto.randomUUID();
    const offerFallback = () => setPaymentLinkFallback({ idempotencyKey: crypto.randomUUID() });
    const pause = () => new Promise((resolve) => window.setTimeout(resolve, 3_000));

    try {
      const result = await postTerminal({
        bookingId,
        customerName,
        customerPhone,
        ...billCheckoutPayload(),
        idempotencyKey,
      });

      if (typeof result.checkoutId !== "string") throw new Error("Square did not return a Terminal checkout.");
      const checkoutId = result.checkoutId;
      const orderId = typeof result.orderId === "string" ? result.orderId : "";
      setTerminalStatus(typeof result.status === "string" ? result.status : "PENDING");
      setTerminalStatusMessage(`Sent ${money(grandTotal)} to ${typeof result.deviceName === "string" ? result.deviceName : "Square Terminal"}. Waiting for the customer to tap, insert, or swipe their card…`);

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const statusResult = await postTerminal({ action: "checkout-status", checkoutId });
        const status = typeof statusResult.status === "string" ? statusResult.status : "PENDING";
        setTerminalStatus(status);
        if (status === "COMPLETED") {
          if (orderId) {
            window.sessionStorage.setItem(`tui-square-order:${bookingId}`, orderId);
            window.dispatchEvent(new Event("tui-square-order-change"));
          }
          setPaymentMethod("Card");
          setPaymentDateTime(new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date()));
          setTerminalStatusMessage("Payment completed on Square Terminal. Checkout is saved.");
          try {
            await onMarkCheckedOut({ tipAmount, paymentMethod: "Card" });
          } catch (error) {
            setCheckoutError(`Payment completed, but checkout details could not be saved: ${error instanceof Error ? error.message : "try Mark checked out again."}`);
          }
          return;
        }
        if (status === "CANCELED") {
          const reason = typeof statusResult.cancelReason === "string" ? ` (${statusResult.cancelReason.replace(/_/g, " ").toLowerCase()})` : "";
          setTerminalStatus("");
          setTerminalStatusMessage("");
          setCheckoutError(`The Square Terminal checkout was canceled${reason}. Send the order again or use the Square payment link.`);
          offerFallback();
          return;
        }
        setTerminalStatusMessage(status === "IN_PROGRESS"
          ? "Square Terminal is processing the customer’s card…"
          : status === "CANCEL_REQUESTED"
            ? "Square Terminal is canceling the checkout…"
            : "Waiting for the customer to tap, insert, or swipe their card on Square Terminal…");
        await pause();
      }
      setTerminalStatus("");
      setTerminalStatusMessage("Square Terminal is still waiting. Check the device before starting another checkout.");
      offerFallback();
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Could not send this order to Square Terminal.");
      setTerminalPairingCode(error instanceof Error && "pairingCode" in error && typeof error.pairingCode === "string" ? error.pairingCode : "");
      setTerminalStatusMessage("");
      setTerminalStatus("");
      if (!(error instanceof Error && "fallbackAvailable" in error && error.fallbackAvailable === false)) offerFallback();
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function markCheckedOut() {
    if (!onMarkCheckedOut || checkoutBusy) return;
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      await onMarkCheckedOut({ tipAmount, paymentMethod: paymentMethod === "Cash" ? "Cash" : "Card" });
      closeBill();
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Could not save this checkout.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  function receiptGuestName(index: number) {
    const label = receiptLanguage === "en" ? "Guest" : "Client";
    const client = customerName?.trim();
    if (!client) return `${label} ${index + 1}`;
    if (index === 0) return client;
    return `${label} ${index + 1} · ${receiptLanguage === "en" ? "with" : "avec"} ${client}`;
  }

  const receiptData: StarReceiptData = {
    dateTime: formatReceiptTimestamp(receiptDate, time),
    orderCode: receiptCode,
    paymentInfo: `${paymentMethod}${paymentAuth ? ` · Auth ${paymentAuth}` : ""}${paymentDateTime ? ` · ${paymentDateTime}` : ""}`,
    customerName,
    customerPhone,
    guests: guests.map((items, index) => ({
      name: receiptGuestName(index),
      technician: technicians[index] || "—",
      discount: getComboDiscountDetails([billSelections[index] ?? []], [billServiceAddOns[index] ?? {}]).amount,
      items: items.map(({ service, addOnKey }) => ({
        name: serviceDisplayName(service, receiptLanguage),
        duration: selectedServiceDuration(service, addOnKey),
        price: selectedServicePrice(service, addOnKey),
        ...(service.addOn && service.addOn.key === addOnKey ? { addOnName: receiptLanguage === "en" ? service.addOn.nameEn : service.addOn.nameFr, addOnPrice: service.addOn.priceCad } : {}),
      })),
    })),
    subtotal,
    tps,
    tvq,
    tip: tipAmount,
    grandTotal,
  };

  function printInBrowser(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    window.print();
  }

  function print58mm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const receiptHtml = buildStarMpopReceiptHtml(receiptData, receiptLanguage);
    const back = encodeURIComponent(printReturnUrl());
    const drawer = openDrawer ? "ahead" : "off";
    openAppUrl(`starpassprnt://v1/print/nopreview?size=2&drawer=${drawer}&html=${encodeURIComponent(receiptHtml)}&back=${back}`);
  }

  function closeOnBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) closeBill();
  }

  async function copyBill() {
    const lines = [
      `${text.title} — Tui Nail Spa Montreal`,
      ...(receiptDateTime ? [`${text.date}: ${receiptDateTime}`] : []),
      ...guests.flatMap((items, index) => [
        receiptGuestName(index),
        ...items.map((item) => `  ${serviceDisplayNameWithAddOn(item.service, receiptLanguage, item.addOnKey)} (${selectedServiceDuration(item.service, item.addOnKey)} ${text.minutes}) — ${money(selectedServicePrice(item.service, item.addOnKey))}`),
      ]),
      "",
      ...(comboDiscount > 0 ? [`${text.comboDiscount}${comboDiscount > 5 ? ` (${comboDiscount / 5}x)` : ""}: -${money(comboDiscount)}`] : []),
      `${text.subtotal}: ${money(subtotal)}`,
      `${text.tps}: ${money(tps)}`,
      `${text.tvq}: ${money(tvq)}`,
      `${text.beforeTip}: ${money(totalBeforeTip)}`,
      ...(customerName ? [`${customerName}${customerPhone ? ` · ${customerPhone}` : ""}`] : []),
      `${text.tip}: ${money(tipAmount)}`,
      `${text.grandTotal}: ${money(grandTotal)}`,
      "",
      RECEIPT_ADDRESS,
      RECEIPT_PHONE,
      RECEIPT_GST,
      RECEIPT_QST,
      "www.tuinailspa.ca | Instagram @tuinailspa | Facebook Tui Nail Spa",
      "Politique de retour / Return Policy:",
      RETURN_POLICY_FR,
      RETURN_POLICY_EN,
      "Nous apprécions vos affaires!",
      "We appreciate your business!",
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button className="backup-bill-trigger" type="button" onClick={openBill}>{triggerLabel ?? text.trigger}</button>
      <dialog
        ref={dialogRef}
        className="backup-bill-dialog"
        aria-labelledby={titleId}
        onClick={closeOnBackdropClick}
        onClose={() => setCopied(false)}
      >
        <div className="bill-sheet">
          <header className="bill-header">
            <h2 id={titleId} className="sr-only">{text.title}</h2>
            <div className="bill-header-controls">
              <div className="receipt-language" role="group" aria-label={receiptLanguage === "en" ? "Receipt language" : "Langue du reçu"}>
                <button type="button" aria-pressed={receiptLanguage === "en"} onClick={() => setReceiptLanguage("en")}>EN</button>
                <span aria-hidden="true">|</span>
                <button type="button" aria-pressed={receiptLanguage === "fr"} onClick={() => setReceiptLanguage("fr")}>FR</button>
              </div>
              <button className="button button-back" type="button" onClick={copyBill}>{copied ? text.copied : text.copy}</button>
              <label className="bill-drawer-toggle"><input type="checkbox" checked={openDrawer} onChange={(event) => setOpenDrawer(event.target.checked)} />Open Drawer</label>
              <button className="button button-primary" type="button" onClick={print58mm}>{text.printStar}</button>
              <button className="button button-back" type="button" onClick={printInBrowser}>{text.print}</button>
              <button className="button button-primary" type="button" onClick={() => void (terminalEnabled ? sendToSquareTerminal() : sendToSquareCheckout())} disabled={checkoutBusy || (terminalEnabled && paymentMethod === "Cash") || terminalStatus === "COMPLETED"}>{checkoutBusy ? terminalStatus === "CONNECTING" ? "Connecting to Square Terminal…" : terminalStatus ? "Waiting on Square Terminal…" : "Working…" : terminalStatus === "COMPLETED" ? "Payment completed on Terminal" : terminalEnabled ? "Send Order to Square Terminal" : "Send Order to Square Checkout"}</button>
              {onSyncFromSquare && <button className="button button-back" type="button" onClick={() => void syncFromSquare()} disabled={squareSyncBusy}>{squareSyncBusy ? "Syncing…" : "Sync from Square"}</button>}
              <button className="bill-close" type="button" onClick={closeBill} aria-label={text.close}>×</button>
            </div>
          </header>
          {squareSyncMessage && <p className="bill-square-sync-status" role="status">{squareSyncMessage}</p>}

          {squarePayment && <section className="bill-square-paid" aria-label="Paid on Square">
            <div className="bill-square-paid-head">
              <strong>Paid on Square</strong>
              <span>{squarePayment.paymentMethod} · {new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(squarePayment.paidAt))}</span>
            </div>
            <dl>
              <div><dt>Subtotal</dt><dd>{formatCents(squarePayment.subtotalCents)}</dd></div>
              {squarePayment.discountCents > 0 && <div><dt>Discount</dt><dd>-{formatCents(squarePayment.discountCents)}</dd></div>}
              <div><dt>TPS 5%</dt><dd>{formatCents(squarePayment.tpsCents)}</dd></div>
              <div><dt>TVQ 9.975%</dt><dd>{formatCents(squarePayment.tvqCents)}</dd></div>
              {squarePayment.tipCents > 0 && <div><dt>Tip</dt><dd>{formatCents(squarePayment.tipCents)}</dd></div>}
              <div className="bill-square-paid-total"><dt>Total paid</dt><dd>{formatCents(squarePayment.totalCents)}</dd></div>
            </dl>
          </section>}

          {squareServiceReference.length > 0 && <aside className="bill-square-reference" aria-label={text.squareReference}>
            <strong>{text.squareReference}</strong>
            <ul>{squareServiceReference.map((service, index) => <li key={`${service}-${index}`}>{service}</li>)}</ul>
          </aside>}

          <section className="bill-catalog" aria-labelledby={`${titleId}-catalog-title`}>
            <div className="bill-catalog-heading"><h3 id={`${titleId}-catalog-title`}>{text.catalog}</h3>{billSelections.length > 1 && <div className="bill-catalog-guests" role="group" aria-label={receiptLanguage === "en" ? "Choose guest" : "Choisir un client"}>
              {billSelections.map((_, index) => <button key={index} type="button" aria-pressed={activeBillGuest === index} onClick={() => setActiveBillGuest(index)}>{text.guest} {index + 1}</button>)}
            </div>}</div>
            <label className="bill-catalog-search" htmlFor={catalogSearchId}>{text.catalogSearch}<input id={catalogSearchId} type="search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} /></label>
            <div className="bill-catalog-list">
              {visibleServices.map((service) => {
                const selected = currentSelections.includes(service.id);
                const addOnKey = currentAddOns[service.id] ?? "";
                return <article className="bill-catalog-item" key={service.id}>
                  <button type="button" aria-pressed={selected} onClick={() => toggleBillService(service.id)}>
                    <span>{serviceDisplayName(service, receiptLanguage)}</span><strong>{money(selectedServicePrice(service, addOnKey))}</strong>
                  </button>
                  {selected && service.addOn && <label>{receiptLanguage === "en" ? "Optional add-on" : "Supplément facultatif"}
                    <select value={addOnKey} onChange={(event) => changeBillAddOn(service.id, event.target.value as ServiceAddOnKey | "")}>
                      <option value="">{receiptLanguage === "en" ? "No add-on" : "Aucun supplément"}</option>
                      <option value={service.addOn.key}>{receiptLanguage === "en" ? service.addOn.labelEn : service.addOn.labelFr}</option>
                    </select>
                  </label>}
                </article>;
              })}
            </div>
          </section>

          <section id="star-mpop-receipt" className="printable-receipt" aria-label={text.title}>
            <div className="print-receipt-topline"><div className="print-receipt-topline-id"><b>{RECEIPT_HEADER_TITLE}</b>{RECEIPT_HEADER_LINES.map((line) => <small key={line}>{line}</small>)}</div><span>#{receiptCode}<br />{printReceiptDateTime}</span></div>
            {guests.map((items, index) => (
              <section key={index} className="print-receipt-guest">
                <strong>{receiptGuestName(index)}</strong>
                <div className="print-receipt-technician">{text.technician}: {technicians[index] || "—"}</div>
                {items.map((item) => (
                  <div className="print-receipt-row" key={item.service.id}>
                    <span>{serviceDisplayName(item.service, receiptLanguage)}{item.service.addOn && item.service.addOn.key === item.addOnKey && <small>{receiptLanguage === "en" ? item.service.addOn.nameEn : item.service.addOn.nameFr} +{money(item.service.addOn.priceCad)}</small>}<small>{selectedServiceDuration(item.service, item.addOnKey)} {text.minutes}</small></span>
                    <strong>{money(selectedServicePrice(item.service, item.addOnKey))}</strong>
                  </div>
                ))}
                {getComboDiscountDetails([billSelections[index] ?? []], [billServiceAddOns[index] ?? {}]).amount > 0 && <div className="print-receipt-row"><span>{text.comboDiscount}</span><strong>-{money(getComboDiscountDetails([billSelections[index] ?? []], [billServiceAddOns[index] ?? {}]).amount)}</strong></div>}
              </section>
            ))}
            <section className="print-receipt-totals">
              <div className="print-receipt-row"><span>Purchase Subtotal</span><strong>{money(subtotal)}</strong></div>
              <div className="print-receipt-row"><span>TVQ (9.975%)</span><strong>{money(tvq)}</strong></div>
              <div className="print-receipt-row"><span>TPS (5%)</span><strong>{money(tps)}</strong></div>
              <div className="print-receipt-row"><span>Tip</span><strong>{money(tipAmount)}</strong></div>
              <div className="print-receipt-row print-receipt-grand"><strong>Total</strong><strong>{money(grandTotal)}</strong></div>
            </section>
            <header className="print-receipt-brand">
              <div><strong>Tui nail spa</strong><address>{RECEIPT_ADDRESS}<br />{RECEIPT_PHONE}</address></div>
            </header>
            <div className="print-receipt-payment">{paymentMethod}{paymentAuth ? ` · Auth ${paymentAuth}` : ""}{paymentDateTime ? ` · ${paymentDateTime}` : ""}</div>
            <div className="print-receipt-tax-ids">GST/HST: 770848539RT0001<br />PST/RST/QST: 4019625996TQ0001</div>
            <footer className="print-receipt-footer">
              <p>{RETURN_POLICY_FR}</p><p>{RETURN_POLICY_EN}</p>
            </footer>
          </section>

          <label className="bill-custom-subtotal">
            <span>{receiptLanguage === "en" ? "Purchase Subtotal · editable" : "Sous-total · modifiable"}</span>
            <span className="bill-custom-input"><span aria-hidden="true">$</span><input type="text" inputMode="decimal" value={customSubtotal} placeholder={subtotal.toFixed(2)} onChange={(event) => setCustomSubtotal(event.target.value.replace(/[^0-9.,]/g, ""))} /></span>
          </label>
          <div className="bill-tips">
            <p className="bill-tip-select-label">{receiptLanguage === "en" ? "Tip" : "Pourboire"} · {receiptLanguage === "en" ? "Based on" : "Calculé sur"} {money(subtotal)}</p>
            <div className="bill-tip-options" role="group" aria-label={receiptLanguage === "en" ? "Tip amount" : "Montant du pourboire"}>
              {TIP_CHOICES.map((choice) => <button key={choice} className={`bill-tip-option${tipChoice === choice ? " is-selected" : ""}`} type="button" aria-pressed={tipChoice === choice} onClick={() => setTipChoice(choice)}>{text.tipChoices[choice]}</button>)}
            </div>
            {tipChoice === "custom" && (
              <label className="bill-custom-tip">
                <span>{text.customLabel}</span>
                <span className="bill-custom-input">
                  <span aria-hidden="true">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customTip}
                    placeholder="0.00"
                    onChange={(event) => setCustomTip(event.target.value.replace(/[^0-9.,]/g, ""))}
                  />
                </span>
              </label>
            )}
          </div>

          <div className="bill-payment-controls">
            <label className="bill-payment-method">{receiptLanguage === "en" ? "Payment method" : "Mode de paiement"}<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "Interac" | "Card" | "Cash")}><option value="Interac">Interac</option><option value="Card">{receiptLanguage === "en" ? "Card" : "Carte"}</option><option value="Cash">{receiptLanguage === "en" ? "Cash" : "Espèces"}</option></select></label>
            <label className="bill-payment-method">{receiptLanguage === "en" ? "Last 4 / Auth code" : "4 derniers chiffres / code d’autorisation"}<input value={paymentAuth} onChange={(event) => setPaymentAuth(event.target.value.slice(0, 40))} /></label>
          </div>
          {checkoutError && <p className="admin-form-error" role="alert">{terminalPairingCode && <strong>Terminal pairing code: {terminalPairingCode}<br /></strong>}{checkoutError}</p>}
          {terminalEnabled && paymentLinkFallback && <button className="button button-primary" type="button" onClick={() => void openPaymentLinkFallback()} disabled={checkoutBusy}>{checkoutBusy ? "Creating Square payment link…" : `Open Square Payment Link · ${money(grandTotal)}`}</button>}
          {terminalStatusMessage && <p className="bill-terminal-status" role="status">{terminalStatusMessage}</p>}
          {onMarkCheckedOut && <button className="bill-mark-checked-out" type="button" onClick={() => void markCheckedOut()} disabled={checkoutBusy}>{checkoutBusy ? (receiptLanguage === "en" ? "Saving checkout…" : "Enregistrement…") : markCheckedOutLabel ?? text.markCheckedOut}</button>}
        </div>
      </dialog>
    </>
  );
}
