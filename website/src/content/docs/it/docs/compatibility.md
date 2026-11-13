---
sourceHash: fb9fac4af8dcfaaf
slug: it/docs/compatibility
title: Compatibilità
description: Cosa garantisce Rebase tra le versioni e cosa no — i sei contratti con controllo di versione, come fallisce ciascuno di essi e cosa potrebbe ancora cambiare in una versione minor.
---

Cosa garantisce Rebase tra le versioni e cosa no.

Questo è il documento da leggere prima di modificare qualsiasi elemento da cui dipende già un
progetto distribuito o un tenant attivo su Rebase Cloud. È anche la risposta sincera alla
domanda: "se sviluppo su Rebase oggi, cosa rischia di rompersi in seguito?"

## Cosa significa "beta" in questo contesto

Rebase è in beta pubblica. La maggior parte dei progetti usa questa parola per intendere "tutto
potrebbe rompersi", il che non fornisce al lettore alcuna informazione utile per pianificare;
ecco quindi la linea di demarcazione tracciata da questo progetto:

> **L'API su cui scrivi codice può cambiare in una release minor, con una voce nel changelog.
> I tuoi dati non possono corrompersi silenziosamente.**

La prima parte è il normale comportamento di una `0.x` ed è descritta di seguito. La seconda
parte è quella che merita attenzione, perché si tratta di un'affermazione riguardante meccanismi
concreti piuttosto che intenzioni: i contratti con controllo di versione nella sezione successiva
sono impressi in un artefatto o in un database, ciascuno viene controllato all'avvio o durante
l'acquisizione, e ciascuno **fallisce in modo rumoroso e specifico** invece di degradare. Un push
dello schema che comporterebbe l'eliminazione di una colonna viene rifiutato da un gate distruttivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e il percorso di aggiornamento
stesso è un test: `upgrade-e2e.test.ts` ripristina i database nello stato in cui li hanno lasciati
le release precedenti, esegue il percorso di migrazione attuale su ciascuno di essi e verifica che
le righe sopravvivano — non solo che l'avvio sia riuscito.

Cosa significa effettivamente beta: mancano ancora delle funzionalità, alcuni sottosistemi sono
più recenti di altri e la natura di un'imperfezione è che qualcosa sia assente o poco pratico, non
che corrompa qualcosa in modo silente. Lo stato dei vari sottosistemi è pubblicato e datato anziché
lasciato da scoprire all'utente — la tabella sottostante rappresenta tale pubblicazione.

## Idoneità per sottosistema

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Ultima revisione il 14 settembre 2026, rispetto alla versione 0.21.0.** Rileggila a ogni versione
minor; una valutazione rimasta invariata per tre release è consolidata oppure è stata dimenticata,
e questa nota serve proprio a verificarne la differenza.

I tre livelli di valutazione indicano:

- **Stabile** — la struttura è consolidata e coperta da un gate in CI. Può ancora acquisire nuove
  funzionalità; non verrà riprogettata all'improvviso all'interno della 0.x, e qualsiasi modifica
  che comporti breaking change verrà annunciata nel changelog.
- **Beta** — funziona ed è utilizzato in produzione, ma contiene aspetti noti come imperfetti: un
  limite raggiungibile, un caso limite scomodo, una decisione di progettazione non ancora presa.
  La parte da perfezionare è specificata nelle note, perché la parola "beta" da sola non dice nulla
  su cui pianificare.
- **Sperimentale** — rilasciato per poter essere utilizzato e testato. Aspettati di imbatterti in
  aree ancora inesplorate.

