---
sourceHash: 89b27e051b61084c
title: Rebase unterstützt X nicht
sidebar_label: Server erweitern
description: Die serverseitige Erweiterungsleiter — Deklaration, Collection-Callback, benutzerdefinierte Funktion, eigene Routen, eigener Server, Eject — und was die jeweilige Stufe erreichen kann und was nicht.
---

## Übersicht

Etwas, das Sie benötigen, ist nicht in der Collection-Konfiguration enthalten. Diese Seite zeigt die Reihenfolge,
in der Sie Dinge ausprobieren sollten, und — was noch nützlicher ist — was die jeweilige Stufe *nicht* erreichen
kann, damit Sie auf der ersten Stufe anhalten, die die Aufgabe erfüllen kann.

Es gibt eine passende Seite für das Admin-Panel:
[Rebase erweitern](/docs/frontend/extending) behandelt Plugins, Slots, Komponenten-Overrides
und benutzerdefinierte Ansichten. Diese Seite hier behandelt den Server.

Die Regel, die dieser Leiter zugrunde liegt: **Jede Stufe kostet Sie etwas, das die Stufe darunter
beibehalten hat.** Eine Deklaration ist portabel, aktualisierbar und wird vom Schema-Planer,
dem generierten SDK und dem Admin-Panel verstanden. Sobald Sie
`rebase eject` erreichen, gehört Ihnen die Boot-Sequenz, und Plattform-Laufzeitaktualisierungen
erreichen Ihr Projekt nicht mehr. Klettern Sie also nur so weit, wie Sie wirklich müssen.

## Die Leiter

| # | Stufe | Erreicht | Erreicht **nicht** | Kosten dieser Stufe |
|---|---|---|---|---|
| 1 | **Deklaration** — eine Eigenschaft, eine Relation, ein Index, ein `search`-Block, eine Sicherheitsregel | Das Schema, das generierte SDK, das Admin-Panel, den Migrations-Planer | Alles, was Code ausführen muss | Keine. Dies ist der standardmäßig unterstützte Pfad |
| 2 | **Collection-Callback** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Jeden Lese- und Schreibzugriff auf eine Collection, über jedes Transportprotokoll, innerhalb der transaktionseigenen Anfrage | Anfragen, die keine Collection berühren; die Response-Envelope; alles Asynchrone zum Schreibvorgang | Läuft auf dem Hot Path und hält die Transaktion offen |
| 3 | **Benutzerdefinierte Funktion** — eine Hono-App in `functions/` | Ihre eigene URL, mit aufgelöster Auth, Driver scoped auf den Aufrufer und `rebase` griffbereit | Die integrierten `/api/data`-Routen. Sie liegt *neben* ihnen, nicht davor | Eine weitere Oberfläche zur Autorisierung; es wird keine SDK-Methode dafür generiert |
| 4 | **Eigene Routen und Middleware** auf der Hono-App | Alles rund um HTTP, einschließlich Pfade, die *vor* den Routern von Rebase laufen | Den Driver und die Identität des Aufrufers, es sei denn, Sie sichern die Route selbst ab | Außerhalb jedes Rebase-Routers: Es wurde keine Auth-Middleware ausgeführt |
| 5 | **Eigener Server** — den Driver in Express, Fastify oder reinem `http` einbetten | Den Datenadapter und Realtime in einem von Ihnen geschriebenen Prozess | Alles, was `initializeRebaseBackend` verknüpft: Auth-Routen, Storage, Jobs, Cron, Admin-API, den MCP-Server | Sie bauen das Backend selbst zusammen. Rebase ist hier eine Bibliothek, kein Koordinator |
| 6 | **`rebase eject`** | Den Einstiegspunkt und das `Dockerfile` in Ihrem Repository | — | **Plattform-Laufzeitaktualisierungen erreichen dieses Projekt nicht mehr.** CORS, Auth-Verdrahtung, Storage und Shutdown liegen in Ihrer Verantwortung |

:::tip[Zwei Stufen werden häufig ohne Grund übersprungen]
`beforeQuery` (Stufe 2) schränkt einen Lesevorgang ein, *bevor er kompiliert wird*, was
genau der Grund ist, warum Leute normalerweise zu Stufe 3 oder 5 greifen. Und ein `search`-Block mit
`mode: "hybrid"` (Stufe 1) ist das, wofür Leute typischerweise zu nativem SQL greifen. Beide sind
neu genug, dass ältere Antworten im Internet sie noch nicht erwähnen.
:::

## 1. Deklaration

