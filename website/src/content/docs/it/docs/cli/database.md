---
sourceHash: 6d4d1426d30011ff
title: Comandi del database
sidebar_label: Comandi del database
description: I comandi rebase db — push, generate e migrate, backup e ripristini, estrazione di una copia, stringa di connessione, database di sviluppo gestito e branch.
---

## Panoramica

`rebase db` è la famiglia di comandi che interagiscono con il database del progetto. Ciascuno
opera sul database risolto dal progetto, nell'ordine elencato in
[Database Branching](/docs/backend/branching/#cli-integration):
`--database-url`, poi `DATABASE_URL` nella shell, il branch su cui è posizionato
il checkout, `DATABASE_URL` in `.env`, `--docker`, e altrimenti il database di
sviluppo gestito avviato da `rebase dev`. `rebase db url` stampa di quale si
tratta.

`request-role` e `provision` servono per un database di cui Rebase non è proprietario esclusivo;
vedi [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).
`push`, `generate` e `migrate` sono descritti in dettaglio in
[Generazione dello schema](/docs/cli/schema/), e ogni altro comando si trova nel
[Riferimento CLI](/docs/cli/).

## Comandi

### `rebase db push`

Invia le modifiche allo schema direttamente al database (solo per sviluppo):

```bash
rebase db push
```

`--database-url <url>` specifica il database e `--docker` quello di Compose, avviato
se necessario. Anche `generate`, `migrate`, `branch`, `backup` e `restore` accettano entrambi.

Non modifica ciò che le dichiarazioni delle tabelle non descrivono: altre tabelle e
viste, indici creati manualmente e i vincoli CHECK ed EXCLUDE su una tabella
dichiarata, che una dichiarazione non può esprimere. Consulta
[`rebase db push`](/docs/cli/schema/#rebase-db-push) per verificare cosa viene applicato e
cosa viene ignorato.

:::caution
`db push` modifica il database direttamente senza file di migrazione. Usa `db generate` + `db migrate` per la produzione.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

Crea file di migrazione provvisti di timestamp in `backend/drizzle/migrations/` che possono essere revisionati e sottoposti a commit.

### `rebase db migrate`

Esegue le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica tutte le migrazioni non ancora applicate al database.

Su un database che è già stato avviato (boot), la prima migrazione tenta di creare tabelle
già create dal boot, quindi il primo `db migrate` si interrompe con l'errore `already exists`. Registra
invece quella migrazione come applicata, una sola volta:

```bash
rebase db migrate --baseline <version>
```

La versione corrisponde al prefisso numerico del file di migrazione; `db generate` stampa il
comando con questo valore già compilato. Consulta
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) per un database che registra già le migrazioni.

Dopodiché, `db migrate` applica ciò che il boot non ha ancora applicato, e su un database
servito da `rebase dev` questo è meno di quanto sembri. Il boot aggiunge ogni nuova tabella,
colonna e valore enum non appena cambia la dichiarazione di una tabella, quindi nel momento in cui
`db generate` scrive la migrazione che aggiunge una colonna, la colonna esiste già: quel `db migrate` si
interrompe nuovamente su `already exists` e indica il parametro
`--baseline <version>` con cui registrarla. Ogni nuova proprietà comporta un'altra
baseline. Registra una migrazione solo quando il boot ha effettuato tutte le modifiche in essa contenute. Una
che elimina (drop), rinomina o restringe qualcosa contiene istruzioni che il boot non esegue mai, e
registrarla le salterebbe. In fase di sviluppo, `rebase db push` è il comando designato per
modificare lo schema; riserva `db generate` e `db migrate` per i database non
ancora modificati dal boot.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` e, trattandosi di un'operazione
distruttiva, richiede la digitazione di `yes` sul terminale, oppure accetta `--yes`; in assenza
di un terminale e senza `--yes`, l'operazione viene rifiutata indicando di passare il flag.
Se eseguito su un database
che contiene già ciò che il backup crea, `restore` richiede `--clean`. Senza
di esso, rifiuta l'esecuzione prima che venga applicato qualsiasi elemento, inclusi i ruoli del cluster,
ed elenca gli oggetti in conflitto indicando le due modalità per aggirarli: `--clean`, oppure
`--create-db --target-db <new name>`.
Con `--clean`
il ripristino avviene in una singola transazione: elimina gli schemi del backup con tutto il loro
contenuto, ripristina ed effettua il commit solo quando l'intero ripristino è andato a buon fine,
garantendo che un eventuale errore lasci il database nello stato originale. Prima di chiedere conferma, elenca gli elementi
da eliminare che non sono presenti nel backup. Esegue `psql`, fornito insieme a `pg_restore`.
`restore` rifiuta
il database di sviluppo gestito: un backup trasporta le proprie righe sotto forma di dati COPY, che
questo non può ricevere.
Effettua il ripristino su Postgres in Docker (`rebase db restore <dump> --docker --clean --yes`),
quindi `rebase db pull --from "$(rebase db url --docker)" --yes` lo copia nel
database gestito. Un backup del database gestito lo lascia inalterato.
I percorsi relativi
e il valore predefinito `./backups` vengono risolti rispetto alla directory da cui si esegue
`rebase`, quindi le tre righe sopra fanno riferimento alla stessa directory; un'opzione non
supportata da un comando viene rifiutata prima dell'esecuzione di qualsiasi operazione.
Il dump e il relativo file dei ruoli sono leggibili solo dall'utente corrente (0600) e,
se eseguiti su un database non attivo, `backup` e `restore` stampano lo
stesso banner mostrato da `db push`.
La pianificazione, il file dei ruoli associato a ogni dump e la procedura di ripristino sono descritti in [Backup e ripristino](/docs/deployment/backups/).

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` accetta un URL `postgres://` o `postgresql://`, oppure coppie
`host=… port=… dbname=…` di libpq racchiuse tra virgolette come unico argomento. Qualsiasi altro formato viene rifiutato
prima di leggere o avviare alcunché, senza ripetere il valore.

`--anonymize` sostituisce i campi personali durante l'importazione, consentendo di lavorare
localmente su una copia di produzione senza trasferire dati reali dei clienti sul proprio computer. L'abbinamento
delle colonne avviene per nome con approccio best-effort. Una semplice colonna `name` viene sostituita solo in una
tabella di persone: ad esempio `users`, `authors`, `customers` o simili, oppure in qualsiasi
tabella che contenga anche una colonna per l'indirizzo email.
Una colonna associata a un indice univoco riceve un valore distinto per ogni riga e l'operazione avviene in una
sola transazione: in caso di errore, le tabelle che sarebbero state riscritte vengono svuotate e
indicate, e il comando termina con codice di uscita 1.

Un flag non
supportato da `pull` viene rifiutato prima di qualsiasi lettura o copia, suggerendo l'opzione
corretta presumibile: `--anonymise` risponde con "did you mean --anonymize?" ed
esce con codice 1.
Sia in `pull` che in ogni altro comando, uno switch a cui viene assegnato un valore lo interpreta:
`--anonymize=true` o `=1` lo attiva, `--anonymize=false` o `=0` lo disattiva
e qualsiasi altro valore viene rifiutato.

`pg_dump` rimuove i privilegi, quindi la copia arriverebbe con i criteri RLS di origine
ma priva delle relative concessioni (grant) — causando il fallimento di ogni lettura eseguita come `rebase_user`
con l'errore `permission denied`. L'operazione di pull esegue successivamente il ri-provisioning del ruolo dell'applicazione,
impiegando la medesima routine utilizzata dal boot e da `rebase db push`, garantendo che l'accesso alle tabelle interne di Rebase
rimanga revocato come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può
essere modificata: `--database-url` viene rifiutato anziché accettato, escludendo a priori qualsiasi
possibilità di eseguire un "pull in produzione". `--from` rappresenta l'unica direzione possibile.

Un pull sostituisce
i contenuti del database locale: svuota preliminarmente ciascuno schema che copia, di conseguenza
le tabelle presenti solo a livello locale non vengono mantenute. Nel database di sviluppo
gestito le righe vengono trasferite tramite istruzioni `INSERT`, che vengono accettate laddove `COPY`
si bloccherebbe.

### `rebase db url`

Stampa la stringa di connessione utilizzata da questo progetto, e nient'altro, permettendone
il piping:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso d'uso principale per questo comando: `.env` lascia
intenzionalmente `DATABASE_URL` commentato e la porta viene ricavata dal
percorso del progetto, per cui nessun file su disco la specifica.
Mantiene tale
porta tra un arresto e un riavvio, a meno che non sia stata occupata da un altro processo. Se è stata impostata una `DATABASE_URL`
personalizzata, verrà stampata quest'ultima: l'ordine di risoluzione è identico a quello
seguito da tutti gli altri comandi. Se il database gestito non è già in esecuzione,
il comando lo avvia.

Dopo
`rebase dev --docker`, `db url` e gli altri comandi utilizzano quel database Docker
(segnalandolo su stderr) finché non viene eseguito `rebase dev` senza il flag. La preferenza
viene memorizzata in `.rebase/dev-database.json` e si posiziona nella priorità allo stesso livello di `--docker`, subordinata a ogni
stringa di connessione. Se si specifica `--docker` ma una stringa di connessione ha priorità maggiore,
non viene avviato alcun container: una riga su stderr segnala l'annullamento, indica quale opzione ha prevalso
e spiega come raggiungere Docker in alternativa. Un comando `rebase dev --docker` scavalcato
in questo modo mantiene inalterata la scelta memorizzata, consentendo ai comandi di tornare a fare riferimento a Docker non appena la stringa di connessione viene rimossa.

`rebase init`
assegna a ciascun progetto una porta compose dedicata, compresa tra 5433 e 5632 in base al percorso del progetto,
e `--docker` verifica che il servizio che risponde su tale porta sia effettivamente il container `db` del progetto corrente.
Se un altro container o un'istanza di Postgres esterna a Docker occupa la porta, il processo si arresta
identificando il conflitto anziché connettersi al database di un'altra istanza. Per spostare il
progetto, modifica la porta dell'host del servizio `db` in `docker-compose.yml` e la variabile
`DATABASE_URL` se definita in `.env`.

### `rebase db stop` / `rebase db reset`

Solo per il database di sviluppo gestito:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Appartiene al progetto e non al comando che lo ha avviato; pertanto, l'arresto
di `rebase dev` lo lascia attivo per gli altri comandi. Trascorsi 30 minuti con
nessuna connessione attiva si arresta automaticamente, e il comando successivo che ne ha bisogno lo
riavvia. `rebase dev`
lo segnala al momento dell'arresto, indicando come fermare subito il database.

L'esecuzione di `db stop` mentre
`rebase dev` è attivo segnala che il backend non potrà raggiungere il database finché non
sarà nuovamente disponibile. Il comando successivo che ne ha bisogno, come ad esempio `rebase db url`, lo riavvia
sulla stessa porta e il backend si riconnette senza richiedere un riavvio.

### `rebase db request-role migrate`

Sposta le richieste di questo database da un ruolo Postgres a un altro:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Le richieste vengono eseguite come `rebase_user` a meno che il progetto non specifichi un altro ruolo
(`REBASE_RLS_REQUEST_ROLE` o `rls.requestRole`). Poiché un ruolo appartiene all'intero
cluster, i progetti che ne condividono uno dovrebbero avere ciascuno il proprio. Il primo
boot di provisioning registra il ruolo nel database; un boot successivo
configurato con un ruolo differente rifiuterà l'avvio finché il database non viene migrato.

Il comando esegue la migrazione a partire dal ruolo registrato nel database, oppure da `rebase_user`. In
un'unica transazione crea il nuovo ruolo se mancante, consente alla connessione di
passare a quest'ultimo, riassegna solo in questo database tutti i permessi (grant) del vecchio ruolo,
aggiorna i criteri (policy) che vi fanno riferimento e registra il nuovo ruolo. Il vecchio ruolo viene
lasciato inalterato, poiché potrebbe essere utilizzato da un altro database sul cluster. Al termine,
stampa le istruzioni `REVOKE` per revocare i permessi del vecchio ruolo su questo database,
da eseguire quando non saranno più necessari.

`--dry-run` stampa le istruzioni e le clausole `REVOKE` senza apportare modifiche. In presenza
di un terminale richiede conferma preliminare; senza terminale rifiuta l'operazione in assenza di `--yes`. Successivamente, imposta
`REBASE_RLS_REQUEST_ROLE` con il nuovo ruolo su ogni server che utilizza il
database. Consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase db provision --print`

Stampa il codice SQL che configura il ruolo o i ruoli di richiesta per questo database, destinato all'esecuzione
da parte di un amministratore di database:

```bash
rebase db provision --print > request-role.sql
```

Per ciascun ruolo di richiesta stampa le istruzioni che creano il ruolo, concedono al
ruolo di connessione il permesso di passare a esso e, con l'impostazione predefinita
`grants: "schema"`, gli concedono l'accesso agli schemi `public` e `rebase`. I ruoli corrispondono a
`REBASE_RLS_REQUEST_ROLE` se impostato, altrimenti a quelli registrati nel database durante il boot,
oppure a `rebase_user`. Le spiegazioni sono incluse sotto forma di commenti SQL, in modo che
l'output sia direttamente eseguibile. Legge il ruolo di connessione e non esegue altre operazioni.
`--print` è obbligatorio. Abbinalo a `REBASE_RLS_PROVISION_ROLE=never` quando i ruoli
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

PostgreSQL non copia né elimina un database a cui è connesso qualsiasi altro processo, e
solitamente tale processo è la propria istanza di `rebase dev`. `create` e `delete` indicano
cosa mantiene aperta la connessione al database; `--force` disconnette preventivamente tali sessioni.

Ciascun branch rappresenta una copia completa su disco, pertanto richiede una pulizia periodica. `prune` rimuove
tre elementi: una voce il cui database è stato eliminato all'esterno di Rebase, un
database di branch la cui voce non è mai stata registrata e — solo specificando `--older-than` — i branch
che superano l'anzianità definita. Chiede conferma prima di rimuovere qualsiasi elemento, a meno che non venga passato `--yes`.
In assenza di un terminale interattivo (ad esempio in ambienti di CI), non rimuove nulla, segnala di
passare `--yes` ed esce con codice 1.
`list` e `info` effettuano solo letture: un database da cui non è stato creato alcun branch non ne possiede nessuno e
non vi creano alcuno schema `rebase`.

`diff` mostra le modifiche apportate da un branch rispetto al database di origine da cui è stato generato:
tabelle, colonne, vincoli, indici, trigger, policy RLS, tipi enum,
viste e funzioni aggiunte, rimosse o modificate, nonché le righe inserite,
aggiornate ed eliminate per ogni tabella. Le righe modificate autonomamente dal
database padre nel frattempo vengono conteggiate a parte, mentre le righe modificate da entrambi costituiscono conflitti. `--json` stampa
l'intero diff, fino a un massimo di `--sample-limit` righe per tabella (valore predefinito: 100). Esegue solo la lettura
di entrambi i database senza modificarli; l'unione (merge) si effettua in Studio — vedi
[Revisione e unione di un branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`. Ha la
precedenza su `DATABASE_URL` in `.env` ma è subordinato a `--database-url` o a una
variabile `DATABASE_URL` nella shell, garantendo che un flag da riga di comando prevalga sempre su un
cambio di branch eseguito in precedenza. `delete` rifiuta l'eliminazione del branch attualmente attivo, poiché ogni comando
nel checkout, inclusa l'eliminazione stessa, punta a esso: esegui prima `switch --off`,
quindi procedi con l'eliminazione. L'intero flusso di lavoro è illustrato in [Database Branching](/docs/backend/branching/).

:::note[Sul database di sviluppo gestito]
`push`, `generate` e `migrate` funzionano qui come su qualsiasi altro database.
`push` e `generate` pianificano le operazioni tramite Atlas, che richiede un secondo
database vuoto per il confronto — e il PGlite gestito ne serve esattamente uno. Di conseguenza,
sul database gestito ciascuno di essi avvia una seconda istanza PGlite temporanea in memoria
per Atlas, arrestandola al termine del comando. È in questo modo che una colonna viene eliminata,
rinominata o ristretta: `rebase dev` si limita solo ad aggiungere. Il controllo per le operazioni distruttive è
identico a quello applicato altrove. Per fare in modo che Atlas pianifichi le modifiche confrontandosi con un database vuoto
personalizzato, imposta `REBASE_ATLAS_DEV_URL`; Rebase non creerà né eliminerà il
database specificato.

`branch` non è supportato qui. L'istruzione `CREATE DATABASE ... TEMPLATE`
su PGlite registra una voce nel catalogo senza copiare alcunché, per cui il branch finirebbe per
puntare allo stesso database da cui è stato clonato — e ogni scrittura che si intendeva isolare
finirebbe direttamente nel database di sviluppo. `rebase dev --docker` mette a disposizione un vero
server su cui i branch possono operare regolarmente.
:::

## Contenuti correlati

- [Riferimento CLI](/docs/cli/) — tutti gli altri comandi di `rebase`
- [Generazione dello schema](/docs/cli/schema/) — approfondimento su `db push`, `db generate`, `db migrate` e `db branch`
- [Backup e ripristino](/docs/deployment/backups/) — pianificazione, file dei ruoli, ripristino
- [Database Branching](/docs/backend/branching/) — come viene creato un branch e quale impatto comporta
- [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/) — il ruolo di richiesta, le sue impostazioni e `rebase doctor --database`
- [Script e Console](/docs/backend/scripts/) — lo stesso database tramite uno script o una REPL
