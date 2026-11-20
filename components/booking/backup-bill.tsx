"use client";

import { useId, useRef, useState } from "react";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { allServices, selectedServiceDuration, selectedServicePrice, serviceById, serviceDisplayName, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { formatSlotTime } from "@/data/staffSchedule";
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
  onMarkCheckedOut?: () => void;
  onBillSelectionChange?: (selections: string[][], addOns: Record<string, ServiceAddOnKey>[]) => void;
};

type TipChoice = "none" | "15" | "18" | "20" | "custom";

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const TIP_PERCENTS: Partial<Record<TipChoice, number>> = { "15": 0.15, "18": 0.18, "20": 0.2 };
const TIP_CHOICES: TipChoice[] = ["15", "18", "20", "custom", "none"];

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
    tipChoices: { none: "No Tip", "15": "15%", "18": "18%", "20": "20%", custom: "Custom" } as Record<TipChoice, string>,
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
    tipChoices: { none: "Sans pourboire", "15": "15%", "18": "18%", "20": "20%", custom: "Autre" } as Record<TipChoice, string>,
    customLabel: "Montant du pourboire",
    empty: "Aucun service sélectionné.",
    date: "Date",
    catalog: "Menu de services interne",
    catalogSearch: "Rechercher dans les services internes",
    squareReference: "Référence du rendez-vous Square uniquement — choisissez les services dans le menu interne ci-dessous",
    currencyLocale: "fr-CA",
  },
};

const RECEIPT_ADDRESS = "1570 Rue Saint-Timothée, Ste 100, Montréal, QC H2L 3N9";
const RECEIPT_PHONE = "438-777-7043";
const RECEIPT_GST = "GST/HST: 77084539RT0001";
const RECEIPT_QST = "PST/RST/QST: 4019625996TQ0001";
const RETURN_POLICY_FR = "Nous avons une politique de NON-REMBOURSEMENT pour tous les services du salon. Dans le cas où vous n'êtes pas entièrement satisfait, merci de nous le faire savoir au moment de votre prestation ou au plus tard 48h après.";
const RETURN_POLICY_EN = "We have a NO REFUND policy for all salon services. In the event that you are not completely satisfied, please let us know at the time of your service or no later than 48 hours after.";

function toCents(amount: number) {
  return Math.round(amount * 100) / 100;
}

