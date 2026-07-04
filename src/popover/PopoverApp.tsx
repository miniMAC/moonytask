import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTranslation } from "react-i18next";
import type { Folder, Project, TimerSnapshot } from "../lib/types";
import * as api from "../lib/api";
import type { ProjectTotal } from "../lib/api";
import { projectColor } from "../lib/colors";
import { fmtClock, fmtHM } from "../lib/time";
import {
  FolderIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "../components/Icons";

type Tab = "all" | "recent";

export default function PopoverApp() {
  const { t, i18n } = useTranslation();
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

  useEffect(() => {
    loadAll();
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
      unFocus.then((f) => f());
    };
  }, []);

  const active = projects.filter((p) => !p.archived);
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

  const openProjectInMain = async (id: string) => {
    await emit("open_project", id);
    await api.openMain();
  };

  const headerColor = headerProject
    ? projectColor(headerProject.color, headerProject.id)
    : "#52514e";

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/95">
      {/* header */}
      <div className="flex items-stretch bg-neutral-900 text-white dark:bg-black/60">
        <button
          onClick={() => {
            if (!headerProject) return;
            if (!running) startProject(headerProject.id);
            else if (timer.status === "running") api.timerPause();
            else api.timerResume();
          }}
          className="flex w-24 items-center justify-center transition-colors hover:brightness-110"
          style={{ backgroundColor: headerColor }}
          disabled={!headerProject}
        >
          {timer.status === "running" ? (
            <PauseIcon size={30} />
          ) : (
            <PlayIcon size={30} />
          )}
        </button>
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="flex items-center justify-between">
            <span
              className={`font-mono text-3xl font-light tabular-nums ${
                running ? "" : "text-neutral-500"
              }`}
            >
              {fmtClock(running ? timer.elapsedSecs : 0)}
            </span>
            {running && (
              <button
                title={t("timer.stop")}
                onClick={() => api.timerStop()}
                className="rounded-full bg-red-500/80 p-2 hover:bg-red-500"
              >
                <StopIcon size={14} />
              </button>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-neutral-500">
            {headerFolder?.name ?? "—"}
          </p>
          <p className="truncate text-[15px] font-medium">
            {headerProject?.name ?? t("projects.empty")}
          </p>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 px-3 pb-1 pt-3">
        {(["all", "recent"] as Tab[]).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`flex-1 rounded-lg py-1 text-[12px] font-medium ${
              tab === tb
                ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {t(`popover.${tb}`)}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto px-2 pb-1">
        {tab === "all" ? (
          folders.map((folder) => {
            const items = active.filter((p) => p.folderId === folder.id);
            if (items.length === 0) return null;
            const expanded = open.has(folder.id);
            return (
              <div key={folder.id}>
                <button
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(folder.id)) n.delete(folder.id);
                      else n.add(folder.id);
                      return n;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span
                    className={`text-[9px] text-neutral-400 transition-transform ${
                      expanded ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  <span style={{ color: folder.color ?? "#8a8984" }}>
                    <FolderIcon size={15} />
                  </span>
                  <span className="flex-1 truncate text-left text-[13px] font-semibold">
                    {folder.name}
                  </span>
                  <span className="text-[12px] tabular-nums text-neutral-500">
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
            />
          ))
        )}
      </div>

      {/* footer */}
      <div className="border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <button
          onClick={() => api.openMain()}
          className="w-full rounded-lg py-1.5 text-[12px] font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
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
  indent,
}: {
  project: Project;
  timer: TimerSnapshot;
  total: number;
  onStart: () => void;
  onOpen: () => void;
  indent?: boolean;
}) {
  const isRunning =
    timer.projectId === project.id && timer.status === "running";
  const isPaused = timer.projectId === project.id && timer.status === "paused";
  const color = projectColor(project.color, project.id);

  return (
    <div
      className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        indent ? "ml-6" : ""
      }`}
    >
      <button
        onClick={() => {
          if (isRunning) api.timerPause();
          else if (isPaused) api.timerResume();
          else onStart();
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-transform hover:scale-105"
        style={{ backgroundColor: color }}
      >
        {isRunning ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
      </button>
      <button
        onClick={onOpen}
        className={`min-w-0 flex-1 truncate text-left text-[13px] ${
          isRunning || isPaused ? "font-semibold" : ""
        }`}
      >
        {project.name}
      </button>
      <span className="text-[12px] tabular-nums text-neutral-500">
        {fmtHM(total)}
      </span>
    </div>
  );
}
