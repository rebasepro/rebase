---
sourceHash: 6f63c3908efa23c5
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il relativo stato HTTP, significato e cosa fare — oltre all'envelope della risposta, X-Request-ID e le regole per details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e include un `code`
stabile. Il codice è l'elemento su cui eseguire le diramazioni logiche (branching): il messaggio è scritto per un essere umano
e può essere riformulato, lo stato è condiviso da decine di problemi diversi,
mentre il codice non è nessuna delle due cose.

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

- **`message`** — leggibile dall'uomo. Per un `4xx` è il messaggio specifico del server; per
  un `5xx` è volutamente generico, poiché il testo sottostante potrebbe citare un
  host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori sottostanti. Stabile tra minor version.
- **`details`** — opzionale e mai garantito. Vedi le regole sotto.
- **`requestId`** — presente ogni volta che la richiesta è passata attraverso il middleware
  per il request-ID, ossia per ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante
quando è un UUID, altrimenti uno nuovo. Viene restituito nella
risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e
associato alla riga di log del server per tale richiesta.

Questa è la chiave di correlazione (join key). Includila in una segnalazione di bug e un operatore potrà trovare l'unica
riga di log che spiega il fallimento, contenente il motivo che non è mai stato
mostrato al client.

Inviare il proprio ID è il modo in cui una traccia sopravvive a un hop di rete: un gateway o un job runner che
inoltra l'header ottiene un singolo ID valido per tutti i servizi che hanno gestito la richiesta.
Un valore non valido viene ignorato anziché rifiutato — non vale la pena
far fallire una richiesta per un header malformato inviato dal chiamante — quindi non dare per scontato che l'ID inviato sia
l'ID ricevuto. Leggi l'header della risposta.

### Cosa contiene `details`

`details` ha uno scopo diagnostico, non contrattuale. È regolato da tre regole:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Questi sono gli
   errori del chiamante descritti con precisione: quale campo di filtro era sconosciuto,
   quale relazione non è scrivibile, quale valore non corrispondeva al suo tipo.
2. **I dati diagnostici del database vengono ridotti in produzione.** Quando il fallimento proviene
   da Postgres, `details.dbCode` — il valore SQLSTATE — è sempre presente: indica
   la classe del problema e non rivela nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   poiché Postgres include in essi i contenuti delle righe. `23505` segnala
   `Key (email)=(a@b.c) already exists.`, che risponderebbe a "questa persona è
   registrata?" per qualsiasi indirizzo chiunque decida di provare.
3. **Non basare mai la logica condizionale su `details`.** Basa i branch su `code`. Il contenuto di `details` è
   semplicemente ciò che risultava utile a una persona in quel punto di chiamata, ed è soggetto a modifiche.

## Interpretare uno stato

