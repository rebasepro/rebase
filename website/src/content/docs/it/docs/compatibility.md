---
sourceHash: 1fd0f89847e543c2
slug: it/docs/compatibility
title: Compatibilità
description: Ciò che Rebase garantisce tra le versioni e ciò che non garantisce — i sei contratti versionati, come ciascuno fallisce e cosa può ancora cambiare in una minor.
---

Ciò che Rebase garantisce tra le versioni e ciò che non garantisce.

Questo è il documento da leggere prima di modificare qualsiasi elemento da cui dipendono già un progetto distribuito o un tenant Rebase Cloud in esecuzione. È anche la risposta onesta alla domanda: "se sviluppo su Rebase oggi, cosa rischia di rompersi in futuro?"

## Cosa significa "beta" in questo contesto

Rebase è in beta pubblica. La maggior parte dei progetti usa questa parola per indicare che "tutto può rompersi", il che non fornisce al lettore alcuna informazione utile per pianificare; ecco quindi la linea che questo progetto traccia concretamente:

> **L'API su cui scrivi codice può cambiare in una minor release, con una voce nel changelog. I tuoi dati non possono rompersi silenziosamente.**

La prima metà è il normale comportamento di una versione `0.x` ed è descritta di seguito. La seconda metà è la parte che merita attenzione, perché si tratta di un'affermazione sui meccanismi piuttosto che sulle intenzioni: i contratti versionati nella sezione successiva sono ciascuno impresso in un artefatto o in un database, ciascuno viene verificato all'avvio o all'acquisizione, e ciascuno **fallisce in modo esplicito e specifico** anziché degradare. Un push dello schema che eliminerebbe una colonna viene rifiutato da un gate distruttivo (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e il percorso di aggiornamento stesso è un test: `upgrade-e2e.test.ts` ripristina i database nello stato in cui li hanno lasciati le versioni precedenti, esegue il percorso di migrazione attuale su ciascuno di essi e verifica che le righe sopravvivano — non solo che l'avvio abbia avuto successo.

Cosa significa effettivamente beta: mancano ancora funzionalità, alcuni sottosistemi sono più recenti di altri, e la natura delle imperfezioni è che qualcosa risulti assente o poco pratico, non che corrompa qualcosa silenziosamente. Lo stato dei singoli sottosistemi è pubblicato e datato anziché lasciato da scoprire — la tabella seguente è tale pubblicazione.

## Stato di maturità per sottosistema

**Ultima revisione: 14 settembre 2026, rispetto alla versione 0.21.0.** Rileggila a ogni minor release; una valutazione che non è cambiata in tre release è consolidata oppure dimenticata, e questa nota è qui affinché la differenza venga verificata.

I tre livelli di valutazione indicano:

- **Stable** — la struttura è consolidata e coperta da un gate in CI. Può ancora acquisire funzionalità; non verrà riprogettata all'improvviso all'interno della 0.x, e qualsiasi modifica che possa causare rotture sarà annunciata nel changelog.
- **Beta** — funziona ed è utilizzato in produzione, ma presenta aspetti ancora grezzi o imperfetti noti: un limite raggiungibile, un comportamento scomodo, una decisione di design non ancora presa. La parte grezza è specificata nelle note, poiché "beta" da sola non fornisce elementi su cui poter pianificare.
- **Experimental** — rilasciato affinché possa essere provato e segnalato. Aspettati di imbatterti in aspetti ancora inesplorati da altri.

