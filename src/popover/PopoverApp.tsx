import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTranslation } from "react-i18next";
import type {
  Folder,
  Project,
  RateProfile,
  TimerSnapshot,
  WatchSuggestion,
} from "../lib/types";
import * as api from "../lib/api";
import type { ProjectTotal } from "../lib/api";
import { PROJECT_COLORS, projectColor } from "../lib/colors";
import { useTheme } from "../lib/theme";
import { fmtClock, fmtHM } from "../lib/time";
import {
  FolderIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
} from "../components/Icons";

type Tab = "all" | "recent";
type CreateKind = "project" | "folder";
type ExportingFormat = api.ExportFormat | null;
type ProjectMenu = {
  project: Project;
  x: number;
  y: number;
} | null;

export default function PopoverApp() {
  const { t, i18n } = useTranslation();
  const { resolved } = useTheme();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [totals, setTotals] = useState<Map<string, ProjectTotal>>(new Map());
  const [timer, setTimer] = useState<TimerSnapshot>({
    status: "idle",
    projectId: null,
    projectName: null,
    elapsedSecs: 0,
  });
  const [tab, setTab] = useState<Tab>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [newName, setNewName] = useState("");
  const [newFolderId, setNewFolderId] = useState("");
  const [newRate, setNewRate] = useState("0");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<ExportingFormat>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<ProjectMenu>(null);
  const [reminder, setReminder] = useState<WatchSuggestion | null>(null);
  const [defaultRateProfile, setDefaultRateProfile] =
    useState<RateProfile | null>(null);

  const loadAll = useCallback(async () => {
    const [f, p, tot, snap] = await Promise.all([
      api.foldersList(),
      api.projectsList(),
      api.projectTotals(),
      api.timerGetState(),
    ]);
    setFolders(f);
    setProjects(p);
    setTotals(new Map(tot.map((x) => [x.projectId, x])));
    setTimer(snap);
  }, []);

  const loadRateProfileDefault = useCallback(async () => {
    const [profiles, defaultId] = await Promise.all([
      api.rateProfilesGet(),
      api.defaultRateProfileGet(),
    ]);
    setDefaultRateProfile(
      profiles.find((profile) => profile.id === defaultId) ?? null,
    );
  }, []);

  useEffect(() => {
    loadAll();
    loadRateProfileDefault();
    api.settingsGet("language").then((l) => {
      if (l && l !== i18n.language) i18n.changeLanguage(l);
    });
    const unTimer = listen<TimerSnapshot>("timer_state", (e) => {
      setTimer((prev) => {
        if (prev.status !== e.payload.status) loadAll();
        return e.payload;
      });
    });
    const unData = listen("data_changed", loadAll);
    const unSetting = listen<[string, string]>("setting_changed", (e) => {
      if (e.payload[0] === "language") i18n.changeLanguage(e.payload[1]);
      if (
        e.payload[0] === "rate_profiles" ||
        e.payload[0] === "default_rate_profile_id"
      ) {
        loadRateProfileDefault();
      }
    });
    const unReminder = listen<WatchSuggestion>("watcher_reminder", (e) => {
      setReminder(e.payload);
      window.setTimeout(() => setReminder(null), 10_000);
    });
    // ricarica quando il popover viene mostrato (riprende il focus)
    const unFocus = getCurrentWebviewWindow().onFocusChanged(
      ({ payload: focused }) => {
        if (focused) loadAll();
      },
    );
    return () => {
      unTimer.then((f) => f());
      unData.then((f) => f());
      unSetting.then((f) => f());
      unReminder.then((f) => f());
      unFocus.then((f) => f());
    };
  }, [loadAll, loadRateProfileDefault, i18n]);

  const active = projects.filter((p) => !p.archived);
  useEffect(() => {
    if (folders.length === 0) {
      setNewFolderId("");
      return;
    }
    if (!folders.some((folder) => folder.id === newFolderId)) {
      setNewFolderId(folders[0].id);
    }
  }, [folders, newFolderId]);

  const running = timer.status !== "idle";
  const runningProject = active.find((p) => p.id === timer.projectId) ?? null;

  // progetto in evidenza nell'header: quello attivo, altrimenti l'ultimo usato
  const headerProject = useMemo(() => {
    if (runningProject) return runningProject;
    let best: Project | null = null;
    let bestTs = 0;
    for (const p of active) {
      const ts = totals.get(p.id)?.lastUsed ?? 0;
      if (ts > bestTs) {
        bestTs = ts;
        best = p;
      }
    }
    return best ?? active[0] ?? null;
  }, [runningProject, active, totals]);

  const headerFolder = folders.find((f) => f.id === headerProject?.folderId);

  const recents = useMemo(
    () =>
      [...active]
        .map((p) => ({ p, ts: totals.get(p.id)?.lastUsed ?? 0 }))
        .filter((x) => x.ts > 0)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 8)
        .map((x) => x.p),
    [active, totals],
  );

  const projectTotal = (id: string) => {
    let secs = totals.get(id)?.totalSecs ?? 0;
    if (running && timer.projectId === id) secs += timer.elapsedSecs;
    return secs;
  };

  const folderTotal = (folderId: string) =>
    active
      .filter((p) => p.folderId === folderId)
      .reduce((sum, p) => sum + projectTotal(p.id), 0);

  const startProject = async (id: string) => {
    await api.timerStart(id);
  };

  const snoozeReminder = async (mode: 5 | 15 | "today") => {
    if (!reminder) return;
    const until =
      mode === "today"
        ? endOfTodayEpoch()
        : Math.floor(Date.now() / 1000) + mode * 60;
    await api.watcherSnooze(reminder.bundleId, until);
    setReminder(null);
  };

  const openProjectInMain = async (id: string) => {
    await emit("open_project", id);
    await api.openMain();
  };

  const resetQuickCreate = () => {
    setCreateKind(null);
    setNewName("");
    setNewRate(String(defaultRateProfile?.hourlyRate ?? 0));
    setNewColor(null);
    setSaving(false);
  };

  const saveQuickCreate = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    try {
      if (createKind === "folder") {
        const folder = await api.folderCreate(newName.trim(), newColor);
        setOpen((current) => new Set(current).add(folder.id));
        setNewFolderId(folder.id);
      } else if (createKind === "project" && newFolderId) {
        const hourlyRate = parseFloat(newRate.replace(",", ".")) || 0;
        const rateProfileId =
          defaultRateProfile && hourlyRate === defaultRateProfile.hourlyRate
            ? defaultRateProfile.id
            : null;
        await api.projectCreate(
          newFolderId,
          newName.trim(),
          hourlyRate,
          newColor,
          rateProfileId,
        );
        setOpen((current) => new Set(current).add(newFolderId));
      }
      await loadAll();
      resetQuickCreate();
    } finally {
      setSaving(false);
    }
  };

  const openQuickCreate = (kind: CreateKind) => {
    setCreateKind(kind);
    setCreateMenuOpen(false);
    setProjectMenu(null);
    setNewName("");
    setNewColor(null);
    setNewRate(
      String(kind === "project" ? (defaultRateProfile?.hourlyRate ?? 0) : 0),
    );
  };

  const openProjectMenu = (project: Project, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setCreateMenuOpen(false);
    setProjectMenu({
      project,
      x: Math.min(event.clientX, window.innerWidth - 154),
      y: Math.min(event.clientY, window.innerHeight - 92),
    });
  };

  const exportProject = async (format: api.ExportFormat) => {
    if (!projectMenu) return;
    const projectId = projectMenu.project.id;
    setExporting(format);
    setExportMessage(null);
    setProjectMenu(null);
    try {
      await api.projectExport(projectId, format);
      setExportMessage(t("popover.exported"));
    } catch {
      setExportMessage(t("popover.exportFailed"));
    } finally {
      setExporting(null);
    }
  };

  const headerColor = headerProject
    ? projectColor(headerProject.color, headerProject.id)
    : "#52514e";
  const isPro = resolved === "pro";
  const queryNorm = query.trim().toLowerCase();
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const searchResults = active.filter((project) => {
    if (!queryNorm) return true;
    const folderName = folderById.get(project.folderId)?.name ?? "";
    return `${project.name} ${folderName}`.toLowerCase().includes(queryNorm);
  });
  const headerBackground = isPro
    ? "linear-gradient(145deg, rgba(189,147,249,0.28), transparent 34%), linear-gradient(145deg, #21222c, #282a36 72%)"
    : `linear-gradient(145deg, ${colorWithAlpha(headerColor, 0.26)}, transparent 34%), linear-gradient(145deg, #252527, #111112 72%)`;
  const headerActionLabel =
    timer.status === "running"
      ? t("timer.pause")
      : timer.status === "paused"
        ? t("timer.resume")
        : t("timer.start");

  return (
    <div
      onMouseDown={() => {
        setProjectMenu(null);
        setCreateMenuOpen(false);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setProjectMenu(null);
        setCreateMenuOpen(false);
      }}
      className="flex h-screen flex-col overflow-hidden rounded-[14px] bg-neutral-50 text-neutral-950 shadow-[0_18px_44px_rgba(0,0,0,0.22)] dark:bg-neutral-950 dark:text-white pro:bg-[#282a36]"
    >
      {/* header */}
      <div
        className="relative overflow-hidden px-4 pb-4 pt-4 text-white"
        style={{ background: headerBackground }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/35" />
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (!headerProject) return;
              if (!running) startProject(headerProject.id);
              else if (timer.status === "running") api.timerPause();
              else api.timerResume();
            }}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_30px_rgba(0,0,0,0.28)] ring-1 ring-white/20 transition hover:scale-[1.03] hover:brightness-110 active:scale-95 disabled:opacity-50"
            style={{
              background:
                `linear-gradient(160deg, ${colorWithAlpha(headerColor, 0.94)}, ` +
                `${colorWithAlpha(headerColor, 0.68)})`,
            }}
            disabled={!headerProject}
            aria-label={headerActionLabel}
          >
            {timer.status === "running" ? (
              <PauseIcon size={22} />
            ) : (
              <PlayIcon size={22} />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <span
              className={`block font-mono text-[38px] font-light leading-none tabular-nums ${
                running ? "text-white" : "text-white/46"
              }`}
            >
              {fmtClock(running ? timer.elapsedSecs : 0)}
            </span>
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: headerColor }}
              />
              <p className="truncate text-[11px] font-semibold uppercase text-white/48">
                {headerFolder?.name ?? "—"}
              </p>
            </div>
            <p className="mt-0.5 truncate text-[15px] font-semibold text-white">
              {headerProject?.name ?? t("projects.empty")}
            </p>
          </div>

          {running && (
            <button
              title={t("timer.stop")}
              onClick={() => api.timerStop()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-white shadow-sm ring-1 ring-white/[0.16] transition hover:bg-red-500/90 active:scale-95"
            >
              <StopIcon size={14} />
            </button>
          )}
        </div>
      </div>

      {reminder && (
        <div className="mx-3 mt-3 rounded-lg bg-emerald-500 px-3 py-2 text-[12px] font-semibold text-white shadow-sm pro:bg-[#50fa7b] pro:text-[#282a36]">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate">{t("popover.reminderTitle")}</p>
              <p className="truncate text-[11px] font-medium opacity-85">
                {t("popover.reminderBody", { app: reminder.appName })}
              </p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {reminder.projectId && (
              <button
                onClick={async () => {
                  await startProject(reminder.projectId!);
                  setReminder(null);
                }}
                className="rounded-md bg-white/20 px-2 py-1 text-[11px] hover:bg-white/30 pro:bg-[#282a36]/15 pro:hover:bg-[#282a36]/25"
              >
                {t("timer.start")}
              </button>
            )}
            <button
              onClick={() => snoozeReminder(5)}
              className="rounded-md bg-white/14 px-2 py-1 text-[11px] hover:bg-white/24 pro:bg-[#282a36]/10 pro:hover:bg-[#282a36]/20"
            >
              {t("popover.snooze5")}
            </button>
            <button
              onClick={() => snoozeReminder(15)}
              className="rounded-md bg-white/14 px-2 py-1 text-[11px] hover:bg-white/24 pro:bg-[#282a36]/10 pro:hover:bg-[#282a36]/20"
            >
              {t("popover.snooze15")}
            </button>
            <button
              onClick={() => snoozeReminder("today")}
              className="rounded-md bg-white/14 px-2 py-1 text-[11px] hover:bg-white/24 pro:bg-[#282a36]/10 pro:hover:bg-[#282a36]/20"
            >
              {t("popover.ignoreToday")}
            </button>
          </div>
        </div>
      )}

      {/* tools */}
      <div className="space-y-2 px-3 pt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("popover.search")}
          className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-blue-500 dark:border-white/10 dark:bg-neutral-900 dark:text-white pro:border-[#44475a] pro:bg-[#21222c] pro:text-[#f8f8f2] pro:placeholder:text-[#b9b9c8] pro:focus:border-[#bd93f9]"
        />

        {exportMessage && (
          <p className="truncate px-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 pro:text-[#b9b9c8]">
            {exportMessage}
          </p>
        )}

        {createKind && (
          <div className="rounded-lg bg-white p-2 shadow-sm dark:bg-neutral-900 pro:bg-[#21222c]">
            <p className="mb-2 text-[11px] font-semibold uppercase text-neutral-400 pro:text-[#bd93f9]">
              {t("popover.quickCreate")}
            </p>
            <div className="space-y-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveQuickCreate()}
                placeholder={
                  createKind === "project"
                    ? t("popover.projectName")
                    : t("popover.folderName")
                }
                className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 dark:border-white/10 dark:bg-neutral-950 pro:border-[#44475a] pro:bg-[#282a36] pro:text-[#f8f8f2] pro:placeholder:text-[#b9b9c8] pro:focus:border-[#bd93f9]"
              />
              {createKind === "project" && (
                <div className="grid grid-cols-[1fr_62px] gap-2">
                  <select
                    value={newFolderId}
                    onChange={(e) => setNewFolderId(e.target.value)}
                    className="min-w-0 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[12px] outline-none dark:border-white/10 dark:bg-neutral-950 pro:border-[#44475a] pro:bg-[#282a36] pro:text-[#f8f8f2]"
                  >
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="decimal"
                    value={newRate}
                    onChange={(e) => setNewRate(e.target.value)}
                    placeholder={t("popover.rate")}
                    className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[12px] outline-none dark:border-white/10 dark:bg-neutral-950 pro:border-[#44475a] pro:bg-[#282a36] pro:text-[#f8f8f2]"
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewColor(color === newColor ? null : color)}
                      className={`h-5 w-5 rounded-full border-2 ${
                        color === newColor
                          ? "border-neutral-950 dark:border-white pro:border-[#f8f8f2]"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={resetQuickCreate}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 pro:text-[#b9b9c8] pro:hover:bg-[#343746]"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={saveQuickCreate}
                    disabled={
                      !newName.trim() ||
                      saving ||
                      (createKind === "project" && !newFolderId)
                    }
                    className="rounded-md bg-neutral-950 px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-45 dark:bg-white dark:text-neutral-950 pro:bg-[#bd93f9] pro:text-[#282a36]"
                  >
                    {t("common.save")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* tabs */}
      {!queryNorm && (
        <div className="px-4 pb-2 pt-3">
          <div className="flex rounded-lg bg-black/[0.055] p-1 shadow-inner dark:bg-white/[0.075] pro:bg-[#21222c]">
            {(["all", "recent"] as Tab[]).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`flex-1 rounded-md py-1.5 text-[12px] font-semibold transition ${
                  tab === tb
                    ? "bg-white text-neutral-950 shadow-sm ring-1 ring-black/5 dark:bg-neutral-800 dark:text-white dark:ring-white/10 pro:bg-[#44475a] pro:text-[#f8f8f2]"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white pro:text-[#b9b9c8] pro:hover:text-[#f8f8f2]"
                }`}
              >
                {t(`popover.${tb}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {queryNorm ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-neutral-400 pro:text-[#b9b9c8]">
              {t("popover.noResults")}
            </p>
          ) : (
            searchResults.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                timer={timer}
                total={projectTotal(project.id)}
                onStart={() => startProject(project.id)}
                onOpen={() => openProjectInMain(project.id)}
                onContextMenu={(event) => openProjectMenu(project, event)}
                subtitle={folderById.get(project.folderId)?.name}
              />
            ))
          )
        ) : tab === "all" ? (
          folders.map((folder) => {
            const items = active.filter((p) => p.folderId === folder.id);
            if (items.length === 0) return null;
            const expanded = open.has(folder.id);
            return (
              <div key={folder.id} className="mb-1">
                <button
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(folder.id)) n.delete(folder.id);
                      else n.add(folder.id);
                      return n;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 transition hover:bg-white hover:shadow-sm dark:hover:bg-white/[0.07] pro:hover:bg-[#343746]"
                >
                  <span
                    className={`text-[9px] text-neutral-400 transition-transform ${
                      expanded ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-black/5 dark:ring-white/10 pro:ring-[#44475a]"
                    style={{
                      backgroundColor: colorWithAlpha(
                        folder.color ?? "#8a8984",
                        0.13,
                      ),
                      color: folder.color ?? "#8a8984",
                    }}
                  >
                    <FolderIcon size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-semibold text-neutral-900 dark:text-white pro:text-[#f8f8f2]">
                      {folder.name}
                    </span>
                    <span className="block text-[11px] text-neutral-400 pro:text-[#b9b9c8]">
                      {items.length}
                    </span>
                  </span>
                  <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[12px] font-medium tabular-nums text-neutral-500 dark:bg-white/[0.07] dark:text-neutral-300 pro:bg-[#21222c] pro:text-[#8be9fd]">
                    {fmtHM(folderTotal(folder.id))}
                  </span>
                </button>
                {expanded &&
                  items.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      timer={timer}
                      total={projectTotal(project.id)}
                      onStart={() => startProject(project.id)}
                      onOpen={() => openProjectInMain(project.id)}
                      onContextMenu={(event) => openProjectMenu(project, event)}
                      indent
                    />
                  ))}
              </div>
            );
          })
        ) : recents.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-neutral-400">
            {t("projects.noEntries")}
          </p>
        ) : (
          recents.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              timer={timer}
              total={projectTotal(project.id)}
              onStart={() => startProject(project.id)}
              onOpen={() => openProjectInMain(project.id)}
              onContextMenu={(event) => openProjectMenu(project, event)}
              subtitle={folderById.get(project.folderId)?.name}
            />
          ))
        )}
      </div>

      {projectMenu && (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="fixed z-50 w-36 overflow-hidden rounded-lg bg-white py-1 text-[12px] font-semibold text-neutral-800 shadow-xl ring-1 ring-black/10 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10 pro:bg-[#21222c] pro:text-[#f8f8f2] pro:ring-[#44475a]"
          style={{ left: projectMenu.x, top: projectMenu.y }}
        >
          <p className="truncate px-3 py-1.5 text-[11px] font-semibold text-neutral-400 pro:text-[#bd93f9]">
            {projectMenu.project.name}
          </p>
          <button
            onClick={() => exportProject("csv")}
            disabled={exporting !== null}
            className="block w-full px-3 py-2 text-left hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800 pro:hover:bg-[#343746]"
          >
            {exporting === "csv" ? "..." : t("popover.exportCsv")}
          </button>
          <button
            onClick={() => exportProject("json")}
            disabled={exporting !== null}
            className="block w-full px-3 py-2 text-left hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800 pro:hover:bg-[#343746]"
          >
            {exporting === "json" ? "..." : t("popover.exportJson")}
          </button>
        </div>
      )}

      {/* footer */}
      <div className="relative flex items-center gap-2 border-t border-black/[0.08] bg-white px-3 py-2 dark:border-white/10 dark:bg-neutral-950 pro:border-[#44475a] pro:bg-[#21222c]">
        <div className="relative">
          <button
            title={t("popover.quickCreate")}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setProjectMenu(null);
              setCreateMenuOpen((open) => !open);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-950 text-white transition hover:bg-neutral-800 active:scale-95 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 pro:bg-[#50fa7b] pro:text-[#282a36] pro:hover:bg-[#8cff9f]"
          >
            <PlusIcon size={16} />
          </button>
          {createMenuOpen && (
            <div
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              className="absolute bottom-10 left-0 z-50 w-40 overflow-hidden rounded-lg bg-white py-1 text-[12px] font-semibold text-neutral-800 shadow-xl ring-1 ring-black/10 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10 pro:bg-[#21222c] pro:text-[#f8f8f2] pro:ring-[#44475a]"
            >
              <button
                onClick={() => openQuickCreate("project")}
                disabled={folders.length === 0}
                className="block w-full px-3 py-2 text-left hover:bg-neutral-100 disabled:opacity-45 dark:hover:bg-neutral-800 pro:hover:bg-[#343746]"
              >
                {t("popover.newProject")}
              </button>
              <button
                onClick={() => openQuickCreate("folder")}
                className="block w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 pro:hover:bg-[#343746]"
              >
                {t("popover.newFolder")}
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => api.openMain()}
          className="min-w-0 flex-1 rounded-lg py-2 text-[12px] font-semibold text-neutral-600 transition hover:bg-black/[0.045] hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/[0.08] dark:hover:text-white pro:text-[#f8f8f2] pro:hover:bg-[#343746]"
        >
          {t("popover.open")}
        </button>
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  timer,
  total,
  onStart,
  onOpen,
  onContextMenu,
  indent,
  subtitle,
}: {
  project: Project;
  timer: TimerSnapshot;
  total: number;
  onStart: () => void;
  onOpen: () => void;
  onContextMenu: (event: MouseEvent) => void;
  indent?: boolean;
  subtitle?: string;
}) {
  const isRunning =
    timer.projectId === project.id && timer.status === "running";
  const isPaused = timer.projectId === project.id && timer.status === "paused";
  const color = projectColor(project.color, project.id);

  return (
    <div
      onContextMenu={onContextMenu}
      className={`group flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition ${
        isRunning || isPaused
          ? "border-black/5 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.08] pro:border-[#bd93f9]/50 pro:bg-[#343746]"
          : "border-transparent hover:bg-white hover:shadow-sm dark:hover:bg-white/[0.06] pro:hover:bg-[#343746]"
      } ${
        indent ? "ml-6" : ""
      }`}
    >
      <button
        onClick={() => {
          if (isRunning) api.timerPause();
          else if (isPaused) api.timerResume();
          else onStart();
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_5px_12px_rgba(0,0,0,0.16)] transition hover:scale-105 active:scale-95"
        style={{
          background:
            `linear-gradient(160deg, ${colorWithAlpha(color, 0.95)}, ` +
            `${colorWithAlpha(color, 0.68)})`,
        }}
      >
        {isRunning ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
      </button>
      <button
        onClick={onOpen}
        className={`min-w-0 flex-1 text-left text-[13px] text-neutral-800 dark:text-neutral-100 pro:text-[#f8f8f2] ${
          isRunning || isPaused ? "font-semibold" : "font-medium"
        }`}
      >
        <span className="block truncate">{project.name}</span>
        {subtitle && (
          <span className="block truncate text-[11px] font-medium text-neutral-400 pro:text-[#b9b9c8]">
            {subtitle}
          </span>
        )}
      </button>
      <span className="rounded-full px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-neutral-500 dark:text-neutral-300 pro:text-[#8be9fd]">
        {fmtHM(total)}
      </span>
    </div>
  );
}

function colorWithAlpha(color: string, alpha: number): string {
  const raw = color.trim();
  const match = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return raw;

  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : match[1];
  const value = Number.parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function endOfTodayEpoch(): number {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return Math.floor(end.getTime() / 1000);
}
