---
sourceHash: fa28c44bef748bed
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene effettuata tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca qualcosa di obbligatorio o se un valore non è valido (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> Dove risiede lo schema dipende da come viene eseguito il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di tutte le tabelle riportate di seguito. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })`, e può aggiungervi le
> proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione a PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria in tutti gli altri casi. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una dicitura di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano: esegue la cifratura, ma non verifica il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la supportano e non gestiscono la
> cosa gradualmente: rifiutano l'avvio con l'errore `invalid sslmode value: "no-verify"`.
>
> I comandi integrati di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima di chiamare i processi
> esterni, funzionando quindi con l'URL così come configurato. L'utilizzo manuale di `psql` non
> effettua questa riscrittura: in tal caso, sostituirla con `sslmode=require`, che cifra senza
> verificare esattamente allo stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL delle API di backend per l'SDK tipizzato. **Impostare solo in sviluppo** — vedere di seguito. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Abilita "Accedi con Google". | — |


> **Non impostare `VITE_API_URL` nelle build di produzione.**
>
> In sviluppo, il frontend e il backend hanno origini separate, quindi il dev server
> inserisce questo valore. In produzione, il backend di Rebase serve la SPA, pertanto l'API
> condivide l'origine della pagina stessa e il client la risolve autonomamente in questo modo.
>
> Inserire un URL assoluto in un bundle di produzione funziona solo fino a quando un secondo
> hostname non punta alla stessa applicazione: un dominio personalizzato caricherebbe la pagina
> da `example.com` ed effettuerebbe chiamate all'API su `example.rebase.website`, che è
> cross-origin, facendo fallire ogni richiesta al preflight. Consentire l'origine in CORS
> **non** risolve il problema: il cookie di refresh è `SameSite=Lax` e non viene inviato
> cross-site; di conseguenza, gli errori in console sparirebbero ma l'autenticazione continuerebbe
> a non funzionare. Lasciandolo non impostato, qualsiasi dominio che punta all'applicazione funziona
> senza richiedere alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un valore `PORT` in `.env` non viene letto, poiché la porta viene risolta prima del caricamento di quel file — altrimenti associa una porta derivata dal percorso del progetto, consentendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la priorità su entrambi, e il banner di avvio specifica il livello utilizzato. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'istruzione SQL associata a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita contiene i parametri associati (ad es. un'email, un hash di password). Impostare su `true` durante la diagnosi di errori DDL, RLS o di acquisizione delle modifiche. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatorio in produzione** a meno che `FRONTEND_URL` non sia impostato: un avvio in produzione senza nessuno dei due rifiuta l'avvio. In sviluppo viene *aggiunto a* localhost — vedere di seguito. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzato in alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e le operazioni amministrative). Il database specificato non è quello considerato corrente dalla console SQL, né quello copiato per impostazione predefinita da un nuovo branch: entrambi corrispondono al database su cui si trova la connessione dell'applicazione stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del database non sono mappati). La console SQL di Studio indica quindi che le righe sono state lette come proprietario della connessione, ne riporta il nome e disabilita il relativo selettore di ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui viene eseguito questo server. `rebase dev` lo imposta su un checkout [spostato su un branch](/docs/backend/branching/#cli-integration). Un server con questa variabile mantiene il registro dei branch su tale database e copia i nuovi branch da esso per impostazione predefinita, in modo che il pannello Branches di Studio mostri i branch del database principale. | — |

#### CORS in sviluppo

Lo sviluppo consente **localhost, oltre a qualsiasi origine indicata da `CORS_ORIGINS` (o `FRONTEND_URL`)**
— lo stesso elenco utilizzato dalla produzione, con l'aggiunta di localhost anziché la sua
sostituzione. La variabile funziona quindi allo stesso modo in entrambi gli ambienti, e i
casi che ne richiedono l'uso in sviluppo sono quelli tipici:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non sia né localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con la riga esatta che la abiliterebbe. Il rifiuto non
è prudenza fine a se stessa: l'API trasmette credenziali, quindi riflettere un header
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate verso il dev server con la sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Segreto per la firma dei JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare i token di accesso in modo asimmetrico (RS256), consentendo a qualsiasi entità in possesso del JWKS di verificare una sessione senza poter generarne una. Accetta un file PEM con interruzioni di riga reali, un PEM con caratteri di escape `\n`, o l'intero PEM codificato in base64. Senza di essa i token rimangono in formato HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificarlo a ogni cambio di chiave: la rotazione richiede che la vecchia e la nuova chiave siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del refresh token. A finestra scorrevole: ogni rotazione la rinnova, determinando quindi quanto a lungo una sessione sopravvive all'**inattività**. Impostare su `400d` per sessioni che devono persistere dopo una lunga assenza; i browser impostano questo limite massimo per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consenti la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione, il **primo** utente può sempre registrarsi, indipendentemente da questo valore: una tabella degli utenti vuota deve accettare qualcuno, e tale utente diventa l'amministratore. In produzione (`NODE_ENV=production`) tale finestra è chiusa: una tabella vuota rifiuta la registrazione iniziale con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un account ordinario e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` di seguito o assegnato con la service key. Il file `.env.example` dello scaffold lo imposta su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di blocco (kill switch). Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, bloccando la registrazione anche a database vuoto. Da associare a `REBASE_ADMIN_EMAIL` riportata di seguito, altrimenti il deployment non avrà alcun modo per creare il suo primo utente autenticato. Tutti gli artefatti di deployment distribuiti lo impostano. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il proprio amministratore: l'operatore definisce il primo account anziché rischiare una race condition su internet. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Deve contenere almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Cifra tutti i secret TOTP memorizzati. Se non impostata, i secret vengono cifrati con `JWT_SECRET` e all'avvio viene mostrato un avviso singolo: ruotare `JWT_SECRET` disconnetterebbe quindi tutti gli utenti *e* renderebbe indecifrabili tutti gli authenticator registrati. Impostare una chiave dedicata (almeno 32 caratteri casuali) prima che chiunque si registri. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la *rotazione*. Impostarle entrambe durante una rotazione: i nuovi secret vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che gli utenti rimangano bloccati fuori dal proprio account a metà procedura. Rimuoverla dopo aver ricifrato tutti i secret. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, volutamente non vincolata a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiedi l'autenticazione per l'API dei dati. Impostare su `false` per una superficie di lettura completamente pubblica (RLS si applica comunque). | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato quando non ne viene specificato alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Attiva l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito via email. Riservato solo a chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è riservato a frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Sicuro per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per connessioni http semplici — un deployment su un indirizzo LAN in cui il browser altrimenti scarterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza errori. Genera un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | ID client Google OAuth (convalida backend) | — |
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
| `GITLAB_CLIENT_ID` | ID client GitLab OAuth. Il parametro `baseUrl` di un'istanza self-hosted non ha una corrispondente variabile d'ambiente — configurare GitLab nel blocco `auth` a tale scopo. | — |
| `GITLAB_CLIENT_SECRET` | Client secret GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID di Apple, per l'accesso web. È pubblico ed è visibile in `GET /auth/config`. Apple non dispone di un client secret statico, poiché Rebase firma un JWT ES256 a breve durata per ogni scambio di token. Di conseguenza Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o ad `APPLE_BUNDLE_IDS`, e non configura nulla senza di essi. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgole dei bundle ID delle app native iOS/macOS di cui vengono accettati i codici di Accedi con Apple. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, il subject emittente del JWT. | — |
| `APPLE_KEY_ID` | ID chiave della chiave privata registrata su Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, interruzioni di riga incluse (i caratteri di escape `\n` sono accettati). | — |
| `REBASE_SERVICE_KEY` | Chiave API amministrativa statica. Ignora la normale autenticazione JWT per le chiamate server-to-server quando inviata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La chiave pubblica della piattaforma di hosting (PEM, EC P-256) utilizzata per verificare i token di piattaforma `rpt_`; blocchi PEM multipli durante una rotazione delle chiavi. Viene impostata dalla piattaforma al momento del deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE` consente al controllo di accesso amministrativo di accettare un token di piattaforma per `cron:read` e per nessun'altra operazione. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID di progetto a cui deve corrispondere il claim `aud` di un token di piattaforma, impedendo l'uso di un token generato per un altro progetto. Se solo una delle due variabili è impostata, il server si avvia, registra un avviso e risponde a qualsiasi token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Dove risiedono i contatori di limitazione di frequenza (rate-limit), per le route di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per singolo processo) o `sql` (condiviso tra le repliche). Un processo non può rilevare il proprio numero di repliche, quindi un deployment con nodi multipli deve esplicitarlo: tre repliche con l'impostazione predefinita applicheranno una soglia tripla. Qualsiasi altro valore **impedisce l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Attiva il flusso del link di accesso senza password. Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Attiva l'accesso senza password con un codice a sei cifre inviato via email. Stessi requisiti per l'email di cui sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic link o codice email per un indirizzo non registrato crea l'account, a condizione che la registrazione sia aperta. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Azione intrapresa in caso di riutilizzo di un refresh token dopo la finestra di tolleranza: `reject` (rifiuta la richiesta, mantiene la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore impedisce l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma preventiva: nessun accesso con password consentito prima della verifica dell'indirizzo. Richiede l'email; l'avvio viene rifiutato se assente. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostata significa nessun captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio una volta impostato `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgole delle route di autenticazione da proteggere (ad esempio `register,login`). Non impostata protegge la selezione predefinita del provider. | — |

