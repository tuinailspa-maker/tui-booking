"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { allServices, selectedServiceDuration, selectedServicePrice, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { ServiceTree } from "@/components/booking/service-tree";
import { translations } from "@/components/booking/copy";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { getClosingTimeForDate } from "@/data/staffSchedule";
import { BackupBill } from "@/components/booking/backup-bill";
import { AppointmentDrawer, type AppointmentStatus } from "./appointment-drawer";

function datePartsForTime(iso: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour ?? "10", minute: parts.minute ?? "00" };
}

function subscribeToSquareOrders(callback: () => void) {
  window.addEventListener("tui-square-order-change", callback);
  return () => window.removeEventListener("tui-square-order-change", callback);
}

function readSquareOrder(bookingId: string) {
  return window.sessionStorage.getItem(`tui-square-order:${bookingId}`) ?? "";
}

type ServiceEditorProps = {
  initialServiceIds: string[][];
  initialAddOns: Record<string, ServiceAddOnKey>[];
  guestNames: string[];
  customerName: string;
  customerPhone: string;
  startAt: string;
  technician: string;
  initialTechnicians?: string[];
  squareServiceReference?: string[];
  onBillSelectionChange?: (serviceIds: string[][], addOns: Record<string, ServiceAddOnKey>[]) => void | Promise<void>;
  status: AppointmentStatus;
  busy?: boolean;
  checkedOut?: boolean;
  onMarkCheckedOut?: () => void | Promise<void>;
  walkIn: boolean;
  onCancel: () => void;
  onTechnicianChange: (value: string) => void;
  onStatusChange: (value: AppointmentStatus) => void;
  onSave: (value: { serviceIds: string[][]; addOns: Record<string, ServiceAddOnKey>[]; customerName: string; customerPhone: string }) => void | Promise<void>;
  onBookingCreated?: () => Promise<void>;
  bookingId: string;
  staffNames?: string[];
};

