# MoonyTask

Time tracker per progetti, nativo per macOS (Tauri 2), pronto per essere portato su altri sistemi operativi e mobile.

## Funzionalità

- **Cartelle e progetti** con costo orario per progetto
- **Timer manuale**: avvia / pausa / riprendi / stop, sempre visibile nella **menu bar** (anche a finestra chiusa)
- **App monitorate**: scegli app installate sul Mac; se ne usi una per 1 minuto senza timer attivo ricevi una notifica che ti propone di avviarlo
- **Report** con grafico tempo/giorno, ripartizione per progetto, tabella giornaliera e stima dei costi
- **Sync con Google Drive** (appDataFolder) per usare MoonyTask su più dispositivi — vedi [SETUP.md](SETUP.md)
- **Master / API Web opzionale**: licenza legata all’identità Google, scelta
  delle cartelle e pubblicazione in background di `PublishedSnapshotV1`
- Interfaccia **italiano / inglese**

## Sviluppo

Prerequisiti: Rust (`rustup`), Node.js, Xcode Command Line Tools.

Per il build Android, `rustup` deve essere installato e disponibile in PATH perché `tauri android` aggiunge i target necessari.

```bash
npm install
npm run tauri dev     # avvio in sviluppo
npm run tauri build   # crea MoonyTask.app / dmg in src-tauri/target/release/bundle
```

### Firma Android

L'APK di produzione usa sempre la stessa chiave. Non è previsto alcun fallback
alla chiave debug: una chiave diversa impedirebbe ad Android di aggiornare
un'installazione esistente.

I due file locali, entrambi esclusi da Git, sono:

- `src-tauri/gen/android/moonytask-release.jks`
- `src-tauri/gen/android/keystore.properties`

Il file `keystore.properties` ha questo formato:

```properties
storeFile=moonytask-release.jks
keyAlias=androiddebugkey
password=LA_PASSWORD_DEL_KEYSTORE
```

Conserva un backup sicuro di entrambi. `npm run android:apk` verifica anche
l'impronta SHA-256 del certificato atteso e interrompe la build se la firma cambia.

## Struttura

- `src/` — frontend React + TypeScript + Tailwind (i18n in `src/i18n/`)
- `src-tauri/src/` — backend Rust: `db.rs` (SQLite), `master.rs` (licenza, DTO e
  pubblicazione), `timer.rs`, `tray.rs`, `watcher.rs`, `apps.rs`, `sync/`
  (OAuth PKCE desktop, Google Identity Services Android, Google Drive + merge)

## Dati

Database locale: `~/Library/Application Support/com.minimamente.moonytask/moonytask.db` (SQLite).
Ogni record ha `updated_at` + tombstone `deleted` per il merge last-write-wins della sync.
