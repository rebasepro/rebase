---
sourceHash: a6ecab532bd0be01
title: Ambiente e Configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase valida le variabili d'ambiente con **Zod** all'avvio. Se
> qualsiasi variabile obbligatoria manca o non è valida (un URL che non è un URL, una porta
> che non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come viene eseguito il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di tutte le tabelle riportate di seguito. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })` e può aggiungere lì
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria in qualsiasi altro contesto. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi propria di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano: esegue la crittografia, ma non verifica il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la supportano e non
> degradano: rifiutano l'avvio con `invalid sslmode value: "no-verify"`.
>
> I comandi interni di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima di invocare i processi shell,
> funzionando quindi con l'URL configurato. L'utilizzo manuale diretto di `psql` non
> funziona: sostituirla con `sslmode=require`, che esegue la crittografia senza
> verifica esattamente nello stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API backend per l'SDK client. **Impostare solo in fase di sviluppo** — vedere sotto. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID Google OAuth. Abilita "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostato nelle build di produzione.**
>
> In fase di sviluppo il frontend e il backend si trovano su origini separate, per cui il dev
> server inietta questa variabile. In produzione il backend di Rebase serve la SPA, pertanto
> l'API coincide con l'origine stessa della pagina e il client la risolve autonomamente in questo modo.
>
> Includere un URL assoluto in un bundle di produzione funziona solo fino a quando un secondo
> hostname non punta alla stessa app: un dominio personalizzato caricherebbe la pagina da
> `example.com` ed eseguirebbe chiamate API verso `example.rebase.website`, operando in
> cross-origin e facendo fallire il preflight di ogni richiesta. Consentire l'origine in CORS
> **non** risolverebbe comunque il problema — il cookie di refresh è impostato su `SameSite=Lax` e non
> viene inviato cross-site; pertanto, pur azzerando gli errori in console, l'autenticazione
> risulterebbe comunque compromessa. Se la variabile non viene impostata, qualsiasi dominio che punta
> all'app funziona senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un `PORT` definito in `.env` non viene letto, poiché la porta viene risolta prima del caricamento di tale file — e in alternativa associa una porta derivata dal percorso del progetto, consentendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la priorità su entrambi e il banner di avvio indica quale opzione è stata utilizzata. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'SQL associato a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita include i parametri associati (un'email, un hash di password). Impostare su `true` durante la diagnosi di errori relativi a DDL, RLS o change-capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco di origini consentite separate da virgola. **Obbligatorio in produzione** se diverso dal dominio di backend. In sviluppo viene *aggiunto a* localhost — vedere sotto. | — |
| `FRONTEND_URL` | URL dell'app frontend. Utilizzato come alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e le operazioni di amministrazione). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'Editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del DB non sono mappati). | `false` |

#### CORS in sviluppo

Lo sviluppo consente **localhost, più qualsiasi origine specificata in `CORS_ORIGINS` (o `FRONTEND_URL`)**
— lo stesso elenco utilizzato in produzione, con localhost aggiunto anziché
sostituito. Pertanto la variabile funziona allo stesso modo in entrambi gli ambienti, e i
casi in cui è necessaria in fase di sviluppo sono quelli consueti:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non sia né localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una sola volta per origine** con l'esatta riga necessaria per abilitarla. Il rifiuto
non è una misura cautelativa fine a se stessa: l'API invia credenziali, quindi riflettere un
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate contro il dev server con la sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Segreto per la firma dei JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare i token di accesso in modo asimmetrico (RS256), consentendo a qualsiasi entità in possesso del JWKS di verificare una sessione senza poterla generare. Accetta un PEM con ritorni a capo reali, un PEM con sequenze di escape `\n` o l'intero PEM codificato in base64. In sua assenza i token restano HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Da modificare a ogni cambio della chiave: la rotazione richiede che la vecchia e la nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del refresh token. A scorrimento: ogni rotazione ne estende la validità, determinando per quanto tempo una sessione sopravvive all'**inattività**. | `400d` |
| `ALLOW_REGISTRATION` | Consente a nuovi utenti di registrarsi (`true`/`false`). Al di fuori della produzione, il **primo** utente può sempre registrarsi indipendentemente da questa impostazione: una tabella utenti vuota deve consentire un accesso iniziale, e tale utente diventa l'amministratore. In produzione (`NODE_ENV=production`) questa possibilità è bloccata: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, il primo account creato tramite registrazione aperta è un account ordinario, e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` di seguito o assegnato con la service key. Il file `.env.example` dello scaffold lo imposta su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di sicurezza. Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, bloccando la registrazione anche su un database vuoto. Da associare a `REBASE_ADMIN_EMAIL` di seguito, altrimenti il deployment non avrà modo di generare il primo utente autenticato. Viene impostato da tutti gli artefatti di deployment distribuiti. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **mentre la tabella utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il suo amministratore: l'operatore definisce il primo account invece di rischiare una race condition su Internet. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per quell'account. Almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Cifra tutti i segreti TOTP memorizzati. Se non impostata, i segreti vengono cifrati con `JWT_SECRET` e all'avvio viene emesso un avviso: in tal caso, la rotazione di `JWT_SECRET` disconnette tutti gli utenti *e* rende indecifrabili tutti gli autenticatori configurati. Impostare una chiave dedicata (almeno 32 caratteri casuali) prima che gli utenti inizino la registrazione. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la rotazione (*precedente*). Impostare entrambe le variabili durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti restano leggibili, evitando che gli utenti rimangano bloccati fuori dal proprio account durante la rotazione. Rimuoverla dopo aver ricifrato tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, deliberatamente slegata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Impostare su `false` per esporre in lettura completamente pubblica — la RLS si applica comunque. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato quando non ne viene indicato uno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Espone `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito via email. Riservato ai soli chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disattivato per impostazione predefinita in quanto superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato unicamente a un frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Attivo per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per il semplice HTTP — utile per un deployment su un indirizzo LAN in cui il browser altrimenti rifiuterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza errori. Genera un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID Google OAuth (validazione lato backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client secret GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client secret X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client secret Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID GitLab OAuth. L'attributo `baseUrl` per un'istanza self-hosted non dispone di una variabile d'ambiente: per questo configurare GitLab nel blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID. Apple non dispone di un client secret statico — Rebase firma un JWT ES256 a breve durata per ogni scambio di token — pertanto sono necessari tutti e quattro i valori `APPLE_*`, in assenza dei quali non viene configurato nulla. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'emittente (issuer) del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi i ritorni a capo (le sequenze di escape `\n` sono accettate). | — |
| `REBASE_SERVICE_KEY` | Chiave API amministrativa statica. Bypassa la normale autenticazione JWT per le chiamate server-to-server se fornita come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione in cui risiedono i contatori del rate limiting per l'autenticazione: `memory` (per singolo processo) o `sql` (condiviso tra le repliche). Un processo non può determinare il numero delle proprie repliche; pertanto un deployment con più nodi deve specificarlo esplicitamente — tre repliche con il valore predefinito applicherebbero una soglia tripla. Qualsiasi altro valore **impedisce l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso senza password tramite magic link. Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password tramite codice a sei cifre inviato via email. Stessi requisiti per il servizio email menzionati sopra. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostato disabilita il captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token trasmesso dal browser. Obbligatorio quando `CAPTCHA_PROVIDER` è impostato. | — |
| `CAPTCHA_ROUTES` | Route di autenticazione da proteggere separate da virgola (ad esempio `register,login`). Se non impostato, protegge il set predefinito del provider. | — |

