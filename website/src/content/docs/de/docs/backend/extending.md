---
sourceHash: 8412da52cc99478c
title: Rebase unterstützt X nicht
sidebar_label: Server erweitern
description: Die serverseitige Erweiterungsleiter – Deklaration, Tabellen-Hook, benutzerdefinierte Funktion, eigene Routen, eigener Server, Eject – und worauf die jeweilige Stufe zugreifen kann und worauf nicht.
---

## Übersicht

Etwas, das Sie benötigen, ist nicht in der Tabellendefinition enthalten. Diese Seite zeigt die Reihenfolge,
in der Sie vorgehen sollten, und – was noch nützlicher ist – worauf jede Stufe *keinen* Zugriff hat,
damit Sie auf der ersten Stufe anhalten, die die Aufgabe erfüllen kann.

Es gibt eine passende Seite für das Admin-Panel:
[Rebase erweitern](/docs/frontend/extending) behandelt Plugins, Slots, Komponenten-Overrides
und benutzerdefinierte Ansichten. Diese Seite hier behandelt den Server.

Die Regel, die der Leiter zugrunde liegt: **Jede Stufe kostet Sie etwas, das die darunterliegende Stufe
beibehalten hat.** Eine Deklaration ist portabel, aktualisierbar und wird vom Schema-Planer,
dem generierten SDK und dem Admin-Panel verstanden. Sobald Sie `rebase eject` erreichen,
liegt die Boot-Sequenz in Ihrer Hand, und Plattform-Laufzeitaktualisierungen erreichen
Ihr Projekt nicht mehr. Klettern Sie also nur so weit, wie es unbedingt nötig ist.

## Die Leiter

