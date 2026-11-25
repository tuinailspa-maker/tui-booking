"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { allServices } from "@/data/serviceTree";

type Language = "en" | "fr";
type Slot = { time: string; startAt: string; assignments?: { teamMemberId: string }[] };
type OtherAppointment = { id: string; startAt: string; isPast: boolean };
type Appointment = { id: string; version?: number; name: string; time: string; service: string; technician: string; checkedIn: boolean };
const copy = {
  en: { otherTitle: "Your appointment isn’t today", otherFuture: "Your appointment is booked for", otherPast: "Your appointment was booked for", otherBody: "This is not today’s date. You can go back, or check in for today and our team will fit you in.", otherCancel: "Back / Cancel", otherCheckIn: "Check In Today Anyway", otherThanks: "Thank you! You’re checked in for today. Please have a seat, our team will be with you shortly.", welcome: "Welcome to Tui Nail Spa", subtitle: "A little moment, just for you.", appointment: "I Have an Appointment", walkin: "Walk-in", phone: "Enter the phone number on your booking", next: "Find My Appointment", back: "Back", noAppointment: "We couldn’t find an appointment for this number today. Please ask a team member for help.", confirm: "Confirm Check-In", checked: "Already checked in", name: "Your name", phoneLabel: "Phone number", guestCount: "How many guests?", services: "Choose your services", submit: "Join Today’s Queue", check: "Check Availability", needService: "Please choose at least one service.", today: "WALK-IN · TODAY", nextAvailable: "Next available", pickTime: "Choose a time today that works for you.", earliest: "Earliest", bookConfirm: "Confirm Appointment", slotTaken: "That time was just taken. Please choose another time.", fullTitle: "We’re fully booked today", fullBody: "Sorry, there are no more open times today for your selection. Choose another date above, or join today’s walk-in queue and we’ll fit you in as soon as a technician is free.", todayChip: "Today", tomorrowChip: "Tomorrow", chooseDate: "Choose a date", walkinDay: "WALK-IN · BOOK A TIME", pickTimeDay: "Choose a time that works for you.", fullDateTitle: "This date is fully booked", fullDateBody: "Sorry, there are no open times on this date for your selection. Please choose another date.", futureBookedTitle: "You’re booked!", futureBookedBody: "We look forward to seeing you on", bookedTitle: "You’re booked and checked in!", bookedBody: "Please have a seat, we’ll call you at", done: "Done", guestsLabel: "Guests", loading: "Please wait…", error: "Something went wrong. Please ask a team member for help.", appointmentThanks: "Thank you! You’re checked in. Please have a seat, we’ll be right with you.", walkinThanks: "You’re on today’s walk-in list. Please have a seat and our team will be with you shortly.", required: "Please enter your name and a valid 10-digit phone number.", backWelcome: "Start over", guest: "Guest", you: "You", companionName: "Name (optional)", needServiceFor: "Please choose at least one service for", groupFullTodayBody: "No time today has enough technicians free at the same moment for your whole group. Choose another date above, or join today’s walk-in queue and we’ll fit you in as soon as possible.", groupFullDateBody: "No time on this date has enough technicians free at the same moment for your whole group. Please choose another date." },
  fr: { otherTitle: "Votre rendez-vous n’est pas aujourd’hui", otherFuture: "Votre rendez-vous est prévu le", otherPast: "Votre rendez-vous était prévu le", otherBody: "Ce n’est pas la date d’aujourd’hui. Vous pouvez revenir en arrière, ou vous enregistrer pour aujourd’hui et notre équipe vous accueillera.", otherCancel: "Retour / Annuler", otherCheckIn: "Enregistrer aujourd’hui quand même", otherThanks: "Merci! Vous êtes enregistré(e) pour aujourd’hui. Installez-vous, notre équipe sera avec vous sous peu.", welcome: "Bienvenue chez Tui Nail Spa", subtitle: "Un petit moment rien que pour vous.", appointment: "J’ai un rendez-vous", walkin: "Sans rendez-vous", phone: "Entrez le numéro associé à votre rendez-vous", next: "Trouver mon rendez-vous", back: "Retour", noAppointment: "Aucun rendez-vous trouvé pour ce numéro aujourd’hui. Veuillez demander de l’aide à un membre de l’équipe.", confirm: "Confirmer l’arrivée", checked: "Déjà enregistré", name: "Votre nom", phoneLabel: "Numéro de téléphone", guestCount: "Combien de personnes?", services: "Choisissez vos services", submit: "Rejoindre la file d’attente", check: "Vérifier la disponibilité", needService: "Veuillez choisir au moins un service.", today: "SANS RENDEZ-VOUS · AUJOURD’HUI", nextAvailable: "Prochaine disponibilité", pickTime: "Choisissez une heure qui vous convient aujourd’hui.", earliest: "Le plus tôt", bookConfirm: "Confirmer le rendez-vous", slotTaken: "Cette heure vient d’être réservée. Veuillez en choisir une autre.", fullTitle: "Nous sommes complets aujourd’hui", fullBody: "Désolés, il n’y a plus de disponibilités aujourd’hui pour votre sélection. Choisissez une autre date ci-dessus, ou rejoignez la file d’attente et nous vous accueillerons dès qu’un(e) technicien(ne) sera libre.", todayChip: "Aujourd’hui", tomorrowChip: "Demain", chooseDate: "Choisir une date", walkinDay: "SANS RENDEZ-VOUS · RÉSERVER", pickTimeDay: "Choisissez une heure qui vous convient.", fullDateTitle: "Cette date est complète", fullDateBody: "Désolés, il n’y a aucune disponibilité à cette date pour votre sélection. Veuillez choisir une autre date.", futureBookedTitle: "Votre rendez-vous est confirmé!", futureBookedBody: "Au plaisir de vous accueillir le", bookedTitle: "Votre rendez-vous est confirmé et enregistré!", bookedBody: "Installez-vous, nous vous appellerons à", done: "Terminé", guestsLabel: "Personnes", loading: "Veuillez patienter…", error: "Une erreur est survenue. Demandez de l’aide à un membre de l’équipe.", appointmentThanks: "Merci! Vous êtes enregistré(e). Installez-vous, nous serons avec vous sous peu.", walkinThanks: "Vous êtes sur la liste d’attente. Installez-vous, notre équipe sera avec vous sous peu.", required: "Entrez votre nom et un numéro de téléphone valide à 10 chiffres.", backWelcome: "Recommencer", guest: "Invité", you: "Vous", companionName: "Nom (facultatif)", needServiceFor: "Veuillez choisir au moins un service pour", groupFullTodayBody: "Aucune heure aujourd’hui n’a assez de techniciens libres en même temps pour tout votre groupe. Choisissez une autre date ci-dessus, ou rejoignez la file d’attente et nous vous accueillerons dès que possible.", groupFullDateBody: "Aucune heure à cette date n’a assez de techniciens libres en même temps pour tout votre groupe. Veuillez choisir une autre date." },
} as const;
const MAX_DAYS_AHEAD = 60;
const torontoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shiftDate = (date: string, days: number) => { const [year, month, day] = date.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10); };
const dayMonthYear = (date: string) => date.split("-").reverse().join("/");
const timeLabel = (value: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }).format(new Date(value));

