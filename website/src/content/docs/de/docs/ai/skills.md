---
sourceHash: 0b7bd3b233513344
title: Agent Skills
sidebar_label: Agent Skills
description: "rebase skills install schreibt 21 Rebase-Referenz-Skills in dein Repo – genau in dem Layout, das dein KI-Assistent erwartet: Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity."
---

Ein KI-Assistent, der die Rebase-Dokumentation gelesen hat, schreibt besseren Rebase-Code als einer, der anhand der Form der API rät. `rebase skills install` kopiert 21 Markdown-Skill-Dateien in dein Repository – genau in dem Layout, das dein Assistent erwartet:

```bash
rebase skills install
```

Die Skills sind **Referenzmaterial, keine Tools**. Sie erklären einem Assistenten, wie Collections definiert werden, warum Migrationen aus zwei Schritten bestehen und welche Fehler das Framework nicht für ihn abfängt. Werkzeuge, die auf deinen Daten operieren, findest du unter [MCP-Server](/docs/ai/mcp).

## Einrichtung durch `rebase init`

Ein neues Projekt benötigt den Befehl nicht. `rebase init` fragt, ob deine KI-Coding-Agents eingerichtet werden sollen, und listet dann die auf dem Rechner gefundenen auf:

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

Die gefundenen Agents sind bereits vorausgewählt. Für jeden, den du beibehältst, schreibt es die Skills und registriert den [MCP-Server](/docs/ai/mcp) in der Projektkonfiguration dieses Agents – noch vor dem ersten Commit des Projekts. In CI oder mit `--yes` kannst du sie direkt angeben:

```bash
rebase init my-app --yes --agent claude,cursor
```

## Ein bestehendes Projekt

`rebase init` verweigert ein Verzeichnis, das bereits ein Projekt enthält. Ein Projekt, das entstand, bevor es die Agent-Einrichtung gab – oder dessen Autor die Abfrage abgelehnt hat – erhält über `rebase skills install --mcp` dieselbe Einrichtung: die Skills und den in der Projektkonfiguration jedes Agents registrierten [MCP-Server](/docs/ai/mcp). Server, die bereits in der Datei stehen, bleiben erhalten, und ein erneuter Lauf lässt den Rebase-Eintrag unverändert.

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

:::note[Cursor, Windsurf, Kiro und Copilot erhalten eine Always-On-Datei]
Diese vier laden ihr gesamtes Rules-Verzeichnis in jeden Request. Eine Regeldatei pro Skill bedeutete etwa **84.000 Zeichen** an Rebase-Referenz vor jeder gestellten Frage, unabhängig davon, ob es um Rebase ging oder nicht – und eine Anweisung, die ein Assistent nur überfliegt, befolgt er meist nicht.

Stattdessen erhalten sie `rebase.mdc` (oder `rebase.md`): einen ca. 3 KB großen Index mit `alwaysApply: true`, der auflistet, was jeder Skill abdeckt und welche Datei zu lesen ist. Die eigentlichen Inhalte liegen in Unterverzeichnissen pro Skill und werden bei Bedarf geöffnet.
:::

`gemini` deckt **sowohl** Gemini CLI als auch Antigravity ab – beide lesen dasselbe `.agents/`-Verzeichnis, daher gibt es keinen separaten `antigravity`-Wert. Codex liest es ebenfalls; die Angabe von sowohl `gemini` als auch `codex` schreibt das Verzeichnis nur einmal.

Ohne Angabe von `--agent` erkennt der Befehl, welche Assistenten ein Projekt bereits verwendet, indem er nach `.cursor/`, `.claude/`, `.windsurf/`, `.agents/`, `.codex/` und `.kiro/` sucht. Findet er keine, fordert er dich zur Auswahl auf, wobei die auf dem Rechner installierten Assistenten bereits vorausgewählt sind.

**GitHub Copilot wird niemals automatisch erkannt.** Sein Verzeichnis wäre `.github/`, und `.github/` ist kein Beweis dafür, dass jemand Copilot verwendet: `rebase init` schreibt `.github/copilot-instructions.md` in jedes Scaffold, und die meisten Repositories besitzen ein `.github/` für Workflows. Installiere es mit `--agent copilot`.

:::note[Ein frisch erstelltes Projekt fordert immer zur Eingabe auf]
`rebase init` schreibt zwar `CLAUDE.md`, `.cursorrules` und Ähnliches, aber keines der *Verzeichnisse*, nach denen die Erkennung sucht. Daher fällt der erste Durchlauf in einem neuen Projekt auf die Eingabeaufforderung zurück – und in CI-Umgebungen ohne TTY bricht er stattdessen mit einem Fehler ab. Übergib `--agent` in jedem nicht-interaktiven Kontext explizit.
:::

## Projektlokal und zum Einchecken gedacht

