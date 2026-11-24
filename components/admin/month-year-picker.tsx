"use client";

import { useEffect, useRef, useState } from "react";
import "./month-year-picker.css";

type MonthYearPickerProps = {
  id: string;
  date: string;
  todayDate: string;
  onSelect: (date: string) => void;
  onClose: () => void;
};

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month, 1))));
const MONTH_SHORT = MONTH_NAMES.map((name) => name.slice(0, 3));

function toValue(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthCells(year: number, month: number) {
  const leading = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [...Array.from({ length: leading }, () => null), ...Array.from({ length: count }, (_, index) => index + 1)];
}

function MonthGrid({ year, month, date, todayDate, compact, onSelect }: { year: number; month: number; date: string; todayDate: string; compact: boolean; onSelect: (value: string) => void }) {
  return <div className={`myp-grid${compact ? " is-compact" : ""}`} role="grid" aria-label={`${MONTH_NAMES[month]} ${year}`}>
    <div className="myp-weekdays" role="row">
      {WEEKDAY_LETTERS.map((letter, index) => <span role="columnheader" key={index}>{letter}</span>)}
    </div>
    <div className="myp-days" role="row">
      {monthCells(year, month).map((day, index) => {
        if (day === null) return <span key={`blank-${index}`} className="myp-blank" aria-hidden="true" />;
        const value = toValue(year, month, day);
        const selected = value === date;
        const isToday = value === todayDate;
        return <button
          type="button"
          role="gridcell"
          key={value}
          className={`myp-day${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
          aria-selected={selected}
          aria-label={`${MONTH_NAMES[month]} ${day}, ${year}${isToday ? ", today" : ""}`}
          data-selected={selected || undefined}
          onClick={() => onSelect(value)}
        >{day}</button>;
      })}
    </div>
  </div>;
}

export function MonthYearPicker({ id, date, todayDate, onSelect, onClose }: MonthYearPickerProps) {
  const [selectedYear, selectedMonth] = date.split("-").map(Number);
  const [mode, setMode] = useState<"month" | "year">("month");
  const [viewYear, setViewYear] = useState(selectedYear);
  const [viewMonth, setViewMonth] = useState(selectedMonth - 1);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = panelRef.current?.querySelector<HTMLButtonElement>("[data-selected]") ?? panelRef.current?.querySelector<HTMLButtonElement>(".myp-day");
    target?.focus({ preventScroll: true });
    if (mode === "year") target?.closest(".myp-mini")?.scrollIntoView({ block: "nearest" });
  }, [mode]);

  function shift(step: number) {
    if (mode === "year") {
      setViewYear((year) => year + step);
      return;
    }
    const next = viewMonth + step;
    setViewYear((year) => year + Math.floor(next / 12));
    setViewMonth(((next % 12) + 12) % 12);
  }

  function choose(value: string) {
    onSelect(value);
    onClose();
  }

  function goToToday() {
    const [year, month] = todayDate.split("-").map(Number);
    setViewYear(year);
    setViewMonth(month - 1);
    choose(todayDate);
  }

  const title = mode === "year" ? String(viewYear) : `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  return <div ref={panelRef} id={id} className={`myp-panel is-${mode}`} role="dialog" aria-modal="false" aria-label="Choose a date">
    <div className="myp-toolbar">
      <div className="myp-tabs" role="group" aria-label="Picker view">
        <button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month</button>
        <button type="button" aria-pressed={mode === "year"} onClick={() => setMode("year")}>Year</button>
      </div>
      <button type="button" className="myp-today" onClick={goToToday}>Today</button>
    </div>

    <div className="myp-nav">
      <button type="button" className="myp-shift" aria-label={mode === "year" ? "Previous year" : "Previous month"} onClick={() => shift(-1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
      </button>
      <h2 className="myp-title" aria-live="polite">{title}</h2>
      <button type="button" className="myp-shift" aria-label={mode === "year" ? "Next year" : "Next month"} onClick={() => shift(1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
      </button>
    </div>

    {mode === "month" ? <>
      <MonthGrid year={viewYear} month={viewMonth} date={date} todayDate={todayDate} compact={false} onSelect={choose} />
      <div className="myp-month-chips" role="group" aria-label={`Jump to a month in ${viewYear}`}>
        {MONTH_SHORT.map((name, month) => <button type="button" key={name} aria-pressed={month === viewMonth} onClick={() => setViewMonth(month)}>{name}</button>)}
      </div>
    </> : <div className="myp-year">
      {MONTH_NAMES.map((name, month) => <section className={`myp-mini${viewYear === selectedYear && month === selectedMonth - 1 ? " is-current" : ""}`} key={name}>
        <button type="button" className="myp-mini-title" onClick={() => { setViewMonth(month); setMode("month"); }} aria-label={`Open ${name} ${viewYear}`}>{name}</button>
        <MonthGrid year={viewYear} month={month} date={date} todayDate={todayDate} compact onSelect={choose} />
      </section>)}
    </div>}
  </div>;
}
