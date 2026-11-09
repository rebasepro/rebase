---
sourceHash: 3d3d35353574f0e5
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il rispettivo stato HTTP, significato e come risolverli — oltre al response envelope, X-Request-ID e le regole per details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e contiene un
`code` stabile. Il codice è l'elemento su cui eseguire i controlli condizionali (branching): il messaggio è scritto per un
essere umano e potrebbe essere riformulato, lo stato è condiviso da decine di problemi
diversi, mentre il codice non è nessuna delle due cose.

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
  un `5xx` è deliberatamente generico, poiché il testo sottostante può menzionare un
  host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori riportati di seguito. Stabile tra versioni minori.
- **`details`** — opzionale e mai garantito. Vedi le regole riportate di seguito.
- **`requestId`** — presente ogni volta che la richiesta è passata attraverso il middleware
  del request-ID, ovvero ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante
quando si tratta di un UUID, altrimenti uno nuovo. Viene restituito nella
risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e
allegato alla riga di log del server per quella richiesta.

Questa è la chiave di correlazione (join key). Includila in una segnalazione di bug e un operatore potrà trovare l'unica
riga di log che spiega il fallimento, contenente il motivo che non è mai stato
mostrato al client.

Inviare il proprio ID è il modo in cui una traccia sopravvive a un hop: un gateway o un job runner che
inoltra l'header ottiene un unico ID attraverso tutti i servizi che hanno gestito la richiesta.
Un valore non valido viene ignorato anziché rifiutato — non vale la pena far fallire una richiesta per un header malformato inviato da un
chiamante — quindi non dare per scontato che l'ID inviato sia
l'ID ricevuto. Leggi l'header della risposta.

### Cosa contiene `details`

`details` ha scopo diagnostico, non contrattuale. È regolato da tre regole:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Si tratta degli
   errori del chiamante descritti con precisione: quale campo di filtro era sconosciuto,
   quale relazione non è scrivibile, quale valore non corrispondeva al tipo previsto.
2. **La diagnostica del database viene rimossa in produzione.** Quando l'errore proviene
   da Postgres, `details.dbCode` — il valore SQLSTATE — è sempre presente: indica la
   classe del problema e non rivela nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   poiché Postgres vi inserisce il contenuto delle righe. `23505` restituisce
   `Key (email)=(a@b.c) already exists.`, che risponderebbe a "questa persona è
   registrata?" per qualsiasi indirizzo si provi a verificare.
3. **Non eseguire mai controlli condizionali su `details`.** Esegui il branch su `code`. Ciò che si trova sotto `details` è
   semplicemente ciò che risultava utile a una persona in quel punto di chiamata, ed è soggetto a modifiche.

## Interpretare uno stato

