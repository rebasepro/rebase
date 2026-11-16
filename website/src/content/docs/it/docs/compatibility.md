---
sourceHash: 717728adb9ef96cc
slug: it/docs/compatibility
title: Compatibilità
description: Ciò che Rebase garantisce tra le versioni e ciò che non garantisce — i sei contratti con versione, come fallisce ciascuno di essi e cosa potrebbe ancora cambiare in una minor.
---

Ciò che Rebase garantisce tra le diverse versioni, e ciò che non garantisce.

Questo è il documento da leggere prima di modificare qualsiasi elemento da cui dipende già un
progetto distribuito o un tenant Rebase Cloud in esecuzione. È anche la risposta onesta alla domanda:
"se sviluppo su Rebase oggi, cosa rischia di rompersi in seguito?"

## Cosa significa "beta" in questo contesto

Rebase è in beta pubblica. La maggior parte dei progetti usa questa parola per indicare che "tutto può
rompersi", il che non fornisce al lettore alcuna base su cui pianificare; ecco quindi la linea
che questo progetto traccia effettivamente:

> **L'API su cui scrivi può cambiare in una minor, con una voce nel changelog.
> I tuoi dati non possono rompersi silenziosamente.**

La prima metà è il normale comportamento di una versione `0.x` ed è descritto di seguito. La seconda
metà è la parte che vale la pena verificare, perché si tratta di un'affermazione su meccanismi concreti
piuttosto che su intenzioni: i contratti con versione nella sezione successiva sono ciascuno impresso
in un artefatto o in un database, ognuno viene verificato all'avvio o all'acquisizione (intake), e ciascuno
**fallisce in modo esplicito e specifico** anziché degradare. Un push dello schema che comporterebbe
l'eliminazione di una colonna viene rifiutato da un gate distruttivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e il percorso di aggiornamento
stesso è un test: `upgrade-e2e.test.ts` ripristina i database nello stato in cui li avevano lasciati le
versioni precedenti, esegue l'attuale percorso di migrazione su ciascuno di essi e verifica che
le righe sopravvivano — non semplicemente che l'avvio sia riuscito.

Cosa significa effettivamente beta: mancano ancora delle funzionalità, alcuni sottosistemi sono più
recenti di altri, e la natura di un'imperfezione è che qualcosa risulti assente o poco pratico,
non che corrompa silenziosamente i dati. Lo stato di ciascun sottosistema viene pubblicato
e datato anziché lasciato da scoprire — la tabella seguente costituisce tale pubblicazione.

## Stato di prontezza per sottosistema

**Ultima revisione il 14 settembre 2026, rispetto alla 0.21.0.** Rileggilo a ogni minor; una
valutazione che non è cambiata in tre release è o consolidata o dimenticata, e
questa nota serve proprio a verificare tale differenza.

Le tre valutazioni significano:

- **Stabile** — la struttura è consolidata e coperta da un gate in CI. Può ancora
  ricevere nuove funzionalità; non verrà riprogettata alle tue spalle all'interno della 0.x, e qualsiasi
  modifica che possa causare rotture verrà annunciata nel changelog.
- **Beta** — funziona ed è utilizzato in produzione, ma presenta aspetti notoriamente
  grezzi: un limite raggiungibile, un caso limite scomodo, una decisione architetturale
  non ancora presa. La parte grezza viene esplicitata nelle note, poiché "beta" da solo
  non fornisce informazioni utili su cui pianificare.
- **Sperimentale** — rilasciato per consentirne l'uso e la segnalazione di feedback. Aspettati di
  imbatterti in aree non ancora esplorate da nessuno.

