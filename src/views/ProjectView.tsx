import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Folder,
  Project,
  ProjectPayment,
  TimeEntry,
  TimerSnapshot,
} from "../lib/types";
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
  const [payments, setPayments] = useState<ProjectPayment[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"json" | "csv" | null>(null);
  const [noteEntry, setNoteEntry] = useState<TimeEntry | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    () => new Set(),
  );

  const load = () =>
    Promise.all([
      api.entriesRange(0, Math.floor(Date.now() / 1000) + 86400),
      api.projectPaymentsList(p.project.id),
    ]).then(([allEntries, projectPayments]) => {
      setEntries(allEntries.filter((e) => e.projectId === p.project.id));
      setPayments(projectPayments);
    });

  useEffect(() => {
    setSelectedEntryIds(new Set());
    setNoteEntry(null);
    load();
  }, [p.project.id, p.refreshKey]);

  const mine = timerIsMine(p.timer, p.project.id);
  const liveExtra = mine ? p.timer.elapsedSecs : 0;
  const now = new Date();
  const stats = useMemo(() => {
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const latestPaidThrough = payments.reduce(
      (latest, payment) => Math.max(latest, payment.paidThroughAt),
      0,
    );
    let todaySecs = 0;
    let weekSecs = 0;
    let totalSecs = 0;
    let residualSecs = 0;
    for (const e of entries) {
      totalSecs += e.durationSecs;
      if (e.startedAt >= week) weekSecs += e.durationSecs;
      if (e.startedAt >= today) todaySecs += e.durationSecs;
      if (e.endedAt > latestPaidThrough) residualSecs += e.durationSecs;
    }
    return { todaySecs, weekSecs, totalSecs, residualSecs, latestPaidThrough };
  }, [entries, payments]);

  const totalSecsWithLive = stats.totalSecs + liveExtra;
  const totalCost = (totalSecsWithLive / 3600) * p.project.hourlyRate;
  const residualSecsWithLive =
    stats.residualSecs +
    (liveExtra > 0 && Math.floor(Date.now() / 1000) > stats.latestPaidThrough
      ? liveExtra
      : 0);
  const residualCost = (residualSecsWithLive / 3600) * p.project.hourlyRate;
  const visibleEntries = entries.slice(0, 15);
  const selectedCount = selectedEntryIds.size;

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const mergeSelectedEntries = async () => {
    if (selectedEntryIds.size < 2) return;
    await api.entriesMerge([...selectedEntryIds]);
    setSelectedEntryIds(new Set());
    load();
  };

  // esporta tutti i dati del progetto in JSON o CSV nella cartella export configurata
  const exportProjectData = async (format: "json" | "csv") => {
    if (exportBusy) return;
    setExportBusy(format);
    setPdfMsg(null);
    try {
      await api.projectExport(p.project.id, format);
      setPdfMsg(t("projects.exported"));
    } catch {
      setPdfMsg(t("projects.exportFailed"));
    } finally {
      setExportBusy(null);
      window.setTimeout(() => setPdfMsg(null), 4000);
    }
  };

  // esporta il PDF dell'intero storico del progetto, senza scegliere un periodo
  const exportAllTimePdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      await api.reportExportPdf({
        from: 0,
        to: Math.floor(Date.now() / 1000) + 86400,
        folderId: "all",
        projectId: p.project.id,
        currency: p.currency,
        locale,
      });
      setPdfMsg(t("reports.pdfExported"));
    } catch {
      setPdfMsg(t("reports.pdfFailed"));
    } finally {
      setPdfBusy(false);
      window.setTimeout(() => setPdfMsg(null), 4000);
    }
  };

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
          <p className="mt-1 text-base text-neutral-500">
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
        <div className="flex items-center gap-1">
          {pdfMsg && (
            <span className="mr-1 max-w-48 truncate text-sm text-neutral-500">
              {pdfMsg}
            </span>
          )}
          <button
            onClick={exportAllTimePdf}
            disabled={pdfBusy}
            title={t("projects.exportPdfHelp")}
            className="h-11 rounded-lg border border-neutral-300 px-5 text-base font-semibold hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800 pro:border-[#44475a] pro:hover:bg-[#343746]"
          >
            {pdfBusy ? "..." : t("projects.exportPdf")}
          </button>
          <button
            onClick={() => exportProjectData("json")}
            disabled={exportBusy !== null}
            title={t("projects.exportJsonHelp")}
            className="h-11 rounded-lg border border-neutral-300 px-5 text-base font-semibold hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800 pro:border-[#44475a] pro:hover:bg-[#343746]"
          >
            {exportBusy === "json" ? "..." : t("projects.exportJson")}
          </button>
          <button
            onClick={() => exportProjectData("csv")}
            disabled={exportBusy !== null}
            title={t("projects.exportCsvHelp")}
            className="h-11 rounded-lg border border-neutral-300 px-5 text-base font-semibold hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800 pro:border-[#44475a] pro:hover:bg-[#343746]"
          >
            {exportBusy === "csv" ? "..." : t("projects.exportCsv")}
          </button>
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
            className="flex items-center gap-2 rounded-xl bg-green-500 px-6 py-3 font-semibold text-white hover:bg-green-400"
          >
            <PlayIcon />
            {t("timer.start")}
          </button>
        ) : (
          <>
            {p.timer.status === "running" ? (
              <button
                onClick={() => api.timerPause()}
                className="flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-3 font-semibold text-white hover:bg-amber-300"
              >
                <PauseIcon />
                {t("timer.pause")}
              </button>
            ) : (
              <button
                onClick={() => api.timerResume()}
                className="flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 font-semibold text-white hover:bg-green-400"
              >
                <PlayIcon />
                {t("timer.resume")}
              </button>
            )}
            <button
              onClick={() => api.timerStop()}
              className="flex items-center gap-2 rounded-xl bg-red-500 px-5 py-3 font-semibold text-white hover:bg-red-400"
            >
              <StopIcon />
              {t("timer.stop")}
            </button>
          </>
        )}
      </div>

      {/* stats */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ProjectStatTile
          label={t("projects.todayTime")}
          value={fmtDuration(stats.todaySecs + liveExtra)}
          detail={
            p.project.hourlyRate > 0
              ? fmtCost(
                  ((stats.todaySecs + liveExtra) / 3600) * p.project.hourlyRate,
                  p.currency,
                  locale,
                )
              : null
          }
        />
        <ProjectStatTile
          label={t("projects.weekTime")}
          value={fmtDuration(stats.weekSecs + liveExtra)}
          detail={
            p.project.hourlyRate > 0
              ? fmtCost(
                  ((stats.weekSecs + liveExtra) / 3600) * p.project.hourlyRate,
                  p.currency,
                  locale,
                )
              : null
          }
        />
        <ProjectStatTile
          label={t("projects.totalTime")}
          value={fmtDuration(totalSecsWithLive)}
          detail={p.project.hourlyRate > 0 ? fmtCost(totalCost, p.currency, locale) : null}
        />
        <ProjectStatTile
          label={t("projects.totalCost")}
          value={fmtCost(totalCost, p.currency, locale)}
          detail={fmtDuration(totalSecsWithLive)}
        />
      </div>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900/30 pro:border-[#44475a] pro:bg-[#21222c]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
            {t("projects.payments")}
          </h2>
          <button
            onClick={() => setPaymentOpen(true)}
            className="flex items-center gap-1 rounded-md border border-neutral-200 px-4 py-2 text-base font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 pro:border-[#44475a] pro:hover:bg-[#343746]"
          >
            <PlusIcon size={13} />
            {t("projects.markPaid")}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ProjectStatTile
            label={t("projects.paidThrough")}
            value={
              stats.latestPaidThrough > 0
                ? fmtDate(stats.latestPaidThrough, locale)
                : "-"
            }
            detail={
              payments[0]
                ? `${t("projects.paidAt")} ${fmtDate(payments[0].paidAt, locale)}`
                : null
            }
          />
          <ProjectStatTile
            label={t("projects.amountDue")}
            value={fmtCost(residualCost, p.currency, locale)}
            detail={fmtDuration(residualSecsWithLive)}
          />
        </div>
        {payments.length === 0 ? (
          <p className="mt-4 text-base text-neutral-500">
            {t("projects.noPayments")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 text-base dark:divide-neutral-800 dark:border-neutral-700 pro:divide-[#44475a] pro:border-[#44475a]">
            {payments.slice(0, 5).map((payment) => (
              <li
                key={payment.id}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {t("projects.paidThrough")} {fmtDate(payment.paidThroughAt, locale)}
                  </span>
                  <span className="block truncate text-sm text-neutral-500">
                    {t("projects.paidAt")} {fmtDate(payment.paidAt, locale)}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </span>
                </span>
                <button
                  onClick={() => api.projectPaymentDelete(payment.id).then(load)}
                  className="invisible rounded p-1 text-neutral-400 hover:text-red-600 group-hover:visible"
                >
                  <TrashIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* entries */}
      <div className="mt-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
            {t("projects.recentEntries")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {selectedCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900/40 pro:border-[#44475a] pro:bg-[#21222c]">
                <span className="px-1 text-sm font-medium text-neutral-500 pro:text-[#b9b9c8]">
                  {t("projects.selectedEntries", { count: selectedCount })}
                </span>
                <button
                  onClick={() => setSelectedEntryIds(new Set())}
                  className="rounded-md px-3 py-1.5 text-base text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 pro:hover:bg-[#343746]"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={mergeSelectedEntries}
                  disabled={selectedCount < 2}
                  className="rounded-md bg-neutral-950 px-2.5 py-1 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 pro:bg-[#50fa7b] pro:text-[#282a36]"
                >
                  {t("projects.mergeEntries")}
                </button>
              </div>
            )}
            <button
              onClick={() => setManualOpen(true)}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <PlusIcon size={13} />
              {t("projects.addManual")}
            </button>
          </div>
        </div>
        {entries.length === 0 ? (
          <p className="py-4 text-base text-neutral-500">
            {t("projects.noEntries")}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
            {visibleEntries.map((e) => {
              const selected = selectedEntryIds.has(e.id);
              return (
              <li
                key={e.id}
                onClick={() => setNoteEntry(e)}
                className={`group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 text-base transition ${
                  selected
                    ? "bg-blue-50 dark:bg-blue-950/30 pro:bg-[#44475a]/50"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60 pro:hover:bg-[#343746]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleEntrySelection(e.id)}
                  onClick={(event) => event.stopPropagation()}
                  className="h-4 w-4"
                  aria-label={t("projects.selectEntry")}
                />
                <span className="min-w-0 text-neutral-700 dark:text-neutral-300">
                  <span className="block truncate">{fmtDateTime(e.startedAt, locale)}</span>
                  {e.note && (
                    <span className="block truncate text-sm text-neutral-400">
                      {e.note}
                    </span>
                  )}
                </span>
                <span className="font-medium tabular-nums">
                  {fmtDuration(e.durationSecs)}
                </span>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    api.entryDelete(e.id).then(() => {
                      setSelectedEntryIds((current) => {
                        const next = new Set(current);
                        next.delete(e.id);
                        return next;
                      });
                      load();
                    });
                  }}
                  className="invisible rounded p-1 text-neutral-400 hover:text-red-600 group-hover:visible"
                >
                  <TrashIcon size={13} />
                </button>
              </li>
            );
            })}
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
      {paymentOpen && (
        <PaymentModal
          projectId={p.project.id}
          onClose={() => setPaymentOpen(false)}
          onSaved={() => {
            setPaymentOpen(false);
            load();
          }}
        />
      )}
      {noteEntry && (
        <EntryNoteModal
          entry={noteEntry}
          onClose={() => setNoteEntry(null)}
          onSaved={() => {
            setNoteEntry(null);
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

function ProjectStatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700 pro:border-[#44475a]">
      <p className="text-sm text-neutral-500 pro:text-[#b9b9c8]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {detail && (
        <p className="text-sm text-neutral-500 pro:text-[#b9b9c8]">{detail}</p>
      )}
    </div>
  );
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
            <span className="mb-1 block text-sm font-medium text-neutral-600">
              {t("projects.date")}
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
            />
          </label>
          <label className="block w-40">
            <span className="mb-1 block text-sm font-medium text-neutral-600">
              {t("projects.durationMinutes")}
            </span>
            <input
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-600">
            {t("projects.note")}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            className="h-11 rounded-lg bg-blue-600 px-6 text-base font-medium text-white hover:bg-blue-700"
          >
            {t("common.add")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EntryNoteModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: TimeEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "it" ? "it-IT" : "en-US";
  const [note, setNote] = useState(entry.note ?? "");

  const save = async () => {
    await api.entryUpdateNote(entry.id, note.trim() || null);
    onSaved();
  };

  return (
    <Modal
      title={entry.note ? t("projects.editEntryNote") : t("projects.addEntryNote")}
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-600 dark:text-neutral-300">
            {fmtDateTime(entry.startedAt, locale)}
          </span>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            className="h-11 rounded-lg bg-blue-600 px-6 text-base font-medium text-white hover:bg-blue-700"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [paidThroughDate, setPaidThroughDate] = useState(toDateInput(new Date()));
  const [note, setNote] = useState("");

  const save = async () => {
    await api.projectPaymentCreate(
      projectId,
      Math.floor(Date.now() / 1000),
      endOfDateInput(paidThroughDate),
      note.trim() || null,
    );
    onSaved();
  };

  return (
    <Modal title={t("projects.markPaid")} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-600 dark:text-neutral-300">
            {t("projects.paymentThroughDate")}
          </span>
          <input
            type="date"
            value={paidThroughDate}
            onChange={(e) => setPaidThroughDate(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-600 dark:text-neutral-300">
            {t("projects.paymentNote")}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            className="h-11 rounded-lg bg-blue-600 px-6 text-base font-medium text-white hover:bg-blue-700"
          >
            {t("projects.paymentCreate")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function fmtDate(epochSecs: number, locale: string): string {
  return new Date(epochSecs * 1000).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function endOfDateInput(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000);
}
