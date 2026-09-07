---
sourceHash: f6312cfcb6187cea
title: Ambiente e Configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene gestita tramite variabili d'ambiente nel tuo file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio.
> Se manca qualcosa di obbligatorio o è malformato (un URL che non è un URL, una
> porta che non è un numero), il server rifiuta di avviarsi e nomina la variabile.
>
> Dove si trova lo schema dipende da come esegui il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — usa lo schema
> del runtime stesso (`loadBootEnv` in `@rebasepro/server`), che è l'unione di
> tutte le tabelle qui sotto. Un progetto che ha eseguito
> [`rebase eject`](/docs/cli) possiede un proprio `backend/src/env.ts` con
> `loadEnv({ extend })`, e può aggiungervi le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue una PostgreSQL gestita per il progetto, con i suoi dati sotto `.rebase/`. Obbligatoria ovunque altrove. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale forte (min 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una grafia di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano — cifra, ma non controllare il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas no, e non degradano:
> rifiutano di avviarsi con `invalid sslmode value: "no-verify"`.
>
> I comandi propri di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima di invocarli,
> quindi funzionano con l'URL così com'è configurato. Lanciare `psql` a mano no —
> lì sostituisci con `sslmode=require`, che cifra senza verificare esattamente
> allo stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API backend per l'SDK client. **Impostalo solo in sviluppo** — vedi sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Abilita "Accedi con Google". | — |


> **Lascia `VITE_API_URL` non impostata nelle build di produzione.**
>
> In sviluppo frontend e backend sono origini distinte, quindi il dev server la
> inietta. In produzione il backend Rebase serve la SPA, quindi l'API è l'origine
> stessa della pagina e il client la risolve così da sé.
>
> Cuocere un URL assoluto in un bundle di produzione funziona fino al momento in
> cui un secondo hostname punta alla stessa app: un dominio personalizzato carica
> allora la pagina da `example.com` e chiama l'API su `example.rebase.website`,
> che è cross-origin, quindi ogni richiesta fallisce al preflight. Consentire
> l'origine in CORS **non** lo risolve: il cookie di refresh è `SameSite=Lax` e
> non viene inviato tra siti diversi, quindi avresti pulito gli errori in console
> e avresti comunque l'autenticazione rotta. Non impostata, ogni dominio che
> punta all'app funziona senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP del backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — una `PORT` in `.env` lì non viene letta, perché la porta è risolta prima che quel file venga caricato — e altrimenti usa una porta derivata dal percorso del progetto, così più progetti possono girare insieme. `rebase dev --port` prevale su entrambe, e il banner di avvio indica quale livello ha usato. | `3001` |
| `LOG_LEVEL` | Verbosità del logging: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'SQL dietro una riga `Failed query: [redacted]`. Ogni istruzione fallita è oscurata per impostazione predefinita, perché una query fallita si porta dietro i parametri associati — un'email, un hash di password. Impostalo a `true` mentre diagnostichi un errore di DDL, RLS o change capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatoria in produzione** se diversa dal dominio del backend. In sviluppo viene *aggiunta a* localhost — vedi sotto. | — |
| `FRONTEND_URL` | URL dell'app frontend. Usata come alternativa a `CORS_ORIGINS`, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database a livello amministrativo (per l'introspezione dello schema e le operazioni amministrative). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disattiva il cambio di ruolo PostgreSQL nell'Editor SQL (utile con autenticazione personalizzata dove i ruoli del DB non sono mappati). | `false` |

#### CORS in sviluppo

