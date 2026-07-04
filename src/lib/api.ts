import { invoke } from "@tauri-apps/api/core";
import type {
  Folder,
  InstalledApp,
  Project,
  ProjectPayment,
  RateProfile,
  ReportExportPdfRequest,
  SyncStatus,
  TimeEntry,
  TimerSnapshot,
  WatchedApp,
} from "./types";

// folders
export const foldersList = () => invoke<Folder[]>("folders_list");
export const folderCreate = (name: string, color: string | null) =>
  invoke<Folder>("folder_create", { name, color });
export const folderUpdate = (id: string, name: string, color: string | null) =>
  invoke<void>("folder_update", { id, name, color });
export const folderDelete = (id: string) =>
  invoke<void>("folder_delete", { id });

// projects
export const projectsList = () => invoke<Project[]>("projects_list");
export const projectCreate = (
  folderId: string,
  name: string,
  hourlyRate: number,
  color: string | null,
  rateProfileId: string | null = null,
) =>
  invoke<Project>("project_create", {
    folderId,
    name,
    hourlyRate,
    rateProfileId,
    color,
  });
export const projectUpdate = (p: Project) =>
  invoke<void>("project_update", {
    id: p.id,
    folderId: p.folderId,
    name: p.name,
    hourlyRate: p.hourlyRate,
    rateProfileId: p.rateProfileId,
    color: p.color,
    archived: p.archived,
  });
export const projectDelete = (id: string) =>
  invoke<void>("project_delete", { id });
export const foldersReorder = (ids: string[]) =>
  invoke<void>("folders_reorder", { ids });
// ids = elenco completo e ordinato dei progetti della cartella di destinazione
export const projectsReorder = (folderId: string, ids: string[]) =>
  invoke<void>("projects_reorder", { folderId, ids });

// time entries
export const entriesRange = (from: number, to: number) =>
  invoke<TimeEntry[]>("entries_range", { from, to });
export const entryDelete = (id: string) => invoke<void>("entry_delete", { id });
export const entryUpdateNote = (id: string, note: string | null) =>
  invoke<void>("entry_update_note", { id, note });
export const entriesMerge = (ids: string[]) =>
  invoke<TimeEntry>("entries_merge", { ids });
export const entryAddManual = (
  projectId: string,
  startedAt: number,
  durationSecs: number,
  note: string | null,
) => invoke<void>("entry_add_manual", { projectId, startedAt, durationSecs, note });

// export
export type ExportFormat = "csv" | "json";
export const dataExport = (format: ExportFormat) =>
  invoke<string>("data_export", { format });
export const projectExport = (projectId: string, format: ExportFormat) =>
  invoke<string>("project_export", { projectId, format });
export const reportExportPdf = (request: ReportExportPdfRequest) =>
  invoke<string>("report_export_pdf", { ...request });

// project payments
export const projectPaymentsList = (projectId: string) =>
  invoke<ProjectPayment[]>("project_payments_list", { projectId });
export const projectPaymentCreate = (
  projectId: string,
  paidAt: number,
  paidThroughAt: number,
  note: string | null,
) =>
  invoke<ProjectPayment>("project_payment_create", {
    projectId,
    paidAt,
    paidThroughAt,
    note,
  });
export const projectPaymentDelete = (id: string) =>
  invoke<void>("project_payment_delete", { id });

// timer
export const timerStart = (projectId: string) =>
  invoke<void>("timer_start", { projectId });
export const timerPause = () => invoke<void>("timer_pause");
export const timerResume = () => invoke<void>("timer_resume");
export const timerStop = () => invoke<TimeEntry | null>("timer_stop");
export const timerGetState = () => invoke<TimerSnapshot>("timer_get_state");

// totals per project (per popover e statistiche)
export interface ProjectTotal {
  projectId: string;
  totalSecs: number;
  lastUsed: number;
}
export const projectTotals = () => invoke<ProjectTotal[]>("project_totals");

// windows
export const openMain = () => invoke<void>("open_main");
export const hidePopover = () => invoke<void>("hide_popover");

// apps / watch list
export const appsInstalled = () => invoke<InstalledApp[]>("apps_installed");
export const watchedList = () => invoke<WatchedApp[]>("watched_list");
export const watchedAdd = (
  bundleId: string,
  appName: string,
  projectId: string | null,
  remindAfterSecs = 60,
) =>
  invoke<WatchedApp>("watched_add", {
    bundleId,
    appName,
    projectId,
    remindAfterSecs,
  });
export const watchedUpdate = (
  id: string,
  enabled: number,
  projectId: string | null,
  remindAfterSecs: number,
) => invoke<void>("watched_update", { id, enabled, projectId, remindAfterSecs });
export const watchedRemove = (id: string) =>
  invoke<void>("watched_remove", { id });
export const watcherSnooze = (bundleId: string, untilEpoch: number) =>
  invoke<void>("watcher_snooze", { bundleId, untilEpoch });

// settings
export const settingsGet = (key: string) =>
  invoke<string | null>("settings_get", { key });
export const selectPdfExportDir = (current: string | null) =>
  invoke<string | null>("select_pdf_export_dir", { current });
export const settingsSet = (key: string, value: string) =>
  invoke<void>("settings_set", { key, value });

// rate profiles
export const rateProfilesGet = async () => {
  const raw = await settingsGet("rate_profiles");
  if (!raw) return [] as RateProfile[];
  try {
    const parsed = JSON.parse(raw) as RateProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
export const rateProfilesSet = (profiles: RateProfile[]) =>
  settingsSet("rate_profiles", JSON.stringify(profiles));
export const defaultRateProfileGet = () => settingsGet("default_rate_profile_id");
export const defaultRateProfileSet = (id: string) =>
  settingsSet("default_rate_profile_id", id);

// sync
export const syncStatus = () => invoke<SyncStatus>("sync_status");
export const syncSetCredentials = (clientId: string, clientSecret: string) =>
  invoke<void>("sync_set_credentials", { clientId, clientSecret });
export const syncLogin = (email: string | null) =>
  invoke<SyncStatus>("sync_login", { email });
export const syncLogout = () => invoke<void>("sync_logout");
export const syncNow = () => invoke<SyncStatus>("sync_now");
export const quitNow = () => invoke<void>("quit_now");
