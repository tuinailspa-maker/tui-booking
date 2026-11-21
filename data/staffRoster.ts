import { SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import type { KnownTechnician } from "@/data/staffSchedule";

export type StaffKind = "real" | "virtual";
export type StaffMember = { name: string; teamMemberId: string; kind: StaffKind };

export const REAL_STAFF_NAMES: readonly string[] = ["Jenny", "Melika", "Nana"];
export const VIRTUAL_STAFF_NAMES: readonly string[] = ["Option 1", "Option 2"];
/** Virtual columns customers never pick directly; still used as overflow. */
export const CUSTOMER_HIDDEN_STAFF: readonly string[] = ["Option 2"];

export function staffKind(name: string): StaffKind {
  return VIRTUAL_STAFF_NAMES.includes(name) ? "virtual" : "real";
}

/** Real staff first (known order, then others alphabetically), virtual option columns last. */
export function sortStaff<T extends { name: string; kind: StaffKind }>(members: T[]): T[] {
  const rank = (member: T) => {
    if (member.kind === "virtual") return 1000 + VIRTUAL_STAFF_NAMES.indexOf(member.name);
    const known = REAL_STAFF_NAMES.indexOf(member.name);
    return known >= 0 ? known : 100;
  };
  return [...members].sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
}

export const DEFAULT_STAFF_ROSTER: StaffMember[] = sortStaff(
  (Object.entries(SQUARE_TEAM_MEMBER_IDS) as [KnownTechnician, string][]).map(([name, teamMemberId]) => ({ name, teamMemberId, kind: staffKind(name) })),
);
