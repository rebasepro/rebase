---
sourceHash: 87e4ee6ea63add18
title: Skripte und die Konsole
sidebar_label: Skripte und die Konsole
description: Öffnen Sie die Daten eines Projekts aus einem Skript, einem Test oder einer REPL mit openRebase oder aus dem Terminal mit rebase console. Kein Server, keine Schemaänderungen.
---

## Übersicht

Um einige Zeilen anzusehen, eine zu korrigieren, einen Filter auszuprobieren oder zu prüfen, was eine Richtlinie für einen Benutzer sichtbar macht, sollten Sie keinen Server starten müssen. Rebase stellt Ihnen die Projektdaten als Objekt an zwei Orten zur Verfügung:

- **`rebase console`**, eine Node-REPL in Ihrem Terminal mit geöffnetem Projekt;
- **`openRebase`**, dasselbe Objekt in einem eigenen Skript oder Test.

Beide öffnen die Datenbank, ohne sie zu verändern: Es werden weder Tabellen, Rollen, Trigger noch Funktionen erstellt. Das `close()` eines Skripts beendet das, was `openRebase` geöffnet hat. Auf der verwalteten Entwicklungsdatenbank startet `rebase console` diese Datenbank, wenn sie nicht läuft, und lässt sie danach weiterlaufen, wie es auch die `rebase db`-Befehle tun; `rebase db stop` stoppt sie. Das Objekt verfügt über das gleiche Vokabular, das eine [benutzerdefinierte Funktion](/docs/backend/custom-functions/) vom Server erhält, `dataAsAdmin` und `sql`, sodass ein Code-Snippet unverändert zwischen einer Funktion, einem Skript und der Konsole verschoben werden kann.

## `rebase console`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Führen Sie es in Ihrem Projekt aus:

```bash
rebase console
```

```text
> const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 })
> data.map(p => p.title)
[ 'Draft', 'Second post', 'Hello' ]
> const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] })
> (await ada.data.posts.find({ limit: 3 })).data.length
3
```

Zwei Bezeichner befinden sich im Scope, und Top-Level-`await` funktioniert:

| Name | Beschreibung |
|---|---|
| `rebase` | Was [`openRebase`](#openrebase) zurückgibt: `dataAsAdmin`, `sql`, `withAuth(user)` und `close()` |
| `tables` | Die Deskriptoren der vom Projekt bereitgestellten Tabellen, geladen aus `backend/schema`, genau wie `rebase db push` sie lädt (`rebase.tables`) |

Die Konsole öffnet das Projekt so wie `rebase db push`: dieselbe `.env`, dieselbe Datenbank und dieselben Tabellen aus `backend/schema`. Sie lädt auch die globalen `hooks` aus `backend/hooks.ts`, sodass Schreibvorgänge dieselben Hooks wie ein Server-Schreibvorgang ausführen. Bei einem Projekt auf der verwalteten Entwicklungsdatenbank wird diese zuerst gestartet. Der Verlauf Ihrer Eingaben wird in `.rebase/console_history` gespeichert, was in der `.gitignore` des Gerüsts bereits ausgeschlossen ist.

Eingepipter Input wird Zeile für Zeile ausgeführt, jeweils nachdem das `await` der vorherigen Zeile aufgelöst wurde, sodass das obige Transkript als `printf '…\n…\n' | rebase console` funktioniert. Alles nach `.exit` wird ignoriert, und Werte werden nur im Terminal farbig dargestellt. Alles, was die Konsole protokolliert, wird an stderr ausgegeben.

### Ein einzelnes Snippet: `--eval`

`rebase console -e "<code>"` führt ein einzelnes Code-Stück anstelle der REPL aus. Der Wert eines Ausdrucks oder das `return` eines Funktionskörpers wird per await abgewartet und als JSON auf stdout ausgegeben, sodass die Ausgabe weitergeleitet werden kann:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Alles, was die Konsole protokolliert – unabhängig davon, was `LOG_LEVEL` angibt –, geht an stderr, sodass stdout ausschließlich das Ergebnis enthält. Ein Snippet, das einen Fehler wirft, gibt den Fehler auf stderr aus und beendet sich mit `1`.

Eine Datenbank, die von der Konsole nicht geöffnet werden kann, wird einmalig gemeldet und der Befehl wird mit `1` beendet: entweder mit dem Banner „Cannot connect to PostgreSQL“, das die `db`-Befehle ausgeben, oder auf der verwalteten Entwicklungsdatenbank mit dem Hinweis, dass keine freie Verbindung verfügbar ist. Diese Datenbank akzeptiert nur wenige gleichzeitige Verbindungen und ein laufendes `rebase dev` belegt einige davon. Schließen Sie daher einen anderen Client oder stoppen Sie `rebase dev` und führen Sie es erneut aus.

### Optionen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Flag | Beschreibung |
|---|---|
| `--eval`, `-e` | Führt diesen Code anstelle der REPL aus, gibt das per await abgewartete Ergebnis als JSON aus und beendet sich mit 1, falls ein Fehler auftritt |
| `--schema-dir` | Das Schema-Verzeichnis, falls nicht das projekteigene (`backend/schema` oder der `tables`-Schlüssel in `rebase.json`) |
| `--database-url` | Öffnet diese Datenbank anstelle der des Projekts |
| `--docker` | Verwendet die Datenbank aus Docker Compose und startet sie bei Bedarf |

## `openRebase`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`openRebase` aus `@rebasepro/server-postgres` ist die Funktion, die von der Konsole aufgerufen wird. Verwenden Sie sie in einem Skript, einem Seed-Skript, einer Datenbereinigung oder einem Test. Legen Sie das Skript in einem per Scaffold erstellten Projekt unter `backend/` ab, beispielsweise `backend/scripts/publish-drafts.ts`: Der Backend-Workspace ist derjenige, der von `@rebasepro/server-postgres` abhängt, und ein Skript im Stammordner `scripts/` kann dieses Paket nicht importieren.

`openRebase` erwartet die Tabellen des Projekts in kompilierter Form: `compileSchema` aus `@rebasepro/common` wandelt die `defineTable`-Ergebnisse in die Tabellen um, auf denen der Treiber operiert, einschließlich der Hooks. Legen Sie dies in einem gemeinsamen Modul ab, das sich die Skripte teilen, `backend/scripts/tables.ts`, nachdem Sie `@rebasepro/common` zu `backend/package.json` hinzugefügt haben:

```typescript no-verify
import { compileSchema } from "@rebasepro/common";
import * as schema from "../schema";

// Every table the index exports, and the defaultRls its "inherit" tables take.
export const tables = compileSchema(
    [schema.users, schema.posts, schema.authors, schema.tags],
    { defaultRls: schema.defaultRls }
);
```

Übergeben Sie die von `backend/hooks.ts` exportierten globalen Hooks als `hooks`, damit Schreibvorgänge eines Skripts diese wie ein Server-Schreibvorgang ausführen. Ohne sie wird ein globales `beforeSave`, das einen Mandanten zuweist oder einen Audit-Eintrag schreibt, bei keinem Schreibvorgang des Skripts ausgeführt. Wenn Sie `tables` weglassen, liest `openRebase` die Tabellen aus der Datenbank aus, genau wie ein Server ohne `backend/schema`. `rebase console` lädt beides automatisch für Sie.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Führen Sie es aus `backend/` aus. `rebase db url` gibt die URL der vom Projekt verwendeten Datenbank aus, einschließlich der verwalteten Entwicklungsdatenbank:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Member | Beschreibung |
|---|---|
| `dataAsAdmin` | Jede Tabelle, gelesen und geschrieben als Service-Identität des Servers (`{ uid: "service", roles: ["admin"] }`): Administratorrechte, weiterhin ausgewertet durch Ihre RLS-Richtlinien, genau wie `rebase.dataAsAdmin` in einer Funktion |
| `sql(query, { params })` | Reines SQL auf der Owner-Verbindung mit denselben Aufrufkonventionen wie `rebase.sql` in einer Funktion. Es wird auf der einzigen geöffneten Datenquelle ausgeführt: Ein `{ database }`, das eine andere angibt, wird abgelehnt |
| `withAuth(user)` | Löst zu `{ data }` auf: die Tabellen so, wie dieser Benutzer sie sieht. Jeder Lese- und Schreibvorgang wird unter seiner Identität ausgeführt und durch Row-Level Security gefiltert, genau wie eine HTTP-Anfrage dieses Benutzers |
| `tables` | Die Deskriptoren der bereitgestellten Tabellen: entweder die übergebenen oder die von der Datenbank beschriebenen |
| `close()` | Beendet den von `openRebase` erstellten Connection-Pool. Kann sicher mehrfach aufgerufen werden |

Die Optionen:

| Option | Beschreibung |
|---|---|
| `databaseUrl` | Die zu öffnende Datenbank. `openRebase` erstellt den Pool und `close()` beendet ihn |
| `connection` | Eine Drizzle-Verbindung, die Sie bereits halten (`createPostgresDatabaseConnection(url).db`), anstelle von `databaseUrl`. Sie bleibt in Ihrer Verwaltung: `close()` lässt sie geöffnet |
| `tables` | Die Tabellen des Projekts, kompiliert mit `compileSchema` (siehe oben). Fehlt diese Angabe oder ist sie leer, werden die Tabellen stattdessen aus der Datenbank gelesen, wie bei einem Server ohne `backend/schema`, und schreibgeschützt bereitgestellt |
| `pool` | Pool-Einstellungen, zusammen mit `databaseUrl` |
| `dataSourceKey` | Die Datenbank, aus der diese Tabellen bereitgestellt werden. Standardwert ist `(default)` |
| `hooks` | Die globalen Hooks des Projekts: die von `backend/hooks.ts` exportierten `hooks`, die der Server vor den tabelleneigenen Hooks ausführt. Wenn Sie sie hier übergeben, werden sie auch bei Skript-Schreibvorgängen ausgeführt. `rebase console` übernimmt dies automatisch für Sie |

`openRebase` liest keine Umgebungsvariablen aus. Das obige `DATABASE_URL` wird von Ihrem Skript gelesen, und Einstellungen wie `REBASE_DB_POOL_MAX` oder `REALTIME_CDC` haben hier keine Auswirkung.

Beim Öffnen wird auf `info`-Ebene nichts protokolliert, sodass stdout ausschließlich die Ausgaben des Skripts enthält und `tsx scripts/report.ts > report.json` nur dessen JSON schreibt. Warnungen und Fehler gehen in der Entwicklung an stderr. Der Hinweis zur Request-Isolierung (`RLS enforcement active`) wird unter `debug` protokolliert; beim Starten eines Servers wird er weiterhin unter `info` ausgegeben. Eine nicht erreichbare Datenbank lehnt das Öffnen mit einem einzigen Fehler ab (`Cannot connect to PostgreSQL at <host>:<port>: <reason>.`) und protokolliert nichts weiter: Was ausgegeben werden soll, entscheidet das Skript.

Die Accessoren sind über das `Database`-Interface typisiert, das von `rebase generate-sdk --register` registriert wird – genau wie das `rebase` einer Funktion. Ein Tippfehler bei einer Tabelle, einem Feld oder einem Enum-Wert in einem Skript führt daher zu einem Typfehler. Die `backend/tsconfig.json` des Gerüsts schließt `scripts/` ein, sodass `tsc --noEmit` in `backend/` diesen Fehler meldet. Ohne Registrierung können Sie den Typ pro Aufruf mit `openRebase<Database>({ … })` angeben; `OpenedRebase<Database>` ist der Typ für eine Hilfsfunktion, die eine Instanz entgegennimmt. Wird keines von beiden verwendet, sind Zeilen untypisiert, weshalb das erste Beispiel `draft.id` mit `String()` umwandelt.

### Prüfen, was ein Benutzer sehen kann

`withAuth` ist der schnellste Weg, eine Sicherheitsregel mit echten Daten zu testen. Das Blog-Gerüst, der Standard von `rebase init`, definiert Regeln direkt auf `posts`: Ein angemeldeter Benutzer ohne Rolle liest veröffentlichte Beiträge und keine Entwürfe, und nur ein Administrator darf Beiträge schreiben. (Die anderen Tabellen geben `rls: "inherit"` an und übernehmen das `defaultRls` aus `backend/schema/index.ts`.) Dies prüft beide Seiten als `backend/scripts/ada-check.ts`:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads published posts, and no drafts…
const { data: seen } = await ada.data.posts.find();
console.log(seen.every(post => post.status === "published"));

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

// SQL as Ada runs under the same policies: her rows, read-only unless { write: true }.
const counted = await ada.sql("SELECT count(*)::int AS n FROM posts");
console.log(Number(counted[0]?.n) === seen.length);

await rebase.close();
```

Führen Sie es wie das erste Skript aus, und es gibt dreimal `true` aus:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Eine Regel, die Zeilen nach dem Eigentümer filtert, wird auf dieselbe Weise überprüft: Vergleichen Sie das Eigentümerfeld jeder Zeile mit der übergebenen `uid`. Im Blog-Gerüst tut dies keine Regel, und `authorId` bei einem Beitrag ist die ID einer Autorenzeile, nicht die eines Benutzers.

Ein Benutzer ist `{ uid, roles?, isAnonymous?, claims? }`; `claims` ist das, was `rebase.jwt()` in einer Richtlinie liest.

`withAuth` wird unter der eingeschränkten Rolle ausgeführt, die beim Serverstart erstellt wird (`rebase_user`). Bei einer Datenbank, auf der noch kein Rebase-Server gestartet wurde, existiert diese Rolle nicht, und `withAuth`-Anfragen schlagen mit dem Postgres-Fehler für unbekannte Rollen fehl, anstatt ungefiltert ausgeführt zu werden. Führen Sie zuvor `rebase db push` aus oder starten Sie den Server einmalig.

### In einem Test

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, tables });
});
after(() => rebase.close());

test("a signed-in user reads published posts only and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    assert.ok(seen.every(post => post.status === "published"));
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Speichern Sie dies als `backend/scripts/posts.test.ts` und führen Sie es aus `backend/` mit dem Test-Runner von Node aus. Verweisen Sie dabei mit `TEST_DATABASE_URL` auf eine Datenbank, auf der ein Rebase-Server bereits gestartet wurde:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

Dasselbe funktioniert auch unter Vitest oder Jest.

### Tabellen mit Historie

Ein Schreibvorgang in eine Tabelle mit [`history: true`](/docs/backend/history/) zeichnet ihren Eintrag genauso auf wie ein Server-Schreibvorgang. Der Eintrag wird in der Transaktion der Zeile selbst geschrieben, sodass ein Schreibvorgang, der zurückgerollt wird, keinen Eintrag hinterlässt. Er wird unter der Identität aufgezeichnet, unter der der Schreibvorgang ausgeführt wurde: `service` für `dataAsAdmin`, die `uid` des Benutzers unter `withAuth`. Schreibvorgänge aus `rebase console` werden auf dieselbe Weise aufgezeichnet.

`openRebase` erstellt keine Strukturen für die Aufzeichnung. Wenn auf der Datenbank noch kein Backend mit aktivierter Historie gestartet wurde, fehlt die Tabelle `rebase.entity_history`. Ein Schreibvorgang in eine Tabelle mit Historie wird dann mit [`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) abgelehnt, noch bevor einer ihrer Hooks ausgeführt wird, und die Fehlermeldung nennt die fehlende Komponente. Lesevorgänge funktionieren wie gewohnt. Starten Sie das Backend einmalig mit aktivierter Historie (was `rebase dev` tut), und die Schreibvorgänge werden ausgeführt.

