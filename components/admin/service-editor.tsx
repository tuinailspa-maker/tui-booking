"use client";

import { useState } from "react";
import { allServices, selectedServicePrice, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";

type ServiceEditorProps = {
  initialServiceIds: string[][];
  initialAddOns: Record<string, ServiceAddOnKey>[];
  guestNames: string[];
  customerName: string;
  customerPhone: string;
  walkIn: boolean;
  onCancel: () => void;
  onSave: (value: { serviceIds: string[][]; addOns: Record<string, ServiceAddOnKey>[]; customerName: string; customerPhone: string }) => void;
};

export function ServiceEditor({ initialServiceIds, initialAddOns, guestNames, customerName, customerPhone, walkIn, onCancel, onSave }: ServiceEditorProps) {
  const guestCount = Math.max(1, initialServiceIds.length);
  const [activeGuest, setActiveGuest] = useState(0);
  const [serviceIds, setServiceIds] = useState(() => Array.from({ length: guestCount }, (_, index) => initialServiceIds[index] ?? []));
  const [addOns, setAddOns] = useState(() => Array.from({ length: guestCount }, (_, index) => initialAddOns[index] ?? {}));
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [search, setSearch] = useState("");
  const [validation, setValidation] = useState("");
  const visibleServices = allServices.filter((service) => serviceDisplayNameWithAddOn(service, "en").toLowerCase().includes(search.toLowerCase()) || service.nameFr.toLowerCase().includes(search.toLowerCase()));
  const activeIds = serviceIds[activeGuest] ?? [];
  const activeAddOns = addOns[activeGuest] ?? {};
  const subtotal = serviceIds.reduce((sum, ids, guestIndex) => sum + ids.reduce((guestTotal, id) => {
    const service = allServices.find((item) => item.id === id);
    return guestTotal + (service ? selectedServicePrice(service, addOns[guestIndex]?.[id]) : 0);
  }, 0), 0);

  function toggleService(id: string) {
    setServiceIds((current) => current.map((ids, index) => {
      if (index !== activeGuest) return ids;
      return ids.includes(id) ? ids.filter((serviceId) => serviceId !== id) : [...ids, id];
    }));
    setValidation("");
  }

  function changeAddOn(serviceId: string, value: ServiceAddOnKey | "") {
    setAddOns((current) => current.map((items, index) => {
      if (index !== activeGuest) return items;
      const next = { ...items };
      if (value) next[serviceId] = value;
      else delete next[serviceId];
      return next;
    }));
  }

  function save() {
    if (walkIn && !name.trim()) {
      setValidation("Enter the walk-in customer name.");
      return;
    }
    if (serviceIds.some((ids) => ids.length === 0)) {
      setValidation("Choose at least one service for each guest.");
      return;
    }
    onSave({ serviceIds, addOns, customerName: name.trim(), customerPhone: phone.trim() });
  }

  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="admin-service-editor" role="dialog" aria-modal="true" aria-labelledby="service-editor-title" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
        <header className="admin-editor-header">
          <div><p className="admin-eyebrow">SERVICE MENU</p><h2 id="service-editor-title">{walkIn ? "New walk-in ticket" : "Edit services"}</h2></div>
          <button className="admin-icon-button" type="button" onClick={onCancel} aria-label="Close editor">×</button>
        </header>
        <div className="admin-editor-scroll">
          {walkIn && <div className="admin-walkin-fields">
            <label>Customer name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Guest name" /></label>
            <label>Phone (optional)<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="438-555-0100" /></label>
          </div>}
          {guestCount > 1 && <div className="admin-guest-tabs" role="group" aria-label="Choose a guest">
            {Array.from({ length: guestCount }, (_, index) => <button key={index} type="button" aria-pressed={activeGuest === index} className={activeGuest === index ? "is-active" : ""} onClick={() => setActiveGuest(index)}>{guestNames[index] || `Guest ${index + 1}`}</button>)}
          </div>}
          <label className="admin-search-label">Find a service<input type="search" autoFocus={!walkIn} aria-label="Search services" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search services" /></label>
          <div className="admin-service-list">
            {visibleServices.map((service) => {
              const selected = activeIds.includes(service.id);
              const selectedAddOn = activeAddOns[service.id] ?? "";
              return <article className={`admin-service-option${selected ? " is-selected" : ""}`} key={service.id}>
                <button type="button" className="admin-service-toggle" aria-pressed={selected} onClick={() => toggleService(service.id)}>
                  <span className="admin-service-check" aria-hidden="true">{selected ? "✓" : "+"}</span>
                  <span><strong>{service.nameEn}</strong><small>{service.displayNameEn}</small></span>
                  <span className="admin-service-price">${selectedServicePrice(service, activeAddOns[service.id])}</span>
                </button>
                {selected && service.addOn && <label className="admin-addon-choice">Optional: {service.addOn.nameEn}
                  <select value={selectedAddOn} onChange={(event) => changeAddOn(service.id, event.target.value as ServiceAddOnKey | "")}>
                    <option value="">No add-on</option>
                    <option value={service.addOn.key}>{service.addOn.nameEn} +${service.addOn.priceCad}</option>
                  </select>
                </label>}
              </article>;
            })}
          </div>
        </div>
        {validation && <p className="admin-form-error" role="alert">{validation}</p>}
        <footer className="admin-editor-footer">
          <span>${subtotal.toFixed(2)} service subtotal · {serviceIds.flat().length} selected</span>
          <div><button className="admin-secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="admin-primary-button" type="button" onClick={save}>{walkIn ? "Create ticket" : "Save services"}</button></div>
        </footer>
      </section>
    </div>
  );
}
