---
sourceHash: 41183c8dc79d618d
title: Rebase unterstützt X nicht
sidebar_label: Server erweitern
description: Die serverseitige Erweiterungsleiter – Deklaration, Collection-Callback, benutzerdefinierte Funktion, eigene Routen, eigener Server, Eject – und was die einzelnen Stufen erreichen können und was nicht.
---

## Übersicht

Etwas, das Sie benötigen, ist nicht in der Collection-Konfiguration enthalten. Diese Seite zeigt die Reihenfolge, in der Sie vorgehen sollten, und – noch nützlicher – was die einzelnen Stufen *nicht* erreichen können, damit Sie bei der ersten Stufe aufhören, die die Aufgabe lösen kann.

Es gibt eine entsprechende Seite für das Admin-Panel:
[Rebase erweitern (Frontend)](/docs/frontend/extending) behandelt Plugins, Slots,
Komponenten-Overrides und benutzerdefinierte Ansichten. Diese Seite hier behandelt den Server.

Die Regel, die dieser Leiter zugrunde liegt: **Jede Stufe kostet Sie etwas, das die
darunterliegende noch beibehalten hat.** Eine Deklaration ist portabel, aktualisierbar
und wird vom Schema-Planer, dem generierten SDK und dem Admin-Panel verstanden.
Sobald Sie `rebase eject` erreichen, gehört Ihnen die Boot-Sequenz, und Plattform-Laufzeit-Upgrades
erreichen Ihr Projekt nicht mehr. Klettern Sie also nur so weit, wie Sie wirklich müssen.

## Die Leiter

| # | Stufe | Erreicht | Erreicht **nicht** | Kosten dieser Stufe |
|---|---|---|---|---|
| 1 | **Deklaration** — eine Eigenschaft, eine Relation, ein Index, ein `search`-Block, eine Sicherheitsregel | Das Schema, das generierte SDK, das Admin-Panel, den Migrationsplaner | Alles, was Code ausführen muss | Keine. Dies ist der empfohlene Weg |
| 2 | **Collection-Callback** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Jeden Lese- und Schreibzugriff auf eine Collection, über jedes Transportprotokoll, innerhalb der anfrageeigenen Transaktion | Anfragen, die keine Collection berühren; den Response-Envelope; alles, was asynchron zum Schreibvorgang ist | Läuft auf dem Hot Path und hält die Transaktion offen |
| 3 | **Benutzerdefinierte Funktion** — eine Hono-App in `functions/` | Eine eigene URL mit aufgelöster Authentifizierung, dem auf den Aufrufer beschränkten Treiber und `rebase` griffbereit | Die integrierten `/api/data`-Routen. Sie liegt *neben* ihnen, nicht davor | Eine zusätzliche Autorisierungsfläche; es wird keine SDK-Methode dafür generiert |
| 4 | **Eigene Routen und Middleware** auf der Hono-App | Alles über HTTP, einschließlich Pfade, die *vor* den Routern von Rebase ausgeführt werden | Den Treiber und die Identität des Aufrufers, es sei denn, Sie sichern die Route selbst ab | Liegt außerhalb jedes Rebase-Routers: Es wurde keine Authentifizierungs-Middleware ausgeführt |
| 5 | **Eigener Server** — Einbetten des Treibers in Express, Fastify oder einfaches `http` | Den Datenadapter und Realtime, in einem von Ihnen geschriebenen Prozess | Alles, was `initializeRebaseBackend` bereitstellt: Authentifizierungsrouten, Speicher, Jobs, Cron, Admin-API, den MCP-Server | Sie bauen das Backend selbst zusammen. Rebase ist hier eine Bibliothek, kein Koordinator |
| 6 | **`rebase eject`** | Den Einstiegspunkt und das `Dockerfile` in Ihrem Repository | — | **Plattform-Laufzeit-Upgrades erreichen dieses Projekt nicht mehr.** CORS, Auth-Verdrahtung, Speicher und Shutdown liegen in Ihrer Verantwortung |

