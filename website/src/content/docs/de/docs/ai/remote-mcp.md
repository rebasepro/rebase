---
sourceHash: 929d8e7ae10aab87
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP über ein deploytes Backend unter /mcp bereit, damit die Personen, die Ihre App nutzen, Claude oder Cursor in ihrem eigenen Namen verbinden können – OAuth mit Zustimmungsbildschirm, neun Tools unter drei Scopes, jeder Aufruf unter deren eigener Row-Level Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase-Connector](/docs/ai/rebase-connector/): ein Connector für
alle Projekte, und ein selbst gehosteter Server schließt sich mit `rebase cloud connect` an. Diese
Seite ist für die Personen gedacht, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwicklertool: Er läuft auf Ihrem Rechner und hält einen Service-Key
oder einen API-Key. Ein deploytes Backend kann MCP auch selbst unter `/mcp` für
die Personen bereitstellen, die Ihre Anwendung nutzen. Ein Assistent, den einer von ihnen verbindet, liest und
schreibt das Projekt **als diese Person**, und jeder Aufruf wird unter deren eigener
Row-Level Security ausgeführt.

Der Endpunkt ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Daten-Treiber, der eine Abfrage
auf einen einzelnen Benutzer beschränken kann, wird der Endpunkt nicht geladen und gibt den Grund im Boot-Log an. Keine
`REBASE_ROLE` schaltet ihn ein.

- **OAuth mit Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt dies
  auf Clients, die Sie registrieren) und leitet die Person zu einem Zustimmungsbildschirm weiter, der sie
  über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird anschließend über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code
  oder einem Wiederherstellungscode gefragt. Wenn das Frontend Ihrer eigenen App
  eine Sitzung im selben Browser aufrechterhält, bietet der Bildschirm dieses Konto an, und
  „Zulassen“ erteilt die Zustimmung als dieses Konto ohne Passwort; so verbindet sich jemand, der sich nur
  mit Google, GitHub oder einem E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem
  Passwort, und wer keines hat, legt zuerst über `/auth/forgot-password`
  (das „Passwort vergessen“ Ihrer App) eines fest; der Bildschirm weist darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet
  wird, und weist darauf hin, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter
  beliebigem Namen registrieren, sodass der Host der Teil ist, den eine Person überprüfen kann.
- **Neun Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die alle Anmeldedaten verwenden. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `show_collection`, `count_documents` und `get_document`; `data:write` ergänzt `create_document` und
  `update_document`; `data:delete` ergänzt `delete_document`. Ein Client, der nichts
  anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Collection einschränken: `data:read:posts`
  listet, beschreibt und liest `posts` und sonst nichts. Ein Scope bestimmt, welche Tools
  angeboten werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann bedeuten,
  dass RLS greift, und `data:write` kann weiterhin keine Zeile schreiben, auf die die Person keinen Zugriff hat.
- **`show_collection` stellt der Person die Zeilen direkt dar.** Es übernimmt
  die Argumente von `query_collection` und liefert dieselbe Seite zurück, zuzüglich der Spalten, die das
  Admin-Panel anzeigt. Ein Client, der MCP Apps rendert, wie etwa Claude, öffnet dies als
  Tabelle in der Konversation: Die Person kann weitere Zeilen laden und – sofern die
  Verbindung über `data:write` verfügt – eine Zelle direkt an Ort und Stelle bearbeiten. Jeder Speichervorgang ist ein
  `update_document`-Aufruf in ihrem Namen unter deren RLS, und dem Modell wird mitgeteilt, was
  geändert wurde. Ein Client ohne MCP Apps, wie Claude Code oder Cursor, zeigt keine
  Tabelle an, und das Modell liest die Seite so, wie es sie von `query_collection` lesen würde.
- **Vor 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird bei
  gespeicherten Berechtigungen und bereits ausgestellten Tokens als `data:read` interpretiert,
  und `mcp:write` als `data:write data:delete`.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  einen Client, der mit einem Header anstelle eines OAuth-Flows konfiguriert ist. Der Key erreicht
  die Tools, die seine `data:*`-Scopes abdecken, und agiert als die entsprechende Identität: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` sowie `data` für
  Schreiboperationen – und lesen über den Pfad `GET /api/data/<collection>`, sodass eine Zeile
  so zurückgegeben wird, wie REST sie ausliefert (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`) und in einem Update unverändert zurückgesendet werden kann. `query_collection`
  antwortet mit `{ data, meta }` mit `meta.total` und `meta.hasMore`, und `count_documents`
  mit `{ count }`. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument und ein
  Bearbeiten oder Löschen einer in den Papierkorb verschobenen Zeile (404) abgelehnt; das Setzen des Soft-Delete-Feldes
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection` und `count_documents` liest den Papierkorb aus, genau wie `?deleted=`
  bei REST, sodass eine durch `delete_document` gelöschte Zeile wiedergefunden und wiederhergestellt werden kann.
  Seine Beschreibung teilt dem Modell mit, dass das Löschen nur dann dauerhaft ist, wenn
  die Collection kein Soft-Delete-Feld hat.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das Schema einer Collection.**
  `list_collections` antwortet mit `name`, `title` und `description` jeder Collection,
  und `describe_collection { collection }` mit den OpenAPI-Schemas `row` und
  `create` dieser Collection sowie `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden. Die Tool-Beschreibungen
  weisen das Modell an, eine Collection zu beschreiben, bevor darin geschrieben wird. Die
  Auflistung eines Projekts mit 200 Collections umfasst etwa 5k Tokens, und jede Beschreibung
  unter 1k; wären alle Schemas in der Auflistung enthalten, wären es etwa 150k gewesen.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass das Verbinden eines Assistenten
  diesem keine Sitzung übergibt.

Jede Anfrage an `/mcp` liest das Konto der Person neu ein. Ein gelöschtes oder deaktiviertes
Konto oder ein „Überall abmelden“ bzw. eine Passwortänderung nach Ausstellung des Tokens
stoppt einen verbundenen Client sofort mit einem 401-Fehler. Eine Herabstufung greift bei dessen
nächstem Tool-Aufruf. Jeder Refresh führt dieselben Prüfungen durch und verweigert eine
solche Berechtigung dauerhaft. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, ein bereits
ausgestelltes Access-Token bleibt jedoch bis zu seinem Ablauf innerhalb der nächsten Stunde gültig.

Die Routen finden Sie unter [Endpunkte](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Konfiguration](/docs/getting-started/configuration/#mcp-surface).
