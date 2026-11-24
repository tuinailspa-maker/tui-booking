import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/checkin",
    name: "Tui Nail Spa Check-in",
    short_name: "Tui Check-in",
    description: "Self check-in kiosk for Tui Nail Spa Montréal: check in for an appointment or join today’s walk-in queue.",
    start_url: "/checkin",
    scope: "/checkin",
    display: "standalone",
    orientation: "landscape",
    background_color: "#faf5f0",
    theme_color: "#faf5f0",
    lang: "en-CA",
    dir: "ltr",
    categories: ["business", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
