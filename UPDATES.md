# MoonyTask — Aggiornamenti automatici e distribuzione

L'app usa il plugin ufficiale `tauri-plugin-updater`. A ogni avvio (dopo ~15 secondi) e
dalla voce di menu **Controlla aggiornamenti…** (menu MoonyTask su macOS e menu della
tray su tutti i sistemi) l'app scarica:

```
https://moonytask.com/downloads/latest.json
```

Se la versione indicata lì è più nuova di quella installata, chiede all'utente se
installare, scarica il pacchetto firmato, lo verifica e propone il riavvio.

## 1. La chiave di firma (fatto una volta sola)

Gli aggiornamenti sono firmati: l'app accetta solo pacchetti firmati con la **tua**
chiave privata. La coppia di chiavi è già stata generata (password vuota):

- privata: `~/.tauri/moonytask.key` → **non perderla e non committarla**: senza questa
  chiave non potrai più pubblicare aggiornamenti per le app già installate.
  Fanne un backup (es. nel password manager).
- pubblica: `~/.tauri/moonytask.key.pub` → già incorporata in
  `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

Per la CI su GitHub aggiungi due secrets (Settings → Secrets and variables → Actions):

- `TAURI_SIGNING_PRIVATE_KEY` = contenuto del file `~/.tauri/moonytask.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = stringa vuota

Per compilare in locale (`npm run tauri build`) esporta prima:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/moonytask.key
```

Senza, la build desktop fallisce perché `createUpdaterArtifacts` è attivo.

## 2. Cosa caricare su FTP in `/downloads/`

La build (locale o via workflow "Build desktop artifacts") produce, oltre agli
installer, gli artefatti per l'updater con relativo file di firma `.sig`:

| Piattaforma | File da caricare | Firma |
|---|---|---|
| macOS | `MoonyTask.app.tar.gz` (bundle `app`) | `MoonyTask.app.tar.gz.sig` |
| Windows x64/arm64 | `MoonyTask_X.Y.Z_…-setup.exe` (NSIS) | `.exe.sig` |
| Linux | `MoonyTask_X.Y.Z_amd64.AppImage` | `.AppImage.sig` |

Il `.sig` **non** va caricato come file: il suo contenuto (una riga base64) va incollato
nel campo `signature` di `latest.json`. Carica anche DMG/MSI/DEB/RPM per chi scarica
dal sito la prima volta.

## 3. Il file `latest.json`

Il template pronto da compilare sta nella repo del sito: `miniMAC/moonytaskweb`,
file `downloads/latest.json`. A ogni release aggiorni versione, URL e firme e lo
carichi via FTP in `/downloads/` insieme ai pacchetti.

```json
{
  "version": "0.2.0",
  "notes": "Novità di questa versione…",
  "pub_date": "2026-07-06T18:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "CONTENUTO DEL FILE MoonyTask.app.tar.gz.sig",
      "url": "https://moonytask.com/downloads/MoonyTask_0.2.0_universal.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "CONTENUTO DEL FILE MoonyTask.app.tar.gz.sig",
      "url": "https://moonytask.com/downloads/MoonyTask_0.2.0_universal.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "CONTENUTO DEL FILE MoonyTask_0.2.0_x64-setup.exe.sig",
      "url": "https://moonytask.com/downloads/MoonyTask_0.2.0_x64-setup.exe"
    },
    "windows-aarch64": {
      "signature": "CONTENUTO DEL FILE MoonyTask_0.2.0_arm64-setup.exe.sig",
      "url": "https://moonytask.com/downloads/MoonyTask_0.2.0_arm64-setup.exe"
    },
    "linux-x86_64": {
      "signature": "CONTENUTO DEL FILE MoonyTask_0.2.0_amd64.AppImage.sig",
      "url": "https://moonytask.com/downloads/MoonyTask_0.2.0_amd64.AppImage"
    }
  }
}
```

Note:
- la build macOS è universale, quindi `darwin-aarch64` e `darwin-x86_64` puntano allo
  stesso `.app.tar.gz`;
- su Linux l'updater aggiorna solo l'**AppImage**; chi installa DEB/RPM aggiorna con il
  gestore pacchetti scaricando il nuovo file dal sito;
- gli URL devono essere **https** (il sito è dietro Cloudflare, quindi ok).

## 4. Checklist di rilascio

1. Aggiorna la versione in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` e
   `package.json` (devono coincidere).
2. Lancia il workflow **Build desktop artifacts** su GitHub (o builda in locale con la
   variabile `TAURI_SIGNING_PRIVATE_KEY_PATH` impostata).
3. Scarica gli artefatti e carica su FTP in `/downloads/` gli installer e gli artefatti
   updater della tabella sopra.
4. Aggiorna `latest.json` con nuova `version`, URL e firme, e caricalo per **ultimo**.
5. Verifica: apri l'app vecchia → menu → Controlla aggiornamenti…

## 5. Pacchetto RPM (Fedora / openSUSE)

L'RPM viene generato dalla build Linux del workflow. In `tauri.conf.json` ora sono
dichiarate le dipendenze runtime come soname (`libwebkit2gtk-4.1.so.0`,
`libgtk-3.so.0`), come richiesto dalle linee guida di packaging: così `dnf` installa da
solo WebKitGTK se manca. A queste, la CLI di Tauri aggiunge **automaticamente**
`libayatana-appindicator3.so.1()(64bit)` perché la feature `tray-icon` è attiva: è la
libreria che disegna l'icona nella tray su Linux, non si può togliere.

**Importante: non installare con `rpm -ivh`** — `rpm` non risolve le dipendenze dai
repository e fallisce con `Dipendenze fallite: libayatana-appindicator3.so.1()(64bit)
necessario`. Va usato il gestore pacchetti della distro, che scarica da solo la
libreria mancante:

```sh
# Fedora / RHEL (la dipendenza è nel pacchetto libayatana-appindicator-gtk3)
sudo dnf install ./MoonyTask-Linux-x64.rpm

# openSUSE (pacchetto libayatana-appindicator3-1)
sudo zypper install ./MoonyTask-Linux-x64.rpm
```

In alternativa si può installare prima la libreria a mano
(`sudo dnf install libayatana-appindicator-gtk3`) e poi usare `rpm -ivh`.

Se un utente non riesce a installare, fatti mandare l'output esatto di quel comando:
il workflow ora stampa anche metadati e dipendenze dell'RPM (`rpm -qip` / `rpm -qRp`)
nel log, utile per confrontare.
