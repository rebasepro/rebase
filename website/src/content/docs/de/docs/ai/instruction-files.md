---
title: KI-Instruktionsdateien
sidebar_label: KI-Instruktionsdateien
description: Jedes erstellte Rebase-Projekt enthält ai-instructions.md sowie einzeilige Pointer-Dateien für Claude, Cursor, Windsurf, Copilot und AGENTS.md – eine Single Source of Truth, viele Dateinamen.
---

Jeder Assistent erwartet seine Regeln in einer anderen Datei. Claude Code liest
`CLAUDE.md`, Cursor liest `.cursorrules`, Windsurf liest `.windsurfrules`,
Copilot liest `.github/copilot-instructions.md` und die herstellerübergreifende
Konvention ist `AGENTS.md`. Dieselben Anweisungen in fünf Dateien zu pflegen,
führt unweigerlich dazu, dass vier davon veralten.

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

Jede Pointer-Datei besteht aus zwei Zeilen:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
```

`.github/copilot-instructions.md` ist bis auf den relativen Pfad
(`../ai-instructions.md`) identisch.

Dies geschieht bei jedem `rebase init`, für jedes Preset einschließlich `--headless`.
Es gibt kein Flag und keine Eingabeaufforderung.

## Warum ein Pointer statt einer Kopie

Die Pointer-Dateien sind bewusst frei von Inhalten. Assistenten folgen relativen
Markdown-Links, sodass eine zweizeilige Datei, die auf die eigentliche Datei
verweist, dasselbe Ergebnis erzielt wie eine Kopie – und sie bietet Vorteile, die
eine Kopie nicht hat:

- **Nur eine Datei zum Bearbeiten.** Regeln können zwischen Assistenten nicht
  voneinander abweichen, da es nur ein einziges Regelwerk gibt.
- **Nur ein Diff zu prüfen.** Eine Änderung an den Projektkonventionen ist eine
  Änderung an einer einzigen Datei und nicht an fünf identischen Dateien, die ein
  Reviewer vergleichen muss.
- **Das Hinzufügen eines Assistenten erfordert nur zwei Zeilen.** Ein neues Tool
  mit einem neuen Dateinamen erhält einen Pointer und keine sechste Kopie Ihrer
  Konventionen.

Es lohnt sich, dieses Muster beizubehalten, wenn Sie das Scaffold forken, und es
lohnt sich auch, es in Repositories zu übernehmen, die überhaupt keine
Rebase-Projekte sind.

## Womit `ai-instructions.md` beginnt

Die generierte Datei ist bewusst kurz gehalten – sie verweist für Details auf
[`rebase skills install`](/docs/ai/skills) und formuliert dann die Regeln, die
Assistenten oft genug falsch machen, sodass es sich lohnt, sie zu Beginn jeder
Sitzung zu wiederholen:

1. **Schema as Code.** Collections werden in `config/collections/` definiert.
   Bearbeiten Sie niemals das generierte Drizzle-Schema oder die Postgres-Tabellen
   manuell – siehe [Schema as Code](/docs/architecture/schema-as-code).
2. **Migrationen bestehen aus zwei Schritten.** `rebase schema generate`, dann
   `rebase db push` in der Entwicklung oder `rebase db generate && rebase db migrate`
   für die Produktion.
3. **Nutzen Sie das SDK.** Gehen Sie über `rebase.dataAsAdmin.<slug>` für Arbeit
   unter der Dienstidentität oder über `getDriver(c)` innerhalb einer Function,
   wenn der Lesezugriff als Aufrufer laufen soll. Auf dem Server hat der Client keinen
   einfachen `data`-Accessor. natives SQL und
   direkte Drizzle-Aufrufe umgehen Validierung, Callbacks und RLS.
4. **Schützen Sie jede benutzerdefinierte Route.** Routen in `backend/functions/`
   werden *ohne* Authentifizierung eingebunden. Verwenden Sie `requireAuth` /
   `requireAdmin` aus `@rebasepro/server/functions` im route-eigenen Middleware-Slot – das
   Auslesen von `c.get("user")` ist kein Schutz, und `app.use()` nach der Route
   ebenfalls nicht.

Besonders der letzte Punkt ist entscheidend. Er macht den Unterschied zwischen
einer Middleware, die ausgeführt wird, und einer, die es nicht wird. Ein Assistent,
dem dies nicht mitgeteilt wurde, wird verlässlich die Version schreiben, die nicht
funktioniert – siehe [Custom Functions](/docs/backend/custom-functions).

## Individuelle Anpassung

`ai-instructions.md` ist Ihre Datei. Sie wird durch nichts neu generiert oder
überschrieben – im Gegensatz zu [installierten Skills](/docs/ai/skills), die bei
jedem `rebase skills install` ersetzt werden. Projektspezifische Konventionen
gehören hierhin.

Hierhin gehört alles, was ein Assistent nicht aus dem Code ableiten kann: welche
Collections veraltet sind, welcher Service welche Tabelle besitzt, die
Namenskonvention, die nirgendwo erzwungen wird, oder die Migration, die nicht
erneut ausgeführt werden darf. Halten Sie es kurz – Instruktionen, die bei jedem
Request geladen werden, konkurrieren mit der eigentlichen Aufgabe um
Aufmerksamkeit, und eine lange Datei wird von einem Assistenten nur überflogen.

Und beachten Sie die Grenze: Diese Datei beeinflusst, was ein Assistent *schreibt*.
Sie hat keinen Einfluss darauf, was ein mit Ihrer Datenbank verbundener Agent
*tun* darf – dies wird durch die Anmeldeinformationen (Credentials) bestimmt,
über die er verfügt, und nichts im Markdown kann das ändern. Siehe
[das Credential-Modell des MCP-Servers](/docs/ai/mcp#what-the-server-can-reach).

---
