---
sourceHash: 983cce6efed81a1a
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il relativo stato HTTP, il loro significato e cosa fare al riguardo — oltre all'envelope di risposta, X-Request-ID e le regole per details.
---

Ogni errore restituito da un backend Rebase utilizza un singolo envelope e contiene un
`code` stabile. Il codice è l'elemento su cui creare diramazioni logiche (branching): il messaggio è scritto per un
essere umano e potrebbe essere riformulato, lo stato è condiviso da decine di problemi differenti,
mentre il codice non è né l'uno né l'altro.

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

- **`message`** — leggibile dall'uomo. Per un `4xx` è il messaggio nativo del server; per
  un `5xx` è volutamente generico, poiché il testo sottostante potrebbe includere un
  host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori seguenti. Stabile tra versioni minor.
- **`details`** — opzionale e mai garantito. Consulta le regole di seguito.
- **`requestId`** — presente ogni volta che la richiesta passa attraverso il middleware
  del request-ID, ossia ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante
se si tratta di un UUID, altrimenti ne viene generato uno nuovo. Viene restituito nella
risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e
allegato alla riga di log del server per tale richiesta.

Questa è la chiave di correlazione (join key). Includila in una segnalazione di bug e un operatore potrà trovare la
riga di log che spiega l'errore, contenente la motivazione che non è mai stata
mostrata al client.

Inviarne uno personalizzato è il modo in cui una traccia sopravvive attraverso i nodi (hop): un gateway o un task runner che
inoltra l'header ottiene un singolo ID su tutti i servizi che hanno gestito la richiesta.
Un valore non valido viene ignorato anziché rifiutato — non vale la pena far fallire una richiesta per un
header malformato da parte di un chiamante — pertanto non dare per scontato che l'ID inviato sia
l'ID ricevuto. Leggi l'header della risposta.

### Cosa c'è in `details`

`details` ha scopo diagnostico, non contrattuale. È disciplinato da tre regole:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Si tratta degli
   errori commessi dal chiamante descritti con precisione: quale campo di filtro era sconosciuto,
   quale relazione non è scrivibile, quale valore non corrispondeva al suo tipo.
2. **I dati diagnostici del database vengono ridotti in produzione.** Quando l'errore proviene
   da Postgres, `details.dbCode` — il valore SQLSTATE — è sempre presente: indica
   la classe del problema e non rivela nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   perché Postgres include in essi il contenuto dei record. `23505` restituisce
   `Key (email)=(a@b.c) already exists.`, rispondendo così alla domanda "questa persona
   è registrata?" per qualsiasi indirizzo si provi.
3. **Non eseguire mai controlli logici (branch) basandoti su `details`.** Basati su `code`. Il contenuto di `details` è
   qualsiasi informazione risultasse utile a una persona in quel punto di chiamata, ed è soggetto a modifiche.

## Leggere uno stato

