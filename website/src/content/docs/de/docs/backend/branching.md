---
sourceHash: f9ad18cf03580c13
title: Datenbank-Branching
sidebar_label: Branching
description: Erstellen Sie isolierte Datenbank-Branches für Entwicklung, Staging und Tests mithilfe von PostgreSQLs CREATE DATABASE ... TEMPLATE – sofortige, originalgetreue Kopien ohne Ausfallzeiten.
---

## Übersicht

Datenbank-Branching ermöglicht es Ihnen, **sofortige, isolierte Kopien** Ihrer gesamten Datenbank (sowohl Schema als auch Daten) zu erstellen, um Entwicklungsarbeiten, Migrationstests und QA-Verfahren sicher durchzuführen. 

Durch die Nutzung nativer PostgreSQL-Templates stellt Rebase geklonte Datenbanken auf Dateisystemebene bereit. Das bedeutet, dass Sie ein originalgetreues Replikat erhalten, das alle Tabellen, Indizes, benutzerdefinierten Typen, Constraints und Row-Level Security (RLS)-Richtlinien enthält – ohne Netzwerkübertragungs-Overhead oder Verzögerungen bei der Schema-Erstellung.

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

Wenn ein Datenbank-Branch erstellt wird, führt der Rebase `BranchService` das folgende SQL aus:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL verarbeitet diesen Vorgang durch Kopieren der zugrunde liegenden Dateisystemverzeichnisse, die die Dateien der Quelldatenbank enthalten. Dies bietet:
- **Klone im Subsekundenbereich**: Es wird keine SQL-Generierung oder Datenladung durchgeführt.
- **Identische Schemas und Daten**: Jede Zeile, jeder Index und jeder Constraint wird sofort dupliziert.
- **Vollständige Isolation**: Das Ändern des Schemas oder das Einfügen von Datensätzen in den Branch hat keinerlei Auswirkungen auf die Quelldatenbank.

### Der Schutzmechanismus für Verbindungsbeschränkungen

PostgreSQL erfordert, dass **keine weiteren aktiven Verbindungen** zur Template-(Quell-)Datenbank bestehen, wenn ein `CREATE DATABASE ... TEMPLATE`-Befehl ausgeführt wird.

Um Fehler zu vermeiden, führt der Rebase `DatabasePoolManager` einen aktiven Bereinigungsprozess (Eviction) durch, bevor ein Branch geklont oder gelöscht wird:
1. **Eviction-Schleife**: Schließt und trennt automatisch alle inaktiven Pools, die innerhalb des Rebase-Anwendungskontexts auf die Zieldatenbank verweisen.
2. **Blockierung durch externe Verbindungen**: Wenn externe Clients (wie DBeaver, pgAdmin oder externe Backend-Prozesse) aktive Transaktionen auf der Quelldatenbank aufrechterhalten, weist PostgreSQL die Template-Operation mit dem Fehler `"being accessed by other users"` zurück.

