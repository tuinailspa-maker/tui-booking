import { SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { CAPACITY_COLUMNS, type KnownTechnician } from "@/data/staffSchedule";

/** Display label only: "virtual" marks the Option columns, which book exactly like staff. */
export type StaffKind = "real" | "virtual";
export type StaffMember = { name: string; teamMemberId: string; kind: StaffKind };

const COLUMN_ORDER: readonly string[] = CAPACITY_COLUMNS;

export function staffKind(name: string): StaffKind {
  return name.startsWith("Option ") ? "virtual" : "real";
}

/** Nana/Melika/Jenny/Option 1/Option 2 in a stable order, then other Square team members alphabetically. */
export function sortStaff<T extends { name: string }>(members: T[]): T[] {
  const rank = (member: T) => {
    const known = COLUMN_ORDER.indexOf(member.name);
    return known >= 0 ? known : 100;
  };
  return [...members].sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
}

export const DEFAULT_STAFF_ROSTER: StaffMember[] = sortStaff(
  (Object.entries(SQUARE_TEAM_MEMBER_IDS) as [KnownTechnician, string][]).map(([name, teamMemberId]) => ({ name, teamMemberId, kind: staffKind(name) })),
);
