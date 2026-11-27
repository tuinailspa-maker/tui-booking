"use client";

import { useState } from "react";
import useSWR from "swr";
import { calculateBill } from "@/data/billing";
import type { ServiceAddOnKey } from "@/data/serviceTree";
import styles from "./payment-override-dialog.module.css";

type PaymentRecord = { guestIndex: number; guestName: string; technician: string; serviceSubtotal: string; tipAmount: string; paymentMethod: string; squareOrderId: string | null };

export type PaymentOverrideTarget = {
  bookingId: string;
  title: string;
  startAt?: string;
  guestNames?: string[];
  technicians?: string[];
  selections?: string[][];
  addOns?: Record<string, ServiceAddOnKey>[];
};

type Props = { target: PaymentOverrideTarget; staffNames: string[]; onClose: () => void; onSaved: (paid: boolean) => void };

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Could not load payment.");
  return result as { records: PaymentRecord[] };
};

function draftGuests(target: PaymentOverrideTarget) {
  const selections = target.selections ?? [];
  if (selections.length === 0) return [];
  const bill = calculateBill({ selections, addOns: target.addOns ?? selections.map(() => ({})) });
  return bill.guestLines.map((lines, guestIndex) => ({
    guestIndex,
    guestName: target.guestNames?.[guestIndex] || (guestIndex === 0 ? target.title : `Guest ${guestIndex + 1}`),
    technician: target.technicians?.[guestIndex] || "Unassigned",
    services: lines.map((line) => ({ name: line.addOnNameEn ? `${line.nameEn} + ${line.addOnNameEn}` : line.nameEn, amount: line.priceCents / 100 })),
    serviceSubtotal: Math.max(0, (bill.guestSubtotalCents[guestIndex] ?? 0) - (bill.guestComboDiscountCents[guestIndex] ?? 0)) / 100,
  }));
}

export function PaymentOverrideDialog({ target, staffNames, onClose, onSaved }: Props) {
  const existing = useSWR(`/api/admin/payments?bookingId=${encodeURIComponent(target.bookingId)}`, fetcher, { revalidateOnFocus: false });
  return <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="payment-override-title">
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>EDIT PAYMENT</span><h2 id="payment-override-title">{target.title}</h2>{target.startAt && <p>{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(target.startAt))}</p>}</div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </header>
      {existing.isLoading ? <p className={styles.status} role="status">Loading saved payment…</p>
        : existing.error ? <p className={styles.error} role="alert">{existing.error.message}</p>
        : <PaymentForm key={target.bookingId} target={target} staffNames={staffNames} records={existing.data?.records ?? []} onClose={onClose} onSaved={onSaved} />}
    </div>
  </div>;
}

function PaymentForm({ target, staffNames, records, onClose, onSaved }: Props & { records: PaymentRecord[] }) {
  const guests = draftGuests(target);
  const rows = records.length > 0 ? records.map((row) => ({ guestName: row.guestName, technician: row.technician, subtotal: Number(row.serviceSubtotal) })) : guests.map((guest) => ({ guestName: guest.guestName, technician: guest.technician, subtotal: guest.serviceSubtotal }));
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState<"Card" | "Cash">(records[0]?.paymentMethod === "Cash" ? "Cash" : "Card");
  const [tip, setTip] = useState(records.length > 0 ? records.reduce((sum, row) => sum + Number(row.tipAmount), 0).toFixed(2) : "");
  const [orderId, setOrderId] = useState(records.find((row) => row.squareOrderId)?.squareOrderId ?? "");
  const [technicians, setTechnicians] = useState(rows.map((row) => row.technician));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = Array.from(new Set([...staffNames.filter((name) => name && name !== "Walk-in"), ...technicians, "Unassigned"]));
  const subtotal = rows.reduce((sum, row) => sum + row.subtotal, 0);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const tipAmount = tip.trim() === "" ? 0 : Number(tip);
    if (paid && (!Number.isFinite(tipAmount) || tipAmount < 0)) return setError("Enter a tip of $0.00 or more.");
    if (paid && rows.length === 0) return setError("Add services to this bill before marking it paid.");
    setSaving(true);
    try {
      const response = await fetch("/api/admin/payments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: target.bookingId, status: paid ? "paid" : "unpaid", paymentMethod: method, tipAmount, squareOrderId: orderId.trim(), appointmentAt: target.startAt, technicians, guests: records.length > 0 ? undefined : guests }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save payment.");
      onSaved(paid);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save payment.");
    } finally {
      setSaving(false);
    }
  }

  return <form className={styles.form} onSubmit={save}>
    <fieldset className={styles.field}><legend>Payment status</legend>
      <div className={styles.segmented}>
        <button type="button" aria-pressed={paid} className={paid ? styles.active : ""} onClick={() => setPaid(true)}>Paid</button>
        <button type="button" aria-pressed={!paid} className={!paid ? styles.active : ""} onClick={() => setPaid(false)}>Not paid</button>
      </div>
    </fieldset>
    {paid ? <>
      <fieldset className={styles.field}><legend>Payment method</legend>
        <div className={styles.segmented}>
          <button type="button" aria-pressed={method === "Card"} className={method === "Card" ? styles.active : ""} onClick={() => setMethod("Card")}>Card / Credit</button>
          <button type="button" aria-pressed={method === "Cash"} className={method === "Cash" ? styles.active : ""} onClick={() => setMethod("Cash")}>Cash</button>
        </div>
      </fieldset>
      <div className={styles.grid}>
        <label className={styles.field}>Tip amount ($)<input type="number" inputMode="decimal" min="0" step="0.01" value={tip} placeholder="0.00" onChange={(event) => setTip(event.target.value)} autoFocus /></label>
        <label className={styles.field}>Square Order ID <small>(optional)</small><input type="text" value={orderId} maxLength={64} pattern="[A-Za-z0-9_\-]*" placeholder="e.g. 7bQx…" onChange={(event) => setOrderId(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      </div>
      {rows.length > 0 && <div className={styles.guests}>
        <span className={styles.label}>Technician per guest · tip split by service amount</span>
        {rows.map((row, index) => <label key={index} className={styles.guestRow}><span>{row.guestName}<small>${row.subtotal.toFixed(2)} services</small></span>
          <select value={technicians[index]} onChange={(event) => setTechnicians((current) => current.map((name, position) => position === index ? event.target.value : name))}>{options.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        </label>)}
      </div>}
      <p className={styles.note}>{records.length > 0 ? "Updates the saved checkout in Neon." : `Creates the checkout in Neon from this bill ($${subtotal.toFixed(2)} pre-tax services).`} Linking a Square order keeps it matched on future syncs.</p>
    </> : <p className={styles.note}>{records.length > 0 ? "Removes the saved checkout for this bill from Neon and reports." : "This bill has no saved payment."}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <footer className={styles.footer}>
      <button type="button" className="admin-secondary-button" onClick={onClose} disabled={saving}>Cancel</button>
      <button type="submit" className="admin-primary-button" disabled={saving || (!paid && records.length === 0)}>{saving ? "Saving…" : paid ? "Save payment" : "Mark not paid"}</button>
    </footer>
  </form>;
}
