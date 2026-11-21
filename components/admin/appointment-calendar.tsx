"use client";

import { useMemo, useState } from "react";
import { serviceById } from "@/data/serviceTree";
import { getClosingTimeForDate } from "@/data/staffSchedule";

export type CalendarBooking = {
  id: string;
  status: string;
  startAt: string;
  customerName: string;
  phone?: string;
  estimatedSubtotal?: number;
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
  staffNames?: string[];
};

const DEFAULT_STAFF_NAMES = ["Jenny", "Melika", "Nana", "Option 1", "Option 2"];
const START_MINUTE = 8 * 60;
const HALF_HOUR_HEIGHT = 48;
const TIME_AXIS_WIDTH = 68;
const MIN_COLUMN_WIDTH = 160;

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

function isUnassigned(booking: CalendarBooking, staffNames: string[] = DEFAULT_STAFF_NAMES) {
  return !booking.status.startsWith("WALK_IN") && !booking.technicians.some((technician) => staffNames.includes(technician));
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

/** Greedy lane packing so overlapping bookings in one column sit side by side instead of stacking. */
function layoutLanes(items: { id: string; start: number; end: number }[]) {
  const sorted = [...items].sort((left, right) => left.start - right.start || right.end - left.end);
  const placement = new Map<string, { lane: number; lanes: number }>();
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    group.forEach(({ id, lane }) => placement.set(id, { lane, lanes: laneEnds.length }));
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.push(item.end) - 1;
    else laneEnds[lane] = item.end;
    group.push({ id: item.id, lane });
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return placement;
}

export function AppointmentCalendar({ date, bookings, view, checkedOut, onOpenSlot, onSelectBooking, staffNames = DEFAULT_STAFF_NAMES }: AppointmentCalendarProps) {
  const ALL_COLUMNS = Array.from(new Set(staffNames.filter((name) => name && name !== "Walk-in")));
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const STAFF = ALL_COLUMNS.filter((name) => !hiddenColumns.has(name));
  const toggleColumn = (name: string) => setHiddenColumns((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
  const gridMinWidth = `${TIME_AXIS_WIDTH + Math.max(1, STAFF.length) * MIN_COLUMN_WIDTH}px`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const nowValues = Object.fromEntries(nowParts.map((part) => [part.type, part.value]));
  const nowMinute = Number(nowValues.hour) * 60 + Number(nowValues.minute);
  const closingTime = getClosingTimeForDate(date);
  const [closingHour, closingMinute] = closingTime.split(":").map(Number);
  const endMinute = closingHour * 60 + closingMinute;
  const columnHeight = ((endMinute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT;
  const timeZoneLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", timeZoneName: "short" }).formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value ?? "ET";
  const showNow = date === today && nowMinute >= START_MINUTE && nowMinute <= endMinute;
  const ticks = useMemo(() => Array.from({ length: (endMinute - START_MINUTE) / 30 + 1 }, (_, index) => START_MINUTE + index * 30), [endMinute]);

  if (view === "list") {
    return <div className="admin-appointment-list">
      {bookings.map((booking) => {
        const status = statusInfo(booking, checkedOut[booking.id] === true);
        return <button type="button" className={`admin-list-booking ${status.className}`} key={booking.id} onClick={() => onSelectBooking(booking)}>
          <strong>{timeLabel(localMinutes(booking.startAt))}</strong>
          <span><b>{booking.customerName || "Walk-in guest"}</b><small>{booking.phone ? `${booking.phone} · ` : ""}{booking.technicians.filter((name) => name !== "Unassigned").join(", ") || "Unassigned"} · {serviceSummary(booking)}</small></span>
          <em>{status.label}{booking.estimatedSubtotal !== undefined ? ` · $${booking.estimatedSubtotal.toFixed(2)}` : ""}</em>
        </button>;
      })}
    </div>;
  }

  return <div className="admin-calendar-wrap">
  <div className="admin-column-toggles" role="group" aria-label="Show or hide schedule columns">
    <span className="admin-column-toggles-label">Columns</span>
    {ALL_COLUMNS.map((name) => {
      const visible = !hiddenColumns.has(name);
      return <button type="button" key={name} className={`admin-column-toggle${visible ? " is-visible" : ""}`} aria-pressed={visible} onClick={() => toggleColumn(name)}>
        {visible ? "Hide" : "Show"} <strong>{name}</strong>
      </button>;
    })}
    {hiddenColumns.size > 0 && <button type="button" className="admin-column-toggle is-reset" onClick={() => setHiddenColumns(new Set())}>Show all</button>}
  </div>
  {STAFF.length === 0 ? <p className="admin-calendar-empty" role="status">All columns are hidden. Use the toggles above to show a column.</p> :
  <div className="admin-calendar-shell" aria-label="Appointments calendar">
    <div className="admin-cal-row admin-calendar-header" style={{ minWidth: gridMinWidth }}>
      <div className="admin-time-header" aria-hidden="true">{timeZoneLabel}</div>
      {STAFF.map((name) => <div className="admin-cal-lane admin-staff-header" key={name}>
        <span className={`admin-staff-avatar avatar-${ALL_COLUMNS.indexOf(name) % 6}`}>{name.charAt(0)}</span>
        <span><strong>{name}</strong><small>{name.startsWith("Option ") ? "OPTION" : "TECHNICIAN"}</small></span>
      </div>)}
    </div>
    <div className="admin-cal-row admin-calendar-body" style={{ minWidth: gridMinWidth, height: `${columnHeight}px` }}>
      <div className="admin-time-axis" aria-hidden="true">
        {ticks.filter((minute) => minute % 60 === 0).map((minute) => <span key={minute} style={{ top: `${((minute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px` }}>{timeLabel(minute)}</span>)}
      </div>
      <div className="admin-cal-lanes">
      <div className="admin-grid-lines" aria-hidden="true">{ticks.map((minute) => <span className={minute % 60 === 0 ? "is-hour" : ""} key={minute} style={{ top: `${((minute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px` }} />)}</div>
      {STAFF.map((staff) => {
        const assigned = bookings.filter((booking) => {
          const start = localMinutes(booking.startAt);
          if (start < START_MINUTE || start >= endMinute) return false;
          return booking.technicians.includes(staff);
        });
        const lanes = layoutLanes(assigned.map((booking) => {
          const start = localMinutes(booking.startAt);
          return { id: booking.id, start, end: start + Math.max(15, booking.durationMinutes || 30) };
        }));
        return <div className="admin-cal-lane admin-staff-column" key={staff}>
          {ticks.slice(0, -1).map((minute) => <button className="admin-calendar-slot" type="button" key={minute} aria-label={`New ${staff} appointment at ${timeLabel(minute)}`} style={{ top: `${((minute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px`, height: `${HALF_HOUR_HEIGHT}px` }} onClick={() => onOpenSlot(staff, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`)} />)}
          {assigned.map((booking) => {
            const start = localMinutes(booking.startAt);
            const duration = Math.max(15, booking.durationMinutes || 30);
            const top = ((start - START_MINUTE) / 30) * HALF_HOUR_HEIGHT;
            const height = Math.min(columnHeight - top, Math.max(34, (duration / 30) * HALF_HOUR_HEIGHT - 3));
            const status = statusInfo(booking, checkedOut[booking.id] === true);
            const { lane, lanes: laneCount } = lanes.get(booking.id) ?? { lane: 0, lanes: 1 };
            return <button type="button" key={booking.id} className={`admin-calendar-card ${status.className}`} style={{ top: `${top}px`, height: `${height}px`, left: `calc(${(lane / laneCount) * 100}% + 4px)`, width: `calc(${100 / laneCount}% - 8px)` }} onClick={() => onSelectBooking(booking)}>
              <strong>{timeLabel(start)} – {timeLabel(start + duration)}</strong>
              <b>{booking.customerName || "Walk-in guest"}</b>
              <small>{serviceSummary(booking)}</small>
              <small>{[booking.phone, booking.technicians.filter((name) => name !== "Unassigned").join(", ") || "Unassigned", booking.estimatedSubtotal !== undefined ? `$${booking.estimatedSubtotal.toFixed(2)}` : ""].filter(Boolean).join(" · ")}</small>
              <span>{status.label}</span>
            </button>;
          })}
        </div>;
      })}
      </div>
      {showNow && (
            <div
              className="admin-current-time"
              aria-label={`Current time ${timeLabel(nowMinute)}`}
              style={{ position: "absolute", zIndex: 7, left: 0, right: 0, top: `${((nowMinute - START_MINUTE) / 30) * HALF_HOUR_HEIGHT}px`, display: "flex", alignItems: "center", gap: 0, transform: "translateY(-50%)", pointerEvents: "none", color: "#d93025", fontSize: 9 }}
            >
              <em style={{ flex: "0 0 68px", width: 68, boxSizing: "border-box", paddingRight: 6, background: "#fff", fontStyle: "normal", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{timeLabel(nowMinute)}</em>
              <span style={{ position: "static", flex: "0 0 7px", width: 7, height: 7, marginLeft: -4, borderRadius: "50%", background: "#e5483b" }} />
              <i aria-hidden="true" style={{ flex: 1, height: 1, background: "#e5483b" }} />
            </div>
          )}
    </div>
  </div>}
  </div>;
}
