export interface Folder {
  id: string;
  name: string;
  position: number;
  color: string | null;
  updatedAt: number;
  deleted: number;
}

export interface FolderCollapseState {
  folderId: string;
  collapsed: boolean;
  updatedAt: number;
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
  role: "standard" | "master" | "member";
  canPublish: boolean;
  association: {
    id: string;
    status: "pending" | "approved";
    requestedAt: number;
    approvedAt: number | null;
    master: {
      email: string;
      displayName: string | null;
    };
    masterLicenseActive: boolean;
  } | null;
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

export interface MasterAssociationSummary {
  id: string;
  memberAccountId: string;
  email: string;
  displayName: string | null;
  status: "pending" | "approved";
  requestedAt: number;
  approvedAt: number | null;
  selectedFolderCount: number;
  lastUpload: number | null;
}

export interface PublishedFolder {
  id: string;
  name: string;
  position: number;
  color: string | null;
  updatedAt: number;
}

export interface PublishedProject {
  id: string;
  folderId: string;
  name: string;
  hourlyRate: number;
  rateProfileId: string | null;
  color: string | null;
  archived: boolean;
  position: number;
  updatedAt: number;
}

export interface PublishedRateProfile {
  id: string;
  name: string;
  paymentType: PaymentType;
  hourlyRate: number;
}

export interface PublishedTimeEntry {
  id: string;
  projectId: string;
  startedAt: number;
  endedAt: number;
  durationSecs: number;
  note: string | null;
  updatedAt: number;
}

export interface PublishedProjectPayment {
  id: string;
  projectId: string;
  paidAt: number;
  paidThroughAt: number;
  note: string | null;
  updatedAt: number;
}

export interface PublishedSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  currency: string;
  folders: PublishedFolder[];
  projects: PublishedProject[];
  rateProfiles: PublishedRateProfile[];
  timeEntries: PublishedTimeEntry[];
  projectPayments: PublishedProjectPayment[];
}

export interface MasterSharedMember {
  associationId: string;
  account: {
    email: string;
    displayName: string | null;
  };
  publication: MasterStatus["publication"];
  snapshot: PublishedSnapshot | null;
}

export interface MasterSharedData {
  members: MasterSharedMember[];
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
