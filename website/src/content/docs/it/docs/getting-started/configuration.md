---
sourceHash: bafbb63e7ad2ac20
title: Ambiente e Configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> qualsiasi parametro obbligatorio risulta mancante o non valido (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come viene eseguito il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di ciascuna tabella sottostante. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })`, e può aggiungervi le
> proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Facoltativa in sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i relativi dati in `.rebase/`. Obbligatoria in qualsiasi altro contesto. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **Su un database gestito, `sslmode=require` potrebbe non significare ciò che sembra.**
>
> Per `psql` e qualsiasi strumento basato su libpq, `require` significa "crittografato, certificato
> non verificato". Il driver Node su cui gira Rebase lo interpreta come `verify-full`, pertanto un
> database il cui certificato non è stato firmato da alcuna autorità pubblica — caso comune su
> Postgres gestito — rifiuta il runtime con `self-signed certificate`, mentre `psql`
> si connette con lo stesso URL. Il runtime e i comandi `rebase db` si interrompono con un
> messaggio che segnala questo problema.
>
> Scegli un'opzione:
>
> - **`sslmode=no-verify`** — crittografato, non verificato: ciò che `require` significa per
>   libpq. È una sintassi di node-postgres non presente in libpq, pertanto `psql`, `pg_dump`
>   e Atlas la rifiutano con `invalid sslmode value: "no-verify"`. I comandi di Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la trasmettono a tali strumenti come
>   `sslmode=require`, funzionando quindi con l'URL configurato; per usare `psql` manualmente,
>   sostituirla con `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificato rispetto al certificato
>   CA del provider. Uguale per ogni strumento.
>
> `uselibpqcompat=true&sslmode=require`, suggerito dall'avviso stesso del driver Node,
> funziona anche per il runtime; i comandi di Rebase rimuovono `uselibpqcompat`
> prima di passare l'URL agli strumenti libpq, che altrimenti lo rifiuterebbero.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API di backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedi sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | ID client OAuth di Google. Abilita "Accedi con Google". | — |