| Stato | Cosa indica sulla richiesta |
| --- | --- |
| `400` | Malformata, o richiede elementi non presenti nello schema. Correggi la richiesta. |
| `401` | Non autenticata, o credenziali scadute. Effettua l'accesso o il refresh. |
| `403` | Autenticata, ma non autorizzata. Riprovare con la stessa identità non servirà. |
| `404` | Route, collection o riga inesistente — o una riga nascosta dalla row-level security. |
| `409` | Conflitto con lo stato attuale: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il payload è troppo grande, il media type è errato, o rifiutato semanticamente. |
| `429` | Limite di richieste superato (rate limited). Rallenta le richieste; il messaggio indica per quanto tempo. |
| `500` | L'errore risiede nel server o nel suo database, non nel chiamante. Controlla i log. |
| `501` | La route esiste, ma questa istanza non può gestirla — funzionalità disabilitata o non configurata. |
| `502` `503` `504` | Una dipendenza era irraggiungibile, non configurata o troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa la verifica MFA, poi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nulla — lo stato desiderato è già valido. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | L'account modificato, reimpostato o eliminato possiede un ruolo o uno scope che il chiamante non ha. `details.beyond` li elenca. | Fai eseguire la modifica a chi possiede tali permessi. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di elencare, creare, modificare o revocare chiavi API, dello stesso tipo o personali. | Gestisci le chiavi tramite un utente in possesso di `keys:write`, o con la service key. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione di Rebase a monte, pertanto le credenziali del chiamante non sono mai state esaminate. | Esegui il mount dell'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Effettua prima l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è riservato esclusivamente al primissimo utente, e questo non lo è. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi un nuovo challenge. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati inseriti per un singolo challenge MFA. | Avvia un nuovo challenge. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con quell'indirizzo — in fase di registrazione, di modifica indirizzo, o seguendo un link di cambio indirizzo quando un altro account ha preso l'indirizzo nel frattempo. | Accedi, oppure avvia il ripristino della password; per un cambio di indirizzo, scegline un altro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP ma il server non dispone di un mail transport. | Configura l'SMTP o usa un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | Un accesso OAuth ha trovato un account con lo stesso indirizzo, ma il provider non ha verificato tale indirizzo, quindi non è collegato. | Accedi con il metodo esistente, poi esegui `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma non è mai stato confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollegala prima da quell'account. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una richiesta ha inviato `x-rebase-impersonate` e il chiamante non può eseguire richieste come un altro utente. Può farlo solo la sessione di un amministratore autenticato, mai una chiave API o la service key. | Inviala con la sessione di un amministratore, o ometti l'header. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` è stato inviato vuoto. | Invia l'uid dell'utente da impersonare, o ometti l'header. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` non indica alcun utente attivo: nessun account ha quell'uid, oppure è disabilitato. | Verifica l'uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | L'autenticazione di questo backend non può eseguire una richiesta per conto di un altro utente perché il suo `AuthAdapter` non implementa `resolveUser`. | Implementa `resolveUser` nell'adapter, o ometti l'header. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` è stato inviato a una route che non supporta l'impersonificazione. Solo l'API dati e le funzioni personalizzate la gestiscono; il socket realtime supporta `impersonate` su `AUTHENTICATE`. | Invia la richiesta senza l'header. |
| `SIMULATION_FORBIDDEN` | 403 | Una richiesta ha inviato un header `x-rebase-simulate-*` (il simulatore RLS) o ha interrogato `/api/admin/rls-simulator`, e il chiamante non può simulare l'accesso. Può farlo solo la sessione di un amministratore autenticato, mai una chiave API o la service key. | Inviala con la sessione di un amministratore, o ometti gli header. |
| `SIMULATION_INVALID` | 400 | La simulazione è malformata: un header inviato vuoto, `x-rebase-simulate-api-key-id` combinato con un ruolo o user id, oppure simulazione combinata con `x-rebase-impersonate`. | Specifica un solo ruolo (facoltativamente con un uid), un solo user id, o un solo id di chiave API. |
| `SIMULATION_READ_ONLY` | 403 | Una scrittura, eliminazione, `_batch`, ripristino cronologia, o una funzione personalizzata chiamata con un verbo diverso da `GET`/`HEAD`/`OPTIONS`, conteneva un header `x-rebase-simulate-*`. L'accesso simulato è di sola lettura: la scrittura verrebbe eseguita come identità simulata, non come amministratore. Le letture, incluse `POST …/query` e `…/count`, vengono comunque eseguite. Nella versione 0.25 la scrittura veniva eseguita come identità simulata. | Interrompi la simulazione per applicare modifiche. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulazione indica un utente non attivo (un user id inviato senza ruolo) o una chiave API non attiva. | Verifica l'id, oppure invia un ruolo con l'uid per simulare un uid privo di account. |
| `SIMULATION_UNAVAILABLE` | 501 | Questo backend non può simulare l'accesso: il suo `AuthAdapter` non ha `resolveUser` per confermare un amministratore, o è stata specificata una chiave su un backend privo di chiavi API. | Implementa `resolveUser`, o ometti gli header. |
| `SIMULATION_UNSUPPORTED` | 400 | Un header `x-rebase-simulate-*` è stato inviato a una route che non supporta l'accesso simulato. Solo l'API dati e le funzioni personalizzate li supportano. | Invia la richiesta senza gli header. |
| `GUEST_REFERENCED` | 409 | Impossibile eliminare un guest perché una riga interna al progetto lo richiede, tramite una foreign key con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo segnala per ciascun guest in `skipped` e prosegue. | Elimina la riga, oppure mantieni il guest. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può agire. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | Il challenge MFA è sconosciuto o scaduto. | Avviane uno nuovo. |
| `INVALID_CODE` | 400 / 401 | Il codice OTP o MFA è errato: 400 dall'accesso tramite codice email (`/auth/otp/verify`), 401 da una registrazione o verifica MFA. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — volutamente non specificato quale delle due. | Riprova, o reimposta la password. |
| `INVALID_PLATFORM_TOKEN` | 401 | Un token di piattaforma `rpt_` è stato rifiutato: firma non valida, audience errata, scaduto o durata superiore al limite massimo. Il messaggio specifica la causa. | Richiedi alla piattaforma l'emissione di uno nuovo — su Rebase Cloud, esegui nuovamente il comando. |
| `INVALID_SCOPES` | 400 | È stato richiesto uno scope non valido per una chiave: malformato, sconosciuto o con un target non supportato dallo scope. `details.problems` ne specifica il motivo; `details.validScopes` elenca gli scope consentiti per una chiave. Esclude `keys:read` e `keys:write`, che nessuna chiave può possedere; nella versione 0.24 venivano elencati. | Usa un nome compreso nell'elenco. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token di verifica, ripristino, magic link o cambio indirizzo è malformato, sconosciuto, già utilizzato o scaduto (400). Una credenziale del provider OAuth o un refresh token non verificabile restituisce 401. | Richiedi un nuovo link, o effettua nuovamente l'accesso. |
| `INVALID_ROLE` | 400 | Il nome del ruolo in scrittura non è una stringa, è vuoto, oppure contiene `,` `{` `}` `"` `\` o un carattere di controllo. Questi caratteri verrebbero riletti come ruoli differenti: un ruolo risiede in un array `text[]` di Postgres e nella lista separata da virgole analizzata dalle policy RLS, quindi `"support,admin"` verrebbe riletto come `admin`. Nella versione 0.25 tale formato veniva memorizzato. `details.problems` elenca ciascun errore. | Rinomina il ruolo. Qualsiasi altro nome viene accettato. |
| `KEY_MANAGEMENT_SCOPE` | 400 | È stato richiesto `keys:read` o `keys:write` per una chiave. Nessuna chiave può gestire altre chiavi. `details.scopes` li elenca. | Omettili. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titolare di `keys:write` ha tentato di modificare o revocare una service key che possiede un ruolo o uno scope che l'utente non ha. Solo un amministratore gestisce qualsiasi chiave. `details.roles` e `details.scopes` specificano cosa possiede la chiave oltre i permessi del chiamante. Nella 0.25 la modifica veniva applicata. | Fai modificare la chiave da un amministratore o da chi possiede tali permessi. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto privo di amministratori. | Promuovi prima un altro utente. |
| `MFA_REQUIRED` | 401 | La password è corretta e l'account ha un secondo fattore verificato, quindi l'accesso è parziale. `details` include un token a breve scadenza valido per il challenge MFA — non è una sessione. | Avvia un challenge e completalo; la risposta al challenge rilascia la sessione. |
| `NO_SESSION` | 401 | Nessun cookie di sessione o refresh token fornito. Comportamento normale al primo caricamento pagina. | Effettua l'accesso. |
| `NOT_ANONYMOUS` | 400 | Una route di passaggio da anonimo è stata chiamata da un account reale, oppure `DELETE /api/admin/guests/:uid` ne ha indicato uno. | Nulla da convertire. Per eliminare un account, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o ha restituito un errore. | Riprova il flusso; il messaggio indica la motivazione del provider. |
| `PERSONAL_KEYS_DISABLED` | 403 | Le chiavi API personali sono disabilitate su questo backend. | Imposta `personalKeys: true` nel blocco `auth` della collection users. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La service key o una sessione guest ha tentato di usare le route per le chiavi personali. Nessuna delle due dispone di un account per il quale la chiave possa agire. | Accedi a un account o crea una service key sotto `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token di piattaforma `rpt_` ha raggiunto un server che non li accetta: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` non sono impostati. | La piattaforma di hosting imposta entrambi al deployment; esegui un nuovo deploy o accedi all'app con un altro metodo. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta le richieste; il messaggio indica per quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione del redirect non è inclusa nell'allow-list. | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | La registrazione autonoma è disabilitata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXCEEDS_CALLER` | 403 | I ruoli da assegnare contengono uno scope, o `admin`, che il chiamante non possiede. `details.beyond` li elenca. | Chiedi a chi possiede tali permessi di assegnare il ruolo. |
| `ROLE_EXCEEDS_CREATOR` | 403 | È stato assegnato a una service key un ruolo RLS che il suo creatore non possiede. Solo un amministratore può assegnare qualsiasi ruolo. `details.roles` li elenca. | Rimuovi il ruolo o chiedi a un amministratore di creare la chiave. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli del chiamante — su una route di amministrazione o su una richiesta dati in un backend con `config.auth`. Blocca l'accesso (fail closed) anziché fidarsi dei ruoli nel token. Un token il cui uid non corrisponde ad alcun account, compreso un uid non supportato dalla tabella users, restituisce 401 anziché questo errore (nella 0.24 un uid non supportato restituiva 503). Un database irraggiungibile restituisce `DATABASE_UNAVAILABLE` anziché questo (nella 0.24 restituiva 503). | Riprova; verifica lo stato del database. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | È stato richiesto per una chiave uno scope che il suo creatore non possiede. Una chiave non può avere permessi superiori a quelli dell'account che la crea. `details.scopes` li elenca. | Rimuovili o richiedi la creazione della chiave a chi li possiede. |
| `SCOPE_MISSING` | 403 | Le credenziali non dispongono dello scope necessario per questa route, collection, storage source o funzione. `details.requiredScope` lo indica, target incluso. | Per un utente, assegna un ruolo che include lo scope. Per una chiave, usa una chiave che lo include. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una route protetta con `requireScope` indica uno scope applicativo che questo backend non dichiara, rendendolo non disponibile a chiunque, inclusi gli amministratori. Una stringa non valida o un errore di digitazione su uno scope integrato (es. `data:raed`) non arriva a questo punto: `requireScope` genera un'eccezione in fase di registrazione della route. Nella versione 0.24 entrambi i casi restituivano a qualsiasi chiamante `403 SCOPE_MISSING`. | Dichiara lo scope sotto `auth.scopes` nella collection users, o correggi il nome. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Richiedi l'eliminazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | La sessione è stata terminata altrove, tutte le sessioni sono state revocate, o l'account è stato eliminato. Tutti gli endpoint che richiedono una sessione rifiutano un access token associato: data API, storage, custom functions e route di amministrazione (nella 0.24 i primi tre restituivano `UNAUTHORIZED` "Invalid or expired token"). Il socket realtime rifiuta l'istruzione `AUTHENTICATE` con un frame `AUTH_ERROR` contenente il medesimo codice. L'SDK tenta il refresh, il refresh viene rifiutato e viene eseguito il logout. | Accedi di nuovo. |
| `ACCOUNT_DISABLED` | 401/403 | Un amministratore ha disabilitato l'account: login (403), refresh e qualsiasi token associato (401) vengono rifiutati su tutti gli endpoint che accettano una sessione (nella 0.24 la data API, storage e custom functions restituivano `UNAUTHORIZED`). Il socket realtime rifiuta `AUTHENTICATE` con un frame `AUTH_ERROR` con lo stesso codice. | Rivolgiti a un amministratore. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` è attivo e l'indirizzo non è ancora confermato. Restituito solo se la password è corretta; viene inviato un nuovo link via email. | Segui il link ricevuto per email. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: l'account contiene una password o un'identità non verificata, e la richiesta non convalida nessuna delle due. Il token non viene consumato. | Invia `password` per mantenerla, o `removeUnproven: true` per confermare senza di essa. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | È stata richiesta una mail di conferma per un indirizzo non recapito — un guest, o il placeholder di X (400) — o un account ha richiesto di passare a tale indirizzo (409, `POST /auth/change-email`). | Imposta prima un indirizzo valido. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` ha specificato l'indirizzo attuale dell'account. | Nessuna modifica da applicare. |
| `ANONYMOUS_USER` | 403 | Un utente guest ha richiesto di modificare il proprio indirizzo email; un guest non ne possiede uno. | Convertilo prima in un account (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Sono stati richiesti codici di recupero per un account privo di un secondo fattore verificato. | Registra prima un fattore. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` ha generato un errore. Il messaggio è quello definito dall'hook; un hook che seleziona uno stato 4xx risponde con quest'ultimo. | Consulta il messaggio. |
| `INVALID_JSON` | 400 | Il corpo della richiesta non è in formato JSON. | Invia un payload JSON. |
| `SELF_DISABLE` | 400 | Un amministratore ha tentato di disabilitare il proprio account. | Rivolgiti a un altro amministratore. |
| `NOT_SUPPORTED` | 501 | Il repository di autenticazione di questo backend non supporta l'operazione richiesta (disabilitare account, modificare un indirizzo). | Riavvia il server per applicare la colonna, o utilizza un repository che la supporti. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Il target di uno scope fa riferimento a una collection, storage source o funzione non gestita da questo backend. `details` elenca quelle supportate. | Correggi il target. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, un codice email o il ripristino password ha confermato l'indirizzo di un account non verificato, ma l'account include un'identità di accesso il cui provider non ha mai verificato quell'indirizzo. Il repository di autenticazione non può rimuoverla (manca `unlinkUserIdentity`), quindi la verifica viene rifiutata per evitare accessi non autorizzati su un account verificato. | Implementa `unlinkUserIdentity` nel repository di autenticazione personalizzato, o richiedi la verifica dell'account a un amministratore. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore configurato, quindi questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | È stato riutilizzato un token monouso, o un refresh token ruotato più di `refreshTokenReuseIntervalSeconds` fa. | Richiedine uno nuovo o accedi di nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account associato a questo id. | Verifica l'id. |
| `WEAK_PASSWORD` | 400 | La password non rispetta i requisiti della [password policy](/docs/backend/auth-endpoints/#password-policy) (predefinito: minimo 8 caratteri con una maiuscola, una minuscola e una cifra) — in fase di registrazione, reset, modifica, o creazione password da parte dell'amministratore: `POST /api/admin/users`, creazione nella collection users tramite data API, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Scegli una password più complessa. Un amministratore che importa account può inviare `skipPasswordPolicy: true` in fase di creazione. |

## Dati, query e scritture

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non supporta il calcolo dell'aggregazione richiesta. | Usa un driver che la supporti, o calcolala lato client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database gestito di sviluppo (PGlite), in cui un branch coincide *con* il genitore e non offrirebbe isolamento. Il messaggio di rifiuto corrisponde a quello di `rebase db branch`. | Configura `DATABASE_URL` puntando a un'istanza Postgres indipendente (`rebase dev --docker` ne avvia una) e crea il branch lì. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` include più operazioni del limite consentito per singolo batch (predefinito: 1000). Un batch costituisce un'unica transazione e trattiene i blocchi per l'intera durata. | Invia le operazioni a blocchi; il messaggio specifica il limite e la quantità rilevata. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non supporta scritture atomiche su più collection, e un ciclo di scritture singole non risulterebbe atomico né eseguibile in un singolo round trip. | Invia le scritture come richieste separate, oppure tramite chiamate `/bulk` specifiche per collection. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite configurato di elementi. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o driver non supporta scritture in blocco (bulk). | Scrivi i record singolarmente. |
| `CALLBACK_REJECTED` | 400 / 403 | Una callback della collection ha rifiutato la scrittura. Un'eccezione (`throw`) da `beforeSave`/`beforeDelete`/`after*` genera un 400 contenente il messaggio definito dallo sviluppatore; un `beforeDelete` che restituisce `false` genera un 403. `details.stage` specifica la callback, `details.path` la collection. | Consulta il messaggio — è definito internamente al progetto, non da Rebase. |
| `CALLBACK_RECURSION` | 500 | Le scritture generate dagli hook hanno superato i 16 livelli di annidamento: la scrittura `context.data` di un hook richiama a sua volta gli hook di quella collection in modo ricorsivo e infinito — tipicamente un `afterSave` che aggiorna la riga corrente senza condizioni. L'intera operazione è stata annullata (rollback). Il messaggio riporta l'hook e la collection; `details.chain` elenca la sequenza hook → scrittura. | Condiziona la scrittura dell'hook: intervieni solo se `status === "new"`, o ignorala quando `values` contiene già i dati da scrivere. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Il cursore stabilisce già l'inizio della pagina, quindi aggiungere un offset salterebbe silenziosamente record oltre la posizione del cursore — creando un vuoto non visibile al chiamante nella risposta. | Usa solo uno dei due parametri. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una ricerca testuale o vettoriale. Entrambe assegnano un punteggio (score) per riga, quindi non esistono due righe identiche e `DISTINCT` non deduplicherebbe nulla — sembrerebbe funzionare senza sortire effetto. | Rimuovi uno dei due parametri. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` viene ordinata per una colonna che non compare nei risultati. Una query `SELECT DISTINCT` può essere ordinata solo per le colonne presenti nella lista di selezione, altrimenti l'ordine delle righe deduplicate risulta indefinito. `details.fields` le elenca. | Aggiungi questi campi a `?fields=`, o rimuovili da `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Il database non è raggiungibile: connessione rifiutata o interrotta, risoluzione host fallita, server in fase di avvio o arresto, o database chiuso a nuove connessioni (`ALLOW_CONNECTIONS false`, condizione che un comando `rebase db branch create --force` interrotto può lasciare sul sorgente; i log del server riportano il nome del database, e `rebase db branch list` lo riapre). L'errore viene restituito su tutti gli endpoint, inclusi login, route di amministrazione e socket realtime (frame `ERROR`). Inviato con header `Retry-After: 5`. Nella 0.24 lo stesso disservizio restituiva `ROLE_LOOKUP_FAILED`, `INTERNAL_ERROR` o 500 con codice `ECONNREFUSED`. | Riprova; l'SDK lo fa automaticamente. Controlla che il database sia attivo e raggiungibile dal server. |
| `DB_CONNECT_TIMEOUT` | 503 | L'apertura di una nuova connessione al database ha richiesto più tempo di `DB_POOL_CONNECT_TIMEOUT`: il database risponde lentamente o ha un'alta latenza di rete. Inviato con `Retry-After`. | Riprova; l'SDK lo fa in automatico. Verifica il carico sul database e la connettività di rete. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): policy di row-level security non valida per questo ruolo, o un comando `GRANT` mancante. | Consulta [Risoluzione dei problemi](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Tutte le connessioni nel pool del database sono rimaste occupate per l'intera durata di `DB_POOL_CONNECT_TIMEOUT`, impedendo alla richiesta di raggiungere il database. È causato dal carico e non da un malfunzionamento; inviato con `Retry-After`. Il server registra nei log la soluzione raccomandata una volta al minuto. | Riprova; l'SDK lo fa in automatico. Incrementa `DB_POOL_MAX` o individua query lente o transazioni prolungate che bloccano le connessioni. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` aggregata o `groupBy` include un campo non leggibile dai ruoli del chiamante (`access.read`), oppure un path annidato o un ordinamento aggregato specifica una relazione non visibile — o un operatore di campo (`$inc`, `$push`, …) punta a uno di essi, dove un vincolo non autorizzato rivelerebbe il valore memorizzato. Un campo escluso dalla risposta non deve poter essere esaminato da alcuna query, altrimenti il valore rimarrebbe deducibile singola condizione per volta. I filtri su relazioni (`author.salary`) e gli ordinamenti aggregati su campi relazionati (`max(staff.salary)`) vengono valutati in base alle regole della destinazione. `details.violations` elenca ogni campo non autorizzato. Un campo nascosto con `excludeFromApi` risponde come se non esistesse: un filtro, `orderBy`, `fields`, `include`, `select` aggregata, `groupBy` o `vector_search` che lo specifica riceve l'errore per campo inesistente (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), e nessun messaggio di errore elenca campi nascosti. | Rimuovi il campo dalla query o acquisisci il ruolo richiesto. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il payload tenta di modificare un campo non modificabile dai ruoli del chiamante (`access.write`). L'operazione viene respinta invece di ignorare il campo: omettere il campo silenziosamente restituirebbe un esito positivo per una modifica mai avvenuta. Lo stesso codice rifiuta scritture su un'entità padre che impostano relazioni su cui non si ha permesso di scrittura, e gli aggiornamenti che impostano valori su campi `softDelete` — solo l'eliminazione può valorizzarli. `details.violations` elenca ciascun campo. | Rimuovi il campo o acquisisci il ruolo appropriato. Un campo non modificabile da alcun utente restituisce `VALIDATION_EXCLUDED_FIELDS`. |
| `HISTORY_UNAVAILABLE` | 503 | Una scrittura su una collection con `history: true` è stata rifiutata perché non è stato possibile registrare la voce nello storico: il database non dispone della tabella `rebase.entity_history` o, per `openRebase` e `rebase console`, della funzione `rebase.record_history`. Nessun backend con cronologia attiva è stato avviato su questo database. Nessuna istruzione è stata eseguita, incluse le callback; le operazioni di lettura rimangono disponibili. Generato da `openRebase`, e restituito da backend inizializzati con `provision: false`. | Avvia il backend almeno una volta con la cronologia abilitata e `provision: true` (gestito in automatico da `rebase dev`), poi riprova. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una precedente richiesta con la stessa `Idempotency-Key` è attualmente in esecuzione. | Riprova al termine dell'operazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata riutilizzata per una richiesta differente: metodo, percorso, query string o payload diversi. | Usa una nuova chiave o invia nuovamente la richiesta originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` ha indicato una funzione diversa da `count`, `sum`, `avg`, `min` o `max`. | Utilizza una di queste; il messaggio ne include l'elenco. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce in `?select=` non rispetta il formato `fn(field)`, oppure è stata invocata una funzione diversa da `count()` senza specificare il campo. | Usa il formato `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Utilizzo di `offset`, `page` o `orderBy` su un'aggregazione priva di `groupBy`, o indicazione di un cursore su qualsiasi aggregazione. Un'aggregazione non raggruppata restituisce un'unica riga, e un gruppo non costituisce una sequenza su cui far scorrere un cursore. | Aggiungi `groupBy` o rimuovi i parametri; pagina i gruppi usando `offset` o `page`. Consulta [Aggregazioni](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Un'operazione in `/_batch` è priva di `op`, `collection`, `values` o `id`, specifica una collection non gestita da questo backend, o riutilizza un identificativo `ref`. | Consulta il messaggio; indica l'indice dell'operazione non valida. |
| `INVALID_BATCH_REF` | 400 | Un elemento `{ "$ref": "<name>.<field>" }` non corrisponde ad alcuna operazione precedente, fa riferimento a un passaggio successivo o richiede un campo non presente nella riga referenziata. Sono validi solo i riferimenti all'indietro. | Definisci l'operazione con `ref` *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | Il payload bulk non corrisponde al formato previsto. | Invia l'array previsto dalla route: `{ "rows": [...] }` su `POST /bulk`, `{ "updates": [{ "id", "data" }] }` su `PATCH /bulk`, `{ "ids": [...] }` su `POST /bulk/delete`. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert indica colonne senza garanzia di unicità, le specifica senza `upsert: true`, o viene inviato in una creazione annidata, dove la riga corrispondente verrebbe riassegnata al nuovo record padre. In questi casi Postgres restituirebbe l'errore 42P10 all'interno di una transazione parzialmente eseguita. Restituito anche per qualsiasi upsert sulla collection users (auth), dove creazione e modifica seguono regole differenti. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target validi. Sulla collection users, usa `POST` per creare e `PATCH` per aggiornare. |
| `INVALID_COUNT` | 400 | Il valore di `?count=` non è `exact` o `none`. Rifiutato anziché interpretato come default: un parametro errato come `?count=nnone` eseguirebbe il conteggio che si intendeva omettere. | Invia `exact` (predefinito) o `none`. Consulta [Omettere il conteggio](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Il cursore `after` non può essere interpretato o specifica un id non compatibile con le colonne chiave della collection: risulta troncato, ricodificato o generato manualmente. L'invio di un cursore valido associato a un `orderBy` differente da quello di emissione genera `CURSOR_ORDER_MISMATCH` (anch'esso 400). | Restituisci il valore `meta.nextCursor` della pagina precedente senza alterazioni, usando lo stesso `orderBy` o omettendolo. Consulta [Paginazione](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è impostato su `include` né su `only`. Rifiutato anziché ignorato: un valore errato come `?deleted=true` nasconderebbe le righe eliminate restituendo l'esito opposto a quello atteso. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Ometti il parametro per ottenere unicamente le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non corrisponde a `true` o `false`. | Invia uno di questi due valori; sono supportati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Un operatore `$inc` / `$push` / `$pull` / `$merge` è stato utilizzato su una proprietà non compatibile, con un operando non valido, combinando due operatori sullo stesso campo, con un errore di sintassi, o durante una creazione — operazione in cui non esiste un valore preesistente da elaborare. | Consulta [Scrittura via REST](/docs/backend/writes/#field-operations); il messaggio riporta il campo interessato. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro indica un campo non presente in questa collection. | Verifica la correttezza del nome rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato per il tipo di dato di questo campo — ad esempio `like` su un valore numerico o su una data. | Consulta [Esecuzione di query sui dati](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Il valore di filtro non può essere convertito nel tipo della colonna confrontata: `?id=eq.abc` su una chiave intera, un valore non presente nell'enum, un timestamp errato, o un numero oltre l'intervallo consentito. `details.dbCode` riporta il codice SQLSTATE. | Invia un valore compatibile con il tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | Il parametro `?hard=` non è `true` né `false`. Qualsiasi altro valore viene respinto anziché interpretato come "false" — un errore di battitura che applica un soft-delete a fronte di una richiesta di cancellazione definitiva lascerebbe intendere che i dati siano stati rimossi. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non rappresenta una lista di percorsi valida o contiene un oggetto opzioni per-relazione non conforme. Un percorso con più di tre livelli genera l'errore `INCLUDE_TOO_DEEP` (anch'esso 400). Rilevato all'ingresso anziché propagato dal driver come 500. | Consulta il messaggio; specifica il percorso non valido. |
| `INVALID_INPUT` | 400 | Il payload non ha superato la convalida. | Consulta il messaggio. |
| `INVALID_LIMIT` | 400 | `?limit=` non è un numero intero compreso tra 1 e il valore massimo ammesso (predefinito: 1000); valori superiori vengono respinti, non limitati al massimo. Una sottoscrizione realtime con limite fuori intervallo riceve lo stesso codice come frame `ERROR` WebSocket. | Riduci il limite e scorri i risultati tramite paginazione. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` / `?not=` è malformato o supera il livello di annidamento consentito. | Consulta il messaggio; illustra le regole di normalizzazione. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un numero intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non corrisponde a `field`, `field:desc`, `field:desc:last`, o a un array JSON di `{ field, direction, nulls }` — oppure indica una direzione diversa da `asc`/`desc` o un posizionamento NULL diverso da `first`/`last`. | Consulta il messaggio; mostra tutti i formati ammessi. |
| `INVALID_PAGE` | 400 | `?page=` non è un intero maggiore o uguale a 1. Le pagine partono da 1, quindi `?page=0` viene gestito come errore e non come prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro della query è malformato. | Consulta il messaggio. |
| `INVALID_QUERY_BODY` | 400 | Il corpo di `POST …/query` include un formato non valido per i parametri URL: una lista per un parametro a valore singolo (`fields`, `limit`, …), un oggetto per un filtro, o la duplicazione di un parametro presente anche nell'URL — `POST …/query` legge l'intera configurazione dal corpo. | Formatta i valori come nell'URL: stringa, o lista per filtri ripetuti; i parametri `where`, `include`, `orderBy` e `vector` richiedono JSON. Consulta [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non corrisponde a `cosine`, `l2` o `inner_product`. | Utilizza una di queste tre opzioni. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un valore numerico. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Un aggiornamento include per la chiave della riga un valore diverso da quello identificativo — nel corpo della richiesta o tramite `beforeSave`. Non è possibile modificare la chiave primaria di un record: i passaggi successivi alla scrittura (rilettura, `afterSave`, cronologia, realtime) fanno riferimento al record tramite la chiave originale. Rifiutato prima dell'esecuzione degli hook, senza applicare scritture, su qualsiasi interfaccia. `details.violations` elenca il campo. | Crea il record con la nuova chiave ed elimina quello preesistente. L'invio della chiave attuale è consentito. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata invocata senza `?select=`. | Specifica il parametro, es. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Il progetto non espone collection: nessuna dichiarazione nel codice e nessuna tabella da cui dedurle. Se le tabelle esistono ma non hanno la row-level security attiva, il messaggio le elenca indicando il comando SQL per abilitarla, e `details.unprotectedTables` ne riporta i nomi; nella 0.24 indicava l'assenza totale di tabelle. | Crea le tabelle necessarie — tramite migration, SQL, o file collection con `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga corrispondente a questo id nella collection — o riga nascosta al chiamante dalle regole di row-level security. | Verifica l'id, poi controlla le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica una relazione non definita sulla collection. Lo stesso codice restituisce **404** se il riferimento errato compare nel *percorso dell'URL*, ad esempio `/api/data/authors/1/posts` dove `authors` non dichiara tale relazione — in questo caso l'URL punta a una risorsa non esistente, costituendo un "not found" anziché una richiesta non valida. | Verifica il nome della relazione — il messaggio riporta quelle definite. Un back-reference deve essere esplicitamente dichiarato sul genitore per poter essere attraversato. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento specifica un campo non ordinabile. | Ordina su una proprietà mappata su colonna. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` è stato combinato con `?offset=` — oppure `page` con `offset` all'interno di un `find()`, combinazione che l'SDK client, l'istanza interna `rebase.data` e il client offline rifiutano con lo stesso codice prima dell'invio. Entrambi definiscono lo stesso intervallo, e in precedenza `page` sovrascriveva silenziosamente `offset` senza che il chiamante se ne accorgesse. | Utilizza solo uno dei due parametri. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo della richiesta supera la dimensione massima consentita. | Riduci la dimensione del payload o incrementa il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Una callback `afterRead` ha tentato un'operazione di scrittura. Le letture legate a una richiesta vengono eseguite in una transazione `READ ONLY`, pertanto né la callback né le funzioni da essa invocate possono scrivere. | Sposta la scrittura fuori dal flusso di lettura: usa un task in background o `rebase.dataAsAdmin` da un cron job o una custom function. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura conteneva un payload di associazione, ma il percorso non raggiunge la destinazione tramite una relazione `manyToMany` configurata con `through.properties` — non esiste quindi una tabella di giunzione su cui memorizzarlo. | Dichiara `through.properties` sulla relazione o rimuovi il payload dall'operazione. Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non è risolvibile rispetto allo schema registrato. L'operazione viene respinta invece di essere ignorata: ometterla confermerebbe il successo di una scrittura mai avvenuta, o restituirebbe insiemi vuoti per record effettivamente esistenti. | Esegui `rebase schema generate` se lo schema generato non è allineato allo stato del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | Non è possibile scollegare la relazione da questo lato dell'associazione. | Esegui la scrittura dal lato proprietario della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile, o un'operazione di create/update specifica una relazione `via` con salti multipli — sono scrivibili solo relazioni `via` a salto singolo. `details.fields` elenca le chiavi `via`. Nessun dato è stato scritto. | Modifica direttamente le righe collegate dalla catena. Consulta [Relazioni](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione definisce colonne sulla tabella di giunzione, ma la sorgente dati corrente non ne supporta la scrittura. | Il collegamento viene comunque creato; solo il payload associato non viene memorizzato. Verifica le funzionalità supportate dal driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | La scrittura della relazione non dispone di una chiave di origine a cui agganciare il collegamento. | Salva prima la riga genitore. |
| `RESULT_TOO_LARGE` | — | Un'istruzione inviata tramite `EXECUTE_SQL` su socket realtime — `admin.executeSql` da un client, letture del catalogo dal pannello di amministrazione — ha prodotto oltre 128 MB di dati, pertanto l'invio è stato bloccato. Notificato con un frame `ERROR` WebSocket. Le esecuzioni avviate dalla console SQL non vengono bloccate: mostrano le prime righe estratte. | Inserisci un `LIMIT` o seleziona un numero inferiore di colonne, leggendo i dati a blocchi. |
| `ROW_IN_TRASH` | 409 | La chiave specificata per l'upsert appartiene a un record presente nel cestino (un record eliminato con soft-delete mantiene la propria chiave). L'upsert non sovrascrive righe eliminate, su qualsiasi canale: parametri REST `?on_conflict=`, upsert in `/bulk` e `/_batch`, chiamate da SDK e socket realtime. Nessun dato è stato modificato. | Ripristina prima il record (aggiornando il campo di soft-delete a `null`), oppure cancellalo definitivamente con `?hard=true` e ripeti l'upsert. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabella o colonna attesa dal codice non esiste nel database. | Esegui `rebase db push` in ambiente di sviluppo; effettua un nuovo deploy su istanze gestite. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato associato a `orderBy: "_score"`. Il punteggio di rilevanza viene calcolato dinamicamente per ogni query e non è memorizzato su disco, pertanto non può essere usato come chiave per un cursore. | Scorri i risultati di rilevanza con `limit`/`offset`, o applica l'ordinamento su una colonna persistita. |
| `SQL_ERROR` | 400 | Il database ha rifiutato l'istruzione SQL inviata. Tramite `EXECUTE_SQL` su socket realtime viene restituito un frame `ERROR` con il messaggio di errore del database. `POST /api/admin/sql/csv` lo restituisce prima dell'invio del file in caso di: errore di sintassi, tentativo di scrittura (il download opera in sola lettura), presenza di query multiple o selezione di un ruolo non consentito per la connessione. | Correggi l'istruzione SQL. L'esportazione accetta una singola istruzione tra `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `TENANT_IMMUTABLE` | 400 | La scrittura comporterebbe lo spostamento di una riga da un tenant a un altro. Non è consentito cambiare il tenant di un record. `details.violations` riporta il campo. | Crea il record nel nuovo tenant ed elimina il precedente, o esegui l'operazione con un ruolo incluso in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | L'operazione indica un tenant a cui il chiamante non appartiene; l'operazione verrebbe comunque respinta dal database. | Scrivi all'interno del tenant di appartenenza o autenticati con credenziali associate ad esso. |
| `TENANT_REQUIRED` | 400 | La collection è vincolata a un tenant ma non è possibile risalire al tenant: la richiesta non ne include alcuno o l'utente appartiene a più tenant contemporaneamente. | Passa esplicitamente il campo tenant, o autenticati come chiamante associato a un unico tenant. |
| `TRANSACTION_ABORTED` | 500 | Un'istruzione nella transazione di scrittura è fallita e una callback ha intercettato l'eccezione. Postgres aveva già impostato la transazione in stato di abort, con conseguente rollback della scrittura e mancato salvataggio dei dati. Solo le operazioni `context.data` di inserimento, modifica o eliminazione respinte dal database vengono isolate e possono essere gestite in sicurezza con un catch. | Lascia propagare l'errore o valida i dati prima dell'esecuzione dell'istruzione. Consulta [Semantica delle transazioni](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` include un campo non presente nella collection. | Verifica la digitazione; il messaggio riporta i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o una clausola `groupBy` indica un campo inesistente nella collection. | Verifica la digitazione; il messaggio riporta i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo non esistente nella collection (o nell'oggetto della relazione), o nascosto tramite `excludeFromApi`. | Verifica la digitazione; il messaggio riporta i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro usa un operatore non riconosciuto. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket realtime presenta un valore di `type` non supportato dal server. Viene restituito un frame `ERROR` contenente il `requestId` originale, permettendo la chiusura della richiesta senza attendere il timeout. | Verifica il `type` del frame; il messaggio indica il valore ricevuto. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento specifica un campo non presente nella collection. | Verifica la digitazione; il messaggio riporta i campi validi. |
| `PRECONDITION_FAILED` | 412 | L'header `If-Match` fa riferimento a una versione del record non più attuale: sono state applicate modifiche tra la lettura e la richiesta di scrittura corrente. Nessun dato è stato salvato. | Leggi nuovamente il record, riapplica le modifiche e invia la richiesta con il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | Il parametro `?fields=` richiede un campo non definito nella collection. | Verifica la digitazione; il messaggio riporta i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è configurata come `vector` per questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il valore di `Content-Type` fornito non è accettato da questa route. | Invia il formato documentato per la route. |
| `UNSUPPORTED_OPTION` | — | Sollevato come eccezione, non restituito via HTTP: una scrittura eseguita tramite accessor interno (`context.data` in una callback, `rebase.data` in una funzione o cron) ha specificato `ifMatch` o `idempotencyKey`. Questo canale non dispone di verifica precondizioni o store per l'idempotenza, quindi l'opzione viene bloccata preventivamente prima della scrittura anziché essere ignorata. | Rimuovi l'opzione nel codice interno, o esegui la scrittura tramite client HTTP, che gestisce entrambe le funzionalità. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è configurato in un'unica direzione, impedendo la correlazione con una sottoquery inversa. | Applica il filtro dal lato proprietario della relazione. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è supportato per il campo indicato: una relazione priva di colonna locale sul record viene filtrata per appartenenza, e gli operatori su pattern (`like`, `ilike` e relative negazioni) operano esclusivamente su valori testuali. | Consulta il messaggio; riporta i valori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore viola una regola di `validation` definita sulla proprietà — lunghezza, intervallo, espressione regolare, campo obbligatorio. | Consulta il messaggio; elenca nel dettaglio le violazioni rilevate. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il payload tenta di scrivere su una colonna contrassegnata con `excludeFromApi` o `access: { write: [] }` — due sintassi per la medesima regola. La gestione di questi campi è riservata al server: hash di password, token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questo errore si applica a qualsiasi chiamante, compreso il ruolo `admin`. | Rimuovi il campo dal payload. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Il valore non è compatibile con il tipo definito per la proprietà. | Consulta il messaggio; indica la proprietà interessata. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo della richiesta contiene campi non presenti nella collection — inclusa la presenza di un argomento `id` in una collection la cui chiave primaria è basata su un altro attributo. | Verifica la correttezza dei nomi; il messaggio elenca i campi riconosciuti. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | È stato combinato un cursore (`after` / `startAfter`) con una ricerca vettoriale. I risultati sono ordinati in base a una distanza calcolata al momento della query, che non può fungere da cursore persistente; una ricerca vettoriale non restituisce pertanto `nextCursor`. | Scorri i risultati per prossimità usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha bloccato la scrittura. | Controlla le `securityRules` impostate sulla collection. |

## `PG_<SQLSTATE>` — vincolo respinto dal database

Una scrittura respinta da Postgres a causa di *dati non validi forniti dal chiamante*
restituisce il valore SQLSTATE all'interno del codice: `PG_23505`, `PG_23503`, e così via.
Si tratta di un pattern, non di un elenco statico — Postgres contempla centinaia di codici SQLSTATE — ma solo due
classi possono generare questo formato, essendo le uniche imputabili ai dati inviati dal client:

- **classe 23**, violazione di vincoli di integrità: record duplicato, foreign key verso
  un record inesistente, colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: valore non compatibile con il tipo di dato della colonna.

Qualsiasi altra condizione — disconnessione, colonna mancante, errore di privilegi —
è considerata anomalia del server e viene restituita come `500`. Di conseguenza, `code.startsWith("PG_")` rappresenta un controllo affidabile
per identificare che "i dati inviati non sono corretti", e i quattro casi seguenti sono quelli
riscontrati più frequentemente dai client. `details.dbCode` riporta lo stesso codice SQLSTATE per tutti, e
il messaggio specifica il vincolo violato.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Impossibile convertire il valore nel tipo richiesto dalla colonna — equivalente in fase di scrittura di `INVALID_FILTER_VALUE`. | Invia un valore conforme al tipo della colonna. |
| `PG_23502` | 400 | Una colonna con vincolo `NOT NULL` è stata lasciata priva di valore. | Invia il campo richiesto o imposta un valore di default sulla colonna. |
| `PG_23503` | 400 / 409 | In fase di salvataggio, una foreign key punta a una riga inesistente (400). In fase di cancellazione, altri record dipendono ancora da questo (409; un vincolo `RESTRICT` genera `PG_23001`, anch'esso 409). | Crea prima il record di destinazione o correggi l'id; per l'eliminazione, rimuovi o riassocia preventivamente le righe collegate. |
| `PG_23505` | 409 | Violazione di un vincolo di unicità. Il messaggio specifica il nome del vincolo. | Utilizza un valore differente o aggiorna il record esistente. |

## Storage

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Il parametro `maxResults` per l'elenco dei file non è un intero maggiore o uguale a 1, oppure `pageToken` non è un token emesso dalla sorgente. In passato una dimensione di pagina inferiore a 1 restituiva una pagina vuota con lo stesso token, generando un loop infinito nei cicli `while (pageToken)`. | Invia un valore positivo per `maxResults` e ripassa `nextPageToken` senza alterazioni. |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket non è conforme. | Verifica la correttezza del nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata, tenta di uscire dal prefisso assegnato, o risiede sotto un prefisso riservato (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifica la chiave specificata. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri per la trasformazione delle immagini sono fuori intervallo o incompatibili tra loro. | Consulta la sezione [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Il file caricato supera il valore `maxSize` definito per la proprietà target. Controllo applicato lato server, non solo all'interno del browser. `details` specifica la proprietà, il limite massimo e la dimensione riscontrata. | Carica un file di dimensioni inferiori o incrementa `maxSize` nella proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il MIME type del file non rientra nell'elenco `acceptedFiles` della proprietà, o in `allowedMimeTypes` della storage source. `details` riporta la proprietà (o la lista della sorgente), i tipi accettati e il content-type ricevuto. | Carica un tipo di file supportato o amplia `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | Il bucket S3 o GCS configurato non esiste, o il provider ha rifiutato le credenziali fornite per questa istanza. Il messaggio riporta il nome del bucket; `details.reason` contiene `NoSuchBucket` o il messaggio di errore del provider. In precedenza un bucket mancante veniva segnalato come "file non trovato" per ciascun file. | Correggi il nome del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` per sorgenti con nome) o verifica i permessi delle credenziali. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nessun backend di storage configurato su questo server, oppure non esiste una sorgente predefinita e la richiesta non specifica il parametro storage source; il messaggio riporta le sorgenti registrate (501). Un upload con ripresa la cui sorgente viene rimossa prima del completamento restituisce 503. | Configura S3, GCS o lo storage locale, o specifica la sorgente tramite `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Invocazione di `POST /api/admin/storage/move` con opzione `deleteSource` (`rebase storage move --delete-source`) tra due sorgenti che condividono lo stesso bucket o la medesima directory. Trattandosi della stessa posizione fisica, ogni file risulterebbe già presente nella destinazione, e l'eliminazione del file sorgente cancellerebbe l'unica copia esistente. Nessun file è stato spostato o cancellato. | Aggiorna la proprietà facendola puntare all'altra sorgente: i file sono già disponibili lì. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) non ha potuto scansionare tutte le collection; i file referenziati dalle collection non lette rischierebbero di apparire orfani. Usando `?scan=`, la scansione indicata è quella che non ha completato la lettura di tutte le collection. Nessun elemento è stato eliminato; `details.unscanned` elenca le collection interessate e la causa. | Risolvi gli errori che impediscono la lettura di queste collection e riesegui la procedura. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione non presente nella sorgente. Le scansioni sono conservate per 7 giorni all'interno della sorgente analizzata; specificare uno `storageId` diverso da quello della scansione restituisce ugualmente risorsa non trovata. | Fornisci lo `storageId` corretto per la scansione o avvia una nuova analisi. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione con stato `queued`, `running` o `failed`. Nessun file è stato eliminato; `details.status` riporta lo stato corrente. | Attendi il completamento della scansione o avviarne una nuova. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione terminata da oltre 15 minuti. Nessun file è stato eliminato. | Avvia una nuova scansione ed esegui la cancellazione a partire da quest'ultima. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione i cui elementi orfani sono già in fase di eliminazione. | Verifica lo stato di avanzamento della rimozione con `GET /api/admin/storage/orphans/scans/:id` controllando il campo `deletion`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La storage source è definita nel codice ma priva delle necessarie credenziali in questo ambiente. | Configura le variabili d'ambiente per questa sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto l'operazione di scrittura. | Consulta i log e verifica le credenziali del servizio di storage. |
| `TRANSFORM_OVERLOADED` | 503 | Raggiunto il limite massimo di elaborazioni simultanee per le trasformazioni di immagini. | Riprova più tardi; valuta l'adozione di un layer CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La richiesta specifica una storage source (`?storageId=`) non configurata nel progetto. Se l'istanza non gestisce un determinato `bucket`, viene restituito lo stesso codice con stato **404** (in operazioni di list, upload singolo, directory o upload con ripresa verso S3/GCS) — ad essere assente è l'archivio stesso; `details` elenca i bucket e le sorgenti disponibili. In precedenza entrambi i casi rispondevano con "file non trovato", indistinguibile dall'assenza del singolo oggetto. | Definisci la sorgente in `config/resources.ts` o verifica l'elenco su `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Una richiesta `PATCH` per un upload con ripresa è giunta mentre la ricezione di un blocco precedente era ancora in corso — scenario tipicamente causato da un client che ripete l'invio del blocco prima della risposta. La richiesta viene respinta anziché accodata, in conformità al comportamento di tusd. | Recupera l'offset corrente tramite `HEAD /api/storage/tus/:id` e riprendi il trasferimento da quel punto; il client tus-js-client implementa automaticamente strategie di backoff e retry. Consulta [Upload con ripresa (TUS)](/docs/backend/storage-resumable-uploads/). |

## Custom functions

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione registrata con questo nome — oppure la funzione esiste ma i percorsi interni non includono il sub-path richiesto. Ai chiamanti autenticati viene mostrato l'elenco delle funzioni *effettivamente* disponibili; ai chiamanti anonimi no, per non esporre la mappatura degli endpoint interni. Se il file della funzione ha fallito il caricamento, il messaggio informa l'utente autenticato indicando il file coinvolto: utile a distinguere un refuso da un problema di deploy. Ai chiamanti anonimi viene restituito il semplice messaggio di risorsa inesistente. | Verifica il nome tramite `GET /api/functions` o consulta i log di avvio per identificare eventuali moduli non caricati. |
| `FUNCTION_TIMEOUT` | 504 | L'esecuzione dell'handler ha superato il tempo massimo previsto. L'elaborazione rimane in esecuzione in background e non può essere interrotta dal server chiamante. | Implementa un `AbortSignal` sulle chiamate esterne o aumenta il valore di `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo inoltra le chiamate a un'altra istanza dedicata alle funzioni, che non ha risposto. | Verifica che il processo responsabile delle funzioni sia attivo e operativo. |

## Cron jobs

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | È stato avviato manualmente un cron job già in corso di esecuzione — sullo stesso processo o su un altro nodo che detiene il lock di esecuzione (run lease), ad esempio un processo worker separato dall'istanza `api`. Nessuna nuova istanza è stata eseguita. L'evento di skip viene tracciato nella cronologia del task; `details.log` riporta la voce di riferimento indicando il nome del processo attualmente in esecuzione. | Riprova al termine dell'esecuzione corrente. Consulta [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Pannello di amministrazione e modifica dello schema

Questi codici segnalano che una funzionalità è disabilitata o non configurata,
non che la richiesta in sé sia errata. Ciascuno di essi viene segnalato anche
sulla rispettiva route `/status` con stato `200`, consentendo alle interfacce grafiche
di disattivare visivamente i componenti corrispondenti anziché mostrare un errore generico.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata interrogata un'interfaccia riservata agli amministratori su un'istanza priva di configurazione di autenticazione, rendendo impossibile distinguere un amministratore da un chiamante non autenticato. | Definisci `auth.jwtSecret` o fornisci un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` ha ricevuto il fingerprint di un diff non più valido: il branch o il suo genitore hanno subito modifiche nel frattempo. Nessuna modifica applicata. | Ricalcola il diff, esaminalo ed esegui il merge specificando il nuovo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La sorgente dati non è in grado di calcolare il diff tra branch: non supporta SQL o mancano le funzionalità di branching (connessione admin non configurata). | Utilizza un'istanza Postgres impostando `adminConnectionString`. |
| `BRANCH_MERGE_BLOCKED` | 409 | Impossibile effettuare il merge di una tabella che presenta differenze strutturali — tabella creata o eliminata nel branch, discrepanze nelle colonne o nella primary key, assenza di primary key, numero di righe troppo elevato per il confronto, o riscrittura della tabella dopo la creazione del branch (`TABLE_REWRITTEN`). Una tabella per cui non è stato possibile confrontare i record blocca l'operazione anche qualora il conteggio mostri 0: i dati risultano indeterminati, non nulli. `details.tables` elenca le tabelle bloccanti e le motivazioni. Nessun dato modificato. | Allinea lo schema tramite migration prima di procedere, oppure includi `skipBlocked: true` per escludere tali tabelle dal merge. |
| `BRANCH_MERGE_CONFLICT` | 409 | Sono state riscontrate modifiche concorrenti sulle stesse righe tra branch e genitore e l'opzione `onConflict` era impostata su `"abort"` (default); oppure il genitore ha respinto parte dell'unione — riga modificata contemporaneamente, blocco da trigger o oscurata da policy di sicurezza. Nessun dato modificato. | Risolvi il conflitto scegliendo la versione prioritaria tramite `onConflict: "branch"` o `"target"`, oppure ricalcola il diff. |
| `BRANCH_MERGE_FAILED` | 409 | Il genitore ha respinto i record del branch durante l'istruzione di merge — per violazione di vincoli, valori enum non ammessi o foreign key non risolte, tipicamente imputabili a disallineamenti tra i due schemi. `details` include `sqlState`, `table`, `constraint` e `detail`. Nessuna modifica applicata. | Analizza le variazioni di schema nel diff, allinea lo schema del genitore mediante le opportune migration, o correggi i dati sul branch prima di tentare nuovamente il merge. |
| `BRANCH_NOT_FOUND` | 404 | Nessun branch registrato con questo nome. | Usa `rebase db branch list` o consulta la sezione Branches per visualizzare l'elenco dei branch disponibili. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto del progetto viene esposto solo in presenza di autenticazione configurata — contiene infatti la specifica dettagliata di tutte le tabelle e relazioni. | Configura l'autenticazione. L'endpoint `/meta/schema-version` rimane invece sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Casella di posta per lo sviluppo non attiva. I messaggi email vengono intercettati unicamente se `SMTP_HOST` non è configurato e `NODE_ENV` non è impostato su production. | Rimuovi la variabile `SMTP_HOST` in ambiente di sviluppo, o consulta la casella email reale. |
| `INVALID_CHANGE` | 400 | La proposta di modifica dello schema non è strutturata correttamente. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione della modifica pianificata allo schema è fallita per cause non coperte da codici più specifici. | Consulta il messaggio; riporta integralmente l'errore originario del database. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è formalmente valida ma non applicabile allo stato corrente dello schema. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non salvate (uncommitted), che impediscono l'applicazione sicura delle variazioni allo schema. | Esegui un commit o uno stash delle modifiche, poi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha respinto l'operazione. | Consulta il messaggio; riporta la motivazione specifica generata dall'editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra identità automatizzata ha tentato di modificare lo schema. | Effettua l'accesso come utente reale, o abilita `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica a caldo dello schema richiede la configurazione di `collectionsDir` o di `liveSchema.repository`, entrambe assenti all'avvio del server. | Configura almeno una di queste opzioni. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La fase di pianificazione è supportata, ma non è presente un repository su cui eseguire il commit delle modifiche. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Questa istanza è configurata per non apportare modifiche strutturali al database (`REBASE_PROVISION=false`), rendendo impossibile l'applicazione da pannello. | Effettua il commit a livello di codice e lascia che sia il processo preposto alle modifiche strutturali ad applicarle. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Il driver corrente non è in grado di pianificare variazioni di schema. | La modifica in tempo reale dello schema è supportata solo su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | In questo ambiente le collection vengono dedotte per introspezione diretta dal database, escludendo l'esistenza di file sorgente modificabili. | Applica le variazioni allo schema tramite script di migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disabilitato per questo server. Le build in bundle rispondono sempre con questo codice. | Abilita la funzionalità tramite `schemaEditor`. Su una build bundle, imposta `REBASE_LIVE_SCHEMA_REPOSITORY` per consentire la modifica delle collection tramite repository — consulta [Modifica in tempo reale dello schema](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema necessita della dipendenza `ts-morph`, che non risulta installata. | Aggiungila alle dipendenze del pacchetto backend e riavvia: `pnpm --dir backend add -D ts-morph@28.0.0` dalla root del progetto scaffoldato, oppure `pnpm add -D ts-morph@28.0.0` se la directory corrente corrisponde al backend. Il messaggio mostra il comando per il tuo ambiente. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non ha una directory `collectionsDir` configurata, rendendo impossibile la scrittura dei file da parte dell'editor. | Definisci il parametro `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato quando `NODE_ENV=production`: i file di un server in produzione vengono ricreati dal repository a ogni deploy, rendendo vane le modifiche locali. | Modifica le collection in sviluppo ed effettua il deploy, oppure configura `liveSchema.repository` per registrarle direttamente su repository. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` non può eseguire lo streaming dell'output: il database di sviluppo in-memory (PGlite) offre una sola connessione, e l'apertura di un cursore per tutta la durata del download bloccherebbe qualsiasi altra query; in alternativa, la sorgente dati non implementa i cursori SQL. | Imposta `DATABASE_URL` puntando a un'istanza Postgres indipendente (`rebase dev --docker` ne inizializza una), o usa una clausola `LIMIT` per esportare i dati visibili a schermo. |

### Perché una tabella di un branch non può essere unita

`BRANCH_MERGE_BLOCKED` elenca nel campo `details.tables` ogni tabella non unibile,
associandola a uno di questi codici. Lo stesso identificatore è presente nell'attributo
`blocked` della tabella all'interno del diff, consentendo a Studio di segnalare l'impossibilità
prima che l'utente scelga l'azione **Merge**. Nessuno di questi codici rappresenta
una risposta HTTP indipendente.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Le colonne della tabella differiscono tra il branch e il genitore. La comparazione dei record si basa esclusivamente sulle colonne condivise. | Aggiungi le colonne mancanti al database genitore applicando le opportune migration (`rebase db push`), quindi procedi con il merge. Una migration che riscrive interamente la struttura della tabella — come un cambio di tipo su una colonna — trasforma lo stato in `TABLE_REWRITTEN`: completa il merge prima di applicarla, o ricrea il branch successivamente. |
| `NO_PRIMARY_KEY` | — | La tabella non possiede una primary key, impedendo il confronto riga per riga; il diff può mostrare soltanto il conteggio totale dei record. | Aggiungi una chiave primaria alla tabella, o trasferisci i record manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Le colonne che compongono la chiave primaria, o i loro tipi, non coincidono tra i due ambienti. | Allinea preventivamente lo schema sul genitore. |
| `TABLE_ADDED` | — | La tabella è stata creata sul branch. Un'operazione di merge non prevede la creazione di tabelle. | Creala sul genitore tramite migration prima di unire i dati. |
| `TABLE_DROPPED` | — | La tabella è stata rimossa sul branch. Un'operazione di merge non prevede l'eliminazione di tabelle. | Rimuovila sul genitore applicando le apposite migration. |
| `TABLE_REWRITTEN` | — | Tutte le righe della tabella sono state riscritte integralmente su uno dei due lati dopo la creazione del branch — a seguito di un cambio di tipo, un `ADD COLUMN` con default volatile, `VACUUM FULL`, `CLUSTER` — facendo apparire ogni record come modificato e rendendo impossibile tracciare le modifiche specifiche. | Esegui il merge del branch prima di applicare migration di questo tipo, oppure ricrea il branch partendo dal genitore aggiornato. |
| `TOO_LARGE` | — | Il volume di record presenti nella tabella su uno dei lati supera la soglia massima per il confronto analitico (predefinito: 100.000, `maxRowsPerTable`). | Aumenta il parametro `maxRowsPerTable` sia nel diff che nel merge, oppure migra i dati con strumenti alternativi. |

## Codici generici

Una route ricorre a questi codici in assenza di un errore più specifico.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Richiesta non valida, e nessun codice più specifico risulta applicabile. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Mancanza di autenticazione, o credenziali non accettate. | Effettua l'accesso o esegui il refresh. |
| `FORBIDDEN` | 403 | Richiesta autenticata, ma priva dei permessi necessari. | Ripetere la richiesta con la medesima identità non risolverà il problema. |
| `CONFLICT` | 409 | Conflitto con lo stato attuale delle risorse. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Errore interno durante l'elaborazione sul server. Il messaggio è volutamente generico. | Comunica il valore `requestId`; la causa dettagliata è registrata nei log. |
| `NOT_CONFIGURED` | 503 | Una risorsa o dipendenza necessaria per questa route non risulta configurata sul server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Un servizio dipendente non è raggiungibile: un bucket S3 o MinIO, o un host invocato via `fetch()` da una funzione che rifiuta la connessione o non è risolvibile. I log del server indicano l'host interessato; la risposta al client non lo specifica. Un database non raggiungibile restituisce `DATABASE_UNAVAILABLE`. Un errore di connessione verso tali servizi produce questo errore; nella 0.24 veniva restituito un `500` con codice associato all'errore di rete (`ECONNREFUSED`), o `INTERNAL_ERROR`. | Riprova; verifica i log di sistema. |

## Mantenere aggiornata questa pagina

Il comando `pnpm verify:docs` fallisce se un codice sollevabile dal server non è documentato
in queste tabelle, se viene inclusa una voce non generata da alcun componente, se gli stati associati
a un codice non coincidono con quelli reali generati dal codice sorgente, o se una famiglia di codici come `PG_<SQLSTATE>` non include
una casistica gestita per i chiamanti. Lo script di controllo è situato in
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Il processo esegue preventivamente un'autoverifica. L'analisi esamina i codici direttamente dal codice TypeScript
anziché interrogare un'istanza runtime del server; di conseguenza, eventuali limiti del parser rimarrebbero non rilevati per costruzione: in passato
lo script non identificava codici restituiti tramite wrapper a riga singola o codici posizionati dopo un messaggio
contenente una parentesi `)`, certificando la correttezza della documentazione a fronte di diciassette codici mancanti.
Per questa ragione la suite esegue una fixture mirata su queste casistiche prima di analizzare la documentazione,
bloccando l'esecuzione se il parser non è in grado di individuarle tutte.
