---
sourceHash: b806e08525154a2e
title: Skripte und die Konsole
sidebar_label: Skripte und Konsole
description: Öffnen Sie die Daten eines Projekts aus einem Skript, einem Test oder einer REPL mit openRebase oder über das Terminal mit rebase console. Kein Server, keine Schemaänderungen.
---

## Übersicht

<span class="since-badge" data-since="0.25">Seit 0.25</span> Unter 0.24 gibt es
weder `openRebase` noch `rebase console`: Ein Skript muss ein Backend bauen oder
die REST-API eines laufenden Servers aufrufen.

Um ein paar Zeilen anzusehen, eine zu korrigieren, einen Filter auszuprobieren oder zu prüfen,
was eine Policy einem Benutzer zeigt, sollten Sie keinen Server starten müssen. Rebase gibt Ihnen
die Daten des Projekts als Objekt, an zwei Stellen:

- **`rebase console`**, eine Node-REPL in Ihrem Terminal, in der das Projekt geöffnet ist;
- **`openRebase`**, dasselbe Objekt in einem eigenen Skript oder Test.

Beide öffnen die Datenbank, ohne sie zu verändern: Es wird keine Tabelle, Rolle, kein Trigger und
keine Funktion angelegt. Das `close()` eines Skripts beendet, was `openRebase` geöffnet hat. Auf der
verwalteten Entwicklungsdatenbank startet `rebase console` diese Datenbank, wenn sie nicht läuft,
und lässt sie danach laufen, wie es die `rebase db`-Befehle tun; `rebase db stop` stoppt sie. Das
Objekt hat das Vokabular, das eine
[benutzerdefinierte Funktion](/docs/backend/custom-functions/) vom Server erhält, `dataAsAdmin`
und `sql`, sodass ein Snippet unverändert zwischen einer Funktion, einem Skript und der Konsole
wandern kann.

## `rebase console`

<span class="since-badge" data-since="0.25">Seit 0.25</span>

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

Zwei Namen sind im Geltungsbereich, und `await` auf oberster Ebene funktioniert:

| Name | Was es ist |
|---|---|
| `rebase` | Was [`openRebase`](#openrebase) zurückgibt: `dataAsAdmin`, `sql`, `withAuth(user)` und `close()` |
| `collections` | Die Collections des Projekts, geladen so, wie `rebase db push` sie lädt |

Die Konsole öffnet das Projekt so, wie es `rebase db push` tut: dieselbe `.env`,
dieselbe Datenbank und dieselben Collections. Bei einem Projekt auf der verwalteten
Entwicklungsdatenbank wird diese zuerst gestartet. Der Verlauf dessen, was Sie eingegeben haben,
wird in `.rebase/console_history` gespeichert, das das `.gitignore` des Scaffolds bereits
ausschließt.

Per Pipe übergebene Eingaben laufen Zeile für Zeile, jede erst nachdem das `await` der
vorherigen Zeile abgeschlossen ist, sodass das Transkript oben als
`printf '…\n…\n' | rebase console` funktioniert. Alles nach `.exit` wird ignoriert, und
Werte werden nur auf einem Terminal eingefärbt. Alles, was die Konsole protokolliert, geht
nach stderr.

### Ein Snippet: `--eval`

<span class="since-badge" data-since="0.25">Seit 0.25</span>

`rebase console -e "<code>"` führt ein Stück Code anstelle der REPL aus. Der Wert eines
Ausdrucks oder das `return` eines Funktionskörpers wird abgewartet (`await`) und als
JSON auf stdout ausgegeben, sodass sich die Ausgabe weiterleiten (pipen) lässt:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Alles, was die Konsole protokolliert, geht, was auch immer `LOG_LEVEL` sagt, nach stderr,
sodass stdout das Ergebnis und sonst nichts enthält. Ein Snippet, das einen Fehler wirft, gibt
den Fehler auf stderr aus und beendet sich mit `1`.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Eine Datenbank,
die die Konsole nicht öffnen kann, wird einmal gemeldet, und sie beendet sich mit `1`: das
Banner "Cannot connect to PostgreSQL", das die `db`-Befehle ausgeben, oder, bei der
verwalteten Entwicklungsdatenbank, dass sie keine freie Verbindung hat. Diese Datenbank nimmt
nur wenige Verbindungen gleichzeitig an, und ein laufendes `rebase dev` hält einige davon:
Schließen Sie also einen anderen Client oder stoppen Sie `rebase dev` und führen Sie die Konsole
erneut aus. Unter 0.24 kam das Banner zweimal, unter einer leeren `❌ [ERROR]`-Zeile, und eine volle
verwaltete Datenbank gab `read ECONNRESET` mit ihrem Stack als eine Zeile JSON aus.

### Optionen

| Flag | Was es bewirkt |
|---|---|
| `--eval`, `-e` | Diesen Code anstelle der REPL ausführen, sein abgewartetes Ergebnis als JSON ausgeben und mit 1 beenden, wenn er einen Fehler wirft |
| `--collections`, `-c` | Pfad zum Collections-Verzeichnis, falls es nicht das des Projekts ist |
| `--database-url` | Diese Datenbank statt der des Projekts öffnen |
| `--docker` | Die Datenbank aus Docker Compose verwenden und sie bei Bedarf starten |

## `openRebase`

<span class="since-badge" data-since="0.25">Seit 0.25</span>

`openRebase` aus `@rebasepro/server-postgres` ist das, was die Konsole aufruft. Verwenden Sie
es in einem Skript, einem Seed, einer Datenkorrektur oder einem Test. Legen Sie das Skript in
einem Scaffold-Projekt unter `backend/` ab, etwa `backend/scripts/publish-drafts.ts`: Der
Backend-Workspace ist derjenige, der von `@rebasepro/server-postgres` abhängt, und ein Skript im
Root-Ordner `scripts/` kann es nicht importieren.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Führen Sie es aus `backend/` aus. `rebase db url` gibt die URL der Datenbank aus, die das
Projekt verwendet, die verwaltete Entwicklungsdatenbank eingeschlossen:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Member | Was es bewirkt |
|---|---|
| `dataAsAdmin` | Jede Collection, gelesen und geschrieben als Service-Identität des Servers (`{ uid: "service", roles: ["admin"] }`): Admin, und dennoch von Ihren RLS-Policies ausgewertet, genau wie `rebase.dataAsAdmin` in einer Funktion |
| `sql(query, { params })` | Rohes SQL auf der Owner-Verbindung, mit derselben Aufrufkonvention wie `rebase.sql` in einer Funktion |
| `withAuth(user)` | Löst zu `{ data }` auf: die Collections, wie dieser Benutzer sie sieht. Jedes Lesen und Schreiben läuft als er, gefiltert durch Row-Level-Security, so wie eine HTTP-Anfrage dieses Benutzers |
| `collections` | Die Collections, mit denen es geöffnet wurde |
| `close()` | Beendet den Connection-Pool, den `openRebase` erstellt hat. Kann gefahrlos zweimal aufgerufen werden |

Seine Optionen:

| Option | Was sie bewirkt |
|---|---|
| `databaseUrl` | Die zu öffnende Datenbank. `openRebase` erstellt den Pool und `close()` beendet ihn |
| `connection` | Eine Drizzle-Verbindung, die Sie bereits halten (`createPostgresDatabaseConnection(url).db`), anstelle von `databaseUrl`. Sie bleibt Ihre: `close()` lässt sie offen |
| `collections` | Die Collections des Projekts. Ein leeres Array liest sie stattdessen aus der Datenbank, wie es ein Server ohne Collection-Dateien tut, und stellt sie schreibgeschützt bereit |
| `pool` | Pool-Einstellungen, zusammen mit `databaseUrl` |
| `dataSourceKey` | Die Datenquelle, aus der diese Collections bereitgestellt werden. Standard `(default)` |

`openRebase` liest keine Umgebungsvariable. Die `DATABASE_URL` oben wird von Ihrem Skript gelesen,
und Einstellungen wie `REBASE_DB_POOL_MAX` oder `REALTIME_CDC` ändern hier nichts.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Das Öffnen
protokolliert auf `info` nichts, sodass die stdout eines Skripts enthält, was das Skript
ausgibt, und `tsx scripts/report.ts > report.json` nur dessen JSON schreibt. Warnungen und
Fehler gehen in der Entwicklung nach stderr. Der Hinweis, wie Anfragen isoliert werden
(`RLS enforcement active`), wird auf `debug` protokolliert; der Boot eines Servers gibt ihn
weiterhin auf `info` aus. Eine Datenbank, die es nicht erreichen kann, lässt das Öffnen mit
einem einzigen Fehler scheitern, `Cannot connect to PostgreSQL at <host>:<port>: <reason>.`,
und protokolliert nichts: Was ausgegeben wird, entscheidet das Skript. Unter 0.24 eröffnete
dieser Hinweis die stdout eines Skripts, und eine nicht erreichbare Datenbank protokollierte
ein Banner vor dem Fehler.

Seine Accessoren sind durch das `Database` typisiert, das `rebase generate-sdk --register`
registriert, wie das `rebase` einer Funktion, sodass eine falsch geschriebene Collection, ein
falsch geschriebenes Feld oder ein falscher Enum-Wert in einem Skript ein Typfehler ist. Die
`backend/tsconfig.json` des Scaffolds schließt `scripts/` ein, sodass `tsc --noEmit` in
`backend/` ihn meldet. Ohne Registrierung benennen Sie es pro Aufruf mit `openRebase<Database>({ … })`;
`OpenedRebase<Database>` ist der Typ für einen Helper, der eines entgegennimmt. Mit keinem von
beiden sind Zeilen untypisiert, weshalb das erste Beispiel `draft.id` mit `String()` umwandelt.

### Prüfen, was ein Benutzer sehen kann

<span class="since-badge" data-since="0.25">Seit 0.25</span>

`withAuth` ist der schnellste Weg, eine Sicherheitsregel gegen echte Daten zu testen. Das
Blog-Scaffold, die Vorgabe von `rebase init`, gibt jeder Collection die
`defaultSecurityRules` in `config/collections/index.ts`: Jeder angemeldete Benutzer liest
jeden Post, und nur ein Admin schreibt einen. Dies prüft beide Hälften, als
`backend/scripts/ada-check.ts`:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads every post…
const { data: seen } = await ada.data.posts.find();
const { data: all } = await rebase.dataAsAdmin.posts.find();
console.log(seen.length === all.length);

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

await rebase.close();
```

Führen Sie es so aus, wie das erste Skript läuft, und es gibt zweimal `true` aus:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Eine Regel, die Zeilen nach Eigentümer filtert, wird auf dieselbe Weise geprüft: Vergleichen
Sie das Eigentümerfeld jeder Zeile mit der übergebenen `uid`. Beim Blog-Scaffold tut das keine
Regel, und `authorId` eines Posts ist die ID einer Autoren-Zeile, nicht die eines Benutzers.

Ein Benutzer ist `{ uid, roles?, isAnonymous?, claims? }`; `claims` sind das, was
`rebase.jwt()` in einer Policy liest.

`withAuth` läuft als die eingeschränkte Rolle, die ein Server-Boot anlegt (`rebase_user`).
Bei einer Datenbank, auf der noch kein Rebase-Server gebootet wurde, existiert diese Rolle nicht,
und `withAuth`-Anfragen schlagen mit dem Unknown-Role-Fehler von Postgres fehl, statt ungefiltert zu laufen.
Führen Sie vorher `rebase db push` aus oder booten Sie den Server einmal.

### In einem Test

<span class="since-badge" data-since="0.25">Seit 0.25</span>

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, collections });
});
after(() => rebase.close());

test("a signed-in user reads every post and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    const { data: all } = await rebase.dataAsAdmin.posts.find();
    assert.equal(seen.length, all.length);
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Speichern Sie ihn als `backend/scripts/posts.test.ts`, führen Sie ihn aus `backend/` mit dem
Test-Runner von Node aus und richten Sie `TEST_DATABASE_URL` auf eine Datenbank, auf der ein
Rebase-Server gebootet hat:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

Dasselbe funktioniert unter Vitest oder Jest.

### Collections mit History

<span class="since-badge" data-since="0.25">Seit 0.25</span>

Ein Schreibvorgang auf eine Collection mit [`history: true`](/docs/backend/history/)
zeichnet seinen Eintrag so auf, wie es ein Schreibvorgang des Servers tut. Der Eintrag
wird in der eigenen Transaktion der Zeile geschrieben, sodass ein Schreibvorgang, der
zurückgerollt wird, keinen Eintrag hinterlässt. Er wird als die Identität aufgezeichnet,
als die der Schreibvorgang lief: `service` für `dataAsAdmin`, die `uid` des Benutzers
unter `withAuth`. Schreibvorgänge aus `rebase console` werden auf dieselbe Weise
aufgezeichnet.

`openRebase` legt nichts an, worin aufgezeichnet werden könnte. Wenn auf der Datenbank
noch kein Backend mit History gebootet hat, fehlt die Tabelle `rebase.entity_history`.
Ein Schreibvorgang auf eine Collection mit History wird dann mit
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) verweigert,
bevor einer seiner Callbacks läuft, und die Meldung nennt, was fehlt. Lesezugriffe
funktionieren wie gewohnt. Booten Sie das Backend einmal mit aktivierter History
(`rebase dev` tut das), und die Schreibvorgänge gehen durch.

Einträge werden aufgezeichnet, nie bereinigt. Die Aufbewahrung ist eine Servereinstellung,
die ein Skript nicht sehen kann, daher bereinigt der Server sie wie gewohnt: wenn er die
Entität das nächste Mal schreibt und in seinem stündlichen Durchlauf.

### Was es auslässt

<span class="since-badge" data-since="0.25">Seit 0.25</span>

`openRebase` öffnet die Datenschicht und sonst nichts. Es startet kein Realtime, daher werden
seine Schreibvorgänge Live-Abfragen nicht mitgeteilt. Storage, E-Mail, Auth-Verwaltung und
Ihre Funktionen sind nicht darauf vorhanden.

Braucht ein Skript auch diese, bauen Sie das Backend, ohne es auszuliefern:
`createRebaseBackend({ …, provision: false })` gibt Ihnen `backend.rebase`, den
vollständigen In-Process-Client, ohne dass etwas eingebunden oder gestartet wird. Siehe
[das Backend ohne Server](/docs/backend/custom-server/#the-backend-without-a-server).
Um einen einzelnen Collection-Callback ganz ohne Datenbank zu testen, rufen Sie ihn mit
[`createCallContext`](/docs/collections/callbacks/#testing-a-callback) auf.

## Verwandte Themen

- [Integration eines eigenen Servers](/docs/backend/custom-server/) — das Backend als öffentliche Bausteine
- [CLI-Referenz](/docs/cli/) — jeder `rebase`-Befehl
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/) — wodurch `withAuth` gefiltert wird
