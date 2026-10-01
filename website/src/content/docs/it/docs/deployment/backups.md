---
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
# Esegui il backup in una cartella locale (formato personalizzato, compresso)
rebase db backup --out ./backups

# Esegui il backup direttamente su object storage privato
rebase db backup --out s3://my-private-bucket/backups

# Elenca i backup disponibili
rebase db backups list --out ./backups

# Ripristina in un database NUOVO (non toccando quello attivo)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

La stringa di connessione proviene dall'ambiente del tuo progetto, come per
ogni altro [comando `rebase db`](/docs/cli/): `DATABASE_URL`, con fallback su
`ADMIN_CONNECTION_STRING`.

## Cos'è un backup

`rebase db backup` esegue `pg_dump` in formato personalizzato (`-Fc`), che è
compresso e può essere ripristinato selettivamente. I file vengono nominati
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; il timestamp UTC nel nome è ciò su
cui si basano l'ordinamento e la retention.

| Opzione | Descrizione |
| --- | --- |
| `--out`, `-o` | Un percorso locale, o un URL `s3://bucket/prefix` / `gs://bucket/prefix`. Il valore predefinito è `$BACKUP_DESTINATION`, poi `./backups`. |
| `--exclude-schema <s>` | Esclude uno schema dal dump (ripetibile). Non escludere mai `rebase` — vedi sotto. |
| `--no-owner` | Omette i comandi di proprietà, per ripristinare come un ruolo diverso. |
| `--enable-row-security` | Esegue il dump come soggetto admin invece di fallire sulla row-level security. **Può produrre un dump parziale** — vedi [Row-level security](#row-level-security-and-the-dump-that-is-silently-short). |
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

Il cron esegue `pg_dump` all'interno del processo server.
<span class="since-badge" data-since="0.24">Dalla 0.24</span> l'immagine di
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
una shell non interattiva si interrompe. `<backup>` è un `.dump` locale o una
chiave `s3://…` / `gs://…`, scaricata per prima.

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
| `--clean` | Elimina gli oggetti esistenti prima di ricrearli (`--clean --if-exists`). |
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

<span class="since-badge" data-since="0.24">Dalla 0.24</span> sopra l'elenco
viene mostrato il job di backup pianificato e la sua ultima esecuzione.
Un'esecuzione fallita viene mostrata come errore con il proprio messaggio,
così un backup notturno che non riesce a eseguirsi è visibile dove sono
elencati i backup, non solo nel pannello Cron Jobs.

I download passano attraverso
`GET /api/admin/backups/download?key=…`, riservato agli admin, così il
bucket non deve mai essere pubblico; una chiave fuori dal prefisso della
destinazione viene rifiutata. Con `BACKUP_DESTINATION` non impostata, il
pannello indica che i backup non sono configurati.

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
