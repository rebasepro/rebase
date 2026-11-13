---
sourceHash: dd9c77451521c040
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install schreibt 24 Rebase-Referenz-Skills in dein Repo, genau in dem Layout, das dein KI-Assistent erwartet – Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity.
---

Ein KI-Assistent, der die Dokumentation von Rebase gelesen hat, schreibt besseren Rebase-Code
als einer, der anhand der Form der API rät. `rebase skills install` kopiert 24
Markdown-Skill-Dateien in dein Repository – und zwar genau in dem Layout, das dein Assistent
erwartet:

```bash
rebase skills install
```

Die Skills sind **Referenzmaterial, keine Werkzeuge**. Sie erklären einem Assistenten, wie
Tabellen deklariert werden, warum Migrationen zwei Schritte umfassen und welche Fehler das
Framework nicht für ihn abfängt. Für Werkzeuge, die auf deine Daten zugreifen, siehe den
[MCP server](/docs/ai/mcp).

## Einrichtung durch `rebase init`

Ein neues Projekt benötigt diesen Befehl nicht. `rebase init` fragt,
ob deine KI-Coding-Agents eingerichtet werden sollen, und listet dann diejenigen auf, die es auf dem
Rechner findet:

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

Die gefundenen Agents sind bereits vorausgewählt. Für jeden, den du beibehältst, schreibt es die Skills
und registriert den [MCP server](/docs/ai/mcp) in der Projektkonfiguration dieses Agents – und das alles
noch vor dem ersten Commit des Projekts. In CI oder mit `--yes` gibst du sie namentlich an:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Ein bestehendes Projekt

`rebase init` bricht ab, wenn ein Verzeichnis bereits ein Projekt enthält. Ein Projekt, das
erstellt wurde, bevor die Agent-Einrichtung existierte – oder dessen Ersteller die Abfrage
abgelehnt hat –, erhält dieselbe Einrichtung über `rebase skills install --mcp`: die Skills und
die Registrierung des [MCP server](/docs/ai/mcp) in der Projektkonfiguration jedes Agents. Bereits
in der Datei vorhandene Server bleiben erhalten, und ein erneuter Durchlauf belässt den Rebase-Eintrag
unverändert.

```bash
rebase skills install --agent cursor --mcp
```

Ohne `--mcp` schreibt der Befehl nur die Skills und nennt die Agents, in deren Konfiguration der
Server noch fehlt.

## Welcher Assistent

Der Befehl akzeptiert `--agent` (oder `-a`), wiederholbar und kommagetrennt:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sieben Ziele werden unterstützt – eines für jede Zeigerdatei, die `rebase init` schreibt:

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
Diese vier laden ihr gesamtes Rules-Verzeichnis in jede Anfrage. Eine Regeldatei pro
Skill bedeutete etwa **84.000 Zeichen** an Rebase-Referenz vor jeder Frage, die
jemand stellte, unabhängig davon, ob es um Rebase ging oder nicht – und eine
Anweisung, die ein Assistent nur überfliegt, wird von ihm nicht befolgt.

Stattdessen erhalten sie `rebase.mdc` (oder `rebase.md`): einen ca. 3 KB großen Index mit
`alwaysApply: true`, der auflistet, was jeder Skill abdeckt und welche Datei gelesen werden
soll. Die eigentlichen Inhalte liegen in Unterverzeichnissen pro Skill und werden bei Bedarf geladen.
:::

`gemini` deckt **sowohl** Gemini CLI als auch Antigravity ab – sie lesen dasselbe
`.agents/`-Verzeichnis, daher gibt es keinen separaten `antigravity`-Wert. Codex liest
es ebenfalls; die Angabe von sowohl `gemini` als auch `codex` schreibt das Verzeichnis nur einmal.

Ohne `--agent` erkennt der Befehl anhand von `.cursor/`, `.claude/skills/`, `.windsurf/`, `.agents/`, `.codex/` und
`.kiro/`, welche Assistenten ein Projekt bereits verwendet. Findet er keine, wirst du aufgefordert, eine
Auswahl zu treffen, wobei die auf dem Rechner installierten Assistenten bereits vorausgewählt sind.

**GitHub Copilot wird niemals automatisch erkannt.** Sein Verzeichnis wäre `.github/`, und
`.github/` ist kein Beleg dafür, dass jemand Copilot verwendet: `rebase init` schreibt
`.github/copilot-instructions.md` in jedes Scaffold, und die meisten Repositories besitzen
ein `.github/` für Workflows. Installiere es mit `--agent copilot`.

:::note[Ein frisch erstelltes Projekt fordert immer zur Auswahl auf]
`rebase init` schreibt `CLAUDE.md`, `.cursorrules` und Ähnliches, aber keines der
*Verzeichnisse*, nach denen die Erkennung sucht. Daher greift beim ersten Durchlauf in einem neuen
Projekt die interaktive Abfrage – und in CI-Umgebungen ohne TTY bricht der Befehl stattdessen
mit einem Fehler ab. Übergib `--agent` in allen nicht-interaktiven Kontexten explizit.
:::

## Projektlokal und für Commits gedacht

Skills werden **relativ zu deiner Projekt-Root** geschrieben – dem nächstgelegenen übergeordneten
Verzeichnis, das `rebase.json` enthält – nicht in dein Home-Verzeichnis und nicht in das aktuelle
Arbeitsverzeichnis. Es wird nichts global installiert.

Committe sie. Sie sind auf dieselbe Weise Teil des Repos wie eine Linter-Konfiguration: Der
Assistent jedes Mitwirkenden arbeitet dann auf Basis desselben Verständnisses der Codebasis,
einschließlich der Mitwirkenden, die den Befehl nie ausgeführt haben.

