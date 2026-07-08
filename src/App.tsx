import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type {
  Folder,
  Project,
  TimeEntry,
  TimerSnapshot,
} from "./lib/types";
import * as api from "./lib/api";
import Sidebar, { type View } from "./components/Sidebar";
import MobileNav from "./components/MobileNav";
import MobileProjectList from "./components/MobileProjectList";
import TimerBar from "./components/TimerBar";
import ProjectModal, {
  type ProjectModalState,
} from "./components/ProjectModal";
import FolderModal, { type FolderModalState } from "./components/FolderModal";
import ConfirmModal from "./components/ConfirmModal";
import Modal from "./components/Modal";
import ProjectView from "./views/ProjectView";
import ReportsView from "./views/ReportsView";
import SettingsView from "./views/SettingsView";

export default function App() {
  const { t, i18n } = useTranslation();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [timer, setTimer] = useState<TimerSnapshot>({
    status: "idle",
    projectId: null,
    projectName: null,
    elapsedSecs: 0,
  });
  const [view, setView] = useState<View>("project");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currency, setCurrency] = useState("EUR");
  const [refreshKey, setRefreshKey] = useState(0);
  const [projectModal, setProjectModal] = useState<ProjectModalState | null>(null);
  const [folderModal, setFolderModal] = useState<FolderModalState | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    action: () => Promise<void>;
  } | null>(null);
  const [noteRequest, setNoteRequest] = useState<TimeEntry | null>(null);
  const [quitAfterNote, setQuitAfterNote] = useState(false);
  const noteRequestRef = useRef<TimeEntry | null>(null);
  const [idlePrompt, setIdlePrompt] = useState<{
    idleStartEpoch: number;
    idleSecs: number;
  } | null>(null);

  const reload = useCallback(async () => {
    const [f, p] = await Promise.all([api.foldersList(), api.projectsList()]);
    setFolders(f);
    setProjects(p);
  }, []);

  useEffect(() => {
    noteRequestRef.current = noteRequest;
  }, [noteRequest]);

  useEffect(() => {
    reload();
    api.timerGetState().then(setTimer);
    api.settingsGet("language").then((l) => {
      if (l && l !== i18n.language) i18n.changeLanguage(l);
    });
    api.settingsGet("currency").then((c) => c && setCurrency(c));

    const unTimer = listen<TimerSnapshot>("timer_state", (e) => {
      setTimer((prev) => {
        // il passaggio a idle/pausa chiude un segmento: aggiorna le liste
        if (prev.status !== e.payload.status) setRefreshKey((k) => k + 1);
        return e.payload;
      });
    });
    const unData = listen("data_changed", () => {
      reload();
      setRefreshKey((k) => k + 1);
    });
    // il popover chiede di aprire un progetto nella finestra principale
    const unOpen = listen<string>("open_project", (e) => {
      setSelectedId(e.payload);
      setView("project");
    });
    const unNote = listen<TimeEntry>("entry_note_required", (e) => {
      setNoteRequest(e.payload);
      setRefreshKey((k) => k + 1);
    });
    // il backend ha rilevato inattività prolungata con il timer attivo
    const unIdle = listen<{ idleStartEpoch: number; idleSecs: number }>(
      "idle_detected",
      (e) => setIdlePrompt(e.payload),
    );
    const unQuit = listen("quit_requested", async () => {
      if (noteRequestRef.current) {
        setQuitAfterNote(true);
        return;
      }
      const snap = await api.timerGetState();
      if (snap.status === "idle") {
        await api.quitNow();
        return;
      }
      setQuitAfterNote(true);
      const entry = await api.timerStop();
      if (entry) {
        setNoteRequest(entry);
      } else {
        setQuitAfterNote(false);
        await api.quitNow();
      }
    });
    return () => {
      unTimer.then((f) => f());
      unData.then((f) => f());
      unOpen.then((f) => f());
      unNote.then((f) => f());
      unIdle.then((f) => f());
      unQuit.then((f) => f());
    };
  }, []);

  // scorciatoie: barra spaziatrice = start/pausa/riprendi
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.code !== "Space" ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        projectModal ||
        folderModal ||
        confirm ||
        noteRequest ||
        idlePrompt
      ) {
        return;
      }
      e.preventDefault();
      if (timer.status === "running") api.timerPause();
      else if (timer.status === "paused") api.timerResume();
      else if (selectedId) api.timerStart(selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timer.status, selectedId, projectModal, folderModal, confirm, noteRequest, idlePrompt]);

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;

  const deleteFolder = (folder: Folder) => {
    setConfirm({
      title: t("folders.delete"),
      body: folder.name,
      action: async () => {
        try {
          await api.folderDelete(folder.id);
          await reload();
        } catch (err) {
          if (String(err).includes("folder_not_empty")) {
            alert(t("folders.notEmpty"));
          }
        }
      },
    });
  };

  const deleteProject = (project: Project) => {
    setConfirm({
      title: t("projects.delete"),
      body: t("projects.deleteConfirm", { name: project.name }),
      action: async () => {
        await api.projectDelete(project.id);
        if (selectedId === project.id) setSelectedId(null);
        await reload();
      },
    });
  };

  return (
    <div className="flex h-full pro:bg-[#282a36]">
      <Sidebar
        folders={folders}
        projects={projects}
        view={view}
        selectedId={selectedId}
        timer={timer}
        onNav={setView}
        onSelectProject={(id) => {
          setSelectedId(id);
          setView("project");
        }}
        onNewFolder={() => setFolderModal({ mode: "create" })}
        onRenameFolder={(f) => setFolderModal({ mode: "rename", folder: f })}
        onDeleteFolder={deleteFolder}
        onDeleteProject={deleteProject}
        onNewProject={(folderId) => setProjectModal({ mode: "create", folderId })}
        onStart={(id) => api.timerStart(id)}
        onReorderFolders={async (ids) => {
          await api.foldersReorder(ids);
          await reload();
        }}
        onReorderProjects={async (folderId, ids) => {
          await api.projectsReorder(folderId, ids);
          await reload();
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-neutral-900 pro:bg-[#282a36]">
        <main className="flex-1 overflow-y-auto">
          {view === "reports" ? (
            <ReportsView
              folders={folders}
              projects={projects}
              currency={currency}
              refreshKey={refreshKey}
            />
          ) : view === "settings" ? (
            <SettingsView
              projects={projects}
              currency={currency}
              onCurrencyChange={setCurrency}
            />
          ) : selectedProject ? (
            <ProjectView
              project={selectedProject}
              folder={folders.find((f) => f.id === selectedProject.folderId)}
              timer={timer}
              currency={currency}
              refreshKey={refreshKey}
              onEdit={() =>
                setProjectModal({ mode: "edit", project: selectedProject })
              }
              onDelete={() => deleteProject(selectedProject)}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <>
              {/* su mobile la lista progetti sostituisce la sidebar */}
              <div className="md:hidden">
                <MobileProjectList
                  folders={folders}
                  projects={projects}
                  timer={timer}
                  onSelectProject={(id) => {
                    setSelectedId(id);
                    setView("project");
                  }}
                  onNewFolder={() => setFolderModal({ mode: "create" })}
                  onRenameFolder={(f) =>
                    setFolderModal({ mode: "rename", folder: f })
                  }
                  onDeleteFolder={deleteFolder}
                  onNewProject={(folderId) =>
                    setProjectModal({ mode: "create", folderId })
                  }
                  onStart={(id) => api.timerStart(id)}
                />
              </div>
              <div className="hidden h-full items-center justify-center md:flex">
                <p className="text-base text-neutral-400">
                  {t("projects.select")}
                </p>
              </div>
            </>
          )}
        </main>
        <TimerBar
          timer={timer}
          onOpenProject={(id) => {
            setSelectedId(id);
            setView("project");
          }}
        />
        <MobileNav
          view={view}
          onNav={(v) => {
            setView(v);
            // il tab Progetti torna alla lista, non all'ultimo progetto aperto
            if (v === "project") setSelectedId(null);
          }}
        />
      </div>

      {projectModal && (
        <ProjectModal
          state={projectModal}
          folders={folders}
          onClose={() => setProjectModal(null)}
          onSaved={async (id) => {
            setProjectModal(null);
            await reload();
            setSelectedId(id);
            setView("project");
          }}
        />
      )}
      {folderModal && (
        <FolderModal
          state={folderModal}
          onClose={() => setFolderModal(null)}
          onSaved={async () => {
            setFolderModal(null);
            await reload();
          }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.action();
            setConfirm(null);
          }}
        />
      )}
      {idlePrompt && (
        <IdlePromptModal
          idlePrompt={idlePrompt}
          onKeep={() => setIdlePrompt(null)}
          onDiscard={async () => {
            const prompt = idlePrompt;
            setIdlePrompt(null);
            // chiude il segmento all'inizio dell'inattività e ferma il timer;
            // il backend apre poi il consueto modale della nota
            await api.timerStopAt(prompt.idleStartEpoch);
          }}
        />
      )}
      {noteRequest && (
        <EntryNoteModal
          entry={noteRequest}
          onClose={async (note) => {
            if (note !== null) {
              await api.entryUpdateNote(noteRequest.id, note);
            }
            setNoteRequest(null);
            setRefreshKey((k) => k + 1);
            if (quitAfterNote) {
              setQuitAfterNote(false);
              await api.quitNow();
            }
          }}
        />
      )}
    </div>
  );
}

function IdlePromptModal({
  idlePrompt,
  onKeep,
  onDiscard,
}: {
  idlePrompt: { idleStartEpoch: number; idleSecs: number };
  onKeep: () => void;
  onDiscard: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const minutes = Math.max(1, Math.round(idlePrompt.idleSecs / 60));

  return (
    <Modal title={t("idle.title")} onClose={onKeep}>
      <div className="space-y-3">
        <p className="text-base text-neutral-500 dark:text-neutral-400">
          {t("idle.body", { minutes })}
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            onClick={onDiscard}
            className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {t("idle.discard")}
          </button>
          <button
            onClick={onKeep}
            className="h-11 rounded-lg bg-blue-600 px-6 text-base font-medium text-white hover:bg-blue-700"
          >
            {t("idle.keep")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EntryNoteModal({
  entry,
  onClose,
}: {
  entry: TimeEntry;
  onClose: (note: string | null) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(entry.note ?? "");

  return (
    <Modal title={t("timer.noteTitle")} onClose={() => onClose(null)}>
      <div className="space-y-3">
        <p className="text-base text-neutral-500 dark:text-neutral-400">
          {t("timer.noteBody")}
        </p>
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => onClose(null)}
            className="h-11 rounded-lg px-5 text-base text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {t("timer.noteSkip")}
          </button>
          <button
            onClick={() => onClose(note.trim())}
            className="h-11 rounded-lg bg-blue-600 px-6 text-base font-medium text-white hover:bg-blue-700"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
