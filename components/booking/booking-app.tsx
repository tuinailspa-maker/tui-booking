"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { assignTechnicians, BUSINESS_TIME_ZONE, getSlotsForDate, isOnlineOnlyTime, type PublicTechnician, type Technician } from "@/data/staffSchedule";
import { serviceById } from "@/data/serviceTree";
import { BookingSummary, formatCad, getBookingTotals } from "./booking-summary";
import { ClientDetails, type ClientDetailsValue } from "./client-details";
import { translations, type Language } from "./copy";
import { Confirmation } from "./confirmation";
import { ServiceTree } from "./service-tree";
import { StepOne } from "./step-one";

type Step = 1 | 2 | 3 | 4;
const initialClient: ClientDetailsValue = { firstName: "", lastName: "", phone: "", email: "", notes: "" };

function minutes(time: string) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

function makeReference() {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "").slice(-7)
    : Math.random().toString(36).slice(2, 9);
  return `TUI-${suffix.toUpperCase()}`;
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
  const [technicianPreferences, setTechnicianPreferences] = useState<(PublicTechnician | "")[]>([""]);
  const [activeGuest, setActiveGuest] = useState(0);
  const [client, setClient] = useState<ClientDetailsValue>(initialClient);
  const [reference, setReference] = useState("");
  const [showMobileSummary, setShowMobileSummary] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [durationError, setDurationError] = useState(false);
  const copy = translations[language];
  const totals = useMemo(() => getBookingTotals(selections), [selections]);
  const slots = useMemo(() => getSlotsForDate(date, partySize), [date, partySize]);
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
    setTechnicianPreferences((current) => Array.from({ length: nextSize }, (_, index) => current[index] ?? ""));
    setActiveGuest(0);
  }

  function changeDate(nextDate: string) {
    setDate(nextDate);
    setTime("");
  }

  function changeTime(nextTime: string) {
    setTime(nextTime);
    setTechnicianPreferences(Array.from({ length: partySize }, () => ""));
  }

  function toggleService(serviceId: string) {
    setSelections((current) => current.map((ids, index) => {
      if (index !== activeGuest) return ids;
      return ids.includes(serviceId) ? ids.filter((id) => id !== serviceId) : [...ids, serviceId];
    }));
    setServiceError(false);
    setDurationError(false);
  }

  function changeTechnician(index: number, value: PublicTechnician | "") {
    setTechnicianPreferences((current) => current.map((preference, guestIndex) => guestIndex === index ? value : preference));
  }

  function continueFromServices() {
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

  function submitClientDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    setReference(makeReference());
    setStep(4);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function assignedTechnicians(): Technician[] {
    if (!selectedSlot) return [];
    return assignTechnicians(selectedSlot.shift, partySize, technicianPreferences);
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
    setTechnicianPreferences([""]);
    setActiveGuest(0);
    setClient(initialClient);
    setReference("");
    setServiceError(false);
    setDurationError(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const selectedPublicNames = Array.from(new Set(assignedTechnicians().filter((name): name is PublicTechnician => name !== "Option 2")));

  return (
    <main className="booking-page">
      <header className="booking-header">
        <a className="salon-wordmark" href="https://tuinailspa.ca" aria-label={`${copy.salon} — tuinailspa.ca`}>
          <img src="/tui-logo.png" alt="Tui — La beauté des ongles" className="salon-logo" />
          <span className="salon-name">{copy.salonName}</span>
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
        <p className="booking-policy">{copy.bookingPolicy}</p>
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
                        {selectedSlot.shift.primaryTechnicians.map((technician) => <option key={technician} value={technician}>{technician}</option>)}
                      </select>
                    </label>
                  )}
                  <ServiceTree
                    language={language}
                    copy={copy}
                    selectedIds={selections[activeGuest] ?? []}
                    onToggleService={toggleService}
                  />
                </div>
                {serviceError && <p className="validation-note" role="alert">{copy.selectOneService}</p>}
                {durationError && <p className="validation-note" role="alert">{copy.durationTooLong}</p>}
              </section>
            )}

            {step === 3 && (
              <ClientDetails copy={copy} value={client} onChange={setClient} onSubmit={submitClientDetails} />
            )}

            <div className="step-actions">
              {step > 1 && <button className="button button-back" type="button" onClick={() => setStep((step - 1) as Step)}><span aria-hidden="true">←</span>{copy.back}</button>}
              {step === 1 && (
                <button className="button button-primary" type="button" disabled={!date || !time} onClick={() => setStep(2)}>{copy.continue}<span aria-hidden="true">→</span></button>
              )}
              {step === 2 && (
                <button className="button button-primary" type="button" onClick={continueFromServices}>{copy.continue}<span aria-hidden="true">→</span></button>
              )}
              {step === 3 && (
                <button className="button button-primary" type="submit" form="client-details-form">{copy.confirm}<span aria-hidden="true">→</span></button>
              )}
            </div>
          </div>

          <aside className="desktop-summary" aria-label={copy.summary}>
            <BookingSummary language={language} copy={copy} partySize={partySize} date={date} time={time} selections={selections} />
          </aside>
        </div>
      )}

      {step !== 4 && (
        <div className="mobile-summary-wrap">
          <div className="mobile-summary-details" id="mobile-summary-details" hidden={!showMobileSummary}>
            <BookingSummary language={language} copy={copy} partySize={partySize} date={date} time={time} selections={selections} />
          </div>
          <button className="mobile-summary-bar" type="button" aria-expanded={showMobileSummary} aria-controls="mobile-summary-details" onClick={() => setShowMobileSummary((open) => !open)}>
            <span className="mobile-summary-label"><span>{copy.summary}</span><small>{totals.serviceCount} {copy.summarySelected.toLowerCase()} · {totals.duration} min</small></span>
            <strong>{formatCad(totals.subtotal, language)}</strong>
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
