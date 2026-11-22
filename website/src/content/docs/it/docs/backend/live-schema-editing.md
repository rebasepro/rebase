---
sourceHash: 45b2459dff0e5ec4
title: Modifica live dello schema
description: Crea e modifica tabelle su un backend in esecuzione — la modifica viene scritta in backend/schema, prima salvata con commit nel repository, poi applicata.
---

L'editor di schema solo sorgente, `/api/admin/schema-editor/*`, riscrive i
file delle tabelle in `backend/schema` e non tocca nient'altro. Funziona sul tuo
computer e da nessun'altra parte: i file di un server distribuito vengono ricompilati dal
tuo repository a ogni deploy, quindi una modifica apportata lì verrebbe scartata
al deploy successivo.

La modifica live dello schema è la risposta a questo problema. **Esegue il commit della modifica
nel repository, poi applica il DDL** — in questo modo la modifica sopravvive al deploy
successivo, poiché il deploy viene compilato a partire da essa. L'editor RLS di Studio salva
le policy di una tabella tramite queste route — pianificate, mostrate come SQL, confermate e
infine applicate — e uno script o un agente che possiede lo scope può inviare le stesse modifiche.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status e plan richiedono lo scope `schema:read`, mentre apply richiede `schema:write`, come
ogni altra superficie di `/api/admin` che definisce uno scope. Un amministratore possiede entrambi.
L'applicazione richiede inoltre una condizione in più rispetto allo scope — vedi [Chi può applicare le modifiche](#chi-può-applicare-le-modifiche).

## Le modifiche: `TablePatch`

Ogni route che modifica lo schema accetta lo stesso body, `{ patches }`: un elenco
di modifiche, ciascuna delle quali identifica la propria tabella tramite slug. Il tipo è `TablePatch`,
proveniente da `@rebasepro/types`.

| `op` | Cosa scrive in `backend/schema` |
|---|---|
| `createTable` | un nuovo `backend/schema/<name>.ts` che contiene la tabella, esportato da `index.ts` |
| `deleteTable` | rimuove il file e la sua esportazione |
| `addColumn` `{ key, column, before? }` | una colonna, prima di quella indicata da `before`, oppure in fondo |
| `changeColumn` `{ key, column }` | riscrive la catena del builder di una colonna; un `.transform()` definito su di essa viene mantenuto |
| `renameColumn` `{ key, to, column }` | rinomina la chiave, mantenendo la colonna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | rimuove o riordina una colonna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | una voce `rel.*`; il `target` della relazione è uno slug |
| `setRls` `{ rls }` | la postura: `"admin-only"`, `"inherit"` o un elenco di regole |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | una regola dell'elenco |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` o `metadata`; `null` lo rimuove |

Una colonna viaggia sotto forma della sua definizione — il tipo Postgres come `{ kind: … }` e i
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
rifiuta, indicando l'espressione, una modifica che interviene *all'interno* di qualcosa definito
nel codice: una tabella creata con uno spread, una colonna creata da un helper, regole contenute in
una variabile, una chiave calcolata, una colonna la cui forma JSON include trasformazioni. Inoltre,
non rinomina mai uno slug, una tabella, uno schema o il nome di una definizione (questo sposta
dati: scrivi una migrazione), non rimuove mai l'ultima regola (ad esempio `setRls` con
`"admin-only"`), rifiuta `rls` su una vista e rifiuta l'eliminazione di una tabella a cui
puntano altre relazioni. Una modifica il cui risultato non compila viene rifiutata con
`SCHEMA_EDIT_DOES_NOT_COMPILE` e i relativi errori del compilatore. In caso di rifiuto non viene
scritto nulla.

L'aspetto di una tabella nel pannello di amministrazione — etichette, icone, gruppi, modalità
di visualizzazione, colori degli enum — non è una modifica dello schema: risiede in
`frontend/src/cms` e nelle preferenze salvate del pannello, e niente di tutto ciò viaggia in un `TablePatch`.

`$ADMIN_TOKEN` è un token di accesso — l'`accessToken` restituito da un sign-in — per un
account che possiede `schema:read`: un admin o un ruolo che lo dichiara. Nulla sulla
macchina lo imposta automaticamente per te.

## Pianifica prima di applicare

