---
sourceHash: fc4e87a4b7e7a310
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP über ein deploytes Backend unter /mcp bereit, sodass Personen, die Ihre App nutzen, Claude oder Cursor als sie selbst verbinden können – OAuth mit Zustimmungsbildschirm, zwölf Tools unter drei Scopes, jeder Aufruf unter deren eigener Row-Level Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase-Connector](/docs/ai/rebase-connector/): ein einziger Connector
für alle Projekte, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect` damit. Diese
Seite ist für die Personen gedacht, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwickler-Tool: Er läuft auf Ihrem Rechner und verwendet einen
Service-Key oder einen API-Key. Ein deploytes Backend kann MCP unter `/mcp` auch selbst für die
Personen bereitstellen, die Ihre Anwendung nutzen. Wenn ein Assistent von einer dieser Personen verbunden wird,
liest und schreibt er im Projekt **als diese Person**, und jeder Aufruf wird unter deren eigener
Row-Level Security ausgeführt.

Dieser Endpunkt ist standardmäßig deaktiviert. Beide Umgebungsvariablen sind erforderlich, um ihn zu aktivieren:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # die tatsächliche Origin dieses Deployments
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage auf einen einzelnen Benutzer
beschränken kann, weigert sich der Endpunkt zu mounten und gibt den Grund im Boot-Log aus. Keine
`REBASE_ROLE` schaltet ihn ein.

- **OAuth mit Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiv; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt dies
  auf Clients, die Sie registrieren) und leitet die Person zu einem Zustimmungsbildschirm weiter,
  der sie über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird anschließend über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code
  oder einem Wiederherstellungscode gefragt. Wenn das Frontend Ihrer eigenen App
  eine Sitzung im selben Browser hält, bietet der Bildschirm dieses Konto an, und
  „Zulassen“ erteilt die Zustimmung ohne Passwort; auf diese Weise verbinden sich Personen,
  die sich ausschließlich mit Google, GitHub oder einem E-Mail-Link anmelden. Andernfalls erfolgt die Anmeldung mit einem
  Passwort. Wenn jemand noch keines hat, wird zuerst über `/auth/forgot-password` eines vergeben
  (die „Passwort vergessen“-Funktion Ihrer App); der Bildschirm weist darauf hin. Er nennt außerdem den Host, an den der Autorisierungscode gesendet
  wird, und weist darauf hin, dass dieser Host nicht verifiziert ist: Da jeder einen Client unter
  einem beliebigen Namen registrieren kann, ist der Host der Teil, den eine Person überprüfen kann.
- **Zwölf Tools, drei Scopes.** <span class="since-badge" data-since="0.29">Seit 0.29</span> Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die alle Anmeldedaten verwenden. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` und die drei Views
  `show_collection`, `show_record` und `show_app`; `data:write` fügt `create_document` und
  `update_document` hinzu; `data:delete` ergänzt `delete_document`. Ein Client, der
  keine Scopes anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Collection eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und nichts anderes. Ein Scope bestimmt, welche Tools
  angeboten werden und auf welche Collections sie zugreifen können, nicht welche Zeilen: Eine leere Liste kann
  das Resultat von RLS sein, und `data:write` kann weiterhin keine Zeilen schreiben, auf die die Person keinen Zugriff hat.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client, der
  MCP Apps rendert (wie z. B. Claude), öffnen sie die Ansichten des Admin-Panels direkt in der
  Konversation, abgeleitet aus Ihren Collections: deren Felder, Enums, Validierungen,
  Relationen, Formularabschnitte und Ansichtseinstellungen.
  - `show_collection` akzeptiert die Argumente von `query_collection` sowie `view`
    (`table`, `list`, `cards` oder `kanban`) und öffnet die Collection-Ansicht: Die
    Person kann suchen, filtern, sortieren, paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer einzelnen Zeile (`id`) oder ein Formular für eine neue Zeile,
    vorausgefüllt mit den vom Modell bereitgestellten `values`, damit die Person die Daten selbst
    prüfen und speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine einzelne
    React-Komponente (`code`) und die `collections`, die sie liest. Sie importiert die Rebase-eigenen
    Pakete, sodass derselbe Code in Ihrem Projekt funktioniert:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      und `useRowWrites` über die Zeilen des Projekts;
    - `@rebasepro/cms`: das `CollectionPanel` des Admin-Panels (mit
      `CollectionToolbar` und dessen Bestandteilen sowie `onRowClick`, das der
      App die angeklickte Zeile so übergibt, wie `useRows` sie liest), `EntityFormPanel` und `FormField`,
      `EntityViewPanel`, `FieldValue` und `useSidePanel`, die jeweils ihre
      Collection über den Pfad benennen, mit Ihren benutzerdefinierten Feldern, Ansichten und Aktionen;
    - `@rebasepro/ui`: das gesamte UI-Kit, einschließlich `SplitView` sowie KPI-Kacheln und
      Diagrammen.

    Der Server kompiliert den Code vorab. Ein Syntaxfehler, ein Modul, das die View
    nicht bereitstellt, oder ein Name, der nicht von `@rebasepro/cms` oder
    `@rebasepro/app` exportiert wird, führt zu einem Fehler des Aufrufs inklusive Zeilenangabe. Ein Fehler während der
    Laufzeit wird an entsprechender Stelle angezeigt und dem Modell mit der nächsten Nachricht
    der Person übermittelt. Eine App darf nur die Collections verwenden, die sie auflistet. Für Styles
    werden die Standard-Utilities von Tailwind verwendet, die zusammen mit der View kompiliert werden,
    bevor eine App geladen wird: Ein Arbitrary-Wert wie `h-[560px]` hat dort keine Auswirkung, weshalb
    eine exakte Größe über `style` definiert werden muss.

  Jeder Lese- und Speichervorgang in der View ist ein Aufruf der Lese- und Schreib-Tools,
  ausgeführt als die jeweilige Person unter deren RLS. Ein Formular bietet daher nur das,
  was der Verbindung gewährt wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das die Rollen der Person nicht lesen dürfen, wird nicht angezeigt. Das ist dieselbe Grenze,
  in der sich auch der Code einer App bewegt: Er läuft innerhalb der View, sodass jeder Aufruf
  über diese Tools im Namen der Person erfolgt – die App kann nichts tun, was das Modell nicht auch
  mit denselben Tools tun könnte. Auf dem gehosteten Connector wird jeder Schreibvorgang zudem vom
  Server geplant und bestätigt. Innerhalb dieses Rahmens fragt `useRowWrites` die Person
  vor dem Schreiben um Erlaubnis, sodass eine App nicht ohne deren Klick schreibt; die
  eigenen Steuerelemente des Admins (das Speichern eines Formulars, Löschen, Bearbeiten in einer Tabelle) verhalten sich genauso
  wie in einer `show_collection`-Ansicht. Dem Modell wird mitgeteilt, was geändert wurde. Es liest die von den Tools zurückgegebenen Zeilen, nicht die Collection-Konfigurationen,
  mit denen die View gerendert wird. Ein Client ohne Unterstützung für MCP Apps (wie Claude Code oder Cursor) zeigt nichts an,
  und das Modell liest dieselben Zeilen, die es über `query_collection` erhalten würde.
