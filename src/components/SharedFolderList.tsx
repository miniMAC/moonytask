import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MasterSharedData } from "../lib/types";
import { projectColor } from "../lib/colors";
import { ChevronIcon, FolderIcon } from "./Icons";

interface Props {
  data: MasterSharedData;
  query?: string;
  mobile?: boolean;
}

export default function SharedFolderList({
  data,
  query = "",
  mobile = false,
}: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const normalized = query.trim().toLocaleLowerCase();
  const visibleMembers = data.members
    .map((member) => {
      const snapshot = member.snapshot;
      const folders = (snapshot?.folders ?? []).filter((folder) => {
        if (!normalized) return true;
        const owner = `${member.account.displayName ?? ""} ${member.account.email}`;
        const projects = (snapshot?.projects ?? []).filter(
          (project) => project.folderId === folder.id && !project.archived,
        );
        return (
          owner.toLocaleLowerCase().includes(normalized) ||
          folder.name.toLocaleLowerCase().includes(normalized) ||
          projects.some((project) =>
            project.name.toLocaleLowerCase().includes(normalized),
          )
        );
      });
      return { member, folders };
    })
    .filter(({ member, folders }) => {
      if (!normalized) return true;
      const owner = `${member.account.displayName ?? ""} ${member.account.email}`;
      return (
        owner.toLocaleLowerCase().includes(normalized) || folders.length > 0
      );
    });

  if (data.members.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-neutral-500">
        {t("folders.sharedEmpty")}
      </p>
    );
  }
  if (visibleMembers.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-neutral-500">
        {t("projects.noResults")}
      </p>
    );
  }

  return (
    <div className={mobile ? "space-y-5" : "space-y-4"}>
      {visibleMembers.map(({ member, folders }) => (
        <section key={member.associationId}>
          <div className={mobile ? "mb-2 px-1" : "mb-1 px-2"}>
            <p className="truncate text-sm font-bold text-neutral-700 dark:text-neutral-200 pro:text-[#f8f8f2]">
              {member.account.displayName || member.account.email}
            </p>
            {member.account.displayName && (
              <p className="truncate text-xs text-neutral-500 pro:text-[#b9b9c8]">
                {member.account.email}
              </p>
            )}
          </div>

          {!member.snapshot ? (
            <p className="px-2 py-2 text-sm text-neutral-400">
              {t("folders.sharedWaiting")}
            </p>
          ) : folders.length === 0 ? (
            <p className="px-2 py-2 text-sm text-neutral-400">
              {normalized
                ? t("projects.noResults")
                : t("folders.sharedNoneSelected")}
            </p>
          ) : (
            folders.map((folder) => {
              const key = `${member.associationId}:${folder.id}`;
              const isCollapsed = collapsed.has(key) && !normalized;
              const ownerMatches = `${member.account.displayName ?? ""} ${
                member.account.email
              }`
                .toLocaleLowerCase()
                .includes(normalized);
              const folderMatches = folder.name
                .toLocaleLowerCase()
                .includes(normalized);
              const projects = (member.snapshot?.projects ?? []).filter(
                (project) =>
                  project.folderId === folder.id &&
                  !project.archived &&
                  (!normalized ||
                    ownerMatches ||
                    folderMatches ||
                    project.name.toLocaleLowerCase().includes(normalized)),
              );
              return (
                <div
                  key={key}
                  className={
                    mobile
                      ? "mb-3 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800/60 pro:border-[#44475a] pro:bg-[#21222c]"
                      : "mb-1 rounded-md"
                  }
                >
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className={`flex w-full min-w-0 items-center gap-2 text-left text-neutral-700 dark:text-neutral-200 pro:text-[#d7d7e2] ${
                      mobile ? "min-h-12 px-3" : "px-2 py-1.5"
                    }`}
                  >
                    <span
                      className={`shrink-0 text-neutral-400 transition-transform ${
                        isCollapsed ? "" : "rotate-90"
                      }`}
                    >
                      <ChevronIcon size={mobile ? 14 : 12} />
                    </span>
                    <span
                      className="shrink-0"
                      style={{ color: folder.color ?? undefined }}
                    >
                      <FolderIcon size={mobile ? 15 : 13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {folder.name}
                    </span>
                    <span className="text-xs text-neutral-400">
                      {projects.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div>
                      {projects.length === 0 && (
                        <p className="px-5 py-2 text-sm text-neutral-400">
                          {t("projects.empty")}
                        </p>
                      )}
                      {projects.map((project) => (
                        <div
                          key={project.id}
                          className={`flex items-center gap-2 text-neutral-700 dark:text-neutral-200 pro:text-[#d7d7e2] ${
                            mobile
                              ? "min-h-12 border-t border-neutral-100 px-4 dark:border-neutral-700/60 pro:border-[#44475a]"
                              : "ml-3 rounded-md px-2 py-1.5 text-base"
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: projectColor(
                                project.color,
                                `${member.associationId}:${project.id}`,
                              ),
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {project.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      ))}
      <p className="px-2 text-xs text-neutral-400">
        {t("folders.sharedReadOnly")}
      </p>
    </div>
  );
}