Die Fehlermeldung benennt, was verbunden ist, anstatt Sie raten zu lassen:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` beendet diese Sitzungen vor dem Templating, gleichermaßen bei `create` wie bei `delete`. Die Sitzung, die den Befehl selbst ausführt, wird dabei niemals beendet.

`create --force` schließt die Quelle für die Dauer des Kopiervorgangs auch für neue Verbindungen (`ALTER DATABASE … ALLOW_CONNECTIONS false`, ausgeführt aus der `postgres`-Datenbank des Servers) und öffnet sie danach wieder: bei Fehlern sowie bei jedem Signal, das abgefangen werden kann (Schließen des Terminals, Strg-C, SIGTERM, SIGQUIT). Wird der Prozess hart abgebrochen (SIGKILL), bleibt die Quelle bis zum nächsten beliebigen `rebase db branch`-Befehl geschlossen, welcher sie zuerst wieder öffnet und darüber informiert; ein manuell aus der `postgres`-Datenbank ausgeführtes `ALTER DATABASE "<db>" ALLOW_CONNECTIONS true` bewirkt dasselbe. Während ein erzwungenes Erstellen seine Quelle geschlossen hält, hält es einen Advisory Lock darauf in der `postgres`-Datenbank, sodass ein erneutes Öffnen die Quelle einer laufenden Kopie unberührt lässt und ein zweites erzwungenes Erstellen von derselben Quelle wartet, bis das erste abgeschlossen ist. Ein Client, der sich sofort nach dem Trennen wieder verbindet – wie es ein laufendes `rebase dev` tut –, kann sich so nicht wieder dazwischenschalten, bevor der Kopiervorgang beginnt. Dazu sind die Rechte des Eigentümers der Quelle erforderlich; ohne diese und bei `delete` trennt `--force` die Sitzungen bis zu dreimal, bevor es aufgibt. Ist danach immer noch eine Sitzung vorhanden, besagt der Fehler, dass sich der Client erneut verbunden hat und gestoppt werden muss, anstatt erneut `--force` zu übergeben.

`DatabasePoolManager` trennt vor dem Klonen oder Löschen seine eigenen inaktiven Pools – jedoch nur die Pools **innerhalb des Prozesses, der die Arbeit ausführt**. Da `rebase db branch` als eigener Prozess läuft, erreicht dies nichts anderes auf Ihrem Rechner:

- **Ein laufendes `rebase dev` blockiert das Branching.** Dies ist der Regelfall, kein Randfall: Einen Branch anlegen zu wollen und die App auszuführen, fällt meist zusammen. Stoppen Sie den Dev-Server, erstellen Sie den Branch und starten Sie ihn neu.
- **Ebenso jeder andere Client.** DBeaver, pgAdmin, eine `psql`-Sitzung, eine zweite App-Instanz – PostgreSQL weist die Operation mit `is being accessed by other users` ab, und diese Verbindungen müssen manuell geschlossen werden.

In PostgreSQL selbst gibt es keinen Weg daran vorbei; `CREATE DATABASE ... TEMPLATE` ist eine Kopie auf Dateisystemebene, und das Template muss für die Dauer des Vorgangs im Ruhezustand sein.

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

Ein Server, der auf einem Branch läuft, verwaltet Branches in der Datenbank, aus der der Branch kopiert wurde. Das eigene `rebase.branches` des Branches ist lediglich ein Snapshot, der erstellt wurde, bevor seine Zeile geschrieben wurde. Daher setzt `rebase dev` bei einem [umgeschalteten](#cli-integration) Checkout `REBASE_BRANCH_PARENT_DATABASE` auf die Datenbank, die in `.env` angegeben ist. Ein Server mit dieser Variablen liest und schreibt die Registry dort und kopiert neue Branches standardmäßig von dort. Der Branches-Bereich von Studio listet auf einem Branch die Branches der Hauptdatenbank auf, einschließlich des aktuellen, und ein dort erstellter Branch wird von `rebase db branch list` angezeigt.

---

## Programmatische API

Die Branching-API wird über den `BranchService` des Backends bereitgestellt. Nachfolgend finden Sie eine Referenz der Kernschnittstelle:

### Einen Datenbank-Branch erstellen

Erzeugt eine neue Branch-Datenbank aus der Standarddatenbank oder einem expliziten Quell-Template.

Der Standard ist die Datenbank, mit der die eigene Verbindung des Servers besteht, oder `REBASE_BRANCH_PARENT_DATABASE`, wenn der Server auf einem Branch läuft. Es ist niemals die in `ADMIN_CONNECTION_STRING` benannte Datenbank, falls sich diese unterscheidet.

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

Ruft eine Liste der registrierten Branches zusammen mit deren physischer Größe über die PostgreSQL-Systemfunktion `pg_database_size` ab.

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

`database` ist die PostgreSQL-Datenbank, die der Branch darstellt, wie in seinem Datensatz angegeben: womit verbunden werden soll und was als `source` übergeben werden muss, um den Branch zu kopieren. Es ist nicht der Name des Branches (`staging` ist die Datenbank `rb_staging`).

### Branch-Informationen abrufen

Ruft Metadaten für einen einzelnen Branch ab. Wenn der Branch existiert, versucht der Dienst, dessen aktuelle physische Festplattenbelegung abzufragen:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Einen Branch löschen

Löscht (droppt) die Zieldatenbank vom Server und bereinigt deren Eintrag in der Metadaten-Tabelle `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Schutzmechanismus: Die Hauptdatenbank (der in den Verbindungszeichenfolgen konfigurierte Standard-Datenbankname) ist geschützt. Das ist die Datenbank, mit der die Verbindung des Servers selbst besteht, oder `REBASE_BRANCH_PARENT_DATABASE` auf einem Branch. Wenn Sie versuchen, die übergeordnete Datenbank zu löschen, wirft der `BranchService` den Fehler `"Cannot delete the main database"` und bricht ab.