:::tip[Zwei Stufen werden häufig grundlos übersprungen]
`beforeQuery` (Stufe 2) schränkt einen Lesevorgang ein, *bevor er kompiliert wird* – genau
das, wofür meist Stufe 3 oder 5 gewählt wird. Und ein `search`-Block mit
`mode: "hybrid"` (Stufe 1) ist das, wozu viele zu nativem SQL greifen. Beide sind
noch so neu, dass ältere Antworten im Internet sie nicht erwähnen.
:::

## 1. Deklaration

Das meiste, was ein Backend benötigt, ist eine Deklaration in der Collection, denn
eine Deklaration ist die einzige Stufe, die der Rest des Systems lesen kann. Der Schema-Planer
wandelt sie in DDL um, der Code-Generator macht daraus SDK-Methoden, das Admin-Panel
rendert sie und `rebase doctor` vergleicht sie mit der Live-Datenbank.

| Ich möchte… | Deklaration | Referenz |
|---|---|---|
| Eine Spalte hinzufügen | eine Eigenschaft | [Eigenschaften](/docs/collections/properties) |
| Zwei Collections verknüpfen | eine `relation`-Eigenschaft | [Relationen](/docs/collections/relations) |
| Eine Abfrage beschleunigen | `indexes` | [Indizes](/docs/backend/indexes) |
| Bestimmen, wer eine Zeile lesen oder schreiben darf | `securityRules` | [Authentifizierung](/docs/backend/authentication) |
| Text richtig durchsuchen – Akzente, JSONB, Ranking, Teilstrings | einen `search`-Block | [Suche](/docs/backend/search) |
| Zeilen nach Bedeutung finden | eine `vector`-Eigenschaft | [Suche](/docs/backend/search) |
| Gelöschte Zeilen aufbewahren | `softDelete` | [Schreibvorgänge](/docs/backend/writes) |
| Protokollieren, wer was geändert hat | `history` | [Verlauf](/docs/backend/history) |
| Etwas nach Zeitplan ausführen | eine Cron-Job-Datei | [Cron-Jobs](/docs/backend/cron-jobs) |
| Etwas nach einem Schreibvorgang asynchron ausführen | einen Job | [Jobs](/docs/backend/jobs) |

**Was sie nicht erreichen kann:** Alles, was zum Zeitpunkt der Anfrage eine Entscheidung treffen muss.
Eine Deklaration besteht aus Daten. Wenn die Antwort davon abhängt, wer die Anfrage stellt, wechseln Sie zu Stufe 2.

## 2. Collection-Callbacks

**Geltungsbereich:** Eine Collection oder jede Collection, wenn sie global über
`initializeRebaseBackend({ callbacks })` registriert wird.

Callbacks werden auf **jedem** Datenpfad ausgelöst – REST, dem SDK, WebSocket-Abonnements
und serverseitigen Schreibvorgängen über `rebase.dataAsAdmin` – und jeder läuft innerhalb der
für diese Anfrage geöffneten Transaktion. Darin liegt der entscheidende Vorteil: Es gibt keinen Weg
an ihnen vorbei, um auf die Zeilen einer Collection zuzugreifen.

| Callback | Wird ausgelöst | Verwendung für |
|---|---|---|
| `beforeQuery` | bevor ein Lesevorgang kompiliert wird | Eingrenzen, **welche Zeilen** ein Lesevorgang abfragt |
| `afterRead` | pro Zeile, nachdem sie abgerufen wurde | Schwärzung/Maskierung, PII-Maskierung, berechnete Felder |
| `beforeSave` | nach der Validierung, vor dem Schreiben | Standardwerte, abgeleitete Spalten, Ablehnen eines Schreibvorgangs |
| `afterSave` | nach dem Schreiben, vor dem Commit | Seiteneffekte, die bei einem Rollback mit rückgängig gemacht werden müssen |
| `afterSaveError` | wenn beim Speichern ein Fehler auftritt | Reporting; `props.error` ist der aufgetretene Fehler |
| `beforeDelete` | vor dem Löschen | Ablehnen des Löschvorgangs |
| `afterDelete` | nach dem Löschen, vor dem Commit | kaskadierende Bereinigung |