| Sottosistema | Valutazione | Su cosa si basa la valutazione |
|---|---|---|
| REST API + SDK generato | Stabile | Il wire contract è versionato e protetto da gate; `client-sdk-e2e` guida register → sign-in → letture con ambito RLS → refresh → storage → realtime end-to-end |
| Auth — email/password, OAuth, OIDC, magic link, codice monouso | Stabile | Sono inclusi dodici provider OAuth. Lo schema di autenticazione è un contratto con versione, impresso e verificato all'avvio |
| Auth — MFA (TOTP) | Beta | Registrazione, verifica e recupero funzionano e sono testati. La rotazione delle chiavi è implementata per la chiave di crittografia; non esiste un'interfaccia di amministrazione per reimpostare il fattore di un utente bloccato |
| Row-level security | Stabile | Il punto di forza del prodotto. `pnpm rls:check` verifica un database attivo rispetto a quindici controlli, e la suite e2e RLS viene eseguita a ogni push |
| Storage | Stabile | Locale, S3 e GCS. Default-deny in produzione a partire dalla versione 0.17.0, e lo scaffold include un hook authorize |
| Realtime | **Beta** | Ogni frame è una lettura sotto l'ambito RLS specifico del proprio sottoscrittore. I socket di un utente su un elenco condividono tale lettura, e un elenco filtrato su una colonna della riga (`where owner == me`) viene interrogato solo quando una scrittura può raggiungerlo: 5.000 utenti che osservano ciascuno le proprie righe costano **una** sola lettura per scrittura, con ~305 ms per la consegna (misurato, `tooling/scripts/bench-realtime-fanout.mts`). Il limite è rappresentato da un elenco ristretto solo da RLS: una lettura per utente distinto per scrittura, quindi 5.000 utenti sullo stesso elenco non filtrato equivalgono a 5.000 letture e a ~2,6 s per completare il fan-out. Corretto a qualsiasi scala; filtra sulla colonna letta dalla policy per rimanere a una sola lettura |
| Vector search (pgvector) | Beta | Ogni colonna vettoriale riceve per impostazione predefinita un indice HNSW per la distanza del coseno, regolabile per colonna tramite `col.vector({ dimensions, index })` (metodo, distanze, parametri di compilazione) o disattivabile, lasciando una scansione esatta. pgvector non può indicizzare una colonna più ampia di 2.000 dimensioni, pertanto queste rimangono non indicizzate ed eseguono una scansione |
| Offline sync | Beta | Le mutazioni includono chiavi di idempotenza rispettate dal server, e i difetti di perdita di dati rilevati durante l'audit di luglio sono stati corretti. Il modello di conflitto è last-write-wins senza merge per campo |
| Entity history | Stabile | Basato su snapshot, protetto da una suite dedicata |
| Functions e cron job | Stabile | L'entry point portabile (`@rebasepro/server/functions`) è un contratto con versione con una propria sezione API-surface |
| Server MCP + agent skills | Beta | `@rebasepro/mcp` viene eseguito su stdio: cinquantatré tool, bearer auth per progetto, i tool distruttivi rifiutano target non locali a meno che non vi sia un opt-in esplicito. Dalla 0.21 il server può anche montare un endpoint `/mcp` remoto — OAuth 2.1, diciassette tool di dati (i quattro per le saved app sono sperimentali), ogni chiamata sotto l'RLS dell'utente autenticato — disattivato a meno che `REBASE_MCP_ENABLED=true`, e solo per Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizzato quotidianamente su progetti reali. Il branching è presente nel pacchetto OSS e deliberatamente non esposto in Rebase Cloud, poiché il passaggio di una distribuzione attiva su un branch non è ancora supportato |
| CMS + admin panel | Beta | Completo per CRUD, relazioni, campi di storage e ruoli. **La tabella dati non possiede semantica di griglia** — nessun `role`, nessun `aria-rowindex`, `tabIndex` rimosso — pertanto gli utenti con tastiera e screen reader non possono utilizzare la vista principale. Nessuna bozza, nessun contenuto per locale, nessun rich-text a blocchi |
| Database di sviluppo gestito PGlite | Beta | `rebase dev` senza configurazione e senza Docker. Una sessione alla volta, quindi le richieste vengono serializzate e la concorrenza non può essere riprodotta; i comandi basati su Atlas (`db push`, `generate`, `migrate`) pianificano le modifiche su una seconda istanza PGlite temporanea avviata per il comando; `db branch` non funziona in questo contesto e restituisce un messaggio apposito |
| Helm chart | Beta | Esegue il rendering della topologia split-process e viene pubblicato nel registry OCI a ogni release. L'impostazione predefinita rimane un singolo container |
| `@rebasepro/firebase` | Sperimentale | Firestore come sorgente che l'admin panel legge direttamente, accanto alle tabelle del backend: `defineFirestoreCollection` in `frontend/src/cms`, passata come `externalCollections`. Nessuna RLS, nessuna interfaccia SQL; il set di funzionalità di Postgres non viene trasferito. Il driver Firestore ignora i gruppi di filtri `or(...)`/`and(...)`, quindi una query che ne utilizza uno legge tutte le righe consentite dai suoi filtri semplici |
| Rebase Cloud | **Beta privata** | Attivo, esegue tenant reali, con accessi aperti a scaglioni. Non self-service |

