---
sourceHash: ffb0a0aaabda1c4c
title: Codici di errore
sidebar_label: Codici di errore
description: Tutti i codici di errore che un backend Rebase può restituire, con il rispettivo stato HTTP, il loro significato e come gestirli — oltre al response envelope, a X-Request-ID e alle regole per details.
---

Ogni errore restituito da un backend Rebase utilizza un unico envelope e contiene un
`code` stabile. Il codice è l'elemento su cui fare branching: il messaggio è scritto per
le persone e può essere riformulato, lo stato è condiviso da una dozzina di problemi
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

- **`message`** — leggibile per le persone. Per un `4xx` è il messaggio specifico del server;
  per un `5xx` è deliberatamente generico, poiché il testo sottostante può menzionare un host,
  un ruolo o il nome di una colonna.
- **`code`** — uno dei valori riportati di seguito. Stabile tra versioni minori.
- **`details`** — opzionale e mai garantito. Consulta le regole riportate di seguito.
- **`requestId`** — presente ogni volta che la richiesta passa attraverso il middleware del
  request-ID, ovvero per ogni route sotto `basePath`.

### `X-Request-ID`

Ogni richiesta sotto `basePath` riceve un ID: l'header `X-Request-ID` del chiamante
quando è un UUID v4 valido, altrimenti uno nuovo. Viene restituito nella risposta
come `X-Request-ID`, incluso nell'envelope di errore come `requestId` e allegato
alla riga di log del server per quella richiesta.

Questa è la chiave di join. Indicandola in una segnalazione di bug, un operatore
può trovare l'unica riga di log che spiega il fallimento, contenente il motivo che non
è mai stato mostrato al client.

Inviare il proprio è il modo in cui una traccia sopravvive a un hop: un gateway o un job runner
che inoltra l'header mantiene un unico ID attraverso tutti i servizi che hanno gestito
la richiesta. Un valore non valido viene ignorato anziché rifiutato — non vale la pena far
fallire una richiesta a causa di un header malformato del chiamante — quindi non dare per
scontato che l'ID inviato sia l'ID ricevuto. Leggi l'header della risposta.

### Cosa contiene `details`

`details` ha uno scopo diagnostico, non contrattuale. È regolato da tre regole:

1. **Qualsiasi cosa impostata esplicitamente da una route viene sempre restituita.** Si tratta
   degli errori specifici del chiamante descritti con precisione: quale campo del filtro era sconosciuto,
   quale relazione non è scrivibile, quale valore non corrispondeva al proprio tipo.
2. **La diagnostica del database viene ridotta in produzione.** Quando l'errore proviene
   da Postgres, `details.dbCode` — il valore SQLSTATE — è sempre presente: indica la classe
   del problema e non rivela nulla sui dati. `dbMessage`, `detail` e `hint` vengono aggiunti
   solo quando `NODE_ENV` non è `production`, poiché Postgres include in essi il contenuto
   delle righe. L'errore `23505` riporta `Key (email)=(a@b.c) already exists.`, il che risponde
   alla domanda "questa persona è registrata?" per qualsiasi indirizzo che chiunque provi a testare.
3. **Non fare mai branching su `details`.** Fai branching su `code`. Il contenuto di `details`
   è semplicemente ciò che risultava utile a una persona in quel punto di chiamata, ed è
   soggetto a modifiche.

## Interpretare uno stato

| Stato | Cosa indica sulla richiesta |
| --- | --- |
| `400` | Malformata, o richiede qualcosa che non esiste nello schema. Correggi la richiesta. |
| `401` | Non autenticata, o credenziale scaduta. Effettua l'accesso o il refresh. |
| `403` | Autenticata, ma non autorizzata. Riprovare con la stessa identità non risolverà il problema. |
| `404` | Route, collection o riga inesistente — oppure una riga nascosta dalla row-level security. |
| `409` | Un conflitto con lo stato esistente: un duplicato o una scrittura concorrente. |
| `413` `415` `422` | Il body è troppo grande, il media type è errato o è stato rifiutato a livello semantico. |
| `429` | Rate limit raggiunto. Riduci la frequenza delle richieste (back off); il messaggio specifica per quanto tempo. |
| `500` | Il problema risiede nel server o nel database, non nel chiamante. Controlla i log. |
| `501` | La route esiste, ma questo deployment non può servirla — una funzionalità disattivata o non configurata. |
| `502` `503` `504` | Una dipendenza non era raggiungibile, non era configurata o era troppo lenta. |

