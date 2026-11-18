---
sourceHash: 69431837d4a9e199
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca un valore obbligatorio o se un parametro è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende dalla modalità di esecuzione del backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema gestito dal runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di ogni tabella riportata di seguito. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })` e può aggiungere lì
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Opzionale in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria in qualsiasi altro contesto. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Usare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **Su un database gestito, `sslmode=require` potrebbe non avere il significato letterale.**
>
> Per `psql` e per tutti gli strumenti basati su libpq, `require` significa "crittografato, certificato non
> verificato". Il driver Node su cui si basa Rebase lo interpreta come `verify-full`, pertanto
> un database il cui certificato non è stato firmato da alcuna autorità pubblica — situazione comune sui database
> Postgres gestiti — rifiuta la connessione del runtime con `self-signed certificate`, mentre `psql`
> si connette usando lo stesso URL. Il runtime e i comandi `rebase db` si interrompono con un
> messaggio esplicativo a riguardo.
>
> Scegliere una delle seguenti opzioni:
>
> - **`sslmode=no-verify`** — crittografato, non verificato: ciò che `require` significa per
>   libpq. È una sintassi di node-postgres non supportata da libpq, pertanto `psql`, `pg_dump`
>   e Atlas la rifiutano con `invalid sslmode value: "no-verify"`. I comandi interni di Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la trasmettono a tali strumenti
>   come `sslmode=require`, funzionando quindi regolarmente con l'URL configurato; se si esegue `psql`
>   manualmente, sostituire con `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificato rispetto al certificato
>   CA del provider. Funziona in modo uniforme per qualsiasi strumento.
>
> Anche `uselibpqcompat=true&sslmode=require`, suggerito dall'avviso stesso del driver Node,
> funziona per il runtime; i comandi di Rebase rimuovono `uselibpqcompat` prima di
> passare l'URL agli strumenti libpq, che altrimenti lo rifiuterebbero.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedere di seguito. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Abilita "Accedi con Google". | — |

