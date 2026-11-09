---
sourceHash: b8e0a21a6a62da25
slug: it/docs/compatibility
title: Compatibilità
description: Cosa garantisce Rebase tra le varie versioni e cosa no — i sei contratti con versione, come ciascuno fallisce e cosa può ancora cambiare in una versione minor.
---

Cosa garantisce Rebase tra le varie versioni e cosa no.

Questo è il documento da leggere prima di modificare qualsiasi elemento da cui un
progetto distribuito o un tenant attivo su Rebase Cloud già dipende. È anche la risposta
onesta a "se sviluppo su Rebase oggi, cosa rischia di rompersi in futuro?"

## Cosa significa "beta" qui

Rebase è in beta pubblica. La maggior parte dei progetti usa questa parola per indicare
che "tutto può rompersi", il che non fornisce al lettore alcuna informazione utile per pianificare.
Ecco quindi la linea che questo progetto traccia concretamente:

> **L'API su cui scrivi il codice può cambiare in una versione minor, con una nota nel changelog.
> I tuoi dati non possono corrompersi silenziosamente.**

La prima metà rappresenta il normale comportamento di una `0.x` ed è descritta di seguito. La
seconda metà è la parte da verificare con attenzione, poiché si tratta di una dichiarazione sui
meccanismi effettivi piuttosto che sulle intenzioni: i contratti con versione della prossima sezione
sono ciascuno impressi in un artefatto o in un database, ognuno viene verificato all'avvio o in fase
di acquisizione, e ciascuno **fallisce in modo evidente e specifico** invece di degradare. Un push
dello schema che comporterebbe l'eliminazione di una colonna viene rifiutato da un gate distruttivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e il percorso di aggiornamento stesso
è un test: `upgrade-e2e.test.ts` ripristina i database esattamente come lasciati dalle versioni precedenti,
esegue l'attuale sequenza di migrazioni su ciascuno di essi e verifica che le righe sopravvivano — non
semplicemente che l'avvio sia andato a buon fine.

Cosa significa beta: mancano ancora delle funzionalità, alcuni sottosistemi sono più recenti di altri
e la presenza di asperità si manifesta con qualcosa di assente o scomodo da usare, non con una
corruzione silenziosa dei dati. Lo stato di ciascun sottosistema viene pubblicato e datato anziché
essere lasciato alla scoperta dell'utente — la tabella sottostante rappresenta tale pubblicazione.

## Idoneità per sottosistema

**Ultima revisione 14 settembre 2026, basata su 0.21.0.** Rileggila a ogni versione minor; una
valutazione rimasta invariata per tre release è ormai consolidata oppure dimenticata, e questa
nota serve proprio a verificare la differenza.

Le tre valutazioni significano:

- **Stable** — la struttura è consolidata e coperta da un gate in CI. Può ancora ricevere nuove
  funzionalità; non verrà riprogettata all'improvviso all'interno della 0.x, e qualsiasi modifica
  potenzialmente distruttiva verrà annunciata nel changelog.
- **Beta** — funziona ed è utilizzato in produzione, ma presenta qualche spigolosità nota: un limite
  che si può raggiungere, un caso limite poco rifinito, una decisione architetturale non ancora presa.
  La criticità viene specificata nelle note, perché la parola "beta" da sola non fornisce elementi utili
  per la pianificazione.
- **Experimental** — rilasciato per poter essere utilizzato e testato. Aspettati di imbatterti in
  parti ancora poco esplorate.