Das meiste, was ein Backend benötigt, ist eine Deklaration in der Collection, denn eine
Deklaration ist die einzige Stufe, die der Rest des Systems lesen kann. Der Schema-Planer
macht daraus DDL, der Code-Generator erzeugt daraus SDK-Methoden, das Admin-Panel
rendert sie, und `rebase doctor` vergleicht sie mit der aktiven Datenbank.

| Ich möchte… | Deklarieren | Referenz |
|---|---|---|
| Eine Spalte hinzufügen | eine Eigenschaft | [Eigenschaften](/docs/collections/properties) |
| Zwei Collections verknüpfen | eine `relation`-Eigenschaft | [Relationen](/docs/collections/relations) |
| Eine Abfrage beschleunigen | `indexes` | [Indizes](/docs/backend/indexes) |
| Festlegen, wer eine Zeile lesen oder schreiben darf | `securityRules` | [Authentifizierung](/docs/backend/authentication) |
| Text richtig durchsuchen — Akzente, JSONB, Ranking, Teilstrings | einen `search`-Block | [Suche](/docs/backend/search) |
| Zeilen nach Bedeutung finden | eine `vector`-Eigenschaft | [Suche](/docs/backend/search) |
| Gelöschte Zeilen behalten | `softDelete` | [Schreibvorgänge](/docs/backend/writes) |
| Aufzeichnen, wer was geändert hat | `history` | [Verlauf](/docs/backend/history) |
| Etwas nach Zeitplan ausführen | eine Cron-Job-Datei | [Cron-Jobs](/docs/backend/cron-jobs) |
| Etwas nach einem Schreibvorgang asynchron (out of band) ausführen | einen Job | [Jobs](/docs/backend/jobs) |

**Was sie nicht erreichen kann:** Alles, was zur Laufzeit der Anfrage eine Entscheidung treffen muss.
Eine Deklaration ist ein Datenwert. Wenn die Antwort davon abhängt, wer anfragt, gehen Sie zu Stufe 2.

## 2. Collection-Callbacks

**Gültigkeitsbereich:** Eine Collection oder jede Collection, wenn sie global über
`initializeRebaseBackend({ callbacks })` registriert wird.

Callbacks werden bei **jedem** Datenpfad ausgelöst — REST, das SDK, WebSocket-Subscriptions
und serverseitige Schreibvorgänge über `rebase.dataAsAdmin` — und jeder läuft innerhalb der
Transaktion ab, die für diese Anfrage geöffnet wurde. Das ist der eigentliche Wert: Es gibt keine Möglichkeit,
an die Zeilen einer Collection heranzukommen, die an ihnen vorbeiführt.

| Callback | Wird ausgelöst | Verwenden für |
|---|---|---|
| `beforeQuery` | bevor ein Lesevorgang kompiliert wird | Einschränken, **welche Zeilen** ein Lesevorgang abfragt |
| `afterRead` | pro Zeile, nachdem sie abgerufen wurde | Reduzierung/Schwärzung, PII-Maskierung, berechnete Felder |
| `beforeSave` | nach der Validierung, vor dem Schreiben | Standardwerte, abgeleitete Spalten, Ablehnen eines Schreibvorgangs |
| `afterSave` | nach dem Schreiben, vor dem Commit | Nebeneffekte, die mit diesem rückgängig gemacht werden müssen |
| `afterSaveError` | wenn ein Speichervorgang einen Fehler wirft | Reporting; `props.error` ist der ausgelöste Fehler |
| `beforeDelete` | vor dem Löschen | Ablehnen des Löschvorgangs |
| `afterDelete` | nach dem Löschen, vor dem Commit | Kaskadierendes Bereinigen |

→ [Collection-spezifische Callbacks](/docs/collections/callbacks) ·
[Globale Hooks](/docs/backend/hooks)

### Einen Lesevorgang mit `beforeQuery` einschränken

`afterRead` sieht Zeilen, die bereits abgerufen wurden; es kann also einen Wert
schwärzen, aber nicht verhindern, dass die Zeile gelesen wird. `beforeQuery` läuft früher: Es erhält die
geparste Abfrage und gibt Bedingungen zurück, die per **AND** angehängt werden.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Drei Eigenschaften sollten Sie kennen, bevor Sie sich darauf verlassen:

- **Es kann nur einschränken.** Der Rückgabewert ist ein Filter, der per AND verknüpft wird, und es gibt
  keine Form von Rückgabewert, die den Lesevorgang erweitern kann. Das ist beabsichtigt: Würde ein Hook
  die Abfrage erhalten und eine modifizierte zurückgeben, könnte er eine Bedingung verwerfen; auf einer
  Datenebene mit Row-Level-Security würde eine verworfene Bedingung jede Zeile zurückgeben, die
  die Policies zufällig erlauben.
