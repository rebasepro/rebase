---
sourceHash: dae0d9a7e36f01c4
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca un valore obbligatorio o se un parametro è malformato (un URL che non è un URL, una porta
> che non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende dalla modalità di esecuzione del backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di ciascuna tabella seguente. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })`, e può aggiungere
> lì le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione a PostgreSQL. **Opzionale in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria in tutti gli altri casi. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in fase di sviluppo). | `a1b2c3d4e5...` |

> **Su un database gestito, `sslmode=require` potrebbe non significare ciò che sembra.**
>
> Per `psql` e qualsiasi strumento basato su libpq, `require` significa "crittografato, certificato non
> verificato". Il driver Node su cui si basa Rebase lo interpreta invece come `verify-full`, quindi un
> database il cui certificato non è stato firmato da un'autorità pubblica — caso comune sui database
> Postgres gestiti — rifiuta il runtime con `self-signed certificate`, mentre `psql`
> si connette con lo stesso URL. Il runtime e i comandi `rebase db` si interrompono con un
> messaggio che spiega questa discrepanza.
>
> Scegliere una delle due opzioni:
>
> - **`sslmode=no-verify`** — crittografato, non verificato: ciò che `require` significa per
>   libpq. È una variante di node-postgres non supportata da libpq, quindi `psql`, `pg_dump`
>   e Atlas la rifiutano con `invalid sslmode value: "no-verify"`. I comandi proprietari di Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la trasmettono a questi strumenti
>   come `sslmode=require`, funzionando regolarmente con l'URL configurato; per usare `psql`
>   manualmente, sostituirlo con `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificato rispetto al certificato
>   CA del provider. Identico per ogni strumento.
>
> Anche `uselibpqcompat=true&sslmode=require`, suggerito dal warning del driver Node stesso,
> funziona per il runtime; i comandi di Rebase rimuovono `uselibpqcompat` prima di passare l'URL
> agli strumenti libpq, che altrimenti lo rifiuterebbero.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API di backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedere sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth di Google. Abilita "Accedi con Google". | — |


