import type { Metadata, Viewport } from "next";
import { Kiosk } from "@/components/checkin/kiosk";
import { ServiceWorkerRegistration } from "@/components/checkin/service-worker-registration";
import "./kiosk.css";

export const metadata: Metadata = {
  title: "Self Check-in | Tui Nail Spa Montréal",
  description: "Check in for your Tui Nail Spa appointment or join today’s walk-in queue.",
  robots: { index: false, follow: false },
  applicationName: "Tui Check-in",
  manifest: "/checkin/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Tui Check-in", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#faf5f0",
};

export default function CheckInPage() {
  return (
    <>
      <Kiosk />
      <ServiceWorkerRegistration />
    </>
  );
}
