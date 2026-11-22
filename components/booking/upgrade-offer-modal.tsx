"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "./copy";

const SEEN_KEY = "tui-upgrade-offer-seen";

const offerCopy = {
  en: {
    badge: "✨ SERVICE UPGRADE & FREE GIFT",
    title: "Upgrade Your Mani or Pedi",
    subtitle: "Treat dry, cracked skin and take home a complimentary herbal repair cream.",
    feet: {
      title: "🦶 For Pedicure Services",
      instruction: "Select Add-On: Extra Callus Remover (Heels)",
      details: "Deep callus smoothing for rough, cracked heels & ankles + light massage.",
      gift: "🎁 FREE 20g Herbal Cracked-Skin Cream (choice of Astragalus, Olive Oil, or Aloe Vera)",
    },
    hands: {
      title: "💅 For Manicure Services",
      instruction: "Select Add-On: Exfoliating & Dry-Skin Care",
      details: "Gentle exfoliation & relaxing massage for dry hands & fingertips.",
      gift: "🎁 FREE 20g Herbal Cracked-Skin Cream (choice of Astragalus, Olive Oil, or Aloe Vera)",
    },
    retailTitle: "🛍️ Available In-Salon for Home Care",
    retailText:
      "Japanese 10% Urea Cream (100g) — Intensive moisture & repair for severely dry heels, ankles & fingertips (with Hyaluronic Acid & Squalane). Ask at reception to purchase!",
    primary: "Book & Select Add-On",
    secondary: "Maybe later",
    close: "Close offer",
    pill: "✨ Free Cream Offer",
    languageLabel: "Language",
  },
  fr: {
    badge: "✨ OPTION SOIN & CADEAU OFFERT",
    title: "Améliorez votre Manucure ou Pédicure",
    subtitle: "Réparez la peau sèche et crevassée et repartez avec une crème réparatrice offerte.",
    feet: {
      title: "🦶 Pour les Pédicures",
      instruction: "Choisissez l’option : Soin Anti-Callosités Intensif (Talons)",
      details: "Traitement intensif des talons et chevilles secs et crevassés + massage léger.",
      gift: "🎁 1 Crème Réparatrice aux Herbes (20 g) OFFERTE (Astragale, Huile d'Olive ou Aloe Vera)",
    },
    hands: {
      title: "💅 Pour les Manucures",
      instruction: "Choisissez l’option : Gommage Exfoliant & Soin Peau Sèche",
      details: "Gommage doux et massage relaxant pour mains et doigts secs.",
      gift: "🎁 1 Crème Réparatrice aux Herbes (20 g) OFFERTE (Astragale, Huile d'Olive ou Aloe Vera)",
    },
    retailTitle: "🛍️ Disponible en Salon pour Soin à Domicile",
    retailText:
      "Crème Japonaise à 10 % d’Urée (100 g) — Hydratation et réparation intenses pour talons, chevilles et doigts très secs (avec acide hyaluronique et squalane). Demandez à l’accueil pour acheter !",
    primary: "Réserver avec Option",
    secondary: "Plus tard",
    close: "Fermer l’offre",
    pill: "✨ Crème Offerte",
    languageLabel: "Langue",
  },
} as const;

type UpgradeCardProps = {
  card: { title: string; instruction: string; details: string; gift: string };
  tone: "feet" | "hands";
};

function UpgradeCard({ card, tone }: UpgradeCardProps) {
  const styles =
    tone === "feet"
      ? { accent: "text-[#558B77]", border: "border-[#558B77]/25", gift: "bg-[#F7FBF9] text-[#3F6D5C]" }
      : { accent: "text-[#C87A8D]", border: "border-[#C87A8D]/25", gift: "bg-[#FFF6F7] text-[#A35C6E]" };

  return (
    <article className={`flex flex-col gap-2 rounded-2xl border ${styles.border} bg-white p-4 shadow-sm`}>
      <h3 className={`text-base font-semibold ${styles.accent}`}>{card.title}</h3>
      <p className="text-sm font-semibold leading-snug text-[#2B2622]">{card.instruction}</p>
      <p className="text-sm leading-relaxed text-[#5E5650]">{card.details}</p>
      <p className={`mt-1 rounded-xl px-3 py-2 text-sm font-medium leading-snug ${styles.gift}`}>{card.gift}</p>
    </article>
  );
}

type UpgradeOfferModalProps = {
  language: Language;
  onLanguageChange: (language: Language) => void;
  onBook: () => void;
};

export function UpgradeOfferModal({ language, onLanguageChange, onBook }: UpgradeOfferModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const t = offerCopy[language];

  useEffect(() => {
    if (sessionStorage.getItem(SEEN_KEY)) return;
    sessionStorage.setItem(SEEN_KEY, "1");
    setIsOpen(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const handleBook = () => {
    setIsOpen(false);
    onBook();
  };

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-4 z-40 rounded-full border border-[#B58938]/40 bg-[#FFFDF7] px-4 py-2 text-sm font-semibold text-[#8A6623]! shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B58938] md:bottom-6"
        >
          {t.pill}
        </button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-[#2B2622]/40 backdrop-blur-sm" aria-hidden="true" onClick={() => setIsOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-offer-title"
            aria-describedby="upgrade-offer-subtitle"
            lang={language}
            className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-3xl bg-[#FAF7F5] p-5 shadow-2xl sm:rounded-3xl sm:p-8"
          >
            <div className="flex items-center justify-between gap-3">
              <div role="group" aria-label={t.languageLabel} className="flex items-center rounded-full border border-[#2B2622]/10 bg-white p-0.5 text-xs font-semibold">
                {(["en", "fr"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={language === code}
                    onClick={() => onLanguageChange(code)}
                    className={`rounded-full px-2.5 py-1 transition ${language === code ? "bg-[#2B2622] text-white!" : "text-[#5E5650]! hover:text-[#2B2622]!"}`}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label={t.close}
                className="flex size-9 items-center justify-center rounded-full bg-white text-xl leading-none text-[#5E5650]! shadow-sm transition hover:text-[#2B2622]! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B58938]"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <header className="mt-5 flex flex-col items-center gap-3 text-center">
              <span className="rounded-full border border-[#B58938]/30 bg-[#FFFDF7] px-3 py-1 text-xs font-semibold tracking-widest text-[#8A6623]">{t.badge}</span>
              <h2 id="upgrade-offer-title" className="text-balance font-serif text-2xl leading-tight text-[#2B2622] sm:text-3xl">{t.title}</h2>
              <p id="upgrade-offer-subtitle" className="max-w-md text-pretty text-sm leading-relaxed text-[#5E5650] sm:text-base">{t.subtitle}</p>
            </header>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <UpgradeCard card={t.feet} tone="feet" />
              <UpgradeCard card={t.hands} tone="hands" />
            </div>

            <aside className="mt-4 flex flex-col gap-1.5 rounded-2xl border border-[#B58938]/25 bg-[#FFFDF7] p-4">
              <h3 className="text-sm font-semibold text-[#8A6623]">{t.retailTitle}</h3>
              <p className="text-sm leading-relaxed text-[#5E5650]">{t.retailText}</p>
            </aside>

            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={handleBook}
                className="w-full rounded-full bg-[#2B2622] px-6 py-3 text-sm font-semibold tracking-wide text-white! transition hover:bg-[#B58938] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B58938] sm:w-auto sm:min-w-64"
              >
                {t.primary}
              </button>
              <button type="button" onClick={() => setIsOpen(false)} className="text-sm text-[#5E5650]! underline-offset-4 hover:text-[#2B2622]! hover:underline">
                {t.secondary}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
