---
sourceHash: df522ef7c8309826
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install schreibt 24 Rebase-Referenz-Skills in Ihr Repository, genau in dem Layout, das Ihr KI-Assistent erwartet – Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity.
---

Ein KI-Assistent, der die Dokumentation von Rebase gelesen hat, schreibt besseren Rebase-Code als ein Assistent, der anhand der Struktur der API nur raten muss. `rebase skills install` kopiert 24 Markdown-Skill-Dateien in Ihr Repository, genau in dem Layout, das Ihr Assistent erwartet:

```bash
rebase skills install
```

Die Skills sind **Referenzmaterial, keine Werkzeuge**. Sie erklären einem Assistenten, wie Tabellen deklariert werden, warum Migrationen aus zwei Schritten bestehen und welche Fehler das Framework nicht für ihn abfängt. Informationen zu Werkzeugen, die auf Ihre Daten zugreifen, finden Sie unter [MCP server](/docs/ai/mcp).

## Einrichtung durch `rebase init`

Ein neues Projekt benötigt diesen Befehl nicht. `rebase init` fragt ab, ob Ihre KI-Coding-Agenten eingerichtet werden sollen, und listet diejenigen auf, die auf dem System gefunden werden:

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

Gefundene Agenten sind vorausgewählt. Für jeden beibehaltenen Agenten werden die Skills geschrieben und der [MCP-Server](/docs/ai/mcp) in der Projektkonfiguration dieses Agenten registriert – noch vor dem ersten Commit des Projekts. In CI-Umgebungen oder mit `--yes` können Sie diese explizit angeben:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Ein bestehendes Projekt

`rebase init` verweigert die Ausführung in einem Verzeichnis, das bereits ein Projekt enthält. Ein Projekt, das vor der Einführung des Agent-Setups erstellt wurde – oder bei dem die Abfrage abgelehnt wurde –, erhält dasselbe Setup über `rebase skills install --mcp`: die Skills sowie die Registrierung des [MCP-Servers](/docs/ai/mcp) in der Projektkonfiguration des jeweiligen Agenten. Bereits in der Datei vorhandene Server bleiben erhalten, und eine erneute Ausführung belässt den Rebase-Eintrag unverändert.

```bash
rebase skills install --agent cursor --mcp
```

Ohne `--mcp` schreibt der Befehl nur die Skills und nennt die Agenten, in deren Konfiguration der Server noch nicht enthalten ist.

## Welcher Assistent

Der Befehl akzeptiert `--agent` (oder `-a`), wiederholbar und kommagetrennt:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Es werden sieben Zielumgebungen unterstützt – eine für jede Pointer-Datei, die `rebase init` schreibt:

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
Diese vier laden ihr gesamtes Regelverzeichnis bei jeder Anfrage. Eine Regeldatei pro Skill bedeutete etwa **84.000 Zeichen** an Rebase-Referenztext vor jeder gestellten Frage, unabhängig davon, ob es um Rebase ging oder nicht – und eine Anweisung, die ein Assistent nur überfliegt, wird von ihm nicht befolgt.

Stattdessen erhalten sie `rebase.mdc` (oder `rebase.md`): einen ~3 KB großen Index mit `alwaysApply: true`, der auflistet, was jeder Skill abdeckt und welche Datei zu lesen ist. Die eigentlichen Inhalte liegen in Skill-spezifischen Unterverzeichnissen und werden bei Bedarf geöffnet.
:::

`gemini` deckt **sowohl** die Gemini CLI als auch Antigravity ab – beide lesen dasselbe `.agents/`-Verzeichnis, daher gibt es keinen separaten `antigravity`-Wert. Codex liest es ebenfalls; werden sowohl `gemini` als auch `codex` angegeben, wird das Verzeichnis einmalig geschrieben.

Ohne `--agent` erkennt der Befehl, welche Assistenten ein Projekt bereits verwendet, indem er nach `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` und `.kiro/` sucht. Wird keines davon gefunden, fordert er zur Auswahl auf, wobei die auf dem System installierten Assistenten bereits vorausgewählt sind.

**GitHub Copilot wird niemals automatisch erkannt.** Dessen Verzeichnis wäre `.github/`, und `.github/` ist kein Beleg dafür, dass Copilot genutzt wird: `rebase init` schreibt `.github/copilot-instructions.md` in jedes Scaffold, und die meisten Repositories besitzen ein `.github/` für Workflows. Installieren Sie es mit `--agent copilot`.