`/plan` non ha effetti collaterali. Invia le modifiche e ti dirà cosa comportano:

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

`files` contiene tutti i file inclusi nel commit dell'applicazione: il sorgente della tabella,
quando il backend può scriverlo, e quindi lo schema generato. I record delle modifiche del
planner mantengono i loro nomi wire (`add-property`, `collection`, `property`).

Non si tratta solo di una comodità. Due dei tre verdetti sono rifiuti, e uno di
essi è un rifiuto che altrimenti scopriresti solo premendo il pulsante su un
database in produzione.

## I tre verdetti

| Verdetto | Significato |
|---|---|
| `safe` | Il percorso di ensure all'avvio lo supporta e il risultato corrisponde alla tua configurazione. Applicato. |
| `diverges` | Viene applicato *in parte*, lasciando un database non corrispondente alla tua configurazione — e nulla lo segnala. Rifiutato. |
| `needs-migration` | Il percorso di ensure non può esprimerlo affatto. Rifiutato. |

`diverges` è quello che vale la pena comprendere, perché queste modifiche sembrano
essere andate a buon fine:

- **Una colonna `.notNull()` aggiunta a una tabella che contiene già righe** arriva
  come **nullable**. Il vincolo `NOT NULL` viene verificato su ogni riga già presente, e le
  righe scritte prima dell'esistenza della colonna non hanno alcun valore per essa. Su una tabella
  **vuota** non c'è nulla da verificare, quindi il vincolo viene applicato ed è
  `safe`.
- **Rendere `.notNull()` una colonna esistente** ha la stessa dinamica: `SET NOT NULL`
  esegue una scansione della tabella, quindi è `safe` su una tabella vuota e `diverges` su una popolata
  finché non esegui un backfill.

Due modifiche che in precedenza erano `diverges` ora sono `safe`, perché il percorso di ensure
le esegue:

- **Un valore aggiunto a un enum esistente** viene applicato tramite
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. In precedenza veniva saltato insieme all'intero
  tipo, e la prima riga che utilizzava il nuovo valore veniva rifiutata da un tipo che non
  ne era a conoscenza.
- **Rilasciare una colonna `.notNull()`** rimuove il `NOT NULL`. In precedenza veniva lasciato
  al suo posto, quindi le scritture che omettevano la colonna continuavano a fallire.

### Vincoli richiesti e non applicati

Una modifica può essere applicabile e tuttavia lasciare non applicato qualcosa richiesto
dalla configurazione — una colonna `.notNull()` su una tabella popolata ne è l'esempio. Questo
non è un rifiuto, quindi non compare in `changes`; compare in
`withheldConstraints`, con l'ostacolo e la soluzione per risolverlo:

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

Il percorso di ensure all'avvio segnala la stessa cosa come avviso. Fino all'introduzione
di questo meccanismo, un vincolo trattenuto veniva trattenuto in silenzio.

`needs-migration` copre tutto ciò che il percorso di ensure non è in grado di fare: eliminare
una tabella o una colonna, modificare il tipo di una colonna (un interruttore a intero, una stringa
che diventa enum, il tipo di elemento di un array, la lunghezza di un varchar), rinominare una
colonna, modificare una chiave primaria, rimuovere un valore di un enum, rendere univoca una colonna
esistente e modificare una relazione — il suo tipo, la destinazione, la sua `localKey`,
il suo `onDelete`. Viene rifiutato anche un `hasMany` o `hasOne` la cui colonna di collegamento non
viene creata da nulla. Ogni rifiuto indica la modifica e cosa fare in alternativa.

Il verdetto viene letto dallo schema prodotto da ciascuna parte — lo stesso piano a partire
dal quale vengono generati `schema.generated.ts` e `db push` — quindi una modifica che altera
il database non può essere segnalata come assenza di modifiche. Due modifiche che sembrano cambiamenti
e non vengono rifiutate:

- **Rinominare la chiave di una colonna mantenendo la colonna SQL** (`renameColumn`,
  che scrive il vecchio nome come primo argomento del builder, `col.text("old_name")`) non sposta alcun dato. È `safe`; i client API leggono il nuovo nome.