Lo sviluppo consente **localhost, più ciò che nominano `CORS_ORIGINS` (o
`FRONTEND_URL`)** — lo stesso elenco che usa la produzione, con localhost
aggiunto anziché sostituito. La variabile funziona quindi allo stesso modo in
entrambi gli ambienti, e i casi che la richiedono in sviluppo sono quelli
ordinari:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non è né localhost né elencata viene rifiutata, e il rifiuto è
registrato **una volta per origine**, con la riga esatta che la consentirebbe.
Rifiutare non è prudenza fine a sé stessa: l'API invia credenziali, quindi
riflettere un `Origin` arbitrario lascerebbe che qualunque sito la sviluppatrice
capiti di visitare faccia richieste autenticate contro il dev server con la sua
sessione e ne legga le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Segreto per la firma JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare gli access token in modo asimmetrico (RS256), così che qualunque cosa possieda il JWKS possa verificare una sessione senza poterne emettere una. Accetta un PEM con veri a capo, un PEM con escape `\n`, oppure il base64 dell'intero PEM. Senza di essa i token restano HS256. | — |
| `JWT_KEY_ID` | Nomina `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Cambialo ogni volta che cambia la chiave — la rotazione dipende dal fatto che vecchia e nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. Scorrevole: ogni rotazione la rinnova, quindi governa quanto a lungo una sessione sopravvive all'**inattività**. | `400d` |
| `ALLOW_REGISTRATION` | Consente ai nuovi utenti di registrarsi (`true`/`false`). Fuori dalla produzione il **primo** utente può sempre registrarsi, qualunque cosa dica questa opzione — una tabella utenti vuota deve pur ammettere qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) quella finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un account ordinario, e l'amministratore viene indicato con `REBASE_ADMIN_EMAIL` più sotto oppure assegnato con la chiave di servizio. Il `.env.example` dello scaffold la imposta a `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` <span class="since-badge" data-since="0.18">Since 0.18</span> | Interruttore di emergenza. Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta fuori dalla produzione, così la registrazione è chiusa anche contro un database vuoto. Abbinala a `REBASE_ADMIN_EMAIL` più sotto, altrimenti il deployment non ha modo di produrre il suo primo chiamante autenticato. Ogni artefatto di deployment distribuito la imposta. | — |
| `REBASE_ADMIN_EMAIL` <span class="since-badge" data-since="0.18">Since 0.18</span> | Email del primo account amministratore, creato all'avvio **finché la tabella utenti è ancora vuota** e mai in seguito. È così che un deployment di produzione ottiene il suo amministratore: l'operatore indica il primo account invece di gareggiare con internet per averlo. L'avvio avvisa quando in produzione la tabella è vuota e questa non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` <span class="since-badge" data-since="0.18">Since 0.18</span> | Password di quell'account. Almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Cambiala dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Cifra ogni segreto TOTP memorizzato. Se non impostata, i segreti vengono cifrati con `JWT_SECRET` e l'avvio avvisa una volta — ruotare `JWT_SECRET` disconnette quindi tutti *e* rende indecifrabile ogni autenticatore registrato. Imposta una chiave dedicata (32+ caratteri casuali) prima che qualcuno si registri. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave *da cui* si sta ruotando. Imposta entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti restano leggibili, così nessuno resta chiuso fuori dal proprio account a metà rotazione. Rimuovila quando ogni segreto è stato ricifrato. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). È opt-in, e deliberatamente non subordinato a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Imposta `false` per una superficie di lettura completamente pubblica — la RLS continua ad applicarsi. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato quando non ne viene indicato uno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimo (`uid`, `displayName`, `photoURL`) per i flussi di invito via email. Solo per chiamanti autenticati, e non restituisce mai email, ruoli o metadati dell'utente trovato. Disattivato per impostazione predefinita: è una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è solo per un frontend davvero cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sul cookie di refresh. Attivo per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per http in chiaro — un deployment su un indirizzo di rete locale, dove altrimenti il browser scarta il cookie e la sessione muore alla scadenza dell'access token, senza alcun errore. L'avvio avvisa. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | ID client Google OAuth (validazione backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret Google OAuth | — |
| `GITHUB_CLIENT_ID` | ID client GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client secret GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | ID client Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | ID client LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | ID client Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | ID client X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client secret X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | ID client Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client secret Discord OAuth | — |
| `GITLAB_CLIENT_ID` | ID client GitLab OAuth. La `baseUrl` di un'istanza self-hosted non ha una grafia come variabile d'ambiente — per quella configura GitLab nel blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID di Apple. Apple non ha un client secret statico — Rebase firma un JWT ES256 di breve durata a ogni scambio di token — quindi servono tutti e quattro i valori `APPLE_*`, e senza di essi non configura nulla. | — |
| `APPLE_TEAM_ID` | Team ID di Apple Developer, l'emittente del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata presso Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file di chiave privata `.p8`, a capo compresi (gli escape `\n` sono accettati). | — |
| `REBASE_SERVICE_KEY` | Chiave API amministrativa statica. Aggira la normale autenticazione JWT per le chiamate server-to-server quando viene passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo.) | — |
| `REBASE_RATE_LIMIT_STORE` | Dove vivono i contatori del rate limit di auth: `memory` (per processo) o `sql` (condivisi tra repliche). Un processo non può vedere il proprio numero di repliche, quindi un deployment con pari deve dirlo — tre repliche sul valore predefinito applicano il triplo del limite. Qualsiasi altro valore **rifiuta l'avvio** invece di ripiegare, `postgres` incluso. | `memory` |
| `AUTH_MAGIC_LINK` | Monta il flusso di accesso senza password tramite link. Richiede un servizio email configurato, altrimenti il link non ha dove andare. | `false` |
| `AUTH_EMAIL_OTP` | Monta l'accesso senza password con un codice a sei cifre inviato via email. Stesso requisito email di cui sopra. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle rotte di auth: `turnstile` o `hcaptcha`. Non impostata significa nessun captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, usato lato server per verificare il token inviato dal browser. Obbligatorio una volta impostato `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Rotte di auth da proteggere, separate da virgole (ad esempio `register,login`). Non impostata protegge l'insieme predefinito del provider. | — |

