import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import type {
  InstalledApp,
  PaymentType,
  Project,
  RateProfile,
  SyncStatus,
  WatchedApp,
} from "../lib/types";
import * as api from "../lib/api";
import { useTheme, type ThemePref } from "../lib/theme";
import Modal from "../components/Modal";
import { PlusIcon, TrashIcon } from "../components/Icons";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF"];
const SETTINGS_TABS = ["general", "rates", "apps", "sync"] as const;
const PAYMENT_TYPES: PaymentType[] = ["hourly", "retainer", "fixed"];

const inputCls =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 pro:border-[#44475a] pro:bg-[#343746] pro:text-[#f8f8f2]";
const rateFieldCls =
  "h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800 pro:border-[#44475a] pro:bg-[#343746] pro:text-[#f8f8f2] pro:focus:border-[#bd93f9]";
const rateGridCls =
  "grid min-w-[820px] grid-cols-[minmax(240px,1fr)_180px_150px_170px_44px] gap-3";

type SettingsTab = (typeof SETTINGS_TABS)[number];

interface Props {
  projects: Project[];
  currency: string;
  onCurrencyChange: (c: string) => void;
}

export default function SettingsView(p: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <nav className="flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 pro:border-[#44475a] pro:bg-[#21222c]">
          {SETTINGS_TABS.map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                tab === item
                  ? "bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-white pro:bg-[#44475a] pro:text-[#f8f8f2]"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white pro:text-[#b9b9c8] pro:hover:text-[#f8f8f2]"
              }`}
            >
              {t(`settings.tabs.${item}`)}
            </button>
          ))}
        </nav>
      </div>

      <div className="space-y-8">
        {tab === "general" && (
          <GeneralSection
            currency={p.currency}
            onCurrencyChange={p.onCurrencyChange}
          />
        )}
        {tab === "rates" && <RateProfilesSection projects={p.projects} />}
        {tab === "apps" && <WatchedAppsSection projects={p.projects} />}
        {tab === "sync" && <SyncSection />}
      </div>
    </div>
  );
}

function GeneralSection({
  currency,
  onCurrencyChange,
}: {
  currency: string;
  onCurrencyChange: (c: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { pref, setPref } = useTheme();
  const [pdfDir, setPdfDir] = useState("");
  const [pdfSaved, setPdfSaved] = useState(false);

  useEffect(() => {
    api.settingsGet("pdf_export_dir").then((value) => setPdfDir(value ?? ""));
  }, []);

  const savePdfDir = async () => {
    await api.settingsSet("pdf_export_dir", pdfDir.trim());
    setPdfSaved(true);
    window.setTimeout(() => setPdfSaved(false), 1600);
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t("settings.general")}
      </h2>
      <div className="mt-3 flex flex-wrap gap-6">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            {t("settings.language")}
          </span>
          <select
            value={i18n.language}
            onChange={(e) => {
              i18n.changeLanguage(e.target.value);
              api.settingsSet("language", e.target.value);
            }}
            className={inputCls}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            {t("settings.theme")}
          </span>
          <select
            value={pref}
            onChange={(e) => setPref(e.target.value as ThemePref)}
            className={inputCls}
          >
            <option value="auto">{t("settings.themeAuto")}</option>
            <option value="light">{t("settings.themeLight")}</option>
            <option value="dark">{t("settings.themeDark")}</option>
            <option value="pro">{t("settings.themePro")}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            {t("settings.currency")}
          </span>
          <select
            value={currency}
            onChange={(e) => {
              onCurrencyChange(e.target.value);
              api.settingsSet("currency", e.target.value);
            }}
            className={inputCls}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-6 max-w-2xl">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            {t("settings.pdfExportDir")}
          </span>
          <div className="flex gap-2">
            <input
              value={pdfDir}
              onChange={(e) => setPdfDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && savePdfDir()}
              placeholder={t("settings.pdfExportDirPlaceholder")}
              className={`min-w-0 flex-1 ${inputCls}`}
            />
            <button
              onClick={savePdfDir}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800 pro:border-[#44475a] pro:hover:bg-[#343746]"
            >
              {pdfSaved ? t("common.saved") : t("common.save")}
            </button>
          </div>
        </label>
        <p className="mt-1.5 text-xs text-neutral-500">
          {t("settings.pdfExportDirHelp")}
        </p>
      </div>
    </section>
  );
}

// ---------- rate profiles ----------

function RateProfilesSection({ projects }: { projects: Project[] }) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<RateProfile[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.rateProfilesGet(), api.defaultRateProfileGet()]).then(
      ([loadedProfiles, loadedDefault]) => {
        setProfiles(loadedProfiles);
        setDefaultId(
          loadedProfiles.some((profile) => profile.id === loadedDefault)
            ? loadedDefault
            : null,
        );
      },
    );
  }, []);

  const saveProfiles = (nextProfiles: RateProfile[], nextDefault = defaultId) => {
    const validDefault = nextDefault
      ? nextProfiles.some((profile) => profile.id === nextDefault)
        ? nextDefault
        : null
      : null;
    setProfiles(nextProfiles);
    setDefaultId(validDefault);
    api.rateProfilesSet(nextProfiles);
    api.defaultRateProfileSet(validDefault ?? "");
  };

  const updateProfile = (id: string, patch: Partial<RateProfile>) => {
    saveProfiles(
      profiles.map((profile) =>
        profile.id === id ? { ...profile, ...patch } : profile,
      ),
    );
  };

  const addProfile = () => {
    const profile: RateProfile = {
      id: newLocalId(),
      name: t("settings.rates.newName"),
      paymentType: "hourly",
      hourlyRate: 0,
    };
    saveProfiles([...profiles, profile], defaultId ?? profile.id);
  };

  const removeProfile = (id: string) => {
    const nextProfiles = profiles.filter((profile) => profile.id !== id);
    const nextDefault =
      defaultId === id ? (nextProfiles[0]?.id ?? null) : defaultId;
    saveProfiles(nextProfiles, nextDefault);
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t("settings.rates.title")}
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-neutral-500">
        {t("settings.rates.help")}
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700 pro:border-[#44475a]">
        <div
          className={`${rateGridCls} bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-normal text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400 pro:bg-[#21222c] pro:text-[#bd93f9]`}
        >
          <span>{t("settings.rates.name")}</span>
          <span>{t("settings.rates.paymentType")}</span>
          <span>{t("settings.rates.hourlyRate")}</span>
          <span>{t("settings.rates.defaultColumn")}</span>
          <span className="sr-only">{t("common.delete")}</span>
        </div>

        <div className="divide-y divide-neutral-200 dark:divide-neutral-700 pro:divide-[#44475a]">
        {profiles.length === 0 && (
          <p className="px-4 py-5 text-xs text-neutral-400">
            {t("settings.rates.empty")}
          </p>
        )}
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className={`${rateGridCls} items-center px-4 py-3`}
          >
            <label className="block min-w-0">
              <span className="sr-only">
                {t("settings.rates.name")}
              </span>
              <input
                value={profile.name}
                onChange={(e) =>
                  updateProfile(profile.id, { name: e.target.value })
                }
                className={rateFieldCls}
              />
            </label>
            <label className="block">
              <span className="sr-only">
                {t("settings.rates.paymentType")}
              </span>
              <select
                value={profile.paymentType}
                onChange={(e) =>
                  updateProfile(profile.id, {
                    paymentType: e.target.value as PaymentType,
                  })
                }
                className={rateFieldCls}
              >
                {PAYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`settings.rates.payment.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">
                {t("settings.rates.hourlyRate")}
              </span>
              <input
                inputMode="decimal"
                value={String(profile.hourlyRate)}
                onChange={(e) =>
                  updateProfile(profile.id, {
                    hourlyRate:
                      parseFloat(e.target.value.replace(",", ".")) || 0,
                  })
                }
                className={rateFieldCls}
              />
            </label>
            <button
              onClick={() => saveProfiles(profiles, profile.id)}
              className={`h-11 w-full rounded-md border px-3 text-sm font-semibold transition ${
                defaultId === profile.id
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 pro:border-[#50fa7b] pro:bg-[#50fa7b]/15 pro:text-[#50fa7b]"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800 pro:border-[#44475a] pro:text-[#b9b9c8] pro:hover:bg-[#343746]"
              }`}
            >
              {defaultId === profile.id
                ? t("settings.rates.default")
                : t("settings.rates.setDefault")}
            </button>
            <button
              onClick={() => removeProfile(profile.id)}
              className="flex h-11 w-11 items-center justify-center rounded-md text-neutral-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              title={t("common.delete")}
            >
              <TrashIcon size={16} />
            </button>
          </div>
        ))}
        </div>
      </div>

      <button
        onClick={addProfile}
        className="mt-3 flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800 pro:border-[#44475a] pro:hover:bg-[#343746]"
      >
        <PlusIcon size={14} />
        {t("settings.rates.add")}
      </button>
      <ProjectRatesSection projects={projects} profiles={profiles} />
    </section>
  );
}

function ProjectRatesSection({
  projects,
  profiles,
}: {
  projects: Project[];
  profiles: RateProfile[];
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Project[]>([]);
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});

  useEffect(() => {
    const active = projects.filter((project) => !project.archived);
    setRows(active);
    setDraftRates(
      Object.fromEntries(
        active.map((project) => [project.id, String(project.hourlyRate)]),
      ),
    );
  }, [projects]);

  const patchLocal = (project: Project) => {
    setRows((current) =>
      current.map((row) => (row.id === project.id ? project : row)),
    );
    setDraftRates((current) => ({
      ...current,
      [project.id]: String(project.hourlyRate),
    }));
  };

  const saveProject = async (project: Project, patch: Partial<Project>) => {
    const next = { ...project, ...patch };
    patchLocal(next);
    await api.projectUpdate(next);
  };

  const selectProfile = async (project: Project, profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    await saveProject(project, {
      rateProfileId: profile?.id ?? null,
      hourlyRate: profile?.hourlyRate ?? project.hourlyRate,
    });
  };

  const saveManualRate = async (project: Project) => {
    const hourlyRate =
      parseFloat((draftRates[project.id] ?? "0").replace(",", ".")) || 0;
    await saveProject(project, { hourlyRate, rateProfileId: null });
  };

  return (
    <section className="mt-8">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t("settings.rates.projectTitle")}
      </h3>
      <p className="mt-1 max-w-2xl text-xs text-neutral-500">
        {t("settings.rates.projectHelp")}
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700 pro:border-[#44475a]">
        <div className="grid min-w-[720px] grid-cols-[minmax(260px,1fr)_220px_160px] gap-3 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-normal text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400 pro:bg-[#21222c] pro:text-[#bd93f9]">
          <span>{t("reports.project")}</span>
          <span>{t("projects.rateProfile")}</span>
          <span>{t("projects.hourlyRate")}</span>
        </div>
        <div className="divide-y divide-neutral-200 dark:divide-neutral-700 pro:divide-[#44475a]">
          {rows.length === 0 && (
            <p className="px-4 py-5 text-xs text-neutral-400">
              {t("projects.empty")}
            </p>
          )}
          {rows.map((project) => (
            <div
              key={project.id}
              className="grid min-w-[720px] grid-cols-[minmax(260px,1fr)_220px_160px] items-center gap-3 px-4 py-3"
            >
              <span className="truncate text-sm font-medium">{project.name}</span>
              <select
                value={project.rateProfileId ?? ""}
                onChange={(e) => selectProfile(project, e.target.value)}
                className={rateFieldCls}
              >
                <option value="">{t("projects.manualRate")}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <input
                inputMode="decimal"
                value={draftRates[project.id] ?? String(project.hourlyRate)}
                onChange={(e) =>
                  setDraftRates((current) => ({
                    ...current,
                    [project.id]: e.target.value,
                  }))
                }
                onBlur={() => saveManualRate(project)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className={rateFieldCls}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function newLocalId() {
  return window.crypto?.randomUUID?.() ?? `rate-${Date.now()}`;
}

// ---------- watched apps ----------

function WatchedAppsSection({ projects }: { projects: Project[] }) {
  const { t } = useTranslation();
  const [watched, setWatched] = useState<WatchedApp[]>([]);
  const [notifOn, setNotifOn] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = () => api.watchedList().then(setWatched);

  useEffect(() => {
    load();
    api
      .settingsGet("watch_notifications")
      .then((v) => setNotifOn(v !== "0"));
  }, []);

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t("settings.watchedApps")}
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        {t("settings.watchedAppsHelp")}
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={notifOn}
          onChange={(e) => {
            setNotifOn(e.target.checked);
            api.settingsSet("watch_notifications", e.target.checked ? "1" : "0");
          }}
        />
        {t("settings.watchNotifications")}
      </label>

      <div className="mt-3 space-y-1.5">
        {watched.length === 0 && (
          <p className="text-xs text-neutral-400">{t("settings.noWatched")}</p>
        )}
        {watched.map((w) => (
          <div
            key={w.id}
            className="grid items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 md:grid-cols-[auto_minmax(0,1fr)_minmax(170px,220px)_150px_auto]"
          >
            <input
              type="checkbox"
              checked={w.enabled === 1}
              onChange={(e) =>
                api
                  .watchedUpdate(
                    w.id,
                    e.target.checked ? 1 : 0,
                    w.projectId,
                    w.remindAfterSecs,
                  )
                  .then(load)
              }
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{w.appName}</p>
              <p className="truncate text-xs text-neutral-400">{w.bundleId}</p>
            </div>
            <select
              value={w.projectId ?? ""}
              onChange={(e) =>
                api
                  .watchedUpdate(
                    w.id,
                    w.enabled,
                    e.target.value || null,
                    w.remindAfterSecs,
                  )
                  .then(load)
              }
              className={`w-full text-xs ${inputCls}`}
              title={t("settings.linkedProject")}
            >
              <option value="">{t("settings.noLinkedProject")}</option>
              {projects
                .filter((pr) => !pr.archived)
                .map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="whitespace-nowrap">
                {t("settings.reminderAfter")}
              </span>
              <input
                type="number"
                min={1}
                max={1440}
                value={Math.max(1, Math.round(w.remindAfterSecs / 60))}
                onChange={(e) => {
                  const minutes = Math.max(
                    1,
                    parseInt(e.target.value, 10) || 1,
                  );
                  api
                    .watchedUpdate(
                      w.id,
                      w.enabled,
                      w.projectId,
                      minutes * 60,
                    )
                    .then(load);
                }}
                className={`w-16 text-xs ${inputCls}`}
              />
              <span>{t("settings.minutesShort")}</span>
            </label>
            <button
              onClick={() => api.watchedRemove(w.id).then(load)}
              className="rounded p-1 text-neutral-400 hover:text-red-600"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setPickerOpen(true)}
        className="mt-3 flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
      >
        <PlusIcon size={14} />
        {t("settings.addApp")}
      </button>

      {pickerOpen && (
        <AppPickerModal
          existing={watched.map((w) => w.bundleId)}
          onClose={() => setPickerOpen(false)}
          onPick={async (app) => {
            await api.watchedAdd(app.bundleId, app.name, null, 60);
            setPickerOpen(false);
            load();
          }}
        />
      )}
    </section>
  );
}

function AppPickerModal({
  existing,
  onClose,
  onPick,
}: {
  existing: string[];
  onClose: () => void;
  onPick: (app: InstalledApp) => void;
}) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.appsInstalled().then(setApps);
  }, []);

  const filtered = (apps ?? []).filter(
    (a) =>
      !existing.includes(a.bundleId) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Modal title={t("settings.addApp")} onClose={onClose}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("settings.searchApps")}
        className={`w-full ${inputCls}`}
      />
      <div className="mt-2 max-h-72 overflow-y-auto">
        {apps === null ? (
          <p className="py-4 text-center text-sm text-neutral-400">
            {t("common.loading")}
          </p>
        ) : (
          filtered.map((a) => (
            <button
              key={a.bundleId}
              onClick={() => onPick(a)}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              <span className="font-medium">{a.name}</span>
              <span className="ml-2 text-xs text-neutral-400">
                {a.bundleId}
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

// ---------- sync ----------

function SyncSection() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");

  const refresh = () => api.syncStatus().then(setStatus);

  useEffect(() => {
    refresh();
    api.settingsGet("google_email").then((v) => v && setEmail(v));
    const un = listen<SyncStatus>("sync_state", (e) => setStatus(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const doLogin = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      await api.syncLogin(email.trim());
    } catch {
      /* l'errore appare in status */
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!status) return null;
  const locale = i18n.language === "it" ? "it-IT" : "en-US";

  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {t("settings.sync.title")}
      </h2>
      <p className="mt-1 text-xs text-neutral-500">{t("settings.sync.help")}</p>

      {!status.configured ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          {t("settings.sync.notConfigured")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {status.connected ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 dark:bg-green-950/60 dark:text-green-300">
                {status.email
                  ? t("settings.sync.connectedAs", { email: status.email })
                  : t("settings.sync.connected")}
              </span>
              <button
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.syncNow();
                  } catch {
                    /* l'errore appare in status */
                  } finally {
                    setBusy(false);
                    refresh();
                  }
                }}
                disabled={busy || status.inProgress}
                className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
              >
                {busy || status.inProgress
                  ? t("settings.sync.syncing")
                  : t("settings.sync.syncNow")}
              </button>
              <button
                onClick={() => api.syncLogout().then(refresh)}
                className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-neutral-600 dark:hover:bg-red-950/40"
              >
                {t("settings.sync.disconnect")}
              </button>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                {t("settings.sync.emailLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("settings.sync.emailPlaceholder")}
                  onKeyDown={(e) => e.key === "Enter" && email.trim() && !busy && doLogin()}
                  className={`w-64 ${inputCls}`}
                />
                <button
                  onClick={doLogin}
                  disabled={busy || !email.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? t("settings.sync.syncing") : t("settings.sync.connect")}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-neutral-400">
                {t("settings.sync.connectHelp")}
              </p>
            </div>
          )}

          {status.lastSync && (
            <p className="text-xs text-neutral-400">
              {t("settings.sync.lastSync", {
                time: new Date(status.lastSync * 1000).toLocaleString(locale),
              })}
            </p>
          )}
          {status.lastError && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t("settings.sync.error", { error: status.lastError })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
