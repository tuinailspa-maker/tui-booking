"use client";

import { useRef } from "react";

type PinLockScreenProps = {
  pin: string;
  error: string;
  busy: boolean;
  onPinChange: (pin: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function PinLockScreen({ pin, error, busy, onPinChange, onSubmit }: PinLockScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function appendDigit(digit: string) {
    if (busy || pin.length >= 4) return;
    onPinChange(`${pin}${digit}`);
  }

  function removeDigit() {
    if (!busy) onPinChange(pin.slice(0, -1));
  }

  return (
    <main className="admin-access-page">
      <form className="admin-pin-card" onSubmit={onSubmit}>
        <span className="admin-lock-mark" aria-hidden="true">T</span>
        <p className="admin-eyebrow">TUI NAIL SPA · STAFF</p>
        <h1>Enter passcode</h1>
        <p className="admin-access-copy">Unlock your appointment dashboard.</p>
        <input ref={inputRef} autoFocus className="admin-pin-input" aria-label="Four-digit staff PIN" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(event) => onPinChange(event.target.value.replace(/\D/g, "").slice(0, 4))} />
        <div className="admin-pin-dots" aria-label={`${pin.length} of 4 PIN digits entered`}>
          {Array.from({ length: 4 }, (_, index) => <span key={index} className={index < pin.length ? "is-filled" : ""} />)}
        </div>
        <div className="admin-pin-pad" aria-label="PIN keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"].map((digit, index) => digit === "" ? <span key={`blank-${index}`} aria-hidden="true" /> : <button key={digit} type="button" aria-label={digit === "delete" ? "Delete last digit" : `Enter ${digit}`} onClick={() => digit === "delete" ? removeDigit() : appendDigit(digit)} disabled={busy || (digit !== "delete" && pin.length >= 4)}>{digit === "delete" ? <span aria-hidden="true">⌫</span> : digit}</button>)}
        </div>
        {error && <p className="admin-form-error" role="alert">{error}</p>}
        <button className="admin-primary-button admin-unlock-button" type="submit" disabled={pin.length !== 4 || busy}>{busy ? "Unlocking…" : "Unlock dashboard"}</button>
        <p className="admin-access-footnote">Your staff session stays private to this tab.</p>
      </form>
    </main>
  );
}
