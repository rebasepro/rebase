---
sourceHash: f3bc0de4cbc7297e
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il rispettivo stato HTTP, il loro significato e come risolverli — oltre alla struttura dell'envelope di risposta, all'X-Request-ID e alle regole relative a details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e include un `code`
stabile. Il codice è l'elemento su cui basare la logica condizionale (branching): il messaggio è scritto per
una persona e potrebbe essere riformulato, lo stato HTTP è condiviso da una decina di
problemi diversi, mentre il codice non è soggetto a nessuna di queste due variabili.

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

- **`message`** — leggibile da persone. Per un codice `4xx` corrisponde al messaggio del
  server stesso; per un `5xx` è volutamente generico, poiché il testo sottostante
  potrebbe fare riferimento a un host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori riportati di seguito. Stabile tra minor version differenti.
- **`details`** — opzionale e mai garantito. Consulta le regole riportate sotto.
- **`requestId`** — presente ogni volta che la richiesta attraversa il middleware
  del request-ID, ossia per tutte le route sotto `basePath`.

### `X-Request-ID`

A ogni richiesta sotto `basePath` viene assegnato un ID: l'header `X-Request-ID` del
chiamante quando è un UUID, altrimenti uno nuovo generato al momento. Viene restituito
nella risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId`
e allegato alla riga di log del server per quella specifica richiesta.

Questa è la chiave di correlazione (join key). Includila in una segnalazione di bug e un operatore potrà
individuare l'unica riga di log che spiega il fallimento, contenente la motivazione che
non è mai stata mostrata al client.

Inviare il proprio ID è il modo in cui una traccia sopravvive a un hop di rete: un gateway o un
job runner che inoltra l'header ottiene un unico ID condiviso tra tutti i servizi che hanno gestito
la richiesta. Un valore non valido viene ignorato anziché rifiutato — non vale la pena
far fallire una richiesta per un header malformato inviato dal chiamante — quindi non dare
per scontato che l'ID inviato sia identico a quello ricevuto. Leggi l'header di risposta.

### Cosa contiene `details`

`details` ha scopi diagnostici, non contrattuali. È regolato da tre regole:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Si tratta degli
   errori commessi dal chiamante descritti con precisione: quale campo di filtro era sconosciuto,
   quale relazione non è scrivibile, quale valore non corrispondeva al relativo tipo.
2. **I dati diagnostici del database vengono ridotti in produzione.** Quando l'errore proviene
   da Postgres, `details.dbCode` — lo SQLSTATE — è sempre presente: indica
   la classe del problema e non rivela nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   perché Postgres include in essi i contenuti delle righe. `23505` segnala
   `Key (email)=(a@b.c) already exists.`, rispondendo alla domanda "questa persona è
   registrata?" per qualsiasi indirizzo chiunque decida di verificare.
3. **Non basare mai la logica condizionale su `details`.** Basala su `code`. Il contenuto di
   `details` corrisponde semplicemente a ciò che era utile a una persona in quel punto di chiamata,
   ed è soggetto a modifiche.

## Leggere uno stato

| Stato | Cosa indica sulla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticato, o la credenziale è scaduta. Effettua l'accesso o aggiorna il token. |
| `403` | Autenticato, ma non autorizzato. Riprovare con la stessa identità non risolverà il problema. |
| `404` | Route, collection o riga inesistente — oppure una riga nascosta dalla row-level security. |
| `409` | Un conflitto con lo stato esistente: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il corpo è troppo grande, il tipo di media è errato oppure è stato rifiutato semanticamente. |
| `429` | Limite di richieste superato (rate limited). Rallenta le richieste; il messaggio specifica per quanto tempo. |
| `500` | L'errore risiede nel server o nel suo database, non nel chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può gestirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza era irraggiungibile, non configurata o troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne possiede solo uno. | Completa la verifica MFA, quindi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nessuna — lo stato desiderato è già soddisfatto. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | L'account in fase di modifica, ripristino o eliminazione possiede un ruolo o uno scope che il chiamante non ha. `details.beyond` ne riporta i dettagli. | Fai eseguire la modifica a qualcuno che li possiede. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sessione guest ha tentato di approvare l'accesso di un dispositivo. Un guest non ha un account da associare a un dispositivo. | Accedi con un account, quindi approva l'accesso. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di elencare, creare, modificare o revocare chiavi API, che fossero del proprio tipo o personali. | Gestisci le chiavi come utente in possesso di `keys:write`, o tramite la service key. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione Rebase a monte, quindi la credenziale del chiamante non è mai stata esaminata. | Esegui il mount dell'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Effettua prima l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Fai assegnare il ruolo da un amministratore esistente. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è consentito solo per il primissimo utente, e questo non lo è. | Fai assegnare il ruolo da un amministratore esistente. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi una nuova verifica CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato nessuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati per una singola verifica MFA. | Avvia una nuova verifica. |
| `DEVICE_LOGIN_DECIDED` | 409 | L'accesso da dispositivo è già stato approvato o rifiutato. L'accesso viene stabilito una sola volta. | Avviane uno nuovo dal dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | L'accesso da dispositivo ha superato i dieci minuti di validità prima di essere deciso. | Avviane uno nuovo dal dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nessun accesso da dispositivo corrisponde a tale user code. Il polling del dispositivo restituisce invece i codici in minuscolo di RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Confronta il codice con quello visualizzato dal dispositivo. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con questo indirizzo — in fase di registrazione, cambio indirizzo o quando si fa clic su un link di cambio indirizzo se un altro account ha occupato l'indirizzo nel frattempo. | Accedi, oppure avvia un reset della password; per un cambio indirizzo, scegline un altro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP ma il server non ha alcun sistema di invio email configurato. | Configura SMTP o utilizza un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | Un accesso OAuth ha trovato un account con lo stesso indirizzo, ma il provider non ha verificato quell'indirizzo, quindi non è stato collegato. | Accedi con il metodo esistente, poi esegui `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma non è mai stato confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollegala prima dall'altro account. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una richiesta ha inviato `x-rebase-impersonate` ma il chiamante non è autorizzato a eseguire richieste come un altro utente. Solo la sessione di un amministratore connesso può farlo, mai una chiave API o la service key. | Inviala con la sessione di un amministratore oppure ometti l'header. |
| `IMPERSONATION_INVALID` | 400 | L'header `x-rebase-impersonate` è stato inviato vuoto. | Invia l'uid dell'utente da impersonare oppure ometti l'header. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` fa riferimento a un utente non attivo: nessun account ha quell'uid, oppure è disabilitato. | Controlla l'uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | L'autenticazione di questo backend non può eseguire una richiesta impersonando un altro utente poiché il relativo `AuthAdapter` non definisce `resolveUser`. | Implementa `resolveUser` nell'adapter oppure ometti l'header. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` è stato inviato a una route che non supporta l'impersonificazione. Solo l'API dati e le funzioni personalizzate la gestiscono; il socket realtime supporta `impersonate` su `AUTHENTICATE`. | Invia la richiesta senza l'header. |
| `SIMULATION_FORBIDDEN` | 403 | Una richiesta ha inviato un header `x-rebase-simulate-*` (il simulatore RLS) o ha richiesto `/api/admin/rls-simulator`, ma il chiamante non è autorizzato a simulare l'accesso. Solo la sessione di un amministratore autenticato può farlo, mai una chiave API o la service key. | Inviala con la sessione di un amministratore oppure ometti gli header. |
| `SIMULATION_INVALID` | 400 | La simulazione era malformata: un header è stato inviato vuoto, `x-rebase-simulate-api-key-id` è stato combinato con un ruolo o user id, oppure la simulazione è stata combinata con `x-rebase-impersonate`. | Specifica un solo ruolo (opzionalmente con un uid), un solo user id o un solo id di chiave API. |
| `SIMULATION_READ_ONLY` | 403 | Una scrittura, cancellazione, `_batch`, ripristino cronologia o una funzione personalizzata chiamata con qualsiasi verbo diverso da `GET`/`HEAD`/`OPTIONS` conteneva un header `x-rebase-simulate-*`. L'accesso simulato è di sola lettura: la scrittura verrebbe eseguita con l'identità simulata, non come amministratore. Le letture, inclusi `POST …/query` e `…/count`, continuano a funzionare. | Disattiva la simulazione per applicare le modifiche. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulazione fa riferimento a un utente non attivo (uno user id inviato senza ruolo) o a una chiave API non valida. | Verifica l'id, oppure invia un ruolo assieme all'uid per simulare un uid sprovvisto di account. |
| `SIMULATION_UNAVAILABLE` | 501 | Questo backend non può simulare l'accesso: il suo `AuthAdapter` non possiede `resolveUser` per confermare un amministratore, oppure è stata indicata una chiave su un backend privo di chiavi API. | Implementa `resolveUser`, oppure ometti gli header. |
| `SIMULATION_UNSUPPORTED` | 400 | Un header `x-rebase-simulate-*` è stato inviato a una route che non supporta l'accesso simulato. Solo l'API dati e le funzioni personalizzate li supportano. | Invia la richiesta senza gli header. |
| `GUEST_REFERENCED` | 409 | Impossibile eliminare un guest perché richiesto da una riga interna al progetto tramite una foreign key con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo segnala per ogni guest in `skipped` e prosegue. | Elimina la riga oppure mantieni il guest. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato incompatibile con questa operazione. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La verifica MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 400 / 401 | Il codice OTP o MFA è errato: 400 per l'accesso tramite codice email (`/auth/otp/verify`), 401 per la registrazione o verifica MFA. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — volutamente non specificato quale delle due. | Riprova, oppure reimposta la password. |
| `INVALID_PLATFORM_TOKEN` | 401 | Un token di piattaforma `rpt_` è stato rifiutato: firma non valida, audience errata, scaduto o durata superiore al limite massimo. Il messaggio ne specifica la causa. | Fai generare un nuovo token dalla piattaforma — su Rebase Cloud, esegui nuovamente il comando. |
| `INVALID_SCOPES` | 400 | È stato richiesto uno scope non valido per una chiave: malformato, sconosciuto o con un target non supportato dallo scope. `details.problems` ne specifica i motivi; `details.validScopes` elenca gli scope ammessi per una chiave. Esclude `keys:read` e `keys:write`, che nessuna chiave può possedere. | Usa un nome compreso nell'elenco. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token di verifica, reset, magic link o cambio indirizzo è malformato, sconosciuto, già utilizzato o scaduto (400). Una credenziale del provider OAuth o un refresh token non verificabile restituisce 401. | Richiedi un nuovo link oppure effettua nuovamente l'accesso. |
| `INVALID_USER_CODE` | 400 | Il codice inviato per l'accesso da dispositivo non è valido: deve essere di otto lettere, come `BCDF-GHJK`. | Copia il codice mostrato dal dispositivo. |
| `INVALID_ROLE` | 400 | Il nome del ruolo inserito non è una stringa, è vuoto oppure contiene `,` `{` `}` `"` `\` o un carattere di controllo. Questi caratteri verrebbero riletti come ruoli differenti: un ruolo risiede in un array Postgres `text[]` e nella lista separata da virgole analizzata dalle policy RLS, quindi `"support,admin"` verrebbe interpretato come `admin`. `details.problems` elenca ogni occorrenza. | Rinomina il ruolo. Qualsiasi altro nome è accettato. |
| `KEY_MANAGEMENT_SCOPE` | 400 | A una chiave sono stati assegnati gli scope `keys:read` o `keys:write`. Nessuna chiave può gestire chiavi. `details.scopes` ne riporta i dettagli. | Rimuovili. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titolare di `keys:write` ha tentato di modificare o revocare una service key che possiede un ruolo o uno scope che l'utente non ha. Solo un admin può gestire qualsiasi chiave. `details.roles` e `details.scopes` indicano quali elementi la chiave possiede in più rispetto al chiamante. | Fai modificare la chiave a un admin o a qualcuno che possiede tali permessi. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto privo di amministratori. | Promuovi prima un altro utente ad amministratore. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è parziale. `details` contiene un token a breve termine limitato alla verifica MFA — non è una sessione. | Avvia una verifica e completala; la risposta alla verifica emetterà la sessione. |
| `NO_SESSION` | 401 | Nessun cookie di sessione o refresh token fornito. Comportamento normale al caricamento iniziale della pagina. | Accedi. |
| `NOT_ANONYMOUS` | 400 | Una route per l'upgrade da account anonimo è stata chiamata da un account reale, oppure `DELETE /api/admin/guests/:uid` ne ha indicato uno. | Nessun upgrade necessario. Per eliminare un account, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o ha restituito un errore. | Riprova la procedura; il messaggio riporta la motivazione del provider. |
| `PERSONAL_KEYS_DISABLED` | 403 | Le chiavi API personali sono disabilitate su questo backend. | Imposta `personalKeys: true` nel blocco `auth` della collection users. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La service key o una sessione guest ha tentato di usare le route per le chiavi personali. Nessuna delle due dispone di un account per conto del quale una chiave possa agire. | Accedi a un account, oppure crea una service key sotto `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token di piattaforma `rpt_` è giunto su un server che non li accetta: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` non sono configurati. | La piattaforma che ospita l'app configura entrambi al momento del deploy; effettua nuovamente il deploy o accedi all'app in un altro modo. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta la frequenza delle richieste; il messaggio specifica per quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione di reindirizzamento non è inclusa nell'elenco degli indirizzi consentiti. | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | L'autoregistrazione è disabilitata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXCEEDS_CALLER` | 403 | I ruoli da assegnare includono uno scope, o il ruolo `admin`, che il chiamante non possiede. `details.beyond` ne riporta i dettagli. | Fai assegnare il ruolo da qualcuno che li possiede. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una service key è stato assegnato un ruolo RLS che il suo creatore non possiede. Solo un amministratore può assegnare qualsiasi ruolo. `details.roles` ne riporta i dettagli. | Rimuovi il ruolo, o fai creare la chiave da un amministratore. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli del chiamante — su una route di amministrazione o su una richiesta dati in un backend con `config.auth`. Il sistema applica una logica di fail-closed invece di fidarsi dei ruoli contenuti nel token. Un token il cui uid non corrisponde ad alcun account, compreso un uid non compatibile con la tabella degli utenti, genera un 401 e non questo errore. Un database irraggiungibile restituisce `DATABASE_UNAVAILABLE`. | Riprova; verifica lo stato del database. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | A una chiave è stato richiesto uno scope non posseduto dal suo creatore. Una chiave non può mai avere permessi superiori a quelli dell'account che la crea. `details.scopes` ne riporta i dettagli. | Rimuovili, oppure fai creare la chiave a qualcuno che li possiede. |
| `SCOPE_MISSING` | 403 | La credenziale non possiede lo scope richiesto da questa route, collection, risorsa di storage o funzione. `details.requiredScope` lo indica, target incluso. | Per una persona, usa un ruolo che dichiara lo scope. Per una chiave, usa una chiave che lo possiede. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una route protetta con `requireScope` fa riferimento a uno scope applicativo non dichiarato da questo backend, per cui nessuno lo possiede, nemmeno un amministratore. Un nome che non corrisponde a alcuno scope, o uno scope integrato scritto male come `data:raed`, non raggiunge questo punto: `requireScope` genera un errore al momento della registrazione della route. | Dichiara lo scope in `auth.scopes` nella collection degli utenti, o correggi il nome. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | È stato effettuato il logout dalla sessione altrove, tutte le sessioni sono state revocate, oppure l'account è stato eliminato. Tutti gli endpoint che accettano una sessione rispondono in questo modo a tale access token: API dati, storage, funzioni personalizzate e route di amministrazione. Il socket realtime rifiuta il comando `AUTHENTICATE` con un frame `AUTH_ERROR` contenente lo stesso codice. L'SDK tenta un refresh, il refresh viene rifiutato e viene eseguito il logout. | Accedi nuovamente. |
| `ACCOUNT_DISABLED` | 401/403 | Un amministratore ha disabilitato l'account: accesso (403), refresh e tutti i token posseduti (401) vengono rifiutati, su qualsiasi endpoint che accetti una sessione. Il socket realtime rifiuta il comando `AUTHENTICATE` con un frame `AUTH_ERROR` contenente lo stesso codice. | Contatta un amministratore. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` è attivo e l'indirizzo non è ancora stato verificato. Restituito solo a fronte di una password corretta; viene inviato un nuovo link via email. | Segui il link presente nell'email. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: l'account contiene una password o un'identità non verificate da nessuno, e la richiesta non ne conferma nessuna delle due. Il token non viene consumato. | Invia `password` per mantenerla, o `removeUnproven: true` per verificare senza di essa. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | È stata richiesta un'email di verifica per un indirizzo non raggiungibile — un guest o il segnaposto di X (400) — oppure un account ha richiesto di passare a un indirizzo simile (409, `POST /auth/change-email`). | Imposta prima un indirizzo reale. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` ha specificato l'indirizzo attuale dell'account. | Nessuna modifica da apportare. |
| `ANONYMOUS_USER` | 403 | Un guest ha richiesto di modificare il proprio indirizzo email; un guest non ne possiede uno proprio. | Trasformalo prima in un account (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Sono stati richiesti codici di recupero per un account privo di un secondo fattore verificato. | Registra prima un fattore. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` ha generato un'eccezione. Il messaggio è quello dell'hook; un hook che imposta uno stato 4xx risponde con tale stato. | Consulta il messaggio. |
| `INVALID_JSON` | 400 | Il corpo della richiesta non è in formato JSON. | Invia un body in formato JSON. |
| `SELF_DISABLE` | 400 | Un amministratore ha tentato di disabilitare il proprio account. | Chiedi a un altro amministratore. |
| `NOT_SUPPORTED` | 501 | L'auth repository di questo backend non supporta l'operazione richiesta (disabilitazione account, cambio indirizzo). | Riavvia il server per aggiungere la colonna o utilizza un repository che la supporti. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Il target di uno scope fa riferimento a una collection, risorsa di storage o funzione non gestita da questo backend. `details` elenca quelle supportate. | Correggi il target. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, codice email o reset password ha verificato l'indirizzo di un account non verificato, ma l'account include un'identità di accesso il cui provider non ha mai verificato quell'indirizzo. L'auth repository non può rimuoverla (manca `unlinkUserIdentity`), pertanto la verifica viene rifiutata per non lasciare aperta quella via d'accesso su un account verificato. | Implementa `unlinkUserIdentity` nel repository di autenticazione personalizzato, oppure chiedi a un amministratore di verificare l'account. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, pertanto questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | Un token monouso è stato riutilizzato, oppure un refresh token è stato ruotato da più tempo di quanto consentito da `refreshTokenReuseIntervalSeconds`. | Richiedine uno nuovo o accedi nuovamente. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con questo id. | Verifica l'id. |
| `WEAK_PASSWORD` | 400 | La password non soddisfa la [policy delle password](/docs/backend/auth-endpoints/#password-policy) (per impostazione predefinita oltre 8 caratteri con una maiuscola, una minuscola e una cifra) — in fase di registrazione, reset o modifica e per la password scelta da un amministratore: `POST /api/admin/users`, una creazione sulla collection users tramite data API, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Scegli una password più sicura. Un amministratore che importa account può inviare `skipPasswordPolicy: true` in fase di creazione. |

## Dati, query e scritture

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Un'aggregazione diversa da `count()` senza `groupBy` su una collection riscritta da un callback `afterRead` (globale, di collection o di proprietà). Un'aggregazione legge i valori archiviati e non esegue mai il callback, quindi una somma, un minimo, un massimo, il conteggio dei campi o un raggruppamento leggerebbero ciò che il callback nasconde. | Usa `count()` senza `groupBy`, oppure leggi le righe, che passano attraverso il callback. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non può calcolare l'aggregazione richiesta. | Usa un driver che la supporti, o calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), dove un branch *coincide* con il genitore e nulla verrebbe isolato. Il rifiuto è lo stesso restituito da `rebase db branch`. | Punta `DATABASE_URL` verso un'istanza Postgres indipendente (`rebase dev --docker` ne avvia una) ed esegui lì il branch. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni del limite per singolo batch (1000 per impostazione predefinita). Un batch rappresenta un'unica transazione e mantiene i relativi lock per l'intera durata. | Invialo suddiviso in più parti; il messaggio indica il limite e il conteggio attuale. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non supporta scritture atomiche su più collection, e un ciclo di scritture singole non sarebbe né atomico né eseguito in un unico round-trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per ciascuna collection. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o questo driver non supporta scritture massive (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 / 403 | Un callback della collection ha rifiutato la scrittura. Un'istruzione `throw` da `beforeSave`/`beforeDelete`/`after*` è un 400 contenente il messaggio definito dall'autore; un `beforeDelete` che restituisce `false` è un 403. `details.stage` indica il callback, `details.path` la collection. | Leggi il messaggio — è stato scritto per questo progetto, non da Rebase. |
| `CALLBACK_RECURSION` | 500 | Scritture avviate da hook nidificate oltre 16 livelli: la scrittura `context.data` di un hook esegue nuovamente gli hook di quella collection e nulla nella catena la interrompe — solitamente un `afterSave` che aggiorna la propria riga in modo incondizionato. L'intera scrittura è stata annullata (rollback). Il messaggio riporta l'hook e la collection; `details.chain` elenca ciascun passaggio hook → scrittura. | Rendi condizionale la scrittura dell'hook: agisci solo su `status === "new"`, oppure saltala quando `values` include già i dati che verrebbero scritti. |
| `COLLECTION_READ_ONLY` | 405 | Una scrittura ha raggiunto una collection associata a una vista SQL (`view`). Una vista è di sola lettura. | Esegui la scrittura sulle tabelle lette dalla vista. Consulta [Viste](/docs/collections/views/). |
| `SQL_NOT_ALLOWED` | 400 | L'istruzione SQL eseguita con le autorizzazioni del chiamante (`getSql(c)`, `withAuth(user).sql`) non era una singola istruzione semplice `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, oppure ha invocato `set_config` o fatto riferimento a `pg_settings`. L'identità del chiamante risiede nelle impostazioni di sessione, pertanto qualsiasi istruzione che possa modificarle viene rifiutata. | Mantieni il testo della query autonomo, con una sola istruzione, inserendo ogni valore in `params`. Consulta [Funzioni personalizzate](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore definisce già il punto di inizio della pagina, quindi un offset applicato in aggiunta salta silenziosamente quel numero di righe oltre il cursore — un salto non visibile al chiamante nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una ricerca testuale o una query vettoriale. Entrambe associano un punteggio a ciascuna riga, per cui due righe non risulteranno mai identiche e `DISTINCT` non aggregherebbe nulla — sembrerebbe funzionare ma non cambierebbe nulla. | Rimuovi uno dei due parametri. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` è ordinata in base a una colonna non restituita. Una `SELECT DISTINCT` può essere ordinata solo in base alle colonne presenti nella sua lista di selezione, altrimenti le righe aggregate non hanno un ordine definito. `details.fields` ne riporta i dettagli. | Aggiungi tali campi a `?fields=` o rimuovili da `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Impossibile raggiungere il database: connessione rifiutata o interrotta, host non risolto, server in fase di avvio o arresto, o database chiuso a nuove connessioni (`ALLOW_CONNECTIONS false`, condizione che un comando `rebase db branch create --force` interrotto a metà lascia sull'origine; i log del server specificano il database e `rebase db branch list` lo riapre). Restituito su qualsiasi canale, inclusi accesso, route di amministrazione e socket realtime (frame `ERROR`). Inviato con `Retry-After: 5`. | Riprova; l'SDK lo fa automaticamente. Verifica che il database sia attivo e raggiungibile dal server. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | Il server database ha rifiutato una nuova connessione perché ha esaurito quelle disponibili (`53300` troppi client, `53400` limite di connessioni di un ruolo o del database raggiunto). Tutte le istanze condividono il parametro `max_connections` del server; questa situazione si verifica in presenza di più istanze con pool ampi e nessun connection pooler. È una condizione di carico, non un guasto; inviato con `Retry-After: 2`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Abbassa `DB_POOL_MAX` (o limitalo con `REBASE_DB_POOL_MAX`) tra le varie istanze, anteponi un pooler al database (`DATABASE_POOLED`), oppure aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | L'apertura di una nuova connessione al database ha richiesto più tempo di `DB_POOL_CONNECT_TIMEOUT`: il database risponde lentamente alle connessioni o ha un'alta latenza di rete. Inviato con `Retry-After`. | Riprova; l'SDK lo fa automaticamente. Verifica il carico del database e la connettività di rete. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): policy di row-level security che blocca questo ruolo o un `GRANT` mancante. | Consulta [Risoluzione dei problemi](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Tutte le connessioni raggruppate nel pool del database sono rimaste occupate per l'intera durata di `DB_POOL_CONNECT_TIMEOUT`, quindi la richiesta non ha raggiunto il database. Condizione di sovraccarico, non un guasto; inviato con `Retry-After`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Aumenta `DB_POOL_MAX` o individua le query lente o le transazioni prolungate che bloccano le connessioni. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` di aggregazione o `groupBy` fa riferimento a un campo che i ruoli del chiamante non possono leggere (`access.read`), un percorso nidificato o un ordinamento aggregato indica una relazione non leggibile — oppure un'operazione sui campi (`$inc`, `$push`, …) ha come target uno di questi, dove un limite rifiutato rivelerebbe il valore archiviato. Un campo non trasmissibile nella risposta non deve poter essere esaminato tramite query, altrimenti il valore sarebbe desumibile un predicato alla volta. Un filtro tramite relazione (`author.salary`) e un ordinamento aggregato sul campo di una relazione (`max(staff.salary)`) vengono valutati in base alla regola della destinazione. `details.violations` elenca ciascun campo. Un campo nascosto con `excludeFromApi` risponde come se non esistesse: un filtro, `orderBy`, `fields`, `include`, `select` di aggregazione o `groupBy`, oppure un `vector_search` che vi faccia riferimento riceve esattamente la risposta data a un nome errato (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), e nessuna risposta per campo sconosciuto lo elencherà. | Rimuovi il campo dalla query oppure ottieni il ruolo necessario. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il corpo imposta un campo che i ruoli del chiamante non possono scrivere (`access.write`). Rifiutato anziché ignorato: una scrittura che tralascia un campo segnalerebbe un esito positivo per una modifica non avvenuta. Lo stesso codice rifiuta una scrittura tramite genitore che imposta una relazione non scrivibile dal chiamante, e un aggiornamento che imposta un valore per un campo `softDelete` — solo un'eliminazione può impostarlo. `details.violations` elenca ciascun campo. | Rimuovi il campo oppure ottieni il ruolo necessario. Un campo non scrivibile da nessuno risponde invece con `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | È stato inviato un aggiornamento o un'eliminazione con filtri alla collection users via HTTP, le cui scritture vengono convalidate utente per utente prima di essere eseguite. | Leggi gli utenti, quindi usa `updateMany`/`deleteMany` filtrando per id. |
| `FILTER_REQUIRED` | 400 | Una scrittura basata su filtri (un aggiornamento o eliminazione tramite `where`/`logical`, da SDK o route bulk) non contiene condizioni, pertanto coinvolgerebbe ogni riga. Rifiutata prima dell'esecuzione. | Aggiungi una condizione. Per modificare intenzionalmente ogni riga, imposta una condizione soddisfatta da ogni riga. |
| `HISTORY_UNAVAILABLE` | 503 | Una scrittura su una collection con `history: true` è stata rifiutata perché non è stato possibile registrare la cronologia: il database non include la tabella `rebase.entity_history` o, per `openRebase` e `rebase console`, la funzione `rebase.record_history`. Nessun backend con cronologia abilitata è mai stato avviato su questo database. Non è stata eseguita alcuna operazione, inclusi i callback; le letture restano invariate. Generato da `openRebase` e restituito da un backend creato con `provision: false`. | Avvia il backend almeno una volta con la cronologia attiva e `provision: true` (operazione eseguita da `rebase dev`), poi riprova. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una precedente richiesta con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine dell'operazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata riutilizzata per una richiesta differente: metodo, percorso, query string o corpo diversi. | Usa una nuova chiave o invia la richiesta originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indica una funzione che non è di aggregazione (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una di queste funzioni; il messaggio ne riporta l'elenco. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una trasformazione `groupBy` è sconosciuta o non applicabile alla colonna: `year`/`month`/`day` su una colonna non temporale, `unnest` su una colonna che non è un array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest` su una colonna del tipo appropriato. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce di `?select=` non rispetta il formato `fn(field)`; una funzione diversa da `count()` o `fingerprint()` è stata specificata senza campo; `percentile` non include una frazione compresa tra 0 e 1; oppure `fingerprint()` è stato invocato su una vista standard, che non memorizza righe fisiche. | Scrivi ad esempio `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` o `orderBy` su un'aggregazione priva di `groupBy`, oppure un cursore su qualsiasi aggregazione. Un'aggregazione non raggruppata restituisce un'unica riga, e un gruppo non è una riga da cui un cursore possa ripartire. | Aggiungi `groupBy` o rimuovi tali parametri; pagina i gruppi tramite `offset` o `page`. Consulta [Aggregazioni](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | In un'operazione di `/_batch` manca `op`, `collection`, `values` o `id`, fa riferimento a una collection non servita da questo backend oppure riutilizza un nome `ref`. | Consulta il messaggio; indica l'operazione in base al suo indice. |
| `INVALID_BATCH_REF` | 400 | Un riferimento `{ "$ref": "<name>.<field>" }` non corrisponde ad alcuna operazione precedente, fa riferimento a un'operazione successiva o richiede un campo non presente nella riga referenziata. Vengono risolti solo i riferimenti all'indietro. | Assegna un `ref` all'operazione *prima* di farvi riferimento. |
| `INVALID_BULK_BODY` | 400 | Il corpo della richiesta bulk non presenta la struttura prevista. | Invia l'array previsto dalla route: `{ "rows": [...] }` per `POST /bulk`, `{ "updates": [{ "id", "data" }] }` per `PATCH /bulk`, `{ "ids": [...] }` per `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regola di conflitto di un upsert (mantenere i duplicati o sostituire solo in base a un `where`) è stata inviata senza `upsert: true`, oppure entrambe le regole sono state specificate contemporaneamente. | Invia `upsert: true` e una sola delle due regole. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert specifica colonne prive di vincolo di unicità, le specifica senza `upsert: true`, o viene inviato in una creazione nidificata dove una riga corrispondente verrebbe spostata sotto il nuovo genitore. Postgres restituirebbe altrimenti 42P10 dall'interno di una transazione che ha già iniziato le operazioni. Riguarda inoltre qualsiasi upsert sulla collection degli utenti (auth), dove creazione e aggiornamento seguono regole differenti. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target validi. Sulla collection users, invia una `POST` per creare e una `PATCH` per aggiornare. |
| `INVALID_COUNT` | 400 | `?count=` non è impostato su `exact` o `none`. Rifiutato anziché interpretato con il valore predefinito: un errore di battitura come `?count=nnone` eseguirebbe il conteggio che si intendeva saltare. | Invia `exact` (predefinito) o `none`. Consulta [Saltare il conteggio](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Impossibile leggere il cursore `after`, oppure indica un id riga non compatibile con le colonne chiave della collection: è stato troncato, ricodificato o generato manualmente. Un cursore leggibile inviato con un `orderBy` diverso da quello con cui è stato generato restituisce `CURSOR_ORDER_MISMATCH`, anch'esso un 400. | Invia nuovamente `meta.nextCursor` della pagina precedente senza alterarlo, con il medesimo `orderBy` o nessuno. Consulta [Paginazione](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Rifiutato anziché ignorato: un errore come `?deleted=true` che nascondesse silenziosamente le righe cancellate sembrerebbe funzionare ma produrrebbe il risultato opposto. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è impostato su `true` o `false`. | Invia uno di questi due valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | È stato utilizzato un operatore `$inc` / `$push` / `$pull` / `$merge` su un tipo di proprietà non compatibile, con un operando non valido, con due operatori sullo stesso campo, con un errore di battitura o in una creazione — dove non esiste un valore preesistente su cui operare. | Consulta [Scrittura tramite REST](/docs/backend/writes/#field-operations); il messaggio indica il campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una scrittura filtrata ha fatto riferimento a un percorso attraverso una relazione (`posts/1/comments`) o a nessuna collection. | Esegui la scrittura sulla collection correlata applicando un filtro sul relativo collegamento. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro fa riferimento a una proprietà non presente in questa collection. | Controlla la correttezza del nome rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di proprietà — ad esempio `like` su un numero o una data. | Consulta [Esecuzione di query sui dati](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Impossibile interpretare il valore del filtro in base al tipo della colonna confrontata: `?id=eq.abc` su una chiave intera, un valore non compreso nell'enum, un timestamp non valido, un numero fuori intervallo. `details.dbCode` riporta lo SQLSTATE. | Invia un valore compatibile con il tipo di colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è impostato su `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "false" — un errore di battitura che esegue un soft-delete a fronte di una richiesta di eliminazione definitiva farebbe credere che i dati siano stati rimossi. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non è un elenco di percorsi valido o contiene un oggetto opzioni per-relazione non conforme. Un percorso nidificato oltre tre passaggi restituisce `INCLUDE_TOO_DEEP`, anch'esso un 400. Errore intercettato a monte anziché propagato dal driver come 500. | Consulta il messaggio; indica il percorso non valido. |
| `INVALID_INPUT` | 400 | Il corpo della richiesta non ha superato la convalida. | Consulta il messaggio. |
| `INVALID_LIMIT` | 400 | `?limit=` non è un numero intero compreso tra 1 e il massimo consentito (1000 per impostazione predefinita); valori superiori vengono rifiutati, non ridotti al limite. Una sottoscrizione realtime con un limite esterno all'intervallo riceve lo stesso codice tramite frame `ERROR` WebSocket. | Riduci il limite e usa la paginazione per i dati rimanenti. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` / `?not=` è malformato o supera il livello di nidificazione consentito. | Consulta il messaggio; mostra la regola di flattening. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non rispetta il formato `field`, `field:desc`, `field:desc:last` o un array JSON di `{ field, direction, nulls }` — oppure specifica una direzione diversa da `asc`/`desc`, o un posizionamento di NULL diverso da `first`/`last`. | Consulta il messaggio; mostra la sintassi consentita. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine hanno indice in base 1, quindi `?page=0` viene considerato un errore anziché la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro della query è malformato. | Consulta il messaggio. |
| `INVALID_QUERY_BODY` | 400 | Il corpo di un `POST …/query` contiene un valore non consentito nell'URL: una lista per un parametro a valore singolo nell'URL (`fields`, `limit`, …), un oggetto per un filtro, o parametri specificati anche nell'URL — un'operazione `POST …/query` legge tutti i parametri dal corpo. | Imposta ogni valore come faresti nell'URL — una stringa o una lista per filtri ripetuti; `where`, `include`, `orderBy` e `vector` accettano JSON. Consulta [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia ad esempio `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non è impostato su `cosine`, `l2` o `inner_product`. | Usa una di queste tre opzioni. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un valore numerico. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia ad esempio `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Un aggiornamento specifica la chiave della riga con un valore diverso da quello mediante cui è identificata — nel body o tramite `beforeSave`. Una riga non può cambiare chiave: tutte le fasi successive alla scrittura (rilettura, `afterSave`, cronologia, realtime) la indirizzano tramite la chiave originale. Rifiutato prima dell'esecuzione di qualsiasi hook, senza scrivere nulla, su ogni canale. `details.violations` indica il campo. | Crea la riga con la nuova chiave ed elimina la precedente. Specificare la chiave attuale della riga è consentito. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata invocata senza `?select=`. | Aggiungine uno, es. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` è stato invocato su una collection che non rappresenta una vista materializzata. | Esegui il refresh solo su collection con `view: { materialized: true }`. |
| `NO_COLLECTIONS` | 404 | Il progetto non espone alcuna collection: nessuna dichiarata nel codice e nessuna tabella da cui dedurla. Se le tabelle esistono ma la row-level security è disattivata, il messaggio le elenca includendo il comando SQL per abilitarla, e `details.unprotectedTables` le riporta. | Crea le tabelle — tramite migrazione, SQL o file di collection con `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con tale id in questa collection — oppure la riga è nascosta al chiamante dalla row-level security. | Verifica l'id, quindi controlla le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` specifica un elemento che non corrisponde a una relazione della collection. Lo stesso codice restituisce **404** quando un *percorso URL* nidificato specifica una relazione inesistente, es. `/api/data/authors/1/posts` dove `authors` non ne dichiara nessuna — in quel caso l'URL non individua alcuna risorsa, trattandosi di not-found e non di richiesta malformata. | Controlla il nome della relazione — il messaggio elenca quelle presenti nella collection. Un back-reference deve essere dichiarato sul genitore per essere attraversabile. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento fa riferimento a una proprietà non ordinabile. | Ordina in base a una proprietà mappata su colonna. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` è stato combinato con `?offset=` — oppure `page` con `offset` in un `find()`, operazione rifiutata preventivamente con lo stesso codice dall'SDK client, dal modulo in-process `rebase.data` e dal client offline. Entrambi definiscono lo stesso intervallo e in precedenza `page` sovrascriveva silenziosamente `offset` senza che l'utente potesse accorgersene. | Specifica solo uno dei due. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo supera il limite configurato. | Invia una quantità inferiore di dati o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` ha tentato di eseguire una scrittura. Una lettura con scope di richiesta viene eseguita in una transazione `READ ONLY`, pertanto né il callback né i metodi da esso invocati possono scrivere dati. | Sposta la scrittura all'esterno della lettura: un job in background o `rebase.dataAsAdmin` da un cron job o da una funzione personalizzata. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` è giunto su un data driver privo di viste materializzate. | Nessun elemento su cui eseguire il refresh in questo backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura conteneva un payload di collegamento, ma il percorso non raggiunge la destinazione tramite un `manyToMany` che dichiara `through.properties` — di conseguenza non esiste una riga di giunzione su cui memorizzarlo. | Dichiara `through.properties` sulla relazione o rimuovi il payload dalla scrittura. Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non è compatibile con lo schema registrato. L'operazione viene rifiutata anziché ignorata: ignorarla notificherebbe il successo di una scrittura mai avvenuta, o restituirebbe un insieme vuoto a fronte di righe esistenti. | Esegui `rebase schema generate` se lo schema generato non è allineato al database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura partendo dall'entità proprietaria della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso nidificato non rappresenta una relazione scrivibile, o una creazione/aggiornamento specifica una relazione `via` multi-hop — solo le relazioni `via` a singolo hop sono scrivibili. `details.fields` elenca le chiavi `via`. Nessun dato è stato scritto. | Scrivi direttamente le righe collegate dalla catena. Consulta [Relazioni](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione dichiara colonne di giunzione, ma questa origine dati non è in grado di scriverle. | Il collegamento in sé funziona; solo il relativo payload aggiuntivo non è supportato. Verifica le funzionalità del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura su relazione non disponeva della chiave di origine a cui associare il collegamento. | Salva prima la riga genitore. |
| `RESULT_TOO_LARGE` | — | Un'istruzione inviata tramite `EXECUTE_SQL` del socket realtime — `admin.executeSql` da un client, letture catalogo del pannello di amministrazione — ha restituito più di 128 MB di righe, quindi nessun dato è stato inviato. Consegnato come frame `ERROR` WebSocket. Le esecuzioni avviate dalla console SQL non vengono bloccate: mostrano le prime righe. | Aggiungi un `LIMIT` o seleziona meno colonne, leggendo i risultati a blocchi. |
| `ROW_IN_TRASH` | 409 | La chiave di un upsert appartiene a una riga nel cestino (una riga soggetta a soft-delete occupa ancora la propria chiave). L'upsert non scrive su una riga cancellata, su nessun canale: REST `?on_conflict=`, upsert `/bulk` e `/_batch`, SDK e socket realtime. Nessun dato è stato scritto. | Ripristina prima la riga (con un aggiornamento che imposti il campo di soft-delete a `null`), oppure eliminala definitivamente con `?hard=true` e riesegui l'upsert. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabella o colonna prevista dal codice non esiste nel database. | Esegui `rebase db push` in sviluppo; effettua un nuovo deploy se su tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. Il punteggio di pertinenza viene calcolato per ciascuna query anziché archiviato, quindi non può essere usato come chiave per un cursore. | Pagina la pertinenza con `limit`/`offset` o ordina per colonna. |
| `SQL_ERROR` | 400 | Il database ha rifiutato l'SQL inserito manualmente. Tramite `EXECUTE_SQL` del socket realtime restituisce un frame `ERROR` contenente il messaggio del database. `POST /api/admin/sql/csv` lo restituisce prima di inviare qualsiasi porzione di file: errore di sintassi, scrittura tentata (il download opera in sola lettura), istruzioni multiple o ruolo non consentito per la connessione. | Correggi l'istruzione SQL. Un download accetta una singola query `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un chiamante privo di ruoli presenti in `view.roles` ha tentato di leggere una vista materializzata o ne ha richiesto il refresh. Una vista materializzata non dispone di row-level security, pertanto viene servita integralmente ed esclusivamente a tali ruoli. | Leggila con uno dei ruoli consentiti, oppure aggiungi il ruolo del chiamante a `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura sposterebbe una riga da un tenant all'altro. Una riga non può cambiare tenant. `details.violations` indica il campo. Un trigger applica la stessa regola direttamente nel database, quindi l'SQL eseguito con le credenziali del chiamante fallisce con errore Postgres `42501` e messaggio che inizia con `TENANT_IMMUTABLE`. | Crea la riga nell'altro tenant ed elimina la riga attuale, oppure scrivi usando un ruolo configurato in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura indica un tenant a cui questo chiamante non appartiene; verrebbe rifiutata anche dal database. | Scrivi all'interno di un tenant di appartenenza del chiamante o autenticati come utente appartenente a tale tenant. |
| `TENANT_REQUIRED` | 400 | La collection ha visibilità isolata per tenant (tenant-scoped) e il tenant non può essere dedotto automaticamente: la richiesta non ne include alcuno o il chiamante appartiene a più tenant. | Invia il campo tenant in modo esplicito o autenticati con un'utenza associata a un unico tenant. |
| `TRANSACTION_ABORTED` | 500 | Un'istruzione nella transazione di scrittura è fallita e un callback ha intercettato l'errore. Poiché Postgres aveva già interrotto la transazione, la scrittura è stata annullata e nessun dato è stato salvato. Solo una creazione, aggiornamento o cancellazione tramite `context.data` rifiutata dal database viene annullata singolarmente e può essere intercettata in sicurezza. | Lascia che l'errore si propaghi (throw) oppure esegui una verifica prima dell'istruzione. Consulta [Semantica delle transazioni](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` include un campo non presente nella collection. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o un `groupBy` include un campo non presente nella collection. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro indica un campo non presente in questa collection — o nella destinazione di una relazione — oppure un campo nascosto tramite `excludeFromApi`. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro fa riferimento a un operatore inesistente. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket realtime ha un `type` non gestito dal server. Restituito come frame `ERROR` contenente il `requestId` della richiesta, consentendo la risoluzione della richiesta invece di attendere il timeout. | Controlla il campo `type` del frame; il messaggio ne indica il valore. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento indica un campo non presente nella collection. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un header `If-Match` fa riferimento a una versione della riga non più attuale: la riga è stata modificata tra la lettura e questa scrittura. Nessun dato è stato scritto. | Rileggi la riga, applica nuovamente la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo non presente nella collection. | Controlla la correttezza del nome; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è di tipo `vector` in questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il valore di `Content-Type` non è tra quelli accettati da questa route. | Invia il tipo documentato per la route. |
| `UNSUPPORTED_OPTION` | — | Generato come eccezione, non come risposta HTTP: a una scrittura tramite accessor in-process (`context.data` in un callback, `rebase.data` in una funzione o cron) è stato passato `ifMatch` o `idempotencyKey`. Questo canale non dispone di verifica delle precondizioni o di archivio di idempotenza, quindi l'opzione viene rifiutata preventivamente anziché ignorata. | Rimuovi l'opzione o esegui la scrittura tramite client HTTP, che le supporta entrambe. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è configurato in una sola direzione, impedendo la correlazione con una sottoquery. | Applica il filtro partendo dal lato proprietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Operatore non definito per questo campo: una relazione senza colonna diretta su questa riga viene filtrata per appartenenza, e i confronti con pattern (`like`, `ilike` e le relative negazioni) si applicano solo ai testi. | Consulta il messaggio; elenca gli operatori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore viola una regola di `validation` definita sulla proprietà — lunghezza, intervallo, pattern o campo obbligatorio mancante. | Consulta il messaggio; elenca ciascuna violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il corpo scrive su una colonna contrassegnata con `excludeFromApi` o `access: { write: [] }` — la stessa regola, con due sintassi diverse. La loro gestione è riservata al server: hash della password, token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è identica per ogni chiamante, `admin` compreso. | Rimuovi il campo. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Il valore non è compatibile con il tipo della proprietà. | Consulta il messaggio; indica la proprietà interessata. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo include un campo non presente nella collection — compreso un argomento `id` su una collection la cui chiave è un altro campo. | Controlla la correttezza del nome; il messaggio elenca i campi noti. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | È stato combinato un cursore (`after` / `startAfter`) con una ricerca vettoriale. Le righe sono ordinate in base a una distanza calcolata per ogni singola query, che non può fare da chiave per un cursore, pertanto un elenco vettoriale non restituisce `nextCursor`. | Pagina le righe più vicine usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha rifiutato la scrittura. | Controlla le `securityRules` della collection. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura rifiutata da Postgres per una motivazione legata ai *dati inviati dal chiamante*
restituisce lo SQLSTATE all'interno del codice: `PG_23505`, `PG_23503`, e così via. Si tratta di una
famiglia di codici e non di un elenco statico — Postgres definisce centinaia di SQLSTATE — ma solo due
classi possono confluire qui, in quanto solo queste due dipendono dal chiamante:

- **classe 23**, violazione di vincoli di integrità: duplicato, foreign key che punta
  a un elemento inesistente, colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: valore non compatibile con il tipo della colonna.

Tutto il resto — connessione caduta, colonna mancante, problema di privilegi —
è di competenza del server e genera un errore `500`. Di conseguenza, `code.startsWith("PG_")` rappresenta una condizione sicura
per verificare che "la riga inviata non era valida", e i quattro riportati di seguito sono quelli
effettivamente riscontrabili da un client. `details.dbCode` riporta lo stesso SQLSTATE per tutti,
e il messaggio specifica il nome del vincolo violato.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Impossibile convertire un valore nel tipo della colonna — l'equivalente in scrittura di `INVALID_FILTER_VALUE`. | Invia un valore del tipo previsto per la colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo o imposta un valore di default per la colonna. |
| `PG_23503` | 400 / 409 | In fase di salvataggio, una foreign key punta a una riga non esistente (400). In fase di cancellazione, altre righe dipendono ancora da questa (409; un vincolo `RESTRICT` genera `PG_23001`, anch'esso 409). | Crea prima la riga di destinazione o correggi l'id; per l'eliminazione, rimuovi o riassocia prima le righe che vi fanno riferimento. |
| `PG_23505` | 409 | Violazione di un vincolo di unicità. Il messaggio specifica il vincolo violato. | Usa un valore diverso o aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Il parametro `maxResults` di un elenco di storage non è un numero intero pari almeno a 1, oppure il suo `pageToken` non è stato emesso da questa sorgente. Una dimensione pagina inferiore a uno restituiva in precedenza una pagina vuota con lo stesso token, provocando un ciclo infinito in un eventuale `while (pageToken)`. | Invia un valore `maxResults` positivo e restituisci `nextPageToken` invariato. |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Controlla il nome del bucket. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata, esce dal proprio prefisso o si trova sotto un prefisso riservato (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifica la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri di trasformazione immagine sono fuori intervallo o discordanti. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Il caricamento supera il valore `maxSize` definito dalla proprietà di destinazione. Applicato lato server, non solo nel browser. `details` riporta la proprietà, il limite e la dimensione reale. | Carica un file più piccolo o aumenta `maxSize` sulla proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo del file caricato non compare in `acceptedFiles` della proprietà, o non è presente nei tipi consentiti `allowedMimeTypes` della sorgente di storage. `details` contiene la proprietà (o la lista della sorgente), l'elenco dei tipi accettati e il content-type inviato. | Carica un tipo supportato o estendi `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | Il bucket S3 o GCS configurato per questa sorgente non esiste, o il provider ha rifiutato le credenziali di questo deployment. Il messaggio indica il bucket; `details.reason` è impostato su `NoSuchBucket` o sul rifiuto del provider. In precedenza un bucket mancante veniva interpretato per ogni file come "file non trovato". | Correggi il nome del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` per una sorgente con nome) o i permessi delle credenziali. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nessun backend di storage configurato su questo server, o nessuno è impostato come predefinito e la richiesta non specifica alcuna risorsa di storage; il messaggio elenca le risorse disponibili (501). Un caricamento riprendibile la cui sorgente è scomparsa prima del completamento restituisce 503. | Configura S3, GCS o storage locale, oppure indica una sorgente tramite `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Esecuzione di `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) tra due sorgenti che risiedono nello stesso bucket o directory. Trattandosi dello stesso file, ogni elemento risulterebbe già presente nella destinazione, ed eliminando la copia dell'origine verrebbe rimossa l'unica copia esistente. Nessun file è stato spostato o eliminato. | Associa la proprietà all'altra sorgente; i file sono già memorizzati lì. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) non è riuscito a scansionare tutte le collection, quindi un file referenziato da una di esse rischierebbe di apparire orfano. Con `?scan=`, la scansione indicata è quella che non ha potuto verificare tutte le collection. Nessun file è stato cancellato; `details.unscanned` elenca ciascuna collection e il motivo della mancata lettura. | Risolvi il problema che impedisce la lettura di queste collection ed esegui nuovamente il comando. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione non presente nella sorgente. Le scansioni sono conservate per 7 giorni nella sorgente analizzata; pertanto uno `storageId` diverso da quello della scansione non restituirà alcun risultato. | Passa lo `storageId` della scansione o avviane un'altra. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione ancora in stato `queued` o `running`, oppure fallita (`failed`). Nessun file è stato eliminato; `details.status` ne indica lo stato. | Attendi il completamento della scansione o avviane un'altra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione terminata da oltre 15 minuti. Nessun dato è stato rimosso. | Esegui una nuova scansione e cancella gli elementi a partire da essa. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione i cui elementi orfani sono già in fase di eliminazione. | Leggi i dettagli di `deletion` della scansione con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La sorgente di storage è dichiarata ma priva di credenziali in questo ambiente. | Configura le variabili d'ambiente per quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto la scrittura. | Controlla i relativi log e le credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini in corso simultaneamente. | Riprova; valuta l'adozione di un CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La richiesta specifica una risorsa di storage (`?storageId=`) non dichiarata in questo progetto. Un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** (su una lista, un upload, una cartella o un upload riprendibile verso S3 o GCS) — è l'archivio a non esistere, e `details` riporta i bucket e le sorgenti esistenti. Entrambi i casi in precedenza restituivano "file non trovato", identico alla risposta per una chiave non presente. | Dichiara la risorsa in `config/resources.ts` o controlla `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Una richiesta `PATCH` per un upload riprendibile è arrivata mentre un altro blocco dello stesso caricamento era ancora in ricezione — quasi sempre riconducibile a un client che ritrasmette il chunk in corso. L'operazione viene rifiutata invece di essere accodata, in modo analogo a tusd. | Richiedi l'offset con `HEAD /api/storage/tus/:id` e riprendi da quel punto; tus-js-client gestisce l'attesa e il rinvio in autonomia. Consulta [Upload riprendibili (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funzioni personalizzate

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione gestita con questo nome — o ne esiste una, ma le sue route non coprono il sub-path indicato. Un chiamante autenticato riceve inoltre l'elenco di ciò che *è* disponibile; un chiamante anonimo no, poiché tale lista costituisce un inventario degli endpoint personalizzati. Se il caricamento del file con quel nome è fallito, il messaggio lo segnala al chiamante autenticato indicando il nome del file: questa è la distinzione tra un refuso e un deployment non funzionante. Un utente anonimo riceve la notifica standard di nome sconosciuto, come in caso di mancata corrispondenza. | Verifica il nome tramite `GET /api/functions` o controlla il log di avvio per individuare file non caricati. |
| `FUNCTION_TIMEOUT` | 504 | L'esecuzione dell'handler ha superato il timeout consentito. Il processo è ancora in esecuzione e non può essere interrotto da questa postazione. | Associa un `AbortSignal` alle chiamate in uscita o incrementa `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo inoltra le funzioni verso un altro processo tramite proxy, ma non ha ottenuto risposta. | Verifica che il processo responsabile delle funzioni sia attivo. |

## Cron job

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | È stato richiesto l'avvio manuale di un cron job già in esecuzione — sullo stesso processo che ha risposto o su un altro che detiene il lease di esecuzione del job, come il worker dietro a un processo `api`. Non è stata eseguita alcuna operazione. L'evento ignorato è registrato nella cronologia del job e `details.log` ne riporta la voce; la riga specifica il processo in cui il job è attivo. | Riprova al termine dell'esecuzione corrente. Consulta [Cron job](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superfici di amministrazione e modifica dello schema

Questi errori indicano che una funzionalità è disattivata o non configurata, non che
la richiesta fosse errata. Ognuno di essi viene riportato anche sulla corrispondente route `/status` con un `200`,
in modo che un pannello di controllo possa disabilitare visivamente la funzione anziché mostrare un errore.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata richiesta una superficie riservata agli amministratori su un server privo di autenticazione configurata, rendendo impossibile distinguere un amministratore da un utente anonimo. | Configura `auth.jwtSecret`, o fornisci un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | A `POST /api/admin/branches/:name/merge` è stato inviato il fingerprint di un diff non più valido: il branch o il suo genitore hanno subito modifiche nel frattempo. Nessun dato è stato scritto. | Ricalcola il diff, esaminalo e procedi al merge usando il nuovo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La sorgente dati non supporta la comparazione tra branch: non prevede SQL o non supporta il branching (nessuna connessione di amministrazione configurata). | Usa un backend Postgres con `adminConnectionString` impostata. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabella modificata non può essere unita — aggiunta o rimossa dal branch, con colonne o chiave primaria differenti, priva di chiave primaria, con troppe righe da confrontare, o riscritta interamente dopo la creazione del branch (`TABLE_REWRITTEN`). Una tabella le cui righe non sono state confrontabili blocca l'operazione anche quando il conteggio indica 0: il conteggio è sconosciuto, non pari a zero. `details.tables` ne elenca ciascuna specificandone il motivo. Nessun dato è stato scritto. | Applica prima lo schema con le tue migrazioni o esegui il merge specificando `skipBlocked: true` per escludere tali tabelle. |
| `BRANCH_MERGE_CONFLICT` | 409 | Alcune righe sono state modificate sia sul branch che sul genitore e `onConflict` era impostato su `"abort"` (predefinito); oppure il genitore ha rifiutato parte del merge — una riga è cambiata nel frattempo, un trigger l'ha ignorata o una policy l'ha nascosta. Nessun dato è stato scritto. | Definisci quale versione deve prevalere con `onConflict: "branch"` o `"target"`, oppure rigenera il diff. |
| `BRANCH_MERGE_FAILED` | 409 | Il genitore ha rifiutato le righe del branch all'interno dell'istruzione di merge — per violazione di un vincolo, di un valore enum o di una foreign key definita sul genitore e non rispettata dai dati del branch, solitamente dovuta a schemi disallineati. `details` include `sqlState`, `table`, `constraint` e `detail`. Nessun dato è stato scritto. | Esamina le modifiche allo schema nel diff, allinea lo schema del genitore tramite le migrazioni o sistema le righe sul branch, quindi riesegui il merge. |
| `BRANCH_NOT_FOUND` | 404 | Nessun branch con questo nome nel registro. | Esegui `rebase db branch list`, o consulta il pannello Branches, per visualizzare quelli disponibili. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto del progetto viene esposto solo in presenza di autenticazione configurata — contiene la descrizione di tutte le tabelle e relazioni. | Configura l'autenticazione. La route `/meta/schema-version` è invece sempre accessibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna casella di posta per lo sviluppo attiva. Le email vengono intercettate solo se `SMTP_HOST` non è configurato e `NODE_ENV` è diverso da production. | Rimuovi la configurazione di `SMTP_HOST` in sviluppo, o verifica la reale casella di posta. |
| `INVALID_CHANGE` | 400 | La modifica dello schema proposta non è ben formata. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione della modifica programmata allo schema è fallita per motivi non gestiti da codici più specifici. | Consulta il messaggio; riporta testualmente l'errore originario. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma non applicabile allo stato attuale dello schema. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non committate, impedendo l'applicazione sicura della modifica. | Esegui il commit o lo stash delle modifiche, poi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha rifiutato la modifica. | Consulta il messaggio; riporta la motivazione specifica dell'editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra identità automatica ha tentato di applicare una modifica allo schema. | Accedi come utente reale, o abilita `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica live dello schema richiede `collectionsDir` o `liveSchema.repository`, ma questo server è stato avviato senza nessuno dei due. | Configura almeno una di queste opzioni. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione delle modifiche funziona, ma manca un repository in cui committare le variazioni. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Questo deployment non applica modifiche al proprio database (`REBASE_PROVISION=false`), pertanto una modifica non può essere applicata dal pannello. | Effettua il commit solo come codice sorgente e lascia l'applicazione al processo incaricato delle modifiche al database. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non supporta la pianificazione delle modifiche dello schema. | La modifica live è supportata su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Le collection vengono ricavate tramite introspezione del database, pertanto non vi sono file sorgente da modificare. | Modifica lo schema applicando una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disabilitato su questo server. Un bundle già compilato risponde sempre in questo modo. | Abilitalo tramite `schemaEditor`. Su un bundle compilato, imposta `REBASE_LIVE_SCHEMA_REPOSITORY` per modificare le collection tramite repository — consulta [Modifica live dello schema](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema necessita di `ts-morph`, che non risulta installato. | Installalo nel package che esegue il backend, quindi riavvia: `pnpm --dir backend add -D ts-morph@28.0.0` dalla root del progetto generato, o `pnpm add -D ts-morph@28.0.0` se il backend costituisce la root. Il messaggio specifica il comando corretto per il tuo progetto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non ha `collectionsDir` configurato, quindi l'editor non ha una cartella in cui scrivere. | Configura `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato con `NODE_ENV=production`: i file di un server distribuito vengono ricompilati dal repository a ogni deploy, rendendo vane le modifiche apportate qui. | Modifica le collection in locale ed esegui il deploy, o configura `liveSchema.repository` per effettuarne il commit direttamente. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | Impossibile inviare un risultato in streaming da `POST /api/admin/sql/csv`: il database di sviluppo in-process (PGlite) supporta una sola connessione, e mantenere aperto un cursore durante il download bloccherebbe ogni altra query; oppure la sorgente dati non dispone di cursori SQL. | Punta `DATABASE_URL` a un'istanza Postgres indipendente (`rebase dev --docker` ne avvia una), oppure applica un `LIMIT` ed esporta le righe a video. |

### Riconciliazione dello schema

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) pianifica
le operazioni tramite `POST /api/admin/schema/reconcile/plan` e le applica mediante
`/reconcile/apply`. Se la richiesta viene rifiutata nulla viene alterato; solo `SCHEMA_RECONCILE_FAILED`
può lasciare applicata una frazione del piano.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | Il corpo non è un oggetto JSON, oppure `drop` non è una lista di stringhe `"<collection>.<column>"`. | Invia `{ "drop": ["voice_cache.wav"] }` o ometti `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Un'istruzione è fallita a metà dell'operazione. Le istruzioni precedenti sono state applicate e restano confermate; `details.applied` ne riporta l'elenco. | Risolvi il problema indicato nel messaggio, quindi riesegui la pianificazione: il nuovo piano escluderà le operazioni già applicate. |
| `SCHEMA_RECONCILE_INVALID` | 400 | Il piano non può essere applicato; il messaggio elenca i motivi: un elemento `drop` non rispetta il formato `<collection>.<column>`, indica una collection o colonna inesistente o fa riferimento a una colonna ancora dichiarata nella collection. `details.plan` contiene il piano. | Correggi la lista `drop`. Una colonna ancora dichiarata viene rimossa eliminando la relativa proprietà, rilasciando il codice e riconciliando lo schema. |
| `SCHEMA_RECONCILE_STALE` | 409 | Il database o le collection hanno subito variazioni rispetto al piano confermato. `details.plan` contiene la nuova versione. | Esamina il nuovo piano e conferma il relativo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | A `/reconcile/apply` non è stato inviato il valore `confirm`. | Esegui prima la pianificazione e invia il `digest` del piano come parametro `confirm`. La CLI esegue questo passaggio dopo aver digitato `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | Il driver di questo backend non è in grado di pianificare una riconciliazione o non supporta l'esecuzione di SQL. | La riconciliazione è supportata su Postgres. |

### Perché una tabella di un branch non può essere unita

`BRANCH_MERGE_BLOCKED` riporta ciascuna tabella rifiutata in `details.tables`, associandovi uno
di questi codici. Lo stesso codice compare alla voce `blocked` della tabella all'interno del diff,
permettendo a Studio di segnalarlo prima della conferma del comando **Merge**. Nessuno di questi costituisce una risposta a sé stante.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Le colonne della tabella differiscono tra il branch e il genitore. Le righe vengono confrontate solo in base alle colonne comuni. | Aggiungi le colonne mancanti al genitore tramite le tue migrazioni (`rebase db push`), quindi effettua il merge. Una migrazione che riscrive la tabella — come la modifica del tipo di colonna — genera l'errore `TABLE_REWRITTEN`: esegui il merge prima di una simile variazione, o ricrea il branch successivamente. |
| `NO_PRIMARY_KEY` | — | La tabella non possiede una chiave primaria, rendendo impossibile confrontare le righe singolarmente; il diff mostra solo il conteggio complessivo delle righe. | Assegna una chiave primaria alla tabella o trasferisci le righe manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Le colonne della chiave primaria, o i rispettivi tipi, non coincidono tra i due ambienti. | Applica prima lo schema corretto sul genitore. |
| `TABLE_ADDED` | — | La tabella è stata creata sul branch. Un'operazione di merge non crea mai tabelle. | Creala sul genitore tramite le migrazioni, poi unisci le relative righe. |
| `TABLE_DROPPED` | — | La tabella è stata eliminata dal branch. Un'operazione di merge non elimina mai tabelle. | Rimuovila tramite le tue migrazioni. |
| `TABLE_REWRITTEN` | — | Uno dei due lati ha riscritto tutte le righe della tabella dopo la creazione del branch — variazione di tipo colonna, `ADD COLUMN` con default volatile, `VACUUM FULL`, `CLUSTER` — facendo apparire ogni riga come modificata successivamente e impedendo di distinguere quale lato abbia modificato le singole righe. | Unisci il branch prima di eseguire tale migrazione o ricrea il branch partendo dal genitore aggiornato. |
| `TOO_LARGE` | — | La tabella contiene su un lato più righe di quante un diff ne possa confrontare elemento per elemento (100.000 per impostazione predefinita, `maxRowsPerTable`). | Aumenta `maxRowsPerTable` sia per il diff che per il merge o sposta le righe tramite una procedura alternativa. |

## Codici generici

Una route ricorre a uno di questi codici quando non è disponibile un errore più specifico.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Richiesta malformata e nessun codice più specifico applicabile. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato o credenziale non valida. | Accedi o aggiorna la sessione. |
| `FORBIDDEN` | 403 | Autenticato, ma non autorizzato. | Riprovare con la stessa utenza non risolverà il problema. |
| `CONFLICT` | 409 | Conflitto con lo stato corrente delle risorse. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Errore interno del server. Il messaggio è volutamente generico. | Riporta il `requestId`; il dettaglio dell'errore è disponibile nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza necessaria a questa route non è configurata su questo server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Un servizio da cui la richiesta dipende non è raggiungibile: un bucket S3 o MinIO, o un host interrogato tramite `fetch()` da una funzione che rifiuta la connessione o non viene risolto dal DNS. Il log del server indica l'host; la risposta al client no. Un database irraggiungibile genera `DATABASE_UNAVAILABLE`. Il fallimento della connessione a tali servizi restituisce questo errore. | Riprova; controlla i log. |

## Mantenere accurata questa pagina

Il comando `pnpm verify:docs` fallisce se uno dei codici generabili dal server
risulta assente da queste tabelle, se una tabella riporta un codice non generabile,
se gli stati HTTP di una riga non rispecchiano fedelmente quelli generati dal codice sorgente o se per una famiglia di codici come `PG_<SQLSTATE>` manca una riga
per uno SQLSTATE riscontrabile dai chiamanti. Lo script di verifica è
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Questo processo convalida prima di tutto se stesso. La scansione rileva i codici analizzando i file TypeScript anziché interrogare
un'istanza in esecuzione, pertanto eventuali lacune di analisi risulterebbero silenziose per definizione: in passato non
riusciva a rilevare un codice incapsulato in un wrapper a riga singola o uno scritto dopo un messaggio
contenente un carattere `)`, segnalando che "tutti i codici del server sono documentati"
a fronte di una pagina in cui ne mancavano ben diciassette. Per questo motivo, la procedura esegue preventivamente un test con una fixture contenente
esattamente queste casistiche prima di analizzare la pagina, rifiutandosi di proseguire qualora non sia in grado di individuarle correttamente.
