---
sourceHash: 4a5c6ecfb9f66fd3
title: KI-Anweisungsdateien
sidebar_label: KI-Anweisungsdateien
description: Jedes gerüstete Rebase-Projekt enthält ai-instructions.md sowie Pointer-Dateien für Claude, Cursor, Windsurf, Copilot und AGENTS.md, die die fünf Regeln enthalten, gegen die Assistenten am häufigsten verstoßen – eine Single Source of Truth, viele Dateinamen.
---

Jeder Assistent verlangt seine Regeln in einer anderen Datei. Claude Code liest
`CLAUDE.md`, Cursor liest `.cursorrules`, Windsurf liest `.windsurfrules`,
Copilot liest `.github/copilot-instructions.md`, und die herstellerübergreifende Konvention
ist `AGENTS.md`. Dieselben Anweisungen in fünf Dateien zu pflegen, führt unweigerlich dazu, dass vier davon
veralten.

`rebase init` schreibt alle fünf – als **Pointer auf eine einzige Datei, die Sie tatsächlich
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

Jede Pointer-Datei nennt die eigentliche Datei, gibt an, wo sich die Skills befinden, und enthält die fünf Regeln, gegen die ein Assistent niemals verstoßen darf, selbst wenn er sonst nichts anderes öffnet:

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
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see. The admin derived from the tables is a draft: before calling an admin done, give every table it shows a `customizeTable` pass (a title, its columns, ids and raw JSON hidden, labels; ai-instructions.md, "Admin UI", has the checklist).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Die anderen unterscheiden sich nur im Skills-Verzeichnis des Agents und dessen `--agent`-Wert –
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` – sowie im
relativen Pfad, der in `.github/copilot-instructions.md` `../ai-instructions.md` und in `AGENTS.md`
`ai-instructions.md` lautet. Die dritte Zeile ist bedingt, da `rebase init --agent` die Skills
möglicherweise bereits installiert hat, bevor der Assistent sie überhaupt liest.

Dies geschieht bei jedem `rebase init`, für jedes Preset einschließlich `--headless`.
Es gibt kein Flag und keine Eingabeaufforderung.

`rebase init` schreibt außerdem `.mcp.json`, was Claude Code, Cursor und
jeden anderen MCP-Client auf den [Rebase MCP-Server](/docs/ai/mcp) verweist – die projekteigene
Kopie, eine devDependency, die mit der CLI fixiert ist (`npx --no rebase-mcp` in einem npm-Projekt):

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
im Projekt-Root, und ein absoluter Pfad ist die eine Zeile dieser Datei, die
nicht comittet werden kann. Sie existiert dort, weil `~/.rebase/projects.json`
rechnerweit gilt – ein Projekt, das kein eigenes Verzeichnis angibt, greift auf das zurück,
was das letzte Projekt auf diesem Rechner persistiert hat. Siehe
[die Rangfolge](/docs/ai/mcp#which-directory-it-acts-on).

## Warum ein Pointer statt einer Kopie

Die Pointer-Dateien enthalten fast nichts. Eine Datei, die die eigentliche Datei referenziert, bündelt
die Konventionen an einem Ort und bietet Vorteile, die eine Kopie nicht hat:

- **Nur eine Datei zum Bearbeiten.** Regeln können zwischen Assistenten nicht auseinanderdriften,
  da es nur ein einziges Regelwerk gibt.
- **Nur ein Diff zum Überprüfen.** Eine Änderung der Projektkonventionen betrifft eine
  einzige Datei – nicht fünf identische, die ein Reviewer vergleichen müsste.
- **Einen Assistenten hinzuzufügen erfordert nur eine kleine Datei.** Ein neues Tool mit einem neuen Dateinamen
  erhält einen Pointer, keine sechste Kopie Ihrer Konventionen.

Die einzige Ausnahme ist der Block **Before you write any code**. Ein Assistent
folgt einem Link nicht zuverlässig: Ein Assistent, der mit einer Aufgabe beschäftigt ist, schreibt zuerst den Code,
und ein Assistent, der im Root-Verzeichnis eines Repositorys gestartet wird, dessen Rebase-Projekt in einem
Unterordner liegt, lädt diese Dateien überhaupt nicht. Daher werden die fünf Regeln, deren Missachtung
den größten Schaden anrichtet (eine Tabelle, die in SQL statt in `backend/schema` erstellt wird, Daten, die am
SDK vorbei gelesen und geschrieben werden, eine ungeschützte Route, ein Deployment, eine bearbeitete generierte Datei),
identisch in jeden Pointer geschrieben. Ein CI-Check stellt sicher, dass die fünf Kopien gleich bleiben.

Es lohnt sich, dieses Muster beizubehalten, wenn Sie das Gerüst forken, und es auch in
Repositorys zu übernehmen, die überhaupt keine Rebase-Projekte sind.

## Womit `ai-instructions.md` beginnt

Die generierte Datei ist bewusst kurz gehalten – sie verweist für Details auf
[`rebase skills install`](/docs/ai/skills) und nennt dann die Regeln, die
Assistenten so oft falsch machen, dass es sich lohnt, sie zu Beginn jeder
Sitzung zu wiederholen:

1. **Schema as Code.** Eine Tabelle ist ein `defineTable` in `backend/schema/<table>.ts`,
   exportiert aus `backend/schema/index.ts` – nur was der Index exportiert, wird
   bereitgestellt – mit einem erforderlichen `rls`. Bearbeiten Sie das generierte Drizzle-Schema
   oder die Postgres-Tabellen niemals manuell – siehe [Schema as Code](/docs/architecture/schema-as-code).
2. **Das Anwenden einer Schemaänderung** hängt von der Datenbank ab. Während `pnpm dev`
   läuft, reicht das Speichern einer Datei in `backend/schema/` bereits aus: Es
   generiert das Drizzle-Schema und die SDK-Typen neu, und beim Booten werden die
   fehlenden Tabellen und Spalten erstellt. `pnpm db:push` ist nur für das gedacht, was beim Booten bewusst
   unverändert bleibt – eine umbenannte Spalte, ein eingeengter Typ, eine entfernte Spalte – sowohl auf der
   verwalteten Entwicklungsdatenbank als auch auf Ihrem eigenen PostgreSQL. Für die Produktion gilt
   `pnpm db:generate` gefolgt von `pnpm db:migrate`.
3. **Verwenden Sie das SDK.** Nutzen Sie `rebase.dataAsAdmin.<table>` für Vorgänge, die als
   Dienstidentität ausgeführt werden, oder `getDriver(c)` innerhalb einer Funktion, wenn der Lesevorgang
   als Aufrufer erfolgen soll. Der Server-Client besitzt keinen einfachen `data`-Accessor. Natives SQL und direkte
   Drizzle-Aufrufe umgehen Validierung, Hooks und RLS.
4. **Sichern Sie jede benutzerdefinierte Route ab.** Routen in `backend/functions/` werden
   *ohne* Authentifizierung eingebunden. Verwenden Sie `requireAuth` / `requireAdmin` aus
   `@rebasepro/server/functions` im Middleware-Slot der jeweiligen Route – das Auslesen von
   `c.get("user")` ist keine Absicherung, und `app.use()` nach der Route ist es ebenso wenig.

Dieser letzte Punkt ist besonders wichtig. Er macht den Unterschied zwischen einer Middleware, die
ausgeführt wird, und einer, die es nicht wird – und ein Assistent, dem man dies nicht ausdrücklich gesagt hat,
schreibt zuverlässig die Version, die nicht funktioniert – siehe
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` lässt nur die Rolle `admin` zu. Wenn eine spezifischere Rolle oder ein API-Schlüssel
eine Route aufrufen können soll, ist der entsprechende Guard `requireScope` mit einem von der App deklarierten
Scope – siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/#app-scopes).

