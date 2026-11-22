---
sourceHash: df5e0441849e5e57
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> manca qualcosa di obbligatorio o se un valore è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come si esegue il backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che è
> l'unione di ogni tabella sottostante. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })` e può aggiungere
> lì le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione a PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue un PostgreSQL gestito per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria ovunque altrove. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **Su un database gestito, `sslmode=require` potrebbe non significare ciò che dice.**
>
> Per `psql` e ogni strumento basato su libpq, `require` significa "crittografato, certificato
> non verificato". Il driver Node su cui si basa Rebase lo interpreta come `verify-full`, quindi
> un database il cui certificato non è stato firmato da un'autorità pubblica — cosa comune
> sui Postgres gestiti — rifiuta il runtime con `self-signed certificate`, mentre `psql`
> si connette con lo stesso URL. Il runtime e i comandi `rebase db` si interrompono con un
> messaggio che spiega questo.
>
> Scegliere una delle seguenti opzioni:
>
> - **`sslmode=no-verify`** — crittografato, non verificato: ciò che `require` significa per
>   libpq. È una sintassi specifica di node-postgres non supportata da libpq, quindi `psql`, `pg_dump`
>   e Atlas la rifiutano con `invalid sslmode value: "no-verify"`. I comandi interni di Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la passano a questi strumenti come
>   `sslmode=require`, funzionando quindi con l'URL così come configurato; per usare
>   `psql` manualmente, sostituirla con `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificato rispetto al certificato
>   CA del provider. Identico per ogni strumento.
>
> `uselibpqcompat=true&sslmode=require`, suggerito dal warning stesso del driver Node,
> funziona anche per il runtime; i comandi di Rebase rimuovono `uselibpqcompat`
> prima di passare l'URL agli strumenti libpq, che altrimenti lo rifiuterebbero.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Impostare solo in sviluppo** — vedi sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | ID client OAuth di Google. Abilita "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostata nelle build di produzione.**
>
> In sviluppo, frontend e backend risiedono su origini separate, quindi il server
> di sviluppo inietta questa variabile. In produzione il backend di Rebase serve la SPA,
> quindi l'API coincide con l'origine stessa della pagina e il client la risolve
> autonomamente in questo modo.
>
> Inserire direttamente un URL assoluto in un bundle di produzione funziona finché un secondo
> hostname non punta alla stessa app: un dominio personalizzato caricherebbe la pagina da
> `example.com` ed effettuerebbe chiamate API a `example.rebase.website`, che è
> cross-origin, facendo fallire ogni richiesta in fase di preflight. Consentire l'origine in CORS
> **non** risolve il problema: il cookie di refresh ha `SameSite=Lax` e non viene inviato
> cross-site, quindi si eliminerebbero gli errori in console ma l'autenticazione rimarrebbe
> comunque compromessa. Se lasciata non impostata, qualsiasi dominio che punta all'app funziona
> senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un `PORT` in `.env` non viene letto lì, perché la porta viene risolta prima che quel file venga caricato — altrimenti associa una porta derivata dal percorso del progetto, consentendo l'esecuzione di più progetti contemporaneamente. `rebase dev --port` ha la precedenza su entrambi, e il banner di avvio indica la priorità utilizzata. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra il codice SQL dietro una riga `Failed query: [redacted]`. Ogni istruzione non riuscita viene oscurata per impostazione predefinita, poiché una query fallita contiene i parametri associati — un'email, un hash di password. Impostare su `true` durante la diagnosi di errori relativi a DDL, RLS o change capture. Ignorato quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatorio in produzione** a meno che `FRONTEND_URL` non sia impostato: un avvio in produzione senza nessuno dei due rifiuta di partire. In sviluppo viene *aggiunto a* localhost — vedi sotto. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzato come alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi di amministratore (usata per l'introspezione dello schema e le operazioni di amministrazione). Il database specificato non è quello che la console SQL considera corrente, né quello copiato per impostazione predefinita da un nuovo branch: entrambi corrispondono al database su cui risiede la connessione dell'applicazione stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del DB non sono mappati). La console SQL di Studio indicherà quindi che le righe sono state lette come proprietario della connessione, indicandone il nome, e disabiliterà il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui viene eseguito questo server. `rebase dev` lo imposta su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server con questa variabile mantiene il registro dei branch su quel database e copia i nuovi branch da esso per impostazione predefinita, consentendo al pannello Branches di Studio di mostrare i branch del database principale. | — |

#### CORS in sviluppo

Lo sviluppo consente **localhost, più qualsiasi origine specificata in `CORS_ORIGINS` (o `FRONTEND_URL`)** — lo stesso elenco utilizzato in produzione, con localhost aggiunto anziché sostituito. Di conseguenza, la variabile funziona allo stesso modo in entrambi gli ambienti, e i casi in cui è necessaria in sviluppo sono quelli tipici:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non è né localhost né presente in elenco viene rifiutata, e il rifiuto viene
registrato nei log **una volta per origine** con l'esatta riga necessaria per consentirla. Il rifiuto
non è pura cautela fine a se stessa: l'API trasmette credenziali, quindi riflettere un
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate verso il server di sviluppo con la sua sessione e leggerne le
risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Segreto per la firma dei JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare i token di accesso in modo asimmetrico (RS256), consentendo a qualsiasi entità in possesso del JWKS di verificare una sessione senza poterla generare. Accetta un PEM con interruzioni di riga reali, un PEM con caratteri di escape `\n` o l'intero PEM in base64. Senza di essa, i token restano HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificarlo ogni volta che la chiave cambia: la rotazione richiede che la vecchia e la nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del refresh token. Scorrevole — ogni rotazione la rinnova, quindi governa la durata della sessione in caso di **inattività**. Impostare a `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser pongono qui il limite massimo per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione, il **primo** utente può sempre registrarsi, indipendentemente da questo valore — una tabella utenti vuota deve pur ammettere qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) tale finestra è chiusa: una tabella vuota rifiuta la registrazione iniziale di bootstrap con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta è un normale account utente, e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` sotto o assegnato tramite service key. Il file `.env.example` dello scaffold lo imposta su `true`; il default del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruttore di emergenza (kill switch). Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, bloccando la registrazione anche a fronte di un database vuoto. Da associare a `REBASE_ADMIN_EMAIL` qui sotto, altrimenti il deployment non ha modo di creare il suo primo chiamante autenticato. Ogni artefatto di deployment distribuito lo imposta. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella degli utenti è ancora vuota** e mai successivamente. È il modo in cui una distribuzione di produzione ottiene il suo amministratore: l'operatore specifica il primo account invece di dover anticipare utenti esterni su Internet. All'avvio viene emesso un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per quell'account. Almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa tutti i segreti TOTP archiviati. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e all'avvio compare un avviso — pertanto la rotazione di `JWT_SECRET` disconnette tutti gli utenti *e* rende indecifrabili tutti gli autenticatori registrati. Impostare una chiave dedicata (minimo 32 caratteri casuali) prima che qualcuno si registri. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave precedente durante una rotazione. Impostarle entrambe durante la transizione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che qualcuno rimanga bloccato fuori dal proprio account a metà procedura. Rimuoverla dopo che tutti i segreti sono stati ricifrati. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, volutamente non vincolata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per le API dei dati. Impostare su `false` per una superficie di lettura interamente pubblica — le policy RLS continuano a essere applicate. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato se non ne viene specificato alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Espone l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato solo ai chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Valore `SameSite` per il cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato solo a un frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Flag `Secure` sul cookie di refresh. Attivo per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per connessioni http non cifrate — tipico di un deployment su indirizzo LAN in cui il browser altrimenti scarterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza mostrare errori. Emette un avviso all'avvio. Non necessario per `http://localhost`. | `true` |
| `GOOGLE_CLIENT_ID` | ID client OAuth di Google (convalida lato backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret OAuth di Google | — |
| `GITHUB_CLIENT_ID` | ID client OAuth di GitHub | — |
| `GITHUB_CLIENT_SECRET` | Client secret OAuth di GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID client OAuth di Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret OAuth di Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID client OAuth di LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret OAuth di LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID client OAuth di Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret OAuth di Facebook | — |
| `TWITTER_CLIENT_ID` | ID client OAuth di X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Client secret OAuth di X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID client OAuth di Discord | — |
| `DISCORD_CLIENT_SECRET` | Client secret OAuth di Discord | — |
| `GITLAB_CLIENT_ID` | ID client OAuth di GitLab. Il `baseUrl` di un'istanza self-hosted non ha una corrispondenza diretta nelle variabili d'ambiente: per configurarlo, utilizzare il blocco `auth`. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID client OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | ID client OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | ID client OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | Apple Services ID, per l'accesso web. È pubblico e viene esposto in `GET /auth/config`. Apple non utilizza un client secret statico, poiché Rebase firma un JWT ES256 a breve durata per ciascuno scambio di token. Di conseguenza, Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o ad `APPLE_BUNDLE_IDS`, e non configura nulla in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | ID bundle separati da virgola delle app native iOS/macOS i cui codici di Accedi con Apple sono accettati. | — |
| `APPLE_TEAM_ID` | Team ID dello sviluppatore Apple, l'issuer del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata presso Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi i ritorni a capo (sono accettati i caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API statica di amministrazione. Bypassa la normale autenticazione JWT per le chiamate server-to-server quando passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) rispetto alla quale vengono verificati i token di piattaforma `rpt_`; più blocchi PEM durante una rotazione delle chiavi. Viene impostata dalla piattaforma al momento del deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE`, consente al gate di amministrazione di accettare un token di piattaforma per `cron:read`, e per nient'altro. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID progetto a cui deve corrispondere il claim `aud` di un token di piattaforma, in modo da rifiutare i token generati per altri progetti. Se è impostata solo una delle due variabili, il server si avvia, registra un avviso e risponde a qualsiasi token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destinazione del pulsante **Continue with Rebase Cloud** nel pannello di amministrazione: la pagina del progetto nella console della piattaforma, che effettua l'accesso dei proprietari del progetto e reindirizza indietro. La piattaforma lo imposta al deploy insieme ai due parametri sopra; con essi, `POST /api/auth/platform-signin` accetta il token temporaneo di un minuto `auth:admin-signin` della piattaforma e avvia una sessione di amministrazione. Senza di esso, l'accesso funziona comunque tramite il pulsante **Open CMS** della console, e la schermata di login ne spiega semplicemente il funzionamento. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione di archiviazione dei contatori di rate limit per le route di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per processo) o `sql` (condiviso tra le repliche). Un processo non può conoscere il numero delle proprie repliche, quindi un deployment distribuito deve indicarlo esplicitamente — tre repliche con il valore predefinito applicherebbero il triplo del limite previsto. Qualsiasi altro valore **rifiuta l'avvio** anziché ripiegare su un fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso senza password tramite magic link. Richiede un servizio email configurato, altrimenti il link non può essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password con codice a sei cifre inviato via email. Stessi requisiti di posta indicati sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic link o codice email per un indirizzo non registrato crea l'account, purché la registrazione sia aperta. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un refresh token dopo la sua finestra di tolleranza: `reject` (lo rifiuta, mantiene la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore fa fallire l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma preventiva: nessun accesso tramite password finché l'indirizzo non è stato verificato. Richiede il servizio email; in caso contrario l'avvio viene rifiutato. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica tramite captcha sulle route di autenticazione: `turnstile` o `hcaptcha`. Non impostata indica nessun captcha. | — |
| `CAPTCHA_SECRET` | Segreto del provider, utilizzato lato server per verificare il token inviato dal browser. Obbligatorio una volta impostato `CAPTCHA_PROVIDER`. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgole delle route di autenticazione da proteggere (ad esempio `register,login`). Se non impostato, protegge il set predefinito del provider. | — |

### Storage

<span class="since-badge" data-since="0.35">Since 0.35</span>

:::caution[Lo storage non dispone di sicurezza a livello di riga, quindi richiede un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. L'object storage non ha un equivalente —
le chiavi condividono un unico namespace piatto — pertanto, in presenza di un bucket configurato
senza alcun modello di accesso, il server **rifiuta l'avvio in produzione**. È necessario soddisfare
questo requisito con esattamente uno dei seguenti elementi: un hook `storageAuthorize` esportato da
`backend/storage.ts` (fornito di default nello scaffold), `STORAGE_POLICIES`, `STORAGE_PUBLIC_READ`
o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di storage: `local`, `s3`, `gcs` o `platform` (file in un prefisso di proprietà della piattaforma di hosting, trasferiti tramite URL firmati dal relativo storage broker; impostato dalla piattaforma). In produzione, `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso base per lo storage locale. Un percorso relativo viene risolto a partire dalla directory in cui viene eseguito il server: la radice del progetto sotto `rebase dev`, `backend/` in un server generato con `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — solo in presenza di un volume persistente che ospita `STORAGE_PATH` e le cartelle `<STORAGE_PATH>__<key>` dei bucket locali nominati adiacenti ad esso | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token inserito da `getSignedUrl()`. Massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente con nome. Se non è un numero intero di byte, l'avvio viene rifiutato | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Access key AWS | — |
| `S3_SECRET_ACCESS_KEY` | Secret key AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza gli URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Di norma dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file della chiave del service account. Omettere su GCP, dove Workload Identity fornisce le credenziali. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce ogni oggetto a chiunque, senza token. Da usare solo per un bucket che funge realmente da CDN pubblica. Uno dei modi per soddisfare il controllo di avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi chiamante autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. Denominato `INSECURE` nell'oggetto di configurazione per un motivo: è giustificabile solo in un'applicazione single-tenant in cui ogni account è ritenuto affidabile per tutti i file. | `false` |
| `STORAGE_POLICIES` | Regole di accesso allo storage in formato JSON: `[{ "path", "operations"?, "allow" }]`, dove `allow` può essere `"public"`, `"authenticated"`, `"owner"` o `{ "roles": [...] }`. Nega per impostazione predefinita e soddisfa il controllo di avvio. Una lista non valida impedisce l'avvio. Vedere [Autorizzazione dello storage](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Lo storage broker della piattaforma, per `STORAGE_TYPE=platform`. Impostato dalla piattaforma che esegue il broker. | — |
| `STORAGE_BROKER_PROJECT` | L'ID del progetto a cui il broker limita i file di questo deployment, per `STORAGE_TYPE=platform`. Impostato dalla piattaforma. | — |
| `STORAGE_RENDITION_CACHE` | Memorizza nella cache le versioni generate delle immagini (ridimensionamenti, conversioni di formato) invece di produrle per ogni richiesta. | `false` |

### Email (Opzionale)
`MAGIC_LINK_URL`.

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato sull'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato negli oggetti e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato in cima ai template email predefiniti. PNG o JPG assoluto `http(s)` — i client rimuovono gli SVG e bloccano gli URI `data:`. Se non impostato, un'app ancora denominata `Rebase` riceve il logo Rebase, mentre una rinominata non ne riceve alcuno |
| `MAGIC_LINK_URL` | Destinazione a cui punta un magic link inviato per email. A un percorso base viene aggiunto `/auth/magic-link?token=…`; un URL contenente `{token}` rappresenta l'intero link, utile per un frontend che non serve `/auth/magic-link`. Racchiuderlo tra virgolette in `.env`, dove un carattere `#` non quotato avvia un commento: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valore contenente un hash o un percorso di file senza `{token}` genera un avviso all'avvio. Se non impostato, la base è `FRONTEND_URL` |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di mantenimento di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (senza pooling). Il modulo [Realtime](/docs/backend/realtime) ne richiede una: `LISTEN`/`NOTIFY` non sopravvive a un pooler in modalità transazione come PgBouncer e, senza di essa, le notifiche di modifica vengono disabilitate con un avviso invece di andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene su di essa il proprio `LISTEN` di riattivazione. Popola `directConnectionString` dell'adapter Postgres quando non impostato. | — |
| `DATABASE_READ_URL` | Replica di lettura, come un hot standby. Quando indica un altro server, le letture autenticate (elenchi, singole righe, conteggi, aggregazioni) vengono servite da lì sotto la medesima sicurezza a livello di riga; scritture, accessi, realtime, cron, job, la console SQL e `rebase.sql` rimangono sul primario. Un client che ha appena scritto legge dal primario per un intervallo pari a `REBASE_READ_STICKY_MS`, e tutti lo fanno se il ritardo della replica supera `REBASE_READ_MAX_LAG_MS` o se la replica fallisce. Popola `readConnectionString` dell'adapter Postgres quando non impostato; fino alla versione 0.28 inclusa, il pool della replica veniva aperto ma mai utilizzato per le letture. | — |
| `REBASE_READ_STICKY_MS` | Dopo una scrittura, tempo durante il quale le letture dello stesso utente vengono indirizzate al primario, in modo che un salvataggio seguito da un elenco mostri i dati aggiornati. Per istanza di server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Ritardo di replica oltre il quale ogni lettura viene indirizzata al primario. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa attraverso un pooler in modalità transazione come PgBouncer. Il pool non invia quindi `search_path` o `statement_timeout` alla connessione (il pooler li rifiuterebbe o li scarterebbe) e imposta entrambi all'interno di ciascuna transazione; l'avvio assegna al ruolo del database un `search_path` predefinito di `public` per le istruzioni esterne a una transazione. `DATABASE_DIRECT_URL` diventa obbligatoria, e realtime, la riattivazione del job worker, la creazione degli indici, il branching e la console SQL la utilizzano tutti. Anche l'URL della replica viene considerato con pooling. `DATABASE_POOLED__<KEY>` per un'altra sorgente dati. | — |
| `REBASE_DB_POOL_MAX` | Un tetto massimo su ogni pool nel processo, applicato a prescindere da quanto richiesto da ciascuno di essi. Solo cifre semplici: un valore malformato viene ignorato anziché serializzare silenziosamente il server. | — |

### Comportamento del runtime

Letto dal runtime — `rebase dev`, `rebase start` e l'immagine del server
pubblicata. Un progetto che ha eseguito l'eject gestisce invece queste decisioni
direttamente nel proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | `true` esegue l'[audit della row-level security](/docs/rls-check#running-it-on-a-schedule) pianificato, che segnala le tabelle servite senza policy. Il progetto deve dichiarare `@rebasepro/rls-check` tra le sue dipendenze: il runtime non ne include alcuna copia e, senza il pacchetto, l'avvio viene rifiutato indicandone il nome. `false` mantiene la scansione disattivata su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres con cui vengono eseguite le richieste autenticate e anonime. Assegnarne uno dedicato a ciascun progetto su un cluster condiviso. Il database registra il ruolo con cui viene eseguito, e un avvio configurato per un altro ruolo rifiuta di partire finché `rebase db request-role migrate` non lo aggiorna. Vedere [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crea il ruolo di richiesta e consente alla connessione di passare ad esso; `never` lascia entrambi all'utente, limitandosi a verificarli. | `auto` |
| `REBASE_RLS_GRANTS` | I privilegi concessi da Rebase al ruolo di richiesta: `schema` (ogni tabella negli schemi serviti, più i privilegi predefiniti), `managed` (solo le tabelle servite) o `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe le policy permissive di Rebase al/ai ruolo/i di richiesta, in modo che altri ruoli che leggono le stesse tabelle non ottengano nulla da esse. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` scrive le policy a cui solo il contesto del server o un amministratore possono accedere come `TO public`, ed esegue gli amministratori con il ruolo di richiesta. Per impostazione predefinita sono `TO rebase_admin`, in modo che le letture limitate al proprietario degli utenti autenticati possano utilizzare l'indice del proprietario. Vedere [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` rimuove la policy di base server-o-amministratore da ogni tabella. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` imposta anche `request.jwt.claims` e `request.jwt.claim.*`, in modo che le policy scritte con `auth.uid()` rilevino il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio quando un altro login può passare al ruolo di richiesta: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso base per ogni route API. Il client deve essere configurato in modo corrispondente — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve le risorse statiche e di amministrazione del bundle da questo processo. Disattivare se è presente una CDN a monte. | `true` |
| `REBASE_STUDIO` | Serve la console standalone integrata Rebase Studio su `/_studio` quando è disponibile un bundle statico di Studio. Impostare su `false` per disabilitare. | `true` |
| `REBASE_STUDIO_DIR` | Directory contenente la SPA standalone precompilata di Rebase Studio servita su `/_studio`. Il valore predefinito è `/studio` nell'immagine del container. | `/studio` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Comprime le risposte con gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` attiva le [notifiche push](/docs/backend/push-notifications/): le route `/api/push`, la tabella `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Coppia di chiavi VAPID utilizzata per firmare i messaggi push. Al di fuori della produzione, se non impostata, ne viene generata una salvata in `.rebase-dev-secrets.json`; in produzione le notifiche push restano disattivate senza di esse. | — |
| `REBASE_VAPID_SUBJECT` | Un indirizzo `mailto:` o un URL `https://` con cui i servizi push possono comunicare. Il valore predefinito è l'origine di un `REBASE_PUBLIC_URL` in `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima del corpo della richiesta, **in byte** (`10485760`, non `10MB` — un valore non numerico impedisce l'avvio invece di rimuovere silenziosamente il limite). `0` disattiva il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superficie OpenAPI. A tre stati. Se non impostata, in ogni ambiente: `/api/docs` viene servito ai chiamanti a cui `GET /api/schema/tables` descrive le tabelle, ciascuno con il documento relativo alle tabelle descritte, e non è presente alcuna Swagger UI. `true` pubblica l'intero documento a chiunque, con la Swagger **UI** su `/api/swagger` fuori dalla produzione (mai in produzione). `false` mantiene il documento protetto dal controllo di amministrazione. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus su `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge `includeSubDomains` all'header `Strict-Transport-Security`, in modo che i browser rifiutino l'HTTP non cifrato su ogni sottodominio dell'host per sei mesi — inclusi gli host non serviti da questo processo. Attivare solo se ogni sottodominio del dominio è esclusivamente HTTPS. Qualsiasi valore diverso da `true`/`false` rifiuta l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token di protezione per `/metrics`. Se non impostato, l'endpoint rimane aperto a chiunque possa raggiungere la porta — accettabile su una rete privata, non su una pubblica, e i log di avvio lo segnalano. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni che il runtime può eseguire sullo schema delle tabelle all'avvio. `ensure` (il default, ovunque — inclusa la produzione) esegue il passaggio **additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminarne o riscriverne alcuno. `none` lascia inalterato lo schema delle tabelle dichiarate, ma le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; `REBASE_PROVISION=false` disattiva anche queste. L'immagine pubblicata accetta solo questi due valori e **rifiuta l'avvio con `push`**. In una [distribuzione suddivisa](/docs/deployment/split-processes), esattamente un processo può effettuare il provisioning, quindi ogni altro ruolo deve impostare `none` o rifiutare l'avvio. | `ensure` |
| `REBASE_PROVISION` | `false` fa sì che il runtime non modifichi nulla nel suo database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o concessione (grant), all'avvio o successivamente, comprese quelle del framework. Segnala invece per nome ciò che risulta mancante. Utile per database modificabili solo dal proprio processo di gestione delle modifiche. Vedere [Quando solo il tuo processo di modifica può alterare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Rifiuta l'avvio quando il provisioning del database è stato eseguito per l'ultima volta a partire da un insieme di tabelle diverso da quello su cui è stato compilato questo processo. Se non impostato (o per qualsiasi valore diverso da `true`/`1`), emette un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Rifiuta l'avvio se un file di funzione o di cron genera un'eccezione o non viene analizzato durante l'importazione, indicando ogni file e la causa, in modo che un rilascio progressivo mantenga attiva la versione precedente. Anche il riavvio è vincolato a questa condizione. Se non impostato (o per qualsiasi valore diverso da `true`), salta il file e serve il resto. Un file importato correttamente che non esporta funzioni o job viene sempre ignorato, non rifiutato. | skip |
| `REALTIME_CDC` | Cattura delle modifiche a livello di database: `auto` (legge le modifiche dal WAL dove consentito dal database, altrimenti usa i trigger, altrimenti ricorre al fallback a livello applicativo, registrando ogni fallback come info), `trigger` (lo forza, avverte se impossibile), `wal` (legge le modifiche dal write-ahead log invece che dai trigger; richiede `wal_level=logical` e un ruolo abilitato alla replica, altrimenti ripiega su `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Prevale su `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Trasporto tra istanze per i canali di broadcast e la presenza: `memory` o `postgres`. Ignorato se a `realtime.bus` è stato passato un trasporto personalizzato. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quante sottoscrizioni può mantenere un singolo socket realtime; la successiva viene rifiutata con `TOO_MANY_SUBSCRIPTIONS`. Un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Prevale su `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quanti socket realtime può mantenere aperti un singolo utente, o una chiave API, su una singola istanza di server. I socket di impersonificazione di un amministratore vengono conteggiati a carico dell'amministratore. L'autenticazione del socket successivo viene rifiutata con `TOO_MANY_SOCKETS` e il socket viene chiuso (4002); l'SDK riprova automaticamente, permettendo la connessione non appena un altro socket si chiude. Un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Prevale su `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo di attesa, in ms, prima che una modifica attivi il recupero (refetch) che la consegna ai sottoscrittori attivi. Un refetch attende 300 ms senza modifiche, e al massimo questo intervallo sotto un flusso continuo di scritture. Un numero intero positivo — qualsiasi altro valore arresta il server all'avvio. Prevale su `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo di tempo, in ms, per cui il totale di una sottoscrizione a elenchi di grandi dimensioni può essere riutilizzato prima di essere ricalcolato; i frame che lo riutilizzano includono `meta.totalAsOf`. Se non impostato, ogni frame effettua il conteggio. Prevale su `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | La soglia minima dell'ultimo totale a cui si applica `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi più piccoli vengono conteggiati a ogni frame. Prevale su `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori `localhost`/loopback con `NODE_ENV=production`. Disattivato, affinché un avvio in produzione fallisca esplicitamente anziché connettersi a un database inesistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` esegue il passaggio dello schema ed esce senza aprire un socket — il formato ideale per un Job di migrazione, a partire dalla stessa immagine e dallo stesso bundle del server successivo. Crea inoltre le tabelle che un processo attivo creerebbe al primo utilizzo, e non avvia cron o code di job. Un valore vuoto equivale a *non impostato*, evitando che un `${SOMETHING}` non sostituito in un file compose trasformi un deployment ordinario in uno che migra e rifiuta di servire traffico. Non consentito insieme a `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un percorso file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive ogni modifica allo schema apportata, in ordine, sotto forma di script SQL da revisionare e applicare con `psql`. Le righe scritte non sono incluse. Rifiutato su un processo che serve traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` consente a una macchina — un agente, un job di CI — di *applicare* una modifica di schema tramite `/api/admin/schema`, non solo di pianificarla. Disattivato se non espressamente richiesto: la credenziale che applicherebbe tale modifica è quella con maggiori probabilità di risiedere in una variabile di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durata massima consentita per l'esecuzione di una funzione personalizzata prima che la richiesta venga interrotta. Corrisponde all'opzione `functionsTimeoutMs`. `0` disattiva il limite. Una funzione che ne dichiara uno proprio (`defineFunction(…, { timeoutMs })`) usa invece il valore dichiarato. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Il timeout massimo che una funzione può dichiarare per se stessa con `defineFunction(…, { timeoutMs })`, in ms; una funzione che richiede un valore superiore riceve questo limite. Un numero positivo; qualsiasi altro valore viene interpretato come non impostato. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fa sì che una promessa rifiutata non gestita termini il processo anziché limitarsi a registrarla nei log. Da attivare sotto un orchestratore configurato per il riavvio; disattivare dove un riavvio è peggiore di un leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Disattiva l'avviso di avvio su piattaforme rilevate dal runtime come con scalabilità a zero (scale-to-zero), in cui un timer che scatta su un'istanza inattiva finirebbe per non scattare su alcuna istanza. Non modifica nient'altro: impostare quando si mantiene almeno un'istanza sempre in esecuzione. | — |
| `TRUSTED_PROXY_HOPS` | Quanti proxy precedono questo server, permettendo al rate limiter di leggere il vero indirizzo del client dall'header `X-Forwarded-For`. Valore fail-safe predefinito `0`: in assenza di proxy, fidarsi dell'header permetterebbe a qualsiasi chiamante di falsificare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non è uno strumento di migrazione]
Il passaggio all'avvio viene eseguito automaticamente senza supervisione umana su un diff,
pertanto non eliminerà mai una colonna, non restringerà mai un tipo e non riscriverà mai una tabella.
È anche il motivo per cui l'immagine rifiuta `REBASE_MIGRATE_ON_BOOT=push`: un push completo calcola
un diff e potrebbe tranquillamente eseguire un `DROP COLUMN`, mentre il riavvio di un container
non deve mai rischiare di distruggere una colonna in produzione come effetto collaterale di una
riprogrammazione (rescheduling).

Le modifiche distruttive o strutturali rimangono in contesti in cui possono essere revisionate:
`rebase db generate` + `rebase db migrate`, oppure `rebase db push` da un checkout locale o da CI,
che esegue una simulazione della modifica (dry-run), rifiuta quelle distruttive in assenza di conferma
ed è in grado di eseguire prima un backup.
:::

### Distribuzioni suddivise

Un'unica immagine e un unico bundle possono essere avviati più volte, ognuno dei
quali serve una parte diversa del progetto. Qui è riportata una riga per ciascuna
variabile, poiché questa pagina elenca tutte le opzioni; cosa ogni combinazione
*monta e gestisce* — e quali combinazioni rifiutano l'avvio — è descritto in
**[Processi suddivisi](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Quale componente serve questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron su *questo* processo. Se non impostato, segue il ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job su questo processo. Se non impostato, segue il ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve solo le funzioni personalizzate specificate in questo processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve tutte le funzioni personalizzate tranne quelle specificate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione a cui il processo API inoltra una richiesta di funzione che non gestisce direttamente. Su un `worker`, corrisponde alla destinazione delle sue chiamate `rebase.functions`. Un URL `http(s)`. | — |

### Superficie MCP

Un endpoint Model Context Protocol opzionale su `/mcp`, che consente a un client AI
di leggere e scrivere su questo progetto **come utente autenticato**. Disattivato
se non esplicitamente impostato e — a differenza di qualsiasi altra superficie —
nessun `REBASE_ROLE` lo attiva automaticamente: gli altri descrivono la conformazione
di un processo, mentre questo rappresenta la scelta di affidare credenziali a software
di terze parti, una decisione che dovrebbe essere presa da una persona anziché
ereditata dal ruolo di un container.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Abilita la superficie MCP. Richiede `REBASE_PUBLIC_URL`; senza di esso, la superficie rifiuta di essere montata e lo segnala nel log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine raggiungibile dall'esterno di questa distribuzione, ad es. `https://app.example.com`. La superficie MCP non può ricavarla autonomamente — estrarre l'origine dall'header `Host` renderebbe l'identità dell'emittente, e l'audience con cui vengono convalidati i suoi token, un valore fornito dal chiamante. | — |
| `REBASE_MCP_VIEW` | Percorso della vista dell'app MCP del progetto (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude al posto della vista generica in modo da fargli visualizzare le viste, i campi e le azioni personalizzati. Senza di essa, il backend cerca accanto al frontend che serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), permettendo a un client di registrarsi autonomamente. Impostare su `false` per richiedere la pre-registrazione dei client. | `true` |

### Modifica dello schema in tempo reale da un bundle

Disattivato a meno che non sia impostato `REBASE_LIVE_SCHEMA_REPOSITORY`. Un bundle
compilato non contiene il codice sorgente `backend/schema` da modificare, quindi
con queste variabili impostate l'editor dello schema legge il sorgente dal repository,
vi esegue il commit di ciascuna modifica e applica il relativo DDL su questo database.
Riservato agli amministratori e applicato manualmente da una persona, a meno che
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` non stabilisca diversamente. Un repository
configurato senza credenziali valide impedisce l'avvio. Vedere
[Modifica dello schema in tempo reale](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Il repository GitHub su cui effettuare il commit delle modifiche dello schema, nel formato `owner/name`. Impostarlo abilita la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Il branch su cui viene effettuato il commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione di `backend/schema` in quel repository, relativa al repository stesso. Un percorso che esce dal repository impedisce l'avvio, così come il parametro deprecato `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token con permessi granulari (fine-grained) con accesso in lettura e scrittura ai contenuti del repository. Impostare questo o le tre variabili `_GITHUB_APP_*`, non entrambi. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID di una GitHub App, per effettuare il commit come app anziché tramite token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installazione dell'app sul repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La chiave privata dell'app: PEM, PEM con ritorni a capo preceduti da escape o base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per i backup pianificati. Se non impostata, i backup pianificati sono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso locale, o un URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatorio insieme a `BACKUP_SCHEDULE`, che rifiuta l'esecuzione in sua assenza. `rebase db backup` ripiega su `./backups` nella cartella in cui è stato eseguito. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di N giorni. Se non impostato o pari a `0`, conserva tutto. | — |
| `BACKUP_KEEP_MINIMUM` | Mantiene sempre almeno N tra i backup più recenti, indipendentemente dalla retention. | — |
| `PG_DUMP_PATH` | Specifica un percorso personalizzato per il binario `pg_dump` — deve corrispondere alla versione principale del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Specifica un percorso personalizzato per il binario `pg_restore`. | — |
| `PSQL_PATH` | Specifica un percorso personalizzato per il binario `psql` eseguito da `rebase db restore --clean` per rendere il ripristino un'unica transazione. | — |
| `PG_DUMPALL_PATH` | Posizione del file binario `pg_dumpall`, se non incluso nel `PATH`. In sua assenza — e senza i client tool di PostgreSQL installati — un backup dei globals fallisce con un errore che fa riferimento a questa variabile. | — |

L'immagine di runtime ufficiale (`rebasepro/server`) include i client tool di PostgreSQL 18,
quindi un backup pianificato eseguito al suo interno funziona su qualsiasi server fino a Postgres 18.
Al di fuori dell'immagine, è necessario installarli manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono segreti e informazioni di identificazione personale (PII). Utilizzare una
destinazione privata con crittografia a riposo.

### Distribuzione dei bundle

Una distribuzione gestita non include il proprio codice nell'immagine: il runtime recupera
un bundle all'avvio. Queste opzioni stabiliscono quale recuperare e con quali modalità.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso verso una directory del bundle già estratta. Quello che `rebase start` imposta localmente. | — |
| `REBASE_BUNDLE_URL` | Posizione da cui scaricare l'archivio del bundle, quando non ne è presente uno locale. | — |
| `REBASE_BUNDLE_TOKEN` | La credenziale bearer per tale download. Trattarla come un segreto: è ciò che autorizza un tenant a scaricare il proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory in cui viene estratto un bundle scaricato. Deve essere scrivibile e deve persistere tra il download e l'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi forniti dall'immagine di runtime al bundle, oltre a quelli dichiarati dal bundle stesso. | — |

### Binding delle risorse

Ogni database, bucket e topic dichiarato da un progetto in `backend/resources.ts` viene
associato tramite variabili d'ambiente con nomi derivati dalla risorsa. I nomi di base
sono indicati di seguito; una risorsa non predefinita aggiunge `__` e la propria chiave
in lettere maiuscole, quindi un bucket denominato `media` leggerà `S3_BUCKET__MEDIA`.
`rebase status` stampa, per ciascuna risorsa, la variabile esatta letta e se risulta impostata.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Il pacchetto npm che implementa il driver di una sorgente dati, quando non si utilizza quello predefinito di Postgres. Con suffisso per sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La stringa di connessione per un topic dichiarato. Con suffisso per topic. | — |

### L'ambiente proprio della CLI

Letto da `rebase`, non dal server. Nulla di quanto indicato qui influisce su un deployment.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Indirizzo a cui `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, nella shell o in `.env`. Impostarlo quando il server viene eseguito in un modo diverso da `rebase dev` in questo progetto: `rebase start`, un container, un altro host. Se non impostato, utilizzano il server registrato da `rebase dev` mentre quest'ultimo è in esecuzione, e non inviano nulla quando non lo è. | — |
| `REBASE_SERVICE_KEY` | La service key con cui tali comandi si autenticano, letta da `.env`: la stessa variabile letta dal server (vedere sopra). | — |
| `SERVICE_KEY` | Un nome precedente per quella chiave. Quando `.env` la imposta, `rebase api-keys` e `rebase storage` la leggono al posto di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quale file `.env` viene letto e scritto dalla CLI, quando non corrisponde a quello del progetto. | — |
| `REBASE_ROOT_RULES` | `0` impedisce a `rebase init` e `rebase skills install` di scrivere le regole del progetto nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, utile per repository in cui tali file vengono gestiti manualmente. | on |
| `REBASE_CLOUD_URL` | Il control plane con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | L'account con cui viene eseguito l'accesso da `rebase cloud login`, evitando richieste interattive. | — |
| `REBASE_CLOUD_PASSWORD` | La relativa password, in modo che un secret store possa fornirla senza che compaia nella cronologia della shell. | — |
| `REBASE_TOKEN` | Un token generato con `rebase cloud tokens create`. Se impostato, ogni comando `rebase cloud` si autentica con esso anziché con la sessione di `rebase cloud login`, senza mai leggere o scrivere la sessione memorizzata. In una directory collegata tramite `rebase cloud init --claim`, viene accantonato a favore del token specifico di quel progetto se non dispone di permessi sul progetto stesso. È il metodo consigliato per eseguire `rebase cloud` in CI — vedere [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI creata dai suoi strumenti cloud e non lo invia mai all'app: per tale scopo, impostare `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` stampa l'errore sottostante e i dettagli della richiesta anziché il messaggio sintetico. La prima opzione da impostare quando un comando `rebase cloud` fallisce senza fornire spiegazioni utili. | — |
| `REBASE_ATLAS_DEV_URL` | Il database vuoto rispetto al quale `rebase db push`, `db generate` e `db migrate` pianificano le modifiche, al posto del database `<db>_dev_diff` creato accanto a `DATABASE_URL`. Rebase non crea né elimina un database qui indicato, e rifiuta un valore identico a `DATABASE_URL`. Nel database di sviluppo gestito, la CLI lo imposta su un'istanza PGlite in memoria temporanea creata appositamente. Da configurare dove non si dispone del permesso `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` non avvia alcun database e non esegue alcun provisioning — il database deve essere fornito autonomamente. Equivale all'opzione `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta del dev server del frontend, che altrimenti `rebase dev` ricava dal percorso del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo di attesa prima che `rebase dev` segnali che il backend non è riuscito ad avviarsi. `0` disabilita la segnalazione. | `30000` |
| `DATABASE_PASSWORD` | La password che `rebase dev --docker` inserisce nella stringa di connessione ricavata da `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenzione standard tra strumenti. Impostato su qualsiasi valore diverso da `0`, disabilita l'invio della telemetria da parte della CLI. | — |
| `REBASE_TELEMETRY_DISABLED` | La stessa funzionalità, specifica per Rebase. Non richiede alcun file, ed è per questo la scelta consigliata in CI e all'interno di un'immagine. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint a cui inviare i dati di telemetria, per un collector self-hosted. | — |

## Segreti in sviluppo

`JWT_SECRET` è obbligatoria in produzione. Sia essa che `REBASE_SERVICE_KEY` vengono
generate automaticamente al di fuori di essa, consentendo di iniziare senza dover configurare nulla.

I valori generati vengono memorizzati nella cache in `.rebase-dev-secrets.json`, accanto a
`.rebase-dev-port` e `.rebase-dev-url` e ignorati da git insieme ad essi. In precedenza
venivano rigenerati a ogni avvio — comportando la disconnessione dalla propria applicazione a
ogni riavvio del dev server e invalidando qualsiasi chiave API appena creata.

- Impostando esplicitamente una delle due variabili viene utilizzato il valore fornito; nulla viene memorizzato in cache né letto.
- Per puntare la cache su un altro percorso, utilizzare `REBASE_DEV_SECRETS_FILE` — un percorso file, nonché l'unica variabile di questa sezione che si potrebbe voler impostare intenzionalmente.
- Eliminare il file per effettuare la rotazione di entrambi i segreti. L'avvio successivo ne scriverà uno nuovo.
- Se il file non può essere scritto — ad esempio in un container in sola lettura — il server si avvia comunque con un segreto temporaneo (effimero), esattamente come accadeva in precedenza.

Nulla viene memorizzato nella cache in produzione o durante l'esecuzione di test runner. In produzione non viene
generato alcun valore: un avvio senza `JWT_SECRET` fallisce segnalando la variabile mancante, e questo
comportamento rimane invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

La configurazione `RebaseBackendConfig` passata a `initializeRebaseBackend()` consente il controllo programmatico:

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
senza `app`, `server` e `basePath` e con un parametro `provision` obbligatorio, buildano un
backend che non serve traffico finché non viene montato: `createRebaseBackend`. Vedere
[Integrazione server personalizzata](/docs/backend/custom-server/).

### Modifica di `basePath`

`basePath` sposta ogni route API, pertanto anche il client deve essere configurato in modo corrispondente —
altrimenti continuerà a effettuare richieste a `/api/...` ricevendo errori 404 per qualsiasi endpoint:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione recepisce automaticamente questa impostazione dal client a cui è collegato;
non è necessaria alcun'altra configurazione. Se si compone un URL di richiesta manualmente,
concatenarlo partendo dal client anziché inserire `/api` direttamente nel codice:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato nell'editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite nell'editor SQL di Rebase Studio falliscono con `cause: error: permission denied for table <name>`, anche se la vista CMS a foglio di calcolo carica i dati correttamente.
* **Causa:** Per impostazione predefinita, Rebase tenta di eseguire le query dell'editor SQL cambiando temporaneamente i ruoli del database in modo che corrispondano al ruolo applicativo dell'utente attivo (ad es. `SET LOCAL ROLE "admin"`). Se si utilizza un'autenticazione personalizzata in cui i ruoli risiedono solo nelle tabelle del database anziché essere veri ruoli PostgreSQL, il cambio di ruolo fallisce o mancano i privilegi del database. La vista CMS a foglio di calcolo viene eseguita con l'utente proprietario della connessione predefinito e bypassa questo passaggio.
* **Soluzione:** Aggiungere `DISABLE_DB_ROLE_SWITCHING=true` alla configurazione `.env` del backend. Questo forza Rebase a eseguire le query dell'editor SQL utilizzando i privilegi del proprietario della connessione (solitamente un superuser/owner). L'editor SQL indicherà quindi sopra i risultati che sono stati letti come proprietario della connessione, e disabiliterà il selettore dei ruoli.

### Recupero dello schema dell'editor SQL non riuscito (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non riesce a caricare l'albero dello schema, oppure l'editor SQL restituisce l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase richiede privilegi amministrativi per interrogare i cataloghi di sistema del database ed eseguire comandi amministrativi. Se `adminConnectionString` non viene fornita al bootstrapper, o se `getAdmin()` viene sovrascritto per restituire `undefined`, queste operazioni falliscono.
* **Soluzione:** Verificare che `adminConnectionString` sia configurata durante l'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Prossimi passi

- **[Distribuzione](/docs/getting-started/deployment)** — Guida alla distribuzione in produzione
- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
