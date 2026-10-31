---
sourceHash: ec6f07e74d4a291d
title: Ambiente e Configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca qualcosa di obbligatorio o è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come si esegue il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che è l'unione
> di ogni tabella sottostante. Un progetto in cui è stato eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })`, e può aggiungervi le
> proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue un PostgreSQL gestito per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria in qualsiasi altro contesto. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per firmare i token JWT. Usa una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (autogenerata in sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi propria di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano — cifrano, ma non controllano il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la supportano e non
> scalano verso il basso: rifiutano l'avvio con `invalid sslmode value: "no-verify"`.
>
> I comandi interni di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima di chiamare la
> shell, quindi funzionano con l'URL configurato. L'invocazione manuale di `psql` non lo
> fa — in quel caso sostituiscila con `sslmode=require`, che cifra senza verificare esattamente
> nello stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Imposta questa variabile solo in sviluppo** — vedi sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth di Google. Abilita "Accedi con Google". | — |


> **Lascia `VITE_API_URL` non impostata nelle build di produzione.**
>
> In sviluppo, frontend e backend hanno origini separate, quindi il server di
> sviluppo inietta questa variabile. In produzione, il backend di Rebase serve la SPA,
> per cui l'API coincide con l'origine stessa della pagina e il client la risolve
> autonomamente in questo modo.
>
> Incorporare un URL assoluto in un bundle di produzione funziona fino a quando un
> secondo hostname non punta alla stessa app: un dominio personalizzato caricherebbe
> quindi la pagina da `example.com` e chiamerebbe l'API su `example.rebase.website`,
> che è cross-origin, facendo fallire il preflight di ogni richiesta. Autorizzare
> l'origine in CORS **non** risolve comunque il problema: il cookie di refresh è `SameSite=Lax`
> e non viene inviato cross-site, per cui si eliminerebbero gli errori in console ma
> l'autenticazione resterebbe compromessa. Se lasciata vuota, qualsiasi dominio che punta
> all'app funziona senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un `PORT` in `.env` non viene letto lì, perché la porta viene risolta prima che tale file venga caricato — e in alternativa esegue il bind su una porta derivata dal percorso del progetto, consentendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la priorità su entrambi, e il banner di avvio indica il criterio utilizzato. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio del logging: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'SQL associato a una riga `Failed query: [redacted]`. Ogni istruzione fallita viene oscurata per impostazione predefinita, poiché una query fallita trasporta i propri parametri associati — un'email, un hash di password. Impostala su `true` durante la diagnosi di un errore di DDL, RLS o change-capture. Ignorata quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatoria in produzione** a meno che `FRONTEND_URL` non sia impostata: un avvio in produzione privo di entrambe rifiuta di partire. In sviluppo viene *aggiunta a* localhost — vedi sotto. | — |
| `FRONTEND_URL` | URL dell'app frontend. Utilizzata in alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e le operazioni amministrative). Il database specificato non è quello che la console SQL considera corrente, né quello che un nuovo branch copia per impostazione predefinita: entrambi corrispondono al database su cui risiede la connessione dell'app stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'Editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del DB non sono mappati). La console SQL di Studio indicherà quindi che le righe sono state lette come proprietario della connessione, ne indicherà il nome e disabiliterà il selettore del ruolo. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui questo server è in esecuzione. `rebase dev` la imposta su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server con questa variabile mantiene il registro dei branch su quel database e copia i nuovi branch da esso per impostazione predefinita, in modo che il pannello Branches di Studio mostri i branch del database principale. | — |

#### CORS in sviluppo

Lo sviluppo consente **localhost, oltre a qualsiasi origine specificata da `CORS_ORIGINS` (o `FRONTEND_URL`)** —
lo stesso elenco utilizzato in produzione, con localhost aggiunto anziché
sostituito. Di conseguenza, la variabile funziona nello stesso modo in entrambi
gli ambienti, e i casi che ne necessitano in sviluppo sono quelli tipici:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non è né localhost né elencata viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con l'esatta riga che la autorizzerebbe.
Il rifiuto non è pura prudenza fine a se stessa: l'API invia credenziali, per cui
riflettere un `Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo
sviluppatore di effettuare richieste autenticate verso il dev server sfruttando la
sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Segreto per la firma dei token JWT (obbligatorio in produzione, autogenerato in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare i token di accesso in modo asimmetrico (RS256), così che chiunque possieda il JWKS possa verificare una sessione senza poterla generare. Accetta un PEM con newline reali, un PEM con sequenze di escape `\n`, o l'intero PEM in base64. Senza di essa, i token rimangono in formato HS256. | — |
| `JWT_KEY_ID` | Specifica l'identificativo di `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificalo ogni volta che la chiave cambia — la rotazione dipende dalla capacità di distinguere la chiave vecchia da quella nuova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del refresh token. A finestra scorrevole — ogni rotazione la rinnova, quindi governa la durata della sessione in caso di **inattività**. Imposta `400d` per sessioni che devono sopravvivere a una lunga assenza; i browser pongono qui il limite massimo per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consenti la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione, il **primo** utente può sempre registrarsi, indipendentemente da questo valore — una tabella utenti vuota deve pur consentire l'accesso a qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) questa finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un account ordinario, e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` sotto o assegnato con la service key. Il file `.env.example` dello scaffold la imposta a `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di emergenza (kill switch). Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, bloccando la registrazione anche a fronte di un database vuoto. Associala a `REBASE_ADMIN_EMAIL` sotto, altrimenti la distribuzione non avrà alcun modo per generare il suo primo utente autenticato. Ogni artefatto di deployment distribuito la imposta. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **mentre la tabella utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il suo amministratore: l'operatore definisce il primo account invece di correre contro chiunque su internet per crearlo. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Deve contenere almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificala dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Cifra ogni segreto TOTP archiviato. Se non impostata, i segreti vengono invece cifrati con `JWT_SECRET` e all'avvio viene emesso un avviso una sola volta — di conseguenza, la rotazione di `JWT_SECRET` disconnette tutti *e* rende indecifrabili tutti gli autenticatori registrati. Imposta una chiave dedicata (almeno 32 caratteri casuali) prima che qualcuno si registri all'MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la rotazione. Impostale entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti restano leggibili, evitando che qualcuno rimanga bloccato fuori dal proprio account durante la transizione. Rimuovila una volta che tutti i segreti sono stati ricifrati. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). È opt-in e deliberatamente non condizionato da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiedi l'autenticazione per l'API dati. Imposta a `false` per una superficie di lettura interamente pubblica — la RLS continua comunque ad essere applicata. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato quando non ne viene fornito alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato ai soli chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato solo a un frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Attivo per impostazione predefinita; usa `AUTH_COOKIE_SECURE=false` per connessioni in semplice HTTP — ad esempio un deployment su un indirizzo LAN dove altrimenti il browser scarterebbe il cookie e la sessione terminerebbe alla scadenza dell'access token senza errori. Emette un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID OAuth di GitLab. Il `baseUrl` di un'istanza self-hosted non ha una corrispondente variabile d'ambiente — a tale scopo, configura GitLab nel blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | Client ID OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | Client ID OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | Client ID OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | ID servizi Apple. Apple non ha un client secret statico — Rebase firma un JWT ES256 a breve durata per ogni scambio di token — richiede pertanto tutti e quattro i valori `APPLE_*`, e senza di essi non effettua alcuna configurazione. | — |
| `APPLE_TEAM_ID` | ID del Team Apple Developer, l'emittente (issuer) del JWT. | — |
| `APPLE_KEY_ID` | ID della chiave privata registrata presso Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, a capo compresi (sono accettate le sequenze di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | API key amministrativa statica. Bypassa la normale autenticazione JWT per chiamate server-to-server quando passata come `Authorization: Bearer <key>`. (Autogenerata in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La chiave pubblica della piattaforma di hosting (PEM, EC P-256) rispetto alla quale vengono verificati i token di piattaforma `rpt_`; supporta blocchi PEM multipli durante una rotazione delle chiavi. La piattaforma la imposta al deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE`, consente al gate di amministrazione di accettare un token di piattaforma per `cron:read`, e per nient'altro. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID di progetto a cui deve corrispondere l'`aud` del token di piattaforma, in modo tale che un token generato per un altro progetto venga rifiutato. Con una sola delle due variabili impostata, il server si avvia, registra un avviso nei log e risponde a ogni token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione in cui risiedono i contatori del rate-limiting di autenticazione: `memory` (per-processo) o `sql` (condivisa tra le repliche). Un processo non è in grado di rilevare autonomamente il numero delle proprie repliche, pertanto una distribuzione con più nodi deve specificarlo esplicitamente — tre repliche con l'impostazione predefinita applicherebbero il triplo del limite. Qualsiasi altro valore **rifiuta l'avvio** anziché effettuare un fallback, compreso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso tramite link senza password (magic link). Richiede un servizio email configurato, altrimenti il link non ha una destinazione verso cui essere inviato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password con un codice a sei cifre inviato via email. Stesso requisito per il servizio email sopra indicato. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic-link o codice email per un indirizzo sconosciuto crea l'account, purché le registrazioni siano aperte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un refresh token dopo la sua finestra di tolleranza: `reject` (rifiuta la richiesta, preserva la sessione) o `revoke-session` (termina la sessione di accesso). Qualsiasi altro valore impedisce l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma preventiva: nessun accesso con password consentito prima che l'indirizzo sia stato verificato. Richiede il servizio email; in assenza di esso l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Se non impostata, nessun captcha viene applicato. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio quando `CAPTCHA_PROVIDER` è impostata. | — |
| `CAPTCHA_ROUTES` | Route di autenticazione da proteggere, separate da virgola (ad esempio `register,login`). Se non impostata, protegge il set predefinito del provider. | — |

### Archiviazione

:::caution[Lo storage non dispone di sicurezza a livello di riga, pertanto necessita di un modello di accesso]
Le collection sono protette dalla RLS di Postgres. L'object storage non ha un
equivalente — le chiavi condividono un unico namespace piatto — per cui, con un
bucket configurato e nessun modello di accesso, il server **rifiuta l'avvio in produzione**.
È possibile soddisfare questo requisito con esattamente uno dei seguenti metodi:
un hook `storageAuthorize` esportato da `config/index.ts` (fornito di default con lo scaffold),
`STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso base per lo storage locale. Un percorso relativo viene interpretato a partire dalla directory in cui viene eseguito il server: la radice del progetto sotto `rebase dev`, `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — solo in presenza di un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali con nome affiancate | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Al massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente con nome. Un valore non numerico intero di byte impedisce l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave di accesso segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza gli URL in formato path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Di norma dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file delle chiavi del service account. Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce qualsiasi oggetto a chiunque, senza token. Da usare esclusivamente per un bucket che funge effettivamente da CDN pubblica. Uno dei tre modi per soddisfare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualunque chiamante autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Denominata `INSECURE` nell'oggetto di configurazione per un motivo: è giustificabile solo in un'app single-tenant in cui ogni account è ritenuto affidabile per qualunque file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache le rese grafiche delle immagini generate (ridimensionamenti, conversioni di formato) invece di produrle per ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita la connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato per l'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato negli oggetti e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo visualizzato in cima ai template email predefiniti. URL PNG o JPG `http(s)` assoluto — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostato, un'app ancora denominata `Rebase` mostra il marchio Rebase e una rinominata non ne mostra alcuno |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pooling). Il [Realtime](/docs/backend/realtime) ne ha bisogno: `LISTEN`/`NOTIFY` non sopravvive a un pooler di transazioni come PgBouncer, e senza di essa le notifiche di modifica vengono disabilitate con un avviso anziché andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene il suo `LISTEN` di riattivazione su di essa. Valorizza `directConnectionString` dell'adapter Postgres quando non impostata. | — |
| `DATABASE_READ_URL` | Replica di lettura. Le letture vengono indirizzate lì quando è impostata e differisce da `DATABASE_URL`; se la connessione fallisce, viene eseguito il fallback sul database primario con un avviso. Valorizza `readConnectionString` dell'adapter Postgres quando non impostata; sulla versione 0.24 tale opzione viene ignorata. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo per ogni pool all'interno del processo, applicato a prescindere da quanto richiesto da ciascuno di essi. Solo cifre numeriche: un valore malformato viene ignorato anziché serializzare silenziosamente il server. | — |

### Comportamento a runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine server
pubblicata. Un progetto che ha eseguito l'eject gestisce queste decisioni
direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit programmato della row-level security](/docs/rls-check#running-it-on-a-schedule), che segnala le tabelle servite senza criteri (policies). Il progetto deve dichiarare `@rebasepro/rls-check` tra le sue dipendenze: il runtime non ne include alcuna copia e, senza il pacchetto, l'avvio viene rifiutato indicandone il nome. `false` mantiene la scansione disattivata per questo processo. | — |
| `REBASE_BASE_PATH` | Percorso di base per tutte le route dell'API. Lo stesso valore deve essere comunicato al client — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Distribuisce le risorse statiche e amministrative del bundle da questo processo. Disattivalo se è presente una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprime le risposte con gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico rifiuta l'avvio invece di rimuovere silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati: non impostata significa attiva in sviluppo, disattivata in produzione; `false` disattiva entrambe ovunque. Si noti che `true` in produzione serve la **specifica** su `/api/docs` ma non la Swagger **UI** su `/api/swagger` — la UI è vincolata a `NODE_ENV` separatamente. | — |
| `REBASE_METRICS` | Espone le metriche di Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, in modo che i browser rifiutino le connessioni HTTP in chiaro su ogni sottodominio dell'host per sei mesi — compresi gli host non serviti da questo processo. Attivalo solo se ogni sottodominio del dominio è esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedere [Intestazioni di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a protezione di `/metrics`. Se non impostato, lascia l'endpoint aperto a chiunque possa raggiungere la porta — accettabile su una rete privata, sconsigliato su una pubblica, come segnalato nei log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Cosa può fare il runtime allo schema delle collection all'avvio. `ensure` (il valore predefinito ovunque, inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere nulla. `none` non modifica lo schema delle collection, ma le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disattiva anche queste ultime. L'immagine pubblicata accetta solo queste due opzioni e **rifiuta l'avvio con `push`**. In un [deployment suddiviso](/docs/deployment/split-processes) esattamente un solo processo può eseguire il provisioning, per cui ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` impedisce al runtime di apportare qualsiasi modifica al database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, né all'avvio né in seguito, compresi quelli interni del framework. Si limita invece a segnalare cosa manca per nome. Indicato per un database che solo il proprio processo dedicato alle modifiche può alterare. Vedere [Quando solo il processo di modifica può alterare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio quando il database è stato sottoposto a provisioning l'ultima volta a partire da un insieme di collection diverso da quello con cui è stato compilato questo processo. Se non impostata (o con qualsiasi valore diverso da `true`/`1`), genera invece un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o cron genera un'eccezione o non viene analizzato durante l'importazione, indicando ciascun file e la causa, in modo che un rolling deploy lasci attiva la versione precedente. Si applica anche al riavvio. Se non impostata (o con qualsiasi valore diverso da `true`), salta il file e serve i restanti. Un file che viene importato correttamente e non esporta alcuna funzione o job viene sempre saltato, non rifiutato. | skip |
| `REALTIME_CDC` | Change capture a livello di database: `auto` (abilita dove la connessione lo supporta, fallback silenzioso altrimenti), `trigger` (forzato, avviso se impossibile), `wal` (attualmente degrada a `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha la priorità su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Trasporto tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato quando a `realtime.bus` è stato assegnato un trasporto già istanziato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quante sottoscrizioni può mantenere un singolo socket realtime; la successiva viene rifiutata con `TOO_MANY_SUBSCRIPTIONS`. Numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quanti socket realtime può tenere aperti un singolo utente o una chiave API su una singola istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore. L'accesso del successivo viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK continua a ritentare, ottenendo l'accesso non appena un altro socket si chiude. Numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Il tempo massimo di attesa di una modifica prima del refetch che la invia ai sottoscrittori attivi, in ms. Un refetch attende 300 ms senza modifiche, e al massimo questo intervallo in presenza di un flusso costante di scritture. Numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Per quanto tempo il totale di una sottoscrizione a un elenco esteso può essere riutilizzato prima di essere conteggiato nuovamente, in ms; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostata, ogni frame esegue il conteggio. Ha la priorità su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | Il totale minimo a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; elenchi più piccoli vengono conteggiati a ogni frame. Ha la priorità su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori di tipo `localhost`/loopback quando `NODE_ENV=production`. Disattivata, in modo che un avvio di produzione fallisca in modo evidente anziché connettersi a un database inesistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Come si comporta l'avvio con una chiave nelle collection che questa versione non riconosce: `warn`, `error` (rifiuta l'avvio — consigliato da attivare in CI), o `off`. Regola solo le chiavi che non *riconosce*, che di solito sono un refuso e occasionalmente metadati intenzionali; una chiave che sa essere stata spostata è sempre fatale, poiché la funzionalità che configurava risulterebbe altrimenti assente in modo silente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio sullo schema ed esce senza aprire un socket — il formato ideale per un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server che lo segue. Crea inoltre le tabelle che un processo in esecuzione creerebbe altrimenti al primo utilizzo, e non avvia né cron né code di job. Un valore vuoto equivale a *non impostato*, evitando che un `${SOMETHING}` non sostituito in un file compose trasformi un normale deployment in uno che migra e si rifiuta di servire traffico. Rifiutato se impostato insieme a `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso di un file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive tutte le modifiche allo schema apportate, in ordine, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe scritte non sono incluse. Rifiutato su un processo che serve traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina — un agente, un job di CI — di *applicare* una modifica dello schema tramite `/api/admin/schema`, non solo di pianificarla. Disattivato se non esplicitamente richiesto: la credenziale che apporterebbe tale modifica è quella che con maggiore probabilità risiede in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione di una funzione personalizzata prima che la sua richiesta venga interrotta. Stessa opzione di `functionsTimeoutMs`. `0` la disattiva. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promise rejection non gestita termini il processo anziché registrarla solo nei log. Attivo sotto un orchestratore che gestisce il riavvio; disattivato dove un riavvio è peggiore di una perdita di memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene attivo lo scheduler cron su piattaforme che il runtime altrimenti rileva come scale-to-zero, dove un timer che scatta in un'istanza inattiva non scatterebbe in nessuna istanza. | — |
| `TRUSTED_PROXY_HOPS` | Quanti proxy si trovano a monte di questo server, in modo che il rate limiter possa estrarre il vero indirizzo del client da `X-Forwarded-For`. Valore fail-safe predefinito `0`: in assenza di proxy, fidarsi dell'intestazione consentirebbe a qualunque chiamante di falsificare l'identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non è uno strumento di migrazione]
Il passaggio all'avvio viene eseguito senza supervisione e senza che nessuno
analizzi un diff, pertanto non eliminerà mai una colonna, non restringerà mai un
tipo e non riscriverà mai una tabella. È anche per questo che l'immagine rifiuta
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff e può eseguire
tranquillamente `DROP COLUMN`, mentre il riavvio di un container non deve mai
poter distruggere una colonna di produzione come effetto collaterale della
rischedulazione.

Le modifiche distruttive o di ristrutturazione rimangono dove possono essere
revisionate: `rebase db generate` + `rebase db migrate`, o `rebase db push` da
un checkout locale o da CI, che esegue una simulazione (dry-run) della modifica,
rifiuta quelle distruttive senza conferma e può eseguire un backup preventivo.
:::

### Deployment suddivisi

Una singola immagine e un singolo bundle possono essere avviati più volte
contemporaneamente, ciascuno al servizio di una parte differente del progetto.
Qui è riportata una sola riga per ciascuna, poiché questa pagina si prefigge di
elencare tutte le variabili; ciò che ciascuna combinazione *monta e gestisce* —
e quali combinazioni rifiutano l'avvio — è descritto in
**[Processi suddivisi](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Quale parte serve questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Esegue l'override per definire se *questo* processo esegue i timer cron. Se non impostata, segue il ruolo. | — |
| `REBASE_JOB_WORKERS` | Esegue l'override per definire se questo processo esegue i worker delle code di job. Se non impostata, segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve solo le funzioni personalizzate indicate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve tutte le funzioni personalizzate tranne quelle indicate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Dove il processo API inoltra una richiesta di funzione che non serve direttamente. Su un `worker`, dove vengono indirizzate le sue chiamate a `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint opzionale Model Context Protocol su `/mcp`, che consente a un client
AI di leggere e scrivere su questo progetto **come utente autenticato**.
Disattivato se non configurato e — a differenza di ogni altra superficie — nessun
`REBASE_ROLE` lo attiva: gli altri descrivono la forma del processo, mentre
questo rappresenta la decisione di affidare credenziali a software di terze
parti, e dovrebbe essere presa da una persona anziché essere ereditata dal ruolo
del container.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Richiede `REBASE_PUBLIC_URL`; senza di essa la superficie rifiuta di montarsi e lo notifica nel log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine accessibile dall'esterno di questo deployment, ad es. `https://app.example.com`. La superficie MCP non è in grado di dedurla — estrarre l'origine dall'header `Host` renderebbe l'identità dell'emittente e l'audience rispetto a cui i token vengono verificati un valore fornito dal chiamante. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), in modo che un client possa registrarsi autonomamente. Impostare su `false` per richiedere che i client vengano registrati preventivamente. | `true` |

### Modifica dello schema live da un bundle

Disattivata a meno che non sia impostata `REBASE_LIVE_SCHEMA_REPOSITORY`. Un
bundle compilato non ha codice sorgente delle collection da modificare, quindi con
queste variabili impostate l'editor delle collection del pannello di amministrazione
legge i sorgenti dal repository, ne committa le modifiche ed esegue il relativo DDL
su questo database. Riservato agli amministratori e applicato manualmente da una
persona, a meno che `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` non stabilisca
diversamente. Un repository configurato senza credenziali utilizzabili rifiuta
l'avvio. Vedere
[Modifica dello schema live](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare il commit delle modifiche allo schema, nel formato `owner/name`. La sua impostazione attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene effettuato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Posizione del sorgente delle collection all'interno di quel repository, relativa al repository. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permessi granulari con accesso in lettura e scrittura ai contenuti del repository. Impostare questo o le tre variabili `_GITHUB_APP_*`, non entrambi. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per effettuare i commit come app anziché con un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata dell'app: PEM, PEM con newline con caratteri di escape, o base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostata o impostata a `0`, mantiene tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Mantiene sempre almeno gli ultimi N backup più recenti, indipendentemente dalla retention. | — |
| `PG_DUMP_PATH` | Esegue l'override dell'eseguibile `pg_dump` — deve corrispondere alla versione principale del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Esegue l'override dell'eseguibile `pg_restore`. | — |
| `PSQL_PATH` | Esegue l'override dell'eseguibile `psql` eseguito da `rebase db restore --clean` per rendere il ripristino un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione di `pg_dumpall`, se non presente nel `PATH`. In sua assenza — e senza i tool client di PostgreSQL installati — un backup dei globals fallisce con un errore che fa riferimento a questa variabile. | — |

L'immagine di runtime ufficiale (`rebasepro/server`) include i tool client di
PostgreSQL 18, pertanto un backup pianificato eseguito al suo interno funziona con
qualsiasi server fino a Postgres 18. Al di fuori dell'immagine, è necessario
installarli autonomamente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione
privata protetta da cifratura a riposo.

### Distribuzione del bundle

Una distribuzione gestita non include il proprio codice nell'immagine: il runtime
recupera un bundle all'avvio. Queste variabili stabiliscono quale bundle recuperare
e in che modo.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso di una directory di bundle già estratta. Quello che `rebase start` imposta localmente. | — |
| `REBASE_BUNDLE_URL` | Percorso/URL da cui scaricare l'archivio del bundle, quando non ve n'è uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | La credenziale Bearer per tale recupero. Trattala come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Cartella in cui viene estratto il bundle scaricato. Deve essere scrivibile e deve persistere tra la fase di download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi che l'immagine di runtime fornisce al bundle, oltre a quelli dichiarati autonomamente. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `config/resources.ts` viene
associato tramite variabili d'ambiente che ne riprendono il nome. I nomi di base sono
indicati di seguito; una risorsa non predefinita appende `__` e la propria chiave
in lettere maiuscole: ad esempio, un bucket denominato `media` leggerà
`S3_BUCKET__MEDIA`. Il comando `rebase status` stampa, per ciascuna risorsa,
la variabile esatta che sta leggendo e se risulta impostata.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di una sorgente dati, quando non corrisponde a quello predefinito di Postgres. Presenta un suffisso per ciascuna sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Presenta un suffisso per ciascun topic. | — |

### Ambiente specifico della CLI

Letto da `rebase`, non dal server. Nulla di quanto indicato qui influisce su un
deployment.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Dove `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, nella shell o in `.env`. Impostala quando il server viene eseguito in un modo diverso da `rebase dev` all'interno di questo progetto: `rebase start`, un container, un altro host. Se non impostata, viene utilizzato il server memorizzato da `rebase dev` finché tale server è in esecuzione, e non viene inviato nulla quando non lo è. | — |
| `REBASE_SERVICE_KEY` | La service key con cui tali comandi si autenticano, letta da `.env`: la stessa variabile letta dal server (vedere sopra). | — |
| `SERVICE_KEY` | Un nome obsoleto per tale chiave. Quando impostata in `.env`, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quale file `.env` viene letto e scritto dalla CLI, quando non corrisponde a quello del progetto. | — |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui eseguire l'accesso tramite `rebase cloud login`, evitando la richiesta interattiva. | — |
| `REBASE_CLOUD_PASSWORD` | La password corrispondente, consentendo a un gestore di segreti di trasmetterla senza che compaia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token generato da `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica tramite di esso anziché tramite la sessione di `rebase cloud login`, e non legge né scrive mai la sessione memorizzata. In una directory collegata tramite `rebase cloud init --claim`, viene accantonato a favore del token specifico di quel progetto se non dispone dello scope necessario per il progetto. È il metodo consigliato per eseguire `rebase cloud` in CI — vedere [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI creata dai suoi tool cloud, e non lo invia mai all'app: a tale scopo impostare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` visualizza l'errore sottostante e i dettagli della richiesta anziché il messaggio abbreviato. La prima cosa da impostare quando un comando `rebase cloud` fallisce senza fornire spiegazioni utili. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto su cui `rebase db push`, `db generate` e `db migrate` effettuano la pianificazione, al posto di `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina un database qui indicato, e rifiuta un valore identico a `DATABASE_URL`. Sul database di sviluppo gestito, la CLI imposta automaticamente un'istanza temporanea in-memory PGlite dedicata. Da impostare negli ambienti in cui il privilegio `CREATE DATABASE` non è concesso. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue il provisioning di nulla — la gestione del database spetta all'utente. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server di frontend, che altrimenti `rebase dev` deduce dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo massimo di attesa da parte di `rebase dev` affinché il backend annunci la propria disponibilità prima di segnalare che non si è avviato. `0` disattiva la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password che `rebase dev --docker` inserisce nella stringa di connessione dedotta da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convenzione cross-tool standard. Se impostata su qualsiasi valore diverso da `0`, la CLI non invia dati di telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | La stessa funzionalità, specifica per Rebase. Non richiede alcun file, ed è per questo quella consigliata da usare in CI e all'interno delle immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint a cui inviare la telemetria, per un collettore self-hosted. | — |

## Segreti in sviluppo

`JWT_SECRET` è obbligatoria in produzione. Sia essa che `REBASE_SERVICE_KEY`
vengono generate automaticamente al di fuori di essa, consentendoti di iniziare
senza dover configurare nulla.

Questi valori generati vengono memorizzati nella cache in `.rebase-dev-secrets.json`,
accanto a `.rebase-dev-port` e `.rebase-dev-url`, e inclusi nel `.gitignore` insieme
ad essi. In precedenza venivano rigenerati a ogni avvio — pertanto il riavvio del dev
server disconnetteva l'utente dalla propria app e invalidava qualsiasi chiave API
appena creata.

- Imposta esplicitamente una delle due variabili e verrà utilizzato il tuo valore;
  nulla verrà memorizzato nella cache né letto.
- Punta la cache altrove con `REBASE_DEV_SECRETS_FILE` — un percorso, e l'unica
  variabile di questa sezione che si imposterebbe mai deliberatamente.
- Elimina il file per effettuare la rotazione di entrambi i segreti. L'avvio successivo
  ne scriverà uno nuovo.
- Se il file non può essere scritto — ad esempio in un container in sola lettura —
  il server si avvia comunque con un segreto effimero, esattamente come in passato.

Nulla viene memorizzato nella cache in produzione, né sotto un test runner. In produzione
non viene generato alcun valore: un avvio privo di `JWT_SECRET` fallisce, indicando il
nome della variabile, e questo comportamento resta invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

Il `RebaseBackendConfig` passato a `initializeRebaseBackend()` offre il controllo programmatico:

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

Le stesse opzioni, senza `app`, `server` e `basePath` e con un parametro `provision`
obbligatorio, creano un backend che non serve nulla finché non viene montato:
`createRebaseBackend`. Vedere [Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta ogni route dell'API, per cui la stessa impostazione deve essere
comunicata al client — altrimenti continuerà a richiedere `/api/...` ricevendo un
404 per qualsiasi cosa:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione rileva questo valore dal client che gli viene fornito;
non occorre configurare nient'altro. Se costruisci un URL di richiesta manualmente,
uniscilo partendo dal client invece di scrivere `/api` a mano:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Errore di autorizzazione nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, anche se la vista CMS a foglio di calcolo carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL commutando temporaneamente i ruoli del database in modo che corrispondano al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli esistono solo nelle tabelle del database anziché come effettivi ruoli di PostgreSQL, il cambio di ruolo fallisce oppure mancano i privilegi nel database. La vista a foglio di calcolo del CMS viene invece eseguita con l'utente proprietario della connessione predefinito e bypassa questo passaggio.
* **Soluzione:** Aggiungi `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del tuo backend. Questo impone a Rebase di eseguire le query dell'Editor SQL utilizzando i privilegi del proprietario della connessione (tipicamente un superuser/owner). L'Editor SQL indicherà quindi, sopra i risultati, che sono stati letti come proprietario della connessione, e disabiliterà il selettore del ruolo.

### Recupero dello schema dell'Editor SQL non riuscito (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'Editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornita al bootstrapper, o se `getAdmin()` viene sottoposto a override per restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Assicurati che `adminConnectionString` sia configurata durante l'inizializzazione del bootstrapper del backend:
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
