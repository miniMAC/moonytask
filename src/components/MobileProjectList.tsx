import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Folder,
  MasterSharedData,
  Project,
  TimerSnapshot,
} from "../lib/types";
import { projectColor } from "../lib/colors";
import SharedFolderList from "./SharedFolderList";
import {
  ChevronIcon,
  FolderIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "./Icons";

interface Props {
  folders: Folder[];
  projects: Project[];
  timer: TimerSnapshot;
  sharedData: MasterSharedData | null;
  folderScope: "personal" | "shared";
  onFolderScopeChange: (scope: "personal" | "shared") => void;
  onRefreshShared: () => void;
  collapsedFolderIds: ReadonlySet<string>;
  onFolderCollapsedChange: (folderId: string, collapsed: boolean) => void;
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
  const [query, setQuery] = useState("");
  const queryNorm = query.trim().toLocaleLowerCase();
  const visibleFolders = queryNorm
    ? p.folders.filter((folder) =>
        p.projects.some(
          (project) =>
            project.folderId === folder.id &&
            !project.archived &&
            project.name.toLocaleLowerCase().includes(queryNorm),
        ),
      )
    : p.folders;

  return (
    <div className="px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-wide text-neutral-700 dark:text-neutral-200 pro:text-[#f8f8f2]">
          MoonyTask
        </h1>
        {p.folderScope === "personal" && (
          <button
            onClick={p.onNewFolder}
            className="flex h-11 items-center gap-1.5 rounded-lg border border-neutral-300 px-4 text-base font-medium dark:border-neutral-600 pro:border-[#44475a]"
          >
            <PlusIcon size={14} />
            {t("folders.new")}
          </button>
        )}
      </div>

      {p.sharedData && (
        <div className="mb-3 grid grid-cols-2 rounded-xl bg-neutral-100 p-1 text-base font-semibold dark:bg-neutral-800 pro:bg-[#343746]">
          {(["personal", "shared"] as const).map((scope) => (
            <button
              key={scope}
              onClick={() => p.onFolderScopeChange(scope)}
              className={`min-h-10 rounded-lg ${
                p.folderScope === scope
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white pro:bg-[#44475a] pro:text-[#f8f8f2]"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {t(`folders.${scope}`)}
            </button>
          ))}
        </div>
      )}

      <label className="relative mb-4 block">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-400">
          <SearchIcon size={18} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            p.folderScope === "shared"
              ? t("projects.searchShared")
              : t("projects.search")
          }
          className="h-12 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-3 text-base outline-none transition placeholder:text-neutral-400 focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-800/60 pro:border-[#44475a] pro:bg-[#21222c] pro:text-[#f8f8f2] pro:focus:border-[#bd93f9]"
        />
      </label>

      {p.folderScope === "shared" && p.sharedData ? (
        <>
          <div className="mb-3 flex justify-end">
            <button
              onClick={p.onRefreshShared}
              className="min-h-10 px-2 text-sm font-semibold text-blue-600 dark:text-blue-400 pro:text-[#8be9fd]"
            >
              {t("common.refresh")}
            </button>
          </div>
          <SharedFolderList data={p.sharedData} query={query} mobile />
        </>
      ) : (
        <>
      {p.folders.length === 0 && !queryNorm && (
        <p className="py-6 text-center text-base text-neutral-500">
          {t("folders.empty")}
        </p>
      )}

      {queryNorm && visibleFolders.length === 0 && (
        <p className="py-6 text-center text-base text-neutral-500">
          {t("projects.noResults")}
        </p>
      )}

      {visibleFolders.map((folder) => {
        const items = p.projects.filter(
          (project) =>
            project.folderId === folder.id &&
            !project.archived &&
            (!queryNorm ||
              project.name.toLocaleLowerCase().includes(queryNorm)),
        );
        const collapsed = p.collapsedFolderIds.has(folder.id);
        const showContents = Boolean(queryNorm) || !collapsed;
        return (
          <div key={folder.id} className="mb-4">
            <div className="flex items-center gap-2 px-1 py-1.5 text-neutral-600 dark:text-neutral-300 pro:text-[#d7d7e2]">
              <button
                type="button"
                aria-expanded={showContents}
                disabled={Boolean(queryNorm)}
                onClick={() =>
                  p.onFolderCollapsedChange(folder.id, !collapsed)
                }
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className={`shrink-0 text-neutral-400 transition-transform ${
                    showContents ? "rotate-90" : ""
                  }`}
                >
                  <ChevronIcon size={14} />
                </span>
                <span
                  className="shrink-0"
                  style={{ color: folder.color ?? undefined }}
                >
                  <FolderIcon size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-semibold">
                  {folder.name}
                </span>
              </button>
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

            {showContents && (
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
            )}
          </div>
        );
      })}
        </>
      )}
    </div>
  );
}
