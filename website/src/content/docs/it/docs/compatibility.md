---
sourceHash: 63db41eff259cc37
slug: it/docs/compatibility
title: Compatibilità
description: Cosa promette Rebase tra le diverse versioni e cosa no — i sei contratti con versione, come fallisce ciascuno di essi e cosa potrebbe ancora cambiare in una minor release.
---

Cosa promette Rebase tra le diverse versioni, e cosa no.

Questo è il documento da leggere prima di modificare qualsiasi elemento da cui dipende già un
progetto distribuito o un tenant Rebase Cloud attivo. È anche la risposta sincera alla
domanda: "se sviluppo su Rebase oggi, cosa si romperà in seguito?"

## Cosa significa "beta" in questo contesto

Rebase è in beta pubblica. La maggior parte dei progetti usa questa parola per indicare che "tutto
potrebbe rompersi", il che non fornisce a chi legge alcuna indicazione utile per pianificare. Ecco quindi
il limite concreto tracciato da questo progetto:

> **L'API su cui scrivi codice può cambiare in una minor, con una voce nel changelog.
> I tuoi dati non possono rompersi silenziosamente.**

La prima metà è il consueto comportamento di una versione `0.x` ed è descritto di seguito. La seconda
metà è la parte che vale la pena esaminare, perché riguarda i meccanismi effettivi piuttosto
che le intenzioni: i contratti con versione illustrati nella sezione successiva sono ciascuno impressi
in un artefatto o in un database, ciascuno viene verificato all'avvio o in fase di acquisizione, e ciascuno
**fallisce in modo esplicito e specifico** anziché degradarsi. Un push dello schema che
comporterebbe l'eliminazione di una colonna viene rifiutato da un gate distruttivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e il percorso di aggiornamento
stesso è un test: `upgrade-e2e.test.ts` ripristina i database esattamente come li avevano lasciati
le release precedenti, esegue l'attuale percorso di migrazione su ciascuno di essi e verifica
che le righe sopravvivano — non semplicemente che l'avvio sia andato a buon fine.

Cosa significa davvero beta: mancano ancora delle funzionalità, alcuni sottosistemi sono più recenti di
altri, e la forma delle imperfezioni è che qualcosa è assente o poco pratico,
non che corrompa silenziosamente i dati. Quali siano questi sottosistemi viene reso pubblico
e datato anziché lasciato alla scoperta casuale — la tabella sottostante rappresenta
tale pubblicazione.

## Prontezza per sottosistema

**Ultima revisione: 14 settembre 2026, relativa a 0.21.0.** Rileggila a ogni minor; una
valutazione che non è cambiata in tre release è ormai consolidata o dimenticata, e
questa nota è qui affinché la differenza venga verificata.

Le tre valutazioni indicano:

- **Stabile** — la struttura è consolidata e protetta da un gate in CI. Può ancora
  ricevere nuove funzionalità; non verrà riprogettata all'improvviso all'interno della 0.x, e una modifica
  incompatibile verrà annunciata nel changelog.
- **Beta** — funziona ed è utilizzato in produzione, ma presenta aspetti ancora acerbi
  noti: un limite raggiungibile, un caso limite scomodo, una decisione di design non
  ancora presa. La parte acerba viene indicata esplicitamente nelle note, perché la dicitura "beta" da sola
  non dice nulla su cui pianificare.
- **Sperimentale** — rilasciato per poter essere utilizzato e testato. Aspettati di imbatterti
  negli aspetti che nessuno ha ancora affrontato.

