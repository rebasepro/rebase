---
sourceHash: ec13f8f9c203aae2
slug: it/docs/compatibility
title: Compatibilità
description: Cosa promette Rebase tra una versione e l'altra e cosa no — i sei contratti con versione, come ciascuno fallisce e cosa può ancora cambiare in una minor.
---

Cosa promette Rebase tra una versione e l'altra, e cosa no.

Questo è il documento da leggere prima di modificare qualsiasi elemento da cui dipende già un
progetto distribuito o un tenant Rebase Cloud attivo. È anche la risposta onesta alla
domanda: "se sviluppo oggi su Rebase, cosa si romperà in seguito?"

## Cosa significa "beta" qui

Rebase è in beta pubblica. La maggior parte dei progetti usa questa parola per indicare che "qualsiasi
cosa potrebbe rompersi", il che non fornisce al lettore alcuna informazione utile per pianificare; ecco
quindi la linea che questo progetto traccia concretamente:

> **L'API su cui scrivi codice può cambiare in una minor, con una voce nel changelog.
> I tuoi dati non possono corrompersi silenziosamente.**

La prima metà è il consueto comportamento delle versioni `0.x` ed è descritta di seguito. La seconda
metà è la parte che merita attenzione, perché riguarda meccanismi concreti anziché
intenzioni: i contratti versionati nella sezione successiva sono ciascuno impresso
in un artefatto o in un database, ciascuno viene verificato all'avvio o all'acquisizione, e ciascuno
**fallisce in modo evidente e specifico** anziché degradare silenziosamente. Un push dello schema che
comporterebbe l'eliminazione di una colonna viene rifiutato da un gate distruttivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e il percorso di aggiornamento
stesso è un test: `upgrade-e2e.test.ts` ripristina i database nello stato in cui
le release precedenti li avevano lasciati, esegue il percorso di migrazione corrente su ciascuno di essi
e verifica che le righe sopravvivano — non semplicemente che l'avvio sia riuscito.

Cosa significa invece beta: mancano ancora delle funzionalità, alcuni sottosistemi sono più recenti di
altri e la natura delle imperfezioni sta nel fatto che qualcosa è assente o poco pratico,
non nel fatto che corrompa qualcosa in modo silenzioso. Lo stato di ciascun sottosistema viene pubblicato
e datato anziché lasciato alla scoperta dell'utente — la tabella sottostante è tale
pubblicazione.

## Livello di maturità per sottosistema

**Ultima revisione 14 settembre 2026, rispetto a 0.21.0.** Rileggila a ogni minor; una
valutazione che non è cambiata in tre release è o consolidata o dimenticata, e
questa nota è qui affinché tale differenza venga verificata.

I tre livelli di valutazione significano:

- **Stable** — la struttura è consolidata e protetta da un gate in CI. Può ancora
  acquisire nuove funzionalità; non verrà riprogettata all'improvviso all'interno della 0.x, e una modifica
  che possa causare rotture sarà annunciata nel changelog.
- **Beta** — funziona ed è utilizzato in produzione, ma presenta aspetti ancora grezzi
  noti: un limite raggiungibile, un caso limite scomodo, una decisione di design
  non ancora presa. La parte grezza è esplicitata nelle note, perché "beta" da sola
  non dice nulla su cui poter pianificare.
- **Experimental** — rilasciato per poter essere utilizzato e testato. Aspettati di incappare
  nelle parti che nessuno ha ancora esplorato.

