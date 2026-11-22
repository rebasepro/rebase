---
sourceHash: 972a11a8dc0defac
title: Modifica dello schema live
description: "Crea e modifica tabelle su un backend in esecuzione: la modifica viene scritta in backend/schema, prima sottoposta a commit nel repository, quindi applicata."
---

L'editor dello schema nel pannello di amministrazione riscrive i file delle tabelle in
`backend/schema`. Questo funziona sulla tua macchina e da nessun'altra parte: i file di
un server distribuito vengono ricostruiti dal repository a ogni deploy, quindi una modifica
effettuata lì verrebbe scartata al deploy successivo.

La modifica dello schema live è la risposta a questo problema. Esegue il **commit della
modifica nel repository, poi applica il DDL**, in modo che la modifica sopravviva al
deploy successivo, poiché il deploy viene compilato a partire da essa.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status e plan richiedono lo scope `schema:read`, mentre apply richiede `schema:write`, come
qualsiasi altra superficie di `/api/admin` che specifica uno scope. Un amministratore li
possiede entrambi. L'applicazione richiede anche un requisito in più rispetto allo scope:
consulta [Chi può applicare le modifiche](#chi-può-applicare-le-modifiche).

## Le modifiche: `TablePatch`

Ogni route che modifica lo schema accetta lo stesso body, `{ patches }`: un elenco
di modifiche, ciascuna delle quali identifica la tabella tramite slug. Il tipo è `TablePatch`,
proveniente da `@rebasepro/types`.

| `op` | Cosa scrive in `backend/schema` |
|---|---|
| `createTable` | un nuovo `backend/schema/<name>.ts` contenente la tabella, esportato da `index.ts` |
| `deleteTable` | rimuove il file e la sua esportazione |
| `addColumn` `{ key, column, before? }` | una colonna, prima di quella indicata da `before`, o per ultima |
| `changeColumn` `{ key, column }` | riscrive la catena del builder di una colonna; un `.transform()` definito su di essa viene mantenuto |
| `renameColumn` `{ key, to, column }` | rinomina la chiave, mantenendo la colonna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | rimuove o riordina una colonna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | una voce `rel.*`; il `target` della relazione è uno slug |
| `setRls` `{ rls }` | la configurazione: `"admin-only"`, `"inherit"` o un elenco di regole |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | una regola dell'elenco |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` o `metadata`; `null` la rimuove |

Una colonna viene trasmessa come la sua definizione — il tipo Postgres come `{ kind: … }`
e i modificatori come flag — senza i suoi hook `.transform()`, che sono codice e rimangono
dove sono scritti:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Viene riscritto solo il codice specificato da una modifica. Tutto il resto rimane invariato:
importazioni, commenti, formattazione, una colonna condivisa da un altro modulo. L'editor
rifiuta, indicando l'espressione, qualsiasi modifica che vada a intaccare qualcosa definito
nel codice: una tabella creata con uno spread, una colonna creata tramite un helper, regole
memorizzate in una variabile, una chiave calcolata, una colonna la cui struttura JSON contiene
trasformazioni. Inoltre, non rinomina mai uno slug, una tabella, uno schema o il nome di una
definizione (questo comporterebbe lo spostamento di dati: scrivi una migrazione), non rimuove
mai l'ultima regola (utilizza `setRls` con `"admin-only"`), rifiuta `rls` su una vista e
rifiuta l'eliminazione di una tabella target di altre relazioni. Una modifica il cui risultato
non compila viene rifiutata con `SCHEMA_EDIT_DOES_NOT_COMPILE` e con i relativi errori del
compilatore. In caso di rifiuto, non viene scritto nulla.

L'aspetto di una tabella nel pannello di amministrazione — etichette, icone, gruppi, modalità
di visualizzazione, colori degli enum — non è una modifica dello schema: risiede in
`frontend/src/cms` e nelle preferenze salvate del pannello, e nulla di tutto ciò viaggia
in un `TablePatch`.

`$ADMIN_TOKEN` è un token di accesso — l'`accessToken` restituito da un accesso — per un
account in possesso di `schema:read`: un amministratore o un ruolo che lo dichiara. Nessun
elemento sulla macchina lo imposta automaticamente per te.

## Pianifica prima di applicare

`/plan` non ha effetti collaterali. Invia le modifiche tramite POST e ti mostrerà il loro
significato:

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

`files` include tutti i file di cui l'applicazione esegue il commit: il sorgente della
tabella, quando il backend può scriverlo, e successivamente lo schema generato. I record di
modifica del planner mantengono i loro nomi wire (`add-property`, `collection`, `property`).

Non si tratta solo di comodità. Due dei tre verdetti sono rifiuti, e uno di questi è un
rifiuto che altrimenti scopriresti solo premendo il pulsante su un database di produzione.

## I tre verdetti

| Verdetto | Significato |
|---|---|
| `safe` | Il percorso di ensure all'avvio è in grado di esprimerlo e il risultato corrisponde alla configurazione. Applicato. |
| `diverges` | Si applica *in parte*, lasciando un database non corrispondente alla configurazione — senza che nulla lo segnali. Rifiutato. |
| `needs-migration` | Il percorso di ensure non è minimamente in grado di esprimerlo. Rifiutato. |

`diverges` è quello fondamentale da comprendere, poiché queste modifiche sembrano essere
andate a buon fine:

- **Una colonna `.notNull()` aggiunta a una tabella che contiene già righe** risulterà
  **nullable**. Il vincolo `NOT NULL` viene verificato rispetto a ogni riga già presente,
  e le righe create prima dell'esistenza della colonna non hanno alcun valore per essa.
  In una tabella **vuota** non c'è nulla da verificare, quindi il vincolo viene applicato
  e questo risulta `safe`.
- **Rendere un'esistente colonna `.notNull()`** segue la stessa logica: `SET NOT NULL`
  esegue una scansione della tabella, pertanto è `safe` su una tabella vuota e `diverges`
  su una popolata fino a quando non esegui un backfill.

Due modifiche che in precedenza erano `diverges` ora sono `safe`, poiché il percorso di
ensure le esegue:

- **Un valore aggiunto a un enum esistente** viene inserito tramite
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Prima veniva ignorato insieme all'intero tipo,
  e la prima riga che utilizzava il nuovo valore veniva rifiutata da un tipo che non lo
  conosceva.
- **Rilassare una colonna `.notNull()`** rimuove il `NOT NULL`. Prima veniva lasciato
  invariato, per cui le scritture che omettevano la colonna continuavano a fallire.

### Vincoli richiesti e non applicati

Una modifica può essere applicabile e tuttavia lasciare non applicato qualcosa richiesto
dalla tua configurazione — è il caso di una colonna `.notNull()` su una tabella popolata.
Non si tratta di un rifiuto, quindi non compare in `changes`, bensì in `withheldConstraints`,
indicando l'ostacolo e ciò che lo risolverebbe:

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

Il percorso di ensure all'avvio segnala la stessa cosa come avviso. Prima dell'introduzione
di questo meccanismo, un vincolo trattenuto veniva omesso in modo del tutto silenzioso.

`needs-migration` copre tutto ciò che il percorso di ensure non è in grado di fare: eliminare
una tabella o una colonna, modificare il tipo di una colonna (un selettore intero, una stringa
che diventa un enum, il tipo di elemento di un array, la larghezza di un varchar), rinominare
una colonna, cambiare una chiave primaria, rimuovere un valore da un enum, rendere univoca
una colonna esistente e modificare una relazione — il suo tipo, il suo target, la sua
`localKey`, il suo `onDelete`. Viene rifiutata anche una relazione `hasMany` o `hasOne` la
cui colonna di collegamento non viene creata da nulla. Ciascun rifiuto specifica la modifica
e l'alternativa da adottare.

Il verdetto viene dedotto dallo schema prodotto da ciascuna parte — lo stesso piano da cui
vengono generati `schema.generated.ts` e `db push` — quindi una modifica che altera il
database non può essere segnalata come assenza di modifiche. Due modifiche che sembrano
cambiamenti e non vengono rifiutate:

- **Rinominare la chiave di una colonna mantenendo la relativa colonna SQL** (`renameColumn`,
  che scrive il vecchio nome come primo argomento del builder, `col.text("old_name")`) non
  sposta alcun dato. È un'operazione `safe`; i client API leggono il nuovo nome.
- **Impostare, modificare o eliminare un valore predefinito** vincola unicamente le scritture
  future. È `safe` e viene applicato con `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Modifica solo del sorgente

Una modifica rifiutata può comunque essere scritta in `backend/schema` e sottoposta a
commit, lasciando il database invariato: la rimozione di una colonna non più servita ne è
il caso d'uso tipico. Invia una richiesta POST a `/apply` con `"sourceOnly": true`. Non
viene eseguito nulla sul database; il messaggio di commit specifica cosa viene mantenuto nel
database, ad esempio
`chore(schema): remove sku from products (source only — column products.sku kept)`,
e ciascuna modifica nel piano include una frase `sourceOnly` che descrive ciò che viene
lasciato indietro — compreso il caso in cui una colonna lasciata sia `NOT NULL` senza valore
predefinito, il che farà fallire ogni successivo inserimento finché non verrà eliminata o
resa nullable. Una modifica priva di questa opzione (spostamento di una chiave primaria, una
relazione la cui colonna di collegamento non viene creata da nulla) non può essere scritta
unicamente nel sorgente.

In un deployment che non apporta modifiche al proprio database (`REBASE_PROVISION=false`),
nessuna modifica viene applicata dal pannello, quindi ogni modifica segue questa procedura:
il pulsante principale della finestra di dialogo riporta **Commit** e invia `"sourceOnly": true`,
mentre il processo preposto alla modifica del database applicherà lo schema.

L'eliminazione di una tabella dal pannello di amministrazione segue lo stesso percorso:
`/apply` con una modifica `deleteTable` e `"sourceOnly": true` elimina il file della tabella
e la sua esportazione in `index.ts` ed esegue il commit di entrambi; la tabella e le sue
righe restano nel database. Viene rifiutata se una relazione di un'altra tabella la identifica
come target, citando tale tabella — eliminarla impedirebbe la compilazione dello schema.

## Cosa viene sottoposto a commit

Non solo il file della tabella. Lo schema Drizzle viene generato a partire da esso, e uno
schema non aggiornato comprometterebbe il deploy successivo; pertanto, entrambi vengono
inclusi nello stesso commit:

- `backend/schema/<name>.ts` — la tabella stessa, e `backend/schema/index.ts` quando una tabella viene creata o eliminata
- `backend/src/schema.generated.ts` — lo schema Drizzle

Questi percorsi sono relativi al tuo **progetto**, non al tuo repository. Quando i due
coincidono — come in un progetto inizializzato con `rebase init`, che rappresenta il caso
comune — non c'è nulla di cui preoccuparsi. Quando il tuo progetto risiede in una
sottodirectory di un repository più grande, ai percorsi viene aggiunto il relativo prefisso,
individuato risalendo dalla directory dello schema fino al `rebase.json` più vicino. Un
progetto privo di `rebase.json` mantiene i percorsi lineari.

Nessun file SQL viene incluso nel commit. `rebase db push` e `rebase db generate` generano
il proprio codice SQL dalle tabelle a ogni esecuzione, salvandolo in `.rebase/sql/`, che è
ignorato da Git.

Il messaggio di commit descrive la modifica invece di limitarsi ad annunciarla, e viene
attribuito alla persona che l'ha eseguita, tramite il nome visualizzato e l'email dell'account
(un utente privo di entrambi viene registrato nel commit come `<uid>@users.noreply.rebase.pro`).

Una modifica dello schema dotata di autore e diff nella cronologia del tuo progetto è una
caratteristica che né Firebase né Supabase offrono: le modifiche alle loro tabelle sono
invisibili al tuo repository.

## Chi può applicare le modifiche

Possedere `schema:read` è sufficiente per l'operazione di **plan**. La pianificazione non ha
effetti collaterali, e un job di CI che verifica se una modifica di schema proposta è
applicabile ne rappresenta un ottimo caso d'uso.

L'applicazione è un secondo privilegio, poiché applicare comporta la scrittura di un commit
e un commit reca un autore:

| Chiamante | Plan | Apply |
|---|---|---|
| Una persona autenticata con `schema:write` | sì | sì |
| Una chiave API con `schema:read` / `schema:write` | sì | no |
| La service key del server | sì | no |

Una credenziale non è un autore. `api-key:7c3f…` nel tuo ambiente di CI non è una persona
fisica, e consentirle di scrivere nel repository produrrebbe esattamente quella cronologia
non tracciabile che questa funzionalità intende eliminare.

Se ciò che desideri è una modifica automatizzata dello schema — ad esempio una pipeline di
migrazione — abilitala esplicitamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oppure `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Il commit viene quindi attribuito
alla credenziale per nome — `Rebase API key (7c3f)` — così che leggendo `git log` un mese
dopo sia ancora possibile capire quali modifiche siano state apportate da una persona.

`GET /api/admin/schema/status` riporta cosa *tu* puoi fare, non solo ciò che il server
supporta, in modo che un pannello possa disabilitare il comando e spiegarne il motivo
anziché rifiutare la richiesta dopo che hai già preso una decisione:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Se il tuo progetto gestisce migrazioni con controllo di versione

L'applicazione in questo contesto **non** scrive una migrazione, né potrebbe farlo: una
migrazione è nel formato di Atlas, con un file di integrità generato da un binario esterno
su un database usa e getta, e un server in esecuzione non dispone di nessuno dei due elementi.

Ciò di cui viene eseguito il commit è il file della tabella, ed è a partire da questo che
`rebase db generate` crea la migrazione. Quindi, la migrazione è a portata di un solo
comando:

```bash
rebase db generate
```

Sia il piano che il risultato lo segnalano esplicitamente quando il tuo progetto adotta le
migrazioni, perché altrimenti il fallimento avverrebbe in modo silenzioso: il tuo database
contiene la modifica e il repository la descrive, ma il successivo ambiente creato
rieseguendo le migrazioni ne è privo, senza alcun avviso.

Un progetto configurato tramite boot-ensure — il runtime gestito e qualsiasi istanza
self-hosted che mantenga `REBASE_MIGRATE_ON_BOOT` sul valore predefinito — non necessita
affatto di migrazioni. Le sue tabelle costituiscono lo schema e l'avvio successivo si occupa
della riconciliazione.

## Prima il commit, poi l'applicazione

L'ordine è importante e non è casuale.

Se il DDL venisse eseguito prima e il commit fallisse, il tuo database avrebbe una colonna
non descritta dal repository. Il percorso di ensure non elimina mai nulla, quindi il deploy
successivo non la rimuoverebbe né la menzionerebbe: una colonna invisibile, assente dalle tue
tabelle, fino a quando qualcuno non andasse a cercarla.

Eseguire prima il commit fallisce nel senso opposto: il repository descrive qualcosa che il
database non possiede ancora. Questo è lo stato ordinario di qualsiasi progetto tra una
modifica e un deploy, e il boot si occupa di riconciliarlo al riavvio successivo.

Pertanto, un'applicazione non riuscita **non è un errore**. La risposta lo indica chiaramente:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Le regole hanno effetto nella stessa applicazione

Una modifica a `rls` di una tabella (o una nuova tabella) diventa effettiva nella stessa
operazione di apply: le policy delle tabelle modificate vengono scritte nel database subito
dopo il DDL, e la risposta descrive l'accaduto sotto la voce `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Nei casi in cui le policy non possono essere scritte — un backend non autorizzato al
provisioning (`provision.tables` disattivato) o un driver privo della funzionalità — lo
stato è `"deferred"`; in caso di fallimento della scrittura, lo stato è `"failed"`,
accompagnato dall'errore. Entrambi contengono il messaggio "Rules saved to source; they take
effect on the next deploy.", e il pannello continuerà a mostrare le regole applicate da
Postgres fino a quel momento, mai regole non attive.

Anche gli hook modificati nel sorgente hanno effetto contestualmente all'applicazione: il
server esegue le tabelle compilate dello schema modificato senza necessità di riavvio.

## Operatività immediata senza riavvio

Una modifica applicata da Studio diventa immediatamente operativa. Il driver Postgres
rilegge le tabelle modificate dal database e le scambia in memoria: le API dei dati, le
inclusioni, gli hook e le funzionalità in tempo reale (realtime) rilevano una nuova
tabella, colonna, relazione o tabella di giunzione senza necessità di riavvio, e una nuova
tabella riceve i relativi privilegi (grants) e il change capture. La risposta lo indica
sotto la voce `serving`:

```json
{ "serving": { "status": "now" } }
```

In un deployment le cui tabelle sono derivate dal database (senza `backend/schema`), o
con un driver incapace di aggiornare le proprie tabelle, il database e il sorgente
conterranno la modifica, ma il processo continuerà a gestire le tabelle con cui è stato
avviato. Lo stato sarà quindi `"after-restart"`, con un `message` visualizzato come avviso
nella notifica di Studio; riavvia il processo per rendere effettiva la modifica.

## Quando il file cambia durante la modifica

Una modifica viene preparata sulla base dei file nello stato in cui si trovano. Se uno di
essi cambia su disco prima che la modifica venga applicata — a causa del salvataggio da parte
di un IDE o di un altro processo — l'applicazione non scrive nulla e restituisce l'errore
409 `SCHEMA_EDIT_STALE_FILE`. Effettua nuovamente la modifica partendo dal file nel suo
stato attuale.

## Dove funziona

La modifica dello schema live riscrive `backend/schema` con lo stesso editor utilizzato dai
salvataggi solo-sorgente del pannello (richiede l'installazione di `ts-morph`). La
provenienza di quel sorgente determina dove viene eseguita:

- **Su disco** (`schemaDir`, opzione predefinita): viene eseguito dove viene eseguito l'editor
  solo-sorgente. Tale editor è disattivato con `NODE_ENV=production`, a meno che il server
  non imposti `schemaEditor: true`.
- **In un repository specificato** (`liveSchema.repository`, oppure
  `REBASE_LIVE_SCHEMA_REPOSITORY` per un bundle): il codice sorgente viene letto da GitHub
  e la modifica vi viene registrata tramite commit; funziona quindi ovunque, inclusa la
  produzione. Questa è la modalità di attivazione (opt-in) per un bundle compilato.

| Deployment | Funziona |
|---|---|
| `rebase dev` sulla tua macchina | sì |
| Self-host con il progetto e il relativo working tree di Git montati | sì, quando `NODE_ENV` non è `production`, o con `schemaEditor: true` |
| Un bundle compilato: un'istanza self-host che esegue una build, o l'immagine pubblicata | solo se attivato tramite `REBASE_LIVE_SCHEMA_REPOSITORY` — vedi [Da un bundle compilato](#da-un-bundle-compilato) |
| Qualsiasi server con `liveSchema.repository` configurato | sì, incluso `NODE_ENV=production` |

Un bundle è un output compilato, pertanto non include il codice sorgente di `backend/schema`,
e il runtime che lo esegue disattiva l'editor solo-sorgente. A meno che non specifichi un
repository, `/api/admin/schema/status` risponde `enabled: false` con il codice
`SCHEMA_EDITOR_DISABLED`: modifica `backend/schema` in fase di sviluppo, esegui il commit
ed effettua il deploy.

### Da un bundle compilato

Un bundle non ha codice proprio da configurare, per cui l'attivazione avviene tramite
variabili d'ambiente. Non cambia nulla per un bundle che non le imposta.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

L'elenco completo è disponibile in [Configuration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un repository specificato senza credenziali valide (nessuna, entrambi i tipi, un'applicazione
GitHub App configurata a metà) o un valore diverso da `owner/name` rifiuta l'avvio, anziché
fornire un editor destinato a fallire quando qualcuno preme Apply. Lo stesso vale per la
variabile deprecata/rimossa `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, con un messaggio che indica
`REBASE_LIVE_SCHEMA_PATH`, e per un percorso che punta all'esterno del repository.

Cosa rimane invariato quando è attivo:

- È una superficie di `/api/admin`: nessuna risposta senza `schema:read`, e `/apply` richiede
  `schema:write` e una persona fisica (vedi [Chi può applicare le modifiche](#chi-può-applicare-le-modifiche)).
- La destinazione di scrittura è unicamente il repository specificato. L'editor solo-sorgente,
  che scrive i file accanto al processo, rimane disattivato.
- Ciascuna modifica viene pianificata, mostrata, sottoposta a commit e infine applicata,
  esattamente come sulla tua macchina locale.

Il processo che ha applicato la modifica la rende subito disponibile: le relative route
REST, i descrittori di `GET /api/schema/tables` e il pannello di amministrazione recepiscono
la modifica senza riavvio. Le altre repliche, e questo stesso processo dopo un riavvio,
continuano a servire le tabelle con cui è stato compilato il bundle fino a quando la tua
pipeline non compila ed esegue il deploy del commit.

Di conseguenza, una modifica attende che quella precedente sia stata resa operativa. Una
modifica pianificata rispetto a tabelle rispetto a cui il repository è già più avanti
finirebbe per sottoporre a commit file di schema generati che ometterebbero la modifica
precedente. Ogni operazione di apply genera quindi `schema.generated.ts` a partire dalle
tabelle servite da questo processo e lo confronta con la copia presente nel repository. Se
differiscono, l'operazione di apply viene rifiutata con `SCHEMA_CHANGE_FAILED`, specificando
il file, fino a quando un processo che esegue quel commit non sostituisce quello corrente.
Questo controllo legge il repository, non la memoria di questo processo, quindi è valido
attraverso riavvii, tra repliche e anche per una modifica inviata (push) da uno sviluppatore
ma non ancora distribuita. La pianificazione rimane comunque disponibile nel frattempo.

Le copie differiscono anche se il file è stato generato da un'altra versione di Rebase,
riformattato o modificato a mano. Se non c'è nulla in attesa di deploy, esegui
`rebase schema generate` con la versione utilizzata dal deployment, sottoponi a commit il
risultato ed effettua il deploy. I caratteri di fine riga e gli spazi vuoti a fine riga non
vengono considerati come differenze.

### Commit su un repository remoto

`liveSchema.repository` fa sì che il server esegua il commit di ogni modifica in un repository
GitHub tramite la Git Data API anziché eseguire `git commit` in un working tree. Non dipende
dall'attivazione dell'editor solo-sorgente: con un repository configurato, la modifica live
funziona con `NODE_ENV=production` e con `schemaEditor: false`, poiché nulla viene scritto su
questa macchina. Un bundle la configura tramite le variabili sopra indicate.

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

La directory dello schema viene quindi letta dal repository, riscritta con lo stesso editor
eseguito in locale, e le modifiche vengono inviate tramite commit attraverso la Git Data
API: un blob per file, un tree, un commit e l'aggiornamento di un ref. Nulla viene clonato
e nulla viene lasciato su disco. Viene letta l'intera directory, non solo il file modificato,
così che una relazione possa puntare a un'altra tabella e l'eliminazione di una tabella
funzioni come in locale: rifiutata finché la relazione di un'altra tabella la identifica come
target, e rimossa da `index.ts` nello stesso commit. Viene recuperata unicamente la cartella
`backend/schema`, pertanto un file di tabella che importa elementi al di fuori di essa non
può essere modificato con questa modalità.

`auth` accetta un token o un'installazione GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Utilizza il token per un singolo progetto che esegue commit su un repository di tua proprietà —
configurare un'App solo per consentire al tuo server di eseguire commit richiede troppa
complessità per una credenziale di una riga. Utilizza l'App per un control plane che gestisce
una sola chiave su molti progetti, come fa Rebase Cloud: un'unica App, un'installazione per
progetto e nessun segreto per singolo cliente da ruotare.

Il token necessita dei permessi `contents: read and write` su quel repository, e nient'altro.

Senza `liveSchema.repository`, il commit è un normale `git commit` nel working tree che
contiene `schemaDir`: nessuna autenticazione necessaria, nessun token, nessuna connessione
di rete.

Due aspetti che ne rendono sicuro l'utilizzo su un repository in cui sta lavorando qualcun
altro:

- Mette in staging **solo** i file che ha generato. Un commit dello schema che includesse
  lavoro a metà sarebbe impossibile da sottoporre a revisione, e rifiuta categoricamente di
  procedere se il tree presenta già modifiche a uno dei propri file.
- Il percorso remoto non esegue mai un aggiornamento forzato (force-update) di un ref. Se nel
  frattempo è stato integrato altro codice mentre il commit veniva generato, l'aggiornamento
  viene rifiutato: perdere silenziosamente il commit di qualcuno è peggio che fallire.

## Limitazioni

- Solo modifiche additive. Qualsiasi altra modifica viene rifiutata con una motivazione,
  poiché il percorso di ensure è l'unico meccanismo che altera lo schema e può eseguire
  unicamente aggiunte.
- Non viene scritto alcun file di migrazione. Un progetto configurato tramite boot-ensure
  non ne ha bisogno; un progetto configurato tramite migrazioni deve eseguire
  `rebase db generate`, che ne genera uno tramite Atlas con l'hash di integrità richiesto da
  Atlas.
- Solo Postgres. La funzionalità viene rilevata a livello di driver, e un driver privo di
  essa risponde con `SCHEMA_EDITING_UNSUPPORTED`.
- Un deployment le cui tabelle derivano dal database rende disponibile una modifica
  applicata dopo l'avvio successivo (`serving.status: "after-restart"`, vedi
  [Operatività immediata senza riavvio](#operatività-immediata-senza-riavvio)).

## Correlati

- [Schema Generation](/docs/cli/schema/) — le stesse modifiche da riga di comando
- [Tables](/docs/schema/) — ciò che l'editor riscrive
- [Studio](/docs/studio/) — il pannello alla base del quale si trovano queste route
