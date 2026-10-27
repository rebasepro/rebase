---
sourceHash: d836d40bf88060b2
title: Ambiente e configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene eseguita tramite variabili d'ambiente nel file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio. Se
> qualsiasi elemento obbligatorio manca o è malformato (un URL che non è un URL, una porta che
> non è un numero), il server rifiuta l'avvio e indica il nome della variabile.
>
> La posizione dello schema dipende da come viene eseguito il backend. Un progetto avviato dal
> runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — utilizza lo
> schema di proprietà del runtime (`loadBootEnv` in `@rebasepro/server`), che corrisponde all'unione
> di ogni tabella sottostante. Un progetto che ha eseguito [`rebase eject`](/docs/cli)
> possiede un file `backend/src/env.ts` che chiama `loadEnv({ extend })`, e può aggiungervi le
> proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL. **Facoltativa in fase di sviluppo** — se non impostata, `rebase dev` esegue un'istanza PostgreSQL gestita per il progetto, con i dati archiviati in `.rebase/`. Obbligatoria ovunque altrove. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Usare una stringa casuale robusta (minimo 32 caratteri). **Obbligatoria in produzione** (generata automaticamente in fase di sviluppo). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` è una sintassi specifica di node-postgres, non di libpq.**
>
> Rebase e il driver Node la accettano — crittografano la connessione, ma non verificano il
> certificato. `psql`, `pg_dump`, `pg_restore` e Atlas non la supportano e non
> degradano l'errore: si rifiutano di avviarsi restituendo `invalid sslmode value: "no-verify"`.
>
> I comandi nativi di Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la riscrivono nell'equivalente `sslmode=require` prima di chiamare la shell,
> funzionando così correttamente con l'URL configurato. L'esecuzione manuale di `psql` non effettua
> questa operazione — occorre sostituirla manualmente con `sslmode=require`, che applica
> la crittografia senza verifica esattamente nello stesso modo.

### Frontend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `VITE_API_URL` | URL dell'API di backend per l'SDK tipizzato. **Impostare solo in fase di sviluppo** — vedere di seguito. | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth di Google. Abilita "Accedi con Google". | — |


> **Lasciare `VITE_API_URL` non impostata nelle build di produzione.**
>
> In fase di sviluppo il frontend e il backend hanno origini separate, quindi il server di sviluppo
> inietta questa variabile. In produzione il backend di Rebase serve la SPA, quindi l'API
> coincide con l'origine della pagina stessa e il client la risolve autonomamente in questo modo.
>
> Integrare un URL assoluto in un bundle di produzione funziona solo fino a quando un secondo
> hostname non punta alla stessa applicazione: un dominio personalizzato caricherà la pagina da
> `example.com` ed effettuerà chiamate all'API su `example.rebase.website`, operazione
> cross-origin che farà fallire ogni richiesta in fase di preflight. Consentire l'origine in CORS
> **non** risolverà il problema: il cookie di refresh è impostato su `SameSite=Lax` e non viene
> inviato cross-site, con la conseguenza di eliminare gli errori in console ma lasciando comunque
> l'autenticazione non funzionante. Se non impostata, qualsiasi dominio che punti all'applicazione
> funzionerà senza alcuna configurazione CORS.

