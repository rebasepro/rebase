---
sourceHash: 219c4aa5108f13df
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP von einem bereitgestellten Backend unter /mcp bereit, sodass die Personen, die Ihre App nutzen, Claude oder Cursor als sie selbst verbinden können – OAuth mit einem Zustimmungsbildschirm, neun Tools unter drei Scopes, jeder Aufruf unter ihrer eigenen Row-Level-Security.
---

:::tip[Verbinden Sie Claude mit Ihren eigenen Projekten?]
Das ist der [Rebase connector](/docs/ai/rebase-connector/): ein Connector für
alle, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect`
damit. Diese Seite ist für die Personen gedacht, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwickler-Tool: Er läuft auf Ihrem Rechner und enthält
einen Service-Key oder einen API-Key. Ein bereitgestelltes Backend kann MCP auch selbst unter
`/mcp` bereitstellen, für die Personen, die Ihre Anwendung nutzen. Ein Assistent, den eine dieser
Personen verbindet, liest und schreibt das Projekt **als diese Person**, und jeder Aufruf wird
unter deren eigener Row-Level-Security ausgeführt.

Er ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage auf einen
Benutzer eingrenzen kann, weigert sich der Endpunkt zu mounten und gibt den Grund im Boot-Log an.
Kein `REBASE_ROLE` aktiviert ihn.

- **OAuth mit einem Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie
  auf Clients, die Sie registrieren) und leitet die Person zu einem Zustimmungsbildschirm (Consent Screen)
  weiter, der sie über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird dann über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authentifikator-Code oder
  einem Wiederherstellungscode gefragt. Wenn das eigene Frontend Ihrer App eine Sitzung im selben
  Browser hält, bietet der Bildschirm dieses Konto an, und „Zulassen“ stimmt als dieses Konto ohne
  Passwort zu; auf diese Weise verbindet sich jemand, der sich nur mit Google, GitHub oder einem
  E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem Passwort, und jemand ohne Passwort
  legt zuerst eines über `/auth/forgot-password` fest (das „Passwort vergessen“ Ihrer App); der
  Bildschirm weist darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet wird,
  und gibt an, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter beliebigem Namen
  registrieren, daher ist der Host der Teil, den eine Person überprüfen kann.
- **Elf Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die alle Anmeldedaten verwenden. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` und die drei Ansichten
  `show_collection`, `show_record` und `show_app`; `data:write` fügt `create_document` und
  `update_document` hinzu; `data:delete` fügt `delete_document` hinzu. Ein Client, der nichts
  anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Collection eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und nichts anderes. Ein Scope bestimmt, welche Tools
  angeboten werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann
  bedeuten, dass RLS greift, und `data:write` kann weiterhin keine Zeile schreiben, die die Person
  nicht schreiben könnte.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client, der
  MCP Apps rendert, wie beispielsweise Claude, öffnen sie die Ansichten des Admin-Panels direkt in der
  Konversation, basierend auf Ihren Collections: deren Felder, Enums, Validierungen,
  Relationen, Formularabschnitte und Ansichtseinstellungen.
  - `show_collection` akzeptiert die Argumente von `query_collection` plus `view`
    (`table`, `list`, `cards` oder `kanban`) und öffnet die Collection-Ansicht: Die
    Person kann suchen, filtern, sortieren und paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer einzelnen Zeile (`id`) oder ein Formular für eine neue Zeile,
    das mit den vom Modell ausgefüllten `values` vorbefüllt ist, damit die Person diese selbst
    überprüfen und speichern kann.
  - `show_app` öffnet einen kompakten Bildschirm mit bis zu acht `blocks`: Collection-Ansichten,
    Datensatzformulare und Metriken, die die Zeilen zählen, die einem `where` entsprechen. Ein Block
    kann der in einem früheren Collection-Block ausgewählten Zeile folgen: ein Formular, das sie
    öffnet (`"follows": {"block": "orders"}`), oder eine zweite Collection, die die Zeilen anzeigt,
    die darauf verweisen (`"follows": {"block": "orders", "on": "orderId"}`).

  Jeder Block wird so geprüft, wie es die Lese- und Schreib-Tools prüfen würden, bevor der
  Bildschirm geöffnet wird. Jeder Lese- und Speichervorgang in der Ansicht ist ein Aufruf dieser Tools,
  ausgeführt als die Person unter deren RLS, sodass das Formular nur das anbietet, was ihrer
  Verbindung gewährt wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld, das ihre Rollen
  nicht lesen können, ist darin nicht enthalten. Dem Modell wird mitgeteilt, was geändert wurde. Es
  liest die von jedem Tool zurückgegebenen Zeilen, nicht die Collection-Konfigurationen, mit denen die
  Ansicht gerendert wird. Ein Client ohne MCP Apps, wie Claude Code oder Cursor, zeigt nichts an,
  und das Modell liest dieselben Zeilen, die es von `query_collection` erhalten würde.
- **Vor 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird bei
  gespeicherten Grants und bereits ausgestellten Token als `data:read` interpretiert und `mcp:write`
  als `data:write data:delete`.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  einen Client, der mit einem Header statt über einen OAuth-Flow konfiguriert ist. Der Key erreicht
  die Tools, die seine `data:*`-Scopes abdecken, als derjenige, für den er agiert: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren das, was das SDK akzeptiert –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` und `data` für Schreibvorgänge –
  und lesen über den Pfad von `GET /api/data/<collection>`, sodass eine Zeile so zurückgegeben
  wird, wie REST sie ausliefert (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`), und in einem Update unverändert zurückgesendet werden kann. `query_collection`
  antwortet mit `{ data, meta }` mit `meta.total` und `meta.hasMore`, und `count_documents` mit
  `{ count }`. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer im Papierkorb liegenden Zeile (404) abgelehnt; das Setzen des Soft-Delete-Felds
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection` und `count_documents` liest den Papierkorb aus, genau wie `?deleted=` bei REST,
  sodass eine durch `delete_document` gelöschte Zeile wiedergefunden und wiederhergestellt werden kann.
  Die Beschreibung des Tools informiert das Modell darüber, dass der Löschvorgang nur dann dauerhaft ist,
  wenn die Collection über kein Soft-Delete-Feld verfügt.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das Schema einer Collection.**
  `list_collections` gibt `name`, `title` und `description` jeder Collection zurück und
  `describe_collection { collection }` die OpenAPI-`row`- und `create`-Schemas dieser Collection,
  plus `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden. Die Tool-Beschreibungen
  weisen das Modell an, eine Collection vor dem Schreiben zu beschreiben. Bei einem Projekt mit
  200 Collections umfasst die Auflistung etwa 5k Tokens und jede Beschreibung unter 1k Tokens;
  mit allen Schemas in der Auflistung waren es etwa 150k.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass das Verbinden eines Assistenten ihm
  keine Sitzung überlässt.

Jede Anfrage an `/mcp` liest das Konto der Person erneut ein. Ein gelöschtes oder deaktiviertes
Konto, ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des Tokens stoppt
einen verbundenen Client sofort mit einem 401. Eine Herabstufung greift beim nächsten Tool-Aufruf.
Jeder Refresh führt dieselben Prüfungen durch und verweigert einen solchen Grant dauerhaft.
Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId`, mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, aber ein bereits ausgestelltes
Access-Token funktioniert weiter, bis es abläuft – innerhalb einer Stunde.

Die Routen finden Sie unter [Endpoints](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Configuration](/docs/getting-started/configuration/#mcp-surface).
