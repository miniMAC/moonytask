import { useTranslation } from "react-i18next";
import type { Folder, Project, TimerSnapshot } from "../lib/types";
import { projectColor } from "../lib/colors";
import {
  FolderIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "./Icons";

interface Props {
  folders: Folder[];
  projects: Project[];
  timer: TimerSnapshot;
  onSelectProject: (id: string) => void;
  onNewFolder: () => void;
  onRenameFolder: (f: Folder) => void;
  onDeleteFolder: (f: Folder) => void;
  onNewProject: (folderId: string) => void;
  onStart: (projectId: string) => void;
}

// lista progetti a schermo intero per mobile: tap target grandi,
// azioni sempre visibili (niente hover), niente drag&drop
export default function MobileProjectList(p: Props) {
  const { t } = useTranslation();

  return (
    <div className="px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-wide text-neutral-700 dark:text-neutral-200 pro:text-[#f8f8f2]">
          MoonyTask
        </h1>
        <button
          onClick={p.onNewFolder}
          className="flex h-11 items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-base font-medium dark:border-neutral-600 pro:border-[#44475a]"
        >
          <PlusIcon size={14} />
          {t("folders.new")}
        </button>
      </div>

      {p.folders.length === 0 && (
        <p className="py-6 text-center text-base text-neutral-500">
          {t("folders.empty")}
        </p>
      )}

      {p.folders.map((folder) => {
        const items = p.projects.filter(
          (pr) => pr.folderId === folder.id && !pr.archived,
        );
        return (
          <div key={folder.id} className="mb-4">
            <div className="flex items-center gap-2 px-1 py-1.5 text-neutral-600 dark:text-neutral-300 pro:text-[#d7d7e2]">
              <span style={{ color: folder.color ?? undefined }}>
                <FolderIcon size={15} />
              </span>
              <span className="flex-1 truncate text-base font-semibold">
                {folder.name}
              </span>
              <button
                title={t("projects.new")}
                onClick={() => p.onNewProject(folder.id)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-200 dark:active:bg-neutral-700 pro:text-[#b9b9c8]"
              >
                <PlusIcon size={17} />
              </button>
              <button
                title={t("folders.rename")}
                onClick={() => p.onRenameFolder(folder)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-200 dark:active:bg-neutral-700 pro:text-[#b9b9c8]"
              >
                <PencilIcon size={16} />
              </button>
              <button
                title={t("folders.delete")}
                onClick={() => p.onDeleteFolder(folder)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-200 active:text-red-600 dark:active:bg-neutral-700 pro:text-[#b9b9c8]"
              >
                <TrashIcon size={16} />
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800/60 pro:border-[#44475a] pro:bg-[#21222c]">
              {items.length === 0 && (
                <p className="px-4 py-3 text-sm text-neutral-400 dark:text-neutral-500">
                  {t("projects.empty")}
                </p>
              )}
              {items.map((project, i) => {
                const running =
                  p.timer.projectId === project.id && p.timer.status !== "idle";
                return (
                  <div
                    key={project.id}
                    className={`flex items-center gap-3 pl-4 pr-2 ${
                      i > 0
                        ? "border-t border-neutral-100 dark:border-neutral-700/60 pro:border-[#44475a]"
                        : ""
                    }`}
                  >
                    <button
                      onClick={() => p.onSelectProject(project.id)}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{
                          backgroundColor: projectColor(
                            project.color,
                            project.id,
                          ),
                        }}
                      />
                      <span className="flex-1 truncate text-base">
                        {project.name}
                      </span>
                    </button>
                    {running ? (
                      <span className="flex h-11 w-11 items-center justify-center">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            p.timer.status === "running"
                              ? "animate-pulse bg-green-600"
                              : "bg-amber-500"
                          }`}
                        />
                      </span>
                    ) : (
                      <button
                        title={t("timer.start")}
                        onClick={() => p.onStart(project.id)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-green-600 active:bg-green-50 dark:text-green-400 dark:active:bg-green-950/40 pro:text-[#50fa7b]"
                      >
                        <PlayIcon size={18} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
