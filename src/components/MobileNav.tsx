import { useTranslation } from "react-i18next";
import type { View } from "./Sidebar";
import { ChartIcon, FolderIcon, GearIcon } from "./Icons";

// barra di navigazione inferiore, solo su schermi stretti (mobile)
export default function MobileNav({
  view,
  onNav,
}: {
  view: View;
  onNav: (v: View) => void;
}) {
  const { t } = useTranslation();
  const items = [
    ["project", t("nav.projects"), <FolderIcon key="p" size={20} />],
    ["reports", t("nav.reports"), <ChartIcon key="r" size={20} />],
    ["settings", t("nav.settings"), <GearIcon key="s" size={20} />],
  ] as const;

  return (
    <nav className="flex shrink-0 border-t border-neutral-200 bg-neutral-50 pb-[env(safe-area-inset-bottom)] md:hidden dark:border-neutral-800 dark:bg-neutral-900 pro:border-[#44475a] pro:bg-[#21222c]">
      {items.map(([v, label, icon]) => (
        <button
          key={v}
          onClick={() => onNav(v)}
          className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
            view === v
              ? "text-blue-600 dark:text-blue-400 pro:text-[#bd93f9]"
              : "text-neutral-500 dark:text-neutral-400 pro:text-[#b9b9c8]"
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </nav>
  );
}
