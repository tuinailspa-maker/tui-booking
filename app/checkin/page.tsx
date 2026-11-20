import type { Metadata } from "next";
import { Kiosk } from "@/components/checkin/kiosk";
import "./kiosk.css";

export const metadata: Metadata = {
  title: "Self Check-in | Tui Nail Spa Montréal",
  description: "Check in for your Tui Nail Spa appointment or join today’s walk-in queue.",
  robots: { index: false, follow: false },
};

export default function CheckInPage() {
  return <Kiosk />;
}
