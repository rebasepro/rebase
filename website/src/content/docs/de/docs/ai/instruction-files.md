---
sourceHash: ffe9f58fdca0c8bc
title: KI-Instruktionsdateien
sidebar_label: KI-Instruktionsdateien
description: Jedes über Scaffolding erstellte Rebase-Projekt enthält ai-instructions.md sowie Pointer-Dateien für Claude, Cursor, Windsurf, Copilot und AGENTS.md, die die fünf Regeln enthalten, gegen die Assistenten am häufigsten verstoßen – eine Single Source of Truth, viele Dateinamen.
---

Jeder Assistent erwartet seine Regeln in einer anderen Datei. Claude Code liest
`CLAUDE.md`, Cursor liest `.cursorrules`, Windsurf liest `.windsurfrules`,
Copilot liest `.github/copilot-instructions.md`, und die herstellerübergreifende Konvention
lautet `AGENTS.md`. Dieselben Richtlinien in fünf Dateien zu pflegen, führt unweigerlich dazu,
dass vier davon veralten.

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

Jede Pointer-Datei nennt die eigentliche Datei, sagt, wo die Skills liegen, und enthält die fünf Regeln, gegen die ein Assistent nicht verstoßen darf, auch wenn er nichts anderes öffnet:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a collection.** Declare it in `config/collections/<name>.ts` with `defineCollection`, and `pnpm dev` creates it. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and callbacks, so keep it for server work that needs every row and for reading a column marked `excludeFromApi`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its collection from `pnpm schema:introspect`.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<slug>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit `.env`, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Unter Version 0.23 weist die dritte Zeile den Assistenten lediglich an,
`rebase skills install --agent claude` auszuführen, und die unten stehende `.mcp.json` startet den
Server mit `npx -y @rebasepro/mcp` aus der Registry.

Die anderen unterscheiden sich nur im Skills-Verzeichnis des Agenten und seinem `--agent`-Wert –
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` – sowie
im relativen Pfad, der in `.github/copilot-instructions.md` `../ai-instructions.md` und
in `AGENTS.md` `ai-instructions.md` lautet. Die dritte Zeile ist konditional, da
`rebase init --agent` die Skills möglicherweise bereits installiert hat, bevor der Assistent sie jemals liest.

Dies geschieht bei jedem `rebase init`, für jedes Preset einschließlich `--headless`.
Es gibt kein Flag und keine Eingabeaufforderung.

`rebase init` erstellt außerdem `.mcp.json`, was Claude Code, Cursor und
jeden anderen MCP-Client auf den [Rebase-MCP-Server](/docs/ai/mcp) verweist – die projekteigene
Kopie, eine devDependency, die mit der CLI gepinnt ist (`npx --no rebase-mcp` in einem
npm-Projekt):

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
im Projekt-Root, und ein absoluter Pfad wäre die eine Zeile dieser Datei, die
nicht committet werden kann. Sie ist vorhanden, weil `~/.rebase/projects.json`
rechnerweit gilt – ein Projekt, das kein eigenes Verzeichnis angibt, fällt auf das zurück,
was das letzte Projekt auf diesem Rechner persistiert hat. Siehe
[die Rangfolge](/docs/ai/mcp#which-directory-it-acts-on).

## Warum ein Pointer statt einer Kopie

Die Pointer-Dateien enthalten fast nichts. Eine Datei, die auf die eigentliche verweist,
hält die Konventionen an einem Ort, und sie besitzt Eigenschaften, die eine Kopie nicht hat:

- **Nur eine Datei zum Bearbeiten.** Regeln können zwischen verschiedenen Assistenten nicht
  auseinanderdriften, da es nur ein einziges Regelwerk gibt.
- **Nur ein Diff zum Reviewen.** Eine Änderung der Projektkonventionen ist eine Änderung an einer
  einzigen Datei, nicht an fünf identischen Dateien, die ein Reviewer vergleichen muss.
- **Das Hinzufügen eines Assistenten ist eine kleine Datei.** Ein neues Tool mit einem neuen
  Dateinamen erhält einen Pointer, keine sechste Kopie Ihrer Konventionen.

Die einzige Ausnahme ist der Block **Before you write any code**. Ein Assistent folgt einem
Link nicht zuverlässig: Einer, der mit einer Aufgabe beschäftigt ist, schreibt zuerst den Code,
und einer, der im Wurzelverzeichnis eines Repositorys gestartet wird, dessen Rebase-Projekt in
einem Unterordner liegt, lädt diese Dateien überhaupt nicht. Deshalb stehen die fünf Regeln,
deren Verletzung den größten Schaden anrichtet (eine im Code statt als Collection erstellte
Tabelle, Daten, die am SDK vorbei gelesen und geschrieben werden, eine ungeschützte Route, ein
Deploy, eine bearbeitete generierte Datei), identisch in jedem Pointer. Eine Prüfung in der CI
hält die fünf Kopien gleich.

Es lohnt sich, dieses Muster beizubehalten, wenn Sie das Scaffold forken, und es lohnt sich, es
in Repositories zu übernehmen, die überhaupt keine Rebase-Projekte sind.

## Womit `ai-instructions.md` beginnt

Die über das Scaffolding erstellte Datei ist bewusst kurz gehalten – sie verweist für vertiefende Details
auf [`rebase skills install`](/docs/ai/skills) und nennt anschließend die Regeln, die
Assistenten oft genug falsch machen, sodass es sich lohnt, sie zu Beginn jeder Session
zu wiederholen:

1. **Schema as Code.** Collections werden in `config/collections/` definiert. Bearbeiten Sie niemals
   manuell das generierte Drizzle-Schema oder die Postgres-Tabellen – siehe
   [Schema as Code](/docs/architecture/schema-as-code).
2. **Das Anwenden einer Collection-Änderung** hängt von der Datenbank ab. Während `pnpm dev`
   läuft, ist das Speichern der Collection-Datei bereits der gesamte Schritt: Der Boot-Prozess regeneriert
   das Drizzle-Schema und erstellt die fehlenden Tabellen und Spalten. `pnpm db:push` ist
   nur für das gedacht, was der Boot-Prozess bewusst unberührt lässt – eine umbenannte Spalte, ein eingeschränkter
   Typ, ein entferntes Feld – sowohl auf der verwalteten Entwicklungsdatenbank als auch auf Ihrem eigenen
   PostgreSQL. Für die Produktion gilt `pnpm db:generate`, gefolgt von `pnpm db:migrate`.
   Unter 0.24 erfordert `pnpm db:push` ein eigenes PostgreSQL, und die Datei weist darauf hin.
3. **Verwenden Sie das SDK.** Nutzen Sie `rebase.dataAsAdmin.<slug>` für Aktionen, die als
   Service-Identität ausgeführt werden, oder `getDriver(c)` innerhalb einer Funktion, wenn der Lesevorgang
   als Aufrufer ausgeführt werden soll. Der Server-Client verfügt über keinen einfachen `data`-Accessor. Natives
   SQL und direkte Drizzle-Aufrufe umgehen Validierung, Callbacks und RLS.
4. **Sichern Sie jede benutzerdefinierte Route ab.** Routen in `backend/functions/` werden
   *ohne* Authentifizierung eingebunden. Verwenden Sie `requireAuth` / `requireAdmin` aus
   `@rebasepro/server/functions` im Middleware-Slot der Route selbst – das Auslesen von
   `c.get("user")` stellt keine Absicherung dar, und `app.use()` nach der Route ebenso wenig.

Dieser letzte Punkt ist besonders wichtig. Er macht den Unterschied aus zwischen einer Middleware,
die ausgeführt wird, und einer, die es nicht wird – und ein Assistent, der nicht darauf hingewiesen
wurde, wird verlässlich die Version schreiben, die nicht ausgeführt wird – siehe
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` lässt ausschließlich die Rolle `admin` zu. Wenn eine spezifischere Rolle oder ein API-Schlüssel
eine Route aufrufen können soll, ist `requireScope` der hinzuzufügende Guard mit einem Scope,
den die App deklariert – siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/#app-scopes).

