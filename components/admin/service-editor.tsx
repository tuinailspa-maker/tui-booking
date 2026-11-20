"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { allServices, selectedServiceDuration, selectedServicePrice, serviceDisplayNameWithAddOn, serviceTree, type ServiceAddOnKey, type ServiceNode } from "@/data/serviceTree";
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

function filterServiceNodes(nodes: ServiceNode[], query: string): ServiceNode[] {
  if (!query) return nodes;
  const normalizedQuery = query.trim().toLocaleLowerCase("en-CA");
  return nodes.flatMap((node) => {
    const names = node.type === "branch"
      ? `${node.nameEn} ${node.nameFr}`
      : `${node.nameEn} ${node.nameFr} ${node.displayNameEn ?? ""} ${node.displayNameFr ?? ""}`;
    if (names.toLocaleLowerCase("en-CA").includes(normalizedQuery)) return [node];
    if (node.type === "branch") {
      const children = filterServiceNodes(node.children, query);
      if (children.length) return [{ ...node, children }];
    }
    return [];
  });
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
  onBillSelectionChange?: (serviceIds: string[][], addOns: Record<string, ServiceAddOnKey>[]) => void;
  status: AppointmentStatus;
  busy?: boolean;
  checkedOut?: boolean;
  onMarkCheckedOut?: () => void | Promise<void>;
  walkIn: boolean;
  onCancel: () => void;
  onTechnicianChange: (value: string) => void;
  onStatusChange: (value: AppointmentStatus) => void;
  onSave: (value: { serviceIds: string[][]; addOns: Record<string, ServiceAddOnKey>[]; customerName: string; customerPhone: string }) => void;
  onBookingCreated?: () => Promise<void>;
  bookingId: string;
};

