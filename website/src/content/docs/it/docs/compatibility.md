---
sourceHash: 5de8d85cb2d31896
slug: it/docs/compatibility
title: Compatibilità
description: "Cosa garantisce Rebase tra le diverse versioni e cosa no: i sei contratti versionati, come ciascuno fallisce e cosa può ancora cambiare in una versione minor."
---

Cosa garantisce Rebase tra le diverse versioni e cosa no.

Questo è il documento da leggere prima di modificare qualsiasi cosa da cui un progetto distribuito o un tenant Rebase Cloud attivo già dipenda. È anche la risposta onesta a "se sviluppo su Rebase oggi, cosa si romperà in seguito?"

## Cosa significa "beta" in questo contesto

Rebase è in beta pubblica. La maggior parte dei progetti usa questa parola per indicare che "qualsiasi cosa potrebbe rompersi", il che non fornisce al lettore alcuna informazione utile per pianificare. Ecco quindi il confine che questo progetto stabilisce effettivamente:

> **L'API su cui scrivi codice può cambiare in una release minor, con una voce nel changelog. I tuoi dati non possono rompersi silenziosamente.**

La prima metà rappresenta il normale comportamento di una `0.x` ed è descritta di seguito. La seconda metà è la parte che vale la pena esaminare, poiché riguarda meccanismi concreti piuttosto che intenzioni: i contratti versionati nella sezione seguente sono impressi in un artefatto o in un database, ciascuno viene verificato all'avvio o all'acquisizione (intake), e ciascuno **fallisce in modo evidente e specifico** invece di degradare. Un push dello schema che comporterebbe l'eliminazione di una colonna viene rifiutato da un controllo distruttivo (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e il percorso di aggiornamento stesso è un test: `upgrade-e2e.test.ts` ripristina i database nello stato in cui li avevano lasciati le release precedenti, esegue il percorso di migrazione corrente su ciascuno di essi e verifica che le righe sopravvivano — non semplicemente che l'avvio sia riuscito.

Cosa significa invece beta: mancano ancora delle funzionalità, alcuni sottosistemi sono più recenti di altri e la natura di un'imperfezione è che qualcosa risulti assente o poco pratico, non che corrompa silenziosamente i dati. Lo stato dei vari sottosistemi è documentato e datato, piuttosto che lasciato alla libera scoperta.

## La promessa della versione 0.x

Rebase è alla versione `0.x` — 0.16 al momento della stesura. Questa sezione è scritta per essere valida per ogni release 0.x anziché per una specifica, in modo da non diventare obsoleta a ogni nuova versione. **Le breaking change all'API TypeScript creata sono ancora consentite in una minor**, e vengono annunciate nel changelog. Ciò che *non* è consentito rompere silenziosamente è l'insieme dei contratti versionati riportati di seguito: ciascuno di essi è impresso in un artefatto o in un database, ciascuno viene controllato all'avvio o all'acquisizione e ciascuno fallisce **in modo evidente e specifico** anziché degradare.

Questa distinzione è il cuore della promessa. Un export rinominato ti costa un errore di compilazione e cinque minuti. Un bundle che si avvia su un runtime errato e serve dati sottilmente errati ti costa un incident, e i contratti esistono proprio per impedire che questa seconda categoria si verifichi silenziosamente.

Rebase Cloud consuma esattamente questi contratti e nient'altro. Tutto ciò che non è elencato qui è un dettaglio implementativo da cui la piattaforma non dipende.

## I contratti versionati

I valori seguenti sono letti dal codice sorgente; considera i riferimenti ai file come l'unica fonte di verità e questa tabella come una mappa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contratto | Dichiarato in | Verificato in | Direzione di compatibilità |
|---|---|---|---|---|
| 1 | Intervallo `rebase` in `rebase.json` | il progetto dell'utente | CLI durante la build | il progetto dichiara quali runtime accetta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatibile** — il nuovo runtime legge i vecchi bundle |
| 3 | `RUNTIME_CONTRACT_VERSION` | stesso file | stesso file | **corrispondenza esatta, entrambe le direzioni** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | all'avvio, rispetto a `rebase.schema_meta` | **solo in avanti** — il nuovo runtime migra i vecchi database |
| 5 | `manifest.schemaVersion` | emesso da `rebase build` | inviato dall'SDK come `x-rebase-schema` | informativo — identifica lo schema con cui è stato compilato il client |
| 6 | Identificatori di database derivati | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelato** — un nome emesso da una release non viene mai ricalcolato |

