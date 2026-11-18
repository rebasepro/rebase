---
sourceHash: 807148298d75dcf8
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca qualcosa di obbligatorio o se un valore non è valido (un URL che non è un URL, una porta
> che non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come viene eseguito il backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di tutte le tabelle sottostanti. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })`, e può aggiungervi le proprie
> variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione a PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i relativi dati in `.rebase/`. Obbligatoria ovunque altrove. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **Su un database gestito, `sslmode=require` potrebbe non significare ciò che sembra.**
>
> Per `psql` e per ogni strumento basato su libpq, `require` significa "crittografato, certificato
> non verificato". Il driver Node su cui si basa Rebase lo interpreta come `verify-full`, quindi un
> database il cui certificato non è firmato da un'autorità pubblica — comune nei
> Postgres gestiti — rifiuta il runtime con `self-signed certificate`, mentre `psql`
> si connette con lo stesso URL. Il runtime e i comandi `rebase db` si arrestano con un
> messaggio che spiega questo comportamento.
>
> Scegliere una delle seguenti opzioni:
>
> - **`sslmode=no-verify`** — crittografato, non verificato: ciò che `require` significa per
>   libpq. È una sintassi specifica di node-postgres che libpq non possiede, pertanto `psql`, `pg_dump`
>   e Atlas la rifiutano con `invalid sslmode value: "no-verify"`. I comandi nativi di Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la passano a questi strumenti come
>   `sslmode=require`, funzionando quindi con l'URL così come configurato; per usare `psql`
>   manualmente, sostituire con `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificato rispetto al certificato
>   CA del provider. Uguale per ogni strumento.
>
> Anche `uselibpqcompat=true&sslmode=require`, suggerito dall'avviso stesso del driver Node,
> funziona per il runtime; i comandi di Rebase rimuovono `uselibpqcompat` prima di passare
> l'URL agli strumenti libpq, che altrimenti lo rifiuterebbero.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedere sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth di Google. Abilita "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostata nelle build di produzione.**
>
> In fase di sviluppo il frontend e il backend hanno origini separate, quindi il server
> di sviluppo inserisce questo valore. In produzione il backend di Rebase serve la SPA, quindi
> l'API corrisponde all'origine della pagina stessa e il client la risolve autonomamente in questo modo.
>
> Incorporare un URL assoluto in un bundle di produzione funziona fino al momento in cui un secondo
> hostname punta alla stessa applicazione: un dominio personalizzato caricherà la pagina da
> `example.com` ed effettuerà chiamate API verso `example.rebase.website`, operazione
> considerata cross-origin che farà fallire ogni richiesta preflight. Consentire l'origine in CORS
> **non** risolve il problema: il cookie di refresh è impostato su `SameSite=Lax` e non
> viene inviato cross-site; di conseguenza, gli errori in console sparirebbero ma l'autenticazione
> risulterebbe comunque compromessa. Se lasciata non impostata, qualsiasi dominio che punta all'applicazione
> funzionerà senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **esclusivamente dall'ambiente della shell** — un valore `PORT` in `.env` non viene letto in questo caso, poiché la porta viene risolta prima del caricamento del file — altrimenti associa una porta derivata dal percorso del progetto, consentendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la priorità su entrambi, e il banner di avvio indica il livello utilizzato. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'SQL associato a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita contiene i parametri associati — un'email, un hash di password. Impostare su `true` durante la diagnosi di errori relativi a DDL, RLS o change-capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco di origini consentite separate da virgola. **Obbligatoria in produzione** a meno che non sia impostata `FRONTEND_URL`: un avvio in produzione privo di entrambe rifiuterà di partire. In sviluppo viene *aggiunta a* localhost — vedere sotto. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzata come alternativa a CORS_ORIGINS in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e operazioni amministrative). Il database specificato non è quello che la console SQL considera corrente, né quello da cui un nuovo branch copia per impostazione predefinita: entrambi corrispondono al database su cui si trova la connessione dell'applicazione stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'Editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del DB non sono mappati). La console SQL di Studio indicherà quindi che le righe sono state lette come proprietario della connessione, mostrandone il nome e disabilitando il selettore di ruolo. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui questo server è in esecuzione. `rebase dev` lo imposta su un checkout [spostato su un branch](/docs/backend/branching/#cli-integration). Un server con questa variabile mantiene il registro dei branch su quel database e copia i nuovi branch da esso per impostazione predefinita, consentendo al pannello Branch di Studio di mostrare i branch del database principale. | — |