Nach den Regeln folgen zwei Abschnitte, die nur für bestimmte Projekte gelten. **Backend
runtime** listet auf, was die verwaltete Laufzeitumgebung auf Rebase Cloud erlaubt: Pakete,
Arbeitsspeicher und Status auf Modulebene, Timeouts, ausgehende Ports, Konfiguration und
Speicher für generierte Dateien. Es verlinkt auf
[Managed backend runtime](/docs/deployment/managed-runtime/), damit ein Assistent
ein Backend-Feature anhand realer Limits plant, anstatt zu raten. **Admin UI**
enthält die Regeln für `@rebasepro/ui` sowie die Checkliste für den `customizeTable`-Durchlauf,
den jede Tabelle benötigt, bevor ein Admin-Bereich als fertig gilt: ein Titel, die aufgelisteten Spalten, ausgeblendete
IDs, Fremdschlüssel und Roh-JSON, Labels, eine Zusammenfassung für JSON-Spalten und ein Blick auf das
laufende Admin-Panel. Diese Regeln gelten für Ansichten innerhalb des Admin-Panels, nicht für eine
öffentliche Website oder eine statische App, die das Projekt bereitstellt.

## Individuelle Anpassung

`ai-instructions.md` ist Ihre Datei. Nichts generiert sie neu oder überschreibt sie – anders als
[installierte Skills](/docs/ai/skills), die bei jedem
`rebase skills install` ersetzt werden. Projektspezifische Konventionen gehören hierher.

Eine Ausnahme gilt für Dateien, die noch niemand berührt hat: Bei einem Headless-Projekt besagt die
`ai-instructions.md`, dass die Datenbank das Schema ist und dass es kein
`backend/schema/` gibt, und `rebase schema introspect` schreibt genau dieses
Verzeichnis. Wenn die Datei noch Byte für Byte dem entspricht, was das Gerüst generiert hat,
ersetzt die Introspektion sie durch die Backend-only-Schema-in-Code-Regeln; sobald Sie sie
bearbeitet haben, bleibt sie unverändert, und der Befehl gibt an, welche ihrer Regeln nicht mehr zutreffen.

Dort hinein gehört alles, was ein Assistent nicht aus dem Code ableiten kann: welche
Tabellen veraltet sind, welcher Dienst welche Tabelle besitzt, die Namenskonvention,
die nirgendwo erzwungen wird, die Migration, die keinesfalls erneut ausgeführt werden darf. Halten Sie
sie kurz – Anweisungen, die bei jedem Request geladen werden, konkurrieren mit der eigentlichen Aufgabe
um Aufmerksamkeit, und eine lange Datei wird von einem Assistenten nur überflogen.

Und behalten Sie die Grenzen im Blick: Diese Datei bestimmt, was ein Assistent *schreibt*. Sie
hat keinen Einfluss darauf, was ein mit Ihrer Datenbank verbundener Agent *tun darf* – das wird
durch die Credentials bestimmt, die er besitzt, und nichts in Markdown kann daran etwas ändern. Siehe
[das Berechtigungsmodell des MCP-Servers](/docs/ai/mcp#what-the-server-can-reach).
