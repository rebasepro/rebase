---
sourceHash: b82ed0c23d6537de
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il relativo stato HTTP, significato e azioni da intraprendere — oltre all'envelope di risposta, X-Request-ID e le regole per i details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e include un
`code` stabile. Il codice è l'elemento su cui creare diramazioni logiche (branching): il messaggio è scritto per un essere umano
e potrebbe essere riformulato, lo stato è condiviso da una dozzina di problemi diversi, mentre il
codice non è nessuna delle due cose.

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

- **`message`** — leggibile dall'uomo. Per un `4xx` corrisponde al messaggio generato dal server; per
  un `5xx` è deliberatamente generico, poiché il testo sottostante potrebbe menzionare un
  host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori riportati di seguito. Stabile tra le versioni minori.
- **`details`** — opzionale e mai garantito. Consulta le regole di seguito.
- **`requestId`** — presente ogni volta che la richiesta passa attraverso il middleware del
  request-ID, ovvero ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante
se è un UUID v4 valido, altrimenti ne viene generato uno nuovo. Viene restituito nella
risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e
associato alla riga di log del server per quella richiesta.

È la chiave di correlazione (join key). Includila in una segnalazione di bug e un operatore potrà
risalire alla riga di log specifica che spiega l'errore, con il motivo che non è mai stato
mostrato al client.

Inviare il proprio ID è il modo in cui una traccia sopravvive a un hop: un gateway o un job runner che
inoltra l'header ottiene lo stesso ID in tutti i servizi che hanno gestito la richiesta.
Un valore non valido viene ignorato anziché rifiutato — non vale la pena far fallire una richiesta per un
header malformato inviato da un chiamante — quindi non dare per scontato che l'ID inviato sia
l'ID ricevuto. Leggi l'header della risposta.

### Cosa contiene `details`

`details` ha uno scopo diagnostico, non contrattuale. È regolato da tre regole:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Si tratta degli
   errori commessi dal chiamante descritti con precisione: quale campo di filtro era sconosciuto,
   quale relazione non è scrivibile, quale valore non corrispondeva al suo tipo.
2. **La diagnostica del database viene ridotta in produzione.** Quando l'errore proviene
   da Postgres, `details.dbCode` — lo SQLSTATE — è sempre presente: indica
   la classe del problema senza rivelare nulla sui dati. `dbMessage`,
   `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`,
   poiché Postgres vi inserisce il contenuto delle righe. L'errore `23505` segnala
   `Key (email)=(a@b.c) already exists.`, rispondendo così alla domanda "questa persona è
   registrata?" per qualsiasi indirizzo si provi a verificare.
3. **Non creare mai rami logici (branch) basandoti su `details`.** Basati su `code`. Il contenuto di `details` è
   semplicemente ciò che è risultato utile a una persona in quel punto di chiamata, ed è soggetto a modifiche.

## Interpretare uno status

| Status | Cosa indica riguardo alla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticato, o credenziale scaduta. Effettua l'accesso o aggiorna il token. |
| `403` | Autenticato, ma non autorizzato. Riprovare con la stessa identità non risolverà il problema. |
| `404` | Route, collection o riga inesistente — oppure una riga nascosta dalla row-level security. |
| `409` | Conflitto con lo stato esistente: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il body è troppo grande, il media type non è corretto, o la richiesta è stata rifiutata a livello semantico. |
| `429` | Rate limit superato. Rallenta le richieste; il messaggio indica per quanto tempo attendere. |
| `500` | L'errore risiede nel server o nel suo database, non nel chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può gestirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza non è raggiungibile, non è configurata o è troppo lenta. |

