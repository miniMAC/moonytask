import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  InstalledApp,
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
const SETTINGS_TABS = ["general", "rates", "apps", "sync", "support"] as const;
const PAYMENT_TYPES: PaymentType[] = ["hourly", "retainer", "fixed"];

// input neutro usato solo nei modali (fuori dai box colorati)
const inputCls =
  "h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base dark:border-neutral-600 dark:bg-neutral-800 pro:border-[#44475a] pro:bg-[#343746] pro:text-[#f8f8f2]";
// stile condiviso dei box colorati, come Tariffa/Pagamenti nella scheda progetto
const sectionTitleCls = "text-sm font-bold uppercase tracking-wide text-white";
const fieldLabelCls = "mb-1 block text-sm font-medium text-white/85";
const helpTextCls = "text-sm text-white/75";

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
        {tab === "support" && <SupportSection />}
      </div>
    </div>
  );
}

// box viola: preferenze generali
const generalInputCls =
  "h-11 rounded-xl border border-white/45 bg-[#5C4FBF] px-3 text-base text-white outline-none transition placeholder:text-white/50 focus:border-white";
const generalGhostBtnCls =
  "h-11 rounded-xl border border-white/60 px-5 text-base font-medium text-white transition hover:bg-white hover:text-[#5C4FBF] disabled:opacity-50";

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
    <section className="rounded-2xl border border-[#5C4FBF] bg-[#7A6BD9] p-5 text-white shadow-[0_14px_35px_rgba(122,107,217,0.18)]">
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
            className={generalInputCls}
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
            className={generalInputCls}
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
            className={generalInputCls}
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
              className={generalInputCls}
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
            className="accent-white"
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
              className={`min-w-0 flex-1 ${generalInputCls}`}
            />
            <button
              onClick={choosePdfDir}
              disabled={pdfSelecting}
              className={generalGhostBtnCls}
            >
              {pdfSelecting
                ? t("common.loading")
                : t("settings.chooseFolder")}
            </button>
            <button onClick={savePdfDir} className={generalGhostBtnCls}>
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
            className="accent-white"
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
    <section className="rounded-2xl border border-[#A84369] bg-[#C95D87] p-5 text-white shadow-[0_14px_35px_rgba(201,93,135,0.18)]">
      <h2 className={sectionTitleCls}>{t("settings.support.title")}</h2>
      <p className={`mt-2 max-w-2xl ${helpTextCls}`}>
        {t("settings.support.help")}
      </p>
      <p className="mt-3 text-sm font-medium text-white/85">
        {t("settings.support.version")}: {version ?? "—"}
      </p>
      <button
        onClick={() => openUrl(`mailto:${email}?subject=${subject}`)}
        className="mt-4 h-11 rounded-xl bg-white px-5 text-base font-semibold text-[#A84369] transition hover:bg-white/90"
      >
        {t("settings.support.email")}
      </button>
    </section>
  );
}

// ---------- rate profiles ----------

