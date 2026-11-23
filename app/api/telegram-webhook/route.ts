import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { CANCEL_CALLBACK_PREFIX, type SquareBooking, square, telegram } from "@/data/lateCheckin";

type CallbackQuery = {
  id: string;
  data?: string;
  from?: { id?: number };
  message?: { message_id: number; text?: string; chat?: { id?: number } };
};

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const ok = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret && !safeEqual(request.headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerChatId = process.env.OWNER_CHAT_ID;
  const update = await request.json().catch(() => null);
  const callback: CallbackQuery | undefined = update?.callback_query;
  if (!callback?.id || !ownerChatId) return ok();

  const chatId = String(callback.message?.chat?.id ?? "");
  if (chatId !== String(ownerChatId)) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Not allowed." }).catch(() => undefined);
    return ok();
  }

  const bookingId = callback.data?.startsWith(CANCEL_CALLBACK_PREFIX) ? callback.data.slice(CANCEL_CALLBACK_PREFIX.length) : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(bookingId) || !callback.message) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Unknown action." }).catch(() => undefined);
    return ok();
  }

  const originalText = callback.message.text ?? "";
  try {
    const current = await square<{ booking?: SquareBooking }>(`/bookings/${encodeURIComponent(bookingId)}`);
    const booking = current.booking;
    if (!booking || typeof booking.version !== "number") throw new Error("Booking not found on Square.");
    const alreadyCancelled = ["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED"].includes(booking.status ?? "");
    if (!alreadyCancelled) {
      await square(`/bookings/${encodeURIComponent(bookingId)}/cancel`, "POST", {
        idempotency_key: `tui-late-cancel-${bookingId}-${booking.version}`,
        booking_version: booking.version,
      });
    }
    await telegram("editMessageText", {
      chat_id: chatId,
      message_id: callback.message.message_id,
      text: `${originalText}\n\n✅ Đã hủy lịch thành công trên Square`,
    });
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "✅ Đã hủy" }).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cancel failed.";
    console.error("Telegram cancel failed:", message);
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: `Lỗi: ${message}`.slice(0, 200), show_alert: true }).catch(() => undefined);
  }
  return ok();
}
