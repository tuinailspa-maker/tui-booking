"use client";

import { useState, type FormEvent } from "react";

type Language = "en" | "fr";

type BookingFormProps = {
  language: Language;
  services: string[];
};

const labels = {
  en: {
    name: "Your name", contact: "Email or phone", service: "Choose a service", date: "Preferred date", time: "Preferred time", submit: "Prepare booking request", required: "Please complete all required fields.", ready: "Your request is ready to send", caveat: "Nothing has been sent or saved. Copy this request and message the studio to confirm your appointment.", copy: "Copy request", copied: "Copied", summary: "Appointment request", appointment: "Service", preferredDate: "Date", preferredTime: "Time", customer: "Name", contactInfo: "Contact",
  },
  fr: {
    name: "Votre nom", contact: "E-mail ou téléphone", service: "Choisissez un soin", date: "Date souhaitée", time: "Horaire souhaité", submit: "Préparer la demande", required: "Veuillez remplir tous les champs obligatoires.", ready: "Votre demande est prête à être envoyée", caveat: "Rien n’a été envoyé ni enregistré. Copiez cette demande et écrivez au studio pour confirmer votre rendez-vous.", copy: "Copier la demande", copied: "Copié", summary: "Demande de rendez-vous", appointment: "Soin", preferredDate: "Date", preferredTime: "Horaire", customer: "Nom", contactInfo: "Contact",
  },
};

export function BookingForm({ language, services }: BookingFormProps) {
  const t = labels[language];
  const [request, setRequest] = useState("");
  const [copied, setCopied] = useState(false);
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const service = String(formData.get("service"));
    const date = String(formData.get("date"));
    const time = String(formData.get("time"));
    const name = String(formData.get("name"));
    const contact = String(formData.get("contact"));
    setRequest(`${t.summary}\n${t.appointment}: ${service}\n${t.preferredDate}: ${date}\n${t.preferredTime}: ${time}\n${t.customer}: ${name}\n${t.contactInfo}: ${contact}`);
    setCopied(false);
  }

  async function copyRequest() {
    await navigator.clipboard.writeText(request);
    setCopied(true);
  }

  return (
    <div className="booking-form-wrap">
      <form className="booking-form" onSubmit={handleSubmit}>
        <label>{t.service}<select name="service" required defaultValue=""><option value="" disabled>{t.service}</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label>
        <label>{t.date}<input type="date" name="date" min={minDate} required /></label>
        <label>{t.time}<select name="time" required defaultValue=""><option value="" disabled>{t.time}</option>{["10:00", "11:30", "13:00", "14:30", "16:00", "17:30"].map((time) => <option key={time}>{time}</option>)}</select></label>
        <label>{t.name}<input type="text" name="name" autoComplete="name" required maxLength={80} /></label>
        <label className="booking-contact-field">{t.contact}<input type="text" name="contact" autoComplete="email" required maxLength={120} /></label>
        <button className="button button-light booking-submit" type="submit">{t.submit}<span aria-hidden="true">↗</span></button>
      </form>
      {request && <div className="booking-result" role="status" aria-live="polite"><strong>{t.ready}</strong><p>{t.caveat}</p><button className="copy-request" type="button" onClick={copyRequest}>{copied ? t.copied : t.copy}</button><pre>{request}</pre></div>}
    </div>
  );
}
