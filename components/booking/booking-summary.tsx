import { selectedServicePrice, serviceById, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { formatSlotTime } from "@/data/staffSchedule";
import type { BookingCopy, Language } from "./copy";
import { BackupBill } from "./backup-bill";

type BookingSummaryProps = {
  language: Language;
  copy: BookingCopy;
  partySize: number;
  date: string;
  time: string;
  selections: string[][];
  serviceAddOns: Record<string, ServiceAddOnKey>[];
};

export function getBookingTotals(selections: string[][], serviceAddOns: Record<string, ServiceAddOnKey>[] = []) {
  const guestDurations = selections.map((ids) => ids.reduce((sum, id) => sum + (serviceById.get(id)?.durationMinutes ?? 0), 0));
  const guestPrices = selections.map((ids, guestIndex) => ids.reduce((sum, id) => {
    const service = serviceById.get(id);
    return sum + (service ? selectedServicePrice(service, serviceAddOns[guestIndex]?.[id]) : 0);
  }, 0));
  const subtotal = guestPrices.reduce((sum, value) => sum + value, 0);
  const comboDiscount = getComboDiscountDetails(selections, serviceAddOns).amount;
  return {
    serviceCount: selections.reduce((sum, ids) => sum + ids.length, 0),
    subtotal,
    comboDiscount,
    guestDurations,
    duration: guestDurations.length ? Math.max(...guestDurations) : 0,
  };
}

export function formatCad(amount: number, language: Language) {
  return new Intl.NumberFormat(language === "en" ? "en-CA" : "fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string, language: Language) {
  if (!date) return "";
  return new Intl.DateTimeFormat(language === "en" ? "en-CA" : "fr-CA", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function BookingSummary({ language, copy, partySize, date, time, selections, serviceAddOns }: BookingSummaryProps) {
  const totals = getBookingTotals(selections, serviceAddOns);
  return (
    <div className="summary-content">
      <div className="summary-topline">
        <p className="summary-eyebrow">TUI NAIL SPA</p>
        <span className="summary-mark" aria-hidden="true">t.</span>
      </div>
      <h2>{copy.summary}</h2>
      <div className="summary-meta">
        <div><span>{copy.summaryGuests}</span><strong>{partySize} {partySize === 1 ? copy.guest : copy.guests}</strong></div>
        {date && <div><span>{copy.summaryDate}</span><strong>{formatDate(date, language)}</strong></div>}
        {time && <div><span>{copy.summaryTime}</span><strong>{formatSlotTime(time, language)}</strong></div>}
      </div>
      <div className="summary-services">
        <div className="summary-section-title"><span>{copy.summarySelected}</span><span>{totals.serviceCount}</span></div>
        {selections.map((ids, index) => (
          <div className="summary-guest" key={index}>
            {partySize > 1 && <p className="summary-guest-label"><span>{copy.guest} {index + 1}</span><span>{totals.guestDurations[index]} min</span></p>}
            {ids.length ? (
              <ul>
                {ids.map((id) => {
                  const item = serviceById.get(id);
                  if (!item) return null;
                  const addOnKey = serviceAddOns[index]?.[id];
                  const price = selectedServicePrice(item, addOnKey);
                  return <li key={id}><span>{serviceDisplayNameWithAddOn(item, language, addOnKey)}</span><span>{item.priceLabel && !addOnKey ? item.priceLabel : formatCad(price, language)}</span></li>;
                })}
              </ul>
            ) : <p className="summary-empty">{copy.noServices}</p>}
          </div>
        ))}
      </div>
      <div className="summary-totals">
        <div><span>{copy.totalDuration}</span><strong>{totals.duration} min</strong></div>
        {totals.comboDiscount > 0 && (
          <div><span>{language === "en" ? `Combo discount${totals.comboDiscount > 5 ? ` (${totals.comboDiscount / 5}x)` : ""}` : `Rabais combo${totals.comboDiscount > 5 ? ` (${totals.comboDiscount / 5}x)` : ""}`}</span><strong>-{formatCad(totals.comboDiscount, language)}</strong></div>
        )}
        <div className="subtotal-row"><span>{copy.subtotal}</span><strong>{formatCad(totals.subtotal - totals.comboDiscount, language)}</strong></div>
        <p className="tax-note">{copy.taxNote}</p>
      </div>
      <BackupBill language={language} date={date} time={time} selections={selections} serviceAddOns={serviceAddOns} />
    </div>
  );
}
