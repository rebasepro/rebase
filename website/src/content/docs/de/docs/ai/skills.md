---
sourceHash: 62b7632c6d62c832
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install schreibt 24 Rebase-Referenz-Skills in Ihr Repository, genau in dem Layout, das Ihr KI-Assistent erwartet – Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity.
---

Ein KI-Assistent, der die Dokumentation von Rebase gelesen hat, schreibt besseren Rebase-Code als einer, der anhand der API-Struktur rät. `rebase skills install` kopiert 24 Markdown-Skill-Dateien in Ihr Repository – genau in dem Layout, das Ihr Assistent erwartet:

```bash
rebase skills install
```

Die Skills sind **Referenzmaterial, keine Werkzeuge**. Sie erklären einem Assistenten, wie Tabellen deklariert werden, warum Migrationen zweistufig sind und welche Fehler das Framework nicht für ihn abfängt. Für Werkzeuge, die auf Ihre Daten zugreifen, siehe den [MCP-Server](/docs/ai/mcp).

## Über MCP, ohne lokale Installation

Dieselben Skills erreichen Claude über MCP. Sowohl der [Rebase-Connector](/docs/ai/rebase-connector/#skills) als auch der [lokale MCP-Server](/docs/ai/mcp/#skills) stellen alle 24 bereit, und ein Client mit Protokollrevision 2026-07-28 oder neuer lädt einen Skill bei Bedarf. Claude Code benennt sie als `<server>:rebase-tables` und so weiter. Die Installation im Repository, wie unten beschrieben, stellt jedoch weiterhin sicher, dass sie jeden Assistenten erreichen – fixiert auf das Release, das das Projekt verwendet.

Ihre eigene Anwendung kann ebenfalls Skills für deren Nutzer bereitstellen: siehe [den Remote-MCP-Endpunkt](/docs/ai/remote-mcp/#skills).

## Einrichtung durch `rebase init`

Ein neues Projekt benötigt diesen Befehl nicht. `rebase init` fragt, ob Ihre KI-Coding-Agents eingerichtet werden sollen, und listet dann diejenigen auf, die auf dem Rechner gefunden werden:

```text
? Set up Rebase skills and the Rebase MCP server for your AI coding agent(s)? Yes

Detecting installed AI coding agents...
  ✓ Claude Code — ~/.claude
  ✓ Gemini CLI / Antigravity — ~/.gemini
  ✗ Cursor — ~/.cursor (not found)
  ✗ Windsurf — ~/.codeium/windsurf (not found)
  ✗ Codex CLI — ~/.codex (not found)
  ✗ Kiro — ~/.kiro (not found)
  · GitHub Copilot — can't be detected; tick it below if you use it
```

Die gefundenen Agents sind vorausgewählt. Für jeden beibehaltenen Agent werden die Skills geschrieben und der [MCP-Server](/docs/ai/mcp) in der Projektkonfiguration dieses Agents registriert – alles vor dem ersten Commit des Projekts. In CI oder mit `--yes` können Sie diese explizit angeben:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Ein bestehendes Projekt

`rebase init` bricht ab, wenn ein Verzeichnis bereits ein Projekt enthält. Daher erhält ein Projekt, das vor der Einführung des Agent-Setups erstellt wurde – oder bei dem die Eingabeaufforderung abgelehnt wurde – dasselbe Setup über `rebase skills install --mcp`: die Skills und den in der Projektkonfiguration jedes Agents registrierten [MCP-Server](/docs/ai/mcp). Bereits in der Datei vorhandene Server bleiben erhalten, und ein erneutes Ausführen belässt den Rebase-Eintrag unverändert.

```bash
rebase skills install --agent cursor --mcp
```

Ohne `--mcp` schreibt der Befehl nur die Skills und nennt die Agents, in deren Konfiguration der Server noch fehlt.

## Welcher Assistent

Der Befehl akzeptiert `--agent` (oder `-a`), wiederholbar und kommagetrennt:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Es werden sieben Ziele unterstützt – eines für jede Verweisdatei, die `rebase init` schreibt:

| `--agent` | Assistent | Geschrieben nach |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.agents/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro und Copilot erhalten eine dauerhaft aktive Datei]
Diese vier laden ihr gesamtes Regelverzeichnis in jede Anfrage. Eine Regeldatei pro Skill bedeutete etwa **84.000 Zeichen** an Rebase-Referenz vor jeder gestellten Frage, egal ob es um Rebase ging oder nicht – und eine Anweisung, die ein Assistent nur überfliegt, befolgt er meist nicht.

Stattdessen erhalten sie `rebase.mdc` (oder `rebase.md`): einen ~3 KB großen Index mit `alwaysApply: true`, der auflistet, was jeder Skill abdeckt und welche Datei zu lesen ist. Die Inhalte liegen in Unterverzeichnissen pro Skill und werden bei Bedarf geladen.
:::

`gemini` deckt **sowohl** Gemini CLI als auch Antigravity ab – beide lesen dasselbe `.agents/`-Verzeichnis, daher gibt es keinen separaten `antigravity`-Wert. Codex liest es ebenfalls; die Angabe von sowohl `gemini` als auch `codex` schreibt das Verzeichnis einmalig.

Ohne `--agent` erkennt der Befehl, welche Assistenten ein Projekt bereits verwendet, indem er nach `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` und `.kiro/` sucht. Findet er keine, fordert er Sie zur Auswahl auf, wobei die auf dem Rechner installierten Assistenten bereits vorausgewählt sind.

**GitHub Copilot wird nie automatisch erkannt.** Dessen Verzeichnis wäre `.github/`, und `.github/` ist kein Beleg dafür, dass jemand Copilot nutzt: `rebase init` schreibt `.github/copilot-instructions.md` in jedes Scaffold, und die meisten Repositories besitzen ein `.github/` für Workflows. Installieren Sie es mit `--agent copilot`.

:::note[Ein frisch erstelltes Projekt fordert immer zur Eingabe auf]
`rebase init` schreibt `CLAUDE.md`, `.cursorrules` und Ähnliches, jedoch keines der *Verzeichnisse*, nach denen die Erkennung sucht. Daher fällt der erste Durchlauf in einem neuen Projekt auf die Eingabeaufforderung zurück – und in CI, wo kein TTY vorhanden ist, bricht er stattdessen mit einem Fehler ab. Übergeben Sie in nicht-interaktiven Kontexten `--agent` explizit.
:::

## Projektlokal und für Commits gedacht

Skills werden **relativ zu Ihrem Projekt-Root** geschrieben – dem nächstgelegenen übergeordneten Verzeichnis, das `rebase.json` enthält – nicht in Ihr Home-Verzeichnis und nicht in das aktuelle Arbeitsverzeichnis. Nichts wird global installiert.

Committen Sie sie. Sie sind genauso Teil des Repositories wie eine Lint-Konfiguration: Der Assistent jedes Mitwirkenden arbeitet dann auf Basis desselben Verständnisses der Codebasis – auch bei Mitwirkenden, die den Befehl nie ausgeführt haben.

## Aktualisieren der Skills

**`rebase upgrade` aktualisiert sie.** Die Skills sind Teil von `@rebasepro/cli`. Nachdem die neue Version installiert wurde, führt [`rebase upgrade`](/docs/cli/#rebase-upgrade) das `rebase skills install` der neuen CLI für jeden Assistenten aus, dessen Skill-Verzeichnis bei einer Installation erstellt wurde, wobei von Ihnen bearbeitete Dateien erhalten bleiben. Ein Projekt, das bereits auf der Version ist, wird ebenfalls aktualisiert. Eine fehlgeschlagene Aktualisierung bringt das Upgrade nie zum Scheitern. Bei `--json` gibt `skills` im Dokument Auskunft darüber, was passiert ist: `{ agents, refreshed }`, mit einem `reason`, falls dies nicht geschah (`dry_run`, `not_installed` nach `--no-install`, `no_project_cli`, wenn das Projekt `@rebasepro/cli` nicht selbst installiert, `failed`), oder `null`, wenn keine Skills installiert sind.

Wenn Sie die Versionen auf andere Weise aktualisiert haben (über einen Dependency-Bot oder manuell), führen Sie `rebase upgrade` trotzdem aus oder starten Sie die Installation selbst:

```bash
rebase skills install
```

Ohne `--agent` werden die Assistenten aktualisiert, deren Verzeichnisse das Projekt bereits enthält. Befehle enden zudem mit einem Hinweis, wenn eine neuere Rebase-Version verfügbar ist, sodass ein im Projekt arbeitender Assistent von dem Release erfährt, ohne eigens informiert werden zu müssen.

Jedes Zielverzeichnis enthält ein `.rebase-skills.json`-Manifest der vom Befehl geschriebenen Daten, sodass ein erneuter Durchlauf eine Bearbeitung von einer Kopie eines älteren Release unterscheiden kann. Committen Sie dieses zusammen mit den Skills.

- Eine Datei, die niemand bearbeitet hat, wird durch die Kopie des neuen Release ersetzt.
- Eine Datei, die Sie bearbeitet haben, bleibt erhalten und wird vom Befehl aufgelistet. `--force` ersetzt sie.
- Ein Skill, der in einem neueren Release nicht mehr enthalten ist, wird entfernt, es sei denn, Sie haben ihn bearbeitet. In diesem Fall bleibt er erhalten und wird aufgelistet.
- Dateien, die der Befehl nie geschrieben hat, werden nicht angetastet.

Projektspezifische Anweisungen gehören weiterhin in [`ai-instructions.md`](/docs/ai/instruction-files), die in Ihrer Hand liegt. Ein bearbeiteter Skill erhält keine Updates mehr, bis Sie ihn mit `--force` überschreiben.

Der Befehl funktioniert auch außerhalb eines Rebase-Projekts und greift dann auf das Arbeitsverzeichnis zurück – nützlich für ein separates Frontend-Repository, das mit einem Rebase-Backend kommuniziert.

## Die 24 Skills

| Skill | Behandelt |
|---|---|
| `rebase-basics` | Grundprinzipien, Workflow und Wartung – der Einstiegspunkt, den die anderen voraussetzen |
| `rebase-tables` | Tabellen erstellen: Spalten, Relationen, `rls`, Hooks und der CMS-Layer darüber (`customizeTable`) |
| `rebase-backend-postgres` | Das Postgres-Backend: Setup, Schemagenerierung, Migrationen, Pooling, Read-Replicas |
| `rebase-api` | Die generierte REST-API – Endpunkte, Filterung, Sortierung, Paginierung |
| `rebase-sdk` | Das generierte TypeScript-SDK: CRUD, Filterung, Suche, Auth, Realtime, Offline, Storage |
| `rebase-auth` | Authentifizierung, Rollen, RLS-Policies, MFA, API-Schlüssel, OAuth, benutzerdefinierte Adapter |
| `rebase-security` | Zugriffskontrolle, Interzeption, Fail-Closed-Design, PII-Maskierung, Mandantenisolation |
| `rebase-realtime` | Die WebSocket-Engine: Synchronisation, Broadcast-Channels, Presence, Tabellenänderungs-Broadcasts |
| `rebase-storage` | S3/GCS/lokaler Speicher, Uploads, TUS-fortsetzbare Uploads, Bildtransformationen |
| `rebase-custom-functions` | Benutzerdefinierte API-Endpunkte über dateibasierte Funktionserkennung |
| `rebase-cron-jobs` | Planung wiederkehrender Hintergrundaufgaben |
| `rebase-webhooks` | Ausgehende HTTP-Webhooks, HMAC-Signaturen, Wiederholungsversuche und Backoff |
| `rebase-email` | SMTP, Vorlagen, benutzerdefinierte Provider, das `rebase.email`-Singleton |
| `rebase-entity-history` | Entitätsversionierung, Änderungsverfolgung, Audit-Logs, Wiederherstellung |
| `rebase-admin` | Navigation im Admin-Panel, Side-Drawers, URLs, Einbetten von Collection-Panels |
| `rebase-customize-admin` | Anpassen des Admins mit React-Komponenten – Singletons, Einstellungsseiten, Bulk-Aktionen, Ansichtsmodi, benutzerdefinierte Felder, Ersetzen integrierter Teile |
| `rebase-custom-views` | Benutzerdefinierte Ansichten im Admin – `rebase generate view`, Top-Level-Views, Record-Tabs, Feld-Widgets |
| `rebase-dashboards` | KPIs, Diagramme und Dashboards – in SQL berechnete Zahlen, gerendert mit `@rebasepro/ui`, platziert in Slots oder auf einer Seite |
| `rebase-ui-components` | Die `@rebasepro/ui`-Komponentenbibliothek |
| `rebase-design-language` | Die UI-Designsprache: Tokens, Farben, Typografie, Abstände, Anti-Patterns |
| `rebase-studio` | Die Studio-Entwicklertools – SQL, RLS, Storage, Cron, Schema-Visualizer, Logs |
| `rebase-cloud` | Deployment und Betrieb auf Rebase Cloud – Projekte, Managed Databases, Umgebungsvariablen, Domains, Logs, Rollbacks |
| `rebase-deployment` | Self-Hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway und Render |
| `rebase-local-env-setup` | Ersteinrichtung: Node.js, pnpm, PostgreSQL, Docker |

Zwei davon fordern dazu auf, ungefragt gelesen zu werden. `rebase-basics` gibt an, dass es immer konsultiert werden sollte, wenn ein Assistent überhaupt mit Rebase arbeitet, und `rebase-design-language` verlangt, dass ein Agent es liest, bevor er eine visuelle Benutzeroberfläche erstellt oder modifiziert – dieser Skill existiert, weil generierte Benutzeroberflächen schneller von einem Designsystem abweichen als alles andere in einer Codebasis.

## Wie ein Durchlauf aussieht

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Skills werden über das Paket `@rebasepro/agent-skills` bereitgestellt, von dem die CLI abhängt, sodass das installierte Set stets mit Ihrer installierten CLI-Version übereinstimmt.
