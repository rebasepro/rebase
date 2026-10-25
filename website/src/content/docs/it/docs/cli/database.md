---
sourceHash: 4527233b1773b5c2
title: Comandi del database
sidebar_label: Comandi del database
description: I comandi rebase db — push, generate e migrate, backup e ripristini, la copia di un database, la stringa di connessione, il database di sviluppo gestito e i branch.
---

## Panoramica

`rebase db` è la famiglia di comandi che raggiungono il database del progetto. Ognuno
lavora sul database che il progetto risolve, nell'ordine elencato da
[Database Branching](/docs/backend/branching/#cli-integration):
`--database-url`, poi `DATABASE_URL` nella shell, il branch su cui è posizionato il
checkout, `DATABASE_URL` in `.env`, `--docker` e, altrimenti, il database di sviluppo
gestito che avvia `rebase dev`. `rebase db url` stampa quale sia.

`push`, `generate` e `migrate` sono descritti in dettaglio in
[Generazione dello schema](/docs/cli/schema/), e ogni altro comando è nel
[riferimento CLI](/docs/cli/).

## Comandi

### `rebase db push`

Invia le modifiche allo schema direttamente al database (solo per sviluppo):

```bash
rebase db push
```

`--database-url <url>` indica il database, e `--docker` quello di compose, avviato se
necessario. Li accettano entrambi anche `generate`, `migrate`, `branch`, `backup` e `restore`.

Lascia stare ciò che le tue collezioni non descrivono: altre tabelle e viste, gli indici che hai
scritto e i vincoli CHECK ed EXCLUDE sulla tabella di una collezione, che una collezione non può
dichiarare. Vedi [`rebase db push`](/docs/cli/schema/#rebase-db-push) per ciò che applica e
prima di cosa si ferma.

:::caution
`db push` modifica il database direttamente senza file di migrazione. Usa `db generate` + `db migrate` per l'ambiente di produzione.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

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

Su un database su cui un server si è già avviato, la prima migrazione crea tabelle che
l'avvio ha già creato, quindi lì il primo `db migrate` si ferma su `already exists`.
Registra invece quella migrazione come applicata, una sola volta:

```bash
rebase db migrate --baseline <version>
```

La versione è il prefisso numerico del file di migrazione; `db generate` stampa il
comando con la versione già inserita. Vedi
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) per un database che registra già le
migrazioni.

Dopo di ciò, `db migrate` applica ciò che l'avvio non ha applicato, e su un database
servito da `rebase dev` è meno di quanto sembri. L'avvio aggiunge ogni nuova tabella,
colonna e valore di enum non appena una collezione cambia, quindi quando
`db generate` scrive la migrazione che aggiunge una colonna, la colonna c'è già: quel
`db migrate` si ferma di nuovo su `already exists` e nomina il
`--baseline <version>` che la registra. Ogni nuova proprietà significa un'altra
baseline. Registra una migrazione solo quando l'avvio ha fatto ogni modifica che
contiene. Una che inoltre elimina, rinomina o restringe qualcosa contiene istruzioni che
l'avvio non esegue mai, e registrarla le salta. In sviluppo, `rebase db push` è il
comando che modifica lo schema; riserva `db generate` e `db migrate` a un database che
l'avvio non ha già modificato.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` e, essendo distruttivo,
chiede di digitare `yes` su un terminale, oppure accetta `--yes`; senza un terminale e
senza `--yes` si rifiuta e dice di passarlo.
In un database
che contiene già ciò che il backup crea, `restore` richiede `--clean`. Senza di esso,
si rifiuta prima di applicare qualsiasi cosa, ruoli del cluster compresi, e nomina gli
oggetti d'intralcio e i due modi per aggirarli: `--clean`, oppure
`--create-db --target-db <new name>`. Su 0.24 applicava i ruoli e poi falliva con
l'errore di pg_restore `schema "rebase" already exists`.
Con `--clean`
il ripristino è un'unica transazione: elimina gli schemi del backup con tutto ciò che
contengono, ripristina, e fa il commit solo quando l'intero ripristino è riuscito, quindi
un errore lascia il database com'era. Prima di chiedere conferma, nomina ciò che elimina
e che il backup non contiene. Esegue `psql`, che viene fornito con `pg_restore`.
Su 0.24 un ripristino `--clean` in un database con una tabella che mancava al backup,
come la tabella delle revisioni di Atlas dopo `db migrate`, eliminava tutto e non
ripristinava nulla.
`restore` rifiuta
il database di sviluppo gestito: un backup porta le sue righe come dati COPY, che quel
database non può ricevere, e su 0.24 il ripristino lo lasciava bloccato finché non
veniva arrestato. Ripristina in Postgres in Docker (`rebase db restore <dump> --docker --clean --yes`),
poi `rebase db pull --from "$(rebase db url --docker)" --yes` lo copia nel database
gestito. Un backup del database gestito lo lascia com'era; su
0.24 le impostazioni applicate da `pg_dump` restavano su di esso, e ogni richiesta API
falliva fino a `rebase db stop`.
I percorsi relativi, e il
valore predefinito `./backups`, si risolvono rispetto alla directory da cui esegui
`rebase`, così le tre righe qui sopra si incontrano in un'unica directory; un'opzione che
un comando non accetta viene rifiutata prima che venga eseguito qualcosa. Su 0.24 il
valore predefinito è `backend/backups`, quindi elencalo con `--out ./backups`.
Il dump e il suo file dei ruoli
sono leggibili solo da te (0600), e contro un database non in esecuzione `backup` e `restore`
stampano il banner che stampa `db push`. Su 0.24 i dump sono 0644.
La pianificazione, il file dei ruoli che viaggia con ogni dump e la procedura di ripristino sono in [Backup e ripristino](/docs/deployment/backups/).

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` accetta un URL `postgres://` o `postgresql://`, oppure le coppie
`host=… port=… dbname=…` di libpq racchiuse tra virgolette come un unico argomento.
Qualsiasi altra cosa viene rifiutata prima che venga letto o avviato qualcosa, senza
ripetere il valore.

`--anonymize` sostituisce i campi personali durante l'importazione, consentendo di lavorare localmente su una copia della produzione senza trasferire dati reali dei clienti su un laptop. Associa le colonne per nome ed è
best-effort. Una colonna `name` semplice viene sostituita solo in una tabella di persone:
una chiamata `users`, `authors`, `customers` o simili, oppure qualsiasi tabella che
contiene anche una colonna di indirizzi email.
Una colonna sotto un indice univoco riceve un valore distinto per ogni riga, e il passaggio
è un'unica transazione: se fallisce, le tabelle che avrebbe riscritto vengono svuotate e
nominate, e il comando termina con 1. Su 0.24 falliva su `token_hash` una volta che gli
utenti avevano effettuato l'accesso due volte, lasciando dati reali.

Un flag che `pull`
non accetta viene rifiutato prima che venga letto o copiato qualsiasi cosa, nominando
quello che probabilmente si intendeva: `--anonymise` risponde "did you mean --anonymize?"
e termina con 1. Su 0.24 un flag scritto male veniva ignorato, quindi `--anonymise`,
`--anon` o `--schem` eseguivano il pull senza di esso, e i dati personali arrivavano
così com'erano.
Su `pull` e su ogni altro comando, uno switch a cui viene dato un valore lo legge:
`--anonymize=true` o `=1` lo attiva, `--anonymize=false` o `=0` lo lascia disattivato,
e qualsiasi altro valore viene rifiutato. Su 0.25 ogni valore attivava lo switch, quindi
`--anonymize=false` anonimizzava e `db push --allow-destructive=false` consentiva
l'eliminazione.

Dato che `pg_dump` rimuove i privilegi, la copia arriverebbe con i criteri RLS di origine ma senza le relative autorizzazioni sottostanti — causando il fallimento di ogni lettura come `rebase_user` con l'errore `permission denied`. L'operazione di pull ripristina successivamente il ruolo dell'applicazione, impiegando la medesima procedura usata all'avvio e da `rebase db push`, garantendo che le tabelle interne di Rebase rimangano protette come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può essere modificata: il passaggio di `--database-url` viene rifiutato, evitando qualsiasi possibilità di eseguire un "pull verso la produzione". `--from` è l'unica direzione consentita.

Un pull sostituisce
il contenuto del database locale: svuota prima ogni schema che copia, quindi una tabella
che esiste solo in locale non sopravvive. Nel database di sviluppo gestito le righe
viaggiano come istruzioni `INSERT`, che quel database accetta laddove `COPY` lo
bloccherebbe. Su 0.24 un pull nel database gestito falliva alla prima tabella e lo
lasciava senza rispondere finché non veniva terminato.

### `rebase db url`

Stampa la stringa di connessione utilizzata dal progetto, e nient'altro, facilitando l'uso in pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso principale che necessita di questo comando: `.env` lascia intenzionalmente `DATABASE_URL` commentato, e la porta è calcolata dal percorso del progetto, per cui nessun elemento su disco la definisce in modo esplicito.
Mantiene quella porta tra un arresto e un avvio, a meno che qualcos'altro non l'abbia
occupata; su 0.24 ogni avvio ne sceglieva una nuova. Quando imposti un tuo `DATABASE_URL`, viene stampato quello — l'ordine di risoluzione è lo stesso seguito da qualsiasi altro comando. Il comando avvia il database gestito qualora non sia già in esecuzione.

Dopo
`rebase dev --docker`, `db url` e gli altri comandi usano quel database Docker
(e lo dicono su stderr) finché non viene eseguito un `rebase dev` senza il flag. La scelta
è conservata in `.rebase/dev-database.json` e ha la precedenza dove l'ha `--docker`,
sotto ogni stringa di connessione. Un `--docker` che digiti e che una stringa di
connessione supera non avvia alcun container: una riga su stderr dice che è stato
ignorato, nomina ciò che ha vinto e dice come raggiungere invece Docker. Un
`rebase dev --docker` superato in questo modo mantiene la scelta memorizzata così com'era,
quindi, una volta tolta la stringa di connessione, i comandi seguono di nuovo Docker. Su
0.24 ogni comando richiede il proprio `--docker`, e uno superato avvia comunque il
container.

`rebase init`
assegna a ogni progetto la propria porta compose, tra 5433 e 5632 in base al percorso del
progetto, e `--docker` controlla che ciò che risponde su di essa sia il container `db` di
questo progetto. Quando la porta è occupata da un altro container o da un Postgres esterno
a Docker, si ferma e lo nomina invece di accedere al database di qualcun altro. Per
spostare il progetto, cambia la porta host del servizio `db` in `docker-compose.yml`, e
`DATABASE_URL` se `.env` ne imposta uno. Su 0.24 ogni scaffold prendeva la prima porta
libera a partire da 5432, quindi progetti creati uno accanto all'altro potevano
condividerne una.

### `rebase db stop` / `rebase db reset`

Valido solo per il database di sviluppo gestito:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Appartiene al progetto, non al comando che l'ha avviato, quindi arrestare `rebase dev`
lo lascia in esecuzione per gli altri comandi. Dopo 30 minuti senza nulla di connesso si
arresta da solo, e il comando successivo che ne ha bisogno lo avvia di nuovo.
`rebase dev` lo dice mentre si arresta, indicando come arrestare subito il database;
su 0.24 non diceva nulla.

`db stop` con un
`rebase dev` in esecuzione dice che il suo backend non può raggiungere il database finché
non torna disponibile. Il comando successivo che ne ha bisogno, per esempio
`rebase db url`, lo avvia sulla stessa porta, e il backend si riconnette senza riavvio.
Su 0.24 tornava su un'altra porta, e il backend rispondeva 503 finché `rebase dev` non
veniva riavviato.

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

PostgreSQL non consente di copiare o eliminare un database a cui è connesso qualsiasi altro processo, e il caso più tipico di "qualsiasi altro processo" è la tua istanza di `rebase dev`. `create` e `delete` indicano cosa sta occupando il database; `--force` disconnette preventivamente tali sessioni.

Ogni branch è una copia completa su disco, pertanto richiede una pulizia periodica. `prune` rimuove tre elementi: una voce il cui database è stato rimosso all'esterno di Rebase, un database di branch la cui voce non è mai stata salvata e — solo specificando `--older-than` — i branch più vecchi dell'età specificata. Salvo l'uso di `--yes`, richiede conferma prima di eliminare qualsiasi cosa.
Senza un terminale su cui chiedere, come in CI, non rimuove nulla, dice di passare `--yes` e termina con 1; su 0.24 dice "Nothing was changed." e termina con 0.
`list` e `info` si limitano a leggere: un database su cui non è stato creato alcun branch non ne ha, e
non vi creano lo schema `rebase`. Su 0.24 creano il registro.

`diff` mostra cosa ha cambiato un branch rispetto al database da cui è stato creato: tabelle, colonne e policy RLS aggiunte, eliminate o modificate, e per tabella le righe che ha inserito, aggiornato ed eliminato. Le righe che il genitore ha cambiato per conto suo da allora sono contate a parte, e quelle cambiate da entrambi sono conflitti. `--json` stampa l'intero diff, con fino a `--sample-limit` righe per tabella (100 per impostazione predefinita). Legge entrambi i database e non ne modifica nessuno; l'unione si fa in Studio — vedi [Esaminare e unire un branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`. Ha la precedenza su `DATABASE_URL` presente in `.env` ma cede il passo a `--database-url` o a una variabile `DATABASE_URL` definita nella shell; pertanto, un flag passato da riga di comando ha sempre priorità rispetto a uno switch effettuato precedentemente. `delete` rifiuta il branch su cui ti trovi, poiché ogni comando del checkout, `delete` compreso, punta a esso: prima `switch --off`, poi eliminalo. L'intero flusso di lavoro è in [Database Branching](/docs/backend/branching/).

:::note[Sul database di sviluppo gestito]
`push`, `generate` e `migrate` funzionano qui come su qualsiasi database.
`push` e `generate` pianificano le loro operazioni tramite Atlas, che richiede un secondo database vuoto con cui effettuare il confronto — e il PGlite gestito ne fornisce esattamente uno. Quindi
sul database gestito ognuno di essi avvia un secondo PGlite temporaneo in memoria
per Atlas, e lo ferma al termine del comando. È così che una colonna viene eliminata,
rinominata o ristretta lì: `rebase dev` si limita ad aggiungere. Il blocco sulle operazioni distruttive è lo
stesso di ovunque. Per far pianificare Atlas su un database vuoto tuo,
imposta `REBASE_ATLAS_DEV_URL` su di esso; Rebase non crea né elimina un
database indicato in questo modo.

`branch` viene rifiutato in tale contesto. L'istruzione `CREATE DATABASE ... TEMPLATE` su PGlite registra una voce nel catalogo senza copiare alcunché; di conseguenza, il branch punterebbe al database da cui è stato clonato, facendo confluire nel database di sviluppo ogni scrittura che intendevi isolare. `rebase dev --docker` mette a disposizione un server reale compatibile con la gestione dei branch.
:::

## Risorse correlate

- [Riferimento CLI](/docs/cli/) — ogni altro comando `rebase`
- [Generazione dello schema](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` e `db branch` in dettaglio
- [Backup e ripristino](/docs/deployment/backups/) — pianificazione, il file dei ruoli, il ripristino
- [Database Branching](/docs/backend/branching/) — come si crea un branch e quanto costa
- [Script e console](/docs/backend/scripts/) — lo stesso database da uno script o da un REPL