> **Lasciare non impostato `VITE_API_URL` nelle build di produzione.**
>
> In fase di sviluppo il frontend e il backend hanno origini separate, quindi il dev
> server inietta questa variabile. In produzione il backend di Rebase serve la SPA, per cui
> l'API coincide con l'origine stessa della pagina e il client la risolve autonomamente in questo modo.
>
> Includere un URL assoluto in un bundle di produzione funziona finché un secondo
> hostname non punta alla stessa app: a quel punto, un dominio personalizzato caricherà la pagina da
> `example.com` ed effettuerà chiamate all'API su `example.rebase.website`, operazione
> cross-origin per cui ogni richiesta fallirà il preflight. Consentire l'origine in CORS
> **non** risolve il problema: il cookie di refresh è impostato su `SameSite=Lax` e non viene
> inviato cross-site, con il risultato di azzerare gli errori in console ma lasciando
> l'autenticazione non funzionante. Se non impostato, ogni dominio che punta all'app funzionerà
> senza richiedere alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **esclusivamente dall'ambiente shell** — un valore `PORT` in `.env` non viene letto, poiché la porta viene risolta prima del caricamento del file — e in caso contrario associa una porta derivata dal percorso del progetto, consentendo l'esecuzione contemporanea di più progetti. `rebase dev --port` ha la precedenza su entrambi, e il banner di avvio specifica quale livello sia stato utilizzato. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'SQL associato alla riga `Failed query: [redacted]`. Per impostazione predefinita ogni istruzione con esito negativo viene oscurata, poiché una query fallita contiene i parametri associati (ad es. un'email o un hash di password). Impostare su `true` durante la diagnostica di errori DDL, RLS o di acquisizione delle modifiche. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatorio in produzione** a meno che non sia impostato `FRONTEND_URL`: un avvio in produzione senza nessuno dei due parametri si rifiuterà di partire. In fase di sviluppo viene *aggiunto a* localhost — vedere sotto. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzato in alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (utilizzata per l'introspezione dello schema e operazioni amministrative). Il database specificato non è quello considerato corrente dalla console SQL, né quello clonato di default da un nuovo branch: entrambi corrispondono al database su cui insiste la connessione dell'app (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli DB non sono mappati). In questo caso la console SQL di Studio segnala che le righe sono state lette con l'utente proprietario della connessione, indicandone il nome, e disabilita il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui questo server è in esecuzione. `rebase dev` lo imposta su un checkout su cui è stato eseguito lo [switch su un branch](/docs/backend/branching/#cli-integration). Un server configurato con questa variabile mantiene il registro dei branch su tale database e clona i nuovi branch a partire da esso per impostazione predefinita, in modo che il pannello Branches di Studio mostri i branch del database principale. | — |

#### CORS in sviluppo

L'ambiente di sviluppo consente **localhost, più qualsiasi origine specificata in `CORS_ORIGINS` (o `FRONTEND_URL`)** — lo stesso elenco usato in produzione, con localhost aggiunto anziché sostituito. Di conseguenza, la variabile funziona allo stesso modo in entrambi gli ambienti e i casi in cui è necessaria in sviluppo sono quelli consueti:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non sia né localhost né inclusa nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una sola volta per origine** con l'indicazione della riga esatta necessaria
per autorizzarla. Il rifiuto non è prudenza fine a se stessa: l'API trasmette credenziali, pertanto
riflettere un header `Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore
di effettuare richieste autenticate verso il dev server con la sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Segreto per la firma JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), affinché qualsiasi servizio dotato del JWKS possa verificare una sessione senza poter generarne di nuove. Accetta una chiave PEM con a capo reali, con sequenze di escape `\n` o l'intera chiave PEM codificata in base64. Senza di essa, i token rimangono HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificarlo a ogni aggiornamento della chiave: la rotazione richiede che la vecchia e la nuova chiave siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del refresh token. A finestra scorrevole: ogni rotazione ne prolunga la validità, determinando per quanto tempo una sessione sopravvive all'**inattività**. Impostare su `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser applicano questo limite massimo al cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori dell'ambiente di produzione, il **primo** utente può sempre registrarsi indipendentemente da questo valore: una tabella utenti vuota deve accettare qualcuno, e tale utente diventa amministratore. In produzione (`NODE_ENV=production`) questa finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un utente standard e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` sotto o assegnato tramite service key. Nel file `.env.example` dello scaffold è impostato su `true`; il default del framework è disabilitato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di blocco (kill switch). Chiude la finestra di bootstrap del primo utente lasciata intenzionalmente aperta da `ALLOW_REGISTRATION=false` al di fuori della produzione, impedendo la registrazione anche a fronte di un database vuoto. Da associare a `REBASE_ADMIN_EMAIL` sottostante, altrimenti il deployment non avrà alcun modo di generare il primo chiamante autenticato. Viene impostato da ogni artifact di deployment distribuito. | — |
| `REBASE_ADMIN_EMAIL` | Indirizzo email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. È così che un deployment di produzione ottiene il proprio admin: l'operatore definisce il primo account anziché rischiare race condition con accessi esterni non autorizzati. All'avvio viene emesso un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per quell'account. Almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP archiviato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e all'avvio viene generato un avviso singolo — di conseguenza, la rotazione di `JWT_SECRET` disconnetterebbe tutti gli utenti *e* renderebbe indecifrabili tutti gli autenticatori registrati. Configurare una chiave dedicata (almeno 32 caratteri casuali) prima che gli utenti effettuino registrazioni MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave precedente durante una procedura di rotazione. Impostarle entrambe durante una rotazione: i nuovi segreti vengono salvati con `MFA_ENCRYPTION_KEY`, mentre quelli esistenti restano decifrabili, evitando che gli utenti restino bloccati fuori dal proprio account durante la transizione. Rimuoverla dopo aver ricifrato tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). È una funzionalità opt-in e deliberatamente slegata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dati. Impostare su `false` per un'interfaccia di lettura completamente pubblica — la RLS rimane comunque attiva. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato quando non ne viene fornito alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato ai soli chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disabilitato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è riservato a frontend effettivamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Abilitato per impostazione predefinita; impostare `AUTH_COOKIE_SECURE=false` per http semplice — ad esempio un deployment su indirizzo LAN in cui il browser scarterebbe altrimenti il cookie e la sessione terminerebbe alla scadenza dell'access token senza errori. Genera un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID OAuth di Google (validazione lato backend) | — |
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
| `GITLAB_CLIENT_ID` | Client ID OAuth di GitLab. L'attributo `baseUrl` di un'istanza self-hosted non ha una corrispondenza diretta nelle variabili d'ambiente: per questo scopo, configurare GitLab nel blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | Client ID OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | Client ID OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | Client ID OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | Services ID di Apple per l'accesso web. È pubblico e viene esposto in `GET /auth/config`. Apple non prevede un client secret statico poiché Rebase firma un token JWT ES256 a breve durata per ogni scambio di token. Di conseguenza, Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questo valore o ad `APPLE_BUNDLE_IDS`; in loro assenza non viene configurato nulla. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgole dei bundle ID delle app native iOS/macOS di cui vengono accettati i codici "Accedi con Apple". | — |
| `APPLE_TEAM_ID` | Team ID di Apple Developer, l'emittente del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata su Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, interruzioni di riga comprese (sono accettate le sequenze di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API statica di amministrazione. Bypassa la normale autenticazione JWT per chiamate server-to-server quando passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) utilizzata per verificare i token di piattaforma `rpt_`; più blocchi PEM in caso di rotazione delle chiavi. Viene impostata dalla piattaforma al momento del deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE` consente al gate amministrativo di accettare un token di piattaforma per `cron:read` e per nient'altro. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID progetto a cui deve corrispondere l'attributo `aud` di un token di piattaforma, impedendo l'uso di un token generato per un altro progetto. Se è impostata solo una delle due variabili, il server si avvia registrando un avviso nei log e risponde a ogni token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destinazione del pulsante **Continue with Rebase Cloud** del pannello di amministrazione: la pagina del progetto nella console della piattaforma, che autentica i proprietari del progetto e reindirizza indietro. La piattaforma la definisce in fase di deploy insieme alle due precedenti; in loro presenza, `POST /api/auth/platform-signin` accetta il token temporaneo `auth:admin-signin` (validità 1 minuto) e avvia una sessione admin. In sua assenza l'accesso continua a funzionare tramite **Open CMS** nella console, e la schermata di login si limita a spiegarlo. | — |
| `REBASE_RATE_LIMIT_STORE` | Archivio per i contatori di rate limit, per le route di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per singolo processo) o `sql` (condiviso tra le repliche). Un processo non può determinare il numero delle proprie repliche, pertanto una distribuzione orizzontale deve indicarlo esplicitamente — tre repliche con il valore predefinito applicherebbero il triplo del limite previsto. Qualsiasi altro valore **impedisce l'avvio** senza fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso senza password tramite link (magic link). Richiede un servizio email configurato, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password tramite codice a sei cifre inviato via email. Stessi requisiti di posta indicati sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic link o codice email per un indirizzo non censito crea l'account, purché la registrazione sia aperta. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un refresh token oltre la relativa finestra di tolleranza: `reject` (rifiuta la richiesta, mantiene la sessione attiva) o `revoke-session` (termina la sessione). Qualsiasi altro valore impedisce l'avvio del server. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma obbligatoria: nessun accesso tramite password finché l'indirizzo email non viene verificato. Richiede il servizio email; in assenza di esso l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Se non impostata, il captcha non è attivo. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, impiegato lato server per verificare il token trasmesso dal browser. Obbligatorio quando `CAPTCHA_PROVIDER` è configurato. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgole delle route di autenticazione da proteggere (ad esempio `register,login`). Se non impostato, protegge il set predefinito del provider. | — |

