import type { MetadataRoute } from "next";

function appIcons(prefix: "admin" | "checkin"): MetadataRoute.Manifest["icons"] {
  return [
    { src: `/icons/${prefix}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `/icons/${prefix}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `/icons/${prefix}-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
}

// Each installable app gets its own id and scope so installing one never
// reuses the other's start_url (Safari keys Home Screen apps by manifest).
export const checkinManifest: MetadataRoute.Manifest = {
  id: "/checkin",
  name: "Tui Check-In",
  short_name: "Tui Check-In",
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
  icons: appIcons("checkin"),
};

export const adminManifest: MetadataRoute.Manifest = {
  id: "/admin",
  name: "Tui Admin",
  short_name: "Tui Admin",
  description: "Private staff dashboard for Tui Nail Spa appointments and checkout.",
  start_url: "/admin",
  scope: "/admin",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  lang: "en-CA",
  dir: "ltr",
  categories: ["business"],
  icons: appIcons("admin"),
};

export function manifestResponse(manifest: MetadataRoute.Manifest) {
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
