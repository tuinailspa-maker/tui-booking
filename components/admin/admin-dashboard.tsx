"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { useSquareSync } from "@/hooks/use-square-sync";
import { AppointmentCalendar } from "./appointment-calendar";
import { AppointmentDrawer, type AppointmentStatus } from "./appointment-drawer";
import { EndOfDayReport, REPORTS_CACHE_PREFIX } from "./end-of-day-report";
import { TeamAccessSettings } from "./team-access-settings";
import { PinLockScreen } from "./pin-lock-screen";
import { allServices, selectedServiceDuration, selectedServicePrice, serviceById, type ServiceAddOnKey } from "@/data/serviceTree";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { ServiceEditor } from "./service-editor";
import { ReportsDashboard } from "./reports-dashboard";
import { SquareCatalogSync } from "./square-catalog-sync";
import { ScheduleHeader } from "./schedule-header";

type AdminBooking = {
  id: string;
  squareBookingIds: string[];
  status: string;
  startAt: string;
  arrivalAt?: string | null;
  customerName: string;
  phone: string;
  technicians: string[];
  serviceIds: string[][];
  addOns: Record<string, ServiceAddOnKey>[];
  guestNames: string[];
  guestPhones: string[];
  durationMinutes: number;
};

type StaffColumn = { name: string; teamMemberId: string; kind: "real" | "virtual" };
type BookingPayload = { bookings: AdminBooking[]; date: string; locationId: string; staff?: StaffColumn[] };
const FALLBACK_STAFF: StaffColumn[] = [
  { name: "Jenny", teamMemberId: "TMeOgAbe7NNuvMjT", kind: "real" },
  { name: "Melika", teamMemberId: "TM1-LEgXD0We2PeB", kind: "real" },
  { name: "Nana", teamMemberId: "TMepcy8rc3Xdpaer", kind: "real" },
  { name: "Option 1", teamMemberId: "TMDUlMsVM52uJQkZ", kind: "virtual" },
  { name: "Option 2", teamMemberId: "TM2Kn6S4wougfdpF", kind: "virtual" },
];
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

function torontoDateTimeToIso(date: string, time: string) {
  const targetLocalAsUtc = Date.parse(`${date}T${time}:00Z`);
  const parts = getTorontoNowParts(new Date(targetLocalAsUtc).toISOString());
  const representedUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(targetLocalAsUtc - (representedUtc - targetLocalAsUtc)).toISOString();
}

