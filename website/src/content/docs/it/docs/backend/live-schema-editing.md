---
sourceHash: 7253b4b5232fa542
title: Modifica dello schema live
description: "Crea e modifica collection a fronte di un backend in esecuzione: prima committate nel repository, poi applicate."
---

L'editor dello schema nel pannello di amministrazione riscrive il codice sorgente delle tue collection. Questo funziona sulla tua macchina e da nessun'altra parte: i file di un server distribuito vengono ricostruiti dal repository a ogni deploy, quindi una modifica effettuata lì verrebbe scartata a quello successivo.

La modifica dello schema live è la risposta a questo problema. Essa **esegue il commit della modifica nel tuo repository, quindi applica il DDL** — così la modifica sopravvive al deploy successivo, poiché quest'ultimo viene generato a partire da essa.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Tutte e tre richiedono i privilegi di amministratore, come qualsiasi altra interfaccia di `/api/admin`. L'applicazione richiede un elemento in più oltre a essere amministratore — consulta [Chi può applicare](#chi-può-applicare).

## Pianifica prima di applicare

`/plan` non ha effetti collaterali. Invia tramite POST la collection come dovrebbe risultare alla fine, e ti indicherà cosa comporta la modifica:

`$ADMIN_TOKEN` è un token di accesso di amministrazione — l'`accessToken` restituito da un accesso per un account con il ruolo di amministratore. Nulla sulla macchina lo imposta per te.

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"collectionId":"posts","collection":{}}'
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
  "files": ["backend/src/schema.generated.ts", "drizzle/schema.sql"]
}
```

Non si tratta di una comodità superflua. Due dei tre verdetti sono rifiuti, e uno di essi è un rifiuto che altrimenti scopriresti solo premendo il pulsante su un database attivo.

## I tre verdetti

| Verdetto | Significato |
|---|---|
| `safe` | Il percorso di ensure all'avvio è in grado di esprimerlo e il risultato corrisponde alla tua configurazione. Applicato. |
| `diverges` | Si applica *in parte*, lasciando un database che non corrisponde alla tua configurazione — e nulla lo segnala. Rifiutato. |
| `needs-migration` | Il percorso di ensure non è affatto in grado di esprimerlo. Rifiutato. |

`diverges` è quello che vale la pena comprendere a fondo, perché queste modifiche sembrano essere andate a buon fine:

- **Una proprietà obbligatoria aggiunta a una tabella che contiene già righe** arriva come **nullable**. `NOT NULL` viene verificato a fronte di ogni riga già presente, e le righe scritte prima che la proprietà esistesse non hanno alcun valore per essa. Su una tabella **vuota** non c'è nulla da verificare, quindi il vincolo viene applicato ed è considerato `safe`.
- **Rendere obbligatoria una proprietà esistente** ha la stessa logica: `SET NOT NULL` scansiona la tabella, quindi è `safe` su una tabella vuota e `diverges` su una popolata finché non esegui un backfill.

Due modifiche che in passato risultavano `diverges` ora sono `safe`, poiché il percorso di ensure le esegue:

- **L'aggiunta di un valore a un enum esistente** va a buon fine, tramite `ALTER TYPE … ADD VALUE IF NOT EXISTS`. In precedenza veniva ignorata insieme all'intero tipo, e la prima riga che utilizzava il nuovo valore veniva rifiutata da un tipo che non lo conosceva.
- **Rendere facoltativa una proprietà obbligatoria** rimuove il vincolo `NOT NULL`. In precedenza veniva lasciato invariato, quindi le scritture che omettevano la proprietà continuavano a fallire.

### Vincoli richiesti ma non applicati

Una modifica può essere applicabile e lasciare comunque non applicato qualcosa richiesto dalla tua configurazione — come nel caso di una proprietà obbligatoria su una tabella popolata. Questo non costituisce un rifiuto, pertanto non compare in `changes`; appare invece in `withheldConstraints`, con l'ostacolo e ciò che lo risolverebbe:

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

Il percorso di ensure all'avvio segnala la stessa cosa come avviso. Prima dell'introduzione di questa funzionalità, un vincolo trattenuto veniva omesso in silenzio.

`needs-migration` copre tutto ciò che il percorso di ensure non può fare: eliminare una collection o una proprietà, modificare un tipo, rinominare una colonna, cambiare una chiave primaria, rimuovere un valore di enum. Ogni rifiuto specifica la modifica e cosa fare in alternativa.

## Cosa viene committato

Non solo il file della collection. Una modifica dello schema tocca diversi elementi generati, e un file non aggiornato comprometterebbe il deploy successivo:

- `config/collections/<name>.ts` — la collection stessa
- `backend/src/schema.generated.ts` — lo schema Drizzle
- `drizzle/schema.sql`, `drizzle/policies.sql`, `drizzle/search.sql`

Questi percorsi sono relativi al tuo **progetto**, non al tuo repository. Quando i due coincidono — un progetto `rebase init`, che rappresenta il caso comune — non c'è nulla di cui preoccuparsi. Quando il progetto si trova in una sottodirectory di un repository più grande, i percorsi includono il relativo prefisso, individuato risalendo dalla directory delle collection fino al `rebase.json` più vicino. Un progetto senza `rebase.json` mantiene i percorsi semplici.

Il messaggio di commit descrive la modifica piuttosto che limitarsi ad annunciarne una, ed è attribuito all'amministratore che l'ha effettuata. Una modifica dello schema con un autore e un diff nella cronologia del tuo progetto è qualcosa che né Firebase né Supabase offrono: le modifiche alle loro tabelle sono invisibili al tuo repository.

## Chi può applicare

Essere un amministratore è sufficiente per eseguire **plan**. La pianificazione non ha effetti collaterali, e un job CI che verifichi se una modifica proposta per una collection sia applicabile ne rappresenta un ottimo caso d'uso.

L'applicazione è un privilegio distinto, poiché applicare scrive un commit e un commit reca con sé un autore:

| Chiamante | Plan | Apply |
|---|---|---|
| Un amministratore autenticato | sì | sì |
| Una chiave API | sì | no |
| La service key del server | sì | no |

Una credenziale non è un autore. `api-key:7c3f…` nel tuo ambiente di CI non è una persona fisica, e consentirle di scrivere nel repository produrrebbe esattamente quella cronologia non attribuibile che questa funzionalità è stata concepita per rimpiazzare.

Se ciò che desideri è una modifica automatizzata dello schema — ad esempio una pipeline di migrazione — attivala esplicitamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oppure `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Il commit viene quindi attribuito alla credenziale per nome — `Rebase API key (7c3f)` — in modo tale che, leggendo il `git log` a distanza di un mese, sia ancora possibile distinguere le modifiche apportate da una persona.