| Sottosistema | Valutazione | Su cosa si basa la valutazione |
|---|---|---|
| REST API + generated SDK | Stabile | Il wire contract ha una versione ed è protetto da gate; `client-sdk-e2e` gestisce registrazione → accesso → letture con ambito RLS → aggiornamento token → storage → realtime end-to-end |
| Auth — email/password, OAuth, OIDC, magic link, one-time code | Stabile | Include dodici provider OAuth. Lo schema di autenticazione è un contratto con versione, impresso e verificato all'avvio |
| Auth — MFA (TOTP) | Beta | Registrazione, verifica e recupero funzionano e sono testati. La rotazione della chiave è implementata per la chiave di crittografia; non esiste un'interfaccia di amministrazione per reimpostare il fattore di un utente bloccato |
| Row-level security | Stabile | Il cardine del prodotto. `pnpm rls:check` esegue l'audit di un database live a fronte di quindici controlli, e la suite e2e di RLS viene eseguita a ogni push |
| Storage | Stabile | Locale, S3 e GCS. Default-deny in produzione a partire da 0.17.0, e lo scaffold fornisce un hook di autorizzazione |
| Realtime | **Beta** | Le sottoscrizioni corrispondono solo per percorso della collection, quindi N sottoscrittori su una collection costano N re-fetch con ambito RLS per ogni scrittura. Questo limita un deployment a qualche centinaio di sottoscrittori concorrenti. Corretto a qualsiasi scala; costoso oltre tale limite |
| Vector search (pgvector) | Beta | Ogni colonna vettoriale ottiene di default un indice HNSW per distanza del coseno, configurabile per proprietà tramite `VectorIndexConfig` (metodo, distanze, parametri di build) o disattivabile, lasciando una scansione esatta. pgvector non può indicizzare colonne con più di 2.000 dimensioni, pertanto queste rimangono non indicizzate e vengono scansionate |
| Offline sync | Beta | Le mutazioni includono chiavi di idempotenza rispettate dal server, e i difetti di perdita di dati rilevati durante l'audit di luglio sono stati risolti. Il modello di conflitto è last-write-wins senza merge per singolo campo |
| Entity history | Stabile | Basata su snapshot, protetta da una propria suite di test |
| Functions and crons | Stabile | L'entry point portabile (`@rebasepro/server/functions`) è un contratto con versione dotato di una propria sezione dedicata alla superficie API |
| MCP server + agent skills | Beta | `@rebasepro/mcp` viene eseguito tramite stdio: cinquantatré strumenti, autenticazione bearer per progetto, gli strumenti distruttivi rifiutano target non locali a meno di un opt-in esplicito. Dalla versione 0.21 il server può anche montare un endpoint remoto `/mcp` — OAuth 2.1, otto strumenti dati, ogni chiamata sotto la RLS dell'utente autenticato — disattivato a meno che `REBASE_MCP_ENABLED=true`, e solo per Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizzato quotidianamente su progetti reali. Il branching è presente nel pacchetto OSS e deliberatamente non esposto in Rebase Cloud, poiché il passaggio di una distribuzione attiva a un branch non è ancora supportato |
| CMS + admin panel | Beta | Completo per CRUD, relazioni, campi storage e ruoli. **La tabella dati non ha semantica di griglia** — nessun `role`, nessun `aria-rowindex`, `tabIndex` rimosso — quindi gli utenti che usano tastiera o screen-reader non possono interagire con la vista principale. Nessuna bozza, nessun contenuto per lingua (locale), nessun testo formattato a blocchi |
| PGlite managed dev database | Beta | `rebase dev` a configurazione zero senza Docker. Una sola sessione alla volta, quindi le richieste vengono serializzate e non è possibile riprodurre la concorrenza; i comandi basati su Atlas (`db push`, `generate`, `migrate`) eseguono il piano a fronte di una seconda istanza PGlite usa-e-getta avviata per il comando (nella 0.24 rifiutano il database gestito); `db branch` non funziona lì e lo segnala |
| Helm chart | Beta | Esegue il rendering della topologia a processi separati e viene pubblicato nel registro OCI a ogni release. Il default rimane un singolo container |
| `@rebasepro/server-mongo` | **Sperimentale** | Un driver funzionante con realtime basato su change-stream e cronologia a snapshot. **Nessuna row-level security** — l'intero modello di isolamento sopra descritto non si applica — e nessuna relazione. I change stream richiedono un replica set: su un `mongod` standalone nulla li sostituisce, quindi una sottoscrizione vede solo le scritture effettuate tramite quel processo Rebase e perde tutte le altre. Nessun MFA: la registrazione risponde 501 e i controlli rispondono "nessun fattore", quindi il login non ne richiede mai uno. L'aggregazione admin non può avere come target una collection — legge il nome da uno stage `$from` che MongoDB non possiede — quindi non restituisce nulla |
| `@rebasepro/firebase` | Sperimentale | Esegue il pannello admin e l'SDK su Firestore. Nessun RLS, nessuna superficie SQL; il set di funzionalità di Postgres non viene trasferito. Il driver Firestore ignora i gruppi di filtri `or(...)`/`and(...)`, quindi una query che ne utilizza uno legge ogni riga consentita dai suoi filtri semplici |
| Rebase Cloud | **Private beta** | Attivo, con tenant reali, aperto a scaglioni. Non self-service |