- **Impostare, modificare o eliminare un valore di default** vincola solo le scritture future. È
  `safe` e viene applicato con `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Modifica solo sorgente

Una modifica rifiutata può comunque essere scritta in `backend/schema` e committata,
lasciando il database così com'è — rimuovere una colonna che non si serve più è il caso
tipico. Invia `/apply` con `"sourceOnly": true`. Non viene eseguito nulla; il messaggio di commit
indica cosa viene mantenuto nel database, ad esempio
`chore(schema): remove sku from products (source only — column products.sku kept)`,
e ogni modifica nel piano include una frase `sourceOnly` che spiega cosa lascia
intatto — anche quando una colonna lasciata indietro è `NOT NULL` senza default, il che
rende fallimentare ogni successivo inserimento finché non viene eliminata o resa nullable.
Una modifica priva di questa specifica (spostare una chiave primaria, una relazione la cui colonna
di collegamento non viene creata da nulla) non può essere scritta solo nel sorgente.

In una distribuzione che non modifica nulla nel database (`REBASE_PROVISION=false`),
nessuna modifica viene applicata dal pannello, quindi ogni modifica segue questa procedura: il pulsante
principale della finestra di dialogo riporta **Commit** e invia `"sourceOnly": true`, e il
processo che modifica quel database applica lo schema.

L'eliminazione di una tabella segue lo stesso percorso: `/apply` con una
modifica `deleteTable` e `"sourceOnly": true` elimina il file della tabella e la sua
esportazione in `index.ts` ed esegue il commit di entrambi; la tabella e le relative righe rimangono nel
database. L'operazione viene rifiutata finché una relazione di un'altra tabella vi fa riferimento, indicando
tale tabella — eliminarla impedirebbe la compilazione dello schema.

## Cosa viene incluso nel commit

Non solo il file della tabella. Lo schema Drizzle viene generato a partire da esso, e uno
schema obsoleto comprometterebbe il deploy successivo, quindi entrambi vengono inseriti nello stesso commit:

- `backend/schema/<name>.ts` — la tabella stessa, e `backend/schema/index.ts` quando una tabella viene creata o eliminata
- `backend/src/schema.generated.ts` — lo schema Drizzle

Questi percorsi sono relativi al tuo **progetto**, non al tuo repository. Quando i
due coincidono — un progetto `rebase init`, che rappresenta il caso comune — non c'è
nulla di cui preoccuparsi. Quando il progetto si trova in una sottodirectory di un repository
più grande, i percorsi vengono preceduti da essa, individuata risalendo dalla directory
dello schema fino al `rebase.json` più vicino. Un progetto senza
`rebase.json` mantiene i percorsi semplici.

Nessun file SQL viene incluso nel commit. `rebase db push` e `rebase db generate` scrivono il proprio SQL
a partire dalle tabelle a ogni esecuzione, all'interno di `.rebase/sql/`, che è ignorato da git.

Il messaggio di commit descrive la modifica invece di annunciarne semplicemente una, ed è
attribuito alla persona che l'ha effettuata, tramite il nome visualizzato e l'email dell'account
(un utente senza nessuno dei due viene committato come `<uid>@users.noreply.rebase.pro`).

Una modifica dello schema con un autore e un diff nella cronologia del progetto è qualcosa
che né Firebase né Supabase offrono — le modifiche alle tabelle effettuate tramite le loro interfacce
sono invisibili al tuo repository.

## Chi può applicare le modifiche

Possedere `schema:read` è sufficiente per **pianificare** (`plan`). La pianificazione non ha effetti
collaterali, e un job CI che verifichi se una modifica proposta allo schema sia applicabile ne
rappresenta un ottimo caso d'uso.

L'applicazione è un secondo privilegio, poiché applicare scrive un commit e un commit
richiede un autore:

| Chiamante | Plan | Apply |
|---|---|---|
| Un utente autenticato con `schema:write` | sì | sì |
| Una chiave API con `schema:read` / `schema:write` | sì | no |
| La service key del server | sì | no |

Una credenziale non è un autore. `api-key:7c3f…` nel tuo ambiente CI non è una
persona fisica, e permetterle di scrivere nel repository produrrebbe esattamente quella
cronologia priva di attribuzione che questa funzionalità mira a sostituire.

Se desideri automatizzare le modifiche dello schema — ad esempio in una pipeline di migrazione —
abilitalo esplicitamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oppure `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Il commit viene quindi attribuito
alla credenziale per nome — `Rebase API key (7c3f)` — in modo che consultando `git log` a
distanza di un mese sia ancora possibile distinguere quali modifiche sono state apportate da una persona.

