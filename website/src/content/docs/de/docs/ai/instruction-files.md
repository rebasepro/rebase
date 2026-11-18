---
sourceHash: 4f52b1da35febe8d
title: KI-Instruktionsdateien
sidebar_label: KI-Instruktionsdateien
description: Jedes per Scaffolding erstellte Rebase-Projekt enthält ai-instructions.md sowie Pointer-Dateien für Claude, Cursor, Windsurf, Copilot und AGENTS.md, die die fünf Regeln enthalten, gegen die Assistenten am häufigsten verstoßen – eine Single Source of Truth, viele Dateinamen.
---

Jeder Assistent erwartet seine Regeln in einer anderen Datei. Claude Code liest
`CLAUDE.md`, Cursor liest `.cursorrules`, Windsurf liest `.windsurfrules`,
Copilot liest `.github/copilot-instructions.md` und die herstellerübergreifende Konvention
lautet `AGENTS.md`. Dieselben Vorgaben in fünf Dateien zu pflegen führt unweigerlich dazu,
dass vier davon veralten.

`rebase init` erstellt alle fünf – als **Pointer auf eine einzige Datei, die Sie tatsächlich
bearbeiten**:

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

Jede Pointer-Datei verweist auf die eigentliche Datei, gibt an, wo sich die Skills befinden, und enthält die fünf Regeln, gegen die ein Assistent keinesfalls verstoßen darf – selbst wenn er niemals etwas anderes öffnet:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit `.env`, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`).
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see.
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Die anderen unterscheiden sich nur im Skills-Verzeichnis des Agenten und seinem `--agent`-Wert –
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` – sowie im
relativen Pfad, der in `.github/copilot-instructions.md` `../ai-instructions.md` und in
`AGENTS.md` `ai-instructions.md` lautet. Die dritte Zeile ist konditional, da
`rebase init --agent` die Skills möglicherweise bereits installiert hat, bevor der
Assistent sie jemals liest.

Dies geschieht bei jedem `rebase init` für jedes Preset einschließlich `--headless`.
Es gibt kein Flag und keine Eingabeaufforderung.

`rebase init` schreibt außerdem `.mcp.json`, was Claude Code, Cursor und
jeden anderen MCP-Client auf den [Rebase-MCP-Server](/docs/ai/mcp) verweist – die
projekteigene Kopie, eine devDependency, die mit der CLI gepinnt ist (`npx --no rebase-mcp`
in einem npm-Projekt):

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

