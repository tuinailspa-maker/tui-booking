"use client";

import { useEffect, type ReactNode } from "react";

export type AppointmentStatus = "BOOKED" | "CHECKED_IN" | "IN_SERVICE" | "CHECKED_OUT";

type AppointmentDrawerProps = {
  open: boolean;
  name: string;
  phone: string;
  startAt: string;
  technician: string;
  status: AppointmentStatus;
  busy?: boolean;
  onClose: () => void;
  onTechnicianChange: (value: string) => void;
  onStatusChange: (value: AppointmentStatus) => void;
  children: ReactNode;
  staffNames?: string[];
};

const statuses: { value: AppointmentStatus; label: string }[] = [
  { value: "BOOKED", label: "Booked" },
  { value: "CHECKED_IN", label: "Checked In" },
  { value: "IN_SERVICE", label: "In Service" },
  { value: "CHECKED_OUT", label: "Checked Out" },
];

export function AppointmentDrawer({ open, name, phone, startAt, technician, status, busy, onClose, onTechnicianChange, onStatusChange, children, staffNames = ["Jenny", "Melika", "Nana", "Option 1", "Option 2"] }: AppointmentDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return <div className="admin-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="admin-appointment-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-drawer-title">
      <header className="admin-drawer-header">
        <div><span className="admin-eyebrow">APPOINTMENT DETAILS</span><h2 id="appointment-drawer-title">{name || "New ticket"}</h2><p>{phone || "Add guest details"}</p></div>
        <button className="admin-icon-button" type="button" onClick={onClose} aria-label="Close appointment details">×</button>
      </header>
      <div className="admin-drawer-scroll">
        <div className="admin-drawer-details"><span><small>DATE & TIME</small><strong>{new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(startAt))}</strong></span><label><small>TECHNICIAN</small><select value={technician} onChange={(event) => onTechnicianChange(event.target.value)} disabled={busy}><option value="">Unassigned</option>{staffNames.map((name) => <option key={name}>{name}</option>)}</select></label></div>
        <div className="admin-drawer-status"><span className="admin-drawer-section-label">STATUS</span><div role="group" aria-label="Appointment status">{statuses.map((item) => <button type="button" key={item.value} aria-pressed={status === item.value} disabled={busy} onClick={() => onStatusChange(item.value)}>{item.label}</button>)}</div></div>
        {children}
      </div>
    </section>
  </div>;
}
