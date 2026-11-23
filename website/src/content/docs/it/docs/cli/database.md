---
sourceHash: 68cf15088ac8b29f
title: Comandi database
sidebar_label: Comandi database
description: I comandi rebase db — push, generate e migrate, backup e ripristini, estrazione di una copia, stringa di connessione, database di sviluppo gestito e branch.
---

## Panoramica

`rebase db` è la famiglia di comandi che interagiscono con il database del progetto. Ciascuno
di essi agisce sul database risolto dal progetto, nell'ordine elencato in
[Database Branching](/docs/backend/branching/#cli-integration):
`--database-url`, poi `DATABASE_URL` nella shell, il branch su cui si trova il checkout,
`DATABASE_URL` in `.env`, `--docker`, e in alternativa il database di sviluppo gestito
avviato da `rebase dev`. `rebase db url` stampa a quale di questi corrisponde.

`request-role` e `provision` servono per un database di cui Rebase non è proprietario esclusivo;
consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).
`push`, `generate` e `migrate` sono descritti approfonditamente in
[Generazione dello schema](/docs/cli/schema/), mentre tutti gli altri comandi si trovano nel
[Riferimento CLI](/docs/cli/).

## Comandi

### `rebase db push`

Applica le modifiche allo schema direttamente al database (solo in sviluppo):

```bash
rebase db push
```

`--database-url <url>` specifica il database, e `--docker` quello di Compose, avviato
se necessario. Anche `generate`, `migrate`, `branch`, `backup` e `restore` accettano entrambi.

