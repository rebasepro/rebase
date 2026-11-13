---
sourceHash: a8ca2780e6bbad15
title: Modifica live dello schema
description: Crea e modifica tabelle su un backend in esecuzione — la modifica viene scritta in backend/schema, prima committata nel tuo repository, poi applicata.
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

L'editor dello schema nel pannello di amministrazione riscrive i file delle tabelle in
`backend/schema`. Questo funziona sulla tua macchina locale e da nessun'altra parte: i file di un
server distribuito vengono ricompilati dal tuo repository a ogni deploy, quindi una modifica apportata
lì verrebbe scartata al deploy successivo.

La modifica live dello schema è la risposta a questo problema. **Esegue il commit della modifica nel tuo
repository, quindi applica il DDL** — così la modifica sopravvive al deploy successivo,
poiché il deploy viene compilato a partire da essa.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status e plan richiedono lo scope `schema:read`, mentre apply richiede `schema:write`, come
ogni altra superficie `/api/admin` che richiede uno scope. Un amministratore possiede entrambi.
L'applicazione richiede anche un ulteriore requisito oltre allo scope — vedi [Chi può applicare](#chi-può-applicare).

## Le modifiche: `TablePatch`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ogni route che modifica lo schema accetta lo stesso corpo, `{ patches }`: un elenco
di modifiche, ciascuna delle quali identifica la propria tabella tramite slug. Il tipo è `TablePatch`, proveniente da
`@rebasepro/types`.

| `op` | Cosa scrive in `backend/schema` |
|---|---|
| `createTable` | un nuovo `backend/schema/<name>.ts` che contiene la tabella, esportata da `index.ts` |
| `deleteTable` | rimuove il file e la sua esportazione |
| `addColumn` `{ key, column, before? }` | una colonna, prima di quella indicata da `before`, o per ultima |
| `changeColumn` `{ key, column }` | riscrive la catena del builder di una colonna; un `.transform()` presente su di essa viene mantenuto |
| `renameColumn` `{ key, to, column }` | rinomina la chiave, mantenendo la colonna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | rimuove o riordina una colonna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | una voce `rel.*`; il `target` della relazione è uno slug |
| `setRls` `{ rls }` | la postura: `"admin-only"`, `"inherit"` o un elenco di regole |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | una regola dell'elenco |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` o `metadata`; `null` la rimuove |

Una colonna viaggia come definizione — il tipo Postgres come `{ kind: … }`, e i
modificatori come flag — senza i suoi hook `.transform()`, che sono codice e rimangono
dove sono stati scritti:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Viene riscritto solo il codice specificato da una modifica. Tutto il resto rimane invariato —
importazioni, commenti, formattazione, una colonna condivisa da un altro modulo. L'editor
rifiuta, indicando l'espressione, qualsiasi modifica che vada ad agire *all'interno* di qualcosa definito
nel codice: una tabella costruita con uno spread, una colonna costruita da un helper, regole contenute in
una variabile, una chiave calcolata, una colonna la cui struttura JSON include trasformazioni. Inoltre,
non rinomina mai uno slug, una tabella, uno schema o il nome di una definizione (questo sposta
dati: scrivi una migrazione), non rimuove mai l'ultima regola (ad esempio usa `setRls` con
`"admin-only"`), rifiuta `rls` su una vista e rifiuta l'eliminazione di una tabella a cui puntano
altre relazioni. Una modifica il cui risultato non compila viene rifiutata con
`SCHEMA_EDIT_DOES_NOT_COMPILE` e i relativi errori del compilatore. In caso di rifiuto non viene scritto nulla.

L'aspetto visivo di una tabella nel pannello di amministrazione — etichette, icone, gruppi, modalità di visualizzazione, colori
degli enum — non è una modifica dello schema: risiede in `frontend/src/cms` e nelle preferenze salvate
del pannello, e nulla di tutto ciò viaggia in una `TablePatch`.

