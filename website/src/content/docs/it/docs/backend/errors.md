---
sourceHash: 816748d7e340be51
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il relativo stato HTTP, il significato e le azioni da intraprendere — oltre all'envelope di risposta, X-Request-ID e le regole per i details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e include un
`code` stabile. Il codice è l'elemento su cui creare diramazioni logiche (branching): il messaggio è scritto per
una persona e può essere riformulato, lo stato è condiviso da una
dozzina di problemi diversi, mentre il codice non è nessuna delle due cose.

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

- **`message`** — leggibile dall'uomo. Per un `4xx` è il messaggio del server stesso; per
  un `5xx` è deliberatamente generico, poiché il testo sottostante può citare un
  host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori indicati di seguito. Stabile tra versioni minori.
- **`details`** — opzionale e mai garantito. Consulta le regole di seguito.
- **`requestId`** — presente ogni volta che la richiesta è passata attraverso il middleware
  del request-ID, ovvero ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del
chiamante quando è un UUID, altrimenti uno nuovo. Viene restituito
nella risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e
allegato alla riga di log del server per tale richiesta.

Questa è la chiave di correlazione (join key). Includila in una segnalazione di bug e un operatore potrà trovare l'unica
riga di log che spiega l'errore, contenente il motivo che non è
mai stato mostrato al client.

Inviare il proprio ID è il modo in cui una traccia sopravvive a un hop: un gateway o un job runner che
inoltra l'header ottiene un unico ID attraverso tutti i servizi che hanno gestito la richiesta.
Un valore non valido viene ignorato anziché rifiutato — non vale la pena far fallire una richiesta per un
header malformato da parte di un chiamante — quindi non dare per scontato che l'ID inviato sia
l'ID ricevuto. Leggi l'header di risposta.

### Cosa contiene `details`

`details` ha valore diagnostico, non contrattuale. È regolato da tre regole:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Si tratta degli
   errori del chiamante descritti con precisione: quale campo di filtro era sconosciuto,
   quale relazione non è scrivibile, quale valore non corrispondeva al suo tipo.
2. **Le informazioni diagnostiche del database vengono rimosse in produzione.** Quando l'errore
   proviene da Postgres, `details.dbCode` — il SQLSTATE — è sempre presente: indica
   la classe del problema e non rivela nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   poiché Postgres vi inserisce il contenuto delle righe. `23505` segnala
   `Key (email)=(a@b.c) already exists.`, che risponde a "questa persona è
   registrata?" per qualsiasi indirizzo si provi a verificare.
3. **Non creare mai logiche condizionali su `details`.** Crea la logica su `code`. Il contenuto di `details` è
   semplicemente ciò che risultava utile a una persona in quel punto di chiamata, e può cambiare.

## Interpretare uno stato