### Archiviazione

:::caution[L'archiviazione non ha sicurezza a livello di riga, quindi le serve un modello di accesso]
Le collezioni sono protette dalla RLS di Postgres. L'archiviazione di oggetti non
ha un equivalente — le chiavi condividono un unico namespace piatto — quindi con
un bucket configurato e nessun modello di accesso il server **rifiuta di avviarsi
in produzione**. Soddisfalo con esattamente uno tra: un hook `storageAuthorize`
esportato da `config/index.ts` (quello che include lo scaffold),
`STORAGE_PUBLIC_READ` oppure `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disattiva l'archiviazione a meno che `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso base per l'archiviazione locale | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Consente l'archiviazione locale in produzione — solo con un volume duraturo montato su `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza URL in stile path per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Di solito dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso di un file di chiave del service account. Ometti su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Serve ogni oggetto a chiunque, senza token. Solo per un bucket che è davvero una CDN pubblica. Uno dei tre modi per soddisfare il controllo di avvio qui sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Lascia che qualsiasi chiamante autenticato legga, scriva, elenchi ed elimini ogni oggetto. Nell'oggetto di configurazione si chiama `INSECURE` per un motivo: è difendibile solo in un'app single-tenant dove ogni account è degno di fiducia per ogni file. | `false` |
| `STORAGE_RENDITION_CACHE` | Mette in cache le rese di immagine generate (ridimensionamenti, conversioni di formato) invece di produrle a ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita la connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato sull'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto usato negli oggetti e nei corpi delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato in cima ai modelli di email predefiniti. PNG o JPG `http(s)` assoluto — i client rimuovono l'SVG e bloccano gli URI `data:`. Non impostata, un'app che si chiama ancora `Rebase` riceve il marchio Rebase e una rinominata nessuno |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi per cui una connessione inattiva viene mantenuta | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non poolata). [Realtime](/docs/backend/realtime) ne ha bisogno: `LISTEN`/`NOTIFY` non sopravvive a un pooler di transazioni come PgBouncer, e senza di essa le notifiche di modifica vengono disattivate con un avviso invece di perdersi in silenzio. | — |
| `DATABASE_READ_URL` | Replica di lettura. Le letture vanno lì quando è impostata e differisce da `DATABASE_URL`; se la connessione fallisce, tutto ripiega sul primario con un avviso. | — |
| `REBASE_DB_POOL_MAX` | Un tetto su ogni pool del processo, applicato qualunque cosa abbia chiesto ciascuno. Solo cifre: un valore malformato viene ignorato invece di serializzare in silenzio il server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine server pubblicata.
Un progetto che ha fatto eject possiede queste decisioni nel proprio codice.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Esegue all'avvio l'audit di sicurezza a livello di riga e monta il suo endpoint, che segnala le tabelle servite senza policy. | — |
| `REBASE_BASE_PATH` | Percorso base di ogni rotta dell'API. Al client va detta la stessa cosa — vedi [Cambiare `basePath`](#cambiare-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/di amministrazione del bundle da questo processo. Disattivalo quando davanti c'è una CDN. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Risposte gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Corpo massimo della richiesta, **in byte** (`10485760`, non `10MB` — un valore che non è un numero rifiuta l'avvio invece di rimuovere il limite in silenzio). | — |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati: non impostata significa attiva in sviluppo, spenta in produzione; `false` le spegne entrambe ovunque. Nota che `true` in produzione serve la **specifica** su `/api/docs` ma non la **UI** di Swagger su `/api/swagger` — la UI dipende separatamente da `NODE_ENV`. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token bearer che protegge `/metrics`. Non impostato lascia l'endpoint aperto a qualsiasi cosa raggiunga la porta — accettabile su una rete privata, non su una pubblica, e i log di avvio lo dicono. | — |
| `REBASE_MIGRATE_ON_BOOT` | Cosa può fare il runtime allo schema all'avvio. `ensure` (il predefinito, ovunque — produzione inclusa) esegue la passata **additiva**: creare tabelle, colonne e tipi enum mancanti, mai eliminarne o riscriverne uno. `none` non tocca nulla. L'immagine pubblicata accetta solo questi due e **rifiuta l'avvio su `push`**. In un [deployment suddiviso](/docs/deployment/split-processes) esattamente un processo può approvvigionare, quindi ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio quando il database è stato approvvigionato l'ultima volta a partire da un insieme di collezioni diverso da quello con cui questo processo è stato costruito. Non impostata (o con qualsiasi valore diverso da `true`/`1`) avvisa invece. | avvisa |
| `REALTIME_CDC` | Cattura delle modifiche a livello di database: `auto` (attivarla dove la connessione la supporta, ripiegare in silenzio altrimenti), `trigger` (forzarla, avvisare se impossibile), `wal` (oggi degrada a `trigger`), `off`. Vedi [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Trasporto tra istanze per i canali broadcast e la presence: `memory` o `postgres`. Ignorato quando a `realtime.bus` è stato passato un trasporto già costruito. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback sotto `NODE_ENV=production`. Disattivato, così un avvio di produzione fallisce rumorosamente invece di collegarsi a un database che non c'è. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Cosa fa l'avvio con una chiave delle tue collezioni che questa versione non legge: `warn`, `error` (rifiutare l'avvio — vale la pena attivarlo in CI) oppure `off`. Governa solo le chiavi che non *riconosce*, che di solito sono un refuso e occasionalmente metadati deliberati; una chiave che sa essere stata spostata è sempre fatale, perché altrimenti la funzionalità che configurava manca in silenzio. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue la passata di schema ed esce senza aprire un socket — la forma che vuole un Job di migrazione, dalla stessa immagine e dallo stesso bundle del server che segue. Un valore vuoto conta come *non impostato*, così un `${SOMETHING}` non sostituito in un file compose non può trasformare un deployment ordinario in uno che migra e rifiuta di servire. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` lascia che una macchina — un agente, un job di CI — *applichi* una modifica di schema attraverso `/api/admin/schema`, non solo la pianifichi. Disattivato se non richiesto: la credenziale che farebbe una modifica del genere è quella che più probabilmente sta in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Per quanto tempo una funzione personalizzata può girare prima che la sua richiesta venga interrotta. La stessa manopola dell'opzione `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che un rifiuto di promise non gestito termini il processo invece di essere registrato. Attivo sotto un orchestratore che ti riavvierà; spento dove un riavvio è peggio di una perdita. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene attivo lo scheduler cron su una piattaforma che il runtime altrimenti rileverebbe come scale-to-zero, dove un timer che scatta in un'istanza inattiva non scatta in nessuna istanza. | — |
| `TRUSTED_PROXY_HOPS` | Quanti proxy stanno davanti a questo server, così che il rate limiter possa leggere il vero indirizzo del client da `X-Forwarded-For`. Predefinito prudente `0`: senza proxy, fidarsi dell'header lascerebbe che qualsiasi chiamante falsifichi un'identità. | `0` |

:::note[L'approvvigionamento all'avvio è additivo, e non è uno strumento di migrazione]
La passata di avvio gira non presidiata, senza che nessuno legga un diff: non
eliminerà quindi mai una colonna, non restringerà un tipo e non riscriverà una
tabella. È anche il motivo per cui l'immagine rifiuta
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff ed eseguirà
volentieri un `DROP COLUMN`, e il riavvio di un container non deve mai poter
distruggere una colonna di produzione come effetto collaterale di una
rischedulazione.

Le modifiche distruttive o che rimodellano restano dove possono essere riviste:
`rebase db generate` + `rebase db migrate`, oppure `rebase db push` da un
checkout o dalla CI, che prova la modifica a vuoto, rifiuta quelle distruttive
senza conferma e può fare prima un backup.
:::

### Deployment suddivisi

Una sola immagine e un solo bundle possono essere avviati più volte, ciascuna
volta servendo una parte diversa del progetto. Qui una riga per ciascuna, perché
questa pagina sostiene di elencare ogni variabile; cosa *monta e possiede* ogni
combinazione — e quali combinazioni rifiutano l'avvio — sta su
**[Processi suddivisi](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Quale parte serve questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Forza se *questo* processo esegue i timer cron. Non impostata segue il ruolo. | — |
| `REBASE_JOB_WORKERS` | Forza se questo processo esegue i worker della coda di lavori. Non impostata segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve in questo processo solo le funzioni personalizzate nominate. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve ogni funzione personalizzata tranne quelle nominate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Dove il processo API inoltra una richiesta di funzione che non serve lui stesso. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Non impostata significa che i backup pianificati sono spenti. | — |
| `BACKUP_DESTINATION` | Percorso locale, oppure un URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Non impostata o `0` conserva tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno N dei backup più recenti, qualunque cosa dica la retention. | — |
| `PG_DUMP_PATH` | Sostituisce il binario `pg_dump` — deve corrispondere alla versione maggiore del server. | — |
| `PG_RESTORE_PATH` | Sostituisce il binario `pg_restore`. | — |

I backup contengono segreti e dati personali. Usa una destinazione privata con
cifratura a riposo.
| `PG_DUMPALL_PATH` | Dove si trova `pg_dumpall`, quando non è nel `PATH`. Senza di esso — e senza gli strumenti client PostgreSQL installati — un backup dei globals fallisce con un errore che nomina questa variabile. | — |

### Consegna del bundle

Un deployment gestito non porta il proprio codice nell'immagine: il runtime
scarica un bundle all'avvio. Queste variabili decidono quale e come.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso a una directory di bundle già estratta. Quello che `rebase start` imposta in locale. | — |
| `REBASE_BUNDLE_URL` | Da dove scaricare l'archivio del bundle, quando non ce n'è uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | La credenziale bearer per quello scaricamento. Trattala come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Dove viene estratto un bundle scaricato. Deve essere scrivibile e sopravvivere tra lo scaricamento e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi che l'immagine del runtime fornisce al bundle, oltre a quelli che dichiara da sé. | — |

### Legami delle risorse

Ogni database, bucket e topic che un progetto dichiara in `config/resources.ts` è
legato da variabili d'ambiente che portano il suo nome. I nomi base sono qui
sotto; una risorsa non predefinita aggiunge `__` e la sua chiave in maiuscolo,
così un bucket chiamato `media` legge `S3_BUCKET__MEDIA`. `rebase status`
<span class="since-badge" data-since="0.18">Since 0.18</span> stampa, per ogni
risorsa, la variabile esatta che sta leggendo e se è impostata.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di un'origine dati, quando non è quello Postgres predefinito. Con suffisso per origine: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Con suffisso per topic. | — |

### L'ambiente della CLI stessa

Letto da `rebase`, non dal server. Nulla di qui influenza un deployment.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Il backend con cui parlano `rebase auth` e `rebase api-keys`, invece di dedurlo dal progetto. | — |
| `REBASE_PORT` | La porta che quei comandi assumono nel dedurre quell'URL. | — |
| `SERVICE_KEY` | La chiave di servizio con cui si autenticano, invece di chiedere. | — |
| `REBASE_ENV_FILE_PATH` | Quale `.env` legge e scrive la CLI, quando non è quello del progetto. | — |
| `REBASE_CLOUD_URL` | Il control plane con cui parla `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` accede, invece di chiedere. | — |
| `REBASE_CLOUD_PASSWORD` | La sua password, così che un archivio di segreti possa fornirla senza che finisca nella cronologia della shell. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e il dettaglio della richiesta invece del messaggio breve. La prima cosa da impostare quando un comando `rebase cloud` fallisce in modo poco utile. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non approvvigiona nulla — lo porti tu. Come `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server del frontend, che `rebase dev` altrimenti deduce dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Per quanto `rebase dev` aspetta che il backend si annunci prima di dire che non è partito. `0` disattiva il report. | `30000` |
| `DATABASE_PASSWORD` | La password che `rebase dev --docker` inserisce nella stringa di connessione che deduce da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convenzione condivisa tra strumenti. Impostata a qualsiasi cosa diversa da `0`, la CLI non invia telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo stesso, specifico per Rebase. Non richiede alcun file, ed è per questo che è quella da usare in CI e in un'immagine. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Dove viene inviata la telemetria, per un collector self-hosted. | — |

## Segreti in sviluppo

`JWT_SECRET` e `REBASE_SERVICE_KEY` sono obbligatori in produzione e generati per
te al di fuori, così puoi iniziare senza configurare nulla.

Quei valori generati vengono messi in cache in `.rebase-dev-secrets.json`,
accanto a `.rebase-dev-port` e `.rebase-dev-url` e gitignorati insieme a loro.
Prima venivano rigenerati a ogni avvio — riavviare il dev server ti disconnetteva
quindi dalla tua stessa app e invalidava qualsiasi chiave API appena creata.

- Imposta esplicitamente una delle due variabili e viene usata la tua; non viene
  messo in cache né letto nulla.
- Sposta la cache altrove con `REBASE_DEV_SECRETS_FILE` — un percorso, e l'unica
  variabile di questa sezione che imposteresti deliberatamente.
- Elimina il file per ruotare entrambi i segreti. L'avvio successivo ne scrive
  uno nuovo.
- Se il file non può essere scritto — un container in sola lettura, per esempio —
  il server parte comunque con un segreto effimero, esattamente come prima.

Non viene messo in cache nulla in produzione, né sotto un test runner. In
produzione un avvio che ha dovuto generare uno dei due segreti continua a
fallire, nominando la variabile, e questo non è cambiato:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Oggetto di Configurazione del Backend

Il `RebaseBackendConfig` passato a `initializeRebaseBackend()` fornisce controllo programmatico:

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

### Cambiare `basePath`

`basePath` sposta ogni rotta dell'API, quindi al client va detta la stessa cosa —
altrimenti continua a chiedere `/api/...` e riceve un 404 per tutto:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione lo prende dal client che riceve; non c'è altro da
configurare. Se costruisci a mano un URL di richiesta, componilo a partire dal
client invece di scrivere `/api` da te:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'Editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, anche se la vista a foglio di calcolo del CMS carica i dati senza problemi.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL cambiando temporaneamente ruolo di database per farlo coincidere con il ruolo applicativo dell'utente attivo (ad esempio `SET LOCAL ROLE "admin"`). Se usi un'autenticazione personalizzata in cui i ruoli esistono solo in tabelle del database e non come veri ruoli PostgreSQL, il cambio di ruolo fallisce o mancano i privilegi. La vista a foglio di calcolo del CMS gira con l'utente proprietario della connessione e aggira tutto questo.
* **Soluzione:** Aggiungi `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del tuo backend. Questo costringe Rebase a eseguire le query dell'Editor SQL con i privilegi del proprietario della connessione (di solito un superuser/owner).

### Recupero dello schema fallito nell'Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non carica l'albero dello schema, oppure l'Editor SQL solleva `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase ha bisogno di privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornito al bootstrapper, o `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Assicurati che `adminConnectionString` sia configurato durante l'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Prossimi Passi

- **[Deployment](/docs/getting-started/deployment)** — Guida al deployment in produzione
- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend

---
