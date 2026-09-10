---
sourceHash: b82ed0c23d6537de
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il relativo stato HTTP, il significato e le azioni da intraprendere — oltre all'envelope di risposta, X-Request-ID e le regole per details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e include un `code` stabile. Il codice è l'elemento su cui basare le diramazioni: il messaggio è scritto per un essere umano e potrebbe essere riformulato, lo stato è condiviso da decine di problemi diversi, mentre il codice non è nessuna di queste due cose.

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

- **`message`** — leggibile dall'uomo. Per un `4xx` è il messaggio specifico del server; per un `5xx` è volutamente generico, poiché il testo sottostante potrebbe menzionare un host, un ruolo o il nome di una colonna.
- **`code`** — uno dei valori riportati di seguito. Stabile tra versioni minori.
- **`details`** — opzionale e mai garantito. Vedi le regole riportate di seguito.
- **`requestId`** — presente ogni volta che la richiesta passa attraverso il middleware del request-ID, ovvero per ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante se è un UUID v4 valido, altrimenti ne viene generato uno nuovo. Viene restituito nella risposta come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e associato alla riga di log del server per quella richiesta.

Questa è la chiave di correlazione (join key). Includila in una segnalazione di bug e un operatore potrà individuare l'esatta riga di log che spiega il fallimento, contenente il motivo che non è mai stato mostrato al client.

Inviare il proprio ID è il modo in cui una traccia sopravvive a un hop: un gateway o un job runner che inoltra l'header ottiene un unico ID attraverso tutti i servizi che hanno gestito la richiesta. Un valore non valido viene ignorato anziché rifiutato — non vale la pena far fallire una richiesta per un header malformato da parte del chiamante — quindi non dare per scontato che l'ID inviato sia quello ricevuto. Leggi l'header della risposta.

### Cosa contiene `details`

`details` ha uno scopo diagnostico, non contrattuale. È regolato da tre principi:

1. **Tutto ciò che una route imposta esplicitamente viene sempre restituito.** Si tratta degli errori commessi dal chiamante descritti con precisione: quale campo di filtro era sconosciuto, quale relazione non è scrivibile, quale valore non corrispondeva al tipo previsto.
2. **Le informazioni diagnostiche del database vengono rimosse in produzione.** Quando l'errore proviene da Postgres, `details.dbCode` — il codice SQLSTATE — è sempre presente: identifica la classe del problema senza rivelare nulla sui dati. `dbMessage`, `detail` e `hint` vengono aggiunti solo quando `NODE_ENV` non è `production`, poiché Postgres include in essi il contenuto delle righe. `23505` segnala `Key (email)=(a@b.c) already exists.`, rispondendo così alla domanda "questa persona è registrata?" per qualsiasi indirizzo si provi a verificare.
3. **Non basare mai le diramazioni su `details`.** Basale su `code`. Il contenuto di `details` è semplicemente ciò che risultava utile a una persona in quello specifico punto di chiamata ed è soggetto a modifiche.

## Interpretare uno status

