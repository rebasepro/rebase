---
slug: docs/changelog
title: Changelog
---
# Changelog

## [0.1.2] - 2026-05-15

### Verbesserungen

- **Abhängigkeit von `lodash` entfernt** — `lodash/cloneDeep` wurde durch ein benutzerdefiniertes `deepClone`-Hilfsprogramm in `@rebasepro/utils` ersetzt. Dies eliminiert die externe Abhängigkeit und behebt das Problem, dass `npx create-rebase-app` aufgrund von fehlendem `lodash` zur Laufzeit fehlschlägt.
- **Neues `deepClone`-Hilfsprogramm** — Eine leichtgewichtige Deep-Clone-Funktion, die Funktionsreferenzen und Klasseninstanzen (Date, GeoPoint usw.) beibehält und speziell für Rebase-Sammlungsobjekte entwickelt wurde.

### CI & Tooling

- **Automatisierte Release-Pipeline** — Neuer GitHub Actions-Workflow (`Publish Stable Release`), der das Hochstufen der Version, das Veröffentlichen auf npm und das Erstellen des GitHub-Releases mit einem einzigen Klick im Actions-Tab abwickelt.
- **Lokales Release-Skript** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` für das Veröffentlichen über die Befehlszeile mit derselben Pipeline.
- **Canary-Releases** — Jeder Push auf `main` veröffentlicht eine Canary-Version auf npm (`@canary` Dist-Tag).

### Fehlerbehebungen

- Navigations-Utility-Tests korrigiert, um die korrekte Aufrufsignatur mit dem optionalen Parameter `undefined` sicherzustellen.
- Paketbeschreibungen aktualisiert, um die Postgres-basierte Architektur widerzuspiegeln.

---

## [0.1.0] - 2025-05-14

🎉 **Erstes öffentliches Release von Rebase** — ein Open-Source-Headless-CMS und Admin-Panel für Postgres.

### Highlights

- **Vollständiges Admin-Panel** — Tabellenkalkulations-, Karten-, Listen- und Tabellenansichten zur Verwaltung Ihrer Daten mit Inline-Bearbeitung, Filterung, Sortierung und Suche.
- **PostgreSQL-Backend** — Erstklassige Postgres-Unterstützung mit Drizzle ORM, Schema-Introspektion und automatischen Migrationen.
- **Authentifizierung** — Integrierte Authentifizierung mit E-Mail/Passwort, Google OAuth und anonymem Login. Rollenbasierte Zugriffskontrolle mit anpassbaren Berechtigungen.
- **Speicher** — S3-kompatibler Dateispeicher mit Bildgrößenänderung, Drag-and-Drop-Uploads und Metadatenverwaltung.
- **Studio** — SQL-Editor, RLS-Richtlinieneditor, Schema-Visualisierer, JS/TS-Editor, Cron-Jobs und API-Explorer.
- **CLI** — `npx create-rebase-app` zum Erstellen eines neuen Projekts in Sekundenschnelle. Unterstützt sowohl npm als auch pnpm.
- **SDK-Generator** — Automatische Generierung vollständig typisierter TypeScript-SDKs aus Ihren Sammlungsdefinitionen.
- **MCP-Server** — Model Context Protocol-Server für KI-gestütztes Datenbankmanagement.
- **Plugins** — Plugins für Datenoptimierung und -analysen zur Erweiterung der Admin-Erfahrung.
- **UI-Komponentenbibliothek** — Ein umfassender Satz barrierefreier, anpassbarer React-Komponenten, die auf Radix-Primitiven basieren.
- **Firebase-Unterstützung** — Optionale Firebase/Firestore-Datenquellen- und Authentifizierungsadapter.
- **MongoDB-Unterstützung** — Optionaler MongoDB-Datenquellenadapter.

### Pakete

| Paket | Beschreibung |
|---|---|
| `@rebasepro/types` | Core-TypeScript-Typdefinitionen |
| `@rebasepro/utils` | Gemeinsame Hilfsfunktionen |
| `@rebasepro/common` | Gemeinsame Module, die paketübergreifend geteilt werden |
| `@rebasepro/formex` | Leichtgewichtige Bibliothek zur Formularverwaltung |
| `@rebasepro/ui` | React-Komponentenbibliothek |
| `@rebasepro/core` | Core-CMS-Logik und Controller |
| `@rebasepro/client` | Clientseitige Datenzugriffsschicht |
| `@rebasepro/client-postgresql` | PostgreSQL-Client-Adapter |
| `@rebasepro/client-firebase` | Firebase/Firestore-Client-Adapter |
| `@rebasepro/server-core` | Server-Framework und Middleware |
| `@rebasepro/server-postgresql` | PostgreSQL-Server-Adapter mit Drizzle |
| `@rebasepro/server-mongodb` | MongoDB-Server-Adapter |
| `@rebasepro/auth` | Authentifizierungs-Controller und -Ansichten |
| `@rebasepro/admin` | Vollständige Admin-Panel-Benutzeroberfläche |
| `@rebasepro/studio` | SQL-Editor, Schema-Tools und Entwickler-Dienstprogramme |
| `@rebasepro/cli` | CLI für Scaffolding und Projektverwaltung |
| `@rebasepro/sdk-generator` | TypeScript-SDK-Codegenerierung |
| `@rebasepro/mcp-server` | MCP-Server für KI-Integrationen |
| `@rebasepro/schema-inference` | Datenbank-Schema-Introspektion und -Inferenz |
| `@rebasepro/plugin-data-enhancement` | KI-gestütztes Datenoptimierungs-Plugin |
| `@rebasepro/plugin-insights` | Analyse- und Insights-Plugin |
