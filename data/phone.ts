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
