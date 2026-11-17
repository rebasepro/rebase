---
sourceHash: a730e31a86f730a7
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il relativo stato HTTP, il loro significato e come risolverli — oltre all'envelope della risposta, X-Request-ID e le regole per details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e include un
`code` stabile. Il codice è l'elemento su cui basare la logica condizionale (branching):
il messaggio è scritto per un essere umano e può essere riformulato, lo stato HTTP
è condiviso da una dozzina di problemi diversi, mentre il codice non è nessuna delle due cose.

## L'envelope

```json
{
  "error": {
    "message": "Schema drift: table \"posts\" does not exist.",
    "code": "SCHEMA_DRIFT",
    "details": { "dbCode": "42P01" },
    "requestId": "6f1b2f3e-8a0c-4d1b-9c3e-2a5b7c9d1e0f"
  }
}
```

- **`message`** — leggibile da persone. Per un `4xx` è il messaggio generato dal server; per
  un `5xx` è deliberatamente generico, poiché il testo sottostante potrebbe citare un
  host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori elencati di seguito. Stabile tra versioni minori.
- **`details`** — opzionale e mai garantito. Consulta le regole di seguito.
- **`requestId`** — presente ogni volta che la richiesta è passata attraverso il middleware
  del request-ID, ovvero per ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante
quando è un UUID, altrimenti uno nuovo generato dal sistema. Viene restituito nella
risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e
allegato alla riga di log del server per tale richiesta.

È la chiave di correlazione (join key). Includila in una segnalazione di bug e un
operatore potrà trovare l'unica riga di log che spiega il fallimento, contenente il
motivo che non è mai stato mostrato al client.

Inviare il proprio ID permette alla traccia di sopravvivere a un hop di rete: un
gateway o un job runner che inoltra l'header mantiene un unico ID attraverso tutti
i servizi che hanno gestito la richiesta. Un valore non valido viene ignorato
anziché rifiutato — non vale la pena far fallire una richiesta per un header
malformato inviato da un chiamante — quindi non dare per scontato che l'ID inviato
sia quello ottenuto. Leggi l'header della risposta.

### Cosa contiene `details`

`details` ha uno scopo diagnostico, non contrattuale. È regolato da tre regole:

1. **Qualsiasi elemento impostato esplicitamente da una route viene sempre restituito.**
   Si tratta degli errori commessi dal chiamante descritti con precisione: quale campo
   del filtro era sconosciuto, quale relazione non è scrivibile, quale valore non
   rientrava nel tipo previsto.
2. **Le informazioni diagnostiche del database vengono rimosse in produzione.** Quando
   l'errore proviene da Postgres, `details.dbCode` — il SQLSTATE — è sempre presente:
   indica la classe del problema e non rivela nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   poiché Postgres inserisce al loro interno i contenuti delle righe. `23505` restituisce
   `Key (email)=(a@b.c) already exists.`, il che risponde a "questa persona è registrata?"
   per qualsiasi indirizzo si provi a verificare.
3. **Non basare mai la logica condizionale su `details`.** Basati su `code`. Il contenuto di
   `details` è semplicemente ciò che risultava utile a una persona in quello specifico punto
   del codice, ed è soggetto a modifiche.

## Come interpretare uno status

| Status | Cosa indica riguardo alla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticato, o credenziale scaduta. Effettua l'accesso o il refresh. |
| `403` | Autenticato, ma non autorizzato. Riprovare con la stessa identità non servirà. |
| `404` | Route, tabella o riga inesistente — oppure una riga nascosta dalla row-level security. |
| `409` | Un conflitto con lo stato esistente: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il body è troppo grande, il media type è errato o la richiesta è semanticamente rifiutata. |
| `429` | Limite di richieste superato (rate limited). Rallenta; il messaggio indica per quanto tempo. |
| `500` | L'errore è del server o del database, non del chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può gestirla — una funzionalità disabilitata o non configurata. |
| `502` `503` `504` | Una dipendenza non è raggiungibile, non è configurata o è troppo lenta. |

