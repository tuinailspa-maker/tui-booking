"use client";

import { useMemo } from "react";
import { serviceById } from "@/data/serviceTree";

export type CalendarBooking = {
  id: string;
  status: string;
  startAt: string;
  customerName: string;
  technicians: string[];
  durationMinutes: number;
  serviceIds: string[][];
};

type AppointmentCalendarProps = {
  date: string;
  bookings: CalendarBooking[];
  view: "day" | "list";
  checkedOut: Record<string, boolean>;
  onOpenSlot: (technician: string, time: string) => void;
  onSelectBooking: (booking: CalendarBooking) => void;
};

const STAFF = ["Jenny", "Melika", "Nana", "Walk-in"];
const START_MINUTE = 8 * 60;
const END_MINUTE = 20 * 60;
const HALF_HOUR_HEIGHT = 48;

function localMinutes(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function timeLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function isUnassigned(booking: CalendarBooking) {
  return !booking.status.startsWith("WALK_IN") && !booking.technicians.some((technician) => ["Jenny", "Melika", "Nana"].includes(technician));
}

function serviceSummary(booking: CalendarBooking) {
  const names = booking.serviceIds.flat().map((id) => serviceById.get(id)?.nameEn).filter((name): name is string => Boolean(name));
  if (names.length === 0) return "Service to be selected";
  return `${names.slice(0, 2).join(" · ")}${names.length > 2 ? ` +${names.length - 2} more` : ""}`;
}

function statusInfo(booking: CalendarBooking, checkedOut: boolean) {
  if (checkedOut || booking.status === "CHECKED_OUT") return { label: "Checked Out", className: "is-checked-out" };
  if (booking.status === "CHECKED_IN") return { label: "Checked In", className: "is-checked-in" };
  if (booking.status === "IN_SERVICE") return { label: "In Service", className: "is-in-service" };
  if (isUnassigned(booking)) return { label: "Unassigned", className: "is-unassigned" };
  return { label: booking.status.startsWith("WALK_IN") ? "Walk-in" : "Booked", className: "is-booked" };
}

export function AppointmentCalendar({ date, bookings, view, checkedOut, onOpenSlot, onSelectBooking }: AppointmentCalendarProps) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const nowValues = Object.fromEntries(nowParts.map((part) => [part.type, part.value]));
  const nowMinute = Number(nowValues.hour) * 60 + Number(nowValues.minute);
  const timeZoneLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", timeZoneName: "short" }).formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value ?? "ET";
  const showNow = date === today && nowMinute >= START_MINUTE && nowMinute <= END_MINUTE;
  const ticks = useMemo(() => Array.from({ length: (END_MINUTE - START_MINUTE) / 30 + 1 }, (_, index) => START_MINUTE + index * 30), []);

  if (view === "list") {
    return <div className="admin-appointment-list">
      {bookings.map((booking) => {
        const status = statusInfo(booking, checkedOut[booking.id] === true);
        return <button type="button" className={`admin-list-booking ${status.className}`} key={booking.id} onClick={() => onSelectBooking(booking)}>
          <strong>{timeLabel(localMinutes(booking.startAt))}</strong>
          <span><b>{booking.customerName || "Walk-in guest"}</b><small>{booking.technicians.filter((name) => name !== "Unassigned").join(", ") || "Unassigned"} · {serviceSummary(booking)}</small></span>
          <em>{status.label}</em>
        </button>;
      })}
    </div>;
  }

  return <div className="admin-calendar-shell" aria-label="Appointments calendar">
    <div className="admin-calendar-header">
      <div className="admin-time-header" aria-hidden="true">{timeZoneLabel}</div>
      {STAFF.map((name, index) => <div className="admin-staff-header" key={name}>
        <span className={`admin-staff-avatar avatar-${index}`}>{name === "Walk-in" ? "+" : name.charAt(0)}</span>
        <span><strong>{name}</strong><small>{index === 3 ? "QUEUE" : "TECHNICIAN"}</small></span>
      </div>)}
    </div>
    <div className="admin-calendar-body">
      <div className="admin-time-axis" aria-hidden="true">
        {ticks.filter((minute) => minute % 60 === 0).map((minute) => <span key={minute} style={{ top: `${((minute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px` }}>{timeLabel(minute)}</span>)}
      </div>
      {STAFF.map((staff) => {
        const assigned = bookings.filter((booking) => {
          const start = localMinutes(booking.startAt);
          if (start < START_MINUTE || start >= END_MINUTE) return false;
          return staff === "Walk-in"
            ? booking.status.startsWith("WALK_IN") || booking.technicians.includes("Walk-in") || isUnassigned(booking)
            : booking.technicians.includes(staff) && !booking.status.startsWith("WALK_IN");
        });
        return <div className="admin-staff-column" key={staff}>
          {ticks.slice(0, -1).map((minute) => <button className="admin-calendar-slot" type="button" key={minute} aria-label={`New ${staff} appointment at ${timeLabel(minute)}`} style={{ top: `${((minute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px`, height: `${HALF_HOUR_HEIGHT}px` }} onClick={() => onOpenSlot(staff, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`)} />)}
          {assigned.map((booking) => {
            const start = localMinutes(booking.startAt);
            const duration = Math.max(15, booking.durationMinutes || 30);
            const top = ((start - START_MINUTE) / 30) * HALF_HOUR_HEIGHT;
            const height = Math.max(34, (duration / 30) * HALF_HOUR_HEIGHT - 3);
            const status = statusInfo(booking, checkedOut[booking.id] === true);
            return <button type="button" key={booking.id} className={`admin-calendar-card ${status.className}`} style={{ top: `${top}px`, height: `${height}px` }} onClick={() => onSelectBooking(booking)}>
              <strong>{timeLabel(start)} – {timeLabel(start + duration)}</strong>
              <b>{booking.customerName || "Walk-in guest"}</b>
              <small>{serviceSummary(booking)}</small>
              <span>{status.label}</span>
            </button>;
          })}
        </div>;
      })}
      <div className="admin-grid-lines" aria-hidden="true">{ticks.map((minute) => <span className={minute % 60 === 0 ? "is-hour" : ""} key={minute} style={{ top: `${((minute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px` }} />)}</div>
      {showNow && <div className="admin-current-time" aria-label={`Current time ${timeLabel(nowMinute)}`} style={{ top: `${((nowMinute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px` }}><span />{timeLabel(nowMinute)}</div>}
    </div>
  </div>;
}
