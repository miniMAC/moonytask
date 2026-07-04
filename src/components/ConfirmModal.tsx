import { useTranslation } from "react-i18next";
import Modal from "./Modal";

export default function ConfirmModal({
  title,
  body,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">{body}</p>
      <div className="flex justify-end gap-2 pt-4">
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={onConfirm}
          className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          {t("common.delete")}
        </button>
      </div>
    </Modal>
  );
}