## Autenticazione e account

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa la verifica MFA, quindi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nessuna — lo stato desiderato è già valido. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disattivato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `API_KEY_FORBIDDEN` | 403 | È stata usata una chiave API su una route riservata alle persone fisiche. | Usa una sessione utente. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di creare, elencare o revocare chiavi API. | Gestisci le chiavi come amministratore autenticato. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione Rebase a monte, quindi la credenziale del chiamante non è mai stata esaminata. | Esegui il mount dell'app tramite il functions router invece che direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Accedi prima. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di concedere il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è riservato solo al primissimo utente, e questo non lo è. | Chiedi a un amministratore esistente di concedere il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi una nuova verifica (challenge). |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati per una singola verifica MFA. | Avvia una nuova verifica. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con questo indirizzo. | Accedi o avvia il recupero della password. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP ma il server non dispone di un mail transport. | Configura SMTP, o usa un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | L'account esiste ma il suo indirizzo non è verificato. | Verifica l'indirizzo. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma mai confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollega prima l'identità dall'altro account. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può intervenire. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La verifica MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 401 | Il codice OTP o MFA è errato. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — volutamente non viene specificato quale. | Riprova o reimposta la password. |
| `INVALID_TOKEN` | 400 | Un token di verifica, ripristino o magic link è malformato o sconosciuto. | Richiedi un nuovo link. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto senza alcun amministratore. | Promuovi prima qualcun altro. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` include un token a breve termine limitato alla verifica MFA — non si tratta di una sessione. | Apri una verifica e rispondi; la risposta alla verifica emetterà la sessione. |
| `NO_SESSION` | 401 | Nessun cookie di sessione o refresh token fornito. Normale al primo caricamento di pagina. | Effettua l'accesso. |
| `NOT_ANONYMOUS` | 400 | Una route di aggiornamento da anonimo è stata chiamata da un account reale. | Nulla da aggiornare. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato o restituito un errore. | Riprova il flusso; il messaggio riporta il motivo del provider. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta le richieste; il messaggio indica per quanto tempo attendere. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | L'URI di reindirizzamento non è presente nell'allow-list. | Aggiungilo alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | La registrazione autonoma (self-service) è disattivata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile recuperare i ruoli per una richiesta riservata agli admin. Si applica una chiusura protettiva (fail-closed) anziché fidarsi del claim del token stesso. | Riprova; controlla il database. |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | La sessione è stata terminata altrove, o tutte le sessioni sono state revocate. | Effettua nuovamente l'accesso. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, quindi questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | Un token monouso è stato riutilizzato. | Richiedine uno nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con questo id. | Controlla l'id. |
| `WEAK_PASSWORD` | 400 | La password non soddisfa i criteri di sicurezza configurati. | Scegline una più robusta. |

## Dati, query e scritture

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non è in grado di calcolare l'aggregazione richiesta. | Usa un driver che lo supporti, oppure calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), dove un branch *è* il genitore e nulla verrebbe isolato. Il rifiuto è lo stesso che stampa `rebase db branch`. | Punta `DATABASE_URL` su una tua istanza di Postgres (`rebase dev --docker` ne avvia una) ed esegui lì il branch. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni del limite consentito per batch (1000 per impostazione predefinita). Un batch costituisce un'unica transazione e mantiene i blocchi per l'intera durata. | Invialo suddiviso in blocchi; il messaggio indica il limite e il conteggio attuale. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non supporta scritture atomiche tra diverse collection, e un ciclo di scritture singole non sarebbe né atomico né eseguito in un unico round trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per singola collection. |
| `BULK_TOO_LARGE` | 400 | Il body dell'operazione bulk supera il limite configurato di elementi. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o questo driver non supporta scritture di massa (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 | Un callback della collection ha rifiutato la scrittura. Un'eccezione `throw` da `beforeSave`/`beforeDelete`/`after*` produce un errore 400 con il messaggio dell'autore; un `beforeDelete` che restituisce `false` genera un 403. `details.stage` specifica quale callback, `details.path` la collection. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore indica già dove inizia la pagina, quindi applicarvi un offset salta silenziosamente quel numero di righe oltre il cursore — un salto non visibile al chiamante nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una query di ricerca o vettoriale. Entrambe associano un punteggio a ciascuna riga, quindi due righe non risulteranno mai uguali e `DISTINCT` non comprimerebbe nulla — sembrerebbe funzionare ma non cambierebbe nulla. | Rimuovi uno dei due. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` è ordinata in base a una colonna che non viene restituita. Una clausola `SELECT DISTINCT` può essere ordinata solo in base alle colonne presenti nel proprio elenco select, altrimenti le righe compresse non hanno un ordine definito. `details.fields` specifica quali sono. | Aggiungi quei campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): a causa di una policy di row-level-security che nega l'accesso a questo ruolo o per via di un `GRANT` mancante. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` di aggregazione o `groupBy` specifica un campo che i ruoli di questo chiamante non possono leggere (`access.read`). Un campo che nessuna risposta può includere non può essere interrogato da alcuna query, altrimenti il valore risulterebbe leggibile un predicato alla volta. `details.violations` elenca ciascun campo. | Rimuovi il campo dalla query o acquisisci il ruolo. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il body imposta un campo che i ruoli di questo chiamante non possono scrivere (`access.write`). Rifiutato anziché ignorato: una scrittura che scartasse un campo riporterebbe esito positivo per una modifica mai avvenuta. `details.violations` elenca ciascun campo. | Rimuovi il campo o acquisisci il ruolo. Un campo che nessuno può scrivere restituisce invece `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine dell'operazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata ricevuta con un body differente. | Usa una nuova chiave oppure invia il body originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` ha specificato una funzione diversa da `count`, `sum`, `avg`, `min` o `max`. | Usane una tra quelle supportate; il messaggio le elenca. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce di `?select=` non è nel formato `fn(field)`, oppure a una funzione diversa da `count()` non è stato passato alcun campo. | Scrivi `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Un'operazione in `/_batch` è priva di `op`, `collection`, `values` o `id`, specifica una collection non gestita da questo backend o riutilizza un nome `ref`. | Consulta il messaggio; specifica l'operazione in base all'indice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` non fa riferimento ad alcuna operazione precedente, punta in avanti o richiede un campo non presente nella riga referenziata. Si possono risolvere solo riferimenti all'indietro. | Assegna un nome all'operazione con `ref` *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | Il body dell'operazione bulk non ha la struttura prevista. | Invia l'array `items` documentato. |
| `INVALID_CONFLICT_TARGET` | 400 | La clausola `on_conflict` / `onConflict` di un upsert specifica colonne senza garanzia di unicità, oppure le specifica senza `upsert: true`. In caso contrario Postgres risponderebbe con 42P10 all'interno di una transazione che ha già eseguito operazioni. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target effettivamente esistenti. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Rifiutato anziché ignorato: un errore di digitazione `?deleted=true` che nascondesse silenziosamente ogni riga eliminata sembrerebbe funzionare ma risponderebbe alla domanda opposta. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non corrisponde a `true` o `false`. | Invia uno di questi valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | È stato usato un operatore `$inc` / `$push` / `$pull` / `$merge` su un tipo di proprietà per cui non è definito, con un operando dal formato errato, con due operatori sullo stesso campo, con un errore di ortografia o durante una creazione — dove non esiste alcun valore salvato su cui operare. | Consulta [Writing over REST](/docs/backend/writes/#field-operations); il messaggio specifica il campo. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro specifica una proprietà che questa collection non possiede. | Verifica l'ortografia rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di proprietà. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Il valore del filtro non può essere interpretato come il tipo della colonna con cui è stato confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non inclusa nell'enum, un timestamp non valido, un numero che supera l'intervallo del tipo. `details.dbCode` include lo SQLSTATE. | Invia un valore compatibile con il tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non corrisponde a `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che applica un soft-delete quando il chiamante chiedeva un purge definitivo lascia erroneamente credere che i dati siano stati rimossi. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non è un elenco di percorsi valido o supera la profondità massima consentita. Viene intercettato al confine anziché propagarsi dal driver come errore 500. | Consulta il messaggio; specifica il percorso problematico. |
| `INVALID_INPUT` | 400 | La validazione del body non è andata a buon fine. | Consulta il messaggio. |
| `INVALID_LIMIT` | — | Una sottoscrizione realtime ha richiesto un limite al di fuori dell'intervallo consentito. Restituito come frame WebSocket `ERROR`, non come risposta HTTP. | Abbassa il limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` è malformato o annidato oltre la profondità consentita. | Consulta il messaggio; mostra la regola di appiattimento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non è nel formato `field`, `field:desc` o un array JSON di `{ field, direction }`. | Consulta il messaggio; mostra tutte e tre le opzioni valide. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine sono su base 1, quindi `?page=0` viene considerato un errore e non la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro della query è malformato. | Consulta il messaggio. |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non corrisponde a `cosine`, `l2` o `inner_product`. | Usane uno tra questi tre. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata chiamata senza specificare `?select=`. | Aggiungine uno, es. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Il progetto non fornisce alcuna collection: nessuna dichiarata nel codice e nessuna tabella da cui derivarla. | Crea le tabelle — tramite migrazione, SQL o un file di collection insieme a `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con quell'id in quella collection — o una riga nascosta a questo chiamante dalla row-level security. | Controlla l'id, quindi le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` specifica un elemento che non è una relazione sulla collection. Lo stesso codice restituisce **404** quando è un *percorso URL* annidato a indicarne uno inesistente, es. `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuno — in tal caso l'URL non punta a nulla, quindi si tratta di una risorsa non trovata e non di una richiesta malformata. | Controlla il nome della relazione — il messaggio elenca quelle presenti nella collection. Un riferimento inverso deve essere dichiarato sul genitore per poter essere attraversato. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento specifica una proprietà non ordinabile. | Ordina in base a una proprietà supportata da una colonna. |
| `PAYLOAD_TOO_LARGE` | 413 | Il body supera il limite configurato. | Invia meno dati o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` ha tentato di eseguire una scrittura. Una lettura associata alla richiesta viene eseguita all'interno di una transazione `READ ONLY`, pertanto né il callback né le operazioni da esso chiamate possono scrivere. | Sposta la scrittura all'esterno della lettura: usa un job in background o `rebase.dataAsAdmin` da un cron job o una custom function. |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non è risolvibile rispetto allo schema registrato. L'operazione viene rifiutata anziché ignorata: scartarla riporterebbe successo per una scrittura mai avvenuta, oppure risulterebbe vuota per righe che esistono. | Esegui `rebase schema generate` se lo schema generato è più vecchio del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura dal lato proprietario (owning side). |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile. | Consulta [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura della relazione non aveva alcuna chiave di origine a cui agganciare il collegamento. | Salva prima la riga genitore. |
| `SCHEMA_DRIFT` | 500 | Una tabella o una colonna prevista dal codice non esiste nel database. | Esegui `rebase db push` in sviluppo; effettua un nuovo deploy su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per ogni query anziché essere salvata, quindi non può fungere da chiave per un cursore. | Esegui la paginazione della rilevanza con `limit`/`offset`, oppure ordina in base a una colonna. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura tenterebbe di spostare una riga da un tenant a un altro. Una riga non può cambiare tenant. `details.violations` indica il campo. | Crea la riga nell'altro tenant ed elimina questa, oppure scrivi con un ruolo incluso in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura specifica un tenant a cui questo chiamante non appartiene; anche il database la rifiuterebbe. | Scrivi in un tenant a cui il chiamante appartiene, oppure autenticati con un utente che ne fa parte. |
| `TENANT_REQUIRED` | 400 | La collection è vincolata al tenant e quest'ultimo non può essere dedotto: la richiesta non ne include alcuno o il chiamante appartiene a più tenant. | Invia il campo del tenant esplicitamente, oppure autenticati come chiamante appartenente a un solo tenant. |
| `UNKNOWN_FIELD` | 400 | `?fields=` specifica un campo che la collection non possiede. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o un `groupBy` specifica un campo che la collection non possiede. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo che questa collection — o il target di una relazione — non possiede. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro specifica un operatore inesistente. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento specifica un campo che questa collection non possiede. | Verifica l'ortografia; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un header `If-Match` ha specificato una versione della riga non più aggiornata: qualcuno ha modificato la riga tra la lettura e questa scrittura. Non è stato scritto nulla. | Rileggi la riga, applica nuovamente la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo che la collection non possiede. | Verifica l'ortografia; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è di tipo `vector` in questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il `Content-Type` non è tra quelli accettati da questa route. | Invia il tipo documentato per la route. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è configurato in un'unica direzione, quindi non c'è modo di ricollegare una subquery. | Filtra dal lato proprietario (owning side). |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è definito per quel campo: una relazione senza colonna su questa riga viene filtrata per appartenenza, e il matching case-insensitive si applica solo al testo. | Consulta il messaggio; elenca cosa accetta il campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore non rispetta una regola di `validation` dichiarata dalla proprietà — lunghezza, intervallo, pattern o campo obbligatorio. | Consulta il messaggio; specifica ogni violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il body scrive su una colonna contrassegnata come `excludeFromApi` o `access: { write: [] }` — la stessa regola, con due sintassi diverse. La loro gestione è riservata al server: hash delle password, token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è identica per ogni chiamante, incluso `admin`. | Rimuovi il campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non è compatibile con il tipo della relativa proprietà. | Consulta il messaggio; specifica la proprietà. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il body specifica un campo non presente nella collection — incluso un argomento `id` su una collection la cui chiave primaria è basata su altro. | Verifica l'ortografia; il messaggio elenca i campi noti. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level-security ha rifiutato la scrittura. | Controlla le `securityRules` della collection. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura rifiutata da Postgres per un motivo attribuibile ai *dati inviati dal chiamante* risponde
con lo SQLSTATE inserito nel codice: `PG_23505`, `PG_23503`, e così via. Si tratta di una
famiglia di codici, non di un elenco esaustivo — Postgres definisce centinaia di SQLSTATE — ma solo due
classi possono effettivamente verificarsi, poiché solo queste due sono imputabili al chiamante:

- **classe 23**, violazione dei vincoli di integrità: un duplicato, una chiave esterna che
  punta a un elemento inesistente, una colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: un valore non supportato dal tipo della colonna.

Tutto il resto — una connessione interrotta, una colonna mancante, un problema di privilegi —
è di competenza del server e rimane un errore `500`. Di conseguenza, `code.startsWith("PG_")` è un controllo
sicuro per stabilire se "la riga inviata non era valida", e i quattro codici riportati di seguito sono quelli in cui un client
si imbatte effettivamente. `details.dbCode` include lo stesso SQLSTATE per ciascuno di essi, e
il messaggio riporta il nome del vincolo violato.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valore non può essere interpretato come il tipo della colonna — la controparte in fase di scrittura di `INVALID_FILTER_VALUE`. | Invia un valore del tipo corretto per la colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo oppure imposta un valore di default per la colonna. |
| `PG_23503` | 400 | Una chiave esterna punta a una riga inesistente. | Crea prima la riga di destinazione oppure correggi l'id. |
| `PG_23505` | 409 | È stato violato un vincolo di unicità. Il messaggio specifica il vincolo. | Usa un valore diverso o aggiorna la riga esistente. |

## Storage

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Controlla il nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata o esce dal prefisso consentito. | Controlla la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri per la trasformazione delle immagini sono fuori intervallo o contraddittori. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | L'upload supera la dimensione `maxSize` dichiarata dalla proprietà di destinazione. Il controllo viene applicato sul server, non solo nel browser. `details` riporta la proprietà, il limite e la dimensione effettiva. | Carica un file più piccolo o aumenta `maxSize` sulla proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo di file caricato non rientra tra gli `acceptedFiles` della proprietà. `details` include la proprietà, l'elenco dei tipi accettati e il content type inviato. | Carica un tipo accettato o amplia `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Nessun backend di storage configurato su questo server. | Configura S3, GCS o lo storage locale. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La sorgente di storage è dichiarata ma priva di credenziali su questo ambiente. | Imposta le variabili d'ambiente per quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto la scrittura. | Controlla i relativi log e credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini in corso contemporaneamente. | Riprova; valuta l'uso di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La richiesta ha specificato una sorgente di storage (`?storageId=`) non dichiarata dal progetto. La richiesta di un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** — è lo store a mancare, e `details` elenca i bucket e le sorgenti esistenti. In precedenza entrambi venivano restituiti come "file not found", rendendoli indistinguibili da una chiave semplicemente assente. | Dichiara la sorgente in `config/resources.ts`, oppure controlla `GET /api/storage/sources`. |

## Custom function

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con quel nome è attiva — oppure è presente, ma le sue route non coprono il percorso successivo. A un chiamante autenticato viene anche indicato cosa *è* disponibile; a uno anonimo no, poiché tale elenco costituisce l'inventario di ogni endpoint personalizzato. Nel caso in cui il caricamento di un file con quel nome sia fallito, il messaggio lo segnala: questa è la differenza tra un errore di battitura e un deployment non funzionante. | Verifica il nome tramite `GET /api/functions`, oppure controlla il log di avvio per individuare il file non caricato. |
| `FUNCTION_TIMEOUT` | 504 | L'handler ha superato il tempo limite di esecuzione (timeout). È ancora in esecuzione; non può essere interrotto da qui. | Assegna un `AbortSignal` alle chiamate in uscita o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo funge da proxy verso un'altra istanza per le function, ma quest'ultima non ha risposto. | Verifica che il servizio delle function sia in esecuzione. |

## Interfacce di amministrazione e modifica dello schema

Questi codici indicano che una funzionalità è disattivata o non configurata, e non che la
richiesta fosse errata. Ognuno di essi viene riportato anche sulla corrispondente route `/status` con stato `200`,
consentendo a un pannello di disabilitare visivamente la funzione invece di mostrare un errore.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata chiamata un'interfaccia riservata agli admin su un server privo di autenticazione configurata, quindi il sistema non può distinguere un amministratore da un utente anonimo. | Imposta `auth.jwtSecret` o passa un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto del progetto viene fornito solo quando l'autenticazione è configurata — descrive ogni tabella e relazione. | Configura l'autenticazione. `/meta/schema-version` è sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna casella di posta per lo sviluppo attiva. Le email vengono intercettate solo quando `SMTP_HOST` non è impostato e `NODE_ENV` non è in produzione. | Rimuovi l'impostazione di `SMTP_HOST` in sviluppo, oppure controlla la casella reale. |
| `INVALID_CHANGE` | 400 | La modifica proposta allo schema non è corretta. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione di una modifica programmata dello schema è fallita per un motivo non coperto da codici più specifici. | Consulta il messaggio; riporta letteralmente l'errore sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma non può essere applicata allo schema nello stato attuale. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository presenta modifiche non salvate (uncommitted), pertanto non è stato possibile applicare l'aggiornamento in sicurezza. | Esegui il commit o lo stash, quindi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha rifiutato la modifica. | Consulta il messaggio; riporta la motivazione specifica dell'editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra identità automatizzata ha tentato di applicare una modifica allo schema. | Accedi come utente o imposta `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica in tempo reale dello schema richiede `collectionsDir` o `liveSchema.repository`, e questo server è stato avviato senza nessuno dei due. | Configura uno dei due parametri. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione funziona; non è presente alcun repository su cui effettuare il commit della modifica. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non supporta la pianificazione delle modifiche allo schema. | La modifica in tempo reale è disponibile su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | In questo ambiente le collection vengono ricavate tramite introspezione dal database, pertanto non ci sono file sorgente da modificare. | Modifica lo schema tramite una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disattivato per questo server. | Abilitalo con `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema richiede `ts-morph`, che non risulta installato. | Esegui `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non ha definito `collectionsDir`, quindi l'editor non ha una destinazione su cui scrivere. | Imposta `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato quando `NODE_ENV=production`: i file di un server distribuito vengono ricompilati dal repository a ogni deploy, quindi una modifica locale verrebbe sovrascritta. | Modifica le collection in ambiente di sviluppo e procedi con il deploy. |