export function ServiceEditor({ initialServiceIds, initialAddOns, guestNames, customerName, customerPhone, startAt, technician, initialTechnicians = [], squareServiceReference = [], onBillSelectionChange, status, busy, checkedOut, onMarkCheckedOut, walkIn, onCancel, onTechnicianChange, onStatusChange, onSave, onBookingCreated, bookingId, staffNames = ["Jenny", "Melika", "Nana", "Option 1", "Option 2"] }: ServiceEditorProps) {
  const guestCount = Math.max(1, initialServiceIds.length);
  const [activeGuest, setActiveGuest] = useState(0);
  const [serviceIds, setServiceIds] = useState(() => Array.from({ length: guestCount }, (_, index) => initialServiceIds[index] ?? []));
  const [addOns, setAddOns] = useState(() => Array.from({ length: guestCount }, (_, index) => initialAddOns[index] ?? {}));
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [validation, setValidation] = useState("");
  const [mode, setMode] = useState<"walkin" | "appointment">("walkin");
  const [partySize, setPartySize] = useState(guestCount);
  const [notes, setNotes] = useState("");
  const [bookingDate, setBookingDate] = useState(datePartsForTime(startAt).date);
  const [bookingTime, setBookingTime] = useState(`${datePartsForTime(startAt).hour}:${datePartsForTime(startAt).minute}`);
  const closingTime = getClosingTimeForDate(bookingDate);
  const [closingHour, closingMinute] = closingTime.split(":").map(Number);
  const closingMinutes = closingHour * 60 + closingMinute;
  const lastStartTime = `${String(Math.floor((closingMinutes - 30) / 60)).padStart(2, "0")}:${String((closingMinutes - 30) % 60).padStart(2, "0")}`;
  const [technicians, setTechnicians] = useState<string[]>(() => Array.from({ length: 3 }, (_, index) => initialTechnicians[index] ?? (index === 0 ? technician || staffNames[0] || "Jenny" : staffNames.filter((name) => name !== technician)[index - 1] ?? staffNames[0] ?? "Jenny")));
  const [submitting, setSubmitting] = useState(false);
  const selectionSyncQueue = useRef<Promise<void>>(Promise.resolve());
  const [selectionSyncStatus, setSelectionSyncStatus] = useState<"idle" | "syncing" | "saved" | "error">("idle");
  const squareOrderId = useSyncExternalStore(subscribeToSquareOrders, () => readSquareOrder(bookingId), () => "");
  const [manualDiscountType, setManualDiscountType] = useState<"FIXED_AMOUNT" | "PERCENTAGE">("FIXED_AMOUNT");
  const [manualDiscountValue, setManualDiscountValue] = useState("");
  const activeIds = serviceIds[activeGuest] ?? [];
  const activeAddOns = addOns[activeGuest] ?? {};
  const activeDuration = activeIds.reduce((total, id) => {
    const service = allServices.find((item) => item.id === id);
    return total + (service ? selectedServiceDuration(service, activeAddOns[id]) : 0);
  }, 0);
  const subtotal = serviceIds.reduce((sum, ids, guestIndex) => sum + ids.reduce((guestTotal, id) => {
    const service = allServices.find((item) => item.id === id);
    return guestTotal + (service ? selectedServicePrice(service, addOns[guestIndex]?.[id]) : 0);
  }, 0), 0);
  const discount = getComboDiscountDetails(serviceIds, addOns).amount;
  const manualDiscountNumber = Number(manualDiscountValue);
  const manualDiscountAmount = manualDiscountValue && Number.isFinite(manualDiscountNumber) && manualDiscountNumber > 0
    ? Math.min(Math.max(0, subtotal - discount), manualDiscountType === "PERCENTAGE" ? (subtotal - discount) * manualDiscountNumber / 100 : manualDiscountNumber)
    : 0;
  const taxableSubtotal = Math.round(Math.max(0, subtotal - discount - manualDiscountAmount) * 100) / 100;
  const tps = Math.round(taxableSubtotal * 0.05 * 100) / 100;
  const tvq = Math.round(taxableSubtotal * 0.09975 * 100) / 100;
  const estimatedTotal = Math.round((taxableSubtotal + tps + tvq) * 100) / 100;
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startAt)).map((part) => [part.type, part.value]));
  const billDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const billTime = `${dateParts.hour}:${dateParts.minute}`;

  function queueSelectionSync(nextServiceIds: string[][], nextAddOns: Record<string, ServiceAddOnKey>[]) {
    if (!onBillSelectionChange || squareOrderId || nextServiceIds.some((ids) => ids.length === 0)) return;
    setSelectionSyncStatus("syncing");
    selectionSyncQueue.current = selectionSyncQueue.current
      .catch(() => undefined)
      .then(() => onBillSelectionChange(nextServiceIds, nextAddOns))
      .then(() => setSelectionSyncStatus("saved"))
      .catch((error: unknown) => {
        setSelectionSyncStatus("error");
        setValidation(error instanceof Error ? error.message : "Could not sync services to Square.");
      });
  }

  function toggleService(id: string) {
    const removing = activeIds.includes(id);
    const nextServiceIds = serviceIds.map((ids, index) => index !== activeGuest
      ? ids
      : removing ? ids.filter((serviceId) => serviceId !== id) : [...ids, id]);
    const nextAddOns = removing
      ? addOns.map((items, index) => {
        if (index !== activeGuest) return items;
        const next = { ...items };
        delete next[id];
        return next;
      })
      : addOns;
    setServiceIds(nextServiceIds);
    setAddOns(nextAddOns);
    queueSelectionSync(nextServiceIds, nextAddOns);
    setValidation("");
  }

  function changeAddOn(serviceId: string, value: ServiceAddOnKey | "") {
    const nextAddOns = addOns.map((items, index) => {
      if (index !== activeGuest) return items;
      const next = { ...items };
      if (value) next[serviceId] = value;
      else delete next[serviceId];
      return next;
    });
    setAddOns(nextAddOns);
    queueSelectionSync(serviceIds, nextAddOns);
  }

  function toggleAddOn(serviceId: string) {
    const service = allServices.find((item) => item.id === serviceId);
    const currentKey = activeAddOns[serviceId];
    changeAddOn(serviceId, service?.addOn?.key === currentKey ? "" : service?.addOn?.key ?? "");
  }

  async function createSquareAppointment() {
    if (!name.trim() || !phone.trim()) { setValidation("Enter the client name and phone number."); return; }
    const selected = serviceIds.slice(0, partySize);
    if (selected.length !== partySize || selected.some((ids) => ids.length === 0)) { setValidation("Choose at least one service for each guest."); return; }
    const assigned = technicians.slice(0, partySize);
    if (new Set(assigned).size !== partySize) { setValidation("Choose a different technician for each guest."); return; }
    if (!bookingDate || !bookingTime) { setValidation("Choose an appointment date and start time."); return; }
    const [startHour, startMinute] = bookingTime.split(":").map(Number);
    const longestGuestDuration = Math.max(...selected.map((ids, index) => ids.reduce((total, id) => {
      const service = allServices.find((item) => item.id === id);
      return total + (service ? selectedServiceDuration(service, addOns[index]?.[id]) : 0);
    }, 0)));
    const startMinutes = startHour * 60 + startMinute;
    if (startMinutes < 8 * 60 || startMinutes >= closingMinutes || startMinutes + longestGuestDuration > closingMinutes) {
      setValidation("Appointments must start between 8:00 AM and the daily closing time, and finish by closing.");
      return;
    }
    setSubmitting(true); setValidation("");
    try {
      const localAsUtc = Date.parse(`${bookingDate}T${bookingTime}:00Z`);
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(localAsUtc)).map((part) => [part.type, part.value]));
      const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      const startAt = new Date(localAsUtc - (represented - localAsUtc)).toISOString();
      const names = name.trim().split(/\\s+/);
      const response = await fetch("/api/bookings/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), startAt, client: { firstName: names[0], lastName: names.slice(1).join(" ") || "Guest", countryCode: "+1", phone: phone.trim(), notes: notes.trim() }, guests: selected.map((ids, index) => ({ serviceIds: ids, addOns: addOns[index] ?? {}, technician: assigned[index] })) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 409 ? "This time conflicts with an existing Square appointment. Choose another time." : result.detail || result.error || "Could not create the Square appointment.");
      await onBookingCreated?.();
    } catch (error) { setValidation(error instanceof Error ? error.message : "Could not create the Square appointment."); }
    finally { setSubmitting(false); }
  }

  async function recordCheckout(checkout: { tipAmount: number; paymentMethod: "Card" | "Cash" }) {
    const squareOrderId = readSquareOrder(bookingId) || null;
    const combo = getComboDiscountDetails(serviceIds, addOns);
    const discountByGuest = new Map(combo.qualifyingGuests.map((guest) => [guest.guestIndex, 5]));
    const grossByGuest = serviceIds.map((ids, index) => ids.reduce((sum, id) => {
      const service = allServices.find((item) => item.id === id);
      return sum + (service ? selectedServicePrice(service, addOns[index]?.[id]) : 0);
    }, 0));
    const afterCombo = grossByGuest.map((amount, index) => Math.max(0, amount - (discountByGuest.get(index) ?? 0)));
    const totalAfterCombo = afterCombo.reduce((sum, amount) => sum + amount, 0);
    const manualDiscountCents = Math.round(manualDiscountAmount * 100);
    const tipCents = Math.round(checkout.tipAmount * 100);
    let allocatedDiscount = 0;
    let allocatedTip = 0;
    const transactedGuests = serviceIds.map((ids, guestIndex) => {
      const discountShare = guestIndex === serviceIds.length - 1
        ? manualDiscountCents - allocatedDiscount
        : Math.round(manualDiscountCents * (totalAfterCombo > 0 ? afterCombo[guestIndex] / totalAfterCombo : 1 / serviceIds.length));
      allocatedDiscount += discountShare;
      const subtotalCents = Math.max(0, Math.round(afterCombo[guestIndex] * 100) - discountShare);
      const tipShare = guestIndex === serviceIds.length - 1
        ? tipCents - allocatedTip
        : Math.round(tipCents * (totalAfterCombo > 0 ? subtotalCents / Math.max(1, Math.round(totalAfterCombo * 100) - manualDiscountCents) : 1 / serviceIds.length));
      allocatedTip += tipShare;
      const services = ids.flatMap((id) => {
        const service = allServices.find((item) => item.id === id);
        return service ? [{ name: serviceDisplayNameWithAddOn(service, "en", addOns[guestIndex]?.[id]), amount: selectedServicePrice(service, addOns[guestIndex]?.[id]) }] : [];
      });
      const response = fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: `${bookingId}:${guestIndex}`,
          bookingId,
          squareOrderId,
          paymentMethod: checkout.paymentMethod,
          guest: {
            guestIndex,
            guestName: guestNames[guestIndex]?.trim() || (guestIndex === 0 ? name.trim() || customerName : `Guest ${guestIndex + 1}`),
            technician: technicians[guestIndex] || initialTechnicians[guestIndex] || (guestIndex === 0 ? technician : "Unassigned"),
            services,
            serviceSubtotal: subtotalCents / 100,
            tipAmount: tipShare / 100,
          },
        }),
      }).then(async (result) => {
        const data = await result.json().catch(() => ({}));
        if (!result.ok) throw new Error(data.error || "Could not save checkout report.");
      });
      return response;
    });
    await Promise.all(transactedGuests);
    await onMarkCheckedOut?.();
  }

  function handleBillSelectionChange(nextServiceIds: string[][], nextAddOns: Record<string, ServiceAddOnKey>[]) {
    if (squareOrderId) return;
    setServiceIds(nextServiceIds);
    setAddOns(nextAddOns);
    queueSelectionSync(nextServiceIds, nextAddOns);
  }

  async function save() {
    if (mode === "appointment") { void createSquareAppointment(); return; }
    if (walkIn && !name.trim()) {
      setValidation("Enter the walk-in customer name.");
      return;
    }
    if (serviceIds.some((ids) => ids.length === 0)) {
      setValidation("Choose at least one service for each guest.");
      return;
    }
    await selectionSyncQueue.current;
    await onSave({ serviceIds, addOns, customerName: name.trim(), customerPhone: phone.trim() });
  }

  return <AppointmentDrawer open staffNames={staffNames} name={walkIn ? (name || "New walk-in") : customerName || "Appointment"} phone={walkIn ? phone : customerPhone} startAt={startAt} technician={technician} status={status} busy={busy} onClose={onCancel} onTechnicianChange={onTechnicianChange} onStatusChange={onStatusChange}>
    <div className="admin-drawer-services">
      {walkIn && <div className="admin-booking-mode" role="group" aria-label="Ticket type"><button type="button" aria-pressed={mode === "appointment"} onClick={() => { setMode("appointment"); setValidation(""); }}>Book Appointment (Sync to Square)</button><button type="button" aria-pressed={mode === "walkin"} onClick={() => { setMode("walkin"); setValidation(""); }}>Quick Walk-in</button></div>}
      <div className="admin-drawer-service-heading"><div><span className="admin-drawer-section-label">TICKET</span><h3>Services</h3></div><span>{serviceIds.flat().length} selected</span></div>
      {walkIn && <div className="admin-walkin-fields">
        <label>Client name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Guest name" /></label>
        <label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="438-555-0100" /></label>
      </div>}
      {walkIn && mode === "appointment" && <div className="admin-booking-fields">
        <label>Appointment date<input type="date" value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} /></label>
        <label>Start time<input type="time" min="08:00" max={lastStartTime} step="1800" value={bookingTime} onChange={(event) => setBookingTime(event.target.value)} /></label>
        <label>Party size<select value={partySize} onChange={(event) => { const size = Number(event.target.value); setPartySize(size); setServiceIds((current) => Array.from({ length: size }, (_, index) => current[index] ?? [])); setAddOns((current) => Array.from({ length: size }, (_, index) => current[index] ?? {})); setActiveGuest(Math.min(activeGuest, size - 1)); }}>{[1, 2, 3].map((size) => <option key={size} value={size}>{size} {size === 1 ? "guest" : "guests"}</option>)}</select></label>
      </div>}
      {walkIn && mode === "appointment" && <label className="admin-search-label">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Anything the team should know?" /></label>}
      {(mode === "appointment" ? partySize : guestCount) > 1 && <div className="admin-guest-tabs" role="group" aria-label="Choose a guest">
        {Array.from({ length: mode === "appointment" ? partySize : guestCount }, (_, index) => <button key={index} type="button" aria-pressed={activeGuest === index} className={activeGuest === index ? "is-active" : ""} onClick={() => setActiveGuest(index)}>{`Guest ${index + 1}`}</button>)}
      </div>}
      {walkIn && mode === "appointment" && <label className="admin-search-label">Technician for Guest {activeGuest + 1}<select value={technicians[activeGuest] || "Jenny"} onChange={(event) => setTechnicians((current) => current.map((value, index) => index === activeGuest ? event.target.value : value))}>{staffNames.map((name) => <option key={name}>{name}</option>)}</select></label>}
      <div className="admin-service-tree">
        <ServiceTree language="en" copy={translations.en} selectedIds={activeIds} selectedAddOns={activeAddOns} onToggleService={toggleService} onToggleAddOn={toggleAddOn} disabled={Boolean(squareOrderId)} />
      </div>
      {activeIds.length > 0 && <div className="admin-selected-services" aria-label={`Selected services for guest ${activeGuest + 1}`}>
        <div className="admin-selected-heading">
          <span>Selected for Guest {activeGuest + 1}</span>
          <span>{activeIds.length} {activeIds.length === 1 ? "item" : "items"} · {activeDuration} min</span>
        </div>
        <ul className="admin-selected-list">
          {activeIds.map((id) => {
            const service = allServices.find((item) => item.id === id);
            if (!service) return null;
            const addOn = service.addOn;
            const addOnOn = Boolean(addOn && activeAddOns[id] === addOn.key);
            const label = serviceDisplayNameWithAddOn(service, "en", activeAddOns[id]);
            return <li key={id} className="admin-selected-row">
              <div className="admin-selected-main">
                <span className="admin-selected-name">{label}</span>
                <span className="admin-selected-meta">{selectedServiceDuration(service, activeAddOns[id])} min</span>
              </div>
              <strong className="admin-selected-price">${selectedServicePrice(service, activeAddOns[id])}</strong>
              <div className="admin-selected-actions">
                {addOn && <button type="button" className={`admin-selected-addon${addOnOn ? " is-on" : ""}`} aria-pressed={addOnOn} onClick={() => toggleAddOn(id)} disabled={Boolean(squareOrderId)}>
                  {addOnOn ? "−" : "+"} {addOn.nameEn} (+${addOn.priceCad} / +{addOn.durationMinutes} min)
                </button>}
                <button type="button" className="admin-selected-remove" onClick={() => toggleService(id)} disabled={Boolean(squareOrderId)} aria-label={`Remove ${label}`}>
                  <span aria-hidden="true">×</span> Remove
                </button>
              </div>
            </li>;
          })}
        </ul>
      </div>}
      {selectionSyncStatus === "syncing" && <p className="admin-access-copy" role="status">Updating services in Square…</p>}
      {selectionSyncStatus === "saved" && <p className="admin-access-copy" role="status">Services updated in Square.</p>}
      {validation && <p className="admin-form-error" role="alert">{validation}</p>}
      <div className="admin-ticket-totals"><span>Services subtotal<strong>${subtotal.toFixed(2)}</strong></span>{discount > 0 && <span>Combo discount<strong>−${discount.toFixed(2)}</strong></span>}{manualDiscountAmount > 0 && <span>Manual discount<strong>−${manualDiscountAmount.toFixed(2)}</strong></span>}<span>Taxable subtotal<strong>${taxableSubtotal.toFixed(2)}</strong></span><span>TPS (5%)<strong>${tps.toFixed(2)}</strong></span><span>TVQ (9.975%)<strong>${tvq.toFixed(2)}</strong></span><span className="admin-ticket-total">Estimated total with tax<strong>${estimatedTotal.toFixed(2)}</strong></span></div>
      <div className="admin-manual-discount">
        <label>Manual discount
          <span className="admin-discount-controls">
            <select aria-label="Manual discount type" value={manualDiscountType} onChange={(event) => setManualDiscountType(event.target.value as "FIXED_AMOUNT" | "PERCENTAGE")} disabled={Boolean(squareOrderId)}>
              <option value="FIXED_AMOUNT">Amount ($)</option><option value="PERCENTAGE">Percent (%)</option>
            </select>
            <input aria-label="Manual discount value" type="number" min="0.01" max={manualDiscountType === "PERCENTAGE" ? 100 : undefined} step="0.01" value={manualDiscountValue} onChange={(event) => setManualDiscountValue(event.target.value)} placeholder="No discount" disabled={Boolean(squareOrderId)} />
          </span>
        </label>
      </div>
      {squareOrderId && <p className="admin-square-order-confirmation" role="status"><strong>Square order recorded for this checkout.</strong><span>Square order: {squareOrderId}</span></p>}
      <div className="admin-drawer-bill"><BackupBill language="en" date={billDate} time={billTime} selections={serviceIds} serviceAddOns={addOns} technicians={mode === "appointment" ? technicians.slice(0, serviceIds.length) : Array.from({ length: serviceIds.length }, (_, index) => initialTechnicians[index] || (index === 0 ? technician : "Unassigned"))} customerName={walkIn ? name : customerName} customerPhone={walkIn ? phone : customerPhone} bookingId={bookingId} terminalEnabled={!checkedOut} manualDiscountAmount={manualDiscountAmount} squareServiceReference={squareServiceReference} onBillSelectionChange={handleBillSelectionChange} triggerLabel={checkedOut ? "View receipt" : "Check out / Bill"} onMarkCheckedOut={checkedOut ? undefined : recordCheckout} markCheckedOutLabel="Save checkout & mark paid" /></div>
      <div className="admin-drawer-footer">
        <button className="admin-secondary-button" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button className="admin-primary-button" type="button" onClick={save} disabled={submitting}>{submitting ? "Syncing to Square…" : walkIn && mode === "appointment" ? "Book appointment" : walkIn ? "Create ticket" : "Save services"}</button>
      </div>
    </div>
  </AppointmentDrawer>;
}