### 1 — `rebase` in `rebase.json`

Un intervallo semver, interpretato come `engines` in un `package.json`: quali versioni di runtime questo progetto accetta. Chiamato intenzionalmente `rebase` anziché `runtime`, poiché `runtime` indica già *chi possiede il processo* (`managed` | `custom`) su un'app.

### 2 — `BUNDLE_FORMAT_VERSION` (attualmente 2)

La struttura su disco di un bundle compilato. Un runtime accetta qualsiasi bundle il cui formato sia **minore o uguale** al proprio, il che consente al tier gestito di spostare un tenant su una nuova immagine senza che sia necessario ricompilare il progetto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` come directory singola, `entry.admin` per un pannello admin integrato.
- **2** — `kind: "backend" | "static"`, `entry.static` come elenco, `entry.admin` rimosso. Il formato 1 viene ancora letto tramite `upgradeLegacyManifest`.

**Incrementalo quando** la struttura cambia in modo tale che un runtime precedente interpreterebbe erroneamente un bundle più recente. L'incremento è ciò che trasforma "si avvia ma non serve nulla" in un rifiuto esplicito di avviarsi.

### 3 — `RUNTIME_CONTRACT_VERSION` (attualmente 1)

La versione major del contratto bundle↔runtime. Distinta dalla versione del pacchetto `@rebasepro/server`, che può rilasciare qualsiasi numero di minor e patch mentre questa rimane invariata.

**Leggi qui prima di modificarlo.** Il controllo è `!==`, non `>`:

> un bundle che punta al contratto *N* viene eseguito **solo** su un runtime che implementa *N*

quindi incrementarlo invalida **ogni bundle mai compilato**, istantaneamente, finché ciascuno non viene ricompilato. Questa è la severità prevista — è la leva "nulla di vecchio può essere eseguito qui" — ma significa che un incremento è una migrazione a livello di intera flotta, non una semplice nota di rilascio. Per il tier gestito, deve essere coordinato con una ricompilazione del bundle di ogni tenant.

Se una modifica è *additiva* e i vecchi bundle rimangono corretti, richiede `BUNDLE_FORMAT_VERSION` (o nessuna modifica), non questo.

### 4 — `AUTH_SCHEMA_VERSION` (attualmente 2)

Impresso in `rebase.schema_meta` e confrontato all'avvio. Un runtime **si rifiuta di avviarsi** su un database migrato da una versione più recente del framework, anziché operare su una struttura che non comprende — durante un rolling deploy, questa è la differenza tra metà della flotta che va in errore e metà della flotta che corrompe i dati.

La migrazione in avanti è automatica: `ensureAuthTablesExist` aggiorna un database precedente. Nota che questo blocco di migrazione è deliberatamente racchiuso in un `try/catch` e registra log anziché lanciare eccezioni — un avvio zoppicante è preferibile a un crash loop — quindi **"si è avviato" non prova nulla**. Ogni asserzione nella suite di upgrade legge invece il catalogo o i dati.

**Incrementalo quando** una migrazione non deve essere ignorata da un runtime precedente. Non incrementarlo per una colonna additiva e retrocompatibile; c'è un esempio pratico di questa valutazione in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash delle definizioni compilate delle collezioni, emesso nel manifest del bundle e restituito da un SDK generato nell'header `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Esiste affinché la piattaforma possa segnalare "questa app è stata compilata su uno schema più vecchio" invece di fallire misteriosamente alla prima richiesta.

Riguarda **esclusivamente le collezioni**. La modifica di un hook o di una funzione non altera il contratto di un client e non deve invalidare ogni SDK generato.

### 6 — Identificatori di database derivati

Ogni nome che questo framework ricava autonomamente invece di riceverlo esplicitamente: una colonna di foreign key, un vincolo di foreign key, una tabella di giunzione (junction table) e le sue due colonne chiave, un tipo enum, il nome di una policy, la colonna in `snake_case` di una proprietà in `camelCase`.