| Sottosistema | Valutazione | Su cosa si basa la valutazione |
|---|---|---|
| REST API + SDK generato | Stable | Il contratto di rete (wire contract) è versionato e protetto da gate; `client-sdk-e2e` gestisce registrazione → accesso → letture con ambito RLS → refresh → storage → realtime end-to-end |
| Auth — email/password, OAuth, OIDC, magic link, codice monouso | Stable | Dodici provider OAuth supportati nativamente. Lo schema di autenticazione è un contratto versionato, impresso e verificato all'avvio |
| Auth — MFA (TOTP) | Beta | Registrazione, verifica e recupero funzionano e sono testati. La rotazione delle chiavi è implementata per la chiave di crittografia; non esiste un'interfaccia di amministrazione per reimpostare il fattore di un utente bloccato |
| Row-level security | Stable | Il punto cardine del prodotto. `pnpm rls:check` verifica un database attivo rispetto a quindici controlli, e la suite e2e di RLS viene eseguita a ogni push |
| Storage | Stable | Locale, S3 e GCS. Default-deny in produzione da 0.17.0, e lo scaffold include un hook authorize |
| Realtime | **Beta** | Le sottoscrizioni corrispondono solo per percorso di collection, quindi N sottoscrittori su una collection costano N refetch con ambito RLS per ogni scrittura. Questo limita un deployment a poche centinaia di sottoscrittori simultanei. Corretto a qualsiasi scala; dispendioso oltre tale limite |
| Ricerca vettoriale (pgvector) | Beta | Ogni colonna vettoriale riceve per impostazione predefinita un indice HNSW per la distanza del coseno, regolabile per proprietà tramite `VectorIndexConfig` (metodo, distanze, parametri di compilazione) o disattivabile, lasciando una scansione esatta. pgvector non può indicizzare una colonna con più di 2.000 dimensioni, pertanto queste rimangono non indicizzate ed eseguono una scansione |
| Sincronizzazione offline | Beta | Le mutazioni includono chiavi di idempotenza rispettate dal server, e i difetti di perdita di dati rilevati nell'audit di luglio sono stati corretti. Il modello di risoluzione dei conflitti è last-write-wins senza merge a livello di singolo campo |
| Cronologia entità | Stable | Basata su snapshot, protetta da una propria suite di test |
| Functions e cron job | Stable | L'entry point portabile (`@rebasepro/server/functions`) è un contratto versionato con una propria sezione dedicata alla superficie API |
| MCP server + agent skills | Beta | `@rebasepro/mcp` funziona su stdio: cinquantatré strumenti, bearer auth per progetto, gli strumenti distruttivi rifiutano destinazioni non locali salvo esplicito consenso (opt-in). Dalla versione 0.21 il server può anche montare un endpoint remoto `/mcp` — OAuth 2.1, undici strumenti per i dati, ogni chiamata sotto la RLS dell'utente autenticato — disattivato se non con `REBASE_MCP_ENABLED=true`, e solo per Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizzato quotidianamente su progetti reali. Il branching è presente nel pacchetto OSS e deliberatamente non esposto in Rebase Cloud, poiché la migrazione di un deployment attivo su un branch non è ancora supportata |
| CMS + pannello di amministrazione | Beta | Completo per CRUD, relazioni, campi di storage e ruoli. **La tabella dati non ha semantica di griglia** — nessun `role`, nessun `aria-rowindex`, `tabIndex` rimosso — pertanto gli utenti con tastiera e screen reader non possono utilizzare la vista principale. Nessuna bozza, nessun contenuto per lingua/localizzazione, nessun rich-text a blocchi |
| Database di sviluppo gestito PGlite | Beta | `rebase dev` con zero configurazione e senza Docker. Una sessione alla volta, quindi le richieste vengono serializzate e la concorrenza non può essere riprodotta; i comandi basati su Atlas (`db push`, `generate`, `migrate`) pianificano su una seconda istanza PGlite usa-e-getta avviata per il comando (nella 0.24 rifiutano il database gestito); `db branch` non funziona su di esso e lo segnala |
| Helm chart | Beta | Esegue il rendering della topologia a processi separati e viene pubblicato nel registry OCI a ogni release. L'impostazione predefinita rimane un singolo container |
| `@rebasepro/server-mongo` | **Experimental** | Un driver funzionante con realtime basato su change-stream e cronologia basata su snapshot. **Nessuna row-level security** — l'intero modello di isolamento sopra descritto non si applica — e nessuna relazione. I change stream richiedono un replica set: su un `mongod` autonomo nulla li sostituisce, quindi una sottoscrizione rileva solo le scritture effettuate tramite quel processo Rebase e perde tutte le altre. Nessuna MFA: la registrazione risponde con 501 e i controlli rispondono "nessun fattore", quindi l'accesso non ne richiede mai uno. L'aggregazione admin non può indirizzare una collection — legge il nome da uno stage `$from` che MongoDB non possiede — quindi non restituisce nulla |
| `@rebasepro/firebase` | Experimental | Esegue il pannello di amministrazione e l'SDK su Firestore. Nessuna RLS, nessuna superficie SQL; il set di funzionalità di Postgres non viene trasferito. Il driver Firestore ignora i gruppi di filtri `or(...)`/`and(...)`, pertanto una query che ne fa uso legge ogni riga consentita dai suoi filtri semplici |
| Rebase Cloud | **Private beta** | Attivo, ospita tenant reali, con accessi aperti a scaglioni. Non self-service |