| Sottosistema | Valutazione | Su cosa si basa la valutazione |
|---|---|---|
| API REST + SDK generato | Stabile | Il wire contract è versionato e protetto da gate; `client-sdk-e2e` gestisce registrazione → accesso → letture con ambito RLS → refresh → storage → realtime end to end |
| Auth — email/password, OAuth, OIDC, magic link, codice monouso | Stabile | Include dodici provider OAuth. Lo schema di autenticazione è un contratto con controllo di versione, impresso e verificato all'avvio |
| Auth — MFA (TOTP) | Beta | Registrazione, verifica e recupero funzionano e sono testati. La rotazione delle chiavi è implementata per la chiave di cifratura; non esiste un'interfaccia di amministrazione per reimpostare il fattore di un utente bloccato |
| Row-level security | Stabile | Il punto di forza del prodotto. `pnpm rls:check` verifica un database attivo a fronte di quindici controlli e la suite e2e RLS viene eseguita a ogni push |
| Storage | Stabile | Locale, S3 e GCS. Rifiuto predefinito (default-deny) in produzione a partire dalla versione 0.17.0, e lo scaffold include un hook di autorizzazione |
| Realtime | **Beta** | Le sottoscrizioni corrispondono solo per percorso della tabella, quindi N sottoscrittori su una singola tabella costano N recuperi con ambito RLS per ogni scrittura. Questo limita un deployment a poche centinaia di sottoscrittori simultanei. Corretto a qualsiasi scala; costoso oltre tale soglia |
| Ricerca vettoriale (pgvector) | Beta | Per impostazione predefinita, a ogni colonna vettoriale viene assegnato un indice HNSW per la distanza del coseno, regolabile per colonna tramite `col.vector({ dimensions, index })` (metodo, distanze, parametri di build) o disattivabile, lasciando una scansione esatta. pgvector non può indicizzare una colonna con più di 2.000 dimensioni, pertanto tali colonne rimangono non indicizzate e vengono scansionate |
| Sincronizzazione offline | Beta | Le mutazioni includono chiavi di idempotenza rispettate dal server, e i difetti di perdita dati rilevati nell'audit di luglio sono stati corretti. Il modello di conflitto è last-write-wins senza merge per campo |
| Cronologia delle entità | Stabile | Basata su snapshot, protetta dalla propria suite di test |
| Funzioni e cron job | Stabile | L'entry point portabile (`@rebasepro/server/functions`) è un contratto con controllo di versione con una propria sezione dedicata alla superficie API |
| Server MCP + agent skills | Beta | `@rebasepro/mcp` viene eseguito tramite stdio: cinquantatré strumenti, autenticazione bearer per progetto, gli strumenti distruttivi rifiutano target non locali a meno che non sia esplicitamente richiesto. Dalla 0.21 il server può anche montare un endpoint `/mcp` remoto — OAuth 2.1, diciassette strumenti dati (i quattro per le app salvate sono sperimentali), ogni chiamata sotto la RLS dell'utente autenticato — disattivato a meno che non sia impostato `REBASE_MCP_ENABLED=true`, e solo Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizzato quotidianamente su progetti reali. Il branching è presente nel pacchetto OSS e deliberatamente non esposto in Rebase Cloud, poiché la migrazione di una distribuzione in esecuzione su un branch non è ancora supportata |
| CMS + pannello di amministrazione | Beta | Completo per CRUD, relazioni, campi di archiviazione e ruoli. **La tabella dati non ha semantica grid** — nessun `role`, nessun `aria-rowindex`, `tabIndex` rimosso — quindi gli utenti con tastiera e screen reader non possono utilizzare la vista principale. Nessuna bozza, nessun contenuto per lingua (locale), nessun rich text a blocchi |
| Database di sviluppo gestito PGlite | Beta | `rebase dev` a configurazione zero senza Docker. Una sola sessione alla volta, quindi le richieste vengono serializzate e la concorrenza non può essere riprodotta su di esso; i comandi basati su Atlas (`db push`, `generate`, `migrate`) pianificano su una seconda istanza PGlite temporanea avviata per il comando; `db branch` non funziona in questo contesto e viene segnalato chiaramente |
| Helm chart | Beta | Esegue il rendering della topologia a processi separati e viene pubblicato nel registro OCI a ogni release. Il default rimane un singolo container |
| `@rebasepro/firebase` | Sperimentale | Firestore come sorgente che il pannello di amministrazione legge direttamente, accanto alle tabelle del backend: `defineFirestoreCollection` in `frontend/src/cms`, passato come `externalCollections`. Nessuna RLS, nessuna interfaccia SQL; il set di funzionalità di Postgres non viene trasferito. Il driver Firestore ignora i gruppi di filtri `or(...)`/`and(...)`, quindi una query che ne usa uno legge ogni riga consentita dai suoi filtri semplici |
| Rebase Cloud | **Private beta** | Attivo, ospita tenant reali, aperto a scaglioni. Non self-service |

