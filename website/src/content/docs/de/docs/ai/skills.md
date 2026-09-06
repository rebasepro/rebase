---
sourceHash: 771019609412b5b6
title: Agent Skills
sidebar_label: Agent Skills
description: rebase skills install schreibt 21 Rebase-Referenz-Skills in Ihr Repository, genau in dem Layout, das Ihr KI-Assistent erwartet – Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity.
---

Ein KI-Assistent, der die Dokumentation von Rebase gelesen hat, schreibt besseren Rebase-Code als einer, der anhand der Form der API rät. `rebase skills install` kopiert 21 Markdown-Skill-Dateien in Ihr Repository, genau in dem Layout, das Ihr Assistent erwartet:

```bash
rebase skills install
```

Die Skills sind **Referenzmaterial, keine Werkzeuge**. Sie erklären einem Assistenten, wie Collections definiert werden, warum Migrationen aus zwei Schritten bestehen und welche Fehler das Framework nicht für ihn abfängt. Für Werkzeuge, die Aktionen auf Ihren Daten ausführen, siehe den [MCP-Server](/docs/ai/mcp).

## Welcher Assistent

Der Befehl akzeptiert `--agent` (oder `-a`), wiederholbar und kommagetrennt:

```bash
rebase skills install --agent claude
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Sieben Ziele werden unterstützt – eines für jede Pointer-Datei, die `rebase init` schreibt:

| `--agent` | Assistent | Geschrieben nach |
|---|---|---|
| `cursor` | Cursor | `.cursor/rules/rebase.mdc` + `.cursor/rules/<skill>/SKILL.md` |
| `claude` | Claude Code | `.claude/skills/<skill>/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/rules/rebase.md` + `.windsurf/rules/<skill>/SKILL.md` |
| `gemini` | Gemini CLI / Antigravity | `.agents/skills/<skill>/SKILL.md` |
| `codex` | Codex CLI | `.codex/skills/<skill>/SKILL.md` |
| `kiro` | Kiro | `.kiro/steering/rebase.md` + `.kiro/steering/<skill>/SKILL.md` |
| `copilot` | GitHub Copilot | `.github/instructions/rebase.instructions.md` + `<skill>/SKILL.md` |

:::note[Cursor, Windsurf, Kiro und Copilot bekommen eine einzige Dauerdatei]
Diese vier laden ihr komplettes Rules-Verzeichnis in jede Anfrage. Eine
Regeldatei pro Skill bedeutete rund **84.000 Zeichen** Rebase-Referenz vor jeder
Frage, ob sie Rebase betraf oder nicht – und eine Anweisung, die ein Assistent
überfliegt, ist eine, der er nicht folgt.

Stattdessen bekommen sie `rebase.mdc` (bzw. `rebase.md`): ein rund 3 KB großer
Index mit `alwaysApply: true`, der auflistet, was jeder Skill abdeckt und welche
Datei zu lesen ist. Die Inhalte liegen in Unterverzeichnissen pro Skill und
werden bei Bedarf geöffnet.
:::

`gemini` deckt **sowohl** Gemini CLI als auch Antigravity ab – beide lesen dasselbe `.agents/`-Verzeichnis, daher gibt es keinen separaten `antigravity`-Wert.

Ohne `--agent` erkennt der Befehl anhand der Verzeichnisse `.cursor/`,
`.claude/`, `.windsurf/`, `.agents/`, `.codex/` und `.kiro/`, welche
Assistenten ein Projekt bereits verwendet. Wird keines gefunden, werden Sie zur
Auswahl aufgefordert.

**GitHub Copilot wird nie erkannt.** Sein Verzeichnis wäre `.github/`, und
`.github/` ist kein Beleg dafür, dass jemand Copilot verwendet: `rebase init`
schreibt `.github/copilot-instructions.md` in jedes Gerüst, und die meisten
Repositories haben ein `.github/` für Workflows. Installieren Sie es mit
`--agent copilot`.

:::note[Ein frisch erstelltes Projekt fordert immer zur Auswahl auf]
`rebase init` schreibt `CLAUDE.md`, `.cursorrules` und Ähnliches, aber keines der
*Verzeichnisse*, nach denen die Erkennung sucht. Daher gelangt der erste Durchlauf in einem neuen Projekt
zur Eingabeaufforderung – und in CI-Umgebungen ohne TTY wird stattdessen mit einem Fehler
abgebrochen. Übergeben Sie `--agent` in jedem nicht-interaktiven Kontext explizit.
:::

## Projektlokal und zum Committen gedacht

Skills werden **relativ zu Ihrem Projektstammverzeichnis** geschrieben – dem nächstgelegenen übergeordneten Verzeichnis, das `rebase.json` enthält – nicht in Ihr Home-Verzeichnis und nicht in das aktuelle Arbeitsverzeichnis. Nichts wird global installiert.

Commiten Sie sie. Sie sind genauso Teil des Repositories wie eine Lint-Konfiguration: Der Assistent jedes Mitwirkenden arbeitet dann mit demselben Verständnis der Codebasis, einschließlich der Mitwirkenden, die den Befehl nie ausgeführt haben.

**Führen Sie den Befehl erneut aus, um zu aktualisieren.** Dateien werden bedingungslos überschrieben, also nach einem Rebase-Upgrade:

```bash
rebase skills install --agent all
```

Zwei Konsequenzen von „bedingungslos“: Lokale Änderungen an einem installierten Skill gehen beim nächsten Durchlauf verloren – bewahren Sie projektspezifische Anweisungen stattdessen in [`ai-instructions.md`](/docs/ai/instruction-files) auf, die Ihnen gehört und niemals überschrieben wird. Zudem werden Skills, die in einem neueren Release entfernt wurden, nicht aus Ihrem Repo gelöscht; nur noch vorhandene Dateien werden neu geschrieben.

Der Befehl funktioniert auch außerhalb eines Rebase-Projekts und weicht dabei auf das Arbeitsverzeichnis aus – nützlich für ein separates Frontend-Repository, das mit einem Rebase-Backend kommuniziert.

## Die 21 Skills

| Skill | Behandelt |
|---|---|
| `rebase-basics` | Grundlegende Prinzipien, Workflow und Wartung – der Einstiegspunkt, den die anderen voraussetzen |
| `rebase-collections` | Definieren von Collections, Eigenschaftstypen, Validierung, Durchsuchbarkeit |
| `rebase-backend-postgres` | Das Postgres-Backend: Setup, Schema-Generierung, Migrationen, Pooling, Read-Replicas |
| `rebase-api` | Die generierte REST-API – Endpunkte, Filterung, Sortierung, Paginierung |
| `rebase-sdk` | Das generierte TypeScript-SDK: CRUD, Filterung, Suche, Authentifizierung, Echtzeit, Offline, Storage |
| `rebase-auth` | Authentifizierung, Rollen, RLS-Richtlinien, MFA, API-Schlüssel, OAuth, benutzerdefinierte Adapter |
| `rebase-security` | Zugriffskontrolle, Interzeption, Fail-Closed-Design, PII-Maskierung, Mandantenisolierung |
| `rebase-realtime` | Die WebSocket-Engine: Synchronisierung, Broadcast-Channels, Presence, Tabellenänderungs-Broadcasts |
| `rebase-storage` | S3/GCS/lokaler Speicher, Uploads, TUS-fortsetzbare Uploads, Bildtransformationen |
| `rebase-custom-functions` | Benutzerdefinierte API-Endpunkte über dateibasierte Funktionserkennung |
| `rebase-cron-jobs` | Planung wiederkehrender Hintergrundaufgaben |
| `rebase-webhooks` | Ausgehende HTTP-Webhooks, HMAC-Signaturen, Wiederholungen und Backoff |
| `rebase-email` | SMTP, Vorlagen, benutzerdefinierte Provider, das `rebase.email`-Singleton |
| `rebase-entity-history` | Entitätsversionierung, Änderungsverfolgung, Audit-Logs, Wiederherstellung |
| `rebase-admin` | Navigation im Admin-Panel, Side-Drawer, URLs, Einbetten von Collection-Panels |
| `rebase-ui-components` | Die `@rebasepro/ui`-Komponentenbibliothek |
| `rebase-design-language` | Die UI-Designsprache: Tokens, Farbe, Typografie, Abstände, Anti-Patterns |
| `rebase-studio` | Die Studio-Entwicklerwerkzeug-Ebene – SQL, RLS, Storage, Cron, Schema-Visualizer, Logs |
| `rebase-cloud` | Deployment und Betrieb auf Rebase Cloud — Projekte, verwaltete Datenbanken, Umgebungsvariablen, Domains, Logs, Rollbacks |
| `rebase-deployment` | Self-Hosting: Docker, Kubernetes, AWS, GCP, Azure, Hetzner, Railway und Render |
| `rebase-local-env-setup` | Ersteinrichtung: Node.js, pnpm, PostgreSQL, Docker |

Zwei davon verlangen, unaufgefordert gelesen zu werden. `rebase-basics` besagt, dass es immer verwendet werden sollte, wenn ein Assistent überhaupt mit Rebase arbeitet, und `rebase-design-language` legt fest, dass ein Agent es lesen muss, bevor er eine visuelle UI erstellt oder ändert – dies existiert, weil generierte UI schneller von einem Design-System abweicht als alles andere in einer Codebasis.

## Wie eine Ausführung aussieht

```text
  Found 21 Rebase skills

  ✓ Claude Code — 21 skills installed (+ 8 reference files) to .claude/skills
```

Skills werden über das `@rebasepro/agent-skills`-Paket bereitgestellt, von dem die CLI abhängt. Das bedeutet, dass der bereitgestellte Satz Ihrer installierten CLI-Version entspricht.

---