---

## CLI-Integration

Datenbank-Branches können direkt über die Rebase-CLI verwaltet werden.

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

`switch` macht einen Branch nutzbar. Es hinterlegt den Branch in `.rebase/branch.json` – einen Namen, niemals eine Verbindungszeichenfolge, sodass Ihre Zugangsdaten ausschließlich in `.env` verbleiben – und jeder `rebase`-Befehl in diesem Checkout löst daraufhin stattdessen die Datenbank des Branches auf: `dev`, `db push`, `db migrate`, `db backup`. Ein bereits laufendes `rebase dev` behält die Datenbank bei, mit der es gestartet wurde, bis Sie es neu starten; `switch` weist darauf hin.

`rebase db branch list` markiert den Branch, auf dem sich dieser Checkout befindet, und `prune` entfernt ihn niemals, so wie sich auch `delete` weigert: Der Ausführungsplan führt ihn als beibehalten auf und weist darauf hin, ihn zuerst mit `rebase db branch switch --off` zu verlassen.

In der Auflösungsreihenfolge steht es zwischen der Shell und der Projektdatei:

1. `--database-url` in der Befehlszeile
2. `DATABASE_URL` in der Shell-Umgebung
3. **der Branch, zu dem dieser Checkout gewechselt hat**
4. `DATABASE_URL` in der `.env` des Projekts
5. `--docker`, oder das letzte `rebase dev`, das damit ausgeführt wurde
6. die verwaltete Entwicklungsdatenbank

Stufe 5 folgt dem letzten `rebase dev --docker`, sodass ein nachfolgender Branch-Befehl kein eigenes `--docker` benötigt, und ein `--docker`, das von einer höheren Stufe überstimmt wird, startet keinen Container und meldet, dass es ignoriert wurde.

Ein Branch muss Vorrang vor `.env` haben, da das Wechseln sonst bei keinem Projekt Wirkung zeigen würde, das `DATABASE_URL` setzt; er darf jedoch nicht die beiden darüber liegenden Stufen überstimmen, da ein Flag auf der Befehlszeile eine unmittelbarere Anweisung ist als ein gestern vorgenommener Wechsel.

`.rebase/` wird von git ignoriert (`.gitignore`), sodass der Branch, auf dem Sie sich befinden, eine Eigenschaft Ihres Rechners ist und niemals des Projekts.

Bei einem gewechselten Checkout operieren `rebase db branch create`, `list`, `info`, `delete` und `prune` auf der Hauptdatenbank, wo sich die Registry befindet, und weisen darauf hin. `create` kopiert weiterhin den Branch, auf dem Sie sich befinden, sofern Sie nicht `--from` übergeben; er wird in der Hauptdatenbank registriert, sodass `list` ihn von jedem Checkout aus anzeigt.

Branches sind gewöhnliche PostgreSQL-Datenbanken, die nach dem Branch mit einem `rb_`-Präfix benannt sind; `dev_sandbox` oben entspricht also der Datenbank `rb_dev_sandbox` auf demselben Server.

Das Erstellen eines Branches ändert **nicht**, mit welcher Datenbank Ihr Projekt kommuniziert. `rebase db branch create` erstellt die Kopie und stoppt dort; es wird nichts in `.env` geschrieben, und das nächste `rebase dev` verwendet weiterhin dieselbe Datenbank wie zuvor. Um auf einem Branch zu arbeiten, wechseln Sie mit `rebase db branch switch <name>` zu diesem, wie oben gezeigt. Um ihn von außerhalb von `rebase`-Befehlen zu erreichen, entspricht seine Verbindungszeichenfolge Ihrer bestehenden, lediglich mit ausgetauschtem Datenbanknamen:

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Einen Branch überprüfen und mergen

Auf einem Branch kann ein Agent oder eine Migration, bei der Sie sich nicht sicher sind, eine Datenbank ändern, ohne die tatsächliche Datenbank zu berühren. Bevor irgendetwas davon die Datenbank erreicht, aus der der Branch erstellt wurde, können Sie in [Studio](/docs/studio/) sehen, was geändert wurde, und es mergen: Öffnen Sie **Branches** und wählen Sie einen aus.