| Stato | Cosa indica sulla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticato, o credenziale scaduta. Effettua l'accesso o aggiorna il token (refresh). |
| `403` | Autenticato, ma non autorizzato. Riprovare con la stessa identità non servirà. |
| `404` | Route, collection o riga inesistente — o una riga nascosta dalla row-level security. |
| `409` | Conflitto con lo stato esistente: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il corpo è troppo grande, il media type è errato o la richiesta è semanticamente rifiutata. |
| `429` | Limite di frequenza superato (rate limited). Rallenta le richieste; il messaggio indica per quanto tempo. |
| `500` | L'errore risiede nel server o nel suo database, non nel chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può gestirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza non è raggiungibile, non è configurata o è troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa la verifica MFA, quindi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nulla — lo stato desiderato è già soddisfatto. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | L'account modificato, reimpostato o eliminato possiede un ruolo o uno scope che il chiamante non ha. `details.beyond` li elenca. | Fai eseguire la modifica a qualcuno che li possiede. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disattivato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di elencare, creare, modificare o revocare chiavi API, del proprio tipo o personali. | Gestisci le chiavi come utente in possesso di `keys:write`, o con la chiave di servizio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza middleware di autenticazione Rebase a monte, quindi la credenziale del chiamante non è mai stata esaminata. | Esegui il mount dell'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Effettua prima l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è riservato esclusivamente al primissimo utente, e questo non lo è. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi una nuova verifica CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati inseriti per una singola verifica MFA. | Avvia una nuova verifica. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con quell'indirizzo — in fase di registrazione, di modifica indirizzo, o seguendo un link di cambio indirizzo quando un altro account ha occupato l'indirizzo nel frattempo. | Accedi, o avvia un ripristino password; per un cambio di indirizzo, scegline un altro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP e il server non dispone di un mail transport. | Configura SMTP, o usa un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | Un accesso OAuth ha trovato un account con lo stesso indirizzo e il provider non ha verificato quell'indirizzo, pertanto non è collegato. | Accedi con il metodo esistente, poi esegui `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma mai confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollegala prima da quell'account. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una richiesta ha inviato `x-rebase-impersonate` e il chiamante non può eseguire richieste come un altro utente. Solo la sessione di un amministratore autenticato può farlo, mai una chiave API o la chiave di servizio. | Inviala con la sessione di un amministratore, o ometti l'header. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` è stato inviato vuoto. | Invia l'uid dell'utente da impersonare, o ometti l'header. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` non indica alcun utente attivo: nessun account ha quell'uid, oppure è disabilitato. | Verifica l'uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | L'autenticazione di questo backend non può eseguire richieste per conto di un altro utente, poiché il suo `AuthAdapter` non implementa `resolveUser`. | Implementa `resolveUser` nell'adapter, o ometti l'header. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` è stato inviato a una route che non può essere eseguita come un altro utente. Solo la data API e le custom functions lo supportano, e il socket realtime supporta `impersonate` su `AUTHENTICATE`. | Invia la richiesta senza l'header. |
| `SIMULATION_FORBIDDEN` | 403 | Una richiesta ha inviato un header `x-rebase-simulate-*` (il simulatore RLS) o ha interrogato `/api/admin/rls-simulator`, e il chiamante non può simulare l'accesso. Solo la sessione di un amministratore autenticato può farlo, mai una chiave API o la chiave di servizio. | Inviala con la sessione di un amministratore, o ometti gli header. |
| `SIMULATION_INVALID` | 400 | La simulazione era malformata: un header inviato vuoto, `x-rebase-simulate-api-key-id` combinato con un ruolo o user id, oppure simulazione combinata con `x-rebase-impersonate`. | Specifica un solo ruolo (facoltativamente con un uid), un solo user id, o un solo ID chiave API. |
| `SIMULATION_READ_ONLY` | 403 | Una scrittura, cancellazione, `_batch`, ripristino cronologia o una custom function chiamata con qualsiasi verbo diverso da `GET`/`HEAD`/`OPTIONS` includeva un header `x-rebase-simulate-*`. L'accesso simulato è di sola lettura: la scrittura verrebbe eseguita con l'identità simulata, non come amministratore. Le letture, incluse `POST …/query` e `…/count`, vengono comunque eseguite. | Interrompi la simulazione per apportare modifiche. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulazione non indica alcun utente attivo (un user id inviato senza ruolo) o nessuna chiave API valida. | Verifica l'ID, oppure invia un ruolo insieme all'uid per simulare un uid senza account. |
| `SIMULATION_UNAVAILABLE` | 501 | Questo backend non può simulare l'accesso: il suo `AuthAdapter` non dispone di `resolveUser` per verificare un amministratore, oppure è stata indicata una chiave su un backend senza chiavi API. | Implementa `resolveUser`, o ometti gli header. |
| `SIMULATION_UNSUPPORTED` | 400 | Un header `x-rebase-simulate-*` è stato inviato a una route che non supporta l'accesso simulato. Solo la data API e le custom functions li supportano. | Invia la richiesta senza gli header. |
| `GUEST_REFERENCED` | 409 | Impossibile eliminare un guest perché una riga del progetto lo richiede, tramite una foreign key con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo segnala per ciascun guest in `skipped` e prosegue. | Elimina la riga, oppure lascia il guest. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può agire. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La verifica MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 400 / 401 | Il codice OTP o MFA è errato: 400 dall'accesso tramite codice email (`/auth/otp/verify`), 401 da una registrazione o verifica MFA. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — deliberatamente non specificato quale. | Riprova o reimposta la password. |
| `INVALID_PLATFORM_TOKEN` | 401 | Un token di piattaforma `rpt_` è stato rifiutato: firma non valida, audience errata, scaduto o durata superiore al limite massimo. Il messaggio specifica la causa. | Richiedi alla piattaforma di generarne uno nuovo — su Rebase Cloud, esegui nuovamente il comando. |
| `INVALID_SCOPES` | 400 | A una chiave è stato richiesto qualcosa che non è uno scope: malformato, sconosciuto o con una risorsa target non accettata dallo scope. `details.problems` indica quali e perché; `details.validScopes` elenca gli scope che una chiave può possedere. Esclude `keys:read` e `keys:write`, che nessuna chiave può possedere. | Usa un nome dall'elenco. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token di verifica, ripristino, magic link o cambio indirizzo è malformato, sconosciuto, già utilizzato o scaduto (400). Una credenziale di un provider OAuth o un refresh token non verificabile restituisce 401. | Richiedi un nuovo link o accedi di nuovo. |
| `INVALID_ROLE` | 400 | Il nome del ruolo in fase di scrittura non è una stringa, è vuoto o contiene `,` `{` `}` `"` `\` o un carattere di controllo. Tali caratteri verrebbero riletti come altri ruoli: un ruolo viaggia in un `text[]` di Postgres e nell'elenco separato da virgole suddiviso dalle policy RLS, quindi `"support,admin"` verrebbe riletto come `admin`. `details.problems` elenca ciascun problema. | Rinomina il ruolo. Qualsiasi altro nome è accettato. |
| `KEY_MANAGEMENT_SCOPE` | 400 | A una chiave sono stati richiesti `keys:read` o `keys:write`. Nessuna chiave può gestire chiavi. `details.scopes` li elenca. | Omettili. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titolare di `keys:write` ha tentato di modificare o revocare una chiave di servizio che possiede un ruolo o uno scope che l'utente non ha. Solo un amministratore gestisce qualsiasi chiave. `details.roles` e `details.scopes` indicano ciò che la chiave possiede oltre il chiamante. | Chiedi a un amministratore, o a qualcuno che li possiede, di modificare la chiave. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto senza amministratori. | Promuovi prima qualcun altro. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` contiene un token a breve durata limitato alla verifica MFA — non è una sessione. | Apri una verifica e rispondi; la risposta alla verifica rilascerà la sessione. |
| `NO_SESSION` | 401 | Nessun cookie di sessione o refresh token presentato. Normale al primo caricamento di pagina. | Accedi. |
| `NOT_ANONYMOUS` | 400 | Una route di passaggio da anonimo è stata chiamata da un account reale, oppure `DELETE /api/admin/guests/:uid` ne ha indicato uno. | Nulla da convertire. Per eliminare un account, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato o restituito un errore. | Riprova il flusso; il messaggio riporta il motivo del provider. |
| `PERSONAL_KEYS_DISABLED` | 403 | Le chiavi API personali sono disattivate su questo backend. | Imposta `personalKeys: true` nel blocco `auth` della collection users. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La chiave di servizio o una sessione guest ha tentato di usare le route per le chiavi personali. Nessuna delle due ha un account da associare alla chiave. | Accedi a un account o crea una chiave di servizio sotto `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token di piattaforma `rpt_` ha raggiunto un server che non li accetta: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` non sono impostati. | La piattaforma che ospita l'app li imposta entrambi durante il deploy; riesegui il deploy o accedi all'app in un altro modo. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta le richieste; il messaggio indica per quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione di reindirizzamento non è presente nella allow-list. | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | L'auto-registrazione è disattivata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXCEEDS_CALLER` | 403 | I ruoli concessi contengono uno scope, o `admin`, che il chiamante non possiede. `details.beyond` li elenca. | Chiedi a qualcuno che li possiede di concedere il ruolo. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una chiave di servizio è stato assegnato un ruolo RLS che il suo creatore non possiede. Solo un amministratore può assegnare qualsiasi ruolo. `details.roles` li elenca. | Rimuovi il ruolo o chiedi a un amministratore di creare la chiave. |
| `ROLE_EXISTS` | 409 | Quel nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli del chiamante — su una route di amministrazione o su una richiesta dati su un backend con `config.auth`. Fallisce in modalità protetta (fail-closed) anziché fidarsi dei ruoli nel token. Un token il cui uid non corrisponde ad alcun account, compreso un uid incompatibile con la tabella users, restituisce 401, non questo errore. Un database non raggiungibile restituisce `DATABASE_UNAVAILABLE`, non questo errore. | Riprova; controlla il database. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | A una chiave è stato richiesto uno scope che il suo creatore non possiede. Una chiave non possiede mai più permessi dell'account che la crea. `details.scopes` li elenca. | Rimuovili o chiedi a qualcuno che li possiede di creare la chiave. |
| `SCOPE_MISSING` | 403 | La credenziale non possiede lo scope richiesto da questa route, collection, storage source o funzione. `details.requiredScope` lo indica, inclusa la risorsa target. | Per una persona, assegna un ruolo che dichiari lo scope. Per una chiave, usa una chiave che lo possieda. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una route protetta con `requireScope` fa riferimento a uno scope applicativo che questo backend non dichiara, quindi nessuno lo possiede, nemmeno un amministratore. Un nome che non sia affatto uno scope o un nome predefinito errato come `data:raed` non arriva mai a questo punto: `requireScope` genera un'eccezione durante la registrazione della route. | Dichiara lo scope sotto `auth.scopes` nella collection users, o correggi il nome. Consulta [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | La sessione è stata terminata altrove, oppure tutte le sessioni sono state revocate, o l'account è stato eliminato. Tutti gli accessi che accettano una sessione rispondono così a tale access token: la data API, lo storage, le custom functions e le route admin. Il socket realtime rifiuta `AUTHENTICATE` con un frame `AUTH_ERROR` contenente lo stesso codice. L'SDK tenta il refresh, il refresh viene rifiutato e la sessione viene chiusa. | Effettua nuovamente l'accesso. |
| `ACCOUNT_DISABLED` | 401/403 | Un amministratore ha disattivato l'account: accesso (403), refresh e ogni token associato (401) vengono rifiutati su tutti gli accessi che accettano una sessione. Il socket realtime rifiuta `AUTHENTICATE` con un frame `AUTH_ERROR` contenente lo stesso codice. | Contatta un amministratore. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` è attivo e l'indirizzo non è ancora verificato. Restituito solo se la password è corretta; viene inviato un nuovo link via email. | Segui il link ricevuto via email. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: l'account contiene una password o un'identità che nessuno ha verificato, e la richiesta non verifica nessuna delle due. Il token non viene consumato. | Invia `password` per mantenerla, o `removeUnproven: true` per verificare senza di essa. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | È stata richiesta un'email di verifica per un indirizzo irraggiungibile — quello di un guest o il placeholder di X (400) — oppure un account ha chiesto di passare a un tale indirizzo (409, `POST /auth/change-email`). | Imposta prima un indirizzo reale. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` ha specificato l'indirizzo attuale dell'account. | Nulla da modificare. |
| `ANONYMOUS_USER` | 403 | Un guest ha chiesto di cambiare il proprio indirizzo email; un guest non ne possiede alcuno. | Convertilo prima in un account reale (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Sono stati richiesti codici di recupero per un account senza un secondo fattore verificato. | Registra prima un fattore. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` ha generato un'eccezione. Il messaggio è quello dell'hook; un hook che sceglie uno stato 4xx risponde con esso. | Consulta il messaggio. |
| `INVALID_JSON` | 400 | Il corpo della richiesta non è in formato JSON. | Invia un corpo JSON. |
| `SELF_DISABLE` | 400 | Un amministratore ha tentato di disabilitare il proprio account. | Chiedi a un altro amministratore. |
| `NOT_SUPPORTED` | 501 | Il repository di autenticazione di questo backend non supporta l'operazione richiesta (disabilitare account, cambiare indirizzo). | Riavvia il server affinché venga aggiunta la colonna, oppure usa un repository che la supporti. |
| `UNKNOWN_SCOPE_TARGET` | 400 | La risorsa target di uno scope fa riferimento a una collection, storage source o funzione non gestita da questo backend. `details` elenca quelle gestite. | Correggi la risorsa target. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, un codice email o un ripristino password ha confermato l'indirizzo di un account non verificato, e l'account contiene un'identità di accesso il cui provider non ha mai verificato quell'indirizzo. Il repository di autenticazione non può rimuoverla (non implementa `unlinkUserIdentity`), quindi la conferma viene rifiutata per evitare di lasciare tale accesso su un account verificato. | Implementa `unlinkUserIdentity` nel repository di autenticazione personalizzato, oppure chiedi a un amministratore di esaminare l'account. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, quindi questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | Un token monouso è stato riutilizzato, oppure un refresh token è stato ruotato più di `refreshTokenReuseIntervalSeconds` fa. | Richiedine uno nuovo o accedi di nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con quell'ID. | Verifica l'ID. |
| `WEAK_PASSWORD` | 400 | La password non rispetta la [password policy](/docs/backend/auth-endpoints/#password-policy) (per impostazione predefinita 8+ caratteri con una lettera maiuscola, una minuscola e una cifra) — in fase di registrazione, ripristino o modifica, e per le password scelte da un amministratore: `POST /api/admin/users`, una creazione sulla collection users tramite data API, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Scegline una più complessa. Un amministratore che importa account può inviare `skipPasswordPolicy: true` in fase di creazione. |

## Dati, query e scritture

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Un'aggregazione diversa da `count()` senza `groupBy` su una collection riscritta da un callback `afterRead` (globale, di collection o di proprietà). Un'aggregazione legge i valori memorizzati e non esegue mai il callback, quindi una somma, un minimo, un massimo, un conteggio di campi o un raggruppamento leggerebbero ciò che il callback nasconde. | Usa `count()` senza `groupBy`, oppure leggi le righe, che passano attraverso il callback. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non può calcolare l'aggregazione richiesta. | Usa un driver che la supporti, oppure calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), in cui un branch *coincide* con il genitore e nulla verrebbe isolato. Il rifiuto è lo stesso restituito da `rebase db branch`. | Punta `DATABASE_URL` verso una tua istanza Postgres (`rebase dev --docker` ne avvia una) ed esegui lì il branch. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni del limite consentito per batch (1000 per impostazione predefinita). Un batch costituisce una singola transazione e mantiene i propri lock per l'intera durata. | Invialo suddiviso in più parti; il messaggio indica il limite e il conteggio attuale. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non è in grado di scrivere in modo atomico tra collection diverse, e un ciclo di singole scritture non sarebbe né atomico né eseguito in un unico round-trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per ciascuna collection. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o driver non supporta le scritture bulk. | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 / 403 | Un callback di collection ha rifiutato la scrittura. Un'istruzione `throw` da `beforeSave`/`beforeDelete`/`after*` è un 400 che riporta il messaggio dell'autore; un `beforeDelete` che restituisce `false` è un 403. `details.stage` indica quale callback, `details.path` la collection. | Leggi il messaggio — è stato scritto per questo progetto, non da Rebase. |
| `CALLBACK_RECURSION` | 500 | Le scritture avviate dagli hook si sono annidate per più di 16 livelli: una scrittura `context.data` di un hook esegue nuovamente gli hook di quella collection e nulla nella catena la interrompe — in genere un `afterSave` che aggiorna la propria riga in modo incondizionato. L'intera scrittura è stata annullata (rollback). Il messaggio indica l'hook e la collection; `details.chain` elenca ogni passaggio hook → scrittura. | Rendi condizionale la scrittura dell'hook: agisci solo su `status === "new"`, oppure ignorala quando `values` contiene già ciò che verrebbe scritto. |
| `COLLECTION_READ_ONLY` | 405 | Una scrittura ha raggiunto una collection che serve una vista SQL (`view`). Una vista è in sola lettura. | Scrivi nelle tabelle lette dalla vista. Consulta [Viste](/docs/collections/views/). |
| `SQL_NOT_ALLOWED` | 400 | L'SQL eseguito come chiamante (`getSql(c)`, `withAuth(user).sql`) non era una singola istruzione semplice `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, oppure chiamava `set_config` o nominava `pg_settings`. L'identità del chiamante risiede nelle impostazioni di sessione, quindi un'istruzione che potrebbe modificarle viene rifiutata. | Mantieni il testo della query sotto il tuo controllo, una sola istruzione, con ogni valore in `params`. Vedi [Funzioni personalizzate](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore specifica già dove inizia la pagina, quindi applicarvi un offset salta silenziosamente quel numero di righe oltre il cursore — un'omissione che il chiamante non può individuare nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una query di ricerca o vettoriale. Entrambe associano un punteggio a ciascuna riga, quindi due righe non risulteranno mai uguali e `DISTINCT` non raggrupperebbe nulla — sembrerebbe funzionare senza modificare nulla. | Rimuovi uno dei due parametri. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` è ordinata in base a una colonna che non viene restituita. Un `SELECT DISTINCT` può essere ordinato solo in base alle colonne presenti nel suo elenco select, altrimenti le righe raggruppate non avrebbero un ordine definito. `details.fields` le elenca. | Aggiungi quei campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Impossibile raggiungere il database: la connessione è stata rifiutata o interrotta, l'host non è stato risolto, il server si sta arrestando o avviando, oppure il database è chiuso a nuove connessioni (`ALLOW_CONNECTIONS false`, stato lasciato sulla sorgente da un `rebase db branch create --force` interrotto a metà; il log del server indica il nome del database, e `rebase db branch list` lo riapre). Ogni endpoint risponde in questo modo, inclusi l'accesso, le route admin e il socket realtime (tramite un frame `ERROR`). Inviato con `Retry-After: 5`. | Riprova; l'SDK lo fa automaticamente. Controlla che il database sia attivo e raggiungibile dal server. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | Il server del database ha rifiutato una nuova connessione poiché ha esaurito quelle disponibili (`53300` troppi client, `53400` limite di connessioni di un ruolo o del database raggiunto). Tutte le istanze del server condividono il valore `max_connections` del server, quindi questo è il problema che si verifica quando più istanze utilizzano pool di grandi dimensioni senza un connection pooler. È un problema di carico, non un guasto; inviato con `Retry-After: 2`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Riduci `DB_POOL_MAX` (o limitane il valore con `REBASE_DB_POOL_MAX`) su tutte le istanze, inserisci un pooler a monte del database (`DATABASE_POOLED`), oppure aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | L'apertura di una nuova connessione al database ha richiesto più tempo di `DB_POOL_CONNECT_TIMEOUT`: il database è lento ad accettare connessioni o è distante nella rete. Inviato con `Retry-After`. | Riprova; l'SDK lo fa automaticamente. Controlla il carico del database e la latenza di rete verso di esso. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): una policy di row-level security nega l'accesso a questo ruolo, oppure manca un `GRANT`. | Consulta la guida di [Risoluzione dei problemi](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Tutte le connessioni al database nel pool sono rimaste occupate per l'intera durata di `DB_POOL_CONNECT_TIMEOUT`, quindi questa richiesta non ha mai raggiunto il database. È un problema di carico, non un guasto; inviato con `Retry-After`. Il server registra la soluzione nei log una volta al minuto. | Riprova; l'SDK lo fa automaticamente. Aumenta `DB_POOL_MAX`, oppure individua le query lente o le transazioni lunghe che bloccano le connessioni. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` di aggregazione o `groupBy` indica un campo che i ruoli di questo chiamante non possono leggere (`access.read`), un percorso annidato o un ordinamento aggregato indica una relazione che non possono leggere — oppure un'operazione di campo (`$inc`, `$push`, …) ha come target uno di essi, dove un limite rifiutato rivelerebbe il valore memorizzato. Un campo che nessuna risposta può includere deve essere un campo che nessuna query può interrogare, altrimenti il valore risulterebbe leggibile un predicato alla volta. Un filtro attraverso una relazione (`author.salary`) e un ordinamento aggregato su un campo di una relazione (`max(staff.salary)`) vengono valutati in base alla regola della destinazione. `details.violations` elenca ciascun campo. Un campo nascosto con `excludeFromApi` risponde come se non esistesse: un filtro, `orderBy`, `fields`, `include`, `select` di aggregazione o `groupBy`, oppure `vector_search` che ne indica uno riceve esattamente la stessa risposta di un nome errato (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), e nessuna risposta di campo sconosciuto ne elenca uno. | Rimuovi il campo dalla query, oppure acquisisci il ruolo necessario. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il corpo imposta un campo che i ruoli di questo chiamante non possono scrivere (`access.write`). Rifiutato anziché ignorato: una scrittura che scartasse un campo segnalerebbe il successo di una modifica che non è avvenuta. Lo stesso codice rifiuta una scrittura tramite un'entità genitore che imposta una relazione non scrivibile dal chiamante, e un aggiornamento che imposta un valore su un campo `softDelete` — solo un'operazione di cancellazione può valorizzarlo. `details.violations` elenca ciascun campo. | Rimuovi il campo, oppure acquisisci il ruolo. Un campo che nessuno può scrivere risponde invece con `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Un update o delete filtrato è stato inviato via HTTP alla collection degli utenti, le cui scritture vengono verificate utente per utente prima di essere eseguite. | Leggi gli utenti, poi usa `updateMany`/`deleteMany` per id. |
| `FILTER_REQUIRED` | 400 | Una scrittura filtrata (un aggiornamento o una cancellazione per `where`/`logical`, dall'SDK o dalle route bulk) non contiene alcuna condizione e quindi indirizzerebbe ogni riga. Rifiutata prima che venga eseguito qualcosa. | Aggiungi una condizione. Per modificare tutte le righe di proposito, indicalo con una condizione che ogni riga soddisfa. |
| `HISTORY_UNAVAILABLE` | 503 | Una scrittura su una collection con `history: true` è stata rifiutata poiché non è stato possibile registrare la voce nella cronologia: il database non dispone della tabella `rebase.entity_history` o, nel caso di `openRebase` e `rebase console`, della funzione `rebase.record_history`. Nessun backend con la cronologia attiva è mai stato avviato su questo database. Non è stato eseguito nulla, inclusi i callback, e le letture non sono influenzate. Generato da `openRebase` e restituito da un backend creato con `provision: false`. | Avvia il backend almeno una volta con la cronologia attiva e `provision: true` (`rebase dev` lo fa automaticamente), quindi riprova. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine dell'elaborazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata inviata su una richiesta differente: diverso metodo, percorso, query string o corpo. | Usa una nuova chiave, oppure invia la richiesta originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indica una funzione che non è un aggregato (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una di queste; il messaggio le elenca. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una trasformazione di `groupBy` è sconosciuta o non si applica alla sua colonna: `year`/`month`/`day` su una colonna che non è una data, `unnest` su una che non è un array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest`, su una colonna del tipo giusto. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce di `?select=` non rispetta la sintassi `fn(field)`; è stata fornita una funzione diversa da `count()` o `fingerprint()` senza specificare il campo; `percentile` non ha una frazione da 0 a 1; oppure `fingerprint()` è stato richiesto a una vista semplice, che non memorizza righe. | Scrivi `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` o `orderBy` su un'aggregazione senza `groupBy`, oppure un cursore su qualsiasi aggregazione. Un'aggregazione non raggruppata corrisponde a una singola riga, e un gruppo non è una riga dopo la quale un cursore possa proseguire. | Aggiungi `groupBy`, o rimuovili; pagina i gruppi con `offset` o `page`. Consulta [Aggregazioni](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Un'operazione `/_batch` manca di `op`, `collection`, `values` o `id`, specifica una collection non gestita da questo backend o riutilizza un nome `ref`. | Consulta il messaggio; indica l'operazione in base al suo indice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` non fa riferimento ad alcuna operazione precedente, punta in avanti o richiede un campo non presente nella riga di riferimento. Si risolvono solo i riferimenti all'indietro. | Definisci l'operazione con `ref` *prima* di farvi riferimento. |
| `INVALID_BULK_BODY` | 400 | Il corpo della richiesta bulk non ha la struttura prevista. | Invia l'array previsto dalla route: `{ "rows": [...] }` per `POST /bulk`, `{ "updates": [{ "id", "data" }] }` per `PATCH /bulk`, `{ "ids": [...] }` per `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | Una regola di conflitto dell'upsert (tenere i duplicati, o sostituire solo secondo un `where`) è stata inviata senza `upsert: true`, oppure le due regole insieme. | Invia `upsert: true` e uno dei due. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert indica colonne prive di garanzia di unicità, le specifica senza `upsert: true`, oppure viene inviato su una creazione annidata in cui una riga corrispondente verrebbe spostata sotto il nuovo genitore. In caso contrario, Postgres risponderebbe con 42P10 all'interno di una transazione che ha già eseguito modifiche. Si applica anche a qualsiasi upsert sulla collection users (auth), dove la creazione e l'aggiornamento seguono regole distinte. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target effettivamente esistenti. Sulla collection users, invia una `POST` per creare e una `PATCH` per aggiornare. |
| `INVALID_COUNT` | 400 | `?count=` è diverso da `exact` o `none`. Rifiutato anziché interpretato come valore predefinito: un errore di digitazione come `?count=nnone` comporterebbe il costo del calcolo del conteggio che intendeva evitare. | Invia `exact` (impostazione predefinita) o `none`. Consulta [Escludere il conteggio](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Il cursore `after` non può essere letto, oppure fa riferimento a un ID di riga non compatibile con le colonne chiave della collection: è stato troncato, ricodificato o costruito manualmente. Un cursore leggibile inviato con un `orderBy` diverso da quello con cui è stato generato restituisce `CURSOR_ORDER_MISMATCH`, anch'esso un 400. | Invia nuovamente `meta.nextCursor` della pagina precedente senza modifiche, con lo stesso `orderBy` o nessuno. Consulta [Paginazione](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Rifiutato anziché ignorato: un errore di digitazione come `?deleted=true` che nascondesse silenziosamente tutte le righe eliminate sembrerebbe funzionare, ma risponderebbe al quesito opposto. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è impostato su `true` o `false`. | Invia uno di questi valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Un operatore `$inc` / `$push` / `$pull` / `$merge` è stato utilizzato su un tipo di proprietà per cui non è definito, con un operando dal formato errato, con due operatori sullo stesso campo, con un errore di ortografia o su una creazione — dove non esiste alcun valore memorizzato su cui operare. | Consulta [Scrittura tramite REST](/docs/backend/writes/#field-operations); il messaggio indica il campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una scrittura filtrata indirizzava un percorso attraverso una relazione (`posts/1/comments`) oppure nessuna collection. | Scrivi nella collection correlata, con un filtro sul suo collegamento. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro specifica una proprietà non presente in questa collection. | Verifica l'ortografia rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di proprietà — ad esempio `like` su un numero o una data. | Consulta [Interrogare i dati](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valore di filtro non può essere interpretato nel tipo della colonna con cui viene confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non presente nell'enum, un timestamp non valido, un numero che eccede l'intervallo del tipo. `details.dbCode` riporta il valore SQLSTATE. | Invia un valore compatibile con il tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è impostato su `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che applica un'eliminazione logica (soft delete) quando il chiamante ha richiesto un'eliminazione definitiva indurrebbe a credere che i dati siano stati rimossi. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non rappresenta un elenco di percorsi valido, oppure è un oggetto di opzioni per relazione con una struttura errata. Un percorso annidato per più di tre livelli restituisce `INCLUDE_TOO_DEEP`, anch'esso un 400. Gestito all'ingresso per evitare che si propaghi dal driver come un 500. | Consulta il messaggio; indica il percorso non valido. |
| `INVALID_INPUT` | 400 | Il corpo della richiesta non ha superato la convalida. | Consulta il messaggio. |
| `INVALID_LIMIT` | 400 | `?limit=` non è un numero intero compreso tra 1 e il valore massimo consentito (1000 per impostazione predefinita); un valore superiore viene rifiutato, non limitato. Una sottoscrizione realtime che richiede un limite al di fuori di questo intervallo riceve lo stesso codice all'interno di un frame `ERROR` via WebSocket. | Riduci il limite e sfoglia le pagine per recuperare le righe rimanenti. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` / `?not=` è malformato o annidato oltre la profondità massima consentita. | Consulta il messaggio; illustra la regola di appiattimento. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un numero intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non corrisponde a `field`, `field:desc`, `field:desc:last`, o a un array JSON di `{ field, direction, nulls }` — oppure specifica una direzione diversa da `asc`/`desc`, o un posizionamento dei NULL diverso da `first`/`last`. | Consulta il messaggio; mostra tutte le sintassi valide. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine hanno base 1, quindi `?page=0` è considerato un errore e non la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro di query è malformato. | Consulta il messaggio. |
| `INVALID_QUERY_BODY` | 400 | Il corpo di una richiesta `POST …/query` contiene un valore non supportabile nell'URL: una lista per un parametro che l'URL legge una sola volta (`fields`, `limit`, …), un oggetto per un filtro, o la presenza del parametro anche nell'URL — una `POST …/query` legge tutti i parametri dal corpo. | Formatta ciascun valore come nell'URL — una stringa, o una lista per un filtro ripetuto; `where`, `include`, `orderBy` e `vector` accettano JSON. Consulta [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non corrisponde a `cosine`, `l2` o `inner_product`. | Usa uno di questi tre valori. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Un aggiornamento indica la chiave della riga con un valore diverso da quello con cui è indirizzata — nel corpo, o scritto da un `beforeSave`. Una riga non può essere spostata su un'altra chiave: tutte le operazioni successive alla scrittura (rilettura, `afterSave`, cronologia, realtime) la indirizzano tramite la chiave originale. Rifiutato prima dell'esecuzione di qualsiasi hook, senza alcuna scrittura, su tutti gli accessi. `details.violations` indica il campo. | Crea la riga sotto la nuova chiave ed elimina quella attuale. Inviare la chiave che la riga possiede già è consentito. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata chiamata senza specificare `?select=`. | Aggiungine uno, ad es. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` è stato chiamato su una collection che non serve una vista materializzata. | Aggiorna solo una collection con `view: { materialized: true }`. |
| `NO_COLLECTIONS` | 404 | Il progetto non gestisce alcuna collection: nessuna dichiarata nel codice e nessuna tabella da cui derivarla. Quando le tabelle esistono ma la row-level security non è abilitata su di esse, il messaggio le elenca con l'istruzione SQL per abilitarla, e `details.unprotectedTables` le riporta. | Crea le tabelle — tramite migrazione, SQL, o un file di collection insieme a `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con quell'ID in quella collection — o una riga che la row-level security nasconde a questo chiamante. | Verifica l'ID, poi le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica un elemento che non corrisponde a una relazione nella collection. Lo stesso codice restituisce **404** quando è un *percorso URL* annidato a indicarne uno, ad es. `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuno — in tal caso l'URL non fa riferimento a nulla, configurando una risorsa non trovata anziché una richiesta malformata. | Verifica il nome della relazione — il messaggio elenca quelle presenti nella collection. Una relazione inversa (back-reference) deve essere dichiarata sul genitore per essere esplorabile. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento specifica una proprietà non ordinabile. | Ordina in base a una proprietà supportata da una colonna. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` è stato combinato con `?offset=` — oppure `page` con `offset` in un `find()`, operazione che l'SDK client, il client in-process `rebase.data` e il client offline rifiutano con lo stesso codice prima di eseguire qualsiasi richiesta. Entrambi definiscono la stessa finestra, e in precedenza `page` prevaleva silenziosamente su `offset` senza che il chiamante vedesse applicato quest'ultimo. | Invia solo uno dei due parametri. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo supera il limite configurato. | Invia una quantità inferiore di dati, o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` ha tentato di eseguire una scrittura. Una lettura con scope di richiesta viene eseguita in una transazione `READ ONLY`, pertanto né il callback né le funzioni da esso invocate possono eseguire scritture. | Sposta la scrittura all'esterno della lettura: un job in background, oppure `rebase.dataAsAdmin` da un cron job o da una custom function. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` ha raggiunto un driver dati senza viste materializzate. | Su questo backend non c'è nulla da aggiornare. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura conteneva un payload di collegamento (link payload), ma il percorso non raggiunge la destinazione tramite un `manyToMany` che dichiara `through.properties` — pertanto non esiste alcuna riga di giunzione su cui memorizzarlo. | Dichiara `through.properties` sulla relazione, oppure rimuovi il payload dalla scrittura. Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non può essere risolta rispetto allo schema registrato. L'operazione viene rifiutata anziché ignorata: ignorarla segnalerebbe il successo di una scrittura mai avvenuta, oppure l'assenza di righe effettivamente esistenti. | Esegui `rebase schema generate` se lo schema generato è meno recente del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | Non è possibile scollegare la relazione da questo lato. | Esegui la scrittura dal lato proprietario della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile, oppure una creazione o aggiornamento indica una relazione `via` multi-hop — solo le relazioni `via` a singolo hop sono scrivibili. `details.fields` elenca le chiavi `via`. Non è stato scritto nulla. | Scrivi direttamente le righe collegate dalla catena. Consulta [Relazioni](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione dichiara colonne di giunzione, ma questa sorgente dati non supporta la loro scrittura. | Il collegamento in sé funziona; solo il payload su di esso non è supportato. Verifica le funzionalità del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura su relazione non disponeva di una chiave di origine a cui agganciare il collegamento. | Salva prima la riga genitore. |
| `RESULT_TOO_LARGE` | — | Un'istruzione inviata tramite `EXECUTE_SQL` sul socket realtime — `admin.executeSql` da un client, letture di catalogo del pannello admin — ha restituito più di 128 MB di righe, pertanto il risultato non è stato inviato. Consegnato come frame `ERROR` via WebSocket. Le esecuzioni avviate dalla console SQL non vengono rifiutate: mostrano le prime righe. | Aggiungi un `LIMIT`, oppure seleziona un numero inferiore di colonne e leggi il risultato in blocchi. |
| `ROW_IN_TRASH` | 409 | La chiave di un upsert appartiene a una riga nel cestino (una riga eliminata logicamente mantiene la propria chiave). Un upsert non scrive all'interno di una riga eliminata, su nessun accesso: parametri REST `?on_conflict=`, upsert `/bulk` e `/_batch`, l'SDK e il socket realtime. Non è stato scritto nulla. | Ripristina prima la riga (con un aggiornamento che imposta a `null` il campo di soft-delete), oppure eliminala definitivamente con `?hard=true` ed esegui nuovamente l'upsert. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabella o una colonna prevista dal codice non esiste nel database. | Esegui `rebase db push` in sviluppo; riesegui il deploy su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per ogni query anziché memorizzata, pertanto non può fungere da chiave per un cursore. | Pagina i risultati per rilevanza usando `limit`/`offset`, oppure ordina in base a una colonna. |
| `SQL_ERROR` | 400 | Il database ha rifiutato l'istruzione SQL inviata da un utente. Sul socket realtime tramite `EXECUTE_SQL` si presenta come un frame `ERROR` contenente il messaggio del database. `POST /api/admin/sql/csv` lo restituisce prima di inviare qualsiasi parte del file: un errore di sintassi, una scrittura (il download viene eseguito in sola lettura), più istruzioni contemporanee o un ruolo non consentito alla connessione. | Correggi l'istruzione SQL. Un download accetta una sola query `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un chiamante che non possiede nessuno dei `view.roles` di una vista materializzata l'ha letta, oppure ha chiesto di aggiornarla. Una vista materializzata non ha row-level security, quindi viene servita per intero e solo a quei ruoli. | Leggila con uno dei ruoli, oppure dichiara il ruolo del chiamante in `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura sposterebbe una riga da un tenant a un altro. Una riga non può cambiare tenant. `details.violations` indica il campo. Un trigger applica la stessa regola nel database, quindi l'SQL eseguito come chiamante fallisce con l'errore Postgres `42501` e un messaggio che inizia con `TENANT_IMMUTABLE`. | Crea la riga nell'altro tenant ed elimina quella attuale, oppure scrivi con un ruolo compreso in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura indica un tenant a cui questo chiamante non appartiene; anche il database la rifiuterebbe. | Scrivi in un tenant a cui il chiamante appartiene, oppure autenticati come utente che ne fa parte. |
| `TENANT_REQUIRED` | 400 | La collection ha come ambito un tenant e il tenant non può essere dedotto: la richiesta non ne specifica alcuno o il chiamante appartiene a più tenant. | Invia il campo del tenant esplicitamente, oppure autenticati come chiamante appartenente a un unico tenant. |
| `TRANSACTION_ABORTED` | 500 | Un'istruzione nella transazione di scrittura è fallita e un callback ha intercettato l'errore. Postgres aveva già interrotto la transazione, pertanto la scrittura è stata annullata (rollback) e nulla è stato memorizzato. Solo un'operazione `context.data` di creazione, aggiornamento o cancellazione rifiutata dal database viene annullata singolarmente ed è sicuro intercettarla. | Lascia che l'errore si propaghi, oppure esegui una verifica prima dell'istruzione. Consulta [Semantica delle transazioni](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` specifica un campo non presente nella collection. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o un `groupBy` specifica un campo non presente nella collection. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo non presente in questa collection — o nella destinazione di una relazione — oppure un campo nascosto con `excludeFromApi`. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro specifica un operatore non esistente. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket realtime ha un `type` non gestito dal server. Restituito come frame `ERROR` contenente il `requestId` della richiesta, consentendo alla richiesta di concludersi anziché andare in timeout. | Verifica il `type` del frame; il messaggio ne indica il nome. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento specifica un campo non presente in questa collection. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un header `If-Match` ha indicato una versione della riga non più attuale: un altro utente o processo vi ha scritto tra la lettura e questa scrittura. Non è stato scritto nulla. | Rileggi la riga, applica nuovamente la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo non presente nella collection. | Verifica l'ortografia; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è di tipo `vector` in questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il `Content-Type` non rientra tra quelli accettati da questa route. | Invia il tipo indicato nella documentazione della route. |
| `UNSUPPORTED_OPTION` | — | Generato come eccezione, non restituito via HTTP: a una scrittura tramite il client in-process (`context.data` in un callback, `rebase.data` in una funzione o cron) sono state passate le opzioni `ifMatch` o `idempotencyKey`. Questo punto di accesso non dispone di verifica delle precondizioni né di memorizzazione dell'idempotenza, pertanto l'opzione viene rifiutata prima di qualsiasi scrittura anziché essere ignorata. | Rimuovi l'opzione in quel contesto, oppure esegui la scrittura tramite il client HTTP, che le supporta entrambe. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è definito in una sola direzione, impedendo la correlazione con una sottoquery. | Applica il filtro dal lato proprietario della relazione. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è definito per quel campo: una relazione priva di colonna su questa riga viene filtrata per appartenenza, e il pattern matching (`like`, `ilike` e le relative negazioni) si applica solo al testo. | Consulta il messaggio; elenca gli operatori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore ha violato una regola di `validation` dichiarata dalla proprietà — lunghezza, intervallo, pattern, campo obbligatorio. | Consulta il messaggio; indica ciascuna violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il corpo scrive su una colonna contrassegnata con `excludeFromApi` o `access: { write: [] }` — la stessa regola, con due sintassi differenti. La loro impostazione è riservata al server: un hash di password, un token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è identica per ogni chiamante, incluso `admin`. | Rimuovi il campo. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non corrisponde al tipo della proprietà. | Consulta il messaggio; indica la proprietà. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo specifica un campo non presente nella collection — compreso un argomento `id` su una collection la cui chiave è un altro campo. | Verifica l'ortografia; il messaggio elenca i campi noti. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Un cursore (`after` / `startAfter`) è stato combinato con una ricerca vettoriale. Le righe sono ordinate in base a una distanza calcolata per ogni query, che non può fungere da chiave per un cursore; pertanto un elenco vettoriale non contiene `nextCursor`. | Pagina le righe più vicine usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha rifiutato la scrittura. | Controlla le `securityRules` della collection. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura rifiutata da Postgres per un motivo legato ai *dati del chiamante* risponde
con il valore SQLSTATE nel codice: `PG_23505`, `PG_23503` e così via. Si tratta di una
famiglia, non di un elenco esaustivo — Postgres definisce centinaia di SQLSTATE — ma solo due
classi arrivano a questo livello, perché solo queste due sono imputabili al chiamante:

- **classe 23**, violazione di vincolo di integrità: un duplicato, una foreign key che
  punta a un elemento inesistente, una colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: un valore non compatibile con il tipo della colonna.

Tutto il resto — una connessione interrotta, una colonna mancante, un problema di privilegi —
è imputabile al server e rimane un `500`. Pertanto `code.startsWith("PG_")` è un controllo affidabile
per verificare che "la riga inviata non era valida", e i quattro codici seguenti sono quelli che un client
effettivamente incontra. `details.dbCode` riporta lo stesso SQLSTATE per tutti, e
il messaggio indica il nome del vincolo.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Impossibile interpretare un valore nel tipo della colonna — l'equivalente lato scrittura di `INVALID_FILTER_VALUE`. | Invia un valore compatibile con il tipo della colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo o definisci un valore predefinito per la colonna. |
| `PG_23503` | 400 / 409 | In salvataggio, una foreign key punta a una riga inesistente (400). In eliminazione, altre righe fanno ancora riferimento a questa (409; una chiave `RESTRICT` solleva `PG_23001`, anch'essa 409). | Crea prima la riga di destinazione o correggi l'id; per l'eliminazione, rimuovi o reindirizza prima le righe che vi fanno riferimento. |
| `PG_23505` | 409 | Violazione di un vincolo di unicità. Il messaggio indica il nome del vincolo. | Usa un valore diverso o aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Il parametro `maxResults` di un elenco di storage non è un numero intero pari almeno a 1, oppure il relativo `pageToken` non è stato rilasciato dalla sorgente. Una dimensione di pagina inferiore a uno rispondeva in precedenza con una pagina vuota contenente lo stesso token, causando un loop infinito in `while (pageToken)`. | Invia un `maxResults` positivo e restituisci `nextPageToken` invariato. |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Verifica il nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata, esce dal proprio prefisso o si trova sotto un prefisso riservato (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifica la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri di trasformazione dell'immagine non sono compresi nell'intervallo valido o sono contraddittori. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | L'upload supera la dimensione massima `maxSize` dichiarata dalla proprietà di destinazione. Applicato sul server, non solo nel browser. `details` contiene la proprietà, il limite e la dimensione effettiva. | Carica un file più piccolo o aumenta `maxSize` sulla proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo del file caricato non rientra in `acceptedFiles` della proprietà, o nei `allowedMimeTypes` della storage source. `details` contiene la proprietà (o l'elenco della sorgente), l'elenco dei tipi consentiti e il content type inviato. | Carica un tipo consentito, o amplia `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | Il bucket S3 o GCS con cui è configurata questa sorgente non esiste, oppure il provider ha rifiutato le credenziali di questo deployment. Il messaggio indica il nome del bucket; `details.reason` è `NoSuchBucket` o il rifiuto del provider. In precedenza, un bucket mancante veniva interpretato come "file non trovato" per ogni file. | Correggi il nome del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` per una sorgente con nome) o i permessi delle credenziali. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nessun backend di storage configurato su questo server, oppure nessuno è predefinito e la richiesta non specifica alcuna storage source; il messaggio elenca le sorgenti gestite (501). Un upload riprendibile la cui sorgente è scomparsa prima del completamento restituisce 503. | Configura S3, GCS o storage locale, oppure specifica una sorgente con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) tra due sorgenti che memorizzano nello stesso bucket o nella stessa directory. Ogni file risulterebbe già presente nella destinazione, trattandosi dello stesso file, e l'eliminazione della copia della sorgente eliminerebbe l'unica esistente. Nessun file è stato spostato o eliminato. | Punta la proprietà verso l'altra sorgente; i suoi file sono già presenti. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) non è riuscito a leggere tutte le collection, quindi un file indicato da una di esse risulterebbe inutilizzato. Con `?scan=`, la scansione indicata è quella che non ha potuto leggere tutte le collection. Nessun file è stato eliminato; `details.unscanned` elenca ciascuna collection e il motivo per cui non è stata letta. | Risolvi ciò che impedisce la lettura di quelle collection ed esegui nuovamente l'operazione. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione non presente nella sorgente. Le scansioni vengono conservate per 7 giorni nella sorgente scansionata, quindi anche uno `storageId` diverso da quello della scansione non trova nulla. | Passa lo `storageId` della scansione, oppure avvia una nuova scansione. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione ancora in stato `queued` o `running`, oppure fallita (`failed`). Nessun file è stato eliminato; `details.status` indica lo stato. | Attendi il completamento della scansione, oppure avviene un'altra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione completata più di 15 minuti fa. Nessun file è stato eliminato. | Avvia un'altra scansione ed elimina da essa. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` fa riferimento a una scansione i cui file orfani sono già in fase di eliminazione. | Leggi lo stato di eliminazione della scansione con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La storage source è dichiarata ma non dispone di credenziali su questo ambiente. | Imposta le variabili d'ambiente di quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto la scrittura. | Controlla i suoi log e le sue credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini in corso contemporaneamente. | Riprova; valuta l'uso di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La richiesta fa riferimento a una storage source (`?storageId=`) non dichiarata in questo progetto. Un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** (su un elenco, un upload, una cartella o un upload riprendibile verso S3 o GCS) — la risorsa mancante è lo storage, e `details` elenca i bucket e le sorgenti esistenti. In precedenza entrambi restituivano "file non trovato", identico al caso di una chiave inesistente. | Dichiara la sorgente in `config/resources.ts`, o verifica `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | La richiesta `PATCH` di un upload riprendibile è arrivata mentre un altro blocco (chunk) dello stesso upload era ancora in ricezione — quasi sempre un client che riprova a inviare il blocco in corso. Viene rifiutata anziché messa in coda, come avviene in tusd. | Richiedi l'offset con `HEAD /api/storage/tus/:id` e riprendi da lì; tus-js-client applica il backoff e riprova autonomamente. Consulta [Upload riprendibili (TUS)](/docs/backend/storage-resumable-uploads/). |

## Custom functions

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con quel nome è gestita — o lo è, ma le sue route non coprono il percorso specificato. A un chiamante autenticato viene anche comunicato cosa *è* gestito; a uno anonimo no, poiché tale elenco costituisce l'inventario di ogni endpoint personalizzato. Se il caricamento di un file con quel nome è fallito, il messaggio lo segnala al chiamante autenticato indicando il nome del file: questa è la differenza tra un errore di digitazione e un deploy non funzionante. Un chiamante anonimo riceve la semplice risposta di nome sconosciuto, come per un nome che non corrisponde a nulla. | Verifica il nome rispetto a `GET /api/functions`, oppure controlla il log di avvio per individuare il file non caricato. |
| `FUNCTION_TIMEOUT` | 504 | L'handler ha superato il tempo limite (timeout). È ancora in esecuzione; non può essere annullato da qui. | Assegna alle chiamate in uscita un `AbortSignal`, oppure aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo fa da proxy per le funzioni verso un altro processo, che non ha risposto. | Verifica che l'unità delle funzioni sia in esecuzione. |

## Cron job

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Attivazione manuale di un cron job già in esecuzione — sul processo che ha risposto o su un altro che detiene il lease di esecuzione del job, come il worker dietro un processo `api`. Non è stato eseguito nulla. Il salto dell'esecuzione è registrato nella cronologia del job e `details.log` corrisponde a tale voce; la sua riga indica il processo che sta eseguendo il job. | Riprova quando l'esecuzione corrente sarà terminata. Consulta [Cron job](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfacce di amministrazione e modifica dello schema

Questi codici indicano che una funzionalità è disattivata o non configurata, piuttosto
che la richiesta fosse errata. Ciascuno viene segnalato anche sulla corrispondente route
`/status` con un `200`, in modo che un pannello possa disabilitare visivamente la funzionalità
anziché mostrare un errore.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Un'interfaccia riservata agli amministratori è stata richiamata su un server senza autenticazione configurata, quindi non è possibile distinguere un amministratore da un utente anonimo. | Imposta `auth.jwtSecret` o passa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | A `POST /api/admin/branches/:name/merge` è stato inviato il fingerprint di un diff non più valido: il branch o il suo parent sono stati modificati nel frattempo. Non è stato scritto nulla. | Rileggi il diff, esaminalo ed esegui il merge con il nuovo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La sorgente dati non può confrontare i branch: non supporta SQL o il branching (nessuna connessione admin). | Usa un backend Postgres con `adminConnectionString` configurata. |
| `BRANCH_MERGE_BLOCKED` | 409 | Impossibile unire una tabella che presenta differenze — aggiunta o rimossa dal branch, colonne o chiave primaria differenti, assenza di chiave primaria, troppe righe da confrontare o riscritta dopo la creazione del branch (`TABLE_REWRITTEN`). Una tabella le cui righe non sono state confrontate blocca l'operazione anche quando i conteggi risultano pari a 0: sono sconosciuti, non zero. `details.tables` elenca ciascuna tabella con il relativo motivo. Non è stato scritto nulla. | Applica prima lo schema con le tue migrazioni, oppure esegui il merge con `skipBlocked: true` per escludere quelle tabelle. |
| `BRANCH_MERGE_CONFLICT` | 409 | Sono state modificate righe sia nel branch che nel parent, e `onConflict` era impostato su `"abort"` (impostazione predefinita); oppure il parent ha rifiutato parte del merge — una riga è cambiata nel frattempo, un trigger l'ha ignorata, una policy l'ha nascosta. Non è stato scritto nulla. | Scegli quale versione deve prevalere con `onConflict: "branch"` o `"target"`, oppure leggi nuovamente il diff. |
| `BRANCH_MERGE_FAILED` | 409 | Il parent ha rifiutato le righe del branch all'interno dell'istruzione di merge — un vincolo, un'etichetta enum o una foreign key presente nel parent che le righe del branch violano, solitamente perché i due schemi differiscono. `details` contiene `sqlState`, `table`, `constraint` e `detail`. Non è stato scritto nulla. | Esamina le modifiche allo schema nel diff, allinea lo schema del parent con le tue migrazioni o correggi le righe del branch, quindi riesegui il merge. |
| `BRANCH_NOT_FOUND` | 404 | Nessun branch con questo nome nel registro. | `rebase db branch list`, o il pannello Branches, elenca quelli disponibili. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto di progetto viene fornito solo quando l'autenticazione è configurata — descrive ogni tabella e relazione. | Configura l'autenticazione. `/meta/schema-version` è sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna casella di posta di sviluppo attiva. I messaggi vengono intercettati solo quando `SMTP_HOST` non è impostato e `NODE_ENV` non è production. | Rimuovi l'impostazione di `SMTP_HOST` in sviluppo, oppure consulta la casella di posta reale. |
| `INVALID_CHANGE` | 400 | La modifica dello schema proposta non è ben formata. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione di una modifica programmata dello schema è fallita per un motivo non coperto da codici più specifici. | Consulta il messaggio; riporta letteralmente l'errore sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma non può essere applicata allo schema nello stato attuale. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non committate, pertanto non è stato possibile applicare la modifica in sicurezza. | Esegui il commit o lo stash, quindi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha rifiutato la modifica. | Consulta il messaggio; riporta il motivo del rifiuto espresso dall'editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra entità automatizzata (machine principal) ha tentato di applicare una modifica allo schema. | Accedi come utente, oppure imposta `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica dello schema in tempo reale richiede `collectionsDir` o `liveSchema.repository`, e questo server è stato avviato senza nessuno dei due. | Configurarne uno. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione funziona; non è presente alcun repository su cui committare la modifica. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Questo deployment non apporta modifiche al proprio database (`REBASE_PROVISION=false`), pertanto non è possibile applicare una modifica dal pannello. | Esegui il commit solo come codice sorgente e lascia che sia il processo preposto alla modifica del database ad applicarla. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non è in grado di pianificare modifiche allo schema. | La modifica in tempo reale è disponibile su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Le collection vengono analizzate tramite introspezione dal database in questo ambiente, quindi non ci sono file sorgente da modificare. | Modifica lo schema tramite una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disattivato per questo server. Un bundle compilato restituisce sempre questo errore. | Attivalo con `schemaEditor`. Su un bundle, imposta `REBASE_LIVE_SCHEMA_REPOSITORY` per modificare le collection tramite un repository — consulta [Modifica live dello schema](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema richiede `ts-morph`, che non è installato. | Installalo nel package che esegue il backend, quindi riavvialo: `pnpm --dir backend add -D ts-morph@28.0.0` dalla root di un progetto generato tramite scaffold, oppure `pnpm add -D ts-morph@28.0.0` se il backend rappresenta l'intero progetto. Il messaggio indica il comando esatto per il tuo progetto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non dispone di `collectionsDir`, quindi l'editor non ha una cartella in cui scrivere. | Imposta `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato con `NODE_ENV=production`: i file di un server distribuito vengono ricompilati dal repository a ogni deploy, quindi qualsiasi modifica apportata qui andrebbe persa. | Modifica le collection in ambiente di sviluppo ed esegui il deploy, oppure configura `liveSchema.repository` per effettuarne il commit lì. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` non può trasmettere in streaming un risultato in questo ambiente: il database di sviluppo in-process (PGlite) dispone di una sola connessione, e un cursore mantenuto attivo durante un download bloccherebbe qualsiasi altra query; oppure la sorgente dati non dispone di un cursore SQL. | Punta `DATABASE_URL` verso un'istanza Postgres indipendente (`rebase dev --docker` ne avvia una), oppure aggiungi un `LIMIT` ed esporta le righe visibili a schermo. |

### Riconciliazione dello schema

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) pianifica
tramite `POST /api/admin/schema/reconcile/plan` e applica tramite
`/reconcile/apply`. Un rifiuto non modifica nulla; solo `SCHEMA_RECONCILE_FAILED`
lascia parte di un piano applicata.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | Il corpo non è un oggetto JSON, oppure `drop` non è un array di stringhe `"<collection>.<column>"`. | Invia `{ "drop": ["voice_cache.wav"] }`, oppure ometti `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Un'istruzione è fallita durante l'esecuzione. Le istruzioni precedenti sono state eseguite e rimangono applicate; `details.applied` le elenca. | Correggi ciò che viene indicato nel messaggio, quindi genera nuovamente il piano: il nuovo piano escluderà quanto già eseguito. |
| `SCHEMA_RECONCILE_INVALID` | 400 | Impossibile applicare il piano, e il messaggio ne elenca i motivi: un `drop` che non segue la sintassi `<collection>.<column>`, non specifica alcuna collection o colonna, oppure specifica una colonna ancora dichiarata dalla collection. `details.plan` contiene il piano. | Correggi l'elenco `drop`. Una colonna dichiarata viene rimossa eliminando la relativa proprietà, distribuendo le modifiche ed eseguendo la riconciliazione. |
| `SCHEMA_RECONCILE_STALE` | 409 | Il database o le collection sono cambiati rispetto al piano confermato. `details.plan` contiene il nuovo piano. | Esamina il nuovo piano e conferma il suo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | A `/reconcile/apply` non è stato inviato alcun parametro `confirm`. | Pianifica prima e invia il `digest` del piano come `confirm`. La CLI esegue questa operazione automaticamente dopo aver digitato `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | Il driver di questo backend non può pianificare una riconciliazione o non può eseguire codice SQL. | La riconciliazione funziona su Postgres. |

### Perché una tabella di un branch non può essere unita

`BRANCH_MERGE_BLOCKED` indica ciascuna tabella rifiutata in `details.tables`, con uno
di questi codici. Lo stesso codice compare su `blocked` della tabella nel diff stesso,
così che Studio possa segnalarlo prima che l'utente prema **Merge**. Nessuno di questi costituisce una risposta autonoma.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Le colonne della tabella differiscono tra il branch e il relativo parent. Le righe vengono confrontate sulle colonne condivise. | Aggiungi le colonne mancanti al parent con le tue migrazioni (`rebase db push`), quindi esegui il merge. Una migrazione che riscrive la tabella — una modifica del tipo di colonna — la trasforma in `TABLE_REWRITTEN`: esegui il merge prima di una tale modifica, oppure ricrea il branch successivamente. |
| `NO_PRIMARY_KEY` | — | La tabella non ha una chiave primaria, pertanto le righe non possono essere confrontate una a una; il diff riporta solo il conteggio delle righe. | Assegna una chiave primaria alla tabella o sposta le righe manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Le colonne della chiave primaria, o i relativi tipi, differiscono tra i due. | Applica prima lo schema al parent. |
| `TABLE_ADDED` | — | Il branch ha creato la tabella. Un'operazione di merge non ne crea mai una. | Creala sul parent tramite le tue migrazioni, quindi unisci le relative righe. |
| `TABLE_DROPPED` | — | Il branch ha eliminato la tabella. Un'operazione di merge non ne elimina mai una. | Rimuovila tramite le tue migrazioni. |
| `TABLE_REWRITTEN` | — | Una delle parti ha riscritto completamente ogni riga della tabella dopo la creazione del branch — un cambio di tipo di colonna, un `ADD COLUMN` con valore predefinito volatile, `VACUUM FULL`, `CLUSTER` — quindi ogni riga risulta modificata da quel momento e non è più possibile determinare quale parte abbia modificato quale riga. | Esegui il merge del branch prima di una tale migrazione, oppure ricrea il branch dal parent successivamente. |
| `TOO_LARGE` | — | La tabella contiene su un lato più righe di quante un diff ne possa confrontare singolarmente (100.000 come impostazione predefinita, `maxRowsPerTable`). | Aumenta `maxRowsPerTable` sia nel diff che nel merge, oppure sposta le righe in altro modo. |

## Codici generici

Una route utilizza uno di questi codici quando non è applicabile nulla di più specifico.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformata, e nessun codice più specifico è applicabile. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato, o credenziale rifiutata. | Effettua l'accesso o aggiorna il token (refresh). |
| `FORBIDDEN` | 403 | Autenticato, ma non autorizzato. | Riprovare con la stessa identità non servirà. |
| `CONFLICT` | 409 | Conflitto con lo stato esistente. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Errore interno sul server. Il messaggio è deliberatamente generico. | Indica il `requestId`; il motivo è presente nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza richiesta da questa route non è configurata su questo server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Un servizio da cui dipende la richiesta non è raggiungibile: un bucket S3 o MinIO, oppure un host interrogato tramite `fetch()` da una funzione che rifiuta la connessione o non viene risolto. Il log del server indica il nome dell'host; la risposta non lo fa. Un database non raggiungibile restituisce `DATABASE_UNAVAILABLE`. Una connessione fallita verso tale servizio restituisce questo errore. | Riprova; controlla i log. |

## Mantenere aggiornata questa pagina

`pnpm verify:docs` fallisce quando un codice che il server può generare è assente da queste
tabelle, quando una tabella elenca un codice che nulla può generare, quando gli stati di una riga non
corrispondono esattamente a quelli con cui il codice sorgente genera l'errore, o quando una famiglia di codici come `PG_<SQLSTATE>` non include una riga
per uno SQLSTATE riscontrabile dai chiamanti. La fase di verifica è
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Esegue prima una verifica su se stesso. La scansione rileva i codici da TypeScript anziché da
un server in esecuzione, pertanto i suoi punti ciechi sono silenziosi per progettazione: in passato
non riusciva a rilevare un codice passato attraverso un wrapper di una sola riga o uno scritto dopo un messaggio
contenente una `)`, segnalando "tutti i codici generabili dal server sono documentati"
su una pagina a cui ne mancavano diciassette. Per questo motivo, la procedura esegue un fixture esattamente con
quelle strutture prima di leggere questa pagina, rifiutandosi di riportare qualsiasi esito se
non è in grado di individuarle.
