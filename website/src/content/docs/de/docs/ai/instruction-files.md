---
sourceHash: eaad69efe348f395
title: KI-Instruktionsdateien
sidebar_label: KI-Instruktionsdateien
description: Jedes erstellte Rebase-Projekt enthält ai-instructions.md sowie Pointer-Dateien für Claude, Cursor, Windsurf, Copilot und AGENTS.md, die die fünf Regeln enthalten, gegen die Assistenten am häufigsten verstoßen – eine Single Source of Truth, viele Dateinamen.
---

Jeder Assistent erwartet seine Regeln in einer anderen Datei. Claude Code liest
`CLAUDE.md`, Cursor liest `.cursorrules`, Windsurf liest `.windsurfrules`,
Copilot liest `.github/copilot-instructions.md` und die herstellerübergreifende
Konvention lautet `AGENTS.md`. Dieselben Anweisungen in fünf Dateien zu pflegen
führt dazu, dass vier davon veralten.

`rebase init` schreibt alle fünf – als **Pointer auf eine einzige Datei, die Sie
tatsächlich bearbeiten**:

```text
your-project/
├── ai-instructions.md            ← the real content
├── CLAUDE.md                     ← pointer
├── AGENTS.md                     ← pointer
├── .cursorrules                  ← pointer
├── .windsurfrules                ← pointer
└── .github/
    └── copilot-instructions.md   ← pointer
```