### Storage

:::caution[Lo storage non ha una sicurezza a livello di riga, quindi richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. L'object storage non ha un equivalente —
le chiavi condividono un unico namespace piatto — pertanto, configurando un bucket senza un modello di accesso,
il server **rifiuta l'avvio in produzione**. Per soddisfare il controllo è necessario definire esattamente uno tra i seguenti elementi:
un hook `storageAuthorize` esportato da `backend/storage.ts` (fornito di default con lo scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3`, `gcs` o `platform` (file memorizzati in un prefisso di proprietà della piattaforma di hosting, trasferiti tramite URL firmati dal relativo storage broker; impostato dalla piattaforma). In produzione `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. Un percorso relativo viene risolto a partire dalla directory in cui gira il server: la radice del progetto sotto `rebase dev`, `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — solo in presenza di un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali nominati adiacenti ad esso | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token generato da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima accettata per i file, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente con nome. Un valore non intero impedisce l'avvio del server | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Access key AWS | — |
| `S3_SECRET_ACCESS_KEY` | Secret key AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza URL in formato path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Solitamente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file della chiave del service account. Omettere su GCP se le credenziali sono fornite da Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce qualsiasi oggetto a chiunque, senza token. Da usare esclusivamente per bucket che fungono realmente da CDN pubblica. È una delle modalità per superare il blocco all'avvio sopra descritto. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi chiamante autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Denominato `INSECURE` nell'oggetto di configurazione per un motivo preciso: è accettabile solo in applicazioni single-tenant in cui ogni account è considerato attendibile per qualsiasi file. | `false` |
| `STORAGE_POLICIES` | Regole di accesso allo storage in formato JSON: `[{ "path", "operations"?, "allow" }]`, dove `allow` può valere `"public"`, `"authenticated"`, `"owner"` o `{ "roles": [...] }`. Nega l'accesso per impostazione predefinita e soddisfa il controllo di sicurezza all'avvio. Un elenco non valido impedisce l'avvio. Consultare [Autorizzazione per lo storage](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Lo storage broker della piattaforma, per `STORAGE_TYPE=platform`. Impostato dalla piattaforma che gestisce il broker. | — |
| `STORAGE_BROKER_PROJECT` | L'ID del progetto a cui il broker circoscrive i file di questa installazione, per `STORAGE_TYPE=platform`. Impostato dalla piattaforma. | — |
| `STORAGE_RENDITION_CACHE` | Memorizza in cache le rendition generate delle immagini (ridimensionamenti, conversioni di formato) invece di produrle a ogni richiesta. | `false` |

### Email (Opzionale)
`MAGIC_LINK_URL`.

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato associato all'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato in cima ai template email predefiniti. PNG o JPG assoluto `http(s)` — i client eliminano gli SVG e bloccano gli URI `data:`. Se non impostato, un'app denominata `Rebase` mostrerà il marchio Rebase, mentre una con nome personalizzato non mostrerà alcun logo |
| `MAGIC_LINK_URL` | Destinazione del link magico inviato via email. A un URL di base viene aggiunto `/auth/magic-link?token=…`; un URL contenente `{token}` rappresenta il link completo, per un frontend che non espone `/auth/magic-link`. Racchiuderlo tra virgolette nel file `.env`, dove un carattere `#` non quotato dà inizio a un commento: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Valori contenenti un cancelletto o un percorso file senza `{token}` generano un avviso all'avvio. Se non impostato, la base predefinita è `FRONTEND_URL` |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di conservazione di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per ottenere una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pooler). Necessaria per [Realtime](/docs/backend/realtime): `LISTEN`/`NOTIFY` non sopravvive a pooler di transazioni come PgBouncer; senza di essa, le notifiche delle modifiche vengono disabilitate con un avviso invece di perdersi silenziosamente. Anche il [job worker](/docs/backend/jobs) vi mantiene il proprio `LISTEN` di attivazione. Popola `directConnectionString` dell'adapter Postgres quando non configurato. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un hot standby. Quando fa riferimento a un altro server, le letture autenticate (elenchi, record singoli, conteggi, aggregazioni) vengono gestite da esso con la medesima row-level security; scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sul primario. Un client che ha appena eseguito una scrittura legge dal primario per `REBASE_READ_STICKY_MS`, e tutti leggono dal primario se la replica ha un ritardo superiore a `REBASE_READ_MAX_LAG_MS` o riscontra errori. Popola `readConnectionString` dell'adapter Postgres se non specificato; fino alla versione 0.28 compresa il pool della replica veniva aperto ma mai utilizzato per le letture. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, intervallo di tempo durante il quale le letture dello stesso utente vengono indirizzate al primario, assicurando che un salvataggio seguito da un elenco mostri i dati salvati. Valido per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Soglia massima di ritardo della replica oltre la quale tutte le letture vengono indirizzate al primario. | `1000` |
| `DATABASE_POOLED` | `true` se `DATABASE_URL` transita attraverso un pooler in modalità transazione come PgBouncer. In tal caso il pool non invia `search_path` o `statement_timeout` al momento della connessione (il pooler li rifiuterebbe o ignorerebbe) e li imposta all'interno di ciascuna transazione; all'avvio viene assegnato al ruolo del database un `search_path` predefinito pari a `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatorio e viene utilizzato da realtime, wake-up dei job worker, creazione indici, branching e console SQL. Anche l'URL della replica viene considerato con pooler. Utilizzare `DATABASE_POOLED__<KEY>` per un'altra origine dati. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo per ogni pool all'interno del processo, applicato indipendentemente dal valore richiesto da ciascuno di essi. Accetta solo cifre numeriche: valori malformati vengono ignorati anziché serializzare silenziosamente le richieste del server. | — |

### Comportamento a runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine server ufficiale.
Un progetto che ha eseguito l'eject gestisce invece queste decisioni direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit programmato della row-level security](/docs/rls-check#running-it-on-a-schedule), che segnala le tabelle servite senza criteri di sicurezza. Il progetto deve dichiarare `@rebasepro/rls-check` tra le proprie dipendenze: il runtime non ne include una copia integrata e, in assenza del pacchetto, l'avvio viene rifiutato indicandone il nome. `false` mantiene la scansione disabilitata su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Ruolo Postgres con cui vengono eseguite le richieste anonime e autenticate. Assegnarne uno specifico a ogni progetto su un cluster condiviso. Il database tiene traccia del ruolo con cui viene eseguito, e un avvio configurato per un altro ruolo si rifiuta di partire fino all'esecuzione di `rebase db request-role migrate`. Consultare [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo di richiesta e consente alla connessione di assumerlo; `never` demanda entrambi i passaggi alla configurazione manuale limitandosi a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | I privilegi concessi da Rebase al ruolo di richiesta: `schema` (tutte le tabelle negli schemi serviti, più i privilegi predefiniti), `managed` (solo le tabelle servite) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe i criteri permissivi di Rebase al/ai ruolo/i di richiesta, impedendo ad altri ruoli che leggono le stesse tabelle di beneficiarne. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` applica i criteri che solo il contesto del server o un amministratore possono soddisfare `TO public`, ed esegue gli amministratori come ruolo di richiesta. Di default sono impostati `TO rebase_admin`, così che le letture circoscritte al proprietario per utenti autenticati possano sfruttare l'indice owner. Vedere [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base per server o admin da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, consentendo ai criteri scritti con `auth.uid()` di identificare il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio se un altro login può assumere il ruolo di richiesta: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso di base per tutte le route API. Il client deve essere configurato in modo conforme — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve le risorse statiche e di amministrazione del bundle da questo processo. Disabilitare in presenza di un CDN a monte. | `true` |
| `REBASE_STUDIO` | Serve il pannello di amministrazione integrato su `/_studio` quando il relativo bundle statico è presente: visualizza le tabelle del progetto come collezioni, inclusi utenti e ruoli, e lo Studio. È lo strumento tramite cui viene amministrato un progetto privo di codice dedicato. Impostare su `false` per disabilitarlo. | `true` |
| `REBASE_STUDIO_DIR` | Directory contenente il pannello di amministrazione precompilato servito su `/_studio`. Il valore predefinito è `/studio` nell'immagine del container. | `/studio` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compressione gzip/brotli per le risposte. | `true` |
| `REBASE_PUSH` | `true` abilita le [notifiche push](/docs/backend/push-notifications/): le route `/api/push`, la tabella `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La coppia di chiavi VAPID con cui vengono firmati i messaggi push. Fuori dalla produzione, se non impostata, viene generata una coppia salvata in `.rebase-dev-secrets.json`; in produzione le push rimangono disabilitate senza di esse. | — |
| `REBASE_VAPID_SUBJECT` | Un indirizzo `mailto:` o un URL `https://` raggiungibile dai servizi push. Di default corrisponde all'origine di un `REBASE_PUBLIC_URL` in `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché disattivare silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | La superficie OpenAPI. A tre stati. Se non impostata, in ogni ambiente: `/api/docs` viene esposta ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, ognuno con la documentazione delle tabelle a lui descritte, e non è presente l'interfaccia Swagger UI. `true` pubblica l'intero documento a chiunque, abilitando Swagger **UI** su `/api/swagger` al di fuori della produzione (mai in produzione). `false` mantiene il documento accessibile solo dietro autenticazione admin. | — |
| `REBASE_DEPLOYMENT_ID` | Il deployment eseguito da questo processo, con il nome assegnato dalla piattaforma; mostrato nella riga che indica che il runtime è in ascolto. Impostato da Rebase Cloud. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, in modo che i browser rifiutino l'HTTP non protetto su ogni sottodominio dell'host per sei mesi — inclusi host non serviti da questo processo. Abilitare solo se ogni sottodominio del dominio è esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token di protezione per `/metrics`. Se non impostato, lascia l'endpoint accessibile a chiunque possa raggiungere la porta — appropriato su rete privata, non su rete pubblica, e i log di avvio lo segnalano. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni consentite al runtime sullo schema delle tabelle all'avvio. `ensure` (valore predefinito ovunque, produzione inclusa) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere nulla. `none` non tocca lo schema delle tabelle dichiarate, ma le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disabilita anche queste. L'immagine distribuita accetta solo questi due valori e **rifiuta l'avvio con `push`**. In un [deployment separato (split deployment)](/docs/deployment/split-processes) un solo processo può effettuare il provisioning, quindi ogni altro ruolo deve essere impostato su `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` impedisce al runtime di apportare qualsiasi modifica al database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant, all'avvio o successivamente, comprese quelle interne del framework. Segnala invece per nome gli elementi mancanti. Indicato per database in cui solo la propria procedura di migrazione può applicare modifiche. Vedere [Quando solo la tua procedura di migrazione può modificare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono ammessi solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio se il database è stato predisposto l'ultima volta a partire da un set di tabelle diverso da quello con cui è stato compilato questo processo. Se non impostato (o qualsiasi valore diverso da `true`/`1`), genera un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o di cron genera un errore o non può essere analizzato durante l'importazione, indicando ogni file e la relativa motivazione, in modo che un deploy progressivo continui a servire la versione precedente. La regola si applica anche in fase di riavvio. Se non impostato (o diverso da `true`), ignora il file problematico e serve il resto. Un file importato correttamente che non esporta funzioni o job viene sempre ignorato senza errori. | skip |
| `REALTIME_CDC` | Change data capture a livello di database: `auto` (legge le modifiche dal WAL dove consentito dal database, altrimenti usa i trigger, altrimenti ricorre al fallback a livello applicativo, registrando ogni fallback come info), `trigger` (lo impone forzatamente, avvisa se impossibile), `wal` (legge le modifiche dal write-ahead log invece che dai trigger; richiede `wal_level=logical` e un ruolo con permessi di replica, altrimenti ricorre a `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha la precedenza su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Meccanismo di trasporto tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato quando a `realtime.bus` viene fornito un trasporto personalizzato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni consentite per singolo socket realtime; le successive vengono rifiutate con `TOO_MANY_SUBSCRIPTIONS`. Deve essere un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Ha la precedenza su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di socket realtime che un utente, o una chiave API, può mantenere aperti su una singola istanza del server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore. L'accesso successivo viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK tenta ripetutamente la riconnessione, riuscendovi non appena un altro socket si chiude. Numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa prima del refetch che distribuisce le modifiche ai sottoscrittori attivi, in ms. Un refetch attende 300 ms senza modifiche, e al massimo questo intervallo in presenza di un flusso continuo di scritture. Numero intero positivo — qualsiasi altro valore blocca il server all'avvio. Ha la precedenza su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo di tempo durante il quale il conteggio totale di una sottoscrizione a liste di grandi dimensioni può essere riutilizzato prima di un nuovo calcolo, in ms; i frame che lo riutilizzano contengono `meta.totalAsOf`. Se non impostato, il calcolo avviene su ogni frame. Ha la precedenza su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | La soglia minima dell'ultimo totale a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi con meno righe vengono ricalcolati a ogni frame. Ha la precedenza su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback sotto `NODE_ENV=production`. Disabilitato per impostazione predefinita, in modo che un avvio di produzione fallisca esplicitamente anziché tentare la connessione a un database inesistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio sullo schema ed esce senza aprire alcun socket — la modalità ideale per un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server successivo. Crea inoltre le tabelle che un processo servente creerebbe solo al primo utilizzo, e non avvia né cron né code di job. Un valore vuoto equivale a *non impostato*, evitando che una variabile `${SOMETHING}` non sostituita in un file compose trasformi una normale installazione in una che migra e si rifiuta di servire traffico. Non compatibile con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso di un file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive in ordine tutte le modifiche allo schema apportate, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe di dati inserite non sono incluse. Rifiutato su un processo attivo per servire traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a un sistema automatico — un agente, un job di CI — di *applicare* modifiche allo schema tramite `/api/admin/schema`, anziché pianificarle soltanto. Disattivato per impostazione predefinita: la credenziale che applicherebbe tale modifica è la stessa che più facilmente potrebbe trovarsi esposta in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo di esecuzione di una funzione personalizzata prima che la richiesta venga interrotta. Stessa opzione di `functionsTimeoutMs`. `0` disattiva il limite. Una funzione che definisce il proprio timeout (`defineFunction(…, { timeoutMs })`) utilizzerà quest'ultimo. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Il timeout massimo che una funzione può dichiarare autonomamente con `defineFunction(…, { timeoutMs })`, in ms; una funzione che richiede un valore superiore riceverà questo limite. Numero positivo; qualsiasi altro valore viene interpretato come non impostato. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una unhandled promise rejection arresti il processo anziché registrarla solo nei log. Utile sotto un orchestratore che gestisce il riavvio; sconsigliato nei casi in cui un riavvio comporti impatti peggiori di un memory leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silenzia l'avviso di avvio su piattaforme rilevate dal runtime come con scalabilità a zero (scale-to-zero), dove un timer che scatta in un'istanza inattiva non scatterebbe in nessuna istanza. Non altera altri comportamenti: impostarlo se si mantiene attiva almeno un'istanza. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy anteposti a questo server, permettendo al rate limiter di rilevare il reale indirizzo del client da `X-Forwarded-For`. Predefinito fail-safe su `0`: senza proxy, fidarsi dell'header consentirebbe a qualsiasi chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non costituisce uno strumento di migrazione]
Il passaggio di avvio viene eseguito in modo automatico senza alcun controllo umano sul diff; di conseguenza, non eliminerà mai una colonna, non restringerà mai un tipo e non riscriverà mai una tabella. È anche per questo che l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola un diff e può eseguire senza problemi un `DROP COLUMN`, mentre il riavvio di un container non deve mai rischiare di distruggere una colonna di produzione come effetto collaterale della rischedulazione.

Le modifiche distruttive o di ristrutturazione devono avvenire dove possono essere esaminate: `rebase db generate` + `rebase db migrate`, oppure `rebase db push` da una copia locale del repository o da CI, che esegue un dry-run della modifica, rifiuta quelle distruttive in assenza di conferma e può creare preventivamente un backup.
:::

### Deployment separati (Split deployments)

Una singola immagine e un singolo bundle possono essere avviati più volte, ciascuno a supporto di una parte differente del progetto. Qui è riportata una riga riassuntiva per ciascuna variabile, poiché questa pagina elenca tutte le opzioni disponibili; ciò che ciascuna combinazione *monta e gestisce* — e quali combinazioni impediscono l'avvio — è documentato in **[Processi separati (Split Processes)](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Quale componente viene servito da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Esegue l'override sull'esecuzione dei timer cron da parte di *questo* processo. Se non impostato, segue quanto stabilito dal ruolo. | — |
| `REBASE_JOB_WORKERS` | Esegue l'override sull'esecuzione dei worker delle code di job da parte di questo processo. Se non impostato, segue quanto stabilito dal ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Esegue solo le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Esegue tutte le funzioni personalizzate tranne quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Indirizzo a cui il processo API inoltra una richiesta per una funzione non gestita localmente. Su un `worker`, indica dove indirizzare le chiamate `rebase.functions` interne. URL `http(s)`. | — |

### Superficie MCP

Un endpoint Model Context Protocol opt-in su `/mcp`, che consente a un client AI di leggere e scrivere su questo progetto **come utente autenticato**. Disattivato per impostazione predefinita e — a differenza di ogni altra superficie — nessun valore di `REBASE_ROLE` lo attiva: gli altri ruoli descrivono la forma del processo, mentre questo rappresenta una decisione consapevole di delegare credenziali a software di terze parti, che dovrebbe essere presa da una persona anziché ereditata dalla funzione di un container.

`rebase dev` imposta `REBASE_MCP_ENABLED=true` per il backend che avvia, a meno che la shell o `.env` non contengano già una riga specifica, e tale backend imposta il proprio `http://localhost:<port>` come URL pubblico se `REBASE_PUBLIC_URL` non è definito. Nessun altro comando esegue questa operazione: un processo di produzione richiede entrambe le variabili.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monta la superficie MCP. Richiede `REBASE_PUBLIC_URL`; in assenza di quest'ultimo la superficie non viene montata e lo segnala nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine accessibile dall'esterno di questa installazione, ad es. `https://app.example.com`. La superficie MCP non può derivarla automaticamente: ricavare l'origine dall'header `Host` renderebbe l'identità dell'emittente (issuer), e l'audience con cui vengono verificati i token, un valore fornito direttamente dal chiamante. | — |
| `REBASE_MCP_VIEW` | Percorso della vista MCP App personalizzata del progetto (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica per fare in modo che mostri viste, campi e azioni personalizzati. In sua assenza, il backend cerca accanto al frontend che serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere che i client vengano registrati preventivamente. | `true` |

### Modifica dello schema in tempo reale da un bundle

Disabilitato a meno che non sia impostato `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle compilato non dispone del sorgente `backend/schema` da modificare; pertanto, impostando queste variabili, l'editor dello schema legge il sorgente dal repository, vi esegue il commit di ciascuna modifica e lancia il relativo DDL su questo database. Riservato agli amministratori e applicato manualmente da un operatore, salvo diversa indicazione di `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`. Un repository indicato senza credenziali utilizzabili blocca l'avvio. Vedere [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui eseguire il commit delle modifiche allo schema, nel formato `owner/name`. La sua impostazione attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene effettuato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione di `backend/schema` all'interno di quel repository, relativo alla radice del repo. Un percorso che esce dal repository impedisce l'avvio, così come il parametro rimosso `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permessi granulari di lettura e scrittura sui contenuti del repository. Impostare questo valore o le tre variabili `_GITHUB_APP_*`, ma non entrambi. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per effettuare commit come applicazione anziché tramite token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'ID di installazione dell'applicazione sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata della GitHub App: formato PEM, PEM con a capo escapati o codifica base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale oppure URL `s3://bucket/prefix` o `gs://bucket/prefix`. Obbligatorio in combinazione con `BACKUP_SCHEDULE`, che altrimenti non verrà eseguito. `rebase db backup` ricorre a `./backups` nella directory da cui è stato eseguito. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostato o pari a `0`, conserva tutti i backup. | — |
| `BACKUP_KEEP_MINIMUM` | Mantiene sempre almeno N dei backup più recenti, indipendentemente dalla retention impostata. | — |
| `PG_DUMP_PATH` | Sovrascrive il percorso dell'eseguibile `pg_dump` — deve corrispondere alla versione major del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Sovrascrive il percorso dell'eseguibile `pg_restore`. | — |
| `PSQL_PATH` | Sovrascrive il percorso dell'eseguibile `psql` eseguito da `rebase db restore --clean` per rendere il ripristino una singola transazione. | — |
| `PG_DUMPALL_PATH` | Percorso in cui risiede `pg_dumpall`, se non presente nel `PATH` di sistema. In sua assenza — e senza i client tool di PostgreSQL installati — un backup dei globals fallisce con un errore indicante questa variabile. | — |

L'immagine di runtime ufficiale (`rebasepro/server`) include gli strumenti client di PostgreSQL 18, pertanto un backup pianificato eseguito al suo interno funziona su qualsiasi server fino a Postgres 18. All'esterno dell'immagine, è necessario installarli manualmente (`apt-get install postgresql-client-18`, `brew install libpq`).

I backup contengono segreti e dati personali (PII). Utilizzare una destinazione privata protetta da crittografia a riposo (encryption-at-rest).

### Distribuzione del bundle (Bundle delivery)

Un deployment gestito non include il proprio codice all'interno dell'immagine: il runtime recupera un bundle in fase di avvio. Queste variabili stabiliscono quale recuperare e con quali modalità.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso di una directory contenente un bundle già estratto. Impostato localmente da `rebase start`. | — |
| `REBASE_BUNDLE_URL` | URL da cui scaricare l'archivio del bundle in assenza di una copia locale. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale Bearer per il download del bundle. Trattarla come un segreto: è l'elemento che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto il bundle scaricato. Deve essere accessibile in scrittura e persistere tra il download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi forniti dall'immagine runtime al bundle, oltre a quelli dichiarati autonomamente. | — |

### Binding delle risorse (Resource bindings)

Ogni database, bucket e topic dichiarato da un progetto in `backend/resources.ts` è associato a variabili d'ambiente denominate in base ad esso. I nomi di base sono indicati di seguito; una risorsa non predefinita aggiunge `__` seguito dalla propria chiave in lettere maiuscole, per cui un bucket denominato `media` leggerà `S3_BUCKET__MEDIA`. Il comando `rebase status` mostra, per ciascuna risorsa, l'esatta variabile letta e se sia impostata o meno.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver della sorgente dati, quando diverso da quello Postgres predefinito. Con suffisso per risorsa: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Con suffisso per topic. | — |

### Ambiente proprio della CLI

Letto dal comando `rebase`, non dal server. Nessun parametro in questa sezione ha impatto sui deployment.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Indirizzo a cui `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, dalla shell o da `.env`. Da impostare quando il server viene eseguito con modalità diverse da `rebase dev` nel progetto: `rebase start`, un container, un altro host. Se non impostato, utilizzano l'indirizzo registrato da `rebase dev` mentre tale server è in esecuzione, non inviando nulla se il server è fermo. | — |
| `REBASE_SERVICE_KEY` | La service key con cui tali comandi si autenticano, letta da `.env`: la stessa variabile letta dal server (vedere sopra). | — |
| `SERVICE_KEY` | Denominazione precedente della stessa chiave. Se presente in `.env`, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quale file `.env` viene letto e scritto dalla CLI, quando diverso da quello del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole del progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile se i file per gli agenti vengono gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui `rebase cloud login` effettua l'accesso, senza richiedere interazione da prompt. | — |
| `REBASE_CLOUD_PASSWORD` | La password dell'account, per consentire a un secret store di fornirla senza lasciarne traccia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token generato con `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica tramite esso invece che con la sessione di `rebase cloud login`, senza leggere né scrivere la sessione memorizzata. In una directory collegata tramite `rebase cloud init --claim`, viene accantonato a favore del token specifico del progetto qualora non disponga dei permessi sul progetto stesso. È il metodo raccomandato per eseguire `rebase cloud` in CI — consultare [CI e agenti](/docs/deployment/cloud/#ci-and-agents). L'[MCP server](/docs/ai/mcp/) lo passa alla CLI creata dai suoi cloud tool e non lo invia mai all'app: per tale scopo impostare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` visualizza l'errore sottostante e il dettaglio della richiesta invece del messaggio sintetico. Il primo parametro da attivare se un comando `rebase cloud` fallisce con un errore non chiaro. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto su cui `rebase db push`, `db generate` e `db migrate` calcolano le differenze di schema, in alternativa al database `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina il database indicato qui, e ne rifiuta uno coincidente con `DATABASE_URL`. Sul database di sviluppo gestito, la CLI lo imposta su un'istanza temporanea PGlite in-memory dedicata. Da impostare nei contesti in cui non è concesso il privilegio `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue il provisioning — richiede un database fornito manualmente. Equivale a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del server dev frontend, che altrimenti `rebase dev` ricava dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa di `rebase dev` per la risposta del backend prima di segnalare che non si è avviato. `0` disabilita la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password che `rebase dev --docker` inserisce nella stringa di connessione ricavata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione comune tra vari strumenti. Se impostata su qualsiasi valore diverso da `0`, la CLI non invia dati di telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | La stessa funzionalità, specifica per Rebase. Non richiede alcun file, ed è quindi l'opzione da preferire in ambienti CI e all'interno di immagini. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint a cui trasmettere la telemetria, per collettori self-hosted. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` impedisce alla CLI di interrogare il registro npm (o `npm_config_registry`), una volta al giorno tramite processo in background, per verificare i dist-tag di `@rebasepro/cli`, e nasconde la riga "Rebase X is out; this CLI is Y" mostrata su stderr al termine di qualsiasi comando tranne `rebase upgrade`. L'esito viene memorizzato in `~/.rebase/release-check.json` e la richiesta non invia altre informazioni. Già disattivato per impostazione predefinita in CI; `NO_UPDATE_NOTIFIER` ha il medesimo effetto. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Impostato dalla CLI per i processi da essa avviati, evitando che un comando che richiama a sua volta la CLI mostri più volte l'avviso "Rebase X is out". L'impostazione manuale nasconde l'avviso per il processo interessato, similmente a `REBASE_NO_UPDATE_CHECK`. | — |

## Segreti in ambiente di sviluppo

`JWT_SECRET` è obbligatorio in produzione. Insieme a `REBASE_SERVICE_KEY` viene
generato automaticamente negli altri ambienti, consentendo di iniziare a lavorare senza
configurazioni preventive.

I valori generati vengono memorizzati nella cache in `.rebase-dev-secrets.json`, accanto a
`.rebase-dev-port` e `.rebase-dev-url` e ignorati da git insieme ad essi. In precedenza
venivano rigenerati a ogni avvio — comportando la disconnessione dall'applicazione
e l'invalidazione di qualsiasi chiave API appena creata a ogni riavvio del dev server.

- Impostando esplicitamente una delle due variabili verrà utilizzato il valore fornito; nulla verrà memorizzato nella cache o letto da essa.
- Per reindirizzare la cache altrove, utilizzare `REBASE_DEV_SECRETS_FILE` — un percorso, nonché
  l'unica variabile di questa sezione che si abbia motivo di configurare manualmente.
- Eliminare il file per rigenerare entrambi i segreti. Il riavvio successivo ne genererà uno nuovo.
- Se il file non può essere scritto — ad esempio all'interno di un container in sola lettura — il server
  si avvia comunque con un segreto effimero, esattamente come in precedenza.

Nulla viene memorizzato nella cache in produzione o durante l'esecuzione dei test runner. In produzione non
viene generato alcun valore automatico: un avvio senza `JWT_SECRET` fallisce indicando la variabile mancante,
rimanendo invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

Il tipo `RebaseBackendConfig` passato a `initializeRebaseBackend()` offre il controllo programmatico della configurazione:

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
backend che non gestisce alcuna richiesta finché non viene montato esplicitamente: `createRebaseBackend`. Consultare
[Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta tutte le route API, pertanto anche il client deve essere configurato in modo conforme —
altrimenti continuerà a effettuare richieste a `/api/...` ricevendo risposte 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione eredita questa impostazione dal client a cui è collegato; non è necessaria
alcuna ulteriore configurazione. Se si compone manualmente l'URL di una richiesta, ricavarlo dal client
invece di digitare direttamente `/api`:

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
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'editor SQL cambiando temporaneamente i ruoli del database in modo che corrispondano al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli esistono solo nelle tabelle del database e non corrispondono a ruoli PostgreSQL reali, il cambio di ruolo fallisce o mancano i relativi privilegi nel database. La vista CMS a foglio di calcolo viene invece eseguita con l'utente proprietario della connessione predefinito e bypassa questo meccanismo.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo forza Rebase a eseguire le query dell'editor SQL utilizzando i privilegi del proprietario della connessione (solitamente un superuser o owner). L'editor SQL indicherà quindi, sopra i risultati, che i dati sono stati letti con l'utente proprietario della connessione e disabiliterà il selettore del ruolo.

### Recupero dello schema nell'Editor SQL non riuscito (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'editor SQL genera l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornito al bootstrapper, oppure `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Assicurarsi che `adminConnectionString` sia configurato durante l'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Passaggi successivi

- **[Deployment](/docs/getting-started/deployment)** — Guida al deployment in produzione
- **[Panoramica del backend](/docs/backend)** — Guida di riferimento completa alla configurazione del backend
