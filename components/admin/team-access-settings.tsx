"use client";

import { useState } from "react";
import useSWR from "swr";

type TeamMember = { name: string; role: "owner" | "staff"; updatedAt: string };
type TeamPayload = { members: TeamMember[]; technicians: string[] };

async function fetcher(url: string): Promise<TeamPayload> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Team access could not be loaded.");
  return body as TeamPayload;
}

export function TeamAccessSettings() {
  const team = useSWR("/api/admin/team", fetcher, { revalidateOnFocus: false });
  const [name, setName] = useState("");
  const [role, setRole] = useState<"staff" | "owner">("staff");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const technicians = team.data?.technicians ?? [];
  const members = team.data?.members ?? [];

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    if (!name.trim()) { setError("Choose a team member."); return; }
    if (!/^\d{4}$/.test(pin)) { setError("Access codes must be exactly 4 digits."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/team", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), role, pin }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save the access code.");
      await team.mutate({ members: body.members, technicians }, { revalidate: false });
      setNotice(`Access code saved for ${name.trim()}.`);
      setPin("");
      setName("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the access code.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberName: string) {
    if (busy || !window.confirm(`Remove the access code for ${memberName}?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/team?name=${encodeURIComponent(memberName)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not remove the access code.");
      await team.mutate({ members: body.members, technicians }, { revalidate: false });
      setNotice(`Access code removed for ${memberName}.`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the access code.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="team-access" aria-labelledby="team-access-title">
    <div>
      <h3 id="team-access-title">Team access codes</h3>
      <p>Each technician unlocks the dashboard with their own 4-digit code and only sees their own column and end-of-day total. Codes are stored hashed and are never shown again after saving.</p>
    </div>
    {team.error && <div className="admin-alert" role="alert"><strong>Team access unavailable.</strong><span>{team.error.message}</span></div>}
    <ul className="team-access-list">
      <li><span><strong>Owner</strong><small>Master code (ADMIN_PIN)</small></span><em>Full access</em></li>
      {members.map((member) => <li key={member.name}>
        <span><strong>{member.name}</strong><small>Updated {new Date(member.updatedAt).toLocaleDateString("en-CA")}</small></span>
        <em>{member.role === "owner" ? "Full access" : "Technician"}</em>
        <button type="button" className="admin-secondary-button" onClick={() => void remove(member.name)} disabled={busy}>Remove</button>
      </li>)}
    </ul>
    <form className="team-access-form" onSubmit={save}>
      <label>Role<select value={role} onChange={(event) => { setRole(event.target.value as "staff" | "owner"); setName(""); }}>
        <option value="staff">Technician</option>
        <option value="owner">Admin / Owner</option>
      </select></label>
      <label>Team member{role === "staff"
        ? <select value={name} onChange={(event) => setName(event.target.value)}><option value="">Choose technician</option>{technicians.map((technician) => <option key={technician} value={technician}>{technician}</option>)}</select>
        : <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Manager name" maxLength={40} />}</label>
      <label>4-digit code<input type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" /></label>
      <button type="submit" className="admin-primary-button" disabled={busy}>{busy ? "Saving…" : members.some((member) => member.name === name.trim()) ? "Update code" : "Save code"}</button>
    </form>
    {error && <p className="team-access-error" role="alert">{error}</p>}
    {notice && <p className="reports-notice" role="status">{notice}</p>}
  </section>;
}
