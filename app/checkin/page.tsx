import type { Metadata } from "next";
import { Kiosk } from "@/components/checkin/kiosk";
import "./kiosk.css";

export const metadata: Metadata = {
  title: "Guest Check-In | Tui Nail Spa Montréal",
  description: "Check in for your appointment or join today’s walk-in queue at Tui Nail Spa Montréal.",
};

export default function CheckInPage() {
  return <Kiosk />;
}
