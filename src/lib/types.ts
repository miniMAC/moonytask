export interface Folder {
  id: string;
  name: string;
  position: number;
  color: string | null;
  updatedAt: number;
  deleted: number;
}

export interface Project {
  id: string;
  folderId: string;
  name: string;
  hourlyRate: number;
  rateProfileId: string | null;
  color: string | null;
  archived: number;
  position: number;
  updatedAt: number;
  deleted: number;
}

export type PaymentType = "hourly" | "retainer" | "fixed";

export interface RateProfile {
  id: string;
  name: string;
  paymentType: PaymentType;
  hourlyRate: number;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  startedAt: number;
  endedAt: number;
  durationSecs: number;
  note: string | null;
  updatedAt: number;
  deleted: number;
}

export interface ProjectPayment {
  id: string;
  projectId: string;
  paidAt: number;
  paidThroughAt: number;
  note: string | null;
  updatedAt: number;
  deleted: number;
}

export interface WatchedApp {
  id: string;
  bundleId: string;
  appName: string;
  projectId: string | null;
  remindAfterSecs: number;
  enabled: number;
  updatedAt: number;
  deleted: number;
}

export interface InstalledApp {
  bundleId: string;
  name: string;
}

export type TimerStatus = "idle" | "running" | "paused";

export interface TimerSnapshot {
  status: TimerStatus;
  projectId: string | null;
  projectName: string | null;
  elapsedSecs: number;
}

export interface SyncStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastSync: number | null;
  lastError: string | null;
  inProgress: boolean;
}

export interface MasterFolderSelection {
  id: string;
  name: string;
  updatedAt?: number | null;
}

export interface MasterStatus {
  account: { email: string };
  request: {
    id: string;
    type: "initial" | "renewal";
    status: "pending" | "approved" | "rejected";
    rejectionReason: string | null;
    requestedAt: number;
    resolvedAt: number | null;
  } | null;
  license: {
    id: string;
    status: "active" | "expired" | "revoked";
    startsAt: number;
    expiresAt: number;
    code: string;
  } | null;
  api: {
    enabled: boolean;
    updatedAt: number | null;
    waitingForApp: boolean;
  };
  selectedFolders: MasterFolderSelection[];
  publication: {
    etag: string | null;
    sizeBytes: number | null;
    generatedAt: number | null;
    lastUpload: number | null;
  };
  lastError: string | null;
  deviceActivated: boolean;
}

export interface WatchSuggestion {
  bundleId: string;
  appName: string;
  projectId: string | null;
}

export interface ReportExportPdfRequest {
  from: number;
  to: number;
  folderId: string;
  projectId: string;
  currency: string;
  locale: string;
}