- **Es wird auf jedem Lesepfad ausgelöst.** Auflistung, einzelnes Abrufen, Zählung (count),
  Aggregation, Suche, Vektor-Lesevorgang, verschachtelte Pfadauflistung, das Realtime-Refetching,
  das Subscription-Frames erstellt, und die Zeilen, die für eine Relation oder ein `?include=` geladen
  werden — wobei hier der Hook der **Ziel-Collection** gilt.
  Ein Hook, der von der Listenansicht berücksichtigt wird, aber nicht von der Zählung, führt zu einer Seite,
  die "1 von 4 Ergebnissen" anzeigt.
- **Ein Filter, der nicht kompiliert werden kann, weist die Anfrage ab.** Das Benennen einer Spalte, die
  die Tabelle nicht besitzt, führt zu einem 400-Fehler und nicht zu einer verworfenen Bedingung, unabhängig davon,
  wie `configureUnknownFilterFields` konfiguriert ist.

Ein Lesevorgang wird bewusst *nicht* eingeschränkt: die Eindeutigkeitsprüfung hinter
`validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der
Tabelle existiert; würde sie eingeschränkt, würde sie für einen Wert, den eine ausgeblendete Zeile
bereits enthält, "eindeutig" melden — was dazu führen würde, dass der Insert stattdessen am Constraint scheitert.

`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine Collection, die von einer
anderen Engine bereitgestellt wird und dies deklariert, **schlägt beim Booten fehl** (mit namentlicher Nennung),
anstatt dass der Hook stillschweigend inaktiv bleibt. Dasselbe gilt für einen globalen Hook neben einer
Datenquelle, die nicht Postgres ist. Schwärzung/Reduzierung, die auf jeder Engine funktioniert, ist `afterRead`.

**Was Callbacks nicht erreichen können:**

- Eine Anfrage, die keine Collection berührt. Es gibt nichts, woran sich der Callback
  anhängen könnte.
- Die Response-Envelope — Statuscode, Header, Paginierungsstruktur. Ein Callback
  gibt Werte zurück, keine Response.
- Aufgaben, die die Transaktion überdauern müssen. `afterSave` läuft *vor* dem Commit;
  wird dort ein Fehler geworfen, wird der Schreibvorgang zurückgerollt. Alles, was das
  Rückgängigmachen des Schreibvorgangs überstehen muss, ist nicht Teil des Schreibvorgangs: Platzieren Sie es in der
  [Job-Queue](/docs/backend/jobs).
- In der Praxis: langwierige Aufgaben. Ein Callback hält die Transaktion offen und damit
  eine Verbindung aus dem Pool. Alles, was mit Drittanbietern kommuniziert, gehört in die Queue.

## 3. Benutzerdefinierte Funktionen

**Gültigkeitsbereich:** Eine URL unter `/api/functions`.

