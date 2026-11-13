---
sourceHash: acc55c3c58895863
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutte le configurazioni vengono eseguite tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca qualcosa di obbligatorio o se un valore è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione in cui risiede lo schema dipende da come si esegue il backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di ogni tabella riportata di seguito. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })`, e può aggiungervi
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Opzionale in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i relativi dati in `.rebase/`. Obbligatoria in qualsiasi altro contesto. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi propria di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano: esegue la crittografia, ma non verifica il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la accettano e non
> degradano dolcemente: rifiutano l'avvio con `invalid sslmode value: "no-verify"`.
>
> I comandi proprietari di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima di invocare la shell,
> funzionando quindi con l'URL così come configurato. L'utilizzo manuale di `psql` non
> lo fa: in quel caso sostituirla con `sslmode=require`, che applica la crittografia senza
> verifica esattamente nello stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedere di seguito. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Abilita "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostata nelle build di produzione.**
>
> In fase di sviluppo il frontend e il backend hanno origini distinte, pertanto il dev
> server la inserisce. In produzione il backend Rebase serve la SPA, quindi
> l'API coincide con l'origine stessa della pagina e il client la risolve autonomamente in questo modo.
>
> Includere un URL assoluto in un bundle di produzione funziona finché un secondo
> hostname non punta alla stessa app: un dominio personalizzato caricherebbe a quel punto la pagina da
> `example.com` ed effettuerebbe chiamate API su `example.rebase.website`, operazione che è
> cross-origin, provocando il fallimento del preflight di ogni richiesta. Consentire l'origine in CORS
> **non** risolve il problema: il cookie di refresh è `SameSite=Lax` e non viene
> inviato cross-site, per cui si eliminerebbero gli errori in console ma l'autenticazione
> rimarrebbe comunque compromessa. Se non impostata, qualsiasi dominio che punti all'app funzionerà
> senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un valore `PORT` in `.env` non viene letto in tale contesto, poiché la porta viene risolta prima del caricamento di quel file — altrimenti associa una porta derivata dal percorso del progetto, consentendo l'esecuzione contemporanea di più progetti. `rebase dev --port` ha la precedenza su entrambi, e il banner di avvio indica il livello utilizzato. | `3001` |
| `LOG_LEVEL` | Verbosità dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra il codice SQL sottostante a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita include i parametri associati — un'email, un hash della password. Impostare su `true` durante la diagnosi di un errore DDL, RLS o di change-capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatorio in produzione** a meno che non sia impostato `FRONTEND_URL`: un avvio in produzione privo di entrambi rifiuterà di partire. In fase di sviluppo viene *aggiunto a* localhost — vedere di seguito. | — |
| `FRONTEND_URL` | URL dell'app frontend. Utilizzato in alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e le operazioni amministrative). Il database specificato non è quello che la console SQL considera corrente, né quello copiato per impostazione predefinita da un nuovo branch: entrambi corrispondono al database su cui si trova la connessione dell'app stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli DB non sono mappati). La console SQL di Studio indicherà a quel punto che le righe sono state lette come proprietario della connessione, indicandone il nome, e disabiliterà il selettore del ruolo. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui viene eseguito questo server. `rebase dev` lo imposta su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server con questa variabile mantiene il registro dei branch su quel database e copia i nuovi branch da esso per impostazione predefinita, consentendo al pannello Branches di Studio di mostrare i branch del database principale. | — |

#### CORS in sviluppo

Lo sviluppo consente **localhost, oltre a qualsiasi origine specificata da `CORS_ORIGINS` (o `FRONTEND_URL`)**
— lo stesso elenco utilizzato dalla produzione, con localhost aggiunto anziché
sostituito. Di conseguenza la variabile funziona nello stesso modo in entrambi gli ambienti, e i
casi che la richiedono in fase di sviluppo sono quelli consueti:

```bash
# Un telefono sulla LAN, la macchina di un collega, un tunnel ngrok,
# una porta inoltrata di Codespaces — tutte origini diverse da localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non sia né localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con l'esatta riga necessaria per consentirla. Il rifiuto non è
prudenza fine a se stessa: l'API trasmette credenziali, pertanto restituire un
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate verso il dev server con la sua sessione e leggerne le
risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Segreto per la firma JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare i token di accesso in modo asimmetrico (RS256), affinché qualsiasi entità in possesso del JWKS possa verificare una sessione senza poterla generare. Accetta un PEM con newline reali, un PEM con caratteri di escape `\n`, o l'intero PEM in base64. In sua assenza, i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificarlo ogni volta che la chiave cambia: la rotazione richiede che la vecchia e la nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. Scorrevole — ogni rotazione la rinnova, determinando quindi per quanto tempo una sessione sopravvive all'**inattività**. Impostare `400d` per sessioni destinate a superare lunghe assenze; i browser pongono qui il limite massimo per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente ai nuovi utenti di registrarsi (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi, indipendentemente da questo valore — una tabella utenti vuota deve pur ammettere qualcuno, e tale utente diventa l'amministratore. In produzione (`NODE_ENV=production`) tale finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, il primo account creato tramite registrazione aperta è un account ordinario, e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` di seguito o assegnato con la chiave di servizio. Il file `.env.example` generato dallo scaffold la imposta su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di emergenza (kill switch). Chiude la finestra di bootstrap per il primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, in modo che la registrazione sia bloccata anche su un database vuoto. Associare a `REBASE_ADMIN_EMAIL` di seguito, altrimenti il deployment non avrà modo di generare il suo primo utente autenticato. Ogni artefatto di deployment rilasciato la imposta. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. Questo è il modo in cui una distribuzione in produzione ottiene il proprio amministratore: l'operatore assegna il primo account invece di lasciare che chiunque su internet provi a crearlo per primo. L'avvio emette un avviso quando la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP archiviato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e l'avvio emette un avviso — pertanto la rotazione di `JWT_SECRET` disconnetterà tutti gli utenti *e* renderà indecifrabili tutti gli autenticatori registrati. Impostare una chiave dedicata (32+ caratteri casuali) prima che chiunque effettui la registrazione. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta eseguendo la rotazione (*precedente*). Impostarle entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che qualcuno rimanga bloccato fuori dal proprio account durante la procedura. Rimuoverla dopo che tutti i segreti sono stati ricifrati. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, deliberatamente slegata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Impostare su `false` per una superficie di lettura interamente pubblica — RLS rimane comunque attiva. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato quando non ne viene fornito alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Attiva l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimo (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato esclusivamente a chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è riservato a frontend effettivamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sul cookie di refresh. Sicuro per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per connessioni in semplice HTTP — ad esempio un deployment su un indirizzo LAN in cui il browser rifiuterebbe altrimenti il cookie e la sessione terminerebbe alla scadenza del token di accesso senza mostrare errori. Emette un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
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
| `GITLAB_CLIENT_ID` | ID client GitLab OAuth. Il `baseUrl` di un'istanza self-hosted non può essere configurato tramite variabili d'ambiente — a tale scopo configurare GitLab all'interno del blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret Spotify OAuth | — |
| `APPLE_CLIENT_ID` | ID dei servizi Apple per l'accesso web. È pubblico e viene reso disponibile in `GET /auth/config`. Apple non supporta un client secret statico, poiché Rebase firma un token JWT ES256 a breve durata per ciascuno scambio di token. Di conseguenza, Apple necessita di `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o a `APPLE_BUNDLE_IDS`, e non configura nulla in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | Bundle ID separati da virgole delle app native iOS/macOS i cui codici "Accedi con Apple" vengono accettati. | — |
| `APPLE_TEAM_ID` | ID del Team sviluppatore Apple, emittente (issuer) del token JWT. | — |
| `APPLE_KEY_ID` | ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi gli a capo (sono accettati caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API di amministrazione statica. Bypassa la normale autenticazione JWT per chiamate server-to-server quando passata come `Authorization: Bearer <key>`. (Generata automaticamente in fase di sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) utilizzata per verificare i token di piattaforma `rpt_`; supporta più blocchi PEM durante la rotazione delle chiavi. La piattaforma la imposta durante il deploy e non contiene informazioni segrete. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE`, consente al gate di amministrazione di accettare un token di piattaforma esclusivamente per `cron:read` e per nessun'altra operazione. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID di progetto a cui deve corrispondere l'attributo `aud` di un token di piattaforma, impedendo l'uso di un token generato per un altro progetto. Se viene impostata solo una delle due variabili, il server si avvia, registra un avviso e risponde a qualsiasi token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione dei contatori di rate limit per l'autenticazione: `memory` (per processo) o `sql` (condivisa tra repliche). Poiché un processo non può rilevare il proprio numero di repliche, una distribuzione con più nodi deve specificarlo esplicitamente — tre repliche con l'impostazione predefinita applicherebbero il triplo del limite. Qualsiasi altro valore **impedisce l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso senza password tramite link (magic link). Richiede la configurazione di un servizio email, altrimenti il link non potrà essere inviato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password con codice a sei cifre inviato via email. Stessi requisiti per l'email indicati sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic link o codice email per un indirizzo non registrato crea l'account, purché la registrazione sia aperta. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento da adottare quando un token di refresh viene riutilizzato oltre la finestra di riutilizzo: `reject` (rifiuta la richiesta, mantiene la sessione) o `revoke-session` (termina la sessione di accesso). Qualsiasi altro valore impedisce l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma obbligatoria: nessun accesso tramite password finché l'indirizzo non viene verificato. Richiede la configurazione dell'email; in caso contrario l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica tramite captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Se non impostata, il captcha non viene utilizzato. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio una volta impostato `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Route di autenticazione separate da virgole da proteggere (ad esempio `register,login`). Se non impostata, protegge il set predefinito del provider. | — |

### Storage

:::caution[Lo storage non dispone di row-level security, pertanto richiede un modello di accesso]
Le tabelle sono protette da Postgres RLS. L'object storage non ha un equivalente —
le chiavi condividono un unico namespace piatto — pertanto, in presenza di un bucket configurato e
in assenza di un modello di accesso, il server **rifiuta l'avvio in produzione**. È possibile
soddisfare questo requisito con uno e uno solo dei seguenti metodi:
un hook `storageAuthorize` esportato da `backend/storage.ts` (fornito di default
nello scaffold), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene interpretato a partire dalla directory in cui è in esecuzione il server: la radice del progetto con `rebase dev`, `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — esclusivamente in presenza di un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali nominati adiacenti | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima dei file accettata dall'origine, in byte, su tutti i percorsi di caricamento — `__<KEY>` per un'origine nominata. Un valore non intero in byte impedisce l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza gli URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Solitamente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file della chiave dell'account di servizio. Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Serve ogni oggetto a chiunque, senza token. Da utilizzare esclusivamente per bucket che fungono effettivamente da CDN pubblica. Uno dei tre modi per soddisfare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Denominata `INSECURE` nell'oggetto di configurazione per un motivo preciso: è giustificabile solo in app single-tenant in cui ogni account è considerato attendibile per ogni file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache le varianti (rendition) delle immagini generate (ridimensionamenti, conversioni di formato) invece di produrle per ogni singola richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato per l'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo visualizzato in cima ai template email predefiniti. URL PNG o JPG `http(s)` assoluto — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostata, un'app ancora denominata `Rebase` mostrerà il marchio Rebase, mentre un'app rinominata non mostrerà alcun logo |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per stabilire una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non inclusa nel pool). [Realtime](/docs/backend/realtime) ne necessita: `LISTEN`/`NOTIFY` non funziona attraverso un connection pooler basato sulle transazioni come PgBouncer; senza di essa, le notifiche di modifica vengono disabilitate con un avviso invece di andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) vi mantiene il proprio `LISTEN` di riattivazione. Valorizza il campo `directConnectionString` dell'adapter Postgres quando questo non è impostato. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un hot standby. Quando indica un altro server, le letture autenticate (elenchi, singole righe, conteggi, aggregati) vengono servite su di esso applicando la medesima row-level security; scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sull'istanza primaria. Un client che ha appena eseguito una scrittura leggerà dall'istanza primaria per la durata di `REBASE_READ_STICKY_MS`, e tutti i client faranno lo stesso se la replica presenta un ritardo superiore a `REBASE_READ_MAX_LAG_MS` o è in errore. Valorizza il parametro `readConnectionString` dell'adapter Postgres quando non configurato; fino alla versione 0.28 compresa, il pool della replica veniva aperto ma mai utilizzato per le letture. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, intervallo di tempo durante il quale le letture dello stesso utente vengono indirizzate all'istanza primaria, in modo che un'operazione di salvataggio seguita da una lettura dell'elenco mostri le modifiche appena salvate. Specificato per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Soglia di ritardo della replica (lag) oltre la quale tutte le letture vengono indirizzate all'istanza primaria. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa attraverso un pooler in modalità transazione come PgBouncer. Il pool non invia quindi `search_path` o `statement_timeout` alla connessione (il pooler li rifiuterebbe o li ignorerebbe) e li imposta all'interno di ogni transazione; l'avvio assegna al ruolo del database un `search_path` predefinito pari a `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatoria, e realtime, la riattivazione del job worker, la creazione degli indici, il branching e la console SQL la utilizzeranno tutti. Anche l'URL della replica viene considerato gestito tramite pooler. Utilizzare `DATABASE_POOLED__<KEY>` per un'altra origine dati. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo applicato a ogni pool del processo, indipendentemente da quanto richiesto da ciascuno di essi. Accetta solo cifre numeriche: un valore malformato viene ignorato anziché serializzare silenziosamente il server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine del server
pubblicata. Un progetto su cui è stato eseguito l'eject gestisce invece queste decisioni direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit programmato della row-level security](/docs/rls-check#running-it-on-a-schedule), che segnala le tabelle servite senza policy. Il progetto deve dichiarare `@rebasepro/rls-check` tra le sue dipendenze: il runtime non ne include alcuna copia e, in assenza del pacchetto, l'avvio viene rifiutato, indicandone il nome. `false` disabilita la scansione per questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Assegnarne uno dedicato a ciascun progetto all'interno di un cluster condiviso. Un database registra il ruolo con cui opera, e un avvio configurato per un altro ruolo rifiuterà di partire finché non viene eseguito `rebase db request-role migrate`. Vedere [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo per le richieste e consente alla connessione di passare ad esso; `never` lascia entrambi i passaggi all'utente e si limita a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | Permessi concessi da Rebase al ruolo delle richieste: `schema` (ogni tabella negli schemi serviti, più i privilegi predefiniti), `managed` (solo le tabelle servite) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe le policy permissive di Rebase ai soli ruoli delle richieste, in modo che altri ruoli che leggono le stesse tabelle non ne traggano beneficio. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` scrive le policy accessibili solo dal contesto del server o da un amministratore `TO public`, ed esegue gli amministratori con il ruolo delle richieste. Per impostazione predefinita sono definite `TO rebase_admin`, in modo che le letture con ambito proprietario degli utenti autenticati possano utilizzare l'indice del proprietario. Vedere [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base server-o-admin da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, consentendo alle policy scritte con `auth.uid()` di rilevare il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio nel caso in cui un altro login possa passare al ruolo delle richieste: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso di base per ogni route API. Il client deve essere configurato in modo identico — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/amministrativi del bundle da questo processo. Disattivare quando c'è una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprime le risposte tramite gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché rimuovere silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati (tri-state). <span class="since-badge" data-since="0.31">Dalla versione 0.31</span> Non impostata, in ogni ambiente: `/api/docs` viene servito ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, ciascuno con il documento relativo alle tabelle a essi descritte, senza Swagger UI. `true` pubblica l'intero documento a chiunque, con la Swagger **UI** su `/api/swagger` al di fuori della produzione (mai in produzione). `false` mantiene il documento protetto dietro l'autenticazione da amministratore. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, imponendo ai browser di rifiutare il traffico HTTP semplice su ogni sottodominio dell'host per sei mesi — inclusi host non serviti da questo processo. Attivare solo se ogni sottodominio del dominio utilizza esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a protezione di `/metrics`. Se non impostata, l'endpoint rimane aperto a chiunque possa raggiungere la porta — accettabile su una rete privata, non su una pubblica, come segnalato nei log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Cosa può fare il runtime allo schema delle tabelle all'avvio. `ensure` (il valore predefinito, ovunque — inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere elementi esistenti. `none` non modifica lo schema delle tabelle dichiarate, ma le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disattiva anche queste ultime. L'immagine pubblicata accetta solo queste due opzioni e **rifiuta l'avvio con `push`**. In un [deployment separato](/docs/deployment/split-processes) esattamente un processo può effettuare il provisioning, pertanto ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` fa sì che il runtime non modifichi nulla nel database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, né all'avvio né in seguito, inclusi quelli propri del framework. Segnala invece per nome gli elementi mancanti. Utile per database modificabili esclusivamente dal processo dedicato alle migrazioni. Vedere [Quando solo il processo di modifica può aggiornare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio se l'ultimo provisioning del database è stato eseguito a partire da un insieme di tabelle diverso da quello su cui è stato compilato questo processo. Se non impostata (o con qualsiasi valore diverso da `true`/`1`), emette un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o cron genera un errore o fallisce il parsing durante l'importazione, indicando ciascun file e la causa, in modo che un deploy progressivo continui a servire la versione precedente. Questo vincolo vale anche per i riavvii. Se non impostata (o con qualsiasi valore diverso da `true`), salta il file e serve i restanti. Un file che viene importato correttamente ma non esporta alcuna funzione o job viene sempre saltato, senza bloccare l'avvio. | skip |
| `REALTIME_CDC` | Cattura delle modifiche a livello di database (Change Data Capture): `auto` (abilita dove supportato dalla connessione, effettua fallback silenzioso altrimenti), `trigger` (la forza, emette un avviso se impossibile), `wal` (legge le modifiche dal write-ahead log invece dei trigger; richiede `wal_level=logical` e un ruolo abilitato alla replica, altrimenti effettua il fallback su `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha la precedenza su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Meccanismo di trasporto tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato quando a `realtime.bus` è stato assegnato un trasporto già istanziato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; le successive vengono rifiutate con `TOO_MANY_SUBSCRIPTIONS`. Numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di socket realtime che un utente, o una chiave API, può mantenere aperti su una singola istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore stesso. L'accesso del socket successivo viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK continua a ritentare la connessione, potendo accedere non appena un altro socket si chiude. Numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa per un refetch che invia le modifiche ai sottoscrittori attivi, in millisecondi. Un refetch attende per 300 ms senza modifiche, e al massimo questo intervallo in presenza di un flusso costante di scritture. Numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo di tempo entro cui il totale di una sottoscrizione a elenchi di grandi dimensioni può essere riutilizzato prima di essere ricalcolato, in ms; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostata, ogni frame ricalcola il totale. Ha la precedenza su `realtime.recountIntervalMs`. | Non impostata |
| `REALTIME_RECOUNT_MIN_ROWS` | Il valore minimo dell'ultimo conteggio totale a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi più piccoli vengono conteggiati su ogni frame. Ha la precedenza su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback quando `NODE_ENV=production`. Disattivata per impostazione predefinita, affinché un avvio in produzione fallisca esplicitamente anziché connettersi a un database inesistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue le operazioni sullo schema e termina senza aprire alcun socket — la configurazione tipica di un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server che lo segue. Crea inoltre le tabelle che un processo in esecuzione creerebbe altrimenti al primo utilizzo, e non avvia né cron né code di job. Un valore vuoto corrisponde a *non impostata*, impedendo a un `${SOMETHING}` non sostituito in un file compose di trasformare un normale deployment in uno che esegue migrazioni rifiutando di rispondere alle richieste. Rifiutata se combinata con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso di un file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive ogni modifica allo schema apportata, in ordine, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe scritte non sono incluse. Rifiutata su un processo attivo per servire traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a un sistema automatizzato — un agente, un job di CI — di *applicare* modifiche allo schema tramite `/api/admin/schema`, anziché limitarsi a pianificarle. Disattivata se non espressamente richiesta: le credenziali necessarie per tali modifiche sono quelle che più comunemente risiedono nelle variabili di una CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione di una funzione personalizzata prima che la richiesta venga interrotta. Corrisponde all'opzione `functionsTimeoutMs`. `0` disattiva il timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promise rejection non gestita termini il processo anziché limitarsi a registrarla nei log. Da attivare sotto un orchestratore configurato per il riavvio; disattivare nei contesti in cui un riavvio sia più dannoso di un leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silenzia l'avviso di avvio su piattaforme rilevate dal runtime come con scalabilità a zero (scale-to-zero), in cui un timer attivato in un'istanza inattiva non scatterebbe in nessuna istanza. Non modifica altri comportamenti: impostarla se si mantiene attiva almeno un'istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy presenti a monte di questo server, in modo che il rate limiter possa identificare il reale indirizzo del client leggendo `X-Forwarded-For`. Valore predefinito di sicurezza `0`: senza proxy, fidarsi dell'header consentirebbe a qualsiasi chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non costituisce uno strumento di migrazione]
Il passaggio all'avvio viene eseguito in modo automatico e non presidiato, senza che nessuno ne esamini il diff; pertanto non eliminerà mai una colonna, non restringerà un tipo né riscriverà una tabella. Per questo motivo l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff e può applicare liberamente un `DROP COLUMN`, mentre il riavvio di un container non deve mai rischiare di distruggere una colonna in produzione come effetto collaterale di una riprogrammazione (rescheduling).

Le modifiche distruttive o strutturali devono essere eseguite dove possono essere revisionate: `rebase db generate` + `rebase db migrate`, o `rebase db push` da locale o dalla CI, che esegue un dry-run delle modifiche, rifiuta quelle distruttive senza previa conferma e può generare preventivamente un backup.
:::

### Deployment separati

Una singola immagine e un singolo bundle possono essere avviati più volte, ciascuno a presidio di una specifica parte del progetto. Qui è riportata una riga riassuntiva per ciascuna variabile, poiché questa pagina elenca ogni opzione disponibile; per scoprire cosa *monta e gestisce* ciascuna combinazione — e quali combinazioni rifiutano l'avvio — consultare **[Processi separati](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Quale parte viene servita da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron per *questo* processo. Se non impostata, segue quanto previsto dal ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job per questo processo. Se non impostata, segue quanto previsto dal ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve unicamente le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve tutte le funzioni personalizzate tranne quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Indirizzo verso cui il processo API inoltra una richiesta per una funzione che non serve direttamente. Su un `worker`, corrisponde alla destinazione delle sue chiamate `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint Model Context Protocol opzionale disponibile su `/mcp`, che consente a un client AI di leggere e scrivere su questo progetto **come utente autenticato**. Disattivato se non specificato espressamente e — a differenza di ogni altra superficie — nessun valore di `REBASE_ROLE` lo attiva in automatico: gli altri ruoli definiscono la struttura di un processo, mentre questa opzione costituisce la scelta consapevole di affidare credenziali a software di terze parti, e tale decisione deve essere presa da una persona anziché essere ereditata dal ruolo assegnato a un container.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Attiva la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza la superficie rifiuta il montaggio e lo segnala nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine raggiungibile esternamente di questa distribuzione, ad es. `https://app.example.com`. La superficie MCP non è in grado di dedurla: ricavare l'origine dall'header `Host` farebbe sì che l'identità dell'emittente e l'audience di verifica dei token diventassero valori forniti dal chiamante. | — |
| `REBASE_MCP_VIEW` | Percorso della vista dell'app MCP personalizzata del progetto (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica per fare in modo che vengano renderizzate le viste, i campi e le azioni personalizzati definiti. In sua assenza, il backend esegue la ricerca accanto al frontend servito. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), consentendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere la pre-registrazione dei client. | `true` |

### Modifica live dello schema da un bundle

Disattivata se non è impostata `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilato non contiene il sorgente `backend/schema` da modificare; pertanto, impostando queste variabili, l'editor dello schema legge il sorgente dal repository, effettua il commit di ogni modifica e applica il relativo DDL su questo database. Riservato agli amministratori e applicato manualmente da una persona, a meno che `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` non stabilisca diversamente. Se viene specificato un repository senza credenziali valide, l'avvio viene rifiutato. Vedere [Modifica live dello schema](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare il commit delle modifiche allo schema, nel formato `owner/name`. L'impostazione di questa variabile attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene inviato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | <span class="since-badge" data-since="0.31">Dalla versione 0.31</span> La posizione di `backend/schema` all'interno di tale repository, relativa alla radice del repo. Un percorso che esca dal repository impedisce l'avvio, così come la variabile rimossa `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permessi granulari con accesso di lettura e scrittura ai contenuti del repository. Impostare questa opzione oppure le tre variabili `_GITHUB_APP_*`, non entrambe. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per effettuare i commit come app anziché tramite token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'ID di installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata dell'app: formato PEM, PEM con newline preceduti da escape, o stringa base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup programmati. Se non impostata, i backup programmati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale, o URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatorio insieme a `BACKUP_SCHEDULE`, che rifiuta di essere eseguito senza di esso. `rebase db backup` ripiega su `./backups` nel percorso in cui è stato eseguito. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostata o su `0`, conserva tutti i backup. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno N dei backup più recenti, indipendentemente dalla retention impostata. | — |
| `PG_DUMP_PATH` | Sovrascrive il binario `pg_dump` — deve corrispondere alla versione principale del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Sovrascrive il binario `pg_restore` | — |
| `PSQL_PATH` | Sovrascrive il binario `psql` eseguito da `rebase db restore --clean` per rendere il ripristino un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione in cui si trova `pg_dumpall`, quando non è presente nel `PATH`. In sua assenza — e senza i client tool di PostgreSQL installati — un backup dei globali fallisce restituendo un errore che menziona questa variabile. | — |

L'immagine runtime ufficiale (`rebasepro/server`) include i tool client di PostgreSQL 18,
pertanto un backup programmato eseguito al suo interno funziona su qualsiasi server fino a Postgres 18.
Al di fuori dell'immagine, è necessario installarli autonomamente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono informazioni riservate e dati personali (PII). Utilizzare una destinazione privata con
crittografia a riposo (encryption-at-rest).

### Distribuzione del bundle

Un deployment gestito non include il proprio codice all'interno dell'immagine: il runtime recupera un
bundle all'avvio. Queste opzioni definiscono quale bundle scaricare e in che modo.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso di una directory di bundle già estratta. Quello che `rebase start` imposta localmente. | — |
| `REBASE_BUNDLE_URL` | URL da cui recuperare l'archivio del bundle, in assenza di un archivio locale. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale bearer per il recupero del bundle. Trattarla come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto un bundle recuperato. Deve essere accessibile in scrittura e deve persistere tra la fase di recupero e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi forniti dall'immagine runtime al bundle, oltre a quelli dichiarati dal bundle stesso. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `backend/resources.ts` viene
associato tramite variabili d'ambiente denominate in base alla risorsa stessa. I nomi base sono riportati di seguito; una
risorsa non predefinita aggiunge `__` seguito dalla propria chiave in lettere maiuscole; ad esempio, un bucket denominato
`media` leggerà `S3_BUCKET__MEDIA`. Il comando `rebase status`
stampa, per ciascuna risorsa,
l'esatta variabile letta e se risulta impostata.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di un'origine dati, quando non si tratta di quello predefinito per Postgres. Presenta un suffisso per origine: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Presenta un suffisso per topic. | — |

### Ambiente proprio della CLI

Letto da `rebase`, non dal server. Nessuna di queste variabili influisce su un deployment.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Indirizzo a cui `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la chiave di servizio, nella shell o in `.env`. Impostarlo quando il server viene eseguito con modalità diverse da `rebase dev` in questo progetto: `rebase start`, un container, un altro host. Se non impostata, utilizzano il server registrato da `rebase dev` mentre tale server è in funzione, e non inviano nulla quando non lo è. | — |
| `REBASE_SERVICE_KEY` | La chiave di servizio con cui tali comandi si autenticano, letta da `.env`: la medesima variabile letta dal server (vedere sopra). | — |
| `SERVICE_KEY` | Una denominazione precedente per tale chiave. Quando è impostata in `.env`, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Il file `.env` letto e scritto dalla CLI, quando diverso da quello del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole del progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile nel caso in cui i file agent della root siano gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Il piano di controllo (control plane) con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` esegue l'accesso, evitando la richiesta interattiva. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, consentendo a un gestore di segreti di passarla senza che compaia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token generato tramite `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica con esso anziché con la sessione di `rebase cloud login`, senza mai leggere o scrivere la sessione memorizzata. In una directory collegata tramite `rebase cloud init --claim`, viene accantonato a favore del token specifico di quel progetto qualora non disponga di autorizzazioni (scope) sul progetto stesso. Rappresenta il metodo designato per eseguire `rebase cloud` in ambienti CI — vedere [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI avviata dai propri strumenti cloud, senza mai inviarlo all'app: per tale scopo impostare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e i dettagli della richiesta anziché il messaggio abbreviato. La prima variabile da impostare quando un comando `rebase cloud` fallisce senza fornire spiegazioni utili. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto rispetto al quale `rebase db push`, `db generate` e `db migrate` pianificano le modifiche, al posto del database `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina il database indicato qui, e rifiuta un database identico a `DATABASE_URL`. Nel database di sviluppo gestito, la CLI lo imposta su un'istanza PGlite temporanea in memoria interna. Impostarlo laddove il permesso `CREATE DATABASE` non sia concesso. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue alcun provisioning — dovrete fornirne uno autonomamente. Equivale all'opzione `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server frontend, che altrimenti `rebase dev` deduce dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo massimo di attesa di `rebase dev` per la notifica di avvio del backend prima di segnalare che non è partito. `0` disabilita la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password inserita da `rebase dev --docker` nella stringa di connessione dedotta da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione standard tra tool. Se impostata su un qualsiasi valore diverso da `0`, la CLI non invia dati di telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente alla precedente, specifica per Rebase. Non richiede alcun file, motivo per cui è quella consigliata per l'uso in CI e all'interno delle immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destinazione a cui inviare i dati di telemetria, per un collettore self-hosted. | — |

## Segreti in fase di sviluppo

`JWT_SECRET` è obbligatoria in produzione. Essa e `REBASE_SERVICE_KEY` vengono
generate automaticamente al di fuori della produzione, consentendo di iniziare senza dover configurare alcunché.

Questi valori generati vengono memorizzati nella cache all'interno di `.rebase-dev-secrets.json`, posizionato
accanto a `.rebase-dev-port` e `.rebase-dev-url` e ignorato da Git insieme a essi. In precedenza
venivano rigenerati a ogni avvio — provocando la disconnessione dalla propria applicazione a ogni riavvio
del dev server e invalidando qualsiasi chiave API appena creata.

- Se si imposta esplicitamente una delle due variabili, verrà utilizzato il valore fornito; nulla verrà salvato in cache o letto da essa.
- Per indirizzare la cache su una posizione diversa, utilizzare `REBASE_DEV_SECRETS_FILE` — un percorso, nonché
  l'unica variabile di questa sezione che si avrebbe motivo di impostare deliberatamente.
- Eliminare il file per effettuare la rotazione di entrambi i segreti. L'avvio successivo ne genererà uno nuovo.
- Se il file non può essere scritto — ad esempio all'interno di un container in sola lettura — il server si avvia
  comunque con un segreto effimero, esattamente come in passato.

Nulla viene memorizzato nella cache in produzione o durante l'esecuzione di test runner. In produzione non viene
generato alcun valore: un avvio senza `JWT_SECRET` fallisce, indicando il nome della variabile, e tale
comportamento rimane invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

L'oggetto `RebaseBackendConfig` passato a `initializeRebaseBackend()` consente il controllo programmatico:

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

Le medesime opzioni,
prive di `app`, `server` e `basePath` e con un parametro `provision` obbligatorio,
consentono di compilare un backend che non serve traffico finché non viene montato manualmente: `createRebaseBackend`. Vedere
[Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta ogni route API, pertanto anche il client deve essere configurato di conseguenza —
altrimenti continuerà a effettuare richieste a `/api/...` ricevendo un errore 404 per ciascuna di esse:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione rileva questa impostazione dal client a cui è collegato; non è richiesta
alcuna altra configurazione. Se si compone un URL di richiesta manualmente, concatenarlo a partire dal client
invece di scrivere `/api` nel codice:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, anche se la vista foglio di calcolo del CMS carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'editor SQL cambiando temporaneamente i ruoli del database in modo che corrispondano al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli risiedono unicamente nelle tabelle del database anziché essere veri ruoli PostgreSQL, il cambio di ruolo fallisce o i privilegi sul database risultano mancanti. La vista foglio di calcolo del CMS viene eseguita con l'utente proprietario della connessione predefinito e bypassa questo meccanismo.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo forza Rebase a eseguire le query dell'editor SQL utilizzando i privilegi del proprietario della connessione (in genere un superuser/owner). L'editor SQL indicherà a quel punto, sopra i risultati, che sono stati letti come proprietario della connessione e disabiliterà il relativo selettore di ruolo.

### Recupero dello schema fallito nell'editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'editor SQL restituisce l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
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