### Backend

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `PORT` | Porta per il server HTTP di backend. Letta da `rebase start`. `rebase dev` la legge **esclusivamente dall'ambiente shell** — un valore `PORT` presente in `.env` non viene letto, poiché la porta viene risolta prima del caricamento di tale file — altrimenti associa una porta derivata dal percorso del progetto, consentendo l'esecuzione contemporanea di più progetti. `rebase dev --port` ha la priorità su entrambi, e il banner di avvio indica la configurazione utilizzata. | `3001` |
| `LOG_LEVEL` | Livello di dettaglio dei log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra la query SQL sottostante a una riga `Failed query: [redacted]`. Ogni istruzione fallita viene oscurata per impostazione predefinita, poiché una query non riuscita include i parametri associati (ad es. email, hash della password). Impostare su `true` durante la diagnosi di problemi DDL, RLS o di change-capture. Ignorata quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` o `test` | `development` |
| `CORS_ORIGINS` | Elenco di origini consentite separate da virgola. **Obbligatoria in produzione** a meno che sia impostata `FRONTEND_URL`: un avvio in produzione senza nessuna delle due si rifiuta di partire. In fase di sviluppo viene *aggiunta a* localhost — vedere di seguito. | — |
| `FRONTEND_URL` | URL dell'applicazione frontend. Utilizzata come alternativa a CORS_ORIGINS, in entrambi gli ambienti. | — |
| `ADMIN_CONNECTION_STRING` | Stringa di connessione al database a livello di amministratore (utilizzata per l'introspezione dello schema e le operazioni amministrative). Il database specificato non è quello considerato corrente dalla console SQL, né quello copiato per impostazione predefinita da un nuovo branch: entrambi corrispondono al database su cui si trova la connessione dell'applicazione stessa (vedere `REBASE_BRANCH_PARENT_DATABASE` per un server su un branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Disabilita il cambio di ruolo PostgreSQL nell'editor SQL (utile per l'autenticazione personalizzata in cui i ruoli del database non sono mappati). In questo caso la console SQL di Studio indicherà che le righe sono state lette come proprietario della connessione, specificandone il nome, e disabiliterà il selettore dei ruoli. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | Il database da cui è stato copiato il branch su cui viene eseguito questo server. `rebase dev` la imposta su un checkout [passato a un branch](/docs/backend/branching/#cli-integration). Un server che include questa variabile mantiene il registro dei branch su quel database e copia i nuovi branch da esso per impostazione predefinita, consentendo al riquadro Branches di Studio di mostrare i branch del database principale. | — |

#### CORS in fase di sviluppo

L'ambiente di sviluppo consente **localhost, più qualsiasi origine indicata in `CORS_ORIGINS` (o `FRONTEND_URL`)** — lo stesso elenco utilizzato in produzione, con localhost aggiunto anziché sostituito. Di conseguenza, la variabile funziona allo stesso modo in entrambi gli ambienti e i casi d'uso tipici in fase di sviluppo includono:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Un'origine che non corrisponde a localhost e non è presente nell'elenco viene rifiutata; il rifiuto viene registrato nei log **una volta per ciascuna origine**, indicando l'esatta riga necessaria per autorizzarla. Questo blocco non è una semplice misura precauzionale: l'API invia credenziali, pertanto riflettere un header `Origin` arbitrario consentirebbe a qualsiasi sito visitato dallo sviluppatore di effettuare richieste autenticate al server di sviluppo con la sua sessione e leggerne le risposte.

### Autenticazione

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `JWT_SECRET` | Chiave segreta per la firma dei JWT (obbligatoria in produzione, generata automaticamente in sviluppo) | — |
| `JWT_PRIVATE_KEY` | Chiave privata PEM per la firma asimmetrica dei token di accesso (RS256), consentendo a qualsiasi entità in possesso del JWKS di verificare una sessione senza poter generare nuovi token. Accetta un file PEM con newline effettivi, un PEM con caratteri di escape `\n`, o la codifica base64 dell'intero PEM. In assenza di questo valore, i token rimangono in formato HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` nell'header del token e nel JWKS. Modificare questo valore ogni volta che la chiave cambia — il processo di rotazione richiede che la chiave precedente e quella nuova siano distinguibili. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh. È di tipo scorrevole (sliding): ogni rotazione ne estende la validità, determinando per quanto tempo una sessione rimane attiva in caso di **inattività**. Impostare `400d` per sessioni che devono sopravvivere a lunghe assenze; i browser applicano questo limite massimo ai cookie di refresh. | `30d` |
| `ALLOW_REGISTRATION` | Consente la registrazione di nuovi utenti (`true`/`false`). Al di fuori della produzione il **primo** utente può sempre registrarsi, a prescindere da questo valore — una tabella utenti vuota deve accettare un utente iniziale, che assumerà il ruolo di amministratore. In produzione (`NODE_ENV=production`) tale finestra è chiusa: una tabella vuota rifiuterà la registrazione iniziale restituendo `SETUP_REQUIRED`, il primo account creato tramite registrazione aperta sarà un utente standard e l'amministratore dovrà essere definito tramite `REBASE_ADMIN_EMAIL` (vedere sotto) o assegnato con la chiave di servizio. Il file `.env.example` dello scaffold la imposta a `true`; il valore predefinito del framework è disattivato. | `false` |
| `DISABLE_SELF_REGISTRATION` | Kill switch. Chiude la finestra di bootstrap del primo utente che `ALLOW_REGISTRATION=false` lascia intenzionalmente aperta al di fuori della produzione, bloccando la registrazione anche su un database vuoto. Da associare a `REBASE_ADMIN_EMAIL` sotto, altrimenti la distribuzione non avrà modo di generare il suo primo utente autenticato. Ogni artefatto di distribuzione rilasciato la include attivata. | — |
| `REBASE_ADMIN_EMAIL` | Indirizzo email del primo account amministratore, creato all'avvio **quando la tabella utenti è ancora vuota** e mai successivamente. È la modalità con cui una distribuzione di produzione ottiene il proprio amministratore: l'operatore specifica il primo account evitando che venga registrato da terzi su Internet. L'avvio genera un avviso se la tabella è vuota in produzione e questa variabile non è impostata. | — |
| `REBASE_ADMIN_PASSWORD` | Password per tale account. Deve contenere almeno 12 caratteri, altrimenti viene rifiutata e l'account non viene creato. Modificarla dopo il primo accesso. | — |
| `MFA_ENCRYPTION_KEY` | Crittografa ogni segreto TOTP archiviato. Se non impostata, i segreti vengono crittografati con `JWT_SECRET` e all'avvio viene emesso un avviso: la rotazione di `JWT_SECRET` disconnetterebbe tutti gli utenti e renderebbe indecifrabili tutti gli autenticatori configurati. Impostare una chiave dedicata (oltre 32 caratteri casuali) prima della registrazione di qualsiasi utente. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La chiave da cui si sta effettuando la *rotazione*. Impostarle entrambe durante una rotazione: i nuovi segreti vengono scritti con `MFA_ENCRYPTION_KEY` e quelli esistenti rimangono leggibili, evitando che gli utenti restino bloccati fuori dal proprio account durante la transizione. Rimuoverla dopo la ri-crittografia di tutti i segreti. | — |
| `ALLOW_ANONYMOUS` | Abilita l'accesso anonimo (`POST /api/auth/anonymous`). Funzionalità opt-in, intenzionalmente non vincolata a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Richiede l'autenticazione per l'API dati. Impostare su `false` per esporre un'interfaccia di lettura completamente pubblica — la sicurezza a livello di riga (RLS) rimane comunque applicata. | `true` |
| `AUTH_DEFAULT_ROLE` | Ruolo assegnato a un utente appena registrato quando non ne viene specificato alcuno. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Abilita l'endpoint `POST /api/auth/find-user`, che risolve un'email in un profilo pubblico minimale (`uid`, `displayName`, `photoURL`) per i flussi di invito tramite email. Riservato esclusivamente a chiamanti autenticati; non restituisce mai l'email, i ruoli o i metadati dell'utente trovato. Disabilitato per impostazione predefinita: rappresenta una potenziale superficie di enumerazione. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Valore `SameSite` per il cookie di refresh: `Strict`, `Lax` o `None`. `None` richiede HTTPS ed è destinato esclusivamente a frontend realmente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Flag `Secure` per il cookie di refresh. Attivo per impostazione predefinita; impostare `AUTH_COOKIE_SECURE=false` per protocollo http semplice — ad esempio distribuzioni su indirizzi LAN dove il browser ignorerebbe altrimenti il cookie e la sessione terminerebbe alla scadenza del token di accesso senza mostrare errori. Emette un avviso all'avvio. `http://localhost` non ne ha bisogno. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID OAuth di GitLab. Il parametro `baseUrl` di un'istanza self-hosted non ha una variabile d'ambiente corrispondente: configurare GitLab nel blocco `auth` per questa esigenza. | — |
| `GITLAB_CLIENT_SECRET` | Client secret OAuth di GitLab | — |
| `BITBUCKET_CLIENT_ID` | Client ID OAuth di Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret OAuth di Bitbucket | — |
| `SLACK_CLIENT_ID` | Client ID OAuth di Slack | — |
| `SLACK_CLIENT_SECRET` | Client secret OAuth di Slack | — |
| `SPOTIFY_CLIENT_ID` | Client ID OAuth di Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret OAuth di Spotify | — |
| `APPLE_CLIENT_ID` | Apple Services ID. Apple non prevede un client secret statico — Rebase firma un token JWT ES256 a breve durata per ogni scambio di token — pertanto sono necessari tutti e quattro i valori `APPLE_*`, senza i quali la funzionalità non viene configurata. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, corrispondente all'emittente (issuer) del JWT. | — |
| `APPLE_KEY_ID` | Key ID della chiave privata registrata con Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenuto del file della chiave privata `.p8`, inclusi i ritorni a capo (sono accettati i caratteri di escape `\n`). | — |
| `REBASE_SERVICE_KEY` | Chiave API di amministrazione statica. Bypassa la normale autenticazione JWT per chiamate server-to-server quando inviata come `Authorization: Bearer <key>`. (Generata automaticamente in fase di sviluppo). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La chiave pubblica della piattaforma di hosting (PEM, EC P-256) utilizzata per verificare i token di piattaforma `rpt_`; può contenere più blocchi PEM durante una rotazione delle chiavi. Viene configurata dalla piattaforma in fase di deploy e non contiene segreti. Insieme a `REBASE_PLATFORM_TOKEN_AUDIENCE`, consente al gateway di amministrazione di accettare un token di piattaforma esclusivamente per l'ambito `cron:read`. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID del progetto a cui deve corrispondere il parametro `aud` di un token di piattaforma, assicurando il rifiuto di token generati per altri progetti. Se solo una delle due variabili è configurata, il server si avvia, registra un avviso e risponde a qualsiasi token `rpt_` con `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Posizione in cui vengono archiviati i contatori per il rate limiting dell'autenticazione: `memory` (per singolo processo) o `sql` (condivisi tra le repliche). Un processo non è a conoscenza del numero totale di repliche attive; pertanto, una distribuzione multi-istanza deve esplicitarlo — tre repliche con il valore predefinito applicherebbero una soglia complessiva triplicata. Qualsiasi altro valore **impedisce l'avvio** senza eseguire fallback, incluso `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Abilita il flusso di accesso senza password tramite link (magic link). Richiede la configurazione di un servizio email, altrimenti il link non potrà essere recapitato. | `false` |
| `AUTH_EMAIL_OTP` | Abilita l'accesso senza password tramite codice numerico a sei cifre inviato via email. Ha gli stessi requisiti di posta indicati sopra. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Registrazione senza password: una richiesta di magic link o codice email per un indirizzo non presente nel sistema crea il relativo account, a condizione che la registrazione sia aperta. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento in caso di riutilizzo di un token di refresh oltre la finestra consentita: `reject` (rifiuta la richiesta, mantiene la sessione) o `revoke-session` (termina la sessione). Qualsiasi altro valore impedisce l'avvio del server. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registrazione con conferma obbligatoria: l'accesso tramite password è bloccato fino alla verifica dell'indirizzo. Richiede la configurazione dell'email; l'avvio fallisce se il servizio email è assente. | `false` |
| `CAPTCHA_PROVIDER` | Abilita la verifica captcha sugli endpoint di autenticazione: `turnstile` o `hcaptcha`. Se non impostata, il captcha rimane disattivato. | — |
| `CAPTCHA_SECRET` | Chiave segreta del provider, impiegata lato server per convalidare il token inviato dal browser. Obbligatoria se `CAPTCHA_PROVIDER` è impostata. | — |
| `CAPTCHA_ROUTES` | Elenco di route di autenticazione da proteggere, separate da virgola (ad esempio `register,login`). Se non specificata, protegge il set predefinito del provider. | — |

