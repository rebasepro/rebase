---
sourceHash: 21a2078200ddc8c0
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase valida le variabili d'ambiente con **Zod** all'avvio. Se
> qualsiasi parametro obbligatorio risulta mancante o malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende dalla modalità di esecuzione del backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde
> all'unione di ogni tabella riportata di seguito. Un progetto in cui è stato eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che richiama `loadEnv({ extend })`, e può aggiungere lì
> le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione a PostgreSQL. **Opzionale in sviluppo** — se non impostata, `rebase dev` esegue un PostgreSQL gestito per il progetto, con i dati in `.rebase/`. Obbligatoria in qualsiasi altro contesto. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizza una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in sviluppo). | `a1b2c3d4e5...` |

> **Su un database gestito, `sslmode=require` potrebbe non significare ciò che dice.**
>
> Per `psql` e qualsiasi strumento basato su libpq, `require` significa "crittografato, certificato non
> verificato". Il driver Node su cui si basa Rebase lo interpreta come `verify-full`, pertanto un
> database il cui certificato non è stato firmato da un'autorità pubblica — caso frequente sui Postgres
> gestiti — rifiuta il runtime con `self-signed certificate`, mentre `psql` si
> connette utilizzando il medesimo URL. Il runtime e i comandi `rebase db` si interrompono con un
> messaggio esplicativo a riguardo.
>
> Scegli un'opzione:
>
> - **`sslmode=no-verify`** — crittografato, non verificato: ciò che `require` significa per
>   libpq. È una sintassi propria di node-postgres non presente in libpq, pertanto `psql`, `pg_dump`
>   e Atlas la rifiutano con `invalid sslmode value: "no-verify"`. I comandi interni di Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la trasmettono loro come
>   `sslmode=require`, funzionando regolarmente con l'URL configurato; per
>   l'uso manuale di `psql`, sostituiscila con `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificato rispetto al
>   certificato CA del provider. Identico per qualsiasi strumento.
>
> `uselibpqcompat=true&sslmode=require`, suggerito dal warning del driver Node,
> funziona anche per il runtime; i comandi di Rebase rimuovono `uselibpqcompat`
> prima di passare l'URL agli strumenti libpq, che altrimenti lo rifiuterebbero.

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API backend per l'SDK tipizzato. **Impostare solo in sviluppo** — vedi sotto. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Abilita "Accedi con Google". | — |

> **Lascia `VITE_API_URL` non impostata nelle build di produzione.**
>
> In sviluppo, il frontend e il backend appartengono a origini distinte, pertanto il dev
> server inietta questa variabile. In produzione, il backend di Rebase serve la SPA, quindi
> l'API coincide con l'origine stessa della pagina e il client la risolve autonomamente in questo modo.
>
> Integrare un URL assoluto in un bundle di produzione funziona solo finché un secondo
> hostname non punta alla stessa applicazione: un dominio personalizzato caricherebbe la pagina da
> `example.com` e richiederebbe le API su `example.rebase.website`, operazione
> cross-origin per la quale ogni richiesta fallirebbe il preflight. Consentire l'origine in CORS
> **non** risolverebbe il problema: il cookie di refresh è `SameSite=Lax` e non viene
> inviato cross-site, con la conseguenza di azzerare gli errori in console lasciando comunque l'autenticazione
> non funzionante. Se lasciata vuota, qualsiasi dominio che punti all'applicazione funziona
> senza richiedere alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **solo dall'ambiente della shell** — un `PORT` impostato in `.env` non viene letto, poiché la porta viene risolta prima del caricamento di tale file — e in alternativa esegue il bind su una porta derivata dal percorso del progetto, permettendo l'esecuzione simultanea di più progetti. `rebase dev --port` ha la precedenza su entrambi, e il banner di avvio specifica il livello utilizzato. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra l'SQL associato a una riga `Failed query: [redacted]`. Ogni istruzione fallita viene oscurata per impostazione predefinita, poiché una query non riuscita contiene i propri parametri vincolati — un'email, un hash di password. Impostala su `true` durante l'analisi di errori di DDL, RLS o di acquisizione delle modifiche (change-capture). Ignorata se `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco separato da virgole delle origini consentite. **Obbligatoria in produzione** a meno che `FRONTEND_URL` non sia impostata: un avvio in produzione privo di entrambe rifiuta l'esecuzione. In sviluppo viene *aggiunta a* localhost — vedi sotto. | — |
| `FRONTEND_URL` | URL dell'app frontend. Usata come alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database con privilegi amministrativi (utilizzata per l'introspezione dello schema e le operazioni di amministrazione). Il database indicato non è quello considerato corrente dalla console SQL, né quello da cui un nuovo branch effettua la copia per impostazione predefinita: entrambi coincidono con il database a cui è collegata l'applicazione stessa (vedi `REBASE_BRANCH_PARENT_DATABASE` per un server in esecuzione su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del database non sono mappati). La console SQL di Studio specificherà quindi che le righe sono state lette come proprietario della connessione, indicandone il nome e disabilitando il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui questo server è in esecuzione. `rebase dev` la imposta su un checkout [spostato su un branch](/docs/backend/branching/#cli-integration). Un server che la possiede mantiene il registro dei branch su tale database e copia i nuovi branch da esso per impostazione predefinita, consentendo al pannello Branches di Studio di mostrare i branch del database principale. | — |

#### CORS in sviluppo

