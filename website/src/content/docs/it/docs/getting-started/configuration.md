---
sourceHash: cf61934167f91e79
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca un elemento obbligatorio o se è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica la variabile.
>
> La posizione dello schema dipende da come viene eseguito il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di ogni tabella riportata di seguito. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })`, e può aggiungervi
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione a PostgreSQL. **Opzionale in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i relativi dati in `.rebase/`. Obbligatoria in tutti gli altri casi. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizza una stringa casuale complessa (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in fase di sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi propria di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano — cifra, ma non verifica il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la accettano, e non
> effettuano un degrado controllato: rifiutano l'avvio con `invalid sslmode value: "no-verify"`.
>
> I comandi interni di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima di invocare i processi esterni,
> funzionando quindi con l'URL così come configurato. L'utilizzo manuale di `psql` non effettua
> questa riscrittura — sostituiscila con `sslmode=require`, che cifra senza verificare esattamente
> nello stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Imposta questa variabile solo in fase di sviluppo** — vedi sotto. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | ID client OAuth di Google. Abilita "Accedi con Google". | — |


> **Lascia `VITE_API_URL` non impostata nelle build di produzione.**
>
> In fase di sviluppo, il frontend e il backend hanno origini distinte, pertanto il server
> di sviluppo inietta questo valore. In produzione, il backend di Rebase serve la SPA, quindi
> l'API coincide con l'origine della pagina stessa e il client la risolve autonomamente in questo modo.
>
> L'inserimento di un URL assoluto in un bundle di produzione funziona finché un secondo
> hostname non punta alla medesima app: in tal caso un dominio personalizzato caricherà la pagina da
> `example.com` ed effettuerà chiamate all'API su `example.rebase.website`, operazione
> cross-origin per cui ogni richiesta fallirà la verifica preliminare (preflight). Consentire l'origine in CORS
> **non** risolve il problema — il cookie di refresh è impostato su `SameSite=Lax` e non
> viene inviato cross-site, con la conseguenza di eliminare gli errori in console lasciando comunque l'autenticazione
> non funzionante. Lasciando la variabile non impostata, qualsiasi dominio che punti all'app funzionerà
> senza richiedere alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **esclusivamente dall'ambiente shell** — un valore di `PORT` in `.env` non viene letto, poiché la porta viene risolta prima del caricamento di tale file — altrimenti associa una porta derivata dal percorso del progetto, permettendo l'esecuzione simultanea di più progetti. L'opzione `rebase dev --port` ha la precedenza su entrambe, e il banner di avvio indica il livello utilizzato. | `3001` |
| `LOG_LEVEL` | Verbosità dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'SQL associato a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita contiene i propri parametri vincolati — un'email, un hash di password. Impostala su `true` durante la diagnosi di errori relativi a DDL, RLS o change capture. Ignorata quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatoria in produzione** a meno che non sia impostata `FRONTEND_URL`: un avvio in produzione privo di entrambe rifiuta di partire. In sviluppo viene *aggiunta* a localhost — vedi sotto. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzata come alternativa a CORS_ORIGINS in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e le operazioni amministrative). Il database indicato non è quello considerato corrente dalla console SQL, né quello clonato di default da un nuovo branch: entrambi corrispondono al database a cui è collegata l'applicazione stessa (vedi `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'Editor SQL (utile per l'autenticazione personalizzata in cui i ruoli DB non sono mappati). La console SQL di Studio indicherà quindi che le righe sono state lette come proprietario della connessione, indicandone il nome e disabilitando il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui questo server è in esecuzione. `rebase dev` la imposta su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server con questa variabile mantiene il registro dei branch su tale database e copia i nuovi branch da esso per impostazione predefinita, consentendo al pannello Branches di Studio di mostrare i branch del database principale. | — |

#### CORS in fase di sviluppo

