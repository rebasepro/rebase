---
sourceHash: 5ce5071347b9d6a7
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il rispettivo stato HTTP, il significato e come gestirli — oltre all'envelope di risposta, X-Request-ID e le regole di details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e include un
`code` stabile. Il codice è l'elemento su cui basare la logica di branching: il messaggio
è scritto per un essere umano e può essere riformulato, lo stato HTTP è condiviso da
decine di problemi diversi, mentre il codice non è né l'uno né l'altro.

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

- **`message`** — leggibile dall'uomo. Per un errore `4xx` è il messaggio generato
  dal server; per un `5xx` è volutamente generico, poiché il testo sottostante
  potrebbe esporre un host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori riportati di seguito. Stabile tra versioni minori.
- **`details`** — facoltativo e mai garantito. Consulta le regole di seguito.
- **`requestId`** — presente ogni volta che la richiesta è passata attraverso il middleware
  request-ID, ovvero per ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante
quando è un UUID, altrimenti ne viene generato uno nuovo. Viene restituito
nella risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId`
e associato alla riga di log del server relativa a quella richiesta.

Questa è la chiave di join. Riportala in una segnalazione di bug e un operatore potrà
trovare l'unica riga di log che spiega il fallimento, contenente il motivo che non è
mai stato mostrato al client.

Inviare il proprio ID è il modo in cui una traccia sopravvive a un hop: un gateway o un
job runner che inoltra l'header mantiene un unico ID attraverso tutti i servizi che hanno
gestito la richiesta. Un valore non valido viene ignorato anziché rifiutato — non vale
la pena far fallire una richiesta a causa di un header malformato del chiamante — quindi
non dare per scontato che l'ID inviato sia quello ottenuto. Leggi l'header della risposta.

### Cosa contiene `details`

`details` ha una funzione diagnostica, non contrattuale. È regolato da tre principi:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Si tratta
   degli errori commessi dal chiamante descritti con precisione: quale campo di filtro era
   sconosciuto, quale relazione non è scrivibile, quale valore non corrispondeva al tipo.
2. **La diagnostica del database viene ridotta in produzione.** Quando l'errore
   proviene da Postgres, `details.dbCode` — il valore SQLSTATE — è sempre presente:
   identifica la classe del problema senza rivelare nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   poiché Postgres include in essi i contenuti delle righe. Il codice `23505` segnala
   `Key (email)=(a@b.c) already exists.`, rispondendo di fatto alla domanda "questa persona
   è registrata?" per qualunque indirizzo si provi a verificare.
3. **Non basare mai il branching su `details`.** Basalo su `code`. Il contenuto di
   `details` rappresenta unicamente ciò che risultava utile a una persona in quel dato
   punto di chiamata, ed è soggetto a modifiche.

## Come interpretare uno stato

| Stato | Cosa indica sulla richiesta |
| --- | --- |
| `400` | Malformata o richiedente qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticato, o credenziale scaduta. Effettua l'accesso o aggiorna il token. |
| `403` | Autenticato, ma non autorizzato. Riprovare con la stessa identità non servirà. |
| `404` | Route, collection o riga inesistente — oppure una riga nascosta dalle policy di row-level security. |
| `409` | Un conflitto con lo stato esistente: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il corpo è troppo grande, il media type è errato o la richiesta è semanticamente rifiutata. |
| `429` | Limite di frequenza superato (rate limited). Rallenta le richieste; il messaggio indica per quanto tempo attendere. |
| `500` | L'errore è dovuto al server o al relativo database, non al chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può servirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza era irraggiungibile, non configurata o troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa la verifica MFA, quindi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nessuna azione: lo stato desiderato è già attivo. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | L'account che si sta modificando, reimpostando o eliminando possiede un ruolo o uno scope che il chiamante non possiede. `details.beyond` li nomina. | Fai eseguire la modifica a qualcuno che li possiede. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di elencare, creare, modificare o revocare chiavi API, del proprio tipo o personali. | Gestisci le chiavi come persona che possiede `keys:write`, oppure con la service key. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione di Rebase a monte, quindi la credenziale del chiamante non è mai stata esaminata. | Esegui il mount dell'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Prima effettua l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è riservato esclusivamente al primo utente in assoluto, e questo non lo è. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi una nuova verifica CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati inseriti per una singola verifica MFA. | Avvia una nuova verifica. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con quell'indirizzo — alla registrazione, su un cambio di indirizzo, e seguendo un link di cambio indirizzo quando un altro account ha preso l'indirizzo mentre era in attesa. | Accedi o avvia il recupero della password; per un cambio di indirizzo, scegline un altro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP e il server non dispone di un mail transport. | Configura SMTP o utilizza un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | Un accesso OAuth ha trovato un account con lo stesso indirizzo, e il provider non ha verificato quell'indirizzo, quindi non viene collegato. | Accedi con il metodo esistente, poi `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma non è mai stato confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollecala prima da quell'account. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una richiesta ha inviato `x-rebase-impersonate` e il chiamante non può eseguire una richiesta come un altro utente. Può farlo solo la sessione di un amministratore che ha effettuato l'accesso, mai una chiave API né la chiave di servizio. | Inviala con la sessione di un amministratore, oppure togli l'header. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` è stato inviato vuoto. | Invia l'uid dell'utente per conto del quale agire, oppure togli l'header. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` non indica nessun utente attivo: nessun account ha quell'uid, oppure è disattivato. | Controlla l'uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | L'autenticazione di questo backend non può eseguire una richiesta come un altro utente, perché il suo `AuthAdapter` non ha `resolveUser`. | Implementa `resolveUser` nell'adapter, oppure togli l'header. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` è stato inviato a una route che non può essere eseguita come un altro utente. Lo rispettano solo l'API dati e le funzioni personalizzate, e il socket realtime rispetta `impersonate` in `AUTHENTICATE`. | Invia la richiesta senza l'header. |
| `SIMULATION_FORBIDDEN` | 403 | Una richiesta ha inviato un'intestazione `x-rebase-simulate-*` (il simulatore RLS), o ha chiamato `/api/admin/rls-simulator`, e il chiamante non può simulare l'accesso. Può farlo solo la sessione propria di un amministratore autenticato, mai una chiave API né la chiave di servizio. | Inviala con la sessione di un amministratore, o togli le intestazioni. |
| `SIMULATION_INVALID` | 400 | La simulazione era malformata: un'intestazione inviata vuota, `x-rebase-simulate-api-key-id` insieme a un ruolo o a un id utente, o una simulazione insieme a `x-rebase-impersonate`. | Indica un ruolo (con un uid facoltativo), un id utente o un id di chiave API. |
| `SIMULATION_READ_ONLY` | 403 | Una scrittura, un'eliminazione, `_batch`, un ripristino dalla cronologia, o una funzione personalizzata chiamata con un verbo qualsiasi tranne `GET`/`HEAD`/`OPTIONS`, portava un'intestazione `x-rebase-simulate-*`. L'accesso simulato è in sola lettura: la scrittura verrebbe eseguita come l'identità simulata, non come l'amministratore. Le letture, incluse `POST …/query` e `…/count`, vengono comunque eseguite. Su 0.25 la scrittura veniva eseguita come l'identità simulata. | Smetti di simulare per apportare modifiche. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulazione non indica alcun utente attivo (un id utente senza ruolo) né alcuna chiave API valida. | Controlla l'id, o invia un ruolo con l'uid per simulare un uid senza account. |
| `SIMULATION_UNAVAILABLE` | 501 | Questo backend non può simulare l'accesso: il suo `AuthAdapter` non ha `resolveUser` per confermare un amministratore, oppure è stata indicata una chiave su un backend senza chiavi API. | Implementa `resolveUser`, o togli le intestazioni. |
| `SIMULATION_UNSUPPORTED` | 400 | Un'intestazione `x-rebase-simulate-*` è stata inviata a una route che non può essere eseguita con accesso simulato. Solo l'API dei dati e le funzioni personalizzate le rispettano. | Invia la richiesta senza le intestazioni. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può agire. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La verifica MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 400 / 401 | Il codice OTP o MFA non è corretto: 400 dall'accesso con codice email (`/auth/otp/verify`), 401 da una registrazione o da un challenge MFA. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — deliberatamente senza specificare quale delle due. | Riprova, o reimposta la password. |
| `INVALID_PLATFORM_TOKEN` | 401 | Un token di piattaforma `rpt_` è stato rifiutato: firma errata, audience sbagliata, scaduto o una durata oltre il limite. Il messaggio dice quale. | Fai emettere un token nuovo alla piattaforma: su Rebase Cloud, esegui di nuovo il comando. |
| `INVALID_SCOPES` | 400 | A una chiave è stato richiesto qualcosa che non è uno scope: malformato, sconosciuto, o con un target che lo scope non accetta. `details.problems` indica quali e perché; `details.validScopes` elenca gli scope che una chiave può avere. Omette `keys:read` e `keys:write`, che nessuna chiave può avere; su 0.24 li elenca. | Usa un nome dell'elenco. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token di verifica, reimpostazione, magic link o cambio indirizzo è malformato, sconosciuto, consumato o scaduto (400). Una credenziale di un provider OAuth o un refresh token che non si verifica restituisce 401. | Richiedi un nuovo link, o accedi di nuovo. |
| `INVALID_ROLE` | 400 | Il nome di un ruolo che si sta scrivendo non è una stringa, è vuoto, o contiene `,` `{` `}` `"` `\` o un carattere di controllo. Quei caratteri verrebbero riletti come altri ruoli: un ruolo viaggia in un `text[]` di Postgres e nell'elenco separato da virgole che le policy RLS dividono, quindi `"support,admin"` tornerebbe indietro come `admin`. Su 0.25 un nome simile veniva memorizzato. `details.problems` nomina ciascuno di essi. | Rinomina il ruolo. Qualsiasi altro nome viene accettato. |
| `KEY_MANAGEMENT_SCOPE` | 400 | A una chiave sono stati richiesti `keys:read` o `keys:write`. Nessuna chiave può gestire le chiavi. `details.scopes` li nomina. | Escludili. |
| `KEY_OUTRANKS_CALLER` | 403 | Chi possiede `keys:write` ha provato a modificare o revocare una chiave di servizio che possiede un ruolo o uno scope che lui non ha. Solo un admin gestisce qualsiasi chiave. `details.roles` e `details.scopes` nominano ciò che la chiave possiede oltre al chiamante. Su 0.25 la modifica andava a buon fine. | Fai modificare la chiave a un admin, o a qualcuno che li possiede. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto senza alcun amministratore. | Promuovi prima qualcun altro. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` contiene un token temporaneo limitato alla verifica MFA — non è una sessione. | Apri una verifica e rispondi; la risposta alla verifica rilascia la sessione. |
| `NO_SESSION` | 401 | Non è stato fornito alcun cookie di sessione o refresh token. Normale al primo caricamento della pagina. | Accedi. |
| `NOT_ANONYMOUS` | 400 | Una route di passaggio da account anonimo è stata chiamata da un account reale. | Nulla da aggiornare. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o ha restituito un errore. | Riprova il flusso; il messaggio riporta la motivazione del provider. |
| `PERSONAL_KEYS_DISABLED` | 403 | Le chiavi API personali sono disattivate su questo backend. | Imposta `personalKeys: true` nel blocco `auth` della collezione users. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La service key o una sessione ospite ha tentato di usare le route delle chiavi personali. Nessuna delle due ha un account con cui una chiave possa agire. | Accedi a un account, oppure crea una chiave di servizio sotto `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token di piattaforma `rpt_` ha raggiunto un server che non li accetta: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` non sono impostate. | La piattaforma che ospita l'app le imposta entrambe al deploy; esegui di nuovo il deploy, o accedi all'app in un altro modo. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta le richieste; il messaggio indica per quanto tempo attendere. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione del reindirizzamento non è presente nella lista dei consentiti (allow-list). | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | L'auto-registrazione è disabilitata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXCEEDS_CALLER` | 403 | I ruoli che si stanno concedendo possiedono uno scope, o `admin`, che il chiamante non possiede. `details.beyond` li nomina. | Fai concedere il ruolo a qualcuno che li possiede. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una chiave di servizio è stato dato un ruolo RLS che il suo creatore non possiede. Solo un admin può dare qualsiasi ruolo. `details.roles` li nomina. | Rimuovi il ruolo, oppure fai creare la chiave a un admin. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli del chiamante — su una route di amministrazione, o su una richiesta di dati in un backend con `config.auth`. Si blocca per sicurezza invece di fidarsi dei ruoli nel token. Un token il cui uid non corrisponde ad alcun account, compreso un uid che la tabella degli utenti non può contenere, è un 401, non questo (su 0.24 un uid che la tabella non può contenere è questo 503). Un database non raggiungibile è `DATABASE_UNAVAILABLE`, non questo (su 0.24 è questo 503). | Riprova; controlla il database. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | A una chiave è stato richiesto uno scope che il suo creatore non possiede. Una chiave non possiede mai più dell'account che la crea. `details.scopes` li nomina. | Rimuovili, oppure fai creare la chiave a qualcuno che li possiede. |
| `SCOPE_MISSING` | 403 | La credenziale non possiede lo scope richiesto da questa route, collezione, sorgente di storage o funzione. `details.requiredScope` lo nomina, target incluso. | Per una persona, un ruolo che dichiara lo scope. Per una chiave, una chiave che lo possiede. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una route protetta con `requireScope` nomina uno scope dell'app che questo backend non dichiara, quindi nessuno lo possiede, nemmeno un amministratore. Un nome che non è affatto uno scope, o uno scope integrato scritto male come `data:raed`, non arriva mai fin qui: `requireScope` lancia un errore nel punto in cui la route viene registrata. Su 0.24 in entrambi i casi ogni chiamante riceve `403 SCOPE_MISSING`. | Dichiara lo scope sotto `auth.scopes` nella collezione degli utenti, oppure correggi il nome. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | È stato eseguito il logout dalla sessione altrove, oppure tutte le sessioni sono state revocate, oppure l'account è stato eliminato. Ogni accesso che accetta una sessione lo risponde a un access token di questo tipo: l'API dei dati, lo storage, le funzioni personalizzate e le route di amministrazione (su 0.24 i primi tre rispondono `UNAUTHORIZED` "Invalid or expired token"). Il socket realtime rifiuta il suo `AUTHENTICATE` con un frame `AUTH_ERROR` che riporta lo stesso codice. L'SDK esegue il refresh, il refresh viene rifiutato, e l'SDK esegue il logout. | Accedi nuovamente. |
| `ACCOUNT_DISABLED` | 401/403 | Un amministratore ha disattivato l'account: l'accesso (403), il refresh e ogni token che possiede (401) vengono rifiutati, a ogni accesso che accetta una sessione (su 0.24 l'API dei dati, lo storage e le funzioni personalizzate rispondono `UNAUTHORIZED`). Il socket realtime rifiuta il suo `AUTHENTICATE` con un frame `AUTH_ERROR` che riporta lo stesso codice. | Chiedi a un amministratore. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` è attivo e l'indirizzo non è ancora verificato. Risposto solo per una password corretta; viene inviato un nuovo link via email. | Segui il link nell'email. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: l'account possiede una password o un'identità che nessuno ha dimostrato, e la richiesta non dimostra nessuna delle due. Il token non è consumato. | Invia `password` per mantenerla, oppure `removeUnproven: true` per verificare senza di essa. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | È stata richiesta un'email di verifica per un indirizzo che l'email non può raggiungere — quello di un guest, o un segnaposto di X (400) — oppure un account ha richiesto di spostarsi su un simile indirizzo (409, `POST /auth/change-email`). | Imposta prima un indirizzo reale. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` ha nominato l'indirizzo attuale dell'account. | Nulla da cambiare. |
| `ANONYMOUS_USER` | 403 | Un guest ha richiesto di cambiare il proprio indirizzo email; un guest non ne possiede uno proprio. | Trasformalo prima in un account (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Sono stati richiesti codici di recupero per un account senza alcun secondo fattore verificato. | Registra prima un fattore. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` ha lanciato un'eccezione. Il messaggio è quello dell'hook; un hook che ha scelto uno status 4xx risponde con esso. | Leggi il messaggio. |
| `INVALID_JSON` | 400 | Il corpo della richiesta non è JSON. | Invia un corpo JSON. |
| `SELF_DISABLE` | 400 | Un amministratore ha tentato di disattivare il proprio account. | Chiedi a un altro amministratore. |
| `NOT_SUPPORTED` | 501 | Il repository di autenticazione di questo backend non può fare ciò che è stato richiesto (disattivare account, cambiare un indirizzo). | Riavvia il server affinché la colonna venga aggiunta, oppure usa un repository che lo supporta. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Il target di uno scope nomina una collezione, una sorgente di storage o una funzione che questo backend non serve. `details` elenca quelli che serve. | Correggi il target. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, un codice via email o un ripristino della password ha dimostrato l'indirizzo di un account non verificato, e l'account ha un'identità di accesso il cui provider non ha mai verificato quell'indirizzo. Il repository di autenticazione non può rimuoverla (non ha `unlinkUserIdentity`), quindi la prova viene rifiutata invece di lasciare quella via d'accesso su un account verificato. | Implementa `unlinkUserIdentity` nel repository di autenticazione personalizzato, o fai verificare l'account da un amministratore. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, quindi questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | È stato riutilizzato un token monouso, oppure un refresh token che è stato ruotato più di `refreshTokenReuseIntervalSeconds` fa. | Richiedine uno nuovo, oppure accedi di nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account trovato con questo id. | Controlla l'id. |
| `WEAK_PASSWORD` | 400 | La password non rispetta la [policy delle password](/docs/backend/auth-endpoints/#password-policy) (per impostazione predefinita almeno 8 caratteri con una lettera maiuscola, una minuscola e una cifra) — in fase di registrazione, di reimpostazione o modifica, e per la password scelta da un amministratore: `POST /api/admin/users`, una creazione sulla collection degli utenti tramite la data API, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Scegline una più robusta. Un amministratore che importa account può inviare `skipPasswordPolicy: true` in una creazione. |

## Dati, query e scritture

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non è in grado di calcolare l'aggregazione richiesta. | Usa un driver che la supporti, o calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), in cui un branch *coincide* con il genitore e nulla verrebbe isolato. Il rifiuto è lo stesso mostrato da `rebase db branch`. | Punta `DATABASE_URL` verso un'istanza Postgres dedicata (`rebase dev --docker` ne avvia una) ed esegui lì il branch. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni del limite consentito per batch (1000 per impostazione predefinita). Un batch costituisce una singola transazione e mantiene i lock per l'intera durata. | Invialo a blocchi; il messaggio indica il limite e il numero di operazioni inviate. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non può eseguire scritture tra più collection in modo atomico, e un ciclo di scritture singole non sarebbe né atomico né un singolo round trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per ciascuna collection. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o questo driver non supporta scritture in blocco (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 / 403 | Un callback di collection ha rifiutato la scrittura. Un'istruzione `throw` proveniente da `beforeSave`/`beforeDelete`/`after*` produce un 400 contenente il messaggio personalizzato dell'autore; un `beforeDelete` che restituisce `false` produce un 403. `details.stage` specifica quale callback, `details.path` la collection. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CALLBACK_RECURSION` | 500 | Scritture avviate da hook annidate per più di 16 livelli: la scrittura `context.data` di un hook esegue di nuovo gli hook di quella collection, e nulla nella catena la interrompe — di solito un `afterSave` che aggiorna la propria riga senza condizioni. L'intera scrittura è stata annullata. Il messaggio nomina l'hook e la collection; `details.chain` elenca ogni passaggio hook → scrittura. | Rendi condizionale la scrittura dell'hook: agisci solo su `status === "new"`, oppure saltala quando `values` già contiene ciò che scriverebbe. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore stabilisce già l'inizio della pagina, quindi applicarvi un offset salta silenziosamente quel numero di righe oltre il cursore — un divario invisibile al chiamante nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una query di ricerca o vettoriale. Entrambe assegnano un punteggio a ciascuna riga, quindi due righe non risulteranno mai identiche e `DISTINCT` non raggrupperebbe nulla — sembrerebbe funzionare ma non modificherebbe nulla. | Rimuovi uno dei due parametri. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura con `distinct` è ordinata in base a una colonna che non restituisce. Una query `SELECT DISTINCT` può essere ordinata solo in base alle colonne presenti nel proprio elenco select, altrimenti le righe raggruppate non avrebbero un ordine definito. `details.fields` ne specifica i nomi. | Aggiungi tali campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Impossibile raggiungere il database: la connessione è stata rifiutata o interrotta, l'host non si è risolto, il server si sta arrestando o avviando, oppure il database è chiuso alle nuove connessioni (`ALLOW_CONNECTIONS false`, che un `rebase db branch create --force` interrotto a metà lascia sulla sua sorgente; il log del server nomina il database, e `rebase db branch list` lo riapre). Rispondono tutti gli accessi, compresi l'autenticazione, le route di amministrazione e il socket realtime (un frame `ERROR`). Inviato con `Retry-After: 5`. Su 0.24 la stessa interruzione risponde `ROLE_LOOKUP_FAILED`, `INTERNAL_ERROR` o un 500 con il codice `ECONNREFUSED`. | Riprova; l'SDK lo fa. Controlla che il database sia in esecuzione e raggiungibile dal server. |
| `DB_CONNECT_TIMEOUT` | 503 | L'apertura di una nuova connessione al database ha richiesto più tempo di `DB_POOL_CONNECT_TIMEOUT`: il database è lento ad accettare connessioni, oppure è lontano. Inviato con `Retry-After`. | Riprova; l'SDK lo fa. Controlla il carico del database e la rete verso di esso. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): una policy di row-level security che nega l'accesso a questo ruolo o un comando `GRANT` mancante. | Consulta [Risoluzione dei problemi](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Ogni connessione del pool è rimasta occupata per `DB_POOL_CONNECT_TIMEOUT`, quindi questa richiesta non ha mai raggiunto il database. Carico, non un guasto; inviato con `Retry-After`. Il server registra il rimedio nei log una volta al minuto. | Riprova; l'SDK lo fa. Aumenta `DB_POOL_MAX`, oppure individua le query lente o le transazioni lunghe che occupano le connessioni. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, la `select` di un aggregato o `groupBy` specifica un campo che i ruoli di questo chiamante non possono leggere (`access.read`), un percorso annidato o un ordinamento di aggregato specifica una relazione che non possono leggere — oppure un'operazione sul campo (`$inc`, `$push`, …) ne ha come destinazione uno, caso in cui un limite rifiutato rivelerebbe il valore memorizzato. Un campo che nessuna risposta può contenere non deve poter essere interrogato da alcuna query, altrimenti il valore sarebbe ricavabile un predicato alla volta. Un filtro attraverso una relazione (`author.salary`) e un ordinamento di aggregato sul campo di una relazione (`max(staff.salary)`) sono valutati secondo la regola della destinazione. `details.violations` elenca ciascun campo. Un campo nascosto con `excludeFromApi` risponde come se non esistesse: un filtro, `orderBy`, `fields`, `include`, la `select` di un aggregato o `groupBy`, oppure `vector_search` che lo specifica ottiene esattamente la risposta di un nome scritto male (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), e nessuna risposta di campo sconosciuto ne elenca uno. | Rimuovi il campo dalla query, oppure acquisisci il ruolo necessario. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il corpo imposta un campo che i ruoli di questo chiamante non possono scrivere (`access.write`). Viene rifiutato anziché ignorato: una scrittura che tralasciasse un campo segnalerebbe un successo per una modifica mai avvenuta. Lo stesso codice rifiuta una scrittura tramite un genitore che imposta una relazione che il chiamante non può scrivere, e un aggiornamento che imposta un campo `softDelete` a un valore — solo un'eliminazione lo marca. `details.violations` elenca ciascun campo. | Rimuovi il campo, oppure acquisisci il ruolo necessario. Un campo che nessuno può scrivere restituisce invece `VALIDATION_EXCLUDED_FIELDS`. |
| `HISTORY_UNAVAILABLE` | 503 | Una scrittura su una collection con `history: true` è stata rifiutata perché non è stato possibile registrarne la voce di cronologia: il database non ha la tabella `rebase.entity_history` oppure, per `openRebase` e `rebase console`, la funzione `rebase.record_history`. Nessun backend con la cronologia attiva si è mai avviato su questo database. Non è stato eseguito nulla, callback comprese, e le letture non ne risentono. Sollevato da `openRebase` e restituito da un backend creato con `provision: false`. | Avvia il backend una volta con la cronologia attiva e `provision: true` (`rebase dev` lo fa), poi riprova. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine dell'operazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è arrivata su una richiesta diversa: un altro metodo, percorso, query string o corpo. | Usa una nuova chiave, oppure invia la richiesta originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` ha indicato una funzione diversa da `count`, `sum`, `avg`, `min` o `max`. | Usane una tra queste; il messaggio ne riporta l'elenco. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce di `?select=` non rispetta il formato `fn(field)`, oppure a una funzione diversa da `count()` non è stato associato alcun campo. | Utilizza la sintassi `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` o `orderBy` su un'aggregazione senza `groupBy`, o un cursore su qualsiasi aggregazione. Un'aggregazione non raggruppata è una riga, e un gruppo non è una riga dopo cui un cursore possa proseguire. | Aggiungi `groupBy`, o toglili; pagina i gruppi con `offset` o `page`. Vedi [Aggregazioni](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Un'operazione in `/_batch` è priva di `op`, `collection`, `values` o `id`, specifica una collection non gestita da questo backend, oppure riutilizza un nome `ref`. | Consulta il messaggio; indica l'operazione in base all'indice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` non fa riferimento ad alcuna operazione precedente, punta in avanti o richiede un campo non presente nella riga referenziata. Si possono risolvere solo riferimenti all'indietro. | Definisci l'operazione con `ref` *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | Il corpo della richiesta bulk non presenta il formato atteso. | Invia l'array che la route accetta: `{ "rows": [...] }` a `POST /bulk`, `{ "updates": [{ "id", "data" }] }` a `PATCH /bulk`, `{ "ids": [...] }` a `POST /bulk/delete`. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert indica colonne senza garanzia di unicità, le specifica senza `upsert: true`, oppure è inviato su una creazione annidata, dove una riga trovata passerebbe sotto il nuovo parent. In caso contrario, Postgres restituirebbe l'errore 42P10 dall'interno di una transazione che ha già svolto del lavoro. Anche qualsiasi upsert sulla collection degli utenti (auth), dove una creazione e un aggiornamento seguono regole diverse. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target effettivamente disponibili. Sulla collection degli utenti, invia un `POST` per creare e un `PATCH` per aggiornare. |
| `INVALID_COUNT` | 400 | `?count=` non è `exact` né `none`. Rifiutato anziché letto come valore predefinito: un `?count=nnone` scritto male pagherebbe il conteggio che doveva saltare. | Invia `exact` (il valore predefinito) oppure `none`. Vedi [Saltare il conteggio](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Il cursore `after` non è leggibile, o indica un id di riga che non corrisponde alle colonne chiave della collection: è stato troncato, ricodificato o costruito a mano. Un cursore leggibile inviato con un `orderBy` diverso da quello con cui è stato emesso è `CURSOR_ORDER_MISMATCH`, anch'esso un 400. | Restituisci invariato il `meta.nextCursor` della pagina precedente, con lo stesso `orderBy` o nessuno. Vedi [Paginazione](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Viene rifiutato anziché ignorato: un errore di battitura come `?deleted=true` che nascondesse silenziosamente tutte le righe eliminate sembrerebbe aver funzionato, rispondendo in realtà alla domanda opposta. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è `true` o `false`. | Invia uno di questi valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | È stato utilizzato un operatore `$inc` / `$push` / `$pull` / `$merge` su un tipo di proprietà non compatibile, con un operando dal formato non corretto, con due operatori sullo stesso campo, digitato in modo errato, o in un'operazione di creazione — dove non esiste un valore salvato su cui operare. | Consulta [Scrittura via REST](/docs/backend/writes/#field-operations); il messaggio indica il campo interessato. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro indica una proprietà non presente in questa collection. | Verifica la correttezza del nome rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di proprietà — per esempio `like` su un numero o una data. | Consulta [Interrogare i dati](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Il valore di un filtro non può essere interpretato come il tipo della colonna a cui è confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non presente nell'enum, un timestamp non valido, un numero che supera l'intervallo consentito dal tipo. `details.dbCode` riporta il codice SQLSTATE. | Invia un valore corrispondente al tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che applica un soft-delete quando il chiamante aveva richiesto una rimozione permanente indurrebbe a credere che i dati siano stati eliminati definitivamente. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non è un elenco di percorsi valido, oppure un oggetto di opzioni per relazione con una forma errata. Un percorso annidato oltre i tre salti è `INCLUDE_TOO_DEEP`, anch'esso un 400. L'errore viene intercettato al limite della richiesta anziché propagarsi dal driver come errore 500. | Consulta il messaggio; indica il percorso non valido. |
| `INVALID_INPUT` | 400 | Il corpo della richiesta non ha superato la convalida. | Consulta il messaggio. |
| `INVALID_LIMIT` | 400 | `?limit=` non è un numero intero da 1 al massimo (1000 per impostazione predefinita); uno più grande viene rifiutato, non ridotto. Una sottoscrizione realtime che chiede un limite fuori da quell'intervallo riceve lo stesso codice come frame `ERROR` di WebSocket. | Riduci il limite e scorri il resto con la paginazione. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` / `?not=` è malformato o supera il livello di annidamento consentito. | Consulta il messaggio; mostra la regola di appiattimento. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un numero intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non è `field`, `field:desc`, `field:desc:last` o un array JSON di `{ field, direction, nulls }` — oppure indica una direzione diversa da `asc`/`desc`, o una posizione dei NULL diversa da `first`/`last`. | Consulta il messaggio; mostra ogni sintassi valida. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. La numerazione delle pagine parte da 1, quindi `?page=0` è considerato un errore e non la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro di query è malformato. | Consulta il messaggio. |
| `INVALID_QUERY_BODY` | 400 | Il body di un `POST …/query` contiene un valore che l'URL non avrebbe potuto portare: una lista per un parametro che l'URL legge una volta sola (`fields`, `limit`, …), un oggetto per un filtro, oppure qualsiasi parametro presente anche nell'URL — un `POST …/query` legge ogni parametro dal body. | Scrivi ogni valore come lo scrive l'URL — una stringa, o una lista per un filtro ripetuto; `where`, `include`, `orderBy` e `vector` accettano JSON. Vedi [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non è `cosine`, `l2` o `inner_product`. | Utilizza uno di questi tre valori. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che mappa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Un update nomina la chiave della riga con un valore diverso da quello con cui è indirizzata — nel corpo, oppure scritto da un `beforeSave`. Una riga non può spostarsi su un'altra chiave: tutto ciò che segue la scrittura (la rilettura, `afterSave`, la storia, il realtime) la indirizza con la chiave che aveva. Rifiutato prima che venga eseguito qualsiasi hook, senza che nulla venga scritto, su ogni canale. `details.violations` nomina il campo. | Crea la riga con la nuova chiave ed elimina questa. Inviare la chiave che la riga già possiede va bene. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata chiamata senza `?select=`. | Aggiungine uno, ad es. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Il progetto non gestisce alcuna collection: nessuna dichiarata nel codice e nessuna tabella da cui ricavarle. Quando esistono tabelle ma la row-level security è disattivata su di esse, il messaggio le nomina, con l'SQL per attivarla, e `details.unprotectedTables` le elenca; su 0.24 dice che non ci sono tabelle. | Crea delle tabelle — tramite migrazione, SQL o un file collection seguito da `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con questo id in questa collection — oppure una riga nascosta a questo chiamante dalla row-level security. | Controlla l'id, poi le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica un elemento che non costituisce una relazione nella collection. Lo stesso codice risponde con **404** quando è invece un *percorso URL* annidato a indicarne una inesistente, ad esempio `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuna — in quel caso l'URL non fa riferimento a nulla, quindi si tratta di una risorsa non trovata anziché di una richiesta malformata. | Controlla il nome della relazione — il messaggio elenca quelle presenti nella collection. Un riferimento inverso deve essere dichiarato sul genitore per essere esplorabile. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento fa riferimento a una proprietà non ordinabile. | Ordina in base a una proprietà supportata da colonna. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` è stato combinato con `?offset=` — oppure `page` con `offset` in una `find()`, che l'SDK client, il `rebase.data` in-process e il client offline rifiutano con lo stesso codice prima di qualsiasi richiesta. Descrivono la stessa finestra, e `page` prevaleva in silenzio su un `offset` che il chiamante non vedeva mai applicato. | Invia uno solo dei due. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo della richiesta supera il limite configurato. | Invia meno dati, oppure aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` ha tentato di eseguire una scrittura. Una lettura con ambito richiesta viene eseguita all'interno di una transazione `READ ONLY`, pertanto né il callback né le funzioni da esso chiamate possono eseguire scritture. | Sposta la scrittura all'esterno dell'operazione di lettura: usa un background job, oppure `rebase.dataAsAdmin` da un cron job o da una custom function. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura includeva un payload di collegamento, ma il percorso non raggiunge la destinazione tramite una relazione `manyToMany` che dichiara `through.properties` — di conseguenza non è presente alcuna riga di giunzione su cui inserirlo. | Dichiara `through.properties` nella relazione, oppure rimuovi il payload dalla scrittura. Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non corrisponde allo schema registrato. L'operazione viene rifiutata anziché ignorata: tralasciarla riporterebbe il successo di una scrittura mai avvenuta, oppure l'assenza di righe in realtà esistenti. | Esegui `rebase schema generate` se lo schema generato è meno recente del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura dal lato proprietario della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile, oppure una creazione o un aggiornamento nomina una relazione `via` a più passaggi: sono scrivibili solo le relazioni `via` a passaggio singolo. `details.fields` elenca le chiavi `via`. Non è stato scritto nulla. | Scrivi direttamente le righe che la catena unisce. Consulta [Relazioni](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione dichiara colonne di giunzione, ma questa sorgente dati non supporta la loro scrittura. | Il collegamento in sé funziona comunque; solo il payload associato non è supportato. Verifica le capacità del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura di relazione non disponeva della chiave di origine a cui agganciare il collegamento. | Salva prima la riga genitore. |
| `RESULT_TOO_LARGE` | — | Un'istruzione inviata tramite `EXECUTE_SQL` del socket realtime — `admin.executeSql` da un client, le letture del catalogo del pannello admin — ha restituito più di 128 MB di righe, quindi non ne è stata inviata nessuna. Consegnato come frame WebSocket `ERROR`. Le esecuzioni della console SQL stessa non vengono rifiutate: mostrano le prime righe. | Aggiungi un `LIMIT`, o seleziona meno colonne, e leggi il risultato a parti. |
| `ROW_IN_TRASH` | 409 | La chiave di un upsert appartiene a una riga nel cestino (una riga eliminata con soft delete mantiene comunque la sua chiave). Un upsert non scrive in una riga eliminata, su nessun canale: `?on_conflict=` su REST, gli upsert di `/bulk` e `/_batch`, l'SDK e il socket realtime. Non è stato scritto nulla. | Ripristina prima la riga (un update che imposta il campo di soft-delete a `null`), oppure elimina definitivamente con `?hard=true` e ripeti l'upsert. Vedi [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabella o una colonna prevista dal codice non esiste nel database. | Esegui `rebase db push` in ambiente di sviluppo; riesegui il deploy su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per ogni query anziché memorizzata, quindi non può fungere da chiave per un cursore. | Esegui la paginazione della rilevanza con `limit`/`offset`, oppure ordina in base a una colonna. |
| `SQL_ERROR` | 400 | Il database ha rifiutato SQL scritto da una persona. Tramite `EXECUTE_SQL` del socket realtime è un frame `ERROR` con il messaggio del database. `POST /api/admin/sql/csv` risponde così prima che venga inviata qualsiasi parte del file: un errore di sintassi, una scrittura (il download viene eseguito in sola lettura), più di un'istruzione, o un ruolo che la connessione non può assumere. | Correggi l'SQL. Un download accetta una sola `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura sposterebbe una riga da un tenant a un altro. Una riga non può cambiare tenant. `details.violations` indica il campo. | Crea la riga nell'altro tenant ed elimina questa, oppure esegui la scrittura con un ruolo presente in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura specifica un tenant a cui questo chiamante non appartiene; anche il database la rifiuterebbe. | Scrivi in un tenant di cui il chiamante fa parte, oppure autenticati con un'identità che vi appartenga. |
| `TENANT_REQUIRED` | 400 | La collection è limitata a un tenant (tenant-scoped) e il tenant non può essere dedotto: la richiesta non ne specifica alcuno, oppure il chiamante appartiene a più tenant. | Invia il campo tenant in modo esplicito, oppure autenticati come chiamante appartenente a un solo tenant. |
| `TRANSACTION_ABORTED` | 500 | Un'istruzione sulla transazione della scrittura è fallita e un callback ha intercettato l'errore. Postgres aveva già interrotto la transazione, quindi la scrittura è stata annullata e non è stato memorizzato nulla. Solo una `context.data` create, update o delete rifiutata dal database viene annullata da sola ed è sicuro intercettarla. | Lascia che l'errore venga propagato, oppure effettua un controllo prima di eseguire l'istruzione. Consulta [Semantica delle transazioni](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` specifica un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un aggregato o `groupBy` specifica un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo non presente in questa collection — o nella destinazione di una relazione — oppure uno nascosto con `excludeFromApi`. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro specifica un operatore inesistente. | Il messaggio elenca tutti gli operatori disponibili. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket realtime ha un `type` che il server non gestisce. Risposta come frame `ERROR` con il `requestId` della richiesta, così la richiesta si chiude invece di andare in timeout. | Controlla il `type` del frame; il messaggio lo nomina. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento specifica un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un header `If-Match` ha specificato una versione della riga non più attuale: qualcuno vi ha scritto tra la lettura e questa scrittura. Non è stato modificato nulla. | Rileggi la riga, riapplica la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è di tipo `vector` in questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il `Content-Type` non rientra tra quelli accettati da questa route. | Invia il tipo indicato nella documentazione della route. |
| `UNSUPPORTED_OPTION` | — | Lanciato, non risposto: una scrittura tramite l'accessor in-process (`context.data` in un callback, `rebase.data` in una funzione o cron) ha ricevuto `ifMatch` oppure `idempotencyKey`. Quel canale non ha alcun controllo delle precondizioni né uno store di idempotenza, quindi l'opzione viene rifiutata prima che venga scritto qualcosa, invece di essere ignorata. | Rimuovi l'opzione lì, oppure effettua la scrittura tramite il client HTTP, che rispetta entrambe. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è configurato in una sola direzione, quindi non vi è alcun elemento con cui correlare una sottoquery all'indietro. | Filtra dal lato proprietario della relazione. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è definito per quel campo: una relazione senza una colonna su questa riga viene filtrata per appartenenza, e la corrispondenza di pattern (`like`, `ilike` e le loro negazioni) si applica solo al testo. | Consulta il messaggio; elenca i valori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore ha violato una regola di `validation` definita dalla proprietà — una lunghezza, un intervallo, un pattern, un campo obbligatorio. | Consulta il messaggio; indica ciascuna violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il corpo scrive su una colonna contrassegnata con `excludeFromApi` o `access: { write: [] }` — la stessa regola, con due sintassi diverse. Questi campi sono riservati all'impostazione da parte del server: l'hash di una password, un token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è identica per qualsiasi chiamante, `admin` compreso. | Rimuovi il campo. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non corrisponde al tipo della proprietà. | Consulta il messaggio; indica la proprietà interessata. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo specifica un campo non presente nella collection — compreso un argomento `id` su una collection la cui chiave è basata su un altro campo. | Verifica la correttezza del nome; il messaggio elenca i campi noti. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Un cursore (`after` / `startAfter`) è stato combinato con una ricerca vettoriale. Le righe sono ordinate per una distanza calcolata per ogni query, che non può fare da cursore, quindi un elenco vettoriale non ha `nextCursor`. | Pagina le righe più vicine con `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha rifiutato la scrittura. | Controlla le `securityRules` della collection. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura che Postgres rifiuta per un motivo legato ai *dati del chiamante* risponde
con lo SQLSTATE nel codice: `PG_23505`, `PG_23503` e così via. Si tratta di una famiglia
di codici, non di un elenco esaustivo — Postgres definisce centinaia di SQLSTATE — ma solo
due classi possono generarlo, poiché solo queste due dipendono dal chiamante:

- **classe 23**, violazione del vincolo di integrità: un duplicato, una foreign key che
  punta al nulla, una colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: un valore che il tipo della colonna non può contenere.

Tutto il resto — una connessione interrotta, una colonna mancante, un problema di privilegi —
è responsabilità del server e rimane un errore `500`. Pertanto `code.startsWith("PG_")` è un
controllo affidabile per verificare se "la riga inviata era errata", e i quattro codici riportati
di seguito sono quelli che un client incontra concretamente. `details.dbCode` include lo stesso
codice SQLSTATE per tutti, e il messaggio indica il vincolo violato.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valore non può essere interpretato come il tipo della colonna — l'equivalente in scrittura di `INVALID_FILTER_VALUE`. | Invia un valore corrispondente al tipo della colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo, oppure imposta un valore predefinito per la colonna. |
| `PG_23503` | 400 / 409 | In un salvataggio, una foreign key fa riferimento a una riga inesistente (400). In un'eliminazione, altre righe fanno ancora riferimento a questa (409; una chiave `RESTRICT` solleva `PG_23001`, anch'essa 409). | Crea prima la riga di destinazione, oppure correggi l'id; per un'eliminazione, rimuovi o ripunta prima le righe che fanno riferimento. |
| `PG_23505` | 409 | È stato violato un vincolo di unicità. Il messaggio indica il vincolo violato. | Usa un valore diverso, oppure aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Il `maxResults` di un elenco dello storage non è un numero intero di almeno 1, o il suo `pageToken` non è stato emesso dalla sorgente. Una dimensione di pagina inferiore a uno restituiva una pagina vuota con lo stesso token, così un ciclo `while (pageToken)` non finiva mai. | Invia un `maxResults` positivo e restituisci `nextPageToken` invariato. |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Controlla il nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata, esce dal prefisso consentito, oppure si trova sotto un prefisso riservato (`_rebase/renditions/`, `_rebase/maintenance/`). | Controlla la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri di trasformazione dell'immagine sono fuori scala o contraddittori. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | L'upload supera la dimensione `maxSize` dichiarata dalla proprietà di destinazione. Applicato sul server, non solo nel browser. `details` indica la proprietà, il limite e la dimensione effettiva. | Carica un file più piccolo, o aumenta `maxSize` sulla proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo di file caricato non è presente tra i tipi ammessi (`acceptedFiles`) della proprietà, né tra gli `allowedMimeTypes` propri della sorgente di storage. `details` include la proprietà (o l'elenco della sorgente), l'elenco consentito e il content type inviato. | Carica un tipo di file consentito, oppure amplia `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | Il bucket S3 o GCS con cui è configurata questa sorgente non esiste, oppure il provider ha rifiutato le credenziali di questo deployment per esso. Il messaggio nomina il bucket; `details.reason` è `NoSuchBucket` o il rifiuto del provider. Un bucket mancante veniva letto come «file non trovato» su ogni file. | Correggi il nome del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` per una sorgente con nome) o i permessi delle credenziali. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nessun backend di storage è configurato su questo server, oppure nessuno è quello predefinito e la richiesta non nomina alcuna sorgente; il messaggio indica le sorgenti servite (501). Un caricamento riprendibile la cui sorgente è scomparsa prima della fine restituisce 503. | Configura S3, GCS o lo storage locale, o nomina una sorgente con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) tra due sorgenti che archiviano nello stesso bucket o nella stessa directory. Ogni file conterebbe come già presente nella destinazione, essendo lo stesso file, ed eliminare la copia della sorgente eliminerebbe l'unica. Non è stato spostato né eliminato nulla. | Punta la proprietà all'altra sorgente; i suoi file sono già lì. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) non ha potuto leggere ogni collection, quindi un file nominato da una di esse sembrerebbe inutilizzato. Con `?scan=`, la scansione che nomina è quella che non ha potuto leggere ogni collection. Non è stato eliminato nulla; `details.unscanned` nomina ogni collection e il motivo per cui non è stato possibile leggerla. | Correggi ciò che impedisce la lettura di quelle collection ed eseguilo di nuovo. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` nomina una scansione che la sorgente non contiene. Le scansioni vengono conservate per 7 giorni, nella sorgente che hanno scansionato, quindi anche uno `storageId` diverso da quello della scansione non ne trova alcuna. | Passa lo `storageId` della scansione, o avviane un'altra. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` nomina una scansione ancora `queued` o `running`, oppure `failed`. Non è stato eliminato nulla; `details.status` indica quale. | Attendi il completamento della scansione, o avviane un'altra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` nomina una scansione completata da più di 15 minuti. Non è stato eliminato nulla. | Avvia un'altra scansione, ed elimina da quella. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` nomina una scansione i cui orfani sono già in corso di eliminazione. | Leggi il `deletion` della scansione con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La sorgente di storage è dichiarata ma non dispone di credenziali su questa istanza. | Imposta le variabili d'ambiente per quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto la scrittura. | Controlla i relativi log e le credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini simultanee in esecuzione. | Riprova; valuta l'uso di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La richiesta indica una sorgente di storage (`?storageId=`) non dichiarata da questo progetto. Un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** (su un elenco, e su un caricamento, una cartella o un caricamento riprendibile verso S3 o GCS) — ciò che manca è lo store, e `details` elenca i bucket e le sorgenti esistenti. In precedenza entrambi venivano segnalati come "file non trovato", indistinguibili da una chiave semplicemente inesistente. | Dichiara la sorgente in `config/resources.ts`, o controlla `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Il `PATCH` di un caricamento riprendibile è arrivato mentre un altro chunk dello stesso caricamento era ancora in fase di ricezione — quasi sempre un client che ritenta il chunk già in corso. Viene rifiutato invece di essere messo in coda, come fa tusd. | Richiedi l'offset con `HEAD /api/storage/tus/:id` e riprendi da lì; tus-js-client esegue il backoff e ritenta automaticamente. Vedi [Caricamenti riprendibili TUS](/docs/backend/storage-resumable-uploads/). |

## Custom function

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con questo nome è disponibile — o se lo è, le sue route non coprono il percorso successivo. A un chiamante autenticato viene anche indicato cosa *è* disponibile; a uno anonimo no, poiché tale elenco costituirebbe un inventario di tutti gli endpoint personalizzati. Se un file con quel nome non è stato caricato, il messaggio lo dice a un chiamante autenticato, nominando il file: questa è la differenza tra un errore di digitazione e un deploy non riuscito. Un chiamante anonimo riceve la semplice risposta di nome sconosciuto, come per un nome che non corrisponde a nulla. | Confronta il nome con `GET /api/functions`, o controlla il log di avvio per individuare il file non caricato. |
| `FUNCTION_TIMEOUT` | 504 | L'handler ha superato il timeout previsto. L'esecuzione è ancora in corso; non può essere interrotta da qui. | Assegna un `AbortSignal` alle chiamate in uscita, oppure aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo fa da proxy per le funzioni verso un altro processo, che non ha risposto. | Verifica che l'unità delle funzioni sia in esecuzione. |

## Cron job

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Un avvio manuale di un cron job già in esecuzione — nel processo che ha risposto, o in un altro che detiene il lease di esecuzione del job, come il worker dietro un processo `api`. Non è stato eseguito nulla. Il salto è nella cronologia del job, e `details.log` è quella voce; la sua riga indica il processo che esegue il job. | Riprova quando quell'esecuzione è terminata. Vedi [Cron job](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superfici di amministrazione e modifica dello schema

Questi codici indicano che una funzionalità è disattivata o non configurata, piuttosto
che la richiesta fosse errata. Ciascuno di essi viene segnalato anche sulla route `/status`
corrispondente con stato `200`, consentendo a un pannello di disabilitare visivamente
la funzione (in grigio) anziché mostrare un errore.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata chiamata una superficie riservata agli amministratori su un server senza autenticazione configurata, quindi non è possibile distinguere un amministratore da un utente anonimo. | Imposta `auth.jwtSecret`, oppure passa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` ha ricevuto il fingerprint di un diff non più vero: il branch o il suo genitore sono cambiati da allora. Non è stato scritto nulla. | Rileggi il diff, esaminalo e unisci con il suo nuovo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La sorgente dati non può confrontare branch: non ha SQL, o non ha il branching (nessuna connessione di amministrazione). | Usa un backend Postgres con `adminConnectionString` impostato. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabella che differisce non si può unire: aggiunta o eliminata dal branch, colonne o chiave primaria diverse, nessuna chiave primaria, troppe righe da abbinare, o riscritta da quando il branch è stato creato (`TABLE_REWRITTEN`). Una tabella le cui righe non si sono potute abbinare blocca anche quando i suoi conteggi riportano 0: sono sconosciuti, non zero. `details.tables` le nomina tutte, con il motivo. Non è stato scritto nulla. | Applica prima lo schema con le tue migrazioni, o unisci con `skipBlocked: true` per lasciare stare quelle tabelle. |
| `BRANCH_MERGE_CONFLICT` | 409 | Alcune righe sono cambiate sia nel branch sia nel suo genitore, e `onConflict` era `"abort"` (il predefinito); oppure il genitore ha rifiutato parte dell'unione: una riga è cambiata nel frattempo, un trigger l'ha saltata, una policy l'ha nascosta. Non è stato scritto nulla. | Scegli quale lato prevale con `onConflict: "branch"` o `"target"`, o rileggi il diff. |
| `BRANCH_MERGE_FAILED` | 409 | Il genitore ha rifiutato le righe del branch dentro l'istruzione di unione — un vincolo, un'etichetta di enum o una chiave esterna che il genitore possiede e che le righe del branch violano, di solito perché i due schemi differiscono. `details` riporta `sqlState`, `table`, `constraint` e `detail`. Non è stato scritto nulla. | Leggi le modifiche di schema del diff, allinea lo schema del genitore alle tue migrazioni, o correggi le righe del branch, poi unisci di nuovo. |
| `BRANCH_NOT_FOUND` | 404 | Nessun branch ha quel nome nel registro. | `rebase db branch list`, o il pannello Branch, elenca quelli esistenti. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto del progetto viene fornito solo quando l'autenticazione è configurata — descrive ogni tabella e relazione. | Configura l'autenticazione. `/meta/schema-version` è sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna casella di posta di sviluppo è attiva. Le email vengono acquisite solo quando `SMTP_HOST` non è impostato e `NODE_ENV` non è in produzione. | Rimuovi `SMTP_HOST` in ambiente di sviluppo, oppure controlla la casella di posta reale. |
| `INVALID_CHANGE` | 400 | La modifica dello schema proposta non è ben formata. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione di una modifica programmata dello schema non è riuscita per un motivo non coperto da codici più specifici. | Consulta il messaggio; riporta testualmente l'errore sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma non può essere applicata allo schema nello stato attuale. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository presenta modifiche non salvate (uncommitted), quindi la modifica non ha potuto essere applicata in modo sicuro. | Esegui commit o stash, poi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor di schema ha rifiutato la modifica. | Consulta il messaggio; è il rifiuto esplicito dell'editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra identità automatizzata (machine principal) ha tentato di applicare una modifica allo schema. | Accedi come utente, oppure imposta `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica dello schema dal vivo richiede `collectionsDir` o `liveSchema.repository`, e questo server è stato avviato senza nessuno dei due. | Configura uno di essi. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione funziona; non è presente alcun repository in cui salvare (commit) la modifica. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Questa distribuzione non modifica nulla nel proprio database (`REBASE_PROVISION=false`), quindi una modifica non può essere applicata dal pannello. <span class="since-badge" data-since="0.26">Da 0.26</span> | Fai il commit solo come sorgente e lascia che sia il processo che modifica il database ad applicarla. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non è in grado di pianificare modifiche allo schema. | La modifica dal vivo è disponibile su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | In questo ambiente le collection vengono ricavate per introspezione dal database, quindi non sono presenti file sorgente da modificare. | Modifica lo schema tramite una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor di schema è disabilitato per questo server. Un bundle compilato risponde sempre così. | Abilitalo tramite `schemaEditor`. Su un bundle, imposta `REBASE_LIVE_SCHEMA_REPOSITORY` per modificare le collection tramite un repository — vedi [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor di schema necessita di `ts-morph`, che non è installato. | Installalo nel pacchetto che esegue il backend, poi riavvialo: `pnpm --dir backend add -D ts-morph@28.0.0` dalla radice di un progetto generato con lo scaffold, oppure `pnpm add -D ts-morph@28.0.0` dove il backend è il progetto. Il messaggio nomina il comando per il tuo progetto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non dispone di una `collectionsDir`, quindi l'editor non ha una destinazione in cui scrivere. | Imposta `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato quando `NODE_ENV=production`: i file di un server distribuito vengono ricompilati dal repository a ogni deploy, quindi una modifica qui andrebbe persa. | Modifica le collection in sviluppo ed effettua il deploy, oppure configura `liveSchema.repository` per eseguirne il commit lì. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` non può trasmettere un risultato qui: il database di sviluppo in-process (PGlite) ha una sola connessione, e un cursore tenuto aperto durante un download bloccherebbe ogni altra query; oppure la data source non ha un cursore SQL. | Punta `DATABASE_URL` a un Postgres tuo (`rebase dev --docker` ne avvia uno), oppure aggiungi un `LIMIT` ed esporta le righe a schermo. |

### Perché la tabella di un branch non si può unire

`BRANCH_MERGE_BLOCKED` nomina ogni tabella rifiutata in `details.tables`, con uno di questi codici. Lo stesso codice è nel `blocked` della tabella nel diff stesso, così Studio può dirlo prima che qualcuno prema **Unisci**. Nessuno è una risposta a sé.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Le colonne della tabella differiscono tra il branch e il suo genitore. Le righe vengono confrontate sulle colonne comuni. | Aggiungi al genitore le colonne mancanti con le tue migrazioni (`rebase db push`), poi unisci. Una migrazione che riscrive la tabella — un cambio di tipo di colonna — la trasforma in `TABLE_REWRITTEN`: unisci prima di un cambiamento simile, oppure crea di nuovo il branch dopo di esso. |
| `NO_PRIMARY_KEY` | — | La tabella non ha chiave primaria, quindi le righe non si possono abbinare una per una; il diff ne riporta solo il numero di righe. | Dai alla tabella una chiave primaria, o sposta le sue righe a mano. |
| `PRIMARY_KEY_DIFFERS` | — | Le colonne della chiave primaria, o i loro tipi, differiscono tra i due. | Applica prima lo schema al genitore. |
| `TABLE_ADDED` | — | Il branch ha creato la tabella. Un'unione non ne crea mai una. | Creala nel genitore con le tue migrazioni, poi unisci le sue righe. |
| `TABLE_DROPPED` | — | Il branch ha eliminato la tabella. Un'unione non ne elimina mai una. | Eliminala con le tue migrazioni. |
| `TABLE_REWRITTEN` | — | Un lato ha riscritto ogni riga della tabella dopo la creazione del branch — un cambio di tipo di colonna, un `ADD COLUMN` con un default volatile, `VACUUM FULL`, `CLUSTER` — quindi ogni riga risulta scritta da allora e non si può più dire quale lato abbia cambiato quale riga. | Unisci il branch prima di una migrazione simile, oppure crea di nuovo il branch dal genitore dopo di essa. |
| `TOO_LARGE` | — | La tabella ha su un lato più righe di quante un diff ne abbini una per una (100.000 per impostazione predefinita, `maxRowsPerTable`). | Aumenta `maxRowsPerTable` sia nel diff sia nell'unione, o sposta le righe in un altro modo. |

## Codici generici

Una route utilizza uno di questi codici quando non è applicabile nulla di più specifico.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformata, e non si applica nulla di più specifico. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato, o la credenziale è stata rifiutata. | Accedi o aggiorna il token. |
| `FORBIDDEN` | 403 | Autenticato, ma non autorizzato. | Riprovare con la stessa identità non servirà. |
| `CONFLICT` | 409 | Conflitto con lo stato esistente. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Si è verificato un errore sul server. Il messaggio è generico per motivi di sicurezza. | Riporta il `requestId`; il motivo è presente nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza necessaria a questa route non è configurata su questo server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Un servizio da cui dipende la richiesta non era raggiungibile: un bucket S3 o MinIO, oppure un host che una funzione raggiunge con `fetch()` e che rifiuta la connessione o non si risolve. Il log del server nomina l'host; la risposta no. Un database non raggiungibile è `DATABASE_UNAVAILABLE`. Una connessione che fallisce verso un servizio simile risponde con questo codice; su 0.24 risponde con un `500` il cui codice è l'errore del socket (`ECONNREFUSED`), oppure `INTERNAL_ERROR`. | Riprova; controlla i log. |

## Mantenere aggiornata questa pagina

`pnpm verify:docs` fallisce quando un codice che il server può generare è assente da queste
tabelle, quando una tabella elenca un codice che nulla può generare, quando gli stati di una riga non sono esattamente quelli con cui il codice sorgente genera il codice o quando una famiglia di codici come `PG_<SQLSTATE>` non ha una riga
per un codice SQLSTATE che i chiamanti possono incontrare. Lo stage di verifica è
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Esegue prima un controllo su se stesso. La scansione estrae i codici direttamente dal codice
TypeScript anziché da un server in esecuzione, quindi i suoi punti ciechi sono per costruzione
silenziosi: in passato non era in grado di rilevare un codice passato attraverso un wrapper a
riga singola, o uno scritto dopo un messaggio contenente una `)`, e segnalava che "ogni codice
generabile dal server è documentato" su una pagina a cui ne mancavano diciassette. Per questo
motivo, lo stage esegue una fixture esattamente con queste casistiche prima di leggere questa
pagina, e si rifiuta di segnalare qualsiasi esito se non riesce a individuarle.
