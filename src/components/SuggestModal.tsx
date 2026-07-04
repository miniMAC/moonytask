import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Project, WatchSuggestion } from "../lib/types";
import * as api from "../lib/api";
import Modal from "./Modal";

export default function SuggestModal({
  suggestion,
  projects,
  onClose,
}: {
  suggestion: WatchSuggestion;
  projects: Project[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const active = projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState(
    suggestion.projectId ?? active[0]?.id ?? "",
  );

  const start = async () => {
    if (!projectId) return;
    await api.timerStart(projectId);
    onClose();
  };

  return (
    <Modal title={t("suggest.title")} onClose={onClose}>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {t("suggest.body", { app: suggestion.appName })}
      </p>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-neutral-600">
          {t("suggest.project")}
        </span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
        >
          {active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2 pt-4">
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          {t("suggest.dismiss")}
        </button>
        <button
          onClick={start}
          disabled={!projectId}
          className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {t("suggest.start")}
        </button>
      </div>
    </Modal>
  );
}
