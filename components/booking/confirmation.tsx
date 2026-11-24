import { formatSlotTime } from "@/data/staffSchedule";
import { selectedServicePrice, serviceById, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import type { BookingCopy, Language } from "./copy";
import { formatCad, formatDate, getBookingTotals } from "./booking-summary";

type ConfirmationProps = {
  language: Language;
  copy: BookingCopy;
  reference: string;
  date: string;
  time: string;
  partySize: number;
  selections: string[][];
  serviceAddOns: Record<string, ServiceAddOnKey>[];
  hasOnlineOnlyTime: boolean;
  assignedNames: string[];
  technicianChoice: string;
  onAddToCalendar: () => void;
  onStartAgain: () => void;
};

export function Confirmation({ language, copy, reference, date, time, partySize, selections, serviceAddOns, hasOnlineOnlyTime, assignedNames, technicianChoice, onAddToCalendar, onStartAgain }: ConfirmationProps) {
  const totals = getBookingTotals(selections, serviceAddOns);
  const comboDiscount = getComboDiscountDetails(selections, serviceAddOns);
  return (
    <section className="confirmation-step" aria-labelledby="confirmation-title">
      <div className="confirmation-icon" aria-hidden="true">✓</div>
      <p className="step-kicker">04 <span /> {copy.stepFour}</p>
      <h1 id="confirmation-title">{copy.stepFourTitle}</h1>
      <article className="confirmation-card">
        <div className="reference-row"><span>{copy.reference}</span><strong>{reference}</strong></div>
        <div className="confirmation-divider" />
        <h2>{copy.appointmentDetails}</h2>
        <dl className="confirmation-details">
          <div><dt>{copy.summaryDate}</dt><dd>{formatDate(date, language)}</dd></div>
          <div><dt>{copy.summaryTime}</dt><dd>{formatSlotTime(time, language)}</dd></div>
          <div><dt>{copy.summaryGuests}</dt><dd>{partySize} {partySize === 1 ? copy.guest : copy.guests}</dd></div>
          <div><dt>{copy.totalDuration}</dt><dd>{totals.duration} min</dd></div>
          <div className="confirmation-services"><dt>{copy.summarySelected}</dt><dd>{selections.map((ids, guestIndex) => (
            <span key={guestIndex}>{partySize > 1 ? `${copy.guest} ${guestIndex + 1}: ` : ""}{ids.map((id) => {
              const service = serviceById.get(id);
              if (!service) return null;
              const addOnKey = serviceAddOns[guestIndex]?.[id];
              return `${serviceDisplayNameWithAddOn(service, language, addOnKey)} — ${formatCad(selectedServicePrice(service, addOnKey), language)}`;
            }).filter(Boolean).join("; ")}</span>
          ))}</dd></div>
          <div><dt>{copy.summaryTechnician}</dt><dd>{technicianChoice}</dd></div>
          <div><dt>{copy.assignedTeam}</dt><dd>{assignedNames.length ? Array.from(new Set(assignedNames)).join(", ") : copy.anyTechnician}</dd></div>
          {comboDiscount.amount > 0 && <div><dt>{language === "en" ? `Combo discount${comboDiscount.qualifyingGuests.length > 1 ? ` (${comboDiscount.qualifyingGuests.length}x)` : ""}` : `Rabais combo${comboDiscount.qualifyingGuests.length > 1 ? ` (${comboDiscount.qualifyingGuests.length}x)` : ""}`}</dt><dd>-{new Intl.NumberFormat(language === "en" ? "en-CA" : "fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(comboDiscount.amount)}</dd></div>}
          <div><dt>{copy.subtotal}</dt><dd>{formatCad(totals.subtotal - comboDiscount.amount, language)}</dd></div>
        </dl>
        <p className="online-only-banner"><span aria-hidden="true">i</span>{hasOnlineOnlyTime ? copy.onlineOnly : copy.onlineAndWalkIns}</p>
        <div className="confirmation-divider" />
        <div className="salon-contact">
          <strong>{copy.salon}</strong>
          <address>{copy.address}</address>
          <a href="tel:+14387777043">{copy.phoneSalon}</a>
        </div>
        <div className="confirmation-actions">
          <button className="button button-primary" type="button" onClick={onAddToCalendar}>{copy.addToCalendar}<span aria-hidden="true">↗</span></button>
          <a className="button button-secondary" href="https://tuinailspa.ca">{copy.backToSalonButton}<span aria-hidden="true">↗</span></a>
        </div>
      </article>
      <button className="start-again" type="button" onClick={onStartAgain}>{copy.tryAgain}</button>
    </section>
  );
}