### Archiviazione

:::caution[Lo storage non include row-level security, pertanto richiede un modello di accesso]
Le collezioni sono protette tramite Postgres RLS. L'object storage non ha un equivalente —
le chiavi condividono un unico namespace piatto — quindi, con un bucket configurato e nessun
modello di accesso, il server **rifiuta l'avvio in produzione**. È necessario soddisfare questo
requisito con uno solo tra i seguenti elementi: un hook `storageAuthorize` esportato da
`config/index.ts` (incluso nello scaffold), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — solo con un volume persistente montato su `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza l'uso di URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Solitamente ricavato dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file della chiave del service account. Omettere su GCP, dove le credenziali sono fornite da Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Serve ogni oggetto a chiunque, senza token. Solo per un bucket che opera a tutti gli effetti come CDN pubblica. Una delle tre modalità per soddisfare il controllo di avvio descritto di seguito. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Denominato `INSECURE` nell'oggetto di configurazione per un motivo preciso: è giustificabile solo in un'app single-tenant in cui tutti gli account hanno accesso affidabile a ogni file. | `false` |
| `STORAGE_RENDITION_CACHE` | Salva in cache le versioni generate delle immagini (ridimensionamenti, conversioni di formato) anziché produrle a ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato associato all'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato negli oggetti e nei corpi delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato nell'intestazione dei template email predefiniti. URL assoluto `http(s)` PNG o JPG — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostato, un'app ancora denominata `Rebase` riceve il logo Rebase, mentre un'app rinominata non ne riceve alcuno |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento per una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per ottenere una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pooler). [Realtime](/docs/backend/realtime) ne richiede una: `LISTEN`/`NOTIFY` non sopravvive a un pooler di transazioni come PgBouncer; in sua assenza le notifiche di modifica vengono disabilitate con un avviso anziché perdersi silenziosamente. | — |
| `DATABASE_READ_URL` | Replica di lettura. Le letture vengono instradate qui quando è impostato e differisce da `DATABASE_URL`; se la connessione fallisce, viene eseguito il fallback al database primario con un avviso. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo su ogni pool all'interno del processo, applicato indipendentemente dalla richiesta di ciascuno. Solo cifre: un valore non valido viene ignorato anziché serializzare silenziosamente le richieste al server. | — |

### Comportamento a runtime

Lette dal runtime — `rebase dev`, `rebase start` e l'immagine
server pubblicata. Un progetto che ha effettuato l'eject gestisce queste decisioni direttamente
nel proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | Esegue l'audit della row-level security all'avvio e monta il relativo endpoint, che segnala le tabelle servite senza policy. | — |
| `REBASE_BASE_PATH` | Percorso base per ogni route API. Il client deve essere configurato in modo identico — vedere [Modifica di `basePath`](#changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/amministrativi del bundle da questo processo. Disattivare quando è presente una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Risposte compresse con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché rimuovere silenziosamente il limite). | — |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati: non impostata indica attiva in sviluppo, disattivata in produzione; `false` disattiva entrambe ovunque. Nota che `true` in produzione serve la **specifica** su `/api/docs` ma non l'**interfaccia Swagger** su `/api/swagger` — l'interfaccia utente è controllata separatamente da `NODE_ENV`. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a protezione di `/metrics`. Se non impostato, lascia l'endpoint accessibile a chiunque possa raggiungere la porta — accettabile su una rete privata, non su una pubblica, e i log di avvio lo segnalano. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni consentite al runtime sullo schema all'avvio. `ensure` (il valore predefinito ovunque, inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere elementi esistenti. `none` non modifica alcunché. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio con `push`**. In un [deployment separato](/docs/deployment/split-processes) un solo processo può occuparsi del provisioning; tutti gli altri ruoli devono impostare `none` o rifiuteranno l'avvio. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio quando il provisioning del database è stato eseguito per l'ultima volta a partire da un set di collezioni differente rispetto a quello con cui è stato compilato questo processo. Se non impostato (o impostato su un valore diverso da `true`/`1`), genera un avviso. | warn |
| `REALTIME_CDC` | Change data capture a livello di database: `auto` (abilita se la connessione lo supporta, altrimenti effettua silenziosamente il fallback), `trigger` (forza l'abilitazione, avverte se impossibile), `wal` (attualmente degrada a `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Meccanismo di trasporto tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato quando a `realtime.bus` è stato assegnato un transport già istanziato. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback con `NODE_ENV=production`. Disattivato, in modo che un avvio in produzione fallisca in modo evidente anziché connettersi a un database inesistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Comportamento all'avvio in presenza di una chiave nelle collezioni non letta da questa versione: `warn`, `error` (rifiuta l'avvio — utile da abilitare in CI) o `off`. Gestisce unicamente chiavi non *riconosciute*, che di solito rappresentano refusi e occasionalmente metadati intenzionali; una chiave riconosciuta come deprecata o spostata è sempre bloccante, poiché altrimenti la funzionalità configurata risulterebbe silenziosamente assente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio dello schema ed esce senza aprire un socket — la struttura ideale per un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server successivo. Un valore vuoto è considerato *non impostato*, in modo che una variabile `${SOMETHING}` non sostituita in un file compose non trasformi un deployment ordinario in uno che esegue la migrazione e rifiuta di servire traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina (un agente, un job di CI) di *applicare* una modifica dello schema tramite `/api/admin/schema`, anziché limitarsi a pianificarla. Disattivato salvo richiesta esplicita: la credenziale che applicherebbe tale modifica è quella che con maggiore probabilità si trova definita in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione consentito per una custom function prima che la richiesta venga interrotta. Corrisponde all'opzione `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promise rejection non gestita arresti il processo anziché limitarsi a registrarla nei log. Da abilitare sotto un orchestratore che gestisce il riavvio; disattivare se un riavvio comporta conseguenze peggiori di un potenziale leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene attivo lo scheduler cron su piattaforme che il runtime altrimenti rileverebbe come scale-to-zero, dove un timer attivato in un'istanza inattiva non verrebbe eseguito da alcuna istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy situati a monte di questo server, consentendo al rate limiter di estrarre l'indirizzo client reale da `X-Forwarded-For`. Valore predefinito di sicurezza `0`: senza proxy a monte, considerare affidabile l'header consentirebbe a qualsiasi chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non è uno strumento di migrazione]
Il passaggio all'avvio opera in modo automatico senza supervisione né revisione dei diff;
pertanto non eliminerà mai una colonna, non restringerà un tipo né riscriverà una tabella.
Questo è anche il motivo per cui l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`: un push
completo calcola un diff e può eseguire tranquillamente `DROP COLUMN`, mentre il riavvio
di un container non deve mai poter distruggere una colonna di produzione come effetto
collaterale di una rischedulazione.

Le modifiche distruttive o strutturali devono essere gestite in contesti in cui possono
essere esaminate: `rebase db generate` + `rebase db migrate`, oppure `rebase db push` da
checkout locale o CI, che simula la modifica (dry-run), rifiuta operazioni distruttive
senza conferma e può effettuare preventivamente un backup.
:::

### Deployment separati

Una stessa immagine e uno stesso bundle possono essere avviati più volte, ciascuno
a supporto di una parte differente del progetto. Qui è riportata una riga per ciascuna
variabile, per completezza della pagina; ciò che ogni combinazione *monta e gestisce*
— e quali combinazioni rifiutano l'avvio — è illustrato in
**[Processi separati](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Quale componente viene servita da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive se *questo* processo deve eseguire i timer cron. Se non impostato, segue il valore del ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive se questo processo deve eseguire i worker delle code di job. Se non impostato, segue il valore del ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Esegue unicamente le custom function indicate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Esegue tutte le custom function ad eccezione di quelle indicate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione verso cui il processo API inoltra una richiesta di function che non gestisce direttamente. | — |

### Superficie MCP

Un endpoint Model Context Protocol opzionale su `/mcp`, che consente a un client AI di leggere
e scrivere su questo progetto **con l'identità dell'utente autenticato**. Disattivato se non impostato,
e — a differenza di qualsiasi altra superficie — nessun `REBASE_ROLE` lo attiva: gli altri ruoli
descrivono la tipologia del processo, mentre questo rappresenta la scelta di fornire credenziali a
software di terze parti, decisione che dovrebbe essere presa manualmente da una persona anziché
ereditata dalla mansione assegnata al container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza la superficie non viene montata e la condizione viene segnalata nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine raggiungibile dall'esterno di questo deployment, es. `https://app.example.com`. La superficie MCP non può ricavarla autonomamente — estrarre l'origine dall'header `Host` farebbe sì che l'identità dell'emittente, e l'audience con cui i suoi stessi token vengono verificati, diventino valori forniti dal chiamante. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere che i client vengano registrati preventivamente. | `true` |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostato o `0`, mantiene tutti i backup. | — |
| `BACKUP_KEEP_MINIMUM` | Mantiene sempre almeno gli N backup più recenti, indipendentemente dalla retention impostata. | — |
| `PG_DUMP_PATH` | Sovrascrive il file binario `pg_dump` — deve corrispondere alla versione major del server. | — |
| `PG_RESTORE_PATH` | Sovrascrive il file binario `pg_restore`. | — |

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione privata con
crittografia a riposo (encryption-at-rest).
| `PG_DUMPALL_PATH` | Percorso in cui risiede `pg_dumpall`, se non presente in `PATH`. In sua assenza — e senza gli strumenti client PostgreSQL installati — un backup delle entità globali fallisce restituendo un errore che indica questa variabile. | — |

