import { useTranslation } from "react-i18next";
import type { TimerSnapshot } from "../lib/types";
import * as api from "../lib/api";
import { fmtClock } from "../lib/time";
import { PauseIcon, PlayIcon, StopIcon } from "./Icons";

export default function TimerBar({
  timer,
  onOpenProject,
}: {
  timer: TimerSnapshot;
  onOpenProject: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (timer.status === "idle") return null;

  return (
    <div className="flex items-center gap-4 border-t border-neutral-200 bg-neutral-900 px-5 py-3 text-white dark:border-neutral-800 dark:bg-black/60 pro:border-[#44475a] pro:bg-[#21222c]">
      <button
        onClick={() => timer.projectId && onOpenProject(timer.projectId)}
        className="min-w-0 flex-1 truncate text-left text-base font-medium hover:underline"
      >
        {timer.projectName}
        <span className="ml-2 text-sm font-normal text-neutral-400">
          {timer.status === "running" ? t("timer.running") : t("timer.paused")}
        </span>
      </button>
      <span className="font-mono text-xl tabular-nums">
        {fmtClock(timer.elapsedSecs)}
      </span>
      {timer.status === "running" ? (
        <button
          title={t("timer.pause")}
          onClick={() => api.timerPause()}
          className="rounded-lg bg-white/15 p-2.5 hover:bg-white/25"
        >
          <PauseIcon />
        </button>
      ) : (
        <button
          title={t("timer.resume")}
          onClick={() => api.timerResume()}
          className="rounded-lg bg-white/15 p-2.5 hover:bg-white/25"
        >
          <PlayIcon />
        </button>
      )}
      <button
        title={t("timer.stop")}
        onClick={() => api.timerStop()}
        className="rounded-lg bg-red-500 p-2.5 hover:bg-red-400"
      >
        <StopIcon />
      </button>
    </div>
  );
}
