---
sourceHash: 90e9eafee6523006
title: Datenbank-Branching
sidebar_label: Branching
description: Erstellen Sie isolierte Datenbank-Branches für Entwicklung, Staging und Tests mit PostgreSQLs CREATE DATABASE ... TEMPLATE – sofortige, originalgetreue Kopien ohne Ausfallzeiten.
---

## Übersicht

Datenbank-Branching ermöglicht es Ihnen, **sofortige, isolierte Kopien** Ihrer gesamten Datenbank (sowohl Schema als auch Daten) zu erstellen, um Entwicklungs-, Migrationstests- und QA-Verfahren sicher durchzuführen.

Durch die Nutzung nativer PostgreSQL-Templates stellt Rebase geklonte Datenbanken auf Dateisystemebene bereit. Das bedeutet, dass Sie ein originalgetreues Replikat erhalten, das alle Tabellen, Indizes, benutzerdefinierten Typen, Constraints und Row-Level Security (RLS)-Richtlinien enthält – ganz ohne Netzwerkübertragungs-Overhead oder Verzögerungen bei der Schemaerstellung.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## Unter der Haube: PostgreSQL-Templating

Wenn ein Datenbank-Branch erstellt wird, führt der Rebase-`BranchService` folgendes SQL aus:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL verarbeitet diesen Vorgang durch Kopieren der zugrunde liegenden Dateisystemverzeichnisse, die die Quelldatenbankdateien enthalten. Dies bietet:
- **Klone in Sekundenbruchteilen**: Es wird keine SQL-Generierung oder Datenladung durchgeführt.
- **Identische Schemas und Daten**: Jede Zeile, jeder Index und jeder Constraint wird sofort dupliziert.
- **Vollständige Isolation**: Das Ändern des Schemas oder das Einfügen von Datensätzen in den Branch hat keine Auswirkungen auf die Quelldatenbank.

### Schutz vor Verbindungseinschränkungen

PostgreSQL setzt voraus, dass **keine weiteren aktiven Verbindungen** zur Template-(Quell-)Datenbank bestehen, wenn ein `CREATE DATABASE ... TEMPLATE`-Befehl ausgeführt wird.

Um Fehler zu vermeiden, führt der Rebase-`DatabasePoolManager` vor dem Klonen oder Löschen eines Branches einen aktiven Eviction-Prozess durch:
1. **Eviction-Schleife**: Schließt und trennt automatisch alle ungenutzten Pools (Idle Pools), die innerhalb des Rebase-Anwendungskontexts auf die Zieldatenbank verweisen.
2. **Blockierung durch externe Verbindungen**: Wenn externe Clients (wie DBeaver, pgAdmin oder externe Backend-Prozesse) aktive Transaktionen auf der Quelldatenbank aufrechterhalten, lehnt PostgreSQL die Template-Operation mit dem Fehler `"being accessed by other users"` ab.

Die Fehlermeldung benennt genau, was verbunden ist, anstatt Sie raten zu lassen:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` beendet diese Sitzungen vor dem Templating, sowohl bei `create` als auch bei `delete`. Die Sitzung, die den Befehl selbst ausführt, wird dabei niemals beendet.

`create --force`
schließt die Quelle außerdem für die Dauer der Kopie für neue Verbindungen
(`ALTER DATABASE … ALLOW_CONNECTIONS false`, ausgeführt aus der `postgres`-Datenbank des Servers)
und öffnet sie danach wieder: bei einem Fehler und bei jedem Signal, das es abfangen kann (Schließen
des Terminals, Ctrl-C, SIGTERM, SIGQUIT). Wird es hart beendet (SIGKILL), bleibt die Quelle
geschlossen bis zum nächsten `rebase db branch`-Befehl, gleich welchem, der sie zuerst wieder öffnet
und das sagt; `ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, ausgeführt aus der
`postgres`-Datenbank, tut dasselbe von Hand. Solange ein erzwungenes Create seine Quelle
geschlossen hält, hält es in der `postgres`-Datenbank einen Advisory Lock auf sie, sodass das
Wiederöffnen die Quelle einer laufenden Kopie in Ruhe lässt und ein zweites erzwungenes Create
von derselben Quelle wartet, bis das erste fertig ist. Ein Client, der sich sofort
nach dem Trennen wieder verbindet, wie es ein laufendes `rebase dev` tut, kann dann nicht
zurückschlüpfen, bevor die Kopie beginnt. Dafür braucht es den Eigentümer der Quelle; ohne ihn,
und bei `delete`, trennt `--force` die Sitzungen bis zu dreimal, bevor es aufgibt. Ist danach noch
eine Sitzung da, sagt der Fehler, dass sie sich wieder verbunden haben und gestoppt werden müssen,
statt erneut `--force` zu empfehlen. Unter 0.24 trennte es sie einmal, und etwa jedes siebte
`create --force` unter einem laufenden `rebase dev` scheiterte mit dem Rat, es mit `--force`
erneut auszuführen.