## Autenticazione e account

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa la verifica MFA, poi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nessuna — lo stato desiderato è già valido. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | L'account in fase di modifica, reset o eliminazione possiede un ruolo o uno scope che il chiamante non ha. `details.beyond` li elenca. | Chiedi a qualcuno che li possiede di effettuare la modifica. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sessione ospite ha tentato di approvare un accesso da dispositivo. Un ospite non ha un account da associare a un dispositivo. | Accedi con un account, poi approva l'accesso. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di elencare, creare, modificare o revocare chiavi API, del proprio tipo o personali. | Gestisci le chiavi come utente con `keys:write`, o tramite la service key. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione Rebase a monte, quindi la credenziale del chiamante non è mai stata controllata. | Monta l'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Effettua prima l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è consentito solo per il primissimo utente, e questo non lo è. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi un nuovo captcha. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati inseriti per la stessa challenge MFA. | Avvia una nuova challenge. |
| `DEVICE_LOGIN_DECIDED` | 409 | L'accesso da dispositivo è già stato approvato o rifiutato. La decisione può essere presa una sola volta. | Avviane uno nuovo dal dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | L'accesso da dispositivo ha superato i dieci minuti di validità prima di essere deciso. | Avviane uno nuovo dal dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nessun accesso da dispositivo corrisponde a tale user code. Il polling del dispositivo risponde invece con i codici minuscoli di RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Confronta il codice con quello mostrato dal dispositivo. |
| `EMAIL_EXISTS` | 409 | Un account con quell'indirizzo esiste già — in fase di registrazione, di cambio indirizzo o seguendo un link di cambio indirizzo quando un altro account ha occupato l'indirizzo nel frattempo. | Accedi o avvia il recupero password; per un cambio di indirizzo, scegline un altro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP ma il server non ha un transport per le email. | Configura SMTP, o utilizza un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | Un accesso OAuth ha trovato un account con lo stesso indirizzo, ma il provider non ha verificato quell'indirizzo, quindi non è collegato. | Accedi con il metodo esistente, poi esegui `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma non è mai stato confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollegala prima da quell'account. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una richiesta ha inviato `x-rebase-impersonate` e il chiamante non può impersonare un altro utente. Solo la sessione di un amministratore autenticato può farlo, mai una chiave API o la service key. | Invia la richiesta con la sessione di un amministratore, o rimuovi l'header. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` è stato inviato vuoto. | Invia l'uid dell'utente da impersonare, o rimuovi l'header. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` non fa riferimento ad alcun utente attivo: nessun account ha quell'uid, oppure è disabilitato. | Verifica l'uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | L'autenticazione di questo backend non supporta l'impersonificazione perché il suo `AuthAdapter` è sprovvisto di `resolveUser`. | Implementa `resolveUser` nell'adapter, o rimuovi l'header. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` è stato inviato a una route che non supporta l'impersonificazione. Solo l'API dati e le funzioni personalizzate la supportano; il socket realtime supporta `impersonate` su `AUTHENTICATE`. | Invia la richiesta senza l'header. |
| `SIMULATION_FORBIDDEN` | 403 | Una richiesta ha inviato un header `x-rebase-simulate-*` (il simulatore RLS), o ha interrogato `/api/admin/rls-simulator`, e il chiamante non è autorizzato a simulare gli accessi. Solo la sessione di un amministratore autenticato può farlo, mai una chiave API o la service key. | Invia la richiesta con la sessione di un amministratore, o ometti gli header. |
| `SIMULATION_INVALID` | 400 | La simulazione è malformata: un header è stato inviato vuoto, `x-rebase-simulate-api-key-id` è stato combinato con un ruolo o user id, oppure la simulazione è stata combinata con `x-rebase-impersonate`. | Specifica un solo ruolo (facoltativamente con un uid), un solo user id, o un solo ID chiave API. |
| `SIMULATION_READ_ONLY` | 403 | Una scrittura, eliminazione, operazione `_batch`, ripristino della cronologia (history revert) o una funzione personalizzata invocata con qualsiasi verbo diverso da `GET`/`HEAD`/`OPTIONS` conteneva un header `x-rebase-simulate-*`. L'accesso simulato è di sola lettura: la scrittura verrebbe eseguita con l'identità simulata e non come amministratore. Le letture, incluse `POST …/query` e `…/count`, vengono comunque eseguite. | Interrompi la simulazione per apportare modifiche. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulazione non fa riferimento ad alcun utente attivo (uno user id inviato senza ruolo) o ad alcuna chiave API attiva. | Verifica l'ID, oppure invia un ruolo con l'uid per simulare un uid sprovvisto di account. |
| `SIMULATION_UNAVAILABLE` | 501 | Questo backend non può simulare l'accesso: il suo `AuthAdapter` non ha `resolveUser` per confermare un amministratore, o è stata indicata una chiave su un backend privo di chiavi API. | Implementa `resolveUser`, o ometti gli header. |
| `SIMULATION_UNSUPPORTED` | 400 | Un header `x-rebase-simulate-*` è stato inviato a una route che non supporta l'accesso simulato. Solo l'API dati e le funzioni personalizzate li supportano. | Invia la richiesta senza gli header. |
| `GUEST_REFERENCED` | 409 | Non è stato possibile eliminare un guest poiché una riga del progetto lo richiede tramite una foreign key con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo segnala per ciascun guest in `skipped` e prosegue. | Elimina la riga, oppure mantieni il guest. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato incompatibile con questa operazione. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La challenge MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 400 / 401 | Il codice OTP o MFA è errato: 400 per l'accesso tramite codice email (`/auth/otp/verify`), 401 per la registrazione o la challenge MFA. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — deliberatamente non specificato. | Riprova, o reimposta la password. |
| `INVALID_PLATFORM_TOKEN` | 401 | Un token di piattaforma `rpt_` è stato rifiutato: firma non valida, audience errata, scaduto o durata superiore al limite massimo. Il messaggio specifica il motivo. | Fai generare un nuovo token dalla piattaforma — su Rebase Cloud, esegui nuovamente il comando. |
| `INVALID_SCOPES` | 400 | È stato richiesto uno scope non valido per una chiave: malformato, sconosciuto o con un target non supportato dallo scope. `details.problems` ne indica i dettagli; `details.validScopes` elenca gli scope consentiti per una chiave. Esclude `keys:read` e `keys:write`, che nessuna chiave può possedere. | Usa un nome presente nell'elenco. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token di verifica, reset, magic link o cambio indirizzo è malformato, sconosciuto, già utilizzato o scaduto (400). Una credenziale del provider OAuth o un refresh token non verificabile restituisce 401. | Richiedi un nuovo link, o effettua nuovamente l'accesso. |
| `INVALID_USER_CODE` | 400 | Ciò che è stato inviato come codice di accesso dispositivo non è valido: deve essere di otto lettere, come `BCDF-GHJK`. | Inserisci il codice mostrato dal dispositivo. |
| `INVALID_ROLE` | 400 | Il nome del ruolo che si sta scrivendo non è una stringa, è vuoto o contiene `,` `{` `}` `"` `\` o caratteri di controllo. Tali caratteri verrebbero interpretati come ruoli distinti: un ruolo risiede in un `text[]` di Postgres e nella lista separata da virgole analizzata dalle policy RLS, quindi `"support,admin"` verrebbe letto come `admin`. `details.problems` elenca ciascun problema. | Rinomina il ruolo. Qualsiasi altro nome è accettato. |
| `KEY_MANAGEMENT_SCOPE` | 400 | A una chiave sono stati richiesti `keys:read` o `keys:write`. Nessuna chiave può gestire chiavi. `details.scopes` li elenca. | Escludili dalla richiesta. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titolare di `keys:write` ha tentato di modificare o revocare una service key che possiede ruoli o scope che il chiamante non ha. Solo un admin può gestire qualsiasi chiave. `details.roles` e `details.scopes` elencano ciò che la chiave possiede in più rispetto al chiamante. | Fai modificare la chiave a un admin o a qualcuno che possiede tali permessi. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto privo di amministratori. | Promuovi prima un altro utente. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è parziale. `details` contiene un token temporaneo limitato alla challenge MFA — non è una sessione. | Crea una challenge e rispondi; la risposta alla challenge rilascerà la sessione. |
| `NO_SESSION` | 401 | Nessun cookie di sessione o refresh token presentato. Normale al primo caricamento pagina. | Effettua l'accesso. |
| `NOT_ANONYMOUS` | 400 | Una route di upgrade da utente anonimo è stata chiamata da un account reale, o `DELETE /api/admin/guests/:uid` ne ha indicato uno. | Nulla da aggiornare. Per eliminare un account, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o restituito un errore. | Riprova il flusso; il messaggio riporta la motivazione del provider. |
| `PERSONAL_KEYS_DISABLED` | 403 | Le chiavi API personali sono disabilitate su questo backend. | Imposta `personalKeys: true` nelle opzioni `auth` della tabella auth (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La service key o una sessione ospite ha tentato di usare le route per le chiavi personali. Nessuna delle due ha un account da associare alla chiave. | Accedi con un account, oppure crea una service key sotto `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token di piattaforma `rpt_` ha raggiunto un server che non li accetta: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` non sono impostati. | La piattaforma di hosting dell'app imposta entrambi al momento del deploy; riesegui il deploy o accedi all'app con un altro metodo. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta; il messaggio indica per quanto tempo attendere. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione del redirect non è nella allow-list. | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | La registrazione autonoma è disabilitata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXCEEDS_CALLER` | 403 | I ruoli assegnati includono uno scope, o `admin`, che il chiamante non possiede. `details.beyond` li specifica. | Fai assegnare il ruolo da qualcuno che possiede tali permessi. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una service key è stato assegnato un ruolo RLS non posseduto dal suo creatore. Solo un admin può assegnare qualsiasi ruolo. `details.roles` li specifica. | Rimuovi il ruolo, o fai creare la chiave a un admin. |
| `ROLE_EXISTS` | 409 | Questo nome per il ruolo è già in uso. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli del chiamante — su una route di amministrazione o su una richiesta dati su un backend con `config.auth`. L'accesso viene bloccato (fail-closed) piuttosto che fidarsi dei ruoli nel token. Un token il cui uid non corrisponde ad alcun account, compreso un uid incompatibile con la tabella utenti, restituisce 401, non questo errore. Un database non raggiungibile restituisce `DATABASE_UNAVAILABLE`. | Riprova; controlla il database. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | È stato richiesto uno scope per una chiave non posseduto dal creatore della stessa. Una chiave non ha mai più permessi dell'account che la crea. `details.scopes` li specifica. | Rimuovili, o fai creare la chiave da chi li possiede. |
| `SCOPE_MISSING` | 403 | La credenziale non include lo scope richiesto da questa route, tabella, storage source o funzione. `details.requiredScope` lo specifica, target incluso. | Per un utente, usa un ruolo che dichiari lo scope. Per una chiave, usa una chiave che lo possieda. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una route protetta con `requireScope` fa riferimento a uno scope applicativo non dichiarato da questo backend, quindi non posseduto da nessuno, nemmeno da un amministratore. Un nome che non è affatto uno scope, o uno scope integrato scritto male come `data:raed`, viene intercettato prima: `requireScope` lancia un errore durante la registrazione della route. | Dichiara lo scope sotto `auth.scopes` nella tabella auth, o correggi il nome. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | La sessione è stata terminata altrove, tutte le sessioni sono state revocate o l'account è stato eliminato. Qualsiasi endpoint che accetta una sessione rifiuterà un token di accesso revocato: API dati, storage, funzioni personalizzate e route admin. Il socket realtime rifiuterà il suo `AUTHENTICATE` con un frame `AUTH_ERROR` con lo stesso codice. L'SDK tenta il refresh, il refresh viene rifiutato e viene eseguito il logout. | Effettua nuovamente l'accesso. |
| `ACCOUNT_DISABLED` | 401/403 | Un amministratore ha disabilitato l'account: login (403), refresh e tutti i token posseduti (401) vengono rifiutati in tutti gli endpoint che accettano una sessione. Il socket realtime rifiuterà il suo `AUTHENTICATE` con un frame `AUTH_ERROR` con lo stesso codice. | Contatta un amministratore. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` è attivo e l'indirizzo non è ancora verificato. Restituito solo a fronte di una password corretta; viene inviato un nuovo link via email. | Segui il link ricevuto via email. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: l'account contiene una password o un'identità non confermata, e la richiesta non ne conferma nessuna. Il token non viene consumato. | Invia `password` per mantenerla, o `removeUnproven: true` per verificare senza di essa. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | È stata richiesta una mail di verifica per un indirizzo non raggiungibile — un guest, o il placeholder di X (400) — o un account ha chiesto di passare a un indirizzo simile (409, `POST /auth/change-email`). | Imposta prima un indirizzo reale. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` ha specificato l'indirizzo attuale dell'account. | Nessuna modifica da apportare. |
| `ANONYMOUS_USER` | 403 | Un guest ha chiesto di modificare la propria email; un guest non ha un'email propria. | Convertilo prima in un account (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Sono stati richiesti codici di recupero per un account sprovvisto di un secondo fattore verificato. | Registra prima un fattore. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` ha lanciato un'eccezione. Il messaggio è quello dell'hook; un hook che specifica uno stato 4xx risponde con esso. | Consulta il messaggio. |
| `INVALID_JSON` | 400 | Il corpo della richiesta non è un JSON valido. | Invia un corpo JSON valido. |
| `SELF_DISABLE` | 400 | Un amministratore ha tentato di disabilitare il proprio account. | Chiedi a un altro amministratore. |
| `NOT_SUPPORTED` | 501 | L'auth repository di questo backend non supporta l'operazione richiesta (disabilitare account, cambiare indirizzo). | Riavvia il server per aggiungere la colonna, o usa un repository che la supporti. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Il target di uno scope fa riferimento a una tabella, storage source o funzione non gestita da questo backend. `details` elenca quelle supportate. | Correggi il target. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, codice email o reset password ha verificato l'indirizzo di un account non verificato, e l'account contiene un'identità di accesso il cui provider non ha mai verificato quell'indirizzo. Il repository di autenticazione non può rimuoverla (manca `unlinkUserIdentity`), quindi la verifica viene respinta per non lasciare accessibile un account verificato in questo modo. | Implementa `unlinkUserIdentity` nel repository di autenticazione personalizzato, o fai verificare l'account a un admin. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un admin, quindi questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | È stato riutilizzato un token monouso, o un refresh token già ruotato da oltre `refreshTokenReuseIntervalSeconds` secondi. | Richiedine uno nuovo, o effettua nuovamente l'accesso. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con questo ID. | Verifica l'ID. |
| `WEAK_PASSWORD` | 400 | La password non rispetta la [policy delle password](/docs/backend/auth-endpoints/#password-policy) (di default almeno 8 caratteri con una lettera maiuscola, una minuscola e una cifra) — in fase di registrazione, reset o modifica, e per la password scelta da un amministratore: `POST /api/admin/users`, creazione nella tabella auth tramite API dati, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Scegli una password più sicura. Un amministratore che importa account può inviare `skipPasswordPolicy: true` in creazione. |

## Dati, query e scritture

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | È stata richiesta un'aggregazione diversa da `count()` senza `groupBy` su una tabella modificata da un hook `afterRead` (globale, di tabella o `.transform()` di colonna). Un'aggregazione legge i valori archiviati e non esegue mai l'hook, quindi una somma, un minimo, un massimo, un conteggio di campi o un raggruppamento leggerebbe dati che l'hook nasconde. | Usa `count()` senza `groupBy`, oppure leggi le righe, che passano attraverso l'hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non supporta il calcolo dell'aggregazione richiesta. | Usa un driver che la supporti, o calcolala lato client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), dove un branch *è* il database genitore e nulla verrebbe isolato. Il rifiuto è lo stesso mostrato da `rebase db branch`. | Punta `DATABASE_URL` su un'istanza Postgres indipendente (`rebase dev --docker` ne avvia una) e crea i branch lì. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni del limite consentito per singolo batch (1000 di default). Un batch corrisponde a una transazione e mantiene i blocchi per tutta la sua durata. | Invia i dati suddivisi in più parti; il messaggio indica il limite e il conteggio attuale. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non supporta scritture atomiche su più tabelle, e un ciclo di scritture singole non sarebbe né atomico né eseguito in un unico round-trip. | Invia le scritture come richieste separate o come chiamate `/bulk` distinte per tabella. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite configurato per il numero di elementi. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa tabella o driver non supporta scritture di tipo bulk. | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook di tabella ha rifiutato la scrittura. Un'eccezione lanciata (`throw`) da `beforeSave`/`beforeDelete`/`after*` è un 400 con il messaggio dell'autore; un `beforeDelete` che restituisce `false` è un 403. `details.stage` specifica l'hook, `details.path` la tabella. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CALLBACK_RECURSION` | 500 | Le scritture avviate dagli hook hanno superato i 16 livelli di annidamento: la scrittura `context.data` di un hook esegue nuovamente gli hook di quella tabella e nulla nella catena interrompe il ciclo — in genere un `afterSave` che aggiorna incondizionatamente la propria riga. L'intera scrittura è stata annullata tramite rollback. Il messaggio specifica l'hook e la tabella; `details.chain` elenca ciascun passaggio hook → scrittura. | Rendi condizionale la scrittura nell'hook: agisci solo su `status === "new"`, oppure saltala se `values` contiene già i dati da scrivere. |
| `TABLE_READ_ONLY` | 405 | È stata tentata una scrittura su una vista (`defineView`). Le viste sono in sola lettura. Precedentemente `COLLECTION_READ_ONLY`. | Scrivi sulle tabelle sottostanti lette dalla vista. Consulta [Viste](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | La tabella è dichiarata, ma il database non la protegge: la row-level security è disabilitata, nessuna delle policy dichiarate è presente, o manca una policy restrittiva dichiarata. (Una policy permissiva mancante viene comunque servita, con un avviso di boot che la segnala). Ciò accade quando il server non esegue il provisioning delle tabelle (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e il server trattiene la tabella invece di servire tutte le righe a tutti i chiamanti. La stessa regola vale per le tabelle di giunzione many-to-many: se falliscono, le tabelle con relazioni che le usano vengono trattenute e il messaggio indica la giunzione; lo stesso vale per una tabella il cui `via` passa attraverso una tabella trattenuta. Anche una lettura di relazione o un filtro che attraversa una tabella trattenuta restituisce questo codice. Le altre tabelle vengono servite normalmente. Il log di boot elenca le istruzioni SQL necessarie a proteggerla. | Applica le istruzioni indicate nel log di boot (`rebase db push` lo fa automaticamente), poi riavvia. Oppure, se l'app gestisce autonomamente l'accesso a quella tabella, dichiara `rlsRequired: false` su di essa (o `database({ rls: { required: false } })`) e riavvia. |
| `SQL_NOT_ALLOWED` | 400 | L'SQL eseguito come chiamante (`getSql(c)`, `withAuth(user).sql`) non era una singola istruzione `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, oppure ha invocato `set_config` o fatto riferimento a `pg_settings`. L'identità del chiamante risiede nelle impostazioni di sessione, quindi qualsiasi istruzione che potrebbe modificarle viene rifiutata. | Mantieni il testo della query semplice, in una singola istruzione, inserendo ogni valore in `params`. Consulta [Funzioni personalizzate](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore definisce già il punto di inizio della pagina, quindi applicare un offset aggiuntivo salterebbe silenziosamente quel numero di righe dopo il cursore — creando una lacuna non visibile nella risposta. | Usa l'uno o l'altro, non entrambi. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una ricerca testuale o vettoriale. Entrambe associano un punteggio (score) per riga, quindi due righe non saranno mai identiche e `DISTINCT` non raggrupperebbe nulla — sembrerebbe funzionare ma senza modificare il risultato. | Rimuovi uno dei due parametri. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` è ordinata in base a una colonna non inclusa tra quelle restituite. Una query `SELECT DISTINCT` può essere ordinata solo in base a colonne presenti nella select list, altrimenti le righe raggruppate non avrebbero un ordine definito. `details.fields` specifica i campi coinvolti. | Aggiungi questi campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Impossibile raggiungere il database: connessione rifiutata o interrotta, risoluzione host fallita, server in fase di avvio/arresto, o database chiuso a nuove connessioni (`ALLOW_CONNECTIONS false`, stato lasciato da un `rebase db branch create --force` interrotto a metà; il log del server indica il database, e `rebase db branch list` lo riapre). Restituito da tutti gli endpoint, inclusi login, route admin e socket realtime (frame `ERROR`). Inviato con `Retry-After: 5`. | Riprova; l'SDK lo fa in automatico. Verifica che il database sia attivo e raggiungibile dal server. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | Il server del database ha rifiutato una nuova connessione perché ha esaurito quelle disponibili (`53300` troppi client, `53400` superato il limite di connessioni di un ruolo o database). Tutte le istanze del server condividono il `max_connections` del DB: è l'errore tipico di più istanze con pool ampi senza un connection pooler intermedio. È un problema di carico, non un guasto; inviato con `Retry-After: 2`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa in automatico. Abbassa `DB_POOL_MAX` (o limitalo con `REBASE_DB_POOL_MAX`) sulle istanze, inserisci un pooler a monte del database (`DATABASE_POOLED`), o aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | L'apertura di una nuova connessione al database ha richiesto più tempo di `DB_POOL_CONNECT_TIMEOUT`: il database risponde lentamente alle connessioni o ha un'elevata latenza di rete. Inviato con `Retry-After`. | Riprova; l'SDK lo fa in automatico. Verifica il carico del database e la latenza di rete. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): una policy di row-level security ha negato l'accesso per questo ruolo, o manca un `GRANT`. | Consulta la sezione [Risoluzione dei problemi](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Tutte le connessioni del pool sono rimaste occupate per l'intera durata di `DB_POOL_CONNECT_TIMEOUT`, quindi la richiesta non ha mai raggiunto il database. È un problema di carico, non un guasto; inviato con `Retry-After`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa in automatico. Aumenta `DB_POOL_MAX`, oppure individua query lente o transazioni lunghe che trattengono le connessioni. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` di aggregazione o `groupBy` specifica un campo che i ruoli del chiamante non possono leggere (`access.read`), un path annidato o un ordinamento di aggregazione specifica una relazione non leggibile — oppure un'operazione su campo (`$inc`, `$push`, …) punta a uno di essi, dove un vincolo rifiutato rivelerebbe il valore archiviato. Un campo escluso dalla risposta non deve poter essere interrogato da alcuna query, altrimenti il valore sarebbe deducibile un predicato alla volta. Un filtro attraverso una relazione (`author.salary`) e un ordinamento di aggregazione su un campo di una relazione (`max(staff.salary)`) vengono valutati in base alle regole della destinazione. `details.violations` elenca ogni campo non valido. Il driver applica la stessa regola alle letture in-process eseguite per conto di un chiamante (`context.data` sotto lo scope del chiamante) e alle ricerche vettoriali, inclusioni o controlli di unicità. Una colonna `.private()` risponde esattamente come se non esistesse: un filtro, `orderBy`, `fields`, `include`, `select` di aggregazione, `groupBy` o `vector_search` che ne specifica una riceve esattamente la stessa risposta di un nome errato (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), e nessun messaggio relativo a campi sconosciuti la elencherà. | Rimuovi il campo dalla query, o acquisisci il ruolo necessario. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | Il corpo della richiesta tenta di valorizzare un campo che i ruoli del chiamante non possono scrivere (`access.write`). L'operazione viene rifiutata anziché ignorata: una scrittura che omettesse il campo riporterebbe successo per una modifica mai avvenuta. Lo stesso codice rifiuta una scrittura tramite un'entità genitore che tenta di impostare una relazione non modificabile dal chiamante, e un aggiornamento che assegna un valore a un campo `softDelete` — solo l'eliminazione può impostarlo. Il socket realtime restituisce 403 con questo codice per una scrittura su un path annidato la cui tabella genitore, relazione o tabella di destinazione non sia supportata lì, anziché inoltrarla non verificata al driver. `details.violations` elenca i campi interessati. | Rimuovi il campo, o acquisisci il ruolo. Un campo non scrivibile da nessuno risponde invece con `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Un aggiornamento o un'eliminazione con filtri è stata inviata alla tabella auth tramite HTTP, le cui scritture devono essere convalidate utente per utente prima dell'esecuzione. | Leggi prima gli utenti, poi esegui `updateMany`/`deleteMany` filtrando per ID. |
| `FILTER_REQUIRED` | 400 | Una scrittura condizionale (un update o delete con `where`/`logical`, da SDK o route bulk) non contiene condizioni, quindi modificherebbe ogni singola riga. Viene rifiutata prima di eseguire qualsiasi operazione. | Aggiungi una condizione. Se intendi modificare tutte le righe intenzionalmente, usa una condizione sempre vera per ogni riga. |
| `HISTORY_UNAVAILABLE` | 503 | Una scrittura su una tabella con `history: true` è stata rifiutata poiché non è stato possibile registrare la voce nello storico: il database è privo della tabella `rebase.entity_history` o, per `openRebase` e `rebase console`, della funzione `rebase.record_history`. Nessun backend con cronologia attiva è stato avviato su questo database. Non è stato eseguito nulla, hook inclusi; le letture non sono influenzate. Sollevato da `openRebase` e restituito da un backend creato con `provision: false`. | Avvia il backend almeno una volta con la cronologia abilitata e `provision: true` (`rebase dev` lo fa automaticamente), poi riprova. |
| `HISTORY_UNSERVABLE` | 501 | Il data driver della tabella non può applicare le regole di lettura e gli hook `afterRead` sulle righe archiviate (`DataDriver.serveStoredRows`), e la cronologia non viene mai servita senza maschera. Il driver Postgres integrato lo supporta. | Implementa `serveStoredRows` nel driver personalizzato. Consulta [Cronologia](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine dell'operazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata riutilizzata per una richiesta differente: metodo, path, query string o body non corrispondono. | Usa una nuova chiave, o invia nuovamente la richiesta originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indica una funzione che non è un'aggregazione valida (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usane una tra quelle supportate; il messaggio le elenca. |
| `INVALID_AGGREGATE_GROUP` | 400 | La trasformazione in `groupBy` è sconosciuta o incompatibile con la colonna: `year`/`month`/`day` su una colonna non di tipo data, `unnest` su un campo che non è un array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest` su una colonna del tipo appropriato. |
| `INVALID_AGGREGATE_SELECT` | 400 | Un parametro in `?select=` non rispetta il formato `fn(field)`; a una funzione diversa da `count()` o `fingerprint()` non è stato passato alcun campo; `percentile` non specifica una frazione compresa tra 0 e 1; oppure `fingerprint()` è stata richiesta su una vista standard, che non memorizza fisicamente le righe. | Scrivi `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso di `offset`, `page` o `orderBy` su un'aggregazione senza `groupBy`, oppure uso di un cursore su qualsiasi aggregazione. Un'aggregazione non raggruppata restituisce una sola riga, e un gruppo non è una riga dopo la quale un cursore possa riprendere la paginazione. | Aggiungi `groupBy` o rimuovi i parametri; pagina i gruppi usando `offset` o `page`. Consulta [Aggregazioni](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Un'operazione all'interno di `/_batch` è priva di `op`, `table`, `values` o `id`, fa riferimento a una tabella non gestita da questo backend o riutilizza un identificatore `ref` già usato. | Consulta il messaggio; indica l'indice dell'operazione errata. |
| `INVALID_BATCH_REF` | 400 | Una voce `{ "$ref": "<name>.<field>" }` non corrisponde ad alcuna operazione precedente, fa riferimento a un'operazione successiva o richiede un campo non presente nella riga referenziata. Si possono referenziare solo operazioni precedenti. | Assegna il `ref` all'operazione desiderata *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | Il corpo della richiesta bulk non rispetta il formato previsto. | Invia l'array richiesto dalla route: `{ "rows": [...] }` per `POST /bulk`, `{ "updates": [{ "id", "data" }] }` per `PATCH /bulk`, `{ "ids": [...] }` per `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regola di conflitto per l'upsert (ignora duplicati, o sovrascrivi solo su un `where`) è stata inviata senza `upsert: true`, oppure entrambe le regole sono state fornite insieme. | Invia `upsert: true` e una sola delle due opzioni. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` dell'upsert indica colonne senza vincolo di unicità, è stato inviato senza `upsert: true` oppure è stato usato in una creazione annidata, dove una riga corrispondente verrebbe spostata sotto un nuovo genitore. In caso contrario Postgres restituirebbe l'errore 42P10 all'interno di una transazione che ha già apportato modifiche. Si applica anche a qualsiasi upsert sulla tabella auth, dove creazione e aggiornamento seguono logiche distinte. | Dichiara `.unique()` sulla colonna o crea un indice `unique`; il messaggio elenca i target validi. Sulla tabella utenti, invia una `POST` per creare e una `PATCH` per aggiornare. |
| `INVALID_COUNT` | 400 | `?count=` non è impostato su `exact` o `none`. L'errore viene segnalato invece di applicare il valore predefinito: un errore di battitura come `?count=nnone` finirebbe per eseguire il conteggio che si intendeva saltare. | Imposta `exact` (predefinito) o `none`. Consulta [Omettere il conteggio](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Il cursore `after` non può essere decodificato o contiene un ID non compatibile con le colonne chiave della tabella: è stato troncato, ricodificato o generato manualmente. Un cursore valido inviato con un `orderBy` diverso da quello originale genera `CURSOR_ORDER_MISMATCH`, anch'esso un 400. | Riutilizza inalterato il valore `meta.nextCursor` della pagina precedente, specificando lo stesso `orderBy` o nessuno. Consulta [Paginazione](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è impostato su `include` né su `only`. Viene restituito errore anziché ignorarlo: un refuso come `?deleted=true` che nascondesse le righe eliminate sembrerebbe funzionare ma risponderebbe all'esatto opposto di quanto richiesto. | Specifica `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è impostato su `true` o `false`. | Invia uno di questi valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Un operatore `$inc` / `$push` / `$pull` / `$merge` è stato utilizzato su un tipo di colonna non supportato, con un argomento non valido, specificando due operatori sullo stesso campo, con un errore di sintassi o durante un'operazione di creazione (dove non esiste un valore preesistente da modificare). | Consulta [Scrittura via REST](/docs/backend/writes/#field-operations); il messaggio indica il campo errato. |
| `INVALID_FILTERED_WRITE` | 400 | Una scrittura filtrata è stata indirizzata a un path attraverso una relazione (`posts/1/comments`) o senza specificare alcuna tabella. | Scrivi direttamente sulla tabella correlata applicando un filtro sul relativo campo di collegamento. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro fa riferimento a una colonna non presente nella tabella. | Verifica la correttezza del nome rispetto alla tabella. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato per questo tipo di colonna — ad esempio `like` su un numero o su una data. | Consulta [Esecuzione di query sui dati](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Il valore del filtro non è compatibile con il tipo della colonna con cui viene confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non presente nell'enum, un timestamp non valido, un numero fuori scala. `details.dbCode` contiene il codice SQLSTATE. | Invia un valore compatibile con il tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è impostato su `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "false" — un errore di battitura che provocasse un soft-delete al posto di un'eliminazione definitiva farebbe credere all'utente che il dato sia stato rimosso per sempre. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: l'elenco dei path non è valido o l'oggetto opzioni per relazione non rispetta il formato corretto. Un path annidato per più di tre livelli restituisce `INCLUDE_TOO_DEEP`, anch'esso un 400. Intercettato a livello applicativo prima di provocare un 500 dal driver. | Consulta il messaggio; indica il path errato. |
| `INVALID_INPUT` | 400 | La validazione del corpo della richiesta è fallita. | Consulta il messaggio. |
| `INVALID_LIMIT` | 400 | `?limit=` non è un numero intero compreso tra 1 e il massimo consentito (1000 di default); valori superiori vengono rifiutati anziché troncati. Una sottoscrizione realtime con un limite fuori intervallo riceve lo stesso codice all'interno di un frame `ERROR` WebSocket. | Riduci il limite e recupera il resto paginando i risultati. |
| `INVALID_LOGICAL_GROUP` | 400 | Un raggruppamento `?or=` / `?and=` / `?not=` è malformato o supera il livello massimo di annidamento consentito. | Consulta il messaggio; illustra le regole per appiattire la struttura. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un numero intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non corrisponde a `field`, `field:desc`, `field:desc:last`, o a un array JSON di `{ field, direction, nulls }` — oppure indica una direzione diversa da `asc`/`desc`, o un posizionamento dei valori NULL diverso da `first`/`last`. | Consulta il messaggio per visualizzare le sintassi consentite. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine sono indicizzate a partire da 1, pertanto `?page=0` è considerato un errore e non la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro di query è malformato. | Consulta il messaggio. |
| `INVALID_QUERY_BODY` | 400 | Il corpo di `POST …/query` include un valore non ammesso per l'URL: una lista per un parametro che l'URL prevede singolo (`fields`, `limit`, …), un oggetto per un filtro, o la duplicazione di un parametro già presente nell'URL — `POST …/query` riceve tutti i parametri dal body. | Scrivi ciascun valore come faresti nell'URL — una stringa, o una lista per un filtro ripetuto; `where`, `include`, `orderBy` e `vector` accettano JSON. Consulta [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia ad esempio `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non corrisponde a `cosine`, `l2` o `inner_product`. | Scegli una di queste tre opzioni. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un valore numerico. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia ad esempio `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una richiesta di aggiornamento tenta di modificare la chiave primaria della riga — nel corpo o tramite un hook `beforeSave`. Una riga non può cambiare chiave: qualsiasi operazione successiva (rilettura, `afterSave`, cronologia, realtime) fa riferimento alla chiave di partenza. La richiesta viene bloccata prima dell'esecuzione di qualsiasi hook, senza scrivere nulla, su ogni canale. `details.violations` indica il campo. | Crea una nuova riga con la nuova chiave ed elimina la precedente. Inviare la chiave già posseduta dalla riga è consentito. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata invocata senza il parametro `?select=`. | Aggiungine uno, ad esempio `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | È stato invocato `refresh()` su una tabella che non fa riferimento a una vista materializzata. | Esegui il refresh solo su viste definite con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | Il progetto non espone tabelle: nessuna tabella dichiarata in `backend/schema`, e nessuna nel database da cui fare introspezione. Quando le tabelle esistono ma la row-level security è disabilitata, il messaggio le elenca indicando il comando SQL per abilitarla, e `details.unprotectedTables` ne riporta i nomi. Precedentemente `NO_COLLECTIONS`. | Crea le tabelle — tramite migrazione, SQL o file `defineTable` associato a `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con quell'ID nella tabella — oppure la riga è nascosta al chiamante dalla row-level security. | Verifica l'ID, poi controlla le policy `rls` della tabella. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica un nome non presente tra le relazioni della tabella. Lo stesso codice restituisce **404** quando è un *percorso URL* annidato a indicare una relazione inesistente, es. `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuna — in quel caso l'URL non punta a nulla, costituendo una risorsa non trovata piuttosto che una richiesta malformata. | Controlla il nome della relazione — il messaggio elenca quelle disponibili. Una relazione inversa (back-reference) deve essere dichiarata sul genitore per essere navigabile. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Il campo indicato per l'ordinamento non è ordinabile. | Ordina in base a una colonna valida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` è stato combinato con `?offset=` — oppure `page` con `offset` all'interno di un metodo `find()`, operazione rifiutata preventivamente con lo stesso codice da SDK client, `rebase.data` in-process e client offline. Entrambi definiscono la stessa finestra di risultati; in precedenza `page` sovrascriveva silenziosamente `offset` senza che il chiamante se ne accorgesse. | Utilizza solo uno dei due parametri. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo della richiesta supera la dimensione massima configurata. | Riduci i dati inviati o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` ha tentato di eseguire una scrittura. Una lettura con ambito a livello di richiesta viene eseguita in una transazione `READ ONLY`, pertanto né l'hook né le funzioni da esso invocate possono scrivere. | Sposta la scrittura al di fuori dell'operazione di lettura: usa un background job, o `rebase.dataAsAdmin` all'interno di un cron job o di una funzione personalizzata. |
| `REFRESH_NOT_SUPPORTED` | 501 | La chiamata `POST /api/data/<slug>/refresh` ha raggiunto un data driver che non supporta le viste materializzate. | Nessuna vista da aggiornare su questo backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura contiene un payload di collegamento, ma il percorso non raggiunge la destinazione tramite una relazione `manyToMany` provvista di `pivot` — manca quindi una riga di giunzione su cui memorizzarlo. | Dichiara le colonne di `pivot` sulla relazione, o rimuovi il payload dalla scrittura. Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non può essere risolta rispetto allo schema registrato. L'operazione viene interrotta anziché ignorata: saltarla riporterebbe successo per una scrittura non avvenuta, o un risultato vuoto per righe effettivamente esistenti. | Esegui `rebase schema generate` se lo schema generato è più vecchio del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | Non è possibile scollegare la relazione da questo lato dell'associazione. | Esegui la scrittura dal lato proprietario della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile, oppure una creazione o aggiornamento fa riferimento a una relazione `via` a più livelli — solo le relazioni `via` a livello singolo supportano la scrittura. `details.fields` elenca le chiavi `via`. Nessuna modifica è stata applicata. | Scrivi direttamente sulle righe collegate dalla catena. Consulta [Relazioni](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione dichiara colonne di giunzione, ma questa sorgente dati non supporta la loro scrittura. | Il collegamento in sé funziona; solo il payload associato non è supportato. Verifica le capacità del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | La scrittura di una relazione non ha una chiave sorgente a cui associare il collegamento. | Salva prima la riga genitore. |
| `RESULT_TOO_LARGE` | — | Un'istruzione inviata tramite `EXECUTE_SQL` sul socket realtime — come `admin.executeSql` da un client o le letture del catalogo nel pannello admin — ha restituito più di 128 MB di righe, quindi nessun dato è stato inviato. Consegnato come frame `ERROR` WebSocket. Le esecuzioni avviate dalla console SQL non vengono bloccate: mostrano le prime righe. | Aggiungi un `LIMIT`, o seleziona meno colonne, leggendo i dati a blocchi. |
| `ROW_IN_TRASH` | 409 | La chiave di un'operazione di upsert corrisponde a una riga nel cestino (una riga eliminata con soft delete mantiene la propria chiave). L'upsert non sovrascrive righe eliminate, su qualsiasi interfaccia: parametri REST `?on_conflict=`, upsert via `/bulk` e `/_batch`, SDK e socket realtime. Nessun dato è stato scritto. | Ripristina prima la riga (con un update che reimposta a `null` il campo di soft delete), oppure eliminala definitivamente con `?hard=true` prima di rieseguire l'upsert. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabella o colonna prevista dal codice applicativo non esiste nel database. | Esegui `rebase db push` in sviluppo; riesegui il deploy su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | È stato combinato `startAfter` con `orderBy: "_score"`. La rilevanza viene calcolata dinamicamente per ogni query e non è memorizzata, quindi non può essere usata come chiave per un cursore. | Esegui la paginazione della rilevanza tramite `limit`/`offset`, oppure ordina per colonna. |
| `SQL_ERROR` | 400 | Il database ha rifiutato un'istruzione SQL manuale. Sul socket realtime tramite `EXECUTE_SQL` viene generato un frame `ERROR` con il messaggio del database. `POST /api/admin/sql/csv` restituisce l'errore prima dell'invio del file: errore di sintassi, tentativo di scrittura (il download è in sola lettura), più istruzioni concatenate, o ruolo non consentito per la connessione. | Correggi l'istruzione SQL. L'esportazione accetta solo un singolo comando `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un chiamante privo dei ruoli specificati in `view.roles` ha tentato di leggere o aggiornare una vista materializzata. Le viste materializzate non hanno row-level security: vengono servite interamente e solo ai ruoli autorizzati. | Effettua la lettura con uno dei ruoli previsti, o aggiungi il ruolo del chiamante a `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | La scrittura comporterebbe lo spostamento di una riga da un tenant all'altro. Una riga non può cambiare tenant. `details.violations` indica il campo. La stessa regola è applicata da un trigger nel database: un'istruzione SQL eseguita dal chiamante fallirà con l'errore Postgres `42501` e un messaggio che inizia con `TENANT_IMMUTABLE`. | Crea la riga nel nuovo tenant ed elimina quella precedente, oppure scrivi usando un ruolo presente in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura fa riferimento a un tenant a cui il chiamante non appartiene; l'operazione verrebbe respinta anche dal database. | Esegui la scrittura per il tenant di appartenenza, oppure autenticati con credenziali associate a quest'ultimo. |
| `TENANT_REQUIRED` | 400 | La tabella è legata a un tenant ma non è possibile risalire a quest'ultimo: la richiesta non ne indica alcuno, o il chiamante appartiene a più tenant contemporaneamente. | Invia esplicitamente il campo del tenant, o autenticati come utente appartenente a un singolo tenant. |
| `TRANSACTION_ABORTED` | 500 | Un'istruzione nella transazione di scrittura è fallita e un hook ha intercettato l'errore. Postgres aveva già interrotto la transazione, quindi la scrittura è stata annullata (rollback) e nessun dato è stato salvato. Solo una creazione, aggiornamento o eliminazione tramite `context.data` respinta dal DB viene annullata singolarmente e può essere intercettata in sicurezza. | Lascia che l'eccezione si propaghi, o fai le opportune verifiche prima di eseguire l'istruzione. Consulta [Semantica delle transazioni](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` indica un campo non presente nella tabella. | Verifica il nome; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o un `groupBy` fa riferimento a un campo non presente nella tabella. | Verifica il nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo non presente in questa tabella — o nella tabella target di una relazione — oppure una colonna `.private()`. | Verifica il nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro indica un operatore inesistente. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket realtime presenta un `type` non supportato dal server. Viene restituito un frame `ERROR` contenente il `requestId` della richiesta, consentendole di chiudersi invece di andare in timeout. | Verifica il `type` del frame; il messaggio indica il tipo ricevuto. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Il campo di ordinamento specificato non esiste nella tabella. | Verifica il nome; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | L'header `If-Match` fa riferimento a una versione della riga non più attuale: un'altra operazione l'ha modificata tra la lettura e questa scrittura. Nessun dato è stato salvato. | Rileggi la riga, riapplica le modifiche e invia la richiesta con il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo non presente nella tabella. | Verifica il nome; il messaggio elenca i campi validi. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | La ricerca vettoriale indica una colonna che non è configurata come `col.vector()` in questa tabella. | Il messaggio elenca le colonne vettoriali disponibili nella tabella. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il valore di `Content-Type` non è tra quelli supportati da questa route. | Invia il tipo indicato nella documentazione della route. |
| `UNSUPPORTED_OPTION` | — | Eccezione generata nel runtime (non risposta HTTP): a una scrittura eseguita tramite l'accessor in-process (`context.data` in un hook, `rebase.data` in una funzione o cron) sono stati passati i parametri `ifMatch` o `idempotencyKey`. Questo canale non dispone di controlli sulle precondizioni o store per l'idempotenza, quindi l'opzione viene bloccata preventivamente prima di scrivere qualsiasi dato anziché essere ignorata. | Rimuovi l'opzione da quella chiamata, oppure effettua la scrittura tramite client HTTP, che le supporta entrambe. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione di tipo `via`, il cui join path è configurato solo in una direzione, rendendo impossibile correlare una subquery al punto di partenza. | Applica il filtro dal lato proprietario della relazione. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è supportato per questo campo: una relazione senza una colonna fisica su questa riga viene filtrata per appartenenza, e la ricerca di pattern (`like`, `ilike` e le relative negazioni) si applica solo al testo. | Consulta il messaggio; elenca gli operatori validi per il campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore non rispetta un vincolo definito sulla colonna (`.validate()`, `.notNull()`, `.oneOf()`) — lunghezza, intervallo, pattern regex, campo obbligatorio, valore non incluso nell'elenco. Ogni voce di `details.violations` include un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene lo stesso elemento due volte, `$push` incluso), `unique_by` (due elementi di un array JSON condividono lo stesso valore in un campo indicato da `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulta il messaggio; indica tabella, colonna e ciascuna violazione riscontrata. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il corpo della richiesta tenta di valorizzare una colonna contrassegnata come `.private()`, oppure `.access({ write: [] })` — stessa regola, due sintassi alternative. Si tratta di campi riservati al server: password hash, token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questo errore si applica a qualsiasi chiamante, compreso il ruolo `admin`. | Rimuovi il campo dalla richiesta. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non è compatibile con il tipo della colonna. | Consulta il messaggio; indica la colonna interessata. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo della richiesta contiene campi inesistenti nella tabella — compreso l'argomento `id` su tabelle con una chiave primaria differente. | Verifica i nomi; il messaggio ("Table 'x' has no column 'f'. Known columns: …") elenca le colonne valide. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Un cursore (`after` / `startAfter`) è stato combinato con una ricerca vettoriale. Le righe sono ordinate in base a una distanza calcolata al momento per ciascuna query, la quale non può fungere da chiave per un cursore; di conseguenza una ricerca vettoriale non restituisce `nextCursor`. | Pagina le righe più vicine usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha negato la scrittura. | Controlla la configurazione `rls` della tabella. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura rifiutata da Postgres per un motivo legato ai *dati forniti dal chiamante*
restituisce il codice SQLSTATE all'interno del codice di errore: `PG_23505`, `PG_23503`,
e così via. Si tratta di una famiglia di codici, non di un elenco esaustivo — Postgres
definisce centinaia di SQLSTATE — ma solo due classi possono essere restituite in questo
modo, poiché solo queste due dipendono dal chiamante:

- **classe 23**, violazione dei vincoli di integrità: un duplicato, una foreign key che punta a
  una riga inesistente, una colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: un valore non supportato dal tipo di dato della colonna.

Tutti gli altri errori — caduta della connessione, colonna inesistente, problemi di privilegi —
sono imputabili al server e restituiscono un `500`. Di conseguenza, `code.startsWith("PG_")`
è un controllo affidabile per determinare se "la riga inviata non era valida", e i quattro codici
seguenti sono quelli che un client incontra più di frequente. `details.dbCode` riporta lo
stesso SQLSTATE per ciascuno di essi, e il messaggio indica il vincolo violato.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valore non può essere convertito nel tipo della colonna — l'equivalente in scrittura di `INVALID_FILTER_VALUE`. | Invia un valore compatibile con il tipo della colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo o assegna un valore predefinito alla colonna. |
| `PG_23503` | 400 / 409 | In fase di salvataggio, una foreign key punta a una riga non esistente (400). In fase di eliminazione, altre righe dipendono ancora da questa (409; un vincolo `RESTRICT` solleva `PG_23001`, anch'esso 409). | Crea prima la riga di destinazione o correggi l'ID; per un'eliminazione, rimuovi o riassocia prima le righe dipendenti. |
| `PG_23505` | 409 | Violazione di un vincolo di unicità. Il messaggio indica il vincolo violato. | Usa un valore differente, o aggiorna la riga esistente. |

## Storage

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Il parametro `maxResults` di un list di storage non è un intero maggiore o uguale a 1, oppure il `pageToken` non è stato generato dalla sorgente. In precedenza una dimensione pagina inferiore a uno restituiva una pagina vuota con lo stesso token, causando loop infiniti nei cicli `while (pageToken)`. | Invia un `maxResults` positivo e ripassa `nextPageToken` inalterato. |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Verifica il nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata, tenta di risalire oltre il prefisso consentito (directory traversal) o risiede sotto un prefisso riservato (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifica la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri per la trasformazione delle immagini sono fuori intervallo o incompatibili tra loro. | Consulta la documentazione di [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | L'upload supera il limite `maxBytes` dichiarato sulla colonna target `col.storage()`. Verificato sul server, non solo nel browser. `details` specifica colonna, limite e dimensione effettiva. | Carica un file più piccolo o incrementa `maxBytes` sulla colonna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il MIME type del file non è presente nell'elenco `accept` della colonna, o non rientra negli `allowedMimeTypes` della sorgente storage. `details` riporta la colonna (o la lista della sorgente), i tipi accettati e il content-type ricevuto. | Carica un formato consentito, o estendi `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | Il bucket S3 o GCS configurato per questa risorsa non esiste, oppure il provider ha rifiutato le credenziali fornite per questo deployment. Il messaggio indica il bucket; `details.reason` riporta `NoSuchBucket` o il motivo del rifiuto del provider. In precedenza un bucket inesistente veniva segnalato come "file non trovato" per ogni file. | Correggi il nome del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` per una risorsa con nome) o i permessi delle credenziali. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nessun backend di storage configurato su questo server, o nessuno è impostato come default e la richiesta non specifica una sorgente; il messaggio elenca le risorse disponibili (501). Un caricamento riprendibile (resumable) la cui sorgente è scomparsa prima del completamento restituisce 503. | Configura S3, GCS o lo storage locale, oppure specifica una sorgente con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Esecuzione di `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) tra due sorgenti che condividono lo stesso bucket o cartella. Essendo lo stesso file, ogni elemento risulterebbe già presente nella destinazione, e l'eliminazione della sorgente cancellerebbe l'unica copia esistente. Nessun file è stato spostato o rimosso. | Fai puntare la colonna all'altra sorgente: i file sono già presenti. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) non è riuscito a scansionare tutte le tabelle, rischiando di identificare come orfano un file in realtà referenziato. Con `?scan=`, fa riferimento a una scansione che non ha potuto verificare tutte le tabelle. Nessun dato è stato cancellato; `details.unscanned` elenca ciascuna tabella e la causa dell'errore. | Risolvi il problema che impedisce la lettura delle tabelle e riesegui il comando. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione non registrata nella sorgente. Le scansioni sono conservate per 7 giorni nella sorgente analizzata; specificare uno `storageId` diverso da quello originale restituirà questo errore. | Invia lo `storageId` corretto della scansione, oppure avviane una nuova. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione che si trova ancora in stato `queued` o `running`, oppure terminata con `failed`. Nessun file è stato eliminato; `details.status` riporta lo stato attuale. | Attendi il completamento della scansione, o avviane un'altra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione completata da più di 15 minuti. Nessun file è stato eliminato. | Avvia una nuova scansione ed esegui l'eliminazione a partire da quest'ultima. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` punta a una scansione i cui file orfani sono già in fase di eliminazione. | Verifica lo stato di eliminazione della scansione (`deletion`) tramite `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La storage source è dichiarata ma priva delle credenziali in questo ambiente. | Configura le variabili d'ambiente per questa sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto l'operazione di scrittura. | Controlla i log e le credenziali del provider di storage. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe operazioni simultanee di elaborazione immagini in corso. | Riprova; valuta l'adozione di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La richiesta indica una risorsa di storage (`?storageId=`) non dichiarata in questo progetto. Un `bucket` non gestito da questa istanza genera lo stesso codice con stato **404** (in operazioni di list, upload, gestione cartelle o upload riprendibili verso S3 o GCS) — la risorsa mancante è lo storage, e `details` elenca i bucket e le sorgenti esistenti. In precedenza entrambi venivano segnalati come "file non trovato", identico all'assenza di una normale chiave. | Dichiara la risorsa in `config/resources.ts`, o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Una richiesta `PATCH` per un upload riprendibile è arrivata mentre un altro blocco dello stesso file era ancora in ricezione — in genere un client che riprova l'invio del blocco in transito. La richiesta viene respinta anziché accodata, come previsto da tusd. | Verifica l'offset corrente con `HEAD /api/storage/tus/:id` e riprendi da quel punto; tus-js-client gestisce automaticamente il backoff e il retry. Consulta [Upload riprendibili (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funzioni personalizzate

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione registrata con questo nome — o la funzione esiste, ma le sue route interne non coprono il percorso specificato successivamente. Un chiamante autenticato riceverà anche l'elenco delle funzioni *disponibili*; un chiamante anonimo non lo riceverà per non esporre l'inventario degli endpoint personalizzati. Se il caricamento del file associato è fallito, il messaggio lo segnala all'utente autenticato indicando il nome del file, distinguendo un errore di battitura da un problema di deploy. Un chiamante anonimo riceve la risposta standard di nome sconosciuto. | Verifica il nome tramite `GET /api/functions`, o controlla il log di avvio per individuare eventuali file non caricati. |
| `FUNCTION_TIMEOUT` | 504 | L'esecuzione dell'handler ha superato il tempo limite previsto. La funzione è ancora in esecuzione e non può essere interrotta da questo processo. | Configura un `AbortSignal` per le chiamate in uscita, oppure incrementa `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo inoltra le funzioni come proxy verso un altro servizio, che non ha risposto. | Verifica che il processo o servizio dedicato alle funzioni sia operativo. |

## Notifiche push

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | L'endpoint della sottoscrizione non appartiene a un servizio push standard per browser (FCM, Mozilla, Apple, Windows) tramite `https`. Il server effettua una POST verso questo indirizzo per ogni invio, quindi non accetta altre destinazioni. | Invia il risultato di `PushSubscription.toJSON()` così come generato dal browser, o aggiungi un servizio push di test in `push.allowedHosts`. Consulta [Notifiche push](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Una chiave API o la service key ha invocato una route per le notifiche push. Una sottoscrizione deve appartenere al browser di un utente autenticato. | Esegui la richiesta all'interno della sessione di quell'utente. |
| `PUSH_NOT_CONFIGURED` | 503 | Il servizio push è abilitato, ma non è in grado di inviare: mancano le chiavi VAPID in produzione o non è stato possibile preparare la tabella dedicata. Il messaggio riporta il motivo esatto. | Configura `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Consulta [Notifiche push](/docs/backend/push-notifications/#keys). |

## Cron job

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | È stato richiesto l'avvio manuale di un cron job già in esecuzione — sul processo corrente o su un altro processo che detiene il lease di esecuzione del job (come un worker collegato a un processo `api`). Nessun nuovo job è stato avviato. L'avvio saltato viene registrato nello storico del job, e `details.log` riporta la voce di log corrispondente; la voce indica il processo che sta eseguendo il job. | Riprova al termine dell'esecuzione in corso. Consulta [Cron Job](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfacce di amministrazione e modifica dello schema

Questi codici indicano che una funzionalità è disabilitata o non configurata,
non che la richiesta fosse errata. Ognuno di essi viene riportato anche sulla
rispettiva route `/status` con codice `200`, consentendo ai pannelli di controllo
di disattivare l'elemento nell'interfaccia anziché mostrare un errore.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata invocata un'interfaccia riservata agli amministratori su un server privo di autenticazione configurata, impedendo di distinguere un amministratore da un utente non autorizzato. | Configura `auth.jwtSecret`, oppure fornisci un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | È stato inviato a `POST /api/admin/branches/:name/merge` il fingerprint di un diff non più valido: il branch o il database genitore hanno subito modifiche nel frattempo. Nessuna modifica applicata. | Ricalcola il diff, esaminalo e ripeti il merge specificando il nuovo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La sorgente dati non supporta la comparazione tra branch: assenza di funzionalità SQL o supporto ai branch non attivo (manca la connessione admin). | Usa un backend Postgres con `adminConnectionString` configurata. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabella che presenta differenze non può essere unita — aggiunta o rimossa dal branch, discrepanza nelle colonne o nella primary key, primary key assente, troppe righe da confrontare, o riscrittura della tabella dopo la creazione del branch (`TABLE_REWRITTEN`). Una tabella le cui righe non sono state confrontabili blocca l'operazione anche con conteggio pari a 0: il dato è sconosciuto, non zero. `details.tables` elenca le tabelle e la motivazione. Nessun dato modificato. | Applica prima lo schema tramite migrazioni, oppure esegui il merge con `skipBlocked: true` per escludere tali tabelle. |
| `BRANCH_MERGE_CONFLICT` | 409 | Le righe sono state modificate sia sul branch che sul genitore e `onConflict` era impostato su `"abort"` (predefinito); oppure il genitore ha rifiutato parte del merge — riga modificata nel frattempo, operazione saltata da un trigger, riga nascosta da una policy. Nessuna scrittura applicata. | Scegli quale versione privilegiare impostando `onConflict: "branch"` o `"target"`, oppure ricalcola il diff. |
| `BRANCH_MERGE_FAILED` | 409 | Il genitore ha rifiutato le righe del branch all'interno dell'istruzione di merge — violazione di vincoli, etichette enum o foreign key presenti sul genitore, dovuta in genere a schemi disallineati. `details` specifica `sqlState`, `table`, `constraint` e `detail`. Nessun dato scritto. | Esamina i cambiamenti di schema nel diff, allinea lo schema del genitore con le migrazioni o correggi le righe nel branch, quindi riprova il merge. |
| `BRANCH_NOT_FOUND` | 404 | Nessun branch con questo nome registrato nel sistema. | Esegui `rebase db branch list` o controlla la scheda Branches per visualizzare quelli disponibili. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto del progetto viene esposto solo in presenza di autenticazione configurata — descrive ogni tabella e relazione. | Configura l'autenticazione. `/meta/schema-version` è invece sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna mailbox di sviluppo attiva. Le email vengono intercettate localmente solo se `SMTP_HOST` non è configurato e `NODE_ENV` non è `production`. | Rimuovi `SMTP_HOST` in ambiente di sviluppo, o consulta la casella di posta reale. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` è accessibile agli stessi chiamanti a cui `GET /api/schema/tables` descrive le tabelle; questo server non ha autenticazione configurata, quindi non ha utenti a cui esporle. | Configura l'autenticazione, o pubblica la documentazione completa a chiunque impostando `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | La modifica dello schema proposta non è formattata correttamente. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione della modifica allo schema pianificata è fallita per un errore non contemplato da codici più specifici. | Consulta il messaggio; riporta letteralmente l'errore sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma non può essere applicata allo stato attuale dello schema. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non committate; l'operazione è stata bloccata per sicurezza. | Esegui un commit o uno stash, poi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha rifiutato la modifica: la parte interessata contiene codice non gestito per la riscrittura automatica (spread operator, helper esterni, proprietà calcolate), o si tratta di un'operazione non consentita (rinominare tabelle, eliminare l'ultima regola). `details.problems` riporta i problemi rilevati. Nessun dato scritto. | Consulta il messaggio. Modifica a mano i file sotto `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | La modifica può essere applicata, ma provocherebbe errori di compilazione nel nuovo schema — ad esempio una relazione verso una tabella rimossa, o una regola che fa riferimento a una colonna eliminata. `details.problems` elenca gli errori del compilatore, con tabella e colonna correlate. Nessuna modifica applicata. | Modifica prima le tabelle da cui dipende, oppure esegui l'intervento manualmente in `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un file interessato dalla modifica è stato aggiornato su disco successivamente alla preparazione dell'intervento (salvataggio da IDE, altro processo). Nessuna modifica applicata. | Ricarica lo stato e riapplica la modifica partendo dalla versione attuale del file. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un altro applicativo automatico ha tentato di applicare una modifica allo schema. | Esegui l'accesso come utente, o abilita `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica a caldo dello schema richiede `schemaDir` (la directory `backend/schema`) o `liveSchema.repository`; il server è stato avviato senza nessuno dei due. Il codice mantiene la nomenclatura storica. | Configurane almeno uno. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione è attiva, ma manca un repository su cui committare le modifiche — deploy eseguito da bundle precompilato o directory `backend/schema` esterna a un repository git (ogni apply genera un commit). | Esegui `git init` nel progetto e riavvia il server (il repository viene rilevato al boot), oppure imposta `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Questo deployment non apporta modifiche dirette al database (`REBASE_PROVISION=false`), pertanto l'applicazione dal pannello non è consentita. | Committa le modifiche solo nei sorgenti e lascia che sia il processo preposto alla gestione del database ad applicarle. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non supporta la pianificazione delle modifiche di schema. | La modifica a caldo (live editing) è supportata su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Le tabelle vengono lette direttamente tramite introspezione del database, senza file sorgente modificabili. | Modifica lo schema applicando una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disattivato per questo server. Un'applicazione distribuita come bundle risponde sempre con questo errore. | Abilitalo tramite `schemaEditor`. Su un bundle compilato, definisci `REBASE_LIVE_SCHEMA_REPOSITORY` per gestire `backend/schema` tramite un repository — consulta [Modifica dello schema a caldo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema richiede `ts-morph`, che non risulta installato. | Installalo nel package che avvia il backend, poi riavvia: `pnpm --dir backend add -D ts-morph@28.0.0` dalla root del progetto con scaffolding, oppure `pnpm add -D ts-morph@28.0.0` se il backend corrisponde alla root del progetto. Il messaggio indica il comando corretto per la tua configurazione. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non ha `schemaDir` valorizzato, quindi l'editor non ha cartelle su cui scrivere. Il codice mantiene la denominazione storica. | Imposta `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato se `NODE_ENV=production`: i file di un server distribuito vengono ricompilati dal repository a ogni deploy, rendendo vane le modifiche locali. | Modifica `backend/schema` in ambiente di sviluppo ed esegui il deploy, oppure configura `liveSchema.repository` per registrarle lì. |
| `SCHEMA_UNAVAILABLE` | 404 | Chiamata a `GET /api/schema/tables` su un backend senza autenticazione configurata: manca il contesto dell'utente per filtrare la visibilità delle tabelle, e `auth.requireAuth: false` non modifica questo comportamento. | Configura un auth adapter o `auth.jwtSecret`. Consulta [Endpoint](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` richiede una tabella non disponibile per il chiamante — slug inesistente o scope della credenziale insufficienti per raggiungerla. | Controlla lo slug e gli scope `data:*` della credenziale. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` è stato invocato con una chiave API, un platform token o la service key. Le preferenze di interfaccia appartengono a un utente reale autenticato. | Effettua l'accesso come utente. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | Le preferenze di interfaccia per una singola tabella superano i 64 KB. | Salva meno informazioni: le preferenze servono per la presentazione, non per memorizzare dati. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | Il driver di questo backend non può eseguire comandi SQL, quindi non memorizza le preferenze UI; il pannello le conserva localmente nel browser. | Nessuna azione richiesta: le impostazioni rimangono memorizzate per singolo browser. |
| `UI_CONFIG_FILE_INVALID` | 500 | Il file `frontend/src/cms/ui-config.json`, in cui vengono salvate le configurazioni di interfaccia del workspace in sviluppo, non contiene JSON valido. | Correggilo o eliminalo; il pannello lo rigenererà al salvataggio successivo. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` non può inviare il risultato in streaming in questo contesto: il database di sviluppo in-process (PGlite) usa una connessione singola, e un cursore aperto per tutta la durata del download bloccherebbe qualsiasi altra query; oppure la sorgente dati non supporta i cursori SQL. | Configura `DATABASE_URL` verso un'istanza Postgres indipendente (`rebase dev --docker` ne crea una), o applica un `LIMIT` esportando le righe visibili a schermo. |

### Schema reconcile

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) calcola il piano
tramite `POST /api/admin/schema/reconcile/plan` e lo applica mediante
`/reconcile/apply`. Un'operazione respinta non altera lo stato del database; solo
`SCHEMA_RECONCILE_FAILED` può lasciare una parte del piano già applicata.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | Il corpo della richiesta non è un oggetto JSON, oppure `drop` non è un array di stringhe nel formato `"<table>.<column>"`. | Invia `{ "drop": ["voice_cache.wav"] }`, oppure ometti `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Un'istruzione è fallita a metà processo. I comandi precedenti sono stati eseguiti e rimangono applicati; `details.applied` li riporta. | Correggi la causa indicata nel messaggio, poi ricalcola il piano: il nuovo piano escluderà le modifiche già completate. |
| `SCHEMA_RECONCILE_INVALID` | 400 | Impossibile applicare il piano; il messaggio ne specifica le ragioni: una voce in `drop` non rispetta il formato `<table>.<column>`, indica tabella o colonna inesistente, o indica una colonna ancora dichiarata nella tabella. `details.plan` contiene il piano. | Correggi la lista `drop`. Una colonna dichiarata va rimossa prima dal rispettivo `defineTable`, deployata e solo dopo riconciliata. |
| `SCHEMA_RECONCILE_STALE` | 409 | Il database o le tabelle hanno subito modifiche rispetto al piano approvato. `details.plan` contiene quello aggiornato. | Rivedi il nuovo piano e conferma il nuovo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | Chiamata a `/reconcile/apply` inviata senza `confirm`. | Pianifica prima l'operazione e invia il `digest` del piano come valore per `confirm`. La CLI esegue questo passaggio dopo aver digitato `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | Il driver di questo backend non è in grado di pianificare un reconcile, o non può eseguire istruzioni SQL. | La riconciliazione è supportata su Postgres. |

### Perché non è possibile unire la tabella di un branch

`BRANCH_MERGE_BLOCKED` elenca ciascuna tabella rifiutata in `details.tables`,
associandola a uno di questi codici. Lo stesso codice compare sul campo `blocked`
della tabella nel diff, consentendo a Studio di segnalarlo prima che l'utente prema **Merge**.
Nessuno di questi codici costituisce una risposta HTTP a sé stante.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Le colonne della tabella differiscono tra il branch e il database genitore. Il confronto delle righe viene effettuato solo sulle colonne condivise. | Aggiungi le colonne mancanti al genitore tramite le tue migrazioni (`rebase db push`), poi esegui il merge. Una migrazione che riscrive la tabella (modifica del tipo di colonna) genera lo stato `TABLE_REWRITTEN`: esegui il merge prima di applicarla, o ricrea il branch dopo l'aggiornamento. |
| `NO_PRIMARY_KEY` | — | La tabella non ha una chiave primaria, rendendo impossibile confrontare le righe singolarmente; il diff mostra solo il conteggio totale delle righe. | Definisci una chiave primaria sulla tabella, o sposta le righe a mano. |
| `PRIMARY_KEY_DIFFERS` | — | Le colonne che compongono la primary key o i relativi tipi di dato differiscono tra i due ambienti. | Allinea prima lo schema sul database genitore. |
| `TABLE_ADDED` | — | La tabella è stata creata all'interno del branch. Un'operazione di merge non crea nuove tabelle. | Creala sul database genitore tramite migrazioni, poi procedi all'unione delle righe. |
| `TABLE_DROPPED` | — | La tabella è stata eliminata all'interno del branch. Il merge non elimina tabelle. | Rimuovila applicando una migrazione. |
| `TABLE_REWRITTEN` | — | Uno dei due ambienti ha riscritto tutte le righe della tabella dopo la creazione del branch — cambio tipo colonna, `ADD COLUMN` con default volatile, `VACUUM FULL`, `CLUSTER` — facendo risultare ogni riga come modificata e impedendo di stabilire quale parte abbia cambiato ciascun record. | Unisci il branch prima di effettuare tale operazione, oppure rigenera il branch dal genitore successivamente. |
| `TOO_LARGE` | — | La tabella contiene più righe di quante un diff possa confrontare singolarmente (100.000 di default, `maxRowsPerTable`). | Incrementa `maxRowsPerTable` sia nel diff che nel merge, oppure migra i record con un metodo alternativo. |

## Codici generici

Una route ricorre a uno di questi codici quando non è disponibile un errore più specifico.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Richiesta malformata, in assenza di un codice più specifico. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato, o credenziale non accettata. | Effettua l'accesso o il refresh. |
| `FORBIDDEN` | 403 | Autenticato, ma privo dei permessi necessari. | Riprovare con la stessa identità non risolverà l'errore. |
| `CONFLICT` | 409 | Conflitto con lo stato attuale della risorsa. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Errore generico lato server. Il messaggio è volutamente non dettagliato. | Fai riferimento al `requestId`; il dettaglio dell'errore è annotato nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza necessaria per questa route non risulta configurata su questo server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Un servizio da cui dipende la richiesta non è raggiungibile: un bucket S3 o MinIO, o un host chiamato via `fetch()` da una funzione che rifiuta la connessione o non risolve il dominio. Il log del server indica l'host; la risposta al client non lo specifica. Un database non raggiungibile restituisce `DATABASE_UNAVAILABLE`. Questo errore segnala il fallimento della connessione a un servizio esterno generico. | Riprova; ispeziona i log di sistema. |

## Come garantire l'accuratezza di questa pagina

Il comando `pnpm verify:docs` fallisce se un codice sollevabile dal server non è presente
in queste tabelle, se una tabella riporta un codice che il codice non genera mai, se gli
stati HTTP indicati differiscono da quelli effettivamente restituiti dal sorgente, o se
una famiglia di codici come `PG_<SQLSTATE>` è priva di una voce per un SQLSTATE riscontrabile
dai chiamanti. Lo script incaricato del controllo è
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Lo script valida prima sé stesso. Poiché estrae i codici analizzando direttamente i file
TypeScript anziché interrogare un'istanza del server in esecuzione, eventuali zone d'ombra
risulterebbero silenti per definizione: in passato non riusciva a individuare un codice
passato attraverso un wrapper a riga singola, o uno scritto dopo un messaggio contenente una `)`,
dichiarando che "ogni codice generabile dal server è documentato" a fronte di una pagina a cui
ne mancavano diciassette. Per questa ragione, il processo esegue preventivamente una suite
di test contenente proprio queste casistiche prima di analizzare la documentazione, rifiutandosi
di procedere qualora non fosse in grado di rilevarle correttamente.