`$ADMIN_TOKEN` è un token di accesso — l'`accessToken` restituito da un accesso — per un
account che possiede `schema:read`: un amministratore, o un ruolo che lo dichiara. Nessun elemento
sulla macchina lo imposta per te in automatico.

## Pianifica prima di applicare

<span class="since-badge" data-since="0.31">Da 0.31</span>

`/plan` non ha effetti collaterali. Invia le modifiche e ti mostrerà cosa comportano:

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"patches":[{"op":"addColumn","table":"posts","key":"subtitle","column":{"type":{"kind":"text"}}}]}'
```

```json
{
  "applicable": true,
  "verdict": "safe",
  "changes": [
    { "kind": "add-property", "verdict": "safe", "collection": "posts",
      "property": "subtitle", "detail": "New optional property subtitle …" }
  ],
  "statements": ["ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"subtitle\" TEXT;"],
  "files": ["backend/schema/posts.ts", "backend/src/schema.generated.ts"],
  "message": "…the commit message the apply would use…",
  "withheldConstraints": [],
  "followUp": []
}
```

`files` include tutti i file di cui l'operazione di applicazione effettua il commit: il sorgente della tabella, quando il backend
può scriverlo, e poi lo schema generato. I record delle modifiche del pianificatore mantengono
i loro nomi wire (`add-property`, `collection`, `property`).

Questa non è una semplice comodità. Due dei tre verdetti sono rifiuti, e uno di
essi è un rifiuto che altrimenti scopriresti solo premendo il pulsante su un
database in produzione.

## I tre verdetti

| Verdetto | Significato |
|---|---|
| `safe` | Il percorso ensure in fase di avvio può esprimerlo e il risultato corrisponde alla tua configurazione. Applicato. |
| `diverges` | Si applica *in parte*, lasciando un database che non corrisponde alla tua configurazione — e nulla lo segnala. Rifiutato. |
| `needs-migration` | Il percorso ensure non può esprimerlo affatto. Rifiutato. |

`diverges` è quello che vale la pena comprendere, perché queste modifiche sembrano
andare a buon fine:

- **Una colonna `.notNull()` aggiunta a una tabella che contiene già righe** viene creata
  **nullable**. `NOT NULL` viene verificato su ogni riga già presente, e le righe
  scritte prima che la colonna esistesse non hanno alcun valore per essa. Su una tabella
  **vuota** non c'è nulla da verificare, quindi il vincolo viene applicato e questo è
  `safe`.
- **Rendere `.notNull()` una colonna esistente** ha la stessa dinamica: `SET NOT NULL`
  esegue una scansione della tabella, quindi è `safe` su una vuota e `diverges` su una
  popolata finché non si esegue un backfill.

Due modifiche che in passato risultavano in `diverges` ora sono `safe`, poiché il percorso ensure
le gestisce direttamente:

- **Un valore aggiunto a un enum esistente** viene applicato, tramite
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Prima veniva ignorato insieme all'intero
  tipo, e la prima riga che utilizzava il nuovo valore veniva rifiutata da un tipo che
  non ne era a conoscenza.
- **Rendere opzionale una colonna `.notNull()`** rimuove il `NOT NULL`. Prima veniva lasciato
  al suo posto, quindi le scritture che omettevano la colonna continuavano a fallire.

### Vincoli richiesti e non applicati

Una modifica può essere applicabile e comunque lasciare qualcosa richiesto dalla tua configurazione
non applicato — il caso tipico è una colonna `.notNull()` su una tabella popolata. Questo non è
un rifiuto, quindi non compare in `changes`; compare in
`withheldConstraints`, con l'ostacolo e ciò che lo risolverebbe:

```json
{
  "withheldConstraints": [
    {
      "target": "public.posts.author",
      "kind": "not-null",
      "reason": "\"author\" is required, but \"public.posts\" already holds rows …",
      "remedy": "Backfill the column, then apply this again."
    }
  ]
}
```

Il percorso ensure all'avvio segnala la stessa cosa come avviso. Fino all'introduzione
di questa funzionalità, un vincolo trattenuto veniva trattenuto in silenzio.

`needs-migration` copre tutto ciò che il percorso ensure non può fare: eliminare una
tabella o una colonna, modificare il tipo di una colonna (un interruttore a intero, una stringa
che diventa un enum, il tipo di elemento di un array, la lunghezza di un varchar), rinominare una
colonna, modificare una chiave primaria, rimuovere un valore di enum, rendere univoca una colonna
esistente e modificare una relazione — il suo tipo, la sua destinazione, la sua `localKey`,
il suo `onDelete`. Viene rifiutato anche un `hasMany` o `hasOne` la cui colonna di collegamento non viene creata da nulla.
Ogni rifiuto specifica la modifica e cosa fare in alternativa.

Il verdetto viene ricavato dallo schema prodotto da ciascuna parte — lo stesso piano da cui
vengono renderizzati `schema.generated.ts` e `db push` — quindi una modifica che altera
il database non può essere segnalata come assenza di modifiche. Due modifiche che sembrano cambiamenti
e non vengono rifiutate:

- **Rinominare la chiave di una colonna mantenendo la relativa colonna SQL** (`renameColumn`,
  che scrive il vecchio nome come primo argomento del builder, `col.text("old_name")`) non sposta dati. È `safe`; i client API leggono il nuovo nome.
- **Impostare, modificare o rimuovere un valore predefinito** vincola solo le scritture future. È
  `safe`, e applicato con `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Modifica solo del sorgente

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una modifica rifiutata può comunque essere scritta in `backend/schema` e committata,
lasciando il database così com'è — la rimozione di una colonna che non si intende più esporre è
il caso tipico. Invia `/apply` con `"sourceOnly": true`. Non viene eseguito nulla sul database; il messaggio
di commit specifica cosa viene mantenuto nel database, ad esempio
`chore(schema): remove sku from products (source only — column products.sku kept)`,
e ogni modifica nel piano contiene una frase `sourceOnly` che spiega cosa
lascia invariato — incluso il caso in cui una colonna lasciata nel DB sia `NOT NULL` senza
un valore predefinito, il che farebbe fallire ogni inserimento successivo finché non viene rimossa o resa
nullable. Una modifica priva di questo (spostamento di una chiave primaria, una relazione la cui colonna di collegamento
non viene creata da nulla) non può essere scritta solo nel sorgente.

