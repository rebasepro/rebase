---
sourceHash: b813cdc1b302b6c6
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP über ein deploytes Backend unter /mcp bereit, sodass Personen, die Ihre App nutzen, Claude oder Cursor als sie selbst verbinden können – OAuth mit Zustimmungsbildschirm, neun Tools unter drei Scopes, jeder Aufruf unter deren eigener Row-Level-Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase-Connector](/docs/ai/rebase-connector/): ein Connector für
alle Projekte, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect` damit. Diese
Seite ist für die Personen gedacht, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwickler-Tool: Er läuft auf Ihrem Rechner und hält einen Service-Key
oder einen API-Key. Ein deploytes Backend kann MCP auch selbst bereitstellen, unter `/mcp`, für
die Personen, die Ihre Anwendung nutzen. Ein Assistent, den jemand von ihnen verbindet, liest und
schreibt das Projekt **als diese Person**, und jeder Aufruf läuft unter deren eigener
Row-Level-Security.

Die Funktion ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Daten-Treiber, der eine Abfrage
auf einen einzelnen Benutzer beschränken kann, weigert sich der Endpunkt zu mounten und nennt den Grund
im Boot-Log. Kein `REBASE_ROLE` schaltet ihn ein.

- **OAuth, mit einem Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie
  auf Clients, die Sie registrieren) und leitet die Person zu einem Zustimmungsbildschirm weiter, der sie
  über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird anschließend über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code
  oder einem Wiederherstellungscode gefragt. Wenn das eigene Frontend Ihrer App
  eine Sitzung im selben Browser hält, bietet der Bildschirm dieses Konto an, und
  „Zulassen“ stimmt als dieses Konto ohne Passwort zu; so verbindet sich jemand, der sich ausschließlich
  über Google, GitHub oder einen E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem
  Passwort, und jemand ohne Passwort legt zuerst über `/auth/forgot-password`
  eines fest (das „Passwort vergessen“ Ihrer App); der Bildschirm weist darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet
  wird, und weist darauf hin, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter
  beliebigem Namen registrieren, daher ist der Host der Teil, den eine Person überprüfen kann.
- **Elf Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die jede Anmeldeinformation verwendet. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` und die drei Ansichten,
  `show_collection`, `show_record` und `show_app`; `data:write` ergänzt `create_document` und
  `update_document`; `data:delete` ergänzt `delete_document`. Ein Client, der
  nichts anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Collection eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und nichts anderes. Ein Scope entscheidet darüber, welche Tools
  angeboten werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann bedeuten, dass
  RLS greift, und `data:write` kann weiterhin keine Zeile schreiben, die die Person selbst nicht schreiben könnte.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client, der
  MCP Apps rendert, wie etwa Claude, öffnen sie die panel-eigenen Ansichten des Admin-Panels in der
  Konversation, abgeleitet aus Ihren Collections: deren Felder, Enums, Validierungen,
  Relationen, Formularabschnitte und Ansichtseinstellungen.
  - `show_collection` übernimmt die Argumente von `query_collection` plus `view`
    (`table`, `list`, `cards` oder `kanban`) und öffnet die Collection-Ansicht: Die
    Person kann suchen, filtern, sortieren und paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer einzelnen Zeile (`id`) oder ein Formular für eine neue Zeile,
    das mit den vom Modell ausgefüllten `values` vorbefüllt ist, damit die Person dies selbst prüfen und
    speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine React-Komponente
    (`code`) und die `collections`, die sie liest. Sie importiert das UI-Kit
    (`@rebasepro/ui`), die KPI-Kacheln und Diagramme von `@rebasepro/plugin-insights`
    sowie `@rebasepro/mcp-apps`: `useQuery`, `useRecord`, `useCount` und
    `useMutate` über die Zeilen des Projekts sowie `CollectionView` und
    `RecordForm` des Admin-Panels zur Komposition. Der Server kompiliert sie
    zuerst, sodass ein Syntaxfehler oder ein Import, den die Ansicht nicht hat, als Fehler des
    Aufrufs samt Zeilennummer gemeldet wird; ein Fehler während der Ausführung wird an Ort und Stelle angezeigt
    und dem Modell mit der nächsten Nachricht der Person mitgeteilt.

  Jeder Lese- und Speichervorgang in der Ansicht ist ein Aufruf der Lese- und Schreib-Tools,
  der als die Person unter deren RLS ausgeführt wird. Ein Formular bietet daher nur das, was der
  Verbindung gewährt wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das ihre Rollen nicht lesen dürfen, ist darin nicht enthalten. Eine Änderung, die der Code einer App vornimmt, wird
  der Person zur Bestätigung vorgelegt, bevor sie gesendet wird. Dem Modell wird mitgeteilt, was
  geändert wurde. Es liest die Zeilen, die jedes Tool zurückgibt, nicht die Collection-Konfigurationen, mit denen
  die Ansicht gerendert wird. Ein Client ohne MCP Apps, wie etwa Claude Code oder Cursor, zeigt nichts an,
  und das Modell liest dieselben Zeilen, die es auch über `query_collection` erhalten würde.