→ [Callbacks pro Collection](/docs/collections/callbacks) ·
[Globale Hooks](/docs/backend/hooks)

### Einen Lesevorgang mit `beforeQuery` eingrenzen

`afterRead` sieht Zeilen, die bereits abgerufen wurden; es kann also einen Wert schwärzen oder maskieren,
aber nicht verhindern, dass die Zeile gelesen wird. `beforeQuery` wird früher ausgeführt: Es erhält die
analysierte Abfrage und gibt Bedingungen zurück, die per **AND** mit ihr verknüpft werden.

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

- **Es kann nur eingrenzen.** Der Rückgabewert ist ein Filter, der per AND verknüpft wird, und es
  gibt keine Rückgabeform, die den Lesevorgang erweitern kann. Das ist beabsichtigt: Ein Hook,
  der die Abfrage erhält und eine neue zurückgeben soll, könnte eine Bedingung weglassen – und auf
  einer Daten-Ebene mit Row-Level Security würde eine weggelassene Bedingung jede Zeile zurückliefern,
  die die Policies zufällig erlauben.
- **Es wird auf jedem Lesepfad ausgelöst.** Bei der Listenansicht, dem einzelnen Abruf (Get), dem Count,
  Aggregaten, der Suche, Vektorabfragen, Listen verschachtelter Pfade, dem Realtime-Refetch zum
  Erstellen von Abonnement-Frames und den für eine Relation oder ein `?include=` geladenen Zeilen – wobei
  hier der Hook der **Ziel-Collection** greift. Ein Hook, der bei der Auflistung berücksichtigt wird, beim
  Count jedoch nicht, führt zu einer Seite, die „1 von 4 Ergebnissen“ anzeigt.
- **Ein Filter, der nicht kompiliert werden kann, weist die Anfrage ab.** Die Angabe einer Spalte,
  die in der Tabelle nicht existiert, führt zu einem 400-Fehler, nicht zu einer ignorierten Bedingung – unabhängig
  davon, wie `configureUnknownFilterFields` konfiguriert ist.
- **Ein Schreibzugriff auf eine ausgeschlossene Zeile führt zu einem 404.** Eine Aktualisierung oder ein
  Löschvorgang für eine Zeile außerhalb des Bereichs wird vor dem Schreiben mit derselben „no row …“-Antwort
  abgelehnt wie bei einem Lesezugriff – ein Scope gilt also auch für Schreibvorgänge, nicht nur für
  Lesevorgänge. Was es *nicht* prüft, sind die geschriebenen Werte selbst: Das Ablehnen eines Schreibvorgangs
  anhand seines Inhalts ist die Aufgabe von `beforeSave`.

Ein Lesevorgang wird bewusst *nicht* eingegrenzt: die Eindeutigkeitsprüfung hinter
`validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert; wäre sie
eingegrenzt, würde sie für einen Wert, den eine ausgeblendete Zeile bereits enthält, „eindeutig“ zurückgeben –
wodurch der Insert stattdessen an der Datenbank-Constraint scheitern würde.

`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine Collection, die von einer anderen
Engine bedient wird und diesen Hook deklariert, **schlägt beim Booten fehl** (unter Nennung des Namens), anstatt
mit einem stillschweigend inaktiven Hook ausgeführt zu werden. Dasselbe gilt für einen globalen Hook an
einer Datenquelle, die nicht Postgres ist. Eine Datenmaskierung, die auf jeder Engine funktioniert, ist `afterRead`.

**Was Callbacks nicht erreichen können:**

