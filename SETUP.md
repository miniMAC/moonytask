# MoonyTask — Configurazione sync Google Drive

MoonyTask salva i dati in una cartella nascosta (`appDataFolder`) del **tuo** Google Drive.
Per attivare la sincronizzazione serve una credenziale OAuth di Google, da creare una sola volta (è gratis).

## 1. Crea il progetto su Google Cloud

1. Vai su <https://console.cloud.google.com/> e accedi con il tuo account Google.
2. In alto, clicca sul selettore progetti → **Nuovo progetto**.
3. Nome: `MoonyTask` (o quello che preferisci) → **Crea**.

## 2. Abilita l'API di Google Drive

1. Menu ☰ → **API e servizi** → **Libreria**.
2. Cerca **Google Drive API** → aprila → **Abilita**.

## 3. Configura la schermata di consenso OAuth

1. Menu ☰ → **API e servizi** → **Schermata consenso OAuth** (o "Google Auth Platform").
2. Tipo di utenti: **Esterni** → **Crea**.
3. Nome app: `MoonyTask`; email di assistenza: la tua; contatto sviluppatore: la tua email → **Salva e continua**.
4. Ambiti (scopes): puoi saltare → **Salva e continua**.
5. **Utenti di test**: aggiungi il tuo indirizzo Gmail (es. `minimamente.info@gmail.com`).
   > Finché l'app resta in modalità "test" solo gli utenti di test possono accedere: per uso personale va benissimo.

## 4. Crea le credenziali

1. Menu ☰ → **API e servizi** → **Credenziali** → **+ Crea credenziali** → **ID client OAuth**.
2. Tipo di applicazione: **App desktop**.
3. Nome: `MoonyTask Mac` → **Crea**.
4. Copia **Client ID** e **Client secret**.

## 5. Incorporali nell'app

1. Apri il file `src-tauri/google_credentials.json` e incolla i valori:

   ```json
   {
     "client_id": "IL_TUO_CLIENT_ID.apps.googleusercontent.com",
     "client_secret": "IL_TUO_CLIENT_SECRET"
   }
   ```

2. Ricompila l'app (`npm run tauri dev` oppure `npm run tauri build`):
   le credenziali vengono incorporate nell'eseguibile.
3. Apri MoonyTask → **Impostazioni** → **Sincronizzazione Google** → **Connetti account Google**:
   si apre il browser, accedi e autorizza. Fatto!
4. La sync avviene automaticamente all'avvio, ogni 5 minuti e a ogni stop del timer.

## Altri dispositivi

Le credenziali sono dentro l'app: sugli altri tuoi computer basta copiare la
`MoonyTask.app` compilata e cliccare **Connetti account Google** (punto 3). Nessun campo da compilare.

## Note

- Nell’uso standard i dati stanno sul dispositivo e, se abiliti la sync, nel
  tuo Drive (spazio nascosto dedicato all'app, non visibile tra i file).
- La modalità **Master / API Web** è separata e opzionale: soltanto dopo una
  richiesta esplicita pubblica sul backend le cartelle selezionate. Il backend
  non legge Drive e non conserva access token o refresh token Google.
- Il "Client secret" delle app desktop non è considerato segreto da Google, ma evita comunque di pubblicarlo.
- Per revocare l'accesso: <https://myaccount.google.com/permissions>.

## Backend Master per sviluppo e staging

L’app usa `https://api.moonytask.com` per default. Per una build di sviluppo o
staging imposta `MOONYTASK_API_URL` durante la compilazione Rust:

```bash
MOONYTASK_API_URL="https://staging-api.example.com" npm run tauri build
```

Il token dispositivo Master viene conservato nel keychain su macOS, Windows e
Linux e nello storage privato dell’app su Android. Le impostazioni Master e
qualunque credenziale sono escluse dall’export manuale JSON/CSV.