| # | Stufe | Erreicht | Erreicht **nicht** | Kosten dieser Stufe |
|---|---|---|---|---|
| 1 | **Deklaration** – eine Spalte, eine Relation, ein Index, ein `search`-Block, eine `rls`-Regel | Das Schema, das generierte SDK, das Admin-Panel, den Migrationsplaner | Alles, was Code ausführen muss | Keine. Dies ist der empfohlene Weg |
| 2 | **Tabellen-Hook** – `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Jeden Lese- und Schreibvorgang einer Tabelle, auf jedem Transportweg, innerhalb der transaktionseigenen Anfrage | Anfragen, die keine Tabelle berühren; die Response-Envelope; alles, was asynchron zum Schreibvorgang ist | Läuft auf dem Hot Path und hält die Transaktion offen |
| 3 | **Benutzerdefinierte Funktion** – eine Hono-App in `functions/` | Die eigene URL, mit aufgelöster Auth, dem Driver im Scope des Aufrufers und verfügbarem `rebase` | Die integrierten `/api/data`-Routen. Sie sitzt *neben* ihnen, nicht davor | Eine weitere Angriffsfläche zur Autorisierung; es wird keine SDK-Methode dafür generiert |
| 4 | **Eigene Routen und Middleware** auf der Hono-App | Alles über HTTP, einschließlich Pfade, die *vor* den Rebase-Routern ausgeführt werden | Den Driver und die Identität des Aufrufers, es sei denn, Sie sichern die Route selbst ab | Liegt außerhalb aller Rebase-Router: Es wurde keine Auth-Middleware ausgeführt |
| 5 | **Eigener Server** – Erstellen Sie das Backend mit `createRebaseBackend` und binden Sie die gewünschten Routengruppen ein, oder betten Sie den Driver allein in Express, Fastify oder reinem `http` ein | Jede Routengruppe am Pfad Ihrer Wahl und welcher Prozess die Timer startet; ganz unten: der Datenadapter und Realtime allein | Mit dem Driver allein: alles andere, von Auth-Routen und Storage bis hin zu Cron und der Admin-API | Sie rufen jeden Schritt selbst auf, den `initializeRebaseBackend` für Sie übernommen hatte |
| 6 | **`rebase eject`** | Den Entrypoint und das `Dockerfile` in Ihrem Repository | — | **Plattform-Laufzeitaktualisierungen erreichen dieses Projekt nicht mehr.** CORS, Auth-Verdrahtung, Storage und Shutdown liegen in Ihrer Verantwortung |

:::tip[Zwei Stufen werden häufig grundlos übersprungen]
`beforeQuery` (Stufe 2) schränkt einen Lesevorgang ein, *bevor er kompiliert wird* – genau das,
wofür viele fälschlicherweise direkt zu Stufe 3 oder 5 greifen. Und ein `search`-Block mit
`mode: "hybrid"` (Stufe 1) ist das, wofür man normalerweise zu nativem SQL greifen würde. Beide sind
neu genug, dass ältere Antworten im Internet sie noch nicht erwähnen.
:::

## 1. Deklaration

Das meiste, was ein Backend benötigt, ist eine Deklaration in der Tabelle, da eine
Deklaration die einzige Stufe ist, die der Rest des Systems interpretieren kann. Der Schema-Planer
macht daraus DDL, der Codegenerator erzeugt daraus SDK-Methoden, das Admin-Panel
rendert sie und `rebase doctor` vergleicht sie mit der aktiven Datenbank.

| Ich möchte… | Deklarieren | Referenz |
|---|---|---|
| Eine Spalte hinzufügen | eine `col.*`-Spalte | [Spalten](/docs/schema/columns/) |
| Zwei Tabellen verknüpfen | eine `rel.*`-Relation | [Relationen](/docs/collections/relations) |
| Eine Abfrage beschleunigen | `indexes` | [Indizes](/docs/backend/indexes) |
| Bestimmen, wer eine Zeile lesen oder schreiben darf | `rls` | [Row-Level Security](/docs/collections/security-rules/) |
| Text richtig durchsuchen – Akzente, JSONB, Ranking, Teilstrings | einen `search`-Block | [Suche](/docs/backend/search) |
| Zeilen nach Bedeutung finden | eine `col.vector()`-Spalte | [Vektorsuche](/docs/backend/vector-search/) |
| Gelöschte Zeilen behalten | `softDelete` | [Soft Delete](/docs/collections/soft-delete) |
| Protokollieren, wer was geändert hat | `history` | [Verlauf](/docs/backend/history) |
| Etwas nach Zeitplan ausführen | eine Cron-Job-Datei | [Cron-Jobs](/docs/backend/cron-jobs) |
| Etwas nach einem Schreibvorgang asynchron (out of band) ausführen | einen Job | [Jobs](/docs/backend/jobs) |

**Worauf kein Zugriff besteht:** Alles, was zum Zeitpunkt der Anfrage eine Entscheidung treffen muss.
Eine Deklaration besteht aus Daten. Wenn die Antwort davon abhängt, wer die Anfrage stellt, gehen Sie zu Stufe 2.

## 2. Tabellen-Hooks

**Geltungsbereich:** eine Tabelle oder jede Tabelle, wenn sie als `hooks` aus
`backend/hooks.ts` exportiert wird (`initializeRebaseBackend({ hooks })` im Ejected-Zustand).

Hooks werden auf **jedem** Datenpfad ausgelöst – REST, dem SDK, WebSocket-Abonnements
und serverseitigen Schreibvorgängen über `rebase.dataAsAdmin` – und jeder läuft innerhalb der
für diese Anfrage geöffneten Transaktion. Genau darin liegt der entscheidende Vorteil: Es gibt keinen Weg,
an die Zeilen einer Tabelle zu gelangen, der an ihnen vorbeiführt.

| Hook | Wird ausgelöst | Verwendung für |
|---|---|---|
| `beforeQuery` | bevor ein Lesevorgang kompiliert wird | Einschränkung, **welche Zeilen** ein Lesevorgang abfragt |
| `afterRead` | pro Zeile, nachdem sie abgerufen wurde | Redaktion, PII-Maskierung, berechnete Felder |
| `beforeSave` | nach der Validierung, vor dem Schreiben | Standardwerte, abgeleitete Spalten, Verweigerung eines Schreibvorgangs |
| `afterSave` | nach dem Schreiben, vor dem Commit | Nebeneffekte, die im Fehlerfall mit zurückgerollt werden müssen |
| `afterSaveError` | wenn ein Speichervorgang einen Fehler auslöst | Reporting; `props.error` enthält den ausgelösten Fehler |
| `beforeDelete` | vor dem Löschen | Verweigerung des Löschvorgangs |
| `afterDelete` | nach dem Löschen, vor dem Commit | Kaskadierende Bereinigungen |

→ [Tabellen-Hooks](/docs/collections/callbacks) ·
[Globale Hooks](/docs/backend/hooks)

### Einen Lesevorgang mit `beforeQuery` einschränken

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`afterRead` sieht Zeilen, die bereits abgerufen wurden. Es kann also einen Wert unkenntlich machen,
aber nicht verhindern, dass die Zeile gelesen wird. `beforeQuery` läuft früher: Es erhält die
geparste Abfrage und gibt Bedingungen zurück, die per **AND** mit ihr verknüpft werden.

```ts
// backend/schema/documents.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const documents = defineTable("documents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text(),
        body: col.text()
    },
    rls: "admin-only",
    hooks: {
        beforeQuery: ({ context }) => {
            if (context.user?.roles?.includes("admin")) return;        // no narrowing
            return { filter: { tenantId: ["==", context.user?.claims?.tenant ?? null] } };
        }
    }
});
```

Vier Eigenschaften sollten Sie kennen, bevor Sie sich darauf verlassen:

- **Es kann nur einschränken.** Der Rückgabewert ist ein Filter, der per AND verknüpft wird. Es gibt
  keine Struktur, die zurückgegeben werden kann, um den Lesevorgang zu erweitern. Das ist Absicht: Könnte
  ein Hook, der die Abfrage erhält und eine neue zurückgeben soll, eine Bedingung weglassen, würde auf einer
  Datenebene mit Row-Level Security jede Zeile zurückgegeben werden, die die Policies zufällig erlauben.
- **Es wird auf jedem Lesepfad ausgelöst.** Auflistungen, einzelne Abrufe, Zählungen (count),
  Aggregationen, Suchvorgänge, Vektorabrufe, verschachtelte Pfadauflistungen, der Realtime-Refetch,
  der Subscription-Frames aufbaut, und die für eine Relation oder ein `?include=` geladenen Zeilen – wobei
  jeweils der Hook der **Ziel**-Tabelle greift. Ein Hook, der bei der Auflistung beachtet wird, aber
  nicht bei der Zählung, führt zu einer Seite, die "1 von 4 Ergebnissen" anzeigt.
- **Ein Filter, der nicht kompiliert werden kann, weist die Anfrage ab.** Die Angabe einer Spalte,
  die die Tabelle nicht besitzt, führt zu einem 400-Fehler und nicht zu einer ignorierten Bedingung,
  unabhängig davon, wie `configureUnknownFilterFields` eingestellt ist.
- **Ein Schreibvorgang auf eine ausgeschlossene Zeile ergibt einen 404.** Eine Aktualisierung oder ein Löschvorgang,
  der auf eine Zeile außerhalb des Gültigkeitsbereichs zielt, wird vor dem Schreiben mit derselben
  Antwort "Keine Zeile …" abgelehnt, die auch ein Lesevorgang liefert – ein Scope gilt also für Schreibvorgänge
  ebenso wie für Lesevorgänge. Was dadurch *nicht* kontrolliert wird, sind die geschriebenen Werte selbst: Die
  Verweigerung eines Schreibvorgangs basierend auf seinen Inhalten ist Aufgabe von `beforeSave`.

Ein Lesevorgang wird bewusst *nicht* eingeschränkt: die Eindeutigkeitsprüfung hinter
`.unique()`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert. Wäre sie eingeschränkt,
würde sie für einen Wert, den eine ausgeblendete Zeile bereits enthält, "eindeutig" melden – was
dazu führen würde, dass der Insert-Vorgang stattdessen am Constraint scheitert.

**Worauf Hooks keinen Zugriff haben:**

- Eine Anfrage, die keine Tabelle berührt. Es gibt nichts, woran sich der Hook
  einhängen könnte.
- Die Response-Envelope – Statuscode, Header, Paginierungsstruktur. Ein Hook
  gibt Werte zurück, keine Response.
- Aufgaben, die die Transaktion überdauern müssen. `afterSave` läuft *vor* dem Commit;
  wird dort ein Fehler ausgelöst, wird der Schreibvorgang zurückgerollt. Alles, was das
  Rückgängigmachen des Schreibvorgangs überstehen muss, ist nicht Teil des Schreibvorgangs: Übergeben Sie es
  an die [Job-Queue](/docs/backend/jobs).
- In der Praxis: Langsame Operationen. Ein Hook hält die Transaktion und damit
  eine gepoolte Verbindung offen. Alles, was mit Drittanbietern kommuniziert, gehört in die Queue.

## 3. Benutzerdefinierte Funktionen

**Geltungsbereich:** eine URL unter `/api/functions`.

Eine Hono-App in `backend/functions/`, die wie Cron-Jobs über den Dateinamen erkannt
oder als Wert übergeben wird (`functions: { promote }`). Die Auth-Middleware wurde bereits ausgeführt,
wenn Ihr Handler erreicht wird, der Driver ist auf den Aufrufer beschränkt und `rebase` steht
für Storage, E-Mail, Jobs und `dataAsAdmin` bereit.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.table("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Benutzerdefinierte Funktionen](/docs/backend/custom-functions)

**Worauf kein Zugriff besteht:** Die integrierten `/api/data`-Routen. Eine Funktion sitzt
*neben* ihnen, nicht davor. Sie kann also nicht ändern, wie eine Auflistung gefiltert,
paginiert oder strukturiert wird – das ist Aufgabe von Stufe 2. Sie erhält außerdem keine
generierte SDK-Methode; Aufrufer erreichen sie über `client.functions.invoke(...)` oder einfaches `fetch`.

## 4. Eigene Routen und Middleware

**Geltungsbereich:** die Hono-App, bevor Rebase sie modifiziert.

`initializeRebaseBackend` akzeptiert die App, die Sie übergeben. Alles, was Sie auf dieser
App registrieren, *bevor* Sie die Initialisierung aufrufen, wird vor jedem Rebase-Router ausgeführt – siehe
[Reihenfolge der Routenregistrierung](/docs/backend/custom-functions#route-registration-order)
für Details. Eine Routengruppe, die Sie selbst aus `backend.routes` (Stufe 5) einbinden,
gehört nicht zu diesen Routen: Sie bringt ihre eigene Auth-Middleware mit.

:::caution[Dort wurde keine Auth-Middleware ausgeführt]
Eine auf diese Weise registrierte Route liegt **außerhalb** aller Rebase-Router. Daher ist
`getDriver(c)` nicht gesetzt und es wurde kein Token überprüft. Sichern Sie sie mit
`requireAuth` ab, importiert aus **`@rebasepro/server`** – dem Root-Paket –, das
den Token selbst überprüft. Verwenden Sie anschließend `requireAdmin` oder `requireScope` aus demselben
Import, um festzulegen, was der Aufrufer tun darf. Die aus
`@rebasepro/server/functions` exportierten Guards lesen eine Identität aus, die ein Rebase-Router
bereits aufgelöst hat, und antworten mit 500, anstatt vorzugeben, dass eine existiert.
:::

Eine Hono-Falle, die erwähnenswert ist, weil sie geräuschlos auftritt: `app.use("/*", guard)` deckt
nur die Routen ab, die *darunter* deklariert sind. Eine später hinzugefügte Route – ganz unten
in der Datei, Monate später – bleibt ungeschützt. Platzieren Sie Guards im eigenen
Middleware-Slot der Route.

**Worauf kein Zugriff besteht:** Die Identität, der im Scope liegende Driver und die Error-Envelope
– es sei denn, Sie binden diese jeweils selbst an. Alles, was ein Rebase-Router einem Handler bereitstellt,
wurde von einem Rebase-Router ausgeführt.

## 5. Eigener Server

**Geltungsbereich:** der Prozess.

`initializeRebaseBackend` ist eine Vereinfachung für einige öffentliche Aufrufe, und diese Stufe
besteht darin, diese selbst aufzurufen. `createRebaseBackend` erstellt das Backend und mountet,
startet und lauscht auf nichts. `backend.routes` stellt jede Routengruppe als
Hono-Sub-App bereit, die Sie separat an jedem beliebigen Pfad einbinden können. `mount`, `attachRealtime` und
`start` übernehmen den Rest, falls gewünscht:

```typescript
const backend = await createRebaseBackend({ database: adapter, auth, schemaDir, provision: true });

