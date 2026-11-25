import { adminManifest, manifestResponse } from "@/lib/pwa-manifest";

export function GET() {
  return manifestResponse(adminManifest);
}