> **Lasciare `VITE_API_URL` non impostato nelle build di produzione.**
>
> In fase di sviluppo il frontend e il backend risiedono su origini separate, quindi il server
> di sviluppo inietta questo valore. In produzione il backend di Rebase serve la SPA, pertanto
> l'API coincide con l'origine della pagina stessa e il client la risolve autonomamente in questo modo.
>
> Includere un URL assoluto in un bundle di produzione funziona finché un secondo
> hostname non punta alla stessa app: a quel punto, un dominio personalizzato caricherà la pagina da
> `example.com` e chiamerà l'API su `example.rebase.website`, operazione
> cross-origin che farà fallire la richiesta di preflight di ogni chiamata. Consentire l'origine in CORS
> **non** risolverà il problema: il cookie di refresh è `SameSite=Lax` e non viene
> inviato cross-site, eliminando così gli errori in console ma lasciando comunque
> l'autenticazione compromessa. Lasciando il valore vuoto, qualsiasi dominio che punta all'app funzionerà
> senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un valore `PORT` presente in `.env` non viene letto, poiché la porta viene risolta prima del caricamento di tale file — altrimenti associa una porta derivata dal percorso del progetto, permettendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la priorità su entrambi e il banner di avvio indica la porta assegnata. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra la query SQL sottostante alle righe `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita contiene i parametri associati (ad es. un'email o un hash di password). Impostare su `true` durante la diagnosi di problemi DDL, RLS o di acquisizione delle modifiche (change-capture). Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco di origini consentite separate da virgola. **Obbligatorio in produzione** a meno che non sia impostato `FRONTEND_URL`: un avvio in produzione privo di entrambi rifiuterà di partire. In fase di sviluppo viene *aggiunto* a localhost — vedere di seguito. | — |
| `FRONTEND_URL` | URL dell'app frontend. Usato come alternativa a `CORS_ORIGINS` in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (usata per l'introspezione dello schema e per operazioni amministrative). Il database specificato non è quello considerato corrente dalla console SQL, né quello clonato da un nuovo branch per impostazione predefinita: entrambi corrispondono al database su cui risiede la connessione dell'app (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del database non sono mappati). In questo caso la console SQL di Studio segnala che le righe sono state lette come proprietario della connessione, indicandone il nome e disabilitando il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato clonato il branch su cui gira questo server. `rebase dev` lo imposta automaticamente in un checkout [posizionato su un branch](/docs/backend/branching/#cli-integration). Un server con questo valore mantiene il registro dei branch su quel database e clona i nuovi branch da esso per impostazione predefinita, mostrando nel pannello Branches di Studio i branch del database principale. | — |

#### CORS in fase di sviluppo

L'ambiente di sviluppo consente **localhost, oltre a qualunque origine specificata in `CORS_ORIGINS` (o `FRONTEND_URL`)** — lo stesso elenco impiegato in produzione, con localhost aggiunto anziché sostituito. Di conseguenza la variabile opera nello stesso modo in entrambi gli ambienti e i casi d'uso necessari in fase di sviluppo sono quelli consueti:

```bash
# Un telefono sulla LAN, la macchina di un collega, un tunnel ngrok,
# una porta inoltrata di Codespaces — tutte origini diverse da localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non corrisponde a localhost né figura nell'elenco viene rifiutata; il rifiuto viene
registrato nei log **una volta per origine** mostrando l'esatta riga necessaria per autorizzarla. Il blocco
non è una semplice precauzione formale: l'API trasmette credenziali, quindi consentire
un `Origin` arbitrario permetterebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate verso il server di sviluppo con la sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Chiave segreta per la firma dei JWT (obbligatoria in produzione, generata automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), in modo che qualsiasi servizio in possesso del JWKS possa verificare una sessione senza poter generare nuovi token. Accetta un formato PEM con ritorni a capo reali, con caratteri di escape `\n` o l'intero PEM codificato in base64. Se assente, i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'intestazione del token e nel JWKS. Modificare ogni volta che la chiave cambia: la rotazione richiede che la nuova e la vecchia chiave siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. A finestra scorrevole: ogni rotazione la rinnova, determinando per quanto tempo una sessione può sopravvivere all'**inattività**. Impostare `400d` per sessioni che devono persistere dopo lunghe assenze; i browser limitano a questo valore il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi a prescindere da questo valore: una tabella utenti vuota deve accettare un utente iniziale, che assumerà il ruolo di amministratore. In produzione (`NODE_ENV=production`) questo comportamento è bloccato: una tabella vuota rifiuterà la registrazione di bootstrap con `SETUP_REQUIRED`, il primo account creato tramite registrazione aperta sarà un account ordinario e l'amministratore dovrà essere definito tramite `REBASE_ADMIN_EMAIL` sotto o assegnato tramite la service key. Nel template `.env.example` è impostato su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di blocco generale. Chiude la finestra di bootstrap per il primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta fuori dalla produzione, impedendo la registrazione anche su un database vuoto. Da abbinare a `REBASE_ADMIN_EMAIL` di seguito, altrimenti il deployment non avrà alcun modo per generare il suo primo utente autenticato. Viene impostato in tutti gli artefatti di distribuzione preconfigurati. | — |
| `REBASE_ADMIN_EMAIL` | Indirizzo email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. È la modalità attraverso cui una distribuzione di produzione ottiene il proprio amministratore: l'operatore definisce il primo account anziché rischiare che venga registrato da terzi su Internet. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Deve contenere almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificare dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP memorizzato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e l'avvio genera un singolo avviso: la rotazione di `JWT_SECRET` disconnetterebbe tutti gli utenti rendendo *inoltre* indecifrabili tutti gli autenticatori configurati. Impostare una chiave dedicata (almeno 32 caratteri casuali) prima che gli utenti configurino l'MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la rotazione. Impostare entrambe le variabili durante una rotazione: i nuovi segreti verranno scritti con `MFA_ENCRYPTION_KEY` mentre quelli esistenti rimarranno leggibili, evitando che gli utenti restino bloccati fuori dal proprio account durante la transizione. Rimuovere dopo aver ricifrato tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). È una funzionalità opt-in e non è vincolata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per le API dei dati. Impostare su `false` per esporre un'interfaccia di sola lettura completamente pubblica — la RLS rimane comunque attiva. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato quando non ne viene specificato uno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Espone l'endpoint `POST /api/auth/find-user`, che risolve un'email restituendo un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato solo a chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente individuato. Disabilitato per impostazione predefinita, poiché costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Direttiva `SameSite` per il cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato esclusivamente a frontend effettivamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Flag `Secure` per il cookie di refresh. Attivo per impostazione predefinita; impostare `AUTH_COOKIE_SECURE=false` per connessioni in semplice HTTP (ad esempio una distribuzione su un indirizzo LAN in cui il browser scarterebbe il cookie, causando la scadenza della sessione al termine del token di accesso senza errori evidenti). Genera un avviso all'avvio. Non necessario per `http://localhost`. | `true` |
| `GOOGLE_CLIENT_ID` | ID client Google OAuth (convalida backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segreto client Google OAuth | — |
| `GITHUB_CLIENT_ID` | ID client GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Segreto client GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | ID client Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Segreto client Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | ID client LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Segreto client LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | ID client Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Segreto client Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | ID client X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Segreto client X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | ID client Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Segreto client Discord OAuth | — |
| `GITLAB_CLIENT_ID` | ID client GitLab OAuth. L'indirizzo `baseUrl` di un'istanza self-hosted non ha una variabile d'ambiente corrispondente: configurare GitLab nel blocco `auth` a tale scopo. | — |
| `GITLAB_CLIENT_SECRET` | Segreto client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Segreto client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Segreto client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Segreto client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID per l'autenticazione web. È pubblico e viene esposto in `GET /auth/config`. Apple non utilizza un segreto client statico: Rebase firma un JWT ES256 a breve durata per ogni scambio di token. Pertanto Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o ad `APPLE_BUNDLE_IDS`, e non configurerà nulla in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | Elenco di bundle ID separati da virgola per le app native iOS/macOS di cui vengono accettati i codici di Accedi con Apple. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, issuer del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi i ritorni a capo (sono accettati i caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API statica di amministrazione. Bypassa la normale autenticazione JWT per chiamate server-to-server se passata come `Authorization: Bearer <key>`. (Generata automaticamente in fase di sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) rispetto a cui verificare i token di piattaforma `rpt_`; può contenere più blocchi PEM durante una rotazione di chiavi. Viene impostata dalla piattaforma al deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE`, consente al gateway di amministrazione di accettare un token di piattaforma per `cron:read` e per nessun'altra operazione. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID di progetto a cui deve corrispondere il campo `aud` del token di piattaforma, in modo da rifiutare un token generato per un altro progetto. Se è impostata solo una delle due variabili, il server si avvia, registra un avviso e risponde a ogni token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione dei contatori del rate-limiting per le rotte di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per singolo processo) o `sql` (condiviso tra le repliche). Un processo non è in grado di rilevare autonomamente il numero di repliche attive, pertanto un'infrastruttura con più istanze deve specificarlo esplicitamente: tre repliche con il valore predefinito consentirebbero complessivamente il triplo del limite previsto. Qualsiasi altro valore **rifiuta l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso passwordless tramite link inviato via email. Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso passwordless con codice a sei cifre inviato via email. Richiede un servizio email, come sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione passwordless: una richiesta di magic-link o di codice email per un indirizzo non censito crea l'account, purché le registrazioni siano aperte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un token di refresh oltre la finestra temporale consentita: `reject` (rifiuta la richiesta, preserva la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore impedisce l'avvio del server. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con verifica preventiva: impedisce l'accesso con password fino a quando l'indirizzo email non è stato verificato. Richiede il servizio email; in assenza di esso l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Abilita la verifica captcha per le rotte di autenticazione: `turnstile` o `hcaptcha`. Se non impostata, non viene applicato alcun captcha. | — |
| `CAPTCHA_SECRET` | Chiave segreta del provider, impiegata lato server per verificare il token inviato dal browser. Obbligatoria se è impostato `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Elenco di rotte di autenticazione da proteggere separate da virgola (ad esempio `register,login`). Se non impostata, protegge le rotte predefinite del provider. | — |

### Storage

:::caution[Lo storage non dispone di sicurezza a livello di riga (RLS), pertanto richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. L'object storage non ha un equivalente
diretto — le chiavi condividono un unico namespace piatto — pertanto, configurando un bucket
senza un modello di accesso, il server **rifiuterà l'avvio in produzione**. Per soddisfare
questo requisito è necessario configurare esattamente una delle seguenti opzioni:
l'hook `storageAuthorize` esportato da `backend/storage.ts` (fornito dal template di base),
`STORAGE_PUBLIC_READ` oppure `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di storage: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso base per lo storage locale. Un percorso relativo viene risolto a partire dalla directory di esecuzione del server: la radice del progetto con `rebase dev`, oppure `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente l'uso dello storage locale in produzione — valido solo in presenza di un volume persistente contenente `STORAGE_PATH` e le directory adiacenti `<STORAGE_PATH>__<key>` per i bucket locali denominati | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durata in secondi dell'URL di download di un file privato — corrispondente al token generato da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima dei file accettati, in byte, su tutti i percorsi di upload — `__<KEY>` per le sorgenti denominate. Se non corrisponde a un numero intero di byte, l'avvio viene rifiutato | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza URL in path-style per i bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Normalmente rilevato in automatico dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file delle chiavi del service account. Omettere su GCP se le credenziali sono fornite da Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce ogni oggetto pubblicamente a chiunque, senza token. Da usare esclusivamente per bucket adibiti a CDN pubblica. È una delle tre opzioni per superare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Denominata `INSECURE` nell'oggetto di configurazione per un motivo preciso: è giustificabile solo in app single-tenant in cui ogni account è autorizzato ad accedere a ogni file. | `false` |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache le varianti grafiche generate (ridimensionamenti, conversioni di formato) invece di rigenerarle a ogni richiesta. | `false` |

### Email (Opzionale)
<span class="since-badge" data-since="0.34">Dalla versione 0.34</span> `MAGIC_LINK_URL`.

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita la connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato associato all'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo posizionato in testa ai template email predefiniti. Deve essere un URL assoluto `http(s)` PNG o JPG — i client email rimuovono gli SVG e bloccano gli URI `data:`. Se non impostata, un'app denominata `Rebase` mostrerà il marchio Rebase, mentre un'app rinominata non mostrerà alcun logo |
| `MAGIC_LINK_URL` | Destinazione del magic link inviato per email. A un percorso base viene aggiunto `/auth/magic-link?token=…`; se l'URL contiene `{token}`, costituirà l'intero link (utile per un frontend che non gestisce `/auth/magic-link`). Racchiudere tra virgolette in `.env`, dove un `#` non quotato avvia un commento: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valore contenente un cancelletto o un percorso file privo di `{token}` genera un avviso all'avvio. Se non impostata, la base corrisponde a `FRONTEND_URL` |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per ottenere una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pooler). [Realtime](/docs/backend/realtime) ne richiede una: `LISTEN`/`NOTIFY` non funziona attraverso pooler in modalità transazione come PgBouncer e, in sua assenza, le notifiche delle modifiche vengono disattivate con un avviso invece di essere perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene su di essa il proprio `LISTEN` di riattivazione. Valorizza il campo `directConnectionString` dell'adapter Postgres quando non configurato. | — |
| `DATABASE_READ_URL` | Replica di sola lettura, come un hot standby. Se valorizzata con un altro server, le operazioni di lettura autenticate (elenchi, righe singole, conteggi, aggregazioni) vengono gestite da tale replica con le medesime regole RLS; scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sull'istanza primaria. Un utente che ha appena effettuato una scrittura leggerà dalla primaria per un intervallo pari a `REBASE_READ_STICKY_MS`, e tutti gli utenti faranno altrettanto qualora il ritardo della replica superi `REBASE_READ_MAX_LAG_MS` o in caso di errore della replica. Valorizza il campo `readConnectionString` dell'adapter Postgres se vuoto; fino alla versione 0.28 compresa, il pool della replica veniva aperto ma mai utilizzato per le letture. | — |
| `REBASE_READ_STICKY_MS` | Durata temporale successiva a una scrittura durante la quale le letture dello stesso utente vengono instradate sull'istanza primaria, assicurando che un salvataggio seguito da un elenco rifletta immediatamente i dati salvati. Valore per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Ritardo massimo consentito per la replica oltre il quale ogni lettura viene instradata sull'istanza primaria. | `1000` |
| `DATABASE_POOLED` | Impostare su `true` quando `DATABASE_URL` transita attraverso un pooler in modalità transazione come PgBouncer. Il pool non invierà `search_path` o `statement_timeout` alla connessione (il pooler li rifiuterebbe o scarterebbe) e imposterà entrambi all'interno di ogni transazione; all'avvio viene assegnato al ruolo del database un `search_path` predefinito pari a `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatoria e viene utilizzata da realtime, dalla riattivazione del job worker, dalla compilazione degli indici, dai branch e dalla console SQL. Anche l'URL della replica viene considerato in pool. Usare `DATABASE_POOLED__<KEY>` per configurare un'altra sorgente dati. | — |
| `REBASE_DB_POOL_MAX` | Tetto massimo applicato a ogni pool del processo, a prescindere dal valore richiesto singolarmente. Accetta solo cifre numeriche: un valore malformato viene ignorato per evitare di serializzare involontariamente l'intero server. | — |

### Comportamento del runtime

Configurazioni lette dal runtime — `rebase dev`, `rebase start` e l'immagine
del server pubblicata. Un progetto che ha eseguito l'eject gestisce queste scelte direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | Impostata su `true`, esegue l'[audit di row-level security](/docs/rls-check#running-it-on-a-schedule) programmato, che segnala le tabelle esposte senza criteri di sicurezza. Il progetto deve dichiarare `@rebasepro/rls-check` tra le dipendenze: il runtime non include il pacchetto internamente e, se assente, l'avvio viene bloccato specificando il componente mancante. Con `false` la scansione non viene eseguita sul processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Su un cluster condiviso è consigliabile assegnare a ogni progetto un ruolo dedicato. Il database registra il ruolo con cui viene eseguito: un avvio configurato con un ruolo diverso rifiuterà di partire finché non viene eseguito `rebase db request-role migrate`. Vedere [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | Con `auto` crea il ruolo di richiesta e consente alla connessione di passare ad esso; con `never` delega la gestione di entrambi all'amministratore, limitandosi a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | Privilegi concessi da Rebase al ruolo di richiesta: `schema` (ogni tabella negli schemi serviti, inclusi i privilegi predefiniti), `managed` (solo le tabelle gestite) oppure `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | Con `requestRole` limita le policy permissive di Rebase al solo ruolo di richiesta, impedendo che altri ruoli che leggono le medesime tabelle ne beneficino. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | Con `public` definisce le policy destinate al server o agli amministratori come `TO public`, eseguendo le richieste degli admin con il ruolo di richiesta ordinario. Come impostazione predefinita sono impostate come `TO rebase_admin`, permettendo alle letture degli utenti autenticati con ambito proprietario di usare l'indice del proprietario. Vedere [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | Se impostata su `false`, rimuove la policy di base server-o-admin da tutte le tabelle. | `true` |
| `REBASE_RLS_IDENTITY` | Con `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, consentendo alle policy scritte con `auth.uid()` di identificare il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio se un altro login può passare al ruolo di richiesta: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso base per tutte le rotte API. Anche il client deve essere configurato con lo stesso valore — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve gli asset statici/amministrativi del bundle da questo processo. Disattivare se è presente una CDN davanti all'applicazione. | `true` |
| `REBASE_HISTORY` | Registra lo [storico delle modifiche delle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compressione gzip/brotli per le risposte. | `true` |
| `REBASE_PUSH` | Se `true`, attiva le [notifiche push](/docs/backend/push-notifications/): le rotte `/api/push`, la tabella `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Coppia di chiavi VAPID per la firma dei messaggi push. Al di fuori della produzione viene generata automaticamente e salvata in `.rebase-dev-secrets.json` se assente; in produzione le notifiche push restano disattivate senza queste chiavi. | — |
| `REBASE_VAPID_SUBJECT` | Un indirizzo `mailto:` o un URL `https://` a cui i servizi push possono fare riferimento. Il valore predefinito è l'origine di un `REBASE_PUBLIC_URL` in `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (es. `10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché disabilitare silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Esposizione della documentazione OpenAPI. Configurazione a tre stati. Se non impostata, in tutti gli ambienti: `/api/docs` viene mostrato solo ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, limitandosi alle tabelle descritte, e non è presente alcuna interfaccia grafica Swagger UI. Se `true`, pubblica l'intero documento a tutti, abilitando la **Swagger UI** su `/api/swagger` fuori dalla produzione (mai in produzione). Se `false`, mantiene la documentazione protetta dall'autenticazione di amministrazione. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'intestazione `Strict-Transport-Security`, imponendo ai browser di rifiutare HTTP non cifrato su ogni sottodominio dell'host per sei mesi — inclusi host non serviti da questo processo. Abilitare esclusivamente se ogni sottodominio del dominio supporta unicamente HTTPS. Valori diversi da `true`/`false` bloccano l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a protezione di `/metrics`. Se non impostato, l'endpoint rimane aperto a chiunque raggiunga la porta — accettabile su una rete privata, non su una pubblica (l'avvio segnala questa condizione nei log). | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni consentite al runtime sullo schema delle tabelle all'avvio. `ensure` (il valore predefinito ovunque, inclusa la produzione) esegue la sincronizzazione **additiva**: crea tabelle, colonne e tipi enum mancanti, senza mai rimuovere o riscrivere elementi esistenti. `none` non modifica lo schema delle tabelle dichiarate, ma crea e aggiorna comunque le tabelle del framework (auth, API key, job, cron); `REBASE_PROVISION=false` disattiva anche queste ultime. L'immagine ufficiale accetta solo queste due modalità e **rifiuta l'avvio con `push`**. In un [deployment distribuito](/docs/deployment/split-processes) un unico processo può effettuare il provisioning: tutti gli altri ruoli devono impostare `none` o falliranno l'avvio. | `ensure` |
| `REBASE_PROVISION` | Se impostata su `false`, impedisce al runtime di apportare qualsiasi modifica al database: tabelle, colonne, indici, funzioni, trigger, policy, ruoli o permessi non verranno toccati, all'avvio o successivamente, compresi quelli interni del framework. Viene invece riportato nei log ciò che risulta mancante. Ideale per database in cui le modifiche strutturali sono delegate unicamente a pipeline esterne. Vedere [Quando solo i processi dedicati possono modificare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Accetta unicamente `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Blocca l'avvio se il database è stato inizializzato con un set di tabelle differente rispetto a quello con cui è stato compilato il processo corrente. Se non impostata (o con valori diversi da `true`/`1`), genera semplicemente un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Blocca l'avvio se un file di funzione o di cron genera un'eccezione o fallisce il parsing in fase di importazione, indicando il file e la causa dell'errore, in modo che un rolling deploy mantenga in esecuzione la versione precedente. Il vincolo si applica anche ai riavvii. Se non impostata (o con valori diversi da `true`), ignora il file problematico e serve i restanti. Un file importato correttamente che non esporta funzioni o job viene sempre ignorato senza interrompere l'avvio. | skip |
| `REALTIME_CDC` | Acquisizione modifiche a livello di database: `auto` (legge le modifiche dal WAL se consentito dal database, altrimenti usa i trigger, altrimenti ricorre alla gestione a livello applicativo, registrando ogni fallback come info), `trigger` (forza l'uso dei trigger, avvisa se impossibile), `wal` (legge le modifiche dal write-ahead log invece che dai trigger; richiede `wal_level=logical` e un ruolo abilitato alla replica, altrimenti ricorre a `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha precedenza su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Meccanismo di trasporto tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato se a `realtime.bus` è stata fornita un'istanza di trasporto custom. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; le richieste eccedenti vengono rifiutate con `TOO_MANY_SUBSCRIPTIONS`. Deve essere un numero intero positivo — qualsiasi altro valore blocca l'avvio del server. Ha precedenza su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di socket realtime che un utente, o una chiave API, può mantenere aperti su una singola istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore. Il socket successivo vedrà l'autenticazione rifiutata con `TOO_MANY_SOCKETS` e verrà chiuso (4002); l'SDK eseguirà ulteriori tentativi, connettendosi non appena un altro socket viene liberato. Deve essere un numero intero positivo — qualsiasi altro valore blocca l'avvio del server. Ha precedenza su `realtime.maxSocketsPerUser`. | Illimitato |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa prima che una modifica attivi la riacquisizione dei dati per i client connessi, in ms. La sincronizzazione attende 300 ms in assenza di modifiche, e al massimo questo intervallo in presenza di un flusso costante di scritture. Numero intero positivo — qualsiasi altro valore blocca l'avvio. Ha precedenza su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tempo di riutilizzo del totale per sottoscrizioni a liste estese prima di eseguire un nuovo conteggio, in ms; i payload che riutilizzano il valore includono `meta.totalAsOf`. Se non impostata, il conteggio viene ricalcolato su ogni frame. Ha precedenza su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | Soglia minima dell'ultimo totale rilevato a cui applicare `REALTIME_RECOUNT_INTERVAL_MS`; le liste con dimensioni inferiori vengono conteggiate a ogni aggiornamento. Ha precedenza su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback con `NODE_ENV=production`. Disattivata per impostazione predefinita, in modo che un avvio di produzione fallisca esplicitamente anziché tentare di connettersi a un database non raggiungibile. | `false` |
| `REBASE_PROVISION_ONLY` | Con `1`/`true` esegue le operazioni di allineamento dello schema ed esce senza aprire porte di rete — ideale per l'esecuzione come Job di migrazione, basato sulla medesima immagine e bundle del server che verrà avviato successivamente. Crea inoltre le tabelle che un processo applicativo genererebbe al primo utilizzo, senza attivare cron o code di job. Una stringa vuota equivale a *non impostata*, evitando che una variabile `${SOMETHING}` non valorizzata in docker-compose trasformi un normale deploy in un job di sola migrazione. Incompatibile con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso di un file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) scriverà in questo file tutte le modifiche allo schema apportate, in sequenza ordinata, sotto forma di script SQL pronto per revisione e applicazione tramite `psql`. I dati inseriti non vengono inclusi. Rifiutata se usata su un processo attivo per il traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | Se `true`, consente a un processo automatico — un agente, un job di CI — di *applicare* direttamente le modifiche allo schema tramite `/api/admin/schema`, non solo di pianificarle. Disattivata salvo esplicita abilitazione: le credenziali autorizzate a tale operazione sono quelle più frequentemente esposte nelle variabili di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo concesso a una funzione personalizzata prima dell'interruzione della richiesta. Corrisponde all'opzione `functionsTimeoutMs`. `0` disattiva il timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | Con `true`, una rejected promise non gestita causa la terminazione del processo anziché una semplice voce di log. Consigliata sotto orchestratori che gestiscono il riavvio automatico; sconsigliata in ambienti dove il riavvio è più problematico di un leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Disattiva l'avviso di avvio sulle piattaforme identificate dal runtime come ambienti scale-to-zero, nei quali un timer che scatta in un'istanza inattiva non verrebbe eseguito da nessuna parte. Non modifica altri comportamenti: impostare se si mantiene sempre almeno un'istanza costantemente attiva. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy interposti prima di questo server, necessario affinché il rate limiter possa estrarre il reale indirizzo del client da `X-Forwarded-For`. Predefinito prudenziale `0`: senza proxy, fidarsi dell'intestazione consentirebbe a qualsiasi client di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è di tipo additivo e non sostituisce uno strumento di migrazione]
La procedura di avvio viene eseguita senza supervisione umana e senza revisione di un diff, pertanto
non eliminerà mai colonne, non restringerà tipi di dato né riscriverà tabelle. Questo è anche
il motivo per cui l'immagine ufficiale rifiuta l'impostazione `REBASE_MIGRATE_ON_BOOT=push`: un push completo
calcola un diff e può eseguire liberamente istruzioni `DROP COLUMN`, mentre il riavvio di un container
non deve mai rischiare di eliminare una colonna di produzione come conseguenza della rischedulazione.

Le modifiche distruttive o strutturali devono essere effettuate dove possono essere esaminate:
`rebase db generate` + `rebase db migrate`, oppure `rebase db push` da una copia locale o da CI,
che simulano preventivamente la modifica, bloccano le operazioni distruttive in assenza di conferma
e possono generare un backup preventivo.
:::

### Distribuzioni separate (Split deployments)

Una singola immagine e un singolo bundle possono essere avviati più volte, destinando ciascuna istanza
a una specifica area del progetto. Vengono qui riassunte le variabili relative; per i dettagli
su cosa ogni combinazione *espone e gestisce* — e quali combinazioni non sono ammesse all'avvio — consultare
**[Processi separati](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Area servita da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron su *questo* processo. Se non impostata, segue quanto definito dal ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job su questo processo. Se non impostata, segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Gestisce esclusivamente le funzioni personalizzate indicate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Gestisce tutte le funzioni personalizzate eccetto quelle indicate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a cui il processo API inoltra le richieste per funzioni non gestite localmente. Su un `worker`, indica dove indirizzare le chiamate interne `rebase.functions`. Deve essere un URL `http(s)`. | — |

### Interfaccia MCP

Un endpoint opzionale per il Model Context Protocol su `/mcp`, per consentire a un client AI di leggere
e scrivere sui dati di questo progetto **con l'identità dell'utente autenticato**. È disattivato salvo esplicita
abilitazione e — a differenza degli altri servizi — nessun valore di `REBASE_ROLE` lo attiva automaticamente:
gli altri ruoli configurano la struttura del processo, mentre l'accesso MCP rappresenta la scelta di delegare
credenziali a software di terze parti, decisione che deve essere esplicitamente presa da una persona e non
derivata dal ruolo di un container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Abilita l'interfaccia MCP. Richiede `REBASE_PUBLIC_URL`; in caso contrario l'interfaccia non viene montata e l'evento viene segnalato nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine pubblicamente raggiungibile di questo deployment, ad es. `https://app.example.com`. L'interfaccia MCP non può dedurla autonomamente: ricavarla dall'header `Host` renderebbe l'identità dell'issuer, e l'audience rispetto a cui i token vengono convalidati, un parametro arbitrario fornito dal client. | — |
| `REBASE_MCP_VIEW` | Percorso della vista MCP personalizzata del progetto (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica in modo da esporre le viste, i campi e le azioni personalizzate. Se omessa, il backend cerca accanto al frontend distribuito. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere la pre-registrazione manuale dei client. | `true` |

### Modifica dello schema in tempo reale da bundle compilato

Disattivata se non è impostata la variabile `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilato non dispone
dei file sorgente in `backend/schema` da modificare; valorizzando queste opzioni, l'editor dello schema
legge i sorgenti direttamente dal repository, crea un commit per ogni modifica e applica le istruzioni DDL
sul database. Funzionalità riservata agli amministratori, applicata manualmente a meno che
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` non stabilisca diversamente. Se viene configurato un repository senza
credenziali valide, l'avvio viene bloccato. Vedere
[Modifica dello schema dal vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare i commit delle modifiche allo schema, nel formato `owner/name`. L'impostazione di questa variabile attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui eseguire il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione di `backend/schema` all'interno del repository, con percorso relativo. Un percorso che esce dalla struttura del repository blocca l'avvio, così come la variabile deprecata `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token ad accesso granulare (fine-grained) con permessi di lettura e scrittura sui contenuti del repository. Impostare questo token o le tre variabili `_GITHUB_APP_*`, non entrambi i metodi. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per effettuare i commit tramite l'applicazione anziché con un token personale. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'ID di installazione dell'applicazione sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chiave privata dell'applicazione: PEM, PEM con ritorni a capo convertiti in escape, o in formato base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se omessa, i backup automatici sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale o URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatoria se è impostata `BACKUP_SCHEDULE`, che non viene avviata in sua assenza. Il comando `rebase db backup` usa come fallback la cartella `./backups` relativa al punto di esecuzione. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostata o impostata a `0`, tutti i backup vengono conservati indefinitamente. | — |
| `BACKUP_KEEP_MINIMUM` | Garantisce la conservazione di almeno N backup più recenti, indipendentemente dalla retention temporale configurata. | — |
| `PG_DUMP_PATH` | Sovrascrive il percorso dell'eseguibile `pg_dump` — deve corrispondere alla major version del server o a una più recente. | — |
| `PG_RESTORE_PATH` | Sovrascrive il percorso dell'eseguibile `pg_restore`. | — |
| `PSQL_PATH` | Sovrascrive il percorso dell'eseguibile `psql` utilizzato da `rebase db restore --clean` per incapsulare il ripristino in un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Percorso dell'eseguibile `pg_dumpall`, se non incluso nel `PATH` di sistema. In sua assenza — e senza i client tools di PostgreSQL installati — il backup delle impostazioni globali fallirà con un errore che fa riferimento a questa variabile. | — |

L'immagine ufficiale del runtime (`rebasepro/server`) include gli strumenti client
di PostgreSQL 18, pertanto un backup pianificato eseguito al suo interno è compatibile con qualsiasi server fino a Postgres 18.
All'esterno dell'immagine, è necessario installarli autonomamente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono dati sensibili e PII. Utilizzare destinazioni private protette da
crittografia dei dati a riposo (at-rest).

### Distribuzione del bundle

Nelle distribuzioni gestite il codice dell'applicazione non è contenuto nell'immagine: il runtime
scarica il bundle all'avvio. Le variabili seguenti regolano la selezione e la modalità di recupero del bundle.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una directory contenente un bundle già estratto. Impostato localmente da `rebase start`. | — |
| `REBASE_BUNDLE_URL` | URL da cui scaricare l'archivio del bundle in assenza di un percorso locale. | — |
| `REBASE_BUNDLE_TOKEN` | Token bearer di autorizzazione per il download. Da trattare come credenziale segreta: autorizza il tenant a scaricare il proprio codice sorgente. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Percorso in cui viene estratto il bundle scaricato. Deve essere scrivibile e persistere tra la fase di recupero e l'avvio effettivo. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi resi disponibili dall'immagine del runtime al bundle, oltre a quelli dichiarati autonomamente. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato in `backend/resources.ts` viene
associato a variabili d'ambiente con prefisso corrispondente. I nomi di base sono indicati di seguito;
una risorsa non predefinita richiede l'aggiunta di `__` seguito dal relativo identificatore in lettere maiuscole:
ad esempio, un bucket denominato `media` leggerà `S3_BUCKET__MEDIA`. Il comando `rebase status`
mostra, per ogni risorsa, l'esatta variabile considerata e se essa risulti impostata o meno.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver per una specifica sorgente dati, quando differente dal driver Postgres predefinito. Con suffisso per sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Stringa di connessione per un topic dichiarato. Con suffisso per topic. | — |

### Ambiente della CLI

Variabili lette dal comando `rebase`, non dal server applicativo. Nessuna di queste voci influisce sui deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Endpoint a cui i comandi `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, impostabile nella shell o in `.env`. Da configurare se il server viene eseguito con modalità diverse da `rebase dev` all'interno del progetto: tramite `rebase start`, all'interno di un container o su un altro host. Se omessa, viene usato il server registrato da `rebase dev` finché esso resta attivo, non inviando nulla in caso contrario. | — |
| `REBASE_SERVICE_KEY` | La service key con cui si autenticano i comandi sopra indicati, letta da `.env`: è la stessa variabile impiegata dal server (vedere sopra). | — |
| `SERVICE_KEY` | Denominazione precedente della stessa chiave. Se configurata in `.env`, `rebase api-keys` e `rebase storage` la leggono in sostituzione di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | File `.env` personalizzato letto e aggiornato dalla CLI, se diverso da quello del progetto. | — |
| `REBASE_ROOT_RULES` | Con `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole di progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile nel caso in cui i file per gli agenti siano gestiti a mano. | on |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Account impiegato per l'autenticazione con `rebase cloud login`, evitando la richiesta interattiva. | — |
| `REBASE_CLOUD_PASSWORD` | Password associata all'account precedente, consentendone il passaggio tramite secret store senza lasciarne traccia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Token generato tramite `rebase cloud tokens create`. Se impostato, tutti i comandi `rebase cloud` si autenticano mediante questo token bypassando la sessione creata con `rebase cloud login`, senza leggere o sovrascrivere la sessione memorizzata. In una directory collegata con `rebase cloud init --claim`, viene temporaneamente accantonato a favore del token specifico del progetto qualora non contenga i permessi necessari su di esso. È la modalità consigliata per eseguire `rebase cloud` in ambienti di CI — consultare [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI creata dai suoi cloud tool e non lo invia mai all'app: a tale scopo utilizzare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | Impostato su `1`, mostra l'errore completo sottostante e i dettagli della richiesta HTTP anziché il messaggio sintetico. È la prima opzione da abilitare in caso di fallimento imprevisto di un comando `rebase cloud`. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto su cui `rebase db push`, `db generate` e `db migrate` pianificano le modifiche, in alternativa al database `<db>_dev_diff` creato automaticamente a fianco di `DATABASE_URL`. Rebase non crea né distrugge un database indicato con questa variabile, e rifiuterà un valore coincidente con `DATABASE_URL`. Nel caso del database di sviluppo gestito, la CLI assegna automaticamente un'istanza PGlite temporanea in-memory. Utile in contesti in cui non è concesso il privilegio `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue provisioning — la configurazione dell'istanza è a carico dell'utente. Equivale al flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta per il server di sviluppo del frontend, che altrimenti `rebase dev` calcola a partire dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo massimo concesso a `rebase dev` per attendere che il backend segnali l'avvenuta attivazione prima di riportare un avviso di mancato avvio. `0` disattiva il controllo. | `30000` |
| `DATABASE_PASSWORD` | Password inserita da `rebase dev --docker` nella stringa di connessione ricavata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione standard tra strumenti di sviluppo. Se impostata con qualsiasi valore diverso da `0`, la CLI non trasmette dati di telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente alla precedente, specifica per Rebase. Non richiede un file dedicato ed è la soluzione raccomandata per ambienti di CI e immagini container. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint a cui inviare la telemetria, qualora si utilizzi un collector self-hosted. | — |

## Segreti in fase di sviluppo

`JWT_SECRET` è obbligatorio in produzione. Insieme a `REBASE_SERVICE_KEY`, viene generato
automaticamente in fase di sviluppo, permettendo di iniziare senza configurazioni manuali.

I valori generati vengono memorizzati nella cache locale in `.rebase-dev-secrets.json`, posizionato
accanto a `.rebase-dev-port` e `.rebase-dev-url` e ignorato da Git assieme a questi ultimi. Nelle versioni
precedenti tali segreti venivano rigenerati a ogni avvio — comportando la disconnessione
dall'applicazione e invalidando qualsiasi API key generata in precedenza.

- Configurando esplicitamente una delle variabili viene utilizzato il valore fornito; nulla viene letto o salvato in cache.
- Per modificare la posizione del file di cache è disponibile `REBASE_DEV_SECRETS_FILE` — percorso su file system,
  ed è l'unica variabile di questa sezione che ha senso configurare manualmente.
- Eliminando il file i due segreti vengono rigenerati. Al successivo avvio verrà creato un file pulito.
- Nel caso in cui il file non sia scrivibile — come all'interno di un container in sola lettura — il server si avvia
  ugualmente impiegando un segreto effimero in memoria.

Nessun dato viene memorizzato in cache in produzione o sotto un test runner. In produzione non viene
generato alcun valore automatico: l'avvio privo di `JWT_SECRET` fallisce esplicitamente indicando la variabile mancante:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

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
senza `app`, `server` e `basePath` e con il parametro `provision` obbligatorio, consentono di istanziare un
backend disaccoppiato che non risponde a richieste finché non viene montato: `createRebaseBackend`. Vedere
[Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

L'opzione `basePath` sposta la radice di ogni rotta API, pertanto è necessario allineare la configurazione del client —
in caso contrario continuerà a chiamare `/api/...`, ricevendo un errore 404 per qualsiasi risorsa:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione eredita questa impostazione dal client associato, senza richiedere interventi
ulteriori. Qualora sia necessario costruire manualmente l'URL di una richiesta, ricavarlo dal client
anziché inserire `/api` come stringa fissa:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con l'errore `cause: error: permission denied for table <name>`, sebbene la vista a tabella del CMS carichi i dati regolarmente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le interrogazioni nell'editor SQL modificando temporaneamente il ruolo del database per farlo corrispondere al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Nel caso in cui si utilizzi un sistema di autenticazione personalizzato in cui i ruoli risiedono solo nelle tabelle e non come ruoli reali di PostgreSQL, il cambio di ruolo fallisce o mancano i relativi privilegi a livello di database. La visualizzazione a tabella del CMS bypassa questo passaggio eseguendo le query come utente proprietario predefinito della connessione.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` al file `.env` del backend. Questa impostazione impone a Rebase di eseguire le query dell'editor SQL utilizzando direttamente i privilegi del proprietario della connessione (in genere un superuser/owner). L'editor SQL mostrerà un'indicazione sopra i risultati specificando che sono stati letti con i permessi del proprietario della connessione, disattivando il selettore dei ruoli.

### Errore nel caricamento dello schema nell'editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'editor SQL restituisce `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necessita di privilegi amministrativi per interrogare i cataloghi di sistema di PostgreSQL ed eseguire istruzioni di amministrazione. Se `adminConnectionString` non viene passata al bootstrapper, o se il metodo `getAdmin()` viene sovrascritto restituendo `undefined`, queste operazioni non vanno a buon fine.
* **Soluzione:** Verificare che `adminConnectionString` sia valorizzata durante l'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Passaggi successivi

- **[Distribuzione](/docs/getting-started/deployment)** — Guida alla distribuzione in produzione
- **[Panoramica del backend](/docs/backend)** — Documentazione completa per la configurazione del backend