| Sottosistema | Valutazione | Su cosa si basa la valutazione |
|---|---|---|
| REST API + SDK generato | Stable | Il contratto wire è versionato e controllato da gate; `client-sdk-e2e` esegue registrazione → accesso → letture con ambito RLS → refresh → storage → realtime end-to-end |
| Auth — email/password, OAuth, OIDC, magic link, codice monouso | Stable | Vengono forniti dodici provider OAuth. Lo schema di autenticazione è un contratto versionato, impresso e verificato all'avvio |
| Auth — MFA (TOTP) | Beta | Registrazione, verifica e recupero funzionano e sono testati. La rotazione delle chiavi è implementata per la chiave di crittografia; non esiste un'interfaccia di amministrazione per reimpostare il fattore di un utente bloccato |
| Row-level security | Stable | Il fulcro del prodotto. `pnpm rls:check` esegue un audit su un database attivo rispetto a quindici controlli, e la suite e2e di RLS viene eseguita a ogni push |
| Storage | Stable | Locale, S3 e GCS. Rifiuto predefinito (default-deny) in produzione dalla 0.17.0, e lo scaffold include un hook authorize |
| Realtime | **Beta** | Le sottoscrizioni vengono associate solo in base al percorso della collection, quindi N sottoscrittori su una singola collection costano N refetch con ambito RLS per ogni scrittura. Questo limita un deployment a poche centinaia di sottoscrittori concorrenti. Corretto a qualsiasi scala; costoso oltre tale soglia |
| Ricerca vettoriale (pgvector) | Beta | Ogni colonna vettoriale riceve per impostazione predefinita un indice HNSW per la distanza del coseno, configurabile per proprietà tramite `VectorIndexConfig` (metodo, distanze, parametri di build) o disattivabile, lasciando una scansione esatta. pgvector non può indicizzare colonne con più di 2.000 dimensioni, pertanto queste rimangono non indicizzate ed eseguono una scansione |
| Sincronizzazione offline | Beta | Le mutazioni includono chiavi di idempotenza rispettate dal server, e i difetti di perdita dati riscontrati nell'audit di luglio sono stati corretti. Il modello di risoluzione dei conflitti è last-write-wins senza merge campo per campo |
| Cronologia entità | Stable | Basata su snapshot, protetta dalla propria suite di test |
| Funzioni e cron | Stable | L'entry point portabile (`@rebasepro/server/functions`) è un contratto versionato con una propria sezione di superficie API |
| Server MCP + skill per agenti | Beta | `@rebasepro/mcp` viene eseguito su stdio: quarantadue tool, autenticazione bearer per progetto, i tool distruttivi rifiutano target non locali a meno che non sia esplicitamente richiesto. Dalla 0.21 il server può anche montare un endpoint `/mcp` remoto — OAuth 2.1, sei data tool, ogni chiamata protetta dalle RLS dell'utente autenticato — disattivato a meno che non sia impostato `REBASE_MCP_ENABLED=true`, e solo per Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizzato quotidianamente su progetti reali. Il branching è presente nel pacchetto OSS e volutamente non esposto in Rebase Cloud, poiché non esiste ancora una gestione per spostare una distribuzione attiva su un branch |
| CMS + pannello di amministrazione | Beta | Completo per CRUD, relazioni, campi di archiviazione e ruoli. **La tabella dati non ha semantica grid** — nessun `role`, nessun `aria-rowindex`, `tabIndex` rimosso — quindi gli utenti da tastiera e con screen reader non possono utilizzare la vista principale. Nessuna bozza, nessun contenuto localizzato per lingua, nessun rich text a blocchi |
| Database di sviluppo gestito PGlite | Beta | `rebase dev` a configurazione zero senza Docker. Una sessione alla volta, quindi le richieste vengono serializzate e la concorrenza non può essere riprodotta; i comandi basati su Atlas (`db push`, `generate`, `migrate`) non funzionano lì e lo segnalano esplicitamente |
| Helm chart | Beta | Esegue il rendering della topologia a processi separati e viene pubblicato nel registro OCI a ogni release. L'impostazione predefinita rimane un singolo container |
| `@rebasepro/server-mongo` | **Experimental** | Un driver funzionante con realtime basato su change-stream e cronologia basata su snapshot. **Nessuna row-level security** — l'intero modello di isolamento sopra descritto non si applica ad esso — e nessuna relazione. I change stream richiedono un replica set: su un'istanza `mongod` standalone non c'è nulla che li sostituisca, quindi una sottoscrizione vede solo le scritture effettuate tramite quel processo Rebase e perde tutte le altre. Nessuna MFA: la registrazione risponde 501 e i controlli rispondono "nessun fattore", quindi l'accesso non ne richiede mai uno. L'aggregazione admin non può avere come target una collection — legge il nome da uno stage `$from` che MongoDB non possiede — quindi non restituisce nulla |
| `@rebasepro/firebase` | Experimental | Esegue il pannello di amministrazione e l'SDK su Firestore. Nessuna RLS, nessuna interfaccia SQL; il set di funzionalità di Postgres non viene trasferito. Il driver Firestore ignora i gruppi di filtri `or(...)`/`and(...)`, quindi una query che ne utilizza uno legge ogni riga consentita dai suoi filtri semplici |
| Rebase Cloud | **Private beta** | Attivo, ospita tenant reali, rilasciato a scaglioni. Non self-service |

