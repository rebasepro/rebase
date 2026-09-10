---
sourceHash: bba1fa1dd7f34bed
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
    name         TEXT PRIMARY KEY,              -- Sanitize user branch name (alphanumeric & underscores)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

---

## Programmatische API

Die Branching-API wird über den `BranchService` des Backends bereitgestellt. Nachfolgend finden Sie eine Referenz der Kernschnittstelle:

### Einen Datenbank-Branch erstellen

Erzeugt eine neue Branch-Datenbank aus der Standarddatenbank oder einem expliziten Quell-Template.

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
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

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
> Schutzmechanismus: Die Hauptdatenbank (der in den Verbindungszeichenfolgen konfigurierte Standarddatenbankname) ist geschützt. Wenn Sie versuchen, die übergeordnete Datenbank zu löschen, wirft der `BranchService` den Fehler `"Cannot delete the main database"` und bricht ab.

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

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` macht einen Branch erst nutzbar. Es hinterlegt den Branch in `.rebase/branch.json` – nur den Namen, niemals einen Connection-String, sodass Ihre Anmeldedaten ausschließlich in `.env` verbleiben – und jeder nachfolgende `rebase`-Befehl in diesem Checkout verwendet stattdessen die Datenbank des Branches: `dev`, `db push`, `db migrate`, `db backup`.

In der Auflösungsreihenfolge steht es zwischen der Shell und der Projektdatei:

1. `--database-url` in der Befehlszeile
2. `DATABASE_URL` in der Shell-Umgebung
3. **der Branch, zu dem dieses Checkout gewechselt hat**
4. `DATABASE_URL` in der `.env`-Datei des Projekts

Ein Branch muss Vorrang vor `.env` haben, da das Umschalten sonst bei keinem Projekt Wirkung zeigen würde, das `DATABASE_URL` setzt; er darf jedoch keinen Vorrang vor den beiden darüber liegenden haben, da ein Flag auf der aktuellen Befehlszeile eine unmittelbarere Anweisung ist als ein Wechsel am Vortag.

`.rebase/` wird von Git ignoriert (gitignored), sodass der Branch, auf dem Sie sich befinden, nur für Ihren Rechner gilt und niemals für das gesamte Projekt.

Branches sind ganz gewöhnliche PostgreSQL-Datenbanken, die nach dem Branch mit dem Präfix `rb_` benannt sind. So entspricht `dev_sandbox` oben der Datenbank `rb_dev_sandbox` auf demselben Server.

Das Erstellen eines Branches ändert **nicht**, mit welcher Datenbank Ihr Projekt kommuniziert. `rebase db branch create` erstellt die Kopie und belässt es dabei; es wird nichts in `.env` geschrieben, und das nächste `rebase dev` verwendet weiterhin die zuvor genutzte Datenbank. Um mit einem Branch zu arbeiten, verweisen Sie selbst per `DATABASE_URL` darauf – der Connection-String entspricht dem vorhandenen, lediglich der Datenbankname wird ausgetauscht:

```bash
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Branching erfordert einen echten PostgreSQL-Server

Branching funktioniert **nicht** mit der verwalteten Entwicklungsdatenbank – der konfigurationsfreien PGlite-Datenbank, die `rebase dev` startet, wenn ein Projekt keine `DATABASE_URL` hat.

PGlite bedient genau eine Datenbank. Ein `CREATE DATABASE ... TEMPLATE` darauf schreibt lediglich einen Katalogeintrag und kopiert nichts, sodass der „Branch“ auf dieselbe Datenbank verweist, von der er geklont wurde: Schreibvorgänge, von denen Sie glauben, dass sie isoliert sind, landen in Ihrer Entwicklungsdatenbank, und es gibt keine zweite Kopie, zu der Sie zurückkehren könnten.

Verwenden Sie Branching mit einem echten Server – Ihrer eigenen PostgreSQL-Instanz über `DATABASE_URL` oder `rebase dev --docker`.

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

- [CLI-Befehle](/docs/cli/) — `rebase db branch` und dessen Flags
- [Schema-Generierung](/docs/cli/schema/) — wie das Schema erzeugt wird, das ein Branch kopiert
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) — `DATABASE_URL` und worüber ein aktiv geschalteter Branch Vorrang hat

---