Jede Pointer-Datei verweist auf die eigentliche Datei, gibt an, wo sich die Skills befinden, und enthält die fünf Regeln, die ein Assistent niemals verletzen darf, selbst wenn er sonst nichts anderes öffnet:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`). In `.env`, change only a local setting the task needs (`AUTH_MAGIC_LINK`, `FRONTEND_URL`, `REBASE_FUNCTIONS_TIMEOUT_MS` and the like), one line at a time, and say which; never rewrite, print or rotate its secrets (`DATABASE_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`).
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see.
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Die anderen unterscheiden sich nur im Skills-Verzeichnis des Agenten und dessen
`--agent`-Wert – `--agent cursor`, `--agent windsurf`, `--agent codex`,
`--agent copilot` – sowie im relativen Pfad, welcher in
`.github/copilot-instructions.md` `../ai-instructions.md` und in `AGENTS.md`
`ai-instructions.md` lautet. Die dritte Zeile ist konditional, da
`rebase init --agent` die Skills möglicherweise bereits installiert hat, bevor
der Assistent sie überhaupt liest.

Dies geschieht bei jedem `rebase init`, für jedes Preset einschließlich `--headless`.
Es gibt kein Flag und keine Eingabeaufforderung.

`rebase init` schreibt auch `.mcp.json`, wodurch Claude Code, Cursor und
jeder andere MCP-Client auf den [Rebase-MCP-Server](/docs/ai/mcp) verwiesen wird –
die projekteigene Kopie, eine devDependency, die mit der CLI gepinnt ist
(`npx --no rebase-mcp` in einem npm-Projekt):

```json title=".mcp.json"
{
    "mcpServers": {
        "rebase": {
            "command": "pnpm",
            "args": ["exec", "rebase-mcp"],
            "env": {
                "REBASE_PROJECT_DIR": "."
            }
        }
    }
}
```

`REBASE_PROJECT_DIR` ist `"."`, kein absoluter Pfad: Der Client startet den
Server im Projekt-Root, und ein absoluter Pfad ist die einzige Zeile dieser
Datei, die nicht comittet werden kann. Dies ist erforderlich, da
`~/.rebase/projects.json` systemweit gilt – ein Projekt, das kein eigenes
Verzeichnis angibt, fällt auf das zurück, was das letzte Projekt auf diesem
Rechner persistiert hat. Siehe
[die Rangfolge](/docs/ai/mcp#which-directory-it-acts-on).

## Warum ein Pointer statt einer Kopie

Die Pointer-Dateien enthalten fast nichts. Eine Datei, die auf die eigentliche
verweist, hält die Konventionen an einem zentralen Ort und bietet Vorteile,
die eine Kopie nicht hat:

- **Eine einzige Datei zum Bearbeiten.** Regeln können zwischen Assistenten
  nicht auseinanderdriften, da es nur ein einziges Regelwerk gibt.
- **Ein einziger Diff zum Reviewen.** Eine Änderung der Projektkonventionen
  betrifft nur eine Datei, nicht fünf identische, die ein Reviewer vergleichen
  müsste.
- **Einen Assistenten hinzuzufügen erfordert nur eine kleine Datei.** Ein neues
  Tool mit einem neuen Dateinamen erhält einen Pointer, keine sechste Kopie
  Ihrer Konventionen.

Die einzige Ausnahme ist der Block **Before you write any code**. Ein Assistent
folgt einem Link nicht zuverlässig: Ist er mit einer Aufgabe beschäftigt,
schreibt er zuerst den Code, und ein Assistent, der im Root eines Repositories
gestartet wurde, dessen Rebase-Projekt in einem Unterordner liegt, lädt diese
Dateien überhaupt nicht. Daher werden die fünf Regeln, deren Missachtung den
größten Schaden anrichtet (eine Tabelle in SQL statt in `backend/schema` erstellt,
Daten am SDK vorbei gelesen und geschrieben, eine ungeschützte Route, ein
Deployment, eine bearbeitete generierte Datei), identisch in jeden Pointer
geschrieben. Ein CI-Check stellt sicher, dass die fünf Kopien synchron bleiben.

Es lohnt sich, dieses Muster beizubehalten, wenn Sie das Scaffold forken, und
es auch in Repositories zu übernehmen, die überhaupt keine Rebase-Projekte sind.

## Womit `ai-instructions.md` beginnt

Die vorbereitete Datei ist bewusst kurz gehalten – sie verweist für detailliertere
Informationen auf [`rebase skills install`](/docs/ai/skills) und nennt dann die
Regeln, die Assistenten so oft falsch machen, dass es sich lohnt, sie zu Beginn
jeder Session zu wiederholen:

1. **Schema as Code.** Eine Tabelle ist ein `defineTable` in
   `backend/schema/<table>.ts`, exportiert aus `backend/schema/index.ts` – nur
   was der Index exportiert, wird bereitgestellt – mit einem erforderlichen
   `rls`. Bearbeiten Sie niemals das generierte Drizzle-Schema oder die
   Postgres-Tabellen manuell – siehe [Schema as Code](/docs/architecture/schema-as-code).
2. **Das Anwenden einer Schemaänderung** hängt von der Datenbank ab. Während
   `pnpm dev` läuft, reicht das Speichern einer Datei in `backend/schema/`
   bereits aus: Es regeneriert das Drizzle-Schema und die SDK-Typen, und der
   Boot-Vorgang erstellt die fehlenden Tabellen und Spalten. `pnpm db:push` wird
   nur für Änderungen benötigt, die der Boot-Vorgang bewusst ignoriert – eine
   umbenannte Spalte, ein eingeschränkter Typ, eine entfernte Spalte – sowohl
   auf der verwalteten Entwicklungsdatenbank als auch auf Ihrem eigenen
   PostgreSQL. Für die Produktion gilt: `pnpm db:generate`, gefolgt von
   `pnpm db:migrate`.
3. **Verwenden Sie das SDK.** Nutzen Sie `rebase.dataAsAdmin.<table>` für
   Operationen, die als Service-Identität ausgeführt werden, oder `getDriver(c)`
   innerhalb einer Funktion, wenn der Lesezugriff als Aufrufer erfolgen soll.
   Der Server-Client besitzt keinen einfachen `data`-Accessor. Rohes SQL und
   direkte Drizzle-Aufrufe umgehen Validierung, Hooks und RLS.
4. **Sichern Sie jede benutzerdefinierte Route ab.** Routen in
   `backend/functions/` werden *ohne* Authentifizierung eingebunden. Verwenden Sie
   `requireAuth` / `requireAdmin` aus `@rebasepro/server/functions` im
   Middleware-Slot der jeweiligen Route – das Auslesen von `c.get("user")`
   stellt keine Absicherung dar, ebenso wenig wie `app.use()` nach der Route.

Dieser letzte Punkt ist besonders wichtig. Er macht den Unterschied zwischen
einer Middleware, die ausgeführt wird, und einer, die nicht ausgeführt wird. Ein
Assistent, dem dies nicht mitgeteilt wurde, wird verlässlich die Variante
schreiben, die nicht ausgeführt wird – siehe
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` gewährt ausschließlich der Rolle `admin` Zugriff. Wenn eine
spezifischere Rolle oder ein API-Schlüssel eine Route aufrufen können soll, ist
`requireScope` mit einem von der App deklarierten Scope der zu verwendende
Guard – siehe [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Nach den Regeln folgen zwei Abschnitte, die nur für bestimmte Projekte relevant
sind. **Backend runtime** listet auf, was die verwaltete Runtime auf Rebase Cloud
erlaubt: Pakete, Speicher und Zustand auf Modulebene, Timeouts, ausgehende Ports,
Konfiguration und Speicher für generierte Dateien. Es verlinkt auf
[Managed backend runtime](/docs/deployment/managed-runtime/), damit ein Assistent
ein Backend-Feature anhand realer Limits plant, anstatt zu raten. **Admin UI**
enthält die Regeln für `@rebasepro/ui`. Sie gelten für Ansichten innerhalb des
Admin-Panels, nicht für eine öffentliche Website oder eine statische App, die
das Projekt bereitstellt.

## An eigene Bedürfnisse anpassen

`ai-instructions.md` ist Ihre Datei. Nichts regeneriert oder überschreibt sie –
im Gegensatz zu [installierten Skills](/docs/ai/skills), die bei jedem
`rebase skills install` ersetzt werden. Projektspezifische Konventionen gehören
hierhin.

Hierhin gehört, was ein Assistent nicht aus dem Code ableiten kann: welche
Tabellen Legacy sind, welcher Service welche Tabelle besitzt, welche
Namenskonvention nirgendwo erzwungen wird, welche Migration nicht erneut
ausgeführt werden darf. Halten Sie es kurz – Instruktionen, die bei jedem
Request geladen werden, konkurrieren mit der eigentlichen Aufgabe um
Aufmerksamkeit, und eine lange Datei wird von einem Assistenten nur überflogen.

Und beachten Sie die Grenzen: Diese Datei bestimmt, was ein Assistent *schreibt*.
Sie hat keinen Einfluss darauf, was ein mit Ihrer Datenbank verbundener Agent tun
*darf* – dies wird durch die übergebenen Anmeldeinformationen bestimmt, und
nichts im Markdown ändert daran etwas. Siehe
[das Credential-Modell des MCP-Servers](/docs/ai/mcp#what-the-server-can-reach).
