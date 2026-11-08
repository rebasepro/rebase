---
sourceHash: 0e81d6a2d1e7dc57
title: Ambiente e Configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene effettuata tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase valida le variabili d'ambiente con **Zod** all'avvio. Se
> un elemento obbligatorio manca o è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come viene eseguito il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema proprietario del runtime (`loadBootEnv` in `@rebasepro/server`), che è l'unione
> di ogni tabella riportata sotto. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })`, e può aggiungervi
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione a PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue un PostgreSQL gestito per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria in tutti gli altri contesti. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Usare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (autogenerata in sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi propria di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano: cifrano, ma non verificano il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la supportano e non
> degradano la sicurezza: rifiutano l'avvio con `invalid sslmode value: "no-verify"`.
>
> I comandi proprietari di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la convertono nell'equivalente `sslmode=require` prima di chiamare la shell,
> funzionando correttamente con l'URL configurato. L'esecuzione manuale di `psql` non
> effettua tale conversione — in quel contesto occorre sostituirla con `sslmode=require`,
> che cifra la connessione senza eseguire la verifica nello stesso identico modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Impostare solo in ambiente di sviluppo** — vedere di seguito. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth di Google. Abilita l'opzione "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostata nelle build di produzione.**
>
> In fase di sviluppo, frontend e backend risiedono su origini separate, pertanto il server
> di sviluppo inietta questo valore. In produzione, il backend Rebase serve la SPA, quindi
> l'API coincide con l'origine della pagina stessa e il client la risolve autonomamente in tal modo.
>
> Incorporare un URL assoluto in un bundle di produzione funziona solo fino a quando un secondo
> hostname non punta alla stessa app: un dominio personalizzato caricherebbe la pagina da
> `example.com` ed effettuerebbe chiamate API verso `example.rebase.website`, configurando una
> richiesta cross-origin che fallirebbe il preflight. Consentire l'origine tramite CORS **non**
> risolverebbe comunque il problema: il cookie di refresh è impostato su `SameSite=Lax` e non viene
> inviato cross-site, portando all'eliminazione degli errori in console ma mantenendo l'autenticazione
> non funzionante. Non impostando la variabile, qualsiasi dominio che punti all'app funzionerà
> senza alcuna configurazione CORS aggiuntiva.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **esclusivamente dall'ambiente della shell** — un parametro `PORT` in `.env` non viene letto in questo contesto, poiché la porta viene risolta prima del caricamento del file — altrimenti associa una porta derivata dal percorso del progetto, consentendo l'esecuzione contemporanea di più progetti. Il parametro `rebase dev --port` ha priorità su entrambi e il banner iniziale indica la configurazione utilizzata. | `3001` |
| `LOG_LEVEL` | Dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'istruzione SQL corrispondente a una riga `Failed query: [redacted]`. Ogni query non riuscita viene oscurata per impostazione predefinita poiché include i parametri vincolati — ad esempio email o hash di password. Impostare su `true` durante l'analisi di errori DDL, RLS o di rilevamento modifiche (change-capture). Ignorata quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco di origini consentite separate da virgola. **Obbligatoria in produzione** a meno che non sia impostata `FRONTEND_URL`: un avvio in produzione privo di entrambe rifiuterà l'esecuzione. In ambiente di sviluppo viene *aggiunta a* localhost — vedere sotto. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzata come alternativa a CORS_ORIGINS in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (usata per l'introspezione dello schema e le operazioni di amministrazione). Il database specificato non corrisponde a quello impostato come corrente dalla console SQL, né a quello clonato per impostazione predefinita da un nuovo branch: entrambi corrispondono al database su cui insiste la connessione dell'applicazione stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server operante su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli DB non sono mappati). In questo caso, la console SQL di Studio segnalerà che le righe sono state lette con l'identità del proprietario della connessione, indicandone il nome e disabilitando il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Database da cui è stato copiato il branch su cui opera il server. `rebase dev` imposta questo valore su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server con questo parametro mantiene il registro dei branch su tale database e copia i nuovi branch da esso per impostazione predefinita, permettendo al pannello Branches di Studio di mostrare i branch del database principale. | — |

#### CORS in fase di sviluppo

L'ambiente di sviluppo autorizza **localhost, oltre a qualsiasi valore specificato in `CORS_ORIGINS` (o `FRONTEND_URL`)** —
lo stesso elenco adoperato in produzione, con localhost aggiunto anziché
sostituito. In questo modo la variabile mantiene un comportamento uniforme in entrambi gli ambienti,
e i casi d'uso necessari in sviluppo rimangono quelli standard:

```bash
# Un telefono sulla LAN, la macchina di un collega, un tunnel ngrok,
# una porta inoltrata da Codespaces — tutte origini diverse da localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine non corrispondente a localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una sola volta per origine** con la riga esatta necessaria per autorizzarla. Il rifiuto
non risponde a una mera precauzione formale: l'API trasmette credenziali, pertanto riflettere un'intestazione
`Origin` arbitraria consentirebbe a qualsiasi sito visitato dallo sviluppatore di inoltrare richieste
autenticate verso il server di sviluppo sfruttando la sessione attiva e leggendone le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Chiave segreta per la firma JWT (obbligatoria in produzione, autogenerata in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), consentendo a qualsiasi entità provvista di JWKS di verificare una sessione senza poterla generare. Accetta un formato PEM con interruzioni di riga reali, con sequenze di escape `\n`, o l'intero blocco PEM in base64. In assenza di questo parametro i token rimangono cifrati con HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificare il valore ad ogni rotazione della chiave — la procedura di rotazione richiede la distinguibilità tra chiave precedente e nuova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del refresh token. Meccanismo a finestra scorrevole — ogni rotazione ne rinnova la scadenza; regola il tempo di sopravvivenza della sessione in caso di **inattività**. Impostare `400d` per sessioni che devono persistere dopo assenze prolungate; i browser impongono tale limite massimo al cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi a prescindere dal valore — una tabella utenti vuota deve necessariamente accogliere un account, che assumerà il ruolo di admin. In produzione (`NODE_ENV=production`) tale finestra è inibita: una tabella vuota rifiuta la registrazione iniziale restituendo `SETUP_REQUIRED`; un primo account creato mediante registrazione aperta diventa un account standard, mentre l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` riportata di seguito o associato tramite la service key. Il file `.env.example` generato imposta il valore su `true`; il framework assume `false` per impostazione predefinita. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di sicurezza. Blocca la finestra di bootstrap per il primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente attiva al di fuori della produzione, impedendo le registrazioni anche su un database vuoto. Da associare al parametro `REBASE_ADMIN_EMAIL` sottostante; in caso contrario il deployment non potrà disporre del suo primo utente autenticato. Impostata in tutti gli artefatti di deployment distribuiti. | — |
| `REBASE_ADMIN_EMAIL` | Indirizzo email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. Questo meccanismo consente di impostare l'amministratore in un deployment di produzione: l'operatore dichiara il primo account impedendone l'acquisizione concorrente su rete pubblica. L'avvio genera un avviso qualora la tabella sia vuota in produzione e questo parametro non sia impostato. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Minimo 12 caratteri, pena il rifiuto e la mancata creazione dell'account. Modificare dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Cifra tutti i segreti TOTP memorizzati. Se non impostata, i segreti vengono cifrati tramite `JWT_SECRET` e l'avvio genera un avviso; di conseguenza, la rotazione di `JWT_SECRET` disconnetterebbe tutti gli utenti rendendo *inoltre* indecifrabili tutti gli autenticatori associati. Impostare una chiave dedicata (32+ caratteri casuali) prima dell'associazione da parte degli utenti. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave *da dismettere* durante la rotazione. Impostare entrambe le chiavi durante la procedura: i nuovi segreti vengono memorizzati con `MFA_ENCRYPTION_KEY` garantendo al tempo stesso la leggibilità di quelli preesistenti, evitando il blocco degli account in corso di rotazione. Rimuovere una volta ricifrati tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, volutamente svincolata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'accesso all'API dati. Impostare su `false` per esporre una superficie di lettura interamente pubblica — le policy RLS continuano a essere applicate. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato in assenza di specificazione. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Espone l'endpoint `POST /api/auth/find-user`, che risolve un indirizzo email in un profilo pubblico essenziale (`uid`, `displayName`, `photoURL`) a supporto dei flussi di invito via email. Riservato agli utenti autenticati; non restituisce mai email, ruoli o metadati dell'utente individuato. Disabilitato per impostazione predefinita: costituisce una superficie potenziale per l'enumerazione degli account. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Direttiva `SameSite` del cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è riservato a scenari con frontend effettivamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Direttiva `Secure` del cookie di refresh. Abilitata di default; impostare `AUTH_COOKIE_SECURE=false` per connessioni non cifrate (plain HTTP) — ad esempio in deployment su indirizzi LAN in cui il browser scarterebbe il cookie provocando l'interruzione della sessione alla scadenza dell'access token senza generare errori espliciti. Genera un avviso all'avvio. `http://localhost` non richiede questa configurazione. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID OAuth Google (validazione backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret OAuth Google | — |
| `GITHUB_CLIENT_ID` | Client ID OAuth GitHub | — |
| `GITHUB_CLIENT_SECRET` | Client secret OAuth GitHub | — |
| `MICROSOFT_CLIENT_ID` | Client ID OAuth Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret OAuth Microsoft | — |
| `LINKEDIN_CLIENT_ID` | Client ID OAuth LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret OAuth LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | Client ID OAuth Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret OAuth Facebook | — |
| `TWITTER_CLIENT_ID` | Client ID OAuth X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Client secret OAuth X/Twitter | — |
| `DISCORD_CLIENT_ID` | Client ID OAuth Discord | — |
| `DISCORD_CLIENT_SECRET` | Client secret OAuth Discord | — |
| `GITLAB_CLIENT_ID` | Client ID OAuth GitLab. Il parametro `baseUrl` di un'istanza self-hosted non prevede una variabile d'ambiente dedicata — configurare GitLab direttamente nel blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth GitLab | — |
| `BITBUCKET_CLIENT_ID` | Client ID OAuth Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth Bitbucket | — |
| `SLACK_CLIENT_ID` | Client ID OAuth Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth Slack | — |
| `SPOTIFY_CLIENT_ID` | Client ID OAuth Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth Spotify | — |
| `APPLE_CLIENT_ID` | Apple Services ID per l'accesso web. Valore pubblico esposto in `GET /auth/config`. Apple non utilizza un client secret statico: Rebase genera e firma un token JWT ES256 a breve durata per ciascuno scambio di token. Di conseguenza, l'integrazione richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, unitamente a questo parametro oppure ad `APPLE_BUNDLE_IDS`; in loro assenza non viene configurata alcuna integrazione. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgola dei bundle ID relativi alle app native iOS/macOS di cui vengono accettati i codici di Sign in with Apple. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, issuer del token JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata presso Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, interruzioni di riga incluse (sono ammesse sequenze `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API amministrativa statica. Bypassa la normale autenticazione JWT per chiamate server-to-server se trasmessa come `Authorization: Bearer <key>`. (Autogenerata in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) utilizzata per verificare i token di piattaforma `rpt_`; può contenere più blocchi PEM in fase di rotazione delle chiavi. Valorizzata dalla piattaforma in fase di deploy; non contiene segreti. Unitamente a `REBASE_PLATFORM_TOKEN_AUDIENCE`, consente al gateway amministrativo di accettare un token di piattaforma limitatamente a `cron:read`. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | Valore dell'identificativo di progetto che deve coincidere con il claim `aud` del token di piattaforma, impedendo l'uso di token generati per altri progetti. Qualora sia configurata una sola delle due variabili, il server si avvia segnalando un avviso nei log e risponde a qualsiasi token `rpt_` con l'errore `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Meccanismo di memorizzazione dei contatori per il rate limiting dell'autenticazione: `memory` (per singolo processo) o `sql` (condiviso tra repliche). Poiché un processo non ha visibilità sul numero di repliche attive, i deployment distribuiti devono dichiararlo esplicitamente — tre repliche con valore predefinito applicherebbero una soglia complessiva pari al triplo di quella prevista. Qualsiasi valore alternativo **impedisce l'avvio del server** anziché effettuare un fallback, inclusa la stringa `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso tramite magic link (senza password). Richiede la configurazione di un servizio di invio email per l'inoltro del link. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password tramite codice numerico a sei cifre inviato via email. Richiede la configurazione del servizio email come indicato sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di autenticazione tramite magic-link o codice email per un indirizzo non censito crea l'account, purché le registrazioni siano aperte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un refresh token oltre la finestra temporale consentita: `reject` (rifiuta la richiesta mantenendo la sessione attiva) o `revoke-session` (invalida la sessione). Qualsiasi valore differente blocca l'avvio del server. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con verifica preventiva: impedisce l'accesso con password finché l'indirizzo email non risulta verificato. Richiede il servizio email; in assenza di esso l'avvio viene bloccato. | `false` |
| `CAPTCHA_PROVIDER` | Abilita la verifica captcha sugli endpoint di autenticazione: `turnstile` o `hcaptcha`. Se omessa, il captcha non viene applicato. | — |
| `CAPTCHA_SECRET` | Chiave segreta del provider, utilizzata lato server per validare il token trasmesso dal browser. Obbligatoria se `CAPTCHA_PROVIDER` è impostato. | — |
| `CAPTCHA_ROUTES` | Elenco di rotte di autenticazione da proteggere separate da virgola (es. `register,login`). Se non impostata, protegge il set predefinito del provider. | — |

### Archiviazione (Storage)

:::caution[Lo storage non dispone di sicurezza a livello di riga, pertanto richiede un modello di accesso]
Le collezioni sono protette tramite Postgres RLS. L'object storage non dispone di un
meccanismo equivalente — le chiavi condividono un unico namespace piatto — pertanto, in presenza di un bucket
configurato privo di modello di accesso, il server **rifiuta l'avvio in produzione**.
Per consentire l'avvio è necessario definire esattamente una tra le seguenti opzioni:
un hook `storageAuthorize` esportato da `config/index.ts` (configurazione inclusa nello scaffolding
predefinito), `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso base per lo storage locale. I percorsi relativi vengono interpretati a partire dalla directory di esecuzione del server: la radice del progetto per `rebase dev`, la directory `backend/` in ambienti sottoposti a `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente l'utilizzo dello storage locale in produzione — esclusivamente in presenza di un volume persistente associato a `STORAGE_PATH` e alle directory `<STORAGE_PATH>__<key>` dei bucket locali dedicati | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durata di validità in secondi dell'URL di download per i file privati — definisce la scadenza del token generato da `getSignedUrl()`. Valore massimo: `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima ammessa per singolo file, espressa in byte, applicata su tutti i percorsi di upload — `__<KEY>` per risorse specifiche. Un valore non intero blocca l'avvio del server | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Access key AWS | — |
| `S3_SECRET_ACCESS_KEY` | Secret key AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Impone URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | ID progetto GCP. Tipicamente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file chiave del service account. Omettere su GCP se le credenziali sono gestite tramite Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Espone pubblicamente ogni oggetto senza richiesta di token. Da utilizzare solo se il bucket funge da vera e propria CDN pubblica. Costituisce una delle tre opzioni per soddisfare il blocco all'avvio sopra descritto. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare tutti gli oggetti. Denominata `INSECURE` nell'oggetto di configurazione per ragioni di sicurezza: è applicabile unicamente in architetture single-tenant in cui tutti gli account godono della piena fiducia nell'accesso ai file. | `false` |
| `STORAGE_RENDITION_CACHE` | Attiva la memorizzazione in cache dei rendering generati per le immagini (ridimensionamenti, conversioni di formato) evitando l'elaborazione ad ogni singola richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione protetta (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato per il mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo incluso nell'intestazione dei template email predefiniti. URL assoluto `http(s)` a un file PNG o JPG — i client email escludono i file SVG e bloccano le URI in formato `data:`. Se non impostato, le applicazioni denominate `Rebase` mostrano il marchio Rebase, mentre le app con nome modificato non mostrano loghi |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Tempo di inattività in millisecondi prima della chiusura della connessione | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Timeout di connessione in millisecondi | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non mediata dal pooler). Necessaria per le funzionalità [Realtime](/docs/backend/realtime): le istruzioni `LISTEN`/`NOTIFY` non sono compatibili con pooler di transazioni quali PgBouncer; in assenza di connessione diretta, le notifiche sulle modifiche vengono disattivate con un warning anziché andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) la impiega per l'istruzione `LISTEN` di riattivazione. Assegna il valore `directConnectionString` all'adapter Postgres qualora non valorizzato. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un nodo in hot standby. Quando punta a un server dedicato, le operazioni di lettura autenticate (elenchi, righe singole, conteggi, aggregazioni) vengono smistate su di esso applicando la medesima row-level security; scritture, accessi, realtime, cron, code di elaborazione, console SQL e `rebase.sql` restano sul nodo primario. Un client che ha appena effettuato una scrittura continuerà a leggere dal primario per la durata definita da `REBASE_READ_STICKY_MS`; l'instradamento avverrà sul primario per tutti i client qualora la replica registri un disallineamento superiore a `REBASE_READ_MAX_LAG_MS` o risulti irraggiungibile. Assegna `readConnectionString` all'adapter Postgres se non valorizzato; fino alla versione 0.28 il pool verso la replica veniva istanziato senza essere mai interrogato. | — |
| `REBASE_READ_STICKY_MS` | Intervallo temporale successivo a una scrittura durante il quale le letture del medesimo utente vengono forzate sul nodo primario, assicurando che una lettura rifletta immediatamente le modifiche salvate. Parametro calcolato per singola istanza server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Soglia massima di latenza di replica oltre la quale tutte le operazioni di lettura vengono deviate sul database primario. | `1000` |
| `DATABASE_POOLED` | Impostare su `true` quando `DATABASE_URL` transita attraverso un pooler in modalità transazione come PgBouncer. Il pool non invia comandi `search_path` o `statement_timeout` alla connessione (operazioni che verrebbero rifiutate o ignorate dal pooler) e li definisce all'interno di ciascuna transazione; all'avvio assegna al ruolo database il valore predefinito `public` per `search_path` per le istruzioni esterne a transazione. Rende obbligatoria la variabile `DATABASE_DIRECT_URL`, impiegata da realtime, riattivazione del job worker, compilazione di indici, branching e console SQL. L'URL della replica viene considerato anch'esso soggetto a pooler. Utilizzare `DATABASE_POOLED__<KEY>` per specificare data source addizionali. | — |
| `REBASE_DB_POOL_MAX` | Tetto massimo applicato a ogni pool del processo, a prescindere dai valori singolarmente configurati. Accetta esclusivamente caratteri numerici: valori non formattati correttamente vengono ignorati anziché forzare un'errata serializzazione del server. | — |