Due voci sopra riportate rappresentano il prezzo in termini di trasparenza nel pubblicare questa
tabella: il refetch in realtime e l'accessibilità della tabella dati sono difetti aperti, non
elementi della roadmap, ed entrambi sono elencati anziché lasciati alla scoperta del lettore.

Questa tabella rappresenta ciò che esiste. Ciò che non c'è ancora si trova sulla
[roadmap](https://rebase.pro/roadmap), una voce per ogni issue di GitHub, con il
sottoinsieme richiesto per la versione 1.0 contrassegnato.

## La promessa della versione 0.x

Rebase è una `0.x`. Questa sezione è scritta per essere valida per ogni release 0.x anziché per
una specifica, in modo da non diventare obsoleta a ogni taglio. **I breaking change all'API
TypeScript creata sono ancora consentiti in una release minor**, e il changelog è il luogo in cui
vengono annunciati. Ciò che *non* è consentito rompere silenziosamente è l'insieme dei contratti
con controllo di versione riportati di seguito: ciascuno di essi è impresso in un artefatto o in
un database, ciascuno viene controllato all'avvio o all'acquisizione, e ciascuno fallisce in modo
**rumoroso e specifico** anziché degradare.

Questa distinzione è l'intera promessa. Un export rinominato ti costa un errore di compilazione
e cinque minuti. Un bundle che si avvia con un runtime errato e serve dati sottilmente errati
ti costa un incident, e i contratti esistono affinché questa seconda categoria non possa
verificarsi silenziosamente.

Rebase Cloud utilizza esattamente questi contratti e nient'altro. Tutto ciò che non è elencato
qui è un dettaglio implementativo da cui la piattaforma non dipende.

### Badge di versione e canary

La documentazione è pubblicata da `main`, quindi una pagina può descrivere qualcosa che nessuna
release stabile possiede ancora. Un badge *Since* indica la prima release stabile che lo include,
e il testo accanto descrive cosa fa la release precedente.

Una canary è una build di `main` numerata come la release verso cui è indirizzata:
`0.25.0-canary.g<commit>` rappresenta `main` a quel commit, dopo la 0.24.0 e prima della 0.25.0,
e `rebase upgrade --to canary` installa la più recente. Contiene tutto ciò che era confluito in
`main` al momento della compilazione, quindi un badge che ne indica la versione è valido per te,
e la nota sulla release precedente descrive la versione stabile da cui provieni.

## I contratti con controllo di versione

I valori sottostanti sono letti dal codice sorgente; considera i riferimenti ai file come la
verità e questa tabella come la mappa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contratto | Dichiarato in | Controllato in | Direzione di compatibilità |
|---|---|---|---|---|
| 1 | Intervallo `rebase` in `rebase.json` | progetto dell'utente | CLI durante la build | il progetto dichiara quali runtime accetta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatibile** dove la struttura lo consente — il formato 3 rifiuta i formati 1 e 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | stesso file | stesso file | **corrispondenza esatta, in entrambe le direzioni** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | all'avvio, rispetto a `rebase.schema_meta` | **solo in avanti** — il nuovo runtime migra i vecchi database |
| 5 | `manifest.schemaVersion` | emesso da `rebase build` | inviato dall'SDK come `x-rebase-schema` se configurato | consultivo — identifica lo schema rispetto al quale è stato compilato un client |
| 6 | Identificatori derivati del database | `contracts/derived-names.txt` | `pnpm check:derived-names` | **bloccato (frozen)** — un nome emesso da una release non viene mai ricalcolato |

### 1 — `rebase` in `rebase.json`

Un intervallo semver, interpretato come `engines` in un `package.json`: definisce quali versioni
del runtime accetta questo progetto. Chiamato deliberatamente `rebase` anziché `runtime`, poiché
`runtime` indica già *chi possiede il processo* (`managed` | `custom`) su un'app.

### 2 — `BUNDLE_FORMAT_VERSION` (attualmente 3)

<span class="since-badge" data-since="0.31">Since 0.31</span>

La struttura su disco di un bundle compilato. Un runtime rifiuta un bundle il cui formato è più
recente del proprio e ne legge uno precedente dove il layout lo consente, il che permette al tier
gestito di spostare un tenant su una nuova immagine senza che nessuno debba ricompilare il proprio
progetto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` una singola directory,
  `entry.admin` per una admin inclusa nel bundle.
- **2** — `kind: "backend" | "static"`, `entry.static` un elenco, `entry.admin`
  rimosso.
- **3** (0.31) — lo schema è `entry.tables`, il `backend/schema` compilato,
  accanto a `entry.resources`, `entry.storage` ed `entry.hooks`; `entry.config`,
  `entry.collections` ed `entry.usersCollection` sono stati rimossi. **I formati 1 e 2
  vengono rifiutati, non aggiornati**: includono `config/collections`, che un runtime
  che legge `backend/schema` non è in grado di interpretare, e avviarne uno comporterebbe
  l'introspezione del database e l'esposizione di un'API diversa. Il rifiuto menziona
  `rebase migrate collections-to-tables`; migra il sorgente e ricompila. Questa è stata l'unica
  rottura della retrocompatibilità, adottata insieme all'incremento del contratto di runtime
  illustrato di seguito.

**Incrementalo quando** la struttura cambia in modo tale che un runtime precedente interpreterebbe
erroneamente un bundle più recente. L'incremento è ciò che trasforma "si avvia e non serve nulla"
in un rifiuto dell'avvio.

### 3 — `RUNTIME_CONTRACT_VERSION` (attualmente 2)

Il major del contratto bundle↔runtime. Distinto dalla versione del pacchetto `@rebasepro/server`,
che può rilasciare un qualsiasi numero di minor e patch mentre questo rimane invariato.

**Leggi questo prima di toccarlo.** Il controllo è `!==`, non `>`:

> un bundle destinato al contratto *N* viene eseguito **solo** su un runtime che implementa *N*

pertanto incrementarlo invalida **ogni bundle mai creato**, simultaneamente, fino a quando
ciascuno non viene ricompilato. Questa è la severità voluta — è la leva che impedisce a "qualsiasi
cosa di vecchio di essere eseguita qui" — ma significa che un incremento è una migrazione a
livello di intero parco istanze, non una semplice nota di rilascio. Per il tier gestito deve
essere sincronizzato con la ricompilazione del bundle di ogni tenant.

Se una modifica è *additiva* e i vecchi bundle rimarrebbero corretti, richiede
`BUNDLE_FORMAT_VERSION` (o nulla del tutto), non questo. La 0.31 lo ha portato a 2,
con il bundle format 3: il modello dello schema è cambiato e il bundle di ogni tenant viene
ricompilato a partire dal sorgente migrato.

### 4 — `AUTH_SCHEMA_VERSION` (attualmente 2)

Impresso in `rebase.schema_meta` e confrontato all'avvio. Un runtime **rifiuta di avviarsi**
a fronte di un database migrato da una versione del framework più recente, piuttosto che operare
su una struttura che non comprende — durante un rolling deploy, questa è la differenza tra metà
del parco istanze che restituisce errori e metà che corrompe i dati.

La migrazione in avanti è automatica: `ensureAuthTablesExist` aggiorna un database precedente.
Nota che questo blocco di migrazione è deliberatamente racchiuso in un `try/catch` ed esegue log
anziché lanciare eccezioni — un avvio claudicante è preferibile a un crash loop — quindi **"si è
avviato" non dimostra nulla**. Ogni asserzione nella suite di upgrade legge invece il catalogo
o i dati.

**Incrementalo quando** una migrazione non deve essere ignorata da un runtime precedente. Non
incrementarlo per una colonna additiva e retrocompatibile; c'è un esempio pratico di tale
valutazione in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash dei descrittori di tabella compilati (`v2:…` a partire dalla 0.31), emesso nel manifest
del bundle e rimandato da un SDK generato nell'header `x-rebase-schema` (`SCHEMA_VERSION_HEADER`).
Esiste affinché la piattaforma possa segnalare "questa app è stata compilata a fronte di uno
schema precedente" invece di fallire misteriosamente alla prima richiesta.

`rebase generate-sdk` scrive il valore in `schema.meta.ts`; passalo al client per inviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Il backend legge tale header su ogni richiesta di dati. Il drift (disallineamento) non rifiuta
mai una chiamata — un SDK indietro di una versione di schema è solitamente ancora compatibile, e
distribuire il backend prima del frontend è il normale ordine di deployment — ma quando una
richiesta fallisce con un 400 o un 404, l'errore riporta il drift come causa:

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

Così una colonna rinominata viene segnalata come "il tuo SDK non è aggiornato, rigeneralo"
piuttosto che come un campo che i tuoi stessi tipi insistono esista. A una richiesta riuscita non
viene mai comunicato nulla.

Riguarda **solo le tabelle** — i loro descrittori compilati, in cui un hook funge da flag di
presenza. Il codice di un hook o la modifica di una funzione non altera il contratto di un
client e non deve invalidare ogni SDK generato. Poiché la versione 0.31 ha spostato l'hash dalle
collection ai descrittori, ogni database con timbro `v1:` segnala la modifica una volta sola, con
la reimpostazione del timbro (avviare il proprietario dello schema, o `rebase db push`), e ogni
SDK generato risulta non aggiornato per una volta.

### Chi sta effettuando la chiamata

Altri due segnali identificativi, nessuno dei quali funge da gate da solo:

- **`GET /api/meta/schema-version`** non è autenticato e risponde con `schemaVersion` del
  progetto *e* con il suo `runtime` (`version` e `contract`). Un job di CI che confronta il
  proprio SDK generato con un progetto attivo non necessita di credenziali, e lo stesso vale per
  un client che richiede con quale runtime stia comunicando.
- **`User-Agent: rebase-cli/<version>`** è presente in ogni richiesta `rebase cloud`. Il formato
  wire del control plane è più avanti rispetto a quanto pubblicato su npm, quindi deve essere in
  grado di rispondere a un vecchio client con `CLI_TOO_OLD` e la versione minima — cosa che può
  fare solo per un chiamante che dichiari la propria identità.

### 6 — Identificatori derivati del database

<span class="since-badge" data-since="0.31">Since 0.31</span>

Ogni nome che questo framework elabora autonomamente anziché ricevere esplicitamente: una
colonna foreign key, un vincolo di foreign key, una junction table e le sue due colonne chiave, un
tipo enum, il nome di una policy, la colonna in `snake_case` derivata da una chiave di colonna in
`camelCase`. Dalla versione 0.31 le tabelle vengono dichiarate con `defineTable`, che deriva
esattamente gli stessi nomi che una collection derivava per uno schema equivalente;
`rebase migrate collections-to-tables` lo dimostra per ciascun progetto confrontando il codice SQL
generato byte per byte.

> **Un identificatore derivato è bloccato (frozen) nel momento in cui una release lo emette.**

Non "bloccato fino alla prossima major" — bloccato. La logica è diversa rispetto agli altri
cinque contratti, ed è più vincolante. Quelli hanno un controllo di versione, quindi una discrepanza
può essere *rilevata* e rifiutata. Questo non può: il nome viene scritto nel database di un cliente
il giorno in cui effettua il deploy, e non c'è alcun indicatore di versione su una colonna. Ogni
database configurato da qualsiasi release mai rilasciata conserva qualsiasi valore abbia derivato,
e nessun codice in questo repository può intervenire e rinominarli tutti.

La versione 0.13 ne è l'esempio pratico. `generateForeignKeyName` ha imparato a rendere correttamente
al singolare i termini — `categorie_id` → `category_id`, `addres_id` → `address_id` — che è senza
dubbio una derivazione migliore, e ha causato problemi a tutti i database esistenti che presentavano
un plurale irregolare. Boot-ensure ha migrato la colonna, quindi i dati sono sopravvissuti; il
file `schema.generated.ts` tracciato nel repository del progetto no, e l'avvio è fallito a causa
di una colonna che esisteva. Tre commit, un nuovo test seam e una voce permanente nelle note di
upgrade, in cambio di un nome di colonna più gradevole alla vista che nessuno aveva richiesto.

**Se una derivazione è realmente errata**, viene modificata solo per le tabelle create
*successivamente*, dietro una strategia di denominazione registrata nel progetto — mai
retroattivamente e mai come effetto collaterale del miglioramento della funzione sottostante.

**L'unica deroga legittima** è una modifica che allinea il codice a un nome che il database
*ha già*. L'esempio pratico è il troncamento degli identificatori: Postgres taglia silenziosamente
un identificatore a 63 byte, quindi un nome di vincolo derivato più lungo non è mai stato presente
nel catalogo con quel nome — la derivazione descriveva un oggetto che non esisteva con quella grafia,
e boot-ensure rieseguiva `ADD CONSTRAINT` a ogni singolo avvio perché il confronto non poteva mai
corrispondere. Troncare in fase di costruzione cambia ciò che questo repository *deriva* e non cambia
nulla di ciò che qualsiasi database distribuito *contiene*. Questo è il criterio da applicare:
non "il nuovo nome è migliore?", ma "un qualsiasi database esistente deve essere modificato?".

L'altro caso in cui un nome può cambiare è un insieme di nomi che non potrebbero mai coesistere
tutti. Una regola che copriva diverse operazioni su una tabella di 42 byte o più derivava
`<table>_default_admin_write_insert`, `_update` e `_delete`, e tutti e tre venivano troncati agli
stessi 63 byte. Postgres memorizzava una sola policy, DELETE, e rifiutava ogni INSERT e UPDATE
dell'amministratore. Solo quando i nomi di una regola entrano in conflitto in questo modo vengono
derivati con il suffisso per primo, come `<head>_<hash8>_<op>`. Ogni nome che funziona oggi
mantiene la sua grafia. Il successivo avvio o push elimina l'unica policy troncata e crea una
policy per ciascuna operazione.

L'unica cosa sempre sicura è *riconoscere* un vecchio nome per poterlo migrare:
`legacyForeignKeyName` esiste per essere rilevato, mai per essere generato, e la baseline blocca
anche queste rilevazioni. Rimuoverne uno ripristina silenziosamente lo stato non migrato di ogni
database che utilizza ancora quella dicitura.

**Il gate.** `tooling/scripts/derived-names.mts` esegue una fixture di stress sui nomi — plurali
irregolari, una desinenza in `ss`, un acronimo, una junction generata da uno slug plurale, override
espliciti, uno slug abbastanza lungo da essere troncato — attraverso entrambi i generatori di DDL
dello schema, e restituisce ogni identificatore specificato da ciascuno dei due:

```bash
pnpm check:derived-names
```

Una riga modificata o rimossa fallisce come violazione del contratto, mostrando la vecchia e la
nuova dicitura affiancate. Anche una modifica puramente additiva fallisce, ma con l'indicazione
"regenerate" — in modo che la baseline non possa subire variazioni all'insaputa di nessuno.

Assicura inoltre che `rebase db push` e il boot-ensure del runtime gestito derivino gli *stessi*
nomi, il che costituisce un secondo contratto nascosto all'interno del primo: compilano le stesse
tabelle tramite codice diverso, e un progetto caricato con il comando push e avviato in seguito
non deve trovarsi con due schemi distinti.

## Cosa *non* è bloccato (frozen)

<span class="since-badge" data-since="0.31">Since 0.31</span>

Detto chiaramente, affinché nessuno presuma promesse mai fatte:

- L'API TypeScript creata — `defineTable` e `customizeTable`, opzioni di `initializeRebaseBackend`,
  proprietà di admin, nomi dei metodi dell'SDK. La 0.31 ha sostituito le collection con le tabelle
  in una release minor, con un codemod che dimostra come il codice SQL generato sia rimasto invariato.
  I breaking change avvengono nelle minor e sono annunciati nel changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — questi si evolvono più rapidamente e contano il minor numero di utilizzatori.
- Qualsiasi elemento presente nella cartella `src/` di un pacchetto che non sia riesportato dal
  relativo barrel file. `packages/client/src/index.ts` contiene una nota che spiega come il suo
  elenco di esportazioni sia curato attentamente proprio per evitare che un export interno diventi
  pubblico per errore.
- Lo schema di database delle *tue* tabelle. Quello appartiene a te; Rebase possiede unicamente lo
  schema `rebase` (e, su un database configurato prima della 0.13, il vecchio schema `auth` finché
  l'avvio non lo dismette definitivamente).

## I gate a presidio di queste regole

Nulla di quanto sopra è una semplice convenzione: ognuno ha un test che fallisce in caso di rottura:

| Gate | Cosa presidia |
|---|---|
| `pnpm verify:corpus` | ogni struttura di bundle mai distribuita, avviata sul runtime odierno. Le fixture in `tests/fixtures/bundles/` sono **scritte manualmente e bloccate (frozen)** — una fixture che il builder rigenera si modifica ogni volta che il builder cambia |
| `pnpm verify:selfhost` | un vero bundle compilato, raggruppato, avviato e interrogato esattamente come farebbe un browser |
| `upgrade-e2e.test.ts` | vecchi schemi di database (`schema-snapshots/`) gestiti dal runtime attuale |
| `tests/e2e/tests/cli-init-e2e.ts` | un progetto generato via scaffold installato da **veri tarball**, non da collegamenti del workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | il percorso dell'utente finale: registrazione → accesso → letture con ambito RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | ogni nome di colonna, vincolo, junction, enum e policy derivato dal framework — e la verifica che l'avvio e `db push` li derivino in modo identico |
| `pnpm rls:check` | le policy dello schema generato |
| `pnpm check:api-surface` | ogni export, e i relativi membri, dei cinque pacchetti forniti dall'immagine — `@rebasepro/server`, `types`, `client`, `common`, `utils` — oltre all'entry point `@rebasepro/server/functions`, a fronte delle sei sezioni di `contracts/server.api.txt`. Questi sono i pacchetti per i quali `infra/docker/entrypoint.mjs` crea collegamenti simbolici sopra le copie interne di un bundle distribuito, quindi rimuovere un export da uno di essi non si traduce in un errore di compilazione per gli utenti, bensì in un errore di avvio nell'intero parco istanze durante un rilascio non richiesto |
| `pnpm test:gates` | i test interni dei gate stessi, eseguiti sulle fixture — quarantasette file, tra cui `check:api-surface` e il controllo di release-bump riportato sotto — in modo che un gate che smette di monitorare ciò che protegge fallisca qui. `check:api-surface` ha trascorso l'intera sua esistenza senza riuscire a rilevare la scomparsa di un membro da `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | verifica che il livello di incremento con cui viene rilasciata una versione corrisponda a quanto la release ha apportato alle baseline sopra indicate — eseguito da `publish.yml` prima che il changelog venga timbrato |
| saas CI | il control plane compilato rispetto al `main` di questo repository, sui propri push e a cadenza notturna |

**Registra una fixture del bundle e uno snapshot dello schema una volta per ogni release.** Il valore
di entrambi i corpora risiede interamente in quanto indietro nel tempo risalga il più vecchio, e nessuno
dei due può essere integrato retroattivamente in un secondo momento.

### Non ancora coperto da gate

La tabella sopra riporta ciò che è presidiato. Queste sono invece le parti della policy non ancora
coperte da alcun controllo, elencate affinché nessuno vi legga una promessa implicita:

- **Nessuna finestra di deprecazione o di supporto.** Finché Rebase è in versione `0.x` non esiste
  alcuna regola scritta sulla durata di un export deprecato prima della rimozione, né su per quanto
  tempo una versione minor precedente riceverà correzioni. Le correzioni di sicurezza vengono
  applicate solo sull'ultima versione minor.
- **Il formato wire HTTP non ha un gate.** Nessuno script `check:*` confronta le strutture di
  richiesta e risposta con una baseline nello stesso modo in cui `check:api-surface` confronta le
  esportazioni; una modifica nella struttura della risposta viene intercettata solo se una suite e2e
  si trova casualmente a leggerla.
- **I flag della CLI non hanno una baseline di compatibilità.** Il validatore della documentazione
  fallisce se un flag utilizzato dalle skills, dagli esempi o dal sito di marketing scompare; nulla
  si accorge della rimozione di qualsiasi altro flag o di un cambiamento nel suo significato.
- **Una release da CI non registra alcun corpus.** Il workflow di pubblicazione non registra alcuna
  fixture di bundle né alcuno snapshot di schema; solo lo script di rilascio locale tenta di farlo,
  e genera un avviso anziché bloccarsi quando non vi riesce. Le versioni dalla 0.18 alla 0.21 non hanno
  alcuno snapshot di progetto registrato.
- **La superficie di esportazione è un gate, non un contratto.** La decisione se le esportazioni
  pubbliche dei pacchetti forniti dal runtime debbano diventare un settimo contratto numerato —
  dichiarato come baseline di `check:api-surface`, compatibile in modo additivo all'interno di una
  major del contratto — rimane ancora aperta.

## Modificare un contratto

1. Determina a quale dei sei appartiene. La maggior parte delle modifiche non rientra in nessuno
   di essi — ma "nessuno dei sei" non significa "privo di controversie". Rimuovere o rinominare un
   export di `@rebasepro/server`, o un suo membro, non fa parte dei sei ed è la singola modifica
   più pericolosa nell'intero repository, poiché il codice che va a rompere è già compilato e non
   verrà ricompilato. `pnpm check:api-surface` è il baluardo che presidia questa linea; se debba
   diventare un settimo contratto numerato è una decisione aperta (vedi *Non ancora coperto da gate*
   sopra).
2. Aggiungi prima una fixture o uno snapshot per la **vecchia** struttura e verifica che il test passi.
3. Applica la modifica e incrementa la costante.
4. Conferma che la vecchia fixture continui a passare, oppure che ora fallisca *con il messaggio che
   servirebbe a un utente*. Entrambi sono esiti validi; il silenzio non lo è.
5. Per il contratto 3, pianifica la ricompilazione di ogni bundle distribuito prima di effettuare il merge.
6. Il contratto 6 rappresenta l'eccezione ai passaggi 3 e 4: non c'è alcuna costante da incrementare
   né alcuna versione su cui opporre un rifiuto, poiché una colonna non reca alcun contrassegno di
   versione. Il passaggio che li sostituisce consiste nel decidere di non apportare la modifica —
   consulta la sezione sopra per comprendere quale sia l'alternativa.

## Correlati

- [Aggiornamento](/docs/upgrading/) — cosa si è effettivamente rotto, versione per versione
- [Changelog](/docs/changelog/) — ogni modifica, comprese quelle che non hanno rotto nulla
- [Runtime e bundle](/docs/architecture/runtime-and-bundles/) — contratto 3 — il formato di bundle rispetto al quale un progetto distribuito è già compilato
