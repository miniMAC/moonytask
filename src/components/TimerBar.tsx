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
    <div className="flex items-center gap-2.5 border-t border-[#434758] bg-[#303443] px-4 py-3 text-white shadow-[0_-1px_0_rgba(255,255,255,0.04)] md:gap-4 md:px-5 dark:border-[#434758] dark:bg-[#252938] pro:border-[#44475a] pro:bg-[#21222c]">
      <button
        onClick={() => timer.projectId && onOpenProject(timer.projectId)}
        className="flex min-w-0 flex-1 items-center gap-2 truncate text-left text-base font-medium hover:underline"
      >
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            timer.status === "running" ? "bg-[#4cf272]" : "bg-amber-400"
          }`}
        />
        <span className="truncate">{timer.projectName}</span>
        <span className="hidden text-sm font-normal text-neutral-400 sm:inline">
          {timer.status === "running" ? t("timer.running") : t("timer.paused")}
        </span>
      </button>
      <span className="font-mono text-xl font-semibold tabular-nums text-[#4cf272]">
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