export function Kiosk() {
  const [language, setLanguage] = useState<Language>("en");
  const [screen, setScreen] = useState<"welcome" | "appointment-phone" | "appointment-result" | "appointment-other-date" | "walkin" | "walkin-slots" | "thanks">("welcome");
  const [otherAppointment, setOtherAppointment] = useState<OtherAppointment | null>(null);
  const otherRequestId = useRef("");
  const [walkinDate, setWalkinDate] = useState("");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [bookedIsToday, setBookedIsToday] = useState(true);
  const slotRequest = useRef(0);
  const [confirmationType, setConfirmationType] = useState<"appointment" | "appointment-other" | "walkin" | "walkin-booked">("appointment");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [bookedAt, setBookedAt] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [guestServices, setGuestServices] = useState<string[][]>([[], [], [], []]);
  const [guestNames, setGuestNames] = useState<string[]>(["", "", "", ""]);
  const [activeGuest, setActiveGuest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = copy[language];
  const services = guestServices[activeGuest] ?? [];
  function setServices(update: string[] | ((current: string[]) => string[])) {
    setGuestServices((all) => all.map((list, index) => (index === activeGuest ? (typeof update === "function" ? update(list) : update) : list)));
  }
  const guestLabel = (index: number) => (index === 0 ? `${t.guest} 1 (${t.you})` : guestNames[index]?.trim() || `${t.guest} ${index + 1}`);
  const party = () => Array.from({ length: guestCount }, (_, index) => ({ name: index === 0 ? name.trim() : (guestNames[index] ?? "").trim(), serviceIds: guestServices[index] ?? [] }));

  useEffect(() => {
    if (screen !== "thanks") return;
    const timeout = window.setTimeout(reset, confirmationType === "walkin-booked" ? 15000 : 6000);
    return () => window.clearTimeout(timeout);
  }, [screen, confirmationType]);

  const serviceCategories = useMemo(() => [
    { id: "hands", label: { en: "Hands", fr: "Mains" }, services: allServices.filter((service) => service.priceCad > 0 && /^(hands-|enhancement-)/.test(service.id)) },
    { id: "feet", label: { en: "Feet", fr: "Pieds" }, services: allServices.filter((service) => service.priceCad > 0 && service.id.startsWith("feet-")) },
    { id: "addons", label: { en: "Option Add-on", fr: "Options supplémentaires" }, services: allServices.filter((service) => service.priceCad > 0 && /^(removal-|repair-|cut-|treatment-|add-on-)/.test(service.id)) },
    { id: "waxing", label: { en: "Waxing", fr: "Épilation" }, services: allServices.filter((service) => service.priceCad > 0 && service.id.startsWith("waxing-")) },
  ], []);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const selectedServices = useMemo(() => services.map((id) => allServices.find((service) => service.id === id)).filter((service): service is (typeof allServices)[number] => Boolean(service)), [services]);
  const partyServices = useMemo(() => guestServices.slice(0, guestCount).map((ids) => ids.map((id) => allServices.find((service) => service.id === id)).filter((service): service is (typeof allServices)[number] => Boolean(service))), [guestServices, guestCount]);
  const partyReady = partyServices.every((list) => list.length > 0);
  function reset() { setScreen("welcome"); setOtherAppointment(null); setPhone(""); setName(""); setAppointments([]); setSelected(""); setGuestCount(1); setGuestServices([[], [], [], []]); setGuestNames(["", "", "", ""]); setActiveGuest(0); setOpenCategory(null); setSlots([]); setSelectedSlot(""); setBookedAt(""); setBusy(false); setError(""); slotRequest.current += 1; setWalkinDate(""); setSlotsLoading(false); setBookedIsToday(true); }
  function appendDigit(digit: string) { if (phone.replace(/\D/g, "").length < 10) setPhone((current) => `${current}${digit}`); }
  async function lookupAppointment() {
    setError(""); setBusy(true);
    try {
      const result = await fetch(`/api/kiosk/checkin?phone=${encodeURIComponent(phone)}`, { cache: "no-store" }).then((response) => response.json().then((data) => { if (!response.ok) throw new Error(data.error); return data; }));
      const found: Appointment[] = result.appointments ?? [];
      setAppointments(found); setSelected(found[0]?.id ?? "");
      const other = result.otherAppointment as { id?: string; startAt?: string } | null;
      if (!found.length && other?.id && other.startAt) {
        setOtherAppointment({ id: other.id, startAt: other.startAt, isPast: Date.parse(other.startAt) < Date.now() });
        otherRequestId.current = crypto.randomUUID();
        setScreen("appointment-other-date");
      } else { setOtherAppointment(null); setScreen("appointment-result"); }
    } catch { setError(t.error); } finally { setBusy(false); }
  }
  function cancelOtherDate() { setOtherAppointment(null); setPhone(""); setError(""); setScreen("appointment-phone"); }
  async function checkInToday() {
    if (!otherAppointment) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/kiosk/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "other-date", bookingId: otherAppointment.id, phone, requestId: otherRequestId.current }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConfirmationType("appointment-other");
      setScreen("thanks");
    } catch { setError(t.error); } finally { setBusy(false); }
  }
  async function confirmAppointment(appointment: Appointment) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/kiosk/checkin", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: appointment.id, version: appointment.version, phone }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConfirmationType("appointment");
      setScreen("thanks");
    } catch { setError(t.error); } finally { setBusy(false); }
  }
  async function beginWalkIn() {
    setError(""); setPhone(""); setName(""); setScreen("walkin");
  }
  async function autoFillName() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) return;
    try {
      const result = await fetch(`/api/kiosk/checkin?customer=1&phone=${encodeURIComponent(digits)}`, { cache: "no-store" }).then((response) => response.json());
      if (result.name) setName(result.name);
    } catch { /* Keep the form usable when Square customer search is unavailable. */ }
  }
  async function submitWalkIn() {
    if (!name.trim() || phone.replace(/\D/g, "").length !== 10) { setError(t.required); return; }
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/kiosk/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone, guestCount, serviceIds: Array.from(new Set(guestServices.slice(0, guestCount).flat())), guests: party() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConfirmationType("walkin");
      setScreen("thanks");
    } catch { setError(t.error); } finally { setBusy(false); }
  }
  async function checkAvailability() {
    if (!name.trim() || phone.replace(/\D/g, "").length !== 10) { setError(t.required); return; }
    const missing = party().findIndex((guest) => guest.serviceIds.length === 0);
    if (missing !== -1) {
      setActiveGuest(missing); setOpenCategory(null);
      setError(guestCount > 1 ? `${t.needServiceFor} ${guestLabel(missing)}.` : t.needService);
      return;
    }
    setScreen("walkin-slots");
    void loadSlots(torontoToday());
  }
  async function loadSlots(date: string) {
    // Ignore responses for a date the guest has already moved away from.
    const requestNo = ++slotRequest.current;
    setWalkinDate(date); setSlots([]); setSelectedSlot(""); setError(""); setSlotsLoading(true);
    try {
      const response = await fetch("/api/checkin/walkin-availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guests: party(), date }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (requestNo !== slotRequest.current) return;
      const found: Slot[] = data.slots ?? [];
      setSlots(found); setSelectedSlot(found[0]?.time ?? "");
    } catch { if (requestNo === slotRequest.current) setError(t.error); } finally { if (requestNo === slotRequest.current) setSlotsLoading(false); }
  }
  async function confirmWalkinBooking() {
    const slot = slots.find((item) => item.time === selectedSlot);
    if (!slot) return;
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/checkin/walkin-book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), name, phone, guests: party(), assignments: slot.assignments?.map((item) => item.teamMemberId), time: slot.time, date: walkinDate }) });
      const data = await response.json();
      if (response.status === 409) {
        const remaining = slots.filter((item) => item.time !== slot.time);
        setSlots(remaining); setSelectedSlot(remaining[0]?.time ?? "");
        if (remaining.length) setError(t.slotTaken);
        return;
      }
      if (!response.ok) throw new Error(data.error);
      setBookedAt(data.startAt ?? slot.startAt);
      setBookedIsToday(data.isToday ?? walkinDate === torontoToday());
      setConfirmationType("walkin-booked");
      setScreen("thanks");
    } catch { setError(t.error); } finally { setBusy(false); }
  }
  const slotLabel = (iso: string) => new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }).format(new Date(iso));
  const longDateLabel = (iso: string) => new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(new Date(iso));
  function toggleService(id: string) { setServices((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  if (screen === "thanks") return <main className="kiosk kiosk-thanks" lang={language}><header className="kiosk-header"><Image src="/tui-logo.png" alt="Tui Nail Spa" width={188} height={126} priority className="kiosk-logo" /><div className="kiosk-language" role="group" aria-label="Language"><button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button><span aria-hidden="true">/</span><button type="button" aria-pressed={language === "fr"} onClick={() => setLanguage("fr")}>FR</button></div></header><div className="kiosk-thanks-card"><span className="kiosk-flower" aria-hidden="true">✳</span>{confirmationType === "walkin-booked" ? <><h1>{bookedIsToday ? t.bookedTitle : t.futureBookedTitle}</h1><p>{bookedIsToday ? t.bookedBody : t.futureBookedBody} <strong>{bookedAt ? `${bookedIsToday ? "" : `${dayMonthYear(walkinDate)} · `}${slotLabel(bookedAt)}` : ""}</strong>.</p><ul className="kiosk-booked-details"><li><span>{t.guestsLabel}</span><b>{guestCount}</b></li>{partyServices.map((list, guestIndex) => <Fragment key={guestIndex}>{guestCount > 1 && <li className="kiosk-booked-guest"><span>{guestLabel(guestIndex)}</span></li>}{list.map((service) => <li key={`${guestIndex}-${service.id}`}><span>{language === "en" ? service.displayNameEn : service.displayNameFr}</span><b>${service.priceCad}</b></li>)}</Fragment>)}</ul><button type="button" className="kiosk-submit kiosk-done" onClick={reset}>{t.done} <span aria-hidden="true">→</span></button></> : <h1>{confirmationType === "appointment" ? t.appointmentThanks : confirmationType === "appointment-other" ? t.otherThanks : t.walkinThanks}</h1>}<div className="kiosk-reset-track"><span style={confirmationType === "walkin-booked" ? { animationDuration: "15s" } : undefined} /></div></div></main>;

  return <main className="kiosk" lang={language}>
    <header className="kiosk-header"><Image src="/tui-logo.png" alt="Tui Nail Spa" width={188} height={126} priority className="kiosk-logo" /><div className="kiosk-language" role="group" aria-label="Language"><button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button><span aria-hidden="true">|</span><button type="button" aria-pressed={language === "fr"} onClick={() => setLanguage("fr")}>FR</button></div></header>
    {screen === "welcome" && <section className="kiosk-welcome"><p className="kiosk-eyebrow">TUI NAIL SPA · MONTRÉAL</p><h1>{t.welcome}</h1><p className="kiosk-subtitle">{t.subtitle}</p><div className="kiosk-choice-grid"><button className="kiosk-choice kiosk-choice-primary" type="button" onClick={() => { setScreen("appointment-phone"); setError(""); }}><span className="kiosk-choice-mark" aria-hidden="true">01</span><strong>I Have an Appointment</strong><span>J’ai un rendez-vous</span><b aria-hidden="true">→</b></button><button className="kiosk-choice" type="button" onClick={beginWalkIn}><span className="kiosk-choice-mark" aria-hidden="true">02</span><strong>Walk-in</strong><span>Sans rendez-vous</span><b aria-hidden="true">→</b></button></div><p className="kiosk-footnote">A warm welcome, in English or en français.</p></section>}
    {screen === "appointment-phone" && <section className="kiosk-panel"><button className="kiosk-back" type="button" onClick={() => setScreen("welcome")}>← {t.back}</button><p className="kiosk-eyebrow">01 · CHECK IN</p><h1>{t.phone}</h1><div className="kiosk-phone-display" aria-live="polite">{phone ? phone.replace(/(\d{3})(\d{3})(\d{0,4})/, (_, a, b, c) => [a, b, c].filter(Boolean).join(" ")) : <span>000 000 0000</span>}</div><div className="kiosk-keypad" aria-label="Numeric keypad">{["1","2","3","4","5","6","7","8","9","clear","0","delete"].map((key) => <button key={key} type="button" aria-label={key === "clear" ? "Clear number" : key === "delete" ? "Delete last digit" : key} onClick={() => key === "clear" ? setPhone("") : key === "delete" ? setPhone((value) => value.slice(0, -1)) : appendDigit(key)}>{key === "clear" ? "Clear" : key === "delete" ? "⌫" : key}</button>)}</div><button className="kiosk-submit kiosk-submit-compact kiosk-keypad-action" type="button" disabled={phone.replace(/\D/g, "").length !== 10 || busy} onClick={lookupAppointment}>{busy ? t.loading : t.next} <span aria-hidden="true">→</span></button>{error && <p className="kiosk-error" role="alert">{error}</p>}</section>}
    {screen === "appointment-other-date" && otherAppointment && <section className="kiosk-panel kiosk-other-date" aria-labelledby="kiosk-other-title"><p className="kiosk-eyebrow">02 · YOUR APPOINTMENT</p><h1 id="kiosk-other-title">{t.otherTitle}</h1><div className="kiosk-other-card"><span>{otherAppointment.isPast ? t.otherPast : t.otherFuture}</span><strong>{longDateLabel(otherAppointment.startAt)}</strong><b>{slotLabel(otherAppointment.startAt)}</b></div><p className="kiosk-other-note">{t.otherBody}</p>{error && <p className="kiosk-error" role="alert">{error}</p>}<div className="kiosk-other-actions"><button type="button" className="kiosk-secondary" disabled={busy} onClick={cancelOtherDate}>{t.otherCancel}</button><button type="button" className="kiosk-submit kiosk-submit-compact" disabled={busy} onClick={checkInToday}>{busy ? t.loading : t.otherCheckIn} <span aria-hidden="true">→</span></button></div></section>}
    {screen === "appointment-result" && <section className="kiosk-panel"><button className="kiosk-back" type="button" onClick={() => setScreen("appointment-phone")}>← {t.back}</button><p className="kiosk-eyebrow">02 · YOUR APPOINTMENT</p><h1>{appointments.length ? (language === "en" ? "We found your appointment" : "Votre rendez-vous est confirmé") : (language === "en" ? "Let’s find your visit" : "Cherchons votre rendez-vous")}</h1>{!appointments.length ? <p className="kiosk-not-found">{t.noAppointment}</p> : <div className="kiosk-appointment-list">{appointments.map((appointment) => <article className={`kiosk-appointment${selected === appointment.id ? " is-selected" : ""}`} key={appointment.id}><label><input type="radio" name="appointment" checked={selected === appointment.id} onChange={() => setSelected(appointment.id)} /><span><strong>{appointment.name}</strong><small>{appointment.service}</small><small>{language === "en" ? "Technician" : "Technicien(ne)"}: {appointment.technician}</small></span><b>{appointment.time ? timeLabel(appointment.time) : "—"}</b></label>{appointment.checkedIn && <small className="kiosk-checked">{t.checked}</small>}</article>)}</div>}{error && <p className="kiosk-error" role="alert">{error}</p>}{appointments.length > 0 && <button className="kiosk-submit" type="button" disabled={busy || !selected || appointments.find((item) => item.id === selected)?.checkedIn} onClick={() => { const appointment = appointments.find((item) => item.id === selected); if (appointment) void confirmAppointment(appointment); }}>{busy ? t.loading : t.confirm} <span aria-hidden="true">→</span></button>}</section>}
    {screen === "walkin" && <section className="kiosk-panel kiosk-walkin"><button className="kiosk-back" type="button" onClick={() => setScreen("welcome")}>← {t.back}</button><p className="kiosk-eyebrow">WALK-IN · SANS RENDEZ-VOUS</p><h1>{language === "en" ? "Let’s get you settled" : "Commençons votre visite"}</h1><div className="kiosk-walkin-form"><div className="kiosk-fields"><label>{t.name}<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={100} /></label><label>{t.phoneLabel}<input value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d+() -]/g, "").slice(0, 20))} onBlur={() => void autoFillName()} inputMode="tel" autoComplete="tel" /></label></div><div className="kiosk-section"><h2>{t.guestCount}</h2><div className="kiosk-counts">{[1,2,3,4].map((count) => <button type="button" key={count} aria-pressed={guestCount === count} onClick={() => { setGuestCount(count); if (activeGuest >= count) { setActiveGuest(0); setOpenCategory(null); } setError(""); }}><strong>{count}</strong><span>{count === 1 ? (language === "en" ? "guest" : "personne") : (language === "en" ? "guests" : "personnes")}</span></button>)}</div></div>{guestCount > 1 && <div className="kiosk-section kiosk-guests"><div className="kiosk-guest-tabs" role="group" aria-label={t.guestsLabel}>{Array.from({ length: guestCount }, (_, index) => { const ready = (guestServices[index]?.length ?? 0) > 0; return <button type="button" key={index} aria-pressed={activeGuest === index} data-ready={ready} onClick={() => { setActiveGuest(index); setOpenCategory(null); setError(""); }}><span>{guestLabel(index)}</span><span className="kiosk-guest-check" aria-hidden="true">{ready ? `✓ ${guestServices[index].length}` : ""}</span></button>; })}</div>{activeGuest > 0 && <div className="kiosk-fields kiosk-guest-name"><label>{t.companionName}<input value={guestNames[activeGuest] ?? ""} placeholder={`${t.guest} ${activeGuest + 1}`} maxLength={60} autoComplete="off" onChange={(event) => { const value = event.target.value; setGuestNames((all) => all.map((item, index) => (index === activeGuest ? value : item))); }} /></label></div>}</div>}{selectedServices.length > 0 && <div className="kiosk-selected" aria-live="polite"><div className="kiosk-selected-head"><span>{language === "en" ? `Selected (${selectedServices.length})` : `Sélectionnés (${selectedServices.length})`}</span><button type="button" className="kiosk-clear" onClick={() => setServices([])}>{language === "en" ? "Clear all" : "Tout effacer"}</button></div><ul>{selectedServices.map((service) => { const label = language === "en" ? service.displayNameEn : service.displayNameFr; return <li key={service.id}><span>{label}</span><b>${service.priceCad}</b><button type="button" aria-label={language === "en" ? `Remove ${label}` : `Retirer ${label}`} onClick={() => toggleService(service.id)}>✕</button></li>; })}</ul></div>}{guestCount > 1 && activeGuest < guestCount - 1 && <button type="button" className="kiosk-next-guest" onClick={() => { setActiveGuest(activeGuest + 1); setOpenCategory(null); setError(""); }}>{language === "en" ? "Next Guest" : "Invité suivant"} <span aria-hidden="true">→</span></button>}{guestCount > 1 && <div className="kiosk-party-summary" aria-live="polite"><p>{language === "en" ? "Group summary" : "Résumé du groupe"}</p><ul>{partyServices.map((list, index) => <li key={index} data-ready={list.length > 0}><b>{guestLabel(index)}:</b> <span>{list.length ? list.map((service) => (language === "en" ? service.displayNameEn : service.displayNameFr)).join(", ") : language === "en" ? "No services yet" : "Aucun service pour l’instant"}</span></li>)}</ul></div>}</div><div className="kiosk-walkin-pick"><div className="kiosk-section kiosk-services-section"><h2>{t.services}{guestCount > 1 ? ` — ${guestLabel(activeGuest)}` : ""}</h2><div className="kiosk-service-categories">{serviceCategories.map((category) => { const isOpen = openCategory === category.id; return <section key={category.id} className="kiosk-accordion" data-open={isOpen}><h3><button type="button" id={`kiosk-category-${category.id}`} className="kiosk-accordion-trigger" aria-expanded={isOpen} aria-controls={`kiosk-panel-${category.id}`} onClick={() => setOpenCategory(isOpen ? null : category.id)}><span className="kiosk-accordion-label">{category.label[language]}</span><span className="kiosk-accordion-chevron" aria-hidden="true" /></button></h3>{isOpen && <div id={`kiosk-panel-${category.id}`} role="region" aria-labelledby={`kiosk-category-${category.id}`} className="kiosk-services">{category.services.map((service) => <button type="button" key={service.id} aria-pressed={services.includes(service.id)} onClick={() => toggleService(service.id)}><span>{language === "en" ? service.displayNameEn : service.displayNameFr}</span><b>${service.priceCad}</b></button>)}</div>}</section>; })}</div></div><div className="kiosk-walkin-action"><button className="kiosk-submit kiosk-submit-compact" type="button" disabled={busy || (guestCount > 1 && !partyReady)} onClick={checkAvailability}>{busy ? t.loading : t.check} <span aria-hidden="true">→</span></button>{error && <p className="kiosk-error" role="alert">{error}</p>}</div></div></section>}
    {screen === "walkin-slots" && (() => {
      const today = torontoToday();
      const tomorrow = shiftDate(today, 1);
      const isToday = walkinDate === today;
      const isFull = !slotsLoading && !error && slots.length === 0;
      const pickTime = isToday ? t.pickTime : t.pickTimeDay;
      return <section className="kiosk-panel kiosk-walkin">
        <button className="kiosk-back" type="button" onClick={() => { slotRequest.current += 1; setSlotsLoading(false); setScreen("walkin"); setError(""); }}>← {t.back}</button>
        <p className="kiosk-eyebrow">{isToday ? t.today : t.walkinDay}</p>
        <h1>{slotsLoading ? t.loading : slots.length ? `${t.nextAvailable}: ${slotLabel(slots[0].startAt)}` : isFull ? (isToday ? t.fullTitle : t.fullDateTitle) : t.chooseDate}</h1>
        <div className="kiosk-date-bar" role="group" aria-label={t.chooseDate}>
          <button type="button" aria-pressed={isToday} onClick={() => void loadSlots(today)}>{t.todayChip}</button>
          <button type="button" aria-pressed={walkinDate === tomorrow} onClick={() => void loadSlots(tomorrow)}>{t.tomorrowChip}</button>
          <label className="kiosk-date-field" data-active={!isToday && walkinDate !== tomorrow}>
            <span className="kiosk-date-hint">{t.chooseDate}</span>
            <span className="kiosk-date-value">{walkinDate ? dayMonthYear(walkinDate) : "DD/MM/YYYY"}</span>
            <input type="date" aria-label={`${t.chooseDate} (DD/MM/YYYY)`} min={today} max={shiftDate(today, MAX_DAYS_AHEAD)} value={walkinDate} onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* Some browsers only open the picker from the icon. */ } }} onChange={(event) => { const value = event.target.value; if (value && value >= today && value <= shiftDate(today, MAX_DAYS_AHEAD) && value !== walkinDate) void loadSlots(value); }} />
          </label>
        </div>
        {slotsLoading ? <p className="kiosk-subtitle" aria-live="polite">{t.loading}</p> : slots.length > 0 ? <><p className="kiosk-subtitle">{pickTime}</p><div className="kiosk-slots" role="group" aria-label={pickTime}>{slots.map((slot, index) => <button type="button" key={slot.time} aria-pressed={selectedSlot === slot.time} className={index === 0 ? "is-next" : undefined} onClick={() => setSelectedSlot(slot.time)}><strong>{slotLabel(slot.startAt)}</strong>{index === 0 && <span>{t.earliest}</span>}</button>)}</div></> : isFull ? <p className="kiosk-not-found">{guestCount > 1 ? (isToday ? t.groupFullTodayBody : t.groupFullDateBody) : isToday ? t.fullBody : t.fullDateBody}</p> : null}
        {error && <p className="kiosk-error" role="alert">{error}</p>}
        {!slotsLoading && slots.length > 0 && <button className="kiosk-submit" type="button" disabled={busy || !selectedSlot} onClick={confirmWalkinBooking}>{busy ? t.loading : t.bookConfirm} <span aria-hidden="true">→</span></button>}
        {!slotsLoading && slots.length === 0 && isToday && <button className="kiosk-submit" type="button" disabled={busy} onClick={submitWalkIn}>{busy ? t.loading : t.submit} <span aria-hidden="true">→</span></button>}
      </section>;
    })()}
    {screen !== "welcome" && <button className="kiosk-start-over" type="button" onClick={reset}>{t.backWelcome}</button>}
  </main>;
}