### Comportamento a runtime

Parametri letti direttamente dal runtime — `rebase dev`, `rebase start` e l'immagine
server distribuita. I progetti che hanno effettuato l'eject gestiscono queste logiche
direttamente nel codice sorgente.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Impostato su `true`, esegue l'audit pianificato sulla [row-level security](/docs/rls-check#running-it-on-a-schedule), segnalando le tabelle esposte prive di policy. Il progetto deve includere `@rebasepro/rls-check` nelle proprie dipendenze: il runtime non include il pacchetto; in sua assenza l'avvio si interrompe con un errore esplicito. `false` disabilita l'analisi sul processo. | — |
| `REBASE_BASE_PATH` | Percorso base condiviso da tutti gli endpoint API. Il client deve riflettere la medesima impostazione — consultare [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Distribuisce gli asset statici/amministrativi del bundle direttamente da questo processo. Disabilitare in presenza di un CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra lo [storico delle modifiche delle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Abilita la compressione delle risposte in formato gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima ammessa per il body della richiesta, **espressa in byte** (`10485760`, non `10MB` — formati non numerici causano il blocco all'avvio anziché disabilitare il limite). `0` disattiva il controllo. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Esposizione delle specifiche OpenAPI. Accetta tre stati: se non impostata è attiva in sviluppo e disattivata in produzione; impostata su `false` la disabilita ovunque. Notare che `true` in produzione espone la **specifica** su `/api/docs` ma non la **Swagger UI** su `/api/swagger` — l'interfaccia grafica è vincolata separatamente a `NODE_ENV`. | — |
| `REBASE_METRICS` | Abilita l'endpoint delle metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge la direttiva `includeSubDomains` all'header `Strict-Transport-Security`, imponendo ai browser il rifiuto del protocollo HTTP su ogni sottodominio dell'host per sei mesi — inclusi gli host non serviti da questo processo. Abilitare esclusivamente qualora ogni sottodominio garantisca il supporto HTTPS. Valori differenti da `true`/`false` causano il blocco all'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer a protezione dell'endpoint `/metrics`. Se omesso, l'endpoint rimane accessibile a chiunque possa raggiungere la porta — configurazione idonea per reti private, non per reti pubbliche, come indicato nei log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni consentite al runtime sullo schema delle collezioni in fase di bootstrap. `ensure` (impostazione predefinita ovunque, inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai rimuovere o alterare strutture esistenti. `none` non apporta modifiche allo schema delle collezioni, ma provvede comunque alla creazione e all'aggiornamento delle tabelle di sistema del framework (auth, API key, job, cron); `REBASE_PROVISION=false` disabilita anche queste ultime. L'immagine ufficiale accetta esclusivamente questi due valori e **rifiuta l'avvio con `push`**. Nelle [architetture distribuite](/docs/deployment/split-processes) la sincronizzazione deve competere a un singolo processo, pertanto ogni altro ruolo deve dichiarare `none` per evitare il blocco dell'avvio. | `ensure` |
| `REBASE_PROVISION` | Impostato su `false`, impedisce al runtime qualsiasi modifica al database: non crea né altera tabelle, colonne, indici, funzioni, trigger, policy, ruoli o permessi, né all'avvio né in fasi successive, inclusi gli oggetti proprietari del framework. Segnala nei log gli elementi mancanti. Utile nei contesti in cui le modifiche strutturali sono delegate unicamente a pipeline di change management dedicate. Consultare [Quando il database è modificabile solo da processi dedicati](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Accetta solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Blocca l'avvio se il database risulta aggiornato da una definizione di collezioni diversa rispetto al build di questo processo. Se non impostata (o con valore diverso da `true`/`1`) emette un avviso senza bloccare l'esecuzione. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Blocca l'avvio qualora un file di custom function o di cron generi un'eccezione o fallisca il parsing in fase di importazione, indicando il file e la causa dell'errore; in questo modo un rolling deploy mantiene attiva la versione precedente. Il vincolo si applica anche ai riavvii. Se non impostata (o con valore diverso da `true`), scarta il file non valido continuando l'avvio dei restanti. I file importati correttamente che non esportano funzioni o job vengono ignorati senza generare errori. | skip |
| `REALTIME_CDC` | Change Data Capture a livello di database: `auto` (attivo se supportato dalla connessione, con fallback silente), `trigger` (imposto forzatamente, con emissione di avviso se non supportabile), `wal` (lettura dei cambiamenti tramite write-ahead log invece dei trigger; richiede `wal_level=logical` e privilegi di replica, altrimenti fallback a `trigger`), `off`. Consultare [Realtime](/docs/backend/realtime-cdc/). Ha precedenza su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Livello di trasporto condiviso tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato nel caso in cui `realtime.bus` riceva un transport preconfigurato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; le richieste eccedenti vengono rifiutate con l'errore `TOO_MANY_SUBSCRIPTIONS`. Richiede un numero intero positivo — valori non conformi bloccano il server all'avvio. Ha precedenza su `realtime.maxSubscriptionsPerSocket`. Consultare [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di socket realtime che un utente, o una singola API key, può mantenere aperti su una medesima istanza server. I socket aperti con impersonificazione da parte di un amministratore vengono imputati all'amministratore stesso. Nuove connessioni vengono rifiutate restituendo `TOO_MANY_SOCKETS` con conseguente chiusura del socket (4002); i tentativi periodici dell'SDK consentiranno l'accesso appena un socket preesistente si chiude. Richiede un intero positivo — valori differenti bloccano il server all'avvio. Ha precedenza su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo, espresso in ms, che un aggiornamento attende prima dell'esecuzione del refetch per la notifica ai subscriber attivi. Il refetch attende 300 ms in assenza di modifiche, fino a un massimo pari a questo valore in presenza di flussi continui di scrittura. Richiede un intero positivo — altri valori bloccano il boot. Ha precedenza su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo temporale, in ms, durante il quale il conteggio totale di elenchi estesi può essere riutilizzato prima di eseguire un nuovo conteggio; i messaggi che lo riusano includono l'attributo `meta.totalAsOf`. Se omesso, ogni frame ricalcola il totale. Ha priorità rispetto a `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | Soglia minima di record oltre la quale entra in funzione `REALTIME_RECOUNT_INTERVAL_MS`; le collezioni con un volume inferiore vengono ricalcolate a ogni frame. Prevale su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permette configurazioni facenti capo a `localhost`/loopback quando `NODE_ENV=production`. Disattivata per impostazione predefinita, così che un avvio di produzione generi un errore immediato anziché connettersi a database inesistenti. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Azione intrapresa all'avvio in presenza di chiavi non riconosciute da questa versione nelle collezioni: `warn`, `error` (arresto del server — consigliato in pipeline di CI) o `off`. Si applica solo a chiavi non *riconosciute*, riconducibili tipicamente a errori di battitura o metadati specifici; chiavi deprecate e spostate altrove generano sempre un errore bloccante, per evitare che la funzionalità configurata venga ignorata silenziosamente. | `warn` |
| `REBASE_PROVISION_ONLY` | Valori come `1` o `true` provocano l'esecuzione dell'aggiornamento dello schema arrestando il processo senza aprire socket — configurazione adatta all'esecuzione di Job di migrazione basati sulla medesima immagine e bundle dell'istanza principale. Provvede inoltre a creare le tabelle che il processo server genererebbe al primo utilizzo, escludendo l'avvio di cron o code di job. Valori vuoti sono trattati come *non impostati*, evitando che variabili non valorizzate come `${SOMETHING}` in un compose trasformino un server di produzione in un processo di migrazione terminante. Incompatibile con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso file. In fase di provisioning (`REBASE_PROVISION_ONLY=true`), vi scrive in sequenza tutte le modifiche allo schema sotto forma di script SQL, pronto per revisione ed esecuzione manuale con `psql`. I record inseriti non vengono esportati. Rifiutata se impostata su un processo configurato per servire traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | Se impostata su `true`, consente a processi automatici (agenti, job di CI) di *applicare* modifiche allo schema tramite `/api/admin/schema`, anziché limitarsi alla sola pianificazione. Disabilitata per impostazione predefinita: le credenziali con tali permessi sono spesso archiviate tra i segreti delle pipeline CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione concesso a una custom function prima che la richiesta venga interrotta. Corrisponde all'opzione programmatica `functionsTimeoutMs`. `0` disattiva il timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | Impostata su `true`, causa la terminazione del processo a fronte di unhandled promise rejection anziché limitarsi alla scrittura nei log. Raccomandata in ambienti dotati di orchestratore con riavvio automatico; da disabilitare se il riavvio del container ha impatti peggiori del memory leak potenziale. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Disattiva l'avviso di avvio emesso sulle piattaforme rilevate come scale-to-zero, in cui i timer pianificati non scattano se l'istanza è sospesa. Non altera altri comportamenti: impostarla se si garantisce l'esecuzione continua di almeno un'istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di reverse proxy interposti prima del server, parametro necessario al rate limiter per risalire all'IP reale del client dall'intestazione `X-Forwarded-For`. Predefinito prudenziale `0`: senza proxy attestati, considerare attendibile l'header consentirebbe a chiunque di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non sostituisce uno strumento di migrazione]
Il provisioning all'avvio viene eseguito in modalità automatica senza verifica manuale del diff, pertanto non eliminerà mai colonne, non restringerà tipi di dato né riscriverà tabelle. Per questa stessa ragione l'immagine rifiuta il parametro `REBASE_MIGRATE_ON_BOOT=push`: un comando di push completo calcola il diff ed esegue comandi distruttivi come `DROP COLUMN`, laddove il riavvio o la rischedulazione di un container non deve in alcun caso rischiare di eliminare colonne in produzione.

Le alterazioni distruttive o di rimodellazione devono avvenire in sedi verificabili: tramite `rebase db generate` + `rebase db migrate`, o `rebase db push` eseguito da terminale locale o da CI, comandi che simulano il piano d'azione (dry-run), richiedono conferma per le modifiche distruttive e offrono la possibilità di generare un backup preventivo.
:::

### Architetture a processi distribuiti (Split deployments)

Una medesima immagine e bundle possono essere avviati su istanze multiple dedicate ciascuna a specifici compiti del progetto. In questa sede sono riepilogate le variabili di riferimento; per la documentazione dettagliata su ciò che ogni combinazione *espone e gestisce* — e per le combinazioni incompatibili — consultare
**[Processi Distribuiti](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Ruolo operativo servito da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'abilitazione dei timer cron per *questo* processo. Se non impostata, segue la configurazione del ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'attivazione dei worker per le code di job in questo processo. Se non impostata, segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Esegue in questo processo esclusivamente l'elenco specificato di custom function. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Esegue tutte le custom function escludendo quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a cui il processo API inoltra le richieste per funzioni che non gestisce direttamente. Su un nodo `worker`, indica dove inoltrare le chiamate `rebase.functions`. Accetta un URL `http(s)`. | — |

### Superficie MCP

Endpoint opzionale basato su Model Context Protocol esposto su `/mcp`, configurato per consentire a client AI di interrogare e modificare il progetto **agendo con i permessi dell'utente autenticato**. Disattivato di default; a differenza delle altre interfacce, nessun valore di `REBASE_ROLE` lo abilita automaticamente: mentre i ruoli descrivono la tipologia architetturale del processo, questa interfaccia concede credenziali ad applicazioni terze, e la scelta deve essere esplicitamente effettuata da un operatore anziché ereditata dal ruolo del container.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Attiva l'interfaccia MCP. Richiede la definizione di `REBASE_PUBLIC_URL`; in caso contrario l'interfaccia non viene esposta, segnalando l'anomalia nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | Origine esterna raggiungibile di questo deployment, es. `https://app.example.com`. Non ricavabile automaticamente: derivare l'origine dall'header `Host` renderebbe l'identità dell'emittente e l'audience verificata sui token dipendenti da un valore fornito dall'utente. | — |
| `REBASE_MCP_VIEW` | Percorso alla vista personalizzata dell'applicazione MCP (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica per consentire il rendering di campi, viste e azioni personalizzate. In assenza del file, il backend ricercherà le viste accanto agli asset frontend serviti. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Abilita la registrazione dinamica dei client OAuth (RFC 7591), consentendo l'auto-iscrizione dei client. Impostare su `false` se si richiede la registrazione preventiva obbligatoria. | `true` |

### Modifica dello schema in tempo reale da bundle

Disabilitata se `REBASE_LIVE_SCHEMA_REPOSITORY` non è valorizzata. Poiché un bundle distribuito non contiene il codice sorgente originale delle collezioni, impostando queste variabili l'editor delle collezioni accessibile dall'amministratore recupererà il sorgente dal repository, vi committerà le modifiche e applicherà i comandi DDL al database. Funzionalità riservata agli amministratori, eseguita manualmente a meno che non intervenga `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`. Specificare un repository privo di credenziali valide causerà il blocco dell'avvio. Consultare
[Modifica dello schema in tempo reale](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repository GitHub su cui eseguire i commit delle modifiche allo schema, nel formato `owner/name`. La sua valorizzazione attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Ramo di destinazione dei commit. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Posizione dei sorgenti delle collezioni all'interno del repository, relativa alla radice. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token con permessi granulari di lettura e scrittura sui contenuti del repository. Utilizzare in alternativa alle tre variabili `_GITHUB_APP_*`. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID della GitHub App, per autenticare i commit a nome dell'app anziché tramite personal access token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID dell'installazione dell'applicazione sul repository indicato. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chiave privata dell'applicazione: formato PEM, PEM con caratteri di fine riga escaped, o stringa base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione Cron per la schedulazione dei backup. Se omessa, i backup automatici sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL conforme allo schema `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatoria se si attiva `BACKUP_SCHEDULE`. Il comando `rebase db backup` assume come valore predefinito `./backups` all'interno della directory di esecuzione. | — |
| `BACKUP_RETENTION_DAYS` | Periodo di retention: rimuove i backup più vecchi di N giorni. Se non impostata o su `0`, conserva l'intero storico. | — |
| `BACKUP_KEEP_MINIMUM` | Numero minimo di backup recenti da preservare in ogni circostanza, a prescindere dai criteri di retention. | — |
| `PG_DUMP_PATH` | Specifica un binario alternativo per `pg_dump` — deve corrispondere alla major release del server o a una versione più recente. | — |
| `PG_RESTORE_PATH` | Percorso alternativo per l'eseguibile `pg_restore`. | — |
| `PSQL_PATH` | Percorso alternativo per il binario `psql`, impiegato da `rebase db restore --clean` per racchiudere l'operazione di ripristino in un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione del binario `pg_dumpall`, qualora non sia individuabile nel `PATH`. In sua assenza — e senza client tools di PostgreSQL installati — il backup degli oggetti globali fallirà richiamando questa variabile d'ambiente. | — |

L'immagine ufficiale (`rebasepro/server`) integra i client tools di
PostgreSQL 18, garantendo l'esecuzione di backup pianificati verso server fino a Postgres 18.
In ambienti d'esecuzione differenti, provvedere alla loro installazione (`apt-get install postgresql-client-18`,
`brew install libpq`).

I file di backup contengono dati sensibili, credenziali e PII. Impiegare destinazioni
protette fornite di cifratura at-rest.

### Distribuzione dei bundle (Bundle delivery)

Nelle architetture gestite, l'immagine distribuita non incorpora il codice applicativo: il runtime scarica il
bundle all'avvio. Queste variabili ne determinano la sorgente e le modalità di ricezione.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso a una directory contenente un bundle pre-estratto. Impostata localmente da `rebase start`. | — |
| `REBASE_BUNDLE_URL` | Posizione da cui scaricare l'archivio del bundle qualora non sia disponibile in locale. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale Bearer per il download del bundle. Da trattare come segreto: autorizza il tenant all'acquisizione del proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Cartella di destinazione per l'estrazione del bundle. Deve disporre dei permessi di scrittura e conservare i dati nel transitorio tra ricezione e avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli addizionali messi a disposizione del bundle dall'immagine di runtime, oltre a quelli dichiarati autonomamente. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato in `config/resources.ts` viene associato
alle variabili d'ambiente corrispondenti. Lo schema di base è descritto di seguito; risorse
prive di configurazione standard aggiungono il suffisso `__` seguito dal relativo identificatore
in maiuscolo (ad esempio, un bucket denominato `media` cercherà la variabile `S3_BUCKET__MEDIA`).
Il comando `rebase status` riporta per ciascuna risorsa la variabile d'ambiente esatta
utilizzata e il relativo stato di valorizzazione.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Pacchetto npm che implementa il driver per una determinata sorgente dati, qualora non coincida con l'adapter Postgres standard. Suffissato per risorsa: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Stringa di connessione a un topic dichiarato. Riceve il suffisso corrispondente al nome del topic. | — |

### Ambiente operativo della CLI

Parametri letti direttamente dal comando `rebase`, senza impatti sul server. Nessuna di queste voci incide sull'applicazione distribuita.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Endpoint a cui `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, da shell o da `.env`. Da valorizzare quando il server è eseguito con modalità diverse da `rebase dev` locale: `rebase start`, container o host remoti. Se non definita, sfrutta le informazioni salvate dall'istanza `rebase dev` attiva, non inviando dati a server spenti. | — |
| `REBASE_SERVICE_KEY` | Service key adoperata dai comandi precedenti per l'autenticazione, letta da `.env`: corrisponde alla medesima variabile utilizzata dal server (vedere sopra). | — |
| `SERVICE_KEY` | Nomenclatura legacy per la service key. Se presente in `.env`, `rebase api-keys` e `rebase storage` le assegnano priorità rispetto a `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | File `.env` specifico da leggere e modificare tramite CLI, se diverso da quello di progetto. | — |
| `REBASE_ROOT_RULES` | Impostare su `0` per evitare che `rebase init` e `rebase skills install` aggiornino i file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile nel caso in cui i file per gli agenti siano mantenuti manualmente. | on |
| `REBASE_CLOUD_URL` | Control plane di riferimento per le comunicazioni di `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Account utilizzato da `rebase cloud login`, evitando la richiesta interattiva. | — |
| `REBASE_CLOUD_PASSWORD` | Password associata, per consentire l'iniezione automatica da password manager o secret store senza transito nella cronologia della shell. | — |
| `REBASE_TOKEN` | Token rilasciato da `rebase cloud tokens create`. Se impostato, i comandi `rebase cloud` utilizzano questo token anziché la sessione creata tramite `rebase cloud login`, senza leggere né aggiornare la sessione memorizzata. Nelle directory collegate con `rebase cloud init --claim`, viene temporaneamente ignorato in favore del token di progetto se privo di scope adeguati. Modalità raccomandata per l'uso di `rebase cloud` in CI — vedere [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo trasmette alla CLI generata dai tool cloud senza inoltrarlo all'applicazione: per quest'ultima impostare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | Impostato su `1`, visualizza il dettaglio esteso delle chiamate e l'errore originario invece del messaggio sintetico. Utile per il debug di comandi `rebase cloud` che falliscono con esiti non chiari. | — |
| `REBASE_ATLAS_DEV_URL` | Database vuoto impiegato da `rebase db push`, `db generate` e `db migrate` per la pianificazione dei diff, in sostituzione di `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né distrugge i database qui referenziati, e ne rifiuta l'uso se coincidenti con `DATABASE_URL`. Nel database di sviluppo integrato, la CLI ricorre a un'istanza temporanea PGlite in-memory. Impostare questo valore qualora l'utente sia privo del privilegio `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia database né applica migrazioni — configurazione demandata all'utente. Equivalente al flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta per il server di sviluppo del frontend, che altrimenti `rebase dev` ricava dinamicamente dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo massimo, in ms, concesso al backend per confermare l'avvio prima che `rebase dev` segnali la mancata disponibilità. `0` disattiva il controllo. | `30000` |
| `DATABASE_PASSWORD` | Password che `rebase dev --docker` inserisce nella connection string dedotta da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Standard cross-tool per la privacy. Se valorizzato a un qualsiasi valore diverso da `0`, la CLI inibisce la telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente specifico per Rebase. Non richiede la persistenza su file, risultando ideale per l'impiego in CI e all'interno di container. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint di destinazione per l'invio della telemetria in presenza di collector personalizzati. | — |

## Segreti in ambiente di sviluppo

`JWT_SECRET` è obbligatoria in produzione. In contesti non di produzione, questa variabile
e `REBASE_SERVICE_KEY` vengono generate in automatico, consentendo l'avvio immediato
senza configurazioni preliminari.

I valori generati vengono memorizzati in `.rebase-dev-secrets.json`, archiviato accanto a
`.rebase-dev-port` e `.rebase-dev-url` e tracciato nel file `.gitignore`. In precedenza
venivano ricreati a ogni avvio, provocando a ogni restart del server locale la perdita
delle sessioni attive e l'invalidazione immediata delle API key generate di recente.

- Dichiarando esplicitamente una delle due variabili, il valore definito dall'utente avrà la priorità senza letture o scritture nella cache.
- Per spostare la cache dei segreti è possibile specificare il percorso desiderato tramite `REBASE_DEV_SECRETS_FILE` — unica variabile di questa sezione che ha senso impostare manualmente.
- L'eliminazione del file comporta la rigenerazione di entrambe le chiavi al successivo boot.
- Se il file non può essere scritto (ad esempio su filesystem a sola lettura in container), il server si avvia normalmente affidandosi a segreti volatili, preservando il comportamento precedente.

Nessun dato viene memorizzato in cache in produzione o durante i test automatici. In produzione
non viene applicata alcuna generazione casuale: l'assenza di `JWT_SECRET` interrompe
il bootstrap indicando la variabile mancante:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

Il tipo `RebaseBackendConfig` passato alla funzione `initializeRebaseBackend()` consente il controllo programmatico:

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

Le medesime opzioni,
prive dei campi `app`, `server` e `basePath` e con la proprietà `provision` obbligatoria,
permettono di inizializzare un'istanza di backend disaccoppiata tramite `createRebaseBackend`.
Consultare [Integrazione Server Personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

L'alterazione di `basePath` riposiziona tutti gli endpoint esposti dall'API; è indispensabile
aggiornare conseguentemente anche il client per evitare che le richieste inviate su `/api/...`
ricevano risposte 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione adotta automaticamente il percorso dal client assegnato,
senza richiedere ulteriori interventi. Qualora le richieste HTTP vengano costruite manualmente,
è consigliabile ricavare il path dal client evitando la scrittura esplicita di `/api`:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'Editor SQL (`permission denied for table <name>`)

* **Sintomi:** L'esecuzione di query SQL personalizzate all'interno dell'editor di Rebase Studio fallisce con l'errore `cause: error: permission denied for table <name>`, sebbene la vista a foglio di calcolo del CMS restituisca i dati regolarmente.
* **Causa:** Rebase tenta di eseguire le query dell'editor SQL operando una transizione temporanea verso il ruolo applicativo PostgreSQL dell'utente connesso (es. `SET LOCAL ROLE "admin"`). Nel caso di sistemi di autenticazione custom in cui i ruoli risiedono solo su tabelle applicative senza corrispondere a ruoli PostgreSQL a livello di database, la transizione non va a buon fine o il ruolo risulta privo dei privilegi necessari. La vista CMS del gestionale, al contrario, interroga il database direttamente con i permessi del proprietario della connessione e non risente di questa impostazione.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` al file `.env` del backend. Questo parametro impone all'editor SQL di interrogare il database con i privilegi del proprietario della connessione (in genere utente con permessi di owner/superuser). L'editor SQL informerà che la lettura dei record è avvenuta tramite l'utente proprietario della connessione, disabilitando la tendina per la selezione del ruolo.

### Recupero dello schema fallito nell'Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non carica l'albero di navigazione dello schema o l'Editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necessita di privilegi amministrativi per accedere alle tabelle di catalogo di sistema del database ed eseguire comandi operativi. Se `adminConnectionString` non è valorizzata nel bootstrapper, o qualora `getAdmin()` sia ridefinita in modo da ritornare `undefined`, tali operazioni non possono essere portate a termine.
* **Soluzione:** Assicurarsi che `adminConnectionString` sia valorizzata durante l'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Fasi successive

- **[Deployment](/docs/getting-started/deployment)** — Guida alla distribuzione in produzione
- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
