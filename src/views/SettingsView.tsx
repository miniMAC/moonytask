import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  Folder,
  InstalledApp,
  MasterStatus,
  PaymentType,
  Project,
  RateProfile,
  SyncStatus,
  WatchedApp,
} from "../lib/types";
import * as api from "../lib/api";
import { isMobilePlatform } from "../lib/platform";
import { useTheme, type ThemePref } from "../lib/theme";
import Modal from "../components/Modal";
import { PlusIcon, TrashIcon } from "../components/Icons";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF"];
const SETTINGS_TABS = [
  "general",
  "rates",
  "apps",
  "sync",
  "master",
  "support",
] as const;
const PAYMENT_TYPES: PaymentType[] = ["hourly", "retainer", "fixed"];

// stile neutro condiviso: le Impostazioni usano i colori dell'interfaccia,
// i box colorati restano solo nelle altre parti dell'app (es. scheda progetto)
const inputCls =
  "h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base outline-none transition focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800 pro:border-[#44475a] pro:bg-[#343746] pro:text-[#f8f8f2] pro:focus:border-[#bd93f9]";
const sectionCls =
  "rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-800/60 pro:border-[#44475a] pro:bg-[#21222c]";
const sectionTitleCls =
  "text-sm font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 pro:text-[#b9b9c8]";
const fieldLabelCls =
  "mb-1 block text-sm font-medium text-neutral-600 dark:text-neutral-300 pro:text-[#c9c9d6]";
const helpTextCls =
  "text-sm text-neutral-500 dark:text-neutral-400 pro:text-[#b9b9c8]";
const ghostBtnCls =
  "h-11 rounded-xl border border-neutral-300 px-5 text-base font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700 pro:border-[#44475a] pro:text-[#f8f8f2] pro:hover:bg-[#343746]";
const primaryBtnCls =
  "h-11 rounded-xl bg-blue-600 px-6 text-base font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 pro:bg-[#bd93f9] pro:text-[#282a36] pro:hover:bg-[#a77bf3]";
const checkboxCls = "accent-blue-600 pro:accent-[#bd93f9]";

type SettingsTab = (typeof SETTINGS_TABS)[number];

interface Props {
  projects: Project[];
  currency: string;
  onCurrencyChange: (c: string) => void;
}