- Eine Anfrage, die keine Collection betrifft. Es gibt keinen Bezugspunkt, an dem der Callback ansetzen könnte.
- Den Response-Envelope – Statuscode, Header, Paginierungsformat. Ein Callback gibt Werte zurück, keine HTTP-Response.
- Aufgaben, die die Transaktion überdauern müssen. `afterSave` läuft *vor* dem Commit; ein dort ausgelöster
  Fehler führt also zu einem Rollback des Schreibvorgangs. Alles, was auch bei einem Rollback erhalten bleiben muss,
  gehört nicht zum Schreibvorgang: Verlagern Sie es in die [Job-Queue](/docs/backend/jobs).
- Langwierige Aufgaben in der Praxis. Ein Callback hält die Transaktion und damit eine gepoolte Datenbankverbindung
  offen. Alles, was mit externen Diensten kommuniziert, gehört in die Queue.

## 3. Benutzerdefinierte Funktionen

**Geltungsbereich:** Eine URL unter `/api/functions`.

Eine Hono-App in `backend/functions/`, die wie Collections und Cron-Jobs anhand des Dateinamens
erkannt wird. Die Authentifizierungs-Middleware wurde bereits ausgeführt, wenn Ihr Handler erreicht wird,
der Treiber ist auf den Aufrufer beschränkt und `rebase` steht für Speicher, E-Mails, Jobs und
`dataAsAdmin` zur Verfügung.

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

**Was sie nicht erreichen kann:** Die integrierten `/api/data`-Routen. Eine Funktion liegt
*neben* ihnen, nicht davor, sodass sie nicht ändern kann, wie eine Auflistung gefiltert,
paginiert oder strukturiert wird – dafür ist Stufe 2 zuständig. Für sie wird auch keine generierte
SDK-Methode bereitgestellt; Aufrufer erreichen sie über `client.functions.invoke(...)` oder ein gewöhnliches `fetch`.

## 4. Eigene Routen und Middleware

**Geltungsbereich:** Die Hono-App, bevor Rebase sie berührt.