- **Schema & RLS policies** listet jede Tabelle, Spalte, jeden Primärschlüssel, Constraint (Unique, Foreign Key, Check, Exclusion), Index, Trigger, jede Policy, jeden Enum-Typ (mit Labels), View und jede Funktion auf, die der Branch hinzugefügt, gelöscht oder geändert hat – als SQL, wobei die Definition des übergeordneten Elements neben der des Branches dargestellt wird.
- **Data changes** zählt pro Tabelle die Zeilen, die der Branch eingefügt, aktualisiert und gelöscht hat (abgeglichen über den Primärschlüssel), und zeigt bis zu 100 davon pro Tabelle (maximal 1.000 bei expliziter Anforderung) zusammen mit den geänderten Spalten an. Eine Spalte, deren Name auf Zugangsdaten hindeutet – `password_hash`, ein `*_token`, alles mit `secret` im Namen, ein `*_hash` –, zeigt `[redacted]` anstelle des tatsächlichen Werts.

Das Überprüfen eines Branches erfordert den Scope `database:write`, der SQL als Datenbankeigentümer ausführt: Die Stichproben sind Zeilen beider Datenbanken, die außerhalb der Row-Level Security gelesen werden. `database:read` listet Branches auf, liest jedoch nicht deren Zeilen.

Derselbe Diff ist über `rebase db branch diff <name>` im Terminal, `GET /api/admin/branches/<name>/diff` über HTTP, das MCP-Tool `rebase_db_branch_diff` sowie `admin.diffBranch(name)` im Code abrufbar. Rebase-eigene Tabellen (Sessions, History, die Branch-Registry) werden dabei ausgelassen.

### Welche Seite eine Zeile geändert hat

Die übergeordnete Datenbank nimmt weiterhin Schreibvorgänge entgegen, während auf dem Branch gearbeitet wird. Daher bedeutet „die beiden Datenbanken weichen voneinander ab“ nicht automatisch „der Branch hat es geändert“: Eine Zeile, die die übergeordnete Datenbank nach dem Erstellen des Branches eingefügt hat, sieht genauso aus wie eine Zeile, die der Branch gelöscht hat. Rebase unterscheidet sie anhand des Zeitpunkts, an dem jede Zeile geschrieben wurde. Transaktions-IDs gehören zum Server, nicht zu einer einzelnen Datenbank, und die Template-Kopie behält diese bei. Daher ist eine Zeile, die nach der Erstellung des Branches geschrieben wurde – auf beiden Seiten –, jünger als die Transaktion, die die Branch-Datenbank erstellt hat. Diese Transaktion wird beim Erstellen des Branches ausgelesen und in dessen Datensatz gespeichert, sodass ein späteres `GRANT` oder `ALTER DATABASE` auf der Branch-Datenbank diesen Zeitpunkt nicht verschiebt.

| Zeile des Branches | Zeile der übergeordneten DB | Gewertet als |
| --- | --- | --- |
| seit dem Fork geschrieben | nicht vorhanden | vom Branch eingefügt |
| nicht vorhanden | von vor dem Fork | vom Branch gelöscht |
| seit dem Fork geschrieben | von vor dem Fork | vom Branch aktualisiert |
| von vor dem Fork oder nicht vorhanden | seit dem Fork geschrieben oder nicht vorhanden | Änderung der übergeordneten DB: beibehalten |
| seit dem Fork geschrieben | seit dem Fork geschrieben | ein **Konflikt** |

Zwei Fälle sehen ähnlich aus und werden so interpretiert, dass nichts verloren geht: Eine Zeile, die der Branch gelöscht und die übergeordnete Datenbank danach geändert hat, wird beibehalten; eine Zeile, die die übergeordnete Datenbank gelöscht und der Branch danach geändert hat, gilt als Insert des Branches. Ein `UPDATE`, das dieselben Werte schreibt, die eine Zeile bereits hatte, zählt dennoch als Schreibvorgang.

Ein Branch, der erstellt wurde, bevor Rebase diese Transaktion aufzeichnete, liest sie aus der aktuellen `pg_database`-Zeile der Branch-Datenbank aus; jede Operation, die die Zeile seither neu geschrieben hat, verschiebt sie. Wenn der Fork-Zeitpunkt überhaupt nicht ausgelesen werden kann – etwa bei einem langlebigen Branch, dessen Zeile durch ein Vacuum eingefroren wurde –, weist der Diff darauf hin und wertet jeden Unterschied als Änderung des Branches.