export default function SettingsView(p: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>("general");
  // il watcher delle app in primo piano esiste solo su desktop
  const tabs = SETTINGS_TABS.filter(
    (item) => item !== "apps" || !isMobilePlatform,
  );

  return (
    <div className="mx-auto max-w-4xl px-4 pb-8 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <nav className="flex max-w-full overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100 p-1 text-base dark:border-neutral-700 dark:bg-neutral-900 pro:border-[#44475a] pro:bg-[#21222c]">
          {tabs.map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition ${
                tab === item
                  ? "bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-white pro:bg-[#44475a] pro:text-[#f8f8f2]"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white pro:text-[#c9c9d6] pro:hover:text-[#f8f8f2]"
              }`}
            >
              {t(`settings.tabs.${item}`)}
            </button>
          ))}
        </nav>
      </div>

      <div className="space-y-8">
        {tab === "general" && (
          <>
            <GeneralSection
              currency={p.currency}
              onCurrencyChange={p.onCurrencyChange}
            />
            <DangerSection projects={p.projects} />
          </>
        )}
        {tab === "rates" && <RateProfilesSection />}
        {tab === "apps" && <WatchedAppsSection projects={p.projects} />}
        {tab === "sync" && <SyncSection />}
        {tab === "master" && <MasterSection />}
        {tab === "support" && <SupportSection />}
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
  const [pdfSelecting, setPdfSelecting] = useState(false);
  const [pdfTotalsOnly, setPdfTotalsOnly] = useState(false);
  const [autoMergeDaily, setAutoMergeDaily] = useState(false);
  const [menubarWindowWidth, setMenubarWindowWidth] = useState("medium");

  useEffect(() => {
    api.settingsGet("pdf_export_dir").then((value) => setPdfDir(value ?? ""));
    api
      .settingsGet("pdf_totals_only")
      .then((value) => setPdfTotalsOnly(value === "1"));
    api
      .settingsGet("auto_merge_daily")
      .then((value) => setAutoMergeDaily(value === "1"));
    api
      .settingsGet("menubar_window_width")
      .then((value) => setMenubarWindowWidth(value || "medium"));
  }, []);

  const savePdfDir = async () => {
    await api.settingsSet("pdf_export_dir", pdfDir.trim());
    setPdfSaved(true);
    window.setTimeout(() => setPdfSaved(false), 1600);
  };

  const choosePdfDir = async () => {
    if (pdfSelecting) return;
    setPdfSelecting(true);
    try {
      const selected = await api.selectPdfExportDir(pdfDir.trim() || null);
      if (selected === null) return;
      setPdfDir(selected);
      await api.settingsSet("pdf_export_dir", selected);
      setPdfSaved(true);
      window.setTimeout(() => setPdfSaved(false), 1600);
    } finally {
      setPdfSelecting(false);
    }
  };

  return (
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>{t("settings.general")}</h2>
      <div className="mt-4 flex flex-wrap gap-6">
        <label className="block">
          <span className={fieldLabelCls}>{t("settings.language")}</span>
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
          <span className={fieldLabelCls}>{t("settings.theme")}</span>
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
          <span className={fieldLabelCls}>{t("settings.currency")}</span>
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
        {!isMobilePlatform && (
          <label className="block">
            <span className={fieldLabelCls}>
              {t("settings.menubarWindowWidth")}
            </span>
            <select
              value={menubarWindowWidth}
              onChange={(e) => {
                setMenubarWindowWidth(e.target.value);
                api.settingsSet("menubar_window_width", e.target.value);
              }}
              className={inputCls}
            >
              <option value="small">{t("settings.windowWidthSmall")}</option>
              <option value="medium">{t("settings.windowWidthMedium")}</option>
              <option value="large">{t("settings.windowWidthLarge")}</option>
            </select>
          </label>
        )}
      </div>
      <div className="mt-6 max-w-2xl">
        <label className="flex items-center gap-2 text-base">
          <input
            type="checkbox"
            className={checkboxCls}
            checked={autoMergeDaily}
            onChange={(e) => {
              setAutoMergeDaily(e.target.checked);
              api.settingsSet("auto_merge_daily", e.target.checked ? "1" : "0");
            }}
          />
          {t("settings.autoMergeDaily")}
        </label>
        <p className={`mt-1 ${helpTextCls}`}>
          {t("settings.autoMergeDailyHelp")}
        </p>
      </div>
      {/* la cartella export riguarda solo il filesystem desktop */}
      {!isMobilePlatform && (
      <div className="mt-6 max-w-2xl">
        <label className="block">
          <span className={fieldLabelCls}>
            {t("settings.pdfExportDir")}
          </span>
          <div className="flex flex-wrap gap-2">
            <input
              value={pdfDir}
              onChange={(e) => setPdfDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && savePdfDir()}
              placeholder={t("settings.pdfExportDirPlaceholder")}
              className={`min-w-0 flex-1 ${inputCls}`}
            />
            <button
              onClick={choosePdfDir}
              disabled={pdfSelecting}
              className={ghostBtnCls}
            >
              {pdfSelecting
                ? t("common.loading")
                : t("settings.chooseFolder")}
            </button>
            <button onClick={savePdfDir} className={ghostBtnCls}>
              {pdfSaved ? t("common.saved") : t("common.save")}
            </button>
          </div>
        </label>
        <p className={`mt-1.5 ${helpTextCls}`}>
          {t("settings.pdfExportDirHelp")}
        </p>
        <label className="mt-4 flex items-center gap-2 text-base">
          <input
            type="checkbox"
            className={checkboxCls}
            checked={pdfTotalsOnly}
            onChange={(e) => {
              setPdfTotalsOnly(e.target.checked);
              api.settingsSet("pdf_totals_only", e.target.checked ? "1" : "0");
            }}
          />
          {t("settings.pdfTotalsOnly")}
        </label>
        <p className={`mt-1 ${helpTextCls}`}>
          {t("settings.pdfTotalsOnlyHelp")}
        </p>
      </div>
      )}
    </section>
  );
}

function SupportSection() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const email = "info@moonytask.com";
  const subject = encodeURIComponent("MoonyTask support");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  return (
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>{t("settings.support.title")}</h2>
      <p className={`mt-2 max-w-2xl ${helpTextCls}`}>
        {t("settings.support.help")}
      </p>
      <p className="mt-3 text-sm font-medium text-neutral-600 dark:text-neutral-300 pro:text-[#c9c9d6]">
        {t("settings.support.version")}: {version ?? "—"}
      </p>
      <button
        onClick={() => openUrl(`mailto:${email}?subject=${subject}`)}
        className={`mt-4 ${primaryBtnCls}`}
      >
        {t("settings.support.email")}
      </button>
    </section>
  );
}

// ---------- rate profiles ----------

// box blu, in tinta con la card Tariffa della scheda progetto
const rateFieldCls = `w-full ${inputCls}`;

function RateProfilesSection() {
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
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>{t("settings.rates.title")}</h2>
      <p className={`mt-2 max-w-2xl ${helpTextCls}`}>
        {t("settings.rates.help")}
      </p>

      <div className="mt-4 space-y-3">
        {profiles.length === 0 && (
          <p className={helpTextCls}>{t("settings.rates.empty")}</p>
        )}
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className={`rounded-xl border bg-neutral-50 p-4 transition dark:bg-neutral-800 pro:bg-[#282a36] ${
              defaultId === profile.id
                ? "border-emerald-500"
                : "border-neutral-200 dark:border-neutral-700 pro:border-[#44475a]"
            }`}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_170px_140px_auto] xl:items-end">
              <label className="block min-w-0">
                <span className={fieldLabelCls}>
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
                <span className={fieldLabelCls}>
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
                <span className={fieldLabelCls}>
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
              <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-1">
                <button
                  onClick={() => saveProfiles(profiles, profile.id)}
                  className={`h-11 flex-1 rounded-md border px-4 text-base font-semibold transition xl:flex-none ${
                    defaultId === profile.id
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 pro:text-[#50fa7b]"
                      : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700 pro:border-[#44475a] pro:text-[#f8f8f2] pro:hover:bg-[#343746]"
                  }`}
                >
                  {defaultId === profile.id
                    ? `✓ ${t("settings.rates.default")}`
                    : t("settings.rates.setDefault")}
                </button>
                <button
                  onClick={() => removeProfile(profile.id)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-neutral-300 text-neutral-500 transition hover:border-red-500 hover:text-red-600 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-red-500 dark:hover:text-red-400 pro:border-[#44475a] pro:text-[#b9b9c8] pro:hover:border-[#ff5555] pro:hover:text-[#ff5555]"
                  title={t("common.delete")}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addProfile}
        className={`mt-4 flex items-center gap-1.5 ${ghostBtnCls}`}
      >
        <PlusIcon size={14} />
        {t("settings.rates.add")}
      </button>
    </section>
  );
}

// ---------- danger zone ----------

function DangerSection({ projects }: { projects: Project[] }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const word = t("settings.danger.confirmWord");

  const close = () => {
    if (busy) return;
    setStep(0);
    setConfirmText("");
  };

  const doReset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // ferma un eventuale timer attivo prima di cancellare i progetti
      await api.timerStop().catch(() => null);
      const folders = await api.foldersList();
      for (const project of projects) {
        await api.projectDelete(project.id);
      }
      for (const folder of folders) {
        await api.folderDelete(folder.id);
      }
      setDone(true);
      setStep(0);
      setConfirmText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={sectionCls}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-red-600 dark:text-red-400 pro:text-[#ff5555]">
        {t("settings.danger.title")}
      </h2>
      <p className={`mt-2 max-w-2xl ${helpTextCls}`}>
        {t("settings.danger.resetHelp")}
      </p>
      <button
        onClick={() => {
          setDone(false);
          setStep(1);
        }}
        className="mt-3 h-11 rounded-xl border border-red-300 px-5 text-base font-semibold text-red-600 transition hover:bg-red-600 hover:text-white dark:border-red-500/50 dark:text-red-400 dark:hover:bg-red-600 dark:hover:text-white pro:border-[#ff5555]/50 pro:text-[#ff5555] pro:hover:bg-[#ff5555] pro:hover:text-[#282a36]"
      >
        {t("settings.danger.resetButton")}
      </button>
      {done && (
        <p className="mt-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 pro:text-[#50fa7b]">
          {t("settings.danger.resetDone")}
        </p>
      )}

      {step === 1 && (
        <Modal title={t("settings.danger.resetStep1Title")} onClose={close}>
          <p className="text-base text-neutral-700 dark:text-neutral-300">
            {t("settings.danger.resetStep1Body")}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={close}
              className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => setStep(2)}
              className="h-11 rounded-lg bg-red-600 px-6 text-base font-semibold text-white hover:bg-red-700"
            >
              {t("settings.danger.resetContinue")}
            </button>
          </div>
        </Modal>
      )}

      {step === 2 && (
        <Modal title={t("settings.danger.resetStep2Title")} onClose={close}>
          <label className="block">
            <span className="mb-2 block text-base text-neutral-700 dark:text-neutral-300">
              {t("settings.danger.typeToConfirm", { word })}
            </span>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={word}
              className={`w-full ${inputCls}`}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={close}
              disabled={busy}
              className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={doReset}
              disabled={busy || confirmText.trim().toUpperCase() !== word}
              className="h-11 rounded-lg bg-red-600 px-6 text-base font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            >
              {busy
                ? t("settings.danger.resetting")
                : t("settings.danger.resetFinal")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function newLocalId() {
  return window.crypto?.randomUUID?.() ?? `rate-${Date.now()}`;
}

// ---------- watched apps ----------

// box ambra: app monitorate
const appsInputCls = inputCls;

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
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>{t("settings.watchedApps")}</h2>
      <p className={`mt-2 ${helpTextCls}`}>
        {t("settings.watchedAppsHelp")}
      </p>

      <label className="mt-3 flex items-center gap-2 text-base">
        <input
          type="checkbox"
          className={checkboxCls}
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
          <p className={helpTextCls}>{t("settings.noWatched")}</p>
        )}
        {watched.map((w) => (
          <div
            key={w.id}
            className="grid items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-base dark:border-neutral-700 dark:bg-neutral-800 pro:border-[#44475a] pro:bg-[#282a36] md:grid-cols-[auto_minmax(0,1fr)_minmax(170px,220px)_150px_auto]"
          >
            <input
              type="checkbox"
              className={checkboxCls}
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
              <p className="truncate text-sm text-neutral-500 dark:text-neutral-400 pro:text-[#b9b9c8]">{w.bundleId}</p>
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
              className={`w-full text-sm ${appsInputCls}`}
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
            <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300 pro:text-[#c9c9d6]">
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
                className={`w-16 text-sm ${appsInputCls}`}
              />
              <span>{t("settings.minutesShort")}</span>
            </label>
            <button
              onClick={() => api.watchedRemove(w.id).then(load)}
              className="rounded p-1 text-neutral-400 transition hover:text-red-600 dark:hover:text-red-400 pro:text-[#b9b9c8] pro:hover:text-[#ff5555]"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setPickerOpen(true)}
        className={`mt-4 flex items-center gap-1.5 ${ghostBtnCls}`}
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
          <p className="py-4 text-center text-base text-neutral-400">
            {t("common.loading")}
          </p>
        ) : (
          filtered.map((a) => (
            <button
              key={a.bundleId}
              onClick={() => onPick(a)}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-base hover:bg-neutral-100 dark:hover:bg-neutral-700"
            >
              <span className="font-medium">{a.name}</span>
              <span className="ml-2 text-sm text-neutral-400">
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

// box verde: sync
const syncInputCls = inputCls;

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
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>{t("settings.sync.title")}</h2>
      <p className={`mt-2 ${helpTextCls}`}>{t("settings.sync.help")}</p>

      {!status.configured ? (
        <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 pro:bg-[#343746] pro:text-[#c9c9d6]">
          {t("settings.sync.notConfigured")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {status.connected ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-300 pro:text-[#50fa7b]">
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
                className={ghostBtnCls}
              >
                {busy || status.inProgress
                  ? t("settings.sync.syncing")
                  : t("settings.sync.syncNow")}
              </button>
              <button
                onClick={() => api.syncLogout().then(refresh)}
                className="h-11 rounded-xl border border-neutral-300 px-5 text-base font-medium text-neutral-700 transition hover:border-red-500 hover:text-red-600 dark:border-neutral-600 dark:text-neutral-200 dark:hover:border-red-500 dark:hover:text-red-400 pro:border-[#44475a] pro:text-[#f8f8f2] pro:hover:border-[#ff5555] pro:hover:text-[#ff5555]"
              >
                {t("settings.sync.disconnect")}
              </button>
            </div>
          ) : (
            <div>
              <label className={fieldLabelCls}>
                {t("settings.sync.emailLabel")}
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("settings.sync.emailPlaceholder")}
                  onKeyDown={(e) => e.key === "Enter" && email.trim() && !busy && doLogin()}
                  className={`w-full sm:w-64 ${syncInputCls}`}
                />
                <button
                  onClick={doLogin}
                  disabled={busy || !email.trim()}
                  className={primaryBtnCls}
                >
                  {busy ? t("settings.sync.syncing") : t("settings.sync.connect")}
                </button>
              </div>
              <p className={`mt-1.5 ${helpTextCls}`}>
                {t("settings.sync.connectHelp")}
              </p>
            </div>
          )}

          {status.lastSync && (
            <p className={helpTextCls}>
              {t("settings.sync.lastSync", {
                time: new Date(status.lastSync * 1000).toLocaleString(locale),
              })}
            </p>
          )}
          {status.lastError && (
            <p className="text-sm font-semibold text-red-600 dark:text-red-400 pro:text-[#ff5555]">
              {t("settings.sync.error", { error: status.lastError })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Master / Web API ----------

function MasterSection() {
  const { t, i18n } = useTranslation();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [status, setStatus] = useState<MasterStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [licenseCode, setLicenseCode] = useState("");
  const [engaged, setEngaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locale = i18n.language === "it" ? "it-IT" : "en-US";

  const applyStatus = (next: MasterStatus) => {
    setStatus(next);
    setSelected(new Set(next.selectedFolders.map((folder) => folder.id)));
    if (next.license?.code) setLicenseCode(next.license.code);
  };

  const refresh = async (markEngaged = true) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (markEngaged) {
        setEngaged(true);
        await api.settingsSet("master_engaged", "1");
      }
      applyStatus(await api.masterStatus());
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      api.syncStatus(),
      api.foldersList(),
      api.settingsGet("master_engaged"),
    ]).then(([syncStatus, localFolders, storedEngagement]) => {
      setSync(syncStatus);
      setFolders(localFolders);
      const hasEngaged = storedEngagement === "1";
      setEngaged(hasEngaged);
      if (hasEngaged && syncStatus.connected) {
        setBusy(true);
        api
          .masterStatus()
          .then(applyStatus)
          .catch((reason) => setError(String(reason)))
          .finally(() => setBusy(false));
      }
    });
  }, []);

  const createRequest = async (type: "initial" | "renewal") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setEngaged(true);
      await api.settingsSet("master_engaged", "1");
      applyStatus(await api.masterRequest(type));
      setNotice(t("settings.master.requestSent"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!licenseCode.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      applyStatus(await api.masterActivate(licenseCode.trim()));
      setNotice(t("settings.master.activated"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveFolders = async () => {
    if (busy || !status?.deviceActivated) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const chosen = folders
        .filter((folder) => selected.has(folder.id))
        .map((folder) => ({ id: folder.id, name: folder.name }));
      applyStatus(await api.masterSetFolders(chosen));
      setNotice(t("settings.master.foldersSaved"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const schedulePublication = async () => {
    setError(null);
    try {
      await api.masterPublishNow();
      setNotice(t("settings.master.publicationScheduled"));
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <section className={sectionCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={sectionTitleCls}>{t("settings.master.title")}</h2>
          <p className={`mt-2 max-w-2xl ${helpTextCls}`}>
            {t("settings.master.help")}
          </p>
        </div>
        <button
          onClick={() => refresh()}
          disabled={busy || !sync?.connected}
          className={ghostBtnCls}
        >
          {busy
            ? t("common.loading")
            : t("settings.master.refresh")}
        </button>
      </div>

      <div
        className={`mt-4 rounded-xl border px-4 py-3 ${
          sync?.connected
            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200 pro:border-[#50fa7b]/30 pro:bg-[#50fa7b]/10 pro:text-[#50fa7b]"
            : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200 pro:border-[#f1fa8c]/30 pro:bg-[#f1fa8c]/10 pro:text-[#f1fa8c]"
        }`}
      >
        <p className="font-semibold">
          {sync?.connected
            ? t("settings.master.driveReady", { email: sync.email ?? "Google" })
            : t("settings.master.driveRequired")}
        </p>
        {!sync?.connected && (
          <p className="mt-1 text-sm">{t("settings.master.driveRequiredHelp")}</p>
        )}
      </div>

      {!engaged && sync?.connected && (
        <div className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700 pro:border-[#44475a]">
          <p className={helpTextCls}>{t("settings.master.optional")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => createRequest("initial")}
              disabled={busy}
              className={primaryBtnCls}
            >
              {t("settings.master.request")}
            </button>
            <button
              onClick={() => refresh()}
              disabled={busy}
              className={ghostBtnCls}
            >
              {t("settings.master.alreadyRequested")}
            </button>
          </div>
        </div>
      )}

      {status && (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MasterFact
              label={t("settings.master.requestState")}
              value={status.request?.status ?? t("settings.master.notRequested")}
            />
            <MasterFact
              label={t("settings.master.licenseState")}
              value={status.license?.status ?? t("settings.master.noLicense")}
            />
            <MasterFact
              label={t("settings.master.apiState")}
              value={
                status.api.enabled
                  ? t("settings.master.enabled")
                  : t("settings.master.disabled")
              }
            />
            <MasterFact
              label={t("settings.master.lastUpload")}
              value={
                status.publication.lastUpload
                  ? new Date(
                      status.publication.lastUpload * 1000,
                    ).toLocaleString(locale)
                  : t("settings.master.never")
              }
            />
          </div>

          {status.request?.status === "rejected" &&
            status.request.rejectionReason && (
              <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300 pro:border-[#ff5555]/40 pro:bg-[#ff5555]/10 pro:text-[#ff5555]">
                {t("settings.master.rejectionReason", {
                  reason: status.request.rejectionReason,
                })}
              </p>
            )}

          {!status.license && status.request?.status !== "pending" && (
            <button
              onClick={() => createRequest("initial")}
              disabled={busy}
              className={primaryBtnCls}
            >
              {t("settings.master.request")}
            </button>
          )}

          {status.license && (
            <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700 pro:border-[#44475a]">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1">
                  <span className={fieldLabelCls}>
                    {t("settings.master.licenseCode")}
                  </span>
                  <input
                    value={licenseCode}
                    onChange={(event) => setLicenseCode(event.target.value)}
                    className={`w-full font-mono ${inputCls}`}
                  />
                </label>
                <button
                  onClick={() => navigator.clipboard.writeText(licenseCode)}
                  className={ghostBtnCls}
                >
                  {t("common.copy", { defaultValue: "Copy" })}
                </button>
                {!status.deviceActivated && (
                  <button
                    onClick={activate}
                    disabled={busy || !licenseCode.trim()}
                    className={primaryBtnCls}
                  >
                    {t("settings.master.activate")}
                  </button>
                )}
              </div>
              <p className={`mt-2 ${helpTextCls}`}>
                {t("settings.master.expires", {
                  time: new Date(status.license.expiresAt * 1000).toLocaleString(
                    locale,
                  ),
                })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => createRequest("renewal")}
                  disabled={busy || status.request?.status === "pending"}
                  className={ghostBtnCls}
                >
                  {t("settings.master.renew")}
                </button>
                <button
                  onClick={() => openUrl("https://moonytask.com/portal/")}
                  className={ghostBtnCls}
                >
                  {t("settings.master.openPortal")}
                </button>
              </div>
            </div>
          )}

          {status.deviceActivated && status.license?.status === "active" && (
            <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700 pro:border-[#44475a]">
              <h3 className="font-semibold">
                {t("settings.master.folderSelection")}
              </h3>
              <p className={`mt-1 ${helpTextCls}`}>
                {t("settings.master.folderSelectionHelp")}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {folders.map((folder) => (
                  <label
                    key={folder.id}
                    className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700 pro:border-[#44475a]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(folder.id)}
                      className={checkboxCls}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(folder.id);
                        else next.delete(folder.id);
                        setSelected(next);
                      }}
                    />
                    {folder.name}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={saveFolders}
                  disabled={busy}
                  className={primaryBtnCls}
                >
                  {t("settings.master.saveFolders")}
                </button>
                <button
                  onClick={schedulePublication}
                  disabled={busy || !status.api.enabled}
                  className={ghostBtnCls}
                >
                  {t("settings.master.publishNow")}
                </button>
              </div>
              {status.api.waitingForApp && (
                <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-300 pro:text-[#f1fa8c]">
                  {t("settings.master.waitingForApp")}
                </p>
              )}
            </div>
          )}

          {status.lastError && (
            <p className="text-sm font-semibold text-red-600 dark:text-red-400 pro:text-[#ff5555]">
              {t("settings.master.lastError", { error: status.lastError })}
            </p>
          )}
        </div>
      )}

      {notice && (
        <p className="mt-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400 pro:text-[#50fa7b]">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400 pro:text-[#ff5555]">
          {error}
        </p>
      )}
    </section>
  );
}

function MasterFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900/40 pro:border-[#44475a] pro:bg-[#282a36]">
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 pro:text-[#b9b9c8]">
        {label}
      </p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
