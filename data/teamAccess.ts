import { createHash, randomBytes, scryptSync } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getAdminSession, safeEqual, validateAdminPin, type AdminRole, type AdminSession } from "@/data/adminAuth";
import { REPORT_USER_ID, adminTeamAccess, reportsDb } from "@/data/reports-db";

export const OWNER_SESSION_NAME = "Owner";
export type TeamMemberSummary = { name: string; role: AdminRole; updatedAt: string };

function hashPin(pin: string, salt: string) {
  return scryptSync(pin, salt, 32).toString("hex");
}

function memberId(name: string) {
  return createHash("sha256").update(`${REPORT_USER_ID}:${name.toLowerCase()}`).digest("hex");
}

export function isValidPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

export async function resolveTeamPin(pin: unknown): Promise<AdminSession | null> {
  if (!isValidPin(pin)) return null;
  if (validateAdminPin(pin)) return { role: "owner", name: OWNER_SESSION_NAME };
  const members = await reportsDb.select().from(adminTeamAccess).where(eq(adminTeamAccess.userId, REPORT_USER_ID));
  const match = members.find((member) => safeEqual(hashPin(pin, member.pinSalt), member.pinHash));
  return match ? { role: match.role, name: match.name } : null;
}

export async function listTeamMembers(): Promise<TeamMemberSummary[]> {
  const members = await reportsDb.select({ name: adminTeamAccess.name, role: adminTeamAccess.role, updatedAt: adminTeamAccess.updatedAt })
    .from(adminTeamAccess).where(eq(adminTeamAccess.userId, REPORT_USER_ID)).orderBy(asc(adminTeamAccess.name));
  return members.map((member) => ({ name: member.name, role: member.role, updatedAt: member.updatedAt.toISOString() }));
}

export async function pinInUse(pin: string, exceptName: string) {
  if (validateAdminPin(pin)) return true;
  const members = await reportsDb.select().from(adminTeamAccess).where(eq(adminTeamAccess.userId, REPORT_USER_ID));
  return members.some((member) => member.name.toLowerCase() !== exceptName.toLowerCase() && safeEqual(hashPin(pin, member.pinSalt), member.pinHash));
}

export async function saveTeamMember(name: string, role: AdminRole, pin: string) {
  const pinSalt = randomBytes(16).toString("hex");
  const values = { id: memberId(name), userId: REPORT_USER_ID, name, role, pinSalt, pinHash: hashPin(pin, pinSalt), updatedAt: new Date() };
  await reportsDb.insert(adminTeamAccess).values(values).onConflictDoUpdate({
    target: [adminTeamAccess.userId, adminTeamAccess.name],
    set: { role: values.role, pinSalt: values.pinSalt, pinHash: values.pinHash, updatedAt: values.updatedAt },
  });
}

// Session cookies are stateless, so re-check the team record to revoke sessions when a code is removed, re-roled, or changed.
export async function verifyAdminSession(request: Request): Promise<AdminSession | null> {
  const session = getAdminSession(request);
  if (!session) return null;
  if (session.role === "owner" && session.name === OWNER_SESSION_NAME) return session;
  const [member] = await reportsDb.select({ role: adminTeamAccess.role, updatedAt: adminTeamAccess.updatedAt }).from(adminTeamAccess)
    .where(and(eq(adminTeamAccess.userId, REPORT_USER_ID), eq(adminTeamAccess.name, session.name))).limit(1);
  if (!member || member.role !== session.role) return null;
  if (session.issuedAt !== undefined && member.updatedAt.getTime() > session.issuedAt + 1000) return null;
  return session;
}

export async function isVerifiedAdmin(request: Request) {
  return (await verifyAdminSession(request)) !== null;
}

export async function isVerifiedOwner(request: Request) {
  return (await verifyAdminSession(request))?.role === "owner";
}

export async function removeTeamMember(name: string) {
  await reportsDb.delete(adminTeamAccess).where(and(eq(adminTeamAccess.userId, REPORT_USER_ID), eq(adminTeamAccess.name, name)));
}