> **Un identificatore derivato è congelato nel momento in cui una release lo emette.**

Non "congelato fino alla prossima major" — congelato definitivamente. La motivazione è diversa dagli altri cinque contratti, ed è più stringente. Quelli sono versionati, quindi una mancata corrispondenza può essere *rilevata* e rifiutata. Questo no: il nome viene scritto nel database di un cliente il giorno del deploy e non c'è alcun contrassegno di versione su una colonna. Ogni database creato da qualsiasi release mai distribuita contiene ciò che è stato derivato, e nessun codice in questo repository può intervenire e rinominarli tutti.

La versione 0.13 è l'esempio pratico. `generateForeignKeyName` ha imparato a rendere correttamente al singolare i nomi — `categorie_id` → `category_id`, `addres_id` → `address_id` — il che è inequivocabilmente una derivazione migliore, e ha rotto ogni vecchio database che conteneva un plurale irregolare. Boot-ensure ha migrato la colonna, quindi i dati sono sopravvissuti; il file `schema.generated.ts` versionato del progetto non lo ha fatto, e l'avvio si è interrotto su una colonna che esisteva. Tre commit, un nuovo seam test e una voce permanente nelle note di upgrade, in cambio di un nome di colonna più gradevole alla vista che nessuno aveva richiesto.

**Se una derivazione è realmente errata**, viene modificata per le collezioni create *successivamente*, protetta da una strategia di denominazione registrata nel progetto — mai retroattivamente e mai come effetto collaterale del miglioramento della funzione sottostante.

**L'unica eccezione legittima** è una modifica che allinea il codice a un nome che il database *possiede già*. L'esempio pratico è il troncamento degli identificatori: Postgres tronca silenziosamente un identificatore a 63 byte, quindi un nome di vincolo derivato più lungo non è mai stato presente nel catalogo con quel nome — la derivazione descriveva un oggetto inesistente con quella grafia, e boot-ensure rieseguiva `ADD CONSTRAINT` a ogni singolo avvio perché il confronto non poteva mai corrispondere. Il troncamento in fase di costruzione modifica ciò che questo repository *deriva* e non cambia nulla di ciò che qualsiasi database distribuito *contiene*. Questo è il test da applicare: non "il nuovo nome è migliore?", ma "qualche database esistente deve cambiare?".
L'unica operazione sempre sicura è *riconoscere* un vecchio nome per poterlo migrare: `legacyForeignKeyName` esiste per essere rilevato, mai per essere generato, e la baseline blocca anche questi rilevamenti. Rimuoverne uno annulla silenziosamente la migrazione di ogni database che utilizza ancora quella dicitura.

**Il gate.** `scripts/derived-names.mts` esegue una fixture di stress sui nomi — plurali irregolari, finale in `ss`, acronimi, giunzioni derivate da uno slug plurale, override espliciti, slug sufficientemente lunghi da essere troncati — attraverso entrambi i generatori di DDL dello schema, e visualizza ogni identificatore nominato da ciascuno:

```bash
pnpm check:derived-names
```

Una riga modificata o rimossa fallisce come violazione del contratto, mostrando la vecchia e la nuova dicitura affiancate. Anche una modifica puramente additiva fallisce, ma con il messaggio "regenerate" — in modo che la baseline non possa deviare all'insaputa di nessuno.

Garantisce inoltre che `rebase db push` e il boot-ensure del runtime gestito derivino gli *stessi* nomi, il che rappresenta un secondo contratto nascosto all'interno del primo: compilano le stesse collezioni tramite codice diverso, e un progetto inviato con push una volta e avviato in seguito non deve trovarsi con due schemi differenti.

## Cosa *non* è congelato

Detto chiaramente, affinché nessuno presuma garanzie mai promesse:

- L'API TypeScript scritta dall'utente — configurazione delle collezioni, opzioni di `initializeRebaseBackend`, proprietà admin, nomi dei metodi dell'SDK. Le breaking change arrivano nelle versioni minor e sono annunciate nel changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — questi si evolvono più rapidamente e hanno il minor numero di utilizzatori.
- Tutto ciò che si trova sotto `src/` di un pacchetto e non viene riesportato dal relativo barrel. `packages/client/src/index.ts` include una nota che spiega come il suo elenco di export sia curato con precisione affinché un export interno non diventi pubblico per errore.
- Lo schema del database delle *tue* collezioni. Quello appartiene a te; Rebase gestisce solo gli schemi `rebase` e `auth`.

