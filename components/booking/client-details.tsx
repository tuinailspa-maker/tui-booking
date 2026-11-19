import type { FormEvent } from "react";
import type { BookingCopy } from "./copy";

export const phoneCountryCodes = ["+1", "+33", "+44", "+84", "+86", "+39", "+34", "+49", "+52", "+506"] as const;

export type ClientDetailsValue = {
  firstName: string;
  lastName: string;
  countryCode: string;
  phone: string;
  email: string;
  notes: string;
};

type ClientDetailsProps = {
  copy: BookingCopy;
  value: ClientDetailsValue;
  onChange: (value: ClientDetailsValue) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ClientDetails({ copy, value, onChange, onSubmit }: ClientDetailsProps) {
  function update(field: keyof ClientDetailsValue, nextValue: string) {
    onChange({ ...value, [field]: nextValue });
  }

  return (
    <section className="booking-step" aria-labelledby="step-three-title">
      <div className="step-heading">
        <p className="step-kicker">03 <span /> {copy.stepThree}</p>
        <h1 id="step-three-title">{copy.stepThreeTitle}</h1>
        <p>{copy.stepThreeIntro}</p>
      </div>
      <form className="client-form" id="client-details-form" onSubmit={onSubmit}>
        <label>
          <span>{copy.firstName} <b aria-hidden="true">*</b></span>
          <input required autoComplete="given-name" maxLength={80} value={value.firstName} onChange={(event) => update("firstName", event.target.value)} />
        </label>
        <label>
          <span>{copy.lastName} <b aria-hidden="true">*</b></span>
          <input required autoComplete="family-name" maxLength={80} value={value.lastName} onChange={(event) => update("lastName", event.target.value)} />
        </label>
        <label>
          <span>{copy.phone} <b aria-hidden="true">*</b></span>
          <span className="phone-field">
            <select aria-label={copy.countryCode} value={value.countryCode} onChange={(event) => update("countryCode", event.target.value)}>
              {phoneCountryCodes.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
            <input required type="tel" autoComplete="tel-national" inputMode="tel" maxLength={30} value={value.phone} onChange={(event) => update("phone", event.target.value)} />
          </span>
        </label>
        <label>
          <span>{copy.email} <b aria-hidden="true">*</b></span>
          <input required type="email" autoComplete="email" maxLength={254} value={value.email} onChange={(event) => update("email", event.target.value)} />
        </label>
        <label className="notes-field">
          <span>{copy.notes}</span>
          <textarea maxLength={500} rows={4} placeholder={copy.notesPlaceholder} value={value.notes} onChange={(event) => update("notes", event.target.value)} />
        </label>
      </form>
    </section>
  );
}