Skills werden **relativ zu deinem Projekt-Root** geschrieben – dem nächstgelegenen übergeordneten Verzeichnis, das `rebase.json` enthält – nicht in dein Home-Verzeichnis und nicht in das aktuelle Arbeitsverzeichnis. Es wird nichts global installiert.

Checke sie ein. Sie sind genauso Teil des Repositories wie eine Linter-Konfiguration: Der Assistent jedes Mitwirkenden arbeitet dann auf Basis desselben Verständnisses der Codebasis, einschließlich Mitwirkender, die den Befehl nie ausgeführt haben.

**Führe den Befehl erneut aus, um zu aktualisieren.** Dateien werden bedingungslos überschrieben; nach einem Rebase-Upgrade also:

```bash
rebase skills install --agent all
```

Zwei Konsequenzen von „bedingungslos“: Lokale Bearbeitungen an einem installierten Skill gehen beim nächsten Durchlauf verloren – bewahre projektspezifische Anweisungen stattdessen in [`ai-instructions.md`](/docs/ai/instruction-files) auf, die dir gehört und niemals überschrieben wird. Zudem werden Skills, die in einem neueren Release entfernt wurden, nicht aus deinem Repo gelöscht; nur noch existierende Dateien werden neu geschrieben.

Der Befehl funktioniert auch außerhalb eines Rebase-Projekts und weicht dabei auf das Arbeitsverzeichnis aus – nützlich für ein separates Frontend-Repo, das mit einem Rebase-Backend kommuniziert.

## Die 21 Skills

| Skill | Behandelt |
|---|---|
| `rebase-basics` | Grundlegende Prinzipien, Workflow und Wartung – der Einstiegspunkt, den die anderen voraussetzen |
| `rebase-collections` | Definieren von Collections, Eigenschaftstypen, Validierung, Durchsuchbarkeit |
| `rebase-backend-postgres` | Das Postgres-Backend: Setup, Schema-Generierung, Migrationen, Connection-Pooling, Read-Replicas |
| `rebase-api` | Die generierte REST-API – Endpunkte, Filterung, Sortierung, Paginierung |
| `rebase-sdk` | Das generierte TypeScript-SDK: CRUD, Filterung, Suche, Authentifizierung, Echtzeit, Offline, Storage |
| `rebase-auth` | Authentifizierung, Rollen, RLS-Policies, MFA, API-Schlüssel, OAuth, benutzerdefinierte Adapter |
| `rebase-security` | Zugriffskontrolle, Interzeption, Fail-Closed-Design, PII-Maskierung, Mandantenisolation |
| `rebase-realtime` | Die WebSocket-Engine: Synchronisation, Broadcast-Kanäle, Presence, Tabellenänderungs-Broadcasts |
| `rebase-storage` | S3/GCS/lokaler Speicher, Uploads, TUS-resumable Uploads, Bildtransformationen |
| `rebase-custom-functions` | Eigene API-Endpunkte über dateibasierte Funktionserkennung |
| `rebase-cron-jobs` | Zeitgesteuerte Ausführung wiederkehrender Hintergrundaufgaben |
| `rebase-webhooks` | Ausgehende HTTP-Webhooks, HMAC-Signaturen, Wiederholungen und Backoff |
| `rebase-email` | SMTP, Templates, benutzerdefinierte Provider, das `rebase.email`-Singleton |
| `rebase-entity-history` | Entitätsversionierung, Änderungsverfolgung, Audit-Logs, Revertieren |
| `rebase-admin` | Navigation im Admin-Panel, Side-Drawers, URLs, Einbetten von Collection-Panels |
| `rebase-ui-components` | Die `@rebasepro/ui`-Komponentenbibliothek |
| `rebase-design-language` | Die UI-Designsprache: Tokens, Farben, Typografie, Spacing, Anti-Patterns |
| `rebase-studio` | Die Studio-Entwicklertools-Schicht – SQL, RLS, Storage, Cron, Schema-Visualizer, Logs |
| `rebase-cloud` | Deployment und Betrieb auf Rebase Cloud – Projekte, Managed Databases, Umgebungsvariablen, Domains, Logs, Rollbacks |
| `rebase-deployment` | Self-Hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway und Render |
| `rebase-local-env-setup` | Ersteinrichtung: Node.js, pnpm, PostgreSQL, Docker |

Zwei davon verlangen, unaufgefordert gelesen zu werden. `rebase-basics` gibt an, dass es immer verwendet werden sollte, wenn ein Assistent überhaupt mit Rebase arbeitet, und `rebase-design-language` verlangt, dass ein Agent es liest, bevor er visuelle UI erstellt oder ändert – dieser Skill existiert, weil generierte UI schneller von einem Design-System abweicht als alles andere in einer Codebasis.

## So sieht ein Durchlauf aus

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

Die Skills werden über das Paket `@rebasepro/agent-skills` ausgeliefert, von dem die CLI abhängt, sodass das bereitgestellte Set immer deiner installierten CLI-Version entspricht.