`REBASE_PROJECT_DIR` ist `"."`, kein absoluter Pfad: Der Client startet den Server
im Projekt-Root, und ein absoluter Pfad ist die eine Zeile dieser Datei, die nicht
committet werden kann. Sie ist vorhanden, weil `~/.rebase/projects.json` maschinenweit
gilt – ein Projekt, das kein eigenes Verzeichnis angibt, fällt auf das zurück, was
das letzte Projekt auf dieser Maschine persistiert hat. Siehe
[die Rangfolge](/docs/ai/mcp#which-directory-it-acts-on).

## Warum ein Pointer statt einer Kopie

Die Pointer-Dateien enthalten fast nichts. Eine Datei, die die eigentliche Datei
referenziert, behält die Konventionen an einem zentralen Ort und hat Eigenschaften,
die eine Kopie nicht besitzt:

- **Eine einzige Datei zum Bearbeiten.** Regeln können zwischen Assistenten nicht
  auseinanderdriften, da es nur ein einziges Regelwerk gibt.
- **Ein einziger Diff zum Reviewen.** Eine Änderung der Projektkonventionen ist eine Änderung
  an einer Datei und nicht an fünf identischen, die ein Reviewer vergleichen müsste.
- **Einen Assistenten hinzuzufügen ist nur eine kleine Datei.** Ein neues Tool mit
  neuem Dateinamen erhält einen Pointer und nicht eine sechste Kopie Ihrer Konventionen.

Die einzige Ausnahme ist der Block **Before you write any code**. Ein Assistent folgt
einem Link nicht immer zuverlässig: Ist er mit einer Aufgabe beschäftigt, schreibt er
zuerst den Code, und wird er im Root eines Repositories gestartet, dessen Rebase-Projekt
in einem Unterordner liegt, lädt er diese Dateien überhaupt nicht. Daher werden die fünf
Regeln, deren Missachtung den größten Schaden anrichtet (eine Tabelle, die in SQL statt
in `backend/schema` erstellt wird, Daten, die am SDK vorbei gelesen oder geschrieben werden,
eine ungesicherte Route, ein Deploy, eine bearbeitete generierte Datei), identisch in
jeden Pointer geschrieben. Eine Prüfung in CI sorgt dafür, dass die fünf Kopien synchron bleiben.

Es lohnt sich, dieses Muster beizubehalten, wenn Sie das Scaffold forken, und es auch
in Repositories zu übernehmen, die überhaupt keine Rebase-Projekte sind.

## Womit `ai-instructions.md` beginnt

Die per Scaffolding erstellte Datei ist bewusst kurz gehalten – sie verweist für
Details auf [`rebase skills install`](/docs/ai/skills) und benennt dann die Regeln,
die Assistenten so oft missverstehen, dass es sich lohnt, sie zu Beginn jeder
Sitzung zu wiederholen:

1. **Schema as Code.** Eine Tabelle ist ein `defineTable` in `backend/schema/<table>.ts`,
   exportiert aus `backend/schema/index.ts` – nur was der Index exportiert, wird
   bereitgestellt – mit einem erforderlichen `rls`. Bearbeiten Sie niemals das generierte
   Drizzle-Schema oder die Postgres-Tabellen manuell – siehe [Schema as Code](/docs/architecture/schema-as-code).
2. **Das Anwenden einer Schemaänderung** hängt von der Datenbank ab. Während `pnpm dev`
   läuft, ist das Speichern einer Datei in `backend/schema/` bereits der gesamte Schritt: Es
   generiert das Drizzle-Schema sowie die SDK-Typen neu, und beim Booten werden die
   fehlenden Tabellen und Spalten erstellt. `pnpm db:push` ist nur für das gedacht, was beim
   Booten bewusst unangetastet bleibt – eine umbenannte Spalte, ein eingeschränkter Typ,
   eine entfernte Spalte – sowohl auf der gemanagten Entwicklungsdatenbank als auch auf
   Ihrem eigenen PostgreSQL. Für die Produktion gilt `pnpm db:generate`, gefolgt von `pnpm db:migrate`.
3. **Verwenden Sie das SDK.** Nutzen Sie `rebase.dataAsAdmin.<table>` für Operationen unter
   der Service-Identität oder `getDriver(c)` innerhalb einer Funktion, wenn der Lesezugriff
   im Kontext des Aufrufers erfolgen soll. Der Server-Client besitzt keinen einfachen `data`-Accessor.
   Reines SQL und direkte Drizzle-Aufrufe umgehen Validierung, Hooks und RLS.
4. **Sichern Sie jede benutzerdefinierte Route ab.** Routen in `backend/functions/` werden
   *ohne* Authentifizierung eingebunden. Verwenden Sie `requireAuth` / `requireAdmin` aus
   `@rebasepro/server/functions` im Middleware-Slot der jeweiligen Route – das Auslesen von
   `c.get("user")` ist keine Absicherung, und `app.use()` nach der Route ist es ebenso wenig.

Dieser letzte Punkt ist besonders wichtig. Er macht den Unterschied zwischen einer Middleware,
die ausgeführt wird, und einer, die es nicht wird – und ein Assistent, dem man dies nicht
ausdrücklich sagt, schreibt verlässlich die Version, die nicht ausgeführt wird – siehe
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` gewährt nur der `admin`-Rolle Zugriff. Wenn eine spezifischere Rolle oder
ein API-Schlüssel eine Route aufrufen können soll, ist `requireScope` der passende Guard
mit einem Scope, den die App deklariert – siehe [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Nach den Regeln folgen zwei Abschnitte, die nur für manche Projekte gelten. **Backend
runtime** listet auf, was die gemanagte Runtime auf Rebase Cloud erlaubt: Pakete,
Arbeitsspeicher und Status auf Modulebene, Timeouts, ausgehende Ports, Konfiguration und
Speicher für generierte Dateien. Der Abschnitt verlinkt auf
[Managed backend runtime](/docs/deployment/managed-runtime/), damit ein Assistent
ein Backend-Feature anhand realer Limits plant, anstatt zu raten. **Admin UI**
enthält die `@rebasepro/ui`-Regeln. Sie gelten für Views innerhalb des Admin-Panels, nicht
für eine öffentliche Website oder statische App, die das Projekt bereitstellt.

## An Ihre Bedürfnisse anpassen

`ai-instructions.md` ist Ihre Datei. Nichts regeneriert oder überschreibt sie – im
Gegensatz zu [installierten Skills](/docs/ai/skills), die bei jedem
`rebase skills install` ersetzt werden. Projektspezifische Konventionen gehören hierhin.

Einen Platz hier verdient alles, was ein Assistent nicht aus dem Code ableiten kann:
welche Tabellen veraltet (Legacy) sind, welcher Service für welche Tabelle zuständig ist,
Namenskonventionen, die nirgends erzwungen werden, oder die Migration, die keinesfalls
erneut ausgeführt werden darf. Halten Sie sie kurz – Anweisungen, die in jeden Request
geladen werden, konkurrieren mit der eigentlichen Aufgabe um Aufmerksamkeit, und eine
lange Datei wird von einem Assistenten nur überflogen.

Und behalten Sie die Abgrenzung im Hinterkopf: Diese Datei bestimmt, was ein Assistent
*schreibt*. Sie hat keinen Einfluss darauf, was ein mit Ihrer Datenbank verbundener
Agent *tun* darf – dies wird durch die Credentials bestimmt, die er besitzt, und
nichts in Markdown ändert daran etwas. Siehe
[das Credential-Modell des MCP-Servers](/docs/ai/mcp#what-the-server-can-reach).