Due voci sopra riportate rappresentano il prezzo in termini di trasparenza nel pubblicare questa tabella:
il refetch del realtime e l'accessibilità della tabella dati sono difetti noti e aperti, non
voci di roadmap, ed entrambi sono elencati anziché lasciati alla scoperta del lettore.

Questa tabella mostra ciò che esiste. Ciò che ancora non esiste si trova nella
[roadmap](https://rebase.pro/roadmap), una voce per issue di GitHub, con il
sottoinsieme richiesto per la 1.0 contrassegnato.

## La promessa della 0.x

Rebase è nella versione `0.x`. Questa sezione è scritta per essere valida per ogni release 0.x anziché
per una specifica, in modo da non diventare obsoleta a ogni rilascio. **Le breaking change
all'API TypeScript esposta agli sviluppatori sono ancora consentite in una minor**, e il changelog è
il luogo in cui vengono annunciate. Ciò che
*non* è consentito rompere silenziosamente è l'insieme dei contratti versionati riportati di seguito: ciascuno
di essi è impresso in un artefatto o in un database, ciascuno viene controllato all'avvio o all'acquisizione,
e ciascuno fallisce **in modo evidente e specifico** anziché degradare.

Questa distinzione rappresenta l'intera promessa. Un export rinominato comporta un errore di compilazione
e cinque minuti di tempo. Un bundle che si avvia su un runtime errato e serve
dati impercettibilmente errati comporta un incidente di produzione, e i contratti esistono affinché la
seconda categoria non possa verificarsi silenziosamente.

Rebase Cloud consuma esattamente questi contratti e nient'altro. Tutto ciò che non è
elencato qui è un dettaglio implementativo da cui la piattaforma non dipende.

## I contratti versionati

I valori seguenti sono letti dal codice sorgente; considera i riferimenti ai file come la verità
e questa tabella come la mappa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contratto | Dichiarato in | Verificato in | Direzione di compatibilità |
|---|---|---|---|---|
| 1 | Intervallo `rebase` in `rebase.json` | il progetto dell'utente | CLI in fase di build | il progetto dichiara quali runtime accetta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatibile** — il nuovo runtime legge i vecchi bundle |
| 3 | `RUNTIME_CONTRACT_VERSION` | stesso file | stesso file | **corrispondenza esatta, in entrambe le direzioni** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | all'avvio, rispetto a `rebase.schema_meta` | **solo in avanti** — il nuovo runtime migra i vecchi database |
| 5 | `manifest.schemaVersion` | emesso da `rebase build` | inviato dall'SDK come `x-rebase-schema` se configurato | consultivo — identifica lo schema rispetto a cui il client è stato compilato |
| 6 | Identificatori derivati del database | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelato** — un nome emesso da una release non viene mai ricalcolato |

### 1 — `rebase` in `rebase.json`

Un intervallo semver, interpretato come `engines` in un `package.json`: indica quali versioni del runtime
questo progetto accetta. Chiamato deliberatamente `rebase` anziché `runtime`, poiché
su un'app `runtime` indica già *chi gestisce il processo* (`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (attualmente 2)

Il layout su disco di un bundle compilato. Un runtime accetta qualsiasi bundle il cui formato sia
**minore o uguale** al proprio, il che consente al livello gestito di migrare un
tenant su una nuova immagine senza che nessuno debba ricompilare il proprio progetto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` come directory singola,
  `entry.admin` per un pannello di amministrazione integrato.
- **2** — `kind: "backend" | "static"`, `entry.static` come elenco, `entry.admin`
  rimosso. Il formato 1 viene ancora letto, tramite `upgradeLegacyManifest`.

**Incrementalo quando** il layout cambia in modo tale che un runtime precedente interpreterebbe in modo errato un
bundle più recente. L'incremento è ciò che trasforma "si avvia e non serve nulla" in un
netto rifiuto di avviarsi.

### 3 — `RUNTIME_CONTRACT_VERSION` (attualmente 1)

La versione major del contratto bundle↔runtime. Distinta dalla versione del pacchetto `@rebasepro/server`,
che può rilasciare qualsiasi numero di minor e patch mentre questa rimane invariata.

**Leggilo prima di modificarlo.** Il controllo è `!==`, non `>`:

> un bundle che ha come target il contratto *N* viene eseguito **solo** su un runtime che implementa *N*

quindi incrementarlo invalida **qualsiasi bundle mai compilato**, contemporaneamente, finché ciascuno
non viene ricompilato. Questa è la severità voluta — è la leva del tipo "nulla di vecchio può girare qui" — ma
significa che un incremento costituisce una migrazione dell'intera flotta, non una semplice nota di rilascio. Per
il livello gestito deve essere coordinato con una ricompilazione del bundle di ciascun tenant.

Se una modifica è *additiva* e i vecchi bundle rimarrebbero corretti, richiede
`BUNDLE_FORMAT_VERSION` (o nulla del tutto), non questo.

### 4 — `AUTH_SCHEMA_VERSION` (attualmente 2)

Impresso in `rebase.schema_meta` e confrontato all'avvio. Un runtime **si rifiuta di
avviarsi** su un database migrato da una versione del framework più recente, anziché
operare su una struttura che non comprende — durante un rolling deploy, questa è la differenza tra metà della flotta che restituisce un errore e metà della flotta che corrompe i dati.

La migrazione in avanti è automatica: `ensureAuthTablesExist` aggiorna un database più
vecchio. Nota che questo blocco di migrazione è deliberatamente racchiuso in un `try/catch` e
genera log anziché lanciare eccezioni — un avvio zoppicante è preferibile a un crash loop — quindi **"si è
avviato" non prova nulla**. Ogni asserzione nella suite di upgrade legge invece il
catalogo o i dati.

**Incrementalo quando** una migrazione non deve essere ignorata da un runtime precedente. Non
incrementarlo per una colonna additiva e retrocompatibile; c'è un esempio pratico di questa
valutazione in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash delle definizioni compilate delle collection, emesso nel manifest del bundle
e replicato da un SDK generato nell'header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Esiste affinché la piattaforma possa indicare "questa app è stata creata
su uno schema precedente" invece di fallire misteriosamente alla prima richiesta.

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

Il backend legge tale header su ogni richiesta di dati. Il disallineamento (drift) non rifiuta mai una
chiamata — un SDK indietro di uno schema è solitamente ancora compatibile, e distribuire il
backend prima del frontend è il normale ordine di deployment — ma quando una richiesta
fallisce con un errore 400 o 404, l'errore riporta il drift come causa:

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

In questo modo, una colonna rinominata viene segnalata come "il tuo SDK è obsoleto, rigeneralo" anziché come
un campo che i tuoi stessi tipi insistono esistere. Una richiesta andata a buon fine non riceve mai questa notifica.

Copre **solo le collection**. La modifica di un hook o di una funzione non altera il
contratto del client e non deve invalidare ogni SDK generato.

### Chi sta effettuando la chiamata

Altri due segnali identificativi, nessuno dei quali funge da gate da solo:

- **`GET /api/meta/schema-version`** non è autenticato e risponde con `schemaVersion`
  *e* `runtime` (`version` e `contract`) del progetto. Un
  job CI che confronta il proprio SDK generato con un progetto attivo non necessita di
  credenziali, così come un client che chiede con quale runtime sta comunicando.
- **`User-Agent: rebase-cli/<version>`** è presente su ogni richiesta a `rebase cloud`.
  Il formato wire del control plane si evolve più velocemente rispetto a quanto pubblicato su npm, quindi deve
  essere in grado di rispondere a un client obsoleto con `CLI_TOO_OLD` e la versione
  minima — cosa che può fare solo per un chiamante che dichiara la propria identità.

### 6 — Identificatori derivati del database

Ogni nome che questo framework ricava autonomamente anziché esserne informato: una colonna
di foreign key, un vincolo di foreign key, una tabella di giunzione e le sue due colonne chiave, un
tipo enum, il nome di una policy, la colonna in `snake_case` di una proprietà in `camelCase`.

> **Un identificatore derivato è congelato dal momento esatto in cui una release lo emette.**

Non "congelato fino alla prossima major" — congelato. La motivazione è diversa dagli
altri cinque contratti, ed è più stringente. Quelli sono versionati, quindi una discrepanza può essere
*rilevata* e rifiutata. Questo no: il nome viene scritto nel database di un cliente
il giorno in cui effettua il deploy, e non c'è alcun indicatore di versione su una colonna. Ogni
database configurato da qualunque release mai rilasciata porta con sé qualunque cosa abbia derivato, e
nessun codice in questo repository può intervenire a rinominarli tutti.

La versione 0.13 ne è l'esempio pratico. `generateForeignKeyName` ha imparato a rendere correttamente al singolare i nomi —
`categorie_id` → `category_id`, `addres_id` → `address_id` — il che è
inequivocabilmente una derivazione migliore, e ha rotto ogni database esistente che conteneva un
plurale irregolare. Boot-ensure ha migrato la colonna, quindi i dati sono sopravvissuti; il file
`schema.generated.ts` sottoposto a commit nel progetto non lo ha fatto, e l'avvio è fallito su una colonna
che esisteva. Tre commit, un nuovo seam test e una voce permanente nelle note di aggiornamento,
in cambio di un nome di colonna più gradevole alla vista che nessuno aveva richiesto.

**Se una derivazione è realmente errata**, viene modificata per le collection create
*successivamente*, dietro una naming strategy registrata nel progetto — mai
retroattivamente, e mai come effetto collaterale del miglioramento della funzione sottostante.

**L'unica eccezione legittima** è una modifica che allinea il codice a un nome che
il database *ha già*. L'esempio pratico è il troncamento degli identificatori: Postgres
taglia silenziosamente un identificatore a 63 byte, quindi un nome di vincolo derivato più lungo non è
mai stato presente nel catalogo con quel nome — la derivazione descriveva un oggetto che
non esisteva con quella grafia, e boot-ensure eseguiva nuovamente `ADD CONSTRAINT` a
ogni singolo avvio perché il confronto non poteva mai coincidere. Il troncamento in fase di
costruzione modifica ciò che questo repository *deriva* e non cambia nulla di ciò che un
qualsiasi database distribuito *contiene*. Questo è il criterio da applicare: non "il nuovo nome è
migliore?", ma "qualche database esistente deve cambiare?".
L'unica cosa sempre sicura è *riconoscere* un vecchio nome per migrarlo:
`legacyForeignKeyName` esiste per essere rilevato, mai per essere generato,
e la baseline blocca anche tali rilevamenti. Rimuoverne uno de-migra silenziosamente
ogni database che presenta ancora quella grafia.

**Il gate.** `tooling/scripts/derived-names.mts` esegue una fixture di stress sui nomi — plurali
irregolari, una desinenza in `ss`, un acronimo, una giunzione da uno slug plurale, override
espliciti, uno slug sufficientemente lungo da essere troncato — attraverso entrambi i generatori di DDL dello schema,
ed esegue il rendering di ogni identificatore nominato da ciascuno di essi:

```bash
pnpm check:derived-names
```

Una riga modificata o rimossa fallisce come violazione del contratto, mostrando la vecchia e la nuova grafia
affiancate. Anche una modifica puramente additiva fallisce, ma con il messaggio "regenerate" — così che la
baseline non possa deviare all'insaputa di nessuno.

Fissa inoltre che `rebase db push` e il boot-ensure del runtime gestito derivino gli
*stessi* nomi, il che rappresenta un secondo contratto nascosto nel primo: compilano
le stesse collection attraverso codice differente, e un progetto sottoposto a push una volta e avviato
in seguito non deve ritrovarsi con due schemi.

## Cosa *non* è congelato

Detto chiaramente, affinché nessuno deduca una promessa mai fatta:

- L'API TypeScript esposta agli sviluppatori — configurazione delle collection, opzioni di
  `initializeRebaseBackend`, props dell'admin, nomi dei metodi dell'SDK. Le breaking change
  vengono introdotte nelle minor e sono annunciate nel changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — si evolvono più rapidamente e hanno il minor numero di utilizzatori.
- Qualsiasi elemento presente in `src/` di un pacchetto che non sia riesportato dal suo barrel file.
  `packages/client/src/index.ts` contiene una nota che spiega che il suo elenco di export
  è curato proprio per evitare che un export interno diventi pubblico per errore.
- Lo schema del database delle *tue* collection. Quello appartiene a te; Rebase gestisce unicamente gli
  schemi `rebase` e `auth`.

## I gate che li proteggono

Nulla di quanto sopra è una semplice convenzione — ognuno dispone di un test che fallisce in caso di rottura:

| Gate | Cosa blocca |
|---|---|
| `pnpm verify:corpus` | ogni formato di bundle mai rilasciato, avviato sul runtime attuale. Le fixture in `tests/fixtures/bundles/` sono **scritte a mano e congelate** — una fixture rigenerata dal builder cambia ogni volta che il builder cambia |
| `pnpm verify:selfhost` | un bundle reale compilato, impacchettato, avviato e interrogato come farebbe un browser |
| `upgrade-e2e.test.ts` | vecchi schemi di database (`schema-snapshots/`) gestiti dal runtime corrente |
| `tests/e2e/tests/cli-init-e2e.ts` | un progetto di scaffold installato da **tarball reali**, non da collegamenti di workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | il percorso dell'utente finale: registrazione → accesso → letture con ambito RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | ogni colonna, vincolo, giunzione, enum e nome di policy che il framework deriva — e che boot e `db push` li derivino in modo identico |
| `pnpm rls:check` | le policy dello schema generato |
| `pnpm check:api-surface` | ogni export, e i relativi membri, dei cinque pacchetti forniti dall'immagine — `@rebasepro/server`, `types`, `client`, `common`, `utils` — più l'entry point `@rebasepro/server/functions`, rispetto alle sei sezioni di `contracts/server.api.txt`. Questi sono i pacchetti che `infra/docker/entrypoint.mjs` collega tramite symlink sulle copie del bundle distribuito, quindi la rimozione di un export da uno di essi non è un errore di compilazione per nessuno — è un errore di avvio per l'intera flotta, durante un rollout che nessuno ha richiesto |
| `pnpm test:gates` | i test stessi dei gate, eseguiti sulle fixture — undici file, tra cui `check:api-surface` e il controllo di bump della release riportato di seguito — cosicché un gate che smette di rilevare ciò che protegge fallisce qui. `check:api-surface` ha trascorso la sua intera esistenza incapace di rilevare la scomparsa di un membro da `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | che il livello di bump con cui viene rilasciata una release corrisponda a ciò che la release ha modificato nelle baseline sopra citate — eseguito da `publish.yml` prima che il changelog venga sigillato |
| saas CI | il control plane compilato rispetto al ramo `main` di questo repository, sui propri push e nelle build notturne (nightly) |

**Registra una fixture di bundle e uno snapshot dello schema una volta per release.** Il valore di
entrambi i corpus risiede interamente in quanto indietro nel tempo risalga il più vecchio di essi, e nessuno dei due può
essere integrato retroattivamente.

### Non ancora protetti da gate

La tabella sopra riportata indica ciò che è garantito. Queste sono le parti della policy per le quali
non vi è ancora alcuna garanzia formale, elencate affinché nessuno vi legga promesse implicite:

- **Nessuna finestra di deprecazione o supporto.** Finché Rebase è in versione `0.x`, non esiste una regola
  scritta su quanto a lungo sopravviva un export deprecato prima della rimozione, o per quanto tempo un'edizione
  minor precedente riceva correzioni. Le correzioni di sicurezza vengono rilasciate unicamente sull'ultima minor.
- **Il formato wire HTTP non ha alcun gate.** Nessuno script `check:*` confronta le strutture di richiesta e
  risposta rispetto a una baseline nel modo in cui `check:api-surface` confronta gli export; una
  modifica nella struttura della risposta viene intercettata solo se una suite e2e si trova a leggerla.
- **I flag della CLI non hanno una baseline di compatibilità.** Il verificatore della documentazione fallisce quando
  scompare un flag utilizzato dalle skill, dagli esempi o dal sito web; nient'altro si accorge della rimozione di altri flag o del cambiamento del significato di un flag.
- **Una release da CI non registra alcun corpus.** Il workflow di pubblicazione non registra alcuna fixture di bundle
  né alcuno snapshot dello schema; solo lo script di release locale ci prova, e avverte invece di bloccarsi quando non ci riesce. Dalla 0.18 alla 0.21 non è stato registrato alcuno snapshot del progetto.
- **La superficie degli export è un gate, non un contratto.** La decisione se gli export pubblici dei pacchetti
  forniti dal runtime debbano diventare un settimo contratto numerato — dichiarato come baseline di `check:api-surface`,
  compatibile in modo additivo all'interno di una major del contratto — è ancora aperta.

## Modificare un contratto

1. Determina a quale dei sei appartiene. La maggior parte delle modifiche non rientra in nessuno di essi — ma
   "nessuno dei sei" non significa "privo di conseguenze". Rimuovere o rinominare un export
   di `@rebasepro/server`, o un suo membro, non fa parte dei sei ed è la modifica più pericolosa
   in assoluto nell'intero repository, poiché il codice che va a rompere è già compilato
   e non verrà ricompilato. `pnpm check:api-surface` è ciò che difende tale confine; se debba diventare un settimo contratto numerato è una decisione aperta (vedere
   *Non ancora protetti da gate*, sopra).
2. Aggiungi prima una fixture o uno snapshot per la **vecchia** struttura e verifica che il test passi.
3. Applica la modifica e incrementa la costante.
4. Verifica che la vecchia fixture passi ancora, o che ora fallisca *con il messaggio
   di cui l'utente avrebbe bisogno*. Entrambi sono esiti validi; il silenzio non lo è.
5. Per il contratto 3, pianifica la ricompilazione di ogni bundle distribuito prima del merge.
6. Il contratto 6 fa eccezione ai passaggi 3 e 4: non c'è alcuna costante da incrementare e
   nessuna versione su cui opporre un rifiuto, poiché una colonna non reca alcun contrassegno di versione. Il passaggio
   che li sostituisce consiste nel decidere di non apportare la modifica — vedere la sezione precedente
   per scoprire quale sia l'alternativa.

## Risorse correlate

- [Upgrading](/docs/upgrading/) — cosa si è effettivamente rotto, release per release
- [Changelog](/docs/changelog/) — ogni modifica, comprese quelle che non hanno rotto nulla
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contratto 3 — il formato del bundle rispetto al quale un progetto distribuito è già compilato

---
