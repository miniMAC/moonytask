import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Folder, Project } from "../lib/types";
import * as api from "../lib/api";
import { PROJECT_COLORS } from "../lib/colors";
import Modal from "./Modal";

export type ProjectModalState =
  | { mode: "create"; folderId: string }
  | { mode: "edit"; project: Project };

export default function ProjectModal({
  state,
  folders,
  onClose,
  onSaved,
}: {
  state: ProjectModalState;
  folders: Folder[];
  onClose: () => void;
  onSaved: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const editing = state.mode === "edit" ? state.project : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [folderId, setFolderId] = useState(
    editing?.folderId ?? (state.mode === "create" ? state.folderId : ""),
  );
  const [rate, setRate] = useState(String(editing?.hourlyRate ?? 0));
  const [color, setColor] = useState<string | null>(editing?.color ?? null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const hourlyRate = parseFloat(rate.replace(",", ".")) || 0;
      if (editing) {
        await api.projectUpdate({
          ...editing,
          name: name.trim(),
          folderId,
          hourlyRate,
          color,
        });
        onSaved(editing.id);
      } else {
        const p = await api.projectCreate(folderId, name.trim(), hourlyRate, color);
        onSaved(p.id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? t("projects.edit") : t("projects.new")}
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600">
            {t("projects.name")}
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
          />
        </label>

        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              {t("projects.folder")}
            </span>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block w-32">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              {t("projects.hourlyRate")}
            </span>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
            />
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c === color ? null : c)}
              className={`h-6 w-6 rounded-full border-2 ${
                color === c ? "border-neutral-800 dark:border-white" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || busy}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