Su una distribuzione che non apporta alcuna modifica al proprio database (`REBASE_PROVISION=false`),
nessuna modifica viene applicata dal pannello, quindi ogni operazione segue questa strada: il
pulsante principale della finestra di dialogo recita **Commit** e invia `"sourceOnly": true`, mentre il
processo deputato a modificare il database applica lo schema.

L'eliminazione di una tabella dal pannello di amministrazione segue lo stesso percorso: `/apply` con una
modifica `deleteTable` e `"sourceOnly": true` elimina il file della tabella e la sua
esportazione in `index.ts` ed effettua il commit di entrambi; la tabella e le relative righe rimangono nel
database. L'operazione viene rifiutata finché una relazione di un'altra tabella vi punta, specificando
quella tabella — eliminarla impedirebbe la compilazione dello schema.

## Cosa viene incluso nel commit

Non solo il file della tabella. Lo schema Drizzle viene generato a partire da esso, e uno
non aggiornato interromperebbe il deploy successivo, quindi entrambi vengono inclusi nello stesso commit:

- `backend/schema/<name>.ts` — la tabella stessa, e `backend/schema/index.ts` quando una tabella viene creata o eliminata
- `backend/src/schema.generated.ts` — lo schema Drizzle

Questi percorsi sono relativi al tuo **progetto**, non al tuo repository. Quando i
due coincidono — un progetto creato con `rebase init`, che è il caso tipico — non c'è
nulla di cui preoccuparsi. Quando il tuo progetto si trova in una sottodirectory di un repository
più grande, ai percorsi viene aggiunto il relativo prefisso, individuato risalendo dalla directory dello
schema fino al `rebase.json` più vicino. Un progetto privo di
`rebase.json` mantiene i percorsi semplici.

