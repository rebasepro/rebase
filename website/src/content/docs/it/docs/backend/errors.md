---
sourceHash: 98630809329b42c5
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
quando è un UUID v4 valido, altrimenti ne viene generato uno nuovo. Viene restituito
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
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `API_KEY_FORBIDDEN` | 403 | È stata utilizzata una chiave API su una route riservata alle persone. | Utilizza una sessione utente. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di creare, elencare o revocare chiavi API. | Gestisci le chiavi come amministratore autenticato. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione di Rebase a monte, quindi la credenziale del chiamante non è mai stata esaminata. | Esegui il mount dell'app tramite il router delle funzioni anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Prima effettua l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è riservato esclusivamente al primo utente in assoluto, e questo non lo è. | Chiedi a un amministratore esistente di assegnare il ruolo. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi una nuova verifica CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato alcuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati inseriti per una singola verifica MFA. | Avvia una nuova verifica. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con quell'indirizzo. | Accedi o avvia il recupero della password. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP e il server non dispone di un mail transport. | Configura SMTP o utilizza un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | L'account esiste ma il relativo indirizzo non è verificato. | Verifica l'indirizzo. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma non è mai stato confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Quell'identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollecala prima da quell'account. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può agire. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La verifica MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 401 | Il codice OTP o MFA non è corretto. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — deliberatamente senza specificare quale delle due. | Riprova, o reimposta la password. |
| `INVALID_TOKEN` | 400 | Un token di verifica, reimpostazione o magic link è malformato o sconosciuto. | Richiedi un nuovo link. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto senza alcun amministratore. | Promuovi prima qualcun altro. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` contiene un token temporaneo limitato alla verifica MFA — non è una sessione. | Apri una verifica e rispondi; la risposta alla verifica rilascia la sessione. |
| `NO_SESSION` | 401 | Non è stato fornito alcun cookie di sessione o refresh token. Normale al primo caricamento della pagina. | Accedi. |
| `NOT_ANONYMOUS` | 400 | Una route di passaggio da account anonimo è stata chiamata da un account reale. | Nulla da aggiornare. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o ha restituito un errore. | Riprova il flusso; il messaggio riporta la motivazione del provider. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Rallenta le richieste; il messaggio indica per quanto tempo attendere. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione del reindirizzamento non è presente nella lista dei consentiti (allow-list). | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | L'auto-registrazione è disabilitata. | Chiedi a un amministratore di creare l'account. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli per una richiesta riservata agli amministratori. Si blocca per sicurezza (fail-closed) anziché fidarsi del claim contenuto nel token. | Riprova; controlla il database. |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fai eseguire l'operazione a un altro amministratore. |
| `SESSION_REVOKED` | 401 | È stato eseguito il logout dalla sessione altrove, oppure tutte le sessioni sono state revocate. | Accedi nuovamente. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, quindi questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | È stato riutilizzato un token monouso. | Richiedine uno nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account trovato con questo id. | Controlla l'id. |
| `WEAK_PASSWORD` | 400 | La password non rispetta i criteri di sicurezza configurati. | Scegline una più robusta. |

## Dati, query e scritture

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non è in grado di calcolare l'aggregazione richiesta. | Usa un driver che la supporti, o calcolala nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), in cui un branch *coincide* con il genitore e nulla verrebbe isolato. Il rifiuto è lo stesso mostrato da `rebase db branch`. | Punta `DATABASE_URL` verso un'istanza Postgres dedicata (`rebase dev --docker` ne avvia una) ed esegui lì il branch. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni del limite consentito per batch (1000 per impostazione predefinita). Un batch costituisce una singola transazione e mantiene i lock per l'intera durata. | Invialo a blocchi; il messaggio indica il limite e il numero di operazioni inviate. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non può eseguire scritture tra più collection in modo atomico, e un ciclo di scritture singole non sarebbe né atomico né un singolo round trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per ciascuna collection. |
| `BULK_TOO_LARGE` | 400 | Il corpo della richiesta bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o questo driver non supporta scritture in blocco (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 | Un callback di collection ha rifiutato la scrittura. Un'istruzione `throw` proveniente da `beforeSave`/`beforeDelete`/`after*` produce un 400 contenente il messaggio personalizzato dell'autore; un `beforeDelete` che restituisce `false` produce un 403. `details.stage` specifica quale callback, `details.path` la collection. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore stabilisce già l'inizio della pagina, quindi applicarvi un offset salta silenziosamente quel numero di righe oltre il cursore — un divario invisibile al chiamante nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una query di ricerca o vettoriale. Entrambe assegnano un punteggio a ciascuna riga, quindi due righe non risulteranno mai identiche e `DISTINCT` non raggrupperebbe nulla — sembrerebbe funzionare ma non modificherebbe nulla. | Rimuovi uno dei due parametri. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura con `distinct` è ordinata in base a una colonna che non restituisce. Una query `SELECT DISTINCT` può essere ordinata solo in base alle colonne presenti nel proprio elenco select, altrimenti le righe raggruppate non avrebbero un ordine definito. `details.fields` ne specifica i nomi. | Aggiungi tali campi a `?fields=`, oppure rimuovili da `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): una policy di row-level security che nega l'accesso a questo ruolo o un comando `GRANT` mancante. | Consulta [Risoluzione dei problemi](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, la `select` di un aggregato o `groupBy` specifica un campo che i ruoli di questo chiamante non possono leggere (`access.read`). Un campo che nessuna risposta può contenere non deve poter essere interrogato da alcuna query, altrimenti il valore sarebbe ricavabile un predicato alla volta. `details.violations` elenca ciascun campo. | Rimuovi il campo dalla query, oppure acquisisci il ruolo necessario. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il corpo imposta un campo che i ruoli di questo chiamante non possono scrivere (`access.write`). Viene rifiutato anziché ignorato: una scrittura che tralasciasse un campo segnalerebbe un successo per una modifica mai avvenuta. `details.violations` elenca ciascun campo. | Rimuovi il campo, oppure acquisisci il ruolo necessario. Un campo che nessuno può scrivere restituisce invece `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova al termine dell'operazione. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è arrivata con un corpo differente. | Usa una nuova chiave, oppure invia il corpo originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` ha indicato una funzione diversa da `count`, `sum`, `avg`, `min` o `max`. | Usane una tra queste; il messaggio ne riporta l'elenco. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce di `?select=` non rispetta il formato `fn(field)`, oppure a una funzione diversa da `count()` non è stato associato alcun campo. | Utilizza la sintassi `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Un'operazione in `/_batch` è priva di `op`, `collection`, `values` o `id`, specifica una collection non gestita da questo backend, oppure riutilizza un nome `ref`. | Consulta il messaggio; indica l'operazione in base all'indice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` non fa riferimento ad alcuna operazione precedente, punta in avanti o richiede un campo non presente nella riga referenziata. Si possono risolvere solo riferimenti all'indietro. | Definisci l'operazione con `ref` *prima* di referenziarla. |
| `INVALID_BULK_BODY` | 400 | Il corpo della richiesta bulk non presenta il formato atteso. | Invia l'array `items` documentato. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert indica colonne senza garanzia di unicità, oppure le specifica senza `upsert: true`. In caso contrario, Postgres restituirebbe l'errore 42P10 dall'interno di una transazione che ha già svolto del lavoro. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target effettivamente disponibili. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Viene rifiutato anziché ignorato: un errore di battitura come `?deleted=true` che nascondesse silenziosamente tutte le righe eliminate sembrerebbe aver funzionato, rispondendo in realtà alla domanda opposta. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è `true` o `false`. | Invia uno di questi valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | È stato utilizzato un operatore `$inc` / `$push` / `$pull` / `$merge` su un tipo di proprietà non compatibile, con un operando dal formato non corretto, con due operatori sullo stesso campo, digitato in modo errato, o in un'operazione di creazione — dove non esiste un valore salvato su cui operare. | Consulta [Scrittura via REST](/docs/backend/writes/#field-operations); il messaggio indica il campo interessato. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro indica una proprietà non presente in questa collection. | Verifica la correttezza del nome rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di proprietà. | Consulta [Interrogare i dati](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Il valore di un filtro non può essere interpretato come il tipo della colonna a cui è confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non presente nell'enum, un timestamp non valido, un numero che supera l'intervallo consentito dal tipo. `details.dbCode` riporta il codice SQLSTATE. | Invia un valore corrispondente al tipo della colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che applica un soft-delete quando il chiamante aveva richiesto una rimozione permanente indurrebbe a credere che i dati siano stati eliminati definitivamente. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non è un elenco di percorsi valido, oppure supera il livello massimo di annidamento consentito. L'errore viene intercettato al limite della richiesta anziché propagarsi dal driver come errore 500. | Consulta il messaggio; indica il percorso non valido. |
| `INVALID_INPUT` | 400 | Il corpo della richiesta non ha superato la convalida. | Consulta il messaggio. |
| `INVALID_LIMIT` | — | Una sottoscrizione realtime ha richiesto un limite al di fuori dell'intervallo consentito. Restituito come frame `ERROR` di WebSocket, non come risposta HTTP. | Riduci il limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` è malformato o supera il livello di annidamento consentito. | Consulta il messaggio; mostra la regola di appiattimento. |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un numero intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non è `field`, `field:desc` o un array JSON di `{ field, direction }`. | Consulta il messaggio; mostra tutte e tre le sintassi valide. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. La numerazione delle pagine parte da 1, quindi `?page=0` è considerato un errore e non la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro di query è malformato. | Consulta il messaggio. |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non è `cosine`, `l2` o `inner_product`. | Utilizza uno di questi tre valori. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che mappa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata chiamata senza `?select=`. | Aggiungine uno, ad es. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Il progetto non gestisce alcuna collection: nessuna dichiarata nel codice e nessuna tabella da cui ricavarle. | Crea delle tabelle — tramite migrazione, SQL o un file collection seguito da `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con questo id in questa collection — oppure una riga nascosta a questo chiamante dalla row-level security. | Controlla l'id, poi le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` indica un elemento che non costituisce una relazione nella collection. Lo stesso codice risponde con **404** quando è invece un *percorso URL* annidato a indicarne una inesistente, ad esempio `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuna — in quel caso l'URL non fa riferimento a nulla, quindi si tratta di una risorsa non trovata anziché di una richiesta malformata. | Controlla il nome della relazione — il messaggio elenca quelle presenti nella collection. Un riferimento inverso deve essere dichiarato sul genitore per essere esplorabile. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento fa riferimento a una proprietà non ordinabile. | Ordina in base a una proprietà supportata da colonna. |
| `PAYLOAD_TOO_LARGE` | 413 | Il corpo della richiesta supera il limite configurato. | Invia meno dati, oppure aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` ha tentato di eseguire una scrittura. Una lettura con ambito richiesta viene eseguita all'interno di una transazione `READ ONLY`, pertanto né il callback né le funzioni da esso chiamate possono eseguire scritture. | Sposta la scrittura all'esterno dell'operazione di lettura: usa un background job, oppure `rebase.dataAsAdmin` da un cron job o da una custom function. |
| `RELATION_HAS_NO_PIVOT` | 400 | La scrittura includeva un payload di collegamento, ma il percorso non raggiunge la destinazione tramite una relazione `manyToMany` che dichiara `through.properties` — di conseguenza non è presente alcuna riga di giunzione su cui inserirlo. | Dichiara `through.properties` nella relazione, oppure rimuovi il payload dalla scrittura. Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non corrisponde allo schema registrato. L'operazione viene rifiutata anziché ignorata: tralasciarla riporterebbe il successo di una scrittura mai avvenuta, oppure l'assenza di righe in realtà esistenti. | Esegui `rebase schema generate` se lo schema generato è meno recente del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura dal lato proprietario della relazione. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile. | Consulta [Relazioni](/docs/collections/relations/). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relazione dichiara colonne di giunzione, ma questa sorgente dati non supporta la loro scrittura. | Il collegamento in sé funziona comunque; solo il payload associato non è supportato. Verifica le capacità del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura di relazione non disponeva della chiave di origine a cui agganciare il collegamento. | Salva prima la riga genitore. |
| `SCHEMA_DRIFT` | 500 | Una tabella o una colonna prevista dal codice non esiste nel database. | Esegui `rebase db push` in ambiente di sviluppo; riesegui il deploy su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per ogni query anziché memorizzata, quindi non può fungere da chiave per un cursore. | Esegui la paginazione della rilevanza con `limit`/`offset`, oppure ordina in base a una colonna. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura sposterebbe una riga da un tenant a un altro. Una riga non può cambiare tenant. `details.violations` indica il campo. | Crea la riga nell'altro tenant ed elimina questa, oppure esegui la scrittura con un ruolo presente in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura specifica un tenant a cui questo chiamante non appartiene; anche il database la rifiuterebbe. | Scrivi in un tenant di cui il chiamante fa parte, oppure autenticati con un'identità che vi appartenga. |
| `TENANT_REQUIRED` | 400 | La collection è limitata a un tenant (tenant-scoped) e il tenant non può essere dedotto: la richiesta non ne specifica alcuno, oppure il chiamante appartiene a più tenant. | Invia il campo tenant in modo esplicito, oppure autenticati come chiamante appartenente a un solo tenant. |
| `UNKNOWN_FIELD` | 400 | `?fields=` specifica un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un aggregato o `groupBy` specifica un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo non presente in questa collection — o nella destinazione di una relazione. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro specifica un operatore inesistente. | Il messaggio elenca tutti gli operatori disponibili. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento specifica un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un header `If-Match` ha specificato una versione della riga non più attuale: qualcuno vi ha scritto tra la lettura e questa scrittura. Non è stato modificato nulla. | Rileggi la riga, riapplica la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo non presente nella collection. | Verifica la correttezza del nome; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è di tipo `vector` in questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il `Content-Type` non rientra tra quelli accettati da questa route. | Invia il tipo indicato nella documentazione della route. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è configurato in una sola direzione, quindi non vi è alcun elemento con cui correlare una sottoquery all'indietro. | Filtra dal lato proprietario della relazione. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è definito per quel campo: una relazione senza una colonna su questa riga viene filtrata per appartenenza, e la corrispondenza case-insensitive si applica solo al testo. | Consulta il messaggio; elenca i valori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore ha violato una regola di `validation` definita dalla proprietà — una lunghezza, un intervallo, un pattern, un campo obbligatorio. | Consulta il messaggio; indica ciascuna violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il corpo scrive su una colonna contrassegnata con `excludeFromApi` o `access: { write: [] }` — la stessa regola, con due sintassi diverse. Questi campi sono riservati all'impostazione da parte del server: l'hash di una password, un token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è identica per qualsiasi chiamante, `admin` compreso. | Rimuovi il campo. Consulta [Accesso ai campi](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non corrisponde al tipo della proprietà. | Consulta il messaggio; indica la proprietà interessata. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il corpo specifica un campo non presente nella collection — compreso un argomento `id` su una collection la cui chiave è basata su un altro campo. | Verifica la correttezza del nome; il messaggio elenca i campi noti. |
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
| `PG_23503` | 400 | Una foreign key fa riferimento a una riga inesistente. | Crea prima la riga di destinazione, oppure correggi l'id. |
| `PG_23505` | 409 | È stato violato un vincolo di unicità. Il messaggio indica il vincolo violato. | Usa un valore diverso, oppure aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Controlla il nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata o esce dal prefisso consentito. | Controlla la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri di trasformazione dell'immagine sono fuori scala o contraddittori. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | L'upload supera la dimensione `maxSize` dichiarata dalla proprietà di destinazione. Applicato sul server, non solo nel browser. `details` indica la proprietà, il limite e la dimensione effettiva. | Carica un file più piccolo, o aumenta `maxSize` sulla proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo di file caricato non è presente tra i tipi ammessi (`acceptedFiles`) della proprietà. `details` include la proprietà, l'elenco consentito e il content type inviato. | Carica un tipo di file consentito, oppure amplia `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Nessun backend di storage è configurato su questo server. | Configura S3, GCS o lo storage locale. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La sorgente di storage è dichiarata ma non dispone di credenziali su questa istanza. | Imposta le variabili d'ambiente per quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto la scrittura. | Controlla i relativi log e le credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini simultanee in esecuzione. | Riprova; valuta l'uso di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La richiesta indica una sorgente di storage (`?storageId=`) non dichiarata da questo progetto. Un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** — ciò che manca è lo store, e `details` elenca i bucket e le sorgenti esistenti. In precedenza entrambi venivano segnalati come "file non trovato", indistinguibili da una chiave semplicemente inesistente. | Dichiara la sorgente in `config/resources.ts`, o controlla `GET /api/storage/sources`. |

## Custom function

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con questo nome è disponibile — o se lo è, le sue route non coprono il percorso successivo. A un chiamante autenticato viene anche indicato cosa *è* disponibile; a uno anonimo no, poiché tale elenco costituirebbe un inventario di tutti gli endpoint personalizzati. Se un file con quel nome non è stato caricato, il messaggio lo specifica: questa è la differenza tra un errore di digitazione e un deploy non riuscito. | Confronta il nome con `GET /api/functions`, o controlla il log di avvio per individuare il file non caricato. |
| `FUNCTION_TIMEOUT` | 504 | L'handler ha superato il timeout previsto. L'esecuzione è ancora in corso; non può essere interrotta da qui. | Assegna un `AbortSignal` alle chiamate in uscita, oppure aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo fa da proxy per le funzioni verso un altro processo, che non ha risposto. | Verifica che l'unità delle funzioni sia in esecuzione. |

## Superfici di amministrazione e modifica dello schema

Questi codici indicano che una funzionalità è disattivata o non configurata, piuttosto
che la richiesta fosse errata. Ciascuno di essi viene segnalato anche sulla route `/status`
corrispondente con stato `200`, consentendo a un pannello di disabilitare visivamente
la funzione (in grigio) anziché mostrare un errore.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata chiamata una superficie riservata agli amministratori su un server senza autenticazione configurata, quindi non è possibile distinguere un amministratore da un utente anonimo. | Imposta `auth.jwtSecret`, oppure passa un `AuthAdapter`. |
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
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non è in grado di pianificare modifiche allo schema. | La modifica dal vivo è disponibile su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | In questo ambiente le collection vengono ricavate per introspezione dal database, quindi non sono presenti file sorgente da modificare. | Modifica lo schema tramite una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor di schema è disabilitato per questo server. | Abilitalo tramite `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor di schema necessita di `ts-morph`, che non è installato. | Esegui `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non dispone di una `collectionsDir`, quindi l'editor non ha una destinazione in cui scrivere. | Imposta `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato quando `NODE_ENV=production`: i file di un server distribuito vengono ricompilati dal repository a ogni deploy, quindi una modifica qui andrebbe persa. | Modifica le collection in sviluppo ed effettua il deploy. |

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
| `SERVICE_UNAVAILABLE` | 503 | Una dipendenza non era raggiungibile. | Riprova; controlla i log. |

## Mantenere aggiornata questa pagina

`pnpm verify:docs` fallisce quando un codice che il server può generare è assente da queste
tabelle, quando una tabella elenca un codice che nulla può generare, quando uno stato dichiarato
discorda dal codice sorgente o quando una famiglia di codici come `PG_<SQLSTATE>` non ha una riga
per un codice SQLSTATE che i chiamanti possono incontrare. Lo stage di verifica è
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Esegue prima un controllo su se stesso. La scansione estrae i codici direttamente dal codice
TypeScript anziché da un server in esecuzione, quindi i suoi punti ciechi sono per costruzione
silenziosi: in passato non era in grado di rilevare un codice passato attraverso un wrapper a
riga singola, o uno scritto dopo un messaggio contenente una `)`, e segnalava che "ogni codice
generabile dal server è documentato" su una pagina a cui ne mancavano diciassette. Per questo
motivo, lo stage esegue una fixture esattamente con queste casistiche prima di leggere questa
pagina, e si rifiuta di segnalare qualsiasi esito se non riesce a individuarle.

---