### Distribuzione del bundle

Un deployment gestito non include il proprio codice applicativo all'interno dell'immagine: il runtime
recupera un bundle all'avvio. Queste variabili stabiliscono quale recuperare e con quali modalità.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una directory con bundle già estratto. Il valore impostato localmente da `rebase start`. | — |
| `REBASE_BUNDLE_URL` | Posizione da cui scaricare l'archivio del bundle quando non ne è presente uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | La credenziale bearer per tale download. Da trattare come un segreto: autorizza il tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto il bundle scaricato. Deve essere scrivibile e persistere nell'intervallo tra il download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi che l'immagine di runtime fornisce al bundle, oltre a quelli dichiarati autonomamente. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `config/resources.ts` viene
collegato tramite variabili d'ambiente denominate in base ad esso. I nomi di base sono indicati
sotto; una risorsa non predefinita appende `__` e la propria chiave in maiuscolo: un bucket
chiamato `media` leggerà quindi `S3_BUCKET__MEDIA`. Il comando `rebase status`
stampa, per ciascuna risorsa, l'esatta variabile letta e se essa risulti impostata o meno.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver della sorgente dati, quando non si utilizza quello predefinito di Postgres. Riceve un suffisso per sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Riceve un suffisso per topic. | — |

### Ambiente specifico della CLI

