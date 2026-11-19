"use client";

import { useRef, useState } from "react";
import { getComboDiscount } from "@/data/comboDiscount";
import { serviceById, serviceDisplayName } from "@/data/serviceTree";
import type { Language } from "./copy";

type BackupBillProps = {
  language: Language;
  selections: string[][];
};

type TipChoice = "none" | "15" | "20" | "25" | "custom";

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const TIP_PERCENTS: Partial<Record<TipChoice, number>> = { "15": 0.15, "20": 0.2, "25": 0.25 };
const TIP_CHOICES: TipChoice[] = ["none", "15", "20", "25", "custom"];

const labels = {
  en: {
    open: "Backup Bill",
    title: "TUI Backup Bill",
    close: "Close",
    copy: "Copy Bill",
    copied: "Copied",
    print: "Print / PDF",
    guest: "Guest",
    minutes: "min",
    subtotal: "Subtotal",
    comboDiscount: "Combo Discount",
    tps: "TPS (5%)",
    tvq: "TVQ (9.975%)",
    beforeTip: "Total before tip",
    tip: "Tip",
    grandTotal: "Grand Total",
    location: "Location",
    tipTitle: "Tip selection",
    basedOn: "Based on",
    tipChoices: { none: "No Tip", "15": "15%", "20": "20%", "25": "25%", custom: "Custom Tip" } as Record<TipChoice, string>,
    customLabel: "Custom tip amount",
    empty: "No services selected.",
    address: "1570 Saint Timothee, H2L3N9",
    phone: "Tel: 438-777-7043",
    currencyLocale: "en-CA",
  },
  fr: {
    open: "Facture de secours",
    title: "Facture de secours TUI",
    close: "Fermer",
    copy: "Copier la facture",
    copied: "Copié",
    print: "Imprimer / PDF",
    guest: "Client",
    minutes: "min",
    subtotal: "Sous-total",
    comboDiscount: "Rabais combo",
    tps: "TPS (5 %)",
    tvq: "TVQ (9,975 %)",
    beforeTip: "Total avant pourboire",
    tip: "Pourboire",
    grandTotal: "Total général",
    location: "Emplacement",
    tipTitle: "Pourboire",
    basedOn: "Basé sur",
    tipChoices: { none: "Aucun pourboire", "15": "15 %", "20": "20 %", "25": "25 %", custom: "Pourboire personnalisé" } as Record<TipChoice, string>,
    customLabel: "Montant du pourboire personnalisé",
    empty: "Aucun service sélectionné.",
    address: "1570 Saint Timothee, H2L3N9",
    phone: "Tél. : 438-777-7043",
    currencyLocale: "fr-CA",
  },
};

function toCents(amount: number) {
  return Math.round(amount * 100) / 100;
}

function sanitizeCustomTip(raw: string) {
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? toCents(parsed) : 0;
}

export function BackupBill({ language, selections }: BackupBillProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tipChoice, setTipChoice] = useState<TipChoice>("none");
  const [customTip, setCustomTip] = useState("");
  const [copied, setCopied] = useState(false);
  const text = labels[language];

  const money = (amount: number) =>
    new Intl.NumberFormat(text.currencyLocale, { style: "currency", currency: "CAD" }).format(amount);

  const guests = selections.map((ids) => ids.map((id) => serviceById.get(id)).filter((item) => item !== undefined));
  const grossSubtotal = toCents(guests.flat().reduce((sum, item) => sum + item.priceCad, 0));
  const comboDiscount = getComboDiscount(selections.flat(), grossSubtotal);
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

  function closeOnBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) closeBill();
  }

  async function copyBill() {
    const lines = [
      `${text.title} — TUI Nail Spa Montreal`,
      ...guests.flatMap((items, index) => [
        guests.length > 1 ? `${text.guest} ${index + 1}` : null,
        ...items.map((item) => `  ${language === "en" ? item.nameEn : item.nameFr} (${item.durationMinutes} ${text.minutes}) — ${money(item.priceCad)}`),
      ]).filter((line): line is string => line !== null),
      "",
      ...(comboDiscount > 0 ? [`${text.comboDiscount}: -${money(comboDiscount)}`] : []),
      `${text.subtotal}: ${money(subtotal)}`,
      `${text.tps}: ${money(tps)}`,
      `${text.tvq}: ${money(tvq)}`,
      `${text.beforeTip}: ${money(totalBeforeTip)}`,
      `${text.tip}: ${money(tipAmount)}`,
      `${text.grandTotal}: ${money(grandTotal)}`,
      "",
      `${text.location}: ${text.address} · ${text.phone}`,
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button className="backup-bill-trigger" type="button" onClick={openBill}>{text.open}</button>
      <dialog
        ref={dialogRef}
        className="backup-bill-dialog"
        aria-labelledby="backup-bill-title"
        onClick={closeOnBackdropClick}
        onClose={() => setCopied(false)}
      >
        <div className="bill-sheet">
          <header className="bill-header">
            <h2 id="backup-bill-title">{text.title}</h2>
            <button className="bill-close" type="button" onClick={closeBill} aria-label={text.close}>×</button>
          </header>

          <div className="bill-actions">
            <button className="button button-back" type="button" onClick={copyBill}>{copied ? text.copied : text.copy}</button>
            <button className="button button-primary" type="button" onClick={() => window.print()}>{text.print}</button>
          </div>

          <div className="bill-items">
            {guests.length === 0 || subtotal === 0 ? <p className="bill-empty">{text.empty}</p> : guests.map((items, index) => items.length > 0 && (
              <section key={index} className="bill-guest">
                {guests.length > 1 && <h3>{text.guest} {index + 1}</h3>}
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <span>
                        {language === "en" ? item.nameEn : item.nameFr}
                        <small>{item.durationMinutes} {text.minutes}</small>
                      </span>
                      <span>{money(item.priceCad)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <dl className="bill-totals">
            {comboDiscount > 0 && <div><dt>{text.comboDiscount}</dt><dd>-{money(comboDiscount)}</dd></div>}
        <div><dt>{text.subtotal}</dt><dd>{money(subtotal)}</dd></div>
            <div><dt>{text.tps}</dt><dd>{money(tps)}</dd></div>
            <div><dt>{text.tvq}</dt><dd>{money(tvq)}</dd></div>
            <div><dt>{text.beforeTip}</dt><dd>{money(totalBeforeTip)}</dd></div>
            <div><dt>{text.tip}</dt><dd>{money(tipAmount)}</dd></div>
            <div className="bill-grand-total"><dt>{text.grandTotal}</dt><dd>{money(grandTotal)}</dd></div>
          </dl>

          <fieldset className="bill-tips">
            <legend>{text.tipTitle} <span>· {text.basedOn} {money(subtotal)}</span></legend>
            <div className="bill-tip-options">
              {TIP_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={tipChoice === choice}
                  className={`bill-tip-option${tipChoice === choice ? " is-selected" : ""}`}
                  onClick={() => setTipChoice(choice)}
                >
                  {text.tipChoices[choice]}
                </button>
              ))}
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
          </fieldset>

          <address className="bill-location">
            <strong>{text.location}</strong>
            <span>{text.address}</span>
            <span>{text.phone}</span>
          </address>
        </div>
      </dialog>
    </>
  );
}
