import { useTranslation } from "react-i18next";
import type { Folder, Project, TimerSnapshot } from "../lib/types";
import { projectColor } from "../lib/colors";
import {
  ChartIcon,
  FolderIcon,
  GearIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "./Icons";

export type View = "project" | "reports" | "settings";

interface Props {
  folders: Folder[];
  projects: Project[];
  view: View;
  selectedId: string | null;
  timer: TimerSnapshot;
  onNav: (v: View) => void;
  onSelectProject: (id: string) => void;
  onNewFolder: () => void;
  onRenameFolder: (f: Folder) => void;
  onDeleteFolder: (f: Folder) => void;
  onNewProject: (folderId: string) => void;
  onStart: (projectId: string) => void;
}

export default function Sidebar(p: Props) {
  const { t } = useTranslation();

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 pro:border-[#44475a] pro:bg-[#21222c]">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-base font-bold tracking-wide text-neutral-700 dark:text-neutral-200 pro:text-[#f8f8f2]">
          TinyTime
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="mb-1 flex items-center justify-between px-2 pt-2">
          <span className="text-sm font-semibold uppercase tracking-wider text-neutral-500 pro:text-[#bd93f9]">
            {t("folders.title")}
          </span>
          <button
            title={t("folders.new")}
            onClick={p.onNewFolder}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 pro:text-[#b9b9c8] pro:hover:bg-[#343746] pro:hover:text-[#8be9fd]"
          >
            <PlusIcon size={14} />
          </button>
        </div>

        {p.folders.length === 0 && (
          <p className="px-2 py-3 text-sm text-neutral-500">
            {t("folders.empty")}
          </p>
        )}

        {p.folders.map((folder) => {
          const items = p.projects.filter(
            (pr) => pr.folderId === folder.id && !pr.archived,
          );
          return (
            <div key={folder.id} className="mb-2">
              <div className="group flex items-center gap-1.5 rounded px-2 py-1 text-neutral-600 dark:text-neutral-300 pro:text-[#d7d7e2]">
                <span style={{ color: folder.color ?? undefined }}>
                  <FolderIcon size={13} />
                </span>
                <span className="flex-1 truncate text-base font-medium">
                  {folder.name}
                </span>
                <span className="hidden gap-0.5 group-hover:flex">
                  <button
                    title={t("projects.new")}
                    onClick={() => p.onNewProject(folder.id)}
                    className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 pro:text-[#b9b9c8] pro:hover:bg-[#44475a] pro:hover:text-[#50fa7b]"
                  >
                    <PlusIcon size={13} />
                  </button>
                  <button
                    title={t("folders.rename")}
                    onClick={() => p.onRenameFolder(folder)}
                    className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 pro:text-[#b9b9c8] pro:hover:bg-[#44475a] pro:hover:text-[#8be9fd]"
                  >
                    <PencilIcon size={13} />
                  </button>
                  <button
                    title={t("folders.delete")}
                    onClick={() => p.onDeleteFolder(folder)}
                    className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-red-600 dark:hover:bg-neutral-700 pro:text-[#b9b9c8] pro:hover:bg-[#44475a] pro:hover:text-[#ff5555]"
                  >
                    <TrashIcon size={13} />
                  </button>
                </span>
              </div>

              {items.map((project) => {
                const active =
                  p.view === "project" && p.selectedId === project.id;
                const running =
                  p.timer.projectId === project.id &&
                  p.timer.status !== "idle";
                return (
                  <div
                    key={project.id}
                    onClick={() => p.onSelectProject(project.id)}
                    className={`group ml-3 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-base ${
                      active
                        ? "bg-white font-medium shadow-sm dark:bg-neutral-800 pro:bg-[#44475a] pro:text-[#f8f8f2]"
                        : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60 pro:text-[#d7d7e2] pro:hover:bg-[#343746]"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: projectColor(
                          project.color,
                          project.id,
                        ),
                      }}
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                    {running ? (
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          p.timer.status === "running"
                            ? "animate-pulse bg-green-600"
                            : "bg-amber-500"
                        }`}
                      />
                    ) : (
                      <button
                        title={t("timer.start")}
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onStart(project.id);
                        }}
                        className="hidden rounded p-0.5 text-neutral-500 hover:text-green-700 group-hover:block dark:hover:text-green-400 pro:text-[#b9b9c8] pro:hover:text-[#50fa7b]"
                      >
                        <PlayIcon size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && (
                <p className="ml-5 py-1 text-sm text-neutral-400 dark:text-neutral-600">
                  {t("projects.empty")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <nav className="border-t border-neutral-200 p-2 dark:border-neutral-800 pro:border-[#44475a]">
        {(
          [
            ["reports", t("nav.reports"), <ChartIcon key="c" size={15} />],
            ["settings", t("nav.settings"), <GearIcon key="g" size={15} />],
          ] as const
        ).map(([v, label, icon]) => (
          <button
            key={v}
            onClick={() => p.onNav(v)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-base ${
              p.view === v
                ? "bg-white font-medium shadow-sm dark:bg-neutral-800 pro:bg-[#44475a] pro:text-[#f8f8f2]"
                : "text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60 pro:text-[#d7d7e2] pro:hover:bg-[#343746]"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
