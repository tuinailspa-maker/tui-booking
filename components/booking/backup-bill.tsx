"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { selectedServiceDuration, selectedServicePrice, serviceById, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { formatSlotTime } from "@/data/staffSchedule";
import type { Language } from "./copy";

type BackupBillProps = {
  language: Language;
  date: string;
  time: string;
  selections: string[][];
  serviceAddOns: Record<string, ServiceAddOnKey>[];
  customerName?: string;
  customerPhone?: string;
  triggerLabel?: string;
  markCheckedOutLabel?: string;
  onMarkCheckedOut?: () => void;
};

type TipChoice = "none" | "15" | "20" | "25" | "custom";

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const TIP_PERCENTS: Partial<Record<TipChoice, number>> = { "15": 0.15, "20": 0.2, "25": 0.25 };
const TIP_CHOICES: TipChoice[] = ["none", "15", "20", "25", "custom"];

const labels = {
  en: {
    title: "Tui Nail Spa",
    trigger: "Backup Bill",
    close: "Close",
    copy: "Copy Bill",
    copied: "Copied",
    print: "Print / PDF",
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
    tipChoices: { none: "No Tip (0%)", "15": "15%", "20": "20%", "25": "25%", custom: "Custom" } as Record<TipChoice, string>,
    customLabel: "Custom tip amount",
    empty: "No services selected.",
    date: "Date",
    currencyLocale: "en-CA",
  },
  fr: {
    title: "Tui Nail Spa",
    trigger: "Facture de secours",
    close: "Fermer",
    copy: "Copier le reçu",
    copied: "Copié",
    print: "Imprimer / PDF",
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
    tipChoices: { none: "Sans pourboire (0%)", "15": "15%", "20": "20%", "25": "25%", custom: "Autre" } as Record<TipChoice, string>,
    customLabel: "Montant du pourboire",
    empty: "Aucun service sélectionné.",
    date: "Date",
    currencyLocale: "fr-CA",
  },
};

const RECEIPT_ADDRESS = "100-1570 Rue Saint-Timothée, Montréal, QC H2L 3N9";
const RECEIPT_PHONE = "(438) 777-7043";
const RECEIPT_GST = "GST/HST: 770848539RT0001";
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