Lette da `rebase`, non dal server. Nessuna di queste opzioni ha effetto su un deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Il backend con cui comunicano `rebase auth` e `rebase api-keys`, anziché ricavarlo dal progetto. | — |
| `REBASE_PORT` | La porta presunta da tali comandi nel ricavare tale URL. | — |
| `SERVICE_KEY` | La service key con cui eseguire l'autenticazione, senza richiedere input interattivo. | — |
| `REBASE_ENV_FILE_PATH` | Il file `.env` che la CLI legge e scrive, qualora non coincida con quello del progetto. | — |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` esegue l'accesso, senza richiedere input interattivo. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, consentendo a un gestore di segreti di trasmetterla senza che venga salvata nella cronologia della shell. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e i dettagli della richiesta anziché il messaggio sintetico. Il primo parametro da impostare se un comando `rebase cloud` fallisce senza fornire spiegazioni utili. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue il provisioning — è necessario fornirne uno autonomamente. Equivale a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server frontend, che altrimenti `rebase dev` ricava dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa di `rebase dev` affinché il backend segnali l'avvenuta inizializzazione prima di notificare che non è stato avviato. `0` disabilita la notifica. | `30000` |
| `DATABASE_PASSWORD` | La password che `rebase dev --docker` inserisce nella stringa di connessione derivata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione standard condivisa tra molteplici strumenti. Se impostata su un valore diverso da `0`, la CLI non invia alcuna telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Stessa funzionalità, specifica per Rebase. Non richiede alcun file, risultando l'opzione consigliata per l'uso in CI e all'interno delle immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destinazione verso cui viene inviata la telemetria, per un collettore self-hosted. | — |

## Segreti in fase di sviluppo

`JWT_SECRET` e `REBASE_SERVICE_KEY` sono obbligatori in produzione e generati
automaticamente in ambienti differenti, consentendo di iniziare a lavorare senza dover configurare nulla.

Tali valori generati vengono memorizzati nella cache in `.rebase-dev-secrets.json`, accanto a
`.rebase-dev-port` e `.rebase-dev-url` ed esclusi dal controllo versione tramite gitignore insieme a essi. In precedenza,
venivano rigenerati a ogni avvio — con la conseguenza che il riavvio del dev server disconnetteva
l'utente dalla propria applicazione e invalidava qualsiasi chiave API appena creata.

- Impostando esplicitamente una delle due variabili, verrà utilizzato il valore fornito; nulla verrà letto o memorizzato nella cache.
- È possibile indirizzare la cache altrove con `REBASE_DEV_SECRETS_FILE` — un percorso, nonché
  l'unica variabile di questa sezione che ha senso impostare intenzionalmente.
- Eliminando il file si ottiene la rotazione di entrambi i segreti. L'avvio successivo ne genererà uno nuovo.
- Se il file non può essere scritto (ad esempio all'interno di un container in sola lettura), il server si avvia
  ugualmente con un segreto temporaneo, esattamente come accadeva in precedenza.

Nulla viene memorizzato nella cache in produzione o sotto un test runner. In produzione, un avvio
che necessiti della generazione di uno dei due segreti continua a fallire indicando la variabile mancante, comportamento
che resta invariato:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Oggetto di configurazione Backend

L'oggetto `RebaseBackendConfig` passato a `initializeRebaseBackend()` consente il controllo programmatico:

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

`basePath` sposta ogni route API, pertanto è necessario configurare la medesima impostazione nel client —
altrimenti questo continuerà a chiamare `/api/...` ricevendo errori 404 per ogni richiesta:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione rileva questa configurazione dal client fornito; non è necessaria
alcun'altra configurazione. Se si costruisce manualmente l'URL di una richiesta, è consigliabile concatenarlo a partire dal client
anziché digitare `/api`:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'Editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, sebbene la vista foglio di calcolo del CMS carichi i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL scambiando temporaneamente i ruoli del database per farli corrispondere al ruolo applicativo dell'utente attivo (es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli sono presenti solo nelle tabelle del database e non corrispondono a ruoli effettivi di PostgreSQL, il cambio di ruolo fallisce o i privilegi sul database risultano mancanti. La vista foglio di calcolo del CMS viene invece eseguita con l'utente proprietario della connessione predefinita, bypassando questo meccanismo.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo forza Rebase ad eseguire le query dell'Editor SQL utilizzando i privilegi del proprietario della connessione (solitamente un superuser/owner).

### Errore nel recupero dello schema nell'Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare la struttura ad albero dello schema, oppure l'Editor SQL restituisce l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necessita di privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi di amministrazione. Se `adminConnectionString` non viene fornito al bootstrapper, o se `getAdmin()` viene sovrascritto in modo da restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Verificare che `adminConnectionString` sia configurato durante l'inizializzazione del bootstrapper di backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Prossimi passi

- **[Deployment](/docs/getting-started/deployment)** — Guida al deployment in produzione
- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend

---