Nach den Regeln folgen zwei Abschnitte, die nur für bestimmte Projekte gelten. **Backend
runtime** listet auf, was die verwaltete Runtime auf Rebase Cloud erlaubt: Pakete,
Speicher und Zustand auf Modulebene, Timeouts, ausgehende Ports, Konfiguration und
Speicherplatz für generierte Dateien. Es verlinkt auf
[Managed backend runtime](/docs/deployment/managed-runtime/), damit ein Assistent
ein Backend-Feature anhand realer Limits plant, anstatt zu raten. **Admin UI**
enthält die Regeln für `@rebasepro/ui`. Sie gelten für Ansichten innerhalb des Admin-Panels, nicht
für eine öffentliche Website oder eine statische App, die das Projekt bereitstellt.

## An die eigenen Bedürfnisse anpassen

`ai-instructions.md` ist Ihre Datei. Nichts regeneriert oder überschreibt sie – im Gegensatz zu
[installierten Skills](/docs/ai/skills), die bei jedem
`rebase skills install` ersetzt werden. Projektspezifische Konventionen gehören hierher.

Einen Platz hier verdient alles, was ein Assistent nicht aus dem Code ableiten kann: welche
Collections veraltet sind, welcher Service welche Tabelle besitzt, die Namenskonvention,
die nirgendwo erzwungen wird, die Migration, die keinesfalls erneut ausgeführt werden darf. Halten Sie sie
kurz – Anweisungen, die bei jedem Request geladen werden, konkurrieren mit der eigentlichen Aufgabe
um Aufmerksamkeit, und eine lange Datei wird von einem Assistenten nur überflogen.

Und behalten Sie die Grenzen im Blick: Diese Datei beeinflusst, was ein Assistent *schreibt*. Sie
hat keinen Einfluss darauf, was ein mit Ihrer Datenbank verbundener Agent *tun* darf – das
wird durch die Credentials bestimmt, über die er verfügt, und nichts in Markdown ändert daran etwas. Siehe
[das Credential-Modell des MCP-Servers](/docs/ai/mcp#what-the-server-can-reach).
