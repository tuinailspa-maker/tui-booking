import { NextResponse } from "next/server";
import {
  CANCEL_CALLBACK_PREFIX,
  LATE_AFTER_MINUTES,
  bookingServices,
  bookingTechnicians,
  checkedInOrNotified,
  claimLateNotification,
  customerName,
  lateBookingCandidates,
  lateSmsBody,
  releaseLateNotification,
  sendSms,
  squareCustomer,
  telegram,
  torontoTime,
} from "@/data/lateCheckin";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerChatId = process.env.OWNER_CHAT_ID;

  try {
    const candidates = await lateBookingCandidates();
    const handled = await checkedInOrNotified(candidates.map((booking) => booking.id));
    const results: Array<{ bookingId: string; sms: boolean; telegram: boolean; error?: string }> = [];

    for (const booking of candidates) {
      if (handled.has(booking.id)) continue;
      if (!(await claimLateNotification(booking.id))) continue;

      const outcome = { bookingId: booking.id, sms: false, telegram: false, error: undefined as string | undefined };
      try {
        const customer = await squareCustomer(booking.customer_id!);
        const name = customerName(customer);
        const phone = customer?.phone_number ?? "";
        const time = torontoTime(booking.start_at!);

        if (phone) {
          try {
            await sendSms(phone, lateSmsBody(name, time));
            outcome.sms = true;
          } catch (error) {
            outcome.error = error instanceof Error ? error.message : "SMS failed.";
          }
        }

        if (ownerChatId) {
          const technicians = bookingTechnicians(booking);
          const text = [
            `Khách trễ hẹn ${LATE_AFTER_MINUTES}+ phút / Late guest`,
            "",
            `Tên / Name: ${name}`,
            `SĐT / Phone: ${phone || "—"}`,
            `Giờ hẹn / Time: ${time}`,
            `Dịch vụ / Services: ${bookingServices(booking)}`,
            ...(technicians ? [`Thợ / Tech: ${technicians}`] : []),
            `SMS: ${outcome.sms ? "đã gửi / sent" : "chưa gửi / not sent"}`,
          ].join("\n");
          await telegram("sendMessage", {
            chat_id: ownerChatId,
            text,
            reply_markup: { inline_keyboard: [[{ text: "❌ Hủy lịch trên Square", callback_data: `${CANCEL_CALLBACK_PREFIX}${booking.id}` }]] },
          });
          outcome.telegram = true;
        }
      } catch (error) {
        outcome.error = error instanceof Error ? error.message : "Notification failed.";
      }

      // Nothing reached anyone: release the claim so the next run can retry.
      if (!outcome.sms && !outcome.telegram) await releaseLateNotification(booking.id);
      results.push(outcome);
    }

    return NextResponse.json({ checked: candidates.length, notified: results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Late check failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Late check failed." }, { status: 500 });
  }
}