| Stato | Cosa dice sulla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticata, o credenziali scadute. Accedi o rinnova la sessione. |
| `403` | Autenticata, ma non autorizzata. Riprovare con la stessa identità non servirà. |
| `404` | Route, tabella o riga inesistente — oppure una riga nascosta dalla sicurezza a livello di riga (RLS). |
| `409` | Un conflitto con lo stato esistente: un duplicato o una scrittura simultanea. |
| `413` `415` `422` | Il corpo è troppo grande, ha un tipo di media errato o è stato rifiutato semanticamente. |
| `429` | Rate limit raggiunto. Rallenta le richieste; il messaggio indica per quanto tempo attendere. |
| `500` | L'errore è del server o del suo database, non del chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può gestirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza era irraggiungibile, non configurata o troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa la verifica MFA, quindi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nulla — lo stato desiderato è già valido. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | L'account in fase di modifica, ripristino o eliminazione possiede un ruolo o uno scope che il chiamante non ha. `details.beyond` li elenca. | Chiedi a qualcuno che li possiede di effettuare la modifica. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sessione ospite ha tentato di approvare un accesso da dispositivo. Un ospite non ha un account da associare a un dispositivo. | Accedi con un account, quindi approva l'accesso. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di elencare, creare, modificare o revocare chiavi API, del suo stesso tipo o personali. | Gestisci le chiavi come utente in possesso di `keys:write`, o con la service key. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione Rebase a monte, quindi le credenziali del chiamante non sono mai state esaminate. | Esegui il mount dell'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Accedi prima. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è consentito solo per il primissimo utente, e questo non lo è. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi un nuovo challenge. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati inseriti per un unico challenge MFA. | Avvia un nuovo challenge. |
| `DEVICE_LOGIN_DECIDED` | 409 | L'accesso da dispositivo è già stato approvato o rifiutato. L'accesso può essere deciso una sola volta. | Avviane uno nuovo sul dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | L'accesso da dispositivo ha superato i dieci minuti di validità prima di essere deciso. | Avviane uno nuovo sul dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nessun accesso da dispositivo corrisponde a quel codice utente. Il polling del dispositivo risponde invece con i codici in minuscolo di RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Confronta il codice con quello mostrato sul dispositivo. |
| `EMAIL_EXISTS` | 409 | Un account con quell'indirizzo esiste già — in fase di registrazione, durante un cambio indirizzo, o seguendo un link di cambio indirizzo dopo che un altro account ha occupato l'indirizzo nel frattempo. | Accedi, oppure avvia un ripristino password; per un cambio di indirizzo, scegline un altro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP e il server non ha un trasporto email configurato. | Configura SMTP o usa un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | L'accesso OAuth ha trovato un account con lo stesso indirizzo, ma il provider non ha verificato tale indirizzo, quindi non è stato collegato. | Accedi con il metodo esistente, quindi invia `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma non è mai stato confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollegala prima dall'altro account. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una richiesta ha inviato `x-rebase-impersonate` e il chiamante non ha il permesso di eseguire richieste impersonando un altro utente. Può farlo solo la sessione di un amministratore autenticato, mai una chiave API o la service key. | Inviala con la sessione di un amministratore, oppure ometti l'header. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` è stato inviato vuoto. | Invia l'uid dell'utente da impersonare, oppure ometti l'header. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` non indica alcun utente attivo: nessun account ha quell'uid, oppure l'account è disabilitato. | Controlla l'uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | L'autenticazione di questo backend non può eseguire richieste impersonando un altro utente, poiché il suo `AuthAdapter` non implementa `resolveUser`. | Implementa `resolveUser` nell'adapter, oppure ometti l'header. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` è stato inviato a una route che non supporta l'impersonificazione. Solo la data API e le funzioni personalizzate lo supportano; il socket realtime supporta `impersonate` su `AUTHENTICATE`. | Invia la richiesta senza l'header. |
| `SIMULATION_FORBIDDEN` | 403 | Una richiesta ha inviato un header `x-rebase-simulate-*` (il simulatore RLS) o ha interrogato `/api/admin/rls-simulator`, e il chiamante non può simulare accessi. Solo la sessione di un amministratore autenticato può farlo, mai una chiave API o la service key. | Inviala con la sessione di un amministratore, oppure ometti gli header. |
| `SIMULATION_INVALID` | 400 | La simulazione era malformata: un header inviato vuoto, `x-rebase-simulate-api-key-id` combinato con un ruolo o user id, oppure una simulazione combinata con `x-rebase-impersonate`. | Specifica un solo ruolo (opzionalmente con un uid), un solo user id, o un solo id di chiave API. |
| `SIMULATION_READ_ONLY` | 403 | Una scrittura, eliminazione, `_batch`, ripristino della cronologia o una funzione personalizzata chiamata con qualsiasi verbo diverso da `GET`/`HEAD`/`OPTIONS` conteneva un header `x-rebase-simulate-*`. L'accesso simulato è in sola lettura: la scrittura verrebbe eseguita come identità simulata, non come amministratore. Le letture, inclusi `POST …/query` e `…/count`, vengono comunque eseguite. | Interrompi la simulazione per apportare modifiche. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulazione indica un utente non attivo (uno user id inviato senza ruolo) o una chiave API non attiva. | Controlla l'id, o invia un ruolo insieme all'uid per simulare un uid sprovvisto di account. |
| `SIMULATION_UNAVAILABLE` | 501 | Questo backend non può simulare l'accesso: il suo `AuthAdapter` non ha `resolveUser` per confermare un amministratore, oppure è stata indicata una chiave su un backend privo di chiavi API. | Implementa `resolveUser`, oppure ometti gli header. |
| `SIMULATION_UNSUPPORTED` | 400 | Un header `x-rebase-simulate-*` è stato inviato a una route che non supporta l'accesso simulato. Solo l'API dati e le funzioni personalizzate li supportano. | Invia la richiesta senza gli header. |
| `GUEST_REFERENCED` | 409 | Impossibile eliminare un ospite perché una riga del progetto lo richiede, tramite una foreign key con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo segnala per ospite in `skipped` e prosegue. | Elimina la riga, oppure lascia l'ospite. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può agire. | Vedi il messaggio. |
| `INVALID_CHALLENGE` | 400 | Il challenge MFA è sconosciuto o scaduto. | Avviane uno nuovo. |
| `INVALID_CODE` | 400 / 401 | Il codice OTP o MFA è errato: 400 per l'accesso con codice email (`/auth/otp/verify`), 401 per la registrazione o il challenge MFA. | Riprova con il codice corrente. |
| `INVALID_CREDENTIALS` | 401 | Email o password errate — volutamente non specificato quale delle due. | Riprova, o reimposta la password. |
| `INVALID_PLATFORM_TOKEN` | 401 | Un platform token `rpt_` è stato rifiutato: firma non valida, audience errata, scaduto o durata superiore al limite massimo. Il messaggio indica quale. | Fai generare un nuovo token dalla piattaforma — su Rebase Cloud, esegui nuovamente il comando. |
| `INVALID_SCOPES` | 400 | È stato richiesto uno scope non valido per una chiave: malformato, sconosciuto o con un target non supportato dallo scope. `details.problems` indica quali e perché; `details.validScopes` elenca gli scope che una chiave può possedere. Esclude `keys:read` e `keys:write`, che nessuna chiave può possedere. | Usa un nome dall'elenco. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token di verifica, ripristino, magic link o cambio indirizzo è malformato, sconosciuto, già utilizzato o scaduto (400). Una credenziale del provider OAuth o un refresh token non verificabile restituisce 401. | Richiedi un nuovo link, o accedi nuovamente. |
| `INVALID_USER_CODE` | 400 | Il valore inviato come codice di accesso del dispositivo non è valido: deve essere di otto lettere, come `BCDF-GHJK`. | Copia il codice mostrato sul dispositivo. |
| `INVALID_ROLE` | 400 | Il nome del ruolo da scrivere non è una stringa, è vuoto, oppure contiene `,` `{` `}` `"` `\` o un carattere di controllo. Questi caratteri verrebbero riletti come altri ruoli: un ruolo viaggia in un `text[]` di Postgres e nell'elenco separato da virgole elaborato dalle policy RLS, quindi `"support,admin"` verrebbe riletto come `admin`. `details.problems` elenca ciascuno di essi. | Rinomina il ruolo. Qualsiasi altro nome è accettato. |
| `KEY_MANAGEMENT_SCOPE` | 400 | È stato richiesto `keys:read` o `keys:write` per una chiave. Nessuna chiave può gestire le chiavi. `details.scopes` li elenca. | Omettili. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titolare di `keys:write` ha tentato di modificare o revocare una service key che possiede un ruolo o uno scope che il chiamante non ha. Solo un amministratore gestisce qualsiasi chiave. `details.roles` e `details.scopes` indicano ciò che la chiave possiede in più rispetto al chiamante. | Fai modificare la chiave da un amministratore o da chi possiede tali permessi. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto senza amministratori. | Promuovi prima un altro utente. |
| `MFA_REQUIRED` | 401 | La password è corretta e l'account ha un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` contiene un token a breve durata limitato al challenge MFA — non è una sessione. | Apri un challenge e rispondi; la risposta al challenge rilascia la sessione. |
| `NO_SESSION` | 401 | Non è stato fornito alcun cookie di sessione o refresh token. Normale al primo caricamento della pagina. | Accedi. |
| `NOT_ANONYMOUS` | 400 | Una route per l'upgrade da utente anonimo è stata chiamata da un account reale, oppure `DELETE /api/admin/guests/:uid` ne ha specificato uno. | Nulla da aggiornare. Per eliminare un account, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o ha restituito un errore. | Riprova il flusso; il messaggio include la motivazione del provider. |
| `PERSONAL_KEYS_DISABLED` | 403 | Le chiavi API personali sono disabilitate su questo backend. | Imposta `personalKeys: true` nelle opzioni `auth` della tabella auth (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La service key o una sessione ospite ha tentato di usare le route per le chiavi personali. Nessuna delle due dispone di un account per il quale la chiave possa agire. | Accedi con un account, oppure crea una service key sotto `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un platform token `rpt_` ha raggiunto un server che non li accetta: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` non sono impostati. | La piattaforma che ospita l'app imposta entrambi al momento del deploy; riesegui il deploy o accedi all'app in un altro modo. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta le richieste; il messaggio indica per quanto tempo attendere. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | L'URI di reindirizzamento non è presente nell'allow-list. | Aggiungilo alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | La registrazione self-service è disabilitata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXCEEDS_CALLER` | 403 | I ruoli assegnati possiedono uno scope, o `admin`, che il chiamante non ha. `details.beyond` li elenca. | Fai assegnare il ruolo da qualcuno che li possiede. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una service key è stato assegnato un ruolo RLS che il suo creatore non possiede. Solo un amministratore può assegnare qualsiasi ruolo. `details.roles` li elenca. | Rimuovi il ruolo, oppure fai creare la chiave da un amministratore. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli del chiamante — su una route admin o su una richiesta dati su un backend con `config.auth`. Fallisce in sicurezza (fail-closed) anziché fidarsi dei ruoli nel token. Un token il cui uid non indica alcun account, incluso un uid non supportabile dalla tabella utenti, genera un 401, non questo errore. Un database irraggiungibile genera `DATABASE_UNAVAILABLE`, non questo errore. | Riprova; controlla il database. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Per una chiave è stato richiesto uno scope che il suo creatore non possiede. Una chiave non può mai avere più permessi dell'account che la crea. `details.scopes` li elenca. | Rimuovili, oppure fai creare la chiave da qualcuno che li possiede. |
| `SCOPE_MISSING` | 403 | La credenziale non possiede lo scope richiesto da questa route, tabella, storage source o funzione. `details.requiredScope` lo indica, target compreso. | Per una persona, serve un ruolo che dichiari lo scope. Per una chiave, una chiave che lo possieda. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una route protetta con `requireScope` fa riferimento a uno scope applicativo che questo backend non dichiara, quindi nessuno lo possiede, nemmeno un amministratore. Un nome che non è affatto uno scope, o uno predefinito con errori di battitura come `data:raed`, non arriva fin qui: `requireScope` lancia un'eccezione al momento della registrazione della route. | Dichiara lo scope sotto `auth.scopes` nella tabella auth, o correggi il nome. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | La sessione è stata chiusa altrove, oppure tutte le sessioni sono state revocate, o l'account è stato eliminato. Tutti gli endpoint che accettano una sessione rispondono così a un token di questo tipo: API dati, storage, funzioni personalizzate e route admin. Il socket realtime rifiuta l'istruzione `AUTHENTICATE` con un frame `AUTH_ERROR` contenente lo stesso codice. L'SDK tenta il refresh, il refresh viene rifiutato e la sessione termina. | Accedi nuovamente. |
| `ACCOUNT_DISABLED` | 401/403 | Un amministratore ha disabilitato l'account: login (403), refresh e tutti i token posseduti (401) vengono rifiutati, su qualsiasi endpoint che accetti una sessione. Il socket realtime rifiuta l'istruzione `AUTHENTICATE` con un frame `AUTH_ERROR` contenente lo stesso codice. | Contatta un amministratore. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` è attivo e l'indirizzo non è ancora verificato. Viene restituito solo per una password corretta; viene inviato un nuovo link via email. | Segui il link ricevuto via email. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: l'account possiede una password o un'identità non convalidata, e la richiesta non dimostra la proprietà di nessuna delle due. Il token non viene consumato. | Invia `password` per mantenerla, o `removeUnproven: true` per verificare senza di essa. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | È stata richiesta una mail di verifica per un indirizzo non raggiungibile — un ospite, o il segnaposto di X (400) — o un account ha richiesto di passare a tale indirizzo (409, `POST /auth/change-email`). | Imposta prima un indirizzo reale. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` ha specificato l'indirizzo attuale dell'account. | Nulla da modificare. |
| `ANONYMOUS_USER` | 403 | Un ospite ha chiesto di modificare il proprio indirizzo email; un ospite non ne possiede uno. | Convertilo prima in un account (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Sono stati richiesti codici di recupero per un account sprovvisto di secondo fattore verificato. | Registra prima un fattore. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` ha generato un'eccezione. Il messaggio è quello dell'hook; un hook che seleziona uno stato 4xx risponde con esso. | Vedi il messaggio. |
| `INVALID_JSON` | 400 | Il corpo della richiesta non è un JSON valido. | Invia un payload JSON. |
| `SELF_DISABLE` | 400 | Un amministratore ha tentato di disabilitare il proprio account. | Chiedi a un altro amministratore. |
| `NOT_SUPPORTED` | 501 | L'auth repository di questo backend non può eseguire l'operazione richiesta (disabilitare account, modificare un indirizzo). | Riavvia il server affinché la colonna venga aggiunta, o usa un repository che la supporti. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Il target di uno scope fa riferimento a una tabella, storage source o funzione non gestita da questo backend. `details` elenca quelle supportate. | Correggi il target. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, codice email o ripristino password ha verificato l'indirizzo di un account non verificato, e l'account include un'identità di accesso il cui provider non ha mai verificato quell'indirizzo. L'auth repository non può rimuoverla (non ha `unlinkUserIdentity`), quindi la verifica viene rifiutata per evitare di lasciare tale accesso aperto su un account verificato. | Implementa `unlinkUserIdentity` nel repository di autenticazione personalizzato, o fai revisionare l'account da un amministratore. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, quindi questa route non è disponibile. | Completa la configurazione iniziale dell'amministratore. |
| `TOKEN_ALREADY_USED` | 401 | Un token monouso è stato riutilizzato, oppure un refresh token è stato ruotato più di `refreshTokenReuseIntervalSeconds` fa. | Richiedine uno nuovo, o accedi di nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata massima. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con quell'id. | Controlla l'id. |
| `WEAK_PASSWORD` | 400 | La password non rispetta la [policy della password](/docs/backend/auth-endpoints/#password-policy) (di default 8+ caratteri con una lettera maiuscola, una minuscola e una cifra) — in fase di registrazione, reset o modifica, o per la password scelta da un amministratore: `POST /api/admin/users`, una creazione sulla tabella auth tramite la data API, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Scegli una password più complessa. Un amministratore che importa account può inviare `skipPasswordPolicy: true` in fase di creazione. |

## Dati, query e scritture

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Un'aggregazione diversa da `count()` senza `groupBy` su una tabella riscritta da un hook `afterRead` (globale, a livello di tabella o con `.transform()` su una colonna). Un'aggregazione legge i valori memorizzati e non esegue mai l'hook, quindi una somma, un minimo, un massimo, il conteggio campi o un raggruppamento leggerebbero ciò che l'hook nasconde. | Usa `count()` senza `groupBy`, o leggi le righe, che passano attraverso l'hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non può calcolare l'aggregazione richiesta. | Usa un driver che la supporti, o calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), dove un branch *è* il genitore stesso e nulla verrebbe isolato. Il rifiuto è lo stesso restituito da `rebase db branch`. | Punta `DATABASE_URL` su un'istanza Postgres indipendente (`rebase dev --docker` ne avvia una) ed esegui i branch lì. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni del limite consentito per singolo batch (1000 per impostazione predefinita). Un batch costituisce un'unica transazione e mantiene i suoi lock per l'intera durata. | Invialo suddiviso in più parti; il messaggio indica il limite e il conteggio attuale. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non può eseguire scritture atomiche su più tabelle, e un ciclo di scritture singole non sarebbe né atomico né eseguito in un unico round trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per tabella. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa tabella o driver non supporta scritture massive (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook di tabella ha rifiutato la scrittura. Un'istruzione `throw` da `beforeSave`/`beforeDelete`/`after*` è un 400 che riporta il messaggio dell'autore; un `beforeDelete` che restituisce `false` è un 403. `details.stage` indica quale hook, `details.path` la tabella. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CALLBACK_RECURSION` | 500 | Le scritture avviate dagli hook hanno superato i 16 livelli di nidificazione: la scrittura di un hook tramite `context.data` esegue nuovamente gli hook di quella tabella e nulla nella catena lo interrompe — tipicamente un `afterSave` che aggiorna la propria riga incondizionatamente. L'intera scrittura è stata annullata (rollback). Il messaggio indica l'hook e la tabella; `details.chain` elenca ogni passaggio hook → scrittura. | Rendi la scrittura dell'hook condizionale: intervieni solo su `status === "new"`, oppure ignorala se `values` contiene già quanto verrebbe scritto. |
| `COMPOSITE_KEY_ADDRESS` | 400 | La tabella ha una chiave composita e l'indirizzo nell'URL specifica un numero diverso di componenti. | Specifica la riga come `<part1>:::<part2>`, con ogni parte codificata per URL, nell'ordine della chiave; `details.primaryKey` elenca le colonne. |
| `TABLE_READ_ONLY` | 405 | Una scrittura ha raggiunto una view (`defineView`). Una view è in sola lettura. Precedentemente `COLLECTION_READ_ONLY`. | Scrivi sulle tabelle lette dalla view. Vedi [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | La tabella è dichiarata, ma il database non la protegge: la sicurezza a livello di riga (RLS) è disattivata, nessuna delle policy dichiarate è presente, o manca una policy restrittiva dichiarata. (Una policy permissiva mancante viene comunque servita, con un avviso di boot che la segnala.) Questo si verifica quando il server non esegue il provisioning delle sue tabelle (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e il server trattiene la tabella anziché esporre ogni riga a ogni chiamante. Una junction many-to-many segue la stessa regola: quando fallisce, le tabelle le cui relazioni la utilizzano vengono trattenute e il messaggio indica la junction; lo stesso vale per una tabella il cui `via` passa attraverso una tabella trattenuta, indicando il `via`. Anche la lettura o il filtraggio di una relazione che passa attraverso una tabella trattenuta risponde con questo codice. Le altre tabelle vengono servite normalmente. Il log di avvio indica le istruzioni per proteggerla. | Esegui le istruzioni indicate nel log di avvio (come fa `rebase db push`), quindi riavvia. Oppure, se l'applicazione gestisce l'accesso a quella tabella autonomamente, dichiara `rlsRequired: false` su di essa (o `database({ rls: { required: false } })`) e riavvia. |
| `SQL_NOT_ALLOWED` | 400 | Il codice SQL eseguito come chiamante (`getSql(c)`, `withAuth(user).sql`) non era una singola istruzione semplice `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, oppure ha invocato `set_config` o referenziato `pg_settings`. L'identità del chiamante risiede nelle impostazioni di sessione, quindi qualsiasi istruzione che potrebbe modificarle viene rifiutata. | Mantieni il testo della query semplice e sotto il tuo controllo, in una sola istruzione, inserendo ogni valore nei `params`. Vedi [Funzioni personalizzate](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore indica già l'inizio della pagina, quindi applicare un offset aggiuntivo salta silenziosamente quel numero di righe dopo il cursore — un divario che il chiamante non può rilevare nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una ricerca testuale o vettoriale. Entrambe associano un punteggio per riga, quindi due righe non risulteranno mai identiche e `DISTINCT` non aggregherebbe nulla — sembrerebbe funzionare senza cambiare nulla. | Rimuovi uno dei due. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` è ordinata per una colonna che non restituisce. Un'istruzione `SELECT DISTINCT` può essere ordinata solo in base alle colonne presenti nel suo elenco di selezione, altrimenti le righe aggregate non hanno un ordine definito. `details.fields` le elenca. | Aggiungi tali campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Impossibile raggiungere il database: connessione rifiutata o interrotta, risoluzione dell'host fallita, server in fase di arresto o avvio, oppure database chiuso a nuove connessioni (`ALLOW_CONNECTIONS false`, condizione in cui un comando `rebase db branch create --force` interrotto a metà lascia la propria origine; il log del server indica il database, e `rebase db branch list` lo riapre). Ogni endpoint risponde così, inclusi login, route admin e socket realtime (con un frame `ERROR`). Inviato con `Retry-After: 5`. | Riprova; l'SDK lo fa automaticamente. Verifica che il database sia attivo e raggiungibile dal server. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | Il server del database ha rifiutato una nuova connessione perché non ne ha più a disposizione (`53300` troppi client, `53400` limite di connessioni di un ruolo o del database raggiunto). Tutte le istanze del server condividono il valore `max_connections` del server, quindi questa situazione si verifica tipicamente con diverse istanze con pool ampi e senza connection pooler. Si tratta di un problema di carico, non di un guasto; inviato con `Retry-After: 2`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Riduci `DB_POOL_MAX` (o limitalo con `REBASE_DB_POOL_MAX`) su tutte le istanze, posiziona un pooler davanti al database (`DATABASE_POOLED`), o aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | L'apertura di una nuova connessione al database ha richiesto più tempo di `DB_POOL_CONNECT_TIMEOUT`: il database è lento ad accettare connessioni o è geograficamente distante. Inviato con `Retry-After`. | Riprova; l'SDK lo fa automaticamente. Controlla il carico del database e la connettività di rete verso di esso. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): una policy di sicurezza a livello di riga nega questo ruolo oppure manca un `GRANT`. | Vedi [Risoluzione dei problemi](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Tutte le connessioni al database nel pool sono rimaste occupate per `DB_POOL_CONNECT_TIMEOUT`, pertanto la richiesta non ha mai raggiunto il database. È un problema di carico, non un guasto; inviato con `Retry-After`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Aumenta `DB_POOL_MAX`, oppure individua le query lente o le transazioni lunghe che bloccano le connessioni. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, un `select` aggregato o un `groupBy` specifica un campo che i ruoli del chiamante non possono leggere (`access.read`), un percorso nidificato o un ordinamento aggregato indica una relazione che non possono leggere — oppure un'operazione su campo (`$inc`, `$push`, …) ha come target un campo non accessibile, dove un limite rifiutato rivelerebbe il valore memorizzato. Un campo che non può apparire nella risposta non deve poter essere interrogato tramite query, altrimenti il valore sarebbe desumibile predicato dopo predicato. Un filtro attraverso una relazione (`author.salary`) e un ordinamento aggregato su un campo di una relazione (`max(staff.salary)`) vengono valutati in base alle regole del target. `details.violations` elenca ciascun campo. Il driver applica la stessa regola a una lettura eseguita nel processo per conto del chiamante (`context.data` nello scope del chiamante), e a una ricerca vettoriale, un include o una verifica di unicità. Una colonna definita con `.private()` risponde come se non esistesse: qualsiasi filtro, `orderBy`, `fields`, `include`, `select` aggregato o `groupBy`, o `vector_search` che la specifichi riceve la stessa risposta data per un nome errato (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), e nessuna risposta di campo sconosciuto ne elencherà il nome. | Rimuovi il campo dalla query, o acquisisci il ruolo. Vedi [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | Il payload imposta un campo che i ruoli di questo chiamante non possono scrivere (`access.write`). Viene rifiutato anziché scartato: una scrittura che ignora un campo restituirebbe un esito positivo per una modifica mai avvenuta. Lo stesso codice rifiuta una scrittura tramite un'entità padre che imposta una relazione che il chiamante non può scrivere, e un aggiornamento che imposta un campo `softDelete` su un valore — solo un'eliminazione può impostarlo. Il socket realtime risponde con un 403 e questo codice per una scrittura tramite un percorso nidificato la cui tabella padre, relazione o tabella di destinazione non è servita lì, anziché inoltrarla al driver senza convalida. `details.violations` elenca ciascun campo. | Rimuovi il campo, o acquisisci il ruolo. Un campo che nessuno può scrivere restituisce invece `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | È stato inviato un aggiornamento o un'eliminazione con filtro alla tabella auth via HTTP, le cui scritture vengono convalidate utente per utente prima di essere eseguite. | Leggi prima gli utenti, quindi usa `updateMany`/`deleteMany` per id. |
| `FILTER_REQUIRED` | 400 | Una scrittura filtrata (un aggiornamento o un'eliminazione tramite `where`/`logical`, dall'SDK o dalle route bulk) non ha condizioni, quindi modificherebbe ogni riga. Viene rifiutata prima di eseguire qualsiasi operazione. | Aggiungi una condizione. Per modificare intenzionalmente ogni riga, indicalo con una condizione soddisfatta da tutte le righe. |
| `HISTORY_UNAVAILABLE` | 503 | Una scrittura su una tabella con `history: true` è stata rifiutata perché la voce cronologica non ha potuto essere registrata: il database non ha la tabella `rebase.entity_history` o, per `openRebase` e `rebase console`, la funzione `rebase.record_history`. Nessun backend con la cronologia attiva è stato avviato su questo database. Nessuna operazione è stata eseguita, hook compresi, e le letture non sono compromesse. Sollevato da `openRebase`, e restituito da un backend creato con `provision: false`. | Avvia il backend una volta con la cronologia attiva e `provision: true` (come fa `rebase dev`), quindi riprova. |
| `HISTORY_UNSERVABLE` | 501 | Il data driver della tabella non può eseguire le regole di lettura e gli hook `afterRead` sulle righe archiviate (`DataDriver.serveStoredRows`), e la cronologia non viene mai servita senza maschera di protezione. Il driver Postgres incluso ne è capace. | Implementa `serveStoredRows` nel driver personalizzato. Vedi [Cronologia](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine della richiesta precedente. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è arrivata su una richiesta diversa: metodo, percorso, query string o payload differente. | Usa una nuova chiave, o reinvia la richiesta originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` ha specificato una funzione non di aggregazione (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una tra queste funzioni supportate; il messaggio le elenca. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una trasformazione `groupBy` non è nota, o non è applicabile alla colonna: `year`/`month`/`day` su una colonna che non è una data, `unnest` su una colonna che non è un array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest`, su una colonna del tipo appropriato. |
| `INVALID_AGGREGATE_SELECT` | 400 | Un elemento in `?select=` non rispetta il formato `fn(field)`; a una funzione diversa da `count()` o `fingerprint()` non è stato associato alcun campo; `percentile` non ha una frazione tra 0 e 1; oppure `fingerprint()` è stato richiesto su una view standard, che non memorizza righe. | Usa formati come `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | È stato usato `offset`, `page` o `orderBy` su un'aggregazione priva di `groupBy`, oppure un cursore su qualsiasi aggregazione. Un'aggregazione non raggruppata produce una sola riga, e un gruppo non è una riga dopo la quale un cursore possa continuare. | Aggiungi `groupBy` oppure omettili; pagina i gruppi usando `offset` o `page`. Vedi [Aggregazioni](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Un'operazione `/_batch` manca di `op`, `table`, `values` o `id`, specifica una tabella non gestita da questo backend, o riutilizza un nome `ref`. | Vedi il messaggio; indica l'operazione per indice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` non indica alcuna operazione precedente, punta in avanti o richiede un campo che la riga referenziata non possiede. Si possono risolvere solo riferimenti a ritroso. | Definisci l'operazione con `ref` *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | Il corpo della richiesta bulk non ha la struttura prevista. | Invia l'array accettato dalla route: `{ "rows": [...] }` a `POST /bulk`, `{ "updates": [{ "id", "data" }] }` a `PATCH /bulk`, `{ "ids": [...] }` a `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regola di conflitto per un upsert (mantieni duplicati, o sostituisci solo su un `where`) è stata inviata senza `upsert: true`, oppure entrambe le regole sono state inviate contemporaneamente. | Invia `upsert: true` e una sola delle due regole. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert indica colonne prive di un vincolo di unicità, le specifica senza `upsert: true`, o viene inviato in una creazione nidificata, dove una riga corrispondente verrebbe spostata sotto il nuovo genitore. Postgres restituirebbe altrimenti 42P10 dall'interno di una transazione che ha già operato. Riguarda inoltre qualsiasi upsert sulla tabella auth, dove create e update seguono regole diverse. | Dichiara `.unique()` sulla colonna o crea un indice `unique`; il messaggio elenca i target validi. Sulla tabella utenti, invia un `POST` per creare e un `PATCH` per aggiornare. |
| `INVALID_COUNT` | 400 | `?count=` non è impostato su `exact` o `none`. Rifiutato anziché interpretato come valore predefinito: un errore di battitura come `?count=nnone` eseguirebbe il conteggio che era invece intenzione saltare. | Invia `exact` (il valore predefinito) o `none`. Vedi [Omettere il conteggio](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Impossibile decodificare il cursore `after`, o indica un id di riga incompatibile con le colonne chiave della tabella: è stato troncato, ricodificato o composto manualmente. Un cursore leggibile inviato con un `orderBy` diverso da quello con cui è stato generato restituisce `CURSOR_ORDER_MISMATCH`, anch'esso un 400. | Invia nuovamente `meta.nextCursor` della pagina precedente inalterato, con lo stesso `orderBy` o nessuno. Vedi [Paginazione](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Rifiutato anziché ignorato: un errore come `?deleted=true` che nascondesse silenziosamente tutte le righe eliminate sembrerebbe funzionare ma risponderebbe alla domanda opposta. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è impostato su `true` o `false`. | Invia uno di questi valori; anche `1` e `0` sono accettati. |
| `INVALID_FIELD_OPERATION` | 400 | È stato usato un operatore `$inc` / `$push` / `$pull` / `$merge` su un tipo di colonna per cui non è definito, con un operando non valido, con due operatori sullo stesso campo, con un errore di sintassi o in fase di creazione — dove non esiste alcun valore archiviato su cui operare. | Vedi [Scrittura tramite REST](/docs/backend/writes/#field-operations); il messaggio indica il campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una scrittura filtrata ha indirizzato un percorso attraverso una relazione (`posts/1/comments`) o nessuna tabella. | Scrivi sulla tabella correlata applicando un filtro sul suo collegamento. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro fa riferimento a una colonna non presente in questa tabella. | Verifica la correttezza del nome rispetto alla tabella. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di colonna — ad esempio `like` su un numero o una data. | Vedi [Esecuzione di query sui dati](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Il valore del filtro non può essere interpretato nel tipo della colonna con cui viene confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non inclusa nell'enum, un timestamp non valido, un numero che eccede il range del tipo. `details.dbCode` riporta lo SQLSTATE. | Invia un valore compatibile con il tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che esegue un soft-delete quando il chiamante intendeva eliminare definitivamente lascerebbe credere che i dati siano stati rimossi. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non è un elenco di percorsi valido o l'oggetto delle opzioni per relazione ha una struttura errata. Un percorso nidificato oltre tre livelli genera `INCLUDE_TOO_DEEP`, anch'esso un 400. Viene intercettato all'ingresso anziché propagarsi come 500 dal driver. | Vedi il messaggio; indica il percorso problematico. |
| `INVALID_INPUT` | 400 | Il corpo della richiesta non ha superato la convalida. | Vedi il messaggio. |
| `INVALID_LIMIT` | 400 | `?limit=` non è un numero intero compreso tra 1 e il massimo consentito (1000 per impostazione predefinita); valori superiori vengono rifiutati, non limitati al massimo consentito. Una sottoscrizione realtime che richiede un limite al di fuori di questo intervallo riceve lo stesso codice come frame `ERROR` via WebSocket. | Riduci il limite e pagina i risultati rimanenti. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` / `?not=` è malformato o supera il livello di nidificazione consentito. | Vedi il messaggio; illustra la regola di flattening. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non è `field`, `field:desc`, `field:desc:last`, o un array JSON di `{ field, direction, nulls }` — oppure specifica una direzione diversa da `asc`/`desc` o un posizionamento dei valori NULL diverso da `first`/`last`. | Vedi il messaggio; mostra tutte le sintassi ammesse. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine sono in base 1, quindi `?page=0` è considerato un errore anziché la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro di query è malformato. | Vedi il messaggio. |
| `INVALID_QUERY_BODY` | 400 | Il corpo di una richiesta `POST …/query` contiene un valore non consentito nell'URL: un elenco per un parametro che l'URL legge una sola volta (`fields`, `limit`, …), un oggetto per un filtro, o qualsiasi parametro passato contemporaneamente anche nell'URL — un `POST …/query` legge tutti i parametri dal corpo. | Specifica ciascun valore come faresti nell'URL — una stringa o una lista per un filtro ripetuto; `where`, `include`, `orderBy` e `vector` richiedono formato JSON. Vedi [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non è impostato su `cosine`, `l2` o `inner_product`. | Usa uno di questi tre valori. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Un aggiornamento specifica la chiave della riga con un valore diverso da quello con cui è stata indirizzata — nel corpo della richiesta o tramite un hook `beforeSave`. Una riga non può cambiare chiave primaria: tutte le operazioni successive alla scrittura (rilettura, `afterSave`, cronologia, realtime) la indirizzano con la chiave originaria. La richiesta viene rifiutata prima dell'esecuzione di qualsiasi hook, senza scrivere nulla, su ogni canale. `details.violations` indica il campo. | Crea la riga con la nuova chiave ed elimina quella precedente. È invece consentito inviare la chiave già posseduta dalla riga. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata invocata senza il parametro `?select=`. | Aggiungine uno, ad es. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | È stato invocato `refresh()` su una tabella che non è una vista materializzata. | Esegui il refresh solo su viste definite con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | Il progetto non fornisce alcuna tabella: nessuna dichiarata in `backend/schema`, e nessuna nel database da sottoporre a introspezione. Quando le tabelle esistono ma la sicurezza a livello di riga (RLS) è disattivata, il messaggio le elenca, includendo il codice SQL per abilitarla, e `details.unprotectedTables` le riporta. Precedentemente `NO_COLLECTIONS`. | Crea le tabelle — tramite migrazione, SQL, o un file `defineTable` con `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con quell'id in quella tabella — o riga nascosta al chiamante dalla sicurezza a livello di riga. | Verifica l'id, quindi controlla l'`rls` della tabella. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` specifica un elemento che non corrisponde a una relazione della tabella. Lo stesso codice risponde **404** quando un *percorso URL* nidificato specifica una relazione inesistente, ad es. `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuna — in questo caso l'URL non individua nulla, configurandosi come una risorsa non trovata anziché come richiesta malformata. | Verifica il nome della relazione — il messaggio elenca quelle presenti nella tabella. Un back-reference deve essere dichiarato sull'entità genitore per essere esplorabile. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento indica un campo non ordinabile. | Ordina in base a una colonna. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` è stato combinato con `?offset=` — oppure `page` con `offset` in un `find()`, combinazione che l'SDK client, il modulo in-process `rebase.data` e il client offline rifiutano con lo stesso codice prima di inoltrare la richiesta. Descrivono la stessa finestra temporale, e storicamente `page` prevaleva in modo silente su un `offset` che non veniva quindi mai applicato. | Invia solo uno dei due parametri. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo della richiesta supera il limite configurato. | Invia meno dati, o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` ha tentato di eseguire una scrittura. Una lettura nello scope della richiesta viene eseguita in una transazione `READ ONLY`, pertanto né l'hook né le funzioni da esso invocate possono scrivere. | Sposta la scrittura all'esterno della fase di lettura: usa un job in background o `rebase.dataAsAdmin` da un cron job o da una custom function. |
| `REFRESH_NOT_SUPPORTED` | 501 | La richiesta `POST /api/data/<slug>/refresh` ha raggiunto un data driver privo del supporto per viste materializzate. | Nessun elemento su cui eseguire il refresh in questo backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura conteneva un payload per il collegamento, ma il percorso non raggiunge la destinazione tramite un `manyToMany` che dichiara un `pivot` — manca quindi la riga di giunzione su cui memorizzarlo. | Dichiara colonne `pivot` sulla relazione, oppure rimuovi il payload dalla scrittura. Vedi [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non si risolve rispetto allo schema registrato. L'operazione viene bloccata anziché saltata: ignorarla restituirebbe un esito positivo per una scrittura mai avvenuta, o un insieme vuoto per righe che in realtà esistono. | Esegui `rebase schema generate` se lo schema generato è meno recente del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura dal lato proprietario della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso nidificato non rappresenta una relazione scrivibile, oppure una creazione o aggiornamento specifica una relazione `via` con più hop — solo le relazioni `via` a hop singolo sono scrivibili. `details.fields` elenca le chiavi `via`. Nessun dato è stato scritto. | Scrivi direttamente sulle righe collegate dalla catena. Vedi [Relazioni](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione dichiara colonne di giunzione, ma questa sorgente dati non supporta la loro scrittura. | Il collegamento in sé funziona; solo il payload associato non è supportato. Verifica le funzionalità del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura su relazione non aveva una chiave di origine a cui associare il link. | Salva prima la riga genitore. |
| `RESULT_TOO_LARGE` | — | Un'istruzione inviata tramite `EXECUTE_SQL` sul socket realtime — come `admin.executeSql` da un client o le letture del catalogo del pannello di amministrazione — ha restituito più di 128 MB di righe, quindi nessun dato è stato inviato. Consegnato come frame `ERROR` via WebSocket. Le esecuzioni della console SQL non vengono invece bloccate: mostrano le prime righe. | Aggiungi un `LIMIT`, o seleziona meno colonne, e leggi il risultato a blocchi. |
| `ROW_IN_TRASH` | 409 | La chiave di un upsert appartiene a una riga nel cestino (una riga eliminata con soft-delete conserva la propria chiave). Un upsert non scrive su una riga eliminata, attraverso nessun canale: `?on_conflict=` in REST, upsert `/bulk` e `/_batch`, l'SDK e il socket realtime. Nessun dato è stato scritto. | Ripristina prima la riga (con un aggiornamento che imposti a `null` il campo di soft-delete), oppure eliminala definitivamente con `?hard=true` ed esegui nuovamente l'upsert. Vedi [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabella o colonna attesa dal codice non esiste nel database. | Esegui `rebase db push` in fase di sviluppo; riesegui il deploy in caso di tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per query anziché essere persistita, pertanto non può fare da chiave per un cursore. | Pagina i risultati per rilevanza usando `limit`/`offset`, oppure ordina in base a una colonna. |
| `SQL_ERROR` | 400 | Il database ha rifiutato il codice SQL scritto manualmente. Sul comando `EXECUTE_SQL` del socket realtime si riceve un frame `ERROR` con il messaggio del database. `POST /api/admin/sql/csv` lo restituisce prima di inviare qualsiasi parte del file: errore di sintassi, tentativo di scrittura (il download viene eseguito in sola lettura), presenza di più istruzioni, o ruolo non consentito per la connessione. | Correggi l'SQL. Un download accetta una sola istruzione `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un chiamante privo di tutti i ruoli definiti in `view.roles` ha tentato di leggere una vista materializzata o di eseguirne il refresh. Una vista materializzata non dispone di sicurezza a livello di riga, quindi viene servita per intero ed esclusivamente a tali ruoli. | Leggila con uno dei ruoli previsti, oppure dichiara il ruolo del chiamante in `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura comporterebbe lo spostamento di una riga da un tenant all'altro. Una riga non può cambiare tenant. `details.violations` indica il campo. Un trigger applica la stessa regola nel database, quindi l'SQL eseguito come chiamante fallisce con l'errore Postgres `42501` e un messaggio che inizia con `TENANT_IMMUTABLE`. | Crea la riga nell'altro tenant ed elimina quella attuale, oppure scrivi usando un ruolo presente in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura specifica un tenant a cui questo chiamante non appartiene; anche il database la rifiuterebbe. | Scrivi all'interno di un tenant di cui il chiamante fa parte, o autenticati con credenziali appartenenti a quel tenant. |
| `TENANT_REQUIRED` | 400 | La tabella opera con ambito tenant e il tenant non può essere dedotto: la richiesta non ne contiene alcuno, oppure il chiamante appartiene a più tenant. | Invia il campo tenant in modo esplicito, oppure autenticati con un chiamante associato a un solo tenant. |
| `TRANSACTION_ABORTED` | 500 | Un'istruzione nella transazione di scrittura è fallita e un hook ha intercettato l'errore. Postgres aveva già interrotto la transazione, quindi la scrittura è stata annullata e nulla è stato persistito. Solo un'operazione di creazione, aggiornamento o eliminazione tramite `context.data` rifiutata dal database viene annullata singolarmente ed è sicuro intercettarla. | Lascia propagare l'errore (throw), oppure esegui i dovuti controlli prima di lanciare l'istruzione. Vedi [Semantica delle transazioni](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` indica un campo non presente nella tabella. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o un `groupBy` fa riferimento a un campo che la tabella non possiede. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro fa riferimento a un campo non presente in questa tabella — o nella destinazione di una relazione — o a una colonna definita con `.private()`. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro specifica un operatore non esistente. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket realtime ha un `type` non gestito dal server. Viene restituito come frame `ERROR` contenente il `requestId` della richiesta, consentendo alla stessa di concludersi anziché andare in timeout. | Controlla il campo `type` del frame; il messaggio ne indica il nome. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento specifica un campo che la tabella non possiede. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | L'header `If-Match` specifica una versione della riga non più attuale: un altro utente o processo ha scritto sulla riga tra la lettura e questa richiesta di scrittura. Nessun dato è stato scritto. | Rileggi la riga, applica nuovamente la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo che la tabella non possiede. | Controlla la correttezza del nome; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha fatto riferimento a una colonna che non è configurata come `col.vector()` in questa tabella. | Il messaggio elenca le colonne vettoriali disponibili nella tabella. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il valore di `Content-Type` non rientra tra quelli accettati da questa route. | Invia il tipo indicato nella documentazione della route. |
| `UNSUPPORTED_OPTION` | — | Generato come eccezione, non restituito via HTTP: a una scrittura eseguita tramite l'accessor in-process (`context.data` in un hook, `rebase.data` in una funzione o cron) sono stati passati `ifMatch` o `idempotencyKey`. Questo canale non dispone di controlli sulle precondizioni né di un archivio di idempotenza, quindi l'opzione viene rifiutata prima della scrittura anziché essere ignorata. | Rimuovi l'opzione in quel contesto, oppure effettua la scrittura tramite il client HTTP, che le supporta entrambe. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è strutturato in una sola direzione, non essendoci elementi su cui correlare una subquery a ritroso. | Applica il filtro dal lato proprietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è definito per quel campo: una relazione che non ha una colonna su questa riga viene filtrata per appartenenza, e i pattern matching (`like`, `ilike` e le relative negazioni) si applicano solo ai testi. | Vedi il messaggio; elenca gli operatori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore ha violato una regola dichiarata dalla colonna (`.validate()`, `.notNull()`, `.oneOf()`) — lunghezza, intervallo, pattern, campo obbligatorio, valore non incluso nella lista. Ciascuna voce di `details.violations` include un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene lo stesso elemento due volte, `$push` incluso), `unique_by` (due elementi di un array JSON condividono lo stesso valore in un campo indicato da `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Vedi il messaggio; indica la tabella, la colonna e ogni singola violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il corpo della richiesta tenta di scrivere su una colonna contrassegnata con `.private()` o `.access({ write: [] })` — la medesima regola, con due sintassi differenti. La modifica di questi campi spetta solo al server: ad esempio l'hash di una password o un token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è uniforme per tutti i chiamanti, `admin` compreso. | Rimuovi il campo. Vedi [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non è compatibile con il tipo della colonna. | Vedi il messaggio; indica la colonna coinvolta. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo della richiesta specifica un campo non esistente nella tabella — compreso il parametro `id` inviato a una tabella con una chiave primaria differente. | Controlla la correttezza del nome; il messaggio ("Table 'x' has no column 'f'. Known columns: …") elenca le colonne valide. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Un cursore (`after` / `startAfter`) è stato combinato con una ricerca vettoriale. Le righe sono ordinate secondo una distanza calcolata a ogni query, che non può essere usata come chiave di un cursore, pertanto un elenco vettoriale non restituisce `nextCursor`. | Pagina le righe più vicine usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha negato la scrittura. | Controlla le regole `rls` della tabella. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura rifiutata da Postgres per un problema legato ai *dati inviati dal chiamante*
risponde includendo lo SQLSTATE all'interno del codice: `PG_23505`, `PG_23503` e così via.
Non si tratta di una lista chiusa ma di una famiglia — Postgres definisce centinaia di valori SQLSTATE —
tuttavia solo due classi possono arrivare fin qui, poiché sono le uniche imputabili
a un errore del chiamante:

- **classe 23**, violazione dei vincoli di integrità: un duplicato, una foreign key che
  punta a un record inesistente, una colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: un valore non supportabile dal tipo di dato della colonna.

Tutto il resto — una connessione interrotta, una colonna mancante, un problema di permessi —
è di responsabilità del server e genera un `500`. Di conseguenza, `code.startsWith("PG_")` rappresenta un test
affidabile per verificare se "la riga inviata non era valida", e i quattro casi elencati sotto
sono quelli che un client riscontra più frequentemente. `details.dbCode` riporta il medesimo SQLSTATE
per ciascuno di essi, e il messaggio indica il vincolo violato.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Impossibile interpretare un valore nel tipo della colonna — l'equivalente in scrittura di `INVALID_FILTER_VALUE`. | Invia un valore compatibile con il tipo della colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo o definisci un valore predefinito per la colonna. |
| `PG_23503` | 400 / 409 | In fase di salvataggio, una foreign key fa riferimento a una riga inesistente (400). In fase di eliminazione, altre righe referenziano ancora questa riga (409; un vincolo con `RESTRICT` solleva `PG_23001`, anch'esso un 409). | Crea prima la riga referenziata o correggi l'id; per un'eliminazione, rimuovi o riassocia prima le righe dipendenti. |
| `PG_23505` | 409 | Violazione di un vincolo di unicità. Il messaggio indica il vincolo specifico. | Usa un valore differente, o aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | In un elenco di file nello storage, `maxResults` non è un intero maggiore o uguale a 1, oppure `pageToken` non è stato rilasciato dalla sorgente. Storicamente, una dimensione di pagina inferiore a 1 restituiva una pagina vuota con lo stesso token, causando loop infiniti nei cicli `while (pageToken)`. | Invia un valore positivo per `maxResults` e inoltra il parametro `nextPageToken` inalterato. |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Controlla il nome del bucket. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata, esce dal prefisso configurato o utilizza un prefisso riservato (`_rebase/renditions/`, `_rebase/maintenance/`). | Controlla la chiave dell'oggetto. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri per la trasformazione delle immagini sono fuori scala o in contraddizione tra loro. | Vedi [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Il caricamento supera il valore `maxBytes` dichiarato sulla colonna di destinazione `col.storage()`. Il controllo è applicato a livello server, non solo nel browser. `details` contiene la colonna, il limite e la dimensione reale. | Carica un file più piccolo, o aumenta `maxBytes` sulla colonna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo di file caricato non rientra nell'elenco `accept` della colonna, o tra i `allowedMimeTypes` specificati per la sorgente di storage. `details` include la colonna (o la lista della sorgente), l'elenco dei tipi accettati e il content-type ricevuto. | Carica un tipo di file consentito, o amplia `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | Il bucket S3 o GCS configurato per questa risorsa non esiste, oppure il provider ha rifiutato le credenziali assegnate a questo deployment. Il messaggio indica il nome del bucket; `details.reason` è `NoSuchBucket` o il motivo del rifiuto inviato dal provider. Un bucket mancante veniva storicamente interpretato come "file non trovato" per ciascun file. | Correggi il nome del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` per una risorsa con nome) o verifica i permessi delle credenziali. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nessun backend di storage è configurato su questo server, oppure nessuno è impostato come predefinito e la richiesta non specifica alcuno storage target; il messaggio riporta le sorgenti gestite (501). Un caricamento riprendibile la cui risorsa è scomparsa prima del completamento restituisce 503. | Configura S3, GCS o uno storage locale, oppure specifica una risorsa con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Chiamata a `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) tra due sorgenti collegate allo stesso bucket o cartella. Ciascun file risulterebbe già presente nella destinazione, essendo identico, e cancellare la copia della sorgente eliminerebbe l'unico file esistente. Nessun file è stato spostato o rimosso. | Fai puntare la colonna all'altra sorgente; i relativi file sono già collocati lì. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) non ha potuto scansionare tutte le tabelle, quindi un file indicato da una di esse rischierebbe di apparire non utilizzato. Con `?scan=`, la scansione indicata è quella che non ha potuto accedere a tutte le tabelle. Nessun dato è stato rimosso; `details.unscanned` indica le tabelle escluse e la motivazione. | Risolvi il problema che blocca la lettura delle tabelle e riesegui il comando. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` richiede una scansione non presente nella sorgente. Le scansioni sono conservate per 7 giorni nella sorgente analizzata; quindi uno `storageId` diverso da quello della scansione non restituirà alcun risultato. | Passa lo `storageId` corretto della scansione, oppure avvia una nuova scansione. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione ancora `queued`, `running` o marcata come `failed`. Nessun dato è stato rimosso; `details.status` riporta lo stato attuale. | Attendi il termine della scansione, oppure avviene una nuova. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione completata più di 15 minuti fa. Nessun dato è stato rimosso. | Avvia una nuova scansione ed esegui la cancellazione a partire da essa. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` punta a una scansione i cui elementi orfani sono già in fase di eliminazione. | Controlla lo stato di `deletion` della scansione con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La sorgente di storage è dichiarata ma non dispone delle credenziali su questo ambiente. | Configura le variabili d'ambiente associate alla sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di archiviazione ha rifiutato o interrotto l'operazione di scrittura. | Controlla i relativi log e la validità delle credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe elaborazioni di immagini in corso simultaneamente. | Riprova; valuta l'uso di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La richiesta fa riferimento a una sorgente di storage (`?storageId=`) non dichiarata in questo progetto. La richiesta di un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** (in operazioni di listing, caricamento, cartella o caricamento riprendibile su S3 o GCS) — la risorsa mancante è lo storage stesso, e `details` elenca i bucket e le sorgenti disponibili. In precedenza entrambi restituivano "file non trovato", indistinguibile da una chiave semplicemente assente. | Dichiara la sorgente in `config/resources.ts`, o controlla `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Una richiesta `PATCH` per un caricamento riprendibile è giunta mentre un altro blocco dello stesso upload era ancora in ricezione — solitamente dovuto a un client che ripete l'invio del blocco in transito. Viene rifiutata anziché accodata, in modo analogo a tusd. | Richiedi l'offset corrente con `HEAD /api/storage/tus/:id` e riprendi da lì; il client tus-js-client gestisce l'attesa e il rinvio in autonomia. Vedi [Caricamenti riprendibili (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funzioni personalizzate

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con questo nome è disponibile — o esiste, ma le sue route non gestiscono il percorso successivo. Un chiamante autenticato riceve l'elenco di ciò che *è* disponibile; un chiamante anonimo no, per non esporre l'elenco di tutti gli endpoint personalizzati. Se il caricamento di un file con quel nome è fallito, il messaggio lo segnala all'utente autenticato specificando il file: ciò consente di distinguere un errore di digitazione da un deployment non riuscito. Un chiamante anonimo riceve la risposta standard di risorsa non trovata. | Controlla il nome su `GET /api/functions` o consulta i log di avvio per verificare se un file non è stato caricato. |
| `FUNCTION_TIMEOUT` | 504 | L'esecuzione dell'handler ha superato il tempo massimo previsto. La funzione è ancora in esecuzione e non può essere interrotta da qui. | Associa un `AbortSignal` alle chiamate esterne o incrementa `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo inoltra le funzioni a un altro servizio proxy che non ha risposto. | Verifica che il servizio preposto all'esecuzione delle funzioni sia attivo. |

## Notifiche push

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | L'endpoint di sottoscrizione non appartiene ai servizi push usati dai browser (FCM, Mozilla, Apple, Windows) tramite protocollo `https`. Il server invia richieste a quell'indirizzo per ogni notifica, pertanto non ne accetta altri. | Invia l'output di `PushSubscription.toJSON()` così come generato dal browser, o specifica un servizio push di test in `push.allowedHosts`. Vedi [Notifiche push](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Una chiave API o la service key ha invocato una route push. Una sottoscrizione appartiene al browser di una persona autenticata. | Esegui la richiesta con la sessione di quell'utente. |
| `PUSH_NOT_CONFIGURED` | 503 | Il modulo push è abilitato ma non può inviare notifiche: mancano le chiavi VAPID in produzione, oppure non è stato possibile inizializzare la relativa tabella. Il messaggio indica la causa. | Configura `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Vedi [Notifiche push](/docs/backend/push-notifications/#keys). |

## Cron job

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | È stata tentata l'attivazione manuale di un cron job già in corso — sul processo locale o su un altro che detiene il lock di esecuzione, come un worker collegato a un processo `api`. L'esecuzione non è stata avviata. L'evento saltato è visibile nella cronologia del job e corrisponde a `details.log`; la voce riporta il processo che sta eseguendo il job. | Riprova al termine dell'esecuzione in corso. Vedi [Cron Job](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfacce di amministrazione e modifica dello schema

Questi errori indicano che una funzionalità è disattivata o non configurata,
non che la richiesta in sé fosse errata. Ciascuno di essi viene notificato anche sulla
corrispondente route `/status` con codice `200`, permettendo al pannello di
disabilitare visivamente la funzione anziché mostrare un errore.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata richiesta una schermata per soli amministratori su un server privo di autenticazione configurata, rendendo impossibile distinguere un amministratore da un qualsiasi utente. | Imposta `auth.jwtSecret`, o definisci un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | È stato inviato a `POST /api/admin/branches/:name/merge` il fingerprint di un diff non più valido: il branch o il genitore hanno subito modifiche nel frattempo. Nessun dato è stato scritto. | Ricalcola il diff, esaminalo e procedi al merge indicando il nuovo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La sorgente dati non supporta il confronto tra branch: non gestisce comandi SQL o non supporta il branching (manca la connessione admin). | Usa un'istanza Postgres con `adminConnectionString` configurata. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabella che presenta differenze non può essere unita — aggiunta o rimossa dal branch, con modifiche alle colonne o alla chiave primaria, priva di chiave primaria, con troppe righe da confrontare o riscritta dalla creazione del branch (`TABLE_REWRITTEN`). Una tabella le cui righe non sono state confrontabili blocca l'operazione anche con conteggio pari a 0: sono indeterminate, non nulle. `details.tables` le elenca fornendo la motivazione. Nessun dato è stato scritto. | Applica prima lo schema con le migrazioni, o esegui il merge specificando `skipBlocked: true` per escludere tali tabelle. |
| `BRANCH_MERGE_CONFLICT` | 409 | Sono presenti modifiche alle stesse righe sia sul branch sia sul genitore e `onConflict` era impostato su `"abort"` (impostazione predefinita); oppure il genitore ha rigettato una parte del merge — una riga è cambiata nel frattempo, un trigger l'ha esclusa, una policy l'ha nascosta. Nessun dato è stato scritto. | Definisci quale versione deve prevalere con `onConflict: "branch"` o `"target"`, oppure ricalcola il diff. |
| `BRANCH_MERGE_FAILED` | 409 | Il genitore ha rifiutato le righe del branch all'interno dell'istruzione di merge — per un vincolo, un valore enum o una foreign key presente sul target e violata dai dati del branch, situazione tipica in presenza di schemi disallineati. `details` include `sqlState`, `table`, `constraint` e `detail`. Nessun dato è stato scritto. | Analizza le variazioni di schema nel diff, allinea lo schema del genitore con le migrazioni o correggi le righe sul branch, quindi riesegui il merge. |
| `BRANCH_NOT_FOUND` | 404 | Nessun branch con questo nome nel registro. | Il comando `rebase db branch list`, o il pannello Branches, elenca i branch disponibili. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contract del progetto viene restituito solo se l'autenticazione è abilitata — descrive ogni tabella e relazione. | Configura l'autenticazione. La route `/meta/schema-version` è invece sempre accessibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna mailbox di sviluppo attiva. I messaggi sono intercettati solo se `SMTP_HOST` non è configurato e `NODE_ENV` non è production. | Rimuovi la configurazione di `SMTP_HOST` in fase di sviluppo, oppure consulta la casella di posta reale. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` è visibile ai medesimi soggetti a cui `GET /api/schema/tables` illustra le tabelle; questo server non ha autenticazione configurata, quindi non vi sono destinatari a cui esporle. | Configura l'autenticazione, o rendi pubblico l'intero documento a chiunque specificando `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | La modifica di schema proposta non è formalmente valida. | Vedi il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione della modifica pianificata allo schema è fallita per motivi non coperti da codici più specifici. | Vedi il messaggio; riporta fedelmente il fallimento sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è corretta ma non può essere applicata allo stato attuale dello schema. | Vedi il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non committate, impedendo l'applicazione sicura della modifica. | Esegui il commit o lo stash delle modifiche, poi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha rifiutato l'operazione: l'oggetto della modifica è definito tramite codice che l'editor non riscrive (spread operator, funzioni helper, chiavi calcolate), o si tratta di una variazione non supportata dall'editor (rinomina di una tabella, rimozione dell'ultima regola). `details.problems` ne elenca i dettagli. Nessun dato è stato scritto. | Vedi il messaggio. Modifica manualmente i file in `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | La modifica è eseguibile, ma lo schema risultante non compilerebbe correttamente — come una relazione verso una tabella eliminata o una regola associata a una colonna rimossa. `details.problems` contiene i riscontri del compilatore, con tabella e colonna correlate. Nessun dato è stato scritto. | Aggiorna preventivamente le tabelle correlate, o modifica manualmente i file in `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un file interessato dalla modifica è cambiato su disco dopo la preparazione dell'operazione (salvataggio da IDE, altri processi). Nessun dato è stato scritto. | Ricarica e ripeti l'operazione applicandola al file nello stato corrente. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra identità non umana ha tentato di applicare una modifica allo schema. | Autenticati come utente, oppure abilita `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | L'editing dinamico dello schema richiede `schemaDir` (la directory `backend/schema`) o `liveSchema.repository`, ed entrambi risultano assenti all'avvio del server. Il codice d'errore conserva la nomenclatura originale. | Configura una delle due opzioni. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione ha successo; manca un repository su cui committare la modifica — come in un deployment basato su bundle compilato o su un server la cui cartella `backend/schema` non si trova in un repository git (l'applicazione comporta sempre un commit). | Esegui `git init` nel progetto e riavvia il server (il repository viene cercato al boot), oppure definisci `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Questo deployment non apporta modifiche dirette al database (`REBASE_PROVISION=false`), pertanto l'aggiornamento non può essere applicato tramite pannello. | Esegui il commit del solo codice sorgente e lascia l'applicazione al processo incaricato delle migrazioni del database. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non supporta la pianificazione delle modifiche di schema. | L'editing dinamico è disponibile su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Le tabelle vengono lette tramite introspezione del database, non vi sono pertanto file sorgente da modificare. | Applica le modifiche allo schema tramite migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disabilitato per questo server. Un bundle compilato risponde sempre in questo modo. | Abilitalo tramite l'opzione `schemaEditor`. Sui bundle, imposta `REBASE_LIVE_SCHEMA_REPOSITORY` per gestire `backend/schema` tramite repository — vedi [Modifica dinamica dello schema](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema necessita del pacchetto `ts-morph`, che non risulta installato. | Installalo nel package del backend e riavvia: `pnpm --dir backend add -D ts-morph@28.0.0` dalla radice del progetto, oppure `pnpm add -D ts-morph@28.0.0` se la root corrisponde al backend. Il messaggio riporta il comando esatto per il tuo progetto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non ha configurato `schemaDir`, impedendo all'editor di individuare i file su cui scrivere. Il codice d'errore conserva la nomenclatura originale. | Imposta `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato quando `NODE_ENV=production`: i file di un server in produzione vengono ricompilati dal repository a ogni deploy, rendendo vane le modifiche applicate qui. | Modifica `backend/schema` in ambiente di sviluppo ed esegui il deploy, oppure configura `liveSchema.repository` per registrarle via commit. |
| `SCHEMA_UNAVAILABLE` | 404 | Chiamata a `GET /api/schema/tables` su un backend privo di autenticazione: non vi è un chiamante in base al quale filtrare la visibilità delle tabelle, e `auth.requireAuth: false` non modifica questo comportamento. | Configura un adapter di autenticazione o imposta `auth.jwtSecret`. Vedi [Endpoint](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` specifica una tabella non accessibile al chiamante — inesistente per quello slug, oppure non inclusa negli scope della credenziale in uso. | Verifica lo slug e controlla gli scope `data:*` associati alle credenziali. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | Richiesta a `/api/admin/ui-config` effettuata con chiave API, platform token o service key. Le preferenze UI appartengono a una persona autenticata. | Autenticati come utente. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | Le preferenze UI di una singola tabella superano i 64 KB. | Riduci i dati salvati: le preferenze servono per le impostazioni di visualizzazione, non per i dati. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | Il driver di questo backend non supporta query SQL e non memorizza le preferenze UI; il pannello le mantiene a livello di browser. | Nessun intervento richiesto: le preferenze restano isolate per ciascun browser. |
| `UI_CONFIG_FILE_INVALID` | 500 | Il file `frontend/src/cms/ui-config.json`, in cui vengono salvate le preferenze UI del workspace in fase di sviluppo, contiene JSON non valido. | Correggilo o eliminalo; il pannello provvederà a rigenerarlo al salvataggio successivo. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` non può inviare i risultati in streaming in questo contesto: il database di sviluppo in-process (PGlite) opera su una sola connessione, e mantenere un cursore attivo durante il download bloccherebbe tutte le altre query; oppure la sorgente dati non supporta i cursori SQL. | Collega `DATABASE_URL` a un'istanza Postgres indipendente (`rebase dev --docker` ne inizializza una), oppure applica un `LIMIT` ed esporta le righe a video. |

### Riconciliazione dello schema

Il comando [`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) pianifica
le operazioni tramite `POST /api/admin/schema/reconcile/plan` e le applica via
`/reconcile/apply`. L'eventuale rifiuto non modifica lo stato dei dati; solo `SCHEMA_RECONCILE_FAILED`
può lasciare un piano parzialmente eseguito.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | Il corpo non è un oggetto JSON, oppure `drop` non è un array di stringhe nel formato `"<table>.<column>"`. | Invia `{ "drop": ["voice_cache.wav"] }`, oppure ometti il parametro `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Un'istruzione è fallita a metà processo. Le istruzioni precedenti sono state eseguite e rimangono applicate; `details.applied` le elenca. | Correggi l'anomalia indicata nel messaggio, poi ricalcola il piano: il nuovo piano escluderà le operazioni già eseguite. |
| `SCHEMA_RECONCILE_INVALID` | 400 | Impossibile applicare il piano; il messaggio ne specifica le ragioni: una voce `drop` non rispetta il formato `<table>.<column>`, fa riferimento a tabelle o colonne inesistenti, o punta a una colonna ancora dichiarata nella tabella. `details.plan` contiene il piano. | Correggi l'elenco `drop`. Una colonna dichiarata va rimossa dal relativo `defineTable`, deployata e solo successivamente riconciliata. |
| `SCHEMA_RECONCILE_STALE` | 409 | Il database o le tabelle hanno subito variazioni dopo il piano confermato. `details.plan` riporta il nuovo piano generato. | Esamina il nuovo piano e conferma il relativo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | La chiamata a `/reconcile/apply` è priva del parametro `confirm`. | Esegui prima la pianificazione e invia il `digest` del piano come valore di `confirm`. La CLI esegue questo passaggio alla digitazione di `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | Il driver di questo backend non può pianificare una riconciliazione o non supporta comandi SQL. | La funzionalità di reconcile è supportata su Postgres. |

### Perché una tabella di un branch non può essere unita

`BRANCH_MERGE_BLOCKED` elenca in `details.tables` ogni tabella rifiutata, associandola a uno
dei seguenti codici. Lo stesso codice compare alla voce `blocked` della tabella nel diff,
consentendo a Studio di evidenziare il blocco prima che l'utente scelga **Merge**. Nessuno di essi costituisce
una risposta HTTP indipendente.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Le colonne della tabella differiscono tra il branch e il genitore. Le righe vengono confrontate solo sulle colonne condivise. | Aggiungi le colonne mancanti al genitore tramite migrazione (`rebase db push`), quindi procedi con il merge. Una migrazione che riscrive la tabella — come il cambio di tipo di una colonna — trasforma lo stato in `TABLE_REWRITTEN`: esegui il merge prima di apportare tale modifica, oppure rigenera il branch successivamente. |
| `NO_PRIMARY_KEY` | — | La tabella non possiede una chiave primaria, rendendo impossibile il confronto riga per riga; il diff calcola unicamente il totale delle righe. | Definisci una chiave primaria sulla tabella, oppure sposta i dati manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Le colonne che compongono la chiave primaria, o i relativi tipi, non coincidono tra i due ambienti. | Allinea preventivamente lo schema sul genitore. |
| `TABLE_ADDED` | — | La tabella è stata creata nel branch. Un merge non gestisce la creazione di tabelle. | Creala sul genitore tramite migrazione, quindi unisci le relative righe. |
| `TABLE_DROPPED` | — | La tabella è stata rimossa nel branch. Un merge non gestisce la cancellazione di tabelle. | Rimuovila tramite migrazione. |
| `TABLE_REWRITTEN` | — | Uno dei due ambienti ha riscritto tutte le righe della tabella dopo la creazione del branch — a seguito del cambio di tipo di una colonna, di un `ADD COLUMN` con default volatile, di un `VACUUM FULL` o di un `CLUSTER` — con la conseguenza che ogni riga risulta modificata e non è più possibile determinare quale parte abbia variato i dati. | Esegui il merge del branch prima di applicare tale migrazione, oppure ricrea il branch dal genitore successivamente. |
| `TOO_LARGE` | — | La tabella contiene in uno degli ambienti più righe di quante un diff ne possa confrontare puntualmente (100.000 per impostazione predefinita, parametro `maxRowsPerTable`). | Aumenta il valore di `maxRowsPerTable` sia per il diff sia per il merge, o migra i record con un'altra procedura. |

## Codici generici

Una route ricorre a uno di questi codici qualora non ve ne sia uno più specifico applicabile al caso.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Richiesta malformata, in assenza di un codice più specifico. | Vedi il messaggio. |
| `UNAUTHORIZED` | 401 | Mancata autenticazione o credenziali rifiutate. | Accedi o rinnova la sessione. |
| `FORBIDDEN` | 403 | Richiesta autenticata ma non autorizzata. | Riprovare con la stessa identità non risolverà il problema. |
| `CONFLICT` | 409 | Conflitto rispetto allo stato attuale dei dati. | Vedi il messaggio. |
| `INTERNAL_ERROR` | 500 | Errore generico a livello di server. Il messaggio è volutamente generico. | Riporta il valore di `requestId`; i dettagli sono reperibili nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza necessaria per questa route non è configurata su questo server. | Vedi il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Un servizio da cui la richiesta dipende è risultato irraggiungibile: un bucket S3 o MinIO, o un host contattato via `fetch()` da una funzione che rifiuta la connessione o non viene risolto dal DNS. Il log del server indica l'host; la risposta HTTP non lo espone. Un database non raggiungibile restituisce `DATABASE_UNAVAILABLE`. Il fallimento di una connessione verso tali servizi produce questo errore. | Riprova; controlla i log. |

## Mantenere accurata questa pagina

Il comando `pnpm verify:docs` fallisce qualora un codice producibile dal server
non compaia in queste tabelle, quando una tabella documenta un codice che il codice non può sollevare,
quando gli stati associati a una riga differiscono da quelli effettivamente restituiti dai sorgenti,
o qualora una famiglia di codici come `PG_<SQLSTATE>` risulti priva di voci per uno SQLSTATE
effettivamente riscontrabile dai chiamanti. Lo script di controllo è
`tooling/scripts/docs-verify/check-error-codes.mjs`.

La procedura verifica anzitutto la propria integrità. L'analisi legge i codici direttamente dal codice TypeScript
anziché interrogare un'istanza server attiva; pertanto eventuali punti ciechi nell'analisi resterebbero silenti:
in passato non era in grado di rilevare codici passati tramite wrapper a riga singola o posizionati dopo messaggi
contenenti una parentesi `)`, arrivando a certificare che "tutti i codici del server sono documentati"
a fronte di una pagina a cui ne mancavano ben diciassette. Per questa ragione, il processo esegue preventivamente un fixture test
contenente esattamente tali pattern prima di verificare questa pagina, e interrompe l'esecuzione qualora
non riesca a intercettarli.