`GET /api/admin/schema/status` segnala ciò che *tu* sei autorizzato a fare, non soltanto ciò che il server supporta, consentendo così a un pannello di disabilitare il controllo spiegandone il motivo, invece di rifiutare l'operazione dopo che hai già deciso di procedere:

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

L'applicazione in questo contesto **non** scrive una migrazione, e non può farlo: una migrazione adotta il formato di Atlas con un file di integrità, generato da un binario esterno a fronte di un database usa e getta, e un server in esecuzione non dispone di nessuno dei due.

Ciò che invece scrive è `drizzle/schema.sql` — esattamente il file con cui `rebase db generate` calcola il diff. Di conseguenza, la migrazione è a portata di un solo comando:

```bash
rebase db generate
```

Sia il plan sia il risultato lo segnalano esplicitamente quando il progetto prevede migrazioni, poiché in caso contrario il problema passerebbe inosservato: il database conterrebbe la modifica e il repository la descriverebbe, ma l'ambiente successivo configurato rieseguendo le migrazioni non la conterrebbe, senza alcun avviso.

Un progetto configurato tramite boot-ensure — il runtime gestito e qualsiasi self-host che mantenga `REBASE_MIGRATE_ON_BOOT` sul valore predefinito — non necessita di alcuna migrazione. Le sue collection costituiscono lo schema, e l'avvio successivo si occupa della riconciliazione.

## Prima il commit, poi l'applicazione

L'ordine è importante e non è arbitrario.

Se il DDL venisse eseguito per primo e il commit fallisse, il database avrebbe una colonna non descritta dal repository. Il percorso di ensure non elimina mai nulla, quindi il deploy successivo non la rimuoverebbe né la segnalerebbe — una colonna invisibile, assente dalle tue collection, finché qualcuno non andasse a cercarla.

Eseguire prima il commit fallisce nel modo opposto: il repository descrive qualcosa che il database non possiede ancora. Questo è lo stato ordinario di ogni progetto nell'intervallo tra una modifica e un deploy, e la fase di boot lo riconcilia all'avvio successivo.

Pertanto, un'applicazione fallita **non è un errore**. La risposta lo indica chiaramente:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Dove funziona

La linea di demarcazione è rappresentata dalla presenza o meno del **codice sorgente su disco** sul server in esecuzione — non dal fatto che si tratti o meno di produzione.

### MongoDB

