"use client";

import { useEffect, useRef, useState } from "react";
import "./schedule-header.css";

type ScheduleHeaderProps = {
  date: string;
  todayDate: string;
  onDateChange: (date: string) => void;
  showWeekStrip: boolean;
  isOwner: boolean;
  viewerLabel: string;
  syncState: "ok" | "syncing" | "error";
  isRefreshing: boolean;
  onRefresh: () => void;
  onLock: () => void;
  onNewBooking: () => void;
  scheduleView?: "day" | "list";
  onScheduleViewChange?: (view: "day" | "list") => void;
  columns?: string[];
  hiddenColumns?: Set<string>;
  onToggleColumn?: (name: string) => void;
  onShowAllColumns?: () => void;
};

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function toDateString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function weekOf(value: string) {
  const selected = parseDate(value);
  const sunday = new Date(selected);
  sunday.setUTCDate(selected.getUTCDate() - selected.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday);
    day.setUTCDate(sunday.getUTCDate() + index);
    return day;
  });
}

export function ScheduleHeader({ date, todayDate, onDateChange, showWeekStrip, isOwner, viewerLabel, syncState, isRefreshing, onRefresh, onLock, onNewBooking, scheduleView, onScheduleViewChange, columns = [], hiddenColumns, onToggleColumn, onShowAllColumns }: ScheduleHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const monthLabel = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(parseDate(date));
  const week = weekOf(date);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function openDatePicker() {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  }

  function shiftWeek(days: number) {
    const next = parseDate(date);
    next.setUTCDate(next.getUTCDate() + days);
    onDateChange(toDateString(next));
  }

  const syncText = syncState === "error" ? "Square unavailable" : syncState === "syncing" ? "Syncing Square" : "Square connected";

  return <header className="sq-header">
    <div className="sq-header-row">
      <div className="sq-menu" ref={menuRef}>
        <button type="button" className="sq-icon-button" aria-label="Calendar options" aria-haspopup="true" aria-expanded={menuOpen} aria-controls="sq-menu-panel" onClick={() => setMenuOpen((open) => !open)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          <span className={`sq-sync-dot is-${syncState}`} aria-hidden="true" />
        </button>
        {menuOpen && <div className="sq-menu-panel" id="sq-menu-panel" role="group" aria-label="Calendar options">
          <div className="sq-menu-identity">
            <strong>{viewerLabel}</strong>
            <span className={`sq-menu-sync is-${syncState}`}><i aria-hidden="true" />{syncText}</span>
          </div>
          {scheduleView && onScheduleViewChange && <div className="sq-menu-section">
            <p className="sq-menu-label">View</p>
            <div className="sq-segmented" role="group" aria-label="Calendar view">
              <button type="button" aria-pressed={scheduleView === "day"} onClick={() => onScheduleViewChange("day")}>By Technician</button>
              <button type="button" aria-pressed={scheduleView === "list"} onClick={() => onScheduleViewChange("list")}>Timeline List</button>
            </div>
          </div>}
          {isOwner && columns.length > 0 && hiddenColumns && onToggleColumn && <div className="sq-menu-section">
            <p className="sq-menu-label">Columns</p>
            <ul className="sq-column-list">
              {columns.map((name) => {
                const visible = !hiddenColumns.has(name);
                return <li key={name}>
                  <label>
                    <input type="checkbox" checked={visible} onChange={() => onToggleColumn(name)} />
                    <span>{name}</span>
                  </label>
                </li>;
              })}
            </ul>
            {hiddenColumns.size > 0 && onShowAllColumns && <button type="button" className="sq-menu-link" onClick={onShowAllColumns}>Show all columns</button>}
          </div>}
          <div className="sq-menu-section sq-menu-actions">
            <button type="button" onClick={() => { onDateChange(todayDate); setMenuOpen(false); }}>Go to today</button>
            <button type="button" onClick={onRefresh} disabled={isRefreshing}>{isRefreshing ? "Refreshing…" : "Refresh appointments"}</button>
            <button type="button" className="is-lock" onClick={onLock}>Lock / Switch staff</button>
          </div>
        </div>}
      </div>

      <div className="sq-month">
        <button type="button" className="sq-month-button" onClick={openDatePicker} aria-label={`${monthLabel}. Choose a date`}>
          <span>{monthLabel}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
        </button>
        <input ref={dateInputRef} className="sq-month-input" type="date" tabIndex={-1} aria-hidden="true" value={date} onChange={(event) => event.target.value && onDateChange(event.target.value)} />
      </div>

      {isOwner ? <button type="button" className="sq-icon-button sq-add-button" aria-label="New booking or walk-in" onClick={onNewBooking}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button> : <span className="sq-icon-spacer" aria-hidden="true" />}
    </div>

    {showWeekStrip && <nav className="sq-week" aria-label="Choose a day">
      <button type="button" className="sq-week-shift" aria-label="Previous week" onClick={() => shiftWeek(-7)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
      </button>
      <ol className="sq-week-days">
        {week.map((day) => {
          const value = toDateString(day);
          const selected = value === date;
          const isToday = value === todayDate;
          return <li key={value}>
            <button type="button" className={`sq-day${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}`} aria-pressed={selected} aria-label={`${WEEKDAY_NAMES[day.getUTCDay()]} ${day.getUTCDate()}${isToday ? ", today" : ""}`} onClick={() => onDateChange(value)}>
              <span className="sq-day-letter" aria-hidden="true">{WEEKDAY_LETTERS[day.getUTCDay()]}</span>
              <span className="sq-day-number" aria-hidden="true">{day.getUTCDate()}</span>
            </button>
          </li>;
        })}
      </ol>
      <button type="button" className="sq-week-shift" aria-label="Next week" onClick={() => shiftWeek(7)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
      </button>
    </nav>}
  </header>;
}
