import type { BookingCopy } from "./copy";
import "./technician-picker.css";

export type TechnicianOption = { id: string; name: string; imageUrl: string | null };

type TechnicianPickerProps = {
  copy: BookingCopy;
  technicians?: TechnicianOption[];
  selectedId: string;
  isLoading: boolean;
  onChange: (id: string) => void;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function TechnicianPicker({ copy, technicians = [], selectedId, isLoading, onChange }: TechnicianPickerProps) {
  return (
    <div className="form-section">
      <div className="section-label-row">
        <h2 id="technician-picker-title">{copy.chooseTechnician}</h2>
      </div>
      <div className="technician-options" role="group" aria-labelledby="technician-picker-title">
        <button
          type="button"
          className={`technician-option technician-option-any${selectedId === "" ? " is-selected" : ""}`}
          aria-pressed={selectedId === ""}
          onClick={() => onChange("")}
        >
          <span className="technician-avatar" aria-hidden="true">✦</span>
          <span className="technician-text">
            <span className="technician-name">{copy.anyTechnicianOption}</span>
            <span className="technician-hint">{copy.anyTechnicianHint}</span>
          </span>
        </button>
        {technicians.map((technician) => (
          <button
            type="button"
            key={technician.id}
            className={`technician-option${selectedId === technician.id ? " is-selected" : ""}`}
            aria-pressed={selectedId === technician.id}
            onClick={() => onChange(technician.id)}
          >
            {technician.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Square-hosted profile photos are not in the Next image allowlist.
              <img className="technician-avatar" src={technician.imageUrl} alt="" width={36} height={36} />
            ) : (
              <span className="technician-avatar" aria-hidden="true">{initials(technician.name)}</span>
            )}
            <span className="technician-text"><span className="technician-name">{technician.name}</span></span>
          </button>
        ))}
      </div>
      {isLoading && technicians.length === 0 && <p className="field-hint technician-loading" role="status">{copy.techniciansLoading}</p>}
    </div>
  );
}
