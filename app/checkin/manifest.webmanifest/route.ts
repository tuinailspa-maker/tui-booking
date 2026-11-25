import { checkinManifest, manifestResponse } from "@/lib/pwa-manifest";

export function GET() {
  return manifestResponse(checkinManifest);
}
