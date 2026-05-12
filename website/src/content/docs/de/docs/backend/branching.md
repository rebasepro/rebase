---
title: Datenbank-Branching
sidebar_label: Branching
slug: docs/backend/branching
description: Erstellen Sie isolierte Datenbank-Branches für Entwicklung, Staging und Tests mithilfe von PostgreSQLs CREATE DATABASE ... TEMPLATE – sofortige, originalgetreue Kopien ohne Ausfallzeiten.
---

## Übersicht

Datenbank-Branching ermöglicht es Ihnen, **sofortige, isolierte Kopien** Ihrer gesamten Datenbank – Schema und Daten – für Entwicklung, Staging oder Tests zu erstellen. Jeder Branch ist eine echte PostgreSQL-Datenbank, die aus einer Vorlage erstellt wurde, also eine originalgetreue Kopie ohne Ausfallzeiten.

Dies ähnelt dem Git-Branching, jedoch für Ihre Datenbank. Erstellen Sie einen Branch, experimentieren Sie mit Migrationen oder Daten und löschen Sie ihn, wenn Sie fertig sind. Ihre Produktionsdatenbank wird niemals angetastet.

## Funktionsweise

Rebase verwendet PostgreSQLs natives `CREATE DATABASE ... TEMPLATE`, um Branches zu erstellen. Dies ist:

- **Sofortig** — PostgreSQL kopiert die Vorlage auf Dateisystemebene
- **Originalgetreu** — Schema, Daten, Indizes, Constraints, RLS-Richtlinien – alles wird kopiert
- **Isoliert** — Änderungen im Branch beeinflussen die Quelldatenbank nicht

Branch-Metadaten werden in einer Tabelle `rebase.branches` in der Hauptdatenbank gespeichert, sodass das System immer weiß, welche Branches existieren und woher sie stammen.

## API

Die Branching-API ist über die `DatabaseAdmin`-Schnittstelle des Backends verfügbar:

### Branch erstellen

```typescript
// Create a branch from the default database
await admin.createBranch("feature_auth");

// Create a branch from a specific source database
await admin.createBranch("staging", { source: "production" });
```

Dies erstellt eine neue PostgreSQL-Datenbank namens `rb_feature_auth` (präfixiert, um Kollisionen zu vermeiden) und zeichnet sie in der Metadatentabelle auf.

### Branches auflisten

```typescript
const branches = await admin.listBranches();
// [
//   {
//     name: "feature_auth",
//     parentDatabase: "rebase",
//     createdAt: "2026-04-15T10:30:00Z",
//     sizeBytes: 52428800
//   }
// ]
```

### Branch-Informationen abrufen

```typescript
const branch = await admin.getBranchInfo("feature_auth");
// { name: "feature_auth", parentDatabase: "rebase", createdAt: ..., sizeBytes: ... }
```

### Branch löschen

```typescript
await admin.deleteBranch("feature_auth");
```

Dies löscht die PostgreSQL-Datenbank und entfernt die Metadaten. Die Hauptdatenbank kann niemals gelöscht werden.

## Konfiguration

Datenbank-Branching erfordert, dass die `adminConnectionString` in Ihrem PostgreSQL-Bootstrapper konfiguriert ist, da das Erstellen und Löschen von Datenbanken erweiterte Berechtigungen benötigt:

```typescript
createPostgresBootstrapper({
    connection: db,
    schema: { tables, enums, relations },
    adminConnectionString: process.env.ADMIN_CONNECTION_STRING || databaseUrl,
    connectionString
})
```

Der `DatabasePoolManager` verwaltet automatisch das Connection Pooling für Branch-Datenbanken. Wenn Sie zu einem Branch wechseln, erstellt der Pool-Manager einen neuen Verbindungspool, der auf diese Datenbank abzielt.

## Branch-Benennung

Branch-Namen werden bereinigt, um nur alphanumerische Zeichen und Unterstriche zuzulassen. Der eigentliche PostgreSQL-Datenbankname wird mit `rb_` präfixiert, um Kollisionen zu vermeiden:

| Branch-Name | Datenbankname |
|---|---|
| `feature_auth` | `rb_feature_auth` |
| `staging` | `rb_staging` |
| `v2_migration` | `rb_v2_migration` |

## Anwendungsfälle

### Vorschau-Umgebungen

Erstellen Sie einen Branch für jeden Pull Request oder jede Vorschau-Bereitstellung. Der Branch erhält eine vollständige Kopie der Produktionsdaten, sodass Prüfer mit realen Daten testen können.

### Migrationstests

Bevor Sie eine Migration in der Produktion ausführen, erstellen Sie einen Branch und führen Sie die Migration zuerst dort aus. Wenn etwas schiefgeht, löschen Sie einfach den Branch.

### Datenexperimente

Müssen Sie eine Datentransformation testen? Erstellen Sie einen Branch, führen Sie Ihr Skript aus und überprüfen Sie die Ergebnisse, ohne die Produktion zu beeinträchtigen.

## Einschränkungen

- **Aktive Verbindungen** — PostgreSQL erfordert, dass alle Verbindungen zur Quelldatenbank geschlossen werden, bevor eine Vorlage erstellt wird. Der Branch-Dienst trennt automatisch inaktive Pools, aber andere Clients (z.B. pgAdmin) müssen manuell getrennt werden.
- **Festplattenspeicher** — jeder Branch ist eine vollständige Kopie der Datenbank. Überwachen Sie die Festplattennutzung beim Erstellen vieler Branches.
- **Datenbankübergreifende Abfragen** — Branches sind separate PostgreSQL-Datenbanken. Sie können keine JOINs zwischen einem Branch und der Hauptdatenbank durchführen.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
- **[CLI](/docs/cli)** — Branches über die Befehlszeile verwalten
- **[Entitätshistorie](/docs/backend/history)** — Änderungen innerhalb eines Branches verfolgen
---
