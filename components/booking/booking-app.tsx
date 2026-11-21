"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import Image from "next/image";
import { BUSINESS_TIME_ZONE, getSlotsForDate, isOnlineOnlyTime, type PublicTechnician, type Technician } from "@/data/staffSchedule";
import { serviceById, type ServiceAddOnKey } from "@/data/serviceTree";
import { BookingSummary, formatCad, getBookingTotals } from "./booking-summary";
import { ClientDetails, type ClientDetailsValue } from "./client-details";
import { translations, type Language } from "./copy";
import { Confirmation } from "./confirmation";
import { ServiceTree } from "./service-tree";
import { StepOne } from "./step-one";

type Step = 1 | 2 | 3 | 4;
const initialClient: ClientDetailsValue = { firstName: "", lastName: "", countryCode: "+1", phone: "", email: "", notes: "" };

function minutes(time: string) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

function localTorontoDateTimeToUtc(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, mins] = time.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hours, mins);
  const candidate = new Date(targetAsUtc);
  const displayedParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(candidate);
  const values = Object.fromEntries(displayedParts.map((part) => [part.type, part.value]));
  const displayedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return new Date(targetAsUtc - (displayedAsUtc - candidate.getTime()));
}

function icsEscape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}

function utcStamp(date: Date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

export function BookingApp() {
  const [language, setLanguage] = useState<Language>("en");
  const [step, setStep] = useState<Step>(1);
  const [partySize, setPartySize] = useState(1);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [selections, setSelections] = useState<string[][]>([[]]);
  const [serviceAddOns, setServiceAddOns] = useState<Record<string, ServiceAddOnKey>[]>([{}]);
  const [technicianPreferences, setTechnicianPreferences] = useState<(PublicTechnician | "")[]>([""]);
  const [activeGuest, setActiveGuest] = useState(0);
  const [client, setClient] = useState<ClientDetailsValue>(initialClient);
  const [reference, setReference] = useState("");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showMobileSummary, setShowMobileSummary] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [durationError, setDurationError] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(false);
  const copy = translations[language];
  const totals = useMemo(() => getBookingTotals(selections, serviceAddOns), [selections, serviceAddOns]);
  const requestedSlotDuration = Math.max(30, ...totals.guestDurations);
  const availabilityKey = date ? ["/api/bookings/availability", date, partySize, requestedSlotDuration] as const : null;
  const { data: slotAvailability, isLoading: isAvailabilityLoading } = useSWR(
    availabilityKey,
    async ([url, requestedDate, requestedPartySize, durationMinutes]) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: requestedDate, partySize: requestedPartySize, durationMinutes }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Could not load live availability.");
      return result as { slots: Record<string, Technician[]> };
    },
    { revalidateOnFocus: false },
  );
  const availabilitySlots = slotAvailability?.slots ?? {};
  const slots = useMemo(() => getSlotsForDate(date, 1), [date]);
  const selectedSlot = slots.find((slot) => slot.time === time);
  const remainingMinutes = selectedSlot ? minutes(selectedSlot.shift.end) - minutes(time) : 0;
  const everyGuestHasTimedService = selections.length === partySize && selections.every((ids) => ids.some((id) => (serviceById.get(id)?.durationMinutes ?? 0) > 0));
  const fitsShift = totals.duration > 0 && totals.duration <= remainingMinutes;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function changePartySize(nextSize: number) {
    setPartySize(nextSize);
    setTime("");
    setSelections((current) => Array.from({ length: nextSize }, (_, index) => current[index] ?? []));
    setServiceAddOns((current) => Array.from({ length: nextSize }, (_, index) => current[index] ?? {}));
    setTechnicianPreferences((current) => Array.from({ length: nextSize }, (_, index) => current[index] ?? ""));
    setActiveGuest(0);
  }

  function changeDate(nextDate: string) {
    setDate(nextDate);
    setTime("");
  }

  function changeTime(nextTime: string) {
    setTime(nextTime);
    setAvailabilityError(false);
    setTechnicianPreferences(Array.from({ length: partySize }, () => ""));
  }

  function toggleService(serviceId: string) {
    const isSelected = selections[activeGuest]?.includes(serviceId) ?? false;
    setSelections((current) => current.map((ids, index) => {
      if (index !== activeGuest) return ids;
      return ids.includes(serviceId) ? ids.filter((id) => id !== serviceId) : [...ids, serviceId];
    }));
    if (isSelected) {
      setServiceAddOns((current) => current.map((addOns, index) => {
        if (index !== activeGuest || !(serviceId in addOns)) return addOns;
        const next = { ...addOns };
        delete next[serviceId];
        return next;
      }));
    }
    setServiceError(false);
    setDurationError(false);
  }

  function removeService(guestIndex: number, serviceId: string) {
    setSelections((current) => current.map((ids, index) => index === guestIndex ? ids.filter((id) => id !== serviceId) : ids));
    setServiceAddOns((current) => current.map((addOns, index) => {
      if (index !== guestIndex || !(serviceId in addOns)) return addOns;
      const next = { ...addOns };
      delete next[serviceId];
      return next;
    }));
    setDurationError(false);
    setAvailabilityError(false);
  }

  function toggleServiceAddOn(serviceId: string) {
    const addOn = serviceById.get(serviceId)?.addOn;
    if (!addOn) return;
    setSelections((current) => current.map((ids, index) => index === activeGuest && !ids.includes(serviceId) ? [...ids, serviceId] : ids));
    setServiceAddOns((current) => current.map((addOns, index) => {
      if (index !== activeGuest) return addOns;
      const next = { ...addOns };
      if (next[serviceId] === addOn.key) delete next[serviceId];
      else next[serviceId] = addOn.key;
      return next;
    }));
    setServiceError(false);
    setDurationError(false);
  }

  function changeTechnician(index: number, value: PublicTechnician | "") {
    setTechnicianPreferences((current) => current.map((preference, guestIndex) => guestIndex === index ? value : preference));
  }

  function continueFromServices() {
    if (!availabilitySlots[time] || assignedTechnicians().length !== partySize) {
      setAvailabilityError(true);
      return;
    }
    setAvailabilityError(false);
    if (!everyGuestHasTimedService) {
      setServiceError(true);
      return;
    }
    if (!fitsShift) {
      setDurationError(true);
      return;
    }
    setServiceError(false);
    setDurationError(false);
    setStep(3);
  }

  async function submitClientDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || isSubmitting) return;

    setIsSubmitting(true);
    setBookingError(null);
    try {
      const bookingGuests = selections.map((serviceIds, index) => ({ serviceIds, addOns: serviceAddOns[index] ?? {}, technician: assignedTechnicians()[index] }));
      const startAt = localTorontoDateTimeToUtc(date, time).toISOString();
      const availability = await fetch("/api/bookings/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt, guests: bookingGuests.map((guest, index) => ({ technician: guest.technician, durationMinutes: totals.guestDurations[index] })) }),
      });
      const availabilityResult = await availability.json().catch(() => null);
      if (!availability.ok || availabilityResult?.available !== true) throw new Error(availabilityResult?.error || "This time slot is no longer available. Please choose another time.");
      const response = await fetch("/api/bookings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), startAt, client, guests: bookingGuests }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const squareMessage = Array.isArray(result?.errors)
          ? result.errors.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ")
          : "";
        throw new Error(squareMessage || result?.detail || result?.error || "Square booking failed without an error message.");
      }
      const squareBookingId = result?.booking?.id;
      if (typeof squareBookingId !== "string" || squareBookingId.length === 0) {
        throw new Error("Square did not return a booking ID.");
      }

      setReference(squareBookingId);
      setStep(4);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Unable to reach Square. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function assignedTechnicians(): Technician[] {
    if (!selectedSlot) return [];
    const available = availabilitySlots[time] ?? [];
    const assignments: (Technician | undefined)[] = Array(partySize).fill(undefined);
    const used = new Set<Technician>();
    technicianPreferences.slice(0, partySize).forEach((preference, index) => {
      if (preference && available.includes(preference) && !used.has(preference)) {
        assignments[index] = preference;
        used.add(preference);
      }
    });
    for (let index = 0; index < partySize; index += 1) {
      if (assignments[index]) continue;
      const candidate = available.find((technician) => !used.has(technician));
      if (candidate) {
        assignments[index] = candidate;
        used.add(candidate);
      }
    }
    return assignments.filter((technician): technician is Technician => Boolean(technician));
  }

  function addToCalendar() {
    const start = localTorontoDateTimeToUtc(date, time);
    const end = new Date(start.getTime() + Math.max(15, totals.duration) * 60_000);
    const title = `${copy.salon} — ${copy.appointmentDetails}`;
    const description = `${copy.reference}: ${reference}\n${copy.summaryGuests}: ${partySize}\n${copy.subtotal}: ${formatCad(totals.subtotal, language)}\n${copy.phoneSalon}`;
    const event = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Tui Nail Spa//Tui Booking//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${reference}@tuinailspa.ca`,
      `DTSTAMP:${utcStamp(new Date())}`,
      `DTSTART:${utcStamp(start)}`,
      `DTEND:${utcStamp(end)}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `LOCATION:${icsEscape("1570 Rue Saint-Timothée, Ste 100, Montreal, QC H2L 3N9")}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([event], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${reference.toLowerCase()}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function startAgain() {
    setStep(1);
    setPartySize(1);
    setDate("");
    setTime("");
    setSelections([[]]);
    setServiceAddOns([{}]);
    setTechnicianPreferences([""]);
    setActiveGuest(0);
    setClient(initialClient);
    setReference("");
    setServiceError(false);
    setDurationError(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const selectedPublicNames = Array.from(new Set(assignedTechnicians()));

  return (
    <main className="booking-page">
      <header className="booking-header">
        <a className="salon-wordmark" href="https://tuinailspa.ca" aria-label={`${copy.salon} — tuinailspa.ca`}>
          <Image src="/tui-logo.png" alt="Tui — La beauté des ongles" className="salon-logo" width={150} height={104} priority />
          <span className="salon-text"><span className="salon-name">{copy.salonName}</span><span className="salon-policy">{copy.bookingPolicy}</span></span>
        </a>
        <div className="header-tools">
          <a className="salon-link" href="https://tuinailspa.ca">{copy.backToSalon}<span aria-hidden="true">↗</span></a>
          <span className="header-divider" aria-hidden="true" />
          <button className="language-switch" type="button" onClick={() => setLanguage(language === "en" ? "fr" : "en")} aria-label={copy.languageLabel} lang={language === "en" ? "fr" : "en"}>
            <span className={language === "en" ? "active-language" : ""}>EN</span><span className="language-separator">/</span><span className={language === "fr" ? "active-language" : ""}>FR</span>
          </button>
        </div>
      </header>

      <div className="booking-intro">
        <p className="eyebrow"><span className="eyebrow-rule" /> TUI NAIL SPA <span className="eyebrow-dot">·</span> {copy.onlineBooking}</p>
        <p className="booking-page-title">{copy.pageTagline}</p>
        
      </div>

      <nav className="booking-progress" aria-label={copy.ariaProgress}>
        {copy.steps.map((label, index) => {
          const number = (index + 1) as Step;
          const isCurrent = number === step;
          const isComplete = number < step;
          return (
            <div className={`progress-item${isCurrent ? " is-current" : ""}${isComplete ? " is-complete" : ""}`} key={label} aria-current={isCurrent ? "step" : undefined}>
              <span className="progress-number">{isComplete ? "✓" : `0${number}`}</span>
              <span className="progress-label">{label}</span>
            </div>
          );
        })}
      </nav>

      {step === 4 ? (
        <Confirmation
          language={language}
          copy={copy}
          reference={reference}
          date={date}
          time={time}
          partySize={partySize}
          selections={selections}
          serviceAddOns={serviceAddOns}
          hasOnlineOnlyTime={isOnlineOnlyTime(time)}
          assignedNames={selectedPublicNames}
          onAddToCalendar={addToCalendar}
          onStartAgain={startAgain}
        />
      ) : (
        <div className="booking-layout">
          <div className="booking-main-column">
            {step === 1 && (
              <StepOne
                language={language}
                copy={copy}
                partySize={partySize}
                onPartySizeChange={changePartySize}
                date={date}
                onDateChange={changeDate}
                time={time}
                onTimeChange={changeTime}
                availabilitySlots={availabilitySlots}
                isAvailabilityLoading={isAvailabilityLoading}
              />
            )}

            {step === 2 && (
              <section className="booking-step" aria-labelledby="step-two-title">
                <div className="step-heading">
                  <p className="step-kicker">02 <span /> {copy.stepTwo}</p>
                  <h1 id="step-two-title">{copy.stepTwoTitle}</h1>
                  <p>{copy.stepTwoIntro}</p>
                </div>
                {partySize > 1 && (
                  <div className="guest-tabs" role="tablist" aria-label={copy.guestServices}>
                    {Array.from({ length: partySize }, (_, index) => (
                      <button
                        key={index}
                        type="button"
                        role="tab"
                        id={`guest-tab-${index}`}
                        aria-selected={activeGuest === index}
                        aria-controls={`guest-panel-${index}`}
                        className={`guest-tab${activeGuest === index ? " is-selected" : ""}`}
                        onClick={() => setActiveGuest(index)}
                      >
                        <span>{copy.guest} {index + 1}</span>
                        {selections[index]?.length > 0 && <b>{selections[index].length}</b>}
                      </button>
                    ))}
                  </div>
                )}
                <div className="guest-panel" id={`guest-panel-${activeGuest}`} role="tabpanel" aria-labelledby={partySize > 1 ? `guest-tab-${activeGuest}` : undefined}>
                  {selectedSlot && (
                    <label className="technician-select">
                      <span>{copy.technician}{partySize > 1 ? ` · ${copy.guest} ${activeGuest + 1}` : ""}</span>
                      <select value={technicianPreferences[activeGuest] ?? ""} onChange={(event) => changeTechnician(activeGuest, event.target.value as PublicTechnician | "")}>
                        <option value="">{copy.anyTechnician}</option>
                        {(availabilitySlots[time] ?? []).map((technician) => <option key={technician} value={technician}>{technician}</option>)}
                      </select>
                    </label>
                  )}
                  <ServiceTree
                    language={language}
                    copy={copy}
                    selectedIds={selections[activeGuest] ?? []}
                    selectedAddOns={serviceAddOns[activeGuest] ?? {}}
                    onToggleService={toggleService}
                    onToggleAddOn={toggleServiceAddOn}
                  />
                </div>
                {serviceError && <p className="validation-note" role="alert">{copy.selectOneService}</p>}
                {durationError && <p className="validation-note" role="alert">{copy.durationTooLong}</p>}
                {availabilityError && <p className="validation-note" role="alert">{language === "en" ? "This time no longer fits the selected services or available technicians. Go back and choose another time." : "Cette heure ne convient plus aux services ou aux techniciennes disponibles. Revenez en arrière et choisissez une autre heure."}</p>}
              </section>
            )}

            {step === 3 && (
              <>
            {bookingError && <p className="validation-note" role="alert">{copy.bookingFailed} {bookingError}</p>}
            <ClientDetails copy={copy} value={client} onChange={setClient} onSubmit={submitClientDetails} />
          </>
            )}

            <div className="step-actions">
              {step > 1 && <button className="button button-back" type="button" onClick={() => setStep((step - 1) as Step)}><span aria-hidden="true">←</span>{copy.back}</button>}
              {step === 1 && (
                <button className="button button-primary" type="button" disabled={!date || !time} onClick={() => setStep(2)}>{copy.continue}<span aria-hidden="true">→</span></button>
              )}
              {step === 2 && (
                <button className="button button-primary" type="button" disabled={isAvailabilityLoading} aria-busy={isAvailabilityLoading} onClick={continueFromServices}>{copy.continue}<span aria-hidden="true">→</span></button>
              )}
              {step === 3 && (
                <button className="button button-primary" type="submit" form="client-details-form" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? (language === "en" ? "Booking…" : "Réservation…") : copy.confirm}<span aria-hidden="true">→</span></button>
              )}
            </div>
          </div>

          <aside className="desktop-summary" aria-label={copy.summary}>
            <BookingSummary language={language} copy={copy} partySize={partySize} date={date} time={time} selections={selections} serviceAddOns={serviceAddOns} onRemoveService={step === 2 || step === 3 ? removeService : undefined} />
          </aside>
        </div>
      )}

      {step !== 4 && (
        <div className="mobile-summary-wrap">
          <div className="mobile-summary-details" id="mobile-summary-details" hidden={!showMobileSummary}>
            <BookingSummary language={language} copy={copy} partySize={partySize} date={date} time={time} selections={selections} serviceAddOns={serviceAddOns} onRemoveService={step === 2 || step === 3 ? removeService : undefined} />
          </div>
          <button className="mobile-summary-bar" type="button" aria-expanded={showMobileSummary} aria-controls="mobile-summary-details" onClick={() => setShowMobileSummary((open) => !open)}>
            <span className="mobile-summary-label"><span>{copy.summary}</span><small>{totals.serviceCount} {copy.summarySelected.toLowerCase()} · {totals.duration} min</small></span>
            <strong>{formatCad(totals.subtotal - totals.comboDiscount, language)}</strong>
            <span className={`mobile-summary-chevron${showMobileSummary ? " is-open" : ""}`} aria-hidden="true">⌃</span>
          </button>
        </div>
      )}

      <footer className="booking-footer">
        <a href="https://tuinailspa.ca">{copy.salon}</a>
        <span>{copy.address}</span>
        <a href="tel:+14387777043">{copy.phoneSalon}</a>
        <span className="footer-note">{copy.footerNote}</span>
      </footer>
    </main>
  );
}