export function ServiceEditor({ initialServiceIds, initialAddOns, guestNames, customerName, customerPhone, startAt, technician, initialTechnicians = [], squareServiceReference = [], onBillSelectionChange, status, busy, checkedOut, onMarkCheckedOut, walkIn, onCancel, onTechnicianChange, onStatusChange, onSave, onBookingCreated, bookingId }: ServiceEditorProps) {
  const guestCount = Math.max(1, initialServiceIds.length);
  const [activeGuest, setActiveGuest] = useState(0);
  const [serviceIds, setServiceIds] = useState(() => Array.from({ length: guestCount }, (_, index) => initialServiceIds[index] ?? []));
  const [addOns, setAddOns] = useState(() => Array.from({ length: guestCount }, (_, index) => initialAddOns[index] ?? {}));
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [search, setSearch] = useState("");
  const [expandedServiceBranches, setExpandedServiceBranches] = useState(["hands", "feet", "waxing", "variable-add-ons"]);
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
  const [technicians, setTechnicians] = useState<string[]>(() => Array.from({ length: 3 }, (_, index) => initialTechnicians[index] ?? (index === 0 ? technician || "Jenny" : ["Jenny", "Melika", "Nana"].filter((name) => name !== technician)[index - 1] ?? "Jenny")));
  const [submitting, setSubmitting] = useState(false);
  const [sendingToSquare, setSendingToSquare] = useState(false);
  const squareOrderId = useSyncExternalStore(subscribeToSquareOrders, () => readSquareOrder(bookingId), () => "");
  const [squareOrderError, setSquareOrderError] = useState("");
  const [manualDiscountType, setManualDiscountType] = useState<"FIXED_AMOUNT" | "PERCENTAGE">("FIXED_AMOUNT");
  const [manualDiscountValue, setManualDiscountValue] = useState("");
  const visibleServiceTree = filterServiceNodes(serviceTree, search);
  const activeIds = serviceIds[activeGuest] ?? [];
  const activeAddOns = addOns[activeGuest] ?? {};
  const subtotal = serviceIds.reduce((sum, ids, guestIndex) => sum + ids.reduce((guestTotal, id) => {
    const service = allServices.find((item) => item.id === id);
    return guestTotal + (service ? selectedServicePrice(service, addOns[guestIndex]?.[id]) : 0);
  }, 0), 0);
  const discount = getComboDiscountDetails(serviceIds, addOns).amount;
  const manualDiscountNumber = Number(manualDiscountValue);
  const manualDiscountAmount = manualDiscountValue && Number.isFinite(manualDiscountNumber) && manualDiscountNumber > 0
    ? Math.min(Math.max(0, subtotal - discount), manualDiscountType === "PERCENTAGE" ? (subtotal - discount) * manualDiscountNumber / 100 : manualDiscountNumber)
    : 0;
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startAt)).map((part) => [part.type, part.value]));
  const billDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const billTime = `${dateParts.hour}:${dateParts.minute}`;

  function toggleService(id: string) {
    setServiceIds((current) => current.map((ids, index) => {
      if (index !== activeGuest) return ids;
      return ids.includes(id) ? ids.filter((serviceId) => serviceId !== id) : [...ids, id];
    }));
    setValidation("");
  }

  function changeAddOn(serviceId: string, value: ServiceAddOnKey | "") {
    setAddOns((current) => current.map((items, index) => {
      if (index !== activeGuest) return items;
      const next = { ...items };
      if (value) next[serviceId] = value;
      else delete next[serviceId];
      return next;
    }));
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

  async function sendToSquare() {
    if (sendingToSquare || squareOrderId) return;
    if (!name.trim() || !phone.trim()) { setSquareOrderError("Enter the guest name and phone number before sending to Square."); return; }
    if (serviceIds.some((ids) => ids.length === 0)) { setSquareOrderError("Choose at least one service for each guest before sending."); return; }
    const numericDiscount = Number(manualDiscountValue);
    if (manualDiscountValue && (!Number.isFinite(numericDiscount) || numericDiscount <= 0 || (manualDiscountType === "PERCENTAGE" && numericDiscount > 100))) {
      setSquareOrderError("Enter a valid discount amount. Percentages must be 100% or less."); return;
    }
    setSendingToSquare(true);
    setSquareOrderError("");
    try {
      const response = await fetch("/api/square/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          customerName: name.trim() || customerName,
          customerPhone: phone.trim() || customerPhone,
          serviceIds,
          addOns,
          manualDiscount: manualDiscountValue ? { type: manualDiscountType, value: numericDiscount } : null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to send this order to Square.");
      window.sessionStorage.setItem(`tui-square-order:${bookingId}`, result.squareOrderId);
      window.dispatchEvent(new Event("tui-square-order-change"));
    } catch (error) {
      setSquareOrderError(error instanceof Error ? error.message : "Unable to send this order to Square.");
    } finally {
      setSendingToSquare(false);
    }
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

  function save() {
    if (mode === "appointment") { void createSquareAppointment(); return; }
    if (walkIn && !name.trim()) {
      setValidation("Enter the walk-in customer name.");
      return;
    }
    if (serviceIds.some((ids) => ids.length === 0)) {
      setValidation("Choose at least one service for each guest.");
      return;
    }
    onSave({ serviceIds, addOns, customerName: name.trim(), customerPhone: phone.trim() });
  }

  function renderServiceNode(node: ServiceNode, depth = 0): ReactNode {
    if (node.type === "service") {
      const selected = activeIds.includes(node.id);
      const selectedAddOn = activeAddOns[node.id] ?? "";
      return <article className={`admin-tree-service${selected ? " is-selected" : ""}`} key={node.id}>
        <button className="admin-tree-service-toggle" type="button" aria-pressed={selected} onClick={() => toggleService(node.id)} disabled={Boolean(squareOrderId)}>
          <span className="admin-service-check" aria-hidden="true">{selected ? "✓" : "+"}</span>
          <span className="admin-tree-service-name"><strong>{node.nameEn}</strong><small>{node.displayNameEn}</small></span>
          <span className="admin-service-price">${selectedServicePrice(node, selectedAddOn)}</span>
        </button>
        {selected && node.addOn && <label className="admin-addon-choice">Optional: {node.addOn.nameEn}
          <select value={selectedAddOn} onChange={(event) => changeAddOn(node.id, event.target.value as ServiceAddOnKey | "")} disabled={Boolean(squareOrderId)}>
            <option value="">No add-on</option>
            <option value={node.addOn.key}>{node.addOn.nameEn} +${node.addOn.priceCad}</option>
          </select>
        </label>}
      </article>;
    }

    const isExpanded = Boolean(search) || expandedServiceBranches.includes(node.id);
    const countSelected = (branch: ServiceNode): number => branch.type === "service"
      ? Number(activeIds.includes(branch.id))
      : branch.children.reduce((count, child) => count + countSelected(child), 0);
    const selectedCount = countSelected(node);
    return <section className={`admin-tree-branch depth-${Math.min(depth, 3)}`} key={node.id}>
      <button className={`admin-tree-branch-toggle${depth === 0 ? " is-root" : ""}`} type="button" aria-expanded={isExpanded} onClick={() => setExpandedServiceBranches((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id])}>
        <span className={`admin-tree-chevron${isExpanded ? " is-open" : ""}`} aria-hidden="true">⌄</span>
        <span>{node.nameEn}</span>
        {selectedCount > 0 && <span className="admin-tree-count">{selectedCount}</span>}
      </button>
      {isExpanded && <div className="admin-tree-children">{node.children.map((child) => renderServiceNode(child, depth + 1))}</div>}
    </section>;
  }

  return <AppointmentDrawer open name={walkIn ? (name || "New walk-in") : customerName || "Appointment"} phone={walkIn ? phone : customerPhone} startAt={startAt} technician={technician} status={status} busy={busy} onClose={onCancel} onTechnicianChange={onTechnicianChange} onStatusChange={onStatusChange}>
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
      {walkIn && mode === "appointment" && <label className="admin-search-label">Technician for Guest {activeGuest + 1}<select value={technicians[activeGuest] || "Jenny"} onChange={(event) => setTechnicians((current) => current.map((value, index) => index === activeGuest ? event.target.value : value))}>{["Jenny", "Melika", "Nana"].map((name) => <option key={name}>{name}</option>)}</select></label>}
      <label className="admin-search-label">Add or edit services<input type="search" aria-label="Search salon services" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the service menu" /></label>
      <div className="admin-service-tree" role="group" aria-label="Salon service menu">
        {visibleServiceTree.length > 0 ? visibleServiceTree.map((node) => renderServiceNode(node)) : <p className="admin-tree-empty">No services match your search.</p>}
      </div>
      {activeIds.length > 0 && <div className="admin-selected-services" aria-label={`Selected services for guest ${activeGuest + 1}`}>
        <span>Selected for Guest {activeGuest + 1}</span>
        {activeIds.map((id) => {
          const service = allServices.find((item) => item.id === id);
          if (!service) return null;
          return <button key={id} type="button" onClick={() => toggleService(id)} disabled={Boolean(squareOrderId)}>
            <span>{serviceDisplayNameWithAddOn(service, "en", activeAddOns[id])}</span><strong>${selectedServicePrice(service, activeAddOns[id])}</strong>
          </button>;
        })}
      </div>}
      {validation && <p className="admin-form-error" role="alert">{validation}</p>}
      <div className="admin-ticket-totals"><span>Services subtotal<strong>${subtotal.toFixed(2)}</strong></span>{discount > 0 && <span>Combo discount<strong>−${discount.toFixed(2)}</strong></span>}{manualDiscountAmount > 0 && <span>Manual discount<strong>−${manualDiscountAmount.toFixed(2)}</strong></span>}<span className="admin-ticket-total">Estimated total before tax<strong>${Math.max(0, subtotal - discount - manualDiscountAmount).toFixed(2)}</strong></span></div>
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
      {squareOrderError && <p className="admin-form-error" role="alert">{squareOrderError}</p>}
      {squareOrderId && <p className="admin-square-order-confirmation" role="status"><strong>Sent to Square POS — open the Orders tab on iPad to collect payment.</strong><span>Square order: {squareOrderId}</span></p>}
      <div className="admin-drawer-bill"><BackupBill language="en" date={billDate} time={billTime} selections={serviceIds} serviceAddOns={addOns} technicians={mode === "appointment" ? technicians.slice(0, serviceIds.length) : Array.from({ length: serviceIds.length }, (_, index) => initialTechnicians[index] || (index === 0 ? technician : "Unassigned"))} customerName={walkIn ? name : customerName} customerPhone={walkIn ? phone : customerPhone} squareServiceReference={squareServiceReference} onBillSelectionChange={(nextServiceIds, nextAddOns) => { if (squareOrderId) return; setServiceIds(nextServiceIds); setAddOns(nextAddOns); onBillSelectionChange?.(nextServiceIds, nextAddOns); }} triggerLabel={checkedOut ? "View receipt" : "Check out / Bill"} onMarkCheckedOut={checkedOut ? undefined : recordCheckout} markCheckedOutLabel="Save checkout & mark paid" /></div>
      <div className="admin-drawer-footer">
        {mode === "walkin" && <button className="admin-secondary-button" type="button" onClick={() => void sendToSquare()} disabled={sendingToSquare || submitting || Boolean(squareOrderId) || serviceIds.some((ids) => ids.length === 0)}>{sendingToSquare ? "Sending to Square…" : squareOrderId ? "Sent to Square POS" : "Send to Square POS"}</button>}
        <button className="admin-secondary-button" type="button" onClick={onCancel} disabled={submitting || sendingToSquare}>Cancel</button>
        <button className="admin-primary-button" type="button" onClick={save} disabled={submitting || sendingToSquare}>{submitting ? "Syncing to Square…" : walkIn && mode === "appointment" ? "Book appointment" : walkIn ? "Create ticket" : "Save services"}</button>
      </div>
    </div>
  </AppointmentDrawer>;
}
