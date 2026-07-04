import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Folder } from "../lib/types";
import * as api from "../lib/api";
import { PROJECT_COLORS } from "../lib/colors";
import Modal from "./Modal";

export type FolderModalState =
  | { mode: "create" }
  | { mode: "rename"; folder: Folder };

export default function FolderModal({
  state,
  onClose,
  onSaved,
}: {
  state: FolderModalState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const editing = state.mode === "rename" ? state.folder : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState<string | null>(editing?.color ?? null);

  const save = async () => {
    if (!name.trim()) return;
    if (editing) {
      await api.folderUpdate(editing.id, name.trim(), color);
    } else {
      await api.folderCreate(name.trim(), color);
    }
    onSaved();
  };

  return (
    <Modal
      title={editing ? t("folders.rename") : t("folders.new")}
      onClose={onClose}
    >
      <input
        autoFocus
        value={name}
        placeholder={t("folders.name")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
      />
      <div className="flex gap-2 pt-3">
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c === color ? null : c)}
            className={`h-6 w-6 rounded-full border-2 ${
              color === c
                ? "border-neutral-800 dark:border-white"
                : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={save}
          disabled={!name.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t("common.save")}
        </button>
      </div>
    </Modal>
  );
}
