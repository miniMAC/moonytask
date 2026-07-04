import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Folder, Project, TimeEntry, TimerSnapshot } from "../lib/types";
import * as api from "../lib/api";
import { projectColor } from "../lib/colors";
import {
  fmtClock,
  fmtCost,
  fmtDateTime,
  fmtDuration,
  startOfDay,
  startOfWeek,
} from "../lib/time";
import Modal from "../components/Modal";
import {
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
} from "../components/Icons";

interface Props {
  project: Project;
  folder: Folder | undefined;
  timer: TimerSnapshot;
  currency: string;
  refreshKey: number;
  onEdit: () => void;
  onDelete: () => void;
}

export default function ProjectView(p: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "it" ? "it-IT" : "en-US";
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [manualOpen, setManualOpen] = useState(false);

  const load = () =>
    api
      .entriesRange(0, Math.floor(Date.now() / 1000) + 86400)
      .then((all) => setEntries(all.filter((e) => e.projectId === p.project.id)));

  useEffect(() => {
    load();
  }, [p.project.id, p.refreshKey]);

  const now = new Date();
  const stats = useMemo(() => {
    const today = startOfDay(now);
    const week = startOfWeek(now);
    let todaySecs = 0;
    let weekSecs = 0;
    let totalSecs = 0;
    for (const e of entries) {
      totalSecs += e.durationSecs;
      if (e.startedAt >= week) weekSecs += e.durationSecs;
      if (e.startedAt >= today) todaySecs += e.durationSecs;
    }
    return { todaySecs, weekSecs, totalSecs };
  }, [entries]);

  const mine = timerIsMine(p.timer, p.project.id);
  const liveExtra = mine ? p.timer.elapsedSecs : 0;

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span
              className="h-3.5 w-3.5 rounded-full"
              style={{
                backgroundColor: projectColor(p.project.color, p.project.id),
              }}
            />
            <h1 className="text-xl font-semibold">{p.project.name}</h1>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {p.folder?.name}
            {p.project.hourlyRate > 0 && (
              <>
                {" · "}
                {fmtCost(p.project.hourlyRate, p.currency, locale)}/
                {t("common.hours").slice(0, 1)}
              </>
            )}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            title={t("projects.edit")}
            onClick={p.onEdit}
            className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <PencilIcon size={16} />
          </button>
          <button
            title={t("projects.delete")}
            onClick={p.onDelete}
            className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-red-600"
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </div>

      {/* timer */}
      <div className="mt-6 flex items-center gap-5 rounded-xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-700 dark:bg-neutral-800/60">
        <span className="flex-1 font-mono text-4xl tabular-nums text-neutral-800 dark:text-neutral-100">
          {fmtClock(mine ? p.timer.elapsedSecs : 0)}
        </span>
        {!mine || p.timer.status === "idle" ? (
          <button
            onClick={() => api.timerStart(p.project.id)}
            className="flex items-center gap-2 rounded-full bg-green-600 px-6 py-3 font-medium text-white hover:bg-green-700"
          >
            <PlayIcon />
            {t("timer.start")}
          </button>
        ) : (
          <>
            {p.timer.status === "running" ? (
              <button
                onClick={() => api.timerPause()}
                className="flex items-center gap-2 rounded-full bg-amber-500 px-5 py-3 font-medium text-white hover:bg-amber-600"
              >
                <PauseIcon />
                {t("timer.pause")}
              </button>
            ) : (
              <button
                onClick={() => api.timerResume()}
                className="flex items-center gap-2 rounded-full bg-green-600 px-5 py-3 font-medium text-white hover:bg-green-700"
              >
                <PlayIcon />
                {t("timer.resume")}
              </button>
            )}
            <button
              onClick={() => api.timerStop()}
              className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 font-medium text-white hover:bg-red-700"
            >
              <StopIcon />
              {t("timer.stop")}
            </button>
          </>
        )}
      </div>

      {/* stats */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {(
          [
            [t("projects.todayTime"), stats.todaySecs + liveExtra],
            [t("projects.weekTime"), stats.weekSecs + liveExtra],
            [t("projects.totalTime"), stats.totalSecs + liveExtra],
          ] as const
        ).map(([label, secs]) => (
          <div
            key={label}
            className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"
          >
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {fmtDuration(secs)}
            </p>
            {p.project.hourlyRate > 0 && (
              <p className="text-xs text-neutral-500">
                {fmtCost((secs / 3600) * p.project.hourlyRate, p.currency, locale)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* entries */}
      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {t("projects.recentEntries")}
          </h2>
          <button
            onClick={() => setManualOpen(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <PlusIcon size={13} />
            {t("projects.addManual")}
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="py-4 text-sm text-neutral-500">
            {t("projects.noEntries")}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
            {entries.slice(0, 15).map((e) => (
              <li
                key={e.id}
                className="group flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="flex-1 text-neutral-700 dark:text-neutral-300">
                  {fmtDateTime(e.startedAt, locale)}
                  {e.note && (
                    <span className="ml-2 text-xs text-neutral-400">
                      {e.note}
                    </span>
                  )}
                </span>
                <span className="font-medium tabular-nums">
                  {fmtDuration(e.durationSecs)}
                </span>
                <button
                  onClick={() => api.entryDelete(e.id).then(load)}
                  className="invisible rounded p-1 text-neutral-400 hover:text-red-600 group-hover:visible"
                >
                  <TrashIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {manualOpen && (
        <ManualEntryModal
          projectId={p.project.id}
          onClose={() => setManualOpen(false)}
          onSaved={() => {
            setManualOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function timerIsMine(timer: TimerSnapshot, projectId: string): boolean {
  return timer.projectId === projectId && timer.status !== "idle";
}

function ManualEntryModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const today = new Date();
  const [date, setDate] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
  );
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");

  const save = async () => {
    const mins = parseInt(minutes, 10);
    if (!mins || mins <= 0) return;
    const [y, m, d] = date.split("-").map(Number);
    const startedAt = Math.floor(new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000);
    await api.entryAddManual(projectId, startedAt, mins * 60, note.trim() || null);
    onSaved();
  };

  return (
    <Modal title={t("projects.addManual")} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              {t("projects.date")}
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
            />
          </label>
          <label className="block w-40">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              {t("projects.durationMinutes")}
            </span>
            <input
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600">
            {t("projects.note")}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("common.add")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