Nessun file SQL viene inserito nel commit. `rebase db push` e `rebase db generate` scrivono il proprio SQL
a partire dalle tabelle a ogni esecuzione, all'interno di `.rebase/sql/`, che è ignorato da git.

Il messaggio di commit descrive la modifica anziché limitarsi ad annunciarla, ed è
attribuito alla persona che l'ha effettuata, tramite il nome visualizzato e l'email dell'account
(un utente sprovvisto di entrambi viene registrato nel commit come `<uid>@users.noreply.rebase.pro`).

Una modifica dello schema con un autore e un diff nella cronologia del tuo progetto è una funzionalità
che né Firebase né Supabase offrono: le loro modifiche alle tabelle sono invisibili
al tuo repository.

## Chi può applicare

Possedere `schema:read` è sufficiente per **pianificare**. La pianificazione non ha effetti collaterali, e un
job di CI che verifichi se una modifica di schema proposta sia applicabile ne rappresenta un ottimo caso
d'uso.

L'applicazione è un secondo livello di privilegio, poiché applicare scrive un commit e un commit
richiede un autore:

| Chiamante | Plan | Apply |
|---|---|---|
| Una persona autenticata con `schema:write` | sì | sì |
| Una chiave API con `schema:read` / `schema:write` | sì | no |
| La service key del server | sì | no |

Una credenziale non è un autore. `api-key:7c3f…` nel tuo ambiente di CI non è
una persona, e permetterle di scrivere nel tuo repository produce esattamente la cronologia
non attribuibile che questa funzionalità mira a superare.

Se ciò che desideri è una modifica automatizzata dello schema — ad esempio una pipeline di migrazione —,
abilitala esplicitamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oppure `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Il commit viene quindi attribuito
alla credenziale per nome — `Rebase API key (7c3f)` — così che leggendo `git log` a
distanza di un mese sia ancora possibile distinguere quali modifiche sono state apportate da una persona.

`GET /api/admin/schema/status` segnala ciò che *tu* puoi fare, non solo ciò che il
server supporta, consentendo a un pannello di disabilitare il controllo e spiegarne il motivo anziché
rifiutare l'operazione dopo che hai deciso:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Se il tuo progetto gestisce migrazioni con versionamento

L'applicazione in questo contesto **non** scrive una migrazione, e non può farlo: una migrazione è nel
formato di Atlas con un file di integrità, generato da un binario esterno su un database
temporaneo, ed entrambi non sono presenti su un server in esecuzione.

Ciò di cui viene effettuato il commit è il file della tabella, ed è a partire da quello che `rebase db generate`
scrive la migrazione. Quindi la migrazione è a portata di un solo comando:

```bash
rebase db generate
```

Sia il piano che il risultato finale lo segnalano quando il tuo progetto usa le migrazioni, perché
altrimenti l'errore passerebbe inosservato: il tuo database contiene la modifica e il tuo repository
la descrive, ma l'ambiente successivo creato rieseguendo le migrazioni ne è privo,
senza che nulla sia stato segnalato.

Un progetto con provisioning tramite boot-ensure — il runtime gestito, e qualsiasi self-host
che mantenga `REBASE_MIGRATE_ON_BOOT` al valore predefinito — non richiede alcuna migrazione. Le sue
tabelle costituiscono lo schema, e l'avvio successivo si occupa della riconciliazione.

## Prima il commit, poi l'applicazione

L'ordine è fondamentale e non è arbitrario.

Se venisse eseguito prima il DDL e il commit fallisse, il tuo database conterrebbe una colonna
che il tuo repository non descrive. Il percorso ensure non elimina mai nulla, quindi il
deploy successivo non la rimuoverebbe né la segnalerebbe — una colonna invisibile, assente
dalle tue tabelle, finché qualcuno non andasse a cercarla.

Effettuare prima il commit produce un fallimento di segno opposto: il repository descrive qualcosa che il
database non ha ancora. Questo è lo stato ordinario di qualsiasi progetto tra
una modifica e un deploy, e la fase di avvio si occupa di riconciliarlo al riavvio successivo.

Di conseguenza, un'applicazione non riuscita **non è un errore**. La risposta lo indica chiaramente:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Le regole hanno effetto nella stessa applicazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una modifica alle `rls` di una tabella (o a una nuova tabella) viene resa effettiva nella stessa applicazione: le
policy delle tabelle modificate vengono scritte nel database subito dopo il DDL,
e la risposta indica l'esito sotto la voce `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Nei casi in cui le policy non possono essere scritte — un backend a cui non è consentito effettuare provisioning
(`provision.tables` disattivato) o un driver privo di questa capacità — lo stato è
`"deferred"`; quando la scrittura fallisce lo stato è `"failed"`, con il relativo errore. Entrambi
restituiscono il messaggio "Rules saved to source; they take effect on the next
deploy.", e il pannello continua a mostrare le regole applicate da Postgres fino a quel momento,
mai regole che non siano effettivamente in vigore.