> **Lascia `VITE_API_URL` non impostata nelle build di produzione.**
>
> In sviluppo, il frontend e il backend hanno origini separate, quindi il server di sviluppo
> inietta questa variabile. In produzione, il backend di Rebase serve la SPA, quindi l'API
> coincide con l'origine stessa della pagina e il client la risolve autonomamente in questo modo.
>
> Fissare un URL assoluto in un bundle di produzione funziona finché un secondo
> hostname non punta alla stessa applicazione: un dominio personalizzato caricherebbe quindi la pagina da
> `example.com` ed effettuerebbe chiamate API su `example.rebase.website`, che è
> cross-origin, facendo fallire ogni richiesta di preflight. Consentire l'origine in CORS
> **non** risolve comunque il problema: il cookie di refresh è `SameSite=Lax` e non
> viene inviato cross-site, quindi gli errori in console sparirebbero ma l'autenticazione
> resterebbe comunque non funzionante. Lasciandola non impostata, qualsiasi dominio che punti all'applicazione
> funziona senza richiedere alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un valore `PORT` in `.env` non viene letto lì, poiché la porta viene risolta prima del caricamento di tale file — e in alternativa esegue il bind su una porta ricavata dal percorso del progetto, consentendo l'esecuzione di più progetti contemporaneamente. `rebase dev --port` ha la precedenza su entrambi, e il banner di avvio indica quale sia stato utilizzato. | `3001` |
| `LOG_LEVEL` | Verbosità del logging: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra la query SQL sottostante a una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene censurata per impostazione predefinita, poiché una query fallita include i parametri associati — un'email, un hash di password. Impostare su `true` durante la diagnosi di errori DDL, RLS o di change-capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatorio in produzione** a meno che non sia impostato `FRONTEND_URL`: un avvio in produzione senza nessuno dei due rifiuterà di partire. In fase di sviluppo viene *aggiunto a* localhost — vedi sotto. | — |
| `FRONTEND_URL` | URL dell'app frontend. Utilizzato come alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e per le operazioni di amministrazione). Il database indicato non è quello considerato corrente dalla console SQL, né quello copiato per impostazione predefinita da un nuovo branch: entrambi corrispondono al database su cui si trova la connessione dell'app stessa (vedi `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo (role-switching) di PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli DB non sono mappati). La console SQL di Studio indicherà quindi che le righe sono state lette come proprietario della connessione, nominandolo, e disabiliterà il relativo selettore di ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui gira questo server. `rebase dev` lo imposta su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server che lo utilizza mantiene il registro dei branch su quel database e copia i nuovi branch da esso per impostazione predefinita, facendo sì che il pannello Branches di Studio mostri i branch del database principale. | — |

#### CORS in sviluppo

In sviluppo sono consentiti **localhost più qualsiasi valore specificato in `CORS_ORIGINS` (o `FRONTEND_URL`)**
— lo stesso elenco utilizzato in produzione, con localhost aggiunto anziché
sostituito. Di conseguenza, la variabile funziona allo stesso modo in entrambi gli ambienti, e i
casi che ne richiedono l'uso in fase di sviluppo sono quelli consueti:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non sia né localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con la riga esatta che la abiliterebbe. Il rifiuto
non è pura precauzione fine a se stessa: l'API invia credenziali, pertanto riflettere un
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate verso il server di sviluppo sfruttando la sua sessione e leggendone le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Segreto per la firma JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), in modo che qualsiasi entità in possesso del JWKS possa verificare una sessione senza poterla generare. Accetta un PEM con newline reali, un PEM con sequenze di escape `\n`, o l'intero PEM codificato in base64. In sua assenza, i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificalo ogni volta che la chiave cambia: la rotazione dipende dalla possibilità di distinguere tra la vecchia e la nuova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. A finestra scorrevole: ogni rotazione la rinnova, quindi governa la durata di una sessione in caso di **inattività**. Impostare `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser pongono qui il limite massimo per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione, il **primo** utente può sempre registrarsi, indipendentemente da questa impostazione: una tabella utenti vuota deve pur consentire l'accesso a qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) tale finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, il primo account creato tramite registrazione aperta è un account ordinario, e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` sotto o assegnato con la chiave di servizio. Il file `.env.example` dello scaffold la imposta su `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Kill switch. Chiude la finestra di bootstrap per il primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, bloccando la registrazione anche a fronte di un database vuoto. Da abbinare a `REBASE_ADMIN_EMAIL` sottostante, altrimenti il deployment non avrà alcun modo di generare il suo primo utente autenticato. Ogni artefatto di deployment distribuito la imposta. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella degli utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il suo admin: l'operatore stabilisce il primo account invece di gareggiare con internet. L'avvio emette un avviso quando la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa tutti i segreti TOTP memorizzati. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e l'avvio emette un avviso singolo — di conseguenza, la rotazione di `JWT_SECRET` disconnetterebbe tutti *e* renderebbe indecifrabili tutti gli autenticatori registrati. Impostare una chiave dedicata (32+ caratteri casuali) prima che chiunque effettui la registrazione MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la rotazione (*away*). Impostare entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che qualcuno rimanga bloccato fuori dal proprio account durante la transizione. Rimuoverla dopo che tutti i segreti sono stati ricifrati. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, e deliberatamente non vincolata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Impostare su `false` per una superficie di lettura interamente pubblica — le policy RLS continuano ad essere applicate. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato quando non ne viene specificato alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Attiva `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito via email. Riservato esclusivamente a chiamanti autenticati, e non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato solo a un frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Attivo per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per connessioni http in chiaro — un deployment su un indirizzo LAN dove altrimenti il browser scarterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza alcun errore. Emette un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
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
| `GITLAB_CLIENT_ID` | ID client OAuth di GitLab. Il `baseUrl` di un'istanza self-hosted non ha una corrispondente variabile d'ambiente — a tale scopo configurare GitLab nel blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Segreto client OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID client OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segreto client OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | ID client OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Segreto client OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | ID client OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segreto client OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | Services ID di Apple, per l'accesso web. È pubblico e viene esposto in `GET /auth/config`. Apple non dispone di un client secret statico, poiché Rebase firma un JWT ES256 a breve durata per ciascun scambio di token. Di conseguenza, Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o a `APPLE_BUNDLE_IDS`, e non configura nulla in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgole dei bundle ID delle app native iOS/macOS i cui codici di "Accedi con Apple" vengono accettati. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'issuer del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file di chiave privata `.p8`, inclusi i ritorni a capo (sono accettate le sequenze di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API di amministrazione statica. Bypassa la normale autenticazione JWT per le chiamate server-to-server quando passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La chiave pubblica della piattaforma di hosting (PEM, EC P-256) rispetto alla quale vengono verificati i token di piattaforma `rpt_`; più blocchi PEM durante una rotazione delle chiavi. La piattaforma la imposta al deployment e non contiene dati segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE` consente al gate di amministrazione di accettare un token di piattaforma per `cron:read`, e per null'altro. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'id progetto a cui deve corrispondere il claim `aud` di un token di piattaforma, evitando che un token generato per un altro progetto venga accettato. Se è impostata solo una delle due variabili, il server si avvia, registra un avviso e risponde a qualsiasi token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Punto di destinazione del pulsante **Continue with Rebase Cloud** del pannello di amministrazione: la pagina del progetto nella console della piattaforma, che autentica i proprietari del progetto ed effettua il reindirizzamento. La piattaforma la imposta al deployment insieme alle due variabili sopra indicate; in loro presenza, `POST /api/auth/platform-signin` accetta il token `auth:admin-signin` valido un minuto della piattaforma e apre una sessione di amministrazione. In sua assenza, l'accesso funziona comunque tramite il pulsante **Open CMS** della console, e la schermata di login si limita a spiegarlo. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione in cui risiedono i contatori del rate-limit, sia per le route di autenticazione sia per `rateLimit` nelle funzioni personalizzate: `memory` (per singolo processo) o `sql` (condiviso tra le repliche). Un processo non può conoscere il numero delle proprie repliche, quindi un deployment distribuito su più istanze deve specificarlo — tre repliche con il valore predefinito applicheranno tre volte il limite. Qualsiasi altro valore **rifiuta l'avvio** anziché effettuare un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Attiva il flusso di accesso senza password tramite magic link. Richiede un servizio email configurato, altrimenti il link non ha destinazione. | `false` |
| `AUTH_EMAIL_OTP` | Attiva l'accesso senza password con un codice a sei cifre inviato via email. Stesso requisito di configurazione email di cui sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic-link o di codice via email per un indirizzo sconosciuto crea l'account, purché le registrazioni siano aperte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un token di refresh oltre la sua finestra temporale consentita: `reject` (rifiuta la richiesta, mantiene la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore impedisce l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma preventiva: nessun accesso tramite password consentito prima della verifica dell'indirizzo. Richiede la configurazione email; in caso contrario l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Abilita la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostata significa nessun captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio una volta impostato `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgole delle route di autenticazione da proteggere (ad esempio `register,login`). Se non impostata, protegge il set predefinito del provider. | — |

### Storage

:::caution[Lo storage non dispone di row-level security, quindi richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. L'object storage non ha un equivalente —
le chiavi condividono un unico namespace piatto — pertanto, con un bucket configurato e nessun modello di accesso
il server **rifiuta l'avvio in produzione**. Soddisfa questo requisito con uno solo tra:
un hook `storageAuthorize` esportato da `backend/storage.ts` (fornito di default con lo
scaffold), `STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di storage: `local`, `s3`, `gcs` o `platform` (file in un prefisso di proprietà della piattaforma di hosting, trasferiti tramite URL firmati dal suo broker di storage; impostato dalla piattaforma). In produzione `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene risolto a partire dalla directory in cui gira il server: la radice del progetto sotto `rebase dev`, `backend/` in un server generato con `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consenti lo storage locale in produzione — solo in presenza di un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali con nome posizionate accanto ad esso | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente con nome. Se non è un numero intero di byte, l'avvio viene rifiutato | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza gli URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Solitamente ricavato dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file della chiave del service account. Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Distribuisci ogni oggetto a chiunque, senza token. Solo per bucket che fungono effettivamente da CDN pubblica. Uno dei modi per soddisfare il controllo di sicurezza all'avvio menzionato sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare ogni oggetto. Denominato `INSECURE` nell'oggetto di configurazione per un motivo preciso: è giustificabile solo in applicazioni single-tenant in cui ciascun account è ritenuto affidabile per ogni file. | `false` |
| `STORAGE_POLICIES` | Regole di accesso allo storage in formato JSON: `[{ "path", "operations"?, "allow" }]`, dove `allow` può essere `"public"`, `"authenticated"`, `"owner"` o `{ "roles": [...] }`. Bloccato per impostazione predefinita, soddisfa il controllo di sicurezza all'avvio. Un elenco non valido impedisce l'avvio. Vedi [Autorizzazione dello storage](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Il broker di storage della piattaforma, per `STORAGE_TYPE=platform`. Impostato dalla piattaforma che gestisce il broker. | — |
| `STORAGE_BROKER_PROJECT` | L'id progetto a cui il broker circoscrive i file di questo deployment, per `STORAGE_TYPE=platform`. Impostato dalla piattaforma. | — |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache le varianti generate delle immagini (ridimensionamenti, conversioni di formato) invece di produrle per ciascuna richiesta. | `false` |

### Email (Facoltativo)
`MAGIC_LINK_URL`.

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato associato all'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato all'inizio dei template email predefiniti. PNG o JPG `http(s)` assoluto — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostata, un'app ancora denominata `Rebase` mostra il marchio Rebase, mentre una rinominata non mostra alcun logo |
| `MAGIC_LINK_URL` | Punto di destinazione di un magic link inviato via email. A un percorso base viene aggiunto `/auth/magic-link?token=…`; un URL contenente `{token}` rappresenta l'intero link, utile per un frontend che non espone `/auth/magic-link`. Racchiuderlo tra virgolette in `.env`, dove un carattere `#` non quotato apre un commento: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valore contenente un hash o un percorso file privo di `{token}` genera un avviso all'avvio. Se non impostata, la base corrisponde a `FRONTEND_URL` |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per ottenere una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pooler). [Realtime](/docs/backend/realtime) ne richiede una: `LISTEN`/`NOTIFY` non sopravvive a un pooler di transazioni come PgBouncer, e in sua assenza le notifiche di modifica vengono disabilitate con un avviso invece di andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene su di essa il proprio `LISTEN` di riattivazione. Valorizza il parametro `directConnectionString` dell'adapter Postgres quando questo non è impostato. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un hot standby. Se fa riferimento a un altro server, le letture autenticate (elenchi, singole righe, conteggi, aggregazioni) vengono servite da esso sotto la medesima row-level security; scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sull'istanza primaria. Un utente in lettura che ha appena eseguito una scrittura legge dall'istanza primaria per la durata di `REBASE_READ_STICKY_MS`, e tutti gli utenti fanno lo stesso quando la replica accumula un ritardo superiore a `REBASE_READ_MAX_LAG_MS` o è in errore. Valorizza il parametro `readConnectionString` dell'adapter Postgres quando questo non è impostato; fino alla versione 0.28 inclusa, il pool della replica veniva aperto ma mai letto. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, intervallo di tempo per cui le letture dello stesso utente vengono indirizzate all'istanza primaria, assicurando che un salvataggio seguito da un elenco mostri il dato appena salvato. Per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Ritardo massimo della replica oltre il quale ogni lettura viene instradata all'istanza primaria. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa attraverso un pooler in modalità transazione come PgBouncer. Il pool non invia quindi `search_path` o `statement_timeout` alla connessione (il pooler li rifiuterebbe o scarterebbe) e li imposta all'interno di ciascuna transazione; l'avvio assegna al ruolo del database un `search_path` predefinito pari a `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatoria, e realtime, il risveglio del job worker, la compilazione degli indici, il branching e la console SQL la utilizzano tutti. Anche l'URL della replica viene considerato con pooler. `DATABASE_POOLED__<KEY>` per un'altra sorgente dati. | — |
| `REBASE_DB_POOL_MAX` | Un tetto massimo applicato a ogni pool nel processo, indipendentemente da quanto richiesto da ciascuno. Solo cifre numeriche semplici: un valore non valido viene ignorato anziché serializzare silenziosamente il server. | — |

### Comportamento a runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine del server
pubblicata. Un progetto che ha eseguito l'eject gestisce queste impostazioni direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit della row-level-security](/docs/rls-check#running-it-on-a-schedule) pianificato, che segnala le tabelle servite prive di policy. Il progetto deve dichiarare `@rebasepro/rls-check` tra le sue dipendenze: il runtime non ne include una copia, e senza il pacchetto l'avvio viene rifiutato specificandone il nome. `false` mantiene la scansione disattivata su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Assegna a ciascun progetto su un cluster condiviso il proprio ruolo. Il database registra il ruolo con cui opera, e un avvio configurato con un altro ruolo rifiuta di partire finché `rebase db request-role migrate` non lo migra. Vedi [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo per le richieste e consente alla connessione di passare ad esso; `never` lascia entrambi alla tua gestione limitandosi a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | I permessi concessi da Rebase al ruolo delle richieste: `schema` (ogni tabella negli schemi serviti, più i privilegi predefiniti), `managed` (solo le tabelle servite) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe le policy permissive di Rebase ai soli ruoli di richiesta, in modo che altri ruoli che leggono le stesse tabelle non ottengano nulla da esse. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` scrive le policy che solo il contesto del server o un amministratore possono soddisfare `TO public`, ed esegue gli amministratori con il ruolo della richiesta. Per impostazione predefinita sono `TO rebase_admin`, in modo che le letture circoscritte al proprietario da parte degli utenti autenticati possano utilizzare l'indice del proprietario. Vedi [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base per server o amministratore da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, in modo che le policy scritte con `auth.uid()` visualizzino il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Azione eseguita all'avvio quando un altro login può passare al ruolo della richiesta: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso di base per tutte le route API. Il client deve essere configurato di conseguenza — vedi [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Distribuisce gli asset statici/amministrativi del bundle da questo processo. Disattivare quando è presente una CDN davanti. | `true` |
| `REBASE_STUDIO` | Serve il pannello di amministrazione integrato su `/_studio` quando è disponibile il suo bundle statico: le tabelle del progetto come collection, utenti e ruoli compresi, e lo Studio. È ciò con cui si amministra un progetto senza codice. Impostare su `false` per disabilitare. | `true` |
| `REBASE_STUDIO_DIR` | Directory contenente il pannello di amministrazione precompilato servito su `/_studio`. Il valore predefinito è `/studio` nell'immagine del container. | `/studio` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Risposte compresse con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` abilita le [notifiche push](/docs/backend/push-notifications/): le route `/api/push`, la tabella `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Coppia di chiavi VAPID con cui vengono firmati i messaggi push. Al di fuori della produzione, se non impostata, viene generata una coppia salvata in `.rebase-dev-secrets.json`; in produzione il push rimane disattivato in loro assenza. | — |
| `REBASE_VAPID_SUBJECT` | Un indirizzo `mailto:` o un URL `https://` che i servizi push possono contattare. Il valore predefinito è l'origine di un `REBASE_PUBLIC_URL` in `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché rimuovere silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati. Se non impostata, in ogni ambiente: `/api/docs` viene servita ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, ciascuno con il documento relativo alle tabelle a lui descritte, senza Swagger UI. `true` pubblica l'intero documento per tutti, con la Swagger **UI** su `/api/swagger` fuori dalla produzione (mai in produzione). `false` mantiene il documento protetto dal controllo di accesso amministrativo. | — |
| `REBASE_DEPLOYMENT_ID` | Il deployment che questo processo esegue, come lo chiama la piattaforma; indicato nella riga che dice che il runtime è in ascolto. Rebase Cloud la imposta. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, facendo sì che i browser rifiutino le connessioni HTTP in chiaro su qualsiasi sottodominio dell'host per sei mesi — inclusi gli host non serviti da questo processo. Attivare solo se ogni sottodominio del dominio supporta esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedi [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer posto a protezione di `/metrics`. Se non impostato, l'endpoint rimane aperto a chiunque possa raggiungere la porta — accettabile su una rete privata, sconsigliato su una pubblica, come segnalato dai log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Cosa può fare il runtime allo schema delle tabelle all'avvio. `ensure` (il valore predefinito, ovunque — produzione inclusa) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere nulla. `none` lascia inalterato lo schema delle tabelle dichiarate, ma le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disattiva anche queste ultime. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio con `push`**. In un [deployment frazionato](/docs/deployment/split-processes) un solo processo può eseguire il provisioning, pertanto ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` fa sì che il runtime non modifichi nulla nel suo database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, né all'avvio né in seguito, inclusi quelli propri del framework. Segnala invece ciò che manca indicandone il nome. Destinato a database in cui solo il tuo processo di change management può effettuare modifiche. Vedi [Quando solo il tuo processo di modifiche può alterare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio se il database è stato sottoposto a provisioning l'ultima volta a partire da un set di tabelle diverso da quello con cui è stato compilato questo processo. Se non impostata (o con qualsiasi valore diverso da `true`/`1`), genera un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio quando un file di funzioni o cron solleva un'eccezione o fallisce il parsing durante l'importazione, indicando ciascun file e la motivazione, in modo che un deployment progressivo mantenga attiva la versione precedente. Anche il riavvio è vincolato a questa regola. Se non impostata (o con qualsiasi valore diverso da `true`), salta il file e serve i restanti. Un file che si importa correttamente ma non esporta alcuna funzione o job viene sempre saltato, non rifiutato. | skip |
| `REALTIME_CDC` | Change data capture a livello di database: `auto` (legge le modifiche dal WAL dove il database lo consente, altrimenti usa i trigger, altrimenti ricorre al fallback a livello di applicazione, registrando ogni fallback come info), `trigger` (lo forza, segnala un avviso se non possibile), `wal` (legge le modifiche dal write-ahead log invece dei trigger; richiede `wal_level=logical` e un ruolo abilitato alla replica, altrimenti ricorre al fallback su `trigger`), `off`. Vedi [Realtime](/docs/backend/realtime-cdc/). Ha la precedenza su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Meccanismo di trasporto inter-istanza per canali di broadcast e presenza: `memory` o `postgres`. Ignorato se a `realtime.bus` è stato fornito un transport già istanziato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni consentite per singolo socket realtime; la successiva viene rifiutata con `TOO_MANY_SUBSCRIPTIONS`. Un numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.maxSubscriptionsPerSocket`. Vedi [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di socket realtime che un utente, o una chiave API, può mantenere aperti su una singola istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore. L'accesso per il socket successivo viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK tenta continuamente la riconnessione, riuscendo ad accedere non appena un altro si chiude. Un numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa, in ms, di una modifica prima del refetch che la recapita ai sottoscrittori attivi. Un refetch attende 300 ms in assenza di modifiche, e al massimo questo tempo in presenza di un flusso costante di scritture. Un numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tempo, in ms, per il quale il totale di una sottoscrizione a elenchi di grandi dimensioni può essere riutilizzato prima di essere ricalcolato; i frame che lo riutilizzano contengono `meta.totalAsOf`. Se non impostata, ogni frame esegue il conteggio. Ha la precedenza su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | Il valore minimo dell'ultimo totale a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi più piccoli vengono conteggiati a ogni frame. Ha la precedenza su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consenti valori `localhost`/loopback con `NODE_ENV=production`. Disattivata per impostazione predefinita, in modo che un avvio di produzione fallisca in modo esplicito anziché tentare di connettersi a un database non presente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio dello schema ed esce senza aprire alcun socket — la modalità richiesta da un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server che lo seguirà. Crea inoltre le tabelle che un processo in esecuzione creerebbe al primo utilizzo, e non avvia né cron né code di job. Un valore vuoto è considerato *non impostato*, evitando che una variabile `${QUALCOSA}` non valorizzata in un file compose trasformi un deployment ordinario in uno che migra e si rifiuta di servire traffico. Rifiutato in combinazione con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un percorso file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) scrive su di esso tutte le modifiche allo schema apportate, in ordine, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe scritte non sono incluse. Rifiutato su un processo che serve traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina — un agente, un job di CI — di *applicare* una modifica allo schema tramite `/api/admin/schema`, anziché solo pianificarla. Disattivato se non espressamente richiesto: la credenziale che effettuerebbe una tale modifica è quella che con maggiore probabilità risiede in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione consentito a una funzione personalizzata prima che la sua richiesta venga interrotta. Corrisponde all'opzione `functionsTimeoutMs`. `0` disattiva il limite. Una funzione che dichiara un proprio timeout (`defineFunction(…, { timeoutMs })`) userà invece quest'ultimo. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Il timeout massimo che una funzione può dichiarare per se stessa tramite `defineFunction(…, { timeoutMs })`, in ms; una richiesta per un valore superiore otterrà questo limite. Un numero positivo; qualsiasi altro valore viene interpretato come non impostato. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che un rifiuto di promise non gestito termini il processo anziché registrarlo nei log. Utile sotto un orchestratore configurato per il riavvio; disattivare nei contesti in cui un riavvio comporta conseguenze peggiori di un memory leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silenzia l'avviso di avvio sulle piattaforme che il runtime rileva come scale-to-zero, dove un timer che scatterebbe in un'istanza inattiva non scatta su alcuna istanza. Non modifica altro: impostare quando si mantiene almeno un'istanza sempre attiva. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy presenti a monte di questo server, consentendo al rate limiter di estrarre il reale indirizzo del client da `X-Forwarded-For`. Predefinito a prova di errore `0`: in assenza di proxy, fidarsi dell'header consentirebbe a qualsiasi chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non costituisce uno strumento di migrazione]
Il passaggio all'avvio viene eseguito in modo non presidiato senza che nessuno revisioni un diff, pertanto non eliminerà mai una colonna, non restringerà un tipo né riscriverà una tabella. Questo è anche il motivo per cui l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff e applicherebbe `DROP COLUMN` senza esitazione, e il riavvio di un container non deve mai poter distruggere una colonna di produzione come effetto collaterale di una rischedulazione.

Le modifiche distruttive o strutturali rimangono dove possono essere revisionate: `rebase db generate` + `rebase db migrate`, oppure `rebase db push` da un checkout locale o da CI, che esegue un dry-run della modifica, rifiuta quelle distruttive in assenza di conferma e può effettuare preventivamente un backup.
:::

### Deployment frazionati (Split deployments)

Una singola immagine e un singolo bundle possono essere avviati più volte, ciascuno a
presidio di una parte diversa del progetto. Qui è riportata una sola riga per ciascuna
variabile, poiché questa pagina si prefigge di elencarle tutte; ciò che ciascuna combinazione *monta e gestisce*
— e quali combinazioni rifiutano l'avvio — è descritto in
**[Processi frazionati](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Quale parte viene servita da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron su *questo* processo. Se non impostata, segue il ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job su questo processo. Se non impostata, segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve solo le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve tutte le funzioni personalizzate tranne quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a cui il processo API inoltra una richiesta per una funzione che non serve direttamente. Su un `worker`, destinazione delle proprie chiamate `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint Model Context Protocol opzionale su `/mcp`, che consente a un client AI di leggere
e scrivere su questo progetto **come utente autenticato**. Disattivato se non impostato e — a differenza
di qualsiasi altra superficie — nessun `REBASE_ROLE` lo attiva: gli altri descrivono la tipologia
del processo, mentre questo rappresenta la scelta consapevole di affidare credenziali a software di
terze parti, decisione che deve essere presa da una persona anziché ereditata dalla
configurazione di un container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Attiva la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in sua assenza, la superficie rifiuta di attivarsi e lo segnala nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine raggiungibile esternamente di questo deployment, ad es. `https://app.example.com`. La superficie MCP non può ricavarla automaticamente: ricavare l'origine dall'header `Host` renderebbe l'identità dell'emittente, e il target rispetto al quale vengono controllati i token, un valore fornito dal chiamante. | — |
| `REBASE_MCP_VIEW` | Percorso della vista MCP personalizzata dell'applicazione (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica per far sì che visualizzi viste, campi e azioni personalizzate. In sua assenza, il backend cerca accanto al frontend che serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere la registrazione preventiva dei client. | `true` |

### Modifica dello schema in tempo reale da un bundle

Disattivata a meno che non sia impostata `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilato
non dispone dei sorgenti in `backend/schema` da modificare, quindi impostando queste variabili l'editor di schemi legge
il codice sorgente dal repository, effettua il commit di ciascuna modifica e applica le relative istruzioni DDL su
questo database. Riservato agli amministratori e applicato manualmente da una persona a meno che
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` non stabilisca diversamente. Un repository indicato senza
credenziali utilizzabili impedisce l'avvio. Vedi
[Modifica dello schema in tempo reale](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare i commit delle modifiche allo schema, nel formato `owner/name`. Impostarla attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene effettuato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione di `backend/schema` all'interno di quel repository, relativa alla radice del repository. Un percorso che esca dal repository impedisce l'avvio, così come l'ormai rimossa variabile `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permessi granulari con accesso in lettura e scrittura ai contenuti del repository. Impostare questa o le tre variabili `_GITHUB_APP_*`, non entrambe. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per effettuare i commit come app anziché tramite token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata dell'app: PEM, PEM con ritorni a capo preceduti da escape, o base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale, o un URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatorio insieme a `BACKUP_SCHEDULE`, che rifiuta di essere eseguito senza di esso. `rebase db backup` ricorre al fallback su `./backups` nella directory in cui è stato eseguito. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostata o impostata su `0`, conserva tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno N dei backup più recenti, indipendentemente dalla retention impostata. | — |
| `PG_DUMP_PATH` | Percorso alternativo del binario `pg_dump` — deve corrispondere alla versione major del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Percorso alternativo del binario `pg_restore`. | — |
| `PSQL_PATH` | Percorso alternativo del binario `psql` eseguito da `rebase db restore --clean` per rendere il ripristino un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione di `pg_dumpall`, se non presente nel `PATH`. In sua assenza — e senza i tool client di PostgreSQL installati — un backup dei globali fallisce con un errore che fa riferimento a questa variabile. | — |

L'immagine di runtime ufficiale (`rebasepro/server`) include i tool client di
PostgreSQL 18, pertanto un backup pianificato eseguito al suo interno può operare con qualsiasi server fino a Postgres 18.
Al di fuori dell'immagine, è necessario installarli autonomamente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione privata con
crittografia a riposo.

### Consegna del bundle

Un deployment gestito non include il proprio codice all'interno dell'immagine: il runtime recupera un
bundle all'avvio. Queste variabili definiscono quale bundle recuperare e come.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una directory del bundle già estratta. Quello che `rebase start` imposta localmente. | — |
| `REBASE_BUNDLE_URL` | URL da cui recuperare l'archivio del bundle in assenza di una copia locale. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale Bearer per il recupero del bundle. Trattare come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto un bundle recuperato. Deve essere scrivibile e persistere tra il recupero e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi che l'immagine di runtime fornisce al bundle, oltre a quelli dichiarati da quest'ultimo. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `backend/resources.ts` viene
associato tramite variabili d'ambiente con nomi derivati da esso. I nomi di base sono indicati di seguito; una
risorsa non predefinita aggiunge `__` e la propria chiave in lettere maiuscole, per cui un bucket denominato
`media` leggerà `S3_BUCKET__MEDIA`. `rebase status` stampa, per ciascuna risorsa,
l'esatta variabile letta e se sia impostata o meno.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di una sorgente dati, se diverso da quello Postgres predefinito. Suffisso per sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Suffisso per topic. | — |

### Ambiente proprio della CLI

Letto da `rebase`, non dal server. Nessun elemento qui influenza un deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Indirizzo a cui `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, impostato nella shell o in `.env`. Impostare quando il server viene eseguito in modalità diversa da `rebase dev` in questo progetto: `rebase start`, un container, un altro host. Se non impostata, utilizzano il server registrato da `rebase dev` finché tale server è in esecuzione, e non inviano nulla quando non lo è. | — |
| `REBASE_SERVICE_KEY` | La service key con cui tali comandi si autenticano, letta da `.env`: la stessa variabile letta dal server (vedi sopra). | — |
| `SERVICE_KEY` | Denominazione precedente di tale chiave. Quando è impostata in `.env`, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quale file `.env` viene letto e scritto dalla CLI, quando non corrisponde a quello del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole del progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile per una root in cui i file degli agenti vengono gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` effettua l'accesso, invece di richiederlo tramite prompt. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, consentendo a un gestore di segreti di passarla senza che finisca nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token ottenuto da `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica tramite esso anziché con la sessione di `rebase cloud login`, senza mai leggere o scrivere la sessione memorizzata. In una directory collegata con `rebase cloud init --claim`, viene accantonato a favore del token specifico del progetto qualora non disponga di permessi su quel progetto. È la modalità consigliata per eseguire `rebase cloud` in CI — vedi [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI avviata dai suoi strumenti cloud, senza mai inviarlo all'app: per tale scopo, impostare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e i dettagli della richiesta anziché il messaggio sintetico. La prima cosa da impostare quando un comando `rebase cloud` fallisce senza fornire spiegazioni utili. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto rispetto al quale `rebase db push`, `db generate` e `db migrate` pianificano le modifiche, al posto del database `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina un database qui indicato, e rifiuta un valore identico a `DATABASE_URL`. Sul database di sviluppo gestito, la CLI lo imposta su un'istanza temporanea PGlite in-memory propria. Impostare negli ambienti in cui il privilegio `CREATE DATABASE` non è concesso. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue alcun provisioning — il database deve essere fornito dall'utente. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server frontend, che altrimenti `rebase dev` ricava dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo massimo di attesa, in ms, con cui `rebase dev` attende che il backend segnali il proprio avvio prima di notificare che non è partito. `0` disattiva la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password inserita da `rebase dev --docker` nella stringa di connessione ricavata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione comune cross-tool. Impostata su qualsiasi valore diverso da `0`, la CLI non invia dati di telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Equivalente, specifico per Rebase. Non richiede alcun file, motivo per cui è quella raccomandata per l'uso in CI e nelle immagini container. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint a cui inviare i dati di telemetria, per un collector self-hosted. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` impedisce alla CLI di interrogare il registro npm (o `npm_config_registry`), una volta al giorno tramite un processo in background, per i dist-tag di `@rebasepro/cli`, e nasconde la riga "Rebase X is out; this CLI is Y" mostrata su stderr al termine di ogni comando eccetto `rebase upgrade`. La risposta viene salvata in `~/.rebase/release-check.json`, e la richiesta non invia altre informazioni. Già disattivato in CI; `NO_UPDATE_NOTIFIER` produce lo stesso effetto. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Impostata dalla CLI per i processi che avvia, in modo che un comando che richiama nuovamente la CLI mostri la riga "Rebase X is out" una sola volta. Impostarla manualmente nasconde la riga per quel processo, allo stesso modo di `REBASE_NO_UPDATE_CHECK`. | — |

## Segreti in sviluppo

`JWT_SECRET` è obbligatoria in produzione. Essa e `REBASE_SERVICE_KEY` vengono
generate automaticamente al di fuori di essa, consentendo di iniziare senza dover configurare nulla.

Tali valori generati vengono memorizzati nella cache in `.rebase-dev-secrets.json`, accanto a
`.rebase-dev-port` e `.rebase-dev-url` e inclusi nel file .gitignore insieme a essi. In precedenza venivano
rigenerati a ogni avvio — facendo sì che il riavvio del server di sviluppo provocasse la disconnessione
dall'applicazione e invalidasse qualsiasi chiave API appena creata.

- Imposta una delle due variabili in modo esplicito e verrà utilizzato il tuo valore; nulla verrà salvato in cache o letto.
- Indirizza la cache altrove con `REBASE_DEV_SECRETS_FILE` — un percorso, nonché
  l'unica variabile di questa sezione che si imposterebbe intenzionalmente.
- Elimina il file per ruotare entrambi i segreti. L'avvio successivo ne scriverà uno nuovo.
- Se il file non può essere scritto — ad esempio in un container in sola lettura — il server si avvia
  comunque con un segreto effimero, esattamente come in precedenza.

Nulla viene memorizzato nella cache in produzione o sotto un test runner. In produzione non
viene generato alcun valore: un avvio privo di `JWT_SECRET` fallisce, indicando il nome della variabile, e
tale comportamento rimane invariato:

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
prive di `app`, `server` e `basePath` e con un parametro `provision` obbligatorio,
permettono di creare un backend che non serve alcunché finché non viene montato: `createRebaseBackend`. Vedi
[Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta tutte le route API, pertanto la stessa configurazione deve essere comunicata al client —
altrimenti quest'ultimo continuerà a effettuare richieste su `/api/...` ricevendo un 404 per qualsiasi endpoint:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione ricava questo valore dal client che gli viene fornito; non occorre
configurare altro. Se componi manualmente l'URL di una richiesta, ricavalo tramite concatenazione dal client
invece di scrivere direttamente `/api`:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Errore di autorizzazione nell'editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, sebbene la vista CMS a foglio di calcolo carichi i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'editor SQL cambiando temporaneamente i ruoli del database in modo che corrispondano al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli esistono solo nelle tabelle del database anziché come ruoli effettivi di PostgreSQL, il cambio di ruolo fallisce o i privilegi del database risultano mancanti. La vista foglio di calcolo del CMS viene eseguita con l'utente proprietario della connessione predefinito e aggira questo meccanismo.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo impone a Rebase di eseguire le query dell'editor SQL utilizzando i privilegi del proprietario della connessione (solitamente un superuser/owner). L'editor SQL indicherà quindi, sopra i risultati, che sono stati letti come proprietario della connessione e disabiliterà il selettore di ruoli.

### Recupero dello schema non riuscito nell'editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'editor SQL restituisce l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per eseguire query sui cataloghi di sistema del database ed eseguire comandi di amministrazione. Se `adminConnectionString` non viene fornita al bootstrapper, oppure `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
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
