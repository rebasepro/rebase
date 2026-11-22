---
sourceHash: cd3015585fe4e355
title: Backup e ripristino
sidebar_label: Backup
description: Esegui, pianifica, elenca e ripristina i backup del database con pg_dump — cosa contiene un backup, il file dei ruoli associato e l'unico elemento non coperto, ovvero i file caricati.
---

## Panoramica

Rebase esegue il backup di un database Postgres con `pg_dump` e lo ripristina con
`pg_restore`. È possibile creare un backup manualmente, pianificarne uno con un cron job,
elencare i backup disponibili dalla CLI o dal pannello **Backups** di Studio e ripristinarli
in un nuovo database senza toccare quello in produzione.

:::caution[Questo non esegue il backup dei tuoi file]
Un backup contiene solo il **database** e nient'altro. I file caricati risiedono nel tuo
[backend di storage](/docs/backend/storage/) — un bucket S3 o GCS, oppure la
directory configurata in `STORAGE_PATH` — non in Postgres, quindi un database ripristinato punta solo ai file presenti in quel backend.
Esegui il backup del bucket (tramite versionamento o replica) o della directory dei caricamenti
separatamente, con una propria pianificazione.
:::

## Avvio rapido

```bash
# Back up to a local directory (custom format, compressed)
rebase db backup --out ./backups

# Back up straight to private object storage
rebase db backup --out s3://my-private-bucket/backups

# List what you have
rebase db backups list

# Restore into a FRESH database (does not touch the live one)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

Il database è quello risolto da ogni altro [comando `rebase db`](/docs/cli/database/),
nello stesso ordine: `--database-url`, `DATABASE_URL` nella shell, il
[branch](/docs/backend/branching/) attualmente selezionato nel checkout, `DATABASE_URL`
in `.env`, Postgres su Docker (`--docker`, o l'ultimo `rebase dev --docker`),
e infine il database di sviluppo gestito, che `restore` rifiuta.

Un'opzione `--out`
relativa, il valore predefinito `./backups` e il percorso di un dump passato a `rebase db restore`
vengono tutti risolti rispetto alla directory da cui si esegue `rebase`, normalmente la radice del
progetto, in modo che `rebase db backup` e `rebase db backups list` convergano nella stessa posizione. Un valore
relativo di `BACKUP_DESTINATION` viene risolto rispetto alla directory del backend, dove
viene letto anche dal server. Tutti e tre i comandi rifiutano qualsiasi opzione non supportata
prima di eseguire qualsiasi operazione, indicando quella che probabilmente si intendeva specificare. La password viene
passata a `pg_dump`, `pg_dumpall` e `pg_restore` tramite `PGPASSWORD`, mai tramite riga di comando,
in modo da non comparire in alcun messaggio di errore o elenco dei processi.

## Cos'è un backup

`rebase db backup` esegue `pg_dump` nel formato personalizzato (`-Fc`), che è compresso
e può essere ripristinato in modo selettivo. I file vengono denominati
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; il timestamp UTC nel nome è ciò in base al quale
vengono ordinati i backup per l'elenco e la retention.

| Opzione | Descrizione |
| --- | --- |
| `--out`, `-o` | Un percorso locale o un URL `s3://bucket/prefix` / `gs://bucket/prefix`. Il valore predefinito è `$BACKUP_DESTINATION`, quindi `./backups` nella directory da cui viene eseguito `rebase`. |
| `--exclude-schema <s>` | Esclude uno schema dal dump (ripetibile). Un pattern che corrisponde a `rebase` viene rifiutato — vedi sotto. |
| `--no-owner` | Omette i comandi di assegnazione della proprietà (ownership), utile per il ripristino con un ruolo differente. |
| `--enable-row-security` | Esegue il dump impersonando un soggetto admin invece di fallire a causa della row-level security. **Può produrre un dump parziale** — vedi [Row-level security](#row-level-security-e-il-dump-parziale-non-segnalato-row-level-security-and-the-dump-that-is-silently-short). |
| `--row-security-role <r>` | Il ruolo da utilizzare per la lettura con il flag precedente. Il valore predefinito è `admin`. |

Un dump viene convalidato prima che il comando segnali il completamento con successo: `pg_restore --list`
deve essere in grado di leggere l'intero archivio.

Per le destinazioni `s3://`, la CLI crea il proprio client di storage utilizzando le stesse
variabili `S3_*` utilizzate dal backend (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### Il file dei ruoli

Ogni backup genera un secondo file accanto al dump:
`rebase-<db>-<…>Z.globals.sql`, prodotto da
`pg_dumpall --globals-only --no-role-passwords`. Un'esecuzione di `pg_dump` specifica per database
non può includere i ruoli a livello di cluster, e i permessi (grants) e le policy di row-level security
del dump ne menzionano uno: `rebase_user`. Se ripristinato in un nuovo Postgres privo di questo ruolo,
il primo comando `GRANT` verso tale ruolo fallirà e il ripristino si bloccherà.

Conserva i due file insieme. La CLI li carica e li ripristina in coppia, un
backup pianificato li elimina congiuntamente e `rebase db restore` cerca il file `.globals.sql` nella stessa
directory o prefisso del file `.dump`. I ruoli vengono ricreati **senza password**;
impostale nuovamente dopo un ripristino in un nuovo cluster. `PG_DUMPALL_PATH` consente di puntare a un
binario specifico di `pg_dumpall`.

### Cosa contiene

Tutto il database, compreso lo schema `rebase`. Tale schema contiene ogni
account utente e il resto dell'autenticazione, le chiavi API, la cronologia dei record, la coda dei job,
i log dei cron e le funzioni richiamate dalle policy RLS e dai trigger di change-capture.
Un dump privo di questo schema non contiene utenti e non può essere ripristinato affatto in un
database vuoto: le tabelle che contiene hanno infatti policy che richiamano funzioni
non presenti.

Pertanto,
`rebase db backup` rifiuta un'opzione `--exclude-schema` corrispondente a `rebase`, in base alle
regole di pattern matching di pg_dump (inclusi `reb*` e `*`), prima di eseguire qualsiasi operazione.
Queste regole interpretano la sintassi delle espressioni regolari al di fuori dei doppi apici, quindi
vengono rifiutati anche pattern come `[r]ebase` e `audit|rebase`, e il server viene interrogato su
ciascun pattern prima dell'esecuzione di `pg_dump`, sfruttando lo stesso motore di espressioni regolari
usato dalla query interna di `pg_dump`.

Poiché contiene
tutte le password e gli hash delle chiavi, un dump locale e il rispettivo file `.globals.sql` vengono creati
leggibili esclusivamente dal proprietario (permessi 0600), prima ancora che `pg_dump` vi scriva; lo
stesso vale per i file locali di un backup pianificato.

## Backup pianificati

Un backup pianificato è un [cron job](/docs/backend/cron-jobs/) che esegue il dump del
database, carica il risultato in `BACKUP_DESTINATION` ed elimina i vecchi backup.
Basta inserire un file in `backend/crons/` che ne esporti uno come default export:

```ts
// backend/crons/backup.ts
import { backupStorageFromEnv, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (!destination || destination.kind === "local") return undefined; // local: written to disk directly
    // The same S3_* (or application-default GCS) client the CLI and the Backups panel build.
    return backupStorageFromEnv(destination, process.env);
}

// With BACKUP_SCHEDULE unset, export a disabled job so discovery still works.
export default resolved.config
    ? createBackupCron({ ...resolved.config, storage: backupStorage() })
    : createBackupCron({
        schedule: "0 3 * * *",
        connectionString: process.env.DATABASE_URL ?? "",
        destination: { kind: "local", path: "./backups" },
        enabled: false
    });
```

Il controller di storage viene passato esplicitamente anziché ricavato dal contesto del job,
poiché `rebase.storage` del contesto rappresenta l'API di storage lato client e non un
controller per il bucket di backup.

Un backup non è vincolato ai limiti di upload del controller. `maxFileSize` (50 MB
se non diversamente configurato) e `allowedMimeTypes` si applicano a ciò che gli utenti caricano, consentendo
l'upload di un dump di qualsiasi dimensione, anche se scritto tramite il controller che gestisce i file
della tua applicazione.

| Variabile | Significato |
| --- | --- |
| `BACKUP_SCHEDULE` | Espressione cron, ad es. `0 3 * * *` per le 03:00 ogni giorno. Se non impostata, disattiva i backup pianificati. |
| `BACKUP_DESTINATION` | Un percorso locale, o `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di questo numero di giorni. Se non impostata o impostata su `0`, conserva tutto. |
| `BACKUP_KEEP_MINIMUM` | Conserva sempre almeno questo numero di backup recenti, indipendentemente dalla loro età — in modo che un lungo periodo di inattività non elimini ogni archivio. |

Ogni nuovo dump viene convalidato **prima** che qualsiasi file venga eliminato, impedendo così che un
dump corrotto possa essere il motivo dell'eliminazione dell'ultimo backup valido. La procedura di pulizia
interessa esclusivamente i file i cui nomi corrispondono al pattern dei backup; qualsiasi altro file che
condivide il bucket o il prefisso rimane intatto.

Il cron esegue `pg_dump` all'interno del processo del server. L'immagine di runtime
ufficiale (`rebasepro/server`, vedi [Self-hosting](/docs/deployment/self-hosting/))
include già i client tool di PostgreSQL 18.
In qualsiasi altro contesto — un VPS, una propria immagine personalizzata —
è necessario installare i client tool manualmente (vedi la sezione successiva).

## Compatibilità delle versioni

`pg_dump` e `pg_restore` devono appartenere alla **stessa versione major del server o a una più
recente**. `rebase db backup` e `rebase db restore` controllano la versione major del client
rispetto al valore di `server_version_num` del server attivo prima di eseguire il dump o il ripristino, e si
bloccano indicando la soluzione se le versioni non sono compatibili, oppure se
il binario non è presente:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

È possibile installarli con `brew install libpq` o `apt-get install postgresql-client-18`
(dal repository apt di PostgreSQL, poiché quello nativo di Debian potrebbe essere più datato), oppure puntare a un
binario specifico tramite `PG_DUMP_PATH`, `PG_RESTORE_PATH` e `PG_DUMPALL_PATH`.
Anche `restore --clean` esegue `psql`, incluso in questi strumenti; `PSQL_PATH` consente di
indicarne un altro.

## Row-level security e il dump parziale non segnalato {#row-level-security-and-the-dump-that-is-silently-short}

Su un'istanza Postgres gestita — Cloud SQL, RDS e simili — non è disponibile un superuser,
quindi il ruolo a cui ci si connette solitamente non è proprietario delle tabelle e non possiede
il privilegio `BYPASSRLS`. La row-level security si applica quindi a tale ruolo e `pg_dump` rifiuta l'operazione:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Questo rifiuto rappresenta il comportamento sicuro. Aggiungere manualmente `--enable-row-security` a `pg_dump`
è invece rischioso: il comando ha successo, restituisce codice 0 e il dump conterrà silenziosamente
solo le righe ammesse dalle policy del ruolo utilizzato per il dump. Le due soluzioni corrette sono:

1. **Concedere al ruolo di backup `BYPASSRLS`, o renderlo proprietario delle tabelle.** In questo
   modo il dump conterrà tutte le righe.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase imposta `app.uid` e
   `app.user_roles` in modo che la policy generata `admin_full_access` consenta l'esecuzione
   del dump, e stampa un avviso per spiegare il compromesso: una tabella le cui
   policy non includono alcuna regola admin verrà esportata priva di righe, senza che nulla segnali l'anomalia.

## Ripristino

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` esegue `pg_restore` ed è un'operazione distruttiva, quindi non avviene mai in modo automatico:
senza `--yes` richiede una conferma interattiva digitando `yes`, mentre in una shell
non interattiva si interrompe avvisando di passare il flag `--yes`. `<backup>` è un percorso a un file `.dump` locale oppure una chiave `s3://…` / `gs://…`,
che verrà preventivamente scaricata.

In un database
che contiene già gli elementi creati dal backup, è necessario specificare `--clean`: senza di esso,
il comando si rifiuta di procedere prima di eseguire qualsiasi operazione, elencando gli schemi e le tabelle in conflitto, e
suggerisce di usare `--clean` o di ripristinare in un nuovo database tramite
`--create-db --target-db <name>`. Il comando rifiuta il
database di sviluppo gestito, che non può elaborare i dati COPY di un dump; esegui il ripristino
su Postgres in Docker con `--docker`.

Con `--clean`,
il ripristino sostituisce ciò che è contenuto nel backup all'interno di una singola transazione. Rimuove con `CASCADE`
ciascuno schema creato integralmente dal backup (ad esempio `rebase`), e ogni tabella creata dal backup
in uno schema non gestito interamente (come `public`), per poi ripristinare il
dump nella stessa transazione. Prima di chiedere conferma, segnala tutto ciò che verrà eliminato e che non
è contenuto nel backup, come ad esempio `rebase.atlas_schema_revisions` generato da
`rebase db migrate`, una funzione, un tipo o una sequenza in uno schema sostituito, oppure una
vista o foreign key altrove che fa riferimento a una delle tabelle del backup. Un ripristino che si interrompe in qualsiasi momento viene annullato con un rollback, lasciando
il database esattamente nello stato in cui si trovava in precedenza. Il dump viene eseguito tramite `psql`,
incluso insieme a `pg_restore` (`PSQL_PATH` consente di specificarne un altro), e attende al massimo
15 secondi per acquisire un lock, che un'istanza di `rebase dev` in esecuzione potrebbe trattenere.
`--continue-on-error` continua a eseguire il flag `--clean` nativo di pg_restore.

Prima di ripristinare, vengono ricreati i ruoli del cluster a partire dal file
`.globals.sql` del backup — un ruolo già esistente viene ignorato senza generare errori — in modo che i permessi
e le policy del dump possano essere applicati correttamente. Il ripristino si arresta poi al primo errore (`--exit-on-error`,
o `ON_ERROR_STOP` in modalità `--clean`): un'operazione di ripristino che
registrasse un errore su un `GRANT` proseguendo comunque segnalerebbe un successo lasciando però
la row-level security non applicata. In assenza di un file `.globals.sql` accanto al backup, viene mostrato un avviso
che segnala la possibile mancanza di ruoli.

| Opzione | Descrizione |
| --- | --- |
| `--target-db <name>` | Esegue il ripristino in questo database invece di quello configurato in `DATABASE_URL`. |
| `--create-db` | Crea prima il database di destinazione se non esiste. |
| `--clean` | Sostituisce il contenuto del backup in un'unica transazione con il ripristino: i suoi schemi per intero e le sue tabelle altrove. Mostra prima cosa verrà eliminato oltre al contenuto del backup. |
| `--no-owner` | Ignora le informazioni di proprietà registrate nel dump. |
| `--continue-on-error` | Registra gli errori e prosegue. **Può lasciare la RLS non applicata**; usalo solo se sei pienamente consapevole del motivo. |
| `--yes`, `-y` | Salta la richiesta di conferma. |

La procedura più sicura consiste nell'eseguire il ripristino accanto al database attivo, verificarlo e solo
successivamente migrare l'applicazione:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Punta un processo temporaneo (o `psql`) su `app_restored` e verifica il conteggio delle righe,
   un accesso utente e le tabelle più critiche.
3. Riassegna `DATABASE_URL` verso questo database, oppure rinomina i database durante una breve
   finestra di manutenzione.
4. Ripristina i file caricati dal loro backup dedicato, allineandoti al punto nel tempo più
   vicino possibile a quello del database.

## Il pannello Backups

Il pannello **Backups** di Studio, nella sezione *Database*, elenca i backup presenti in
`BACKUP_DESTINATION`, dal più recente al più vecchio, con la relativa data e ora (e la dimensione, nel caso di una
destinazione locale). **Download**
scarica il dump; **Roles file** scarica il rispettivo file `.globals.sql`. Scarica entrambi e
conservali nella stessa directory. Un backup contrassegnato con **No roles file** non ha un file collaterale associato:
ricrea manualmente i ruoli prima di ripristinarlo in un nuovo Postgres.

Sopra l'elenco, il pannello riporta il job di backup pianificato e la sua ultima esecuzione. Un'esecuzione fallita viene mostrata come
un errore con il relativo messaggio, rendendo visibile un backup notturno non riuscito direttamente dove
sono elencati i backup, e non solo nel pannello Processi pianificati.

Cosa viene indicato a proposito del job:

- **Last scheduled backup** è l'ultima esecuzione effettuata dalla pianificazione. Un'esecuzione avviata
  manualmente nel frattempo (**Run Now** in Processi pianificati) ottiene una riga separata, in modo che un'esecuzione
  di test riuscita non nasconda un backup notturno fallito, e un test fallito non venga
  scambiato per l'esecuzione notturna.
- Un job dichiarato con `enabled: false` viene indicato con i backup pianificati **disattivati**.
  Questo è quanto esportato dal file cron sopra riportato finché `BACKUP_SCHEDULE` non è impostata;
  la definizione di `BACKUP_SCHEDULE` provvede ad attivarli. **Paused** indica che un admin ha sospeso
  il job in Processi pianificati, e la sua ripresa da tale schermata lo riattiva.
- Un job rifiutato dallo scheduler per pianificazione, fuso orario o timeout non valido
  viene riportato con la relativa motivazione. Non verrà mai eseguito finché il rispettivo file cron non sarà corretto.
- Quando la cronologia delle esecuzioni in `rebase.cron_logs` non è accessibile, il pannello lo segnala
  chiaramente, anziché indicare che il backup non è ancora stato eseguito.

L'elenco viene letto dal processo del server che risponde a `GET /api/admin/backups`,
e tale processo non coincide sempre con quello che esegue la pianificazione:

- Una destinazione `s3://` viene elencata e scaricata tramite un client per quel
  bucket, configurato con le stesse variabili `S3_*` usate dal cron di backup. Una destinazione `gs://`
  utilizza le Application Default Credentials. Forniscile a **ogni** processo che
  gestisce `/api/admin`, compreso il ruolo `api` in un
  [deployment con processi separati](/docs/deployment/split-processes/), non solo a quello
  che esegue il cron. Una destinazione non leggibile dal processo risponde con un codice `503`
  indicando la destinazione e il motivo, e il pannello mostra questo messaggio anziché
  un elenco vuoto.
- Un percorso locale fa riferimento al disco del singolo processo. Quando la pianificazione viene eseguita in un altro
  processo (un'istanza `api` con `REBASE_CRON_SCHEDULER=false` accanto a un `worker`), il
  pannello segnala che sta leggendo il disco di quel processo: i backup pianificati compariranno
  lì solo se entrambi i processi condividono lo stesso volume montato. Un deployment con processi separati
  dovrebbe sempre salvare i backup su object storage.

I download vengono inviati in streaming tramite `GET /api/admin/backups/download?key=…`, riservato agli admin,
in modo che il bucket non debba mai essere reso pubblico; qualsiasi chiave esterna al prefisso della destinazione viene
rifiutata. Se `BACKUP_DESTINATION` non è impostata, il pannello segnala che i backup non sono
configurati.

### Scaricare un backup

Un browser non può
inviare un header `Authorization` durante un download diretto, quindi Studio e l'SDK richiedono prima un
link. `POST /api/admin/backups/download-url` con `{ "key": "…" }` (con gli stessi
permessi admin e controlli sulla chiave previsti per il download) restituisce
`{ url, token, expiresIn }`: un URL il cui token sostituisce l'header per
quello specifico backup nella destinazione corrente, con una validità di 60 secondi. Il token viene
rifiutato per qualsiasi altro scopo — come sessione, come token di download dello storage o per un altro
backup — e non appena scade. Il browser scarica quindi il dump direttamente su
disco, evitando che un backup grande quanto l'intero database debba risiedere nella memoria di una scheda.

```ts
// In a browser: the browser saves the file.
await client.backups.download(key);

// Anywhere: a link that needs no header, for 60 seconds.
const { url } = await client.backups.downloadUrl(key);

// In Node: stream the bytes to a file.
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { stream, name } = await client.backups.stream(key);
await pipeline(Readable.fromWeb(stream), createWriteStream(name));
```

`backups.download(key)` salva il file in un browser e genera un errore altrove; usa `stream(key)`
in ambiente Node. Con un server privo del supporto per i link di download (versioni precedenti alla 0.25, o istanze
prive del segreto JWT per firmarli), `download()` effettua un fallback leggendo direttamente i byte.

## Mantenere i backup privati

Un backup contiene tutti i tuoi dati, incluse le credenziali e le informazioni personali.

- Non usare mai un bucket pubblico. Mantieni l'accesso strettamente privato e monitoralo con i log.
- Attiva la crittografia at-rest: crittografia lato server di S3, crittografia predefinita di GCS,
  oppure crittografia a livello di disco per una directory locale.
- Limita chi può accedere alla destinazione dei backup e ruota periodicamente le relative credenziali.
- Prediligi un bucket dedicato, separato da quello dei caricamenti degli utenti.

## Point-in-time recovery

Un backup `pg_dump` consente il ripristino limitatamente all'istante esatto in cui è stato eseguito il dump. Il ripristino
a qualsiasi secondo intermedio richiede l'archiviazione dei file WAL e base backup, operazioni che
la distribuzione open-source non gestisce automaticamente. Se hai questa esigenza in un ambiente self-hosted, utilizza `pgBackRest`
o `wal-g` accanto alla tua istanza Postgres, conservando questi dump come seconda copia portabile.