Anche gli hook modificati nel codice sorgente diventano effettivi con l'applicazione: il server esegue le
tabelle compilate dello schema modificato senza necessità di riavvio.

## Servito senza riavvio

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una modifica applicata dallo Studio viene resa disponibile immediatamente. Il driver Postgres rilegge
le tabelle modificate dal database e le sostituisce: la data API,
le include, gli hook e il realtime vedono una nuova tabella, colonna, relazione o junction
senza bisogno di riavvio, e una nuova tabella riceve i suoi grant e il change capture. La
risposta lo indica sotto `serving`:

```json
{ "serving": { "status": "now" } }
```

In una distribuzione in cui le tabelle sono derivate dal database (senza
`backend/schema`), o con un driver che non può aggiornare le sue tabelle, il
database e il codice sorgente contengono la modifica, ma il processo continua a servire le
tabelle con cui si è avviato. Lo stato è in tal caso `"after-restart"`, con un `message`
che la ricevuta dello Studio mostra come avviso; riavvia il processo per rendere disponibile
la modifica.

## Quando il file cambia durante la modifica

Una modifica viene preparata sulla base dei file così come sono. Se uno di essi viene modificato su
disco prima che la modifica venga applicata — un salvataggio da IDE, un altro processo — l'applicazione
non scrive nulla e risponde con 409 `SCHEMA_EDIT_STALE_FILE`. L'editor delle collection
propone il pulsante Ricarica; ripeti la modifica sul file nello stato in cui si trova attualmente.

## Dove funziona

<span class="since-badge" data-since="0.31">Da 0.31</span>