// box blu, in tinta con la card Tariffa della scheda progetto
const rateFieldCls =
  "h-11 w-full rounded-md border border-white/45 bg-[#23768D] px-3 text-base text-white outline-none transition placeholder:text-white/50 focus:border-white";

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
    <section className="rounded-2xl border border-[#2D8FA8] bg-[#45B0CB] p-5 text-white shadow-[0_14px_35px_rgba(69,176,203,0.18)]">
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
            className={`rounded-xl border bg-[#2D8FA8] p-4 transition ${
              defaultId === profile.id
                ? "border-[#7CF5A4]"
                : "border-white/35"
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
                      ? "border-[#7CF5A4] bg-[#7CF5A4]/15 text-[#D9FFE6]"
                      : "border-white/50 text-white hover:bg-white hover:text-[#2D8FA8]"
                  }`}
                >
                  {defaultId === profile.id
                    ? `✓ ${t("settings.rates.default")}`
                    : t("settings.rates.setDefault")}
                </button>
                <button
                  onClick={() => removeProfile(profile.id)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/40 text-white/80 transition hover:border-white hover:bg-white hover:text-red-600"
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
        className="mt-4 flex h-11 items-center gap-1.5 rounded-xl border border-white/60 px-5 text-base font-medium text-white transition hover:bg-white hover:text-[#2D8FA8]"
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
    <section className="rounded-2xl border border-[#C4373C] bg-[#E5484D] p-5 text-white shadow-[0_14px_35px_rgba(229,72,77,0.18)]">
      <h2 className={sectionTitleCls}>{t("settings.danger.title")}</h2>
      <p className={`mt-2 max-w-2xl ${helpTextCls}`}>
        {t("settings.danger.resetHelp")}
      </p>
      <button
        onClick={() => {
          setDone(false);
          setStep(1);
        }}
        className="mt-3 h-11 rounded-xl border border-white/60 px-5 text-base font-semibold text-white transition hover:bg-white hover:text-[#C4373C]"
      >
        {t("settings.danger.resetButton")}
      </button>
      {done && (
        <p className="mt-2 text-sm font-semibold text-white">
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
const appsInputCls =
  "h-11 rounded-lg border border-white/45 bg-[#B5661A] px-3 text-base text-white outline-none transition placeholder:text-white/50 focus:border-white";

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
    <section className="rounded-2xl border border-[#B5661A] bg-[#D9822B] p-5 text-white shadow-[0_14px_35px_rgba(217,130,43,0.18)]">
      <h2 className={sectionTitleCls}>{t("settings.watchedApps")}</h2>
      <p className={`mt-2 ${helpTextCls}`}>
        {t("settings.watchedAppsHelp")}
      </p>

      <label className="mt-3 flex items-center gap-2 text-base">
        <input
          type="checkbox"
          className="accent-white"
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
            className="grid items-center gap-3 rounded-xl border border-white/35 bg-[#B5661A]/40 px-3 py-2 text-base md:grid-cols-[auto_minmax(0,1fr)_minmax(170px,220px)_150px_auto]"
          >
            <input
              type="checkbox"
              className="accent-white"
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
              <p className="truncate text-sm text-white/70">{w.bundleId}</p>
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
            <label className="flex items-center gap-1.5 text-sm text-white/80">
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
              className="rounded p-1 text-white/70 transition hover:text-white"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setPickerOpen(true)}
        className="mt-4 flex h-11 items-center gap-1.5 rounded-xl border border-white/60 px-5 text-base font-medium text-white transition hover:bg-white hover:text-[#B5661A]"
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
const syncInputCls =
  "h-11 rounded-xl border border-white/45 bg-[#2C8A52] px-3 text-base text-white outline-none transition placeholder:text-white/50 focus:border-white";

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
    <section className="rounded-2xl border border-[#2C8A52] bg-[#3EA96B] p-5 text-white shadow-[0_14px_35px_rgba(62,169,107,0.18)]">
      <h2 className={sectionTitleCls}>{t("settings.sync.title")}</h2>
      <p className={`mt-2 ${helpTextCls}`}>{t("settings.sync.help")}</p>

      {!status.configured ? (
        <p className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-sm text-white">
          {t("settings.sync.notConfigured")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {status.connected ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-sm font-medium text-white">
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
                className="h-11 rounded-xl border border-white/60 px-5 text-base font-medium text-white transition hover:bg-white hover:text-[#2C8A52] disabled:opacity-50"
              >
                {busy || status.inProgress
                  ? t("settings.sync.syncing")
                  : t("settings.sync.syncNow")}
              </button>
              <button
                onClick={() => api.syncLogout().then(refresh)}
                className="h-11 rounded-xl border border-white/60 px-5 text-base font-medium text-white transition hover:bg-white hover:text-red-600"
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
                  className="h-11 rounded-xl bg-white px-6 text-base font-semibold text-[#2C8A52] transition hover:bg-white/90 disabled:opacity-50"
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
            <p className="text-sm font-semibold text-[#FFE1E1]">
              {t("settings.sync.error", { error: status.lastError })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
