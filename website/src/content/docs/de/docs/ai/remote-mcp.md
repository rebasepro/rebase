---
sourceHash: 3c5e837860d6c8c6
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP von einem bereitgestellten Backend unter /mcp bereit, damit die Benutzer Ihrer App Claude oder Cursor als sich selbst verbinden können – OAuth mit Zustimmungsbildschirm, acht Tools unter drei Scopes, jeder Aufruf unter ihrer eigenen Row-Level Security.
---

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwickler-Tool: Er läuft auf Ihrem Rechner und
hält einen Service-Key oder einen API-Key. Ein bereitgestelltes Backend kann MCP auch
selbst unter `/mcp` bereitstellen, für die Benutzer Ihrer Anwendung. Ein Assistent, den
einer von ihnen verbindet, liest und schreibt das Projekt **als diese Person**, und
jeder Aufruf läuft unter deren eigener Row-Level Security.

Der Endpunkt ist ausgeschaltet, solange Sie ihn nicht einschalten, und beide Variablen
sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Fehlt `REBASE_PUBLIC_URL`, ein JWT-Secret oder ein Daten-Treiber, der eine Abfrage auf
einen einzelnen Benutzer eingrenzen kann, wird der Endpunkt nicht eingebunden und nennt
den Grund im Boot-Log. Keine `REBASE_ROLE` schaltet ihn ein.

- **OAuth, mit Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver über
  `/.well-known/oauth-protected-resource`, registriert sich selbst (die dynamische
  Registrierung ist standardmäßig aktiv; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt
  sie auf Clients, die Sie registrieren) und schickt die Person zu einem
  Zustimmungsbildschirm, der sie über Ihr bestehendes `/auth/login` anmeldet. Ein Konto
  mit einem zweiten Faktor wird anschließend über die bestehenden
  `/auth/mfa/challenge`-Routen nach dem Code seiner Authenticator-App oder nach einem
  Wiederherstellungscode gefragt. Der Bildschirm meldet nur mit einem Passwort an: Wer
  bisher ausschließlich Google, GitHub oder einen E-Mail-Link verwendet hat, legt
  zuerst eines über `/auth/forgot-password` fest („Passwort vergessen“ in Ihrer App),
  und der Bildschirm sagt ihm das. Er nennt außerdem den Host, an den der
  Autorisierungscode gesendet wird, und weist darauf hin, dass dieser Host nicht
  verifiziert ist: Jeder darf einen Client unter einem beliebigen Namen registrieren,
  daher ist der Host der Teil, den eine Person überprüfen kann.
- **Acht Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/), die
  jedes Zugangsdatum verwendet. `data:read` bietet `list_collections`,
  `describe_collection`, `query_collection`, `count_documents` und `get_document`;
  `data:write` fügt `create_document` und `update_document` hinzu; `data:delete` fügt
  `delete_document` hinzu. Ein Client, der nichts anfordert, erhält `data:read`. Jeder
  davon lässt sich auf eine Collection eingrenzen: `data:read:posts` listet, beschreibt
  und liest `posts` und sonst nichts. Ein Scope entscheidet, welche Tools angeboten
  werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann
  bedeuten, dass RLS funktioniert, und `data:write` kann dennoch keine Zeile schreiben,
  die die Person nicht schreiben könnte.
- **Vor 0.24 erteilte Berechtigungen behalten ihre Reichweite.** `mcp:read` wird als
  `data:read` gelesen und `mcp:write` als `data:write data:delete`, bei gespeicherten
  Berechtigungen ebenso wie bei bereits ausgestellten Tokens.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch
  `Authorization: Bearer rk_…`, für einen Client, der mit einem Header statt mit einem
  OAuth-Ablauf konfiguriert ist. Der Key erreicht die Tools, die seine `data:*`-Scopes
  abdecken, als diejenige Identität, als die er handelt: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein
  Service-Key als `api-key:<id>`.
- **Das Vokabular des SDK, die Antworten von REST.** Die Tools nehmen entgegen, was das
  SDK entgegennimmt – `where` (`{"status": ["==", "paid"]}`), `orderBy`
  (`["created_at", "desc"]` oder `"created_at:desc"`), `limit`, `offset`, `searchString`
  und `data` für einen Schreibvorgang – und lesen über den Pfad von
  `GET /api/data/<collection>`, sodass eine Zeile so zurückkommt, wie REST sie liefert
  (ISO-Datumsangaben, eine `belongsTo`-Relation als ihr Fremdschlüssel, z. B.
  `authorId`), und unverändert in einem Update zurückgesendet werden kann.
  `query_collection` antwortet mit `{ data, meta }` samt `meta.total` und
  `meta.hasMore`, `count_documents` mit `{ count }`. Wie bei REST werden ein `limit`
  über 1000, ein nicht deklariertes Argument und das Bearbeiten oder Löschen einer
  Zeile im Papierkorb (404) abgelehnt; wer das Soft-Delete-Feld auf `null` setzt,
  stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei `query_collection`
  und `count_documents` liest den Papierkorb, so wie `?deleted=` bei REST, sodass eine
  von `delete_document` in den Papierkorb verschobene Zeile wiedergefunden und
  wiederhergestellt werden kann. Die Beschreibung von `delete_document` sagt dem Modell nur dort, dass das
  Löschen endgültig ist, wo die Collection kein Soft-Delete-Feld hat.
- **Die Liste nennt die Collections; `describe_collection` liefert das Schema einer
  einzelnen.** `list_collections` antwortet pro Collection mit `name`, `title` und
  `description`, und `describe_collection { collection }` mit den OpenAPI-Schemas `row`
  und `create` dieser Collection, dazu `softDeleteField`, wo Zeilen in einen Papierkorb
  wandern. Die Tool-Beschreibungen weisen das Modell an, eine Collection zu beschreiben,
  bevor es in sie schreibt. Die Liste eines Projekts mit 200 Collections umfasst etwa
  5k Tokens, jede Beschreibung unter 1k; mit allen Schemas in der Liste waren es etwa
  150k.
- **Ein Token nur für diesen Endpunkt.** Ein MCP-Access-Token wird von `/api/data`,
  `/api/admin` und dem WebSocket abgelehnt, sodass das Verbinden eines Assistenten ihm
  keine Sitzung aushändigt.

Jede Anfrage an `/mcp` liest das Konto der Person neu ein. Ein gelöschtes oder
deaktiviertes Konto, oder ein „überall abmelden“ oder eine Passwortänderung nach der
Ausstellung des Tokens, stoppt einen verbundenen Client sofort mit einem 401. Eine
Herabstufung gilt für den nächsten Tool-Aufruf. Jede Erneuerung führt dieselben
Prüfungen durch und lehnt eine solche Berechtigung endgültig ab. Eine Gast-Sitzung kann
überhaupt nicht zustimmen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId`, mit
der eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, aber ein bereits
ausgestelltes Access-Token funktioniert weiter, bis es abläuft, innerhalb einer Stunde.

Die Routen stehen im [Endpunkt-Index](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Umgebung & Konfiguration](/docs/getting-started/configuration/#mcp-surface).