## Autenticazione e account

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route richiede un secondo fattore e la sessione ne ha solo uno. | Completa la verifica MFA, quindi riprova. |
| `ALREADY_VERIFIED` | 400 | L'indirizzo o il fattore è già verificato. | Nulla — lo stato desiderato è già soddisfatto. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | L'accesso anonimo è disabilitato su questo server. | Abilitalo, oppure accedi con un'identità reale. |
| `API_KEY_FORBIDDEN` | 403 | È stata utilizzata una chiave API su una route accessibile solo a persone fisiche. | Usa una sessione utente. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una chiave API ha tentato di creare, elencare o revocare chiavi API. | Gestisci le chiavi autenticandoti come amministratore. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una route protetta è stata eseguita senza il middleware di autenticazione di Rebase a monte, quindi le credenziali del chiamante non sono mai state esaminate. | Esegui il mount dell'applicazione tramite il functions router anziché direttamente sul tuo server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Il bootstrap del primo amministratore è stato tentato da un chiamante anonimo. | Effettua prima l'accesso. |
| `BOOTSTRAP_COMPLETED` | 403 | Il primo amministratore esiste già. | Richiedi l'assegnazione del ruolo a un amministratore esistente. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Il bootstrap è riservato esclusivamente al primo utente in assoluto, e non è questo. | Richiedi l'assegnazione del ruolo a un amministratore esistente. |
| `CAPTCHA_FAILED` | 400 | Il provider ha rifiutato il token CAPTCHA. | Risolvi una nuova challenge. |
| `CAPTCHA_REQUIRED` | 400 | La route richiede un token CAPTCHA e non ne è stato inviato nessuno. | Includi il token. |
| `CHALLENGE_EXHAUSTED` | 401 | Troppi codici errati per una singola verifica MFA. | Avvia una nuova challenge. |
| `EMAIL_EXISTS` | 409 | Esiste già un account con questo indirizzo. | Accedi o avvia il recupero della password. |
| `EMAIL_NOT_CONFIGURED` | 503 | Sono stati richiesti magic link o OTP ma il server non dispone di un mail transport. | Configura SMTP o usa un altro metodo di accesso. |
| `EMAIL_NOT_VERIFIED` | 403 | L'account esiste ma il suo indirizzo non è verificato. | Verifica l'indirizzo. |
| `FACTOR_NOT_VERIFIED` | 400 | Il fattore MFA è stato registrato ma mai confermato. | Conferma il fattore. |
| `IDENTITY_ALREADY_LINKED` | 409 | Questa identità OAuth appartiene a un altro account. | Accedi con essa, oppure scollegala prima dall'altro account. |
| `INVALID_ACCOUNT` | 400 | L'account si trova in uno stato su cui questa operazione non può agire. | Consulta il messaggio. |
| `INVALID_CHALLENGE` | 400 | La challenge MFA è sconosciuta o scaduta. | Avviane una nuova. |
| `INVALID_CODE` | 401 | Il codice OTP o MFA è errato. | Riprova con il codice attuale. |
| `INVALID_CREDENTIALS` | 401 | Email o password errata — volutamente non specificato quale. | Riprova o reimposta la password. |
| `INVALID_TOKEN` | 400 | Un token di verifica, reimpostazione o magic link è malformato o sconosciuto. | Richiedi un nuovo link. |
| `LAST_ADMIN` | 403 | La modifica lascerebbe il progetto senza alcun amministratore. | Promuovi prima un altro utente. |
| `MFA_REQUIRED` | 401 | La password era corretta e l'account ha un secondo fattore verificato, quindi l'accesso è completato solo a metà. `details` contiene un token a breve termine limitato alla challenge MFA — non è una sessione. | Apri una challenge e rispondi; la risposta alla challenge emetterà la sessione. |
| `NO_SESSION` | 401 | Nessun cookie di sessione o refresh token presentato. Normale al primo caricamento della pagina. | Effettua l'accesso. |
| `NOT_ANONYMOUS` | 400 | Una route di passaggio da anonimo ad account registrato è stata chiamata da un account reale. | Nulla da aggiornare. |
| `OAUTH_ERROR` | 401 | Il provider OAuth ha rifiutato la richiesta o ha restituito un errore. | Riprova il flusso; il messaggio indica il motivo fornito dal provider. |
| `RATE_LIMITED` | 429 | Troppi tentativi da parte di questo chiamante. | Riduci la frequenza delle richieste (back off); il messaggio specifica per quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La destinazione del reindirizzamento non è nell'allow-list. | Aggiungila alla configurazione del provider. |
| `REGISTRATION_DISABLED` | 403 | La registrazione autonoma è disattivata. | Richiedi la creazione dell'account a un amministratore. |
| `ROLE_EXISTS` | 409 | Questo nome di ruolo è già occupato. | Scegli un altro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossibile leggere i ruoli per una richiesta riservata agli amministratori. Termina con esito negativo per sicurezza (fails closed) invece di fidarsi del claim presente nel token. | Riprova; controlla il database. |
| `SELF_DELETE` | 400 | Un amministratore ha tentato di eliminare il proprio account. | Fallo fare a un altro amministratore. |
| `SESSION_REVOKED` | 401 | La sessione è stata disconnessa altrove, oppure tutte le sessioni sono state revocate. | Accedi di nuovo. |
| `SETUP_REQUIRED` | 403 | Il progetto non ha ancora un amministratore, pertanto questa route non è disponibile. | Completa la configurazione del primo amministratore. |
| `TOKEN_ALREADY_USED` | 401 | È stato riutilizzato un token monouso. | Richiedine uno nuovo. |
| `TOKEN_EXPIRED` | 401 | Il token ha superato la sua durata di validità. | Richiedine uno nuovo. |
| `USER_NOT_FOUND` | 404 | Nessun account con questo ID. | Verifica l'ID. |
| `WEAK_PASSWORD` | 400 | La password non soddisfa i criteri di sicurezza configurati. | Scegline una più robusta. |