`GET /api/admin/schema/status` segnala ciò che *tu* puoi fare, non solo ciò che il
server supporta, consentendo a un pannello di disabilitare il controllo e spiegarne il motivo
anziché rifiutare l'azione dopo che hai già deciso:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Se il tuo progetto utilizza migrazioni con controllo di versione

L'applicazione qui **non** scrive una migrazione, e non può farlo: una migrazione è nel
formato di Atlas con un file di integrità, generato da un binario esterno su un
database usa e getta, ed entrambi non sono presenti su un server in esecuzione.

Ciò di cui esegue il commit è il file della tabella, ed è da quello che `rebase db generate`
scrive la migrazione. Di conseguenza, la migrazione è a un solo comando di distanza:

```bash
rebase db generate
```

Sia il piano che il risultato lo segnalano quando il tuo progetto contiene migrazioni,
perché altrimenti il problema passerebbe inosservato: il database contiene la modifica e il repository
la descrive, ma l'ambiente successivo creato rieseguendo le migrazioni non la riceverebbe,
senza alcun avviso.

Un progetto sottoposto a provisioning tramite boot-ensure — il runtime gestito e qualsiasi
istanza self-hosted che mantenga `REBASE_MIGRATE_ON_BOOT` sul valore predefinito — non necessita
affatto di migrazioni. Le sue tabelle costituiscono lo schema e l'avvio successivo esegue la riconciliazione.

## Prima il commit, poi l'applicazione

L'ordine è importante e non è casuale.

Se il DDL venisse eseguito prima e il commit fallisse, il database conterrebbe una colonna
che il repository non descrive. Il percorso di ensure non elimina mai nulla, quindi il
deploy successivo non la rimuoverebbe né la segnalerebbe — una colonna invisibile, assente
dalle tue tabelle, finché qualcuno non se ne accorgesse indagando.

Eseguire prima il commit fallisce nella direzione opposta: il repository descrive qualcosa che il
database non possiede ancora. Questo è lo stato ordinario di ogni progetto tra
una modifica e un deploy, e la procedura di boot lo riconcilia all'avvio successivo.

Pertanto, una mancata applicazione **non è un errore**. La risposta lo specifica:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Le regole hanno effetto nella stessa applicazione

Una modifica all'`rls` di una tabella (o una nuova tabella) viene applicata contestualmente: le
policy delle tabelle modificate vengono scritte nel database subito dopo il DDL e
la risposta descrive l'esito sotto `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Nei casi in cui le policy non possono essere scritte — un backend che non può effettuare il provisioning
(`provision.tables` disattivato) o un driver privo di tale funzionalità — lo stato è
`"deferred"`; quando la loro scrittura fallisce, lo stato è `"failed"`, accompagnato dall'errore.
Entrambi includono il messaggio "Rules saved to source; they take effect on the next
deploy.", e il pannello continua a mostrare le regole che Postgres applica fino a quel momento,
mai regole che non siano effettivamente in vigore.

Anche gli hook modificati nel sorgente diventano effettivi con l'applicazione: il server esegue le
tabelle compilate dello schema modificato senza necessità di riavvio.

## Servito senza riavvio

Una modifica applicata da Studio viene servita immediatamente. Il driver Postgres rilegge
le tabelle modificate dal database e le scambia: l'API dei dati,
gli includes, gli hook e il realtime riconoscono una nuova tabella, colonna, relazione o junction
senza riavvio, e una nuova tabella ottiene i propri permessi e il change capture. La
risposta lo indica sotto `serving`:

```json
{ "serving": { "status": "now" } }
```

In un deployment in cui le tabelle sono derivate dal database (senza
`backend/schema`), o con un driver che non può aggiornare le sue tabelle, il
database e il codice sorgente contengono la modifica, ma il processo continua a servire le
tabelle con cui è stato avviato. In questo caso lo stato è `"after-restart"`, con un `message`
che la ricevuta di Studio mostra come avviso; riavvia il processo per servire la
modifica.

## Quando il file cambia durante la modifica