Tutto quanto descritto sopra riguarda Postgres, dove una modifica dello schema si traduce in istruzioni DDL. Su MongoDB non ci sono tabelle da alterare: l'aggiunta di una proprietà non aggiunge nulla, la sua rimozione non rimuove nulla, e un documento scritto ieri rimane valido anche domani.

Di conseguenza, ogni modifica è applicabile, nulla viene mai rifiutato e il piano non contiene istruzioni — il commit *è* la modifica stessa. Il pannello mostra "Commit" anziché "Commit and apply", e non asserisce che sia stato eseguito alcunché sul database.

L'unico aspetto che merita un'attenta lettura è la rimozione. Su Postgres la rimozione di una proprietà viene rifiutata perché comporterebbe l'eliminazione di una colonna. Su MongoDB il campo rimane in ogni documento che lo contiene; la tua API smette semplicemente di restituirlo. La modifica lo esplicita chiaramente, evitando di lasciare presumere il comportamento tipico dei database relazionali.

| Distribuzione | Funziona |
|---|---|
| `rebase dev` sulla tua macchina | sì |
| Self-host con il progetto montato | sì |
| Self-host da un bundle compilato | sì, con `liveSchema.repository` |
| Rebase Cloud o qualsiasi bundle | sì, con `liveSchema.repository` |

Un bundle è un output compilato, quindi non contiene il sorgente delle collection. Configura `liveSchema.repository` e il sorgente verrà recuperato direttamente dal tuo repository; in caso contrario, le route risponderanno con `SCHEMA_EDITING_NO_REPOSITORY` spiegandone la ragione.

### Una distribuzione senza sorgente su disco

Un bundle è un output compilato — vale per ogni tenant Cloud e per qualunque installazione self-host che utilizzi una build. L'editor non ha a disposizione il sorgente delle collection da riscrivere, per cui è necessario puntarlo verso il repository in cui risiede effettivamente il codice:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where the collection source lives in that repository.
            // Defaults to "config/collections".
            collectionsPath: "config/collections",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

La modifica viene quindi letta dal repository, riscritta con lo stesso editor utilizzato in locale e committata nuovamente tramite le Git Data API: un blob, un tree, un commit e l'aggiornamento di un ref. Nulla viene clonato e nulla viene lasciato su disco.

`auth` accetta un token o un'installazione di una GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Utilizza il token per un singolo progetto che esegue commit su un repository già di tua proprietà — configurare un'App solo per permettere al tuo server di committare richiede troppa complessità burocratica per una credenziale su una sola riga. Utilizza invece l'App per un control plane che gestisce un'unica chiave condivisa tra più progetti, esattamente come fa Rebase Cloud: una sola App, un'installazione per ciascun progetto e nessun segreto specifico per singolo cliente da ruotare.

Il token richiede il permesso `contents: read and write` su quel repository, e nient'altro.

Su una macchina in cui è presente il repository, il commit è un semplice `git commit` — nulla da autenticare, nessun token, nessuna rete. Una distribuzione che ne è priva esegue invece il commit tramite le Git Data API, senza clonare nulla — vedi [Una distribuzione senza sorgente su disco](#una-distribuzione-senza-sorgente-su-disco).

Due aspetti rendono sicura l'esecuzione a fronte di un repository su cui sta lavorando qualcun altro:

- Esegue lo stage dei **soli** file che ha generato. Un commit dello schema che inglobasse lavori a metà sarebbe impossibile da revisionare; pertanto, l'operazione viene categoricamente rifiutata se nell'albero risulta già modificato uno dei propri file.
- Il percorso remoto non esegue mai un aggiornamento forzato di un ref. Se qualcosa è stato inviato mentre il commit veniva generato, l'aggiornamento viene rifiutato: perdere silenziosamente il commit di qualcuno è peggio di un fallimento dell'operazione.

## Limitazioni

- Solo modifiche additive. Tutto il resto viene rifiutato con una motivazione, poiché il percorso di ensure è l'unico elemento a modificare uno schema e può eseguire solo aggiunte.
- Non viene scritto alcun file di migrazione. Un progetto configurato tramite boot-ensure non ne ha bisogno; un progetto configurato con migrazioni dovrebbe eseguire `rebase db generate`, che ne genera uno tramite Atlas con l'hash di integrità richiesto da Atlas.
- Solo Postgres. La funzionalità viene rilevata sul driver, e gli altri motori rispondono con `SCHEMA_EDITING_UNSUPPORTED`.

## Correlati

- [Generazione dello schema](/docs/cli/schema/) — le stesse modifiche da riga di comando
- [Definizione delle collection](/docs/collections/) — ciò che l'editor sta riscrivendo
- [Studio](/docs/studio/) — il pannello accessibile dietro queste route