Due voci sopra riportate rappresentano il prezzo in termini di trasparenza della pubblicazione di questa tabella: il refetch del realtime e l'accessibilità della tabella dati sono difetti aperti, non elementi della roadmap, ed entrambi sono elencati anziché lasciati alla scoperta del lettore.

Questa tabella rappresenta ciò che esiste. Ciò che ancora non esiste si trova sulla [roadmap](https://rebase.pro/roadmap), con una voce per ciascuna issue di GitHub e con evidenziato il sottoinsieme richiesto per la versione 1.0.

## La promessa della versione 0.x

Rebase è nella fase `0.x`. Questa sezione è scritta per essere valida per ogni release 0.x anziché per una sola di esse, in modo da non diventare obsoleta a ogni taglio di versione. **I breaking change alle API TypeScript create dall'utente sono ancora consentiti in una minor release**, e il changelog è il luogo in cui vengono annunciati. Ciò che *non* è consentito rompere silenziosamente è l'insieme dei contratti versionati indicati di seguito: ciascuno di essi è impresso in un artefatto o in un database, ciascuno viene verificato all'avvio o all'acquisizione, e ciascuno fallisce **in modo esplicito e specifico** anziché degradare.

Questa distinzione rappresenta l'intera promessa. Un export rinominato costa un errore di compilazione e cinque minuti. Un bundle che si avvia su un runtime errato e fornisce dati sottilmente errati costa un incidente, e i contratti esistono proprio per impedire che questa seconda categoria si verifichi silenziosamente.

Rebase Cloud fa affidamento esattamente su questi contratti e su nient'altro. Qualsiasi cosa non elencata qui è un dettaglio implementativo da cui la piattaforma non dipende.

### Badge di versione e canary build

La documentazione viene pubblicata dal branch `main`, quindi una pagina può descrivere qualcosa che nessuna release stabile ancora possiede. Un badge *Since* indica la prima release stabile che include la funzionalità, e il testo accanto descrive cosa fa la versione precedente.

Una canary è una build di `main` numerata in base alla versione verso cui è diretta: `0.25.0-canary.g<commit>` rappresenta `main` a quel determinato commit, dopo la 0.24.0 e prima della 0.25.0, e `rebase upgrade --to canary` installa la versione più recente. Include tutto ciò che era confluito in `main` al momento della compilazione, quindi un badge che riporta la sua versione (Since 0.25) si applica al tuo caso, mentre la nota sulla versione precedente (on 0.24) descrive la release stabile da cui provieni. Le versioni canary precedenti alla 0.25.0 erano invece numerate in base all'ultima release: anche `0.24.1-canary.g<commit>` è un'anteprima della 0.25.

## I contratti versionati

I valori seguenti sono letti dal codice sorgente; considera i riferimenti ai file come l'unica fonte di verità e questa tabella come la mappa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contratto | Dichiarato in | Verificato in | Direzione di compatibilità |
|---|---|---|---|---|
| 1 | intervallo `rebase` in `rebase.json` | progetto dell'utente | CLI durante il build | il progetto specifica quali runtime accetta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatibile** — il nuovo runtime legge i vecchi bundle |
| 3 | `RUNTIME_CONTRACT_VERSION` | stesso file | stesso file | **corrispondenza esatta, in entrambe le direzioni** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | all'avvio, su `rebase.schema_meta` | **solo in avanti** — il nuovo runtime migra i vecchi database |
| 5 | `manifest.schemaVersion` | emesso da `rebase build` | inviato dall'SDK come `x-rebase-schema` quando configurato | informativo — identifica lo schema rispetto a cui è stato compilato il client |
| 6 | Identificatori del database derivati | `contracts/derived-names.txt` | `pnpm check:derived-names` | **bloccato (frozen)** — un nome emesso da una release non viene mai ricalcolato |

### 1 — `rebase` in `rebase.json`

Un intervallo semver, interpretato come `engines` in un `package.json`: indica quali versioni del runtime questo progetto accetta. È denominato deliberatamente `rebase` anziché `runtime`, poiché su un'app `runtime` significa già *chi possiede il processo* (`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (attualmente 2)

La struttura su disco di un bundle compilato. Un runtime accetta qualsiasi bundle il cui formato sia **minore o uguale** al proprio, ed è ciò che consente al tier gestito di spostare un tenant su una nuova immagine senza che nessuno debba ricompilare il proprio progetto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` una singola directory, `entry.admin` per un pannello admin incluso nel bundle.
- **2** — `kind: "backend" | "static"`, `entry.static` un elenco, `entry.admin` rimosso. Il formato 1 viene ancora letto, tramite `upgradeLegacyManifest`.

**Incrementalo quando** il layout cambia in modo tale che un runtime precedente interpreterebbe erroneamente un bundle più recente. L'incremento è ciò che converte un "si avvia ma non serve nulla" in un esplicito rifiuto di avviarsi.

### 3 — `RUNTIME_CONTRACT_VERSION` (attualmente 1)

La versione major del contratto bundle↔runtime. Distinta dalla versione del pacchetto `@rebasepro/server`, che può rilasciare qualsiasi numero di minor e patch mentre questa rimane invariata.

**Leggi questo prima di toccarlo.** Il controllo è `!==`, non `>`:

> un bundle destinato al contratto *N* viene eseguito **solo** su un runtime che implementa *N*

pertanto incrementarlo invalida **ogni bundle mai creato**, simultaneamente, fino a quando ciascuno non viene ricompilato. Questa è la severità intenzionale — è la leva del "nulla di vecchio può essere eseguito qui" — ma significa che un incremento rappresenta una migrazione dell'intera flotta, non una semplice nota di rilascio. Per il tier gestito deve essere sincronizzato con la ricompilazione del bundle di ogni tenant.

Se una modifica è *additiva* e i vecchi bundle rimangono corretti, richiede `BUNDLE_FORMAT_VERSION` (o assolutamente nulla), non questo.

### 4 — `AUTH_SCHEMA_VERSION` (attualmente 2)

Impresso in `rebase.schema_meta` e confrontato all'avvio. Un runtime **si rifiuta di avviarsi** su un database migrato da una versione del framework più recente, anziché operare su una struttura che non comprende — durante un rolling deploy, questa è la differenza tra metà della flotta che restituisce un errore e metà della flotta che corrompe i dati.

La migrazione in avanti è automatica: `ensureAuthTablesExist` aggiorna un database precedente. Si noti che questo blocco di migrazione è deliberatamente racchiuso in un `try/catch` ed esegue il logging anziché lanciare un'eccezione — un avvio zoppicante è preferibile a un crash loop — quindi **"si è avviato" non dimostra nulla**. Ogni asserzione nella suite di aggiornamento legge invece il catalogo o i dati.

**Incrementalo quando** una migrazione non deve essere saltata da un runtime precedente. Non incrementarlo per una colonna additiva e retrocompatibile; c'è un esempio pratico di tale valutazione in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash delle definizioni compilate delle collection, emesso nel manifest del bundle e replicato da un SDK generato nell'header `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Esiste affinché la piattaforma possa segnalare che "questa app è stata compilata rispetto a uno schema precedente" anziché fallire misteriosamente alla prima richiesta.

`rebase generate-sdk` scrive il valore in `schema.meta.ts`; passalo al client per inviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Il backend legge tale header a ogni richiesta di dati. Il disallineamento (drift) non rifiuta mai una chiamata — un SDK indietro di uno schema è solitamente ancora compatibile, e distribuire il backend prima del frontend è il normale ordine di deployment — ma quando una richiesta fallisce con un errore 400 o 404, l'errore riporta il drift come causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

In questo modo, una colonna rinominata viene segnalata come "il tuo SDK non è aggiornato, rigeneralo" anziché come un campo che i tuoi stessi tipi insistono esista. A una richiesta che ha successo non viene mai notificato.

Riguarda **esclusivamente le collection**. La modifica di un hook o di una function non altera il contratto del client e non deve invalidare ogni SDK generato.

### Chi sta chiamando

Altri due segnali identificativi, nessuno dei quali funge da gate da solo:

- **`GET /api/meta/schema-version`** non richiede autenticazione e risponde con lo `schemaVersion` del progetto *e* con il suo `runtime` (`version` e `contract`). Un job di CI che confronta il suo SDK generato con un progetto attivo non necessita di credenziali, così come un client che chieda con quale runtime stia comunicando.
- **`User-Agent: rebase-cli/<version>`** viene incluso in ogni richiesta verso `rebase cloud`. Il formato di rete (wire format) del control plane evolve più rapidamente di quanto pubblicato su npm, quindi deve essere in grado di rispondere a un client obsoleto con `CLI_TOO_OLD` e la versione minima richiesta — cosa che può fare solo per un chiamante che dichiari la propria identità.

### 6 — Identificatori del database derivati

Ogni nome che questo framework ricava autonomamente anziché ricevere esplicitamente: una colonna foreign key, un vincolo di foreign key, una junction table e le sue due colonne chiave, un tipo enum, il nome di una policy, la colonna in `snake_case` di una proprietà in `camelCase`.

> **Un identificatore derivato è congelato (frozen) nel momento stesso in cui una release lo emette.**

Non "congelato fino alla prossima major" — congelato definitivamente. La motivazione è diversa rispetto agli altri cinque contratti, ed è più forte. Quelli sono versionati, quindi una mancata corrispondenza può essere *rilevata* e rifiutata. Questo no: il nome viene scritto nel database di un cliente il giorno in cui effettua il deploy, e non c'è alcun contrassegno di versione su una colonna. Ogni database sottoposto a provisioning da qualsiasi release mai rilasciata porta con sé qualsiasi nome sia stato derivato, e nessun codice in questo repository può intervenire per rinominarli tutti.

La 0.13 è l'esempio pratico. `generateForeignKeyName` ha imparato a rendere correttamente i singolari — `categorie_id` → `category_id`, `addres_id` → `address_id` — il che è inequivocabilmente una derivazione migliore, ma ha rotto ogni database preesistente che presentava un plurale irregolare. Il boot-ensure ha migrato la colonna, quindi i dati sono sopravvissuti; il file `schema.generated.ts` committato nel progetto non lo ha fatto, e l'avvio è fallito su una colonna che esisteva. Tre commit, un nuovo seam test e una voce permanente nelle note di aggiornamento, in cambio di un nome di colonna esteticamente più gradevole che nessuno aveva richiesto.

**Se una derivazione è realmente errata**, viene modificata per le collection create *successivamente*, gestita da una strategia di denominazione (naming strategy) registrata nel progetto — mai retroattivamente e mai come effetto collaterale del miglioramento della funzione sottostante.

**L'unica eccezione legittima (override)** è una modifica che allinea il codice a un nome che il database *ha già*. L'esempio pratico è il troncamento degli identificatori: Postgres tronca silenziosamente un identificatore a 63 byte, quindi un nome di vincolo derivato più lungo non è mai stato presente nel catalogo — la derivazione descriveva un oggetto che non esisteva con quel nome, e il boot-ensure eseguiva nuovamente `ADD CONSTRAINT` a ogni singolo avvio poiché il confronto non poteva mai coincidere. Il troncamento in fase di costruzione modifica ciò che questo repository *deriva* e non cambia nulla di ciò che qualsiasi database distribuito *contiene*. Questo è il criterio da applicare: non "il nuovo nome è migliore?", ma "qualche database esistente deve cambiare?".

L'altro caso in cui un nome può cambiare è un insieme di nomi che non potrebbero mai coesistere tutti. Una regola che copriva diverse operazioni su una tabella di 42 byte o più derivava `<table>_default_admin_write_insert`, `_update` e `_delete`, e tutti e tre venivano troncati agli stessi 63 byte. Postgres memorizzava una sola policy, DELETE, e rifiutava ogni INSERT e UPDATE dell'amministratore. Solo quando i nomi di una regola collidono in questo modo vengono derivati con il suffisso prioritario, come `<head>_<hash8>_<op>`. Ogni nome che funziona oggi mantiene la sua dicitura esatta. L'avvio o il push successivo elimina la singola policy troncata e crea una policy per ciascuna operazione.

L'unica operazione sempre sicura è *riconoscere* un vecchio nome per poterlo migrare: `legacyForeignKeyName` esiste per essere rilevato, mai per essere generato, e la baseline blocca anche questi rilevamenti. Rimuoverne uno annullerebbe silenziosamente la migrazione per ogni database che contiene ancora quella dicitura.

**Il gate.** `tooling/scripts/derived-names.mts` esegue una fixture di stress sui nomi — plurali irregolari, una desinenza in `ss`, un acronimo, una junction derivata da uno slug plurale, override espliciti, uno slug sufficientemente lungo da essere troncato — attraverso entrambi i generatori di DDL dello schema, e genera l'output di ogni identificatore indicato da ciascuno di essi:

```bash
pnpm check:derived-names
```

Una riga modificata o rimossa fallisce come violazione del contratto, mostrando la vecchia e la nuova dicitura affiancate. Anche una modifica puramente additiva fallisce, ma con il messaggio "regenerate" — in modo che la baseline non possa subire deviazioni all'insaputa di nessuno.

Garantisce inoltre che `rebase db push` e il boot-ensure del runtime gestito derivino gli *stessi* nomi, il che rappresenta un secondo contratto nascosto all'interno del primo: compilano le stesse collection attraverso codice diverso, e un progetto su cui viene effettuato il push una volta e l'avvio in seguito non deve ritrovarsi con due schemi differenti.

## Cosa *non* è bloccato (frozen)

Detto chiaramente, affinché nessuno presuma promesse mai fatte:

- Le API TypeScript scritte dallo sviluppatore — configurazione delle collection, opzioni di `initializeRebaseBackend`, proprietà admin, nomi dei metodi dell'SDK. I breaking change arrivano nelle minor release e vengono annunciati nel changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — questi si evolvono più rapidamente e hanno il minor numero di utilizzatori.
- Qualsiasi elemento all'interno della directory `src/` di un pacchetto che non sia riesportato dal relativo file barrel. `packages/client/src/index.ts` include una nota in cui si spiega che l'elenco degli export è curato appositamente per impedire che un export interno diventi pubblico per errore.
- Lo schema di database delle *tue* collection. Quello è di tua proprietà; Rebase gestisce solo lo schema `rebase` (e, su un database configurato prima della versione 0.13, il vecchio schema `auth` finché l'avvio non lo dismette).

## I gate a presidio di queste regole

Nulla di quanto sopra è una semplice convenzione — ognuno dispone di un test che fallisce in caso di violazione:

| Gate | Cosa vincola |
|---|---|
| `pnpm verify:corpus` | ogni formato di bundle mai rilasciato, avviato sul runtime odierno. Le fixture in `tests/fixtures/bundles/` sono **scritte a mano e bloccate** — una fixture rigenerata dal builder cambierebbe ogni volta che il builder cambia |
| `pnpm verify:selfhost` | un vero bundle compilato, ripiegato, avviato e interrogato esattamente come farebbe un browser |
| `upgrade-e2e.test.ts` | vecchi schemi di database (`schema-snapshots/`) gestiti dal runtime attuale |
| `tests/e2e/tests/cli-init-e2e.ts` | un progetto generato tramite scaffold installato da **veri archivi tarball**, non da collegamenti del workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | il percorso dell'utente finale: registrazione → accesso → letture con ambito RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | ogni nome di colonna, vincolo, junction, enum e policy derivato dal framework — e la garanzia che boot e `db push` li derivino in modo identico |
| `pnpm rls:check` | le policy dello schema generato |
| `pnpm check:api-surface` | ogni export, e relativi membri, dei cinque pacchetti forniti dall'immagine — `@rebasepro/server`, `types`, `client`, `common`, `utils` — oltre all'entry point `@rebasepro/server/functions`, rispetto alle sei sezioni di `contracts/server.api.txt`. Questi sono i pacchetti che `infra/docker/entrypoint.mjs` collega tramite symlink sulle copie del bundle distribuito, quindi la rimozione di un export da uno di essi non è un errore di compilazione per alcuno — è un errore di avvio che colpisce l'intera flotta durante un rollout non desiderato |
| `pnpm test:gates` | i test dei gate stessi, eseguiti su fixture — quarantasette file, tra cui `check:api-surface` e il controllo del release-bump sotto descritto — affinché un gate che smette di monitorare ciò che protegge fallisca qui. `check:api-surface` ha trascorso la sua intera esistenza senza rilevare la scomparsa di un membro da `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | che il livello di incremento con cui una release viene distribuita corrisponda a ciò che la release ha modificato nelle baseline di cui sopra — eseguito da `publish.yml` prima che il changelog venga impresso |
| saas CI | il control plane compilato rispetto al branch `main` di questo repository, sui propri push e nelle build notturne (nightly) |

**Registra una fixture del bundle e uno snapshot dello schema una volta per ogni release.** Il valore di entrambi i corpora risiede interamente nella profondità storica del più vecchio, e nessuno dei due può essere ricostruito retroattivamente a posteriori.

### Non ancora protetto da gate

La tabella sopra riportata rappresenta ciò che è garantito. Queste sono le parti della policy per le quali non esiste ancora alcun controllo automatico, elencate affinché nessuno vi legga una garanzia implicita:

- **Nessuna finestra di supporto o deprecazione.** Finché Rebase è in versione `0.x` non esiste alcuna regola formale su quanto tempo un export deprecato rimanga disponibile prima della rimozione, né per quanto tempo una minor precedente riceva fix. Le correzioni di sicurezza vengono applicate esclusivamente sull'ultima versione minor.
- **Il formato di rete HTTP (wire format) non ha gate.** Nessuno script `check:*` esegue il diff delle strutture di richiesta e risposta rispetto a una baseline come fa `check:api-surface` per gli export; una modifica nella struttura della risposta viene rilevata solo se una suite e2e si trova a leggerla.
- **I flag della CLI non hanno una baseline di compatibilità.** Il verificatore della documentazione fallisce se scompare un flag utilizzato dalle skill, dagli esempi o dal sito di marketing; nulla segnala la rimozione di qualsiasi altro flag o un cambiamento nel suo significato.
- **Una release da CI non registra alcun corpus.** Il workflow di pubblicazione non registra alcuna fixture di bundle né alcuno snapshot di schema; solo lo script di rilascio locale tenta di farlo, e genera un avviso anziché bloccarsi quando non vi riesce. Dalla 0.18 alla 0.21 non esistono snapshot di progetto registrati.
- **La superficie degli export è un gate, non un contratto.** La decisione se gli export pubblici dei pacchetti forniti dal runtime diventeranno un settimo contratto numerato — dichiarato come baseline di `check:api-surface`, compatibile in modo additivo all'interno di una major di contratto — rimane aperta.

## Modificare un contratto

1. Determina a quale dei sei contratti appartiene la modifica. La maggior parte delle modifiche non appartiene a nessuno di essi — ma "nessuno dei sei" non significa "privo di rischi". Rimuovere o rinominare un export di `@rebasepro/server`, o un suo membro, non rientra in nessuno dei sei ed è la modifica in assoluto più pericolosa nel repository, poiché il codice che rompe è già compilato e non verrà ricompilato. `pnpm check:api-surface` è ciò che presidia questa linea; se debba diventare un settimo contratto numerato è una decisione ancora aperta (vedi *Non ancora protetto da gate*, sopra).
2. Aggiungi innanzitutto una fixture o uno snapshot per la **vecchia** struttura e verifica che il test passi.
3. Apporta la modifica e incrementa la costante.
4. Verifica che la vecchia fixture continui a passare, oppure che fallisca *con il messaggio di errore utile per l'utente*. Entrambi sono esiti validi; il silenzio non lo è.
5. Per il contratto 3, pianifica la ricompilazione di ogni bundle distribuito prima di effettuare il merge.
6. Il contratto 6 fa eccezione rispetto ai punti 3 e 4: non c'è alcuna costante da incrementare né alcuna versione su cui opporre un rifiuto, poiché una colonna non riporta alcun contrassegno di versione. Il passaggio che li sostituisce consiste nel decidere di non apportare la modifica — consulta la sezione sopra per vedere come si configura l'alternativa.

## Risorse correlate

- [Aggiornamento](/docs/upgrading/) — cosa si è effettivamente rotto, release per release
- [Changelog](/docs/changelog/) — ogni modifica, comprese quelle che non hanno rotto nulla
- [Runtime & Bundle](/docs/architecture/runtime-and-bundles/) — contratto 3 — il formato del bundle rispetto a cui un progetto distribuito è già compilato
