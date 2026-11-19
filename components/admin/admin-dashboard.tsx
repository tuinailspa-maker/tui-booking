"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import useSWR from "swr";
import { allServices, selectedServiceDuration, selectedServicePrice, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { BackupBill } from "@/components/booking/backup-bill";
import { ServiceEditor } from "./service-editor";

type AdminBooking = {
  id: string;
  squareBookingIds: string[];
  status: string;
  startAt: string;
  customerName: string;
  phone: string;
  technicians: string[];
  serviceIds: string[][];
  addOns: Record<string, ServiceAddOnKey>[];
  guestNames: string[];
  guestPhones: string[];
  durationMinutes: number;
};

type BookingPayload = { bookings: AdminBooking[]; date: string; locationId: string };
type ServiceDraft = { serviceIds: string[][]; addOns: Record<string, ServiceAddOnKey>[]; customerName: string; customerPhone: string };
type FetchError = Error & { status?: number };

const SESSION_STORAGE_KEY = "tui-admin-unlocked";
const CHECKED_OUT_STORAGE_KEY = "tui-admin-checked-out";
const SESSION_EVENT = "tui-admin-session-change";
const CHECKOUT_EVENT = "tui-admin-checkout-change";

function readSessionHint() {
  return typeof window !== "undefined" && window.sessionStorage.getItem(SESSION_STORAGE_KEY) === "1";
}

function subscribeToSessionHint(callback: () => void) {
  window.addEventListener(SESSION_EVENT, callback);
  return () => window.removeEventListener(SESSION_EVENT, callback);
}

function saveSessionHint(value: boolean) {
  if (value) window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
  else window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function readCheckedOutSnapshot() {
  if (typeof window === "undefined") return "{}";
  const snapshot = window.sessionStorage.getItem(CHECKED_OUT_STORAGE_KEY) ?? "{}";
  try { JSON.parse(snapshot); return snapshot; } catch { return "{}"; }
}

function subscribeToCheckedOut(callback: () => void) {
  window.addEventListener(CHECKOUT_EVENT, callback);
  return () => window.removeEventListener(CHECKOUT_EVENT, callback);
}

function saveCheckedOutSnapshot(value: Record<string, boolean>) {
  window.sessionStorage.setItem(CHECKED_OUT_STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(CHECKOUT_EVENT));
}

async function jsonFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") saveSessionHint(false);
    const error = new Error(body.error || `Request failed with status ${response.status}.`) as FetchError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

function getTorontoNowParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatAppointmentTime(iso: string) {
  if (!iso) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function formatAppointmentDate(iso: string) {
  if (!iso) return { date: "", time: "" };
  const parts = getTorontoNowParts(iso);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function statusLabel(status: string) {
  if (status === "ACCEPTED" || status === "BOOKED") return "Confirmed";
  if (status === "PENDING") return "Pending";
  if (status === "MIXED") return "Partially confirmed";
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function totalFor(booking: AdminBooking) {
  const grossSubtotal = booking.serviceIds.reduce((sum, guestIds, guestIndex) => sum + guestIds.reduce((guestSum, id) => {
    const service = allServices.find((item) => item.id === id);
    return guestSum + (service ? selectedServicePrice(service, booking.addOns[guestIndex]?.[id]) : 0);
  }, 0), 0);
  return grossSubtotal - getComboDiscountDetails(booking.serviceIds, booking.addOns).amount;
}

export function AdminDashboard({ initialDate }: { initialDate: string }) {
  const sessionHint = useSyncExternalStore(subscribeToSessionHint, readSessionHint, () => false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [date, setDate] = useState(initialDate);
  const checkedOutSnapshot = useSyncExternalStore(subscribeToCheckedOut, readCheckedOutSnapshot, () => "{}");
  const checkedOut = useMemo<Record<string, boolean>>(() => JSON.parse(checkedOutSnapshot), [checkedOutSnapshot]);
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, { serviceIds: string[][]; addOns: Record<string, ServiceAddOnKey>[] }>>({});
  const [walkIns, setWalkIns] = useState<AdminBooking[]>([]);
  const [editor, setEditor] = useState<{ booking: AdminBooking | null; walkIn: boolean } | null>(null);
  const session = useSWR<{ authenticated: boolean }, FetchError>(sessionHint ? "/api/admin/session" : null, jsonFetcher, { shouldRetryOnError: false, revalidateOnFocus: false });
  const isAuthenticated = sessionHint && session.data?.authenticated === true;
  const bookingKey = isAuthenticated && date ? `/api/admin/bookings?date=${encodeURIComponent(date)}` : null;
  const bookings = useSWR<BookingPayload, FetchError>(bookingKey, jsonFetcher, { revalidateOnFocus: false });

  const appointments = [...(bookings.data?.date === date ? bookings.data.bookings : []), ...walkIns.filter((item) => formatAppointmentDate(item.startAt).date === date)]
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
  const totalSales = appointments.filter((item) => checkedOut[item.id]).reduce((sum, item) => {
    const override = serviceOverrides[item.id];
    return sum + totalFor(override ? { ...item, ...override } : item);
  }, 0);
  const currentEditorBooking = editor?.booking;
  const currentEditorDraft = currentEditorBooking ? serviceOverrides[currentEditorBooking.id] : undefined;

  async function submitPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pin.length !== 4 || pinBusy) return;
    setPinBusy(true);
    setPinError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to unlock the admin dashboard.");
      saveSessionHint(true);
      setPin("");
      await session.mutate();
    } catch (error) {
      setPinError(error instanceof Error ? error.message : "Unable to unlock the admin dashboard.");
    } finally {
      setPinBusy(false);
    }
  }

  async function logOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    await bookings.mutate(undefined, { revalidate: false });
    await session.mutate(undefined, { revalidate: false });
    saveSessionHint(false);
  }

  function setCheckedOutStatus(id: string) {
    saveCheckedOutSnapshot({ ...checkedOut, [id]: true });
  }

  function openAppointmentEditor(booking: AdminBooking) {
    setEditor({ booking, walkIn: false });
  }

  function openWalkInEditor() {
    const now = new Date();
    const startAt = now.toISOString();
    const id = `walkin-${crypto.randomUUID()}`;
    const booking: AdminBooking = {
      id, squareBookingIds: [], status: "WALK_IN", startAt, customerName: "", phone: "", technicians: ["Walk-in"], serviceIds: [[]], addOns: [{}], guestNames: ["Guest 1"], guestPhones: [""], durationMinutes: 0,
    };
    setEditor({ booking, walkIn: true });
  }

  function saveServices(value: ServiceDraft) {
    if (!editor) return;
    if (editor.walkIn && editor.booking) {
      const durationMinutes = value.serviceIds[0]?.reduce((sum, id) => {
        const service = allServices.find((item) => item.id === id);
        return sum + (service ? selectedServiceDuration(service, value.addOns[0]?.[id]) : 0);
      }, 0) ?? 0;
      const booking: AdminBooking = {
        ...editor.booking, customerName: value.customerName, phone: value.customerPhone, guestNames: [value.customerName], guestPhones: [value.customerPhone], serviceIds: value.serviceIds, addOns: value.addOns, durationMinutes,
      };
      setWalkIns((current) => [booking, ...current]);
    } else if (editor.booking) {
      setServiceOverrides((current) => ({ ...current, [editor.booking!.id]: { serviceIds: value.serviceIds, addOns: value.addOns } }));
    }
    setEditor(null);
  }

  if (!sessionHint || session.error?.status === 401 || bookings.error?.status === 401) {
    return <main className="admin-access-page">
      <div className="admin-access-card">
        <span className="admin-lock-mark" aria-hidden="true">T</span>
        <p className="admin-eyebrow">TUI NAIL SPA · STAFF</p>
        <h1>Salon Admin</h1>
        <p className="admin-access-copy">Enter your 4-digit staff PIN to open today&apos;s schedule.</p>
        <form onSubmit={submitPin}>
          <label htmlFor="admin-pin">Staff PIN</label>
          <input id="admin-pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} required aria-describedby={pinError ? "admin-pin-error" : undefined} />
          {pinError && <p className="admin-form-error" id="admin-pin-error" role="alert">{pinError}</p>}
          <button className="admin-primary-button admin-unlock-button" type="submit" disabled={pin.length !== 4 || pinBusy}>{pinBusy ? "Unlocking…" : "Unlock dashboard"}</button>
        </form>
        <p className="admin-access-footnote">Your session stays unlocked in this tab only.</p>
      </div>
    </main>;
  }

  if (!isAuthenticated) {
    return <main className="admin-access-page"><div className="admin-access-card"><span className="admin-lock-mark" aria-hidden="true">T</span><p className="admin-eyebrow">TUI NAIL SPA · STAFF</p><h1>Verifying session</h1><p className="admin-access-copy">Checking your secure staff session…</p>{session.error && <button className="admin-secondary-button" type="button" onClick={() => { saveSessionHint(false); }}>Return to PIN entry</button>}</div></main>;
  }

  return <main className="admin-page">
    <header className="admin-topbar">
      <Link className="admin-brand" href="/" aria-label="Tui Nail Spa booking home"><span className="admin-brand-seal">T</span><span><strong>Tui Nail Spa</strong><small>STAFF ADMIN</small></span></Link>
      <div className="admin-topbar-actions"><span className={`admin-live-indicator${bookings.error ? " is-error" : bookings.isLoading ? " is-syncing" : ""}`}><i /> {bookings.error ? "Square unavailable" : bookings.isLoading ? "Syncing Square" : "Square connected"}</span><button type="button" className="admin-logout-button" onClick={logOut}>Lock dashboard</button></div>
    </header>

    <div className="admin-content">
      <section className="admin-page-heading">
        <div><p className="admin-eyebrow">APPOINTMENT OPERATIONS</p><h1>Daily schedule</h1><p>Review live appointments and prepare checkout receipts.</p></div>
        <div className="admin-toolbar"><label htmlFor="admin-date">Day<input id="admin-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="admin-secondary-button" type="button" onClick={() => bookings.mutate()} disabled={bookings.isValidating}>{bookings.isValidating ? "Refreshing…" : "Refresh"}<span aria-hidden="true">↻</span></button><button className="admin-primary-button" type="button" onClick={openWalkInEditor}><span aria-hidden="true">+</span> Walk-in</button></div>
      </section>

      <section className="admin-metrics" aria-label="Daily overview">
        <article><span>Appointments</span><strong>{appointments.length}</strong><small>on selected date</small></article>
        <article><span>Checked out</span><strong>{appointments.filter((booking) => checkedOut[booking.id]).length}</strong><small>tickets completed</small></article>
        <article><span>Subtotal billed</span><strong>${totalSales.toFixed(2)}</strong><small>before taxes and tips</small></article>
        <article><span>Next appointment</span><strong>{appointments.find((booking) => !checkedOut[booking.id]) ? formatAppointmentTime(appointments.find((booking) => !checkedOut[booking.id])!.startAt) : "—"}</strong><small>{appointments.some((booking) => !checkedOut[booking.id]) ? "up next" : "all clear"}</small></article>
      </section>

      <div className="admin-schedule-heading"><div><h2>Appointments</h2><p>{new Intl.DateTimeFormat("en-CA", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</p></div><span className="admin-count-pill">{appointments.length} {appointments.length === 1 ? "booking" : "bookings"}</span></div>
      {bookings.error && <div className="admin-alert" role="alert"><strong>Couldn&apos;t sync Square appointments.</strong><span>{bookings.error.message}</span><button type="button" onClick={() => bookings.mutate()}>Try again</button></div>}
      {bookings.isLoading && <div className="admin-loading" role="status"><span className="admin-spinner" />Loading Square appointments…</div>}
      {!bookings.isLoading && !bookings.error && appointments.length === 0 && <div className="admin-empty"><span aria-hidden="true">—</span><h3>No appointments for this day</h3><p>Square has no active bookings for the selected date. Add a walk-in ticket when a guest arrives.</p></div>}
      {appointments.length > 0 && <div className="admin-appointment-list">
        {appointments.map((booking) => {
          const override = serviceOverrides[booking.id];
          const selection = override ?? { serviceIds: booking.serviceIds, addOns: booking.addOns };
          const isWalkIn = booking.status === "WALK_IN";
          const isCheckedOut = checkedOut[booking.id] === true;
          const dateTime = formatAppointmentDate(booking.startAt);
          const displayDuration = override ? selection.serviceIds.reduce((sum, ids, guestIndex) => sum + ids.reduce((guestTotal, id) => {
            const service = allServices.find((item) => item.id === id);
            return guestTotal + (service ? selectedServiceDuration(service, selection.addOns[guestIndex]?.[id]) : 0);
          }, 0), 0) : booking.durationMinutes;
          const serviceList = selection.serviceIds.flatMap((ids, guestIndex) => ids.map((id) => {
            const service = allServices.find((item) => item.id === id);
            return service ? { id: `${guestIndex}-${id}`, guestIndex, label: serviceDisplayNameWithAddOn(service, "en", selection.addOns[guestIndex]?.[id]), amount: selectedServicePrice(service, selection.addOns[guestIndex]?.[id]) } : null;
          })).filter((item): item is NonNullable<typeof item> => Boolean(item));
          return <article className={`admin-appointment-card${isCheckedOut ? " is-checked-out" : ""}`} key={booking.id}>
            <div className="admin-time-column"><strong>{formatAppointmentTime(booking.startAt)}</strong><span>{displayDuration ? `${displayDuration} min` : "Walk-in"}</span><i /></div>
            <div className="admin-appointment-main">
              <div className="admin-appointment-person"><div><h3>{booking.customerName || "Walk-in guest"}</h3><p>{booking.phone || "No phone on file"}</p></div><span className={`admin-status${isCheckedOut ? " is-paid" : ""}`}>{isCheckedOut ? "Checked out" : isWalkIn ? "Walk-in" : statusLabel(booking.status)}</span></div>
              <div className="admin-appointment-meta"><span><small>TECHNICIAN</small>{Array.from(new Set(booking.technicians)).join(", ") || "Unassigned"}</span><span><small>SQUARE REF</small>{booking.squareBookingIds[0] ?? "Walk-in"}</span></div>
              <div className="admin-appointment-services"><div className="admin-service-lines"><strong>Services</strong>{serviceList.length > 0 ? serviceList.map((service) => <span key={service.id}>{selection.serviceIds.length > 1 ? <small>Guest {service.guestIndex + 1} · </small> : null}{service.label}<b>${service.amount}</b></span>) : <span className="admin-unmapped-service">Services weren&apos;t recognized. Add them before checkout.</span>}</div><div className="admin-card-total"><small>ESTIMATED</small><strong>${totalFor({ ...booking, ...selection }).toFixed(2)}</strong></div></div>
              <div className="admin-card-actions"><button type="button" className="admin-edit-button" onClick={() => openAppointmentEditor(booking)}>Edit services</button><BackupBill language="en" date={dateTime.date} time={dateTime.time} selections={selection.serviceIds} serviceAddOns={selection.addOns} customerName={booking.customerName} customerPhone={booking.phone} triggerLabel={isCheckedOut ? "View receipt" : "Check out / Bill"} onMarkCheckedOut={isCheckedOut ? undefined : () => setCheckedOutStatus(booking.id)} markCheckedOutLabel="Mark checked out" /></div>
            </div>
          </article>;
        })}
      </div>}
      <footer className="admin-footer"><span>Live data from Square Appointments</span><span>Location R73A64VPAR34X</span></footer>
    </div>

    {editor?.booking && <ServiceEditor key={editor.booking.id} initialServiceIds={currentEditorDraft?.serviceIds ?? editor.booking.serviceIds} initialAddOns={currentEditorDraft?.addOns ?? editor.booking.addOns} guestNames={editor.booking.guestNames} customerName={editor.booking.customerName} customerPhone={editor.booking.phone} walkIn={editor.walkIn} onCancel={() => setEditor(null)} onSave={saveServices} />}
  </main>;
}