- **Vor 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird als
  `data:read` interpretiert und `mcp:write` als `data:write data:delete`, sowohl bei gespeicherten Berechtigungen
  als auch bei bereits ausgestellten Tokens.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  einen Client, der über einen Header statt über einen OAuth-Flow konfiguriert ist. Der Schlüssel erreicht
  die Tools, die durch seine `data:*`-Scopes abgedeckt sind, und agiert als die jeweilige Entität: ein
  [persönlicher Schlüssel](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` sowie `data` für Schreibvorgänge –
  und lesen über den Pfad `GET /api/data/<collection>`, sodass eine Zeile so
  zurückgegeben wird, wie REST sie ausliefert (ISO-Daten, ein `belongsTo` als dessen Fremdschlüssel, z. B.
  `authorId`), und in einem Update unverändert zurückgesendet werden kann. `query_collection`
  antwortet mit `{ data, meta }` einschließlich `meta.total` und `meta.hasMore`, und `count_documents` mit
  `{ count }`. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer Zeile im Papierkorb (404) verweigert; das Setzen des Soft-Delete-Feldes
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection` und `count_documents` liest den Papierkorb aus, genau wie `?deleted=` bei REST,
  sodass eine von `delete_document` in den Papierkorb verschobene Zeile wiedergefunden und wiederhergestellt werden kann.
  Die Beschreibung des Tools teilt dem Modell mit, dass das Löschen nur dort permanent ist,
  wo die Collection kein Soft-Delete-Feld besitzt.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das Schema.**
  `list_collections` gibt `name`, `title` und `description` jeder Collection zurück,
  und `describe_collection { collection }` die OpenAPI-`row`- und
  `-create`-Schemas dieser Collection sowie `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden. Die Tool-Beschreibungen
  weisen das Modell an, eine Collection zu beschreiben, bevor darin geschrieben wird. Die Auflistung
  eines Projekts mit 200 Collections umfasst etwa 5.000 Tokens, und jede Beschreibung liegt
  unter 1.000 Tokens; mit jedem Schema in der Auflistung waren es zuvor rund 150.000 Tokens.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass das Verbinden eines Assistenten
  diesem keine Sitzung übergibt.

Jede Anfrage an `/mcp` liest das Konto der Person erneut ein. Ein gelöschtes oder deaktiviertes
Konto, ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des
Tokens stoppt einen verbundenen Client sofort mit einem 401. Eine Herabstufung von Rechten greift beim
nächsten Tool-Aufruf. Jeder Refresh führt dieselben Prüfungen durch und verweigert eine solche Berechtigung
dauerhaft. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, ein bereits
ausgestelltes Access-Token funktioniert jedoch weiter, bis es abläuft (innerhalb einer Stunde).

Die Routen finden Sie unter [Endpunkte](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Konfiguration](/docs/getting-started/configuration/#mcp-surface).
