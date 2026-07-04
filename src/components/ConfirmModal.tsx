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
      <p className="text-base text-neutral-700 dark:text-neutral-300">{body}</p>
      <div className="flex justify-end gap-2 pt-4">
        <button
          onClick={onClose}
          className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={onConfirm}
          className="h-11 rounded-lg bg-red-600 px-6 text-base font-medium text-white hover:bg-red-700"
        >
          {t("common.delete")}
        </button>
      </div>
    </Modal>
  );
}