| Sottosistema | Valutazione | Su cosa si basa la valutazione |
|---|---|---|
| REST API + SDK generato | Stable | Il wire contract è versionato e protetto da gate; `client-sdk-e2e` gestisce end-to-end: registrazione → accesso → letture con scope RLS → refresh → storage → realtime |
| Auth — email/password, OAuth, OIDC, magic link, codice monouso | Stable | Dodici provider OAuth supportati nativamente. Lo schema di autenticazione è un contratto versionato, impresso e verificato all'avvio |
| Auth — MFA (TOTP) | Beta | Registrazione, verifica e recupero funzionano e sono testati. La rotazione della chiave è implementata per la chiave di crittografia; non esiste un'interfaccia di amministrazione per ripristinare il fattore di un utente bloccato |
| Row-level security | Stable | Il pilastro fondamentale del prodotto. `pnpm rls:check` esegue l'audit di un database attivo a fronte di quindici verifiche, e la suite e2e per RLS viene eseguita a ogni push |
| Storage | Stable | Locale, S3 e GCS. Di default nega l'accesso in produzione a partire dalla 0.17.0, e lo scaffold include un hook authorize |
| Realtime | **Beta** | Le sottoscrizioni vengono associate solo per percorso di collezione, quindi N sottoscrittori su una collezione costano N refetch con scope RLS per scrittura. Ciò limita una distribuzione a poche centinaia di sottoscrittori simultanei. Corretto a qualsiasi scala; costoso oltre tale soglia |
| Vector search (pgvector) | Beta | Ogni colonna vettoriale riceve di default un indice HNSW per la distanza del coseno, regolabile per proprietà tramite `VectorIndexConfig` (metodo, distanze, parametri di build) o disattivabile, consentendo uno scan esatto. pgvector non può indicizzare una colonna con più di 2.000 dimensioni, che quindi restano non indicizzate ed eseguono la scansione |
| Offline sync | Beta | Le mutazioni includono chiavi di idempotenza onorate dal server e i difetti di perdita dati rilevati nell'audit di luglio sono stati risolti. Il modello di conflitto è last-write-wins senza merge per singolo campo |
| Entity history | Stable | Basato su snapshot, protetto dalla propria suite di test |
| Functions e crons | Stable | L'entry point portabile (`@rebasepro/server/functions`) è un contratto versionato con una propria sezione dedicata alla superficie API |
| MCP server + skill per agenti | Beta | `@rebasepro/mcp` viene eseguito via stdio: cinquantatré strumenti, autenticazione bearer per progetto, gli strumenti distruttivi rifiutano target non locali salvo esplicita adesione. Dalla 0.21 il server può anche montare un endpoint remoto `/mcp` — OAuth 2.1, tredici data tool, ogni chiamata subordinata all'RLS dell'utente autenticato — disattivato a meno che non sia impostato `REBASE_MCP_ENABLED=true`, e solo per Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizzato quotidianamente su progetti reali. Il branching è presente nel pacchetto OSS e deliberatamente non esposto in Rebase Cloud, poiché la migrazione di una distribuzione attiva su un branch non è ancora supportata |
| CMS + pannello admin | Beta | Completo per CRUD, relazioni, campi storage e ruoli. **La tabella dati non implementa la semantica di una griglia** — nessun `role`, nessun `aria-rowindex`, `tabIndex` rimosso — impedendo agli utenti con tastiera e screen reader di usare la vista principale. Mancano bozze, contenuti per localizzazione e rich-text a blocchi |
| Database dev gestito PGlite | Beta | `rebase dev` a configurazione zero senza Docker. Una sola sessione alla volta, quindi le richieste vengono serializzate e la concorrenza non può essere riprodotta; i comandi basati su Atlas (`db push`, `generate`, `migrate`) calcolano il piano su una seconda istanza PGlite temporanea avviata per il comando (nella 0.24 rifiutano il database gestito); `db branch` non funziona in questo contesto e genera un errore esplicito |
| Helm chart | Beta | Esegue il rendering della topologia a processi separati e viene pubblicato sul registro OCI a ogni release. Il default rimane il singolo container |
| `@rebasepro/server-mongo` | **Experimental** | Driver funzionante con realtime basato su change-stream e cronologia basata su snapshot. **Nessuna row-level security** — l'intero modello di isolamento sopra indicato non si applica — e nessuna relazione. I change stream richiedono un replica set: su un `mongod` autonomo non c'è nulla che li sostituisca, quindi una sottoscrizione rileva solo le scritture effettuate tramite quel processo Rebase ignorando tutte le altre. Nessuna MFA: la registrazione risponde 501 e le verifiche restituiscono "nessun fattore", quindi l'accesso non ne richiede mai uno. L'aggregazione admin non può puntare a una collezione — legge il nome da uno stage `$from` che MongoDB non possiede — e di conseguenza non restituisce nulla |
| `@rebasepro/firebase` | Experimental | Esegue il pannello admin e l'SDK su Firestore. Nessun RLS, nessuna interfaccia SQL; il set di funzionalità di Postgres non è presente. Il driver Firestore ignora i gruppi di filtri `or(...)`/`and(...)`, quindi una query che ne fa uso legge ogni riga consentita dai suoi soli filtri semplici |
| Rebase Cloud | **Private beta** | Attivo, ospita tenant reali, aperto a scaglioni. Non in self-service |

