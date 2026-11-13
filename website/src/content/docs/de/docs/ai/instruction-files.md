---
sourceHash: 80e40ea5912a48c8
title: KI-Anweisungsdateien
sidebar_label: KI-Anweisungsdateien
description: Jedes per Gerüst erstellte Rebase-Projekt liefert ai-instructions.md sowie Pointer-Dateien für Claude, Cursor, Windsurf, Copilot und AGENTS.md aus, die die fünf Regeln enthalten, die Assistenten am häufigsten verletzen – eine Single Source of Truth, viele Dateinamen.
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jeder Assistent erwartet seine Regeln in einer anderen Datei. Claude Code liest
`CLAUDE.md`, Cursor liest `.cursorrules`, Windsurf liest `.windsurfrules`,
Copilot liest `.github/copilot-instructions.md`, und die anbieterübergreifende Konvention
lautet `AGENTS.md`. Dieselben Anweisungen in fünf Dateien zu pflegen führt dazu, dass vier
davon veralten.

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

Jede Pointer-Datei benennt die eigentliche Datei, gibt an, wo sich die Skills befinden, und enthält die fünf Regeln, die ein Assistent keinesfalls verletzen darf, selbst wenn er nie etwas anderes öffnet:

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
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Die anderen unterscheiden sich nur im Skills-Verzeichnis des Agenten und dessen `--agent`-Wert –
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` – sowie im
relativen Pfad, der in `.github/copilot-instructions.md` `../ai-instructions.md` und in
`AGENTS.md` `ai-instructions.md` lautet. Die dritte Zeile ist konditional, da
`rebase init --agent` die Skills möglicherweise bereits installiert hat, bevor der Assistent
sie überhaupt liest.

Dies geschieht bei jedem `rebase init`, für jedes Preset einschließlich `--headless`.
Es gibt kein Flag und keine Eingabeaufforderung.

`rebase init` schreibt auch `.mcp.json`, was Claude Code, Cursor und jeden anderen MCP-Client
auf den [Rebase-MCP-Server](/docs/ai/mcp) verweist – die projekteigene Kopie, eine
devDependency, die mit der CLI gepinnt ist (`npx --no rebase-mcp` in einem npm-Projekt):

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

`REBASE_PROJECT_DIR` ist `"."`, kein absoluter Pfad: Der Client startet den Server im
Projektstammverzeichnis, und ein absoluter Pfad ist die einzige Zeile dieser Datei, die
nicht committet werden kann. Sie ist vorhanden, weil `~/.rebase/projects.json`
maschinenweit gilt – ein Projekt, das kein eigenes Verzeichnis angibt, fällt auf das
zurück, was das letzte Projekt auf diesem Rechner persistiert hat. Siehe
[die Rangfolge](/docs/ai/mcp#which-directory-it-acts-on).

## Warum ein Pointer statt einer Kopie

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Pointer-Dateien enthalten fast nichts. Eine Datei, die die eigentliche Datei referenziert,
behält die Konventionen an einem zentralen Ort und hat Eigenschaften, die eine Kopie nicht besitzt:

- **Nur eine Datei zum Bearbeiten.** Regeln können zwischen Assistenten nicht
  auseinanderdriften, da es nur ein einziges Regelwerk gibt.
- **Nur ein Diff zum Überprüfen.** Eine Änderung der Projektkonventionen ist eine
  Änderung an einer Datei, nicht an fünf identischen, die ein Reviewer vergleichen muss.
- **Einen Assistenten hinzuzufügen erfordert nur eine kleine Datei.** Ein neues Tool mit einem
  neuen Dateinamen erhält einen Pointer, keine sechste Kopie Ihrer Konventionen.

Die einzige Ausnahme ist der Block **Before you write any code**. Ein Assistent folgt
einem Link nicht zuverlässig: Einer, der mit einer Aufgabe beschäftigt ist, schreibt zuerst den
Code, und ein Assistent, der im Root eines Repositorys gestartet wird, dessen Rebase-Projekt in einem
Unterordner liegt, lädt diese Dateien überhaupt nicht. Daher werden die fünf Regeln, deren
Verletzung den größten Schaden anrichtet (eine in SQL statt in `backend/schema` erstellte Tabelle,
Daten, die am SDK vorbei gelesen und geschrieben werden, eine ungeschützte Route, ein Deployment,
eine bearbeitete generierte Datei), identisch in jeden Pointer geschrieben. Eine Überprüfung in
der CI sorgt dafür, dass die fünf Kopien synchron bleiben.

Dieses Muster lohnt sich beizubehalten, wenn Sie das Gerüst forken, und lohnt sich auch für
Repositories zu übernehmen, die überhaupt keine Rebase-Projekte sind.

## Womit `ai-instructions.md` beginnt

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die per Gerüst erstellte Datei ist bewusst kurz gehalten – sie verweist für Details auf
[`rebase skills install`](/docs/ai/skills) und nennt dann die Regeln, die Assistenten so oft
falsch machen, dass es sich lohnt, sie zu Beginn jeder Sitzung zu wiederholen:

1. **Schema als Code.** Eine Tabelle ist ein `defineTable` in `backend/schema/<table>.ts`,
   exportiert aus `backend/schema/index.ts` – nur was der Index exportiert, wird
   bereitgestellt – mit einem erforderlichen `rls`. Bearbeiten Sie niemals das generierte
   Drizzle-Schema oder die Postgres-Tabellen manuell – siehe [Schema as Code](/docs/architecture/schema-as-code).
2. **Das Anwenden einer Schemaänderung** hängt von der Datenbank ab. Während `pnpm dev`
   läuft, reicht das Speichern einer Datei in `backend/schema/` vollkommen aus: Es generiert
   das Drizzle-Schema und die SDK-Typen neu, und beim Booten werden die fehlenden Tabellen
   und Spalten erstellt. `pnpm db:push` ist nur für das gedacht, was beim Booten bewusst
   unangetastet bleibt – eine umbenannte Spalte, ein eingeschränkter Typ, eine entfernte
   Spalte – sowohl in der Managed-Development-Datenbank als auch in Ihrem eigenen PostgreSQL.
   Für die Produktion gilt `pnpm db:generate`, gefolgt von `pnpm db:migrate`.
3. **Verwenden Sie das SDK.** Nutzen Sie `rebase.dataAsAdmin.<table>` für Aktionen als
   Service-Identität oder `getDriver(c)` innerhalb einer Funktion, wenn der Lesevorgang als
   der Aufrufer ausgeführt werden soll. Der Server-Client hat keinen einfachen `data`-Accessor.
   Natives SQL und direkte Drizzle-Aufrufe umgehen Validierung, Hooks und RLS.
4. **Sichern Sie jede benutzerdefinierte Route ab.** Routen in `backend/functions/` werden
   *ohne* Authentifizierung eingebunden. Verwenden Sie `requireAuth` / `requireAdmin` aus
   `@rebasepro/server/functions` im eigenen Middleware-Slot der Route – das Auslesen von
   `c.get("user")` ist kein Schutz, und `app.use()` nach der Route ebenfalls nicht.

Der letzte Punkt ist besonders wichtig. Er macht den Unterschied zwischen einer Middleware,
die ausgeführt wird, und einer, die nicht ausgeführt wird, und ein Assistent, dem dies nicht
mitgeteilt wurde, wird verlässlich die Version schreiben, die nicht ausgeführt wird – siehe
[Benutzerdefinierte Funktionen](/docs/backend/custom-functions).

`requireAdmin` lässt nur die Rolle `admin` zu. Wenn eine spezifischere Rolle oder ein
API-Schlüssel eine Route aufrufen können soll, ist der hinzuzufügende Schutz `requireScope`
mit einem Scope, den die App deklariert – siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/#app-scopes).

Nach den Regeln folgen zwei Abschnitte, die nur für manche Projekte gelten. **Backend-Runtime**
listet auf, was die Managed-Runtime auf Rebase Cloud erlaubt: Pakete, Speicher und Zustand auf
Modulebene, Timeouts, ausgehende Ports, Konfiguration und Speicherplatz für generierte Dateien.
Der Abschnitt verlinkt auf [Managed Backend-Runtime](/docs/deployment/managed-runtime/), damit ein
Assistent ein Backend-Feature anhand realer Limits plant, anstatt zu raten. **Admin-UI**
enthält die `@rebasepro/ui`-Regeln. Sie gelten für Ansichten innerhalb des Admin-Panels, nicht
für eine öffentliche Website oder eine statische App, die das Projekt ausliefert.

## Anpassung an Ihr Projekt

`ai-instructions.md` ist Ihre Datei. Nichts generiert sie neu oder überschreibt sie – im
Gegensatz zu [installierten Skills](/docs/ai/skills), die bei jedem `rebase skills install`
ersetzt werden. Projektspezifische Konventionen gehören hierhin.

Was hier seinen Platz verdient, ist das, was ein Assistent nicht aus dem Code ableiten kann:
welche Tabellen veraltet (Legacy) sind, welcher Dienst welche Tabelle besitzt, die
Namenskonvention, die nirgendwo erzwungen wird, die Migration, die nicht erneut ausgeführt
werden darf. Halten Sie es kurz – Instruktionen, die bei jedem Request geladen werden,
konkurrieren mit der eigentlichen Aufgabe um Aufmerksamkeit, und eine lange Datei wird von
einem Assistenten nur überflogen.

Und behalten Sie die Grenzen im Blick: Diese Datei bestimmt, was ein Assistent *schreibt*.
Sie hat keinen Einfluss darauf, was ein mit Ihrer Datenbank verbundener Agent *tun darf* – das
wird durch die Zugangsdaten bestimmt, die er besitzt, und nichts in Markdown ändert das. Siehe
[das Zugangsdaten-Modell des MCP-Servers](/docs/ai/mcp#what-the-server-can-reach).