:::note[Ein neu erstelltes Projekt fordert immer zur Auswahl auf]
`rebase init` schreibt `CLAUDE.md`, `.cursorrules` und ähnliches, aber keines der *Verzeichnisse*, nach denen die Erkennung sucht. Daher fällt der erste Durchlauf in einem neuen Projekt auf die interaktive Eingabeaufforderung zurück – und in CI-Umgebungen ohne TTY bricht er stattdessen mit einem Fehler ab. Übergeben Sie `--agent` in nicht-interaktiven Kontexten immer explizit.
:::

## Projektlokal und zum Committen gedacht

Skills werden **relativ zu Ihrem Projektstammverzeichnis** geschrieben – dem nächstgelegenen übergeordneten Verzeichnis, das `rebase.json` enthält – nicht in Ihr Home-Verzeichnis und nicht in das aktuelle Arbeitsverzeichnis. Es wird nichts global installiert.

Committen Sie diese. Sie gehören zum Repository genauso wie eine Linter-Konfiguration: Der Assistent jedes Mitwirkenden arbeitet dann auf Basis desselben Verständnisses der Codebasis – auch bei Mitwirkenden, die den Befehl nie ausgeführt haben.

## Aktualisieren der Skills

**`rebase upgrade` aktualisiert sie.** Die Skills werden zusammen mit `@rebasepro/cli` ausgeliefert. Nachdem das neue Release installiert wurde, führt [`rebase upgrade`](/docs/cli/#rebase-upgrade) das `rebase skills install` der neuen CLI für jeden Assistenten aus, dessen Skill-Verzeichnis durch eine Installation angelegt wurde, wobei manuell bearbeitete Dateien beibehalten werden. Ein Projekt, das sich bereits auf dem Release befindet, wird ebenfalls aktualisiert. Eine Aktualisierung, die fehlschlägt, lässt das Upgrade niemals scheitern. Unter `--json` gibt das Feld `skills` im Dokument Auskunft darüber, was passiert ist: `{ agents, refreshed }`, mit einem `reason`, falls keine Aktualisierung erfolgte (`dry_run`, `not_installed` nach `--no-install`, `no_project_cli`, wenn das Projekt `@rebasepro/cli` nicht selbst installiert, `failed`), oder `null`, falls keine Skills installiert sind.

Wenn Sie die Versionen anderweitig angepasst haben (über einen Dependency-Bot, eine manuelle Bearbeitung), führen Sie dennoch `rebase upgrade` oder die Installation selbst aus:

```bash
rebase skills install
```

Ohne `--agent` werden die Assistenten aktualisiert, deren Verzeichnisse im Projekt bereits vorhanden sind. Befehle enden zudem mit einer Zeile, wenn eine neuere Rebase-Version verfügbar ist, sodass ein im Projekt arbeitender Assistent von dem Release erfährt, ohne eigens darauf hingewiesen zu werden.

Jedes Zielverzeichnis enthält ein `.rebase-skills.json`-Manifest der geschriebenen Dateien, sodass ein erneuter Durchlauf Änderungen von der Version eines älteren Releases unterscheiden kann. Committen Sie dieses zusammen mit den Skills.

- Eine Datei, die niemand bearbeitet hat, wird durch die Kopie des neuen Releases ersetzt.
- Eine von Ihnen bearbeitete Datei wird beibehalten und vom Befehl aufgelistet. `--force` ersetzt sie.
- Ein Skill, der in einem neueren Release nicht mehr enthalten ist, wird entfernt, es sei denn, Sie haben ihn bearbeitet. In diesem Fall wird er beibehalten und aufgelistet.
- Dateien, die der Befehl nie geschrieben hat, werden nicht angetastet.

Projektspezifische Anweisungen gehören weiterhin in die Datei [`ai-instructions.md`](/docs/ai/instruction-files), die in Ihrer Hand liegt. Ein bearbeiteter Skill erhält keine Aktualisierungen mehr, es sei denn, Sie erzwingen dies mit `--force`.

Der Befehl funktioniert auch außerhalb eines Rebase-Projekts und weicht dabei auf das aktuelle Arbeitsverzeichnis aus – nützlich für ein separates Frontend-Repository, das mit einem Rebase-Backend kommuniziert.

## Die 24 Skills

| Skill | Inhalt |
|---|---|
| `rebase-basics` | Grundlegende Prinzipien, Workflow und Wartung – der Einstiegspunkt, den die anderen voraussetzen |
| `rebase-tables` | Erstellen von Tabellen: Spalten, Relationen, `rls`, Hooks und die darüberliegende CMS-Ebene (`customizeTable`) |
| `rebase-backend-postgres` | Das Postgres-Backend: Setup, Schemagenerierung, Migrationen, Connection-Pooling, Read Replicas |
| `rebase-api` | Die generierte REST-API – Endpunkte, Filterung, Sortierung, Paginierung |
| `rebase-sdk` | Das generierte TypeScript-SDK: CRUD, Filterung, Suche, Authentifizierung, Realtime, Offline, Storage |
| `rebase-auth` | Authentifizierung, Rollen, RLS-Policies, MFA, API-Keys, OAuth, benutzerdefinierte Adapter |
| `rebase-security` | Zugriffskontrolle, Interception, Fail-Closed-Design, Maskierung personenbezogener Daten (PII), Mandantenisolierung |
| `rebase-realtime` | Die WebSocket-Engine: Synchronisierung, Broadcast-Channels, Presence, Übertragung von Tabellenänderungen |
| `rebase-storage` | S3/GCS/lokaler Speicher, Uploads, fortsetzbare TUS-Uploads, Bildtransformationen |
| `rebase-custom-functions` | Benutzerdefinierte API-Endpunkte über dateibasierte Funktionserkennung |
| `rebase-cron-jobs` | Zeitplanung wiederkehrender Hintergrundaufgaben |
| `rebase-webhooks` | Ausgehende HTTP-Webhooks, HMAC-Signaturen, Wiederholungsversuche und Backoff |
| `rebase-email` | SMTP, Templates, benutzerdefinierte Provider, das `rebase.email`-Singleton |
| `rebase-entity-history` | Versionsverwaltung von Entitäten, Änderungshistorie, Audit-Logs, Revertieren |
| `rebase-admin` | Navigation im Admin-Panel, Side-Drawers, URLs, Einbetten von Collection-Panels |
| `rebase-customize-admin` | Anpassen des Admin-Bereichs mit React-Komponenten – Singletons, Einstellungsseiten, Bulk-Aktionen, Ansichtsmodi, benutzerdefinierte Felder, Ersetzen integrierter Komponenten |
| `rebase-custom-views` | Benutzerdefinierte Ansichten im Admin-Bereich – `rebase generate view`, Top-Level-Views, Datensatz-Tabs, Feld-Widgets |
| `rebase-dashboards` | KPIs, Diagramme und Dashboards – in SQL berechnete Kennzahlen, gerendert mit `@rebasepro/ui`, platziert in Slots oder auf einer Seite |
| `rebase-ui-components` | Die Komponentenbibliothek `@rebasepro/ui` |
| `rebase-design-language` | Die UI-Designsprache: Tokens, Farben, Typografie, Abstände, Anti-Patterns |
| `rebase-studio` | Die Entwickler-Tools-Ebene von Studio – SQL, RLS, Storage, Cron, Schema-Visualizer, Logs |
| `rebase-cloud` | Bereitstellung und Betrieb auf Rebase Cloud – Projekte, Managed Databases, Umgebungsvariablen, Domains, Logs, Rollbacks |
| `rebase-deployment` | Self-Hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway und Render |
| `rebase-local-env-setup` | Ersteinrichtung: Node.js, pnpm, PostgreSQL, Docker |

Zwei davon fordern dazu auf, ungefragt gelesen zu werden. `rebase-basics` gibt an, dass es immer dann herangezogen werden soll, wenn ein Assistent überhaupt mit Rebase interagiert, und `rebase-design-language` verlangt, dass ein Agent es liest, bevor er eine visuelle Benutzeroberfläche erstellt oder modifiziert – dieser Skill existiert, weil generierte UIs schneller von einem Designsystem abweichen als alles andere in einer Codebasis.

## Wie ein Durchlauf aussieht

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Die Skills werden über das Paket `@rebasepro/agent-skills` ausgeliefert, von dem die CLI abhängt, sodass die bereitgestellten Skills exakt zu Ihrer installierten CLI-Version passen.
