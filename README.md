# MoonyTask

Time tracker per progetti, nativo per macOS (Tauri 2), pronto per essere portato su altri sistemi operativi e mobile.

## Funzionalità

- **Cartelle e progetti** con costo orario per progetto
- **Timer manuale**: avvia / pausa / riprendi / stop, sempre visibile nella **menu bar** (anche a finestra chiusa)
- **App monitorate**: scegli app installate sul Mac; se ne usi una per 1 minuto senza timer attivo ricevi una notifica che ti propone di avviarlo
- **Report** con grafico tempo/giorno, ripartizione per progetto, tabella giornaliera e stima dei costi
- **Sync con Google Drive** (appDataFolder) per usare MoonyTask su più dispositivi — vedi [SETUP.md](SETUP.md)
- Interfaccia **italiano / inglese**

## Sviluppo

Prerequisiti: Rust (`rustup`), Node.js, Xcode Command Line Tools.

```bash
npm install
npm run tauri dev     # avvio in sviluppo
npm run tauri build   # crea MoonyTask.app / dmg in src-tauri/target/release/bundle
```

## Struttura

- `src/` — frontend React + TypeScript + Tailwind (i18n in `src/i18n/`)
- `src-tauri/src/` — backend Rust: `db.rs` (SQLite), `timer.rs`, `tray.rs`, `watcher.rs` (rilevamento app in primo piano), `apps.rs` (scan app installate), `sync/` (OAuth PKCE + Google Drive + merge)

## Dati

Database locale: `~/Library/Application Support/com.minimamente.moonytask/moonytask.db` (SQLite).
Ogni record ha `updated_at` + tombstone `deleted` per il merge last-write-wins della sync.