app.route("/v2/data", backend.routes.data());   // only the parts you want,
app.route("/v2/auth", backend.routes.auth());   // at the paths you want
await backend.attachRealtime(server);
backend.start();                                // cron, job workers, sweeps
```

Eine Gruppe bringt ihren eigenen Auth-Kontext, Ratenbegrenzungen und Admin-Gates mit und lehnt
Impersonation- und Simulations-Header ab (außer es handelt sich um die Daten- oder Funktionsgruppe),
sodass `getDriver(c)` in einer an beliebiger Stelle gemounteten Gruppe funktioniert. Was sie nicht mitbringt,
ist die prozessweite Middleware, die `mount()` hinzufügt: Das Body-Limit, die Komprimierung, CSRF und
die Error-Envelope müssen von Ihnen hinzugefügt werden, wenn Sie Gruppen einzeln einbinden.

Noch einen Schritt weiter gedacht: `@rebasepro/server-postgres` ist Framework-agnostisch: Es
hängt von Drizzle und Nodes `http.Server` ab und von sonst nichts. Sie können also
den Datentreiber und Realtime in Express, Fastify oder reinem Node einbetten und den
Rebase-Server komplett weglassen.

→ [Eigene Server-Integration](/docs/backend/custom-server)

**Worauf kein Zugriff besteht:** Mit `createRebaseBackend` ist nichts unerreichbar;
Sie übernehmen lediglich die Reihenfolge der Aufrufe. Mit dem Driver allein müssen Sie alles,
was der Server sonst verdrahtet, selbst aufbauen: die Auth-Routen und Token-Aktualisierung, Storage,
die Job-Queue, Cron, die Admin-API, mit der Studio kommuniziert, den MCP-Server, die
Error-Envelope und den Middleware-Stack.

Greifen Sie dazu, wenn Sie einen bestehenden Server haben, der der Entrypoint bleiben muss, oder
wenn nur ein Teil des Backends in diesen Prozess gehört. Wenn Sie eigentlich nur
eine einzelne benutzerdefinierte Route benötigen, entspricht das Stufe 3 oder 4 – bei einem Bruchteil der Angriffsfläche.

## 6. `rebase eject`

**Geltungsbereich:** das Repository.

Schreibt den Backend-Entrypoint und ein `Dockerfile` in das Projekt und stellt das
Backend um, sodass das Repository sein eigenes Image baut, anstatt die
veröffentlichte Laufzeitumgebung auszuführen.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Was es kostet:** **Plattform-Laufzeitaktualisierungen erreichen das Projekt nicht mehr.**
CORS, Auth-Verdrahtung, Storage und Shutdown müssen von Ihnen selbst konfiguriert und
funktionsfähig gehalten werden. Dies ist die einzige Stufe auf der Leiter, die sich nur schwer rückgängig machen lässt.

Prüfen Sie dies zuerst in einer Vorschau. `--force` ersetzt eine bestehende Datei `backend/src/index.ts` oder
`env.ts` und behält die aktuelle Datei als `<name>.bak` bei.

## Wenn nichts davon die Lösung ist

Zwei Fälle sind erwähnenswert, da sie nicht in die Leiter passen.

**Natives SQL.** Sie müssen das Framework nicht verlassen, um eine Abfrage zu schreiben, die der
Query-Builder nicht abbilden kann. Schränken Sie `driver.admin` mit `isSQLAdmin` ein und nutzen Sie
`executeSql` aus einer benutzerdefinierten Funktion oder einem Hook heraus:

```typescript
import { isSQLAdmin, type DataDriver } from "@rebasepro/types";

