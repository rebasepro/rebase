---
sourceHash: 6598745a12831632
title: Ambiente e Configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene effettuata tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca qualcosa di obbligatorio o se un valore non è valido (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica la variabile problematica.
>
> La posizione dello schema dipende da come si esegue il backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che è l'unione
> di tutte le tabelle sottostanti. Un progetto su cui è stato eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })`, e può aggiungervi le proprie
> variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Opzionale in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria in tutti gli altri casi. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Usare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in fase di sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi propria di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano — crittografano i dati senza verificare il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la accettano e non
> degradano le prestazioni in modo permissivo: rifiutano l'avvio con l'errore `invalid sslmode value: "no-verify"`.
>
> I comandi proprietari di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la convertono nell'equivalente `sslmode=require` prima dell'esecuzione tramite shell,
> funzionando così con l'URL configurato. L'utilizzo manuale di `psql` non lo fa:
> sostituirla con `sslmode=require`, che esegue la crittografia senza verifica esattamente
> allo stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API di backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedere sotto. | origin della pagina |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth di Google. Abilita "Accedi con Google". | — |


> **Lasciare non impostato `VITE_API_URL` nelle build di produzione.**
>
> In fase di sviluppo il frontend e il backend hanno origini separate, quindi il server
> di sviluppo inietta questo valore. In produzione il backend di Rebase serve la SPA, quindi
> l'API coincide con l'origin della pagina stessa e il client la risolve autonomamente in questo modo.
>
> Integrare un URL assoluto in un bundle di produzione funziona finché un secondo
> hostname non punta alla stessa app: un dominio personalizzato caricherebbe la pagina da
> `example.com` ed effettuerebbe chiamate all'API su `example.rebase.website`, che è
> cross-origin, causando il fallimento del preflight di ogni richiesta. Consentire l'origin in CORS
> **non** risolve il problema — il cookie di refresh è impostato come `SameSite=Lax` e non viene
> inviato cross-site, eliminando gli errori in console ma lasciando l'autenticazione
> non funzionante. Se non impostato, ogni dominio che punta all'app funziona senza alcuna
> configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un valore `PORT` in `.env` non viene letto, poiché la porta viene risolta prima del caricamento del file — altrimenti associa una porta derivata dal percorso del progetto, permettendo l'esecuzione di più progetti contemporaneamente. L'opzione `rebase dev --port` ha la precedenza su entrambe, e il banner di avvio indica la configurazione utilizzata. | `3001` |
| `LOG_LEVEL` | Dettaglio del logging: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra la query SQL relativa a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché contiene i parametri associati (email, hash delle password, ecc.). Impostare su `true` durante la diagnosi di errori DDL, RLS o change-capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco di origini consentite separate da virgola. **Obbligatorio in produzione** se diverso dal dominio di backend. In fase di sviluppo viene *aggiunto a* localhost — vedere sotto. | — |
| `FRONTEND_URL` | URL dell'app frontend. Utilizzato come alternativa a CORS_ORIGINS in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (usata per l'introspezione dello schema e le operazioni di amministrazione). Il database specificato non è quello indicato come corrente dalla console SQL, né quello che un nuovo branch copia per impostazione predefinita: entrambi coincidono con il database su cui risiede la connessione dell'app (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'Editor SQL (utile per autenticazioni personalizzate in cui i ruoli del database non sono mappati). La console SQL di Studio indica che le righe sono state lette come proprietario della connessione, ne specifica il nome e disabilita il selettore di ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui è in esecuzione il server. `rebase dev` lo imposta su un checkout [spostato su un branch](/docs/backend/branching/#cli-integration). Un server con questa configurazione mantiene il registro dei branch su tale database e copia i nuovi branch da esso per impostazione predefinita, mostrando nel pannello Branches di Studio i branch del database principale. | — |

#### CORS in fase di sviluppo

L'ambiente di sviluppo consente **localhost, oltre a quanto indicato in `CORS_ORIGINS` (o `FRONTEND_URL`)**
— lo stesso elenco utilizzato in produzione, con localhost aggiunto anziché
sostituito. La variabile funziona allo stesso modo in entrambi gli ambienti,
e i casi in cui è necessaria in sviluppo sono quelli tipici:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non sia localhost né presente nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con la riga esatta necessaria per consentirla. Il rifiuto
non è una semplice precauzione: l'API invia credenziali, pertanto riflettere un
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di eseguire
richieste autenticate contro il server di sviluppo sfruttando la sessione attiva e leggendo
le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Chiave segreta per la firma JWT (obbligatoria in produzione, generata automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), consentendo a qualsiasi entità provvista del JWKS di verificare una sessione senza poterla generare. Accetta una stringa PEM con caratteri di nuova riga reali, una PEM con escape `\n` o l'intera chiave PEM codificata in base64. In sua assenza, i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificare a ogni cambio di chiave — la rotazione richiede la distinguibilità tra vecchia e nuova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. A scorrimento: ogni rotazione ne estende la validità, regolando la persistenza di una sessione in caso di **inattività**. Impostare `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser pongono qui il limite massimo per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi, a prescindere dal valore impostato: una tabella utenti vuota deve accettare un utente iniziale, che assumerà il ruolo di amministratore. In produzione (`NODE_ENV=production`) questa possibilità è disabilitata: una tabella vuota rifiuta la registrazione bootstrap con `SETUP_REQUIRED`, il primo account creato tramite registrazione aperta è un utente standard e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` di seguito o assegnato tramite service key. Il file `.env.example` dello scaffold la imposta su `true`; l'impostazione predefinita del framework è disattivata. | `false` |
| `DISABLE_SELF_REGISTRATION` | Meccanismo di blocco (kill switch). Chiude la finestra di bootstrap del primo utente lasciata aperta intenzionalmente da `ALLOW_REGISTRATION=false` fuori dalla produzione, bloccando la registrazione anche a database vuoto. Da associare a `REBASE_ADMIN_EMAIL` sottostante per evitare che il deployment non abbia modo di generare il primo utente autenticato. Impostata in tutti gli artefatti di distribuzione rilasciati. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. Consente la definizione dell'amministratore in un deployment di produzione evitando accessi concorrenti non autorizzati. All'avvio viene emesso un avviso se la tabella è vuota in produzione e questo valore non è impostato. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Minimo 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificare dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP archiviato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e viene emesso un avviso all'avvio: la rotazione di `JWT_SECRET` comporterebbe la disconnessione di tutti gli utenti *e* l'impossibilità di decifrare gli autenticatori registrati. Impostare una chiave dedicata (32+ caratteri casuali) prima della registrazione di qualsiasi utente. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave *precedente* in fase di rotazione. Impostare entrambe le variabili durante la procedura: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, prevenendo il blocco dell'accesso agli utenti durante la transizione. Rimuovere una volta ricifrati tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Opzionale (opt-in) e non vincolata a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Impostare su `false` per una superficie di lettura interamente pubblica — le policy RLS continuano a essere applicate. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato in assenza di specifica. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Espone l'endpoint `POST /api/auth/find-user`, che risolve un indirizzo email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per flussi di invito via email. Riservato a chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente individuato. Disattivato per impostazione predefinita per limitare la superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` del cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato unicamente a frontend cross-site effettivi. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` del cookie di refresh. Attivo per impostazione predefinita; impostare `AUTH_COOKIE_SECURE=false` per connessioni HTTP non protette (es. deployment su indirizzi LAN in cui il browser scarterebbe il cookie, causando la scadenza della sessione al termine della validità del token di accesso senza errori espliciti). Emette un avviso all'avvio. Non necessario per `http://localhost`. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID OAuth di Google (validazione backend) | — |
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
| `GITLAB_CLIENT_ID` | Client ID OAuth di GitLab. Il valore `baseUrl` per un'istanza self-hosted non è configurabile tramite variabile d'ambiente: definire GitLab all'interno del blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | Client ID OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | Client ID OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | Client ID OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | Services ID di Apple. Apple non adotta un client secret statico (Rebase firma un JWT ES256 a breve durata per ogni scambio di token): richiede la presenza di tutti e quattro i valori `APPLE_*`, senza i quali la configurazione viene ignorata. | — |
| `APPLE_TEAM_ID` | Team ID sviluppatore Apple, emittente del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata presso Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi i ritorni a capo (sono accettati caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API statica di amministrazione. Bypassa l'autenticazione JWT standard per chiamate server-to-server quando passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) utilizzata per la verifica dei token di piattaforma `rpt_`; blocchi PEM multipli durante la rotazione delle chiavi. Impostata dalla piattaforma in fase di deploy, non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE` consente al gateway di amministrazione di accettare un token di piattaforma per `cron:read` e per nessun'altra operazione. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID del progetto a cui deve corrispondere il campo `aud` di un token di piattaforma, per rifiutare token emessi per altri progetti. Se solo una delle due variabili è impostata, il server si avvia, registra un avviso e risponde a ogni token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione dei contatori per il rate limiting dell'autenticazione: `memory` (per singolo processo) o `sql` (condiviso tra repliche). Non potendo un processo rilevare autonomamente il numero di repliche, i deployment distribuiti devono specificarlo — tre repliche con valore predefinito applicherebbero il triplo del limite previsto. Qualsiasi altro valore **impedisce l'avvio** senza fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso tramite link senza password. Richiede un servizio email configurato per l'invio del collegamento. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password tramite codice a sei cifre inviato via email. Richiede la configurazione dell'email come sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic-link o codice email per un indirizzo non registrato crea l'account, purché le registrazioni siano abilitate. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un token di refresh oltre la finestra consentita: `reject` (rifiuta la richiesta, preserva la sessione) o `revoke-session` (termina la sessione). Valori diversi impediscono l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma obbligatoria: l'accesso con password è inibito fino alla verifica dell'indirizzo email. Richiede il servizio email; in caso contrario l'avvio viene bloccato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostato disattiva il captcha. | — |
| `CAPTCHA_SECRET` | Segreto del provider utilizzato lato server per verificare il token inviato dal browser. Obbligatorio se `CAPTCHA_PROVIDER` è impostato. | — |
| `CAPTCHA_ROUTES` | Route di autenticazione da proteggere separate da virgola (ad es. `register,login`). Non impostato adotta l'elenco predefinito del provider. | — |

### Archiviazione (Storage)

:::caution[Lo storage non dispone di sicurezza a livello di riga (RLS) e richiede un modello di accesso]
Le collezioni sono protette dalle policy RLS di Postgres. Lo storage a oggetti non ha un meccanismo equivalente —
le chiavi condividono un unico namespace piatto — pertanto, configurando un bucket senza un modello di accesso,
il server **rifiuta l'avvio in produzione**. È necessario soddisfare questo requisito impostando esattamente una delle seguenti opzioni:
un hook `storageAuthorize` esportato da `config/index.ts` (incluso nello scaffold
predefinito), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene letto dalla directory in cui gira il server: la radice del progetto con `rebase dev`, `backend/` in un server scritto da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente l'uso dello storage locale in produzione — valido unicamente in presenza di un volume persistente contenente `STORAGE_PATH` e le directory adiacenti `<STORAGE_PATH>__<key>` dei bucket locali nominati | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — corrispondente al token inserito da `getSignedUrl()`. Valore massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima dei file accettati, espressa in byte, per ogni percorso di caricamento — `__<KEY>` per una sorgente con nome. Valori non numerici interi impediscono l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Access key AWS | — |
| `S3_SECRET_ACCESS_KEY` | Secret key AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza URL di tipo path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | ID progetto GCP. Solitamente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file delle chiavi del service account. Da omettere su GCP se le credenziali sono fornite da Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce qualsiasi oggetto a chiunque senza token. Da utilizzare solo se il bucket funge da CDN pubblica. Costituisce una delle tre modalità per soddisfare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare ogni oggetto. Denominato `INSECURE` nell'oggetto di configurazione: è accettabile esclusivamente in applicazioni single-tenant in cui ogni account dispone della massima fiducia su tutti i file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza in cache i rendering generati delle immagini (ridimensionamenti, conversioni di formato) invece di produrli a ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato associato all'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo visualizzato in alto nei template email predefiniti. Indirizzo assoluto `http(s)` PNG o JPG — i client email rimuovono gli SVG e bloccano gli URI `data:`. Se non impostato, un'applicazione denominata `Rebase` mostrerà il marchio Rebase, mentre un'applicazione rinominata non mostrerà alcun logo |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di persistenza di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per l'acquisizione di una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non gestita da pooler). Richiesta da [Realtime](/docs/backend/realtime): i comandi `LISTEN`/`NOTIFY` non funzionano con transaction pooler come PgBouncer; in sua assenza le notifiche di modifica vengono disabilitate con un avviso per evitare la perdita silente di dati. Il [job worker](/docs/backend/jobs) vi mantiene il `LISTEN` per il risveglio. <span class="since-badge" data-since="0.25">Da 0.25</span> Assegna il valore a `directConnectionString` dell'adattatore Postgres se non impostato. | — |
| `DATABASE_READ_URL` | Replica di lettura. Se configurata e diversa da `DATABASE_URL`, le letture vengono indirizzate su di essa; in caso di errore di connessione, il traffico effettua il fallback sul nodo primario con un avviso. <span class="since-badge" data-since="0.25">Da 0.25</span> Assegna il valore a `readConnectionString` dell'adattatore Postgres se non impostato; sulla versione 0.24 questa opzione viene ignorata. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo per tutti i pool del processo, a prescindere dai parametri individuali. Accetta solo valori numerici: un valore non valido viene ignorato per evitare la serializzazione non intenzionale delle operazioni del server. | — |

### Comportamento a runtime

Variabili lette dal runtime — `rebase dev`, `rebase start` e l'immagine
del server pubblicata. Un progetto su cui è stato eseguito l'eject gestisce queste impostazioni direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Se `true`, esegue l'audit pianificato sulla [sicurezza a livello di riga (RLS)](/docs/rls-check#running-it-on-a-schedule), segnalando le tabelle esposte prive di policy. Il progetto deve includere `@rebasepro/rls-check` tra le dipendenze: il runtime non ne include copie e, senza il pacchetto, l'avvio viene bloccato indicandone la mancanza. `false` disabilita la scansione per il processo. | — |
| `REBASE_BASE_PATH` | Percorso base per tutte le route API. Il client deve essere configurato in modo corrispondente — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Distribuisce gli asset statici/amministrativi del bundle da questo processo. Disattivare se è presente una CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Abilita la compressione gzip/brotli delle risposte. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — valori non numerici impediscono l'avvio invece di rimuovere silenziosamente il limite). | — |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI. A tre stati: non impostata equivale ad attivo in sviluppo e disattivato in produzione; `false` la disattiva in ogni contesto. `true` in produzione espone la **specifica** su `/api/docs` ma non la **UI** di Swagger su `/api/swagger` — la UI è condizionata separatamente da `NODE_ENV`. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, imponendo ai browser di rifiutare connessioni HTTP su ogni sottodominio dell'host per sei mesi — inclusi host non gestiti da questo processo. Attivare solo se tutti i sottodomini del dominio supportano esclusivamente HTTPS. Valori diversi da `true`/`false` impediscono l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a protezione di `/metrics`. Se non impostato, l'endpoint è accessibile da chiunque possa raggiungere la porta — accettabile su una rete privata, sconsigliato su rete pubblica (condizione segnalata nei log di avvio). | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni sullo schema consentite al runtime all'avvio. `ensure` (predefinito in tutti gli ambienti, produzione inclusa) applica le modifiche **additive**: crea tabelle, colonne e tipi enum mancanti, senza mai rimuovere o riscrivere elementi esistenti. `none` non modifica lo schema. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio con `push`**. Nelle [architetture distribuite (split deployments)](/docs/deployment/split-processes), un solo processo può eseguire il provisioning, imponendo a tutti gli altri ruoli di impostare `none` per evitare il blocco dell'avvio. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Impedisce l'avvio se il database è stato inizializzato da un insieme di collezioni differente rispetto a quello con cui è stato compilato il processo. Se non impostato (o impostato su valori diversi da `true`/`1`), emette solo un avviso. | warn |
| `REALTIME_CDC` | Change Data Capture a livello di database: `auto` (attiva la funzione se supportata dalla connessione, altrimenti esegue un fallback trasparente), `trigger` (forza l'uso dei trigger, emette avviso in caso di errore), `wal` (attualmente degrada a `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). <span class="since-badge" data-since="0.25">Da 0.25</span> Ha priorità su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Livello di trasporto cross-istanza per canali broadcast e presenza: `memory` o `postgres`. Ignorato se a `realtime.bus` viene assegnato un trasporto istanziato manualmente. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; le richieste eccedenti vengono rifiutate con `TOO_MANY_SUBSCRIPTIONS`. Richiede un numero intero positivo — valori differenti bloccano il server all'avvio. Ha priorità su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | <span class="since-badge" data-since="0.25">Da 0.25</span> Numero massimo di socket realtime mantenibili da un utente su una singola istanza del server. Ulteriori tentativi di connessione vengono rifiutati con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK riprova la connessione, consentendo l'accesso alla chiusura di un altro socket. Richiede un numero intero positivo — valori differenti bloccano il server all'avvio. Ha priorità su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | <span class="since-badge" data-since="0.25">Da 0.25</span> Tempo massimo di attesa (in ms) prima dell'esecuzione del refetch che notifica le modifiche ai sottoscrittori. In assenza di modifiche l'attesa è di 300 ms, fino al tempo massimo configurato in presenza di flussi costanti di scrittura. Richiede un numero intero positivo — valori differenti bloccano il server all'avvio. Ha priorità su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | <span class="since-badge" data-since="0.25">Da 0.25</span> Intervallo (in ms) entro cui riutilizzare il conteggio totale di elenchi di grandi dimensioni prima di ricalcolarlo; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostato, il calcolo avviene a ogni frame. Ha priorità su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | <span class="since-badge" data-since="0.25">Da 0.25</span> Soglia minima di righe a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; per elenchi con meno elementi il conteggio viene aggiornato a ogni frame. Ha priorità su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback in ambiente `NODE_ENV=production`. Disattivata per impostazione predefinita, per segnalare immediatamente configurazioni errate invece di tentare connessioni a database inesistenti. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Comportamento all'avvio in presenza di chiavi nelle collezioni non riconosciute dalla versione corrente: `warn`, `error` (blocca l'avvio — consigliato in CI) o `off`. Si applica solo a chiavi *sconosciute* (tipicamente errori di battitura o metadati intenzionali); l'uso di chiavi deprecate o rimosse genera sempre un errore bloccante, poiché comporterebbe l'assenza trasparente della funzionalità associata. | `warn` |
| `REBASE_PROVISION_ONLY` | Se `1`/`true`, esegue il provisioning dello schema ed esce senza aprire socket di rete — modalità indicata per Job di migrazione basati sulla stessa immagine e bundle del server finale. Valori vuoti sono trattati come *non impostati*, evitando che variabili non valorizzate come `${SOMETHING}` nei compose file blocchino il server in modalità migrazione. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | Se `true`, consente a processi automatici (agent, pipeline CI) di *applicare* modifiche allo schema tramite `/api/admin/schema`, oltre alla sola pianificazione. Disattivato se non espressamente richiesto: le credenziali con tali permessi sono spesso esposte nelle variabili CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione di una custom function prima dell'interruzione della richiesta. Equivalente all'opzione `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | Se `true`, termina il processo in caso di rejection non gestita di una Promise anziché registrarla solo nei log. Consigliato sotto orchestratori configurati per il riavvio automatico; sconsigliato se il riavvio è più impattante di un potenziale leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene attivo lo scheduler cron su piattaforme con scale-to-zero, dove un timer che scatta su un'istanza inattiva rischierebbe di non essere eseguito su alcuna risorsa. | — |
| `TRUSTED_PROXY_HOPS` | Numero di reverse proxy a monte del server, necessario affinché il rate limiter possa estrarre l'indirizzo IP reale del client da `X-Forwarded-For`. Predefinito su `0` per sicurezza: senza proxy, fidarsi dell'header consentirebbe lo spoofing dell'identità client. | `0` |

:::note[Il provisioning all'avvio è additivo e non sostituisce uno strumento di migrazione]
Il processo di avvio viene eseguito automaticamente senza revisione delle differenze, pertanto non
eliminerà colonne, non restringerà tipi di dati né riscriverà tabelle. Questo è il motivo per cui l'immagine rifiuta
`REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff e può eseguire comandi come
`DROP COLUMN`, e il riavvio di un container non deve poter distruggere colonne
in produzione a seguito di una rischedulazione.

Le modifiche distruttive o strutturali devono essere gestite in contesti controllati: `rebase db
generate` + `rebase db migrate`, oppure `rebase db push` da locale o pipeline CI,
che mostra l'anteprima (dry-run), blocca le modifiche distruttive in assenza di conferma esplicita
e consente l'esecuzione di backup preventivi.
:::

### Processi separati (Split deployments)

Una singola immagine e un singolo bundle possono essere avviati in più processi distinti,
ciascuno responsabile di una parte dell'applicazione. Qui vengono riassunte le variabili relative;
per i dettagli su cosa ogni combinazione *espone e gestisce* — e quali
configurazioni non sono consentite all'avvio — consultare
**[Processi separati (Split Processes)](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Ruolo del processo corrente: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron per *questo* processo. Se non impostato, eredita la configurazione dal ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job per questo processo. Se non impostato, eredita la configurazione dal ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Limita l'esecuzione in questo processo esclusivamente alle custom function specificate. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Esegue tutte le custom function escludendo quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a monte a cui il processo API inoltra le richieste per funzioni non gestite localmente. | — |

### Superficie MCP

Endpoint opzionale per Model Context Protocol disponibile su `/mcp`, che consente a un client AI
di interagire in lettura e scrittura con il progetto **con l'identità dell'utente autenticato**.
Disattivato per impostazione predefinita e — a differenza di altri servizi — nessun
`REBASE_ROLE` lo abilita automaticamente: mentre gli altri ruoli definiscono l'architettura
del processo, questa opzione delega credenziali ad applicativi di terze parti
e richiede una decisione esplicita anziché derivata dal ruolo del container.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Abilita l'endpoint MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza il servizio non viene montato e la condizione viene segnalata nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origin accessibile pubblicamente di questo deployment, ad es. `https://app.example.com`. Non deducibile automaticamente: ricavare l'origin dall'header `Host` renderebbe l'identità dell'emittente e la validazione dei token dipendenti da un valore fornito dal client chiamante. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591) per l'auto-registrazione. Impostare su `false` se si richiede la pre-registrazione manuale dei client. | `true` |

### Modifica live dello schema da bundle

Disattivata se non viene impostata la variabile `REBASE_LIVE_SCHEMA_REPOSITORY`. Poiché un bundle compilato
non include i sorgenti delle collezioni modificabili, configurando questi parametri l'editor delle collezioni
del pannello di amministrazione recupera i sorgenti dal repository, ne esegue il commit e applica il relativo DDL
sul database. Funzionalità riservata agli amministratori, applicata manualmente a meno che non sia impostato diversamente da
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`. Specificare un repository senza credenziali valide blocca l'avvio. Vedere
[Modifica live dello schema](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare i commit delle modifiche allo schema, nel formato `owner/name`. La sua valorizzazione attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch di destinazione dei commit. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Percorso relativo al repository in cui risiedono i sorgenti delle collezioni. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token ad accesso granulare con permessi di lettura e scrittura sul repository. Impostare questa variabile o le tre variabili `_GITHUB_APP_*` (non entrambe le soluzioni). | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID della GitHub App, per eseguire commit con l'identità dell'applicazione anziché tramite token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID di installazione dell'applicazione sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chiave privata dell'applicazione: formato PEM, PEM con caratteri di nuova riga con escape, o stringa codificata in base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup automatici sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostata o uguale a `0`, tutti i backup vengono conservati. | — |
| `BACKUP_KEEP_MINIMUM` | Mantiene sempre almeno gli ultimi N backup più recenti, a prescindere dalle regole di retention. | — |
| `PG_DUMP_PATH` | Percorso personalizzato per il binario `pg_dump` — deve corrispondere alla major version del server o superiore. | — |
| `PG_RESTORE_PATH` | Percorso personalizzato per il binario `pg_restore`. | — |
| `PG_DUMPALL_PATH` | Percorso dell'eseguibile `pg_dumpall`, se non incluso nel `PATH`. In sua assenza — e senza i client tools di PostgreSQL installati — il backup degli oggetti globali fallisce restituendo un errore che fa riferimento a questa variabile. | — |

L'immagine runtime ufficiale (`rebasepro/server`) include i tool client di PostgreSQL 18,
garantendo l'esecuzione dei backup pianificati verso database fino a Postgres 18.
In ambienti esterni all'immagine, è necessario installarli manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizzare destinazioni di archiviazione
private dotate di crittografia a riposo (encryption-at-rest).

### Distribuzione dei bundle

Un deployment gestito non include il codice applicativo all'interno dell'immagine: il runtime
scarica il bundle all'avvio. Le seguenti variabili regolano la sorgente e la modalità di download.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso di una directory contenente un bundle già estratto. Impostato localmente da `rebase start`. | — |
| `REBASE_BUNDLE_URL` | URL da cui prelevare l'archivio del bundle in assenza di un percorso locale. | — |
| `REBASE_BUNDLE_TOKEN` | Token bearer per l'autenticazione del download. Trattare come segreto: autorizza il tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory di destinazione in cui viene estratto il bundle scaricato. Deve disporre dei permessi di scrittura e persistere tra il download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi messi a disposizione del bundle dall'immagine di runtime, oltre a quelli inclusi di default. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato in `config/resources.ts` viene
associato a variabili d'ambiente con nomi derivati dalla risorsa stessa. I prefissi base sono elencati di seguito;
per le risorse non predefinite viene aggiunto `__` seguito dal nome in lettere maiuscole (un bucket
denominato `media` leggerà `S3_BUCKET__MEDIA`). Il comando `rebase status` mostra, per ogni risorsa,
la variabile associata e il relativo stato di valorizzazione.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver per una sorgente dati differente da quella predefinita (Postgres). Presenta il suffisso della risorsa: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Stringa di connessione per un topic dichiarato. Presenta il suffisso della risorsa. | — |

### Variabili d'ambiente della CLI

Lette dal comando `rebase`, non dal server applicativo. I seguenti valori non hanno impatto sui deployment.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Endpoint di backend con cui comunicano `rebase auth` e `rebase api-keys`, in alternativa al valore ricavato dal progetto. | — |
| `REBASE_PORT` | Porta presunta dai comandi CLI per la derivazione dell'URL sopra indicato. | — |
| `SERVICE_KEY` | Service key per l'autenticazione delle chiamate, evitando richieste interattive a terminale. | — |
| `REBASE_ENV_FILE_PATH` | Percorso alternativo del file `.env` letto e modificato dalla CLI. | — |
| `REBASE_CLOUD_URL` | Endpoint del control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Account utilizzato per il login con `rebase cloud login`, in assenza di input interattivo. | — |
| `REBASE_CLOUD_PASSWORD` | Password associata all'account cloud, per l'integrazione con secret manager senza esposizione nella cronologia della shell. | — |
| `REBASE_TOKEN` | Token generato tramite `rebase cloud tokens create`. Se impostato, tutti i comandi `rebase cloud` utilizzano questo token al posto della sessione creata con `rebase cloud login`, ignorando le sessioni memorizzate. Indicato per pipeline CI — consultare [CI e agent](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) legge la stessa variabile come alias di `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | Impostato su `1`, restituisce l'errore completo e i dettagli della richiesta anziché il messaggio sintetico. Utile per il debug di comandi `rebase cloud` che falliscono senza output esaustivo. | — |
| `REBASE_ATLAS_DEV_URL` | <span class="since-badge" data-since="0.25">Da 0.25</span> Database vuoto utilizzato per la pianificazione dei comandi `rebase db push`, `db generate` e `db migrate`, in alternativa a `<db>_dev_diff` creato parallelamente a `DATABASE_URL`. Rebase non crea né elimina il database indicato e non accetta valori identici a `DATABASE_URL`. Sul database di sviluppo gestito, la CLI assegna un'istanza PGlite temporanea in memoria. Da impostare qualora non si disponga del privilegio `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia istanze di database né esegue il provisioning dei dati — richiede un database esterno preesistente. Equivalente al flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta per il server di sviluppo frontend, che altrimenti `rebase dev` calcola dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa (in ms) di `rebase dev` per il segnale di disponibilità del backend prima di segnalarne la mancata inizializzazione. `0` disabilita la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | Password inserita da `rebase dev --docker` nella stringa di connessione ricavata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Standard open-source convenzionale. Se impostata su un valore diverso da `0`, la CLI non invia dati di telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente specifica per Rebase. Non richiede un file di configurazione, risultando ideale per l'uso in contesti CI e container. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint di destinazione per l'invio della telemetria verso un collector personalizzato self-hosted. | — |

## Segreti in fase di sviluppo

`JWT_SECRET` e `REBASE_SERVICE_KEY` sono obbligatori in produzione e generati
automaticamente in ambiente di sviluppo, per consentire l'avvio immediato senza configurazione preventiva.

I valori generati vengono memorizzati nella cache locale in `.rebase-dev-secrets.json`, accanto a
`.rebase-dev-port` e `.rebase-dev-url` e ignorati da git insieme a essi. Nelle versioni precedenti
venivano rigenerati a ogni avvio, provocando la disconnessione dall'applicazione
e l'invalidazione delle API key create di recente.

- Impostando una delle variabili manualmente, verrà utilizzato il valore definito e la cache non verrà impiegata.
- È possibile specificare un percorso alternativo per la cache tramite `REBASE_DEV_SECRETS_FILE` —
  unica variabile di questa sezione da configurare esplicitamente qualora necessario.
- Eliminando il file i segreti verranno rigenerati al successivo avvio.
- Se il file non può essere salvato (ad esempio in container con filesystem di sola lettura),
  il server si avvia con un segreto temporaneo in memoria.

Nessun dato viene memorizzato in cache in produzione o durante i test automatizzati. In produzione,
un avvio in cui non sia configurato uno dei segreti fallisce indicando la variabile mancante:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Oggetto di configurazione del Backend

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

<span class="since-badge" data-since="0.25">Da 0.25</span> Con le stesse opzioni,
escludendo `app`, `server` e `basePath` e aggiungendo il parametro obbligatorio `provision`, è possibile
istanziare un backend che non gestisce direttamente l'ascolto di rete tramite `createRebaseBackend`. Consultare
[Integrazione con server personalizzato](/docs/backend/custom-server/).

### Modifica di `basePath`

La modifica di `basePath` sposta l'intero routing delle API, richiedendo l'aggiornamento
della configurazione lato client per evitare errori 404 dovuti a chiamate verso il percorso predefinito `/api/...`:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione riceve questa impostazione dal client associato senza ulteriori modifiche.
Se si compongono URL manualmente, ricavarli tramite il client invece di impostare staticamente `/api`:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Errore di permessi nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** L'esecuzione di query personalizzate nell'editor SQL di Rebase Studio restituisce l'errore `cause: error: permission denied for table <name>`, mentre la vista CMS tabellare carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'Editor SQL variando temporaneamente il ruolo nel database in base a quello applicativo dell'utente attivo (es. `SET LOCAL ROLE "admin"`). Nel caso in cui si utilizzi un sistema di autenticazione personalizzato con ruoli gestiti a livello di tabelle applicative e non mappati sui ruoli di PostgreSQL, il comando fallisce o risultano assenti i privilegi necessari. La vista tabellare CMS viene eseguita utilizzando il proprietario predefinito della connessione e non risente del problema.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questa impostazione impone l'esecuzione delle query dell'Editor SQL con i privilegi del proprietario della connessione (solitamente superuser/owner). L'Editor SQL mostrerà sopra i risultati la notifica che i dati sono stati letti con i privilegi del proprietario della connessione e disabiliterà il selettore dei ruoli.

### Errore nel recupero dello schema nell'Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non carica l'albero dello schema o l'Editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necessita di privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire istruzioni di amministrazione. L'errore si verifica se `adminConnectionString` non viene passata al bootstrapper o se il metodo `getAdmin()` viene sovrascritto restituendo `undefined`.
* **Soluzione:** Assicurarsi che `adminConnectionString` sia definita durante l'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Passaggi successivi

- **[Distribuzione](/docs/getting-started/deployment)** — Guida al deployment in produzione
- **[Panoramica del Backend](/docs/backend)** — Documentazione completa per la configurazione del backend