### Storage

:::caution[Lo storage non dispone di sicurezza a livello di riga, quindi richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. L'object storage non ha un equivalente —
le chiavi condividono un unico namespace piatto — pertanto con un bucket configurato e nessun modello di accesso
il server **rifiuta l'avvio in produzione**. Soddisfare questo requisito con esattamente uno dei seguenti elementi:
un hook `storageAuthorize` esportato da `backend/storage.ts` (incluso nello scaffold),
`STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di storage: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene interpretato a partire dalla directory in cui viene eseguito il server: la radice del progetto sotto `rebase dev`, `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consenti lo storage locale in produzione — solo con un volume permanente che contenga `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali nominati adiacenti | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte, su tutti i percorsi di upload — `__<KEY>` per una sorgente nominata. Un valore che non sia un numero intero di byte impedisce l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza l'uso di URL in stile path per i bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Di norma dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file delle chiavi del service account. Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce qualsiasi oggetto a chiunque, senza token. Da utilizzare solo per un bucket che agisce effettivamente come CDN pubblica. Uno dei tre modi per soddisfare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Denominata `INSECURE` nell'oggetto di configurazione per un motivo: è giustificabile solo in un'applicazione single-tenant in cui ogni account è autorizzato ad accedere a ogni file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache le varianti grafiche generate (ridimensionamenti, conversioni di formato) anziché produrle a ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita la connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato per l'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato negli oggetti e nei corpi delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato in cima ai template email predefiniti. URL assoluto `http(s)` di un'immagine PNG o JPG — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostata, un'applicazione denominata `Rebase` riceve il logo Rebase, mentre un'app con un nome diverso non riceve alcun logo |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pool). [Realtime](/docs/backend/realtime) ne richiede una: `LISTEN`/`NOTIFY` non funziona attraverso un pooler a livello di transazione come PgBouncer; senza di essa, le notifiche delle modifiche vengono disabilitate con un avviso anziché andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene su di essa il proprio `LISTEN` di riattivazione. Popola l'opzione `directConnectionString` dell'adattatore Postgres quando questa non è impostata. | — |
| `DATABASE_READ_URL` | Replica in sola lettura, come un hot standby. Quando indica un altro server, le operazioni di lettura per utenti autenticati (elenchi, righe singole, conteggi, aggregati) vengono gestite da lì applicando la medesima sicurezza a livello di riga; le scritture, gli accessi, realtime, i cron, i job, la console SQL e `rebase.sql` rimangono sull'istanza primaria. Un utente che ha appena eseguito una scrittura legge dall'istanza primaria per la durata di `REBASE_READ_STICKY_MS`, e tutti leggono dalla primaria se la replica accumula un ritardo superiore a `REBASE_READ_MAX_LAG_MS` o se fallisce. Popola `readConnectionString` dell'adattatore Postgres se non impostata; fino alla versione 0.28 compresa, il pool della replica veniva aperto ma non veniva mai impiegato per le letture. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, tempo durante il quale le letture dello stesso utente vengono indirizzate all'istanza primaria, garantendo che un salvataggio seguito da un elenco mostri il dato aggiornato. Per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Ritardo massimo della replica oltre il quale ogni lettura viene instradata all'istanza primaria. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa attraverso un pooler in modalità transazione come PgBouncer. Il pool non invia `search_path` o `statement_timeout` alla connessione (il pooler li rifiuterebbe o scarterebbe) e imposta entrambi all'interno di ciascuna transazione; all'avvio viene assegnato al ruolo del database un `search_path` predefinito di `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatorio e viene impiegato per realtime, il risveglio del job worker, la creazione degli indici, il branching e la console SQL. Anche l'URL della replica viene considerato con pool. Utilizzare `DATABASE_POOLED__<KEY>` per un'altra sorgente dati. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo applicato a ogni pool del processo, indipendentemente dal valore richiesto da ciascuno. Solo cifre numeriche semplici: un valore non valido viene ignorato anziché serializzare silenziosamente le connessioni del server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine del server
pubblicata. Un progetto che ha eseguito l'eject gestisce queste impostazioni direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit della sicurezza a livello di riga](/docs/rls-check#running-it-on-a-schedule) programmato, che segnala le tabelle esposte prive di policy. Il progetto deve dichiarare `@rebasepro/rls-check` tra le sue dipendenze: il runtime non include una copia integrata e, in assenza del pacchetto, l'avvio viene rifiutato indicandone il nome. `false` disabilita la scansione su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Assegnare un ruolo dedicato a ciascun progetto presente su un cluster condiviso. Il database memorizza il ruolo con cui viene eseguito, e un avvio configurato per un altro ruolo rifiuta di partire finché non viene eseguito `rebase db request-role migrate`. Vedere [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo di richiesta e consente alla connessione di passare a esso; `never` lascia entrambi i passaggi all'utente, limitandosi a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | Quali permessi Rebase assegna al ruolo di richiesta: `schema` (ogni tabella negli schemi gestiti, più i privilegi predefiniti), `managed` (solo le tabelle gestite) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe le policy permissive di Rebase esclusivamente al ruolo (o ai ruoli) di richiesta, impedendo agli altri ruoli che leggono le stesse tabelle di beneficiarne. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` assegna le policy superabili solo dal contesto server o da un amministratore `TO public`, ed esegue gli amministratori con il ruolo di richiesta. Per impostazione predefinita sono impostate `TO rebase_admin`, consentendo alle letture con ambito proprietario degli utenti autenticati di utilizzare l'indice del proprietario. Vedere [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base server-o-admin da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, permettendo alle policy scritte con `auth.uid()` di identificare il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio quando un altro login può assumere il ruolo di richiesta: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso base per tutte le route API. Anche il client deve essere configurato con lo stesso valore — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Distribuisce gli asset statici/amministrativi del bundle da questo processo. Disattivare se è presente una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprime le risposte tramite gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché rimuovere silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Esposizione dell'interfaccia OpenAPI. A tre stati. Non impostata, in tutti gli ambienti: `/api/docs` viene servito ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, fornendo a ciascuno il documento delle tabelle a essi descritte, senza Swagger UI. `true` pubblica l'intero documento a tutti, con la **UI** di Swagger su `/api/swagger` all'esterno della produzione (mai in produzione). `false` mantiene il documento protetto dal controllo di accesso amministratore. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, imponendo ai browser di rifiutare il traffico HTTP semplice su ogni sottodominio dell'host per sei mesi — inclusi gli host non serviti da questo processo. Attivare solo se ogni sottodominio del dominio supporta esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token per la protezione di `/metrics`. Se non impostata, l'endpoint rimane accessibile a chiunque possa raggiungere la porta — accettabile su una rete privata, non su una pubblica, come evidenziato nei log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Azioni consentite al runtime sullo schema delle tabelle all'avvio. `ensure` (il valore predefinito ovunque, inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere elementi esistenti. `none` non modifica lo schema delle tabelle dichiarate, ma crea e mantiene aggiornate le tabelle interne del framework (autenticazione, chiavi API, job, cron); `REBASE_PROVISION=false` disattiva anche queste ultime. L'immagine pubblicata accetta solo queste due opzioni e **rifiuta l'avvio su `push`**. In un [deployment distribuito](/docs/deployment/split-processes) solo un processo può occuparsi del provisioning; tutti gli altri ruoli devono impostare `none` o l'avvio verrà bloccato. | `ensure` |
| `REBASE_PROVISION` | `false` impedisce al runtime di apportare qualsiasi modifica al database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, né all'avvio né in seguito, inclusi quelli propri del framework. Segnala invece i componenti mancanti per nome. Da utilizzare per database modificabili esclusivamente tramite la pipeline di migrazione dedicata. Vedere [Quando solo il processo di migrazione può modificare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo i valori `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio se il database è stato predisposto l'ultima volta a partire da un insieme di tabelle diverso da quello utilizzato per compilare questo processo. Se non impostata (o con qualsiasi valore diverso da `true`/`1`), emette un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o di cron genera un'eccezione o presenta errori di parsing durante l'importazione, specificando il file e la causa, in modo che un deploy progressivo continui a servire la versione precedente. La regola si applica anche in caso di riavvio. Se non impostata (o con qualsiasi valore diverso da `true`), ignora il file problematico e carica i rimanenti. Un file che viene importato correttamente ma non esporta alcuna funzione o job viene sempre ignorato senza interrompere l'avvio. | skip |
| `REALTIME_CDC` | Acquisizione dei cambiamenti a livello di database (Change Data Capture): `auto` (legge le modifiche dal WAL se supportato dal database, altrimenti usa i trigger, altrimenti ricorre al fallback a livello applicativo, registrando ogni fallback come info), `trigger` (forza l'uso dei trigger, avvisa se impossibile), `wal` (legge le modifiche dal write-ahead log invece che dai trigger; richiede `wal_level=logical` e un ruolo abilitato alla replica, altrimenti esegue il fallback su `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha priorità rispetto a `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Trasporto tra istanze per i canali di broadcast e la presence: `memory` o `postgres`. Ignorato se a `realtime.bus` è stato assegnato un trasporto già inizializzato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; la richiesta successiva viene rifiutata con `TOO_MANY_SUBSCRIPTIONS`. Richiede un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha priorità rispetto a `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di socket realtime che un utente, o una chiave API, può mantenere aperti su una singola istanza del server. I socket aperti da un amministratore in modalità impersonificazione vengono conteggiati a carico dell'amministratore stesso. La connessione successiva viene rifiutata con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK ritenta la connessione, riuscendo ad accedere non appena un altro socket si chiude. Richiede un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha priorità rispetto a `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa di una modifica prima del refetch che la invia ai sottoscrittori attivi, in ms. Un refetch attende 300 ms senza modifiche, e al massimo questo intervallo in presenza di un flusso costante di scritture. Richiede un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha priorità rispetto a `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo di tempo entro cui il totale di una sottoscrizione di un elenco di grandi dimensioni può essere riutilizzato prima di un nuovo conteggio, in ms; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostata, il conteggio viene rieseguito a ogni frame. Ha priorità rispetto a `realtime.recountIntervalMs`. | Non impostata |
| `REALTIME_RECOUNT_MIN_ROWS` | Valore minimo dell'ultimo totale a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi più piccoli vengono conteggiati a ogni frame. Ha priorità rispetto a `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback in ambiente `NODE_ENV=production`. Disattivata per impostazione predefinita, in modo che un avvio in produzione segnali chiaramente l'errore anziché connettersi a un database inesistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio sullo schema e termina senza aprire alcun socket — la modalità richiesta da un Job di migrazione, basato sulla stessa immagine e sullo stesso bundle del server successivo. Crea inoltre le tabelle che un processo in esecuzione creerebbe solo al primo utilizzo, e non avvia né code di cron né worker di job. Un valore vuoto è considerato *non impostato*, evitando che una variabile `${QUALCOSA}` non sostituita in un file compose trasformi un normale deployment in uno che esegue migrazioni e rifiuta di servire traffico. Non compatibile con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso di un file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive tutte le modifiche allo schema apportate, in sequenza, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe di dati scritte non sono incluse. Rifiutato su un processo che serve traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a un sistema automatico — un agente, un job di CI — di *applicare* una modifica allo schema tramite `/api/admin/schema`, anziché limitarsi a pianificarla. Disattivata a meno che non sia richiesta esplicitamente: le credenziali che consentirebbero tale modifica sono spesso quelle salvate nelle variabili di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione consentito a una funzione personalizzata prima dell'interruzione della richiesta. Stesso parametro dell'opzione `functionsTimeoutMs`. `0` disattiva il timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promise rejection non gestita termini il processo anziché limitarsi a registrarla nei log. Da attivare sotto un orchestratore configurato per il riavvio automatico; disattivare nei contesti in cui un riavvio sia più dannoso di un potenziale leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Disattiva l'avviso di avvio sulle piattaforme che il runtime rileva come scale-to-zero, dove un timer eseguito in un'istanza inattiva non scatterebbe su nessuna istanza. Non altera altri comportamenti: impostare quando si garantisce almeno un'istanza sempre attiva. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy intermedi attestati davanti a questo server, necessario affinché il rate limiter possa estrarre il reale indirizzo del client da `X-Forwarded-For`. Valore predefinito prudenziale `0`: senza proxy, considerare affidabile l'header consentirebbe a qualsiasi client di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non è uno strumento di migrazione]
Il provisioning all'avvio viene eseguito in modo non presidiato, senza che nessuno analizzi il diff: pertanto non eliminerà mai una colonna, non restringerà un tipo né riscriverà una tabella. Per questo motivo l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff e può eseguire tranquillamente `DROP COLUMN`, mentre il riavvio di un container non deve in alcun caso rischiare di distruggere una colonna in produzione a seguito di una rischedulazione.

Le modifiche distruttive o strutturali devono essere gestite nei flussi in cui possono essere revisionate: `rebase db generate` + `rebase db migrate`, oppure `rebase db push` da un checkout locale o da CI, che simula la modifica a secco, rifiuta quelle distruttive in assenza di conferma e consente di eseguire preventivamente un backup.
:::

### Deployment distribuiti

Una singola immagine e un unico bundle possono essere avviati più volte, ciascuno
dedicato a una parte specifica del progetto. Di seguito una breve sintesi per ciascuna voce;
per il dettaglio su cosa ogni combinazione *installa e gestisce* — e su quali
combinazioni impediscano l'avvio — consultare
**[Processi separati](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Quale componente serve questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron su *questo* processo. Se non impostata, segue il ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job su questo processo. Se non impostata, segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Esegue in questo processo solo le funzioni personalizzate indicate. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Esegue tutte le funzioni personalizzate a eccezione di quelle indicate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Endpoint a cui il processo API inoltra una richiesta per una funzione non gestita localmente. Su un `worker`, corrisponde alla destinazione delle chiamate interne `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint opzionale Model Context Protocol su `/mcp`, che consente a un client AI di leggere
e scrivere in questo progetto **come utente autenticato**. Disattivato per impostazione predefinita
e — a differenza di ogni altra interfaccia — nessun `REBASE_ROLE` lo abilita automaticamente:
gli altri descrivono la tipologia di processo, mentre questa rappresenta una scelta esplicita di delegare
credenziali a software di terze parti, che deve essere assunta da un operatore umano anziché
derivata dal ruolo di un container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Attiva l'interfaccia MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza l'endpoint non viene abilitato e viene registrato un messaggio nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine raggiungibile esternamente di questo deployment, ad es. `https://app.example.com`. L'interfaccia MCP non può dedurla autonomamente — ricavarla dall'header `Host` farebbe dipendere l'identità dell'emittente e l'audience con cui vengono validati i token da un valore fornito dal client. | — |
| `REBASE_MCP_VIEW` | Percorso della vista personalizzata MCP dell'applicazione (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica per permettergli di renderizzare viste, campi e azioni personalizzati. Se non specificata, il backend cercherà il file accanto al frontend che serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consenti la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere la pre-registrazione dei client. | `true` |

### Modifica live dello schema da un bundle

Disabilitata a meno che non sia impostata `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilato non
dispone dei sorgenti in `backend/schema` da modificare: impostando queste variabili, l'editor
dello schema legge i sorgenti dal repository, ne committa le modifiche ed esegue il relativo DDL
su questo database. Riservato agli amministratori e applicato manualmente da una persona, a meno
che `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` non disponga diversamente. L'indicazione di un repository
privo di credenziali utilizzabili impedisce l'avvio. Vedere
[Modifica live dello schema](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare i commit delle modifiche allo schema, nel formato `owner/name`. L'impostazione di questa variabile attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene effettuato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione di `backend/schema` all'interno del repository, relativa alla radice. Un percorso che punti all'esterno del repository impedisce l'avvio, così come l'opzione deprecata `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permessi granulari di lettura e scrittura sui contenuti del repository. Impostare questa variabile o le tre variabili `_GITHUB_APP_*`, non entrambe. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID dell'applicazione GitHub App, per effettuare i commit come app anziché tramite token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID di installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chiave privata dell'app: formato PEM, PEM con newline con escape o base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Non impostata indica che i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatoria in combinazione con `BACKUP_SCHEDULE`, che non viene avviato in sua assenza. `rebase db backup` fa fallback su `./backups` nella directory di esecuzione. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Non impostata o `0` conserva tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Mantiene sempre almeno N backup più recenti, indipendentemente dalla retention impostata. | — |
| `PG_DUMP_PATH` | Percorso alternativo dell'eseguibile `pg_dump` — deve corrispondere alla major version del server o a una più recente. | — |
| `PG_RESTORE_PATH` | Percorso alternativo dell'eseguibile `pg_restore`. | — |
| `PSQL_PATH` | Percorso alternativo dell'eseguibile `psql` eseguito da `rebase db restore --clean` per incapsulare il ripristino in un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Percorso dell'eseguibile `pg_dumpall`, se non incluso nel `PATH`. In sua assenza — e senza i client tool di PostgreSQL installati — il backup delle entità globali fallisce con un errore che cita questa variabile. | — |

L'immagine di runtime ufficiale (`rebasepro/server`) include i tool client di
PostgreSQL 18; pertanto, un backup pianificato può essere eseguito al suo interno verso
qualsiasi server fino a Postgres 18. Al di fuori dell'immagine, installarli manualmente
(`apt-get install postgresql-client-18`, `brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione privata
con crittografia a riposo (encryption-at-rest).

### Distribuzione del bundle

Un deployment gestito non include il codice applicativo all'interno dell'immagine: il
runtime recupera un bundle all'avvio. Queste variabili ne determinano la selezione e le modalità
di recupero.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una directory con bundle già estratto. Impostato localmente da `rebase start`. | — |
| `REBASE_BUNDLE_URL` | URL da cui scaricare l'archivio del bundle in assenza di un percorso locale. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale bearer per il download del bundle. Trattare come segreto: autorizza il tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto il bundle scaricato. Deve essere scrivibile e persistere tra la fase di download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi che l'immagine di runtime mette a disposizione del bundle, oltre a quelli dichiarati dal bundle stesso. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato dal progetto in `backend/resources.ts` è
associato a variabili d'ambiente denominate in base a esso. I nomi di base sono riportati di seguito;
una risorsa non predefinita aggiunge `__` e la propria chiave in lettere maiuscole, per cui un bucket
denominato `media` leggerà `S3_BUCKET__MEDIA`. `rebase status` stampa, per ciascuna risorsa,
la variabile esatta che viene letta e se risulta configurata o meno.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Pacchetto npm che implementa il driver della sorgente dati, se diverso da quello PostgreSQL predefinito. Con suffisso per sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Stringa di connessione per un topic dichiarato. Con suffisso per topic. | — |

### L'ambiente della CLI

Lette da `rebase`, non dal server. Nessuna di queste voci influisce su un deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Endpoint a cui i comandi `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, impostabile nella shell o in `.env`. Impostarlo quando il server viene eseguito con modalità diverse da `rebase dev` in questo progetto: `rebase start`, container, host remoto. Se non impostata, viene utilizzato l'indirizzo registrato da `rebase dev` durante l'esecuzione del server, senza inviare nulla se non attivo. | — |
| `REBASE_SERVICE_KEY` | Service key con cui si autenticano tali comandi, letta da `.env`: la stessa variabile letta dal server (vedere sopra). | — |
| `SERVICE_KEY` | Denominazione precedente di tale chiave. Se presente in `.env`, `rebase api-keys` e `rebase storage` la leggono in sostituzione di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | File `.env` letto e modificato dalla CLI, qualora sia diverso da quello predefinito del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole di progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile se i file per gli agenti vengono gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Account con cui `rebase cloud login` esegue l'accesso, evitando la richiesta interattiva. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, consentendo a un gestore di segreti di trasmetterla senza esporla nella cronologia della shell. | — |
| `REBASE_TOKEN` | Token generato con `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica con esso anziché con la sessione di `rebase cloud login`, senza leggere né scrivere la sessione memorizzata. In una directory collegata con `rebase cloud init --claim`, viene ignorato a favore del token specifico del progetto se non dispone dei permessi sul progetto stesso. Metodo consigliato per eseguire `rebase cloud` in CI — vedere [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI avviata dai suoi tool cloud e non lo invia mai all'app: a tale scopo utilizzare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` visualizza i dettagli dell'errore e della richiesta sottostanti al posto del messaggio sintetico. Il primo parametro da attivare se un comando `rebase cloud` fallisce senza informazioni utili. | — |
| `REBASE_ATLAS_DEV_URL` | Database vuoto su cui `rebase db push`, `db generate` e `db migrate` pianificano le modifiche, in alternativa a `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina il database indicato qui, e ne rifiuta uno equivalente a `DATABASE_URL`. Nel database di sviluppo gestito, la CLI lo imposta su un'istanza PGlite temporanea in memoria interna. Configurare questo valore negli ambienti in cui non è concesso il privilegio `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue il provisioning — richiede un'istanza fornita dall'utente. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server frontend, altrimenti derivata automaticamente da `rebase dev` in base al percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa in ms di `rebase dev` per la risposta del backend prima di segnalare la mancata inizializzazione. `0` disattiva la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | Password inserita da `rebase dev --docker` nella stringa di connessione derivata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione trasversale tra vari strumenti. Qualsiasi valore diverso da `0` disattiva l'invio della telemetria da parte della CLI. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente, specifico per Rebase. Non richiede un file di configurazione, risultando ideale per l'impiego in CI e nei container. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destinazione a cui inviare la telemetria, per collettori self-hosted. | — |

## Secret in sviluppo

`JWT_SECRET` è obbligatoria in produzione. Sia essa che `REBASE_SERVICE_KEY` vengono
generate automaticamente al di fuori della produzione, consentendo di iniziare senza configurazioni preliminari.

I valori generati vengono salvati nella cache in `.rebase-dev-secrets.json`, accanto a
`.rebase-dev-port` e `.rebase-dev-url` ed esclusi da git insieme a essi. In precedenza venivano
rigenerati a ogni avvio — comportando la disconnessione dall'applicazione e l'invalidazione
delle chiavi API appena create a ogni riavvio del dev server.

- Impostando una delle due variabili in modo esplicito verrà utilizzato il valore fornito; nulla verrà salvato in cache né letto.
- Per indicare una posizione differente per la cache, utilizzare `REBASE_DEV_SECRETS_FILE` — un percorso file, nonché l'unica variabile di questa sezione che si dovrebbe impostare intenzionalmente.
- Eliminando il file si effettua la rotazione di entrambi i segreti. L'avvio successivo ne genererà uno nuovo.
- Qualora il file non possa essere scritto — ad esempio all'interno di un container in sola lettura — il server si avvia ugualmente con un segreto effimero, esattamente come in passato.

In produzione, o sotto un test runner, nulla viene memorizzato nella cache. In produzione non
viene generato alcun segreto: un avvio privo di `JWT_SECRET` fallisce indicando la variabile mancante,
e tale comportamento rimane invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

L'oggetto `RebaseBackendConfig` passato a `initializeRebaseBackend()` offre il controllo programmatico:

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
senza `app`, `server` e `basePath` e con il parametro obbligatorio `provision`, consentono di creare un
backend che non gestisce traffico finché non viene montato: `createRebaseBackend`. Vedere
[Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta tutte le route API; pertanto, anche il client deve essere configurato di conseguenza —
altrimenti continuerà a effettuare richieste su `/api/...` ricevendo errori 404 per qualsiasi chiamata:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione eredita questa configurazione dal client fornito; non sono necessarie
altre modifiche. Se si costruisce un URL di richiesta manualmente, concatenarlo a partire dal client
anziché inserire `/api` nel codice:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Errore di autorizzazione nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, anche se la vista CMS a tabella carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL cambiando temporaneamente il ruolo del database per farlo corrispondere al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un sistema di autenticazione personalizzato in cui i ruoli esistono solo nelle tabelle del database e non corrispondono a ruoli PostgreSQL effettivi, il cambio di ruolo fallisce o mancano i relativi privilegi nel database. La visualizzazione tabellare del CMS viene eseguita con l'utente proprietario della connessione predefinita e bypassa questo controllo.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo forza Rebase a eseguire le query dell'Editor SQL con i privilegi del proprietario della connessione (solitamente un superuser/owner). L'Editor SQL indicherà quindi, sopra i risultati, che sono stati letti con i privilegi del proprietario della connessione e disabiliterà il relativo selettore di ruoli.

### Recupero dello schema nell'Editor SQL non riuscito (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'Editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornita al bootstrapper, o se `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Assicurarsi che `adminConnectionString` sia configurata durante l'inizializzazione del bootstrapper del backend:
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