async function topSellers(driver: DataDriver, since: string) {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) throw new Error("Native SQL is not available on this driver.");
    return admin.executeSql(
        "select product_id, sum(qty) from order_lines where created_at > $1 group by 1",
        { params: [since] }
    );
}
```

`driver` ist das, was Ihnen der Kontext einer benutzerdefinierten Funktion übergibt (`c.get("driver")`), oder
`context.driver` innerhalb eines Hooks. Grenzen Sie den Typ mit `isSQLAdmin` ein, anstatt ihn
per Typumwandlung (Cast) zu erzwingen: Dieser Guard macht den Unterschied aus zwischen einem Driver, der kein SQL ausführen kann
und dies mitteilt, und einem, der an der Aufrufstelle `admin.executeSql is not a function` auslöst.

`executeSql` gibt
jede gelesene Zeile zurück. Übergeben Sie bei SQL-Abfragen, deren Ergebnismenge Sie nicht kontrollieren, `maxResultBytes`:
Ein Ergebnis, dessen Zeilen mehr Bytes belegen, wird mit einem Fehler abgewiesen, dessen
`code` `RESULT_TOO_LARGE` lautet – es wird niemals nur teilweise zurückgegeben. Das `EXECUTE_SQL` des
Realtime-Sockets, über das das `executeSql` eines Admin-Clients läuft, setzt für jeden Aufrufer ein Limit von 128 MB.

**Etwas, das das Framework können sollte, aber nicht kann.** Wenn Sie sich dabei wiederfinden,
`@rebasepro/server-postgres` zu patchen oder für ein bestimmtes Verhalten zu ejecten, ist das
eher einen Issue wert als einen Fork –
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Sowohl `beforeQuery` als auch `search.mode: "hybrid"` existieren nur deshalb, weil ein gepatchter Driver
zuvor die einzige Alternative war.

## Verwandte Themen

- [Rebase erweitern (Frontend)](/docs/frontend/extending) – dieselbe Leiter für das Admin-Panel
- [Tabellen-Hooks](/docs/collections/callbacks)
- [Globale Hooks](/docs/backend/hooks)
- [Benutzerdefinierte Funktionen](/docs/backend/custom-functions)
- [Eigene Server-Integration](/docs/backend/custom-server)
- [Suche](/docs/backend/search)
- [Endpunkt-Index](/docs/backend/endpoints) – jede Route, die der Server mountet