| Stato | Cosa indica sulla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticato, o credenziale scaduta. Accedi o effettua il refresh. |
| `403` | Autenticato, ma non autorizzato. Riprovare con la stessa identità non servirà. |
| `404` | Route, tabella o riga inesistente — o una riga nascosta dalla sicurezza a livello di riga (RLS). |
| `409` | Conflitto con lo stato esistente: un duplicato o una scrittura simultanea. |
| `413` `415` `422` | Il corpo è troppo grande, il media type è errato o è stato rifiutato semanticamente. |
| `429` | Limite di richieste superato (rate limited). Rallenta; il messaggio indica per quanto tempo. |
| `500` | L'errore è del server o del suo database, non del chiamante. Controlla i log. |
| `501` | La route esiste, ma questa distribuzione non può servirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza non era raggiungibile, non configurata o troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa il challenge MFA, poi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nulla — lo stato desiderato è già verificato. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | L'account modificato, reimpostato o eliminato possiede un ruolo o uno scope che il chiamante non ha. `details.beyond` li elenca. | Fai eseguire la modifica a qualcuno che li possiede. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sessione ospite ha tentato di approvare l'accesso di un dispositivo. Un ospite non ha un account da associare a un dispositivo. | Accedi con un account, quindi approva. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di elencare, creare, modificare o revocare chiavi API, del proprio tipo o personali. | Gestisci le chiavi come persona provvista di `keys:write`, o con la chiave di servizio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione Rebase a monte, quindi la credenziale del chiamante non è mai stata controllata. | Monta l'applicazione tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Prima effettua l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Fatti assegnare il ruolo da un amministratore esistente. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è consentito solo per il primissimo utente, e questo non lo è. | Fatti assegnare il ruolo da un amministratore esistente. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi un nuovo challenge. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato nessuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati per un singolo challenge MFA. | Avvia un nuovo challenge. |
| `DEVICE_LOGIN_DECIDED` | 409 | L'accesso da dispositivo è già stato approvato o rifiutato. Un accesso viene deciso una sola volta. | Avviane uno nuovo sul dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | L'accesso da dispositivo ha superato i dieci minuti prima di essere deciso. | Avviane uno nuovo sul dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nessun accesso da dispositivo corrisponde a tale user code. Il polling del dispositivo stesso risponde invece con i codici minuscoli della RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Confronta il codice con quello mostrato dal dispositivo. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con quell'indirizzo — in fase di registrazione, cambio indirizzo o apertura del link di modifica indirizzo quando un altro account ha preso l'indirizzo durante l'attesa. | Accedi o avvia il recupero password; per un cambio di indirizzo, scegline un altro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP e il server non dispone di trasporto di posta. | Configura SMTP o usa un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | Un accesso OAuth ha trovato un account con lo stesso indirizzo, ma il provider non ha verificato tale indirizzo, quindi non è collegato. | Accedi con il metodo esistente, poi esegui `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma mai confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollegala prima da lì. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una richiesta ha inviato `x-rebase-impersonate` e il chiamante non può eseguire richieste come un altro utente. Può farlo solo la sessione di un amministratore autenticato, mai una chiave API o la chiave di servizio. | Inviala con la sessione di un amministratore, oppure ometti l'header. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` è stato inviato vuoto. | Invia lo uid dell'utente per cui operare, oppure ometti l'header. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` indica un utente non attivo: nessun account ha quello uid, oppure è disabilitato. | Controlla lo uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | L'autenticazione di questo backend non può eseguire richieste impersonando un altro utente, poiché il suo `AuthAdapter` è sprovvisto di `resolveUser`. | Implementa `resolveUser` nell'adapter, oppure ometti l'header. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` è stato inviato a una route che non supporta l'impersonificazione. Solo le API dati e le funzioni personalizzate lo supportano, mentre il socket realtime supporta `impersonate` su `AUTHENTICATE`. | Invia la richiesta senza l'header. |
| `SIMULATION_FORBIDDEN` | 403 | Una richiesta ha inviato un header `x-rebase-simulate-*` (il simulatore RLS), o ha interrogato `/api/admin/rls-simulator`, e il chiamante non può simulare accessi. Può farlo solo la sessione di un amministratore autenticato, mai una chiave API o la chiave di servizio. | Inviala con la sessione di un amministratore, oppure ometti gli header. |
| `SIMULATION_INVALID` | 400 | La simulazione era malformata: un header inviato vuoto, `x-rebase-simulate-api-key-id` combinato con un ruolo o user id, oppure simulazione combinata con `x-rebase-impersonate`. | Specifica un singolo ruolo (opzionalmente con uno uid), un solo user id o un solo ID di chiave API. |
| `SIMULATION_READ_ONLY` | 403 | Una scrittura, eliminazione, `_batch`, ripristino cronologia o una funzione personalizzata chiamata con verbi diversi da `GET`/`HEAD`/`OPTIONS` conteneva un header `x-rebase-simulate-*`. L'accesso simulato è in sola lettura: la scrittura verrebbe eseguita con l'identità simulata, non come amministratore. Le letture, incluse `POST …/query` e `…/count`, vengono comunque eseguite. | Interrompi la simulazione per apportare modifiche. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulazione specifica un utente non attivo (uno user id inviato senza ruolo) o una chiave API non valida. | Controlla l'ID, oppure invia un ruolo con lo uid per simulare uno uid privo di account. |
| `SIMULATION_UNAVAILABLE` | 501 | Questo backend non può simulare accessi: il suo `AuthAdapter` non ha `resolveUser` per convalidare un amministratore, oppure è stata specificata una chiave su un backend senza chiavi API. | Implementa `resolveUser`, oppure ometti gli header. |
| `SIMULATION_UNSUPPORTED` | 400 | Un header `x-rebase-simulate-*` è stato inviato a una route che non può essere eseguita con accesso simulato. Solo le API dati e le funzioni personalizzate li supportano. | Invia la richiesta senza gli header. |
| `GUEST_REFERENCED` | 409 | Impossibile eliminare un ospite perché una riga del progetto lo richiede mediante una chiave esterna con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo segnala per ciascun ospite in `skipped` e prosegue. | Elimina la riga, oppure mantieni l'ospite. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può agire. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | Il challenge MFA è sconosciuto o scaduto. | Avviane uno nuovo. |
| `INVALID_CODE` | 400 / 401 | Il codice OTP o MFA è errato: 400 per l'accesso con codice email (`/auth/otp/verify`), 401 per la registrazione o verifica di un challenge MFA. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — volutamente senza specificare quale. | Riprova o reimposta la password. |
| `INVALID_PLATFORM_TOKEN` | 401 | Un platform token `rpt_` è stato rifiutato: firma non valida, destinatario errato, scaduto o durata superiore al limite massimo. Il messaggio indica la causa. | Fai generare un nuovo token alla piattaforma — su Rebase Cloud, esegui nuovamente il comando. |
| `INVALID_SCOPES` | 400 | È stato richiesto per una chiave qualcosa che non è uno scope: malformato, sconosciuto o con un target non accettato dallo scope. `details.problems` specifica quali e perché; `details.validScopes` elenca gli scope consentiti per una chiave. Esclude `keys:read` e `keys:write`, che nessuna chiave può possedere. | Usa un nome dall'elenco. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token di verifica, ripristino, magic link o cambio indirizzo è malformato, sconosciuto, già usato o scaduto (400). Una credenziale del provider OAuth o un refresh token non verificabile restituisce 401. | Richiedi un nuovo link, o accedi di nuovo. |
| `INVALID_USER_CODE` | 400 | Ciò che è stato inviato come codice di accesso da dispositivo non è valido: deve essere di otto lettere, come `BCDF-GHJK`. | Copia il codice mostrato dal dispositivo. |
| `INVALID_ROLE` | 400 | Il nome del ruolo da inserire non è una stringa, è vuoto o contiene `,` `{` `}` `"` `\` o un carattere di controllo. Tali caratteri verrebbero riletti come altri ruoli: un ruolo viaggia in un `text[]` Postgres e nell'elenco separato da virgole suddiviso dalle policy RLS, quindi `"support,admin"` verrebbe riletto come `admin`. `details.problems` ne elenca ciascuno. | Rinomina il ruolo. Qualsiasi altro nome viene accettato. |
| `KEY_MANAGEMENT_SCOPE` | 400 | È stato richiesto `keys:read` o `keys:write` per una chiave. Nessuna chiave può gestire chiavi. `details.scopes` le elenca. | Omettili. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titolare di `keys:write` ha tentato di modificare o revocare una chiave di servizio che possiede un ruolo o uno scope che non possiede. Solo un amministratore gestisce qualsiasi chiave. `details.roles` e `details.scopes` indicano i permessi eccedenti della chiave rispetto al chiamante. | Fai modificare la chiave a un amministratore o a qualcuno che li possiede. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto privo di amministratori. | Promuovi prima un altro utente. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` contiene un token di breve durata limitato al challenge MFA — non è una sessione. | Apri un challenge e rispondi; la risposta al challenge rilascia la sessione. |
| `NO_SESSION` | 401 | Non è stato presentato alcun cookie di sessione o refresh token. Normale al primo caricamento della pagina. | Accedi. |
| `NOT_ANONYMOUS` | 400 | Una route di upgrade da utente anonimo è stata chiamata da un account reale, o `DELETE /api/admin/guests/:uid` ne ha indicato uno. | Nulla da aggiornare. Per eliminare un account, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato l'operazione o ha restituito un errore. | Riprova il flusso; il messaggio riporta la motivazione del provider. |
| `PERSONAL_KEYS_DISABLED` | 403 | Le chiavi API personali sono disattivate su questo backend. | Imposta `personalKeys: true` nelle opzioni `auth` della tabella auth (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La chiave di servizio o una sessione ospite ha tentato di usare le route per le chiavi personali. Nessuno dei due possiede un account per cui una chiave possa operare. | Accedi a un account, o crea una chiave di servizio sotto `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un platform token `rpt_` ha raggiunto un server che non li accetta: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` non sono impostati. | La piattaforma che ospita l'app li imposta entrambi durante il deploy; ridistribuisci o accedi all'app in un altro modo. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta; il messaggio indica per quanto tempo attendere. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione del reindirizzamento non è presente nell'allow-list. | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | La registrazione autonoma è disattivata. | Fai creare l'account a un amministratore. |
| `ROLE_EXCEEDS_CALLER` | 403 | I ruoli assegnati contengono uno scope, o `admin`, che il chiamante non possiede. `details.beyond` li elenca. | Fai assegnare il ruolo da qualcuno che li possiede. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una chiave di servizio è stato assegnato un ruolo RLS che il suo creatore non possiede. Solo un amministratore può assegnare qualsiasi ruolo. `details.roles` li elenca. | Rimuovi il ruolo, o fai creare la chiave a un amministratore. |
| `ROLE_EXISTS` | 409 | Quel nome di ruolo è già in uso. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli del chiamante — su una route di amministrazione o su una richiesta dati in un backend con `config.auth`. Si applica una politica di chiusura sicura (fail closed) anziché fidarsi dei ruoli nel token. Un token il cui uid non corrisponde ad alcun account, compreso uno uid non supportato dalla tabella utenti, è un 401, non questo errore. Un database non raggiungibile restituisce `DATABASE_UNAVAILABLE`. | Riprova; controlla il database. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | È stato richiesto per una chiave uno scope che il suo creatore non possiede. Una chiave non ha mai permessi superiori all'account che la crea. `details.scopes` li elenca. | Rimuovili, o fai creare la chiave da qualcuno che li possiede. |
| `SCOPE_MISSING` | 403 | La credenziale non possiede lo scope richiesto da questa route, tabella, storage source o funzione. `details.requiredScope` lo indica, target compreso. | Per una persona, usa un ruolo che dichiara lo scope. Per una chiave, usa una chiave che lo possiede. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una route protetta con `requireScope` fa riferimento a un'applicazione di scope che questo backend non dichiara, quindi nessuno lo possiede, neppure un amministratore. Un nome che non sia affatto uno scope, o uno integrato con errori di battitura come `data:raed`, non raggiunge mai questo punto: `requireScope` genera un errore al momento della registrazione della route. | Dichiara lo scope sotto `auth.scopes` nella tabella auth, o correggi il nome. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | È stato effettuato il logout altrove, ogni sessione è stata revocata o l'account è stato eliminato. Qualsiasi punto di accesso che accetta sessioni risponde così a tale access token: API dati, storage, funzioni personalizzate e route di amministrazione. Il socket realtime rifiuta l'istruzione `AUTHENTICATE` con un frame `AUTH_ERROR` recante lo stesso codice. L'SDK tenta il refresh, il refresh viene rifiutato e viene eseguito il logout. | Accedi di nuovo. |
| `ACCOUNT_DISABLED` | 401/403 | Un amministratore ha disattivato l'account: login (403), refresh e tutti i token posseduti (401) vengono rifiutati in qualsiasi punto di accesso che richiede una sessione. Il socket realtime rifiuta il comando `AUTHENTICATE` con un frame `AUTH_ERROR` recante lo stesso codice. | Contatta un amministratore. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` è attivo e l'indirizzo non è ancora verificato. Viene restituito solo a fronte di una password corretta; viene inviato un nuovo link via email. | Segui il link presente nell'email. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: l'account possiede una password o un'identità che nessuno ha verificato, e la richiesta non dimostra nessuna delle due. Il token non viene consumato. | Invia `password` per mantenerla, o `removeUnproven: true` per verificare senza di essa. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | È stata richiesta un'email di verifica per un indirizzo non raggiungibile via mail — un ospite o il placeholder di X (400) — oppure un account ha chiesto di passare a un indirizzo simile (409, `POST /auth/change-email`). | Imposta prima un indirizzo reale. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` ha indicato l'indirizzo attuale dell'account. | Nessuna modifica da apportare. |
| `ANONYMOUS_USER` | 403 | Un ospite ha chiesto di modificare il proprio indirizzo email; un ospite non ne possiede uno proprio. | Convertilo prima in un account (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Sono stati richiesti codici di ripristino per un account privo di un secondo fattore verificato. | Registra prima un fattore. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` ha generato un errore. Il messaggio corrisponde a quello dell'hook; un hook che specifica uno stato 4xx risponde con quest'ultimo. | Consulta il messaggio. |
| `INVALID_JSON` | 400 | Il corpo della richiesta non è in formato JSON. | Invia un corpo JSON. |
| `SELF_DISABLE` | 400 | Un amministratore ha tentato di disabilitare il proprio account. | Chiedi a un altro amministratore. |
| `NOT_SUPPORTED` | 501 | L'auth repository di questo backend non può compiere l'operazione richiesta (disabilitare account, cambiare indirizzo). | Riavvia il server affinché la colonna venga aggiunta, o usa un repository che la supporti. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Il target di uno scope fa riferimento a una tabella, storage source o funzione non gestita da questo backend. `details` elenca quelle supportate. | Correggi il target. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, un codice email o un reset password ha verificato l'indirizzo di un account non verificato, e l'account possiede un'identità di accesso il cui provider non ha mai verificato quell'indirizzo. L'auth repository non può rimuoverla (manca `unlinkUserIdentity`), quindi la verifica viene rifiutata per evitare accessi non autorizzati su un account verificato. | Implementa `unlinkUserIdentity` nel repository di auth personalizzato, o fai revisionare l'account da un amministratore. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, pertanto questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | Un token monouso è stato riutilizzato, oppure è stato impiegato un refresh token ruotato da più tempo rispetto a `refreshTokenReuseIntervalSeconds`. | Richiedine uno nuovo o accedi di nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con questo ID. | Controlla l'ID. |
| `WEAK_PASSWORD` | 400 | La password non soddisfa la [password policy](/docs/backend/auth-endpoints/#password-policy) (di default almeno 8 caratteri con una lettera maiuscola, una minuscola e una cifra) — in fase di registrazione, reset o modifica, e per le password scelte da un amministratore: `POST /api/admin/users`, una creazione sulla tabella auth tramite API dati, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Scegline una più complessa. Un amministratore che importa account può inviare `skipPasswordPolicy: true` in fase di creazione. |

## Dati, query e scritture

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Un'aggregazione diversa da `count()` senza `groupBy` su una tabella riscritta da un hook `afterRead` (globale, di tabella o `.transform()` di una colonna). Un'aggregazione legge i valori salvati e non esegue mai l'hook; quindi una somma, un minimo, un massimo, un conteggio di campi o un raggruppamento leggerebbero ciò che l'hook nasconde. | Usa `count()` senza `groupBy`, oppure leggi le righe, che passano attraverso l'hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non può calcolare l'aggregazione richiesta. | Usa un driver che lo supporti, oppure calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), in cui un branch *coincide* con il parent e nulla verrebbe isolato. Il rifiuto è il medesimo stampato da `rebase db branch`. | Punta `DATABASE_URL` a una tua istanza Postgres (`rebase dev --docker` ne avvia una) ed esegui lì il branch. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni rispetto al limite per batch (1000 di default). Un batch costituisce un'unica transazione e mantiene i suoi lock per l'intera durata. | Invialo suddiviso in parti; il messaggio specifica il limite e il conteggio attuale. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non supporta scritture atomiche su più tabelle, e un ciclo di singole scritture non sarebbe né atomico né eseguibile in un unico round trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per tabella. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa tabella o questo driver non supporta scritture massive (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook di tabella ha rifiutato la scrittura. Un'eccezione (`throw`) da `beforeSave`/`beforeDelete`/`after*` restituisce 400 con il messaggio dell'autore; un `beforeDelete` che restituisce `false` è un 403. `details.stage` specifica l'hook, `details.path` la tabella. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CALLBACK_RECURSION` | 500 | Le scritture avviate dagli hook hanno superato i 16 livelli di annidamento: una scrittura `context.data` di un hook esegue nuovamente gli hook di quella tabella e nulla nella catena lo interrompe — solitamente un `afterSave` che aggiorna la propria riga incondizionatamente. L'intera scrittura è stata annullata (rollback). Il messaggio riporta l'hook e la tabella; `details.chain` elenca ogni passaggio hook → scrittura. | Rendi la scrittura dell'hook condizionale: agisci solo su `status === "new"`, o saltala quando `values` contiene già ciò che scriverebbe. |
| `TABLE_READ_ONLY` | 405 | Una scrittura ha raggiunto una vista (`defineView`). Le viste sono in sola lettura. Precedentemente `COLLECTION_READ_ONLY`. | Scrivi sulle tabelle lette dalla vista. Consulta [Viste](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | La tabella è dichiarata, ma il database non la protegge: la sicurezza a livello di riga (RLS) è disattivata, nessuna delle policy dichiarate è presente, o manca una policy restrittiva dichiarata. (Una policy permissiva mancante viene servita, con un avviso di avvio che la specifica). Ciò accade quando il server non esegue il provisioning delle sue tabelle (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e il server trattiene la tabella anziché esporre ogni riga a qualsiasi chiamante. Una tabella di giunzione many-to-many segue la stessa regola: quando fallisce, le tabelle le cui relazioni la usano vengono trattenute e il messaggio riporta la giunzione; lo stesso vale per una tabella il cui `via` passa attraverso una tabella trattenuta, indicando il `via`. Anche la lettura di una relazione o un filtro che attraversa una tabella trattenuta restituisce questo codice. Le altre tabelle vengono servite regolarmente. Il log di avvio elenca le istruzioni per proteggerla. | Esegui le istruzioni indicate nel log di avvio (come fa `rebase db push`), quindi riavvia. |
| `SQL_NOT_ALLOWED` | 400 | L'SQL eseguito come chiamante (`getSql(c)`, `withAuth(user).sql`) non era una singola istruzione `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE` standard, oppure ha chiamato `set_config` o fatto riferimento a `pg_settings`. L'identità del chiamante risiede nelle impostazioni di sessione, quindi qualsiasi istruzione che potrebbe modificarle viene rifiutata. | Mantieni il testo della query proprietario, in una singola istruzione, con tutti i valori in `params`. Consulta [Funzioni personalizzate](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore indica già l'inizio della pagina, quindi applicare un offset salta silenziosamente quel numero di righe oltre il cursore — un divario invisibile nella risposta per il chiamante. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una query di ricerca o vettoriale. Entrambe associano un punteggio per riga, quindi due righe non sono mai considerate uguali e `DISTINCT` non raggrupperebbe nulla — sembrerebbe funzionare senza cambiare nulla. | Ometti uno dei due. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` è ordinata in base a una colonna non restituita. Una `SELECT DISTINCT` può essere ordinata solo in base a colonne presenti nel suo elenco di selezione, altrimenti le righe raggruppate non hanno un ordine definito. `details.fields` le elenca. | Aggiungi tali campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Impossibile raggiungere il database: connessione rifiutata o interrotta, l'host non si risolve, il server è in fase di arresto o avvio, oppure il database non accetta nuove connessioni (`ALLOW_CONNECTIONS false`, condizione lasciata sulla sorgente da un `rebase db branch create --force` interrotto; il log del server indica il database e `rebase db branch list` lo riapre). Rispondono così tutti i punti di accesso, inclusi login, route admin e socket realtime (frame `ERROR`). Inviato con `Retry-After: 5`. | Riprova; l'SDK lo fa automaticamente. Controlla che il database sia attivo e raggiungibile dal server. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | Il server di database ha rifiutato una nuova connessione per esaurimento delle stesse (`53300` troppi client, `53400` limite di connessioni di un ruolo o del database superato). Tutte le istanze del server condividono il `max_connections` del server, quindi questo accade con più istanze che utilizzano pool estesi senza pooler. È un problema di carico, non un guasto; inviato con `Retry-After: 2`. Il server registra la soluzione una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Riduci `DB_POOL_MAX` (o limitalo con `REBASE_DB_POOL_MAX`) su tutte le istanze, inserisci un pooler davanti al database (`DATABASE_POOLED`), oppure aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | L'apertura di una nuova connessione al database ha richiesto più tempo di `DB_POOL_CONNECT_TIMEOUT`: il database è lento ad accettare connessioni o è distante. Inviato con `Retry-After`. | Riprova; l'SDK lo fa automaticamente. Verifica il carico del database e la connettività di rete. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): policy RLS che nega l'accesso a questo ruolo o un `GRANT` mancante. | Consulta [Risoluzione dei problemi](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Tutte le connessioni in pool sono rimaste occupate per `DB_POOL_CONNECT_TIMEOUT`, quindi questa richiesta non ha mai raggiunto il database. Problema di carico, non un guasto; inviato con `Retry-After`. Il server registra la soluzione una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Aumenta `DB_POOL_MAX`, oppure individua le query lente o le transazioni lunghe che bloccano le connessioni. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, un'aggregazione `select` o `groupBy` indica un campo non leggibile dai ruoli del chiamante (`access.read`), un percorso annidato o un ordinamento aggregato indica una relazione che non possono leggere — o un'operazione su campo (`$inc`, `$push`, …) ne prende di mira uno, dove un vincolo negato rivelerebbe il valore salvato. Un campo che non può essere presente nella risposta non deve poter essere interrogato da alcuna query, altrimenti il valore sarebbe desumibile un predicato alla volta. Un filtro attraverso una relazione (`author.salary`) e un ordinamento aggregato sul campo di una relazione (`max(staff.salary)`) sono valutati secondo la regola della destinazione. `details.violations` elenca ciascun campo. Il driver applica la stessa regola a una lettura eseguita nel processo per conto del chiamante (`context.data` sotto lo scope del chiamante), a una ricerca vettoriale, a un include o a una verifica di unicità. Una colonna `.private()` risponde come se non esistesse: un filtro, `orderBy`, `fields`, `include`, `select` aggregata o `groupBy`, oppure `vector_search` che la specifichi riceve esattamente la risposta data a un nome errato (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), e nessuna risposta di campo sconosciuto la elencherà. | Rimuovi il campo dalla query o acquisisci il ruolo necessario. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | Il corpo imposta un campo che i ruoli del chiamante non possono scrivere (`access.write`). Viene rifiutato anziché scartato: una scrittura che ignora un campo restituirebbe successo per una modifica mai avvenuta. Lo stesso codice rifiuta una scrittura tramite un parent che imposta una relazione non scrivibile per il chiamante, e un aggiornamento che imposta un valore su un campo `softDelete` — solo una cancellazione può valorizzarlo. Il socket realtime risponde con 403 e questo codice per una scrittura su percorso annidato la cui tabella padre, relazione o tabella di destinazione non è ivi servita, per evitare di inoltrarla al driver senza controllo. `details.violations` elenca ogni campo. | Rimuovi il campo o acquisisci il ruolo. Un campo che nessuno può scrivere restituisce invece `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | È stato inviato un aggiornamento o una cancellazione filtrata alla tabella auth via HTTP, le cui scritture vengono validate utente per utente prima di essere eseguite. | Leggi gli utenti, quindi esegui `updateMany`/`deleteMany` per ID. |
| `FILTER_REQUIRED` | 400 | Una scrittura filtrata (update o delete tramite `where`/`logical`, dall'SDK o dalle route bulk) non contiene condizioni, quindi modificherebbe ogni riga. Rifiutata preventivamente. | Aggiungi una condizione. Per modificare intenzionalmente ogni riga, specificane una soddisfatta da tutte le righe. |
| `HISTORY_UNAVAILABLE` | 503 | Una scrittura su una tabella con `history: true` è stata rifiutata perché non è stato possibile registrarne la voce di cronologia: il database non ha la tabella `rebase.entity_history` o, per `openRebase` e `rebase console`, la funzione `rebase.record_history`. Nessun backend con cronologia attiva è stato avviato su questo database. Nulla è stato eseguito, inclusi gli hook, e le letture non sono compromesse. Sollevato da `openRebase`, e restituito da un backend creato con `provision: false`. | Avvia il backend almeno una volta con la cronologia abilitata e `provision: true` (come fa `rebase dev`), quindi riprova. |
| `HISTORY_UNSERVABLE` | 501 | Il data driver della tabella non può applicare le regole di lettura e gli hook `afterRead` sulle righe salvate (`DataDriver.serveStoredRows`), e la cronologia non viene mai servita senza maschera. Il driver Postgres integrato lo supporta. | Implementa `serveStoredRows` nel driver personalizzato. Consulta [Cronologia](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine della richiesta. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata usata per una richiesta differente: metodo, percorso, query string o corpo diversi. | Usa una nuova chiave o invia la richiesta originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indica una funzione che non è di aggregazione (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usane una tra quelle supportate; il messaggio le elenca. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una trasformazione `groupBy` è sconosciuta o non si applica alla colonna: `year`/`month`/`day` per colonne non data, `unnest` per colonne non array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest` su una colonna del tipo appropriato. |
| `INVALID_AGGREGATE_SELECT` | 400 | Un valore in `?select=` non è nella forma `fn(field)`; una funzione diversa da `count()` o `fingerprint()` non ha ricevuto alcun campo; `percentile` non ha una frazione tra 0 e 1; o `fingerprint()` è stato richiesto su una vista normale, che non memorizza righe fisiche. | Scrivi `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` o `orderBy` su un'aggregazione priva di `groupBy`, oppure un cursore su qualsiasi aggregazione. Un'aggregazione senza raggruppamento produce una sola riga, e un gruppo non è una riga dopo la quale un cursore possa proseguire. | Aggiungi `groupBy` oppure omettili; impagina i gruppi con `offset` o `page`. Consulta [Aggregazioni](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Un'operazione `/_batch` manca di `op`, `table`, `values` o `id`, specifica una tabella non gestita da questo backend o riutilizza un nome `ref`. | Consulta il messaggio; indica l'operazione per indice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` non fa riferimento ad alcuna operazione precedente, punta in avanti o richiede un campo inesistente nella riga referenziata. Si risolvono solo riferimenti all'indietro. | Assegna `ref` all'operazione *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | Il corpo della richiesta bulk non ha la struttura prevista. | Invia l'array accettato dalla route: `{ "rows": [...] }` a `POST /bulk`, `{ "updates": [{ "id", "data" }] }` a `PATCH /bulk`, `{ "ids": [...] }` a `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regola di conflitto di un upsert (mantieni duplicati, o sostituisci solo con una condizione `where`) è stata inviata senza `upsert: true`, oppure entrambe le regole sono state inviate contemporaneamente. | Invia `upsert: true` e una sola delle due regole. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert indica colonne prive di vincolo di unicità, le indica senza `upsert: true`, o viene inviato in un inserimento annidato (create) dove una riga corrispondente verrebbe spostata sotto il nuovo parent. Altrimenti Postgres risponderebbe con 42P10 all'interno di una transazione che ha già iniziato a lavorare. Vale anche per qualsiasi upsert sulla tabella auth, dove la creazione e l'aggiornamento seguono regole differenti. | Dichiara `.unique()` sulla colonna o un indice `unique`; il messaggio elenca i target validi. Sulla tabella utenti, invia `POST` per creare e `PATCH` per aggiornare. |
| `INVALID_COUNT` | 400 | `?count=` non è `exact` né `none`. Rifiutato anziché interpretato come default: un errore di battitura come `?count=nnone` eseguirebbe il calcolo del conteggio che intendeva evitare. | Invia `exact` (il valore predefinito) o `none`. Consulta [Omettere il conteggio](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Il cursore `after` non può essere letto o specifica un ID riga incompatibile con le colonne chiave della tabella: è stato troncato, ricodificato o creato manualmente. Un cursore leggibile inviato con un `orderBy` diverso da quello con cui è stato rilasciato restituisce `CURSOR_ORDER_MISMATCH`, anch'esso un 400. | Invia nuovamente `meta.nextCursor` della pagina precedente senza alterarlo, con lo stesso `orderBy` o nessuno. Consulta [Paginazione](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Rifiutato anziché ignorato: un errore di battitura `?deleted=true` che nascondesse silenziosamente ogni riga cancellata sembrerebbe funzionare ma risponderebbe all'esatto contrario. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è `true` o `false`. | Invia uno di questi; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | È stato utilizzato `$inc` / `$push` / `$pull` / `$merge` su un tipo di colonna non supportato, con un operando non valido, con due operatori sullo stesso campo, con errori di digitazione o in fase di creazione (create) — dove non c'è un valore salvato su cui agire. | Consulta [Scrittura tramite REST](/docs/backend/writes/#field-operations); il messaggio indica il campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una scrittura filtrata ha specificato un percorso attraverso una relazione (`posts/1/comments`) o nessuna tabella. | Scrivi sulla tabella correlata applicando un filtro sul suo collegamento. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro specifica una colonna inesistente in questa tabella. | Verifica la correttezza del nome rispetto alla tabella. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato per questo tipo di colonna — ad esempio `like` su un numero o su una data. | Consulta [Esecuzione di query](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Il valore del filtro non può essere interpretato nel tipo di dato della colonna confrontata: `?id=eq.abc` su una chiave intera, un'etichetta non presente nell'enum, un timestamp malformato, un numero fuori intervallo. `details.dbCode` riporta il SQLSTATE. | Invia un valore compatibile con il tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che provoca un soft-delete quando il chiamante intendeva eliminare definitivamente (purge) fa credere erroneamente che i dati siano stati distrutti. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: elenco dei percorsi non valido o oggetto opzioni per relazione di formato errato. Un percorso con più di tre hop restituisce `INCLUDE_TOO_DEEP`, anch'esso un 400. Intercettato al confine per evitare che il driver generi un 500. | Consulta il messaggio; indica il percorso errato. |
| `INVALID_INPUT` | 400 | Il corpo della richiesta non ha superato la convalida. | Consulta il messaggio. |
| `INVALID_LIMIT` | 400 | `?limit=` non è un numero intero compreso tra 1 e il massimo consentito (1000 di default); valori superiori vengono rifiutati, non limitati al massimo. Una sottoscrizione realtime che richiede un limite fuori intervallo riceve lo stesso codice come frame `ERROR` WebSocket. | Abbassa il limite e impagina i risultati successivi. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` / `?not=` è malformato o annidato oltre la profondità consentita. | Consulta il messaggio; mostra la regola di flattening. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non corrisponde a `field`, `field:desc`, `field:desc:last`, o a un array JSON di `{ field, direction, nulls }` — oppure indica una direzione diversa da `asc`/`desc` o un posizionamento di NULL diverso da `first`/`last`. | Consulta il messaggio; mostra le opzioni accettate. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine hanno indice in base 1, quindi `?page=0` viene considerato un errore e non la prima pagina. | Invia `1` o superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro della query è malformato. | Consulta il messaggio. |
| `INVALID_QUERY_BODY` | 400 | Il corpo di una richiesta `POST …/query` contiene un valore non trasferibile via URL: una lista per un parametro che l'URL legge come singolo (`fields`, `limit`, …), un oggetto per un filtro, o parametri duplicati sia nell'URL che nel body — una `POST …/query` legge tutti i parametri dal corpo. | Formatta ogni valore come nell'URL — stringa o lista per filtri ripetuti; `where`, `include`, `orderBy` e `vector` accettano JSON. Consulta [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non è `cosine`, `l2` o `inner_product`. | Usane uno tra questi tre. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un valore numerico. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Un aggiornamento specifica la chiave della riga con un valore diverso da quello con cui è indirizzata — nel corpo o impostata da un `beforeSave`. Una riga non può cambiare chiave: tutte le operazioni successive alla scrittura (rilettura, `afterSave`, cronologia, realtime) la indirizzano con la chiave originaria. Rifiutata prima dell'esecuzione di qualsiasi hook, senza scrivere nulla, su ogni interfaccia. `details.violations` indica il campo. | Crea la riga con la nuova chiave ed elimina questa. Inviare la stessa chiave già presente è consentito. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata chiamata senza `?select=`. | Aggiungine uno, es. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | È stato chiamato `refresh()` su una tabella che non è una vista materializzata. | Esegui il refresh solo su viste definite con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | Il progetto non serve alcuna tabella: nessuna dichiarata in `backend/schema`, e nessuna nel database da ispezionare. Se le tabelle esistono ma la sicurezza a livello di riga (RLS) è disattivata, il messaggio le elenca, con l'SQL per abilitarla, e `details.unprotectedTables` le specifica. In precedenza `NO_COLLECTIONS`. | Crea le tabelle — tramite migrazione, SQL, o un file `defineTable` seguito da `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con tale ID nella tabella indicata — o nascosta dalla sicurezza a livello di riga per questo chiamante. | Controlla l'ID e la configurazione `rls` della tabella. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica un valore che non corrisponde a una relazione della tabella. Lo stesso codice restituisce **404** se un *percorso URL* annidato ne specifica uno inesistente, es. `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuna — in quel caso l'URL non individua alcuna risorsa, trattandosi quindi di not-found e non di richiesta malformata. | Controlla il nome della relazione — il messaggio elenca quelle presenti nella tabella. Un riferimento inverso deve essere dichiarato sul parent per essere navigabile. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento fa riferimento a un campo non ordinabile. | Ordina su una colonna supportata. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` è stato combinato con `?offset=` — oppure `page` con `offset` in un `find()`, operazione rifiutata preventivamente con lo stesso codice da SDK client, `rebase.data` in-process e client offline. Descrivono la stessa finestra di risultati, e `page` prevaleva silenziosamente su un `offset` che non veniva mai applicato. | Invia solo uno dei due parametri. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo supera il limite configurato. | Invia un payload ridotto o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` ha tentato una scrittura. Una lettura associata alla richiesta viene eseguita in una transazione `READ ONLY`, pertanto né l'hook né le sue chiamate possono eseguire modifiche. | Sposta la scrittura fuori dal contesto di lettura: in un background job, o usa `rebase.dataAsAdmin` da un cron job o da una funzione personalizzata. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` è stato inviato a un data driver privo di viste materializzate. | Nessuna vista da aggiornare su questo backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura conteneva un payload di collegamento, ma il percorso non raggiunge la destinazione tramite un `manyToMany` che dichiara un `pivot` — manca quindi la riga di giunzione su cui memorizzarlo. | Dichiara le colonne `pivot` sulla relazione, oppure rimuovi il payload dalla scrittura. Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non è risolvibile rispetto allo schema registrato. L'operazione viene rifiutata anziché ignorata: ometterla segnalerebbe il successo di una scrittura mai avvenuta, o restituirebbe dati vuoti per righe invece esistenti. | Esegui `rebase schema generate` se lo schema generato è meno recente del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura dal lato proprietario della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile, oppure un'operazione di creazione o aggiornamento specifica una relazione `via` con percorsi multi-hop — solo le relazioni `via` a singolo hop sono scrivibili. `details.fields` elenca le chiavi `via`. Nulla è stato scritto. | Modifica direttamente le righe unite dalla catena di join. Consulta [Relazioni](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione dichiara colonne di giunzione, ma questa origine dati non supporta la loro scrittura. | Il collegamento in sé funziona; solo il payload associato non viene applicato. Verifica le capacità del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura su una relazione era priva della chiave di origine a cui agganciare il collegamento. | Salva prima la riga padre. |
| `RESULT_TOO_LARGE` | — | Un'istruzione inviata su `EXECUTE_SQL` tramite il socket realtime — `admin.executeSql` da un client, letture del catalogo dal pannello di amministrazione — ha restituito più di 128 MB di righe, quindi nulla è stato inviato. Consegnato come frame `ERROR` WebSocket. Le esecuzioni ordinarie della console SQL non vengono rifiutate: mostrano le prime righe. | Aggiungi un `LIMIT`, o seleziona meno colonne, e leggi il risultato a blocchi. |
| `ROW_IN_TRASH` | 409 | La chiave di un upsert appartiene a una riga nel cestino (una riga eliminata con soft-delete mantiene la propria chiave). Un upsert non sovrascrive una riga eliminata, su nessuna interfaccia: `?on_conflict=` REST, upsert `/bulk` e `/_batch`, SDK e socket realtime. Nulla è stato scritto. | Ripristina prima la riga (con un aggiornamento che imposta a `null` il campo di soft-delete), oppure eliminala definitivamente con `?hard=true` ed esegui nuovamente l'upsert. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabella o colonna attesa dal codice non esiste nel database. | Esegui `rebase db push` in sviluppo; effettua un nuovo deploy su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per ogni singola query e non memorizzata, quindi non può fungere da chiave per un cursore. | Impagina la rilevanza con `limit`/`offset`, oppure ordina in base a una colonna. |
| `SQL_ERROR` | 400 | Il database ha rifiutato l'SQL inserito manualmente. Su `EXECUTE_SQL` del socket realtime viene restituito un frame `ERROR` contenente il messaggio del database. `POST /api/admin/sql/csv` lo restituisce prima dell'invio del file: errore di sintassi, scrittura tentata (il download è in sola lettura), istruzioni multiple o ruolo non consentito per la connessione. | Correggi l'SQL. Un download accetta una sola istruzione `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un chiamante privo di qualunque ruolo presente in `view.roles` di una vista materializzata ha tentato di leggerla o aggiornarla. Una vista materializzata è priva di sicurezza a livello di riga (RLS), pertanto viene servita integralmente ed esclusivamente a tali ruoli. | Leggila disponendo di uno dei ruoli previsti, o dichiara il ruolo del chiamante in `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura sposterebbe una riga da un tenant all'altro. Una riga non può cambiare tenant. `details.violations` indica il campo. Un trigger fa rispettare la stessa regola a livello di database, pertanto l'SQL eseguito come chiamante fallisce con errore Postgres `42501` e un messaggio che inizia con `TENANT_IMMUTABLE`. | Crea la riga nell'altro tenant ed elimina questa, oppure esegui la scrittura con un ruolo incluso in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura specifica un tenant a cui il chiamante non appartiene; anche il database rifiuterebbe l'operazione. | Scrivi all'interno di un tenant di cui il chiamante fa parte, o autenticati come utente appartenente a quest'ultimo. |
| `TENANT_REQUIRED` | 400 | La tabella è legata ai tenant e il tenant non può essere dedotto: la richiesta non ne include alcuno, o il chiamante appartiene a più tenant. | Invia esplicitamente il campo tenant, o autenticati come chiamante appartenente a un singolo tenant. |
| `TRANSACTION_ABORTED` | 500 | Un'istruzione nella transazione di scrittura è fallita e un hook ha intercettato l'errore. Postgres aveva già interrotto la transazione, quindi la scrittura è stata annullata e nulla è stato salvato. Solo le operazioni `context.data` di creazione, aggiornamento o cancellazione rifiutate dal database vengono isolate singolarmente ed è sicuro gestirle con un catch. | Lascia propagare l'errore o esegui le verifiche prima di lanciare l'istruzione. Consulta [Semantica delle transazioni](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` indica un campo inesistente nella tabella. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o un `groupBy` fa riferimento a un campo inesistente nella tabella. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro fa riferimento a un campo inesistente nella tabella — o nel target di una relazione — oppure a una colonna `.private()`. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro specifica un operatore non riconosciuto. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket realtime ha un `type` non supportato dal server. Riceve risposta come frame `ERROR` contenente il `requestId` della richiesta, consentendole di risolversi anziché andare in timeout. | Controlla il `type` del frame; il messaggio lo indica esplicitamente. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento fa riferimento a un campo inesistente nella tabella. | Controlla la correttezza del nome; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un header `If-Match` specifica una versione della riga non più aggiornata: è stata modificata tra la lettura e questa scrittura. Nessun dato è stato salvato. | Rileggi la riga, applica nuovamente la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo non presente nella tabella. | Controlla la correttezza del nome; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale fa riferimento a una colonna che non è definita come `col.vector()` su questa tabella. | Il messaggio elenca le colonne vettoriali della tabella. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il `Content-Type` non è accettato da questa route. | Invia il tipo specificato nella documentazione della route. |
| `UNSUPPORTED_OPTION` | — | Sollevato a livello di codice, non restituito via HTTP: a una scrittura tramite accessor in-process (`context.data` in un hook, `rebase.data` in una funzione o cron) sono stati passati `ifMatch` o `idempotencyKey`. Questo canale non dispone di controllo precondizioni o store di idempotenza, pertanto l'opzione viene respinta preventivamente prima di scrivere anziché ignorata. | Rimuovi l'opzione in quel punto, oppure esegui la scrittura tramite client HTTP, che le supporta entrambe. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è strutturato in una sola direzione; manca quindi il riferimento per correlare a ritroso una sottoquery. | Filtra partendo dal lato proprietario della relazione. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è supportato per questo campo: una relazione senza colonna su questa riga viene filtrata per appartenenza (membership), e la ricerca di pattern (`like`, `ilike` e le relative negazioni) si applica solo al testo. | Consulta il messaggio; elenca gli operatori validi per il campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore non ha rispettato una regola dichiarata dalla colonna (`.validate()`, `.notNull()`, `.oneOf()`) — lunghezza, intervallo, pattern, campo obbligatorio, valore non incluso nell'elenco. Ogni voce di `details.violations` include un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene lo stesso elemento due volte, `$push` incluso), `unique_by` (due elementi di un array JSON condividono un valore nel campo indicato da `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulta il messaggio; indica la tabella, la colonna e ogni violazione riscontrata. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il corpo modifica una colonna impostata come `.private()`, o `.access({ write: [] })` — stessa regola, due sintassi alternative. Sono riservate all'uso del server: hash delle password, token di verifica. A differenza di `FIELD_NOT_WRITABLE`, la risposta è la medesima per qualsiasi chiamante, `admin` compreso. | Rimuovi il campo. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non è compatibile con il tipo della colonna. | Consulta il messaggio; indica la colonna interessata. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo fa riferimento a un campo non presente nella tabella — compreso un argomento `id` su una tabella con chiave primaria differente. | Controlla la correttezza del nome; il messaggio ("Table 'x' has no column 'f'. Known columns: …") elenca le colonne valide. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Un cursore (`after` / `startAfter`) è stato combinato con una ricerca vettoriale. Le righe vengono ordinate in base a una distanza calcolata per ogni singola query, che non può fungere da cursore; un elenco vettoriale non restituisce pertanto alcun `nextCursor`. | Impagina i risultati più vicini usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy RLS ha negato l'operazione di scrittura. | Controlla la configurazione `rls` della tabella. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura rifiutata da Postgres per un motivo legato ai *dati inviati dal chiamante*
restituisce il relativo SQLSTATE nel codice: `PG_23505`, `PG_23503`, e così via. Si tratta di una
famiglia di codici, non di un elenco limitato — Postgres definisce centinaia di SQLSTATE — ma solo due
classi vengono gestite in questo modo, poiché solo queste sono attribuibili a un errore del chiamante:

- **classe 23**, violazione dei vincoli di integrità: duplicato, chiave esterna che punta a un elemento inesistente,
  colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: valore non supportato dal tipo di colonna.

Tutto il resto — connessione caduta, colonna mancante, problemi di permessi —
è di competenza del server e rimane un `500`. Pertanto `code.startsWith("PG_")` è un controllo affidabile
per verificare che "la riga inviata era errata", e i quattro casi seguenti sono quelli
effettivamente riscontrati dai client. `details.dbCode` riporta il medesimo SQLSTATE per tutti loro,
e il messaggio specifica il nome del vincolo violato.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valore non può essere interpretato nel tipo della colonna — equivalente lato scrittura di `INVALID_FILTER_VALUE`. | Invia un valore compatibile con il tipo della colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo o imposta un valore predefinito sulla colonna. |
| `PG_23503` | 400 / 409 | In fase di salvataggio, una chiave esterna fa riferimento a una riga inesistente (400). In fase di eliminazione, altre righe fanno ancora riferimento a questa (409; un vincolo `RESTRICT` genera `PG_23001`, anch'esso 409). | Crea prima la riga di destinazione o correggi l'ID; in caso di cancellazione, rimuovi o riassocia preventivamente le righe collegate. |
| `PG_23505` | 409 | È stato violato un vincolo di unicità. Il messaggio indica il nome del vincolo. | Usa un valore differente oppure aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Il parametro `maxResults` per l'elenco dello storage non è un intero uguale o superiore a 1, o il suo `pageToken` non è stato rilasciato dalla sorgente. Una dimensione pagina inferiore a uno rispondeva storicamente con una pagina vuota avente lo stesso token, causando cicli infiniti in `while (pageToken)`. | Invia un `maxResults` positivo e restituisci `nextPageToken` senza alterazioni. |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Controlla il nome del bucket. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata, esce dal prefisso assegnato o si trova sotto un prefisso riservato (`_rebase/renditions/`, `_rebase/maintenance/`). | Controlla la chiave dell'oggetto. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri di trasformazione dell'immagine sono fuori scala o in contraddizione. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Il file caricato supera il limite `maxBytes` dichiarato sulla colonna `col.storage()` di destinazione. Applicato lato server, non solo dal browser. `details` specifica la colonna, il limite e la dimensione reale. | Carica un file più piccolo o aumenta `maxBytes` sulla colonna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo di file caricato non compare nell'elenco `accept` della colonna, o non è presente nei tipi ammessi (`allowedMimeTypes`) della sorgente di storage. `details` include la colonna (o l'elenco della sorgente), i tipi accettati e il content type inviato. | Carica un formato consentito oppure amplia `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | Il bucket S3 o GCS configurato per questa sorgente non esiste, o il provider ha rifiutato le credenziali di questa distribuzione. Il messaggio specifica il bucket; `details.reason` è `NoSuchBucket` o il messaggio di rifiuto del provider. Storicamente, un bucket mancante veniva interpretato per ogni file come "file non trovato". | Correggi il nome del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` per sorgenti con nome) o i permessi delle credenziali. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nessun backend di storage è configurato sul server, o nessuno è impostato come default e la richiesta non specifica una sorgente; il messaggio elenca le sorgenti supportate (501). Un caricamento riprendibile la cui sorgente è scomparsa prima del completamento restituisce 503. | Configura S3, GCS o storage locale, oppure specifica la risorsa con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) eseguito tra due sorgenti residenti nello stesso bucket o nella medesima cartella. Ciascun file risulterebbe già presente nella destinazione (essendo lo stesso file) e la cancellazione della copia di origine distruggerebbe l'unico file presente. Nessun file è stato spostato o cancellato. | Punta la colonna direttamente all'altra sorgente: i suoi file sono già presenti. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) non è riuscito a scansionare tutte le tabelle, pertanto i file referenziati da queste ultime apparirebbero orfani. Con `?scan=`, la scansione indicata è quella che non ha potuto leggere tutte le tabelle. Nessun dato è stato cancellato; `details.unscanned` indica ciascuna tabella e il motivo dell'errore di lettura. | Risolvi il problema che impedisce la lettura delle tabelle e avvia nuovamente il comando. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione non registrata dalla sorgente. Le scansioni vengono mantenute per 7 giorni all'interno della sorgente analizzata; pertanto anche uno `storageId` differente rispetto alla scansione non produrrà alcun risultato. | Passa lo `storageId` corretto per la scansione o avviane una nuova. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` richiede una scansione ancora in stato `queued`, `running` o marcata come `failed`. Nessun dato è stato rimosso; `details.status` riporta lo stato attuale. | Attendi il termine della scansione o avviane una nuova. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione terminata da oltre 15 minuti. Nessun file è stato eliminato. | Avvia una nuova scansione e procedi all'eliminazione da essa. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica una scansione i cui elementi orfani sono già in fase di cancellazione. | Controlla lo stato di eliminazione della scansione con `GET /api/admin/storage/orphans/scans/:id` al campo `deletion`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La storage source è dichiarata ma non dispone delle credenziali in questo ambiente. | Configura le variabili d'ambiente per quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto l'operazione di scrittura. | Controlla i relativi log di sistema e la validità delle credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini in elaborazione contemporanea. | Riprova più tardi; valuta l'integrazione di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La richiesta specifica una risorsa di storage (`?storageId=`) non dichiarata nel progetto. Un `bucket` non supportato da questo ambiente restituisce lo stesso codice con stato **404** (su una lista, un upload, una cartella o un upload riprendibile verso S3 o GCS) — è il repository di memorizzazione a risultare assente, e `details` elenca i bucket e le sorgenti realmente presenti. In precedenza entrambi venivano notificati come "file non trovato", indistinguibili da una chiave semplicemente assente. | Dichiara la sorgente in `config/resources.ts`, o verifica con `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | La chiamata `PATCH` di un upload riprendibile è giunta mentre un altro blocco dello stesso file era ancora in ricezione — quasi sempre dovuto a un client che ripete l'invio del blocco in transito. L'operazione viene rifiutata anziché accodata, in modo analogo a tusd. | Recupera l'offset corrente con `HEAD /api/storage/tus/:id` e riprendi da quel punto; tus-js-client gestisce automaticamente il backoff e i nuovi tentativi. Consulta [Upload riprendibili (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funzioni personalizzate

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con questo nome è disponibile — oppure esiste, ma le sue route interne non coprono il sotto-percorso indicato. Un chiamante autenticato riceve l'elenco delle route effettivamente servite; un chiamante anonimo no, poiché tale lista costituisce una mappatura completa di tutti gli endpoint custom. Quando il caricamento di un file fallisce, il messaggio notifica il chiamante autenticato indicando il nome del file: ciò evidenzia la differenza tra un errore di digitazione e un deploy corrotto. Un chiamante anonimo riceve la risposta generica di nome sconosciuto, identica al caso in cui nessun elemento coincida. | Verifica il nome tramite `GET /api/functions`, oppure ispeziona il log di boot per individuare file non caricati. |
| `FUNCTION_TIMEOUT` | 504 | L'esecuzione dell'handler ha superato il tempo limite previsto. L'elaborazione rimane in esecuzione; non può essere interrotta da questo livello. | Configura un `AbortSignal` sulle chiamate verso l'esterno, o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo inoltra le funzioni tramite proxy a un'altra istanza che non ha risposto. | Verifica che il processo adibito all'esecuzione delle funzioni sia attivo. |

## Notifiche push

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | L'endpoint della sottoscrizione non appartiene ai servizi push utilizzati dai browser supportati (FCM, Mozilla, Apple, Windows) su protocollo `https`. Il server invia una richiesta HTTP a quell'indirizzo per ogni notifica, pertanto non ne accetta altri. | Invia l'output di `PushSubscription.toJSON()` così come generato dal browser, o specifica un servizio push di test in `push.allowedHosts`. Consulta [Notifiche push](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Una chiave API o la chiave di servizio ha invocato una route di push. Una sottoscrizione è strettamente legata al browser di un utente autenticato. | Esegui la chiamata utilizzando la sessione di quell'utente. |
| `PUSH_NOT_CONFIGURED` | 503 | Il modulo push è attivo ma impossibilitato a inviare notifiche: chiavi VAPID assenti in ambiente di produzione, o tabella associata non inizializzata. Il messaggio ne specifica la ragione. | Imposta `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Consulta [Notifiche push](/docs/backend/push-notifications/#keys). |

## Cron job

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | È stato richiesto l'avvio manuale di un cron job attualmente in esecuzione — sullo stesso processo interpellato o su un altro che detiene il lock di esecuzione, come il worker dietro un processo `api`. Nulla è stato avviato. L'avviso di salto è registrato nella cronologia del job e corrisponde a `details.log`; il log indica il processo che sta eseguendo il job. | Riprova al termine dell'esecuzione corrente. Consulta [Cron job](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Aree di amministrazione e modifica dello schema

Questi codici indicano che una funzionalità è disattivata o non configurata, piuttosto che
la richiesta fosse errata. Ognuno di essi viene riportato anche sulla corrispondente route `/status` con un `200`,
consentendo a un pannello di disabilitare visivamente la funzionalità (grey out) invece di mostrare un errore.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata interrogata una sezione riservata agli amministratori su un server privo di configurazione di autenticazione, impedendo di distinguere un amministratore da un chiamante generico. | Imposta `auth.jwtSecret`, oppure fornisci un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | È stato inviato a `POST /api/admin/branches/:name/merge` il fingerprint di un diff non più valido: il branch o il suo parent sono stati modificati nel frattempo. Nessuna scrittura eseguita. | Estrai nuovamente il diff, verificalo e procedi al merge usando il nuovo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | L'origine dati non può eseguire confronti tra branch: assenza di SQL o funzionalità di branching disabilitata (mancanza di connessione con privilegi di amministrazione). | Usa un backend Postgres con `adminConnectionString` configurata. |
| `BRANCH_MERGE_BLOCKED` | 409 | Impossibile unire una tabella con discrepanze — aggiunta o rimossa nel branch, colonne o chiave primaria differenti, chiave primaria assente, volume di righe eccessivo per il match, o modifiche strutturali applicate dopo la creazione del branch (`TABLE_REWRITTEN`). Una tabella per la quale non è stato possibile eseguire il match delle righe blocca l'operazione anche se i conteggi riportano 0: il dato è sconosciuto, non pari a zero. `details.tables` elenca le tabelle interessate con la motivazione. Nessun dato è stato modificato. | Allinea lo schema tramite migrazioni preventive, oppure esegui il merge specificando `skipBlocked: true` per escludere tali tabelle. |
| `BRANCH_MERGE_CONFLICT` | 409 | Sono state riscontrate modifiche concorrenti sulle medesime righe sia nel branch che nel parent con `onConflict` impostato su `"abort"` (impostazione predefinita); oppure il parent ha respinto parte dell'unione — una riga è variata nel frattempo, un trigger l'ha esclusa, una policy RLS l'ha oscurata. Nessuna operazione eseguita. | Definisci quale versione debba prevalere impostando `onConflict: "branch"` o `"target"`, oppure analizza nuovamente il diff. |
| `BRANCH_MERGE_FAILED` | 409 | Il parent ha respinto le righe del branch durante l'istruzione di merge — violazione di vincoli, valori enum non validi o chiavi esterne violate dai dati del branch, causato generalmente da difformità tra i due schemi. `details` specifica `sqlState`, `table`, `constraint` e `detail`. Nessuna scrittura effettuata. | Controlla le modifiche allo schema nel diff, allinea lo schema del parent tramite le tue migrazioni o correggi i dati nel branch, quindi ripeti il merge. |
| `BRANCH_NOT_FOUND` | 404 | Nessun branch con questo nome registrato nel catalogo. | Esegui `rebase db branch list`, o visualizza il riquadro Branches, per consultare l'elenco dei branch disponibili. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto del progetto viene esposto solo in presenza di autenticazione attiva — descrive la totalità delle tabelle e delle relazioni. | Configura il modulo auth. L'endpoint `/meta/schema-version` rimane invece sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna casella di posta per l'ambiente di sviluppo risulta attiva. La ricezione delle email viene simulata esclusivamente se `SMTP_HOST` non è impostato e `NODE_ENV` differisce da production. | Rimuovi `SMTP_HOST` in ambiente di sviluppo, oppure consulta la casella di posta reale. |
| `DOCS_UNAVAILABLE` | 404 | L'endpoint `GET /api/docs` è accessibile agli stessi chiamanti abilitati a `GET /api/schema/tables`; se questo server non ha l'autenticazione configurata, non è presente alcun destinatario a cui mostrare le informazioni. | Configura l'autenticazione, oppure pubblica l'intera documentazione pubblicamente impostando `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | La modifica proposta per lo schema non è formalmente corretta. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione della modifica programmata allo schema è fallita per cause non coperte da codici più specifici. | Consulta il messaggio; riporta testualmente il fallimento sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma incompatibile con lo stato attuale dello schema. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non ancora committate; l'operazione non può essere applicata in sicurezza. | Esegui un commit o un git stash, quindi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha respinto l'operazione: l'oggetto dell'intervento ricade in costrutti di codice che non vengono modificati in automatico (spread operator, funzioni helper, chiavi calcolate), o la modifica richiesta non è supportata (es. rinominare una tabella, eliminare l'ultima regola rimasta). `details.problems` riporta i dettagli. Nessuna modifica salvata. | Consulta il messaggio. Applica la modifica a mano intervenendo nei file sotto `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | La modifica è eseguibile, ma lo schema risultante non compilerebbe correttamente — una relazione verso una tabella rimossa, una regola che invoca una colonna eliminata. `details.problems` mostra gli errori di compilazione per tabella e colonna. Nessuna modifica salvata. | Aggiorna preventivamente le tabelle dipendenti, o modifica manualmente i file in `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un file coinvolto nella modifica è stato modificato sul disco dopo la preparazione dell'operazione (salvataggio da IDE, processi concorrenti). Nessun dato modificato. | Ricarica il file ed esegui nuovamente l'intervento sulla versione attuale. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o altra entità non umana ha tentato di applicare una modifica allo schema. | Effettua l'accesso come utente, oppure imposta `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica dello schema a caldo richiede l'impostazione di `schemaDir` (la cartella `backend/schema`) o `liveSchema.repository`; questo server è stato avviato senza nessuno dei due. Il codice d'errore mantiene il nome originale. | Configura uno dei due percorsi. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione è attiva, ma manca un repository git su cui committare le modifiche — installazione basata su bundle precompilato o server in cui `backend/schema` non rientra in un repository git (l'applicazione comporta sempre un commit). | Esegui `git init` nella radice del progetto e riavvia il server (il repository viene rilevato all'avvio), oppure configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Questa istanza non applica alterazioni al database (`REBASE_PROVISION=false`), pertanto la modifica non può essere eseguita tramite interfaccia. | Committa le modifiche solo come codice sorgente e delega l'applicazione al processo incaricato di aggiornare il database. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non supporta la pianificazione automatica delle modifiche allo schema. | La modifica a caldo è supportata su motori Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Le tabelle vengono mappate per introspezione diretta dal database, pertanto mancano i file sorgente da modificare. | Modifica la struttura dello schema mediante una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disattivato per questo server. Un'applicazione distribuita come bundle precompilato restituisce sempre questo errore. | Attivalo mediante l'opzione `schemaEditor`. Su un bundle compilato, definisci `REBASE_LIVE_SCHEMA_REPOSITORY` per consentire la modifica di `backend/schema` tramite repository — consulta [Modifica dello schema a caldo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema necessita della dipendenza `ts-morph`, attualmente non installata. | Installala nel modulo che esegue il backend, quindi riavvialo: `pnpm --dir backend add -D ts-morph@28.0.0` partendo dalla radice di un progetto strutturato con scaffolding, oppure `pnpm add -D ts-morph@28.0.0` se la radice coincide con il backend. Il messaggio visualizza il comando idoneo al progetto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non ha `schemaDir` configurata, impedendo all'editor di individuare i file su cui scrivere. Il codice d'errore mantiene il nome storico. | Imposta `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disabilitato in presenza di `NODE_ENV=production`: i file di un server in produzione vengono ricreati a partire dal repository a ogni deploy, rendendo vano qualunque salvataggio eseguito qui. | Esegui le modifiche in `backend/schema` in ambiente di sviluppo e rilasciale, o configura `liveSchema.repository` per registrarvi i commit. |
| `SCHEMA_UNAVAILABLE` | 404 | Chiamata a `GET /api/schema/tables` su un backend privo di autenticazione: non esiste alcun chiamante su cui profilare le tabelle, e `auth.requireAuth: false` non muta questo comportamento. | Configura un adapter di auth o valorizza `auth.jwtSecret`. Consulta [Endpoint](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` specifica una tabella a cui il chiamante non ha accesso — slug errato o permessi (`scope`) del token non sufficienti per visualizzarla. | Controlla lo slug e gli scope `data:*` della credenziale. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` è stato interrogato con una chiave API, un platform token o la chiave di servizio. Le preferenze UI appartengono al profilo di un utente reale autenticato. | Effettua l'accesso come utente. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | Le preferenze di interfaccia per una singola tabella superano i 64 KB. | Riduci i parametri salvati: le preferenze servono per la presentazione, non per la persistenza di dati applicativi. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | Il driver di questo backend non può eseguire istruzioni SQL, pertanto non archivia le preferenze di interfaccia; il pannello le memorizzerà localmente nel browser. | Nessun intervento richiesto: la persistenza resta legata al singolo browser. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json`, in cui vengono scritte le preferenze UI dell'area di lavoro in fase di sviluppo, contiene JSON non valido. | Correggi o elimina il file; il pannello lo rigenererà al prossimo salvataggio. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` non può eseguire lo streaming dell'output in questo ambiente: il database di sviluppo integrato (PGlite) offre una sola connessione, e mantenere aperto un cursore durante il download bloccherebbe tutte le altre query; in alternativa, la risorsa dati non fornisce cursori SQL. | Configura `DATABASE_URL` verso una tua istanza Postgres (`rebase dev --docker` ne inizializza una), oppure aggiungi una clausola `LIMIT` ed esporta le righe a schermo. |

### Riconciliazione dello schema

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) elabora il piano
tramite `POST /api/admin/schema/reconcile/plan` e lo applica tramite
`/reconcile/apply`. Un piano rifiutato non altera alcun elemento; unicamente `SCHEMA_RECONCILE_FAILED`
lascia un piano eseguito parzialmente.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | Il corpo della richiesta non è un oggetto JSON, oppure `drop` non è una lista di stringhe nel formato `"<table>.<column>"`. | Invia `{ "drop": ["voice_cache.wav"] }`, oppure ometti il parametro `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | L'esecuzione di un'istruzione è fallita a metà processo. I comandi precedenti sono stati applicati e restano validi; `details.applied` li riporta. | Risolvi il problema indicato nel messaggio, quindi genera nuovamente il piano: il nuovo piano escluderà le modifiche già completate. |
| `SCHEMA_RECONCILE_INVALID` | 400 | Il piano non può essere eseguito; il messaggio fornisce l'elenco dei motivi: un elemento `drop` non rispetta la sintassi `<table>.<column>`, dichiara una tabella o colonna inesistente, oppure indica una colonna ancora presente nel codice della tabella. `details.plan` mostra il piano. | Rettifica l'elenco `drop`. Una colonna formalizzata si rimuove eliminandola dal corrispondente `defineTable`, effettuando il deploy e procedendo infine alla riconciliazione. |
| `SCHEMA_RECONCILE_STALE` | 409 | La struttura del database o le definizioni delle tabelle sono cambiate successivamente alla generazione del piano confermato. `details.plan` contiene il piano aggiornato. | Valuta il nuovo piano e convalida il suo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | La chiamata a `/reconcile/apply` è giunta priva del campo `confirm`. | Genera prima il piano e invia il suo `digest` nel valore `confirm`. La CLI esegue questo passaggio alla conferma con `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | Il driver di questo backend non può generare piani di riconciliazione o non supporta comandi SQL. | La riconciliazione opera su istanze Postgres. |

### Motivi di blocco nel merge di una tabella da un branch

`BRANCH_MERGE_BLOCKED` elenca ciascuna tabella rifiutata all'interno di `details.tables`, associandola a uno
di questi codici. Lo stesso codice viene valorizzato sul campo `blocked` della tabella nel diff,
consentendo a Studio di segnalarlo prima della pressione del tasto **Merge**. Nessuno
di essi costituisce una risposta HTTP a sé stante.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Le colonne della tabella presentano differenze tra il branch e il parent. La comparazione dei dati opera solo sui campi condivisi. | Aggiungi le colonne mancanti nel parent usando le tue migrazioni (`rebase db push`), quindi effettua il merge. Una migrazione che ricostruisce interamente la tabella — come la modifica del tipo di colonna — converte lo stato in `TABLE_REWRITTEN`: esegui il merge prima di applicarla, o ricrea il branch successivamente. |
| `NO_PRIMARY_KEY` | — | La tabella non dispone di una chiave primaria, precludendo l'allineamento riga per riga; il diff riporterà unicamente i totali complessivi delle righe. | Definisci una chiave primaria sulla tabella, o gestisci il riallineamento dei dati manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Le colonne che compongono la chiave primaria, o i relativi tipi, non coincidono tra i due ambienti. | Allinea preventivamente lo schema sul branch parent. |
| `TABLE_ADDED` | — | La tabella è stata introdotta nel branch. La procedura di merge non crea mai nuove tabelle. | Creala sul parent tramite migrazioni, quindi procedi a unire i dati delle righe. |
| `TABLE_DROPPED` | — | La tabella risulta rimossa nel branch. Il merge non elimina mai tabelle. | Rimuovila applicando una migrazione. |
| `TABLE_REWRITTEN` | — | Tutte le righe della tabella sono state riscritte integralmente su uno dei lati dopo la creazione del branch — variazione del tipo di una colonna, `ADD COLUMN` con valore di default volatile, `VACUUM FULL`, `CLUSTER` — facendo risultare ogni riga come modificata e impedendo di distinguere l'origine delle modifiche riga per riga. | Esegui il merge del branch prima di lanciare tale migrazione, oppure ricrea il branch derivandolo nuovamente dal parent dopo averla applicata. |
| `TOO_LARGE` | — | La tabella contiene un numero di righe superiore al limite supportato dal diff per il confronto puntuale (100.000 come valore predefinito, `maxRowsPerTable`). | Incrementa `maxRowsPerTable` sia per il diff che per il merge, o procedi al trasferimento dei dati mediante strumenti alternativi. |

## Codici generici

Una route ricorre a uno di questi codici quando nessun errore specifico risulta applicabile.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Richiesta non valida, e nessun codice specifico risulta applicabile. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato, o la credenziale è stata respinta. | Accedi o esegui il refresh del token. |
| `FORBIDDEN` | 403 | Autenticato, ma privo delle autorizzazioni necessarie. | Riprovare con la medesima identità non risolverà l'errore. |
| `CONFLICT` | 409 | È emerso un conflitto con lo stato corrente dei dati. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Errore interno del server. Il messaggio viene mantenuto generico per sicurezza. | Fai riferimento al `requestId`; il dettaglio dell'errore è consultabile nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza indispensabile per questa route non risulta configurata sul server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Un servizio esterno richiesto per soddisfare la chiamata non è raggiungibile: bucket S3 o MinIO, o un host invocato via `fetch()` da una funzione che rifiuta la connessione o non si risolve. Il log del server indica l'host; la risposta al client lo omette. Un database non raggiungibile genera `DATABASE_UNAVAILABLE`. Il fallimento di una connessione verso tali servizi produce questo codice. | Riprova; controlla i log. |

## Manutenzione e coerenza di questa pagina

Il comando `pnpm verify:docs` fallisce qualora un codice producibile dal server non sia
presente in queste tabelle, se una tabella riporta un codice non generabile dal codice,
se gli stati HTTP di una riga non rispecchiano fedelmente quelli originati dal sorgente,
o se una famiglia come `PG_<SQLSTATE>` è sprovvista di una voce per un SQLSTATE
incontrato dai chiamanti. Lo script di controllo è situato in
`tooling/scripts/docs-verify/check-error-codes.mjs`.

La procedura testa anzitutto la propria affidabilità. La scansione estrae i codici
analizzando il codice TypeScript a monte anziché interrogare un'istanza in esecuzione,
il che potrebbe generare falsi positivi per conformazione: in passato ignorava codici
veicolati tramite funzioni wrapper a riga singola o collocati dopo un messaggio
contenente una `)`, certificando che "ogni codice generabile dal server è documentato"
su una documentazione che in realtà ne tralasciava diciassette. Per ovviare a ciò, il processo
esegue preventivamente una fixture progettata con queste esatte anomalie prima di
leggere questa pagina, interrompendo l'esecuzione qualora non fosse in grado di rilevarle.
