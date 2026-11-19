import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getTorontoToday } from "@/data/staffSchedule";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const metadata: Metadata = {
  title: "Salon Admin | Tui Nail Spa Montréal",
  description: "Private staff dashboard for Tui Nail Spa appointments and checkout.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <Suspense fallback={<main className="admin-access-page"><p className="admin-access-copy">Loading staff dashboard…</p></main>}><AdminDashboardForToday /></Suspense>;
}

async function AdminDashboardForToday() {
  await connection();
  return <AdminDashboard initialDate={getTorontoToday()} />;
}