#### CORS in sviluppo

In fase di sviluppo sono consentiti **localhost e i domini specificati in `CORS_ORIGINS` (o `FRONTEND_URL`)** —
lo stesso elenco utilizzato in produzione, con l'aggiunta di localhost anziché la sua
sostituzione. La variabile funziona quindi nello stesso modo in entrambi gli ambienti, e i
casi che la richiedono in sviluppo sono quelli consueti:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non corrisponde a localhost né a quelle in elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con l'esatta riga necessaria per autorizzarla. Il rifiuto
non è una semplice misura di cautela: l'API invia credenziali, pertanto restituire un
header `Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate verso il server di sviluppo sfruttando la sua sessione e leggendone le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Segreto per la firma dei JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare i token di accesso in modo asimmetrico (RS256), consentendo a qualsiasi entità in possesso del JWKS di verificare una sessione senza poterla generare. Accetta un PEM con ritorni a capo effettivi, con caratteri di escape `\n` o l'intero PEM codificato in base64. Senza di essa, i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificarlo a ogni cambio di chiave — la rotazione richiede che la vecchia e la nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. Scorrevole (sliding) — ogni rotazione la rinnova, determinando quindi quanto a lungo una sessione resiste all'**inattività**. Impostare `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser pongono lì il limite per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi indipendentemente da questa impostazione — una tabella utenti vuota deve consentire l'accesso a qualcuno, che diventerà l'amministratore. In produzione (`NODE_ENV=production`) questa finestra è chiusa: una tabella vuota rifiuta la registrazione iniziale con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un account ordinario e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` di seguito o assegnato con la service key. Il file `.env.example` dello scaffold la imposta su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di emergenza (kill switch). Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, disabilitando la registrazione anche a fronte di un database vuoto. Da associare a `REBASE_ADMIN_EMAIL` di seguito, altrimenti il deployment non avrà modo di produrre il primo utente autenticato. Ogni artefatto di deployment distribuito la imposta. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il proprio amministratore: l'operatore specifica il primo account invece di rischiare una race condition con utenti esterni. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Minimo 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa tutti i segreti TOTP archiviati. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e all'avvio viene generato un avviso — pertanto la rotazione di `JWT_SECRET` disconnette tutti gli utenti *e* rende indecifrabili tutti gli autenticatori registrati. Impostare una chiave dedicata (oltre 32 caratteri casuali) prima della registrazione degli utenti. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave precedente in fase di rotazione. Impostarle entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che gli utenti restino bloccati fuori dal proprio account durante la procedura. Rimuoverla dopo la ridecifratura/ricrittografia di ogni segreto. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Opzionale (opt-in) e deliberatamente non vincolato da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Impostare su `false` per una superficie di lettura completamente pubblica — la RLS rimane comunque attiva. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato quando non ne viene fornito alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato ai soli chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente individuato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato unicamente a frontend effettivamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Secure per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per HTTP non cifrato — utile per deployment su indirizzi LAN in cui il browser altrimenti scarterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza alcun errore. Genera un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID OAuth di Google (convalida backend) | — |
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
| `GITLAB_CLIENT_ID` | Client ID OAuth di GitLab. Il parametro `baseUrl` di un'istanza self-hosted non ha una corrispondente variabile d'ambiente — configurare GitLab nel blocco `auth` per questo scopo. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | Client ID OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | Client ID OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | Client ID OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | Apple Services ID per l'accesso web. È pubblico e viene esposto in `GET /auth/config`. Apple non dispone di un client secret statico, poiché Rebase firma un JWT ES256 a breve durata per ciascuno scambio di token. Di conseguenza, Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o a `APPLE_BUNDLE_IDS`, e non configura nulla in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgola dei bundle ID delle app native iOS/macOS i cui codici di "Accedi con Apple" sono accettati. | — |
| `APPLE_TEAM_ID` | Team ID Apple Developer, l'emittente (issuer) del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata presso Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file di chiave privata `.p8`, inclusi i ritorni a capo (sono accettati i caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API statica di amministrazione. Bypassa la consueta autenticazione JWT per chiamate server-to-server se passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La chiave pubblica della piattaforma di hosting (PEM, EC P-256) rispetto alla quale vengono verificati i token di piattaforma `rpt_`; più blocchi PEM durante una rotazione delle chiavi. La piattaforma la imposta al deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE` consente al gate di amministrazione di accettare un token di piattaforma per `cron:read` e per nient'altro. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID di progetto a cui deve corrispondere il claim `aud` del token di piattaforma, in modo da rifiutare i token generati per altri progetti. Se viene impostata solo una delle due variabili, il server si avvia, registra un avviso e risponde a ogni token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destinazione del pulsante **Continue with Rebase Cloud** del pannello di amministrazione: la pagina del progetto nella console della piattaforma, che autentica i proprietari del progetto ed esegue il reindirizzamento. La piattaforma la imposta al deploy insieme alle due precedenti; in loro presenza, `POST /api/auth/platform-signin` accetta il token `auth:admin-signin` della piattaforma valido un minuto e avvia una sessione amministrativa. Senza di essa, l'accesso funziona comunque tramite **Open CMS** nella console, e la schermata di login si limita a spiegarlo. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione dei contatori di rate limit per le route di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per singolo processo) o `sql` (condiviso tra le repliche). Un processo non può determinare il numero delle proprie repliche, pertanto un deployment con più nodi deve specificarlo — tre repliche con il valore predefinito applicano un limite triplicato. Qualsiasi altro valore **impedisce l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso senza password tramite link (magic link). Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password con codice a sei cifre inviato via email. Stessi requisiti per l'email indicati sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta tramite magic link o codice email per un indirizzo non registrato crea l'account, purché le registrazioni siano aperte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Azione intrapresa in caso di riutilizzo di un refresh token oltre la finestra consentita: `reject` (rifiuta la richiesta, mantiene la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore impedisce l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma preventiva: nessun accesso con password consentito finché l'indirizzo non viene verificato. Richiede il servizio email; in sua assenza l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostata indica nessun captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio se `CAPTCHA_PROVIDER` è impostato. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgola delle route di autenticazione da proteggere (ad esempio `register,login`). Non impostata protegge il set predefinito del provider. | — |

### Storage

:::caution[Lo storage non dispone di sicurezza a livello di riga (RLS), pertanto richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. Lo storage a oggetti non ha un equivalente —
le chiavi condividono un unico namespace piatto — pertanto, con un bucket configurato e nessun modello di accesso,
il server **rifiuta l'avvio in produzione**. È necessario soddisfare il requisito con una sola delle seguenti opzioni:
un hook `storageAuthorize` esportato da `backend/storage.ts` (fornito di default nello scaffold),
`STORAGE_PUBLIC_READ` oppure `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene interpretato a partire dalla directory in cui è in esecuzione il server: la radice del progetto sotto `rebase dev`, `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — esclusivamente in presenza di un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali denominati accanto ad esso | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Al massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente denominata. Un valore che non sia un numero intero di byte rifiuta l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS (access key) | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS (secret key) | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza gli URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Solitamente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file della chiave del service account. Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce ogni oggetto a chiunque, senza token. Solo per bucket utilizzati a tutti gli effetti come CDN pubbliche. Uno dei tre modi per soddisfare il controllo di avvio sottostante. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare ogni oggetto. Denominata `INSECURE` nell'oggetto di configurazione per un motivo preciso: è giustificabile solo in applicazioni single-tenant in cui ogni account è autorizzato ad accedere a ogni file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache le varianti (rendition) di immagini generate (ridimensionamenti, conversioni di formato) invece di produrle a ogni richiesta. | `false` |

### Email (opzionale)
<span class="since-badge" data-since="0.34">Dalla 0.34</span> `MAGIC_LINK_URL`.

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita la connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato dell'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato in cima ai template email predefiniti. URL assoluto `http(s)` PNG o JPG — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostata, un'app ancora denominata `Rebase` riceve il logo Rebase, mentre un'app rinominata non ne riceve alcuno |
| `MAGIC_LINK_URL` | Punto di destinazione del magic link inviato via email. A un URL di base viene accodato `/auth/magic-link?token=…`; un URL contenente `{token}` rappresenta il link completo, utile per un frontend che non espone `/auth/magic-link`. Racchiuderlo tra virgolette in `.env`, dove un carattere `#` non quotato avvia un commento: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valore contenente un cancelletto o un percorso file privo di `{token}` genera un avviso all'avvio. Se non impostata, la base è `FRONTEND_URL` |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non tramite pooler). Richiesta da [Realtime](/docs/backend/realtime): `LISTEN`/`NOTIFY` non funziona attraverso un pooler di transazioni come PgBouncer e, in sua assenza, le notifiche delle modifiche vengono disabilitate con un avviso invece di andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) vi mantiene il proprio `LISTEN` di riattivazione. Valorizza `directConnectionString` dell'adattatore Postgres se non impostata. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un hot standby. Se punta a un altro server, le letture degli utenti autenticati (elenchi, singole righe, conteggi, aggregazioni) vengono servite da lì con la medesima sicurezza a livello di riga; scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sul primario. Un utente che ha appena eseguito una scrittura legge dal primario per un tempo pari a `REBASE_READ_STICKY_MS`, e tutti leggono dal primario se il ritardo (lag) della replica supera `REBASE_READ_MAX_LAG_MS` o in caso di errore. Valorizza `readConnectionString` dell'adattatore Postgres se non impostata; fino alla versione 0.28 inclusa, il pool della replica veniva aperto ma mai letto. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, tempo durante il quale le letture dello stesso utente vengono indirizzate al primario, in modo che un salvataggio seguito da un elenco mostri i dati aggiornati. Per istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Ritardo (lag) della replica oltre il quale ogni lettura viene indirizzata al primario. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa attraverso un pooler in modalità transazione come PgBouncer. Il pool non invia quindi `search_path` o `statement_timeout` alla connessione (il pooler li rifiuterebbe o li scarterebbe) e imposta entrambi all'interno di ogni transazione; l'avvio assegna al ruolo del database un `search_path` predefinito pari a `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatoria, e realtime, la riattivazione del job worker, la creazione degli indici, il branching e la console SQL la utilizzano tutti. Anche l'URL della replica viene considerato sottoposto a pooling. `DATABASE_POOLED__<KEY>` per un'altra origine dati. | — |
| `REBASE_DB_POOL_MAX` | Un tetto massimo per ogni pool nel processo, applicato indipendentemente dalla richiesta di ciascuno. Solo cifre numeriche: un valore non valido viene ignorato anziché serializzare silenziosamente le richieste del server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine server pubblicata.
Un progetto che ha eseguito l'eject gestisce invece queste decisioni all'interno del proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit programmato della row-level security](/docs/rls-check#running-it-on-a-schedule), che segnala le tabelle esposte prive di policy. Il progetto deve dichiarare `@rebasepro/rls-check` tra le proprie dipendenze: il runtime non include una copia e, in assenza del pacchetto, l'avvio viene rifiutato indicando il nome della dipendenza mancante. `false` disattiva la scansione su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Assegnarne uno specifico a ogni progetto su un cluster condiviso. Il database registra il ruolo con cui opera e un avvio configurato con un altro ruolo rifiuterà di partire finché non viene eseguito `rebase db request-role migrate`. Vedere [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo di richiesta e consente alla connessione di passare ad esso; `never` demanda entrambe le operazioni all'utente limitandosi a verificarne la presenza. | `auto` |
| `REBASE_RLS_GRANTS` | I privilegi concessi da Rebase al ruolo di richiesta: `schema` (tutte le tabelle negli schemi serviti, più i privilegi predefiniti), `managed` (solo le tabelle gestite) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe le policy permissive di Rebase al/ai ruolo/i di richiesta, in modo che altri ruoli che leggono le stesse tabelle non ne traggano beneficio. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` assegna le policy superabili solo dal contesto server o da un amministratore `TO public`, ed esegue gli amministratori con il ruolo di richiesta. Per impostazione predefinita sono `TO rebase_admin`, consentendo alle letture con ambito proprietario degli utenti autenticati di sfruttare l'indice del proprietario. Vedere [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base server-o-admin da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, consentendo alle policy scritte con `auth.uid()` di identificare il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio quando un altro login può passare al ruolo di richiesta: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso di base per tutte le route API. Il client deve essere configurato in modo corrispondente — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/amministrativi del bundle da questo processo. Disattivare quando c'è una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprime le risposte con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` abilita le [notifiche push](/docs/backend/push-notifications/): le route `/api/push`, la tabella `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La coppia di chiavi VAPID con cui vengono firmati i messaggi push. Al di fuori della produzione, se non impostata, viene generata una coppia salvata in `.rebase-dev-secrets.json`; in produzione le notifiche push restano disattivate senza di esse. | — |
| `REBASE_VAPID_SUBJECT` | Un indirizzo `mailto:` o un URL `https://` che i servizi push possono contattare. Il valore predefinito è l'origine di una `REBASE_PUBLIC_URL` in `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché rimuovere silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati (tri-state). Non impostata, in ogni ambiente: `/api/docs` viene servita ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, ciascuno con il documento delle sole tabelle a cui ha accesso, e non è presente alcuna Swagger UI. `true` pubblica l'intero documento a chiunque, con la Swagger **UI** disponibile su `/api/swagger` al di fuori della produzione (mai in produzione). `false` mantiene il documento riservato dietro l'accesso di amministrazione. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, in modo che i browser rifiutino l'HTTP non cifrato su tutti i sottodomini dell'host per sei mesi — inclusi host non serviti da questo processo. Attivare solo se ogni sottodominio del dominio è esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer a protezione di `/metrics`. Se non impostato, lascia l'endpoint accessibile a chiunque possa raggiungere la porta — accettabile su una rete privata, non su una pubblica, e i log di avvio lo segnalano. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni che il runtime può eseguire sullo schema delle tabelle all'avvio. `ensure` (predefinito ovunque, inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminarne o riscriverne alcuno. `none` non modifica lo schema delle tabelle dichiarate, ma le tabelle proprie del framework (auth, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disattiva anche queste. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio con `push`**. In un [deployment suddiviso](/docs/deployment/split-processes) esattamente un processo può eseguire il provisioning, pertanto ogni altro ruolo deve impostare `none` o rifiuterà l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` fa sì che il runtime non apporti alcuna modifica al database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, né all'avvio né successivamente, inclusi quelli propri del framework. Segnala invece per nome ciò che risulta mancante. Indicato per database modificabili solo dal proprio processo di gestione modifiche. Vedere [Quando solo il proprio processo di gestione modifiche può modificare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio se l'ultimo provisioning del database è stato effettuato a partire da un set di tabelle diverso da quello con cui è stato compilato questo processo. Se non impostata (o con valori diversi da `true`/`1`), genera invece un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o cron genera un'eccezione o fallisce il parsing durante l'importazione, indicando ciascun file e la motivazione, in modo che un rolling deploy continui a servire la versione precedente. Anche un riavvio è soggetto a questo vincolo. Se non impostata (o con valori diversi da `true`), il file viene ignorato e il resto viene servito regolarmente. Un file importato senza errori che non esporta alcuna funzione o job viene sempre ignorato, mai rifiutato. | skip |
| `REALTIME_CDC` | Change capture a livello di database: `auto` (legge le modifiche dal WAL dove il database lo consente, altrimenti usa trigger, altrimenti ricorre al fallback a livello applicativo, registrando ogni fallback come info), `trigger` (ne forza l'uso, genera un avviso se impossibile), `wal` (legge le modifiche dal write-ahead log invece dei trigger; richiede `wal_level=logical` e un ruolo con permessi di replica, altrimenti ricade su `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha la priorità su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Meccanismo di trasporto tra istanze per i canali broadcast e presence: `memory` o `postgres`. Ignorato se `realtime.bus` è stato configurato con un trasporto personalizzato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; la successiva viene rifiutata con `TOO_MANY_SUBSCRIPTIONS`. Deve essere un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero di socket realtime che un utente, o una chiave API, può mantenere aperti su una singola istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore. La connessione successiva viene rifiutata con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK ritenta continuamente, riuscendo a connettersi non appena un altro socket si chiude. Deve essere un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa di una modifica prima del refetch che la distribuisce ai subscriber attivi, in ms. Un refetch attende 300 ms in assenza di modifiche, e al massimo questo intervallo in presenza di un flusso costante di scritture. Deve essere un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la priorità su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo di riutilizzo del totale per una sottoscrizione a elenchi di grandi dimensioni prima di un nuovo conteggio, in ms; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostata, ogni frame esegue il conteggio. Ha la priorità su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | Valore minimo dell'ultimo totale a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi più piccoli vengono conteggiati a ogni frame. Ha la priorità su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback sotto `NODE_ENV=production`. Disattivata per impostazione predefinita, così che un avvio in produzione fallisca in modo esplicito anziché connettersi a un database inesistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio dello schema ed esce senza aprire alcun socket — la modalità ideale per un Job di migrazione, utilizzando la stessa immagine e lo stesso bundle del server successivo. Crea inoltre le tabelle che un processo attivo creerebbe altrimenti al primo utilizzo e non avvia né cron né code di job. Un valore vuoto è considerato *non impostato*, evitando che una variabile `${SOMETHING}` non sostituita in un file compose trasformi un normale deployment in uno che esegue solo migrazioni e non serve traffico. Rifiutata se combinata con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un percorso di file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive tutte le modifiche allo schema apportate, in sequenza, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe scritte non sono incluse. Rifiutata su un processo attivo che serve richieste. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina — un agente, un job di CI — di *applicare* una modifica dello schema tramite `/api/admin/schema`, e non solo di pianificarla. Disattivata se non espressamente richiesta: la credenziale che applicherebbe tale modifica è quella che con maggiore probabilità risiede in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione di una funzione personalizzata prima dell'interruzione della richiesta. Stesso parametro dell'opzione `functionsTimeoutMs`. `0` disattiva il timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa terminare il processo in caso di unhandled promise rejection anziché limitarsi a registrarla nei log. Da attivare sotto un orchestratore in grado di riavviare l'istanza; da disattivare laddove un riavvio sia peggiore di un leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Disattiva l'avviso di avvio sulle piattaforme che il runtime rileva come scale-to-zero, in cui un timer che scatta in un'istanza inattiva finisce per non essere eseguito in nessuna istanza. Non modifica nient'altro: impostarlo quando si mantiene attiva almeno un'istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy anteposti al server, consentendo al rate limiter di estrarre il reale indirizzo del client da `X-Forwarded-For`. Valore di sicurezza predefinito `0`: in assenza di proxy, fare affidamento sull'header permetterebbe a qualunque chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non costituisce uno strumento di migrazione]
Il passaggio all'avvio viene eseguito senza supervisione e senza revisione di diff, pertanto non eliminerà mai
una colonna, non restringerà un tipo né riscriverà una tabella. Questo è anche il motivo per cui l'immagine rifiuta
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff e può eseguire senza problemi un
`DROP COLUMN`, e il riavvio di un container non deve mai poter distruggere una
colonna di produzione come effetto collaterale di una rischedulazione.

Le modifiche distruttive o strutturali rimangono confinate dove possono essere revisionate: `rebase db
generate` + `rebase db migrate`, oppure `rebase db push` da un checkout locale o da CI,
che simula la modifica (dry-run), rifiuta le operazioni distruttive in assenza di conferma e
può effettuare preventivamente un backup.
:::

### Deployment suddivisi

Una singola immagine e un unico bundle possono essere avviati più volte, ognuno servendo una
parte diversa del progetto. Qui vengono descritti brevemente per completezza d'elenco; cosa
ciascuna combinazione *monta e gestisce* — e quali combinazioni rifiutano l'avvio — è documentato
in **[Processi suddivisi](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Quale componente viene servito da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron su *questo* processo. Se non impostata, segue il ruolo configurato. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job su questo processo. Se non impostata, segue il ruolo configurato. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve esclusivamente le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve tutte le funzioni personalizzate ad eccezione di quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a cui il processo API inoltra le richieste per le funzioni che non gestisce direttamente. Su un `worker`, indica dove indirizzare le proprie chiamate `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint opzionale (opt-in) Model Context Protocol su `/mcp`, che consente a un client AI di leggere
e scrivere su questo progetto **come utente autenticato**. Disattivato se non impostato e — a differenza di
ogni altra superficie — nessun `REBASE_ROLE` lo abilita automaticamente: gli altri ruoli definiscono la struttura
di un processo, mentre questa è una scelta consapevole di condividere credenziali con software di terze parti,
e deve essere presa da una persona anziché ereditata dal ruolo di un container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Abilita la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza la superficie non viene montata e lo segnala nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine raggiungibile dall'esterno di questo deployment, es. `https://app.example.com`. La superficie MCP non può dedurla autonomamente — ricavare l'origine dall'header `Host` renderebbe l'identità dell'emittente e l'audience rispetto a cui vengono verificati i token un valore fornito dal chiamante. | — |
| `REBASE_MCP_VIEW` | Percorso della vista MCP App del progetto (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica, così da renderizzare viste, campi e azioni personalizzati. Senza di essa, il backend cerca accanto al frontend che serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere la preregistrazione dei client. | `true` |

### Modifica live dello schema da un bundle

Disattivata a meno che non sia impostata `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilato non dispone
dei sorgenti in `backend/schema` da modificare, quindi con queste variabili configurate l'editor di schema legge
il sorgente dal repository, esegue il commit di ciascuna modifica ed esegue il relativo DDL su
questo database. Riservato agli amministratori e applicato manualmente da una persona, salvo diversa
indicazione di `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`. Un repository configurato senza credenziali
utilizzabili impedisce l'avvio. Vedere
[Modifica live dello schema](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub in cui effettuare il commit delle modifiche allo schema, nel formato `owner/name`. La sua impostazione abilita la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene effettuato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione di `backend/schema` in quel repository, relativa alla radice del repo. Un percorso che punta all'esterno del repository impedisce l'avvio, così come l'ormai obsoleta `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token fine-grained con permessi di lettura e scrittura sui contenuti del repository. Impostare questa variabile o le tre variabili `_GITHUB_APP_*`, ma non entrambe. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per effettuare il commit come app anziché tramite token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'ID di installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata dell'app: PEM, PEM con ritorni a capo con escape, o in formato base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatoria insieme a `BACKUP_SCHEDULE`, che non viene eseguito in sua assenza. `rebase db backup` ripiega su `./backups` nel percorso in cui è stato eseguito. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostata o pari a `0`, mantiene tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno N tra i backup più recenti, indipendentemente dalla retention impostata. | — |
| `PG_DUMP_PATH` | Esegue l'override del binario `pg_dump` — deve corrispondere alla major version del server o a una più recente. | — |
| `PG_RESTORE_PATH` | Esegue l'override del binario `pg_restore`. | — |
| `PSQL_PATH` | Esegue l'override del binario `psql` eseguito da `rebase db restore --clean` per rendere il ripristino un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione di `pg_dumpall`, se non presente nel `PATH`. In sua assenza — e senza i tool client di PostgreSQL installati — un backup dei globals fallisce con un errore che indica questa variabile. | — |

L'immagine di runtime ufficiale (`rebasepro/server`) include gli strumenti client di PostgreSQL 18,
pertanto un backup pianificato eseguito al suo interno funziona con qualsiasi server fino a Postgres 18.
Al di fuori dell'immagine, è necessario installarli autonomamente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione privata con
crittografia a riposo (encryption-at-rest).

### Distribuzione del bundle

Un deployment gestito non include il codice nell'immagine: il runtime recupera un
bundle all'avvio. Queste variabili definiscono quale recuperare e con quali modalità.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una directory di bundle già estratta. Quello che `rebase start` imposta localmente. | — |
| `REBASE_BUNDLE_URL` | Posizione da cui scaricare l'archivio del bundle, quando non è presente uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | La credenziale Bearer per il download. Trattarla come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto il bundle scaricato. Deve essere scrivibile e persistere tra il download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi che l'immagine di runtime fornisce al bundle, oltre a quelli dichiarati autonomamente. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `backend/resources.ts` viene
associato tramite variabili d'ambiente denominate in base ad esso. I nomi di base sono indicati di seguito;
una risorsa non predefinita aggiunge `__` seguito dalla propria chiave in lettere maiuscole, quindi un bucket denominato
`media` leggerà `S3_BUCKET__MEDIA`. `rebase status` stampa, per ogni risorsa,
l'esatta variabile letta e se risulta impostata.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di un'origine dati, se diverso da quello Postgres predefinito. Con suffisso per risorsa: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Con suffisso per topic. | — |

### Ambiente specifico della CLI

Letto da `rebase`, non dal server. Nessun parametro qui presente influisce su un deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Destinazione a cui `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, nella shell o in `.env`. Impostarla quando il server viene eseguito con modalità diverse da `rebase dev` in questo progetto: `rebase start`, un container, un altro host. Se non impostata, utilizzano il server registrato da `rebase dev` durante la sua esecuzione, e non inviano nulla quando non è attivo. | — |
| `REBASE_SERVICE_KEY` | La service key con cui tali comandi si autenticano, letta da `.env`: la medesima variabile letta dal server (vedere sopra). | — |
| `SERVICE_KEY` | Denominazione precedente per tale chiave. Quando impostata in `.env`, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quale file `.env` la CLI legge e scrive, se diverso da quello del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole del progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile se tali file vengono gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` effettua l'accesso, senza richiedere l'input interattivo. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, consentendo a un gestore di segreti di fornirla senza che compaia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token generato da `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica tramite esso anziché con la sessione di `rebase cloud login`, senza leggere o modificare la sessione memorizzata. In una directory collegata tramite `rebase cloud init --claim`, viene accantonato a favore del token specifico del progetto se privo di permessi (scope) su di esso. È la modalità consigliata per eseguire `rebase cloud` in CI — vedere [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI avviata dai propri cloud tool e non lo invia mai all'app: per tale scopo impostare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e i dettagli della richiesta invece del messaggio breve. La prima variabile da impostare quando un comando `rebase cloud` fallisce senza fornire dettagli utili. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto rispetto al quale `rebase db push`, `db generate` e `db migrate` calcolano il piano, invece del database `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina alcun database specificato qui, e rifiuta un valore identico a `DATABASE_URL`. Nel database di sviluppo gestito, la CLI lo imposta su un'istanza PGlite in memoria temporanea. Da impostare nei contesti in cui il privilegio `CREATE DATABASE` non è concesso. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue il provisioning — è necessario fornirne uno proprio. Equivale a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del server di sviluppo frontend, che altrimenti `rebase dev` deduce dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa di `rebase dev` per la notifica di avvio del backend prima di segnalare la mancata partenza. `0` disattiva la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password inserita da `rebase dev --docker` nella stringa di connessione ricavata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convenzione standard comune a più tool. Impostata su qualsiasi valore diverso da `0`, impedisce l'invio della telemetria da parte della CLI. | — |
| `REBASE_TELEMETRY_DISABLED` | Lo stesso parametro, specifico per Rebase. Non richiede alcun file, motivo per cui è l'opzione da utilizzare in CI e all'interno delle immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destinazione a cui viene inviata la telemetria, per collettori self-hosted. | — |

## Segreti in sviluppo

`JWT_SECRET` è obbligatoria in produzione. Essa e `REBASE_SERVICE_KEY` vengono
generate automaticamente al di fuori della produzione, consentendo di iniziare senza alcuna configurazione preliminare.

Questi valori generati vengono salvati nella cache in `.rebase-dev-secrets.json`, accanto
a `.rebase-dev-port` e `.rebase-dev-url` e inclusi nel gitignore insieme a essi. In precedenza venivano
rigenerati a ogni avvio — quindi il riavvio del server di sviluppo provocava il logout dall'applicazione
e invalidava qualsiasi chiave API appena creata.

- Impostando esplicitamente una delle due variabili viene utilizzato il valore fornito; nulla viene memorizzato nella cache o letto.
- È possibile puntare la cache altrove con `REBASE_DEV_SECRETS_FILE` — un percorso, nonché
  l'unica variabile di questa sezione che si imposterebbe intenzionalmente.
- Eliminare il file per ruotare entrambi i segreti. L'avvio successivo ne creerà uno nuovo.
- Se il file non può essere scritto — ad esempio in un container in sola lettura — il server si avvia
  comunque con un segreto effimero, esattamente come in precedenza.

Nulla viene memorizzato nella cache in produzione o sotto un test runner. In produzione non viene
generato alcun valore: un avvio senza `JWT_SECRET` fallisce, indicando il nome della variabile, e
questo comportamento è invariato:

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

Le medesime opzioni,
senza `app`, `server` e `basePath` e con il parametro obbligatorio `provision`, consentono di compilare un
backend che non serve traffico finché non viene montato: `createRebaseBackend`. Vedere
[Integrazione con server personalizzato](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta ogni route API, pertanto è necessario comunicare la stessa impostazione al client —
altrimenti continuerà a effettuare richieste a `/api/...` ricevendo un 404 per ciascuna di esse:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione ricava questo valore dal client fornito; non è necessaria
alcuna ulteriore configurazione. Se si compone un URL di richiesta manualmente, concatenarlo a partire
dal client anziché inserire `/api` a mano:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'Editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, sebbene la vista CMS a foglio di calcolo carichi i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL scambiando temporaneamente i ruoli del database in base al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli risiedono solo nelle tabelle del database anziché essere veri ruoli PostgreSQL, il cambio di ruolo fallisce o mancano i relativi privilegi nel database. La vista CMS a foglio di calcolo viene invece eseguita con l'utente proprietario della connessione predefinito, bypassando questo passaggio.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo forza Rebase a eseguire le query dell'Editor SQL con i privilegi del proprietario della connessione (in genere un superuser/owner). L'Editor SQL indicherà quindi, sopra i risultati, che sono stati letti con i privilegi del proprietario della connessione, disabilitando il selettore di ruolo.

### Recupero dello schema non riuscito nell'Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'Editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necessita di privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornita al bootstrapper o se `getAdmin()` viene sovrascritta per restituire `undefined`, queste operazioni falliscono.
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