export function BackupBill({ language, date, time, selections, serviceAddOns, customerName, customerPhone, triggerLabel, markCheckedOutLabel, onMarkCheckedOut }: BackupBillProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tipChoiceId = useId();
  const [receiptLanguage, setReceiptLanguage] = useState<Language>(language);
  const [tipChoice, setTipChoice] = useState<TipChoice>("none");
  const [customTip, setCustomTip] = useState("");
  const [copied, setCopied] = useState(false);
  const text = labels[receiptLanguage];
  const receiptDate = date ? new Intl.DateTimeFormat(receiptLanguage === "en" ? "en-CA" : "fr-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "";
  const receiptDateTime = [receiptDate, time ? formatSlotTime(time, receiptLanguage) : ""].filter(Boolean).join(" · ");

  const money = (amount: number) =>
    new Intl.NumberFormat(text.currencyLocale, { style: "currency", currency: "CAD" }).format(amount);

  const guests = selections.map((ids, guestIndex) => ids.flatMap((id) => {
    const service = serviceById.get(id);
    return service ? [{ service, addOnKey: serviceAddOns[guestIndex]?.[id] }] : [];
  }));
  const grossSubtotal = toCents(guests.flat().reduce((sum, item) => sum + selectedServicePrice(item.service, item.addOnKey), 0));
  const comboDiscount = getComboDiscountDetails(selections, serviceAddOns).amount;
  const subtotal = toCents(grossSubtotal - comboDiscount);
  const tps = toCents(subtotal * TPS_RATE);
  const tvq = toCents(subtotal * TVQ_RATE);
  const totalBeforeTip = toCents(subtotal + tps + tvq);
  const tipAmount = tipChoice === "custom"
    ? sanitizeCustomTip(customTip)
    : toCents(subtotal * (TIP_PERCENTS[tipChoice] ?? 0));
  const grandTotal = toCents(totalBeforeTip + tipAmount);

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

  function print58mm() {
    const receiptHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{width:58mm;margin:0 auto;padding:3mm;font:12px Arial,sans-serif;color:#111}h1{text-align:center;font-size:16px}p{margin:5px 0}hr{border:0;border-top:1px dashed #555}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;gap:8px;margin:7px 0}.total{font-weight:bold}</style></head><body><h1>Tui Nail Spa</h1><p>${escapeHtml(receiptDateTime)}</p><p>${escapeHtml(customerName ?? "")} ${escapeHtml(customerPhone ?? "")}</p><hr>${guests.map((items, index) => `<p><strong>${text.guest} ${index + 1}</strong></p><ul>${items.map((item) => `<li><span>${escapeHtml(serviceDisplayNameWithAddOn(item.service, receiptLanguage, item.addOnKey))}<br>${selectedServiceDuration(item.service, item.addOnKey)} ${text.minutes}</span><span>${money(selectedServicePrice(item.service, item.addOnKey))}</span></li>`).join("")}</ul>`).join("")}<hr><p>${text.subtotal}: ${money(subtotal)}</p>${comboDiscount > 0 ? `<p>${text.comboDiscount}: -${money(comboDiscount)}</p>` : ""}<p>${text.tps}: ${money(tps)}</p><p>${text.tvq}: ${money(tvq)}</p><p>${text.tip}: ${money(tipAmount)}</p><p class="total">${text.grandTotal}: ${money(grandTotal)}</p><hr><p>${RECEIPT_ADDRESS}</p><p>${RECEIPT_PHONE}</p><p>We appreciate your business!</p></body></html>`;
    if (/iPad|iPhone|iPod/i.test(navigator.userAgent)) {
      window.location.href = `starpassprnt://v1/print/nopreview?data=${encodeURIComponent(receiptHtml)}`;
    } else {
      window.print();
    }
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
            <div className="bill-header-brand">
              <Image src="/tui-logo.png" alt="Tui Nail Spa logo" width={809} height={811} />
              <strong style={{ fontSize: "12px" }}>Tui Nail Spa Montreal</strong>
            </div>
            <div className="bill-header-controls">
              <div className="receipt-language" role="group" aria-label={receiptLanguage === "en" ? "Receipt language" : "Langue du reçu"}>
                <button type="button" aria-pressed={receiptLanguage === "en"} onClick={() => setReceiptLanguage("en")}>EN</button>
                <span aria-hidden="true">|</span>
                <button type="button" aria-pressed={receiptLanguage === "fr"} onClick={() => setReceiptLanguage("fr")}>FR</button>
              </div>
              <button className="button button-back" type="button" onClick={copyBill}>{copied ? text.copied : text.copy}</button>
              <button className="button button-primary" type="button" onClick={print58mm}>Print 58mm (Star PassPRNT)</button>
              <button className="bill-close" type="button" onClick={closeBill} aria-label={text.close}>×</button>
            </div>
          </header>

          <h2 id={titleId} className="sr-only">{text.title}</h2>
          <div className="receipt-heading">
            <address className="receipt-contact">
              <span>{RECEIPT_ADDRESS} · {RECEIPT_PHONE}</span>
              <span>{RECEIPT_GST} · {RECEIPT_QST}</span>
            </address>
          </div>

          {receiptDateTime && <p className="receipt-date"><strong>{text.date}:</strong> {receiptDateTime}</p>}
          {(customerName || customerPhone) && <p className="receipt-date"><strong>{customerName || text.guest}</strong>{customerPhone ? ` · ${customerPhone}` : ""}</p>}

          <div className="bill-items">
            {guests.length === 0 || subtotal === 0 ? <p className="bill-empty">{text.empty}</p> : guests.map((items, index) => items.length > 0 && (
              <section key={index} className="bill-guest">
                <h3>{text.guest} {index + 1}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item.service.id}>
                      <span>
                        {serviceDisplayNameWithAddOn(item.service, receiptLanguage, item.addOnKey)}
                        <small>{selectedServiceDuration(item.service, item.addOnKey)} {text.minutes}</small>
                      </span>
                      <span>{money(selectedServicePrice(item.service, item.addOnKey))}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <dl className="bill-totals">
            {comboDiscount > 0 && <div><dt>{text.comboDiscount}{comboDiscount > 5 ? ` (${comboDiscount / 5}x)` : ""}</dt><dd>-{money(comboDiscount)}</dd></div>}
            <div><dt>{text.subtotal}</dt><dd>{money(subtotal)}</dd></div>
            <div><dt>{text.tps}</dt><dd>{money(tps)}</dd></div>
            <div><dt>{text.tvq}</dt><dd>{money(tvq)}</dd></div>
            <div><dt>{text.beforeTip}</dt><dd>{money(totalBeforeTip)}</dd></div>
            <div><dt>{text.tip}</dt><dd>{money(tipAmount)}</dd></div>
            <div className="bill-grand-total"><dt>{text.grandTotal}</dt><dd>{money(grandTotal)}</dd></div>
          </dl>

          <div className="bill-tips">
            <label className="bill-tip-select-label" htmlFor={tipChoiceId}>{receiptLanguage === "en" ? "Tip" : "Pourboire"} · {receiptLanguage === "en" ? "Based on" : "Calculé sur"} {money(subtotal)}</label>
            <select id={tipChoiceId} className="bill-tip-select" value={tipChoice} onChange={(event) => setTipChoice(event.target.value as TipChoice)}>
              {TIP_CHOICES.map((choice) => <option key={choice} value={choice}>{text.tipChoices[choice]}</option>)}
            </select>
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

          <footer className="receipt-footer">
            <div className="receipt-social"><strong>www.tuinailspa.ca</strong><span>Instagram @tuinailspa</span><span>Facebook Tui Nail Spa</span></div>
            <div className="receipt-policy">
              <strong>Politique de retour / Return Policy:</strong>
              <p>{RETURN_POLICY_FR}</p>
              <p>{RETURN_POLICY_EN}</p>
            </div>
            <div className="receipt-closing"><span>Nous apprécions vos affaires!</span><span>We appreciate your business!</span></div>
          </footer>
          {onMarkCheckedOut && <button className="bill-mark-checked-out" type="button" onClick={markCheckedOut}>{markCheckedOutLabel ?? text.markCheckedOut}</button>}
        </div>
      </dialog>
    </>
  );
}
