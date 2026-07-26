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
4. Apri **Data Access** → **Add or remove scopes** e aggiungi:
   - `https://www.googleapis.com/auth/drive.appdata`
   - `openid`
   - `email`
   poi salva. Lo scope `drive.appdata` consente a MoonyTask di gestire solo
   i dati nascosti creati dall'app, non gli altri file presenti su Drive.
5. Apri **Audience**, imposta il tipo di utenti su **External** e seleziona
   **Publish app** per portare lo stato su **In production**. In questo modo
   qualsiasi account Google può autorizzare la sincronizzazione e non serve
   mantenere una lista di utenti di test.
6. Completa in **Branding** i dati pubblici richiesti (nome app, email di
   assistenza e contatti sviluppatore). Se Google richiede homepage o privacy
   policy per la pubblicazione, usa pagine pubbliche appartenenti al dominio
   ufficiale di MoonyTask.

## 4. Crea le credenziali desktop

1. Menu ☰ → **API e servizi** → **Credenziali** → **+ Crea credenziali** → **ID client OAuth**.
2. Tipo di applicazione: **App desktop**.
3. Nome: `MoonyTask Mac` → **Crea**.
4. Copia **Client ID** e **Client secret**.

## 5. Registra anche l'app Android

Nello stesso progetto Google Cloud crea un secondo **ID client OAuth**:

- tipo applicazione: **Android**;
- nome pacchetto: `com.minimamente.moonytask`;
- impronta SHA-1 della chiave di produzione:
  `32:D2:02:0E:2B:59:9A:B5:01:DD:C2:A5:F1:48:12:A8:5B:29:48:7F`.

Questa credenziale non ha un secret da copiare nell'app. Serve a Google Play
Services per riconoscere il pacchetto e il certificato dell'APK. Se la firma
cambia, Google rifiuta l'autorizzazione Android.

Se usi anche la modalità **Master / API Web**, aggiungi il Client ID Android
alla variabile `GOOGLE_APP_CLIENT_IDS` del Worker, separandolo con una virgola
dal Client ID desktop. In questo modo il backend accetta l'identità verificata
proveniente da entrambe le app.

## 6. Incorpora le credenziali desktop nell'app

1. Apri il file `src-tauri/google_credentials.json` e incolla i valori:

   ```json
   {
     "client_id": "IL_TUO_CLIENT_ID.apps.googleusercontent.com",
     "client_secret": "IL_TUO_CLIENT_SECRET"
   }
   ```

2. Ricompila l'app (`npm run tauri dev` oppure `npm run tauri build`):
   le credenziali vengono incorporate nell'eseguibile.
3. Apri MoonyTask → **Impostazioni** → **Sincronizzazione Google** →
   **Connetti account Google**. Su desktop si apre il browser; su Android viene
   mostrata la schermata nativa di Google e, al termine, si torna direttamente
   nell'app.
4. La sync avviene automaticamente all'avvio, ogni 15 minuti e dopo le
   modifiche locali.

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