function formatAppointmentDate(iso: string) {
  if (!iso) return { date: "", time: "" };
  const parts = getTorontoNowParts(iso);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function subtotalFor(booking: AdminBooking) {
  const grossSubtotal = booking.serviceIds.reduce((sum, guestIds, guestIndex) => sum + guestIds.reduce((guestSum, id) => {
    const service = allServices.find((item) => item.id === id);
    return guestSum + (service ? selectedServicePrice(service, booking.addOns[guestIndex]?.[id]) : 0);
  }, 0), 0);
  return Math.max(0, grossSubtotal - getComboDiscountDetails(booking.serviceIds, booking.addOns).amount);
}

function totalFor(booking: AdminBooking) {
  const subtotal = subtotalFor(booking);
  const taxes = Math.round(subtotal * 0.05 * 100) / 100 + Math.round(subtotal * 0.09975 * 100) / 100;
  return subtotal + taxes;
}

export function AdminDashboard({ initialDate }: { initialDate: string }) {
  const sessionHint = useSyncExternalStore(subscribeToSessionHint, readSessionHint, () => false);
  const { mutate: mutateCache } = useSWRConfig();
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [activeTab, setActiveTab] = useState<"schedule" | "queue" | "summary" | "eod" | "reports">("schedule");
  const [scheduleView, setScheduleView] = useState<"day" | "list">("day");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const [showCatalogSync, setShowCatalogSync] = useState(false);
  const checkedOutSnapshot = useSyncExternalStore(subscribeToCheckedOut, readCheckedOutSnapshot, () => "{}");
  const checkedOut = useMemo<Record<string, boolean>>(() => JSON.parse(checkedOutSnapshot), [checkedOutSnapshot]);
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, { serviceIds: string[][]; addOns: Record<string, ServiceAddOnKey>[] }>>({});
  const [walkIns, setWalkIns] = useState<AdminBooking[]>([]);
  const [assignmentBusy, setAssignmentBusy] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState("");
  const [editor, setEditor] = useState<{ booking: AdminBooking | null; walkIn: boolean } | null>(null);
  const session = useSWR<{ authenticated: boolean; role?: "owner" | "staff"; name?: string }, FetchError>(sessionHint ? "/api/admin/session" : null, jsonFetcher, { shouldRetryOnError: false, revalidateOnFocus: false });
  const isAuthenticated = sessionHint && session.data?.authenticated === true;
  const viewerRole = session.data?.role === "owner" ? "owner" : "staff";
  const isOwner = viewerRole === "owner";
  const viewerName = session.data?.name ?? "";
  const bookingKey = isAuthenticated && date ? `/api/admin/bookings?date=${encodeURIComponent(date)}` : null;
  const bookings = useSWR<BookingPayload, FetchError>(bookingKey, jsonFetcher, { revalidateOnFocus: true, refreshInterval: 60000 });
  useSquareSync(() => void bookings.mutate());
  const staffRoster = bookings.data?.staff?.length ? bookings.data.staff : FALLBACK_STAFF;
  const staffNames = staffRoster.map((member) => member.name);

  const appointments = [...(bookings.data?.date === date ? bookings.data.bookings : []), ...walkIns.filter((item) => formatAppointmentDate(item.startAt).date === date)]
    .map((booking) => ({ ...booking, estimatedSubtotal: subtotalFor(serviceOverrides[booking.id] ? { ...booking, ...serviceOverrides[booking.id] } : booking) }))
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
  const queueBookings = appointments.filter((booking) => !checkedOut[booking.id] && booking.status !== "CHECKED_OUT" && (booking.status === "CHECKED_IN" || booking.status === "IN_SERVICE" || booking.status.startsWith("WALK_IN")));
  const displayBookings = activeTab === "queue" ? queueBookings : appointments;
  const totalSales = appointments.filter((item) => checkedOut[item.id] || item.status === "CHECKED_OUT").reduce((sum, item) => {
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
      await clearReportCache();
      saveSessionHint(true);
      setPin("");
      await session.mutate();
    } catch (error) {
      setPinError(error instanceof Error ? error.message : "Unable to unlock the admin dashboard.");
    } finally {
      setPinBusy(false);
    }
  }

  function clearReportCache() {
    return mutateCache((key) => Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith(REPORTS_CACHE_PREFIX), undefined, { revalidate: false });
  }

  async function logOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    await clearReportCache();
    setEditor(null);
    setWalkIns([]);
    setServiceOverrides({});
    setActiveTab("schedule");
    await bookings.mutate(undefined, { revalidate: false });
    await session.mutate(undefined, { revalidate: false });
    saveSessionHint(false);
  }

  function setCheckedOutStatus(id: string) {
    saveCheckedOutSnapshot({ ...checkedOut, [id]: true });
  }

  async function assignWalkInTechnician(booking: AdminBooking, technician: string) {
    const teamMemberId = staffRoster.find((member) => member.name === technician)?.teamMemberId;
    if (!teamMemberId || assignmentBusy) return;
    if (booking.squareBookingIds.length === 0) {
      setWalkIns((current) => current.map((item) => item.id === booking.id ? { ...item, technicians: [technician] } : item));
      return;
    }
    setAssignmentBusy(booking.id);
    setAssignmentError("");
    try {
      for (const bookingId of booking.squareBookingIds) {
        const response = await fetch("/api/admin/bookings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId, teamMemberId }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Unable to assign technician.");
      }
      await bookings.mutate();
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "Unable to assign technician.");
    } finally {
      setAssignmentBusy(null);
    }
  }

  function openAppointmentEditor(booking: AdminBooking) {
    setEditor({ booking, walkIn: false });
  }

  function openWalkInEditor(technician = "Walk-in", slotTime?: string) {
    if (!isOwner) return;
    const now = new Date();
    const startAt = slotTime ? torontoDateTimeToIso(date, slotTime) : now.toISOString();
    const id = `walkin-${crypto.randomUUID()}`;
    const booking: AdminBooking = {
      id, squareBookingIds: [], status: "WALK_IN", startAt, customerName: "", phone: "", technicians: [technician], serviceIds: [[]], addOns: [{}], guestNames: ["Guest 1"], guestPhones: [""], durationMinutes: 0,
    };
    setEditor({ booking, walkIn: true });
  }

  async function updateBookingStatus(booking: AdminBooking, status: AppointmentStatus) {
    if (booking.squareBookingIds.length === 0) {
      setWalkIns((current) => current.map((item) => item.id === booking.id ? { ...item, status } : item));
      if (status === "CHECKED_OUT") setCheckedOutStatus(booking.id);
      return;
    }
    setAssignmentBusy(booking.id);
    setAssignmentError("");
    try {
      for (const bookingId of booking.squareBookingIds) {
        const response = await fetch("/api/admin/bookings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId, status }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Unable to update appointment status.");
      }
      await bookings.mutate();
      if (status === "CHECKED_OUT") setCheckedOutStatus(booking.id);
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "Unable to update appointment status.");
    } finally {
      setAssignmentBusy(null);
    }
  }

  async function updateBookingTechnician(booking: AdminBooking, technician: string) {
    if (booking.squareBookingIds.length === 0) {
      setWalkIns((current) => current.map((item) => item.id === booking.id ? { ...item, technicians: [technician] } : item));
      return;
    }
    await assignWalkInTechnician(booking, technician);
  }

  async function saveBillingSelection(booking: AdminBooking, serviceIds: string[][], addOns: Record<string, ServiceAddOnKey>[]) {
    if (booking.squareBookingIds.length === 0) {
      setWalkIns((current) => current.map((item) => item.id === booking.id ? { ...item, serviceIds, addOns } : item));
      return;
    }
    setServiceOverrides((current) => ({ ...current, [booking.id]: { serviceIds, addOns } }));
    for (const [index, bookingId] of booking.squareBookingIds.entries()) {
      const response = await fetch("/api/admin/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, serviceIds: serviceIds[index] ?? [], addOns: addOns[index] ?? {} }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not sync services to Square.");
    }
    await bookings.mutate();
  }

  async function saveServices(value: ServiceDraft) {
    if (!editor) return;
    if (!editor.walkIn && editor.booking?.squareBookingIds.length) {
      setAssignmentBusy(editor.booking.id);
      setAssignmentError("");
      try {
        for (const [index, bookingId] of editor.booking.squareBookingIds.entries()) {
          const response = await fetch("/api/admin/bookings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId, serviceIds: value.serviceIds[index] ?? [], addOns: value.addOns[index] ?? {} }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || "Could not sync services to Square.");
        }
        await bookings.mutate();
      } catch (error) {
        setAssignmentError(error instanceof Error ? error.message : "Could not sync services to Square.");
        return;
      } finally {
        setAssignmentBusy(null);
      }
    }
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
    return <PinLockScreen pin={pin} error={pinError} busy={pinBusy} onPinChange={setPin} onSubmit={submitPin} />;
  }

  if (!isAuthenticated) {
    return <main className="admin-access-page"><div className="admin-pin-card"><span className="admin-lock-mark" aria-hidden="true">T</span><p className="admin-eyebrow">TUI NAIL SPA · STAFF</p><h1>Verifying session</h1><p className="admin-access-copy">Checking your secure staff session…</p>{session.error && <button className="admin-secondary-button" type="button" onClick={() => saveSessionHint(false)}>Return to PIN entry</button>}</div></main>;
  }

  const dateLabel = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const drawerBooking = editor?.booking;
  const drawerStatus: AppointmentStatus = drawerBooking?.status === "CHECKED_IN" || drawerBooking?.status === "IN_SERVICE" || drawerBooking?.status === "CHECKED_OUT" ? drawerBooking.status : checkedOut[drawerBooking?.id ?? ""] ? "CHECKED_OUT" : "BOOKED";
  const drawerTechnician = drawerBooking?.technicians.find((name) => staffNames.includes(name)) ?? "";
  const checkedOutCount = appointments.filter((booking) => checkedOut[booking.id] || booking.status === "CHECKED_OUT").length;

  return <main className="admin-page">
    <aside className="admin-sidebar" aria-label="Main navigation">
      <Link className="admin-brand" href="/" aria-label="Tui Nail Spa home"><span className="admin-brand-seal">T</span></Link>
      <nav className="admin-rail-nav">
        <button type="button" className={activeTab === "schedule" ? "is-active" : ""} aria-current={activeTab === "schedule" ? "page" : undefined} onClick={() => setActiveTab("schedule")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="16" rx="2" /><path d="M8 2.8v3.5M16 2.8v3.5M3.5 9.5h17M8 13h2M13 13h3M8 16.5h2" /></svg><small>Calendar</small></button>
        <button type="button" className={activeTab === "queue" ? "is-active" : ""} aria-current={activeTab === "queue" ? "page" : undefined} onClick={() => setActiveTab("queue")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><path d="M8 8h8M8 12h5M8 16l2 2 5-5" /></svg><small>Check-in</small>{queueBookings.length > 0 && <b>{queueBookings.length}</b>}</button>
        <button type="button" className={activeTab === "summary" ? "is-active" : ""} aria-current={activeTab === "summary" ? "page" : undefined} onClick={() => setActiveTab("summary")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5h16M6.5 16V11M12 16V5M17.5 16V8" /></svg><small>Summary</small></button>
        <button type="button" className={activeTab === "eod" ? "is-active" : ""} aria-current={activeTab === "eod" ? "page" : undefined} onClick={() => setActiveTab("eod")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.3-1.5z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></svg><small>End of Day</small></button>
        {isOwner && <button type="button" className={activeTab === "reports" ? "is-active" : ""} aria-current={activeTab === "reports" ? "page" : undefined} onClick={() => setActiveTab("reports")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5h16M6 16v-4M11 16V7M16 16V4M20 16V9" /><path d="M5 8.5 10 5l5 2 4-3" /></svg><small>Reports</small></button>}
      </nav>
      <button className="admin-rail-lock" type="button" onClick={logOut} aria-label="Lock or switch staff"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10" width="13" height="11" rx="2" /><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3" /></svg><small>Lock</small></button>
    </aside>

    <div className="admin-workspace">
      <h1 className="sr-only">Tui Nail Spa dashboard</h1>
      <ScheduleHeader
        date={date}
        todayDate={initialDate}
        onDateChange={setDate}
        showWeekStrip={activeTab === "schedule" || activeTab === "queue" || activeTab === "summary"}
        isOwner={isOwner}
        viewerLabel={isOwner ? (viewerName && viewerName !== "Owner" ? `${viewerName} · Owner` : "Owner") : `${viewerName || "Staff"} · Technician`}
        syncState={bookings.error ? "error" : bookings.isLoading ? "syncing" : "ok"}
        isRefreshing={bookings.isValidating}
        onRefresh={() => void bookings.mutate()}
        onLock={logOut}
        onNewBooking={() => openWalkInEditor()}
        scheduleView={activeTab === "schedule" ? scheduleView : undefined}
        onScheduleViewChange={setScheduleView}
        columns={activeTab === "schedule" && scheduleView === "day" ? staffNames.filter((name) => name && name !== "Walk-in") : []}
        hiddenColumns={hiddenColumns}
        onToggleColumn={(name) => setHiddenColumns((current) => {
          const next = new Set(current);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        })}
        onShowAllColumns={() => setHiddenColumns(new Set())}
      />

      <div className="admin-page-content">
        {bookings.error && <div className="admin-alert" role="alert"><strong>Couldn&apos;t sync Square appointments.</strong><span>{bookings.error.message}</span><button type="button" onClick={() => bookings.mutate()}>Try again</button></div>}
        {assignmentError && <div className="admin-alert" role="alert"><strong>Couldn&apos;t update appointment.</strong><span>{assignmentError}</span></div>}
        {activeTab === "summary" ? <>
          <div className="admin-summary-intro"><div><h2>End-of-day snapshot</h2><p>{dateLabel}</p></div><span className="admin-summary-live">Square · Live</span></div>
          <section className="admin-metrics admin-summary-metrics" aria-label="Daily overview">
            <article><span>Appointments</span><strong>{appointments.filter((booking) => !booking.status.startsWith("WALK_IN")).length}</strong><small>Square bookings</small></article>
            <article><span>Checked in</span><strong>{appointments.filter((booking) => booking.status === "CHECKED_IN" || booking.status === "IN_SERVICE").length}</strong><small>in salon</small></article>
            <article><span>Walk-ins waiting</span><strong>{appointments.filter((booking) => booking.status.startsWith("WALK_IN")).length}</strong><small>arrival queue</small></article>
            <article><span>Checked out</span><strong>${totalSales.toFixed(2)}</strong><small>{checkedOutCount} completed tickets</small></article>
          </section>
          {isOwner && <TeamAccessSettings />}
          {isOwner && <section className="admin-catalog-tools" aria-label="Square catalog tools">
            <div><h3>Square catalog sync</h3><p>Prices, durations, add-ons and taxes come from the internal service menu. Open only when Square needs to be re-synced.</p></div>
            <button className="admin-secondary-button" type="button" aria-expanded={showCatalogSync} aria-controls="square-catalog-sync-panel" onClick={() => setShowCatalogSync((open) => !open)}>{showCatalogSync ? "Hide Square sync tools" : "Show Square sync tools"}</button>
          </section>}
          {isOwner && showCatalogSync && <div id="square-catalog-sync-panel"><SquareCatalogSync /></div>}
        </> : activeTab === "eod" ? <EndOfDayReport key={`${viewerRole}:${viewerName}`} initialDate={initialDate} role={viewerRole} viewerName={viewerName} technicians={staffNames} /> : activeTab === "reports" && isOwner ? <ReportsDashboard /> : <>
          {activeTab === "queue" && <div className="admin-schedule-heading"><div><h2>Arrival queue</h2><p>{displayBookings.length} {displayBookings.length === 1 ? "guest" : "guests"} · {dateLabel}</p></div><span className="admin-sync-note">Auto-refreshes every 60 seconds</span></div>}
          {bookings.isLoading && <div className="admin-loading" role="status"><span className="admin-spinner" />Loading Square appointments…</div>}
          {!bookings.isLoading && !bookings.error && displayBookings.length === 0 && <div className="admin-empty"><span aria-hidden="true">—</span><h3>{activeTab === "queue" ? "The arrival queue is clear" : "No appointments for this day"}</h3><p>{activeTab === "queue" ? "Checked-in guests and waiting walk-ins will appear here." : isOwner ? "Square has no active bookings for the selected date. Add a walk-in ticket when a guest arrives." : "You have no appointments assigned for this day."}</p>{isOwner && <button className="admin-primary-button" type="button" onClick={() => openWalkInEditor()}>+ New / Walk-in</button>}</div>}
          {(displayBookings.length > 0 || (activeTab !== "queue" && scheduleView === "day")) && <AppointmentCalendar staffNames={staffNames} date={date} bookings={displayBookings} view={activeTab === "queue" ? "list" : scheduleView} checkedOut={checkedOut} onOpenSlot={isOwner ? openWalkInEditor : () => undefined} canManageColumns={isOwner} canCreateBookings={isOwner} hiddenColumns={hiddenColumns} onSelectBooking={(booking) => openAppointmentEditor(booking as AdminBooking)} />}
          <footer className="admin-footer"><span>Live data from Square Appointments · refreshes every minute</span><span>Location R73A64VPAR34X</span></footer>
        </>}
      </div>
    </div>

    {drawerBooking && !isOwner && <AppointmentDrawer open staffNames={[viewerName]} name={drawerBooking.customerName || "Appointment"} phone={drawerBooking.phone} startAt={drawerBooking.startAt} technician={viewerName} status={drawerStatus} busy={assignmentBusy === drawerBooking.id} onClose={() => setEditor(null)} onTechnicianChange={() => undefined} onStatusChange={(status) => void updateBookingStatus(drawerBooking, status)}>
      <div className="admin-drawer-services"><div className="admin-drawer-service-heading"><div><span className="admin-drawer-section-label">TICKET</span><h3>Services</h3></div></div>
        <ul className="admin-readonly-services">{drawerBooking.serviceIds.flatMap((ids, guestIndex) => ids.map((id) => <li key={`${guestIndex}-${id}`}>{serviceById.get(id)?.name ?? id}</li>))}</ul>
        <p className="admin-access-note">Pricing, discounts and checkout are handled by the owner.</p>
      </div>
    </AppointmentDrawer>}
    {drawerBooking && isOwner && <ServiceEditor staffNames={staffNames} key={drawerBooking.id} initialServiceIds={currentEditorDraft?.serviceIds ?? drawerBooking.serviceIds} initialAddOns={currentEditorDraft?.addOns ?? drawerBooking.addOns} bookingId={drawerBooking.id} guestNames={drawerBooking.guestNames} customerName={drawerBooking.customerName} customerPhone={drawerBooking.phone} startAt={drawerBooking.startAt} technician={drawerTechnician} initialTechnicians={drawerBooking.technicians} status={drawerStatus} busy={assignmentBusy === drawerBooking.id} checkedOut={drawerStatus === "CHECKED_OUT"} onMarkCheckedOut={async () => { await updateBookingStatus(drawerBooking, "CHECKED_OUT"); }} onBillSelectionChange={(serviceIds, addOns) => saveBillingSelection(drawerBooking, serviceIds, addOns)} walkIn={Boolean(editor?.walkIn)} onCancel={() => setEditor(null)} onTechnicianChange={(technician) => void updateBookingTechnician(drawerBooking, technician)} onStatusChange={(status) => void updateBookingStatus(drawerBooking, status)} onSave={saveServices} onBookingCreated={async () => { setEditor(null); await bookings.mutate(); }} />}
  </main>;
}