Eine Hono-App in `backend/functions/`, die wie Collections und Cron-Jobs über den Dateinamen
erkannt wird. Die Auth-Middleware wurde bereits ausgeführt, wenn Ihr Handler erreicht wird,
der Driver ist auf den Aufrufer begrenzt und `rebase` steht für Storage, E-Mail,
Jobs und `dataAsAdmin` zur Verfügung.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.collection("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Benutzerdefinierte Funktionen](/docs/backend/custom-functions)

**Was sie nicht erreichen können:** Die integrierten `/api/data`-Routen. Eine Funktion sitzt
*neben* ihnen, nicht davor; sie kann also nicht ändern, wie eine Liste gefiltert,
paginiert oder strukturiert wird — das ist Stufe 2. Sie erhält auch keine generierte
SDK-Methode; Aufrufer erreichen sie über `client.functions.invoke(...)` oder einfaches `fetch`.

## 4. Eigene Routen und Middleware

**Gültigkeitsbereich:** Die Hono-App, bevor Rebase sie anfasst.

`initializeRebaseBackend` akzeptiert die App, die Sie übergeben; alles, was Sie auf
dieser App registrieren, *bevor* Sie die Funktion aufrufen, läuft vor jedem Rebase-Router — siehe
[Reihenfolge der Routenregistrierung](/docs/backend/custom-functions#route-registration-order)
für den genauen Aufbau.

:::caution[Dort wurde keine Auth-Middleware ausgeführt]
Eine auf diese Weise registrierte Route befindet sich **außerhalb** jedes Rebase-Routers;
`getDriver(c)` ist also nicht gesetzt und es wurde kein Token überprüft. Sichern Sie sie mit
`requireAuth` / `requireAdmin` ab, importiert aus **`@rebasepro/server`** — dem
Paket-Root —, die den Token selbst validieren. Die aus
`@rebasepro/server/functions` exportierten Guards lesen eine Identität aus, die ein Rebase-Router
bereits aufgelöst hat, und antworten mit 500, anstatt vorzugeben, dass eine existiert.
:::

Eine Hono-Falle, die man erwähnen sollte, weil sie still auftritt: `app.use("/*", guard)` deckt
nur die Routen ab, die *darunter* deklariert sind. Eine später angehängte Route — ganz unten in
der Datei, Monate später — ist ungeschützt. Platzieren Sie Guards im Middleware-Slot der jeweiligen Route selbst.

**Was sie nicht erreichen können:** Die Identität, den zugewiesenen Driver und die Error-Envelope
— es sei denn, Sie verdrahten alles selbst. Alles, was ein Rebase-Router einem Handler übergibt,
ist etwas, das ein Rebase-Router ausgeführt hat.

## 5. Eigener Server

**Gültigkeitsbereich:** Der Prozess.

`@rebasepro/server-postgres` ist framework-agnostisch: Es hängt von Drizzle und
Nodes `http.Server` ab und von sonst nichts. Sie können den Datenadapter und
Realtime also in Express, Fastify oder reines Node einbetten und den Koordinator komplett weglassen.

→ [Eigene Server-Integration](/docs/backend/custom-server)

**Was er nicht erreichen kann:** Alles, was `initializeRebaseBackend` verknüpft, was
den Großteil des Backends ausmacht — die Auth-Routen und Token-Aktualisierung, Storage, die Job-Queue,
Cron, die Admin-API, mit der das Studio kommuniziert, der MCP-Server, die Error-Envelope,
der Middleware-Stack. Jedes dieser Elemente kann manuell zusammengestellt werden;
keines davon baut sich von selbst zusammen. Rebase ist auf dieser Stufe eine Bibliothek, kein Koordinator.

Greifen Sie darauf zurück, wenn Sie einen bestehenden Server haben, der der Einstiegspunkt bleiben muss.
Wenn Sie eigentlich nur eine eigene Route benötigen, ist das Stufe 3 oder 4, bei einem Bruchteil
des Aufwands.

## 6. `rebase eject`

**Gültigkeitsbereich:** Das Repository.

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen
Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte
Laufzeitumgebung auszuführen.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Was es kostet:** **Plattform-Laufzeitaktualisierungen erreichen das Projekt nicht mehr.**
CORS, Auth-Verdrahtung, Storage und Shutdown müssen von Ihnen konfiguriert und funktionstüchtig
gehalten werden. Dies ist die einzige Sprosse auf der Leiter, die sich nur schwer rückgängig machen lässt.

Führen Sie vorher eine Vorschau durch. `--force` ersetzt eine bestehende `backend/src/index.ts` oder
`env.ts`, behält die aktuelle Datei jedoch als `<name>.bak`.

## Wenn keines davon die Lösung ist

Zwei Fälle sind erwähnenswert, da die Leiter nicht auf sie passt.

**Natives SQL.** Sie müssen das Framework nicht verlassen, um eine Abfrage zu schreiben, die der
Query-Builder nicht ausdrücken kann. Schränken Sie `driver.admin` mit `isSQLAdmin` ein und verwenden Sie
`executeSql` aus einer benutzerdefinierten Funktion oder einem Callback:

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
`context.driver` innerhalb eines Callbacks. Grenzen Sie ihn mit `isSQLAdmin` ein, anstatt zu casten:
Der Guard macht den Unterschied aus, ob ein Driver, der kein SQL ausführen kann, dies mitteilt,
oder ob an der Aufrufstelle ein Fehler wie `admin.executeSql is not a function` geworfen wird.

**Etwas, das das Framework tun sollte, aber nicht tut.** Wenn Sie dabei sind,
`@rebasepro/server-postgres` zu patchen oder für ein einzelnes Verhalten ein Eject durchzuführen,
ist das eher ein Issue als ein Fork wert —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Sowohl `beforeQuery` als auch `search.mode: "hybrid"` existieren, weil ein
gepatchter Driver zuvor die einzige Alternative war.

## Verwandte Themen

- [Rebase erweitern (Frontend)](/docs/frontend/extending) — dieselbe Leiter für das Admin-Panel
- [Collection-spezifische Callbacks](/docs/collections/callbacks)
- [Globale Hooks](/docs/backend/hooks)
- [Benutzerdefinierte Funktionen](/docs/backend/custom-functions)
- [Eigene Server-Integration](/docs/backend/custom-server)
- [Suche](/docs/backend/search)
- [Endpunkt-Index](/docs/backend/endpoints) — alle Routen, die der Server bereitstellt