Due voci sopra riportate rappresentano il prezzo in termini di trasparenza del pubblicare questa tabella:
il refetch del realtime e l'accessibilità della tabella dati sono difetti aperti, non elementi
della roadmap, ed entrambi sono elencati anziché lasciati alla scoperta dell'utente.

Questa tabella rappresenta ciò che esiste. Ciò che ancora non c'è si trova nella
[roadmap](https://rebase.pro/roadmap), con una voce per ogni issue di GitHub e con
contrassegnato il sottoinsieme necessario per la 1.0.

## La promessa dello 0.x

Rebase è nella fase `0.x`. Questa sezione è scritta per essere valida per ogni release 0.x anziché
per una sola di esse, in modo da non diventare obsoleta a ogni taglio di versione. **Le modifiche che interrompono la compatibilità (breaking change) all'API TypeScript scritta dallo sviluppatore sono ancora consentite in una minor**, e il changelog è
il luogo in cui vengono annunciate. Ciò che
*non* può rompersi silenziosamente è l'insieme dei contratti con versione riportati di seguito: ciascuno
di essi è impresso in un artefatto o in un database, ciascuno viene controllato all'avvio o in fase di
acquisizione, e ciascuno fallisce **in modo esplicito e specifico** anziché degradarsi.

Questa distinzione racchiude l'intera promessa. Un export rinominato costa un errore
di compilazione e cinque minuti. Un bundle che si avvia a fronte del runtime sbagliato e restituisce
dati sottilmente errati costa un incidente, e i contratti esistono affinché la
seconda categoria non possa mai verificarsi silenziosamente.

Rebase Cloud fa affidamento esattamente su questi contratti e su nient'altro. Tutto ciò che non è
elencato qui è un dettaglio di implementazione da cui la piattaforma non dipende.

### Badge di versione e canary

La documentazione viene pubblicata dal branch `main`, quindi una pagina può descrivere qualcosa che nessuna
release stabile possiede ancora. Un badge *Since* indica la prima release stabile che include quella funzionalità,
e il testo accanto spiega il comportamento della versione precedente.

Una versione canary è una build di `main` numerata in base alla release verso cui è diretta:
`0.25.0-canary.g<commit>` rappresenta `main` a quel commit, dopo la 0.24.0 e prima
della 0.25.0, e `rebase upgrade --to canary` installa la più recente. Include
tutto ciò che era confluito in `main` al momento della compilazione, quindi un badge che indica la sua
versione (Since 0.25) è applicabile al tuo caso, e la nota sulla release precedente (on
0.24) descrive la release stabile da cui provieni. Le canary precedenti alla 0.25.0 erano
invece numerate a partire dall'ultima release: anche `0.24.1-canary.g<commit>` è un'anteprima
della 0.25.

## I contratti con versione

I valori seguenti vengono letti direttamente dal codice sorgente; considera i riferimenti ai file come la fonte di verità
e questa tabella come la mappa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contratto | Dichiarato in | Verificato in | Direzione di compatibilità |
|---|---|---|---|---|
| 1 | Intervallo `rebase` in `rebase.json` | il progetto dell'utente | CLI in fase di build | il progetto specifica quali runtime accetta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatibile** — il nuovo runtime legge i vecchi bundle |
| 3 | `RUNTIME_CONTRACT_VERSION` | stesso file | stesso file | **corrispondenza esatta, in entrambe le direzioni** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | all'avvio, a fronte di `rebase.schema_meta` | **solo in avanti** — il nuovo runtime migra i vecchi database |
| 5 | `manifest.schemaVersion` | emesso da `rebase build` | inviato dall'SDK come `x-rebase-schema` quando configurato | indicativo — identifica lo schema su cui è stato compilato il client |
| 6 | Identificatori derivati del database | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelato** — un nome emesso da una release non viene mai ricalcolato |

### 1 — `rebase` in `rebase.json`

Un intervallo semver, interpretato come `engines` in un `package.json`: indica quali versioni del runtime
questo progetto accetta. Chiamato deliberatamente `rebase` anziché `runtime`, poiché
`runtime` indica già *chi possiede il processo* (`managed` | `custom`) su un'app.

### 2 — `BUNDLE_FORMAT_VERSION` (attualmente 2)

Il layout su disco di un bundle compilato. Un runtime accetta qualsiasi bundle il cui formato
sia **minore o uguale** al proprio, ed è questo che consente al livello gestito di spostare un
tenant su una nuova immagine senza che nessuno debba ricompilare il proprio progetto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` una singola directory,
  `entry.admin` per un pannello admin integrato.
- **2** — `kind: "backend" | "static"`, `entry.static` un elenco, `entry.admin`
  rimosso. Il formato 1 viene ancora letto, tramite `upgradeLegacyManifest`.

**Incrementalo quando** il layout cambia in modo tale che un runtime precedente interpreterebbe in modo errato
un bundle più recente. L'incremento è ciò che trasforma una situazione del tipo "si avvia ma non serve nulla" in un
rifiuto esplicito dell'avvio.

### 3 — `RUNTIME_CONTRACT_VERSION` (attualmente 1)

La versione major del contratto bundle↔runtime. Distinta dalla versione del pacchetto `@rebasepro/server`,
che può rilasciare qualsiasi numero di versioni minor e patch mentre questa rimane invariata.

**Leggi questo prima di toccarlo.** Il controllo è `!==`, non `>`:

> un bundle destinato al contratto *N* viene eseguito **solo** su un runtime che implementa *N*

quindi incrementarlo invalida **ogni bundle mai compilato**, tutti insieme, finché ciascuno
non viene ricompilato. Questa è la severità prevista — è la leva del tipo "niente di vecchio può essere eseguito qui"
— ma significa che un incremento costituisce una migrazione a livello dell'intero parco istanze, non una semplice nota di rilascio. Per
il livello gestito deve essere coordinato con una ricompilazione del bundle di ogni tenant.

Se una modifica è *additiva* e i vecchi bundle rimarrebbero comunque corretti, essa richiede
`BUNDLE_FORMAT_VERSION` (o niente del tutto), non questo.

### 4 — `AUTH_SCHEMA_VERSION` (attualmente 2)

Impresso in `rebase.schema_meta` e confrontato all'avvio. Un runtime **si rifiuta di
avviarsi** a fronte di un database migrato da una versione più recente del framework, piuttosto che
operare su una struttura che non comprende — durante un rolling deploy, questa è
la differenza tra metà del parco istanze che restituisce un errore e metà che corrompe i dati.

La migrazione in avanti è automatica: `ensureAuthTablesExist` aggiorna un database
più vecchio. Si noti che questo blocco di migrazione è deliberatamente racchiuso in un `try/catch` ed
esegue il log invece di sollevare un'eccezione — un avvio zoppicante è meglio di un crash loop — quindi **"si è
avviato" non dimostra nulla**. Ogni asserzione nella suite di upgrade legge invece il
catalogo o i dati.

**Incrementalo quando** una migrazione non deve essere saltata da un runtime precedente. Non
incrementarlo per una colonna additiva e retrocompatibile; c'è un esempio pratico di questa
valutazione in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash delle definizioni compilate delle collection, emesso nel manifest del bundle
e replicato da un SDK generato nell'header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Esiste affinché la piattaforma possa segnalare che "questa app è stata creata
a fronte di uno schema precedente" anziché fallire misteriosamente alla prima richiesta.

`rebase generate-sdk` scrive il valore in `schema.meta.ts`; passalo al
client per inviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Il backend legge tale header a ogni richiesta di dati. Il disallineamento (drift) non rifiuta mai una
chiamata — un SDK indietro di uno schema è solitamente ancora compatibile, e distribuire il
backend prima del frontend è il normale ordine di deployment — ma quando una richiesta
fallisce con un 400 o un 404, l'errore riporta il drift come causa:

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

In questo modo, una colonna rinominata viene segnalata come "il tuo SDK non è aggiornato, rigeneralo" anziché come
un campo che i tuoi tipi insistono debba esistere. A una richiesta andata a buon fine questo non viene mai notificato.

Copre **solo le collection**. La modifica di un hook o di una funzione non altera il
contratto di un client e non deve invalidare ogni SDK generato.

### Chi sta effettuando la chiamata

Altri due segnali identificativi, nessuno dei quali blocca nulla di per sé:

- **`GET /api/meta/schema-version`** non richiede autenticazione e risponde con lo
  `schemaVersion` del progetto *e* con il suo `runtime` (`version` e `contract`). Un
  job di CI che confronta il proprio SDK generato con un progetto live non necessita di
  credenziali, così come un client che chiede con quale runtime stia comunicando.
- **`User-Agent: rebase-cli/<version>`** viene incluso in ogni richiesta verso `rebase cloud`.
  Il formato di rete (wire format) del control plane evolve più rapidamente di quanto pubblicato su npm, quindi
  deve poter rispondere a un client obsoleto con `CLI_TOO_OLD` e la versione minima —
  operazione possibile solo se il chiamante dichiara la propria identità.

### 6 — Identificatori derivati del database

Qualsiasi nome che questo framework ricava autonomamente anziché ricevere esplicitamente: una colonna
di chiave esterna, un vincolo di chiave esterna, una tabella di giunzione e le sue due colonne chiave, un
tipo enum, il nome di una policy, la colonna in `snake_case` di una proprietà definita in `camelCase`.

> **Un identificatore derivato è congelato dal momento esatto in cui una release lo emette.**

Non "congelato fino alla prossima major release" — congelato. La motivazione è diversa da quella degli
altri cinque contratti, ed è più vincolante. Quelli hanno una versione, quindi un disallineamento può essere
*rilevato* e rifiutato. Questo no: il nome viene scritto nel database di un cliente
il giorno in cui effettua il deployment, e non vi è alcuna indicazione di versione su una colonna. Ogni
database sottoposto a provisioning da qualsiasi release mai rilasciata contiene qualsiasi cosa sia stata derivata,
e nessun codice in questo repository può intervenire per rinominarli tutti.

La 0.13 ne è l'esempio pratico. `generateForeignKeyName` ha imparato a rendere correttamente al
singolare i nomi — `categorie_id` → `category_id`, `addres_id` → `address_id` — che è
senza dubbio una derivazione migliore, e ha rotto ogni database preesistente che contenesse un
plurale irregolare. Il boot-ensure ha migrato la colonna, quindi i dati sono sopravvissuti; il
file `schema.generated.ts` salvato nel repository del progetto no, e l'avvio è fallito a causa di una colonna
che esisteva. Tre commit, un nuovo seam test e una nota permanente nelle note
di aggiornamento, in cambio di un nome di colonna esteticamente più gradevole che nessuno aveva richiesto.

**Se una derivazione è realmente errata**, viene modificata solo per le collection create
*successivamente*, dietro una naming strategy registrata nel progetto — mai
retroattivamente e mai come effetto collaterale del miglioramento della funzione sottostante.

**L'unica eccezione legittima** è una modifica che allinea il codice a un nome che il database
*ha già*. L'esempio pratico è il troncamento degli identificatori: Postgres
tronca silenziosamente un identificatore a 63 byte, quindi un nome di vincolo derivato più lungo non
è mai stato presente con quel nome nel catalogo — la derivazione descriveva un oggetto che
non esisteva con quella dicitura, e il boot-ensure rieseguiva `ADD CONSTRAINT` su
ogni singolo avvio perché il confronto non poteva mai corrispondere. Il troncamento in fase di
costruzione modifica ciò che questo repository *deriva* e non cambia nulla di ciò che qualsiasi
database distribuito *contiene*. Questo è il criterio da applicare: non "il nuovo nome è
migliore?", ma "qualche database esistente deve cambiare?".

L'altro caso in cui un nome può cambiare è un insieme di nomi che non potrebbero mai coesistere tutti.
Una regola che copriva diverse operazioni su una tabella di 42 o più byte derivava
`<table>_default_admin_write_insert`, `_update` e `_delete`, e tutti e tre venivano troncati
agli stessi 63 byte. Postgres memorizzava una sola policy, DELETE, e rifiutava ogni
INSERT e UPDATE dell'amministratore. Solo quando i nomi di una regola entrano in conflitto in questo modo
vengono derivati con il suffisso prioritario, come `<head>_<hash8>_<op>`. Ogni nome che funziona
oggi mantiene la sua dicitura. L'avvio o push successivo elimina l'unica policy troncata e crea una
policy per ciascuna operazione.

L'unica cosa che è sempre sicura è *riconoscere* un vecchio nome per poterlo migrare:
`legacyForeignKeyName` esiste per essere rilevato, mai per essere generato, e la baseline
fissa anche tali rilevamenti. Rimuoverne uno annulla silenziosamente la migrazione di
ogni database che ha ancora quella dicitura.

**Il gate.** `tooling/scripts/derived-names.mts` esegue una fixture di stress sui nomi — plurali
irregolari, terminazioni in `ss`, acronimi, tabelle di giunzione generate da slug plurali, override
espliciti, slug sufficientemente lunghi da essere troncati — attraverso entrambi i generatori di DDL dello schema,
e visualizza ogni identificatore prodotto da ciascuno di essi:

```bash
pnpm check:derived-names
```

Una riga modificata o rimossa fallisce come violazione del contratto, mostrando la vecchia e la nuova dicitura
affiancate. Anche una modifica puramente additiva fallisce, ma con l'indicazione "regenerate" — in modo che
la baseline non possa subire variazioni all'insaputa di nessuno.

Fissa inoltre che `rebase db push` e il boot-ensure del runtime gestito derivino gli
*stessi* nomi, il che rappresenta un secondo contratto nascosto all'interno del primo: compilano
le stesse collection attraverso codice diverso, e un progetto caricato con push e avviato
in seguito non deve ritrovarsi con due schemi diversi.

## Cosa *non* è congelato

Detto chiaramente, affinché nessuno presuma promesse mai fatte:

- L'API TypeScript scritta dallo sviluppatore — configurazione delle collection, opzioni di `initializeRebaseBackend`,
  proprietà admin, nomi dei metodi dell'SDK. Le breaking change avvengono nelle minor e
  vengono annunciate nel changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — questi pacchetti si evolvono più rapidamente e hanno il minor numero di utilizzatori.
- Tutto ciò che si trova sotto `src/` di un pacchetto e non viene riesportato dal relativo file barrel.
  `packages/client/src/index.ts` include una nota che spiega che il suo elenco di export
  è curato appositamente affinché un export interno non possa diventare pubblico per errore.
- Lo schema del database delle *tue* collection. Quello appartiene a te; Rebase gestisce solo lo
  schema `rebase` (e, su un database creato prima della versione 0.13, il vecchio schema `auth`
  finché l'avvio non lo dismette).

## I gate a presidio di queste garanzie

Nulla di quanto sopra è una semplice convenzione: ognuno ha un test che fallisce in caso di violazione:

| Gate | Cosa presidia |
|---|---|
| `pnpm verify:corpus` | ogni forma di bundle mai rilasciata, avviata sul runtime odierno. Le fixture in `tests/fixtures/bundles/` sono **scritte a mano e congelate** — una fixture rigenerata dal builder cambia ogni volta che cambia il builder |
| `pnpm verify:selfhost` | un vero bundle compilato, compresso, avviato e interrogato esattamente come farebbe un browser |
| `upgrade-e2e.test.ts` | i vecchi schemi di database (`schema-snapshots/`) gestiti dal runtime attuale |
| `tests/e2e/tests/cli-init-e2e.ts` | un progetto generato via scaffold installato da **veri tarball**, non da collegamenti del workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | il percorso dell'utente finale: registrazione → accesso → letture con ambito RLS → aggiornamento token → storage → realtime |
| `pnpm check:derived-names` | ogni nome di colonna, vincolo, tabella di giunzione, enum e policy derivato dal framework — e che l'avvio e `db push` li derivino in modo identico |
| `pnpm rls:check` | le policy dello schema generato |
| `pnpm check:api-surface` | ogni export e i relativi membri dei cinque pacchetti forniti dall'immagine — `@rebasepro/server`, `types`, `client`, `common`, `utils` — oltre all'entry point `@rebasepro/server/functions`, a fronte delle sei sezioni di `contracts/server.api.txt`. Questi sono i pacchetti che `infra/docker/entrypoint.mjs` collega tramite symlink sopra le copie del bundle distribuito, quindi la rimozione di un export da uno di essi non è un errore di compilazione per gli utenti — è un errore di avvio nell'intero parco istanze, durante un rollout che nessuno ha richiesto |
| `pnpm test:gates` | i test dei gate stessi, eseguiti sulle fixture — quarantasette file, tra cui `check:api-surface` e il controllo del bump di release descritto sotto — in modo che un gate che smette di rilevare ciò che dovrebbe proteggere fallisca qui. `check:api-surface` ha trascorso la sua intera esistenza senza essere in grado di rilevare la scomparsa di un membro da `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | che il livello di incremento (bump) con cui viene rilasciata una versione corrisponda a ciò che la release ha modificato nelle baseline di cui sopra — eseguito da `publish.yml` prima che il changelog venga impresso |
| saas CI | il control plane compilato a fronte del branch `main` di questo repository, sui propri push e a frequenza notturna |

**Registra una fixture del bundle e uno snapshot dello schema una volta per ogni release.** Il valore di
entrambi i corpora risiede interamente in quanto indietro nel tempo risale il più vecchio, e nessuno dei due può essere
ricostruito a posteriori.

### Non ancora protetto da gate

La tabella sopra rappresenta ciò che è garantito. Queste sono le parti della policy per le quali non esiste
ancora una protezione automatica, elencate affinché nessuno vi legga una promessa:

- **Nessuna finestra di deprecazione o supporto.** Finché Rebase è in versione `0.x` non esiste alcuna
  regola scritta su quanto a lungo un export deprecato rimanga prima di essere rimosso, o per quanto tempo un'older
  minor release riceva correzioni. Le correzioni di sicurezza vengono applicate solo alla minor release più recente.
- **Il formato di rete HTTP (wire format) non ha un gate.** Nessuno script `check:*` confronta la struttura
  di richieste e risposte con una baseline come fa `check:api-surface` per gli export; una
  modifica nella struttura della risposta viene rilevata solo da una suite e2e che casualmente la legge.
- **I flag della CLI non hanno una baseline di compatibilità.** Lo strumento di verifica della documentazione fallisce quando
  un flag utilizzato dalle skill, dagli esempi o dal sito di marketing scompare; nulla
  si accorge della rimozione di qualsiasi altro flag o del cambio di significato di un flag.
- **Un rilascio via CI non registra alcun corpus.** Il workflow di pubblicazione non registra alcuna fixture
  di bundle né alcuno snapshot di schema; solo lo script di rilascio locale ci prova, e
  segnala un avviso anziché bloccarsi quando non ci riesce. Dalla 0.18 alla 0.21 non è presente alcuno
  snapshot di progetto registrato.
- **La superficie degli export è un gate, non un contratto.** Se gli export pubblici dei pacchetti forniti dal
  runtime diventeranno un settimo contratto numerato — dichiarato come la baseline di `check:api-surface`,
  compatibile in modo additivo all'interno di una major del contratto — è una decisione ancora aperta.

## Modificare un contratto

1. Determina a quale dei sei appartiene. La maggior parte delle modifiche non rientra in nessuno di essi — ma "nessuno
   dei sei" non significa "privo di rischi". Rimuovere o rinominare un export di
   `@rebasepro/server`, o un suo membro, non fa parte dei sei ed è la modifica in assoluto
   più pericolosa nel repository, perché il codice che viene interrotto è già compilato
   e non verrà ricompilato. `pnpm check:api-surface` è ciò che presidia questo confine; se
   diventerà un settimo contratto numerato è una decisione ancora aperta (vedi
   *Non ancora protetto da gate*, sopra).
2. Aggiungi prima una fixture o uno snapshot per la **vecchia** struttura, e verifica che il test passi.
3. Applica la modifica e incrementa la costante.
4. Conferma che la vecchia fixture continui a passare, oppure che ora fallisca *con il messaggio
   necessario all'utente*. Entrambi sono esiti validi; il silenzio non lo è.
5. Per il contratto 3, pianifica la ricompilazione di ogni bundle distribuito prima del merge.
6. Il contratto 6 fa eccezione ai punti 3 e 4: non c'è alcuna costante da incrementare e
   nessuna versione su cui opporre un rifiuto, poiché una colonna non reca alcuna indicazione di versione. Il passaggio
   che li sostituisce consiste nel decidere di non apportare la modifica — consulta la sezione precedente
   per vedere quale sia l'alternativa.

## Risorse correlate

- [Aggiornamento](/docs/upgrading/) — cosa si è effettivamente rotto, release per release
- [Changelog](/docs/changelog/) — ogni modifica, comprese quelle che non hanno rotto nulla
- [Runtime e Bundle](/docs/architecture/runtime-and-bundles/) — contratto 3 — il formato di bundle su cui un progetto distribuito è già compilato