## I gate di controllo

Nulla di quanto sopra è una semplice convenzione — ognuno di essi dispone di un test che fallisce in caso di violazione:

| Gate | Cosa garantisce |
|---|---|
| `pnpm verify:corpus` | ogni struttura di bundle mai distribuita, avviata sul runtime odierno. Le fixture in `fixtures/bundles/` sono **scritte a mano e congelate** — una fixture rigenerata dal builder cambia ogni volta che cambia il builder |
| `pnpm verify:selfhost` | un bundle reale compilato, impacchettato, avviato e interrogato esattamente come farebbe un browser |
| `upgrade-e2e.test.ts` | vecchi schemi di database (`schema-snapshots/`) gestiti dal runtime corrente |
| `e2e/tests/cli-init-e2e.ts` | un progetto generato (scaffolded) installato da **veri tarball**, non da link del workspace |
| `e2e/tests/client-sdk-e2e.ts` | il percorso dell'utente finale: registrazione → accesso → letture con ambito RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | ogni nome di colonna, vincolo, giunzione, enum e policy derivato dal framework — e che l'avvio e `db push` li derivino in modo identico |
| `pnpm rls:check` | le policy dello schema generato |
| `pnpm check:api-surface` | ogni export di `@rebasepro/server`, e i suoi membri, confrontato con `contracts/server.api.txt`. Questo è il pacchetto che `infra/docker/entrypoint.mjs` collega tramite symlink sulla copia locale del bundle distribuito, quindi rimuovere un export da esso non è un errore di compilazione per nessuno — è un errore di avvio sull'intera flotta, durante un rollout che nessuno ha richiesto |
| `pnpm test:gates` | i due gate precedenti, eseguiti sulle fixture. `check:api-surface` non è mai stato in grado di rilevare la scomparsa di un membro da `const rebase` |
| `node scripts/check-release-bump.mjs` | che il livello di incremento con cui viene rilasciata una versione corrisponda a ciò che la release ha modificato nelle baseline sopra citate — eseguito da `publish.yml` prima della generazione del changelog |
| saas CI | il control plane compilato rispetto al ramo `main` di questo repository, sui propri push e nelle build notturne |

**Registra una fixture del bundle e uno snapshot dello schema una volta per release.** Il valore di entrambi i corpus risiede interamente nell'antichità del più vecchio tra essi, e nessuno dei due può essere integrato retroattivamente a posteriori.

## Modificare un contratto

1. Determina a quale dei sei appartiene la modifica. La maggior parte delle modifiche non riguarda nessuno di essi — ma "nessuno dei sei" non significa "privo di controversie". Rimuovere o rinominare un export di `@rebasepro/server`, o un suo membro, non fa parte dei sei ed è la singola modifica più pericolosa nel repository, poiché il codice che va a rompere è già compilato e non verrà ricompilato. `pnpm check:api-surface` è ciò che mantiene questo confine; stabilire se debba diventare un settimo contratto numerato è una decisione ancora aperta (`docs/audits/81-compat-policy.md`).
2. Aggiungi prima una fixture o uno snapshot per la **vecchia** struttura e verifica che il test passi.
3. Applica la modifica e incrementa la costante.
4. Conferma che la vecchia fixture passi ancora, oppure che ora fallisca *con il messaggio necessario all'utente*. Entrambi sono esiti validi; il fallimento silenzioso non lo è.
5. Per il contratto 3, pianifica la ricompilazione di ogni bundle distribuito prima di effettuare il merge.
6. Il contratto 6 è l'eccezione ai passaggi 3 e 4: non c'è alcuna costante da incrementare né alcuna versione su cui rifiutare l'avvio, poiché una colonna non presenta alcun contrassegno di versione. Il passaggio alternativo consiste nel decidere di non apportare la modifica — consulta la sezione precedente per vedere quale sia l'alternativa.

---
