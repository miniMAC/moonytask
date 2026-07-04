import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import type {
  InstalledApp,
  Project,
  SyncStatus,
  WatchedApp,
} from "../lib/types";
import * as api from "../lib/api";
import { useTheme, type ThemePref } from "../lib/theme";
import Modal from "../components/Modal";
import { PlusIcon, TrashIcon } from "../components/Icons";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF"];

const inputCls =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800";

interface Props {
  projects: Project[];
  currency: string;
  onCurrencyChange: (c: string) => void;
}

export default function SettingsView(p: Props) {
  const { t, i18n } = useTranslation();
  const { pref, setPref } = useTheme();

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>

      {/* general */}
      <section className="flex flex-wrap gap-6">
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
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            {t("settings.currency")}
          </span>
          <select
            value={p.currency}
            onChange={(e) => {
              p.onCurrencyChange(e.target.value);
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
      </section>

      <WatchedAppsSection projects={p.projects} />
      <SyncSection />
    </div>
  );
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
            className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700"
          >
            <input
              type="checkbox"
              checked={w.enabled === 1}
              onChange={(e) =>
                api
                  .watchedUpdate(w.id, e.target.checked ? 1 : 0, w.projectId)
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
                  .watchedUpdate(w.id, w.enabled, e.target.value || null)
                  .then(load)
              }
              className={`max-w-44 text-xs ${inputCls}`}
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
            await api.watchedAdd(app.bundleId, app.name, null);
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