Lascia intatto ciò che le dichiarazioni delle tabelle non descrivono: altre tabelle e
viste, gli indici scritti da te e i vincoli CHECK ed EXCLUDE su una tabella dichiarata,
che una dichiarazione non può esprimere. Consulta
[`rebase db push`](/docs/cli/schema/#rebase-db-push) per sapere cosa viene applicato e
davanti a cosa si arresta.

L'SQL che una dichiarazione di tabella non può definire (funzioni, trigger, vincoli CHECK,
grant) va inserito in `backend/sql/*.sql`. Il push applica tali file in ordine
alfabetico di nome, dopo le tabelle e le viste e prima delle policy, in modo che una policy
possa chiamare una funzione definita da un file. Ogni file viene registrato per nome e hash in
`rebase.sql_files` e viene rieseguito solo quando subisce modifiche, all'interno della propria transazione:
un file che fallisce subisce un rollback e arresta il push. Scrivi file che siano sicuri
da rieseguire (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` prima di
`CREATE TRIGGER`). Un file il cui nome inizia con `_` è considerato una bozza e non viene
applicato. La rimozione di un file non annulla quanto eseguito in precedenza. `--dry-run` elenca i file che
verrebbero applicati.

Un deploy applica gli stessi file: `rebase build` li include nel bundle, e
l'avvio del server esegue ciascun file nuovo o modificato dopo le tabelle e l'autenticazione,
e prima delle policy, registrandolo nella stessa tabella `rebase.sql_files`. La transazione di ciascun
file acquisisce prima un advisory lock, così che più istanze che si avviano contemporaneamente,
o un push durante un deploy, eseguano ciascun file una volta sola. Un file può rimanere in esecuzione
fino a 15 minuti. Un file che fallisce blocca l'avvio e ne indica il nome. Anche `rebase dev` li applica all'avvio. Un'applicazione
che compila il proprio backend specifica la directory con
`createPostgresAdapter({ sqlDir: "backend/sql" })`. Nulla viene applicato se
`REBASE_PROVISION=false` o `REBASE_MIGRATE_ON_BOOT=none`.

:::caution
`db push` modifica direttamente il database senza file di migrazione. Usa `db generate` + `db migrate` per la produzione.
:::

### `rebase db generate`

Genera i file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

Crea file di migrazione con timestamp in `backend/drizzle/migrations/` che possono essere revisionati e committati.

### `rebase db migrate`

Esegue le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica tutte le migrazioni non ancora applicate al database.

Su un database che è già stato avviato, la prima migrazione crea tabelle che l'avvio
ha già generato, pertanto il primo `db migrate` si ferma prima di eseguire qualsiasi cosa e
stampa la baseline da eseguire. Registra invece quella migrazione come applicata, una volta sola:

```bash
rebase db migrate --baseline <version>
```

La versione corrisponde al prefisso numerico del file di migrazione; `db generate` stampa il
comando con tale valore già inserito. Consulta
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) per un database che
registra già le migrazioni.

Dopodiché, `db migrate` applica ciò che l'avvio non ha applicato, e su un database gestito da
`rebase dev` questo è meno di quanto sembri. L'avvio aggiunge ogni nuova tabella,
colonna e valore enum non appena cambia la dichiarazione di una tabella, perciò nel momento in cui
`db generate` scrive la migrazione che aggiunge una colonna, la colonna è già
presente: quel `db migrate` si fermerà di nuovo con l'errore `already exists` indicando il comando
`--baseline <version>` con cui registrarla. Ogni nuova proprietà comporta un'altra
baseline. Registra una migrazione solo quando l'avvio ha apportato ogni modifica in essa contenuta. Una migrazione che
inoltre elimina, rinomina o restringe qualcosa contiene istruzioni che l'avvio non esegue mai, e
registrarla comporterà il saltarle. In fase di sviluppo, `rebase db push` è il comando che
modifica lo schema; riserva `db generate` e `db migrate` per i database non ancora modificati dall'avvio.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` e, trattandosi di un'operazione distruttiva,
richiede di digitare `yes` nel terminale, oppure accetta il flag `--yes`; in assenza di terminale e senza
`--yes`, l'operazione viene rifiutata indicando di passare il flag.
Verso un database
che contiene già gli elementi creati dal backup, `restore` necessita di `--clean`. Senza
di esso, l'operazione viene rifiutata prima di applicare alcunché, inclusi i ruoli del cluster, e
vengono elencati gli oggetti in conflitto e le due soluzioni possibili: `--clean`, oppure
`--create-db --target-db <nuovo nome>`.
Con `--clean`,
il ripristino avviene in una singola transazione: elimina gli schemi del backup con tutto il loro
contenuto, ripristina e committa solo una volta che l'intero ripristino è andato a buon fine, garantendo
che un errore lasci il database nello stato iniziale. Prima di chiedere conferma, segnala gli elementi che andrà a eliminare
e che non sono presenti nel backup. Esegue `psql`, fornito insieme a `pg_restore`.
`restore` rifiuta
il database di sviluppo gestito: un backup contiene i propri dati sotto forma di COPY, che
questo database non è in grado di ricevere.
Esegui il restore in Postgres su Docker (`rebase db restore <dump> --docker --clean --yes`),
quindi `rebase db pull --from "$(rebase db url --docker)" --yes` per copiarlo nel
database gestito. Un backup del database gestito lo lascia inalterato.
I percorsi relativi,
e il percorso predefinito `./backups`, vengono risolti rispetto alla directory da cui si esegue `rebase`,
quindi le tre righe sopra fanno riferimento alla stessa directory; un'opzione non supportata da un comando
viene rifiutata prima che venga eseguito alcunché.
Il dump e il rispettivo file dei ruoli sono leggibili esclusivamente dal tuo utente (0600), e
se eseguiti su un database non attivo, `backup` e `restore` stampano lo
stesso banner mostrato da `db push`.
La pianificazione, il file dei ruoli associato a ciascun dump e la procedura di ripristino sono descritti in [Backup e ripristino](/docs/deployment/backups/).

### `rebase db pull`

Copia un altro database nel database di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` accetta un URL `postgres://` o `postgresql://`, oppure le coppie
`host=… port=… dbname=…` di libpq racchiuse tra virgolette come singolo argomento. Qualsiasi altro valore viene rifiutato
prima di avviare o leggere alcunché, senza ripetere il valore inserito.

`--anonymize` sostituisce i dati personali durante l'importazione, consentendo di lavorare
in locale su una copia della produzione senza trasferire dati reali dei clienti sul computer. Esegue la corrispondenza
delle colonne per nome con un approccio best-effort. Una colonna con il semplice nome `name` viene sostituita solo sulle
tabelle che rappresentano persone: ad esempio tabelle denominate `users`, `authors`, `customers` o simili, o qualsiasi
tabella che contenga anche una colonna per l'indirizzo email.
A una colonna soggetta a un indice univoco viene assegnato un valore distinto per ciascuna riga, e il passaggio avviene in
un'unica transazione: in caso di errore, le tabelle che sarebbero state riscritte vengono svuotate, elencate,
e il comando esce con codice 1.

Un flag non supportato
da `pull` viene rifiutato prima di leggere o copiare alcunché, suggerendo quello
probabilmente desiderato: ad esempio, `--anonymise` risponde "did you mean --anonymize?" ed
esce con codice 1.
In `pull` e in tutti gli altri comandi, un flag a cui viene assegnato un valore lo interpreta:
`--anonymize=true` o `=1` lo abilita, `--anonymize=false` o `=0` lo disabilita,
mentre qualsiasi altro valore viene rifiutato.

`pg_dump` rimuove i privilegi, quindi la copia arriverebbe con le policy RLS dell'origine
senza alcuno dei relativi permessi (grant) associati — con la conseguenza che ogni operazione di lettura come `rebase_user` fallirebbe
con `permission denied`. Il comando pull esegue nuovamente il provisioning del ruolo dell'applicazione subito dopo, utilizzando
la medesima routine sfruttata all'avvio e da `rebase db push`, assicurando che le tabelle interne di Rebase rimangano
prive di privilegi come previsto.

La destinazione corrisponde sempre al database di sviluppo locale di questo progetto e non può essere
modificata: `--database-url` viene rifiutato anziché accettato, rendendo impossibile impostare
un "pull in produzione". La direzione consentita è solo tramite `--from`.

Un'operazione di pull sostituisce
il contenuto del database locale: per prima cosa svuota ciascuno schema copiato, impedendo la permanenza
di tabelle esistenti solo localmente. Nel database di sviluppo gestito, le righe vengono trasferite
sotto forma di istruzioni `INSERT`, che il database è in grado di elaborare laddove l'istruzione `COPY`
si bloccherebbe. Il dump deve essere esclusivamente in codifica UTF8: un pull da un database con una codifica
differente, ad esempio LATIN1, viene rifiutato prima di svuotare qualsiasi dato. In tal caso, esegui il pull su
Postgres in Docker (`rebase db pull --docker` con lo stesso parametro `--from`), oppure su un'istanza
Postgres specificata tramite `DATABASE_URL`.

### `rebase db url`

Stampa la stringa di connessione utilizzata dal progetto corrente, e nient'altro, consentendone
l'uso in pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso d'uso principale per questo comando: il file `.env` lascia
intenzionalmente `DATABASE_URL` commentato, e la porta è calcolata a partire dal percorso del
progetto, pertanto non è specificata in alcun file su disco.
Mantiene tale
porta tra arresti e avvii, a meno che non sia stata occupata da un altro processo. Quando configuri una
`DATABASE_URL` personalizzata, viene stampata quest'ultima — l'ordine di risoluzione è identico a quello
seguito da qualsiasi altro comando. Il comando avvia il database gestito qualora non fosse
già in esecuzione.

Dopo aver eseguito
`rebase dev --docker`, `db url` e gli altri comandi useranno quel database Docker
(segnalandolo su stderr) finché non verrà eseguito un `rebase dev` senza tale flag. La preferenza viene
salvata in `.rebase/dev-database.json` e ha lo stesso livello di priorità di `--docker`, subordinato a qualsiasi
stringa di connessione. Se digiti `--docker` ma è presente una stringa di connessione di rango superiore,
non verrà avviato alcun container: un messaggio di una riga su stderr indicherà che il flag è stato ignorato, quale configurazione ha avuto la precedenza,
e come connettersi invece a Docker. Un `rebase dev --docker` scavalcato in questo
modo mantiene la preferenza memorizzata invariata, consentendo ai comandi di tornare a fare riferimento a Docker una volta
rimossa la stringa di connessione.

`rebase init`
assegna a ciascun progetto una porta Compose dedicata, compresa tra 5433 e 5632 in base al percorso del progetto,
e `--docker` verifica che il servizio in ascolto su di essa corrisponda effettivamente al container `db` del progetto.
Se un altro container o un'istanza di Postgres esterna a Docker occupa la porta, il processo si arresta
segnalando il conflitto, per evitare l'accesso al database di un altro progetto. Per spostare il
progetto, modifica la porta host del servizio `db` in `docker-compose.yml`, oltre a
`DATABASE_URL` nel caso in cui sia impostata in `.env`.

### `rebase db stop` / `rebase db reset`

Esclusivamente per il database di sviluppo gestito:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Appartiene al progetto e non al comando che lo ha avviato, pertanto l'arresto di
`rebase dev` lo lascia comunque attivo a beneficio degli altri comandi. Dopo 30 minuti di inattività
senza connessioni si arresta automaticamente, e il comando successivo che ne necessita provvede
a riavviarlo. `rebase dev`
lo segnala al momento dell'arresto, indicando come arrestare immediatamente il database.

L'esecuzione di `db stop` mentre
`rebase dev` è attivo avvisa che il relativo backend non potrà raggiungere il database finché non
sarà nuovamente disponibile. Il comando successivo che ne richiederà la presenza, come `rebase db url`, lo avvierà
sulla medesima porta, permettendo al backend di riconnettersi senza dover essere riavviato.

### `rebase db request-role migrate`

Migra le richieste di questo database da un ruolo Postgres a un altro:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Le richieste vengono eseguite come `rebase_user`, a meno che il progetto non specifichi un ruolo differente
(`REBASE_RLS_REQUEST_ROLE` o `rls.requestRole`). Un ruolo appartiene all'intero
cluster, pertanto i progetti che ne condividono uno dovrebbero avere ciascuno il proprio. Il primo
avvio con provisioning registra il ruolo nel database, e un avvio successivo
configurato con un ruolo diverso rifiuterà di partire finché il database non sarà stato migrato.

Il comando esegue la migrazione a partire dal ruolo registrato nel database, oppure da `rebase_user`. In
un'unica transazione crea il nuovo ruolo se mancante, abilita la connessione a passare ad esso,
riassegna solo in questo database tutti i grant posseduti dal vecchio ruolo,
aggiorna le policy che vi fanno riferimento e registra il nuovo ruolo. Il vecchio ruolo viene
lasciato intatto, poiché potrebbe essere utilizzato da un altro database sullo stesso cluster. Al termine,
vengono stampate le istruzioni `REVOKE` per revocare i grant del vecchio ruolo da questo database,
da eseguire una volta che non saranno più necessari.

`--dry-run` stampa le istruzioni e le clausole `REVOKE` senza applicare modifiche. In presenza di un
terminale viene chiesta conferma; in assenza di terminale, il comando rifiuta l'esecuzione se manca `--yes`. Successivamente imposta
`REBASE_RLS_REQUEST_ROLE` con il nuovo ruolo su tutti i server che utilizzano il
database. Consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase db provision --print`

Stampa il codice SQL che configura i ruoli di richiesta per questo database, destinato all'esecuzione
da parte di un amministratore di database:

```bash
rebase db provision --print > request-role.sql
```

Per ciascun ruolo di richiesta stampa le istruzioni per creare il ruolo, assegnare al
ruolo di connessione i privilegi per passare ad esso e, con l'impostazione predefinita
`grants: "schema"`, concedergli l'accesso agli schemi `public` e `rebase`. I ruoli corrispondono a
`REBASE_RLS_REQUEST_ROLE` se impostato, in alternativa a quelli registrati nel database durante l'avvio,
altrimenti a `rebase_user`. Le spiegazioni sono formattate come commenti SQL, in modo tale che
l'output possa essere eseguito così com'è. Legge il ruolo di connessione senza eseguire altre operazioni.
`--print` è obbligatorio. Associalo a `REBASE_RLS_PROVISION_ROLE=never` quando i ruoli
vengono creati da un DBA o tramite codice di infrastruttura.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch diff <name> [--json] [--sample-limit <n>]
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL non consente la copia o l'eliminazione di un database a cui è connesso qualsiasi altro processo, e
di norma questo "qualsiasi altro processo" è la tua istanza di `rebase dev`. `create` e `delete` indicano
chi sta tenendo aperto il database; `--force` disconnette preventivamente tali sessioni.

Ogni branch è una copia completa su disco, pertanto richiede una pulizia periodica. `prune` rimuove
tre tipologie di elementi: una voce il cui database è stato eliminato all'esterno di Rebase, un database
di branch la cui voce non è mai stata registrata e — solo se combinato con `--older-than` — i branch
più vecchi dell'intervallo temporale indicato. Richiede conferma prima di eliminare qualsiasi elemento a meno che non venga passato `--yes`.
In assenza di un terminale interattivo, ad esempio in ambienti CI, non elimina alcunché, segnala di
fornire `--yes` ed esce con codice 1.
`list` e `info` sono comandi di sola lettura: un database su cui non è stato creato alcun branch risulterà privo di branch, e
questi comandi non creeranno alcuno schema `rebase`.

`diff` mostra le modifiche apportate da un branch rispetto al database di origine da cui è stato creato:
tabelle, colonne, vincoli, indici, trigger, policy RLS, tipi enum,
viste e funzioni aggiunte, eliminate o modificate, nonché per ciascuna tabella le righe
inserite, aggiornate ed eliminate. Le righe modificate autonomamente dal database genitore nel frattempo
vengono conteggiate a parte, e le righe modificate da entrambe le parti costituiscono conflitti. `--json` stampa il
diff completo, fino a un massimo di `--sample-limit` righe per tabella (valore predefinito: 100). Legge
entrambi i database senza modificarne alcuno; l'operazione di merge avviene in Studio — consulta
[Revisione e merge di un branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` registra il branch in `.rebase/branch.json` senza mai modificare `.env`. Ha
priorità su `DATABASE_URL` in `.env` ma è subordinato a `--database-url` o a una variabile
`DATABASE_URL` definita nella shell, quindi un flag sulla riga di comando ha sempre la precedenza rispetto
a uno switch eseguito in precedenza. `delete` impedisce l'eliminazione del branch su cui ti trovi, poiché ogni comando
nel checkout, inclusa l'eliminazione stessa, punta ad esso: esegui prima `switch --off`,
quindi procedi all'eliminazione. Il flusso di lavoro completo è documentato in [Database Branching](/docs/backend/branching/).

#### `rebase db branch merge`

```bash
rebase db branch merge <name> [--on-conflict abort|branch|target] [--skip-blocked] [--yes]
```

Scrive le righe inserite, aggiornate ed eliminate da un branch nel database da cui è stato generato. Stampa prima il diff e chiede conferma, quindi applica esattamente quel diff: il merge fa riferimento all'impronta (fingerprint) del diff, per cui se il genitore ha subito modifiche nel frattempo l'operazione viene rifiutata anziché eseguita. `--on-conflict` stabilisce il comportamento per una riga modificata su entrambi i lati: `abort` (predefinito) non scrive nulla, `branch` applica la riga del branch, `target` mantiene quella del genitore; `--skip-blocked` unisce le tabelle per cui è possibile farlo e salta le restanti. Le modifiche a schemi e policy non vengono mai unite: sono le migrazioni a gestirle. Anche `delete` richiede conferma prima di procedere, e il flag `--yes` risponde affermativamente a entrambe le richieste negli script.

:::note[Sul database di sviluppo gestito]
`push`, `generate` e `migrate` funzionano qui come su qualsiasi altro database.
`push` e `generate` pianificano le proprie operazioni tramite Atlas, che necessita di un secondo
database vuoto per effettuare il confronto — e l'istanza gestita di PGlite ne gestisce esattamente uno. Pertanto,
sul database gestito ciascuno di essi avvia un secondo PGlite temporaneo in memoria
dedicato ad Atlas, per poi arrestarlo al termine del comando. È in questo modo che una colonna viene eliminata,
rinominata o ristretta in questo ambiente: `rebase dev` si limita sempre e solo ad aggiungere. Il controllo sulle operazioni distruttive è il
medesimo presente ovunque. Se desideri che Atlas effettui la pianificazione rispetto a un tuo database vuoto,
imposta `REBASE_ATLAS_DEV_URL` con il relativo indirizzo; Rebase non creerà né eliminerà
alcun database specificato in questo modo.

`branch` non è consentito qui. L'istruzione `CREATE DATABASE ... TEMPLATE`
eseguita su PGlite registra una voce nel catalogo senza copiare i dati, con la conseguenza che il branch
punterebbe allo stesso database da cui è stato clonato: ogni operazione di scrittura pensata per essere isolata
finirebbe direttamente nel database di sviluppo. L'opzione `rebase dev --docker` mette a disposizione un vero
server su cui è possibile utilizzare i branch.
:::

## Risorse correlate

- [Riferimento CLI](/docs/cli/) — tutti gli altri comandi `rebase`
- [Generazione dello schema](/docs/cli/schema/) — approfondimento su `db push`, `db generate`, `db migrate` e `db branch`
- [Backup e ripristino](/docs/deployment/backups/) — pianificazione, file dei ruoli, ripristino
- [Database Branching](/docs/backend/branching/) — come viene creato un branch e quali risorse richiede
- [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/) — il ruolo di richiesta, le sue impostazioni e `rebase doctor --database`
- [Script e Console](/docs/backend/scripts/) — interagire con lo stesso database da uno script o da una REPL