function sanitizeCustomTip(raw: string) {
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? toCents(parsed) : 0;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

type StarReceiptData = {
  dateTime: string;
  customerName?: string;
  customerPhone?: string;
  guests: Array<{
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
    ? { date: "Date / Time", guest: "Guest", technician: "Technician", minutes: "min", discount: "Combo Discount", subtotal: "Subtotal", tps: "GST 5%", tvq: "QST 9.975%", beforeTip: "Total before tip", tip: "Tip", total: "TOTAL", hours: "8:00 AM – 10:00 AM: Booking online only · After 10:00 AM: Walk-ins welcome", thanks: "Thank you for visiting!", thanksFr: "Merci de votre visite !", policyEn: "We have a NO REFUND policy for all salon services. Please tell us at the time of service or within 48 hours if you are not completely satisfied.", policyFr: "Nous avons une politique de NON-REMBOURSEMENT pour tous les services du salon. Merci de nous le faire savoir pendant votre prestation ou dans les 48 heures." }
    : { date: "Date / heure", guest: "Client", technician: "Technicienne", minutes: "min", discount: "Rabais combo", subtotal: "Sous-total", tps: "TPS 5%", tvq: "TVQ 9,975%", beforeTip: "Total avant pourboire", tip: "Pourboire", total: "TOTAL", hours: "8 h–10 h : Réservation en ligne seulement · Après 10 h : Clients sans rendez-vous bienvenus", thanks: "Merci de votre visite !", thanksFr: "Thank you for visiting!", policyEn: "We have a NO REFUND policy for all salon services. Please let us know at the time of service or within 48 hours.", policyFr: "Nous avons une politique de NON-REMBOURSEMENT pour tous les services du salon. Avisez-nous pendant votre prestation ou dans les 48 heures." };
  const money = (amount: number) => new Intl.NumberFormat(lang === "en" ? "en-CA" : "fr-CA", { style: "currency", currency: "CAD" }).format(amount);
  const guestRows = receiptData.guests.map((guest, index) => `<section class="guest"><strong>${copy.guest} ${index + 1}</strong><div class="meta">${copy.technician}: ${escapeHtml(guest.technician || "—")}</div>${guest.items.map((item) => `<div class="row item"><span>${escapeHtml(item.name)}${item.addOnName ? `<small>${escapeHtml(item.addOnName)} +${money(item.addOnPrice ?? 0)}</small>` : ""}<small>${item.duration} ${copy.minutes}</small></span><b>${money(item.price)}</b></div>`).join("")}${guest.discount > 0 ? `<div class="row"><span>${copy.discount}</span><b>-${money(guest.discount)}</b></div>` : ""}</section>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tui Nail Spa receipt</title><style>@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{width:58mm;margin:0;padding:0;background:#fff;color:#000}body{font:10px/1.3 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.receipt{width:58mm;padding:2.5mm 3mm 12px}.brand{display:grid;grid-template-columns:1fr 2fr;align-items:center;gap:2mm;padding-bottom:2mm;border-bottom:1px dashed #000}.mark{display:grid;place-items:center;width:100%;aspect-ratio:1;border:2px solid #000;border-radius:50%;font:bold 22px Georgia,serif}.store b{display:block;font-size:12px}.store address,.store a{color:#000;font:normal 8px/1.3 Arial,sans-serif;text-decoration:none}.hours,.meta-line{padding:2mm 0;border-bottom:1px dashed #000;font-size:8px}.row{display:flex;justify-content:space-between;gap:2mm;margin:1.2mm 0}.row span{min-width:0;overflow-wrap:anywhere}.row b{white-space:nowrap;font-variant-numeric:tabular-nums}.item{align-items:flex-start}.item small{display:block;font-size:8px}.guest{padding:1.5mm 0;border-bottom:1px dashed #000}.guest>strong{font-size:9px}.meta{font-size:8px}.totals{padding-top:2mm}.tax-id{padding-top:2mm;border-top:1px dashed #000;font-size:8px}.grand{margin-top:2mm;padding-top:2mm;border-top:1px dashed #000;font-size:12px;font-weight:700}.footer{padding-top:2mm;text-align:center;font-size:8px}.footer b{display:block;font-size:10px}.policy{margin-top:2mm;text-align:left;font-size:7px}.site{font-weight:700}</style></head><body><main class="receipt"><header class="brand"><span class="mark" aria-label="Tui Nail Spa">T</span><div class="store"><b>Tui Nail Spa</b><address>1570 Rue Saint-Timothée, Ste 100<br>Montréal, QC H2L 3N9<br><a href="tel:4387777043">438-777-7043</a><br><span class="site">www.tuinailspa.ca</span></address></div></header><div class="hours">${copy.hours}</div><div class="meta-line"><b>${copy.date}:</b> ${escapeHtml(receiptData.dateTime)}${receiptData.customerName ? `<br><b>${copy.guest}:</b> ${escapeHtml(receiptData.customerName)}` : ""}${receiptData.customerPhone ? `<br>${escapeHtml(receiptData.customerPhone)}` : ""}</div>${guestRows}<section class="totals"><div class="row"><span>${copy.subtotal}</span><b>${money(receiptData.subtotal)}</b></div><div class="row"><span>${copy.tps}</span><b>${money(receiptData.tps)}</b></div><div class="row"><span>${copy.tvq}</span><b>${money(receiptData.tvq)}</b></div><div class="tax-id">GST/HST 77084539RT0001<br>QST 4019625996TQ0001</div><div class="row"><span>${copy.beforeTip}</span><b>${money(receiptData.subtotal + receiptData.tps + receiptData.tvq)}</b></div><div class="row"><span>${copy.tip}</span><b>${money(receiptData.tip)}</b></div><div class="row grand"><span>${copy.total}</span><b>${money(receiptData.grandTotal)}</b></div></section><footer class="footer"><b>${copy.thanks}</b><div>${copy.thanksFr}</div><div>Nous apprécions vos affaires !<br>We appreciate your business!</div><div class="policy">${copy.policyFr}<br>${copy.policyEn}</div></footer></main></body></html>`;
}

export function buildStarMpopReceiptHtml(receiptData: StarReceiptData, lang: Language) {
  return buildPrintableReceiptHtml(receiptData, lang);
}

export function buildLegacyStarMpopReceiptHtml(receiptData: StarReceiptData, lang: Language) {
  const copy = lang === "en"
    ? { dateTime: "Date / Time", guest: "Guest", technician: "Technician", minutes: "min", discount: "Combo Discount", subtotal: "Subtotal", tps: "GST 5%", tvq: "QST 9.975%", tip: "Tip", total: "Grand Total", hours: "8:00 AM – 10:00 AM: Booking online only · After 10:00 AM: Walk-ins welcome", thanks: "Thank you for visiting!" }
    : { dateTime: "Date / heure", guest: "Client", technician: "Technicienne", minutes: "min", discount: "Rabais combo", subtotal: "Sous-total", tps: "TPS 5%", tvq: "TVQ 9,975%", tip: "Pourboire", total: "Total", hours: "8 h – 10 h : Réservation en ligne seulement · Après 10 h : Clients sans rendez-vous bienvenus", thanks: "Merci de votre visite !" };
  const money = (amount: number) => new Intl.NumberFormat(lang === "en" ? "en-CA" : "fr-CA", { style: "currency", currency: "CAD" }).format(amount);
  const guestsHtml = receiptData.guests.map((guest, index) => `<section class="guest"><div class="guest-title">${escapeHtml(copy.guest)} ${index + 1}</div><div class="meta">${escapeHtml(copy.technician)}: ${escapeHtml(guest.technician || "—")}</div>${guest.items.map((item) => `<div class="item"><span>${escapeHtml(item.name)}${item.addOnName ? `<br><small>+ ${escapeHtml(item.addOnName)} +${money(item.addOnPrice ?? 0)}</small>` : ""}<br><small>${item.duration} ${copy.minutes}</small></span><strong>${money(item.price)}</strong></div>`).join("")}${guest.discount > 0 ? `<div class="row"><span>${escapeHtml(copy.discount)}</span><strong>-${money(guest.discount)}</strong></div>` : ""}</section>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tui Nail Spa receipt</title><style>@page{size:58mm auto;margin:0}*{box-sizing:border-box}html,body{width:58mm;margin:0;padding:0;background:#fff;color:#000}body{font:10px/1.35 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.receipt{width:58mm;padding:2.5mm 3mm}.brand{display:grid;grid-template-columns:1fr 2fr;align-items:center;gap:2mm;padding-bottom:2mm;border-bottom:1px solid #000}.logo{width:100%;height:auto}.store strong{display:block;font-size:13px;line-height:1.1}.store address,.store a{font:normal 8px/1.3 Arial,sans-serif;color:#000;text-decoration:none}.hours{padding:2mm 0;border-bottom:1px dashed #000;font-size:8px}.receipt-meta{padding:2mm 0}.row,.item{display:flex;justify-content:space-between;gap:2mm;margin:1.2mm 0}.row span,.item span{min-width:0;overflow-wrap:anywhere}.item{align-items:flex-start}.item strong,.row strong{white-space:nowrap}.guest{padding:1.5mm 0;border-top:1px dashed #000}.guest-title{font-weight:700}.meta,small{font-size:8px}.totals{padding-top:2mm;border-top:1px solid #000}.grand{margin-top:2mm;padding-top:2mm;border-top:1px solid #000;font-size:12px;font-weight:700}.tax-id{padding-top:2mm;border-top:1px dashed #000;font-size:8px}.thank{text-align:center;padding-top:2mm;font-weight:700}@media print{html,body{width:58mm}body{margin:0}}</style></head><body><main class="receipt"><header class="brand"><svg class="logo" viewBox="0 0 100 100" role="img" aria-label="Tui Nail Spa"><circle cx="50" cy="50" r="46" fill="none" stroke="#000" stroke-width="3"/><text x="50" y="59" text-anchor="middle" font-family="Georgia,serif" font-size="42" font-weight="bold" fill="#000">Tui</text></svg><div class="store"><strong>Tui Nail Spa</strong><address>1570 Rue Saint-Timothée, Ste 100<br>Montréal, QC H2L 3N9<br><a href="tel:4387777043">438-777-7043</a></address></div></header><div class="hours">${escapeHtml(copy.hours)}</div><div class="receipt-meta">${receiptData.dateTime ? `<div class="row"><span>${copy.dateTime}</span><strong>${escapeHtml(receiptData.dateTime)}</strong></div>` : ""}${receiptData.customerName || receiptData.customerPhone ? `<div>${escapeHtml([receiptData.customerName, receiptData.customerPhone].filter(Boolean).join(" · "))}</div>` : ""}</div>${guestsHtml}<section class="totals"><div class="row"><span>${copy.subtotal}</span><strong>${money(receiptData.subtotal)}</strong></div><div class="row"><span>${copy.tps}</span><strong>${money(receiptData.tps)}</strong></div><div class="row"><span>${copy.tvq}</span><strong>${money(receiptData.tvq)}</strong></div><div class="row"><span>${copy.tip}</span><strong>${money(receiptData.tip)}</strong></div><div class="row grand"><span>${copy.total}</span><strong>${money(receiptData.grandTotal)}</strong></div></section><div class="tax-id">GST: 77084539RT0001<br>QST: 4019625996TQ0001</div><footer class="thank">${copy.thanks}</footer></main></body></html>`;
}

export function BackupBill({ language, date, time, selections, serviceAddOns, technicians = [], customerName, customerPhone, squareServiceReference = [], triggerLabel, markCheckedOutLabel, onMarkCheckedOut, onBillSelectionChange }: BackupBillProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const catalogSearchId = useId();
  const [receiptLanguage, setReceiptLanguage] = useState<Language>(language);
  const [tipChoice, setTipChoice] = useState<TipChoice>("none");
  const [customTip, setCustomTip] = useState("");
  const [copied, setCopied] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [activeBillGuest, setActiveBillGuest] = useState(0);
  const [localSelections, setLocalSelections] = useState(() => selections.map((ids) => [...ids]));
  const [localServiceAddOns, setLocalServiceAddOns] = useState(() => serviceAddOns.map((items) => ({ ...items })));
  const billSelections = onBillSelectionChange ? selections : localSelections;
  const billServiceAddOns = onBillSelectionChange ? serviceAddOns : localServiceAddOns;
  const text = labels[receiptLanguage];
  const receiptDate = date ? new Intl.DateTimeFormat(receiptLanguage === "en" ? "en-CA" : "fr-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "";
  const receiptDateTime = [receiptDate, time ? formatSlotTime(time, receiptLanguage) : ""].filter(Boolean).join(" · ");

  const money = (amount: number) =>
    new Intl.NumberFormat(text.currencyLocale, { style: "currency", currency: "CAD" }).format(amount);

  const currentSelections = billSelections[activeBillGuest] ?? [];
  const currentAddOns = billServiceAddOns[activeBillGuest] ?? {};
  const visibleServices = allServices.filter((service) => serviceDisplayName(service, receiptLanguage).toLowerCase().includes(catalogSearch.toLowerCase()));
  const guests = billSelections.map((ids, guestIndex) => ids.flatMap((id) => {
    const service = serviceById.get(id);
    return service ? [{ service, addOnKey: billServiceAddOns[guestIndex]?.[id] }] : [];
  }));
  const grossSubtotal = toCents(guests.flat().reduce((sum, item) => sum + selectedServicePrice(item.service, item.addOnKey), 0));
  const comboDiscount = getComboDiscountDetails(billSelections, billServiceAddOns).amount;
  const subtotal = toCents(grossSubtotal - comboDiscount);
  const tps = toCents(subtotal * TPS_RATE);
  const tvq = toCents(subtotal * TVQ_RATE);
  const totalBeforeTip = toCents(subtotal + tps + tvq);
  const tipAmount = tipChoice === "custom"
    ? sanitizeCustomTip(customTip)
    : toCents(subtotal * (TIP_PERCENTS[tipChoice] ?? 0));
  const grandTotal = toCents(totalBeforeTip + tipAmount);

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

  function openBill() {
    dialogRef.current?.showModal();
  }

  function closeBill() {
    dialogRef.current?.close();
  }

  function markCheckedOut() {
    onMarkCheckedOut?.();
    closeBill();
  }

  const receiptData: StarReceiptData = {
    dateTime: receiptDateTime,
    customerName,
    customerPhone,
    guests: guests.map((items, index) => ({
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

  function printInBrowser() {
    window.print();
  }

  function print58mm() {
    const receiptHtml = buildPrintableReceiptHtml(receiptData, receiptLanguage);
    const back = encodeURIComponent(window.location.href);
    window.location.href = `starpassprnt://v1/print/nopreview?html=${encodeURIComponent(receiptHtml)}&size=2&drawer=off&back=${back}`;
  }

  function closeOnBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) closeBill();
  }

  async function copyBill() {
    const lines = [
      `${text.title} — Tui Nail Spa Montreal`,
      ...(receiptDateTime ? [`${text.date}: ${receiptDateTime}`] : []),
      ...guests.flatMap((items, index) => [
        `${text.guest} ${index + 1}`,
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
              <button className="button button-primary" type="button" onClick={print58mm}>{text.printStar}</button>
              <button className="button button-back" type="button" onClick={printInBrowser}>{text.print}</button>
              <button className="bill-close" type="button" onClick={closeBill} aria-label={text.close}>×</button>
            </div>
          </header>

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
                      <option value={service.addOn.key}>{receiptLanguage === "en" ? service.addOn.nameEn : service.addOn.nameFr} +{money(service.addOn.priceCad)}</option>
                    </select>
                  </label>}
                </article>;
              })}
            </div>
          </section>

          <section id="printable-receipt" className="printable-receipt" aria-label={text.title}>
            <header className="print-receipt-brand">
              <span className="print-receipt-logo" aria-hidden="true">T</span>
              <div><strong>Tui Nail Spa</strong><address>{RECEIPT_ADDRESS}<br />{RECEIPT_PHONE}<br />www.tuinailspa.ca</address></div>
            </header>
            <p className="print-receipt-hours">{receiptLanguage === "en" ? "8:00 AM – 10:00 AM: Booking online only · After 10:00 AM: Walk-ins welcome" : "8 h–10 h : Réservation en ligne seulement · Après 10 h : Clients sans rendez-vous bienvenus"}</p>
            {(receiptDateTime || customerName || customerPhone) && <div className="print-receipt-meta">
              {receiptDateTime && <div><strong>{receiptLanguage === "en" ? "Date / Time" : "Date / heure"}:</strong> {receiptDateTime}</div>}
              {customerName && <div><strong>{receiptLanguage === "en" ? "Guest" : "Client"}:</strong> {customerName}</div>}
              {customerPhone && <div>{customerPhone}</div>}
            </div>}
            {guests.map((items, index) => (
              <section key={index} className="print-receipt-guest">
                <strong>{text.guest} {index + 1}</strong>
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
              <div className="print-receipt-row"><span>{text.subtotal}</span><strong>{money(subtotal)}</strong></div>
              <div className="print-receipt-row"><span>{text.tps}</span><strong>{money(tps)}</strong></div>
              <div className="print-receipt-row"><span>{text.tvq}</span><strong>{money(tvq)}</strong></div>
              <div className="print-receipt-tax-ids">{RECEIPT_GST}<br />{RECEIPT_QST}</div>
              <div className="print-receipt-row"><span>{text.beforeTip}</span><strong>{money(totalBeforeTip)}</strong></div>
              <div className="print-receipt-row"><span>{text.tip}</span><strong>{money(tipAmount)}</strong></div>
              <div className="print-receipt-row print-receipt-grand"><strong>{text.grandTotal}</strong><strong>{money(grandTotal)}</strong></div>
            </section>
            <footer className="print-receipt-footer">
              <strong>{receiptLanguage === "en" ? "Thank you for visiting!" : "Merci de votre visite !"}</strong>
              <div>Nous apprécions vos affaires !<br />We appreciate your business!</div>
              <p>{RETURN_POLICY_FR}</p><p>{RETURN_POLICY_EN}</p>
            </footer>
          </section>

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

          {onMarkCheckedOut && <button className="bill-mark-checked-out" type="button" onClick={markCheckedOut}>{markCheckedOutLabel ?? text.markCheckedOut}</button>}
        </div>
      </dialog>
    </>
  );
}
