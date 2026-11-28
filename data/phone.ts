export type PhoneCountry = { code: string; flag: string; en: string; fr: string };

/** Common calling codes shown first in the kiosk dropdown; anything else is typed in via "Other (+)". */
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "1", flag: "🇨🇦/🇺🇸", en: "Canada / US", fr: "Canada / É.-U." },
  { code: "33", flag: "🇫🇷", en: "France", fr: "France" },
  { code: "44", flag: "🇬🇧", en: "United Kingdom", fr: "Royaume-Uni" },
  { code: "61", flag: "🇦🇺", en: "Australia", fr: "Australie" },
  { code: "81", flag: "🇯🇵", en: "Japan", fr: "Japon" },
  { code: "82", flag: "🇰🇷", en: "South Korea", fr: "Corée du Sud" },
  { code: "84", flag: "🇻🇳", en: "Vietnam", fr: "Viêt Nam" },
  { code: "86", flag: "🇨🇳", en: "China", fr: "Chine" },
  { code: "49", flag: "🇩🇪", en: "Germany", fr: "Allemagne" },
  { code: "39", flag: "🇮🇹", en: "Italy", fr: "Italie" },
  { code: "34", flag: "🇪🇸", en: "Spain", fr: "Espagne" },
  { code: "52", flag: "🇲🇽", en: "Mexico", fr: "Mexique" },
];

const MIN_NATIONAL_DIGITS = 7;
const MAX_E164_DIGITS = 15;

/** Longest known calling code (3, 2 then 1 digit) that an international number starts with. */
export function matchKnownCode(digits: string): string | null {
  for (const length of [3, 2, 1]) {
    const candidate = digits.slice(0, length);
    if (candidate.length === length && PHONE_COUNTRIES.some((country) => country.code === candidate)) return candidate;
  }
  return null;
}

/** Splits a number typed with a leading "+" into a known calling code and the rest, e.g. "+33 6 12" -> 33 / "612". */
export function splitInternational(input: string): { code: string; national: string } | null {
  if (!input.trim().startsWith("+")) return null;
  const digits = input.replace(/\D/g, "");
  const code = matchKnownCode(digits);
  return code ? { code, national: digits.slice(code.length) } : null;
}

/**
 * Strict E.164 (`+[countryCode][nationalNumber]`, at most 15 digits) from a calling code and what the guest typed.
 * North America needs exactly 10 digits; elsewhere 7 or more. A national trunk "0" is dropped
 * (+33 06 12 34 56 78 -> +33612345678) except for Italy, where the leading 0 is part of landline numbers.
 */
export function buildE164(countryCode: unknown, input: unknown): string | null {
  if (typeof input !== "string") return null;
  let code = typeof countryCode === "string" || typeof countryCode === "number" ? String(countryCode).replace(/\D/g, "").replace(/^0+/, "") : "1";
  let national = input.replace(/\D/g, "");

  if (input.trim().startsWith("+")) {
    const known = matchKnownCode(national);
    if (known) code = known;
    else if (!code || !national.startsWith(code)) return null;
    national = national.slice(code.length);
  }

  if (code.length < 1 || code.length > 3) return null;
  if (code === "1") {
    if (national.length === 11 && national.startsWith("1")) national = national.slice(1);
    return national.length === 10 ? `+1${national}` : null;
  }
  if (code !== "39") national = national.replace(/^0/, "");
  if (national.length < MIN_NATIONAL_DIGITS || code.length + national.length > MAX_E164_DIGITS) return null;
  return `+${code}${national}`;
}

export type ContactPhone = { e164: string | null; national: string };

/**
 * Comparable form of any phone string: "+33 6 12 34 56 78", "(514) 555-0123", "00 33 …", "15145550123" or an E.164 value stored in Square.
 * `e164` is set when the country is known (a leading "+"/"00", or a 10-digit / 11-digit "1…" North American number);
 * `national` is the number without its country calling code.
 */
export function parseContactPhone(value: unknown): ContactPhone {
  if (typeof value !== "string") return { e164: null, national: "" };
  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    if (!trimmed.startsWith("+")) digits = digits.slice(2);
    const code = matchKnownCode(digits);
    if (code) {
      let national = digits.slice(code.length);
      if (code !== "1" && code !== "39") national = national.replace(/^0/, "");
      return { e164: `+${code}${national}`, national };
    }
    return { e164: digits.length >= 7 && digits.length <= MAX_E164_DIGITS ? `+${digits}` : null, national: digits };
  }
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  // NANP area codes never start with 0 or 1, so "06 12 34 56 78" is a national number of another country, not a +1 number.
  if (digits.length === 10 && /^[2-9]/.test(digits)) return { e164: `+1${digits}`, national: digits };
  return { e164: null, national: digits.replace(/^0+/, "") };
}

/** True when the input has enough digits to look an appointment up (international or local). */
export function isUsablePhone(value: unknown): boolean {
  const { e164, national } = parseContactPhone(value);
  return e164 ? e164.length - 1 >= MIN_NATIONAL_DIGITS : national.length >= MIN_NATIONAL_DIGITS && national.length <= MAX_E164_DIGITS;
}

/** Exact E.164 match first; otherwise the national digits (last 10, at least 7) must agree and the known calling codes must not conflict. */
export function phonesMatch(left: unknown, right: unknown): boolean {
  const a = parseContactPhone(left);
  const b = parseContactPhone(right);
  if (!a.national || !b.national) return false;
  if (a.e164 && b.e164 && a.e164 === b.e164) return true;
  if (a.e164 && b.e164) {
    const codeA = matchKnownCode(a.e164.slice(1));
    const codeB = matchKnownCode(b.e164.slice(1));
    if (codeA && codeB && codeA !== codeB) return false;
  }
  const tailA = a.national.slice(-10);
  const tailB = b.national.slice(-10);
  return tailA.length >= MIN_NATIONAL_DIGITS && tailB.length >= MIN_NATIONAL_DIGITS && (tailA.endsWith(tailB) || tailB.endsWith(tailA));
}