Due delle voci sopra riportate rappresentano il costo onesto della pubblicazione stessa di questa tabella: il
fan-out in tempo reale per gli elenchi limitati solo da RLS e l'accessibilità della tabella dati
sono limitazioni aperte, non elementi della roadmap, ed entrambe sono elencate anziché
lasciate alla scoperta del lettore.

Questa tabella rappresenta ciò che esiste. Ciò che non esiste ancora si trova sulla
[roadmap](https://rebase.pro/roadmap), con una voce per ciascuna issue di GitHub,
contrassegnando il sottoinsieme richiesto per la 1.0.

## La promessa delle versioni 0.x

Rebase è nella serie `0.x`. Questa sezione è scritta per essere valida per ogni release 0.x anziché
per una sola di esse, in modo da non diventare obsoleta a ogni taglio di versione. **Le breaking change all'API
TypeScript scritta dall'utente sono ancora consentite in una versione minor**, e il changelog è
il luogo in cui vengono annunciate. Ciò che
*non* è consentito rompere silenziosamente è l'insieme di contratti con versione riportati di seguito: ciascuno
di essi è impresso in un artefatto o in un database, ognuno viene verificato all'avvio o all'acquisizione,
e ciascuno fallisce in modo **esplicito e specifico** anziché degradare.

Questa distinzione è il fulcro dell'intera promessa. Un export rinominato costa un
errore di compilazione e cinque minuti. Un bundle che si avvia con il runtime errato ed eroga
dati impercettibilmente errati costa un incidente, e i contratti esistono proprio affinché la
seconda categoria non possa verificarsi silenziosamente.

Rebase Cloud consuma esattamente questi contratti e nient'altro. Tutto ciò che non è
elencato qui è un dettaglio implementativo da cui la piattaforma non dipende.

### Badge di versione e canary

La documentazione viene pubblicata dal branch `main`, quindi una pagina può descrivere qualcosa che nessuna
release stabile ancora possiede. Un badge *Since* indica la prima release stabile che include tale funzionalità,
mentre il testo accanto specifica il comportamento della release precedente.

Una build canary è una compilazione di `main` numerata in base alla release a cui sta puntando:
`0.25.0-canary.g<commit>` rappresenta `main` a quel commit, successiva a 0.24.0 e precedente a
0.25.0, e `rebase upgrade --to canary` installa la più recente. Contiene
tutto ciò che era confluito in `main` al momento della compilazione, quindi un badge che indica la sua
versione è applicabile al tuo caso, e la nota relativa alla release precedente descrive la versione stabile di provenienza.

## I contratti con versione

I valori seguenti vengono letti direttamente dal codice sorgente; considera i riferimenti ai file come l'unica
fonte di verità e questa tabella come una mappa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contratto | Dichiarato in | Verificato in | Direzione di compatibilità |
|---|---|---|---|---|
| 1 | intervallo `rebase` in `rebase.json` | il progetto dell'utente | CLI durante la build | il progetto specifica quali runtime accetta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatibile** dove il layout lo consente — il formato 3 rifiuta i formati 1 e 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | stesso file | stesso file | **corrispondenza esatta, in entrambe le direzioni** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | all'avvio, su `rebase.schema_meta` | **solo in avanti (forward only)** — un runtime più recente migra i database obsoleti |
| 5 | `manifest.schemaVersion` | emesso da `rebase build` | inviato dall'SDK come `x-rebase-schema` se configurato | informativo — identifica lo schema rispetto al quale è stato compilato un client |
| 6 | Identificatori derivati del database | `contracts/derived-names.txt` | `pnpm check:derived-names` | **bloccato (frozen)** — un nome emesso da una release non viene mai ricalcolato |

### 1 — `rebase` in `rebase.json`

Un intervallo semver, interpretato come il campo `engines` in un `package.json`: specifica quali versioni
del runtime sono accettate da questo progetto. È denominato deliberatamente `rebase` anziché `runtime`,
poiché `runtime` indica già *chi possiede il processo* (`managed` | `custom`) all'interno di un'app.

### 2 — `BUNDLE_FORMAT_VERSION` (attualmente 3)

Il layout su disco di un bundle compilato. Un runtime rifiuta un bundle il cui formato sia più
recente del proprio e ne legge uno precedente laddove il layout lo consenta; questo è ciò che
permette al piano gestito (managed tier) di trasferire un tenant su una nuova immagine senza dover
ricompilare il progetto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` una singola directory,
  `entry.admin` per un'interfaccia admin integrata.
- **2** — `kind: "backend" | "static"`, `entry.static` un elenco, `entry.admin`
  rimosso.
- **3** (0.31) — lo schema è `entry.tables`, il `backend/schema` compilato,
  accanto a `entry.resources`, `entry.storage` ed `entry.hooks`; `entry.config`,
  `entry.collections` ed `entry.usersCollection` sono stati rimossi. **I formati 1 e 2
  vengono rifiutati, non aggiornati**: includono `config/collections`, che un runtime
  progettato per leggere `backend/schema` non è in grado di interpretare, e l'avvio di uno di essi
  comporterebbe l'introspezione del database ed esporrebbe un'API differente. Il rifiuto segnala
  `rebase migrate collections-to-tables`; migra il sorgente e ricompila. Questa
  è stata l'unica rottura della retrocompatibilità, introdotta contestualmente all'avanzamento
  del contratto di runtime descritto di seguito.

**Incrementalo quando** il layout cambia in modo tale che un runtime precedente interpreterebbe
erroneamente un bundle più recente. L'incremento è ciò che converte la situazione "si avvia ma non eroga nulla"
in un rifiuto esplicito di avvio.

### 3 — `RUNTIME_CONTRACT_VERSION` (attualmente 2)

La versione major del contratto bundle↔runtime. Distinta dalla versione del pacchetto `@rebasepro/server`,
che può rilasciare qualsiasi numero di minor e patch mentre questa rimane invariata.

**Leggere attentamente prima di modificarlo.** Il controllo è `!==`, non `>`:

> un bundle destinato al contratto *N* viene eseguito **esclusivamente** su un runtime che implementa *N*

pertanto incrementarlo invalida **ogni bundle mai compilato**, contemporaneamente,
fino a quando ciascuno di essi non viene ricompilato. Questo livello di severità è intenzionale — è la leva
per stabilire che "nessuna versione precedente può essere eseguita qui" — ma significa che un incremento costituisce
una migrazione dell'intero parco istanze, non una semplice nota di rilascio. Per il livello gestito
deve essere coordinato con la ricompilazione del bundle di ciascun tenant.

Se una modifica è *additiva* e i vecchi bundle rimarrebbero corretti, richiede
`BUNDLE_FORMAT_VERSION` (o nessuna modifica), non questo. La versione 0.31 lo ha portato a 2,
con il bundle format 3: il modello di schema è cambiato e il bundle di ogni tenant viene
ricompilato dal codice sorgente migrato.

### 4 — `AUTH_SCHEMA_VERSION` (attualmente 2)

Impresso in `rebase.schema_meta` e confrontato all'avvio. Un runtime **rifiuta di avviarsi**
a fronte di un database migrato da una versione del framework più recente, anziché operare su una struttura
che non comprende — durante un rolling deploy, questa è la differenza tra metà del parco istanze
che restituisce errori e metà che corrompe i dati.

La migrazione in avanti è automatica: `ensureAuthTablesExist` aggiorna un database precedente.
Si noti che questo blocco di migrazione è deliberatamente racchiuso in un `try/catch` e genera
log anziché lanciare eccezioni — un avvio zoppicante è preferibile a un crash loop — quindi
**"si è avviato" non dimostra nulla**. Ogni asserzione nella suite di aggiornamento legge invece
il catalogo o i dati effettivi.

**Incrementalo quando** una migrazione non deve essere saltata da un runtime precedente. Non incrementarlo
per una colonna additiva e retrocompatibile; c'è un esempio pratico di tale valutazione in
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash dei descrittori di tabella compilati (`v2:…` a partire dalla 0.31), emesso nel manifest del bundle
e replicato da un SDK generato nell'header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Esiste affinché la piattaforma possa segnalare "questa app è stata compilata
per uno schema precedente" anziché fallire misteriosamente alla prima richiesta.

`rebase generate-sdk` scrive il valore in `schema.meta.ts`; passalo al
client per inviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Il backend legge tale header a ogni richiesta di dati. Il disallineamento (drift) non rifiuta mai
una chiamata — un SDK indietro di uno schema è solitamente ancora compatibile, e distribuire il
backend prima del frontend rappresenta il normale ordine di deployment — ma quando una richiesta
fallisce con un errore 400 o 404, l'errore riporta il disallineamento come causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on table \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v2:0e1c…",
      "serverSchema": "v2:9ab4…",
      "message": "This client was generated against schema v2:0e1c…; this backend serves v2:9ab4…"
    }
  }
}
```

In questo modo, una colonna rinominata viene indicata con un messaggio del tipo "il tuo SDK è obsoleto, rigeneralo"
anziché risultare come un campo che i tuoi tipi insistono a considerare presente. A una richiesta con esito positivo non viene mai notificato alcunché.

Riguarda **esclusivamente le tabelle** — i relativi descrittori compilati, in cui un hook funge da
flag di presenza. Il codice di un hook o la modifica di una funzione non altera il contratto di un client
e non deve invalidare ogni SDK generato. Poiché la 0.31 ha spostato l'hash dalle collection ai descrittori,
ogni database contrassegnato con `v1:` segnala la modifica una sola volta, con la nuova registrazione
(avviando il proprietario dello schema o tramite `rebase db push`), e ogni SDK generato risulta obsoleto una sola volta.

### Chi sta chiamando

Altri due segnali identificativi, nessuno dei quali funge da gate da solo:

- **`GET /api/meta/schema-version`** non è autenticato e risponde con lo `schemaVersion`
  del progetto *e* con il relativo `runtime` (`version` e `contract`). Un job di CI che confronta
  il proprio SDK generato con un progetto attivo non necessita di credenziali, così come un client
  che interroga il runtime con cui sta comunicando.
- **`User-Agent: rebase-cli/<version>`** viene allegato a ogni richiesta `rebase cloud`.
  Il wire format del control plane si evolve più rapidamente rispetto a quanto pubblicato su npm,
  pertanto deve poter rispondere a un client obsoleto con `CLI_TOO_OLD` e la versione minima —
  operazione possibile solo per un chiamante che dichiara la propria identità.

### 6 — Identificatori derivati del database

Ogni nome che questo framework ricava autonomamente anziché ricevere esplicitamente: una
colonna di foreign key, un vincolo di foreign key, una junction table e le sue due colonne chiave, un
tipo enum, il nome di una policy, la colonna in `snake_case` corrispondente a una chiave di colonna in `camelCase`. Dalla
versione 0.31 le tabelle vengono dichiarate con `defineTable`, che deriva esattamente gli stessi nomi che una
collection derivava per uno schema equivalente; `rebase migrate collections-to-tables`
lo dimostra per ciascun progetto confrontando l'SQL generato byte per byte.

> **Un identificatore derivato è congelato (frozen) nel momento stesso in cui una release lo emette.**

Non "congelato fino alla prossima major" — congelato. La motivazione è diversa rispetto agli
altri cinque contratti, ed è più forte. Quelli sono contrassegnati da una versione, pertanto una mancata
corrispondenza può essere *rilevata* e rifiutata. Questo no: il nome viene scritto nel database di un cliente
il giorno in cui effettua il deploy, e non c'è alcun indicatore di versione su una colonna. Ogni
database fornito da qualsiasi release mai rilasciata conserva qualsiasi valore abbia derivato,
e nessun codice in questo repository può intervenire per rinominarli tutti.

La versione 0.13 è il caso pratico. `generateForeignKeyName` ha appreso a gestire correttamente il singolare —
`categorie_id` → `category_id`, `addres_id` → `address_id` — che rappresenta senza dubbio una derivazione migliore,
e ha rotto ogni database datato con un plurale irregolare. La procedura di boot-ensure ha migrato la colonna,
preservando i dati; il file `schema.generated.ts` del progetto sottoposto a commit non lo ha fatto, e l'avvio è fallito
a causa di una colonna che esisteva. Tre commit, un nuovo seam test e una voce permanente nelle note di aggiornamento,
in cambio di un nome di colonna esteticamente migliore che nessuno aveva richiesto.

**Se una derivazione è realmente errata**, viene modificata per le tabelle create
*successivamente*, protetta da una strategia di denominazione registrata nel progetto — mai
retroattivamente e mai come effetto collaterale del miglioramento della funzione sottostante.

**L'unico override legittimo** è una modifica che allinea il codice a un nome che il database
*ha già*. Il caso pratico è il troncamento degli identificatori: Postgres tronca silenziosamente
un identificatore a 63 byte, quindi un nome di vincolo derivato più lungo non è mai stato presente
nel catalogo con quel nome — la derivazione descriveva un oggetto che non esisteva con quella specifica grafia,
e boot-ensure rieseguiva `ADD CONSTRAINT` a ogni singolo avvio perché il confronto non poteva mai corrispondere.
Il troncamento in fase di costruzione modifica ciò che questo repository *deriva* e non cambia nulla di ciò che
qualsiasi database distribuito *contiene*. Questo è il criterio da applicare: non "il nuovo nome è migliore?",
ma "un qualsiasi database esistente deve cambiare?".

L'altro caso in cui un nome può cambiare si verifica quando un insieme di nomi non potrebbe mai coesistere.
Una regola estesa su diverse operazioni su una tabella di 42 byte o più derivava
`<table>_default_admin_write_insert`, `_update` e `_delete`, e tutti e tre venivano troncati agli stessi
63 byte. Postgres memorizzava una sola policy, DELETE, e rifiutava qualsiasi INSERT e UPDATE amministrativo.
Solo quando i nomi di una regola entrano in conflitto in questo modo, vengono derivati partendo dal suffisso,
come `<head>_<hash8>_<op>`. Ogni nome attualmente funzionante mantiene la propria forma. Il successivo avvio
o push elimina la policy troncata e crea una policy per ciascuna operazione.

L'unica operazione sempre sicura è *riconoscere* un vecchio nome per migrarlo:
`legacyForeignKeyName` esiste per essere rilevato, mai per essere generato, e la baseline blocca anche
questi rilevamenti. Eliminarne uno annulla silenziosamente la migrazione di ogni database che utilizza ancora
quella dicitura.

**Il gate.** `tooling/scripts/derived-names.mts` esegue una fixture di stress sui nomi — plurali
irregolari, una desinenza in `ss`, un acronimo, una junction generata da uno slug plurale, override
espliciti, uno slug sufficientemente lungo da essere troncato — attraverso entrambi i generatori di DDL dello schema,
e genera ogni identificatore definito da ciascuno di essi:

```bash
pnpm check:derived-names
```

Una riga modificata o rimossa fallisce come violazione del contratto, mostrando la vecchia e la nuova dicitura
affiancate. Anche una modifica puramente additiva fallisce, ma con l'istruzione "regenerate" — in modo tale
che la baseline non possa subire deviazioni all'insaputa di nessuno.

Garantisce inoltre che `rebase db push` e il boot-ensure del runtime gestito derivino gli *stessi* nomi,
il che costituisce un secondo contratto implicito all'interno del primo: compilano le medesime tabelle attraverso
codice differente, e un progetto inviato una volta con push e avviato successivamente non deve ritrovarsi con due schemi diversi.

## Cosa *non* è bloccato

Esposto chiaramente, affinché nessuno deduca una promessa mai fatta:

- L'API TypeScript scritta dall'utente — `defineTable` e `customizeTable`, opzioni di
  `initializeRebaseBackend`, props dell'admin, nomi dei metodi dell'SDK. La versione 0.31 ha sostituito le collection
  con le tabelle in una minor, con un codemod che dimostra l'invarianza dell'SQL generato. Le breaking change
  vengono introdotte nelle minor e sono annunciate nel changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — questi si evolvono più rapidamente e contano il minor numero di utilizzatori.
- Qualsiasi elemento all'interno della directory `src/` di un pacchetto che non sia riesportato dal relativo file barrel.
  `packages/client/src/index.ts` include una nota che spiega come il proprio elenco di esportazioni
  sia curato meticolosamente per evitare che un export interno diventi pubblico accidentalmente.
- Lo schema di database delle *tue* tabelle. Quello appartiene a te; Rebase gestisce unicamente
  lo schema `rebase` (e, su un database configurato prima della 0.13, il vecchio schema `auth`
  finché l'avvio non lo dismette definitivamente).

## I gate a presidio di queste regole

Nulla di quanto sopra è una semplice convenzione — ognuno di questi punti dispone di un test che fallisce in caso di violazione:

| Gate | Cosa vincola |
|---|---|
| `pnpm verify:corpus` | ogni struttura di bundle mai rilasciata, avviata sul runtime attuale. Le fixture in `tests/fixtures/bundles/` sono **scritte a mano e bloccate** — una fixture rigenerata dal builder cambierebbe ogni volta che il builder viene modificato |
| `pnpm verify:selfhost` | un bundle reale compilato, impacchettato, avviato e interrogato esattamente come farebbe un browser |
| `upgrade-e2e.test.ts` | vecchi schemi di database (`schema-snapshots/`) gestiti dal runtime corrente |
| `tests/e2e/tests/cli-init-e2e.ts` | un progetto generato tramite scaffolding e installato da **tarball reali**, non da collegamenti del workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | il percorso dell'utente finale: register → sign in → letture con ambito RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | ogni nome di colonna, vincolo, junction, enum e policy derivato dal framework — verificando inoltre che boot e `db push` li derivino in modo identico |
| `pnpm rls:check` | le policy dello schema generato |
| `pnpm check:api-surface` | ogni export e i relativi membri dei cinque pacchetti forniti dall'immagine — `@rebasepro/server`, `types`, `client`, `common`, `utils` — oltre all'entry point `@rebasepro/server/functions`, rispetto alle sei sezioni di `contracts/server.api.txt`. Questi sono i pacchetti per cui `infra/docker/entrypoint.mjs` crea collegamenti simbolici sulle copie del bundle distribuito, quindi la rimozione di un export da uno di essi non è un errore di compilazione per nessuno — è un errore di avvio per l'intero parco istanze, durante un rollout che nessuno ha richiesto |
| `pnpm test:gates` | i test interni dei gate stessi, eseguiti sulle fixture — quarantasette file, tra cui `check:api-surface` e il controllo release-bump descritto sotto — in modo che un gate che smette di monitorare ciò che dovrebbe proteggere fallisca qui. `check:api-surface` ha trascorso la sua intera esistenza incapace di rilevare la scomparsa di un membro da `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | che il livello di incremento (bump) associato a una release corrisponda a quanto modificato rispetto alle baseline sopra indicate — eseguito da `publish.yml` prima che il changelog venga registrato |
| saas CI | il control plane compilato rispetto al branch `main` di questo repository, sui propri push e ogni notte (nightly) |

**Registra una fixture del bundle e uno snapshot dello schema una volta per release.** Il valore
di entrambi i corpus risiede interamente nell'anzianità del reperto più vecchio, e nessuno dei due può
essere ricostruito retroattivamente.

### Non ancora protetto da gate

La tabella sopra rappresenta ciò che viene garantito. Di seguito sono riportate le parti della policy non
ancora presidiate, elencate affinché nessuno vi legga promesse inesistenti:

- **Nessuna finestra di deprecazione o supporto.** Finché Rebase è nella versione `0.x`, non esiste
  una regola scritta che stabilisca per quanto tempo un export deprecato sopravviva prima della rimozione, o per quanto tempo
  una versione minor precedente riceva correzioni. Le correzioni di sicurezza vengono applicate esclusivamente sull'ultima minor.
- **Il formato HTTP wire non ha alcun gate.** Nessuno script `check:*` calcola il diff delle strutture
  di richiesta e risposta rispetto a una baseline come fa `check:api-surface` per gli export; una modifica
  nella struttura delle risposte viene rilevata solo da una suite e2e che si trovi per caso a leggerla.
- **I flag della CLI non hanno una baseline di compatibilità.** Lo strumento di verifica della documentazione fallisce
  se scompare un flag utilizzato dalle skill, dagli esempi o dal sito di marketing; nessun controllo
  rileva la rimozione di qualsiasi altro flag o un cambio del suo significato.
- **Una release da CI non registra nessuno dei due corpus.** Il workflow di pubblicazione non registra alcuna fixture
  di bundle né alcuno snapshot di schema; solo lo script di rilascio locale tenta di farlo, e genera un avviso
  anziché interrompersi quando non ci riesce. Dalla 0.18 alla 0.21 non è presente alcuno snapshot di progetto registrato.
- **La superficie degli export è un gate, non un contratto.** La decisione se le esportazioni pubbliche
  dei pacchetti forniti dal runtime debbano diventare un settimo contratto numerato — dichiarato come baseline di
  `check:api-surface`, compatibile in modo additivo all'interno di una major del contratto — rimane ancora aperta.

## Modificare un contratto

1. Determina quale dei sei contratti viene coinvolto. La maggior parte delle modifiche non riguarda
   nessuno di essi — ma "nessuno dei sei" non significa "privo di rischi". Rimuovere o rinominare
   un export di `@rebasepro/server`, o un suo membro, non appartiene a nessuno dei sei ed è la modifica
   più pericolosa in assoluto in questo repository, poiché il codice che va a rompere è già compilato
   e non verrà ricompilato. `pnpm check:api-surface` è ciò che presidia questo limite; se debba diventare
   un settimo contratto numerato è una decisione ancora aperta (vedi *Non ancora protetto da gate*, sopra).
2. Aggiungi prima una fixture o uno snapshot per la **vecchia** struttura e verifica che il test passi.
3. Applica la modifica e incrementa la costante.
4. Verifica che la vecchia fixture passi ancora, oppure che fallisca *con il messaggio necessario all'utente*.
   Entrambi sono esiti validi; il silenzio non lo è.
5. Per il contratto 3, pianifica la ricompilazione di ogni bundle distribuito prima di procedere con il merge.
6. Il contratto 6 rappresenta l'eccezione ai passaggi 3 e 4: non c'è alcuna costante da incrementare
   né alcuna versione su cui opporre un rifiuto, poiché una colonna non reca alcun indicatore di versione.
   Il passaggio alternativo consiste nel decidere di non applicare la modifica — consulta la sezione
   precedente per vedere quale sia l'alternativa.

## Risorse correlate

- [Aggiornamento](/docs/upgrading/) — cosa si è effettivamente rotto, release per release
- [Changelog](/docs/changelog/) — ogni modifica, comprese quelle che non hanno rotto nulla
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contratto 3 — il formato di bundle rispetto al quale un progetto distribuito è già compilato