**Führe den Befehl nach einem Rebase-Upgrade erneut aus**, um sie zu aktualisieren:

```bash
rebase skills install --agent all
```

Jedes Zielverzeichnis enthält ein `.rebase-skills.json`-Manifest der vom Befehl
geschriebenen Dateien, sodass ein erneuter Durchlauf eigene Anpassungen von Kopien älterer
Releases unterscheiden kann. Committe es zusammen mit den Skills.

- Eine Datei, die niemand bearbeitet hat, wird durch die Kopie des neuen Releases ersetzt.
- Eine Datei, die du bearbeitet hast, bleibt erhalten und wird vom Befehl aufgelistet. `--force` ersetzt sie.
- Ein Skill, der in einem neueren Release nicht mehr enthalten ist, wird entfernt, es sei denn, du hast ihn bearbeitet.
  In diesem Fall bleibt er erhalten und wird aufgelistet.
- Dateien, die der Befehl nie geschrieben hat, werden nicht angetastet.

Projektspezifische Anweisungen gehören weiterhin in
[`ai-instructions.md`](/docs/ai/instruction-files), die dir gehört. Ein bearbeiteter
Skill erhält keine Updates mehr, es sei denn, du erzwingst dies mit `--force`.

Der Befehl funktioniert auch außerhalb eines Rebase-Projekts und weicht dann auf das Arbeitsverzeichnis
aus – nützlich für ein separates Frontend-Repo, das mit einem Rebase-Backend kommuniziert.

## Die 24 Skills

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Skill | Behandelt |
|---|---|
| `rebase-basics` | Grundlegende Prinzipien, Workflow und Wartung – der Einstiegspunkt, den die anderen voraussetzen |
| `rebase-tables` | Tabellen erstellen: Spalten, Relationen, `rls`, Hooks und die CMS-Ebene darüber (`customizeTable`) |
| `rebase-backend-postgres` | Das Postgres-Backend: Setup, Schemagenerierung, Migrationen, Pooling, Read-Replicas |
| `rebase-api` | Die generierte REST-API – Endpunkte, Filterung, Sortierung, Paginierung |
| `rebase-sdk` | Das generierte TypeScript-SDK: CRUD, Filterung, Suche, Auth, Realtime, Offline, Storage |
| `rebase-auth` | Authentifizierung, Rollen, RLS-Richtlinien, MFA, API-Schlüssel, OAuth, benutzerdefinierte Adapter |
| `rebase-security` | Zugriffskontrolle, Interception, Fail-Closed-Design, PII-Maskierung, Mandantenisolierung |
| `rebase-realtime` | Die WebSocket-Engine: Synchronisierung, Broadcast-Channels, Presence, Tabellenänderungs-Broadcasts |
| `rebase-storage` | S3/GCS/lokaler Speicher, Uploads, fortsetzbare TUS-Uploads, Bildtransformationen |
| `rebase-custom-functions` | Benutzerdefinierte API-Endpunkte über dateibasierte Funktionserkennung |
| `rebase-cron-jobs` | Planung wiederkehrender Hintergrundaufgaben |
| `rebase-webhooks` | Ausgehende HTTP-Webhooks, HMAC-Signaturen, Wiederholungsversuche und Backoff |
| `rebase-email` | SMTP, Templates, benutzerdefinierte Provider, das `rebase.email`-Singleton |
| `rebase-entity-history` | Entitätsversionierung, Änderungsverfolgung, Audit-Logs, Wiederherstellung |
| `rebase-admin` | Navigation im Admin-Panel, Side-Drawers, URLs, Einbetten von Collection-Panels |
| `rebase-customize-admin` | Anpassen des Admins mit React-Komponenten – Singletons, Einstellungsseiten, Bulk-Aktionen, Ansichtsmodi, benutzerdefinierte Felder, Ersetzen integrierter Teile |
| `rebase-custom-views` | Benutzerdefinierte Ansichten im Admin – `rebase generate view`, Top-Level-Ansichten, Datensatz-Tabs, Feld-Widgets |
| `rebase-dashboards` | KPIs, Diagramme und Dashboards – in SQL berechnete Kennzahlen, gezeichnet mit `@rebasepro/ui`, platziert in Slots oder auf einer Seite |
| `rebase-ui-components` | Die `@rebasepro/ui`-Komponentenbibliothek |
| `rebase-design-language` | Die UI-Designsprache: Tokens, Farben, Typografie, Abstände, Anti-Patterns |
| `rebase-studio` | Die Entwickler-Tools-Ebene von Studio – SQL, RLS, Storage, Cron, Schema-Visualisierer, Logs |
| `rebase-cloud` | Bereitstellung und Betrieb auf Rebase Cloud – Projekte, verwaltete Datenbanken, Umgebungsvariablen, Domains, Logs, Rollbacks |
| `rebase-deployment` | Self-Hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway und Render |
| `rebase-local-env-setup` | Ersteinrichtung: Node.js, pnpm, PostgreSQL, Docker |

Zwei davon verlangen, unaufgefordert gelesen zu werden. `rebase-basics` besagt, dass es immer
verwendet werden soll, sobald ein Assistent überhaupt mit Rebase arbeitet, und `rebase-design-language`
verlangt, dass ein Agent es liest, bevor er visuelle UI erstellt oder modifiziert – dieser Skill
existiert, weil generierte UI schneller von einem Design-System abweicht als alles andere in einer
Codebasis.

## So sieht ein Durchlauf aus

```text
  Found 24 Rebase skills

  ✓ Claude Code — 24 skills installed (+ 8 reference files) to .claude/skills
```

Skills werden über das Paket `@rebasepro/agent-skills` bereitgestellt, von dem die CLI abhängt.
Das bereitgestellte Set entspricht daher immer der installierten CLI-Version.
