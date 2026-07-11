import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface Props {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

export default function DatePicker({
  value,
  onChange,
  ariaLabel,
  className = "",
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "it" ? "it-IT" : "en-US";
  const selectedDate = useMemo(() => fromDateInput(value), [value]);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  // il popup vive in un portal su document.body, così non viene tagliato
  // dall'overflow delle modali; la posizione è calcolata dal bottone
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const margin = 8;
      let top = anchor.bottom + margin;
      if (top + popup.offsetHeight > window.innerHeight - margin) {
        top = Math.max(margin, anchor.top - popup.offsetHeight - margin);
      }
      const left = Math.min(
        anchor.left,
        Math.max(margin, window.innerWidth - popup.offsetWidth - margin),
      );
      setPopupPos({ top, left });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popupRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setVisibleMonth(
        new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
      );
    }
  }, [open, selectedDate]);

  const firstDayOfWeek = locale === "it-IT" ? 1 : 0;
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const sunday = new Date(2024, 0, 7);
        sunday.setDate(sunday.getDate() + firstDayOfWeek + index);
        return new Intl.DateTimeFormat(locale, { weekday: "short" })
          .format(sunday)
          .replace(".", "");
      }),
    [firstDayOfWeek, locale],
  );
  const days = useMemo(
    () => calendarDays(visibleMonth, firstDayOfWeek),
    [visibleMonth, firstDayOfWeek],
  );
  const today = new Date();

  const chooseDate = (date: Date) => {
    onChange(toDateInput(date));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] border border-neutral-300 bg-white px-3 text-left text-base outline-none transition hover:border-neutral-400 focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:border-neutral-500 pro:border-[#44475a] pro:bg-[#343746] pro:text-[#f8f8f2] pro:focus:border-[#bd93f9]"
      >
        <span className="tabular-nums">
          {new Intl.DateTimeFormat(locale, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(selectedDate)}
        </span>
        <CalendarIcon />
      </button>

      {open &&
        createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label={t("calendar.chooseDate")}
          style={{ top: popupPos.top, left: popupPos.left }}
          className="fixed z-[70] w-[min(22rem,calc(100vw-5rem))] rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-2xl dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 pro:border-[#44475a] pro:bg-[#21222c] pro:text-[#f8f8f2]"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label={t("calendar.previousMonth")}
              onClick={() =>
                setVisibleMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700 pro:hover:bg-[#343746]"
            >
              <Chevron direction="left" />
            </button>
            <p className="text-base font-bold capitalize">
              {new Intl.DateTimeFormat(locale, {
                month: "long",
                year: "numeric",
              }).format(visibleMonth)}
            </p>
            <button
              type="button"
              aria-label={t("calendar.nextMonth")}
              onClick={() =>
                setVisibleMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700 pro:hover:bg-[#343746]"
            >
              <Chevron direction="right" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdays.map((weekday, index) => (
              <span
                key={`${weekday}-${index}`}
                className="pb-1 text-xs font-bold uppercase text-neutral-500 dark:text-neutral-400 pro:text-[#b9b9c8]"
              >
                {weekday}
              </span>
            ))}
            {days.map((date) => {
              const selected = isSameDay(date, selectedDate);
              const currentDay = isSameDay(date, today);
              const outsideMonth = date.getMonth() !== visibleMonth.getMonth();
              return (
                <button
                  type="button"
                  key={toDateInput(date)}
                  aria-label={new Intl.DateTimeFormat(locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(date)}
                  aria-pressed={selected}
                  onClick={() => chooseDate(date)}
                  className={`relative flex aspect-square min-h-10 items-center justify-center rounded-xl text-sm font-semibold tabular-nums transition ${
                    selected
                      ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700 pro:bg-[#bd93f9] pro:text-[#282a36]"
                      : outsideMonth
                        ? "text-neutral-300 hover:bg-neutral-100 dark:text-neutral-600 dark:hover:bg-neutral-700 pro:text-[#626477] pro:hover:bg-[#343746]"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-700 pro:hover:bg-[#343746]"
                  }`}
                >
                  {date.getDate()}
                  {currentDay && !selected && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-blue-600 pro:bg-[#bd93f9]" />
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => chooseDate(today)}
            className="mt-3 w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-neutral-600 dark:text-blue-300 dark:hover:bg-neutral-700 pro:border-[#44475a] pro:text-[#bd93f9] pro:hover:bg-[#343746]"
          >
            {t("calendar.today")}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function calendarDays(month: Date, firstDayOfWeek: number): Date[] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (firstOfMonth.getDay() - firstDayOfWeek + 7) % 7;
  const firstVisibleDay = new Date(
    month.getFullYear(),
    month.getMonth(),
    1 - offset,
  );

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisibleDay);
    date.setDate(firstVisibleDay.getDate() + index);
    return date;
  });
}

function fromDateInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function CalendarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-neutral-500 dark:text-neutral-400"
    >
      <path d="M8 2v4M16 2v4M3 10h18" />
      <rect x="3" y="4" width="18" height="18" rx="3" />
    </svg>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}
