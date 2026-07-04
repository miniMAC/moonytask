import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Folder, Project, TimeEntry } from "../lib/types";
import * as api from "../lib/api";
import { projectColor } from "../lib/colors";
import { useTheme } from "../lib/theme";
import {
  dayKey,
  dayKeysBetween,
  fmtCost,
  fmtDayLabel,
  fmtDuration,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "../lib/time";

type Preset = "today" | "week" | "month" | "custom";

interface Props {
  folders: Folder[];
  projects: Project[];
  currency: string;
  refreshKey: number;
}

export default function ReportsView(p: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "it" ? "it-IT" : "en-US";
  const { resolved } = useTheme();
  // palette dataviz: stessa tinta, step calibrato per superficie chiara/scura
  const chart =
    resolved === "dark"
      ? { bar: "#3987e5", grid: "#2e2e2c", tick: "#c3c2b7", cursor: "rgba(255,255,255,0.06)" }
      : { bar: "#2a78d6", grid: "#eeedeb", tick: "#52514e", cursor: "rgba(0,0,0,0.04)" };

  const [preset, setPreset] = useState<Preset>("week");
  const todayStr = toDateInput(new Date());
  const [customFrom, setCustomFrom] = useState(todayStr);
  const [customTo, setCustomTo] = useState(todayStr);
  const [folderId, setFolderId] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  const now = new Date();
  const [from, to] = useMemo((): [number, number] => {
    const end = Math.floor(Date.now() / 1000);
    switch (preset) {
      case "today":
        return [startOfDay(now), end];
      case "week":
        return [startOfWeek(now), end];
      case "month":
        return [startOfMonth(now), end];
      case "custom": {
        const f = fromDateInput(customFrom);
        const t2 = fromDateInput(customTo) + 86400 - 1;
        return [f, Math.max(f, t2)];
      }
    }
  }, [preset, customFrom, customTo, p.refreshKey]);

  useEffect(() => {
    api.entriesRange(from, to + 1).then(setEntries);
  }, [from, to, p.refreshKey]);

  const projectById = useMemo(
    () => new Map(p.projects.map((pr) => [pr.id, pr])),
    [p.projects],
  );

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (projectId !== "all") return e.projectId === projectId;
        if (folderId !== "all") {
          return projectById.get(e.projectId)?.folderId === folderId;
        }
        return true;
      }),
    [entries, projectId, folderId, projectById],
  );

  const cost = (e: TimeEntry) =>
    ((projectById.get(e.projectId)?.hourlyRate ?? 0) * e.durationSecs) / 3600;

  const totals = useMemo(() => {
    let secs = 0;
    let money = 0;
    const days = new Set<string>();
    for (const e of filtered) {
      secs += e.durationSecs;
      money += cost(e);
      days.add(dayKey(e.startedAt));
    }
    return { secs, money, days: days.size };
  }, [filtered]);

  const byDay = useMemo(() => {
    const map = new Map<string, { secs: number; money: number }>();
    for (const e of filtered) {
      const k = dayKey(e.startedAt);
      const cur = map.get(k) ?? { secs: 0, money: 0 };
      cur.secs += e.durationSecs;
      cur.money += cost(e);
      map.set(k, cur);
    }
    return map;
  }, [filtered]);

  const chartData = useMemo(
    () =>
      dayKeysBetween(from, to).map((k) => ({
        day: k,
        label: fmtDayLabel(k, locale),
        hours: (byDay.get(k)?.secs ?? 0) / 3600,
        secs: byDay.get(k)?.secs ?? 0,
        money: byDay.get(k)?.money ?? 0,
      })),
    [byDay, from, to, locale],
  );

  const byProject = useMemo(() => {
    const map = new Map<string, { secs: number; money: number }>();
    for (const e of filtered) {
      const cur = map.get(e.projectId) ?? { secs: 0, money: 0 };
      cur.secs += e.durationSecs;
      cur.money += cost(e);
      map.set(e.projectId, cur);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ project: projectById.get(id), ...v }))
      .filter((r) => r.project)
      .sort((a, b) => b.secs - a.secs);
  }, [filtered, projectById]);

  const maxProjectSecs = byProject[0]?.secs ?? 1;
  const visibleFolderProjects = p.projects.filter(
    (pr) => folderId === "all" || pr.folderId === folderId,
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="text-xl font-semibold">{t("reports.title")}</h1>

      {/* filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
          {(["today", "week", "month", "custom"] as Preset[]).map((pr) => (
            <button
              key={pr}
              onClick={() => setPreset(pr)}
              className={`rounded-md px-3 py-1 text-[13px] ${
                preset === pr
                  ? "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {t(`reports.${pr}`)}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5 text-sm">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[13px] dark:border-neutral-600 dark:bg-neutral-800"
            />
            <span className="text-neutral-400">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[13px] dark:border-neutral-600 dark:bg-neutral-800"
            />
          </div>
        )}
        <select
          value={folderId}
          onChange={(e) => {
            setFolderId(e.target.value);
            setProjectId("all");
          }}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-[13px] dark:border-neutral-600 dark:bg-neutral-800"
        >
          <option value="all">{t("reports.allFolders")}</option>
          {p.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-[13px] dark:border-neutral-600 dark:bg-neutral-800"
        >
          <option value="all">{t("reports.allProjects")}</option>
          {visibleFolderProjects.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.name}
            </option>
          ))}
        </select>
      </div>

      {/* stat tiles */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatTile label={t("reports.totalTime")} value={fmtDuration(totals.secs)} />
        <StatTile
          label={t("reports.totalCost")}
          value={fmtCost(totals.money, p.currency, locale)}
        />
        <StatTile label={t("reports.daysWorked")} value={String(totals.days)} />
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          {t("reports.noData")}
        </p>
      ) : (
        <>
          {/* time per day */}
          <h2 className="mb-2 mt-8 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {t("reports.byDay")}
          </h2>
          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={chart.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: chart.tick }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: chart.tick }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}h`}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: chart.cursor }}
                  content={<DayTooltip currency={p.currency} locale={locale} />}
                />
                <Bar
                  dataKey="hours"
                  fill={chart.bar}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* by project */}
          <h2 className="mb-2 mt-8 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {t("reports.byProject")}
          </h2>
          <div className="space-y-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
            {byProject.map(({ project, secs, money }) => (
              <div key={project!.id} className="flex items-center gap-3 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: projectColor(project!.color, project!.id),
                  }}
                />
                <span className="w-44 truncate">{project!.name}</span>
                <div className="h-3.5 flex-1 rounded-sm bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(1, (secs / maxProjectSecs) * 100)}%`,
                      backgroundColor: projectColor(project!.color, project!.id),
                    }}
                  />
                </div>
                <span className="w-20 text-right font-medium tabular-nums">
                  {fmtDuration(secs)}
                </span>
                <span className="w-24 text-right text-neutral-500 tabular-nums">
                  {fmtCost(money, p.currency, locale)}
                </span>
              </div>
            ))}
          </div>

          {/* table */}
          <h2 className="mb-2 mt-8 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {t("reports.day")} / {t("reports.time")} / {t("reports.cost")}
          </h2>
          <table className="w-full overflow-hidden rounded-xl border border-neutral-200 text-sm dark:border-neutral-700">
            <thead>
              <tr className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-800/60">
                <th className="px-4 py-2 font-medium">{t("reports.day")}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t("reports.time")}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t("reports.cost")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {[...byDay.entries()]
                .sort((a, b) => (a[0] < b[0] ? 1 : -1))
                .map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-4 py-2">{fmtDayLabel(k, locale)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtDuration(v.secs)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                      {fmtCost(v.money, p.currency, locale)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function DayTooltip({
  active,
  payload,
  currency,
  locale,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; secs: number; money: number } }>;
  currency: string;
  locale: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-800">
      <p className="font-medium">{d.label}</p>
      <p className="mt-0.5 tabular-nums">{fmtDuration(d.secs)}</p>
      <p className="tabular-nums text-neutral-500">
        {fmtCost(d.money, currency, locale)}
      </p>
    </div>
  );
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateInput(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}