Lo sviluppo consente **localhost, oltre a qualunque origine specificata da `CORS_ORIGINS` (o `FRONTEND_URL`)**
— lo stesso elenco utilizzato in produzione, con l'aggiunta di localhost anziché la sua
sostituzione. Di conseguenza la variabile opera nello stesso modo in entrambi gli ambienti, e i
casi d'uso che la richiedono in sviluppo sono quelli tipici:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non sia né localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con l'esatta riga necessaria per consentirla. Il rifiuto non è
pura cautela fine a se stessa: l'API trasmette credenziali, pertanto riflettere un
`Origin` arbitrario consentirebbe a qualunque sito visitato dallo sviluppatore di effettuare richieste
autenticate verso il server di sviluppo con la sua sessione e leggerne le
risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Segreto per la firma dei JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), consentendo a chiunque possieda il JWKS di verificare una sessione senza poterla generare. Accetta un file PEM con newline effettivi, un PEM con caratteri di escape `\n`, o l'intero PEM in formato base64. In sua assenza i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificalo ogni volta che la chiave cambia: la rotazione richiede che la chiave precedente e quella nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. A scorrimento (sliding): ogni rotazione lo rinnova, determinando quindi quanto a lungo una sessione sopravvive all'**inattività**. Imposta `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser applicano questo limite massimo al cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consenti la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi indipendentemente da questa impostazione: una tabella utenti vuota deve pur ammettere qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) questa finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un normale account utente, e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` più sotto o assegnato con la chiave di servizio. Il file `.env.example` dello scaffold la imposta su `true`; il valore predefinito del framework è disattivato (`false`). | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di emergenza (kill switch). Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, impedendo la registrazione anche a fronte di un database vuoto. Associala a `REBASE_ADMIN_EMAIL` qui sotto, altrimenti il deployment non avrà alcun modo per generare il suo primo chiamante autenticato. Ogni artefatto di deployment distribuito la imposta. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella degli utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il suo amministratore: l'operatore definisce il primo account anziché rischiare una race condition con Internet. All'avvio viene emesso un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Minimo 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificala dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Cifra ciascun segreto TOTP archiviato. Se non impostata, i segreti vengono cifrati con `JWT_SECRET` e all'avvio viene emesso un avviso: la rotazione di `JWT_SECRET` disconnetterebbe quindi tutti gli utenti *e* renderebbe indecifrabili tutti gli autenticatori configurati. Imposta una chiave dedicata (almeno 32 caratteri casuali) prima che chiunque effettui la registrazione. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la rotazione (*away*). Impostale entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti restano leggibili, evitando che qualcuno rimanga bloccato fuori dal proprio account a metà rotazione. Rimuovila una volta che tutti i segreti sono stati ricifrati. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, volutamente non vincolata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiedi l'autenticazione per l'API dei dati. Imposta su `false` per un'interfaccia di lettura completamente pubblica — la RLS continuerà ad applicarsi. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato quando non ne viene fornito alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Attiva l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato ai chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato esclusivamente a frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Attivo per impostazione predefinita; usa `AUTH_COOKIE_SECURE=false` per connessioni http non cifrate — ad esempio un deployment su un indirizzo LAN dove il browser altrimenti scarterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza alcun errore. Emette un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | ID client OAuth di Google (convalida backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segreto client OAuth di Google | — |
| `GITHUB_CLIENT_ID` | ID client OAuth di GitHub | — |
| `GITHUB_CLIENT_SECRET` | Segreto client OAuth di GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID client OAuth di Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Segreto client OAuth di Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID client OAuth di LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Segreto client OAuth di LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID client OAuth di Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Segreto client OAuth di Facebook | — |
| `TWITTER_CLIENT_ID` | ID client OAuth di X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Segreto client OAuth di X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID client OAuth di Discord | — |
| `DISCORD_CLIENT_SECRET` | Segreto client OAuth di Discord | — |
| `GITLAB_CLIENT_ID` | ID client OAuth di GitLab. Il `baseUrl` di un'istanza self-hosted non ha una variabile d'ambiente dedicata — configura GitLab nel blocco `auth` a tale scopo. | — |
| `GITLAB_CLIENT_SECRET` | Segreto client OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID client OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segreto client OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | ID client OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Segreto client OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | ID client OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segreto client OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | ID Apple Services per l'accesso web. È pubblico e viene esposto in `GET /auth/config`. Apple non dispone di un segreto client statico, poiché Rebase firma un JWT ES256 di breve durata per ogni scambio di token. Di conseguenza, Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o ad `APPLE_BUNDLE_IDS`, e non configura nulla in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgole dei bundle ID delle app native iOS/macOS di cui vengono accettati i codici di Accedi con Apple. | — |
| `APPLE_TEAM_ID` | ID del team Apple Developer, l'issuer del JWT. | — |
| `APPLE_KEY_ID` | ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi gli a capo (sono accettati i caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API di amministrazione statica. Bypassa la normale autenticazione JWT per chiamate server-to-server quando passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) rispetto alla quale vengono verificati i token di piattaforma `rpt_`; blocchi PEM multipli durante una rotazione delle chiavi. La piattaforma la imposta al momento del deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE` consente al gate amministrativo di accettare un token di piattaforma per `cron:read` e per nient'altro. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID progetto a cui deve corrispondere il campo `aud` di un token di piattaforma, in modo da rifiutare i token generati per un altro progetto. Se è impostata solo una delle due variabili, il server si avvia, registra un avviso e risponde a ogni token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione in cui risiedono i contatori del rate limiting, per le route di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per processo) o `sql` (condiviso tra le repliche). Un processo non è in grado di rilevare il conteggio delle proprie repliche, pertanto una distribuzione con istanze multiple deve indicarlo esplicitamente — tre repliche con il valore predefinito applicheranno tre volte il limite. Qualsiasi altro valore **impedisce l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Attiva il flusso di accesso senza password tramite link (magic link). Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Attiva l'accesso senza password con un codice a sei cifre inviato via email. Stesso requisito per il servizio email menzionato sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic link o codice email per un indirizzo sconosciuto crea l'account, purché le registrazioni siano aperte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento da adottare quando un token di refresh viene riutilizzato dopo la sua finestra temporale di riuso: `reject` (rifiuta la richiesta, mantieni la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore interrompe l'avvio con errore. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma obbligatoria: nessun accesso con password consentito prima della verifica dell'indirizzo email. Richiede il servizio email; in caso contrario l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica tramite captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Se non impostata, il captcha è disattivato. | — |
| `CAPTCHA_SECRET` | Segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio una volta impostato `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgole delle route di autenticazione da proteggere (ad esempio `register,login`). Se non impostata, protegge il set predefinito del provider. | — |

### Archiviazione (Storage)

:::caution[Lo storage non supporta la sicurezza a livello di riga (RLS), pertanto richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. L'object storage non ha un equivalente —
le chiavi condividono un singolo namespace piatto — quindi, con un bucket configurato e nessun modello di accesso,
il server **rifiuta l'avvio in produzione**. Soddisfa questo requisito con esattamente uno dei seguenti elementi:
un hook `storageAuthorize` esportato da `backend/storage.ts` (incluso nello scaffold),
`STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene interpretato a partire dalla directory in cui gira il server: la radice del progetto con `rebase dev`, `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consenti lo storage locale in produzione — solo con un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali nominati accanto a esso | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente con nome. Un valore non intero rifiuta l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave di accesso segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza gli URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Solitamente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file della chiave dell'account di servizio (service account). Omettere su GCP, dove le credenziali sono fornite da Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Servi qualsiasi oggetto a chiunque, senza token. Solo per un bucket che funge effettivamente da CDN pubblica. Uno dei tre modi per soddisfare il controllo di avvio riportato sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi chiamante autenticato di leggere, scrivere, elencare ed eliminare ogni oggetto. Denominato `INSECURE` nell'oggetto di configurazione per un motivo preciso: è giustificabile solo in un'applicazione single-tenant in cui ogni account è ritenuto affidabile per qualunque file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache i rendering generati delle immagini (ridimensionamenti, conversioni di formato) invece di produrli per ogni richiesta. | `false` |

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
| `APP_NAME` | Nome del prodotto utilizzato negli oggetti e nei corpi delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo visualizzato in cima ai template email predefiniti. URL assoluto `http(s)` di un'immagine PNG o JPG — i client email rimuovono gli SVG e bloccano gli URI `data:`. Se non impostato, un'app ancora denominata `Rebase` riceve il logo Rebase, mentre un'app rinominata non ne riceve alcuno |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per ottenere una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pooler). [Realtime](/docs/backend/realtime) ne richiede una: `LISTEN`/`NOTIFY` non funziona attraverso un transaction pooler come PgBouncer e, in sua assenza, le notifiche di modifica vengono disabilitate con un avviso invece di andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene il suo `LISTEN` di riattivazione su di essa. Popola la proprietà `directConnectionString` dell'adattatore Postgres se non impostata. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un'istanza hot standby. Quando indica un altro server, le letture autenticate (elenchi, singole righe, conteggi, aggregazioni) vengono servite da esso applicando la stessa sicurezza a livello di riga (RLS); scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sul primario. Un utente che ha appena eseguito una scrittura leggerà dal primario per la durata di `REBASE_READ_STICKY_MS`, e tutti leggeranno dal primario qualora la replica sia in ritardo di oltre `REBASE_READ_MAX_LAG_MS` o presenti errori. Popola `readConnectionString` dell'adattatore Postgres se non impostata; fino alla versione 0.28 inclusa, il pool della replica veniva aperto ma mai utilizzato per la lettura. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, intervallo di tempo per cui le letture dello stesso utente vengono indirizzate al primario, assicurando che un salvataggio seguito da un elenco mostri il dato appena salvato. Per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Ritardo della replica oltre il quale ogni lettura viene instradata al server primario. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa attraverso un pooler in modalità transazione come PgBouncer. Il pool non invia quindi `search_path` o `statement_timeout` alla connessione (il pooler li rifiuterebbe o scarterebbe) e imposta entrambi all'interno di ciascuna transazione; all'avvio viene assegnato al ruolo del database un `search_path` predefinito pari a `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatoria, e il realtime, il risveglio del job worker, le creazioni di indici, il branching e la console SQL la utilizzano tutti. Anche l'URL della replica viene considerato con pooler. Usa `DATABASE_POOLED__<KEY>` per un'altra sorgente dati. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo applicato a ogni pool nel processo, indipendentemente da quanto richiesto da ciascuno di essi. Solo cifre numeriche: un valore malformato viene ignorato anziché serializzare silenziosamente le operazioni del server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine del server
pubblicata. Un progetto che ha eseguito l'eject gestisce queste decisioni
all'interno del proprio codice.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit della sicurezza a livello di riga (RLS)](/docs/rls-check#running-it-on-a-schedule) programmato, che segnala le tabelle servite prive di policy. Il progetto deve dichiarare `@rebasepro/rls-check` tra le sue dipendenze: il runtime non ne include una copia e, in assenza del pacchetto, l'avvio viene rifiutato specificandone il nome. `false` mantiene la scansione disattivata su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Assegna a ciascun progetto su un cluster condiviso un proprio ruolo dedicato. Il database registra il ruolo con cui opera, e un avvio configurato per un altro rifiuta di partire finché non viene eseguito `rebase db request-role migrate`. Vedi [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo per le richieste e consente alla connessione di passare a esso; `never` lascia entrambi i passaggi a tuo carico limitandosi a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | I permessi concessi da Rebase al ruolo delle richieste: `schema` (ogni tabella negli schemi serviti, più i privilegi predefiniti), `managed` (solo le tabelle servite) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe le policy permissive di Rebase al/ai ruolo/i delle richieste, di modo che gli altri ruoli che leggono le stesse tabelle non ne traggano beneficio. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` applica le policy a cui possono accedere solo il contesto del server o un amministratore con `TO public`, ed esegue gli amministratori con il ruolo delle richieste. Per impostazione predefinita sono `TO rebase_admin`, consentendo alle letture degli utenti autenticati limitate al proprietario di sfruttare l'indice del proprietario. Vedi [Richieste di amministrazione e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base per server o amministratore da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, così che le policy scritte con `auth.uid()` riconoscano il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio quando un altro login può passare al ruolo delle richieste: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso di base per tutte le route API. Al client deve essere comunicata la medesima impostazione — vedi [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/amministrativi del bundle da questo processo. Disattivalo se c'è una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprimi le risposte con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` attiva le [notifiche push](/docs/backend/push-notifications/): le route `/api/push`, la tabella `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Coppia di chiavi VAPID con cui vengono firmati i messaggi push. Al di fuori della produzione viene generata una coppia salvata in `.rebase-dev-secrets.json` se non impostata; in produzione le notifiche push restano disabilitate in loro assenza. | — |
| `REBASE_VAPID_SUBJECT` | Un indirizzo `mailto:` o un URL `https://` con cui i servizi push possono comunicare. Il valore predefinito è l'origine di un `REBASE_PUBLIC_URL` con schema `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore che non è un numero impedisce l'avvio anziché rimuovere silenziosamente il limite). `0` disabilita il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI. A tre stati. Se non impostata, in qualunque ambiente: `/api/docs` viene servito ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, ciascuno con il documento relativo alle sole tabelle descritte, e non è presente alcuna Swagger UI. `true` pubblica l'intero documento a tutti, con la Swagger **UI** su `/api/swagger` all'esterno della produzione (mai in produzione). `false` mantiene il documento protetto dal controllo di accesso amministrativo. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, in modo che i browser rifiutino le connessioni HTTP in chiaro su qualsiasi sottodominio dell'host per sei mesi — inclusi gli host non serviti da questo processo. Attivalo solo quando ogni sottodominio del dominio è esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` rifiuta l'avvio. Vedi [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a protezione di `/metrics`. Se non impostato, lascia l'endpoint accessibile a chiunque possa raggiungere la porta — accettabile su una rete privata, non su una pubblica, e i log di avvio lo segnalano. | — |
| `REBASE_MIGRATE_ON_BOOT` | Cosa può fare il runtime allo schema delle tabelle all'avvio. `ensure` (il valore predefinito, ovunque — inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminarne o riscriverne alcuno. `none` lascia inalterato lo schema delle tabelle dichiarate, ma le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disattiva anche queste ultime. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio con `push`**. In una [distribuzione frazionata](/docs/deployment/split-processes) esattamente un solo processo può eseguire il provisioning, pertanto ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` fa sì che il runtime non modifichi nulla nel database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, né all'avvio né in seguito, inclusi quelli interni del framework. Riporta invece per nome gli elementi mancanti. Utile per database modificabili esclusivamente dal proprio processo dedicato ai cambi di schema. Vedi [Quando solo il processo di modifica può alterare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio quando il database è stato inizializzato l'ultima volta a partire da un insieme di tabelle diverso da quello su cui è stato compilato questo processo. Se non impostata (o con qualsiasi valore diverso da `true`/`1`), emette un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o di cron genera un errore o non viene analizzato durante l'importazione, indicando ciascun file e la causa, in modo che un rolling deploy continui a servire la versione precedente. Anche il riavvio è soggetto a questo vincolo. Se non impostata (o con qualsiasi valore diverso da `true`), ignora il file ed esegue il resto. Un file importato correttamente che non esporta alcuna funzione o job viene sempre ignorato, non rifiutato. | skip |
| `REALTIME_CDC` | Cattura delle modifiche a livello di database: `auto` (legge le modifiche dal WAL dove consentito dal database, altrimenti usa i trigger, altrimenti ricorre al livello applicativo, registrando ogni fallback come info), `trigger` (forza l'uso dei trigger, avvisa se impossibile), `wal` (legge le modifiche dal write-ahead log invece dei trigger; richiede `wal_level=logical` e un ruolo con permessi di replica, altrimenti ricorre a `trigger`), `off`. Vedi [Realtime](/docs/backend/realtime-cdc/). Ha la precedenza su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Meccanismo di trasporto tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato se a `realtime.bus` è stato fornito un trasporto già istanziato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; la richiesta successiva viene rifiutata con `TOO_MANY_SUBSCRIPTIONS`. Un numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.maxSubscriptionsPerSocket`. Vedi [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero di socket realtime che un singolo utente o chiave API può mantenere aperti su un'istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore. L'accesso del socket successivo viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK riprova continuamente, riuscendo a connettersi non appena un altro socket si chiude. Un numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa (in ms) di una modifica prima dell'esecuzione del refetch che la consegna ai subscriber attivi. Un refetch attende 300 ms senza modifiche, e al massimo questo intervallo in presenza di un flusso costante di scritture. Un numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tempo (in ms) per cui il totale di una sottoscrizione a elenchi di grandi dimensioni può essere riutilizzato prima di essere ricalcolato; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostata, ogni frame esegue il conteggio. Ha la precedenza su `realtime.recountIntervalMs`. | Non impostata |
| `REALTIME_RECOUNT_MIN_ROWS` | Il totale minimo precedente a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi più piccoli vengono conteggiati a ogni frame. Ha la precedenza su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consenti valori `localhost`/loopback con `NODE_ENV=production`. Disattivata per impostazione predefinita, così che un avvio di produzione fallisca in modo evidente anziché connettersi a un database non presente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio dello schema ed esce senza aprire un socket — il formato ideale per un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server che lo segue. Crea inoltre le tabelle che un processo attivo creerebbe altrimenti al primo utilizzo, e non avvia né cron né code di job. Un valore vuoto è considerato *non impostato*, evitando che un `${SOMETHING}` non sostituito in un file compose trasformi una normale distribuzione in una che esegue migrazioni rifiutando di servire traffico. Rifiutato se combinato con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso di un file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) scrive in questo file ogni modifica dello schema apportata, in ordine sequenziale, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe di dati inserite non sono incluse. Rifiutata su un processo attivo che serve traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina — un agente, un job di CI — di *applicare* una modifica allo schema tramite `/api/admin/schema`, anziché limitarsi a pianificarla. Disattivata salvo richiesta esplicita: la credenziale che applicherebbe tale modifica è quella che con maggiore probabilità risiede in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione consentito per una funzione personalizzata prima che la richiesta venga interrotta. Stessa opzione di `functionsTimeoutMs`. `0` disattiva il limite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promise rejection non gestita termini il processo invece di limitarsi a registrarla nei log. Utile sotto un orchestratore in grado di riavviare l'istanza; da disattivare laddove un riavvio sia peggiore di un memory leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silenzia l'avviso di avvio su piattaforme rilevate dal runtime come con scalabilità a zero (scale-to-zero), dove un timer che scatterebbe in un'istanza inattiva non scatterebbe in nessuna istanza. Non altera null'altro: impostala se mantieni attiva almeno un'istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy presenti a monte di questo server, in modo che il rate limiter possa leggere il reale indirizzo del client da `X-Forwarded-For`. Valore predefinito di sicurezza `0`: senza proxy, fidarsi dell'header consentirebbe a qualsiasi chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non costituisce uno strumento di migrazione]
Il passaggio di avvio viene eseguito senza presidio umano e senza che nessuno analizzi una diff;
di conseguenza, non eliminerà mai una colonna, non restringerà mai un tipo e non riscriverà mai una tabella.
È anche per questo che l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola una diff ed eseguirà tranquillamente
`DROP COLUMN`, mentre il riavvio di un container non deve mai poter distruggere una colonna di produzione come effetto collaterale di una rischedulazione.

Le modifiche distruttive o che rimodellano la struttura rimangono dove possono essere esaminate: `rebase db
generate` + `rebase db migrate`, oppure `rebase db push` da un checkout o da una CI,
che esegue un dry-run della modifica, rifiuta quelle distruttive senza previa conferma e
può eseguire prima un backup.
:::

### Distribuzioni frazionate (Split deployments)

Una singola immagine e un singolo bundle possono essere avviati più volte in parallelo, ciascuno
servendo una parte diversa del progetto. Qui è riportata una sola riga per variabile per completezza dell'elenco;
ciò che ogni combinazione *installa e gestisce* — e quali combinazioni impediscono l'avvio — è descritto in
**[Processi frazionati](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Quale parte viene servita da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'indicazione se *questo* processo debba eseguire i timer dei cron. Se non impostata, segue il ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'indicazione se questo processo debba eseguire i worker delle code di job. Se non impostata, segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve solo le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve tutte le funzioni personalizzate tranne quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Dove il processo API inoltra una richiesta per una funzione che non serve direttamente. Su un `worker`, la destinazione delle sue chiamate `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint Model Context Protocol opzionale su `/mcp`, per consentire a un client AI di leggere
e scrivere su questo progetto **come utente autenticato**. Disattivato a meno che non venga impostato e — a differenza di
ogni altra superficie — nessun `REBASE_ROLE` lo attiva: gli altri descrivono la tipologia del processo,
mentre questo rappresenta la scelta di fornire credenziali a software di terze parti,
scelta che dovrebbe essere effettuata da una persona anziché essere ereditata dal
ruolo di un container.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Attiva la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza la superficie rifiuta di attivarsi e lo segnala nel log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine esternamente raggiungibile di questo deployment, ad es. `https://app.example.com`. La superficie MCP non può derivarla automaticamente — ricavare l'origine dall'header `Host` renderebbe l'identità dell'emittente, e l'audience rispetto a cui sono verificati i token, un valore fornito dal chiamante. | — |
| `REBASE_MCP_VIEW` | Percorso della vista personalizzata dell'app MCP del progetto (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica così che disegni le tue viste, campi e azioni personalizzati. Senza di essa, il backend cerca accanto al frontend che serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consenti la registrazione dinamica dei client OAuth (RFC 7591), consentendo a un client di registrarsi autonomamente. Imposta su `false` per richiedere che i client vengano registrati preventivamente. | `true` |

### Modifica dello schema live da un bundle

Disattivata a meno che `REBASE_LIVE_SCHEMA_REPOSITORY` non sia impostata. Un bundle compilato non contiene il
codice sorgente `backend/schema` da modificare; pertanto, impostando queste variabili, l'editor di schema legge
il sorgente dal repository, vi committa ciascuna modifica ed esegue il relativo DDL su
questo database. Riservato agli amministratori e applicato manualmente da una persona, salvo
diversamente specificato da `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`. Un repository indicato senza
credenziali valide impedisce l'avvio. Vedi
[Modifica dello schema live](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare i commit delle modifiche allo schema, nel formato `owner/name`. L'impostazione di questa variabile attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene applicato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione in cui risiede `backend/schema` in quel repository, relativo alla radice del repository. Un percorso che esce dal repository impedisce l'avvio, così come il parametro deprecato `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permessi granulari (fine-grained) con accesso in lettura e scrittura ai contenuti del repository. Imposta questa variabile o le tre variabili `_GITHUB_APP_*`, non entrambe. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per eseguire i commit come app anziché con un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata dell'app: formato PEM, PEM con caratteri di escape per i ritorni a capo, o in base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatoria se è presente `BACKUP_SCHEDULE`, che rifiuta di essere eseguito senza di essa. `rebase db backup` ripiega su `./backups` nel percorso in cui è stato eseguito. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostata o pari a `0`, conserva tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno N tra i backup più recenti, indipendentemente dalla retention impostata. | — |
| `PG_DUMP_PATH` | Sovrascrivi il binario `pg_dump` — deve corrispondere alla versione principale del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Sovrascrivi il binario `pg_restore`. | — |
| `PSQL_PATH` | Sovrascrivi il binario `psql` eseguito da `rebase db restore --clean` per rendere il ripristino un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione di `pg_dumpall`, se non presente nel `PATH`. In sua assenza — e senza i tool client di PostgreSQL installati — un backup dei globali fallisce con un errore che menziona questa variabile. | — |

L'immagine runtime ufficiale (`rebasepro/server`) include i client tool di PostgreSQL 18,
permettendo l'esecuzione di backup pianificati al suo interno verso qualsiasi server fino a Postgres 18.
Al di fuori dell'immagine, installali manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizza una destinazione privata con
crittografia a riposo (encryption-at-rest).

### Distribuzione del bundle (Bundle delivery)

Un deployment gestito non include il proprio codice all'interno dell'immagine: il runtime scarica un
bundle all'avvio. Queste variabili ne determinano la selezione e le modalità.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso di una directory di bundle già estratta. Quello che `rebase start` imposta localmente. | — |
| `REBASE_BUNDLE_URL` | Posizione da cui scaricare l'archivio del bundle, quando non ne è disponibile uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale bearer per tale download. Trattala come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto il bundle scaricato. Deve essere scrivibile e deve persistere tra la fase di download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi forniti dall'immagine runtime al bundle, oltre a quelli dichiarati dal bundle stesso. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `backend/resources.ts` viene
associato tramite variabili d'ambiente che ne riprendono il nome. I nomi di base sono indicati di seguito; una
risorsa non predefinita aggiunge in coda `__` e la propria chiave in lettere maiuscole, per cui un bucket denominato
`media` leggerà `S3_BUCKET__MEDIA`. `rebase status` stampa, per ciascuna risorsa,
l'esatta variabile letta e se risulta impostata.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di una sorgente dati, se diverso da quello predefinito per Postgres. Presenta un suffisso per ciascuna sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Con suffisso per ciascun topic. | — |

### L'ambiente proprio della CLI

Letto da `rebase`, non dal server. Nessuna di queste voci influisce su un deployment.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Dove `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, nella shell o in `.env`. Impostala quando il server gira con modalità diverse da `rebase dev` in questo progetto: `rebase start`, un container, un altro host. Se non impostata, utilizzano il server registrato da `rebase dev` mentre tale server è attivo, e non inviano nulla quando non lo è. | — |
| `REBASE_SERVICE_KEY` | La chiave di servizio con cui tali comandi si autenticano, letta da `.env`: la stessa variabile letta dal server (vedi sopra). | — |
| `SERVICE_KEY` | Una denominazione precedente per tale chiave. Quando è impostata in `.env`, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quale file `.env` viene letto e scritto dalla CLI, qualora non coincida con quello del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole del progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile per una root i cui file per agenti sono gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Il piano di controllo (control plane) con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` esegue l'accesso, anziché richiederlo tramite prompt. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, in modo che un secret store possa fornirla senza che compaia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token generato con `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica con esso anziché con la sessione di `rebase cloud login`, senza mai leggere o scrivere la sessione salvata. In una directory collegata da `rebase cloud init --claim`, viene accantonato a favore del token proprio di quel progetto qualora non disponga dello scope necessario sul progetto stesso. È il metodo da adottare per eseguire `rebase cloud` in CI — vedi [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI creata dai propri cloud tool, senza mai inviarlo all'app: imposta `REBASE_API_TOKEN` a tale scopo. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e i dettagli della richiesta anziché il messaggio sintetico. La prima opzione da impostare quando un comando `rebase cloud` fallisce senza fornire informazioni utili. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto rispetto a cui `rebase db push`, `db generate` e `db migrate` pianificano le modifiche, anziché il database `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina un database qui indicato, e ne rifiuta uno coincidente con `DATABASE_URL`. Sul database di sviluppo gestito, la CLI lo imposta su una propria istanza PGlite temporanea in memoria. Impostalo nei contesti in cui il privilegio `CREATE DATABASE` non è concesso. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue alcun provisioning — dovrai fornirne uno tuo. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server frontend, che altrimenti `rebase dev` ricaverebbe dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa (in ms) impiegato da `rebase dev` prima che il backend annunci il proprio avvio, trascorso il quale ne segnala la mancata esecuzione. `0` disattiva la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password inserita da `rebase dev --docker` nella stringa di connessione derivata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione standard condivisa tra diversi strumenti. Se impostata su qualsiasi valore diverso da `0`, la CLI non invia dati telemetrici. | — |
| `REBASE_TELEMETRY_DISABLED` | La medesima funzionalità, specifica per Rebase. Non richiede alcun file di configurazione, motivo per cui è quella consigliata in ambienti CI e nelle immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destinazione a cui inviare i dati di telemetria, per un collector self-hosted. | — |

## Segreti in fase di sviluppo

`JWT_SECRET` è obbligatoria in produzione. Essa e `REBASE_SERVICE_KEY` vengono
generate automaticamente al di fuori di essa, consentendoti di iniziare senza dover configurare nulla.

I valori generati vengono memorizzati nella cache in `.rebase-dev-secrets.json`, accanto a
`.rebase-dev-port` e `.rebase-dev-url` e ignorati da git insieme a essi. In precedenza venivano
rigenerati a ogni avvio — comportando la disconnessione dall'applicazione e l'invalidazione
di qualsiasi chiave API appena creata a ogni riavvio del dev server.

- Impostando esplicitamente una delle due variabili verrà utilizzato il tuo valore; nulla verrà memorizzato o letto dalla cache.
- Indirizza la cache altrove con `REBASE_DEV_SECRETS_FILE` — un percorso di file, nonché l'unica
  variabile di questa sezione che avrebbe senso impostare intenzionalmente.
- Elimina il file per effettuare la rotazione di entrambi i segreti. L'avvio successivo ne creerà uno nuovo.
- Se il file non può essere scritto — ad esempio in un container in sola lettura — il server si avvia
  ugualmente con un segreto effimero, esattamente come in precedenza.

Nulla viene memorizzato nella cache in produzione o sotto un test runner. In produzione non
viene generato alcun valore automatico: un avvio privo di `JWT_SECRET` fallisce indicando la variabile mancante, e
questo comportamento rimane invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

L'oggetto `RebaseBackendConfig` passato a `initializeRebaseBackend()` offre un controllo programmatico:

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
prive di `app`, `server` e `basePath` e con un parametro obbligatorio `provision`, consentono di creare un
backend che non serve traffico finché non viene montato: `createRebaseBackend`. Vedi
[Integrazione con server personalizzato](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta ogni route API, pertanto la stessa impostazione deve essere comunicata al client —
altrimenti continuerà a richiedere `/api/...` ricevendo errori 404 per qualsiasi risorsa:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione rileva questa impostazione dal client a cui è collegato; non è richiesta altra
configurazione. Se componi manualmente l'URL di una richiesta, ricavalo dal client anziché
inserire `/api` direttamente nel codice:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Errore di autorizzazione negata nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con l'errore `cause: error: permission denied for table <name>`, anche se la vista CMS a foglio di calcolo carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL cambiando temporaneamente i ruoli del database in modo che corrispondano al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli esistono solo nelle tabelle del database anziché come ruoli effettivi di PostgreSQL, il cambio di ruolo fallisce o mancano i relativi privilegi nel database. La visualizzazione a foglio di calcolo del CMS viene eseguita con l'utente proprietario della connessione predefinito e bypassa questo passaggio.
* **Soluzione:** Aggiungi `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del tuo backend. Questo impone a Rebase di eseguire le query dell'Editor SQL utilizzando i privilegi del proprietario della connessione (solitamente un superuser/owner). L'Editor SQL indicherà quindi, sopra i risultati, che sono stati letti come proprietario della connessione, disabilitando il selettore dei ruoli.

### Errore nel recupero dello schema nell'Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'Editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornita al bootstrapper, o se `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
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