Der `DatabasePoolManager` trennt vor dem Klonen oder Löschen seine eigenen Idle-Pools – allerdings nur die Pools **innerhalb des Prozesses, der die Arbeit ausführt**. Da `rebase db branch` als eigener Prozess läuft, erreicht dies nichts anderes auf Ihrem Rechner:

- **Ein laufendes `rebase dev` blockiert das Branching.** Das ist der Regelfall, kein Randfall: Das Verlangen nach einem Branch und das Ausführen der App fallen meist zusammen. Stoppen Sie den Dev-Server, erstellen Sie den Branch und starten Sie ihn wieder.
- **Das gilt auch für jeden anderen Client.** DBeaver, pgAdmin, eine `psql`-Sitzung, eine zweite App-Instanz – PostgreSQL weist die Operation mit `is being accessed by other users` zurück, und diese Verbindungen müssen manuell geschlossen werden.

In PostgreSQL selbst führt kein Weg daran vorbei; `CREATE DATABASE ... TEMPLATE` ist eine Kopie auf Dateisystemebene, und das Template muss für die Dauer des Vorgangs im Ruhezustand sein.

---

## Metadaten-Schema

Branch-Konfigurationen werden in der Standarddatenbank in der Tabelle `rebase.branches` gespeichert, die während des Bootstrappings bereitgestellt wird:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Branch name as given (letters, digits, underscores, hyphens)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