### Archiviazione (Storage)

:::caution[Lo storage non dispone di sicurezza a livello di riga (RLS) e richiede pertanto un modello di accesso]
Le collezioni sono protette dalla RLS di Postgres. L'archiviazione a oggetti non offre un meccanismo equivalente —
le chiavi condividono un singolo namespace piatto — quindi, con un bucket configurato ma privo di modello di accesso,
il server **rifiuta l'avvio in produzione**. Per soddisfare questo requisito, definire esattamente uno dei seguenti elementi:
l'hook `storageAuthorize` esportato da `config/index.ts` (fornito di serie nello scaffold),
`STORAGE_PUBLIC_READ`, o `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `STORAGE_TYPE` | Backend di archiviazione: `local`, `s3` o `gcs`. In produzione `local` disabilita lo storage a meno che non sia impostato `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Percorso di base per lo storage locale. I percorsi relativi vengono risolti rispetto alla directory da cui viene eseguito il server: la radice del progetto con `rebase dev`, la directory `backend/` in un server generato con `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Consente l'uso dello storage locale in produzione — esclusivamente con un volume permanente associato a `STORAGE_PATH` e alle directory `<STORAGE_PATH>__<key>` dei bucket locali adiacenti | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondi di validità dell'URL di download di un file privato — il token generato da `getSignedUrl()`. Valore massimo `604800` (una settimana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima dei file accettata dalla sorgente, in byte, su ogni percorso di upload — `__<KEY>` per una sorgente con nome. Un valore non intero impedisce l'avvio | `52428800` (50 MB) |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS (Access Key) | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS (Secret Access Key) | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |
| `S3_FORCE_PATH_STYLE` | Forza l'uso di URL in formato path-style per il bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome del bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | ID del progetto GCP. Generalmente ricavato dalle credenziali. | — |
| `GCS_KEY_FILENAME` | Percorso del file delle chiavi del service account. Omettere su GCP se le credenziali sono fornite da Workload Identity. | — |
| `STORAGE_PUBLIC_READ` | Distribuisce qualsiasi oggetto a chiunque, senza necessità di token. Da utilizzare solo se il bucket è a tutti gli effetti un CDN pubblico. È uno dei tre metodi per soddisfare il controllo di sicurezza all'avvio descritto sopra. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Consente a qualunque utente autenticato di leggere, scrivere, elencare ed eliminare qualsiasi oggetto. È indicata come `INSECURE` nell'oggetto di configurazione per un motivo preciso: è accettabile solo in applicazioni single-tenant in cui ogni account dispone della massima fiducia per tutti i file. | `false` |
| `STORAGE_RENDITION_CACHE` | Mantiene in cache le versioni modificate generate per le immagini (ridimensionamenti, conversioni di formato) evitando di rielaborarle a ogni richiesta. | `false` |

### Email (Opzionale)

| Variabile | Descrizione |
|-----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Abilita la connessione sicura (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `SMTP_FROM` | Indirizzo del mittente per le email di sistema |
| `SMTP_NAME` | Nome visualizzato associato all'indirizzo del mittente |
| `APP_NAME` | Nome del prodotto utilizzato nell'oggetto e nel corpo dei messaggi email (predefinito: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo mostrato nell'intestazione dei template email predefiniti. Deve essere un URL assoluto `http(s)` a un file PNG o JPG — i client di posta rimuovono i file SVG e bloccano gli URI `data:`. Se non impostato, un'applicazione denominata `Rebase` mostrerà il marchio Rebase, mentre un'applicazione rinominata non mostrerà alcun logo |

### Pool di connessioni al database

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `DB_POOL_MAX` | Numero massimo di connessioni nel pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondi prima della chiusura di una connessione inattiva | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondi di attesa massima per stabilire una connessione | `10000` |
| `DATABASE_DIRECT_URL` | Connessione diretta (non mediata da pooler). Richiesta per le funzionalità [Realtime](/docs/backend/realtime): le istruzioni `LISTEN`/`NOTIFY` non operano attraverso transaction pooler come PgBouncer; in assenza di connessione diretta, le notifiche di modifica vengono disabilitate con un avviso anziché andare perse silenziosamente. Anche il [job worker](/docs/backend/jobs) mantiene il suo `LISTEN` di riattivazione su di essa. Valorizza il parametro `directConnectionString` dell'adattatore Postgres se non specificato altrimenti. | — |
| `DATABASE_READ_URL` | Replica di sola lettura. Le query di lettura vengono instradate qui se la variabile è impostata e diversa da `DATABASE_URL`; se la connessione fallisce, le operazioni tornano automaticamente al database primario con un avviso. Valorizza l'opzione `readConnectionString` dell'adattatore Postgres quando non specificata; nella versione 0.24 questa opzione viene ignorata. | — |
| `REBASE_DB_POOL_MAX` | Limite massimo applicato a ogni singolo pool all'interno del processo, indipendentemente dalle configurazioni specifiche. Accetta solo cifre numeriche: un valore malformato viene ignorato per evitare di serializzare involontariamente le operazioni del server. | — |

### Comportamento del runtime

Variabili lette direttamente dal runtime — `rebase dev`, `rebase start` e l'immagine
del server pubblicata. Un progetto sottoposto a eject gestisce queste logiche all'interno del proprio codice.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_RLS_AUDIT` | Se impostata su `true`, esegue il [controllo pianificato della sicurezza a livello di riga (RLS)](/docs/rls-check#running-it-on-a-schedule), segnalando le tabelle servite prive di policy. Il progetto deve includere `@rebasepro/rls-check` tra le dipendenze: il runtime non include questo pacchetto e l'avvio verrà bloccato indicando la dipendenza mancante. `false` disabilita la scansione in questo processo. | — |
| `REBASE_BASE_PATH` | Percorso di base per tutte le route API. Deve essere allineato con la configurazione del client — vedere [Modifica di `basePath`](#modifica-di-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Distribuisce gli asset statici/amministrativi del bundle direttamente da questo processo. Disattivare se è presente un CDN a monte. | `true` |
| `REBASE_HISTORY` | Registra la [cronologia delle modifiche alle entità](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Abilita la compressione gzip/brotli delle risposte. | `true` |
| `REBASE_MAX_BODY_SIZE` | Dimensione massima consentita per il corpo della richiesta, **in byte** (es. `10485760`, non `10MB` — un valore non numerico blocca l'avvio anziché rimuovere silenziosamente la restrizione). Impostare `0` per disattivare il limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Interfaccia OpenAPI. Funzionamento a tre stati: non definita indica attiva in sviluppo e disattivata in produzione; `false` la disattiva in qualsiasi ambiente. `true` in produzione espone la **specifica** su `/api/docs`, ma non l'**interfaccia grafica** Swagger su `/api/swagger` — la UI è vincolata separatamente al valore di `NODE_ENV`. | — |
| `REBASE_METRICS` | Espone le metriche Prometheus all'endpoint `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Aggiunge la direttiva `includeSubDomains` all'header `Strict-Transport-Security`, indicando ai browser di rifiutare connessioni HTTP non cifrate su tutti i sottodomini per sei mesi — compresi gli host non gestiti da questo processo. Attivare solo se ogni sottodominio applica obbligatoriamente HTTPS. Qualsiasi valore diverso da `true`/`false` impedisce l'avvio. Vedere [Header di sicurezza](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token a protezione dell'endpoint `/metrics`. Se non impostata, l'endpoint è accessibile da qualunque entità raggiunga la porta: accettabile su una rete privata, rischioso su rete pubblica (la condizione viene segnalata nei log di avvio). | — |
| `REBASE_MIGRATE_ON_BOOT` | Operazioni di migrazione dello schema consentite al runtime all'avvio. `ensure` (il valore predefinito ovunque, inclusa la produzione) esegue il passaggio **esclusivamente additivo**: crea tabelle, colonne e tipi enum mancanti, senza mai eliminare o riscrivere elementi esistenti. `none` lascia intatto lo schema delle collection, ma le tabelle proprie del framework (auth, chiavi API, job, cron) vengono comunque create e mantenute aggiornate; <span class="since-badge" data-since="0.26">Da 0.26</span> `REBASE_PROVISION=false` disattiva anche quelle. L'immagine ufficiale accetta solo questi due valori e **rifiuta l'avvio con `push`**. Nelle [distribuzioni suddivise (split deployments)](/docs/deployment/split-processes), un solo processo deve gestire il provisioning; tutti gli altri ruoli devono impostare `none`, pena il blocco dell'avvio. | `ensure` |
| `REBASE_PROVISION` | <span class="since-badge" data-since="0.26">Da 0.26</span> `false` fa sì che il runtime non modifichi nulla nel proprio database: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o permesso, né all'avvio né dopo, comprese le tabelle proprie del framework. Segnala invece per nome ciò che manca. Per un database che solo il vostro processo di modifica può cambiare. Vedi [Quando solo il vostro processo di modifica può cambiare il database](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Sono accettati solo `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Impedisce l'avvio se l'ultimo provisioning del database è stato effettuato a partire da un insieme di collezioni differente rispetto a quello con cui è stato compilato questo processo. Se non impostata (o con valori diversi da `true`/`1`), genera un avviso anziché un blocco. | warn |
| `REALTIME_CDC` | Change data capture a livello di database: `auto` (abilita se la connessione lo supporta, con fallback silenzioso in caso contrario), `trigger` (forza l'uso dei trigger, segnalando con un avviso l'eventuale impossibilità), `wal` (attualmente degrada a `trigger`), `off`. Vedere [Realtime](/docs/backend/realtime-cdc/). Ha la precedenza rispetto all'opzione `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Livello di trasporto tra istanze per canali broadcast e presence: `memory` o `postgres`. Ignorato se la configurazione `realtime.bus` specifica già un'istanza di trasporto. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Numero massimo di sottoscrizioni consentite per ciascun socket realtime; il superamento comporta l'errore `TOO_MANY_SUBSCRIPTIONS`. Richiede un numero intero positivo — valori differenti bloccano il server all'avvio. Ha la precedenza rispetto a `realtime.maxSubscriptionsPerSocket`. Vedere [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Numero massimo di socket realtime che un singolo utente, o una singola chiave API, può mantenere aperti su una singola istanza del server. I socket di un amministratore che impersonano contano a carico dell'amministratore. Il superamento rifiuta l'autenticazione con `TOO_MANY_SOCKETS` e chiude il socket (codice 4002); l'SDK ritenterà la connessione, riuscendovi non appena un altro socket viene chiuso. Numero intero positivo — valori non conformi bloccano l'avvio. Ha la precedenza rispetto a `realtime.maxSocketsPerUser`. | Nessun limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo massimo (in ms) per cui una modifica attende il refetch destinato ai sottoscrittori attivi. Il refetch attende 300 ms in assenza di nuove modifiche, fino a un limite massimo specificato da questo valore in presenza di scritture continue. Numero intero positivo — altri valori bloccano l'avvio. Ha la precedenza rispetto a `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervallo di tempo (in ms) durante il quale il conteggio totale di una sottoscrizione a liste estese può essere riutilizzato prima di un nuovo calcolo; i frame che riutilizzano il valore includono il campo `meta.totalAsOf`. Se non impostata, il calcolo viene rieseguito a ogni frame. Ha la precedenza rispetto a `realtime.recountIntervalMs`. | Non impostata |
| `REALTIME_RECOUNT_MIN_ROWS` | La soglia minima di righe dell'ultimo conteggio a cui applicare `REALTIME_RECOUNT_INTERVAL_MS`; le liste di dimensioni inferiori vengono conteggiate ad ogni frame. Ha la precedenza rispetto a `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Consente valori di tipo `localhost`/loopback quando `NODE_ENV=production`. Disattivata per impostazione predefinita, così da interrompere esplicitamente l'avvio in produzione anziché tentare di connettersi a database inesistenti. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Azione eseguita all'avvio in presenza di chiavi nelle collezioni non riconosciute da questa versione: `warn`, `error` (blocca l'avvio — consigliato in ambienti di CI), oppure `off`. Si applica solo a chiavi non *riconosciute*, riconducibili a errori di battitura o metadati intenzionali; una chiave che il sistema sa essere stata spostata genera sempre un errore irreversibile, altrimenti la funzionalità configurata risulterebbe assente in modo silente. | `warn` |
| `REBASE_PROVISION_ONLY` | Impostata su `1`/`true`, esegue il passaggio di aggiornamento dello schema ed esce senza aprire porte di ascolto — ideale per un Job di migrazione basato sulla stessa immagine e bundle del server successivo. Una stringa vuota equivale a *non impostata*, garantendo che un segnaposto `${SOMETHING}` non espanso in un file compose non converta per errore un'istanza operativa in un job a sola migrazione. Crea anche le tabelle che un processo di servizio creerebbe al primo utilizzo, e non avvia né il cron né la coda dei job. Rifiutata insieme a <span class="since-badge" data-since="0.26">Da 0.26</span> `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | <span class="since-badge" data-since="0.26">Da 0.26</span> Un percorso di file. Un'esecuzione di provisioning (`REBASE_PROVISION_ONLY=true`) vi scrive ogni modifica dello schema che ha effettuato, in ordine, come script SQL da rivedere e applicare con `psql`. Le righe che ha scritto non sono incluse. Rifiutata su un processo che serve richieste. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | Se impostata su `true`, consente a processi automatici (agenti, job di CI) di *applicare* modifiche allo schema tramite `/api/admin/schema`, anziché limitarsi alla sola pianificazione. Disattivata salvo esplicita configurazione: le credenziali con privilegi per queste operazioni sono tipicamente definite come variabili nei sistemi di CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durata massima consentita per l'esecuzione di una funzione personalizzata prima dell'annullamento della richiesta. Equivale all'opzione `functionsTimeoutMs`. `0` disattiva il timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` forza l'arresto immediato del processo in caso di unhandled promise rejection anziché limitarsi alla sola registrazione nei log. Consigliata con orchestratori in grado di riavviare l'istanza; sconsigliata se l'interruzione del servizio ha un impatto peggiore di una perdita di memoria. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantiene attivo lo scheduler cron su piattaforme gestite che il runtime identifica altrimenti con scalabilità a zero (scale-to-zero), dove un timer eseguito su un'istanza inattiva non verrebbe azionato su nessuna macchina. | — |
| `TRUSTED_PROXY_HOPS` | Numero di reverse proxy posizionati a monte del server, necessario per consentire al rate limiter di identificare il reale indirizzo del client leggendo `X-Forwarded-For`. Predefinito a `0` per sicurezza: senza proxy interposti, dare credito a questo header consentirebbe a qualsiasi client di contraffare la propria identità di rete. | `0` |

:::note[Il provisioning all'avvio è puramente additivo e non sostituisce uno strumento di migrazione completo]
La fase di boot viene eseguita senza supervisione manuale e senza un controllo interattivo delle differenze (diff),
motivo per cui non eliminerà mai colonne, non restringerà tipi di dato né riscriverà tabelle. Questo è anche
il motivo per cui l'immagine rifiuta il valore `REBASE_MIGRATE_ON_BOOT=push`: un'operazione di push completa calcola le differenze
ed è autorizzata a invocare `DROP COLUMN`, ma il semplice riavvio di un container per manutenzione non deve
mai poter distruggere colonne in ambienti di produzione.

Le modifiche distruttive o strutturali devono essere gestite in contesti con possibilità di revisione: tramite
`rebase db generate` + `rebase db migrate`, oppure `rebase db push` eseguito manualmente o via CI,
che mostra un'anteprima delle modifiche (dry-run), richiede conferma esplicita per le operazioni distruttive
e supporta la creazione preventiva di backup.
:::

### Distribuzioni separate (Split deployments)

Una singola immagine e un unico bundle applicativo possono essere avviati su più istanze indipendenti,
ciascuna dedicata a un ruolo specifico del progetto. Questa tabella riepiloga le variabili disponibili;
per i dettagli su ciò che ciascuna combinazione *avvia e gestisce* — e per le configurazioni non consentite — consultare la guida
**[Split Processes](/docs/deployment/split-processes)**.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_ROLE` | Ruolo gestito da questo processo: `all`, `api`, `functions` o `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sovrascrive l'esecuzione dei timer cron per *questo* processo. Se non impostata, segue la configurazione del ruolo. | — |
| `REBASE_JOB_WORKERS` | Sovrascrive l'esecuzione dei worker delle code di job per questo processo. Se non impostata, segue la configurazione del ruolo. | — |
| `REBASE_FUNCTIONS_ONLY` | Esegue in questo processo esclusivamente le funzioni personalizzate indicate. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Esegue tutte le funzioni personalizzate a eccezione di quelle indicate. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destinazione upstream a cui il processo API inoltra le richieste per le funzioni che non gestisce direttamente. Su un `worker`, dove vanno le sue chiamate `rebase.functions`. Un URL `http(s)`. | — |

### Endpoint MCP

Endpoint opzionale per il protocollo Model Context Protocol accessibile su `/mcp`, progettato per consentire a client AI
di interagire in lettura e scrittura con il progetto **con i permessi dell'utente autenticato**. È disattivato salvo configurazione esplicita
e — a differenza delle altre interfacce — nessun valore di `REBASE_ROLE` lo abilita automaticamente: i ruoli
definiscono l'architettura dei processi, mentre l'esposizione di questo endpoint comporta la condivisione di credenziali
con software di terze parti, scelta che deve essere assunta esplicitamente dall'amministratore.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_MCP_ENABLED` | Abilita l'endpoint MCP. Richiede la definizione di `REBASE_PUBLIC_URL`; in sua assenza l'endpoint non viene esposto, segnalando l'evento nei log di avvio. | `false` |
| `REBASE_PUBLIC_URL` | Origine pubblicamente raggiungibile per questa distribuzione (es. `https://app.example.com`). L'interfaccia MCP non può ricavarla dinamicamente, in quanto utilizzare l'header `Host` renderebbe l'identità dell'emittente (issuer) e l'audience di verifica dei token valori modificabili dal chiamante. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Abilita la registrazione dinamica dei client OAuth (RFC 7591), consentendo l'auto-registrazione dei client. Impostare su `false` se si richiede che i client vengano pre-registrati manualmente. | `true` |

### Modifica dello schema in tempo reale da bundle

Disattivata se `REBASE_LIVE_SCHEMA_REPOSITORY` non è valorizzata. Poiché un bundle compilato
non include il codice sorgente delle collezioni da modificare, impostando queste variabili l'editor di collezioni
amministrativo scaricherà il codice dalla repository remota, applicherà le modifiche tramite commit e
eseguirà i relativi comandi DDL sul database in uso. Funzionalità a uso esclusivo dell'amministratore,
eseguita manualmente a meno che non sia specificato `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`. Specificare una
repository senza credenziali valide impedirà l'avvio. Consultare
[Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repository GitHub di destinazione per i commit dello schema, nel formato `owner/name`. Impostarla attiva la funzionalità. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Branch su cui eseguire il commit delle modifiche. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Percorso dei file sorgente delle collezioni all'interno della repository. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token con permessi granulari (fine-grained) di lettura e scrittura sui contenuti della repository. Configurare questo token o le tre variabili `_GITHUB_APP_*`, non entrambi i sistemi. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID della GitHub App, per eseguire commit a nome dell'applicazione anziché tramite token personale. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID di installazione dell'applicazione sulla repository. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chiave privata dell'applicazione: formato PEM, PEM con newline soggetti a escape, oppure stringa in base64. | — |

### Backup

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `BACKUP_SCHEDULE` | Espressione cron per pianificare i backup periodici. Se omessa, i backup automatici sono disabilitati. | — |
| `BACKUP_DESTINATION` | Percorso su disco locale, o URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Numero di giorni di conservazione prima dell'eliminazione. Se non impostata o `0`, mantiene indefinitamente tutti i backup. | — |
| `BACKUP_KEEP_MINIMUM` | Numero minimo di backup recenti da preservare sempre, a prescindere dal criterio temporale di retention. | — |
| `PG_DUMP_PATH` | Percorso alternativo del binario `pg_dump` — deve corrispondere alla major version del server o a una versione più recente. | — |
| `PG_RESTORE_PATH` | Percorso alternativo del binario `pg_restore`. | — |
| `PSQL_PATH` | Percorso alternativo del binario `psql` eseguito da `rebase db restore --clean` per completare il ripristino all'interno di una singola transazione. | — |
| `PG_DUMPALL_PATH` | Posizione dell'eseguibile `pg_dumpall`, se non presente nel `PATH`. In assenza di questo file — e dei client PostgreSQL di sistema — il backup degli oggetti globali fallirà richiamando espressamente questa variabile. | — |

L'immagine ufficiale di runtime (`rebasepro/server`) integra i tool client di
PostgreSQL 18, supportando operazioni di backup schedulato verso server fino a Postgres 18.
Se si esegue al di fuori dell'immagine container, installare i pacchetti corrispondenti nel sistema ospitante (`apt-get install postgresql-client-18`,
`brew install libpq`).

I file di backup contengono dati sensibili e segreti: utilizzare storage di destinazione
privati con crittografia a riposo (at-rest) abilitata.

### Distribuzione del bundle (Bundle delivery)

Una distribuzione gestita non memorizza il codice applicativo all'interno dell'immagine: il runtime
scarica il bundle in fase di avvio. Le seguenti variabili governano questa procedura.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BUNDLE` | Percorso di una cartella contenente un bundle già estratto. Impostato localmente da `rebase start`. | — |
| `REBASE_BUNDLE_URL` | URL remoto da cui scaricare l'archivio del bundle qualora non sia presente localmente. | — |
| `REBASE_BUNDLE_TOKEN` | Credenziale di tipo bearer impiegata per autorizzare il download dell'archivio. Trattare come dato sensibile: abilita il tenant a prelevare il proprio codice applicativo. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Directory di destinazione per l'estrazione del bundle scaricato. Deve consentire la scrittura e rimanere disponibile tra il download e l'inizializzazione del processo. | — |
| `REBASE_RUNTIME_MODULES` | Moduli aggiuntivi resi disponibili al bundle dall'immagine di runtime, oltre a quelli già integrati nel pacchetto. | — |

### Associazione risorse (Resource bindings)

Ciascun database, bucket e topic configurato in `config/resources.ts` viene associato
alle variabili d'ambiente denominate in accordo con la risorsa stessa. I nomi base sono riportati di seguito;
per risorse personalizzate o non predefinite, aggiungere in coda il suffisso `__` seguito dal nome risorsa in maiuscolo
(es. un bucket `media` leggerà la variabile `S3_BUCKET__MEDIA`). Il comando `rebase status`
mostra dettagliatamente per ogni risorsa la variabile letta e il suo stato di impostazione.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_DRIVER` | Pacchetto npm contenente il driver della sorgente dati, se differente da quello Postgres nativo. Suffisso per sorgente: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Stringa di connessione relativa a un topic dichiarato. Suffisso per singolo topic. | — |

### Variabili d'ambiente per la CLI

Valori letti esclusivamente dal comando `rebase`, e non dal runtime del server. Nessuna di queste
variabili produce impatti sull'ambiente di distribuzione remota.

| Variabile | Descrizione | Predefinito |
|-----------|-------------|-------------|
| `REBASE_BASE_URL` | Endpoint a cui inviare la service key tramite `rebase api-keys`, `rebase storage` e `rebase auth reset-password`, configurabile da shell o `.env`. Utile qualora il server sia avviato senza `rebase dev` (es. tramite `rebase start`, container o host remoto). Se omessa, le chiamate usano l'indirizzo annotato da `rebase dev` durante l'esecuzione del server, altrimenti non trasmettono dati. | — |
| `REBASE_SERVICE_KEY` | Chiave di servizio con cui tali comandi si autenticano, ricavata dal file `.env`: coincide con la medesima variabile letta dal server (vedere sopra). | — |
| `SERVICE_KEY` | Denominazione pregressa per la service key. Se configurata in `.env`, viene considerata da `rebase api-keys` e `rebase storage` in sostituzione di `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Percorso specifico del file `.env` che la CLI deve leggere e scrivere, quando diverso dalla radice del progetto. | — |
| `REBASE_CLOUD_URL` | Endpoint del piano di controllo (control plane) con cui comunica `rebase cloud`. | — |
| `REBASE_CLOUD_EMAIL` | Account utilizzato da `rebase cloud login` per evitare richieste interattive a terminale. | — |
| `REBASE_CLOUD_PASSWORD` | Password dell'account, per l'integrazione con gestori di segreti evitando la registrazione nei log della shell. | — |
| `REBASE_TOKEN` | Token di autenticazione generato con `rebase cloud tokens create`. Se specificato, tutti i comandi `rebase cloud` utilizzano questo token anziché la sessione creata da `rebase cloud login`, evitando scritture sulla configurazione locale. <span class="since-badge" data-since="0.26">Da 0.26</span> In una directory collegata da `rebase cloud init --claim`, viene messo da parte a favore del token proprio di quel progetto quando non possiede alcuno scope sul progetto. È la procedura raccomandata per l'uso di `rebase cloud` in ambienti CI — consultare [CI and agents](/docs/deployment/cloud/#ci-and-agents). Il [server MCP](/docs/ai/mcp/) lo passa alla CLI che i suoi tool cloud avviano, e non lo invia mai all'app: per quello imposta `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | Impostata a `1`, visualizza il dettaglio esteso della richiesta e gli stack trace interni anziché il solo messaggio sintetico. Particolarmente utile per analizzare comandi `rebase cloud` non andati a buon fine. | — |
| `REBASE_ATLAS_DEV_URL` | Database vuoto sul quale `rebase db push`, `db generate` e `db migrate` effettuano il calcolo delle modifiche, in sostituzione di `<db>_dev_diff` creato contestualmente a `DATABASE_URL`. Rebase non effettua operazioni di creazione o cancellazione sul database qui indicato, e blocca l'esecuzione se il valore coincide con `DATABASE_URL`. Con il database di sviluppo gestito, la CLI assegna automaticamente un'istanza volatile in-memory basata su PGlite. Da configurare laddove non si disponga del privilegio `CREATE DATABASE`. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | Impedisce a `rebase dev` di istanziare o configurare automaticamente un database locale, delegandone la gestione all'utente. Corrisponde al flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fissa la porta per il server di sviluppo frontend, altrimenti calcolata dinamicamente da `rebase dev` in base al percorso della cartella del progetto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo massimo in millisecondi che `rebase dev` attende prima di segnalare la mancata inizializzazione del backend. Il valore `0` disabilita il timeout. | `30000` |
| `DATABASE_PASSWORD` | Password inclusa nella stringa di connessione generata da `rebase dev --docker` a partire dal file `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Standard open per il rispetto della privacy nei tool di sviluppo. Qualsiasi valore diverso da `0` disabilita completamente la trasmissione di dati telemetrici da parte della CLI. | — |
| `REBASE_TELEMETRY_DISABLED` | Configurazione equivalente, mirata specificamente all'ecosistema Rebase. Non richiede la creazione di file, risultando ideale per ambienti CI o immagini container. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint personalizzato per l'invio dei dati telemetrici a un collettore self-hosted. | — |

## Gestione dei segreti in sviluppo

`JWT_SECRET` è obbligatoria in produzione. Essa e `REBASE_SERVICE_KEY` vengono
create automaticamente al di fuori della produzione, permettendo di iniziare senza configurazioni manuali.

Tali valori generati sono memorizzati localmente nel file `.rebase-dev-secrets.json`, affiancato a
`.rebase-dev-port` e `.rebase-dev-url` e analogamente escluso dal controllo di versione tramite gitignore. Nelle versioni precedenti
questi parametri venivano ricreati a ogni avvio, provocando l'interruzione della sessione
e la perdita di validità di eventuali chiavi API appena generate.

- Definire manualmente una o entrambe le variabili farà prevalere i valori immessi, evitando letture o scritture nella cache locale.
- La posizione di questo file può essere personalizzata specificando un percorso in `REBASE_DEV_SECRETS_FILE` — si tratta
  dell'unico parametro di questa categoria destinato a una modifica deliberata.
- Rimuovendo il file si forza la rotazione di entrambi i segreti, che saranno riscritti al boot successivo.
- Se il file non può essere creato o aggiornato (ad esempio in container con filesystem di sola lettura), il sistema completerà
  comunque l'inizializzazione adottando chiavi volatili in memoria, conformemente al comportamento storico.

La cache locale dei segreti è del tutto inattiva in produzione o in presenza di test runner. In produzione non viene generato nulla: un avvio
senza `JWT_SECRET` viene interrotto, restituendo il nome della variabile mancante, e questo comportamento resta invariato:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Oggetto di configurazione del backend

Il parametro `RebaseBackendConfig` fornito alla funzione `initializeRebaseBackend()` consente la configurazione a livello di codice:

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
omettendo `app`, `server` e `basePath` e aggiungendo il parametro obbligatorio `provision`, consentono di assemblare un
backend disaccoppiato che non espone endpoint finché non viene montato: `createRebaseBackend`. Consultare
[Custom Server Integration](/docs/backend/custom-server/).

### Modifica di `basePath`

L'opzione `basePath` modifica la radice di tutti gli endpoint API del server; di conseguenza, il client deve riflettere
la medesima impostazione per evitare errori 404 dovuti a chiamate verso `/api/...`:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Il pannello di amministrazione eredita questa configurazione dal client fornito, senza necessità
di interventi manuali. Se si costruiscono gli URL delle richieste manualmente, utilizzare l'helper del client
anziché inserire il percorso `/api` come stringa fissa:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Risoluzione dei problemi

### Errore di permessi non sufficienti nell'editor SQL (`permission denied for table <name>`)

* **Sintomi:** Le query personalizzate eseguite all'interno dell'editor SQL di Rebase Studio falliscono con il messaggio `cause: error: permission denied for table <name>`, sebbene la vista CMS a griglia carichi regolarmente le righe della tabella.
* **Causa:** Come comportamento predefinito, Rebase applica le query dell'editor SQL cambiando temporaneamente il ruolo nel database affinché corrisponda a quello dell'utente connesso (es. invocando `SET LOCAL ROLE "admin"`). Nel caso in cui si utilizzi un sistema di autenticazione applicativo i cui ruoli non corrispondono a ruoli effettivi di PostgreSQL, questa transizione non va a buon fine o il ruolo non possiede i privilegi necessari. La vista tabellare del CMS opera invece tramite l'utente proprietario della connessione predefinita, bypassando questo passaggio.
* **Soluzione:** Impostare `DISABLE_DB_ROLE_SWITCHING=true` all'interno del file `.env` del backend. Questa impostazione impone l'esecuzione delle query dell'editor SQL mantenendo l'identità e i privilegi del proprietario della connessione (solitamente un superuser o owner del database). L'editor SQL mostrerà un'indicazione esplicita sopra i risultati specificando che la lettura è avvenuta tramite l'utente proprietario della connessione e disattiverà il selettore del ruolo.

### Impossibile recuperare lo schema nell'editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomi:** L'interfaccia di Studio non carica l'albero della struttura del database, oppure l'editor SQL genera l'errore: `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** Rebase necessita di privilegi elevati per interrogare i cataloghi di sistema e completare comandi operativi. Se il parametro `adminConnectionString` non viene fornito al bootstrapper, o se il metodo `getAdmin()` viene sovrascritto in modo da restituire `undefined`, tali operazioni non possono essere eseguite.
* **Soluzione:** Assicurarsi che `adminConnectionString` sia correttamente valorizzata nell'inizializzazione del bootstrapper del backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Passaggi successivi

- **[Distribuzione](/docs/getting-started/deployment)** — Guida alla distribuzione in ambienti di produzione
- **[Panoramica del backend](/docs/backend)** — Riferimento completo alla configurazione del backend