### Was ein Merge bewirkt

**Merge** schreibt die Zeilen, die der Branch eingefügt, aktualisiert und gelöscht hat, in die übergeordnete Datenbank. Was Vorrang hat:

- **Zeilen, die nur der Branch geändert hat**, werden geschrieben: eingefügt, überschrieben oder gelöscht.
- **Zeilen, die nur die übergeordnete Datenbank geändert hat**, seit der Branch erstellt wurde, bleiben exakt so, wie sie sind – es sei denn, eine Zeile verweist auf eine Zeile, die der Branch gelöscht hat, was einen Konflikt darstellt (siehe unten).
- **Zeilen, die von beiden Seiten geändert wurden**, sind Konflikte. Standardmäßig schreibt der Merge überhaupt nichts; wählen Sie `onConflict: "branch"`, um die Zeile des Branches über die der übergeordneten Datenbank zu schreiben, oder `"target"`, um die der übergeordneten Datenbank beizubehalten.
- **Eine Zeile, die der Branch gelöscht hat, auf die neuere Zeilen der übergeordneten Datenbank jedoch noch verweisen**, ist ebenfalls ein Konflikt. Angenommen, der Branch hat einen Autor gelöscht, und die übergeordnete Datenbank hat inzwischen einen Beitrag von ihm gespeichert: Das Löschen des Autors auf der übergeordneten Datenbank würde kaskadierend diesen Beitrag löschen, dessen Spalte auf NULL setzen oder am Foreign Key fehlschlagen. Der Diff wertet den Autor als Konflikt und benennt die verweisenden Zeilen (`referencedBy`: die Tabelle, der Fremdschlüssel, sein `ON DELETE` und wie viele Zeilen). Standardmäßig verweigert der Merge die Ausführung, nennt die Tabelle, die Zeilen und den Ausweg; `"target"` behält den Autor und damit den Beitrag; `"branch"` löscht den Autor, lässt den Fremdschlüssel wie definiert greifen und führt die betroffenen Elemente in `warnings` auf.
- **Schema- und Policy-Änderungen werden niemals gemergt.** Sie gehören zu Ihren Tabellendefinitionen und deren Migrationen: Wenden Sie sie mit `rebase db push` (oder `migrate`) an und mergen Sie anschließend die Zeilen.

Eine Tabelle, deren Zeilen nicht abgeglichen werden können, blockiert den Merge: eine Tabelle, die der Branch hinzugefügt oder gelöscht hat, eine, deren Spalten oder Primärschlüssel sich zwischen beiden unterscheiden, eine ohne Primärschlüssel oder eine mit mehr als 100.000 Zeilen auf einer Seite. Ihre Zähler stehen auf 0, da nicht bekannt ist, welche Zeilen geändert wurden; `rowCounts` gibt die Zeilenanzahl jeder Seite an. Eine solche Tabelle, die nur die übergeordnete Datenbank geändert hat – der Branch hat keine ihrer Zeilen geschrieben, und die Zeilen von vor dem Fork sind identisch –, wird nicht blockiert. Übergeben Sie `skipBlocked` (aktivieren Sie in Studio **Merge the other tables**), um die restlichen Tabellen zu mergen und diese unberührt zu lassen.

Eine Tabelle, die seit der Erstellung des Branches neu geschrieben wurde, wird ebenfalls blockiert (`TABLE_REWRITTEN`). Eine Änderung des Spaltentyps, ein `ADD COLUMN` mit flüchtigem Default-Wert, `VACUUM FULL` oder `CLUSTER` schreibt jede Zeile neu, sodass jede Zeile als seither geschrieben gilt und nicht mehr ermittelt werden kann, welche Seite was geändert hat. Wenn der Branch den Typ einer Spalte geändert hat, mergen Sie dessen Zeilen, bevor Sie diese Änderung auf die übergeordnete Datenbank anwenden, oder erstellen Sie den Branch danach neu.