Ein Server, der auf einem Branch läuft, verwaltet Branches in der Datenbank, aus der der Branch
kopiert wurde. Die eigene `rebase.branches` des Branches ist nur ein Schnappschuss, aufgenommen bevor
seine Zeile geschrieben wurde. Deshalb setzt `rebase dev` in einem [umgeschalteten](#cli-integration) Checkout
`REBASE_BRANCH_PARENT_DATABASE` auf die Datenbank, die `.env` nennt, und ein Server
mit dieser Variable liest und schreibt die Registry dort und kopiert neue Branches
standardmäßig aus ihr. Der Branches-Bereich von Studio listet auf einem Branch die Branches der Hauptdatenbank auf,
einschließlich des aktuellen, und ein dort erstellter Branch ist einer, den
`rebase db branch list` anzeigt.

---

## Programmatische API

Die Branching-API wird über den `BranchService` des Backends bereitgestellt. Nachfolgend finden Sie eine Referenz der Kernschnittstelle:

### Einen Datenbank-Branch erstellen

Erzeugt eine neue Branch-Datenbank aus der Standarddatenbank oder einem expliziten Quell-Template.

Der Standard ist die Datenbank, auf der die eigene Verbindung des Servers liegt, oder
`REBASE_BRANCH_PARENT_DATABASE`, wenn der Server auf einem Branch läuft. Es ist nie
die Datenbank, die `ADMIN_CONNECTION_STRING` nennt, wenn das eine andere ist.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### Aktive Branches auflisten

Ruft eine Liste der registrierten Branches zusammen mit ihren physischen Größen ab, die über die PostgreSQL-Systemfunktion `pg_database_size` abgefragt werden.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    database: "rb_feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

`database` ist die PostgreSQL-Datenbank, die der Branch ist, so wie sein Eintrag sie angibt:
womit Sie sich verbinden und was Sie als `source` übergeben, um den Branch zu kopieren. Es ist nicht
der Name des Branches (`staging` ist die Datenbank `rb_staging`).

### Branch-Informationen abrufen

Ruft Metadaten für einen einzelnen Branch ab. Wenn der Branch existiert, versucht der Dienst, dessen aktuelle physische Festplattenbelegung abzufragen:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Einen Branch löschen

Löscht die Zieldatenbank vom Server und bereinigt deren Eintrag in der Metadatentabelle `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Schutzmechanismus: Die Hauptdatenbank (der in den Verbindungszeichenfolgen konfigurierte Standarddatenbankname) ist geschützt. Das ist die Datenbank, auf der die eigene Verbindung des Servers liegt, oder auf einem Branch `REBASE_BRANCH_PARENT_DATABASE`. Wenn Sie versuchen, die übergeordnete Datenbank zu löschen, wirft der `BranchService` den Fehler `"Cannot delete the main database"` und bricht ab.

---

## CLI-Integration

Datenbank-Branches können direkt über das Rebase-CLI verwaltet werden.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# What the branch changed: schema, RLS policies and rows (--json for all of it)
rebase db branch diff dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` macht einen Branch erst nutzbar. Es hinterlegt den Branch in `.rebase/branch.json` – nur den Namen, niemals einen Connection-String, sodass Ihre Anmeldedaten ausschließlich in `.env` verbleiben – und jeder nachfolgende `rebase`-Befehl in diesem Checkout verwendet stattdessen die Datenbank des Branches: `dev`, `db push`, `db migrate`, `db backup`.
Ein bereits laufendes `rebase dev` behält die Datenbank, mit der es gestartet wurde, bis Sie es neu
starten, und `switch` sagt das.

`rebase db branch
list` markiert den Branch, auf dem dieser Checkout steht, und `prune` entfernt ihn nie, so wie
`delete` ihn verweigert: Der Plan führt ihn als behalten auf und sagt, ihn zuerst mit
`rebase db branch switch --off` zu verlassen. Unter 0.24 löschte `prune --older-than … --yes` ihn,
und der Checkout richtete danach jeden Befehl auf eine Datenbank, die nicht mehr existierte.

In der Auflösungsreihenfolge steht es zwischen der Shell und der Projektdatei:

1. `--database-url` in der Befehlszeile
2. `DATABASE_URL` in der Shell-Umgebung
3. **der Branch, zu dem dieses Checkout gewechselt hat**
4. `DATABASE_URL` in der `.env`-Datei des Projekts
5. `--docker` oder der Umstand, dass das letzte `rebase dev` damit lief
6. die verwaltete Entwicklungsdatenbank

Stufe 5 folgt dem letzten
`rebase dev --docker`, sodass ein Branch-Befehl danach kein eigenes `--docker` braucht,
und ein `--docker`, das eine Stufe darüber übertrumpft, startet keinen Container und
sagt, dass es ignoriert wurde. Unter 0.24 zählt nur das Flag, und ein übertrumpftes
startet den Container trotzdem.

Ein Branch muss Vorrang vor `.env` haben, da das Umschalten sonst bei keinem Projekt Wirkung zeigen würde, das `DATABASE_URL` setzt; er darf jedoch keinen Vorrang vor den beiden darüber liegenden haben, da ein Flag auf der aktuellen Befehlszeile eine unmittelbarere Anweisung ist als ein Wechsel am Vortag.

`.rebase/` wird von Git ignoriert (gitignored), sodass der Branch, auf dem Sie sich befinden, nur für Ihren Rechner gilt und niemals für das gesamte Projekt.

In einem umgeschalteten
Checkout arbeiten `rebase db branch create`, `list`, `info`, `delete` und `prune` auf der
Hauptdatenbank, in der das Register liegt, und sagen das auch. `create` kopiert weiterhin
den Branch, auf dem du bist, außer du übergibst `--from`; er wird in der Hauptdatenbank
erfasst, sodass `list` ihn aus jedem Checkout anzeigt. Vor 0.25 tat das nur `list`, und
ein aus einem umgeschalteten Checkout erstellter Branch wurde allein im Snapshot des
Branches erfasst.

Branches sind ganz gewöhnliche PostgreSQL-Datenbanken, die nach dem Branch mit dem Präfix `rb_` benannt sind. So entspricht `dev_sandbox` oben der Datenbank `rb_dev_sandbox` auf demselben Server.

Das Erstellen eines Branches ändert **nicht**, mit welcher Datenbank Ihr Projekt kommuniziert. `rebase db branch create` erstellt die Kopie und belässt es dabei; es wird nichts in `.env` geschrieben, und das nächste `rebase dev` verwendet weiterhin die zuvor genutzte Datenbank. Um mit einem Branch zu arbeiten, wechseln Sie mit `rebase db branch switch <name>` zu ihm, wie oben. Um ihn aus etwas zu erreichen, das kein `rebase`-Befehl ist: Sein Connection-String entspricht dem vorhandenen, lediglich der Datenbankname wird ausgetauscht:

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Einen Branch prüfen und zusammenführen

<span class="since-badge" data-since="0.26">Seit 0.26</span>

Ein Branch ist der Ort, an dem ein Agent – oder eine Migration, bei der Sie sich nicht sicher sind – eine Datenbank ändern kann, ohne die echte anzufassen. Bevor davon etwas die Datenbank erreicht, aus der der Branch erstellt wurde, können Sie in [Studio](/docs/studio/) sehen, was sich geändert hat, und es zusammenführen: Öffnen Sie **Branches** und wählen Sie einen aus.

- **Schema und RLS-Richtlinien** listet jede Tabelle, Spalte, jeden Primärschlüssel und jede Richtlinie, die der Branch hinzugefügt, entfernt oder geändert hat, als SQL – die Definition des Elternteils neben der des Branches.
- **Datenänderungen** zählt pro Tabelle die Zeilen, die der Branch eingefügt, aktualisiert und gelöscht hat, zugeordnet über den Primärschlüssel, und zeigt bis zu 100 davon pro Tabelle mit den geänderten Spalten.

Derselbe Diff ist `rebase db branch diff <name>` im Terminal, `GET /api/admin/branches/<name>/diff` über HTTP, das MCP-Tool `rebase_db_branch_diff` und `admin.diffBranch(name)` im Code. Rebases eigene Tabellen (Sitzungen, Verlauf, das Branch-Register) bleiben außen vor.

### Welche Seite eine Zeile geändert hat

Der Elternteil nimmt weiter Schreibzugriffe an, während am Branch gearbeitet wird. „Die beiden Datenbanken unterscheiden sich“ heißt daher nicht „der Branch hat es geändert“: Eine Zeile, die der Elternteil nach dem Erstellen des Branches eingefügt hat, sieht genauso aus wie eine Zeile, die der Branch gelöscht hat. Rebase unterscheidet sie danach, wann jede Zeile geschrieben wurde. Transaktions-IDs gehören dem Server, nicht einer einzelnen Datenbank, und die Template-Kopie behält sie bei – eine Zeile, die nach dem Erstellen des Branches geschrieben wurde, auf welcher Seite auch immer, ist also jünger als die Transaktion, die die Branch-Datenbank erstellt hat.

| Die Zeile des Branches | Die Zeile des Elternteils | Zählt als |
| --- | --- | --- |
| seit der Abzweigung geschrieben | fehlt | vom Branch eingefügt |
| fehlt | von vor der Abzweigung | vom Branch gelöscht |
| seit der Abzweigung geschrieben | von vor der Abzweigung | vom Branch aktualisiert |
| von vor der Abzweigung, oder fehlt | seit der Abzweigung geschrieben, oder fehlt | Änderung des Elternteils: bleibt erhalten |
| seit der Abzweigung geschrieben | seit der Abzweigung geschrieben | ein **Konflikt** |

Zwei Fälle sehen gleich aus und werden so gelesen, dass nichts verloren geht: Eine Zeile, die der Branch gelöscht und der Elternteil danach geändert hat, bleibt erhalten, und eine Zeile, die der Elternteil gelöscht und der Branch danach geändert hat, gilt als Einfügung des Branches. Ein `UPDATE`, das die Werte schreibt, die eine Zeile schon hatte, zählt trotzdem als Schreibvorgang.

Lässt sich der Abzweigpunkt nicht lesen – bei einem langlebigen Branch, dessen `pg_database`-Zeile ein Vacuum eingefroren hat, oder einem, der mit `ALTER DATABASE` umbenannt wurde –, sagt der Diff das und zählt jeden Unterschied als Änderung des Branches.

### Was ein Zusammenführen tut

**Zusammenführen** schreibt die Zeilen, die der Branch eingefügt, aktualisiert und gelöscht hat, in den Elternteil. Was gewinnt:

- **Zeilen, die nur der Branch geändert hat**, werden geschrieben: eingefügt, überschrieben oder gelöscht.
- **Zeilen, die nur der Elternteil** seit dem Erstellen des Branches geändert hat, bleiben genau so, wie sie sind.
- **Zeilen, die beide geändert haben**, sind Konflikte. Standardmäßig schreibt das Zusammenführen dann gar nichts; wählen Sie `onConflict: "branch"`, um die Zeile des Branches über die des Elternteils zu schreiben, oder `"target"`, um die des Elternteils zu behalten.
- **Schema- und Richtlinienänderungen werden nie zusammengeführt.** Sie gehören zu Ihren Collections und deren Migrationen: Wenden Sie sie mit `rebase db push` (oder `migrate`) an und führen Sie dann die Zeilen zusammen.

Eine Tabelle, deren Zeilen sich nicht zuordnen lassen, blockiert das Zusammenführen: eine, die der Branch hinzugefügt oder entfernt hat, eine, deren Spalten oder Primärschlüssel sich zwischen beiden unterscheiden, eine ohne Primärschlüssel oder eine mit mehr als 100.000 Zeilen auf einer Seite. Übergeben Sie `skipBlocked` (in Studio: **Die übrigen Tabellen zusammenführen** ankreuzen), um den Rest zusammenzuführen und diese in Ruhe zu lassen.

Jeder Schreibvorgang geschieht in einer einzigen Anweisung auf dem Elternteil – alles oder nichts, Fremdschlüssel am Ende geprüft. Ein Zusammenführen trägt den `fingerprint` des Diffs, den Sie geprüft haben, und schreibt nichts, wenn sich seitdem eine der beiden Datenbanken geändert hat: Laden Sie den Diff neu und sehen Sie noch einmal hin. Sequenzen werden über alle IDs hinaus vorgerückt, die das Zusammenführen eingefügt hat.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

Zusammenführen ist bewusst kein MCP-Tool: Ein Agent schlägt auf seinem Branch vor, und ein Mensch führt zusammen.

---

## Branching erfordert einen echten PostgreSQL-Server

Branching funktioniert **nicht** mit der verwalteten Entwicklungsdatenbank – der konfigurationsfreien PGlite-Datenbank, die `rebase dev` startet, wenn ein Projekt keine `DATABASE_URL` hat.

PGlite bedient genau eine Datenbank. Ein `CREATE DATABASE ... TEMPLATE` darauf schreibt lediglich einen Katalogeintrag und kopiert nichts, sodass der „Branch“ auf dieselbe Datenbank verweist, von der er geklont wurde: Schreibvorgänge, von denen Sie glauben, dass sie isoliert sind, landen in Ihrer Entwicklungsdatenbank, und es gibt keine zweite Kopie, zu der Sie zurückkehren könnten.

Verwenden Sie Branching mit einem echten Server – Ihrer eigenen PostgreSQL-Instanz über `DATABASE_URL` oder `rebase dev --docker`, dem die Branch-Befehle dann folgen.

---

## Best Practices und Einschränkungen

### Festplattennutzung
Da PostgreSQL die Dateien auf der Festplatte dupliziert, belegt jeder Branch genauso viel Speicherplatz wie die Quelldatenbank. Wenn Sie eine 100-GB-Produktionsdatenbank haben, verbraucht das Erstellen von 5 Branches zusätzliche 500 GB Speicherplatz.
* *Empfehlung*: Verwenden Sie Subsets von Datenbanken oder schlanke Dev-Templates als Klonquellen anstelle vollständiger Produktionsklone.

Mit `rebase db branch prune` geben Sie den Speicherplatz wieder frei:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nichts läuft ab, es sei denn, Sie verlangen es: Ein Branch kann die einzige Kopie der Arbeit eines ganzen Nachmittags sein. Daher ist `--older-than` optional (Opt-in), Altersangaben werden abgerundet, und der Befehl zeigt seinen Plan an und fragt nach Bestätigung, bevor etwas entfernt wird – es sei denn, Sie übergeben `--yes`.

`prune` findet auch die beiden Fälle, in denen Branches von ihren Metadaten abweichen – ein Eintrag, dessen Datenbank mit einfachem SQL gelöscht wurde (was `list` für immer weiter melden würde), und eine Branch-Datenbank, deren Eintrag nie geschrieben wurde (bei einem Absturz zwischen den beiden Anweisungen, die `create` ausführt). Atlas’ temporäre `<db>_dev_diff`-Datenbanken werden ebenfalls gemeldet, aber nur mit `--include-dev-diff` entfernt: Sie sind keine Branches, und eine davon könnte zu einem gerade laufenden `db push` gehören.

### pgBouncer-Kompatibilität
Stellen Sie beim Einsatz hinter pgBouncer oder Connection-Poolern sicher, dass der Pooler administrative Datenbankoperationen unterstützt. Das Erstellen und Löschen von Datenbanken umgeht standardmäßige Pools auf Transaktionsebene und erfordert direkte Verbindungen zum Postgres-Server (mit erweiterten Benutzerrechten) über die `adminConnectionString`-Konfiguration.

### Datenbankübergreifende Abfragen
Da Branches separate PostgreSQL-Datenbanken sind, können Sie keine SQL-`JOIN`-Anweisungen über Branch-Grenzen hinweg ausführen. Alle Relationen müssen sich innerhalb der Grenzen der einzelnen aktiven Branch-Datenbank befinden.


## Verwandte Themen

- [Datenbank-Befehle](/docs/cli/database/#rebase-db-branch) — `rebase db branch` und dessen Flags
- [Schema-Generierung](/docs/cli/schema/) — wie das Schema erzeugt wird, das ein Branch kopiert
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) — `DATABASE_URL` und worüber ein aktiv geschalteter Branch Vorrang hat
