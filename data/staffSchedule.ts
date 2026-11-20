export const BUSINESS_TIME_ZONE = "America/Toronto";
export const BUSINESS_OPEN_TIME = "08:00";
const BUSINESS_OPEN_MINUTES = 8 * 60;
const BUSINESS_CLOSE_TIMES = ["19:00", "19:00", "19:00", "19:00", "20:00", "20:00", "19:00"] as const;

export type PublicTechnician = "Jenny" | "Melika" | "Nana" | "Option 1";
type InternalTechnician = "Option 2";
export type Technician = PublicTechnician | InternalTechnician;

export type ShiftBlock = {
  start: string;
  end: string;
  primaryTechnicians: PublicTechnician[];
  overflowTechnician?: InternalTechnician;
  maxGuests: 1 | 2 | 3;
};

export const staffSchedule: Record<number, ShiftBlock[]> = {
  0: [{ start: BUSINESS_OPEN_TIME, end: BUSINESS_CLOSE_TIMES[0], primaryTechnicians: ["Jenny"], maxGuests: 1 }],
  1: [{ start: BUSINESS_OPEN_TIME, end: BUSINESS_CLOSE_TIMES[1], primaryTechnicians: ["Jenny"], maxGuests: 1 }],
  2: [{ start: BUSINESS_OPEN_TIME, end: BUSINESS_CLOSE_TIMES[2], primaryTechnicians: ["Jenny", "Melika"], overflowTechnician: "Option 2", maxGuests: 3 }],
  3: [{ start: BUSINESS_OPEN_TIME, end: BUSINESS_CLOSE_TIMES[3], primaryTechnicians: ["Jenny", "Nana"], overflowTechnician: "Option 2", maxGuests: 3 }],
  4: [{ start: BUSINESS_OPEN_TIME, end: BUSINESS_CLOSE_TIMES[4], primaryTechnicians: ["Jenny", "Melika", "Nana"], overflowTechnician: "Option 2", maxGuests: 3 }],
  5: [{ start: BUSINESS_OPEN_TIME, end: BUSINESS_CLOSE_TIMES[5], primaryTechnicians: ["Jenny", "Melika", "Nana"], overflowTechnician: "Option 2", maxGuests: 3 }],
  6: [{ start: BUSINESS_OPEN_TIME, end: BUSINESS_CLOSE_TIMES[6], primaryTechnicians: ["Jenny", "Option 1"], overflowTechnician: "Option 2", maxGuests: 3 }],
};

export function getClosingTimeForDate(date: string): string {
  if (!date) return BUSINESS_CLOSE_TIMES[0];
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  return staffSchedule[dayOfWeek]?.map((shift) => shift.end).sort().at(-1) ?? "19:00";
}

export type DateOption = {
  iso: string;
  dayOfWeek: number;
  dayNumber: number;
  monthShort: string;
  weekdayShort: string;
};

export type TimeSlot = {
  time: string;
  shift: ShiftBlock;
};

function datePartsInToronto(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

export function getTorontoToday(now = new Date()): string {
  const { year, month, day } = datePartsInToronto(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getUpcomingDates(language: "en" | "fr", count = 28, now = new Date()): DateOption[] {
  const today = datePartsInToronto(now);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + index, 12));
    const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    const dayOfWeek = date.getUTCDay();
    const formatted = new Intl.DateTimeFormat(language === "en" ? "en-CA" : "fr-CA", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
    }).formatToParts(date);
    const values = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
    return {
      iso,
      dayOfWeek,
      dayNumber: date.getUTCDate(),
      monthShort: values.month,
      weekdayShort: values.weekday,
    };
  });
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function getTorontoMinutesOfDay(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function isWithinBusinessHours(value: Date | string, durationMinutes = 0): boolean {
  const date = value instanceof Date ? value : new Date(value);
  const startMinutes = getTorontoMinutesOfDay(date);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(durationMinutes) || durationMinutes < 0) return false;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, weekday: "short" }).format(date);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const closingMinutes = toMinutes(BUSINESS_CLOSE_TIMES[weekdayIndex] ?? "00:00");
  return startMinutes >= BUSINESS_OPEN_MINUTES && startMinutes < closingMinutes &&
    startMinutes + durationMinutes <= closingMinutes;
}

export function getSlotsForDate(date: string, partySize: number): TimeSlot[] {
  if (!date) return [];
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const slots = staffSchedule[dayOfWeek]
    .filter((shift) => shift.maxGuests >= partySize)
    .flatMap((shift) => {
      const times: TimeSlot[] = [];
      for (let start = toMinutes(shift.start); start + 30 <= toMinutes(shift.end); start += 30) {
        times.push({ time: fromMinutes(start), shift });
      }
      return times;
    });

  if (date !== getTorontoToday()) return slots;
  const now = new Date();
  const currentTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return slots.filter((slot) => slot.time > currentTime);
}

export function isOnlineOnlyTime(time: string): boolean {
  const minutes = toMinutes(time);
  return minutes >= BUSINESS_OPEN_MINUTES && minutes < 10 * 60;
}

export function assignTechnicians(shift: ShiftBlock, partySize: number, preferences: (PublicTechnician | "")[]): Technician[] {
  const assignments: (Technician | undefined)[] = Array(partySize).fill(undefined);
  const usedPrimary = new Set<PublicTechnician>();

  preferences.slice(0, partySize).forEach((preference, index) => {
    if (preference && shift.primaryTechnicians.includes(preference) && !usedPrimary.has(preference)) {
      assignments[index] = preference;
      usedPrimary.add(preference);
    }
  });

  for (let guestIndex = 0; guestIndex < partySize; guestIndex += 1) {
    if (assignments[guestIndex]) continue;
    const nextPrimary = shift.primaryTechnicians.find((technician) => !usedPrimary.has(technician));
    if (nextPrimary) {
      assignments[guestIndex] = nextPrimary;
      usedPrimary.add(nextPrimary);
    } else if (shift.overflowTechnician) {
      assignments[guestIndex] = shift.overflowTechnician;
    }
  }

  return assignments.filter((technician): technician is Technician => Boolean(technician));
}

export function formatSlotTime(time: string, language: "en" | "fr"): string {
  const [rawHours, minutes] = time.split(":").map(Number);
  if (language === "fr") return `${rawHours} h ${String(minutes).padStart(2, "0")}`;
  const meridiem = rawHours >= 12 ? "PM" : "AM";
  const hours = rawHours % 12 || 12;
  return `${hours}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}