## Dati, query e scritture

<span class="since-badge" data-since="0.20">Da 0.20</span>

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Questo driver non può calcolare l'aggregato richiesto. | Usa un driver che lo supporti, oppure calcolalo nel client. |
| `BRANCHING_UNSUPPORTED` | — | È stato richiesto un branch del database tramite il websocket di Studio sul database di sviluppo gestito (PGlite), in cui un branch *è* il genitore e nulla verrebbe isolato. Il rifiuto è lo stesso restituito da `rebase db branch`. | Fai puntare `DATABASE_URL` a una tua istanza Postgres (`rebase dev --docker` ne avvia una) ed esegui il branch lì. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene più operazioni rispetto al limite consentito per batch (1000 per impostazione predefinita). Un batch costituisce una singola transazione e mantiene i suoi lock per l'intera durata. | Invialo in blocchi (chunk); il messaggio specifica il limite e il conteggio inviato. |
| `BATCH_UNSUPPORTED` | 400 | Il driver di questo backend non può eseguire scritture atomiche su più collection, e un ciclo di scritture singole non sarebbe né atomico né limitato a un singolo round trip. | Invia le scritture come richieste separate, oppure come chiamate `/bulk` per ciascuna collection. |
| `BULK_TOO_LARGE` | 400 | Il body dell'operazione bulk supera il limite di elementi configurato. | Suddividi la richiesta. |
| `BULK_UNSUPPORTED` | 400 | Questa collection o questo driver non supporta scritture in blocco (bulk). | Scrivi le righe una alla volta. |
| `CALLBACK_REJECTED` | 400 | Una callback di collection ha rifiutato la scrittura. Un'eccezione (`throw`) sollevata da `beforeSave`/`beforeDelete`/`after*` genera un errore 400 che riporta il messaggio definito dall'autore; un `beforeDelete` che restituisce `false` restituisce un 403. `details.stage` indica quale callback, `details.path` la collection. | Leggi il messaggio — è stato scritto da questo progetto, non da Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` è stato combinato con `?offset=` o `?page=`. Un cursore definisce già dove inizia la pagina, quindi applicare un offset sopra di esso salta silenziosamente quel numero di righe oltre il cursore — un divario non rilevabile dal chiamante nella risposta. | Usa l'uno o l'altro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` è stato combinato con una query di ricerca o vettoriale. Entrambe associano un punteggio a ciascuna riga, quindi due righe non risulteranno mai uguali e `DISTINCT` non raggrupperebbe nulla — sembrerebbe funzionare senza cambiare nulla. | Rimuovi uno dei due. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lettura `distinct` è ordinata in base a una colonna che non restituisce. Una `SELECT DISTINCT` può essere ordinata solo per le colonne presenti nella sua select list, altrimenti le righe raggruppate non avrebbero un ordine definito. `details.fields` ne riporta i nomi. | Aggiungi tali campi a `?fields=` o rimuovili da `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres ha rifiutato l'istruzione (`42501`): una policy di row-level security che nega l'accesso a questo ruolo o un comando `GRANT` mancante. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, un `select` di aggregazione o `groupBy` menziona un campo che i ruoli di questo chiamante non possono leggere (`access.read`). Un campo che nessuna risposta può contenere deve essere inaccessibile a qualsiasi query, altrimenti il valore risulterebbe leggibile un predicato alla volta. `details.violations` elenca ogni campo. | Rimuovi il campo dalla query o acquisisci il ruolo necessario. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Il body imposta un campo che i ruoli di questo chiamante non possono scrivere (`access.write`). L'operazione viene rifiutata anziché ignorata: una scrittura che scartasse un campo segnalerebbe successo per una modifica mai avvenuta. `details.violations` elenca ogni campo. | Rimuovi il campo o acquisisci il ruolo. Un campo che nessuno può scrivere restituisce invece `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una richiesta precedente con la stessa `Idempotency-Key` è ancora in esecuzione. | Riprova non appena termina. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La stessa `Idempotency-Key` è stata inviata con un body diverso. | Usa una nuova chiave o invia il body originale. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` specifica una funzione diversa da `count`, `sum`, `avg`, `min` o `max`. | Usa una di queste; il messaggio le elenca. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una voce di `?select=` non è nel formato `fn(field)`, oppure a una funzione diversa da `count()` non è stato associato alcun campo. | Scrivi `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | A un'operazione di `/_batch` manca `op`, `collection`, `values` o `id`, specifica una collection non gestita da questo backend, oppure riutilizza un nome `ref`. | Consulta il messaggio; indica l'operazione in base all'indice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` non fa riferimento ad alcuna operazione precedente, punta in avanti o richiede un campo che la riga referenziata non possiede. Possono essere risolti solo i riferimenti all'indietro. | Assegna all'operazione un `ref` *prima* di farvi riferimento. |
| `INVALID_BULK_BODY` | 400 | Il body della richiesta bulk non rispetta la struttura prevista. | Invia l'array `items` documentato. |
| `INVALID_CONFLICT_TARGET` | 400 | Il parametro `on_conflict` / `onConflict` di un upsert fa riferimento a colonne prive di vincolo di unicità, oppure le specifica senza `upsert: true`. Altrimenti Postgres restituirebbe 42P10 all'interno di una transazione che ha già eseguito operazioni. | Dichiara `validation: { unique: true }` o un indice `unique`; il messaggio elenca i target validi esistenti. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` non è né `include` né `only`. Rifiutato anziché ignorato: un errore di battitura come `?deleted=true` che nascondesse silenziosamente tutte le righe eliminate sembrerebbe funzionare, fornendo però una risposta errata. | Invia `include` (attive ed eliminate) o `only` (solo eliminate). Omettilo per ottenere solo le righe attive. |
| `INVALID_DISTINCT` | 400 | `?distinct=` non è `true` o `false`. | Invia uno di questi valori; sono accettati anche `1` e `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Un operatore `$inc` / `$push` / `$pull` / `$merge` è stato utilizzato su un tipo di proprietà per cui non è definito, con un operando non valido, con due operatori sullo stesso campo, con un errore di sintassi o durante un'operazione di creazione — in cui non esiste alcun valore salvato su cui operare. | Consulta [Writing over REST](/docs/backend/writes/#field-operations); il messaggio indica il campo. |
| `INVALID_FILTER_FIELD` | 400 | Il filtro indica una proprietà che questa collection non possiede. | Verifica la correttezza del nome rispetto alla collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'operatore non è supportato da questo tipo di proprietà. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valore di filtro non può essere convertito nel tipo della colonna con cui viene confrontato: `?id=eq.abc` su una chiave intera, un'etichetta non presente nell'enum, un timestamp non valido, un numero che supera l'intervallo consentito per il tipo. `details.dbCode` contiene il valore SQLSTATE. | Invia un valore del tipo previsto dalla colonna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` non è `true` o `false`. Qualsiasi altro valore viene rifiutato anziché interpretato come "no" — un errore di battitura che applica un soft-delete quando il chiamante intendeva eliminare definitivamente (purge) indurrebbe a credere erroneamente che i dati siano stati rimossi. | Invia `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` è malformato: non è un elenco di percorsi valido o supera la profondità massima di annidamento. Viene gestito al limite della richiesta anziché propagarsi dal driver come errore 500. | Consulta il messaggio; indica il percorso non valido. |
| `INVALID_INPUT` | 400 | La validazione del body è fallita. | Consulta il messaggio. |
| `INVALID_LIMIT` | — | Una sottoscrizione realtime ha richiesto un limite al di fuori dell'intervallo consentito. Restituito come frame `ERROR` WebSocket, non come risposta HTTP. | Riduci il limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un gruppo `?or=` / `?and=` è malformato o annidato oltre la profondità consentita. | Consulta il messaggio; illustra la regola di appiattimento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` non è un numero intero maggiore o uguale a 0. | Invia un numero intero non negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` non è espresso come `field`, `field:desc` o come array JSON di `{ field, direction }`. | Consulta il messaggio; mostra tutti e tre i formati supportati. |
| `INVALID_PAGE` | 400 | `?page=` non è un numero intero maggiore o uguale a 1. Le pagine sono in base 1, quindi `?page=0` è considerato un errore e non la prima pagina. | Invia `1` o un valore superiore, oppure usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parametro di query è malformato. | Consulta il messaggio. |
| `INVALID_VECTOR` | 400 | `?vector=` non è un array JSON di numeri. | Invia `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` non è `cosine`, `l2` o `inner_product`. | Usa uno di questi tre valori. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` non è un numero. | Invia un numero. |
| `INVALID_WHERE` | 400 | `?where=` non è un oggetto JSON che associa campi a condizioni. | Invia `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route di aggregazione è stata chiamata senza `?select=`. | Aggiungine uno, ad es. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Il progetto non serve alcuna collection: nessuna dichiarata nel codice e nessuna tabella da cui ricavarle. | Crea le tabelle — tramite una migrazione, SQL o un file di collection insieme a `rebase db push` — e riavvia. |
| `NOT_FOUND` | 404 | Nessuna riga con questo ID nella collection — oppure una riga nascosta a questo chiamante dalla row-level security. | Verifica l'ID, quindi controlla le `securityRules` della collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` specifica un elemento che non corrisponde a una relazione sulla collection. Lo stesso codice restituisce **404** quando invece viene indicato in un *percorso URL* annidato, ad es. `/api/data/authors/1/posts` dove `authors` non ne dichiara alcuno — in tal caso l'URL non fa riferimento a nulla, trattandosi quindi di una risorsa non trovata anziché di una richiesta malformata. | Verifica il nome della relazione — il messaggio elenca quelle presenti nella collection. Una back-reference deve essere dichiarata sul genitore per poter essere percorsa. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | L'ordinamento specifica una proprietà non ordinabile. | Esegui l'ordinamento su una proprietà associata a una colonna reale. |
| `PAYLOAD_TOO_LARGE` | 413 | Il body supera il limite configurato. | Invia meno dati o aumenta il limite. |
| `READ_ONLY_TRANSACTION` | 409 | Una callback `afterRead` ha tentato di eseguire una scrittura. Una lettura con ambito di richiesta viene eseguita in una transazione `READ ONLY`, pertanto né la callback né qualsiasi cosa da essa chiamata può scrivere. | Sposta la scrittura al di fuori della lettura: tramite un job in background o `rebase.dataAsAdmin` da un cron job o da una custom function. |
| `RELATION_MISCONFIGURED` | 500 | Una relazione non si risolve rispetto allo schema registrato. L'operazione viene rifiutata anziché ignorata: tralasciarla riporterebbe successo per una scrittura mai avvenuta, oppure l'assenza di righe in realtà esistenti. | Esegui `rebase schema generate` se lo schema generato è meno recente del database. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relazione non può essere scollegata da questo lato. | Esegui la scrittura dal lato proprietario. |
| `RELATION_NOT_WRITABLE` | 400 | Il percorso annidato non è una relazione scrivibile. | Consulta [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una scrittura di relazione non disponeva della chiave di origine a cui agganciare il collegamento. | Salva prima la riga genitore. |
| `SCHEMA_DRIFT` | 500 | Una tabella o una colonna attesa dal codice non esiste nel database. | Esegui `rebase db push` in sviluppo; effettua un nuovo deployment su un tenant gestito. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` è stato combinato con `orderBy: "_score"`. La rilevanza viene calcolata per ogni singola query anziché salvata, quindi non può fare da chiave per un cursore. | Impagina la rilevanza con `limit`/`offset`, oppure ordina per colonna. |
| `TENANT_IMMUTABLE` | 400 | Una scrittura sposterebbe una riga da un tenant all'altro. Una riga non può cambiare tenant. `details.violations` indica il campo. | Crea la riga nell'altro tenant ed elimina questa, oppure esegui la scrittura con un ruolo incluso in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La scrittura indica un tenant a cui questo chiamante non appartiene; anche il database la rifiuterebbe. | Scrivi in un tenant a cui appartiene il chiamante, oppure autenticati con un'identità che vi appartiene. |
| `TENANT_REQUIRED` | 400 | La collection è limitata a un tenant e il tenant non può essere dedotto: la richiesta non ne specifica alcuno, oppure il chiamante appartiene a più tenant. | Invia il campo del tenant in modo esplicito, oppure autenticati con un chiamante che appartiene esattamente a uno solo. |
| `UNKNOWN_FIELD` | 400 | `?fields=` specifica un campo che la collection non possiede. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un'aggregazione o `groupBy` specifica un campo che la collection non possiede. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_FIELD` | 400 | Il filtro specifica un campo che questa collection — o la destinazione di una relazione — non possiede. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Il filtro indica un operatore non esistente. | Il messaggio elenca tutti gli operatori. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | L'ordinamento specifica un campo che questa collection non possiede. | Verifica la correttezza del nome; il messaggio elenca i campi validi. |
| `PRECONDITION_FAILED` | 412 | Un header `If-Match` ha specificato una versione della riga non più attuale: qualcuno vi ha scritto tra la lettura e questa scrittura. Non è stato scritto nulla. | Rileggi la riga, riapplica la modifica e invia il nuovo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` richiede un campo che la collection non possiede. | Verifica la correttezza del nome; il messaggio elenca i campi noti. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una ricerca vettoriale ha specificato una proprietà che non è di tipo `vector` in questa collection. | Il messaggio elenca le proprietà vettoriali della collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Il `Content-Type` non è tra quelli accettati da questa route. | Invia il tipo indicato nella documentazione della route. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Il filtro attraversa una relazione `via`, il cui percorso di join è definito in una sola direzione, quindi non c'è modo di ricollegare una sottoquery. | Esegui il filtro dal lato proprietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'operatore non è definito per quel campo: una relazione senza colonna su questa riga viene filtrata per appartenenza, e la corrispondenza senza distinzione tra maiuscole e minuscole (case-insensitive) si applica solo al testo. | Consulta il messaggio; elenca gli operatori accettati dal campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valore ha violato una regola di `validation` dichiarata dalla proprietà — lunghezza, intervallo, pattern o campo obbligatorio. | Consulta il messaggio; indica ciascuna violazione. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Il body tenta di scrivere una colonna contrassegnata con `excludeFromApi` o `access: { write: [] }` — la stessa regola in due forme diverse. Questi campi sono riservati al server: un hash della password, un token di verifica. A differenza di `FIELD_NOT_WRITABLE`, questa risposta è identica per qualsiasi chiamante, incluso `admin`. | Rimuovi il campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valore non corrisponde al tipo di proprietà previsto. | Consulta il messaggio; indica la proprietà interessata. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Il body indica un campo che la collection non possiede — compreso un argomento `id` su una collection avente un'altra chiave primaria. | Verifica la correttezza del nome; il messaggio elenca i campi noti. |
| `WRITE_DENIED` | 403 | Una regola di sicurezza o una policy di row-level security ha rifiutato la scrittura. | Controlla le `securityRules` della collection. |

## `PG_<SQLSTATE>` — un vincolo rifiutato dal database

Una scrittura che Postgres rifiuta a causa dei *dati del chiamante* risponde con
il valore SQLSTATE nel codice: `PG_23505`, `PG_23503` e così via. Si tratta di una
famiglia, non di un elenco esaustivo — Postgres definisce centinaia di codici SQLSTATE — ma
solo due classi vengono esposte in questo modo, poiché solo queste due dipendono dal chiamante:

- **classe 23**, violazione di vincoli di integrità: un duplicato, una foreign key che punta
  al nulla, una colonna NOT NULL lasciata vuota;
- **classe 22**, eccezione sui dati: un valore non supportato dal tipo della colonna.

Tutto il resto — una connessione interrotta, una colonna mancante, un problema di privilegi —
è imputabile al server e rimane un `500`. Di conseguenza, `code.startsWith("PG_")` costituisce
un controllo affidabile per indicare che "la riga inviata non era valida", e i quattro seguenti
sono quelli che un client incontra concretamente. `details.dbCode` riporta lo stesso SQLSTATE per
tutti, e il messaggio specifica il vincolo violato.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Impossibile convertire un valore nel tipo della colonna — l'equivalente in scrittura di `INVALID_FILTER_VALUE`. | Invia un valore del tipo previsto dalla colonna. |
| `PG_23502` | 400 | Una colonna `NOT NULL` è stata lasciata vuota. | Invia il campo oppure definisci un valore predefinito per la colonna. |
| `PG_23503` | 400 | Una foreign key punta a una riga inesistente. | Crea prima la riga di destinazione o correggi l'ID. |
| `PG_23505` | 409 | È stato violato un vincolo di unicità. Il messaggio indica il vincolo. | Usa un valore diverso oppure aggiorna la riga esistente. |

## Storage

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Il nome del bucket è malformato. | Verifica il nome. |
| `INVALID_STORAGE_KEY` | 400 | La chiave dell'oggetto è malformata o esce dal proprio prefisso. | Verifica la chiave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | I parametri di trasformazione dell'immagine sono fuori scala o contraddittori. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Il file caricato supera il valore `maxSize` dichiarato dalla proprietà di destinazione. Applicato sul server, non solo nel browser. `details` indica la proprietà, il limite e la dimensione effettiva. | Carica un file più piccolo o aumenta `maxSize` sulla proprietà. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Il tipo di file caricato non rientra in `acceptedFiles` della proprietà. `details` indica la proprietà, l'elenco dei tipi accettati e il content type inviato. | Carica un tipo accettato o estendi `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Nessun backend di storage è configurato su questo server. | Configura S3, GCS o lo storage locale. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La sorgente di storage è dichiarata ma non dispone di credenziali su questo server. | Imposta le variabili d'ambiente per quella sorgente. |
| `STORAGE_WRITE_FAILED` | 502 | Il backend di storage ha rifiutato o interrotto la scrittura. | Controlla i relativi log e credenziali. |
| `TRANSFORM_OVERLOADED` | 503 | Troppe trasformazioni di immagini simultanee in corso. | Riprova; prendi in considerazione l'utilizzo di una CDN a monte. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La richiesta specifica una sorgente di storage (`?storageId=`) non dichiarata in questo progetto. Un `bucket` non gestito da questo deployment restituisce lo stesso codice con stato **404** — ciò che manca è lo store, e `details` elenca i bucket e le sorgenti esistenti. In precedenza entrambi venivano segnalati come "file non trovato", indistinguibili da una chiave semplicemente assente. | Dichiara la sorgente in `config/resources.ts` o verifica `GET /api/storage/sources`. |

## Custom functions

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nessuna funzione con questo nome è disponibile — oppure esiste, ma le sue route interne non coprono il percorso successivo. A un chiamante autenticato viene anche mostrato cosa *è* disponibile; a uno anonimo no, poiché tale elenco costituisce un inventario di tutti gli endpoint personalizzati. Se un file con quel nome non è stato caricato, il messaggio lo segnala: questa è la differenza tra un errore di battitura e un deploy corrotto. | Verifica il nome tramite `GET /api/functions` o controlla il log di avvio per individuare il file non caricato. |
| `FUNCTION_TIMEOUT` | 504 | L'handler ha superato il proprio timeout. È ancora in esecuzione; non può essere interrotto da qui. | Assegna un `AbortSignal` alle chiamate in uscita o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Questo processo inoltra le funzioni come proxy a un altro processo, che non ha risposto. | Verifica che l'unità delle funzioni sia in esecuzione. |

## Interfacce di amministrazione e modifica dello schema

Questi codici indicano che una funzionalità è disattivata o non configurata, piuttosto
che un errore nella richiesta. Ciascuno di essi viene segnalato anche sulla route
`/status` corrispondente con stato `200`, consentendo a un pannello di disabilitare visivamente
la funzione (in grigio) invece di mostrare un errore.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | È stata chiamata un'interfaccia riservata agli amministratori su un server privo di autenticazione configurata, rendendo impossibile distinguere un amministratore da un qualsiasi utente. | Imposta `auth.jwtSecret` o passa un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Il contract del progetto viene fornito solo quando l'autenticazione è configurata — descrive ogni tabella e relazione. | Configura l'autenticazione. `/meta/schema-version` è sempre disponibile. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nessuna casella di posta per lo sviluppo è attiva. Le email vengono intercettate solo quando `SMTP_HOST` non è impostato e `NODE_ENV` non è production. | Rimuovi `SMTP_HOST` in sviluppo oppure controlla la casella di posta reale. |
| `INVALID_CHANGE` | 400 | La modifica dello schema proposta non è ben formata. | Consulta il messaggio. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'applicazione di una modifica programmata dello schema è fallita per un motivo non coperto da codici più specifici. | Consulta il messaggio; riporta testualmente l'errore sottostante. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modifica è valida ma non può essere applicata allo schema nello stato attuale. | Consulta il messaggio. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Il repository contiene modifiche non committate, quindi la modifica non ha potuto essere applicata in sicurezza. | Esegui un commit o uno stash, poi riprova. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'editor dello schema ha rifiutato la modifica. | Consulta il messaggio; riporta il rifiuto specifico dell'editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una chiave API o un'altra entità automatizzata (machine principal) ha tentato di applicare una modifica allo schema. | Accedi come utente o imposta `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modifica dello schema in tempo reale richiede `collectionsDir` o `liveSchema.repository`, ma questo server è stato avviato senza nessuno dei due. | Configurane uno. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La pianificazione funziona; non è presente alcun repository su cui committare la modifica. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Questo driver non supporta la pianificazione delle modifiche allo schema. | La modifica in tempo reale è disponibile su Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | In questo contesto le collection vengono rilevate tramite introspezione del database, pertanto non ci sono file sorgente da modificare. | Modifica lo schema tramite una migrazione. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'editor dello schema è disabilitato su questo server. | Abilitalo tramite `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'editor dello schema richiede `ts-morph`, che non è installato. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Il server non dispone di `collectionsDir`, pertanto l'editor non ha una destinazione su cui scrivere. | Imposta `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'editor è disattivato quando `NODE_ENV=production`: i file di un server distribuito vengono ricompilati dal repository a ogni deploy, quindi una modifica effettuata qui verrebbe persa. | Modifica le collection in sviluppo ed effettua il deploy. |

## Codici generici

Una route utilizza uno di questi codici quando non è applicabile nulla di più specifico.

| Codice | Stato | Significato | Cosa fare |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Richiesta malformata e nessun codice più specifico applicabile. | Consulta il messaggio. |
| `UNAUTHORIZED` | 401 | Non autenticato, o credenziale rifiutata. | Effettua l'accesso o il refresh. |
| `FORBIDDEN` | 403 | Autenticato, ma non autorizzato. | Riprovare con la stessa identità non risolverà il problema. |
| `CONFLICT` | 409 | Conflitto con lo stato esistente. | Consulta il messaggio. |
| `INTERNAL_ERROR` | 500 | Si è verificato un errore sul server. Il messaggio è generico di proposito. | Indica il `requestId`; la causa è indicata nei log. |
| `NOT_CONFIGURED` | 503 | Una dipendenza richiesta da questa route non è configurata su questo server. | Consulta il messaggio. |
| `SERVICE_UNAVAILABLE` | 503 | Una dipendenza non era raggiungibile. | Riprova; controlla i log. |

## Mantenere aggiornata questa pagina

`pnpm verify:docs` fallisce quando un codice generabile dal server non è presente
in queste tabelle, quando una tabella elenca un codice che nulla può generare, quando
uno stato indicato differisce dal codice sorgente o quando una famiglia di codici come
`PG_<SQLSTATE>` non include una riga per un SQLSTATE riscontrabile dai chiamanti. Lo stage
di verifica è `tooling/scripts/docs-verify/check-error-codes.mjs`.

Verifica prima se stesso. La scansione legge i codici direttamente dal codice TypeScript
anziché da un server in esecuzione, quindi i suoi punti ciechi sono per progettazione silenti:
in passato non riusciva a rilevare un codice passato tramite un wrapper su una singola riga
o scritto dopo un messaggio contenente una `)`, segnalando che "tutti i codici generabili dal
server sono documentati" su una pagina a cui ne mancavano ben diciassette. Per questo motivo
lo stage esegue una fixture con esattamente quelle strutture prima di analizzare questa pagina,
e si rifiuta di completare la segnalazione se non riesce a rilevarle.

---
