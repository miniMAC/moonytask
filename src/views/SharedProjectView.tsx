import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BackIcon } from "../components/Icons";
import { projectColor } from "../lib/colors";
import {
  fmtCost,
  fmtDateTime,
  fmtDuration,
  startOfDay,
  startOfWeek,
} from "../lib/time";
import type {
  MasterSharedMember,
  PublishedFolder,
  PublishedProject,
  PublishedSnapshot,
} from "../lib/types";

const sectionLabelCls = "text-sm font-bold uppercase tracking-wide";

interface Props {
  member: MasterSharedMember;
  snapshot: PublishedSnapshot;
  folder: PublishedFolder;
  project: PublishedProject;
  onBack: () => void;
}

export default function SharedProjectView({
  member,
  snapshot,
  folder,
  project,
  onBack,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "it" ? "it-IT" : "en-US";
  const entries = useMemo(
    () =>
      snapshot.timeEntries
        .filter((entry) => entry.projectId === project.id)
        .sort((a, b) => b.startedAt - a.startedAt),
    [project.id, snapshot.timeEntries],
  );
  const payments = useMemo(
    () =>
      snapshot.projectPayments
        .filter((payment) => payment.projectId === project.id)
        .sort((a, b) => b.paidAt - a.paidAt),
    [project.id, snapshot.projectPayments],
  );
  const rateProfile =
    snapshot.rateProfiles.find((profile) => profile.id === project.rateProfileId) ??
    null;
  const stats = useMemo(() => {
    const today = startOfDay(new Date());
    const week = startOfWeek(new Date());
    const latestPaidThrough = payments.reduce(
      (latest, payment) => Math.max(latest, payment.paidThroughAt),
      0,
    );
    let todaySecs = 0;
    let weekSecs = 0;
    let totalSecs = 0;
    let residualSecs = 0;
    for (const entry of entries) {
      totalSecs += entry.durationSecs;
      if (entry.startedAt >= week) weekSecs += entry.durationSecs;
      if (entry.startedAt >= today) todaySecs += entry.durationSecs;
      if (entry.endedAt > latestPaidThrough) residualSecs += entry.durationSecs;
    }
    return {
      todaySecs,
      weekSecs,
      totalSecs,
      residualSecs,
      latestPaidThrough,
    };
  }, [entries, payments]);
  const totalValue = (stats.totalSecs / 3600) * project.hourlyRate;
  const residualValue = (stats.residualSecs / 3600) * project.hourlyRate;
  const ownerName = member.account.displayName || member.account.email;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-8 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8 md:py-8">
      <div className="flex min-w-0 items-start gap-1">
        <button
          title={t("common.back")}
          onClick={onBack}
          className="-ml-2 mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <BackIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full"
              style={{
                backgroundColor: projectColor(
                  project.color,
                  `${member.associationId}:${project.id}`,
                ),
              }}
            />
            <h1 className="truncate text-xl font-semibold">{project.name}</h1>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 pro:bg-[#44475a] pro:text-[#8be9fd]">
              {t("sharedProject.readOnly")}
            </span>
            {project.archived && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                {t("sharedProject.archived")}
              </span>
            )}
          </div>
          <p className="mt-1 text-base text-neutral-600 dark:text-neutral-400 pro:text-[#c9c9d6]">
            {folder.name}
            {project.hourlyRate > 0 && (
              <>
                {" · "}
                {fmtCost(project.hourlyRate, snapshot.currency, locale)}/
                {t("sharedProject.hour")}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm sm:grid-cols-2 dark:border-neutral-700 dark:bg-neutral-800/60 pro:border-[#44475a] pro:bg-[#21222c]">
        <SharedMetadata
          label={t("sharedProject.owner")}
          value={ownerName}
          detail={
            member.account.displayName ? member.account.email : undefined
          }
        />
        <SharedMetadata
          label={t("sharedProject.publishedAt")}
          value={fmtDateTime(snapshot.generatedAt, locale)}
          detail={t("sharedProject.sourceHelp")}
        />
        <SharedMetadata
          label={t("sharedProject.hourlyValue")}
          value={fmtCost(project.hourlyRate, snapshot.currency, locale)}
          detail={
            rateProfile
              ? `${rateProfile.name} · ${t(
                  `settings.rates.payment.${rateProfile.paymentType}`,
                )}`
              : t("sharedProject.manualRate")
          }
        />
        <SharedMetadata
          label={t("sharedProject.projectUpdatedAt")}
          value={fmtDateTime(project.updatedAt, locale)}
          detail={`${entries.length} ${t("sharedProject.entries").toLocaleLowerCase()}`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SharedStat
          label={t("projects.todayTime")}
          value={fmtDuration(stats.todaySecs)}
          detail={valueDetail(stats.todaySecs, project.hourlyRate, snapshot.currency, locale)}
        />
        <SharedStat
          label={t("projects.weekTime")}
          value={fmtDuration(stats.weekSecs)}
          detail={valueDetail(stats.weekSecs, project.hourlyRate, snapshot.currency, locale)}
        />
        <SharedStat
          label={t("projects.totalTime")}
          value={fmtDuration(stats.totalSecs)}
          detail={fmtCost(totalValue, snapshot.currency, locale)}
        />
        <SharedStat
          label={t("sharedProject.amountDue")}
          value={fmtCost(residualValue, snapshot.currency, locale)}
          detail={fmtDuration(stats.residualSecs)}
        />
      </div>

      <section className="mt-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2
            className={`${sectionLabelCls} text-blue-700 dark:text-blue-400 pro:text-[#8be9fd]`}
          >
            {t("sharedProject.entries")}
          </h2>
          <span className="text-sm text-neutral-500">
            {t("sharedProject.entryCount", { count: entries.length })}
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 px-4 py-5 text-base text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            {t("sharedProject.noEntries")}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-base"
              >
                <span className="min-w-0 text-neutral-700 dark:text-neutral-300">
                  <span className="block">
                    {fmtDateTime(entry.startedAt, locale)}
                  </span>
                  {entry.note && (
                    <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-neutral-500 dark:text-neutral-400">
                      {entry.note}
                    </span>
                  )}
                </span>
                <span className="font-medium tabular-nums">
                  {fmtDuration(entry.durationSecs)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-[#D94700] bg-[#FF5600] p-5 text-white shadow-[0_14px_35px_rgba(255,86,0,0.18)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={`${sectionLabelCls} text-white`}>
            {t("projects.payments")}
          </h2>
          <span className="text-sm text-white/80">
            {stats.latestPaidThrough > 0
              ? `${t("projects.paidThrough")} ${fmtDateTime(
                  stats.latestPaidThrough,
                  locale,
                )}`
              : t("sharedProject.notPaid")}
          </span>
        </div>
        {payments.length === 0 ? (
          <p className="mt-4 text-base text-white/85">
            {t("sharedProject.noPayments")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-white/25 overflow-hidden rounded-xl border border-white/40 text-base">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-3"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {t("projects.paidThrough")}{" "}
                    {fmtDateTime(payment.paidThroughAt, locale)}
                  </span>
                  {payment.note && (
                    <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-white/85">
                      {payment.note}
                    </span>
                  )}
                </span>
                <span className="text-sm text-white/80">
                  {t("projects.paidAt")} {fmtDateTime(payment.paidAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function valueDetail(
  seconds: number,
  hourlyRate: number,
  currency: string,
  locale: string,
): string | null {
  if (hourlyRate <= 0) return null;
  return fmtCost((seconds / 3600) * hourlyRate, currency, locale);
}

function SharedStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string | null;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700 pro:border-[#44475a]">
      <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500 pro:text-[#bd93f9]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && (
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {detail}
        </p>
      )}
    </div>
  );
}

function SharedMetadata({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 truncate text-base font-medium text-neutral-800 dark:text-neutral-100">
        {value}
      </p>
      {detail && (
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {detail}
        </p>
      )}
    </div>
  );
}
