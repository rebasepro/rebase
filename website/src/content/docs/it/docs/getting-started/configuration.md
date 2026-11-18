---
sourceHash: 0309acf690d3fb3f
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca qualcosa di obbligatorio o se un valore è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica la variabile incriminata.
>
> La posizione dello schema dipende da come si esegue il backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che è l'unione
> di ogni tabella riportata di seguito. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })`, e può aggiungervi
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Opzionale in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria ovunque altrove. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> Per impostazione predefinita node-postgres verifica il certificato con
> `sslmode=require`. Gli strumenti libpq come `psql` accettano `require` con
> controlli più deboli e rifiutano `no-verify`. Usa
> `sslmode=verify-full&sslrootcert=/path/to/ca.pem` per verificare la CA e il nome
> host. Per cifrare senza verificare il certificato, imposta `sslmode=no-verify` in
> Rebase. Rebase passa `sslmode=require` a Ptah Compat e agli strumenti PostgreSQL di
> backup e ripristino. Per chiamate dirette a libpq, usa `sslmode=require`.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedi sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth di Google. Abilita "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostato nelle build di produzione.**
>
> In fase di sviluppo, il frontend e il backend si trovano su origini distinte, quindi il server
> di sviluppo inietta questa variabile. In produzione, il backend Rebase serve la SPA, quindi
> l'API coincide con l'origine stessa della pagina e il client la risolve autonomamente in questo modo.
>
> Inserire un URL assoluto in un bundle di produzione funziona solo fino a quando un secondo
> hostname non punta alla stessa applicazione: un dominio personalizzato caricherebbe la pagina da
> `example.com` ed effettuerebbe chiamate API su `example.rebase.website`, operazione
> cross-origin per cui ogni richiesta fallirebbe il preflight. Autorizzare l'origine in CORS
> **non** risolve il problema: il cookie di refresh è `SameSite=Lax` e non viene
> inviato cross-site, con il risultato che sparirebbero gli errori in console ma l'autenticazione
> rimarrebbe comunque compromessa. Se la variabile non è impostata, qualsiasi dominio che punta all'app
> funziona senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **esclusivamente dall'ambiente della shell** — un valore `PORT` in `.env` non viene letto lì, poiché la porta viene risolta prima del caricamento di quel file — altrimenti associa una porta derivata dal percorso del progetto, consentendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la priorità su entrambi, e il banner di avvio indica la configurazione adottata. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'istruzione SQL sottostante a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita contiene i parametri associati — un'email, un hash di password. Impostare su `true` durante la diagnosi di errori DDL, RLS o di change-capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatorio in produzione** a meno che non sia impostato `FRONTEND_URL`: un avvio in produzione privo di entrambi rifiuterà di partire. In fase di sviluppo viene *aggiunto a* localhost — vedi sotto. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzato come alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (usata per l'introspezione dello schema e per le operazioni amministrative). Il database indicato non è quello considerato corrente dalla console SQL, né quello copiato per impostazione predefinita da un nuovo branch: entrambi corrispondono al database su cui risiede la connessione dell'applicazione stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del database non sono mappati). In tal caso, la console SQL di Studio indicherà che le righe sono state lette come proprietario della connessione, specificandone il nome, e disabiliterà il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui è in esecuzione questo server. `rebase dev` lo imposta su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server che lo include mantiene il registro dei branch su quel database e copia i nuovi branch da esso per impostazione predefinita, in modo che il pannello Branches di Studio mostri i branch del database principale. | — |

#### CORS in fase di sviluppo

In fase di sviluppo sono consentiti **localhost, più qualsiasi origine specificata in `CORS_ORIGINS` (o `FRONTEND_URL`)** — lo stesso elenco usato in produzione, con localhost aggiunto anziché
sostituito. Di conseguenza, la variabile funziona allo stesso modo in entrambi gli ambienti, e i
casi in cui è necessaria in fase di sviluppo sono quelli tipici:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non è né localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con l'esatta riga necessaria per consentirla. Il rifiuto non
è prudenza fine a se stessa: l'API invia credenziali, quindi riflettere un'intestazione `Origin`
arbitraria consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare richieste
autenticate al server di sviluppo con la sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Segreto per la firma dei JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), in modo che qualsiasi entità in possesso del JWKS possa verificare una sessione senza poterla generare. Accetta un file PEM con interruzioni di riga reali, un PEM con caratteri di escape `\n` o l'intero PEM in base64. In sua assenza, i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificarlo a ogni cambio di chiave: la rotazione richiede che la vecchia e la nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del refresh token. A finestra scorrevole: ogni rotazione la rinnova, determinando quindi per quanto tempo una sessione sopravvive all'**inattività**. Impostare a `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser limitano il cookie di refresh a tale valore. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione, il **primo** utente può sempre registrarsi, indipendentemente da questo valore: una tabella utenti vuota deve accettare qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) questa finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un account ordinario e l'amministratore viene specificato con `REBASE_ADMIN_EMAIL` in basso o assegnato con la chiave di servizio. Il file `.env.example` dello scaffold lo imposta su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di emergenza. Chiude la finestra di bootstrap per il primo utente che `ALLOW_REGISTRATION=false` lascia intenzionalmente aperta al di fuori della produzione, bloccando la registrazione anche su un database vuoto. Associare a `REBASE_ADMIN_EMAIL` sottostante, altrimenti il deployment non avrà modo di generare il suo primo utente autenticato. Viene impostato da ogni artefatto di deployment distribuito. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **mentre la tabella utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il proprio amministratore: l'operatore specifica il primo account invece di competere con chiunque su Internet per crearlo. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP archiviato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e l'avvio genera un avviso: ruotare `JWT_SECRET` disconnetterebbe tutti gli utenti *e* renderebbe indecifrabili tutti gli autenticatori registrati. Impostare una chiave dedicata (oltre 32 caratteri casuali) prima che chiunque effettui la registrazione MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave precedente da cui si sta effettuando la rotazione. Impostarle entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che qualcuno rimanga bloccato fuori dal proprio account durante la transizione. Rimuoverla dopo aver ricifrato tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, volutamente non vincolata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Impostare su `false` per una superficie di lettura completamente pubblica — la RLS rimane comunque applicata. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato se non ne viene fornito alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito via email. Riservato solo a chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente individuato. Disattivato per impostazione predefinita poiché costituisce una potenziale superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è riservato a un frontend effettivamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Attivo per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per connessioni HTTP in chiaro — come un deployment su un indirizzo LAN dove il browser altrimenti scarterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza segnalare errori. Emette un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID OAuth di Google (convalida lato backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret OAuth di Google | — |
| `GITHUB_CLIENT_ID` | Client ID OAuth di GitHub | — |
| `GITHUB_CLIENT_SECRET` | Client secret OAuth di GitHub | — |
| `MICROSOFT_CLIENT_ID` | Client ID OAuth di Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret OAuth di Microsoft | — |
| `LINKEDIN_CLIENT_ID` | Client ID OAuth di LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret OAuth di LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | Client ID OAuth di Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret OAuth di Facebook | — |
| `TWITTER_CLIENT_ID` | Client ID OAuth di X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Client secret OAuth di X/Twitter | — |
| `DISCORD_CLIENT_ID` | Client ID OAuth di Discord | — |
| `DISCORD_CLIENT_SECRET` | Client secret OAuth di Discord | — |
| `GITLAB_CLIENT_ID` | Client ID OAuth di GitLab. L'opzione `baseUrl` per un'istanza self-hosted non dispone di una variabile d'ambiente — configurare GitLab nel blocco `auth` a questo scopo. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | Client ID OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | Client ID OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | Client ID OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | Services ID di Apple, per l'accesso web. È pubblico e pubblicato in `GET /auth/config`. Apple non prevede un client secret statico, poiché Rebase firma un token JWT ES256 a breve durata per ciascuno scambio di token. Di conseguenza, Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, unitamente a questo valore o ad `APPLE_BUNDLE_IDS`, e non configura nulla in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgole dei bundle ID delle app native iOS/macOS i cui codici Sign in with Apple vengono accettati. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'emittente (issuer) del JWT. | — |
| `APPLE_KEY_ID` | ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, interruzioni di riga incluse (i caratteri di escape `\n` sono supportati). | — |
| `REBASE_SERVICE_KEY` | Chiave API statica di amministrazione. Bypassa la normale autenticazione JWT per le chiamate server-to-server se passata come `Authorization: Bearer <key>`. (Generata automaticamente in fase di sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) rispetto alla quale vengono verificati i token di piattaforma `rpt_`; blocchi PEM multipli durante una rotazione delle chiavi. Viene impostata dalla piattaforma al momento del deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE`, consente al gate di amministrazione di accettare un token di piattaforma per `cron:read` e per null'altro. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID del progetto a cui deve corrispondere il claim `aud` del token di piattaforma, in modo da rifiutare i token generati per altri progetti. Se viene impostata solo una delle due variabili, il server si avvia, registra un avviso e risponde a ogni token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione in cui risiedono i contatori di rate limit, per le route di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per singolo processo) o `sql` (condiviso tra le repliche). Un processo non è in grado di rilevare il numero delle proprie repliche, pertanto un deployment distribuito deve specificarlo chiaramente — tre repliche con il valore predefinito applicherebbero un limite tre volte superiore. Qualsiasi altro valore **impedisce l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta il flusso di accesso senza password tramite link. Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Monta l'accesso senza password con un codice a sei cifre inviato via email. Stesso requisito per l'email indicato sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic link o codice email per un indirizzo sconosciuto crea l'account, a condizione che le registrazioni siano aperte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un refresh token oltre la finestra di riutilizzo consentita: `reject` (lo rifiuta, mantenendo attiva la sessione) o `revoke-session` (termina la sessione di accesso). Qualsiasi altro valore interrompe l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma preventiva: nessun accesso con password fino a quando l'indirizzo non viene verificato. Richiede il servizio email; in sua assenza l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostato indica l'assenza di captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio quando `CAPTCHA_PROVIDER` è impostato. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgole delle route di autenticazione da proteggere (ad esempio `register,login`). Non impostato protegge il set predefinito del provider. | — |

### Storage

:::caution[Lo storage non dispone di sicurezza a livello di riga, quindi richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. Lo storage a oggetti non ha un
meccanismo equivalente — le chiavi condividono un unico namespace piatto —
pertanto, in presenza di un bucket configurato senza un modello di accesso,
il server **rifiuta l'avvio in produzione**. È necessario soddisfare questo requisito con uno solo tra:
un hook `storageAuthorize` esportato da `backend/storage.ts` (fornito nello scaffold
di base), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di storage: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene interpretato a partire dalla directory in cui è in esecuzione il server: la radice del progetto sotto `rebase dev`, `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — solo in presenza di un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali con nome posizionate accanto ad esso | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durata in secondi dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte, su qualsiasi percorso di caricamento — `__<KEY>` per una sorgente con nome. Un valore che non sia un numero intero di byte impedisce l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza URL con stile a percorso (path-style) per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Di norma dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file delle chiavi dell'account di servizio (service account). Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Rende accessibile ogni oggetto a chiunque, senza necessità di token. Indicato solo per un bucket che agisce effettivamente da CDN pubblica. Uno dei tre modi per soddisfare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi chiamante autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Definito `INSECURE` nell'oggetto di configurazione per un motivo: è giustificabile solo in un'applicazione single-tenant in cui ogni account è ritenuto affidabile per qualsiasi file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza in cache le versioni generate delle immagini (ridimensionamenti, conversioni di formato) anziché rielaborarle a ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato per l'indirizzo mittente |
| `APP_NAME` | Nome del prodotto usato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato in cima ai template email predefiniti. File PNG o JPG con indirizzo `http(s)` assoluto — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostato, un'app ancora denominata `Rebase` riceve il logo Rebase, mentre un'app rinominata non ne riceve alcuno |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per ottenere una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non gestita da pooler). Necessaria per [Realtime](/docs/backend/realtime): `LISTEN`/`NOTIFY` non funziona attraverso un pooler in modalità transazione come PgBouncer e, in sua assenza, le notifiche di modifica vengono disabilitate con un avviso anziché andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene su di essa la sua istruzione `LISTEN` di risveglio. Popola il parametro `directConnectionString` dell'adattatore Postgres quando questo non è impostato. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un hot standby. Quando punta a un altro server, le letture degli utenti autenticati (elenchi, singole righe, conteggi, aggregazioni) vengono servite da lì sotto la medesima sicurezza a livello di riga; scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sul primario. Un client che ha appena eseguito una scrittura leggerà dal primario per un tempo pari a `REBASE_READ_STICKY_MS`, e tutti lo faranno qualora la replica accumuli un ritardo superiore a `REBASE_READ_MAX_LAG_MS` o sia in errore. Popola il parametro `readConnectionString` dell'adattatore Postgres quando questo non è impostato; fino alla versione 0.28 inclusa, il pool della replica veniva aperto senza mai esser letto. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, tempo durante il quale le letture dello stesso utente vengono indirizzate al primario, in modo che un salvataggio seguito da un elenco rifletta immediatamente le modifiche. Per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Ritardo della replica oltre il quale ogni lettura viene indirizzata al primario. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa attraverso un pooler in modalità transazione come PgBouncer. In tal caso il pool non invia `search_path` o `statement_timeout` al momento della connessione (il pooler li rifiuterebbe o li ignorerebbe) e li imposta in ciascuna transazione; l'avvio assegna al ruolo del database un `search_path` predefinito pari a `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatorio e viene utilizzato da realtime, dal risveglio del job worker, dalla creazione di indici, dal branching e dalla console SQL. Anche l'URL della replica viene considerato come gestito da pool. Usare `DATABASE_POOLED__<KEY>` per un'altra sorgente dati. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo per ciascun pool all'interno del processo, applicato a prescindere dal valore richiesto da ciascuno. Solo cifre numeriche: un valore non valido viene ignorato anziché serializzare silenziosamente le richieste del server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine del server
pubblicata. Un progetto che ha eseguito l'eject gestisce invece queste decisioni
all'interno del proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit pianificato della sicurezza a livello di riga](/docs/rls-check#running-it-on-a-schedule), che segnala le tabelle servite senza criteri (policies). Il progetto deve dichiarare `@rebasepro/rls-check` tra le sue dipendenze: il runtime non include una copia predefinita e, in assenza del pacchetto, l'avvio viene rifiutato indicandone il nome. `false` mantiene la scansione disattivata su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Assegnarne uno specifico a ogni progetto su un cluster condiviso. Il database registra il ruolo con cui opera e un avvio configurato con un altro ruolo rifiuterà di partire finché non viene eseguito `rebase db request-role migrate`. Vedere [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo per le richieste e consente alla connessione di passare ad esso; `never` lascia entrambi a carico dell'utente limitandosi a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | Privilegi che Rebase concede al ruolo delle richieste: `schema` (ogni tabella negli schemi che serve, oltre ai privilegi predefiniti), `managed` (solo le tabelle che serve) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe i criteri permissivi di Rebase ai soli ruoli di richiesta, in modo che altri ruoli che leggono le stesse tabelle non ottengano privilegi da essi. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` definisce le policy destinate esclusivamente al contesto server o all'amministratore con `TO public`, ed esegue gli amministratori con il ruolo delle richieste. Per impostazione predefinita sono impostate su `TO rebase_admin`, in modo che le letture con scope proprietario degli utenti autenticati possano usare l'indice di proprietà. Vedere [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base per server o amministratore da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, così che le policy scritte con `auth.uid()` possano identificare il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio quando un altro login può passare al ruolo delle richieste: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso di base per ogni route API. La stessa impostazione deve essere fornita al client — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/amministrativi del bundle da questo processo. Disattivare quando è presente una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprime le risposte con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` abilita le [notifiche push](/docs/backend/push-notifications/): le route `/api/push`, la tabella `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La coppia di chiavi VAPID con cui vengono firmati i messaggi push. Al di fuori della produzione, se non impostata, viene generata una coppia conservata in `.rebase-dev-secrets.json`; in produzione le notifiche push restano disattivate in loro assenza. | — |
| `REBASE_VAPID_SUBJECT` | Un indirizzo `mailto:` o un URL `https://` contattabile dai servizi push. Il valore predefinito è l'origine di un `REBASE_PUBLIC_URL` in `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico rifiuta l'avvio anziché rimuovere silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI. A tre stati. Se non impostata, in qualsiasi ambiente: `/api/docs` viene servito ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, ciascuno con la documentazione delle tabelle a lui descritte, senza interfaccia Swagger UI. `true` pubblica l'intero documento per tutti, con la Swagger **UI** su `/api/swagger` al di fuori della produzione (mai in produzione). `false` mantiene il documento protetto dal controllo di amministrazione. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, in modo che i browser rifiutino l'HTTP in chiaro su ogni sottodominio dell'host per sei mesi — inclusi gli host non serviti da questo processo. Attivare solo se ogni sottodominio del dominio è esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer a protezione di `/metrics`. Se non impostato, lascia l'endpoint accessibile a chiunque possa raggiungere la porta — accettabile su una rete privata, non su una pubblica, come segnalato dai log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Cosa può fare il runtime allo schema delle tabelle all'avvio. `ensure` (predefinito ovunque, produzione inclusa) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminarne o riscriverne alcuno. `none` non tocca lo schema delle tabelle dichiarate, sebbene le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengano comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disattiva anche queste. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio con `push`**. In un [deployment separato (split deployment)](/docs/deployment/split-processes), esattamente un solo processo può effettuare il provisioning, quindi ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` fa sì che il runtime non modifichi nulla nel database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, né all'avvio né successivamente, inclusi quelli del framework. Segnala invece per nome ciò che risulta mancante. Indicato per un database modificabile esclusivamente dal proprio processo di gestione modifiche. Vedere [Quando solo il proprio processo di gestione modifiche può modificare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio se l'ultimo provisioning del database è stato eseguito a partire da un set di tabelle differente rispetto a quello con cui è stato compilato questo processo. Se non impostato (o impostato su un valore diverso da `true`/`1`), genera invece un avviso. | avviso |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o di cron genera un errore o non viene analizzato correttamente durante l'importazione, indicando ciascun file e la relativa motivazione, in modo che un rolling deploy continui a servire la versione precedente. Questo vincolo si applica anche in caso di riavvio. Se non impostato (o su un valore diverso da `true`), salta il file e serve il resto. Un file importato correttamente che non esporta funzioni o job viene sempre saltato e non rifiutato. | salta |
| `REALTIME_CDC` | Change Data Capture a livello di database: `auto` (legge le modifiche dal WAL dove consentito dal database, altrimenti usa i trigger, altrimenti ricorre al fallback a livello applicativo, registrando ciascun fallback come info), `trigger` (lo forza, emette un avviso se impossibile), `wal` (legge le modifiche dal write-ahead log invece che dai trigger; richiede `wal_level=logical` e un ruolo abilitato alla replica, altrimenti ricorre al fallback su `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha la priorità su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Trasporto tra istanze per i canali broadcast e presence: `memory` o `postgres`. Ignorato se a `realtime.bus` è stato fornito un trasporto già configurato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quante sottoscrizioni può gestire un singolo socket realtime; la successiva viene rifiutata con `TOO_MANY_SUBSCRIPTIONS`. Numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quanti socket realtime può mantenere aperti un singolo utente o una singola chiave API su una specifica istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore stesso. Il login del successivo viene rifiutato con `TOO_MANY_SOCKETS` e il socket chiuso (4002); l'SDK continua a riprovare, connettendosi appena un altro socket si chiude. Numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo, in ms, che una modifica attende per il refetch con cui viene recapitata ai sottoscrittori attivi. Un refetch attende 300 ms senza modifiche, e al massimo questo intervallo in presenza di un flusso costante di scritture. Numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo di tempo, in ms, per il quale il totale di una sottoscrizione di un elenco di grandi dimensioni può essere riutilizzato prima di essere ricalcolato; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostato, ogni frame esegue il conteggio. Ha la priorità su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | Il valore minimo dell'ultimo totale a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi più piccoli vengono conteggiati a ogni frame. Ha la priorità su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback con `NODE_ENV=production`. Disattivato, in modo che un avvio in produzione fallisca in modo evidente anziché connettersi a un database inesistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio dello schema ed esce senza aprire alcun socket — la struttura ideale per un Job di migrazione, basato sulla stessa immagine e sullo stesso bundle del server successivo. Crea inoltre le tabelle che un processo in esecuzione creerebbe altrimenti al primo utilizzo e non avvia cron o code di job. Un valore vuoto equivale a *non impostato*, evitando che una variabile `${SOMETHING}` non sostituita in un file compose trasformi un deployment normale in uno che esegue solo migrazioni rifiutando il traffico. Rifiutato in combinazione con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un percorso di file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive ogni modifica allo schema effettuata, in ordine, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe scritte non sono incluse. Rifiutato su un processo che serve traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina — un agente, un job di CI — di *applicare* una modifica di schema tramite `/api/admin/schema`, anziché limitarsi a pianificarla. Disattivato se non espressamente richiesto: la credenziale che applicherebbe tale modifica è quella che con maggiore probabilità risiede in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo per cui una funzione personalizzata può essere eseguita prima che la sua richiesta venga interrotta. Stesso parametro dell'opzione `functionsTimeoutMs`. `0` lo disattiva. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promessa rifiutata non gestita (unhandled promise rejection) termini il processo anziché limitarsi a registrarla nei log. Attivo se controllato da un orchestratore predisposto al riavvio; disattivato laddove un riavvio sia peggiore di un memory leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silenzia l'avviso di avvio su una piattaforma rilevata dal runtime come scale-to-zero, dove un timer che scatta su un'istanza inattiva non scatterebbe su alcuna istanza. Non modifica null'altro: impostarlo se si mantiene costantemente in esecuzione almeno un'istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy a monte di questo server, consentendo al rate limiter di estrarre il reale indirizzo del client da `X-Forwarded-For`. Predefinito fail-safe su `0`: in assenza di proxy, fidarsi dell'header permetterebbe a qualsiasi chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non costituisce uno strumento di migrazione]
Il passaggio di avvio viene eseguito automaticamente senza che nessuno revisioni un diff,
pertanto non eliminerà mai una colonna, non restringerà un tipo né riscriverà una tabella.
Questo è anche il motivo per cui l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`:
un push completo calcola un diff e applicherebbe senza esitazioni un `DROP COLUMN`,
mentre il riavvio di un container non deve mai poter distruggere una colonna in produzione
come effetto collaterale di una riprogrammazione (rescheduling).

Le modifiche distruttive o strutturali rimangono in contesti dove possono essere revisionate:
`rebase db generate` + `rebase db migrate`, oppure `rebase db push` eseguito da un checkout
locale o da CI, che simula la modifica in dry-run, rifiuta i cambiamenti distruttivi in assenza
di conferma e può eseguire preventivamente un backup.
:::

### Deployment separati (Split deployments)

Una singola immagine e un singolo bundle possono essere avviati più volte, ciascuno a
presidio di una diversa componente del progetto. Di seguito una breve riga per ciascuna,
poiché questa pagina elenca l'insieme completo delle variabili; l'illustrazione dettagliata
di cosa ciascuna combinazione *monta e gestisce* — e quali combinazioni impediscono l'avvio —
è consultabile in **[Processi separati (Split Processes)](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Quale componente serve questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive se *questo* processo debba eseguire i timer dei cron. Se non impostato, segue quanto previsto dal ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive se questo processo debba eseguire i worker delle code di job. Se non impostato, segue quanto previsto dal ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve esclusivamente le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve ogni funzione personalizzata tranne quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a cui il processo API inoltra una richiesta di funzione che non gestisce direttamente. Su un `worker`, indica dove vengono inviate le sue chiamate `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint opzionale per il Model Context Protocol su `/mcp`, che consente a un client IA
di leggere e scrivere su questo progetto **come utente autenticato**. Disattivato per impostazione
predefinita e — a differenza di ogni altra superficie — nessun `REBASE_ROLE` lo attiva
automaticamente: gli altri descrivono la conformazione di un processo, mentre questa è una decisione
mirata a concedere credenziali a software di terze parti, e come tale deve essere deliberata da
una persona anziché ereditata dalla configurazione di un container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza la superficie non viene montata, segnalandolo nel log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine raggiungibile esternamente di questo deployment, ad es. `https://app.example.com`. La superficie MCP non può dedurla autonomamente — ricavare l'origine dall'header `Host` farebbe sì che l'identità dell'issuer e l'audience su cui vengono verificati i token corrispondano a un valore fornito dal chiamante. | — |
| `REBASE_MCP_VIEW` | Percorso della vista MCP App del progetto (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica, così da renderizzare viste, campi e azioni personalizzate. In sua assenza, il backend cerca accanto al frontend che serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere che i client vengano registrati preventivamente. | `true` |

### Modifica dello schema in tempo reale da un bundle

Disattivato a meno che `REBASE_LIVE_SCHEMA_REPOSITORY` non sia impostato. Un bundle
compilato non contiene il sorgente di `backend/schema` da modificare; pertanto, con queste
variabili impostate, l'editor di schema legge il sorgente dal repository, esegue il commit
di ciascuna modifica ed esegue il relativo DDL su questo database. Riservato agli amministratori
e applicato manualmente da un operatore, salvo diversamente specificato da
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`. Un repository indicato senza credenziali utilizzabili
impedisce l'avvio. Vedere [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui eseguire il commit delle modifiche allo schema, nel formato `owner/name`. L'impostazione di questo parametro attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene effettuato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | La posizione di `backend/schema` all'interno di quel repository, relativa al repository stesso. Un percorso che esce dal repository impedisce l'avvio, così come il parametro deprecato `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token fine-grained con accesso in lettura e scrittura ai contenuti del repository. Impostare questo parametro oppure le tre variabili `_GITHUB_APP_*`, non entrambi. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per eseguire il commit come app anziché tramite un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'ID di installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata dell'app: PEM, PEM con caratteri di escape per le interruzioni di riga o base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatorio insieme a `BACKUP_SCHEDULE`, che rifiuta l'esecuzione in sua assenza. `rebase db backup` ripiega su `./backups` nel percorso in cui è stato eseguito. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostato o pari a `0`, conserva tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno N backup più recenti, indipendentemente dalla retention. | — |
| `PG_DUMP_PATH` | Sovrascrive il binario `pg_dump` — deve corrispondere alla versione major del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Sovrascrive il binario `pg_restore`. | — |
| `PSQL_PATH` | Sovrascrive il binario `psql` eseguito da `rebase db restore --clean` per rendere il ripristino un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione di `pg_dumpall`, se non presente nel `PATH`. In sua assenza — e senza i client tools di PostgreSQL installati — un backup dei globals fallisce con un errore che cita questa variabile. | — |

L'immagine runtime ufficiale (`rebasepro/server`) include i client tools di PostgreSQL 18,
pertanto un backup pianificato eseguito al suo interno funziona con qualsiasi server fino a Postgres 18.
Al di fuori dell'immagine, è necessario installarli manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione privata dotata
di crittografia a riposo (encryption-at-rest).

### Distribuzione dei bundle (Bundle delivery)

Un deployment gestito non include il codice all'interno dell'immagine: il runtime recupera un
bundle all'avvio. Queste variabili stabiliscono quale bundle recuperare e in che modo.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una directory di bundle già estratta. Quello che `rebase start` imposta in locale. | — |
| `REBASE_BUNDLE_URL` | Posizione da cui scaricare l'archivio del bundle, quando non ve n'è uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | La credenziale Bearer per il download. Trattarla come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Posizione in cui viene estratto il bundle scaricato. Deve essere scrivibile e persistere tra il download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi forniti dall'immagine runtime al bundle, oltre a quelli dichiarati dal bundle stesso. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `backend/resources.ts` è
vincolato da variabili d'ambiente con il rispettivo nome. I nomi di base sono indicati di seguito;
una risorsa non predefinita aggiunge `__` e la propria chiave in lettere maiuscole, quindi un bucket
denominato `media` leggerà `S3_BUCKET__MEDIA`. `rebase status` stampa, per ciascuna risorsa,
l'esatta variabile che sta leggendo e se risulta impostata.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di una sorgente dati, quando non coincide con quello predefinito di Postgres. Aggiunge un suffisso per ogni sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Riceve un suffisso per topic. | — |

### L'ambiente della CLI

Lette da `rebase`, non dal server. Nessuna di queste voci influisce su un deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Destinazione a cui `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la chiave di servizio, nella shell o in `.env`. Da impostare quando il server è eseguito in un modo diverso da `rebase dev` in questo progetto: `rebase start`, un container, un altro host. Se non impostato, utilizzano il server registrato da `rebase dev` mentre quest'ultimo è in esecuzione, e non inviano nulla quando è spento. | — |
| `REBASE_SERVICE_KEY` | La chiave di servizio con cui tali comandi si autenticano, letta da `.env`: la stessa variabile letta dal server (vedi sopra). | — |
| `SERVICE_KEY` | Una denominazione precedente per tale chiave. Quando è impostata in `.env`, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quale file `.env` viene letto e scritto dalla CLI, qualora non coincida con quello del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole del progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile per una root i cui file per agenti sono gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Il piano di controllo (control plane) con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` esegue l'accesso, anziché richiederlo tramite prompt. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, in modo che un secret store possa fornirla senza che compaia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token generato con `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica con esso anziché con la sessione di `rebase cloud login`, senza mai leggere o scrivere la sessione salvata. In una directory collegata da `rebase cloud init --claim`, viene accantonato a favore del token proprio di quel progetto qualora non disponga dello scope necessario sul progetto stesso. È il metodo da adottare per eseguire `rebase cloud` in CI — vedi [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI creata dai propri cloud tool, senza mai inviarlo all'app: imposta `REBASE_API_TOKEN` a tale scopo. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e i dettagli della richiesta anziché il messaggio sintetico. La prima opzione da impostare quando un comando `rebase cloud` fallisce senza fornire informazioni utili. | — |
| `REBASE_ATLAS_DEV_URL` | Database di sviluppo vuoto per `db push` e `db generate`. Il nome resta invariato per i progetti esistenti. Rebase non gestisce un database indicato qui e rifiuta l’URL del database di destinazione. PGlite gestito riceve un database temporaneo in memoria. Usalo senza `CREATE DATABASE`; `db migrate` non ne ha bisogno. | `<db>_dev_diff` |
| `PTAH_TRUST_REPLAY_SQL` | Con PostgreSQL esterno, incluso un servizio Docker Compose locale, Ptah può rieseguire SQL per `db push`, `db push --dry-run` e `db generate`. Usa `PTAH_DEV_SERVER_DISPOSABLE=1` solo se puoi eliminare tutto il server di sviluppo. Su un server condiviso, `PTAH_TRUST_REPLAY_SQL=1` autorizza l’esecuzione con i privilegi della connessione di sviluppo. Attivalo solo se ti fidi di quel SQL. PGlite gestito è già temporaneo. | — |
| `PTAH_DEV_SERVER_DISPOSABLE` | Impostare a `1` solo se l'intero server di sviluppo può essere eliminato. Rebase lo imposta automaticamente per il server di sviluppo PGlite gestito. | non impostato |
| `PTAH_ATLAS_ALLOW_UNMATCHED_EXCLUDE` | Rebase lo imposta affinché lo stesso elenco di esclusioni funzioni anche quando manca un oggetto. Non serve impostarlo manualmente. | `1` durante i comandi del database |
| `PTAH_ATLAS_MIGRATE_DIFF_EXCLUDE` | Rebase lo imposta dai selettori degli oggetti protetti durante `db generate`. Non serve impostarlo manualmente. | generato |
| `PTAH_ATLAS_MIGRATE_DIFF_INCLUDE` | Rebase lo imposta dai selettori degli oggetti dichiarati durante `db generate`. Non serve impostarlo manualmente. | generato |
| `REBASE_PTAH_DEV_PGLITE` | Indicatore interno della connessione di sviluppo PGlite gestita. Rebase lo imposta automaticamente. | non impostato |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue alcun provisioning — dovrai fornirne uno tuo. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server frontend, che altrimenti `rebase dev` ricaverebbe dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa (in ms) impiegato da `rebase dev` prima che il backend annunci il proprio avvio, trascorso il quale ne segnala la mancata esecuzione. `0` disattiva la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password inserita da `rebase dev --docker` nella stringa di connessione derivata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione standard condivisa tra diversi strumenti. Se impostata su qualsiasi valore diverso da `0`, la CLI non invia dati telemetrici. | — |
| `REBASE_TELEMETRY_DISABLED` | La medesima funzionalità, specifica per Rebase. Non richiede alcun file di configurazione, motivo per cui è quella consigliata in ambienti CI e nelle immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destinazione a cui inviare i dati di telemetria, per un collector self-hosted. | — |

## Segreti in fase di sviluppo

`JWT_SECRET` è obbligatoria in produzione. Essa e `REBASE_SERVICE_KEY` vengono
generate automaticamente al di fuori della produzione, consentendo di iniziare senza configurare nulla.

I valori generati vengono salvati nella cache in `.rebase-dev-secrets.json`, accanto
a `.rebase-dev-port` e `.rebase-dev-url`, e ignorati da Git insieme ad essi. In precedenza
venivano rigenerati a ogni avvio — con la conseguenza che il riavvio del server di sviluppo
provocava il logout dall'applicazione e invalidava qualsiasi chiave API appena creata.

- Impostando esplicitamente una delle due variabili verrà usato il valore fornito; nulla verrà salvato in cache o letto.
- Indirizzare la cache altrove con `REBASE_DEV_SECRETS_FILE` — un percorso, nonché
  l'unica variabile di questa sezione che si abbia motivo di impostare deliberatamente.
- Eliminare il file per ruotare entrambi i segreti. Il successivo avvio ne scriverà uno nuovo.
- Se il file non può essere scritto — ad esempio in un container in sola lettura — il server
  si avvia comunque con un segreto effimero, esattamente come in passato.

Nulla viene memorizzato nella cache in produzione o all'interno di un test runner. In produzione
nulla viene generato automaticamente: un avvio privo di `JWT_SECRET` fallisce indicando il nome
della variabile, e questo comportamento resta invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

L'oggetto `RebaseBackendConfig` passato a `initializeRebaseBackend()` fornisce il controllo programmatico:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    schemaDir: "./schema",     // The backend/schema directory: the tables, and what the schema editor writes
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Publish the whole OpenAPI document at /api/docs to everyone

    logging: {
        level: "info"
    }
});
```

Le stesse opzioni,
senza `app`, `server` e `basePath` e con un parametro `provision` obbligatorio, consentono di compilare un
backend che non serve nulla finché non viene montato: `createRebaseBackend`. Vedere
[Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta ogni route API, pertanto è necessario comunicare la stessa modifica al client —
altrimenti continuerà a richiedere `/api/...` ottenendo un errore 404 per qualsiasi cosa:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione rileva questa impostazione dal client fornito; non occorre
configurare altro. Se si compone un URL di richiesta manualmente, concatenarlo a partire dal client anziché
scrivere `/api` a mano:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Errore di autorizzazione negata nell'editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, anche se la vista CMS a foglio di calcolo carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'editor SQL cambiando temporaneamente i ruoli del database in modo che corrispondano al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli esistono solo nelle tabelle del database anziché essere veri e propri ruoli PostgreSQL, il cambio di ruolo fallisce o mancano i relativi privilegi nel database. La vista CMS a foglio di calcolo viene invece eseguita con l'utente proprietario della connessione predefinita, bypassando questo passaggio.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione del file `.env` del backend. Questo forza Rebase a eseguire le query dell'editor SQL utilizzando i privilegi del proprietario della connessione (solitamente un superuser/owner). L'editor SQL indicherà quindi, sopra i risultati, che sono stati letti come proprietario della connessione, e disabiliterà il selettore dei ruoli.

### Recupero dello schema dell'editor SQL fallito (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'editor SQL restituisce l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornito al bootstrapper, o se `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Assicurarsi che `adminConnectionString` sia configurato durante l'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Passaggi successivi

- **[Deployment](/docs/getting-started/deployment)** — Guida al deployment in produzione
- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