`initializeRebaseBackend` übernimmt die App, die Sie übergeben. Alles, was Sie *vor* dem Aufruf
auf dieser App registrieren, läuft vor jedem Rebase-Router – siehe
[Reihenfolge der Routenregistrierung](/docs/backend/custom-functions#route-registration-order)
für den genauen Aufbau.

:::caution[Dort wurde keine Authentifizierungs-Middleware ausgeführt]
Eine auf diese Weise registrierte Route liegt **außerhalb** jedes Rebase-Routers, daher ist
`getDriver(c)` nicht gesetzt und kein Token wurde überprüft. Sichern Sie sie mit
`requireAuth` / `requireAdmin` ab, importiert aus **`@rebasepro/server`** – dem
Paket-Root –, welche das Token selbst verifizieren. Die aus
`@rebasepro/server/functions` exportierten Guards lesen eine Identität aus, die bereits von einem
Rebase-Router aufgelöst wurde, und antworten mit 500, anstatt vorzutäuschen, dass eine existiert.
:::

Eine Hono-Falle, die man erwähnen sollte, da sie unbemerkt bleibt: `app.use("/*", guard)` deckt
nur Routen ab, die *darunter* deklariert sind. Eine Route, die später – vielleicht in einigen Monaten
am Ende der Datei – hinzugefügt wird, bleibt ungeschützt. Platzieren Sie Guards im Middleware-Slot
der jeweiligen Route.

**Was sie nicht erreichen kann:** Die Identität, den benutzerbezogenen Treiber und den Error-Envelope
– es sei denn, Sie binden diese selbst an. Alles, was ein Rebase-Router einem Handler bereitstellt, wurde
von einem Rebase-Router ausgeführt.

## 5. Eigener Server

**Geltungsbereich:** Der Prozess.

`@rebasepro/server-postgres` ist framework-agnostisch: Es hängt von Drizzle und Nodes
`http.Server` ab und von sonst nichts. Sie können den Datenadapter und Realtime also in Express,
Fastify oder reines Node einbetten und den Koordinator vollständig umgehen.

→ [Eigene Server-Integration](/docs/backend/custom-server)

**Was er nicht erreichen kann:** Alles, was `initializeRebaseBackend` bereitstellt – und das
ist der Großteil des Backends: Die Auth-Routen und Token-Aktualisierung, Speicher, die Job-Queue,
Cron, die Admin-API, mit der das Studio kommuniziert, der MCP-Server, der Error-Envelope und der
Middleware-Stack. Jede dieser Komponenten kann manuell eingebunden werden, aber keine richtet sich
von selbst ein. Auf dieser Stufe ist Rebase eine Bibliothek, kein Koordinator.

Wählen Sie diese Option, wenn Sie bereits einen bestehenden Server haben, der der Haupteinstiegspunkt
bleiben muss. Wenn Sie eigentlich nur eine eigene Route benötigen, entspricht das Stufe 3 oder 4 – bei
einem Bruchteil des Aufwands und der Angriffsfläche.

## 6. `rebase eject`

**Geltungsbereich:** Das Repository.

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt das Backend um,
sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte Laufzeitumgebung auszuführen.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Was es kostet:** **Plattform-Laufzeit-Upgrades erreichen das Projekt nicht mehr.**
CORS, Auth-Konfiguration, Speicher und der Shutdown-Prozess müssen nun von Ihnen konfiguriert
und instand gehalten werden. Dies ist die einzige Stufe auf der Leiter, die sich nur schwer
rückgängig machen lässt.

Führen Sie zuerst eine Vorschau aus. `--force` ersetzt eine vorhandene `backend/src/index.ts` oder
`env.ts` und sichert die aktuelle Datei als `<name>.bak`.

## Wenn keine dieser Optionen zutrifft

Zwei Fälle sind erwähnenswert, da sie nicht in das Stufenschema passen.

**Natives SQL.** Sie müssen das Framework nicht verlassen, um eine Abfrage zu schreiben, die der
Query-Builder nicht abbilden kann. Schränken Sie den Typ von `driver.admin` mit `isSQLAdmin` ein und nutzen
Sie `executeSql` aus einer benutzerdefinierten Funktion oder einem Callback heraus:

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

`driver` ist das, was der Kontext einer benutzerdefinierten Funktion bereitstellt (`c.get("driver")`)
bzw. `context.driver` innerhalb eines Callbacks. Grenzen Sie den Typ mit `isSQLAdmin` ein, anstatt
einen Type-Cast zu verwenden: Dieser Type-Guard macht den Unterschied aus zwischen einem Treiber, der
explizit meldet, dass er kein SQL ausführen kann, und einem Fehler `admin.executeSql is not a function`
am Aufrufort.

**Etwas, das das Framework können sollte, aber nicht tut.** Wenn Sie feststellen, dass Sie
`@rebasepro/server-postgres` patchen oder für ein bestimmtes Verhalten einen Eject durchführen müssen,
ist das eher ein Issue wert als ein Fork –
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Sowohl `beforeQuery` als auch `search.mode: "hybrid"` existieren nur deshalb, weil ein gepatchter
Treiber zuvor die einzige Alternative war.

## Verwandte Themen

- [Rebase erweitern (Frontend)](/docs/frontend/extending) – dieselbe Leiter für das Admin-Panel
- [Callbacks pro Collection](/docs/collections/callbacks)
- [Globale Hooks](/docs/backend/hooks)
- [Benutzerdefinierte Funktionen](/docs/backend/custom-functions)
- [Eigene Server-Integration](/docs/backend/custom-server)
- [Suche](/docs/backend/search)
- [Endpunkt-Übersicht](/docs/backend/endpoints) – alle Routen, die der Server bereitstellt