Due delle voci sopra riportate sono il costo da pagare per l'onestà di questa tabella: il refetch
del realtime e l'accessibilità della tabella dati sono bug aperti, non elementi della roadmap,
ed entrambi sono esplicitati anziché lasciati alla scoperta dell'utente.

Questa tabella rappresenta ciò che esiste oggi. Ciò che ancora non c'è si trova sulla
[roadmap](https://rebase.pro/roadmap), con una voce per ciascuna issue di GitHub, dove è
contrassegnato il sottoinsieme richiesto per la 1.0.

## La promessa della 0.x

Rebase è alla versione `0.x`. Questa sezione è scritta per essere valida per ogni release 0.x
piuttosto che per una specifica, evitando di diventare obsoleta a ogni taglio di release. **Le modifiche
distruttive (breaking changes) alle API TypeScript create dagli utenti sono ancora consentite nelle
versioni minor**, e il changelog è il luogo in cui vengono annunciate. Ciò che *non* è consentito
rompere silenziosamente è l'insieme di contratti con versione riportati di seguito: ciascuno di essi
è impresso in un artefatto o in un database, ognuno viene verificato all'avvio o all'acquisizione, e
ciascuno fallisce **in modo evidente e specifico** anziché degradare.

Questa distinzione è il fulcro dell'intera promessa. Un export rinominato ti costa un errore di
compilazione e cinque minuti di lavoro. Un bundle che si avvia con il runtime sbagliato e serve dati
sottilmente errati ti costa un incidente di produzione; i contratti esistono proprio affinché questa
seconda eventualità non si verifichi mai in silenzio.

Rebase Cloud consuma esattamente questi contratti e nient'altro. Tutto ciò che non è elencato qui
rappresenta un dettaglio implementativo da cui la piattaforma non dipende.

### Badge di versione e canary

La documentazione viene pubblicata dal branch `main`, quindi una pagina può descrivere qualcosa
che nessuna release stabile possiede ancora. Un badge *Since* indica la prima release stabile
che lo include, mentre il testo a fianco spiega il comportamento della release precedente.

Una build canary è una compilazione di `main` numerata in base alla release a cui è destinata:
`0.25.0-canary.g<commit>` rappresenta il codice di `main` a quel commit, successivo a 0.24.0 e precedente
a 0.25.0; `rebase upgrade --to canary` installa la più recente. Include tutto ciò che era confluito in
`main` al momento della compilazione, quindi un badge indicante la sua versione (Since 0.25) si applica
al tuo caso, e la nota sulla release precedente (on 0.24) descrive la release stabile da cui provieni.
Le versioni canary precedenti alla 0.25.0 erano invece numerate a partire dall'ultima release:
`0.24.1-canary.g<commit>` è anch'essa un'anteprima della 0.25.

## I contratti con versione

I valori riportati di seguito sono letti dal codice sorgente; considera i riferimenti ai file come
la fonte di verità e questa tabella come la mappa di orientamento.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contratto | Dichiarato in | Verificato in | Direzione di compatibilità |
|---|---|---|---|---|
| 1 | Intervallo `rebase` in `rebase.json` | progetto dell'utente | CLI in fase di build | il progetto specifica quali runtime accetta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatibile** — il nuovo runtime legge i vecchi bundle |
| 3 | `RUNTIME_CONTRACT_VERSION` | stesso file | stesso file | **corrispondenza esatta, bidirezionale** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | all'avvio, a fronte di `rebase.schema_meta` | **solo in avanti** — il nuovo runtime migra i vecchi database |
| 5 | `manifest.schemaVersion` | generato da `rebase build` | inviato dall'SDK come `x-rebase-schema` se configurato | informativo — identifica a fronte di quale schema è stato compilato un client |
| 6 | Identificatori derivati del database | `contracts/derived-names.txt` | `pnpm check:derived-names` | **bloccato (frozen)** — un nome emesso da una release non viene mai ricalcolato |

### 1 — `rebase` in `rebase.json`

Un intervallo semver, interpretato come il campo `engines` in un `package.json`: indica quali versioni
del runtime sono accettate da questo progetto. Chiamato deliberatamente `rebase` invece di `runtime`,
poiché per un'app `runtime` indica già *chi possiede il processo* (`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (attualmente 2)

Il layout su disco di un bundle compilato. Un runtime accetta qualsiasi bundle il cui formato sia
**minore o uguale** al proprio; questo consente al piano gestito di migrare un tenant su una nuova
immagine senza che nessuno debba ricompilare il proprio progetto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` come directory singola,
  `entry.admin` per un admin aggregato nel bundle.
- **2** — `kind: "backend" | "static"`, `entry.static` come elenco, `entry.admin`
  rimosso. Il formato 1 viene ancora letto, tramite `upgradeLegacyManifest`.

**Incrementalo quando** il layout cambia in modo tale che un runtime precedente interpreterebbe
in modo errato un bundle più recente. Questo incremento trasforma un avvio con mancata erogazione
dei servizi ("boots and serves nothing") in un netto rifiuto di avvio.

### 3 — `RUNTIME_CONTRACT_VERSION` (attualmente 1)

Il numero major del contratto tra bundle↔runtime. È distinto dalla versione del pacchetto
`@rebasepro/server`, che può rilasciare qualsiasi quantità di versioni minor e patch mentre questo
valore resta invariato.

**Leggere attentamente prima di modificarlo.** Il controllo è `!==`, non `>`:

> un bundle compilato per il contratto *N* viene eseguito **esclusivamente** su un runtime che implementa *N*

di conseguenza incrementarlo invalida **tutti i bundle mai compilati**, istantaneamente, finché ciascuno
non viene ricompilato. Questo è il rigore intenzionale — è la leva per stabilire che "nessun elemento
obsoleto può essere eseguito qui" — ma implica che un incremento rappresenti una migrazione a livello
dell'intera flotta, non una semplice nota di rilascio. Per il piano gestito deve essere coordinato con la
ricompilazione del bundle di ogni tenant.

Se una modifica è *additiva* e i vecchi bundle resterebbero comunque corretti, l'intervento corretto
riguarda `BUNDLE_FORMAT_VERSION` (o nessuna modifica), non questo valore.

### 4 — `AUTH_SCHEMA_VERSION` (attualmente 2)

Impresso in `rebase.schema_meta` e confrontato all'avvio. Un runtime **rifiuta di avviarsi**
a fronte di un database migrato da una versione del framework più recente, piuttosto che operare su
una struttura che non comprende — durante un rolling deploy, questa è la differenza tra metà della
flotta che genera errori e metà della flotta che corrompe i dati.

La migrazione in avanti è automatica: `ensureAuthTablesExist` provvede ad aggiornare i database più
vecchi. Nota che questo blocco di migrazione è deliberatamente incapsulato in un blocco `try/catch` e
si limita a registrare log invece di lanciare eccezioni — un avvio parziale è preferibile a un crash loop —
quindi **il fatto che "si sia avviato" non dimostra nulla**. Ogni asserzione nella suite di aggiornamento
legge direttamente il catalogo o i dati.

**Incrementalo quando** una migrazione non deve assolutamente essere ignorata da un runtime più vecchio.
Non incrementarlo per una colonna retrocompatibile e puramente additiva; c'è un esempio dettagliato di
questa valutazione in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash delle definizioni compilate delle collezioni, inserito nel manifest del bundle e replicato da un
SDK generato nell'header `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Esiste affinché la piattaforma
possa segnalare che "questa app è stata compilata con uno schema obsoleto" anziché fallire misteriosamente
alla prima richiesta.

`rebase generate-sdk` scrive questo valore in `schema.meta.ts`; passalo al client per inviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Il backend legge questo header a ogni richiesta dati. Il disallineamento (drift) non blocca mai una
chiamata — un SDK rimasto indietro di uno schema è solitamente ancora compatibile, e distribuire il
backend prima del frontend è il normale flusso di deployment — tuttavia, se una richiesta fallisce
con un 400 o un 404, l'errore riporta il drift come causa:

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

In questo modo, una colonna rinominata viene segnalata come "il tuo SDK non è aggiornato, rigeneralo",
anziché apparire come un campo che i tuoi tipi ritengono erroneamente esistente. Una richiesta che ha
successo non riceve mai questa notifica.

Copre **esclusivamente le collezioni**. La modifica di un hook o di una funzione non altera il contratto
del client e non deve invalidare ogni SDK generato.

### Chi sta chiamando

Due ulteriori segnali di identificazione, nessuno dei quali vincola nulla di per sé:

- **`GET /api/meta/schema-version`** non richiede autenticazione e restituisce lo `schemaVersion`
  del progetto *insieme al* suo `runtime` (`version` e `contract`). Un job di CI che confronta il proprio
  SDK generato rispetto a un progetto attivo non necessita di credenziali, così come non ne ha bisogno
  un client per chiedere a quale runtime si stia connettendo.
- **`User-Agent: rebase-cli/<version>`** viene allegato a ogni richiesta verso `rebase cloud`.
  Il formato su rete del control plane avanza più rapidamente di quanto pubblicato su npm, quindi
  deve poter rispondere a un vecchio client con `CLI_TOO_OLD` indicando la versione minima — operazione
  possibile solo se il chiamante dichiara la propria identità.

### 6 — Identificatori derivati del database

Ogni identificatore che questo framework ricava autonomamente senza istruzioni esplicite: una colonna
foreign key, un vincolo di foreign key, una tabella di giunzione e le sue due colonne chiave, un tipo enum,
il nome di una policy, la colonna in `snake_case` di una proprietà definita in `camelCase`.

> **Un identificatore derivato è congelato (frozen) nell'istante esatto in cui una release lo emette.**

Non "congelato fino alla prossima major" — congelato definitivamente. La motivazione è diversa rispetto
agli altri cinque contratti, ed è più vincolante. Quelli sono dotati di versione, quindi una discrepanza
può essere *rilevata* e respinta. Questo no: il nome viene scritto nel database di un cliente il giorno in cui
esegue il deploy, e non c'è alcun indicatore di versione sulle colonne. Ogni database predisposto da ogni
versione mai rilasciata include i nomi così come erano stati derivati, e nessun codice in questo repository
ha la possibilità di intervenire e rinominarli tutti.

La 0.13 è il caso di studio concreto. `generateForeignKeyName` ha introdotto una corretta gestione del
singolare — `categorie_id` → `category_id`, `addres_id` → `address_id` — che rappresenta senza dubbio
la derivazione migliore, ma ha rotto ogni database preesistente che contenesse un plurale irregolare.
La procedura di verifica all'avvio ha migrato la colonna, preservando i dati; il file `schema.generated.ts`
sottoposto a controllo di versione nel progetto non lo ha fatto, e l'avvio è fallito su una colonna che
in realtà esisteva. Tre commit, un nuovo seam test e una voce permanente nelle note di rilascio,
semplicemente per ottenere un nome di colonna visivamente più gradevole che nessuno aveva richiesto.

**Se una derivazione è realmente errata**, viene modificata solo per le collezioni create
*successivamente*, dietro una strategia di denominazione registrata all'interno del progetto — mai in
modo retroattivo e mai come effetto collaterale dell'ottimizzazione della funzione sottostante.

**L'unica eccezione legittima** è una modifica che allinea il codice a un nome che il database
*già possiede*. L'esempio pratico è il troncamento degli identificatori: Postgres tronca silenziosamente
gli identificatori a 63 byte, quindi un nome di vincolo derivato più lungo non è mai stato presente nel
catalogo con quel nome — la derivazione descriveva un oggetto inesistente con quella dicitura, e
la verifica all'avvio rieseguiva `ADD CONSTRAINT` a ogni singolo avvio poiché il confronto non poteva
mai combaciare. Il troncamento in fase di generazione altera ciò che questo repository *deriva*, ma non
cambia assolutamente nulla di ciò che qualsiasi database in produzione *contiene*. Questo è il criterio
da applicare: non "il nuovo nome è migliore", ma "qualche database esistente deve essere modificato?".

L'altro caso in cui un nome può cambiare riguarda un insieme di nomi che non potrebbero mai coesistere.
Una regola distribuita su diverse operazioni su una tabella con nome di 42 byte o più derivava
`<table>_default_admin_write_insert`, `_update` e `_delete`, e tutti e tre venivano troncati agli stessi
63 byte. Postgres memorizzava una sola policy, DELETE, e rifiutava ogni INSERT e UPDATE dell'amministratore.
Solo in presenza di collisioni di questo tipo i nomi vengono derivati con il suffisso per primo, nella
forma `<head>_<hash8>_<op>`. Ogni nome attualmente funzionante mantiene la propria formulazione.
L'avvio o il push successivo elimina l'unica policy troncata e crea una policy distinta per ciascuna operazione.

L'unica operazione sempre sicura è il *riconoscimento* di un vecchio nome per consentirne la migrazione:
`legacyForeignKeyName` esiste per essere rilevato, mai per essere generato, e la baseline blocca anche
queste rilevazioni. Rimuoverne una annullerebbe silenziosamente la migrazione per ogni database che
utilizza ancora quella dicitura.

**Il gate.** `tooling/scripts/derived-names.mts` esegue una fixture di stress sui nomi — plurali
irregolari, terminazioni in `ss`, acronimi, giunzioni da slug plurali, override espliciti, slug abbastanza
lunghi da essere troncati — attraverso entrambi i generatori di DDL dello schema, e visualizza ogni
identificatore denominato da ciascuno di essi:

```bash
pnpm check:derived-names
```

Una riga modificata o rimossa comporta il fallimento per rottura del contratto, mostrando la vecchia e
la nuova dicitura affiancate. Anche una modifica puramente additiva fallisce, ma con l'indicazione di
"rigenerare" — impedendo così alla baseline di subire disallineamenti non tracciati.

Inoltre, assicura che `rebase db push` e il controllo all'avvio del runtime gestito derivino gli *stessi*
identici nomi, rappresentando un secondo contratto nascosto all'interno del primo: compilano le medesime
collezioni attraverso porzioni di codice differenti, e un progetto inviato tramite push una volta e avviato
in seguito non deve in alcun caso ritrovarsi con due schemi divergenti.

## Cosa *non* è bloccato (frozen)

Esplicitato chiaramente, affinché nessuno presuma garanzie mai fornite:

- L'API TypeScript creata dall'utente — configurazione delle collezioni, opzioni di
  `initializeRebaseBackend`, proprietà di admin, nomi dei metodi dell'SDK. Le modifiche distruttive
  vengono introdotte nelle minor e documentate nel changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — questi pacchetti evolvono più rapidamente e contano meno utilizzatori.
- Qualsiasi elemento sotto la directory `src/` di un pacchetto che non sia riesportato dal suo file barrel.
  `packages/client/src/index.ts` include una nota che spiega come la sua lista di export sia curata
  meticolosamente proprio per evitare che un export interno diventi accidentalmente pubblico.
- Lo schema del database delle *tue* collezioni. Quello appartiene a te; Rebase gestisce unicamente
  lo schema `rebase` (e, nei database predisposti prima della 0.13, il vecchio schema `auth` finché non
  viene ritirato in fase di boot).

## I gate a presidio di queste regole

Nulla di quanto descritto sopra è una semplice convenzione — a ogni aspetto corrisponde un test che fallisce in caso di rottura:

| Gate | Cosa presidia |
|---|---|
| `pnpm verify:corpus` | ogni struttura di bundle mai rilasciata, avviata sul runtime odierno. Le fixture in `tests/fixtures/bundles/` sono **scritte manualmente e congelate** — una fixture rigenerata automaticamente dal builder muta ogni volta che il builder cambia |
| `pnpm verify:selfhost` | un bundle reale compilato, ripiegato, avviato e interrogato esattamente come farebbe un browser |
| `upgrade-e2e.test.ts` | vecchi schemi di database (`schema-snapshots/`) gestiti dall'attuale runtime |
| `tests/e2e/tests/cli-init-e2e.ts` | un progetto basato su template installato da **archivi tarball reali**, non da symlink del workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | il percorso dell'utente finale: registrazione → accesso → letture con scope RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | ogni nome di colonna, vincolo, giunzione, enum e policy derivato dal framework — assicurando che l'avvio e `db push` li derivino in modo identico |
| `pnpm rls:check` | le policy dello schema generato |
| `pnpm check:api-surface` | ogni export, con i relativi membri, dei cinque pacchetti forniti dall'immagine — `@rebasepro/server`, `types`, `client`, `common`, `utils` — oltre all'entry point `@rebasepro/server/functions`, a fronte delle sei sezioni di `contracts/server.api.txt`. Questi sono i pacchetti che `infra/docker/entrypoint.mjs` collega tramite symlink sovrascrivendo le copie interne di un bundle distribuito, quindi la rimozione di un export da uno di essi non si traduce in un errore di compilazione — bensì in un fallimento all'avvio sull'intera flotta, durante un rollout imprevisto |
| `pnpm test:gates` | i test dei gate stessi, eseguiti sulle fixture — quarantasette file, tra cui `check:api-surface` e la verifica del bump di rilascio indicata di seguito — affinché un gate che smette di monitorare ciò che deve proteggere fallisca qui. Per molto tempo `check:api-surface` non è stato in grado di rilevare la scomparsa di un membro da `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | verifica che il livello di incremento con cui viene rilasciata una versione corrisponda a quanto la release ha modificato nelle baseline di cui sopra — eseguito da `publish.yml` prima della registrazione del changelog |
| saas CI | il control plane compilato a fronte del branch `main` di questo repository, sui propri push e nelle build notturne |

**Registra una fixture del bundle e uno snapshot dello schema una volta per ogni release.** Il valore
di entrambi i corpus risiede interamente nell'arco temporale coperto a ritroso dalla voce più vecchia,
e nessuno dei due può essere integrato retroattivamente.

### Non ancora protetti da gate

La tabella precedente elenca ciò che è attualmente garantito. Di seguito sono indicate le parti della policy
per le quali non esiste ancora una protezione automatica, specificate affinché non vengano interpretate
come garanzie acquisite:

- **Nessuna finestra formale di deprecazione o supporto.** Finché Rebase rimane in `0.x`, non esiste
  una regola scritta sulla durata di sopravvivenza di un export deprecato prima della rimozione, né
  sulla durata del supporto con correzioni per una release minor precedente. Le patch di sicurezza
  vengono applicate esclusivamente sull'ultima minor disponibile.
- **Il formato wire HTTP non ha alcun gate.** Nessuno script `check:*` confronta le strutture di
  richiesta e risposta con una baseline come fa `check:api-surface` per gli export; una modifica nella
  struttura di una risposta viene rilevata unicamente se una suite e2e si trova a leggerla.
- **I flag della CLI non hanno una baseline di compatibilità.** Il verificatore della documentazione
  segnala un errore solo quando scompare un flag utilizzato dalle skill, dagli esempi o dal sito di
  marketing; la rimozione di qualunque altro flag o la modifica del suo significato passa inosservata.
- **Una release da CI non archivia alcuno dei due corpus.** Il workflow di pubblicazione non registra
  né la fixture del bundle né lo snapshot dello schema; solo lo script di rilascio locale tenta di farlo,
  limitandosi ad avvertire con un warning anziché bloccarsi quando non vi riesce. Le versioni da 0.18 a 0.21
  sono prive di snapshot di progetto registrati.
- **La superficie degli export è un gate, non un contratto.** La possibilità che gli export pubblici
  dei pacchetti forniti dal runtime diventino un settimo contratto numerato — formalizzato come baseline
  di `check:api-surface`, compatibile in modo additivo all'interno della stessa major del contratto —
  rappresenta una decisione ancora aperta.

## Modificare un contratto

1. Identifica a quale dei sei contratti appartiene la modifica. La maggior parte dei cambiamenti non
   riguarda nessuno di essi — ma "nessuno dei sei" non significa "privo di rischi". Rimuovere o rinominare
   un export di `@rebasepro/server`, o un suo membro, non rientra tra i sei ed è la modifica in assoluto
   più pericolosa nel repository, poiché il codice che viene rotto è già compilato e non verrà ricompilato.
   `pnpm check:api-surface` presidia proprio questa linea; stabilire se debba diventare un settimo
   contratto numerato è una decisione aperta (vedi la sezione *Non ancora protetti da gate* sopra).
2. Aggiungi innanzitutto una fixture o uno snapshot per la **vecchia** conformazione e verifica che passi il test.
3. Applica la modifica e incrementa la costante corrispondente.
4. Assicurati che la vecchia fixture continui a passare, oppure che ora fallisca *restituendo il messaggio
   di cui l'utente avrebbe bisogno*. Entrambi sono esiti validi; il silenzio non lo è.
5. Per il contratto 3, pianifica la ricompilazione di ogni bundle distribuito prima di procedere al merge.
6. Il contratto 6 rappresenta l'eccezione ai passaggi 3 e 4: non c'è alcuna costante da incrementare
   né alcuna versione su cui opporre un rifiuto, poiché le colonne non recano un'indicazione di versione.
   Il passaggio alternativo consiste nel decidere di non attuare la modifica — consulta la sezione
   precedente per comprendere come impostare l'alternativa.

## Risorse correlate

- [Aggiornamento](/docs/upgrading/) — cosa ha effettivamente subito modifiche distruttive, release dopo release
- [Changelog](/docs/changelog/) — ogni singola modifica, comprese quelle non distruttive
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contratto 3 — il formato del bundle su cui un progetto distribuito è già compilato
