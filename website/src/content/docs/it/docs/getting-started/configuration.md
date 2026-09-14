---
sourceHash: 11b34d6efd4ef32e
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` nella root del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> qualcosa di obbligatorio manca o è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come viene eseguito il backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che è l'unione
> di tutte le tabelle sottostanti. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })`, e può aggiungere lì
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Facoltativa in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i relativi dati in `.rebase/`. Obbligatoria ovunque altrove. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in fase di sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi specifica di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano: crittografa, ma non verifica il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la accettano e non
> degradano: rifiutano l'avvio con `invalid sslmode value: "no-verify"`.
>
> I comandi nativi di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima dell'esecuzione tramite shell,
> funzionando quindi con l'URL così come configurato. Se si utilizza `psql` manualmente, questo
> non accade: sostituire lì il parametro con `sslmode=require`, che crittografa senza verificare
> esattamente allo stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API di backend per l'SDK client. **Impostare solo in fase di sviluppo** — vedere sotto. | origin della pagina |
| `VITE_GOOGLE_CLIENT_ID` | Client ID Google OAuth. Abilita "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostato nelle build di produzione.**
>
> In fase di sviluppo, il frontend e il backend si trovano su origin distinte, quindi il server
> di sviluppo inietta questa variabile. In produzione, il backend di Rebase serve la SPA, quindi
> l'API coincide con l'origin della pagina stessa e il client la risolve autonomamente in questo modo.
>
> Includere un URL assoluto in un bundle di produzione funziona solo fino a quando un secondo
> hostname non punta alla stessa app: un dominio personalizzato caricherebbe la pagina da
> `example.com` ed effettuerebbe chiamate all'API su `example.rebase.website`, operazione
> cross-origin per cui ogni richiesta fallirebbe il preflight. Permettere l'origin nei CORS
> **non** risolve comunque il problema: il cookie di refresh ha `SameSite=Lax` e non viene
> inviato cross-site; pertanto si eliminerebbero gli errori in console ma l'autenticazione
> rimarrebbe compromessa. Se non impostato, ogni dominio che punta all'app funziona senza
> alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un `PORT` in `.env` non viene letto in questo contesto, poiché la porta viene risolta prima del caricamento di quel file — e altrimenti effettua il bind su una porta derivata dal percorso del progetto, consentendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la precedenza su entrambi, e il banner di avvio indica il criterio utilizzato. | `3001` |
| `LOG_LEVEL` | Verbosità del logging: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'istruzione SQL sottostante a una riga `Failed query: [redacted]`. Ogni query non riuscita viene oscurata per impostazione predefinita, poiché una query fallita contiene i relativi parametri associati (un'email, un hash di password). Impostare su `true` durante la diagnosi di errori relativi a DDL, RLS o change-capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production`, o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origin consentite. **Obbligatorio in produzione** se diverso dal dominio di backend. In sviluppo viene *aggiunto a* localhost — vedere sotto. | — |
| `FRONTEND_URL` | URL dell'app frontend. Utilizzato come alternativa a CORS_ORIGINS in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database a livello amministrativo (utilizzata per l'introspezione dello schema e per operazioni di amministrazione). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'Editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del database non sono mappati). | `false` |

#### CORS in fase di sviluppo

L'ambiente di sviluppo consente **localhost, oltre a qualunque valore specificato in `CORS_ORIGINS` (o `FRONTEND_URL`)** — lo stesso elenco utilizzato in produzione, con localhost aggiunto anziché sostituito. La variabile funziona quindi nello stesso modo in entrambi gli ambienti, e i casi che ne richiedono l'uso in fase di sviluppo sono quelli consueti:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origin che non sia localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origin** con l'indicazione della riga esatta che la abiliterebbe.
Il rifiuto non è prudenza fine a se stessa: l'API invia credenziali, pertanto riflettere un
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare richieste
autenticate contro il server di sviluppo con la sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Segreto per la firma JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), in modo che chiunque disponga del JWKS possa verificare una sessione senza poterla generare. Accetta un PEM con newline reali, un PEM con caratteri di escape `\n` o il base64 dell'intero PEM. Senza di essa i token rimangono HS256. | — |
| `JWT_KEY_ID` | Specifica il `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificarlo a ogni cambio della chiave — la rotazione si basa sulla capacità di distinguere la vecchia chiave dalla nuova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. A scorrimento — ogni rotazione la rinnova, determinando quindi quanto a lungo una sessione sopravvive all'**inattività**. | `400d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione, il **primo** utente può sempre registrarsi indipendentemente da questo valore — una tabella utenti vuota deve permettere l'ingresso a qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) questa finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, il primo account creato tramite registrazione aperta è un account ordinario, e l'amministratore viene indicato con `REBASE_ADMIN_EMAIL` sotto o assegnato con la service key. Il file `.env.example` dello scaffold la imposta su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Kill switch. Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia intenzionalmente aperta al di fuori della produzione, bloccando la registrazione anche in caso di database vuoto. Da associare a `REBASE_ADMIN_EMAIL` sotto, altrimenti il deployment non avrà modo di produrre il suo primo utente autenticato. Impostato da ogni artefatto di deployment distribuito. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella degli utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il proprio amministratore: l'operatore designa il primo account anziché fare a gara con Internet per crearlo. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Minimo 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP archiviato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e l'avvio genera un avviso singolo: ruotare `JWT_SECRET` disconnetterebbe quindi tutti gli utenti *e* renderebbe indecifrabili tutti gli autenticatori configurati. Impostare una chiave dedicata (32+ caratteri casuali) prima che chiunque effettui la registrazione. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la rotazione (*precedente*). Impostarle entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, garantendo che nessuno rimanga bloccato fuori dal proprio account durante la procedura. Rimuoverla dopo aver ricifrato ogni segreto. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Opzionale (opt-in) e deliberatamente non vincolato da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Impostare su `false` per una superficie di lettura completamente pubblica — la RLS si applica comunque. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato quando non ne viene fornito alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Registra l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato esclusivamente a chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente individuato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Direttiva `SameSite` per il cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato solo a un frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Flag `Secure` per il cookie di refresh. Attivo (`true`) per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per connessioni HTTP in chiaro — ad esempio un deployment su un indirizzo LAN in cui il browser scarterebbe altrimenti il cookie e la sessione terminerebbe alla scadenza dell'access token senza generare errori. Genera un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | ID client OAuth Google (validazione backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segreto client OAuth Google | — |
| `GITHUB_CLIENT_ID` | ID client OAuth GitHub | — |
| `GITHUB_CLIENT_SECRET` | Segreto client OAuth GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID client OAuth Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Segreto client OAuth Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID client OAuth LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Segreto client OAuth LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID client OAuth Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Segreto client OAuth Facebook | — |
| `TWITTER_CLIENT_ID` | ID client OAuth X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Segreto client OAuth X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID client OAuth Discord | — |
| `DISCORD_CLIENT_SECRET` | Segreto client OAuth Discord | — |
| `GITLAB_CLIENT_ID` | ID client OAuth GitLab. La `baseUrl` di un'istanza self-hosted non ha una corrispondenza nelle variabili d'ambiente: per questo caso, configurare GitLab nel blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Segreto client OAuth GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID client OAuth Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segreto client OAuth Bitbucket | — |
| `SLACK_CLIENT_ID` | ID client OAuth Slack | — |
| `SLACK_CLIENT_SECRET` | Segreto client OAuth Slack | — |
| `SPOTIFY_CLIENT_ID` | ID client OAuth Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segreto client OAuth Spotify | — |
| `APPLE_CLIENT_ID` | Services ID Apple. Apple non utilizza un segreto client statico — Rebase firma un JWT ES256 a breve termine per ogni scambio di token — pertanto richiede tutti e quattro i valori `APPLE_*`, senza i quali non configura nulla. | — |
| `APPLE_TEAM_ID` | Team ID sviluppatore Apple, l'issuer del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file di chiave privata `.p8`, inclusi i ritorni a capo (sono accettati i caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API amministrativa statica. Bypassa la normale autenticazione JWT per chiamate server-to-server se passata come `Authorization: Bearer <key>`. (Generata automaticamente in fase di sviluppo). | — |
| `REBASE_RATE_LIMIT_STORE` | Dove risiedono i contatori del rate-limiting di autenticazione: `memory` (per processo) o `sql` (condiviso tra le repliche). Un processo non può determinare il proprio numero di repliche, quindi un deployment con più nodi deve specificarlo esplicitamente — tre repliche con il valore predefinito applicherebbero il triplo del limite. Qualsiasi altro valore **rifiuta l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Registra il flusso di accesso senza password tramite link (magic link). Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Registra l'accesso senza password con codice a sei cifre inviato via email. Stesso requisito del servizio email indicato sopra. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostato disabilita il captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio quando `CAPTCHA_PROVIDER` è impostato. | — |
| `CAPTCHA_ROUTES` | Route di autenticazione da proteggere, separate da virgole (ad esempio `register,login`). Non impostato protegge l'insieme predefinito del provider. | — |

### Storage

:::caution[Lo storage non dispone di sicurezza a livello di riga (RLS), pertanto richiede un modello di accesso]
Le collection sono protette da Postgres RLS. L'object storage non ha un equivalente —
le chiavi condividono un unico namespace piatto — pertanto, in presenza di un bucket configurato
senza un modello di accesso, il server **rifiuta l'avvio in produzione**. È necessario soddisfare
questo requisito con uno solo tra i seguenti: un hook `storageAuthorize` esportato da
`config/index.ts` (fornito di default nello scaffold), `STORAGE_PUBLIC_READ`, o
`STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di storage: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — solo con un volume persistente montato su `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza URL in stile path per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Solitamente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file chiave del service account. Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Serve ogni oggetto a chiunque, senza token. Solo per bucket che fungono effettivamente da CDN pubblica. Uno dei tre modi per soddisfare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi chiamante autenticato di leggere, scrivere, elencare ed eliminare ogni oggetto. Denominato `INSECURE` nell'oggetto di configurazione per un motivo: è giustificabile solo in un'app single-tenant in cui ogni account è considerato attendibile per qualsiasi file. | `false` |
| `STORAGE_RENDITION_CACHE` | Esegue la cache delle interpretazioni grafiche generate per le immagini (ridimensionamenti, conversioni di formato) invece di produrle a ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato per l'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato negli oggetti e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo visualizzato in cima ai template email predefiniti. PNG o JPG assoluto `http(s)` — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostato, un'app ancora denominata `Rebase` riceve il logo Rebase, mentre una rinominata non ne riceve alcuno |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non in pool). Richiesta per [Realtime](/docs/backend/realtime): `LISTEN`/`NOTIFY` non sopravvive a un transaction pooler come PgBouncer, e senza di essa le notifiche di modifica vengono disabilitate con un avviso anziché perdersi silenziosamente. | — |
| `DATABASE_READ_URL` | Replica di lettura. Le letture vengono indirizzate lì quando impostata e diversa da `DATABASE_URL`; se la connessione fallisce, tutte le operazioni passano al primario con un avviso. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo su ogni pool nel processo, applicato a prescindere da quanto richiesto da ciascuno. Solo cifre numeriche: un valore malformato viene ignorato anziché serializzare silenziosamente il server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e dall'immagine del server
pubblicata. Un progetto che ha eseguito l'eject gestisce queste impostazioni
direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | Esegue l'audit della row-level security all'avvio e monta il relativo endpoint, che segnala le tabelle servite senza policy. | — |
| `REBASE_BASE_PATH` | Percorso di base per ogni route API. Al client deve essere comunicato lo stesso percorso — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/admin del bundle da questo processo. Disattivare quando è presente un CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche delle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Risposte compresse con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore che non sia un numero rifiuta l'avvio anziché rimuovere silenziosamente il limite). | — |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati: non impostato significa attivo in sviluppo, disattivato in produzione; `false` disattiva entrambi ovunque. Si noti che `true` in produzione serve la **specifica** su `/api/docs` ma non la **UI** di Swagger su `/api/swagger` — la UI è vincolata a `NODE_ENV` separatamente. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer a protezione di `/metrics`. Non impostato lascia l'endpoint aperto a chiunque possa raggiungere la porta — accettabile su una rete privata, sconsigliato su una pubblica, come segnalato nei log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Azioni che il runtime può eseguire sullo schema all'avvio. `ensure` (il valore predefinito, ovunque — inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere nulla. `none` non tocca nulla. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio su `push`**. In un [deployment frazionato](/docs/deployment/split-processes), esattamente un solo processo può effettuare il provisioning, quindi ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio se il database è stato predisposto l'ultima volta a partire da un insieme di collection diverso da quello con cui è stato compilato questo processo. Non impostato (o qualsiasi valore diverso da `true`/`1`) genera invece un avviso. | warn |
| `REALTIME_CDC` | Acquisizione dei dati di modifica (CDC) a livello di database: `auto` (abilita se la connessione lo supporta, fallback trasparente altrimenti), `trigger` (forza l'abilitazione, avvisa se impossibile), `wal` (attualmente degrada a `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Trasporto tra istanze per canali di broadcast e presence: `memory` o `postgres`. Ignorato se a `realtime.bus` è stato assegnato un trasporto già istanziato. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback con `NODE_ENV=production`. Disattivato per impostazione predefinita, in modo che un avvio in produzione fallisca vistosamente anziché connettersi a un database inesistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Comportamento all'avvio in presenza di una chiave nelle collection non letta da questa versione: `warn`, `error` (rifiuta l'avvio — consigliato da attivare in CI), o `off`. Regola solo le chiavi non *riconosciute*, che di solito sono un refuso e occasionalmente metadati intenzionali; una chiave che il sistema sa essere stata spostata è sempre fatale, poiché la funzionalità configurata risulterebbe altrimenti assente in modo silente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio dello schema ed esce senza aprire un socket — il formato desiderato per un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server che lo segue. Un valore vuoto equivale a *non impostato*, pertanto una variabile `${SOMETHING}` non sostituita in un file compose non può trasformare un deployment ordinario in uno che esegue le migrazioni rifiutandosi di servire richieste. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina — un agente, un job CI — di *applicare* una modifica di schema tramite `/api/admin/schema`, non solo di pianificarla. Disattivato se non espressamente richiesto: la credenziale atta a compiere tale modifica è quella con la maggiore probabilità di risiedere in una variabile CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione consentito per una funzione personalizzata prima che la relativa richiesta venga interrotta. Stesso controllo dell'opzione `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promise rejection non gestita termini il processo anziché limitarsi a registrarla nei log. Da attivare sotto un orchestratore in grado di riavviare il container; disattivare dove un riavvio è peggiore di un leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene attivo lo scheduler cron su una piattaforma che il runtime rileverebbe altrimenti come scale-to-zero, dove un timer che scatta in un'istanza inattiva non scatterebbe in alcuna istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy posti a monte di questo server, consentendo al rate limiter di estrarre il reale indirizzo del client da `X-Forwarded-For`. Valore predefinito di sicurezza `0`: in assenza di proxy, fidarsi dell'header consentirebbe a qualsiasi chiamante di falsificare un'identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non è uno strumento di migrazione]
Il passaggio di avvio viene eseguito senza presidio umano e senza che nessuno
verifichi un diff, pertanto non eliminerà mai una colonna, non restringerà un tipo
né riscriverà una tabella. Questo è anche il motivo per cui l'immagine rifiuta
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff ed eseguirebbe
senza problemi un `DROP COLUMN`, ma il riavvio di un container non deve mai
rischiare di distruggere una colonna di produzione come effetto collaterale di una rischedulazione.

Le modifiche distruttive o strutturali rimangono dove possono essere esaminate: `rebase db
generate` + `rebase db migrate`, o `rebase db push` da un checkout o in CI,
che esegue una simulazione (dry-run) della modifica, rifiuta quelle distruttive senza
conferma e può creare preventivamente un backup.
:::

### Deployment frazionati

Una singola immagine e un singolo bundle possono essere avviati più volte, ognuno al
servizio di una parte differente del progetto. Qui è riportata una riga per ciascuna
variabile, poiché questa pagina elenca tutte le variabili; ciò che ciascuna combinazione
*monta e gestisce* — e quali combinazioni rifiutano l'avvio — è documentato in
**[Split Processes](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Quale parte viene servita da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Esegue l'override indicando se *questo* processo debba eseguire i timer cron. Non impostato segue il ruolo. | — |
| `REBASE_JOB_WORKERS` | Esegue l'override indicando se questo processo debba eseguire i worker delle code di job. Non impostato segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve solo le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve tutte le funzioni personalizzate tranne quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a cui il processo API inoltra una richiesta di funzione che non gestisce direttamente. | — |

### Superficie MCP

Un endpoint opzionale (opt-in) Model Context Protocol su `/mcp`, che consente a un
client AI di leggere e scrivere su questo progetto **come utente autenticato**.
Disattivato se non espressamente impostato e — a differenza di ogni altra superficie —
nessun `REBASE_ROLE` lo abilita: gli altri descrivono la tipologia di processo, mentre
questa è una decisione consapevole di affidare credenziali a software di terze parti,
e dovrebbe essere presa da una persona anziché ereditata dalla mansione di un container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza la superficie non viene montata e lo segnala nel log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origin raggiungibile esternamente di questo deployment, ad es. `https://app.example.com`. La superficie MCP non è in grado di dedurla — ricavare l'origin dall'header `Host` renderebbe l'identità dell'emittente, e l'audience rispetto a cui vengono verificati i propri token, un valore fornito dal chiamante. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), consentendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere che i client siano preregistrati. | `true` |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Non impostato disattiva i backup pianificati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Non impostato o `0` conserva tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno N dei backup più recenti, indipendentemente dalla retention. | — |
| `PG_DUMP_PATH` | Esegue l'override del binario `pg_dump` — deve corrispondere alla versione major del server. | — |
| `PG_RESTORE_PATH` | Esegue l'override del binario `pg_restore`. | — |

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione privata
con crittografia at-rest.
| `PG_DUMPALL_PATH` | Percorso in cui risiede `pg_dumpall`, quando non è presente nel `PATH`. Senza di esso — e senza gli strumenti client di PostgreSQL installati — il backup delle impostazioni globali fallisce con un errore che fa riferimento a questa variabile. | — |

### Distribuzione del bundle

Un deployment gestito non include il codice all'interno dell'immagine: il runtime recupera
un bundle all'avvio. Queste variabili determinano quale bundle scaricare e come.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una directory del bundle già estratta. Quello che `rebase start` imposta localmente. | — |
| `REBASE_BUNDLE_URL` | Posizione da cui scaricare l'archivio del bundle, quando non ve n'è uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale Bearer per il download. Trattarla come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Cartella in cui viene estratto il bundle scaricato. Deve essere scrivibile e persistere tra il download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi che l'immagine di runtime fornisce al bundle, oltre a quelli dichiarati autonomamente. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `config/resources.ts` è
associato tramite variabili d'ambiente denominate in base ad esso. I nomi di base sono
riportati di seguito; una risorsa non predefinita aggiunge in coda `__` e la propria
chiave in lettere maiuscole, quindi un bucket chiamato `media` legge `S3_BUCKET__MEDIA`.
Il comando `rebase status` stampa, per ciascuna risorsa, l'esatta variabile letta e se sia impostata o meno.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di una sorgente dati, quando non è quello Postgres predefinito. Con suffisso per sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Con suffisso per topic. | — |

### L'ambiente della CLI

Letto da `rebase`, non dal server. Nessun parametro qui presente influisce su un deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Il backend con cui comunicano `rebase auth` e `rebase api-keys`, invece di dedurlo dal progetto. | — |
| `REBASE_PORT` | La porta assunta da tali comandi nel dedurre l'URL. | — |
| `SERVICE_KEY` | La service key con cui si autenticano, invece di richiederla tramite prompt. | — |
| `REBASE_ENV_FILE_PATH` | Il file `.env` letto e scritto dalla CLI, quando non coincide con quello del progetto. | — |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` effettua l'accesso, invece di richiederlo tramite prompt. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, in modo che un secret store possa fornirla senza che finisca nella cronologia della shell. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e il dettaglio della richiesta invece del messaggio sintetico. La prima opzione da impostare quando un comando `rebase cloud` fallisce senza fornire informazioni utili. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue il provisioning — è necessario fornirne uno proprio. Equivale a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server frontend, che `rebase dev` altrimenti ricaverebbe dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa in millisecondi che `rebase dev` concede al backend per annunciarsi prima di segnalare che non è stato avviato. `0` disabilita la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password che `rebase dev --docker` inserisce nella stringa di connessione derivata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convenzione cross-tool. Impostata su qualsiasi valore diverso da `0`, impedisce alla CLI di inviare telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo stesso, specificamente per Rebase. Non richiede file, ed è quindi l'opzione consigliata da utilizzare in CI e all'interno delle immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destinazione a cui inviare la telemetria, per un collettore self-hosted. | — |

## Segreti in fase di sviluppo

`JWT_SECRET` e `REBASE_SERVICE_KEY` sono obbligatori in produzione e generati
automaticamente negli altri ambienti, consentendo di iniziare senza configurare nulla.

Questi valori generati vengono memorizzati nella cache in `.rebase-dev-secrets.json`, accanto
a `.rebase-dev-port` e `.rebase-dev-url` ed esclusi da git insieme ad essi. In precedenza venivano
rigenerati a ogni avvio, pertanto il riavvio del server di sviluppo provocava la disconnessione
dall'applicazione e invalidava qualsiasi chiave API appena creata.

- Impostare una delle due variabili in modo esplicito per utilizzare il proprio valore; non verrà memorizzato o letto alcunché dalla cache.
- Puntare la cache su una posizione differente con `REBASE_DEV_SECRETS_FILE` — un percorso, nonché
  l'unica variabile di questa sezione che andrebbe mai impostata deliberatamente.
- Eliminare il file per rigenerare entrambi i segreti. L'avvio successivo ne creerà uno nuovo.
- Se il file non può essere scritto — ad esempio in un container in sola lettura — il server si avvia
  comunque con un segreto effimero, esattamente come in precedenza.

Nulla viene memorizzato nella cache in produzione o sotto un test runner. In produzione, un avvio
che dovesse trovarsi a dover generare uno dei due segreti fallisce comunque, indicando il nome
della variabile, e questo comportamento rimane invariato:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Oggetto di configurazione del backend

L'interfaccia `RebaseBackendConfig` passata a `initializeRebaseBackend()` fornisce un controllo programmatico:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
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

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

### Modifica di `basePath`

`basePath` sposta ogni route API, pertanto è necessario comunicare la stessa informazione
al client — altrimenti continuerà a effettuare richieste a `/api/...` ricevendo un 404 per ciascuna di esse:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione ricava questo valore dal client che gli viene fornito; non è richiesta
alcuna altra configurazione. Se si compone un URL di richiesta manualmente, concatenarlo a partire dal
client anziché scrivere `/api` direttamente nel codice:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, anche se la visualizzazione a foglio di calcolo del CMS carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL passando temporaneamente da un ruolo di database all'altro per farlo corrispondere al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli esistono solo nelle tabelle del database anziché come effettivi ruoli PostgreSQL, il cambio di ruolo fallisce o mancano i privilegi sul database. La visualizzazione a foglio di calcolo del CMS viene eseguita con l'utente proprietario della connessione predefinita e bypassa questo passaggio.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo costringe Rebase a eseguire le query dell'Editor SQL utilizzando i privilegi del proprietario della connessione (tipicamente un superuser/owner).

### Recupero dello schema non riuscito nell'Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema oppure l'Editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi di amministrazione. Se `adminConnectionString` non viene fornita al bootstrapper, o se `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Assicurarsi che `adminConnectionString` sia configurata durante l'inizializzazione del bootstrapper di backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Passaggi successivi

- **[Deployment](/docs/getting-started/deployment)** — Guida al deployment in produzione
- **[Backend Overview](/docs/backend)** — Riferimento completo alla configurazione del backend