La modifica live dello schema riscrive `backend/schema` con lo stesso editor utilizzato dai salvataggi
del pannello in modalità solo sorgente (richiede l'installazione di `ts-morph`). La provenienza di tale
sorgente determina dove può essere eseguito:

- **Su disco** (`schemaDir`, il valore predefinito): viene eseguito dove funziona l'editor
  solo sorgente. Tale editor è disattivato con `NODE_ENV=production`, a meno che il server
  non imposti `schemaEditor: true`.
- **In un repository indicato** (`liveSchema.repository`, o
  `REBASE_LIVE_SCHEMA_REPOSITORY` per un bundle): il sorgente viene letto da
  GitHub e la modifica viene committata nuovamente lì, quindi funziona ovunque,
  inclusa la produzione. Questa è l'opzione da abilitare per un bundle compilato.

| Distribuzione | Funziona |
|---|---|
| `rebase dev` sulla tua macchina | sì |
| Self-host con il progetto e il suo working tree Git montati | sì, quando `NODE_ENV` non è `production`, o con `schemaEditor: true` |
| Un bundle compilato: un self-host che esegue una build, o l'immagine pubblicata | solo se abilitato esplicitamente con `REBASE_LIVE_SCHEMA_REPOSITORY` — vedi [Da un bundle compilato](#da-un-bundle-compilato) |
| Qualsiasi server con `liveSchema.repository` configurato | sì, incluso `NODE_ENV=production` |

Un bundle è un output compilato, pertanto non contiene il codice sorgente di `backend/schema`, e
il runtime che lo esegue disattiva l'editor solo sorgente. A meno che non indichi un
repository, `/api/admin/schema/status` risponderà con `enabled: false` e il codice
`SCHEMA_EDITOR_DISABLED`: modifica `backend/schema` in ambiente di sviluppo, committa ed
esegui il deploy.

### Da un bundle compilato

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un bundle non ha codice proprio da configurare, quindi viene abilitato tramite variabili
di ambiente. Non cambia nulla per un bundle che non le imposta.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

L'elenco completo si trova in [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un repository specificato senza credenziali utilizzabili (nessuna, entrambi i tipi, una GitHub
App a metà), o un valore diverso da `owner/name`, blocca l'avvio del server, anziché servire
un editor che fallirebbe non appena qualcuno preme Applica. Lo stesso avviene per la variabile rimossa
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, con un messaggio che indica
`REBASE_LIVE_SCHEMA_PATH`, e per un percorso che punta al di fuori del repository.

Cosa rimane invariato quando è attivo:

- È una superficie di `/api/admin`: nessuna risposta senza `schema:read`, e
  `/apply` richiede `schema:write` e una persona (vedi [Chi può applicare](#chi-può-applicare)).
- La destinazione di scrittura è unicamente il repository indicato. L'editor solo sorgente,
  che scrive i file localmente accanto al processo, rimane disattivato.
- Ogni modifica viene pianificata, mostrata, committata e infine applicata, esattamente come sulla tua
  macchina locale.

Il processo che ha applicato la modifica la rende disponibile immediatamente: le sue route REST, i
descrittori `GET /api/schema/tables` e il pannello di amministrazione seguono la modifica
senza necessità di riavvio. Le altre repliche, e questo stesso processo dopo un riavvio, continuano a servire
le tabelle con cui il bundle è stato compilato fino a quando la tua pipeline non compila e distribuisce
il commit.

Pertanto, una modifica deve attendere che quella precedente sia stata resa disponibile. Una modifica pianificata rispetto a
tabelle rispetto alle quali il repository è già più avanti finirebbe per committare file di schema generati
che escluderebbero la modifica precedente. Ogni operazione di apply renderizza quindi
`schema.generated.ts` a partire dalle tabelle servite da questo processo e lo confronta con
la copia presente nel repository. Se differiscono, l'applicazione viene rifiutata con
`SCHEMA_CHANGE_FAILED`, indicando il file, finché un processo che esegue quel commit non
sostituisce questo. Il controllo legge il repository, non la memoria di questo processo,
quindi è valido anche dopo un riavvio, tra le repliche e per una modifica inviata da uno sviluppatore
che non è ancora stata distribuita. Nel frattempo la pianificazione rimane disponibile.

Le copie differiscono anche qualora il file sia stato generato da un'altra versione di Rebase,
riformattato o modificato manualmente. Se non ci sono distribuzioni in attesa, esegui
`rebase schema generate` con la versione eseguita dall'ambiente di produzione, committa il
risultato e distribuiscilo. I caratteri di fine riga e gli spazi vuoti finali non vengono considerati
come differenze.

### Commit su un repository remoto

<span class="since-badge" data-since="0.31">Da 0.31</span>

`liveSchema.repository` fa sì che il server effettui il commit di ogni modifica su un repository GitHub
tramite la Git Data API anziché eseguire `git commit` in un
working tree. Questo non dipende dall'attivazione dell'editor solo sorgente: con un
repository configurato, la modifica live funziona anche con `NODE_ENV=production` e con
`schemaEditor: false`, poiché nulla viene scritto su questa macchina. Un bundle
lo imposta tramite le variabili sopra indicate.

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where backend/schema lives in that repository.
            // Defaults to "backend/schema".
            schemaPath: "backend/schema",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

La directory dello schema viene quindi letta dal repository, riscritta con lo
stesso editor in esecuzione in locale, e le modifiche vengono committate tramite
la Git Data API: un blob per file, un albero, un commit e l'aggiornamento del ref. Nulla viene
clonato e nulla viene lasciato su disco. Viene letta l'intera directory, non solo il
file modificato, in modo che una relazione possa puntare a un'altra tabella e l'eliminazione di una tabella funzioni
come in locale: rifiutata se una relazione di un'altra tabella vi punta, e
rimossa da `index.ts` nello stesso commit. Viene recuperato solo `backend/schema`,
quindi un file di tabella che importa elementi esterni ad esso non può essere modificato in questo modo.

`auth` accetta un token o un'installazione di GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Usa il token per un singolo progetto che effettua commit su un repository di tua proprietà —
configurare un'App solo per permettere al tuo server di committare su di essa comporta una trafila eccessiva per
una credenziale di una sola riga. Usa l'App per un control plane che gestisce un'unica chiave su
molti progetti, che è ciò che fa Rebase Cloud: una sola App, un'installazione per ciascun
progetto e nessun segreto da ruotare per ciascun cliente.

Il token richiede il permesso `contents: read and write` su quel repository, e nient'altro.

Senza `liveSchema.repository`, il commit è un normale `git commit` nel
working tree che contiene `schemaDir`: nulla da autenticare, nessun token, nessuna
chiamata di rete.

Due aspetti garantiscono la sicurezza dell'operazione su un repository su cui sta lavorando qualcun altro:

- Esegue lo stage **soltanto** dei file generati. Un commit dello schema che includesse
  lavori a metà sarebbe un commit impossibile da revisionare; inoltre l'operazione viene rifiutata
  immediatamente se l'albero di lavoro presenta già modifiche su uno dei propri file.
- Il percorso remoto non forza mai l'aggiornamento di un ref (mai force-update). Se qualcosa è stato inviato nel frattempo
  mentre il commit veniva preparato, l'aggiornamento viene respinto — perdere il commit di qualcuno
  silenziosamente è peggio che fallire l'operazione.

## Limitazioni

- Solo modifiche additive. Tutto il resto viene rifiutato con una motivazione, poiché il
  percorso ensure è l'unico meccanismo che altera uno schema e può solamente aggiungere elementi.
- Non viene scritto alcun file di migrazione. Un progetto configurato tramite boot-ensure non ne ha bisogno;
  un progetto configurato tramite migrazioni dovrebbe eseguire `rebase db generate`, che ne
  crea una tramite Atlas con l'hash di integrità richiesto da Atlas.
- Solo Postgres. La funzionalità viene rilevata a livello di driver, e un driver
  privo di tale supporto risponde con `SCHEMA_EDITING_UNSUPPORTED`.
- Una distribuzione le cui tabelle sono derivate dal database renderà disponibile la modifica
  applicata solo dopo il riavvio successivo (`serving.status: "after-restart"`, vedi
  [Servito senza riavvio](#servito-senza-riavvio)).

## Risorse correlate

- [Generazione dello schema](/docs/cli/schema/) — le stesse modifiche da riga di comando
- [Tabelle](/docs/schema/) — ciò che l'editor sta riscrivendo
- [Studio](/docs/studio/) — il pannello alla base di queste route