| Status | Cosa indica sulla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticato, o credenziale scaduta. Esegui l'accesso o aggiorna il token. |
| `403` | Autenticato, ma non autorizzato. Riprovare con la stessa identità non servirà. |
| `404` | Route, collection o riga inesistente — oppure una riga nascosta dalla row-level security. |
| `409` | Conflitto con lo stato esistente: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il body è troppo grande, il media type è errato o la richiesta è stata rifiutata a livello semantico. |
| `429` | Rate limit raggiunto. Rallenta le richieste; il messaggio indica per quanto tempo. |
| `500` | Errore del server o del database, non del chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può gestirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza non era raggiungibile, non era configurata o era troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa il challenge MFA, poi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nulla — lo stato desiderato è già valido. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `API_KEY_FORBIDDEN` | 403 | È stata utilizzata una chiave API su una route accessibile solo da persone. | Usa una sessione utente. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di creare, elencare o revocare chiavi API. | Gestisci le chiavi come amministratore autenticato. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione di Rebase a monte, quindi la credenziale del chiamante non è mai stata esaminata. | Esegui il mount dell'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Effettua prima l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è riservato esclusivamente al primissimo utente, e non è questo. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi una nuova sfida CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati per una singola verifica MFA. | Avvia una nuova verifica. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con questo indirizzo. | Accedi, o avvia la procedura di reimpostazione della password. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP ma il server non ha un trasporto email configurato. | Configura SMTP, o usa un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | L'account esiste e il relativo indirizzo non è verificato. | Verifica l'indirizzo. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma mai confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Questa identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollecala prima da quell'account. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato incompatibile con questa operazione. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La verifica MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 401 | Il codice OTP o MFA è errato. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — senza specificare quale di proposito. | Riprova, o reimposta la password. |
| `INVALID_TOKEN` | 400 | Il token di verifica, reimpostazione o magic link è malformato o sconosciuto. | Richiedi un nuovo link. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto senza alcun amministratore. | Promuovi prima qualcun altro. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account dispone di un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` contiene un token di breve durata limitato alla richiesta MFA — non è una sessione. | Apri una verifica e rispondi; la risposta alla verifica emetterà la sessione. |
| `NO_SESSION` | 401 | Non è stato presentato alcun cookie di sessione o refresh token. Normale al primo caricamento della pagina. | Accedi. |
| `NOT_ANONYMOUS` | 400 | Una route di upgrade da utente anonimo è stata chiamata da un account reale. | Nulla da aggiornare. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o ha restituito un errore. | Riprova il flusso; il messaggio riporta il motivo fornito dal provider. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta le richieste; il messaggio specifica per quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione di reindirizzamento non è presente nella allow-list. | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | La registrazione autonoma è disabilitata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli per una richiesta riservata agli amministratori. Si chiude per sicurezza (fail-closed) anziché fidarsi del claim del token. | Riprova; controlla il database. |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | La sessione è stata terminata altrove, oppure tutte le sessioni sono state revocate. | Accedi di nuovo. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, pertanto questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | È stato riutilizzato un token monouso. | Richiedine uno nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con questo id. | Controlla l'id. |
| `WEAK_PASSWORD` | 400 | La password non soddisfa la policy configurata. | Scegline una più robusta. |

## Dati, query e scritture

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non può calcolare l'aggregazione richiesta. | Usa un driver compatibile o calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), dove un branch *è* il parent e nulla verrebbe isolato. Il rifiuto è lo stesso restituito da `rebase db branch`. | Punta `DATABASE_URL` verso un'istanza Postgres dedicata (`rebase dev --docker` ne avvia una) ed esegui il branch lì. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni rispetto al limite consentito per batch (1000 per impostazione predefinita). Un batch costituisce una singola transazione e mantiene i lock per l'intera durata. | Invia i dati suddivisi in blocchi; il messaggio indica il limite e il conteggio inviato. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non può eseguire scritture atomiche su più collection, e un ciclo di scritture singole non sarebbe né atomico né limitato a un unico round trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per ciascuna collection. |
| `BULK_TOO_LARGE` | 400 | Il body bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o questo driver non supporta le scritture in blocco (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 | Un callback della collection ha rifiutato la scrittura. Un'istruzione `throw` da `beforeSave`/`beforeDelete`/`after*` produce un 400 contenente il messaggio definito dall'autore; un `beforeDelete` che restituisce `false` produce un 403. `details.stage` indica quale callback, `details.path` la collection. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore definisce già il punto di inizio della pagina, quindi un offset applicato sopra di esso salterebbe silenziosamente quel numero di righe oltre il cursore — un divario non visibile dal chiamante nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una query di ricerca o vettoriale. Entrambe associano un punteggio per riga, quindi non esistono due righe identiche e `DISTINCT` non raggrupperebbe nulla — sembrerebbe aver funzionato senza cambiare alcunché. | Rimuovi uno dei due parametri. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura con `distinct` è ordinata in base a una colonna che non viene restituita. Un `SELECT DISTINCT` può essere ordinato solo in base alle colonne presenti nel suo elenco select, altrimenti le righe compattate non hanno un ordine definito. `details.fields` ne riporta i nomi. | Aggiungi questi campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): una policy di row-level security che rifiuta questo ruolo oppure un `GRANT` mancante. | Consulta la sezione [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, un'aggregazione `select` o `groupBy` fa riferimento a un campo che i ruoli di questo chiamante non possono leggere (`access.read`). Un campo che nessuna risposta può includere deve essere un campo che nessuna query può interrogare, altrimenti il valore sarebbe deducibile un predicato alla volta. `details.violations` indica ciascun campo. | Rimuovi il campo dalla query oppure ottieni il ruolo necessario. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il body imposta un campo che i ruoli di questo chiamante non possono scrivere (`access.write`). Viene rifiutato anziché ignorato: una scrittura che scarta un campo segnalerebbe il successo di una modifica mai avvenuta. `details.violations` elenca ciascun campo. | Rimuovi il campo oppure ottieni il ruolo. Un campo che nessuno può scrivere restituisce invece `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine dell'operazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata inviata con un body differente. | Usa una nuova chiave oppure invia il body originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indica una funzione diversa da `count`, `sum`, `avg`, `min` o `max`. | Usa una di queste funzioni; il messaggio le elenca. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce di `?select=` non è nel formato `fn(field)`, oppure a una funzione diversa da `count()` non è stato assegnato alcun campo. | Scrivi `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Un'operazione `/_batch` non contiene `op`, `collection`, `values` o `id`, specifica una collection non gestita da questo backend oppure riutilizza un nome `ref`. | Consulta il messaggio; indica l'operazione in base all'indice. |
| `INVALID_BATCH_REF` | 400 | Un elemento `{ "$ref": "<name>.<field>" }` non fa riferimento ad alcuna operazione precedente, punta in avanti oppure richiede un campo non presente nella riga referenziata. Possono essere risolti solo i riferimenti all'indietro. | Definisci l'operazione con `ref` *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | La struttura del body bulk non è nel formato previsto. | Invia l'array `items` documentato. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert indica colonne prive di vincolo di univocità, oppure le indica senza `upsert: true`. In caso contrario, Postgres restituirebbe 42P10 dall'interno di una transazione che ha già eseguito operazioni. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target esistenti. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Rifiutato anziché ignorato: un errore di battitura come `?deleted=true` che nascondesse silenziosamente ogni riga eliminata sembrerebbe funzionare rispondendo però alla domanda opposta. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per recuperare solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è `true` né `false`. | Invia uno di questi valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | È stato usato un operatore `$inc` / `$push` / `$pull` / `$merge` su un tipo di proprietà per cui non è definito, con un operando di formato errato, con due operatori sullo stesso campo, con un errore di battitura oppure durante un'operazione di creazione — in cui non esiste alcun valore memorizzato su cui operare. | Consulta [Writing over REST](/docs/backend/writes/#field-operations); il messaggio indica il campo. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro specifica una proprietà non presente in questa collection. | Verifica l'ortografia rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di proprietà. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Impossibile interpretare il valore del filtro come il tipo della colonna con cui è confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non presente nell'enum, un timestamp non valido, un numero fuori dall'intervallo del tipo. `details.dbCode` riporta il codice SQLSTATE. | Invia un valore corrispondente al tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è `true` né `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che esegue un soft-delete quando il chiamante chiedeva un'eliminazione definitiva farebbe credere che i dati siano stati rimossi. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non è un elenco di percorsi valido, o è nidificato oltre la profondità massima. Risolto al perimetro dell'applicazione prima di generare un 500 dal driver. | Consulta il messaggio; indica il percorso non valido. |
| `INVALID_INPUT` | 400 | La convalida del body è fallita. | Consulta il messaggio. |
| `INVALID_LIMIT` | — | Una sottoscrizione realtime ha richiesto un limite al di fuori dell'intervallo consentito. Notificato come frame `ERROR` WebSocket, non come risposta HTTP. | Riduci il limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` è malformato o nidificato oltre la profondità consentita. | Consulta il messaggio; mostra la regola di appiattimento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non è `field`, `field:desc`, né un array JSON di `{ field, direction }`. | Consulta il messaggio; mostra tutte e tre le sintassi valide. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine sono basate su indice 1, quindi `?page=0` è un errore anziché la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro di query è malformato. | Consulta il messaggio. |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non è `cosine`, `l2` né `inner_product`. | Usa uno di questi tre valori. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che mappa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata chiamata senza `?select=`. | Aggiungine uno, ad es. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Il progetto non gestisce alcuna collection: nessuna dichiarata nel codice e nessuna tabella da cui derivarla. | Crea delle tabelle — tramite migrazione, SQL o un file di collection insieme a `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con tale id in quella collection — oppure una riga nascosta a questo chiamante dalla row-level security. | Verifica l'id, poi le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` indica un elemento che non è una relazione della collection. Lo stesso codice risponde **404** quando è invece un *percorso URL* nidificato a indicarlo, ad es. `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuno — in tal caso l'URL non fa riferimento a nulla, quindi si tratta di una risorsa non trovata anziché di una richiesta malformata. | Controlla il nome della relazione — il messaggio elenca quelle presenti nella collection. Un back-reference deve essere dichiarato sul parent per poter essere attraversato. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento specifica una proprietà non ordinabile. | Ordina in base a una proprietà associata a una colonna. |
| `PAYLOAD_TOO_LARGE` | 413 | Il body supera il limite configurato. | Riduci la dimensione dei dati inviati o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` ha tentato di eseguire una scrittura. Una lettura con ambito di richiesta viene eseguita in una transazione `READ ONLY`, pertanto né il callback né le funzioni da esso invocate possono scrivere. | Sposta la scrittura all'esterno della lettura: usa un job in background o `rebase.dataAsAdmin` da un cron job o da una custom function. |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non corrisponde allo schema registrato. L'operazione viene rifiutata anziché ignorata: scartarla segnalerebbe un successo per una scrittura mai avvenuta, oppure un risultato vuoto per righe realmente esistenti. | Esegui `rebase schema generate` se lo schema generato è meno recente del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura dal lato proprietario (owning side). |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso nidificato non è una relazione scrivibile. | Consulta [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura di relazione non disponeva della chiave sorgente a cui agganciare il collegamento. | Salva prima la riga padre. |
| `SCHEMA_DRIFT` | 500 | Una tabella o una colonna prevista dal codice non esiste nel database. | Esegui `rebase db push` in sviluppo; effettua un nuovo deploy su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per singola query anziché essere persistita, pertanto non può fungere da chiave per un cursore. | Esegui la paginazione della rilevanza con `limit`/`offset`, oppure ordina in base a una colonna. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura sposterebbe una riga da un tenant a un altro. Una riga non può cambiare tenant. `details.violations` indica il campo. | Crea la riga nell'altro tenant ed elimina questa, oppure esegui la scrittura con un ruolo presente in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura indica un tenant a cui questo chiamante non appartiene; anche il database la rifiuterebbe. | Scrivi all'interno di un tenant a cui il chiamante appartiene, oppure autenticati come utente appartenente a esso. |
| `TENANT_REQUIRED` | 400 | La collection ha ambito limitato al tenant e il tenant non può essere dedotto: la richiesta non ne specifica alcuno, oppure il chiamante appartiene a più tenant. | Invia il campo del tenant in modo esplicito, oppure autenticati come chiamante appartenente a uno solo. |
| `UNKNOWN_FIELD` | 400 | `?fields=` specifica un campo non presente nella collection. | Controlla l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o `groupBy` indica un campo non presente nella collection. | Controlla l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo non presente in questa collection o nella destinazione di una relazione. | Controlla l'ortografia; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro specifica un operatore inesistente. | Il messaggio elenca tutti gli operatori validi. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento indica un campo non presente nella collection. | Controlla l'ortografia; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un `If-Match` ha indicato una versione della riga non più aggiornata: qualcuno ha eseguito una scrittura tra la lettura e questa scrittura. Non è stato scritto nulla. | Rileggi la riga, riapplica la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo non presente nella collection. | Controlla l'ortografia; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è un `vector` in questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il `Content-Type` non è tra quelli accettati da questa route. | Invia il tipo indicato nella documentazione della route. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è configurato in una sola direzione, quindi non c'è modo di correlare una sottoquery a ritroso. | Filtra dal lato proprietario (owning side). |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è definito per quel campo: una relazione priva di colonna su questa riga viene filtrata per appartenenza e la corrispondenza case-insensitive si applica solo al testo. | Consulta il messaggio; elenca i valori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore viola una regola di `validation` dichiarata dalla proprietà — lunghezza, intervallo, pattern o campo obbligatorio. | Consulta il messaggio; indica ciascuna violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il body tenta di scrivere una colonna contrassegnata con `excludeFromApi` o `access: { write: [] }` — la stessa regola, con due sintassi diverse. Questi campi sono riservati alla gestione del server: hash delle password, token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è identica per qualsiasi chiamante, `admin` compreso. | Rimuovi il campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non è compatibile con il tipo di proprietà previsto. | Consulta il messaggio; indica la proprietà in questione. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il body specifica un campo non presente nella collection — compreso un argomento `id` su una collection avente una chiave diversa. | Controlla l'ortografia; il messaggio elenca i campi noti. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha rifiutato la scrittura. | Controlla le `securityRules` della collection. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura che Postgres rifiuta a causa dei *dati forniti dal chiamante* restituisce il codice SQLSTATE nel campo code: `PG_23505`, `PG_23503`, e così via. Si tratta di una famiglia di codici, non di un elenco esaustivo — Postgres definisce centinaia di SQLSTATE — ma solo due classi possono arrivare a questo livello, perché solo queste due dipendono dal chiamante:

- **classe 23**, violazione di vincolo di integrità: un duplicato, una chiave esterna che punta a un elemento inesistente, una colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: un valore non supportato dal tipo della colonna.

Tutto il resto — una connessione interrotta, una colonna mancante, un problema di privilegi — riguarda il server e rimane un `500`. Pertanto `code.startsWith("PG_")` è un controllo affidabile per verificare se "la riga inviata conteneva errori", e i quattro codici seguenti sono quelli che un client riscontra effettivamente. `details.dbCode` riporta lo stesso SQLSTATE per tutti questi casi e il messaggio indica il vincolo violato.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Impossibile interpretare un valore come il tipo della colonna — la controparte in scrittura di `INVALID_FILTER_VALUE`. | Invia un valore del tipo corretto per la colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo oppure imposta un valore predefinito per la colonna. |
| `PG_23503` | 400 | Una chiave esterna punta a una riga inesistente. | Crea prima la riga di destinazione oppure correggi l'id. |
| `PG_23505` | 409 | È stato violato un vincolo di univocità (unique constraint). Il messaggio specifica il vincolo. | Usa un valore diverso oppure aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Controlla il nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata o esce dal prefisso consentito. | Controlla la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri di trasformazione dell'immagine sono fuori intervallo o contraddittori. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Il file caricato supera il `maxSize` dichiarato dalla proprietà di destinazione. Applicato sul server, non solo nel browser. `details` riporta la proprietà, il limite e le dimensioni effettive. | Carica un file più piccolo o aumenta il `maxSize` nella proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo del file caricato non è presente nell'elenco `acceptedFiles` della proprietà. `details` include la proprietà, l'elenco dei tipi accettati e il content type inviato. | Carica un tipo consentito o amplia `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Nessun backend di storage è configurato su questo server. | Configura S3, GCS o lo storage locale. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La sorgente di storage è dichiarata ma non dispone delle credenziali in questo ambiente. | Imposta le variabili d'ambiente per quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto la scrittura. | Controlla i relativi log e credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini in corso simultaneamente. | Riprova; valuta l'uso di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La richiesta specifica una sorgente di storage (`?storageId=`) non dichiarata in questo progetto. Un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** — a mancare è lo store stesso, e `details` elenca i bucket e le sorgenti esistenti. In precedenza entrambi venivano restituiti come "file non trovato", indistinguibili da una chiave semplicemente assente. | Dichiara la sorgente in `config/resources.ts`, oppure verifica `GET /api/storage/sources`. |

## Custom function

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con questo nome è disponibile — oppure la funzione esiste, ma le sue route interne non coprono il percorso successivo. A un chiamante autenticato viene anche comunicato cosa *è* disponibile; a uno anonimo no, poiché tale elenco rappresenta un inventario di ogni endpoint personalizzato. Se il caricamento di un file con quel nome è fallito, il messaggio lo segnala: questa è la differenza tra un errore di battitura e un deploy corrotto. | Verifica il nome tramite `GET /api/functions`, oppure controlla il log di avvio per individuare eventuali file non caricati. |
| `FUNCTION_TIMEOUT` | 504 | L'handler ha superato il timeout previsto. È ancora in esecuzione; non può essere interrotto da qui. | Assegna un `AbortSignal` alle chiamate in uscita, oppure aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo fa da proxy per le funzioni verso un altro processo, che non ha risposto. | Verifica che l'unità delle funzioni sia in esecuzione. |

## Interfacce admin e modifica dello schema

Questi codici indicano che una funzionalità è disattivata o non configurata, piuttosto che un errore nella richiesta. Ciascuno di essi viene segnalato anche sulla rispettiva route `/status` con stato `200`, consentendo a un pannello di disabilitare visivamente la funzione invece di mostrare un errore.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata richiamata un'interfaccia riservata agli admin su un server privo di autenticazione configurata, quindi non è possibile distinguere un amministratore da un utente generico. | Imposta `auth.jwtSecret` oppure passa un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contratto del progetto viene fornito solo quando l'autenticazione è configurata — descrive ogni tabella e relazione. | Configura l'autenticazione. `/meta/schema-version` è sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna casella di posta di sviluppo è attiva. Le email vengono intercettate solo quando `SMTP_HOST` non è impostato e `NODE_ENV` non è production. | Rimuovi `SMTP_HOST` in ambiente di sviluppo, oppure controlla la casella di posta reale. |
| `INVALID_CHANGE` | 400 | La modifica dello schema proposta non è ben formata. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione di una modifica programmata dello schema è fallita per un motivo non coperto da codici più specifici. | Consulta il messaggio; riporta letteralmente l'errore sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma non può essere applicata allo schema nello stato attuale. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non salvate (uncommitted), pertanto la modifica non può essere applicata in sicurezza. | Esegui il commit o lo stash, quindi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha rifiutato la modifica. | Consulta il messaggio; riporta la motivazione specifica dell'editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra entità automatizzata ha tentato di applicare una modifica allo schema. | Accedi come utente, oppure imposta `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica dello schema dal vivo richiede `collectionsDir` o `liveSchema.repository`, ma questo server è stato avviato senza nessuno dei due. | Configura uno dei due parametri. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione funziona, ma non è presente alcun repository su cui eseguire il commit della modifica. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non può pianificare modifiche allo schema. | La modifica in tempo reale è disponibile su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Le collection vengono rilevate tramite introspezione del database, quindi non sono presenti file sorgente da modificare. | Modifica lo schema tramite una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disabilitato per questo server. | Abilitalo con `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema richiede `ts-morph`, che non risulta installato. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non ha un `collectionsDir`, quindi l'editor non ha una destinazione in cui scrivere. | Imposta `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato quando `NODE_ENV=production`: i file di un server in produzione vengono ricreati dal repository a ogni deploy, quindi qualsiasi modifica verrebbe persa. | Modifica le collection in ambiente di sviluppo ed esegui il deploy. |

## Codici generici

Una route utilizza uno di questi codici quando non è applicabile nulla di più specifico.

| Codice | Stato | Significato | Azione |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformata, e non è applicabile nulla di più specifico. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato, o credenziale rifiutata. | Accedi o aggiorna il token. |
| `FORBIDDEN` | 403 | Autenticato, ma non autorizzato. | Riprovare con la stessa identità non servirà. |
| `CONFLICT` | 409 | Conflitto con lo stato esistente. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Si è verificato un errore sul server. Il messaggio è volutamente generico. | Riporta il `requestId`; la motivazione è riportata nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza richiesta da questa route non è configurata su questo server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Una dipendenza non era raggiungibile. | Riprova; controlla i log. |

## Mantenere aggiornata questa pagina

`pnpm verify:docs` fallisce quando un codice generabile dal server non è presente in queste tabelle, quando una tabella elenca un codice che nulla può generare, quando uno stato indicato non corrisponde a quello del codice sorgente o quando una famiglia di codici come `PG_<SQLSTATE>` non ha una voce per un codice SQLSTATE che i chiamanti possono riscontrare. Lo stage di controllo è `tooling/scripts/docs-verify/check-error-codes.mjs`.

Esegue prima un controllo su se stesso. La scansione estrae i codici direttamente da TypeScript anziché da un server in esecuzione, quindi i suoi punti ciechi sono intrinsecamente silenziosi: in passato non era in grado di rilevare un codice passato attraverso un wrapper su una singola riga, o uno scritto dopo un messaggio contenente una `)`, e segnalava che "ogni codice generabile dal server è documentato" su una pagina a cui ne mancavano diciassette. Per questo motivo lo stage esegue una fixture esattamente con queste casistiche prima di analizzare questa pagina, e si rifiuta di completare la verifica se non riesce a individuarle.

---