- **Vor Version 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird als
  `data:read` interpretiert und `mcp:write` als `data:write data:delete`, sowohl bei gespeicherten Berechtigungen
  als auch bei bereits ausgestellten Tokens.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  Clients, die über einen Header statt über einen OAuth-Flow konfiguriert sind. Der Key kann
  die Tools aufrufen, die durch seine `data:*`-Scopes abgedeckt sind, und zwar in der entsprechenden Rolle: Ein
  [persönlicher Schlüssel](/docs/backend/api-keys/#personal-keys) als dessen Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` sowie `data` für
  Schreibvorgänge – und lesen über den Pfad `GET /api/data/<collection>`. Zeilen werden daher so
  zurückgegeben, wie REST sie ausliefert (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`), und können bei einem Update unverändert zurückgesendet werden. `query_collection`
  antwortet mit `{ data, meta }` inklusive `meta.total` und `meta.hasMore`, und `count_documents`
  mit `{ count }`. `aggregate_documents` entspricht `GET /api/data/<collection>/aggregate`:
  `select` ist eine Liste in REST-Syntax (`["count()", "sum(total)"]`), `groupBy`
  eine Liste von Feldern, und die Antwort ist `{ data }` mit einer Zeile pro Gruppe sowie
  `meta.hasMore` bei einem gruppierten Aufruf, dessen Gruppen mit `limit` und `offset`
  paginiert und mit `orderBy` sortiert werden können. Bei einer Collection, die durch einen `afterRead`-Callback
  umgeschrieben wird, gibt die Methode wie REST ausschließlich `count()` zurück. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer im Papierkorb liegenden Zeile (404) abgelehnt; das Setzen des Soft-Delete-Feldes
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection`, `count_documents` und `aggregate_documents` liest gelöschte Einträge, analog zu RESTs
  `?deleted=`, sodass eine durch `delete_document` in den Papierkorb verschobene Zeile zur Wiederherstellung
  wiedergefunden werden kann. Die Beschreibung weist das Modell darauf hin, dass der Löschvorgang nur dann
  dauerhaft ist, wenn die Collection kein Soft-Delete-Feld hat.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das Schema.**
  `list_collections` liefert `name`, `title` und `description` jeder Collection zurück,
  und `describe_collection { collection }` die OpenAPI-Schemas `row` und
  `create` dieser Collection, ergänzt um `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden. Die
  Tool-Beschreibungen weisen das Modell an, eine Collection vor dem Schreiben zu beschreiben. Die
  Auflistung eines Projekts mit 200 Collections umfasst etwa 5k Tokens, und jede Beschreibung
  unter 1k; wären alle Schemas direkt in der Auflistung enthalten, wären es etwa 150k.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt. Das Verbinden eines Assistenten
  gewährt ihm also keine vollwertige Sitzung.

Jede Anfrage an `/mcp` liest das Konto der Person erneut aus. Ein gelöschtes oder deaktiviertes
Konto sowie ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des Tokens
blockiert einen verbundenen Client sofort mit einem 401-Fehler. Ein Entzug von Rechten greift beim
nächsten Tool-Aufruf. Jeder Refresh führt dieselben Prüfungen durch und lehnt eine solche Autorisierung
dauerhaft ab. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, ein bereits ausgestelltes
Access-Token bleibt jedoch bis zu seinem Ablauf (innerhalb einer Stunde) gültig.

Die Routen finden Sie unter [Endpunkte](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Konfiguration](/docs/getting-started/configuration/#mcp-surface).