Einträge werden aufgezeichnet, aber nie bereinigt. Die Aufbewahrungsdauer (Retention) ist eine Servereinstellung, auf die ein Skript keinen Zugriff hat. Der Server bereinigt sie wie gewohnt: beim nächsten Schreiben der Entität sowie beim stündlichen Bereinigungslauf.

### Was ausgelassen wird

`openRebase` öffnet die Datenebene und nichts anderes. Es startet keine eigene Echtzeit-Engine, aber seine Schreibvorgänge erreichen dennoch Live-Abfragen: Die Change-Capture-Trigger der Datenbank kündigen jeden Schreibvorgang an, unabhängig davon, wer ihn durchgeführt hat, sodass Abonnenten auf einem laufenden Server auch nach einem Backfill Daten neu abrufen. Nur bei `REALTIME_CDC=off` auf diesem Server werden sie nicht angekündigt. Siehe [Database change capture](/docs/backend/realtime-cdc/). Storage, E-Mail, Auth-Administration und Ihre Funktionen sind nicht enthalten.

Die tabelleneigenen Hooks werden bei jedem Schreibvorgang ausgeführt, genau wie auf dem Server. Die globalen Hooks des Projekts werden nur ausgeführt, wenn Sie sie als Option `callbacks` übergeben. `rebase console` übergibt sie für Sie: Sie liest die von `backend/hooks.ts` exportierten `hooks`, sodass ein globales `beforeSave` auch bei ihren Schreibvorgängen ausgeführt wird. Wenn diese Datei nicht importiert werden kann (beispielsweise weil sie eine Umgebungsvariable benötigt, die der Konsole nicht übergeben wurde), gibt die Konsole eine Zeile aus, die besagt, dass globale Hooks für die Sitzung deaktiviert sind, und öffnet die Verbindung ohne sie.

Wenn ein Skript auch diese benötigt, erstellen Sie das Backend, ohne es bereitzustellen: `createRebaseBackend({ …, provision: false })` liefert Ihnen `backend.rebase`, den vollständigen In-Process-Client, ohne dass etwas gemountet oder gestartet wird. Siehe [das Backend ohne Server](/docs/backend/custom-server/#the-backend-without-a-server). Um einen einzelnen Tabellen-Hook ganz ohne Datenbank zu testen, rufen Sie ihn mit [`createCallContext`](/docs/collections/callbacks/#testing-a-hook) auf.

## Verwandte Themen

- [Custom Server Integration](/docs/backend/custom-server/) – das Backend als öffentliche Komponenten
- [CLI-Referenz](/docs/cli/) – alle `rebase`-Befehle
- [Sicherheitsregeln](/docs/collections/security-rules/) – wonach `withAuth` gefiltert wird