Una modifica viene preparata sulla base dei file così come sono. Se uno di essi cambia
su disco prima che la modifica venga applicata — un salvataggio nell'IDE, un altro processo — l'applicazione
non scrive nulla e risponde con 409 `SCHEMA_EDIT_STALE_FILE`. Esegui nuovamente la modifica
sul file nello stato in cui si trova adesso.

## Dove funziona

La modifica live dello schema riscrive `backend/schema` con lo stesso editor utilizzato dai
salvataggi solo sorgente del pannello (richiede `ts-morph` installato). La provenienza
di tale sorgente determina dove viene eseguito:

- **Su disco** (`schemaDir`, il valore predefinito): viene eseguito dove viene eseguito l'editor
  solo sorgente. Tale editor è disattivato con `NODE_ENV=production` a meno che il server non
  imposti `schemaEditor: true`.
- **In un repository specificato** (`liveSchema.repository`, o
  `REBASE_LIVE_SCHEMA_REPOSITORY` per un bundle): il sorgente viene letto da GitHub e la modifica
  viene committata lì, quindi funziona ovunque, inclusa la produzione. Questa è la modalità di
  attivazione per un bundle compilato.

| Distribuzione | Funziona |
|---|---|
| `rebase dev` sulla tua macchina | sì |
| Self-host con il progetto e il suo working tree git montati | sì, quando `NODE_ENV` non è `production`, o con `schemaEditor: true` |
| Un bundle compilato: un'istanza self-hosted che serve una build o l'immagine pubblicata | solo se attivato con `REBASE_LIVE_SCHEMA_REPOSITORY` — vedi [Da un bundle compilato](#da-un-bundle-compilato) |
| Qualsiasi server con `liveSchema.repository` configurato | sì, incluso `NODE_ENV=production` |

Un bundle è un output compilato, quindi non contiene i sorgenti in `backend/schema`, e
il runtime che lo serve disattiva l'editor solo sorgente. A meno che non specifichi un repository,
`/api/admin/schema/status` risponde con `enabled: false` e il codice
`SCHEMA_EDITOR_DISABLED`: modifica `backend/schema` in fase di sviluppo, esegui il commit e
distribuisci.

### Da un bundle compilato

Un bundle non ha codice proprio da configurare, quindi viene abilitato tramite variabili
d'ambiente. Nulla cambia per un bundle che non le imposta.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

L'elenco completo si trova in [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un repository specificato senza una credenziale utilizzabile (nessuna, entrambi i tipi, metà GitHub
App) o con un valore diverso da `owner/name` rifiuta l'avvio, piuttosto che servire
un editor che fallirebbe non appena qualcuno preme Apply. Lo stesso vale per la variabile rimossa
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, con un messaggio che menziona
`REBASE_LIVE_SCHEMA_PATH`, e per un percorso che esce dal repository.

Cosa rimane invariato quando è attivo:

