---
sourceHash: c782dc72c3c2aff6
title: Backup e ripristino
sidebar_label: Backup
description: Crea, pianifica, elenca e ripristina backup del database con pg_dump — cosa contiene un backup, il file dei ruoli che lo accompagna, e l'unica cosa che non copre, i tuoi file caricati.
---

## Panoramica

Rebase esegue il backup di un database Postgres con `pg_dump` e lo ripristina
con `pg_restore`. Puoi creare un backup manualmente, pianificarne uno con un
cron job, elencare quelli disponibili dalla CLI o dal pannello **Backups** di
Studio, e ripristinare in un database nuovo senza toccare quello attivo.

:::caution[Questo non esegue il backup dei tuoi file]
Un backup contiene solo il **database**, nient'altro. I file caricati vivono
nel tuo [backend di storage](/docs/backend/storage/) — un bucket S3 o GCS,
oppure la cartella in `STORAGE_PATH` — non in Postgres, quindi un database
ripristinato punta a file che solo quel backend possiede. Esegui il backup
del bucket (versioning o replica) o della cartella di upload separatamente,
con una pianificazione propria.
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

Il database è quello che risolve ogni altro [comando `rebase db`](/docs/cli/database/),
nello stesso ordine: `--database-url`, `DATABASE_URL` nella shell, il
[branch](/docs/backend/branching/) su cui è posizionato il checkout, `DATABASE_URL`
in `.env`, Postgres in Docker (`--docker`, o l'ultimo `rebase dev --docker`),
poi il database di sviluppo gestito, che `restore` rifiuta.

Un `--out` relativo, il
valore predefinito `./backups` e un percorso di dump passato a `rebase db restore` si
risolvono tutti rispetto alla directory da cui esegui `rebase`, normalmente la radice del
progetto, così `rebase db backup` e `rebase db backups list` si incontrano nello stesso
posto. Un `BACKUP_DESTINATION` relativo si risolve rispetto alla directory del backend,
dove lo legge anche il server. Tutti e tre i comandi rifiutano un'opzione che non
accettano prima di eseguire qualsiasi cosa, e nominano quella che probabilmente intendevi.
La password arriva a `pg_dump`, `pg_dumpall` e `pg_restore` in `PGPASSWORD`, mai sulla loro
riga di comando, così nessun messaggio di errore né elenco dei processi la mostra. Su 0.24
il valore predefinito era `backend/backups`, un'opzione scritta male veniva ignorata, e un
ripristino fallito stampava la stringa di connessione con la sua password.

## Cos'è un backup

`rebase db backup` esegue `pg_dump` in formato personalizzato (`-Fc`), che è
compresso e può essere ripristinato selettivamente. I file vengono nominati
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; il timestamp UTC nel nome è ciò su
cui si basano l'ordinamento e la retention.

| Opzione | Descrizione |
| --- | --- |
| `--out`, `-o` | Un percorso locale, o un URL `s3://bucket/prefix` / `gs://bucket/prefix`. Il valore predefinito è `$BACKUP_DESTINATION`, poi `./backups` nella directory da cui esegui `rebase`. |
| `--exclude-schema <s>` | Esclude uno schema dal dump (ripetibile). Un pattern che corrisponde a `rebase` viene rifiutato — vedi sotto. |
| `--no-owner` | Omette i comandi di proprietà, per ripristinare come un ruolo diverso. |
| `--enable-row-security` | Esegue il dump come soggetto admin invece di fallire sulla row-level security. **Può produrre un dump parziale** — vedi [Row-level security](#row-level-security-e-il-dump-silenziosamente-incompleto). |
| `--row-security-role <r>` | Il ruolo con cui leggere con il flag sopra. Il valore predefinito è `admin`. |

Un dump viene validato prima che il comando segnali il successo:
`pg_restore --list` deve riuscire a leggere l'intero archivio.

Per le destinazioni `s3://` la CLI costruisce il proprio client di storage
dalle stesse variabili `S3_*` usate dal tuo backend (`S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### Il file dei ruoli

Ogni backup scrive un secondo file accanto al dump:
`rebase-<db>-<…>Z.globals.sql`, prodotto da
`pg_dumpall --globals-only --no-role-passwords`. Un `pg_dump` per singolo
database non può includere i ruoli a livello di cluster, e i grant e le
policy di row-level security del dump ne nominano uno — `rebase_user`.
Ripristinato in un nuovo Postgres senza di esso, il primo `GRANT` verso quel
ruolo fallisce e il ripristino si interrompe.

Mantieni i due file insieme. La CLI li carica, elenca, pota e ripristina come
coppia, e `rebase db restore` cerca il `.globals.sql` nella stessa cartella o
prefisso del `.dump`. I ruoli vengono ricreati **senza password**;
impostale di nuovo dopo un ripristino in un nuovo cluster. `PG_DUMPALL_PATH`
indica un binario `pg_dumpall` specifico.

### Cosa contiene

Tutto il database, incluso lo schema `rebase`. Quello schema contiene ogni
account utente e il resto dell'autenticazione, le chiavi API, la cronologia
dei record, la coda dei job, i log dei cron, e le funzioni richiamate dalle
tue policy RLS e dai trigger di change-capture. Un dump senza di esso non ha
utenti, e non può essere ripristinato in un database vuoto: le tabelle che
contiene hanno policy che richiamano funzioni che non contiene.

Per questo
`rebase db backup` rifiuta un `--exclude-schema` che corrisponde a `rebase`, secondo le
regole dei pattern di pg_dump stesso (`reb*` e `*` compresi), prima di eseguire qualsiasi
cosa. Su 0.24 scriveva il dump e lo validava, e falliva solo il ripristino.

Poiché contiene ogni password
e hash di chiave, un dump locale e il suo `.globals.sql` vengono creati leggibili solo dal
proprietario (0600), prima che `pg_dump` vi scriva; lo sono anche i file locali di un
backup pianificato. Su 0.24 sono 0644.

## Backup pianificati

Un backup pianificato è un [cron job](/docs/backend/cron-jobs/) che esegue il
dump del database, carica il risultato su `BACKUP_DESTINATION` e pota i
backup vecchi. Inserisci un file in `backend/crons/` che esporti come
default:

```ts
// backend/crons/backup.ts
import { GCSStorageController, S3StorageController, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (destination?.kind === "gcs") {
        return new GCSStorageController({ type: "gcs", bucket: destination.bucket });
    }
    if (destination?.kind !== "s3") return undefined; // local: written to disk directly
    return new S3StorageController({
        type: "s3",
        bucket: destination.bucket,
        region: process.env.S3_REGION || "auto",
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
    });
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

Il controller di storage viene passato invece di essere preso dal contesto
del job, perché `rebase.storage` nel contesto è l'API di storage lato
client, non un controller per il bucket dei backup.

Un backup non è soggetto ai limiti di caricamento del controller. `maxFileSize` (50 MB se non
impostato) e `allowedMimeTypes` valgono per ciò che caricano gli utenti, quindi un dump di qualsiasi
dimensione viene caricato, e lo stesso vale per uno scritto tramite il controller che serve i file
della tua app.

| Variabile | Significato |
| --- | --- |
| `BACKUP_SCHEDULE` | Espressione cron, ad es. `0 3 * * *` per le 03:00 ogni giorno. Non impostata disattiva i backup pianificati. |
| `BACKUP_DESTINATION` | Un percorso locale, o `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Elimina i backup più vecchi di questo numero di giorni. Non impostata o `0` mantiene tutto. |
| `BACKUP_KEEP_MINIMUM` | Mantiene sempre almeno questo numero di backup recenti, per quanto vecchi — così un'interruzione prolungata non elimina tutto. |

Ogni nuovo dump viene validato **prima** che qualcosa venga potato, quindi un
dump corrotto non può mai essere il motivo per cui il tuo ultimo backup
valido è stato eliminato. La potatura tocca solo i file il cui nome
corrisponde al pattern dei backup; qualsiasi altra cosa che condivide il
bucket o il prefisso resta intatta.

Il cron esegue `pg_dump` all'interno del processo server. L'immagine di
runtime ufficiale (`rebasepro/server`, vedi
[Self-hosting](/docs/deployment/self-hosting/)) include a questo scopo gli
strumenti client di PostgreSQL 18;
sulla 0.23 e precedenti non ne aveva alcuno, e ogni esecuzione pianificata
falliva con `Could not find the 'pg_dump' binary`. Ovunque altrove — un VPS,
una tua immagine — installa tu stesso gli strumenti client (vedi la sezione
successiva).

## Compatibilità delle versioni

`pg_dump` e `pg_restore` devono avere la **stessa versione major del server,
o una più recente**. Ogni comando verifica prima la versione major del
client rispetto al `server_version_num` del server attivo e si interrompe
con il rimedio se non corrispondono, o se il binario è assente:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Installali con `brew install libpq` o
`apt-get install postgresql-client-18` (dal repository apt di PostgreSQL,
dove quello di Debian è più vecchio), oppure indica un binario specifico con
`PG_DUMP_PATH`, `PG_RESTORE_PATH` e `PG_DUMPALL_PATH`.
`restore --clean` esegue anche `psql`, che viene fornito con essi; `PSQL_PATH` ne indica
un altro.

## Row-level security, e il dump silenziosamente incompleto

Su un Postgres gestito — Cloud SQL, RDS e gli altri — non esiste un
superuser da concedere, quindi il ruolo con cui ti connetti di solito non
possiede nessuna delle tue tabelle e non ha `BYPASSRLS`. La row-level
security si applica anche a lui, e `pg_dump` si rifiuta:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Quel rifiuto è l'esito sicuro. Aggiungere `--enable-row-security` a `pg_dump`
manualmente è quello pericoloso: ha successo, esce con 0, e il dump contiene
silenziosamente solo le righe che le policy del ruolo che esegue il dump
ammettono. Due vie d'uscita reali:

1. **Concedi al ruolo che esegue il dump `BYPASSRLS`, oppure rendilo
   proprietario delle tabelle.** Il dump contiene allora ogni riga.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase imposta `app.uid` e
   `app.user_roles` in modo che la policy generata `admin_full_access` ammetta
   il dump, e stampa un avviso che indica cosa hai scambiato: una tabella le
   cui policy non includono alcuna regola admin risulta incompleta, e nulla lo
   segnala.

## Ripristino

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` esegue `pg_restore`, ed è un'operazione distruttiva, quindi non è
mai automatica: senza `--yes` richiede una conferma interattiva `yes`, e in
una shell non interattiva si interrompe e dice di passare `--yes`. `<backup>` è un
`.dump` locale o una chiave `s3://…` / `gs://…`, scaricata per prima.

In un database
che contiene già ciò che il backup crea, richiede `--clean`: senza di esso, si rifiuta
prima di eseguire qualsiasi cosa, nominando gli schemi e le tabelle d'intralcio, e dice di
passare `--clean` oppure di ripristinare in un nuovo database con
`--create-db --target-db <name>`. Su 0.24 ricreava i ruoli e poi si fermava sull'errore di
pg_restore `schema "rebase" already exists`. Rifiuta il database di sviluppo gestito,
che non può accettare i dati COPY di un dump; ripristina invece in Postgres in Docker con
`--docker`.

Con `--clean`,
il ripristino sostituisce ciò che il backup contiene in un'unica transazione. Elimina per
intero ogni schema che il backup crea (`rebase`, per esempio), e ogni tabella che il
backup crea in uno schema che non crea (`public`), con `CASCADE`, poi ripristina il dump
nella stessa transazione. Prima di chiedere conferma, nomina ciò che questo elimina e che
il backup non contiene, come `rebase.atlas_schema_revisions` da `rebase db migrate`,
una funzione, un tipo o una sequenza in uno schema sostituito, o una vista o una chiave
esterna altrove che fa riferimento a una delle tabelle del
backup. Un ripristino che si ferma in un punto qualsiasi viene annullato, e dice che il
database contiene ciò che conteneva prima. Esegue il dump tramite `psql`, che viene
fornito con `pg_restore` (`PSQL_PATH` ne indica un altro), e attende al massimo
15 secondi per un lock, che un `rebase dev` in esecuzione può detenere. Su 0.24, `--clean`
era quello di pg_restore, un'istruzione alla volta: una tabella che mancava al backup in
`rebase` lo fermava a `DROP SCHEMA rebase`, dopo che ogni tabella era stata eliminata.
`--continue-on-error` esegue ancora il `--clean` di pg_restore.

Prima di ripristinare, ricrea i ruoli del cluster a partire dal
`.globals.sql` del backup — un ruolo già esistente viene saltato, non è un
errore — in modo che i grant e le policy del dump si applichino. Esegue poi
con `--exit-on-error`: un ripristino che registrasse un `GRANT` fallito e
continuasse segnalerebbe successo con la row-level security non applicata.
Senza un `.globals.sql` accanto al backup avvisa che alcuni ruoli potrebbero
mancare.

| Opzione | Descrizione |
| --- | --- |
| `--target-db <name>` | Ripristina in questo database invece di quello in `DATABASE_URL`. |
| `--create-db` | Crea prima il database di destinazione se non esiste. |
| `--clean` | Sostituisce ciò che il backup contiene, in un'unica transazione con il ripristino: i suoi schemi per intero, e le sue tabelle altrove. Dice prima che cosa questo elimina oltre il backup. |
| `--no-owner` | Ignora la proprietà registrata nel dump. |
| `--continue-on-error` | Registra gli errori e continua oltre di essi. **Può lasciare la RLS non applicata**; usalo solo quando sai perché. |
| `--yes`, `-y` | Salta la conferma. |

La procedura sicura è ripristinare accanto al database attivo, verificarlo, e
solo dopo spostare l'app:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Punta un processo di prova (o `psql`) su `app_restored` e verifica i
   conteggi delle righe, un accesso, e le tabelle a cui tieni più.
3. Ripunta `DATABASE_URL` su di esso, oppure rinomina i database, durante una
   breve finestra di manutenzione.
4. Ripristina i tuoi file caricati dal loro backup proprio, allo stesso
   momento nel tempo quanto più possibile.

## Il pannello Backups

Il pannello **Backups** di Studio, nel gruppo *Database*, elenca i backup
presenti in `BACKUP_DESTINATION`, dal più recente, con la loro dimensione e
l'orario. **Download** scarica il dump; **Roles file** scarica il suo
`.globals.sql`. Scarica entrambi e conservali nella stessa cartella. Un
backup contrassegnato **No roles file** non ha il file collaterale: ricrea i
suoi ruoli a mano prima di ripristinarlo in un nuovo Postgres.

Sopra l'elenco, il pannello riporta il job di backup pianificato e la sua ultima
esecuzione. Un'esecuzione fallita viene mostrata come errore con il proprio messaggio,
così un backup notturno che non riesce a eseguirsi è visibile dove sono
elencati i backup, non solo nel pannello Cron Jobs.

Cosa dice del job:

- **Last scheduled backup** è l'ultima esecuzione fatta dalla pianificazione. Un'esecuzione
  avviata a mano da allora (**Run Now** in Cron Jobs) ha una riga a sé, così un'esecuzione
  di prova riuscita non può nascondere un backup notturno fallito, e una fallita non viene
  riportata come il backup notturno.
- Un job dichiarato `enabled: false` risulta come backup pianificati **off**.
  È ciò che esporta il file di cron qui sopra finché `BACKUP_SCHEDULE` non è impostata, e
  impostare `BACKUP_SCHEDULE` li attiva. **Paused** significa che un admin ha messo in pausa
  il job in Cron Jobs, e riprenderlo lì lo riattiva.
- Un job che lo scheduler ha rifiutato, per una pianificazione, un fuso orario o un timeout
  non validi, viene riportato con il motivo. Non viene mai eseguito finché il suo file di
  cron non viene corretto.
- Quando la cronologia delle esecuzioni in `rebase.cron_logs` non può essere letta, il
  pannello lo dice, anziché dire che il backup non è ancora stato eseguito.

L'elenco viene letto dal processo server che risponde a `GET /api/admin/backups`,
e non sempre è il processo che esegue la pianificazione:

- Una destinazione `s3://` viene elencata e scaricata tramite un client per quel
  bucket, costruito dalle stesse variabili `S3_*` usate dal cron di backup. Una `gs://`
  usa le credenziali predefinite dell'applicazione (ADC). Forniscile a **ogni** processo che
  serve `/api/admin`, compreso il ruolo `api` di un
  [deployment suddiviso](/docs/deployment/split-processes/), non solo a quello che esegue
  il cron. Una destinazione che il processo non riesce a leggere risponde `503`
  con la destinazione e il motivo, e il pannello mostra questo anziché un
  elenco vuoto.
- Un percorso locale è il disco proprio di quel processo. Quando la pianificazione viene
  eseguita in un altro processo (un `api` con `REBASE_CRON_SCHEDULER=false` accanto a un
  `worker`), il pannello dice che sta elencando il disco di questo processo: i backup
  pianificati compaiono lì solo se entrambi i processi montano la stessa directory. Un
  deployment suddiviso dovrebbe fare il backup su object storage.

I download passano attraverso
`GET /api/admin/backups/download?key=…`, riservato agli admin, così il
bucket non deve mai essere pubblico; una chiave fuori dal prefisso della
destinazione viene rifiutata. Con `BACKUP_DESTINATION` non impostata, il
pannello indica che i backup non sono configurati.

### Scaricare un backup

Un browser non può
mettere un header `Authorization` su un download, quindi Studio e l'SDK chiedono prima
un link. `POST /api/admin/backups/download-url` con `{ "key": "…" }` (stesso scope admin e
stessi controlli sulla chiave del download) risponde
`{ url, token, expiresIn }`: un URL il cui token sostituisce l'header, per
quel solo backup alla destinazione corrente, per 60 secondi. Il token viene
rifiutato ovunque altro — come sessione, come token di download dello storage, per un altro
backup — e una volta scaduto. Il browser trasmette poi il dump direttamente
su disco, così un backup grande quanto il tuo database non deve mai stare in una tab.

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

Prima della 0.24, `backups.download(key)` rispondeva con un `Blob` contenente l'intero dump.
Ora salva il file in un browser e lancia un errore altrove; usa `stream(key)`
in Node. Contro un server senza link di download (uno precedente alla 0.24, o uno
senza un segreto JWT per firmarli), `download()` ripiega sulla lettura dei byte
da sé.

## Mantieni i backup privati

Un backup contiene tutti i tuoi dati, credenziali e dati personali inclusi.

- Non usare mai un bucket pubblico. Mantieni il suo accesso privato e
  registralo nei log.
- Attiva la cifratura at-rest: la server-side encryption di S3, la
  cifratura predefinita di GCS, o la cifratura del disco per una cartella
  locale.
- Limita chi può leggere la posizione dei backup, e ruota le sue credenziali.
- Preferisci un bucket dedicato, separato dai file caricati dagli utenti.

## Point-in-time recovery

Un backup `pg_dump` si ripristina al momento in cui è stato eseguito il
dump. Recuperare a un secondo qualsiasi nel mezzo richiede l'archiviazione
dei WAL e backup di base, che la distribuzione open source non esegue per
te. Se ti serve in self-hosting, esegui `pgBackRest` o `wal-g` accanto al tuo
Postgres e mantieni questi dump come una seconda copia, portabile.