Lo sviluppo consente **localhost, oltre a qualunque valore indicato in `CORS_ORIGINS` (o `FRONTEND_URL`)**
— lo stesso elenco utilizzato dalla produzione, con localhost aggiunto anziché
sostituito. Di conseguenza, la variabile funziona allo stesso modo in entrambi gli ambienti, e i
casi in cui è necessaria in sviluppo sono quelli consueti:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non corrisponde a localhost né figura nell'elenco viene rifiutata, e il rifiuto viene
registrato nei log **una sola volta per origine** con la riga esatta necessaria ad autorizzarla. Il rifiuto
non è una precauzione fine a se stessa: l'API trasmette credenziali, pertanto riflettere un
`Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare
richieste autenticate verso il dev server sfruttando la sua sessione e leggendone le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Segreto per la firma dei JWT (obbligatorio in produzione, generato automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per firmare i token di accesso in modo asimmetrico (RS256), consentendo a qualsiasi entità in possesso del JWKS di verificare una sessione senza poterla generare. Accetta un PEM con newline reali, un PEM con escape `\n`, o la codifica base64 dell'intero PEM. In sua assenza, i token restano HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificalo ogni volta che la chiave cambia — la rotazione richiede che la vecchia e la nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata di validità del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata di validità del token di refresh. Scorrevole (sliding) — ogni rotazione la rinnova, determinando quindi quanto a lungo una sessione sopravvive all'**inattività**. Imposta `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser pongono qui il limite massimo per il cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente a nuovi utenti di registrarsi (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi, indipendentemente da questa impostazione — una tabella utenti vuota deve ammettere qualcuno, e quel qualcuno diventa l'amministratore. In produzione (`NODE_ENV=production`) tale finestra è chiusa: una tabella vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un primo account creato tramite registrazione aperta diventa un account ordinario, e l'amministratore viene definito tramite `REBASE_ADMIN_EMAIL` di seguito o assegnato con la service key. Il file `.env.example` dello scaffold la imposta su `true`; il default del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Kill switch. Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia deliberatamente aperta al di fuori della produzione, bloccando la registrazione anche su un database vuoto. Abbinalo a `REBASE_ADMIN_EMAIL` di seguito, altrimenti il deployment non avrà modo di produrre il suo primo chiamante autenticato. Ogni artefatto di deployment distribuito la imposta. | — |
| `REBASE_ADMIN_EMAIL` | Email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai in seguito. Questo è il meccanismo con cui un deployment di produzione ottiene il proprio amministratore: l'operatore definisce il primo account anziché rischiare una race condition con internet. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Minimo 12 caratteri, pena il rifiuto e la mancata creazione dell'account. Modificala dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP archiviato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e l'avvio genera un avviso — una rotazione di `JWT_SECRET` disconnetterebbe tutti *e* renderebbe indecifrabili tutti gli autenticatori registrati. Imposta una chiave dedicata (32+ caratteri casuali) prima che gli utenti si registrino. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la rotazione. Impostale entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che gli utenti restino bloccati fuori dal proprio account durante la transizione. Rimuovila una volta ricifrati tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opzionale (opt-in) e deliberatamente non vincolata da `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dei dati. Imposta a `false` per una superficie di lettura completamente pubblica — la RLS rimane comunque attiva. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un nuovo utente registrato quando non ne viene indicato nessuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Attiva `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per flussi di invito via email. Riservato ai soli chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente individuato. Disattivato per impostazione predefinita: costituisce una superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attributo `SameSite` sul cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è riservato a frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attributo `Secure` sul cookie di refresh. Attivo per impostazione predefinita; `AUTH_COOKIE_SECURE=false` per http semplice — un deployment su un indirizzo LAN in cui il browser altrimenti scarterebbe il cookie e la sessione terminerebbe alla scadenza del token di accesso senza alcun errore. Genera un avviso all'avvio. `http://localhost` non ne necessita. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID Google OAuth (validazione backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client secret GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client secret X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client secret Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID GitLab OAuth. Il `baseUrl` di un'istanza self-hosted non ha una variabile d'ambiente dedicata — configura GitLab nel blocco `auth` per gestirlo. | — |
| `GITLAB_CLIENT_SECRET` | Client secret GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID Apple, per l'accesso web. È pubblico e viene esposto in `GET /auth/config`. Apple non utilizza un client secret statico, poiché Rebase firma un JWT ES256 a breve scadenza per ogni scambio di token. Di conseguenza, Apple richiede `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, oltre a questa variabile o a `APPLE_BUNDLE_IDS`, e non effettua alcuna configurazione in loro assenza. | — |
| `APPLE_BUNDLE_IDS` | Elenco separato da virgole dei bundle ID delle app native iOS/macOS di cui vengono accettati i codici "Accedi con Apple". | — |
| `APPLE_TEAM_ID` | Team ID sviluppatore Apple, emittente del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata presso Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi gli a capo (sono accettati i caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API amministrativa statica. Bypassa la consueta autenticazione JWT per chiamate server-to-server se passata come `Authorization: Bearer <key>`. (Generata automaticamente in sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chiave pubblica della piattaforma di hosting (PEM, EC P-256) utilizzata per verificare i token di piattaforma `rpt_`; può contenere più blocchi PEM durante una rotazione delle chiavi. La piattaforma la imposta al deploy e non racchiude elementi segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE` permette al gate admin di accettare un token di piattaforma unicamente per `cron:read`. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID di progetto a cui deve corrispondere il claim `aud` di un token di piattaforma, così che un token generato per un altro progetto venga rifiutato. Con una sola delle due variabili impostata, il server si avvia, registra un avviso e risponde a qualsiasi token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destinazione del comando **Continue with Rebase Cloud** del pannello di amministrazione: la pagina del progetto nella console della piattaforma, che autentica i proprietari del progetto ed esegue il redirect di ritorno. La piattaforma la imposta al deploy insieme alle due precedenti; grazie ad esse, `POST /api/auth/platform-signin` accetta il token di validità di un minuto `auth:admin-signin` della piattaforma e apre una sessione admin. In sua assenza, l'accesso rimane disponibile tramite **Open CMS** dalla console, e la schermata di login ne illustra il funzionamento. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione in cui risiedono i contatori del rate-limit, per le rotte di autenticazione e per `rateLimit` nelle funzioni personalizzate: `memory` (per singolo processo) o `sql` (condiviso tra repliche). Poiché un processo non può determinare il proprio numero di repliche, un deployment con peer deve indicarlo esplicitamente — tre repliche con l'impostazione predefinita applicano un limite tre volte superiore. Qualsiasi altro valore **impedisce l'avvio** senza applicare fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Attiva il flusso di accesso tramite link senza password. Richiede la configurazione di un servizio email per l'invio del link. | `false` |
| `AUTH_EMAIL_OTP` | Attiva l'accesso senza password tramite codice a sei cifre inviato via email. Stessi requisiti del servizio email indicati sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic-link o di codice email per un indirizzo sconosciuto crea l'account, purché la registrazione sia aperta. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento applicato a un token di refresh riutilizzato oltre la finestra consentita: `reject` (rifiuta la richiesta, preserva la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore impedisce l'avvio. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con verifica preliminare: nessun accesso con password consentito prima della verifica dell'indirizzo. Richiede la configurazione dell'email; in sua assenza l'avvio fallisce. | `false` |
| `CAPTCHA_PROVIDER` | Attiva la verifica captcha sulle rotte di autenticazione: `turnstile` o `hcaptcha`. Non impostata indica assenza di captcha. | — |
| `CAPTCHA_SECRET` | Il segreto del provider, impiegato lato server per verificare il token inviato dal browser. Obbligatorio quando `CAPTCHA_PROVIDER` è impostata. | — |
| `CAPTCHA_ROUTES` | Elenco separato da virgole delle rotte di autenticazione da proteggere (ad esempio `register,login`). Se non impostata, protegge il set predefinito del provider. | — |

### Storage

:::caution[Lo storage non dispone di sicurezza a livello di riga, pertanto necessita di un modello di accesso]
Le tabelle sono protette dalla RLS di Postgres. L'object storage non dispone di un equivalente —
le chiavi condividono un unico namespace piatto — di conseguenza, in presenza di un bucket configurato senza un modello di accesso,
il server **rifiuta l'avvio in produzione**. Soddisfa questo vincolo adottando esattamente una tra le seguenti opzioni:
un hook `storageAuthorize` esportato da `backend/storage.ts` (fornito dal template di base),
`STORAGE_PUBLIC_READ`, o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di storage: `local`, `s3` o `gcs`. In produzione, `local` disabilita lo storage a meno che non sia specificato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso base per lo storage locale. Un percorso relativo viene interpretato rispetto alla directory di esecuzione del server: la radice del progetto con `rebase dev`, la cartella `backend/` in un server generato da `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente lo storage locale in produzione — esclusivamente in presenza di un volume persistente contenente `STORAGE_PATH` e le directory `<STORAGE_PATH>__<key>` dei bucket locali associati | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — corrispondente al token integrato da `getSignedUrl()`. Valore massimo: `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima consentita per i file dalla sorgente, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente specifica con nome. Un valore non intero impedisce l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza l'uso di URL path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Progetto GCP. Normalmente dedotto dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file chiave del service account. Omettere su GCP, dove le credenziali sono fornite da Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Rende ogni oggetto accessibile a chiunque, senza necessità di token. Da usare esclusivamente per bucket adibiti a CDN pubblica. Una delle tre modalità per soddisfare il controllo di sicurezza all'avvio. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualsiasi utente autenticato di leggere, scrivere, elencare ed eliminare ogni oggetto. Denominata `INSECURE` nell'oggetto di configurazione per un motivo preciso: è ammissibile unicamente in applicazioni a tenant singolo in cui ogni account è autorizzato ad accedere all'intero archivio. | `false` |
| `STORAGE_RENDITION_CACHE` | Mantiene in cache le rese generate delle immagini (ridimensionamenti, conversioni di formato) invece di elaborarle per ciascuna richiesta. | `false` |

### Email (Opzionale)
`MAGIC_LINK_URL`.

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita la connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato associato all'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato negli oggetti e nel corpo delle email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo posizionato in cima ai template email predefiniti. Indirizzo PNG o JPG `http(s)` assoluto — i client rimuovono gli SVG e bloccano i data URI (`data:`). Se non impostata, un'applicazione con nome invariato `Rebase` mostra il marchio Rebase; un'applicazione rinominata non mostra alcun logo |
| `MAGIC_LINK_URL` | Destinazione del magic link inviato via email. A un percorso base viene aggiunto `/auth/magic-link?token=…`; un URL contenente `{token}` rappresenta il link completo, pensato per un frontend che non espone la rotta `/auth/magic-link`. Racchiudilo tra virgolette nel file `.env`, dove un `#` non quotato dà inizio a un commento: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Un valore contenente un cancelletto o un percorso file privo di `{token}` genera un avviso all'avvio. Se non impostata, il percorso base corrisponde a `FRONTEND_URL` |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi di persistenza di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa per ottenere una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non sottoposta a pooler). Indispensabile per [Realtime](/docs/backend/realtime): le istruzioni `LISTEN`/`NOTIFY` non funzionano attraverso un pooler di transazioni quale PgBouncer; senza di essa, le notifiche di modifica vengono disabilitate con un avviso invece di andare perse senza segnalazione. Anche il [job worker](/docs/backend/jobs) mantiene su di essa la propria operazione di ascolto `LISTEN` per il risveglio. Valorizza il parametro `directConnectionString` dell'adapter Postgres quando non configurato. | — |
| `DATABASE_READ_URL` | Replica di lettura, ad esempio un nodo hot standby. Quando punta a un altro server, le operazioni di lettura autenticate (elenchi, singole righe, conteggi, aggregazioni) vengono gestite su di esso applicando la medesima sicurezza a livello di riga; le scritture, l'autenticazione, realtime, i cron, i job, la console SQL e `rebase.sql` permangono sul nodo primario. Un client che ha appena effettuato una scrittura leggerà dal nodo primario per la durata definita da `REBASE_READ_STICKY_MS`, e tutti i client faranno lo stesso qualora la replica presenti un ritardo superiore a `REBASE_READ_MAX_LAG_MS` o risulti irraggiungibile. Valorizza `readConnectionString` dell'adapter Postgres quando non configurato; fino alla versione 0.28 compresa, il pool della replica veniva aperto senza essere mai impiegato per la lettura. | — |
| `REBASE_READ_STICKY_MS` | Intervallo successivo a una scrittura durante il quale le letture del medesimo utente continuano a essere indirizzate al primario, garantendo che una modifica appena salvata compaia nel successivo elenco. Calcolato per singola istanza del server. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Soglia di ritardo della replica oltre la quale tutte le letture vengono reindirizzate al nodo primario. | `1000` |
| `DATABASE_POOLED` | Impostare su `true` quando `DATABASE_URL` transita tramite un pooler in modalità transazione (es. PgBouncer). Il pool evita di inviare direttive di `search_path` o `statement_timeout` alla connessione (il pooler le rifiuterebbe o scarterebbe), impostando entrambi i parametri all'interno di ciascuna transazione; la procedura di avvio assegna al ruolo del database un `search_path` predefinito impostato su `public` per le istruzioni esterne alla transazione. In questo scenario `DATABASE_DIRECT_URL` diventa obbligatoria, e viene impiegata da realtime, dalla procedura di riattivazione del job worker, dalla compilazione degli indici, dalle operazioni di branching e dalla console SQL. Anche l'URL della replica viene interpretato come gestito da pooler. Utilizzare `DATABASE_POOLED__<KEY>` per specificare un'ulteriore sorgente dati. | — |
| `REBASE_DB_POOL_MAX` | Tetto massimo applicato a ogni pool del processo, a prescindere dal limite configurato per ciascuno di essi. Accetta esclusivamente cifre: un valore errato viene ignorato per evitare che il server serializzi silenziosamente le operazioni. | — |

### Comportamento a runtime

Variabili interpretate dal runtime — `rebase dev`, `rebase start` e l'immagine
ufficiale del server. Un progetto sottoposto a eject gestisce tali logiche direttamente
nel proprio codice.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Se impostata su `true`, esegue l'[audit programmato della sicurezza a livello di riga](/docs/rls-check#running-it-on-a-schedule), rilevando le tabelle esposte senza policy associate. Il progetto deve includere `@rebasepro/rls-check` tra le proprie dipendenze: il runtime non ne contiene una copia, e l'assenza del pacchetto causerà l'interruzione dell'avvio con segnalazione dell'errore. Impostare su `false` per disattivare la verifica su questo processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | Il ruolo Postgres utilizzato per eseguire le richieste autenticate e anonime. Assegna un ruolo specifico a ogni progetto ospitato su un cluster condiviso. Il database tiene traccia del ruolo con cui viene eseguito: un avvio configurato con un ruolo differente viene bloccato fino all'esecuzione di `rebase db request-role migrate`. Consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | Con `auto` crea il ruolo della richiesta e abilita la connessione a passare ad esso; con `never` delega la gestione di entrambi all'amministratore, limitandosi a verificarne la presenza. | `auto` |
| `REBASE_RLS_GRANTS` | Privilegi concessi da Rebase al ruolo della richiesta: `schema` (tutte le tabelle negli schemi gestiti, oltre ai privilegi predefiniti), `managed` (esclusivamente le tabelle gestite) oppure `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | Con `requestRole`, circoscrive le policy permissive di Rebase ai soli ruoli della richiesta, impedendo ad altri ruoli che consultano le stesse tabelle di ereditarne i permessi. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | Con `public`, assegna le policy riservate al contesto server o all'amministratore con clausola `TO public`, eseguendo le operazioni admin con il ruolo della richiesta. L'impostazione predefinita è `TO rebase_admin`, permettendo alle letture con scope proprietario degli utenti autenticati di sfruttare l'indice del proprietario. Consulta [Richieste admin e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | Impostata su `false`, rimuove da ogni tabella la policy di base riservata al contesto server o admin. | `true` |
| `REBASE_RLS_IDENTITY` | Con `supabase`, valorizza contestualmente `request.jwt.claims` e `request.jwt.claim.*`, permettendo alle policy scritte con `auth.uid()` di identificare il chiamante. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento all'avvio nel caso in cui un altro account possa assumere il ruolo della richiesta: `warn`, `refuse` o `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Percorso base applicato a tutte le rotte API. Deve essere allineato con la configurazione del client — consulta [Modificare `basePath`](#modificare-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Abilita la distribuzione dei file statici/admin del bundle da questo processo. Disattivare se è presente una CDN a monte. | `true` |
| `REBASE_STUDIO` | Distribuisce la console autonoma integrata Rebase Studio all'indirizzo `/_studio` qualora sia presente il relativo bundle statico. Impostare su `false` per disabilitarla. | `true` |
| `REBASE_STUDIO_DIR` | Directory contenente la SPA Rebase Studio autonoma precompilata servita su `/_studio`. Il valore predefinito è `/studio` all'interno dell'immagine container. | `/studio` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Abilita la compressione gzip/brotli per le risposte. | `true` |
| `REBASE_PUSH` | Se `true`, attiva le [notifiche push](/docs/backend/push-notifications/): le rotte `/api/push`, la tabella `rebase.push_subscriptions` e il modulo `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Coppia di chiavi VAPID impiegate per firmare i messaggi push. Negli ambienti diversi dalla produzione, se non fornite, viene generata una coppia salvata in `.rebase-dev-secrets.json`; in produzione il servizio push rimane disattivato in loro assenza. | — |
| `REBASE_VAPID_SUBJECT` | Recapito `mailto:` o indirizzo `https://` utilizzabile dai servizi di push notification. Il valore predefinito corrisponde all'origine di un URL `REBASE_PUBLIC_URL` con protocollo `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima ammessa per il corpo della richiesta, espressa **in byte** (es. `10485760`, non `10MB` — un valore non numerico impedisce l'avvio anziché azzerare il vincolo). Il valore `0` rimuove la limitazione. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Gestione della documentazione OpenAPI. Comportamento a tre stati. Non impostata: in tutti gli ambienti `/api/docs` viene erogata ai chiamanti autorizzati a consultare le tabelle tramite `GET /api/schema/tables`, limitatamente a quelle visibili, escludendo l'interfaccia Swagger UI. Con `true`, rende pubblico l'intero documento a chiunque, abilitando l'interfaccia Swagger **UI** su `/api/swagger` esclusivamente al di fuori della produzione. Con `false`, subordina la consultazione del documento all'accesso admin. | — |
| `REBASE_METRICS` | Espone le metriche in formato Prometheus sull'endpoint `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge la direttiva `includeSubDomains` all'header `Strict-Transport-Security`, imponendo ai browser di rifiutare il traffico HTTP non cifrato su qualsiasi sottodominio dell'host per sei mesi — inclusi gli host non serviti da questo processo. Attivare unicamente se ogni sottodominio opera esclusivamente sotto HTTPS. Valori diversi da `true`/`false` causano l'interruzione dell'avvio. Consulta [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a presidio di `/metrics`. Se non impostata, l'endpoint rimane liberamente accessibile da chiunque possa raggiungere la porta — accettabile su rete privata, sconsigliato su rete pubblica, condizione notificata nei log di avvio. | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni consentite al runtime sullo schema delle tabelle durante la fase di avvio. Con `ensure` (impostazione predefinita per ogni ambiente, produzione compresa) viene eseguito il passaggio **additivo**: vengono creati tabelle, colonne e tipi enum assenti, escludendo l'eliminazione o la riscrittura di elementi esistenti. Con `none` lo schema delle tabelle definite dall'applicazione non viene modificato, ma le tabelle interne del framework (autenticazione, API key, job, cron) vengono generate e aggiornate; `REBASE_PROVISION=false` disattiva anche queste ultime. L'immagine distribuita accetta unicamente queste due opzioni e **rifiuta l'avvio se impostata su `push`**. In una [distribuzione suddivisa](/docs/deployment/split-processes) un singolo processo è autorizzato al provisioning, imponendo a ogni altro ruolo di impostare `none` per evitare il blocco dell'esecuzione. | `ensure` |
| `REBASE_PROVISION` | Impostata su `false`, impedisce al runtime di apportare modifiche al database: nessuna operazione su tabelle, colonne, indici, funzioni, trigger, policy, ruoli o grant, né all'avvio né successivamente, inclusi gli oggetti interni del framework. Il sistema elenca le componenti mancanti tramite log. Modalità adatta a database modificabili unicamente mediante pipeline di migrazione dedicate. Consulta [Quando solo il tuo processo di modifica può alterare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Accetta unicamente `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Blocca l'avvio se l'ultimo provisioning del database è stato eseguito su un insieme di tabelle disallineato rispetto alla build di questo processo. Se non impostata (o con valori diversi da `true`/`1`), emette unicamente un avviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Impedisce l'avvio qualora un file contenente funzioni o cron generi errori o non superi il parsing in fase di import, segnalando il file interessato e la causa, così da consentire a un rilascio continuo (rolling deploy) di mantenere attiva la versione precedente. La regola viene applicata anche in fase di riavvio. Se non impostata (o con valori diversi da `true`), esclude il file critico continuando a servire i restanti. Un file importato correttamente che non esporta funzioni o job viene ignorato senza provocare blocchi. | skip |
| `REALTIME_CDC` | Rilevamento delle modifiche a livello di database: `auto` (estrae le modifiche dal WAL ove consentito dal database, altrimenti usa i trigger, ricorrendo in ultima istanza al livello applicativo con notifica informativa nei log), `trigger` (forza l'impiego dei trigger, segnalando se non applicabili), `wal` (legge le modifiche direttamente dal write-ahead log senza creare trigger; presuppone `wal_level=logical` e un ruolo abilitato alla replica, altrimenti degrada a `trigger`), `off`. Consulta [Realtime](/docs/backend/realtime-cdc/). Ha precedenza rispetto a `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Livello di trasporto tra istanze per i canali broadcast e la presenza: `memory` o `postgres`. Ignorato nel caso in cui a `realtime.bus` sia già stata fornita un'istanza di trasporto configurata. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni gestibili da un singolo socket realtime; le richieste eccedenti vengono respinte con errore `TOO_MANY_SUBSCRIPTIONS`. Richiede un numero intero positivo — qualsiasi altro valore impedisce l'avvio del server. Ha precedenza rispetto a `realtime.maxSubscriptionsPerSocket`. Consulta [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di connessioni socket realtime che un utente, o una specifica chiave API, può mantenere aperte su una singola istanza del server. I socket aperti in modalità impersonificazione da un amministratore vengono conteggiati a carico dell'amministratore stesso. Il tentativo di connessione successivo viene respinto con `TOO_MANY_SOCKETS` e il socket viene chiuso (codice 4002); l'SDK esegue nuovi tentativi progressivi fino alla chiusura di una sessione esistente. Richiede un numero intero positivo — qualsiasi altro valore blocca l'avvio del server. Ha precedenza rispetto a `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo, espresso in millisecondi, con cui una modifica attende il ciclo di rilettura (refetch) prima dell'invio ai client sottoscritti. Il refetch attende 300 ms in assenza di nuove modifiche, fino a un massimo pari a questo valore in presenza di un flusso costante di scritture. Richiede un numero intero positivo — qualsiasi altro valore impedisce l'avvio del server. Ha precedenza rispetto a `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo in millisecondi entro cui il conteggio complessivo di una sottoscrizione su elenchi di grandi dimensioni può essere riutilizzato prima di eseguire un nuovo calcolo; i frame che riutilizzano il dato integrano il campo `meta.totalAsOf`. Se non impostata, il conteggio viene ricalcolato a ogni frame. Ha precedenza rispetto a `realtime.recountIntervalMs`. | Non impostato |
| `REALTIME_RECOUNT_MIN_ROWS` | Valore minimo dell'ultimo conteggio totale a partire dal quale viene applicato `REALTIME_RECOUNT_INTERVAL_MS`; gli elenchi con volumi inferiori vengono ricalcolati a ogni frame. Ha precedenza rispetto a `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorizza l'impiego di indirizzi `localhost` o di loopback anche in presenza di `NODE_ENV=production`. Disattivata per impostazione predefinita, così che l'avvio in produzione fallisca tempestivamente invece di tentare la connessione a un database inesistente. | `false` |
| `REBASE_PROVISION_ONLY` | Con `1` o `true` esegue l'aggiornamento dello schema e termina l'esecuzione senza aprire socket HTTP — la modalità indicata per un Job di migrazione basato sulla medesima immagine e sul medesimo bundle del server applicativo. Provvede inoltre a creare le tabelle che il processo server genererebbe al primo utilizzo, escludendo l'avvio di cron o code di elaborazione. Un valore vuoto viene considerato *non impostato*, evitando che una mancata risoluzione di `${SOMETHING}` in un file compose trasformi inavvertitamente il deployment in un'attività di sola migrazione. L'uso è incompatibile con `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Percorso di destinazione per un file. Se abilitata (`REBASE_PROVISION_ONLY=true`), esporta l'elenco cronologico delle modifiche allo schema apportate, sotto forma di script SQL pronto per la revisione e l'applicazione manuale tramite `psql`. I record inseriti non sono inclusi. L'opzione non è consentita su processi che erogano traffico. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | Se impostata su `true`, consente a processi automatici — script, pipeline di CI — di *applicare* aggiornamenti dello schema tramite l'endpoint `/api/admin/schema`, oltre alla sola fase di pianificazione. Disattivata per sicurezza: le credenziali con privilegi per tale operazione sono quelle più comunemente esposte nelle variabili d'ambiente di integrazione continua. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo massimo concesso a una funzione personalizzata prima dell'interruzione della richiesta associata. Corrisponde all'opzione di configurazione `functionsTimeoutMs`. Impostare a `0` per azzerare il limite. Una funzione che definisce autonomamente la scadenza (`defineFunction(…, { timeoutMs })`) manterrà il proprio valore. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Timeout massimo, espresso in millisecondi, impostabile da una funzione tramite `defineFunction(…, { timeoutMs })`; richieste superiori vengono ridotte a questo valore. Accetta numeri positivi; ogni altro valore viene considerato non configurato. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | Con `true`, la mancata gestione di una rejection di una Promise causa la terminazione forzata del processo anziché la sola registrazione nei log. Consigliata sotto orchestratori in grado di eseguire il riavvio automatico; sconsigliata in contesti dove il riavvio genera disservizi più gravi di un leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Sopprime l'avviso di avvio su piattaforme con architettura scale-to-zero, nelle quali un timer scattato su un'istanza priva di traffico non verrebbe di fatto recapitato. Non altera altri comportamenti: impostala se garantisci la costante disponibilità di almeno un'istanza attiva. | — |
| `TRUSTED_PROXY_HOPS` | Numero di proxy intermedi anteposti a questo server, parametro necessario al rate limiter per estrarre l'indirizzo IP reale del client dall'header `X-Forwarded-For`. Il valore predefinito prudenziale è `0`: senza proxy a monte, considerare affidabile questo header permetterebbe a qualsiasi client di contraffare la propria identità. | `0` |

:::note[Il provisioning all'avvio è additivo e non sostituisce uno strumento di migrazione]
Il provisioning eseguito all'avvio opera in modalità non presidiata senza richiedere l'approvazione umana di un diff; di conseguenza, non effettuerà mai l'eliminazione di colonne, la restrizione di tipi di dato o la riscrittura di intere tabelle. Per la stessa ragione l'immagine rifiuta la configurazione `REBASE_MIGRATE_ON_BOOT=push`: un push completo analizza il diff ed è abilitato a eseguire `DROP COLUMN`, mentre il semplice riavvio di un container non deve poter alterare irreparabilmente lo schema di produzione per effetto di una rischedulazione.

Le modifiche distruttive o di ristrutturazione devono essere gestite in contesti con possibilità di revisione: tramite `rebase db generate` unito a `rebase db migrate`, oppure mediante `rebase db push` da locale o pipeline di CI, comandi che eseguono una simulazione (dry-run), richiedono una conferma esplicita prima di modifiche distruttive e supportano la creazione di un backup preventivo.
:::

### Distribuzioni separate

Una medesima immagine e un unico bundle possono essere istanziati più volte,
assegnando a ciascuna istanza il presidio di un'area specifica del progetto. Di seguito
vengono riepilogate le variabili pertinenti; per l'elenco dei servizi *avviati e gestiti* da ogni combinazione —
nonché per le configurazioni non ammesse — consulta la sezione
**[Processi suddivisi](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_ROLE` | Tipologia di servizio gestito dal processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Definisce esplicitamente se *questo* processo deve avviare i timer cron. Se omessa, il comportamento deriva dal ruolo configurato. | — |
| `REBASE_JOB_WORKERS` | Definisce esplicitamente se questo processo deve eseguire i worker della coda job. Se omessa, il comportamento deriva dal ruolo configurato. | — |
| `REBASE_FUNCTIONS_ONLY` | Limita l'esecuzione alle sole funzioni personalizzate indicate. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Esegue tutte le funzioni personalizzate a eccezione di quelle indicate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Indirizzo a cui il processo API instrada le richieste di funzioni non eseguite localmente. Su un `worker`, corrisponde alla destinazione delle chiamate interne a `rebase.functions`. Accetta URL `http(s)`. | — |

### Superficie MCP

Endpoint opzionale basato sullo standard Model Context Protocol accessibile su `/mcp`, concepito per consentire ai client AI
di interagire in lettura e scrittura con il progetto **sotto l'identità dell'utente autenticato**.
Disattivato per impostazione predefinita, e — diversamente dalle altre componenti — non attivabile
mediante `REBASE_ROLE`: le altre opzioni descrivono il dimensionamento architetturale del processo, mentre
questa operazione comporta l'esposizione di credenziali verso strumenti software terzi, scelta
che deve scaturire da un intervento esplicito dell'amministratore e non dal semplice ruolo assegnato al container.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Attiva l'endpoint MCP. Richiede la contestuale configurazione di `REBASE_PUBLIC_URL`; in caso contrario, il modulo non viene inizializzato e l'evento viene notificato nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | L'origine pubblica attraverso cui il deployment è accessibile dall'esterno, ad esempio `https://app.example.com`. Il modulo MCP non è in grado di dedurla: estrarre l'origine dall'header `Host` consentirebbe al chiamante di condizionare l'identità dell'emittente e il valore di audience con cui i token vengono validati. | — |
| `REBASE_MCP_VIEW` | Percorso della vista personalizzata dell'applicazione MCP (`rebase-view.html`, generata da `rebaseMcpViewPlugin()`), servita a Claude in luogo dell'interfaccia predefinita, permettendo il rendering dei layout, campi e azioni definiti ad hoc. Se assente, il backend ricerca il file accanto alla build del frontend. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Consente la registrazione dinamica dei client OAuth (RFC 7591), offrendo ai client la possibilità di registrarsi autonomamente. Impostare su `false` per imporre la registrazione preventiva di ogni client. | `true` |

### Modifica dello schema live da un bundle

Disattivata a meno che `REBASE_LIVE_SCHEMA_REPOSITORY` non risulti valorizzata. Un bundle compilato
non ospita i sorgenti in `backend/schema` modificabili direttamente; con queste variabili attive,
l'editor di schema estrae i file dal repository, esegue il commit di ciascun aggiornamento
e applica il conseguente DDL su questo database. Funzionalità a uso esclusivo degli amministratori e applicabile
solo manualmente, salvo diversa indicazione in `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`.
L'indicazione di un repository privo di credenziali adeguate blocca l'avvio. Consulta
[Modifica dello schema live](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repository GitHub di destinazione per i commit relativi alle modifiche dello schema, specificato come `owner/name`. La valorizzazione di questo parametro attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Branch di destinazione su cui effettuare i commit. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Posizione di `backend/schema` all'interno del repository, espressa con percorso relativo alla radice dello stesso. Un percorso esterno ai confini del repository impedisce l'avvio, al pari del parametro deprecato `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token con permessi granulari dotato di accessi di lettura e scrittura sui contenuti del repository. Utilizzare questa variabile in alternativa alla terna `_GITHUB_APP_*`, escludendone l'impiego congiunto. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identificativo dell'applicazione GitHub App, per autenticare i commit a nome dell'applicazione stessa anziché mediante personal token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Identificativo di installazione dell'applicazione sul repository indicato. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chiave privata dell'applicazione: supporta formato PEM nativo, PEM con caratteri di fine riga sottoposti a escape, o codifica in base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Espressione cron per la schedulazione dei backup. Se non specificata, i backup automatici rimangono disattivati. | — |
| `BACKUP_DESTINATION` | Percorso nel filesystem locale o URL in formato `s3://bucket/prefix` / `gs://bucket/prefix`. Obbligatoria se è impostata `BACKUP_SCHEDULE`, che rifiuta di operare senza di essa. Il comando `rebase db backup` adotta come fallback la directory `./backups` relativa al punto di esecuzione. | — |
| `BACKUP_RETENTION_DAYS` | Elimina i salvataggi antecedenti a N giorni. L'assenza della variabile o il valore `0` preservano l'intero archivio storico. | — |
| `BACKUP_KEEP_MINIMUM` | Garantisce la persistenza di almeno N copie di backup tra le più recenti, indipendentemente dai criteri di retention temporale. | — |
| `PG_DUMP_PATH` | Specifica un percorso personalizzato per il binario `pg_dump` — la versione deve coincidere con la major version del server o essere più recente. | — |
| `PG_RESTORE_PATH` | Specifica un percorso personalizzato per il binario `pg_restore`. | — |
| `PSQL_PATH` | Specifica un percorso personalizzato per l'eseguibile `psql` invocato da `rebase db restore --clean` per isolare il processo di ripristino in una singola transazione. | — |
| `PG_DUMPALL_PATH` | Posizione del binario `pg_dumpall`, ove non reperibile nel `PATH`. In sua assenza — e in mancanza dei tool client di PostgreSQL nell'ambiente — il backup degli oggetti globali fallisce restituendo un errore correlato a questa variabile. | — |

L'immagine ufficiale del runtime (`rebasepro/server`) integra nativamente i tool
client di PostgreSQL 18, garantendo l'esecuzione dei backup pianificati verso qualsiasi
server fino alla versione Postgres 18. Al di fuori del container ufficiale, è necessario
provvedere alla loro installazione manuale (`apt-get install postgresql-client-18`,
`brew install libpq`).

I backup contengono credenziali e dati sensibili. Utilizza destinazioni private
adeguatamente protette da crittografia a riposo (encryption-at-rest).

### Distribuzione dei bundle

Nei deployment gestiti il codice applicativo non risiede nell'immagine: il runtime
scarica il bundle applicativo contestualmente alla procedura di avvio. Le seguenti variabili regolano tale meccanismo.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Percorso che punta a una directory con il bundle preventivamente estratto. Viene impostata in automatico localmente tramite `rebase start`. | — |
| `REBASE_BUNDLE_URL` | Indirizzo da cui prelevare l'archivio del bundle in mancanza di una cartella locale. | — |
| `REBASE_BUNDLE_TOKEN` | Token bearer utilizzato per autenticare la richiesta di prelievo. Da trattare come informazione riservata: autorizza il tenant all'acquisizione del proprio codice. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Percorso in cui viene decompresso il bundle scaricato. Deve presentare permessi di scrittura e conservare i dati nel passaggio dal prelievo all'avvio. | — |
| `REBASE_RUNTIME_MODULES` | Moduli addizionali messi a disposizione del bundle direttamente dall'immagine runtime, ulteriori rispetto a quelli inclusi autonomamente. | — |

### Binding delle risorse

Ogni database, bucket o topic dichiarato dall'applicazione nel file `backend/resources.ts`
viene associato mediante variabili d'ambiente il cui nome riflette la risorsa stessa.
I prefissi base sono illustrati di seguito; per fare riferimento a risorse diverse da quella
predefinita si aggiunge `__` unito al relativo identificatore in lettere maiuscole (es. un bucket
denominato `media` cercherà la variabile `S3_BUCKET__MEDIA`). Tramite `rebase status`
è possibile visualizzare nel dettaglio le variabili d'ambiente ricercate per ciascuna risorsa e il relativo stato di configurazione.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_DRIVER` | Pacchetto npm deputato a implementare il driver per la sorgente dati, laddove non coincida con quello standard di Postgres. Strutturato con suffisso per ogni sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Stringa di connessione assegnata a un topic registrato. Strutturato con suffisso dedicato a ciascun topic. | — |

### Variabili d'ambiente della CLI

Parametri letti direttamente dal comando `rebase`, senza impatto sulle logiche
del server. Nessuna di queste voci modifica il comportamento di un deployment.

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Destinazione verso cui i comandi `rebase api-keys`, `rebase storage` e `rebase auth reset-password` inviano la service key, da shell o da file `.env`. Utile qualora il server sia eseguito con modalità differenti da `rebase dev` (es. `rebase start`, all'interno di un container o su host remoto). Se non specificata, i comandi interrogano l'istanza rilevata da `rebase dev` finché questa risulta in esecuzione, astenendosi da qualunque chiamata quando è spenta. | — |
| `REBASE_SERVICE_KEY` | Chiave di servizio impiegata per autenticare i comandi precedenti, estratta dal file `.env`: corrisponde al parametro analizzato dal server (vedi sopra). | — |
| `SERVICE_KEY` | Nomenclatura legacy per la chiave di servizio. Se presente in `.env`, `rebase api-keys` e `rebase storage` ne acquisiscono il valore in sostituzione di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Percorso alternativo da cui la CLI legge o scrive le impostazioni d'ambiente, se disallineato da quello del progetto. | — |
| `REBASE_ROOT_RULES` | Con il valore `0`, impedisce a `rebase init` e `rebase skills install` di apportare modifiche alle istruzioni di configurazione nei file `CLAUDE.md` e `AGENTS.md` alla radice del repository, tutelando ambienti in cui la gestione dei prompt per gli agenti avviene manualmente. | on |
| `REBASE_CLOUD_URL` | Endpoint del control plane impiegato per la comunicazione da parte di `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Account utilizzato in automatico da `rebase cloud login`, evitando la richiesta interattiva. | — |
| `REBASE_CLOUD_PASSWORD` | Password associata all'account precedente, utile per consentire a secret manager di iniettarla senza tracciamento nella history della shell. | — |
| `REBASE_TOKEN` | Token generato tramite `rebase cloud tokens create`. Se impostata, ogni operazione di `rebase cloud` si autentica tramite essa bypassando la sessione creata con `rebase cloud login`, astenendosi dalla lettura o modifica dello stato locale. Nelle cartelle collegate via `rebase cloud init --claim`, viene temporaneamente esclusa a favore del token specifico del progetto qualora risulti priva di permessi adeguati su quest'ultimo. Costituisce lo standard di autenticazione per `rebase cloud` nei processi di CI — consulta [CI e agenti](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) provvede a propagarla alla CLI istanziata dalle proprie funzioni cloud, senza trasmetterla all'applicazione: a tale scopo va utilizzata `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | Impostata su `1`, restituisce nei log il dettaglio completo dell'errore e della richiesta in luogo della sintesi. Utile come prima verifica a fronte di risposte generiche da un comando `rebase cloud`. | — |
| `REBASE_ATLAS_DEV_URL` | Database vuoto su cui `rebase db push`, `db generate` e `db migrate` effettuano il calcolo delle modifiche, alternativo al database `<db>_dev_diff` istanziato accanto a `DATABASE_URL`. Rebase non provvede alla creazione o distruzione del database indicato, e ne rifiuta l'impiego qualora coincida con `DATABASE_URL`. Quando si opera sul database locale gestito, la CLI assegna automaticamente un'istanza volatile in-memory di PGlite. Indicata in contesti privi di privilegi per l'istruzione `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | Disabilita l'inizializzazione del database e il relativo provisioning all'interno di `rebase dev` — presuppone l'aggancio a un'istanza esterna. Equivalente al flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Sovrascrive e fissa la porta del server di sviluppo del frontend, che altrimenti `rebase dev` calcola a partire dal path del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Finestra di attesa entro cui `rebase dev` attende la notifica di avvio del backend prima di segnalare il fallimento dell'operazione. Con `0` la notifica viene disattivata. | `30000` |
| `DATABASE_PASSWORD` | Password che `rebase dev --docker` integra nella stringa di connessione dedotta dal file `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Standard condiviso tra molteplici tool. Se valorizzata con un valore differente da `0`, la CLI interrompe l'invio delle metriche di telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Direttiva di disattivazione della telemetria specifica per Rebase. Non necessita di file su disco, rappresentando la soluzione ideale per container e pipeline di CI. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Server di destinazione per l'invio dei dati di telemetria, nel caso di un collector self-hosted. | — |

## Segreti in sviluppo

`JWT_SECRET` è obbligatoria in produzione. Sia essa sia `REBASE_SERVICE_KEY` vengono
generate automaticamente in sua assenza, permettendo l'avvio immediato senza configurazioni preliminari.

I valori generati vengono salvati nella cache all'interno del file `.rebase-dev-secrets.json`, collocato accanto a
`.rebase-dev-port` e `.rebase-dev-url` e similmente ignorato da git. Nelle versioni precedenti
venivano rigenerati a ogni avvio — comportando la disconnessione dell'utente dall'applicazione
a ogni riavvio del dev server e invalidando le API key generate nella sessione.

- Specificando esplicitamente una delle variabili, il valore inserito avrà la precedenza e nulla verrà letto o scritto nella cache.
- Puoi reindirizzare la cache in un altro punto tramite `REBASE_DEV_SECRETS_FILE` — accetta un percorso, e rappresenta l'unica variabile di questo gruppo da configurare manualmente all'occorrenza.
- Rimuovendo il file forzerai la rigenerazione di entrambi i segreti, che verranno ricreati all'avvio successivo.
- Qualora la scrittura del file su disco risulti inibita (es. container in sola lettura), il server si avvierà impiegando credenziali effimere in memoria, riproponendo la modalità precedente.

Nessun dato viene salvato in cache in produzione o durante l'esecuzione dei test runner. In produzione non
avviene alcuna generazione automatica: l'avvio privo di `JWT_SECRET` fallisce bloccando il processo ed evidenziando il parametro mancante:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

L'oggetto `RebaseBackendConfig` passato alla funzione `initializeRebaseBackend()` consente il controllo programmatico:

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

Le medesime impostazioni,
escludendo `app`, `server` e `basePath` e aggiungendo l'opzione obbligatoria `provision`, consentono di comporre
un'istanza backend che rimane inerte fino al montaggio esplicito: `createRebaseBackend`. Consulta
[Integrazione server personalizzato](/docs/backend/custom-server/).

### Modificare `basePath`

L'impostazione `basePath` modifica la radice di ogni rotta API; di conseguenza, il client necessita
della medesima configurazione per evitare che tenti di contattare `/api/...` ottenendo risposte 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione eredita questa impostazione direttamente dall'istanza client fornita,
senza interventi manuali aggiuntivi. Se componi gli indirizzi delle chiamate via codice, risolvili a partire dal client
evitando di cablare staticamente la stringa `/api`:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Permesso negato in SQL Editor (`permission denied for table <name>`)

* **Sintomi:** Le query arbitrarie inviate tramite l'editor SQL di Rebase Studio falliscono con errore `cause: error: permission denied for table <name>`, sebbene la vista CMS tabellare mostri correttamente i record.
* **Causa:** Rebase esegue normalmente le query dell'Editor SQL assumendo provvisoriamente il ruolo del database associato al ruolo applicativo dell'utente attivo (es. tramite `SET LOCAL ROLE "admin"`). Nel caso di sistemi di autenticazione custom in cui i ruoli sono registrati esclusivamente su tabelle applicative senza corrispondere a ruoli PostgreSQL effettivi, la modifica di ruolo fallisce o mancano i relativi permessi nel database. La vista CMS opera bypassando questo meccanismo poiché viene eseguita direttamente con l'utente proprietario della connessione.
* **Soluzione:** Configura `DISABLE_DB_ROLE_SWITCHING=true` nel file `.env` del backend. Questa impostazione impone a Rebase di eseguire le query dell'Editor SQL ereditando i privilegi del proprietario della connessione (solitamente superuser o owner). L'Editor SQL mostrerà un avviso sopra l'output indicando che l'interrogazione è avvenuta con l'utente di connessione, disattivando il selettore dei ruoli.

### Errore nel recupero dello schema in SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** Studio non compila l'albero di navigazione dello schema, oppure l'Editor SQL restituisce l'errore `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necessita di privilegi amministrativi per consultare le tabelle di sistema del database ed eseguire comandi riservati. Se la stringa `adminConnectionString` non viene fornita al bootstrapper, oppure il metodo `getAdmin()` viene ridefinito per restituire `undefined`, queste interrogazioni falliscono.
* **Soluzione:** Verifica che `adminConnectionString` sia passata correttamente in fase di inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Passaggi successivi

- **[Distribuzione](/docs/getting-started/deployment)** — Guida al rilascio in produzione
- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
