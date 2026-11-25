import type { MetadataRoute } from "next";

type ManifestIcon = NonNullable<MetadataRoute.Manifest["icons"]>[number];

// The Web App Manifest spec allows space-separated purposes ("any maskable"),
// but Next.js only types single values, so widen the type for this one field.
const ANY_MASKABLE = "any maskable" as unknown as ManifestIcon["purpose"];

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "tuinailspa-checkin",
    name: "Tui Nail Spa Check-in",
    short_name: "Tui Check-in",
    description: "Self check-in kiosk for Tui Nail Spa Montréal: check in for an appointment or join today’s walk-in queue.",
    start_url: "/checkin",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "en-CA",
    dir: "ltr",
    categories: ["business", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: ANY_MASKABLE },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: ANY_MASKABLE },
    ],
  };
}
