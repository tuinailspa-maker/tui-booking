import { useEffect, useState } from "react";
import {
  BUSINESS_TIME_ZONE,
  formatSlotTime,
  getClosingTimeForDate,
  getSlotsForDate,
  getUpcomingDates,
  isOnlineOnlyTime,
  staffSchedule,
  type DateOption,
} from "@/data/staffSchedule";
import type { Technician } from "@/data/staffSchedule";
import type { Language, BookingCopy } from "./copy";

type StepOneProps = {
  language: Language;
  copy: BookingCopy;
  partySize: number;
  onPartySizeChange: (size: number) => void;
  date: string;
  onDateChange: (date: string) => void;
  time: string;
  onTimeChange: (time: string) => void;
  availabilitySlots: Record<string, Technician[]>;
  isAvailabilityLoading: boolean;
};

function fullDateLabel(iso: string, language: Language) {
  return new Intl.DateTimeFormat(language === "en" ? "en-CA" : "fr-CA", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${iso}T12:00:00Z`));
}

export function StepOne({ language, copy, partySize, onPartySizeChange, date, onDateChange, time, onTimeChange, availabilitySlots, isAvailabilityLoading }: StepOneProps) {
  const [dates, setDates] = useState<DateOption[]>([]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDates(getUpcomingDates(language)));
    return () => window.cancelAnimationFrame(frame);
  }, [language]);
  const slots = getSlotsForDate(date, 1).filter((slot) => Boolean(availabilitySlots[slot.time]));
  const selectedSlot = slots.find((slot) => slot.time === time);
  const closingTime = getClosingTimeForDate(date);

  return (
    <section className="booking-step" aria-labelledby="step-one-title">
      <div className="step-heading">
        <p className="step-kicker">01 <span /> {copy.stepOne}</p>
        <h1 id="step-one-title">{copy.stepOneTitle}</h1>
        <p>{copy.stepOneIntro}</p>
      </div>

      <div className="form-section">
        <div className="section-label-row">
          <h2>{copy.partySize}</h2>
          <span className="field-hint">{copy.timezone}</span>
        </div>
        <div className="party-options" role="group" aria-label={copy.partySize}>
          {[1, 2, 3].map((size) => (
            <button
              className={`party-option${partySize === size ? " is-selected" : ""}`}
              type="button"
              key={size}
              aria-pressed={partySize === size}
              onClick={() => onPartySizeChange(size)}
            >
              <span className="party-number">0{size}</span>
              <span>{size === 1 ? copy.guest : copy.guests}</span>
            </button>
          ))}
        </div>

        {partySize === 2 && <p className="capacity-note">{copy.groupTwo}</p>}
        {partySize === 3 && <p className="capacity-note">{copy.groupThree}</p>}
      </div>

      <div className="form-section">
        <div className="section-label-row">
          <h2>{copy.date}</h2>
        </div>
        <div className="date-picker" role="group" aria-label={copy.upcomingDates}>
          {dates.map((option) => {
            const isUnavailable = !staffSchedule[option.dayOfWeek].length;
            return (
              <button
                className={`date-option${date === option.iso ? " is-selected" : ""}${isUnavailable ? " is-closed" : ""}`}
                key={option.iso}
                type="button"
                disabled={isUnavailable}
                aria-label={`${fullDateLabel(option.iso, language)}${isUnavailable ? ` — ${copy.noSlots}` : ""}`}
                aria-pressed={date === option.iso}
                onClick={() => onDateChange(option.iso)}
              >
                <span className="date-weekday">{option.weekdayShort}</span>
                <span className="date-number">{option.dayNumber}</span>
                <span className="date-month">{option.monthShort}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="form-section time-section">
        <div className="section-label-row">
          <h2>{copy.time}</h2>
          <span className="field-hint">{BUSINESS_TIME_ZONE}</span>
        </div>
        <div className="booking-window-notes" aria-label={copy.time}>
          <p className="booking-window-note is-online-only"><span aria-hidden="true" />{copy.slotOnlineOnly}</p>
          <p className="booking-window-note is-walk-ins"><span aria-hidden="true" />{copy.slotWalkInsWelcome.replace("{closeTime}", formatSlotTime(closingTime, language))}</p>
        </div>
        {!date ? (
          <p className="empty-state">{copy.date}</p>
        ) : isAvailabilityLoading ? (
          <p className="empty-state" role="status">{language === "en" ? "Checking live availability…" : "Vérification des disponibilités…"}</p>
        ) : slots.length === 0 ? (
          <p className="empty-state">{copy.noSlots}</p>
        ) : (
          <div className="time-grid" role="group" aria-label={copy.time}>
            {slots.map((slot) => (
              <button
                className={`time-option${time === slot.time ? " is-selected" : ""}${isOnlineOnlyTime(slot.time) ? " is-online-only" : ""}`}
                type="button"
                key={slot.time}
                aria-pressed={time === slot.time}
                onClick={() => onTimeChange(slot.time)}
              >
                {formatSlotTime(slot.time, language)}
              </button>
            ))}
          </div>
        )}
        {selectedSlot && isOnlineOnlyTime(selectedSlot.time) && (
          <p className="online-only-banner" role="status"><span aria-hidden="true">i</span>{copy.onlineOnly}</p>
        )}
      </div>
    </section>
  );
}
