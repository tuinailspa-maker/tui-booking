import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getTorontoToday } from "@/data/staffSchedule";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const metadata: Metadata = {
  title: "Salon Admin | Tui Nail Spa Montréal",
  description: "Private staff dashboard for Tui Nail Spa appointments and checkout.",
  robots: { index: false, follow: false },
  applicationName: "Tui Admin",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Tui Admin", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function AdminPage() {
  return <Suspense fallback={<main className="admin-access-page"><p className="admin-access-copy">Loading staff dashboard…</p></main>}><AdminDashboardForToday /></Suspense>;
}

async function AdminDashboardForToday() {
  await connection();
  return <AdminDashboard initialDate={getTorontoToday()} />;
}