## Codici generici

Una route ricorre a uno di questi codici quando non ne esiste uno più specifico applicabile.

| Code | Status | Significato | Azione |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Richiesta malformata, e nessun codice più specifico risulta applicabile. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato, o credenziale rifiutata. | Effettua l'accesso o aggiorna il token. |
| `FORBIDDEN` | 403 | Autenticato, ma non autorizzato. | Riprovare con la stessa identità non risolverà il problema. |
| `CONFLICT` | 409 | Conflitto con lo stato attuale delle risorse. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Si è verificato un errore sul server. Il messaggio è volutamente generico. | Riporta il `requestId`; la motivazione è presente nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza richiesta da questa route non è configurata su questo server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Una dipendenza non è raggiungibile. | Riprova; controlla i log. |

## Mantenere aggiornata questa pagina

Il comando `pnpm verify:docs` fallisce se un codice che il server può restituire non compare in queste
tabelle, se una tabella include un codice che nessun modulo può generare, se uno status indicato
è in disaccordo con il codice sorgente o se una famiglia di codici come `PG_<SQLSTATE>` non copre
un valore SQLSTATE in cui i chiamanti possono incorrere. Il controllo viene eseguito dallo script
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Lo script verifica prima se stesso. L'analisi legge i codici direttamente da TypeScript anziché da un
server in esecuzione, quindi le sue zone d'ombra sono silenziose per natura: in passato non è stato
in grado di rilevare un codice passato tramite un wrapper monoriga o uno inserito dopo un messaggio
contenente una `)`, segnalando "tutti i codici che il server può restituire sono documentati"
su una pagina a cui ne mancavano diciassette. Per questo motivo, la verifica esegue una fixture basata
esattamente su queste casistiche prima di analizzare la pagina, rifiutandosi di proseguire se
non riesce a rilevarle.

---