Jeder Schreibvorgang erfolgt in einem einzigen Statement auf der übergeordneten Datenbank – alles oder nichts, Fremdschlüssel werden am Ende überprüft. Ein Merge trägt den `fingerprint` des von Ihnen überprüften Diffs und schreibt nichts, wenn sich eine der beiden Datenbanken seither geändert hat: Laden Sie den Diff neu und prüfen Sie ihn erneut. Sequences werden über alle IDs hinaus weitergesetzt, die durch den Merge eingefügt wurden.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

Mergen ist bewusst kein MCP-Tool: Ein Agent schlägt Änderungen auf seinem Branch vor, und ein Mensch führt den Merge durch.

---

## Branching erfordert einen echten PostgreSQL-Server

Branching funktioniert **nicht** mit der verwalteten Entwicklungsdatenbank – der konfigurationsfreien PGlite-Datenbank, die `rebase dev` startet, wenn ein Projekt keine `DATABASE_URL` besitzt.

PGlite stellt genau eine Datenbank bereit. Ein darauf ausgeführtes `CREATE DATABASE ... TEMPLATE` schreibt einen Katalogeintrag und kopiert nichts, sodass der „Branch“ zu der Datenbank aufgelöst wird, von der er geklont wurde: Schreibvorgänge, von denen Sie annehmen, dass sie isoliert sind, landen in Ihrer Entwicklungsdatenbank, und es gibt keine zweite Kopie, zu der Sie zurückkehren könnten.

Verwenden Sie Branching mit einem echten Server – Ihrem eigenen PostgreSQL über `DATABASE_URL` oder `rebase dev --docker`, woran sich die Branch-Befehle anschließend orientieren.

---

## Best Practices und Einschränkungen

### Speicherplatzbedarf
Da PostgreSQL die Dateien auf der Festplatte dupliziert, belegt jeder Branch so viel Speicherplatz wie die Quelldatenbank. Wenn Sie eine 100-GB-Produktionsdatenbank haben, verbraucht das Erstellen von 5 Branches zusätzliche 500 GB Speicherplatz. 
* *Empfehlung*: Verwenden Sie Subsets von Datenbanken oder schlanke Dev-Templates als Klonquellen anstelle vollständiger Produktionsklone.

Mit `rebase db branch prune` geben Sie den Speicherplatz wieder frei:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nichts läuft automatisch ab, es sei denn, Sie fordern es an: Ein Branch kann die einzige Kopie der Arbeit eines ganzen Nachmittags sein. Daher ist `--older-than` ein Opt-in, Altersangaben werden abgerundet, und der Befehl zeigt seinen Ausführungsplan an und fragt nach, bevor etwas entfernt wird – es sei denn, Sie übergeben `--yes`.

Prune erkennt auch die beiden Fälle, in denen Branches von ihren Metadaten abweichen: ein Eintrag, dessen Datenbank mit einfachem SQL gelöscht wurde (was `list` sonst dauerhaft melden würde), und eine Branch-Datenbank, deren Eintrag nie geschrieben wurde (ein Absturz zwischen den beiden Statements, die `create` ausführt). Die Scratch-Datenbanken `<db>_dev_diff` von Atlas werden ebenfalls gemeldet, jedoch nur mit `--include-dev-diff` entfernt: Sie sind keine Branches, und eine davon könnte zu einem gerade laufenden `db push` gehören.

### pgBouncer-Kompatibilität
Stellen Sie beim Einsatz hinter pgBouncer oder Verbindungspoolern sicher, dass der Pooler administrative Datenbankoperationen unterstützt. Das Erstellen und Löschen von Datenbanken umgeht Standard-Pools auf Transaktionsebene und erfordert direkte Verbindungen zum Postgres-Server (unter Verwendung erweiterter Benutzerrechte) über die Konfiguration `adminConnectionString`.

### Datenbankübergreifende Abfragen (Cross-Database Queries)
Da Branches separate PostgreSQL-Datenbanken sind, können Sie keine SQL-`JOIN`-Statements über Branch-Grenzen hinweg ausführen. Alle Relationen müssen innerhalb des Gültigkeitsbereichs der einzelnen aktiven Branch-Datenbank liegen.


## Verwandte Themen

- [Database Commands](/docs/cli/database/#rebase-db-branch) – `rebase db branch` und seine Flags
- [Schema Generation](/docs/cli/schema/) – wie das Schema erzeugt wird, das ein Branch kopiert
- [Environment & Configuration](/docs/getting-started/configuration/) – `DATABASE_URL` und was ein umgeschalteter Branch überstimmt