- È una superficie di `/api/admin`: nessuna risposta senza `schema:read`, e
  `/apply` richiede `schema:write` e una persona fisica (vedi [Chi può applicare le modifiche](#chi-può-applicare-le-modifiche)).
- La destinazione di scrittura è unicamente il repository specificato. L'editor solo sorgente,
  che scrive i file accanto al processo, rimane disattivato.
- Ogni modifica viene pianificata, mostrata, committata e infine applicata, esattamente come sulla
  tua macchina locale.

Il processo che ha applicato la modifica la serve immediatamente: le sue route REST, i
descrittori `GET /api/schema/tables` e il pannello di amministrazione recepiscono la modifica
senza riavvio. Le altre repliche, e questo processo dopo un riavvio, servono le tabelle
con cui è stato compilato il bundle finché la pipeline non compila e distribuisce il commit.

Pertanto, una modifica attende che quella precedente sia servita. Una modifica pianificata
rispetto a tabelle rispetto a cui il repository è già più avanti committerebbe file di schema generati
che omettono la modifica precedente. Ogni apply esegue quindi il rendering di
`schema.generated.ts` dalle tabelle che questo processo serve e lo confronta con la copia del repository.
Se differiscono, l'applicazione viene rifiutata con `SCHEMA_CHANGE_FAILED`, indicando il file,
finché un processo che esegue quel commit non sostituisce quello attuale. Il controllo legge il repository,
non la memoria di questo processo, quindi è valido attraverso i riavvii, tra le repliche e per una modifica
inviata da uno sviluppatore che non è ancora stata distribuita. Nel frattempo, la pianificazione rimane disponibile.

Le copie differiscono anche quando il file è stato generato da un'altra versione di Rebase,
riformattato o modificato manualmente. Se non ci sono deploy in attesa, esegui
`rebase schema generate` con la versione utilizzata dal deploy, fai il commit del risultato e
distribuiscilo. I caratteri di fine riga e gli spazi bianchi finali non contano come
differenze.

### Commit su un repository remoto

`liveSchema.repository` fa sì che il server esegua il commit di ogni modifica su un repository
GitHub tramite la Git Data API anziché eseguire `git commit` in un working tree. Non dipende
dall'attivazione dell'editor solo sorgente: con un repository configurato, la modifica live funziona
sotto `NODE_ENV=production` e con `schemaEditor: false`, poiché sulla macchina locale non viene
scritto nulla. Un bundle lo imposta tramite le variabili sopra indicate.

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
stesso editor eseguito localmente, e ciò che è cambiato viene committato tramite la
Git Data API: un blob per file, un tree, un commit e l'aggiornamento di un ref. Nulla viene
clonato e nulla viene lasciato su disco. Viene letta l'intera directory, non solo il
file modificato, così una relazione può puntare a un'altra tabella e l'eliminazione di una tabella
funziona come localmente: rifiutata finché la relazione di un'altra tabella vi fa riferimento, e
rimossa da `index.ts` nello stesso commit. Viene recuperato solo `backend/schema`,
pertanto un file di tabella che importa qualcosa all'esterno di essa non può essere modificato in questo modo.

`auth` accetta un token o un'installazione di GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Usa il token per un singolo progetto che esegue il commit su un repository di tua proprietà —
configurare un'App solo per consentire al tuo server di eseguire il commit è una procedura eccessiva per
una credenziale di una riga. Usa l'App per un control plane che gestisce una sola chiave su
molti progetti, come fa Rebase Cloud: un'App, un'installazione per progetto e nessun segreto per singolo cliente da ruotare.

Il token necessita solo del permesso `contents: read and write` su quel repository, e di nient'altro.

Senza `liveSchema.repository`, il commit è un normale `git commit` nel working tree che
ospita `schemaDir`: nulla da autenticare, nessun token, nessuna rete.

Due aspetti che ne garantiscono la sicurezza quando viene eseguito su un repository su cui sta
lavorando qualcun altro:

- Aggiunge all'area di staging **solo** i file generati. Un commit dello schema che includesse modifiche
  a metà risulterebbe impossibile da revisionare; inoltre, l'operazione viene rifiutata categoricamente
  se il working tree ha già uno dei suoi file modificato.
- La modalità remota non forza mai l'aggiornamento di un ref (`force-update`). Se qualcosa è stato
  inviato mentre il commit veniva creato, l'aggiornamento viene rifiutato — perdere silenziosamente il
  commit di qualcun altro è peggio che fallire.

## Limitazioni

- Solo modifiche additive. Tutto il resto viene rifiutato con una motivazione, poiché il
  percorso di ensure è l'unico elemento che modifica uno schema e può solo aggiungere.
- Non viene scritto alcun file di migrazione. Un progetto configurato tramite boot-ensure non ne ha bisogno;
  un progetto configurato tramite migrazioni dovrebbe eseguire `rebase db generate`, che ne genera una
  tramite Atlas con l'hash di integrità richiesto da Atlas.
- Solo Postgres. La funzionalità viene rilevata sul driver e un driver sprovvisto risponde con
  `SCHEMA_EDITING_UNSUPPORTED`.
- Una distribuzione le cui tabelle sono derivate dal database serve una modifica applicata dopo
  l'avvio successivo (`serving.status: "after-restart"`, vedi
  [Servito senza riavvio](#servito-senza-riavvio)).

## Correlati

- [Generazione dello schema](/docs/cli/schema/) — le stesse modifiche da riga di comando
- [Tabelle](/docs/schema/) — cosa riscrive l'editor
- [Studio](/docs/studio/) — il pannello accessibile tramite queste route
