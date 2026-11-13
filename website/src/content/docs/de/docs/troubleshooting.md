---
sourceHash: ff162864c3d1600b
slug: de/docs/troubleshooting
title: Fehlerbehebung
description: Fehler, die das Starten oder Ausliefern eines Rebase-Backends verhindern – eine nicht erreichbare Datenbank, falsche Anmeldedaten, eine fehlende Erweiterung, RLS-Verweigerung, Schema-Drift, ein belegter Port, eine nicht ladbare Funktion – und wie die einzelnen Fehler aussehen.
---

Fehler, die das Starten oder Ausliefern eines Rebase-Backends verhindern, wie diese jeweils auf dem Bildschirm aussehen und was dagegen zu tun ist.

Der Boot-Vorgang schlägt laut und vollständig fehl. Wenn die Datenbank nicht erreichbar ist, die Zugangsdaten falsch sind oder das Schema nicht kompiliert oder angewendet werden kann, wirft `initializeRebaseBackend` einen Fehler, es wird nichts ausgeliefert und der Prozess wird mit `1` beendet. Es gibt keinen herabgesetzten Modus (Degraded Mode): Ein Server, der hochfährt und Anmeldungen beantwortet, während jede `/api/data/*`-Route fehlschlägt, ist schwerer zu diagnostizieren als einer, der gar nicht erst startet.

Der erste Anlaufpunkt ist daher immer der letzte Eintrag im Log vor dem Exit.

## Einen Boot-Fehler lesen

Jeder Datenbankfehler, den Sie sehen, ist ein Wrapper. Drizzle wirft Abfragefehler erneut als `Failed query: …` mit einem Stacktrace durch die eigenen Interna, und der Satz, der das eigentliche Problem beschreibt, liegt darunter in `.cause` – oder innerhalb eines `AggregateError`, wenn ein Dual-Stack-Host mehrere Adressen ausprobiert hat.

Die Runtime packt dies für Sie aus. Ein Boot-Fehler protokolliert:

- eine **eingerahmte Diagnose**, die den Host, den Port und die Behebung benennt, und
- `caused by:`-Zeilen, die die Fehlerkette enthalten und mit dem Grund enden, den das Betriebssystem oder Postgres geliefert hat.

Wenn Sie JSON-Logs lesen (`NODE_ENV=production`), befindet sich dieselbe Kette unter `error.cause`, jeweils mit `code`, `address` und `port` auf jedem Kettenglied.

### `Failed query: [redacted]`

Dies ist keine abgeschnittene Logzeile. Drizzle baut jeden Abfragefehler als `Failed query: <sql>`, gefolgt von den gebundenen Werten, auf. Dadurch werden das Statement und seine Parameter – etwa eine E-Mail-Adresse oder ein Passwort-Hash – in der Nachricht und dem Stacktrace von allem mitgeführt, was der Treiber erneut auslöst. Der Logger entfernt diesen Bereich aus jeder Zeile, die er schreibt, und gibt an dieser Stelle `[redacted]` aus.

Das Statement selbst liefert ohnehin selten die Antwort: Die Ursache findet sich in den darunterliegenden `caused by:`-Zeilen. Wenn Sie es doch einmal benötigen, setzen Sie in der Entwicklungsumgebung `REBASE_LOG_RAW_QUERIES=true`, und das SQL wird stattdessen ausgegeben. Außerhalb der Entwicklungsumgebung wird dies ignoriert, sodass eine Variable, die versehentlich in eine Produktionsumgebung gelangt, dort nichts de-anonymisieren kann.

## Die Datenbank läuft nicht

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Unter dieser Adresse lauscht nichts. Starten Sie die Datenbank:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

Oder führen Sie `rebase dev` ganz ohne `DATABASE_URL` aus; dadurch wird eine verwaltete PGlite-Datenbank für Sie gestartet, die keinerlei Installation erfordert.

Wenn Host und Port im Kasten nicht den Erwartungen entsprechen, ist die `DATABASE_URL` in `.env` nicht diejenige, die der Prozess eingelesen hat – prüfen Sie, ob eine zweite `.env`-Datei existiert, eine Shell-Variable bereits exportiert wurde oder ein Container gestartet wurde, bevor Sie die Datei bearbeitet haben.

## Das Passwort oder der Datenbankname ist falsch

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` steht für ein falsches Passwort, `28000` für eine Rolle, die sich von hier aus nicht verbinden darf, und `3D000` für eine nicht existierende Datenbank. Alle drei sind eindeutige Fakten über den Verbindungs-String: Ein erneuter Versuch führt zum selben Ergebnis, weshalb der Boot-Vorgang sofort fehlschlägt, anstatt einen Pool zu melden, der sich „womöglich erholt“.

Überprüfen Sie die Zugangsdaten in `DATABASE_URL`. Ein Passwort, das `@`, `/`, `?` oder `#` enthält, muss prozentkodiert (URL-encoded) werden – ein nicht kodiertes Zeichen verändert stillschweigend die Struktur der URL, und der Host, zu dem schließlich verbunden wird, entspricht nicht dem eingegebenen.

## `SchemaDefinitionError` — das Schema kompiliert nicht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Boot, `rebase db generate`, `db push`, `generate-sdk` und `doctor` kompilieren vor allem anderen die Tabellen, die `backend/schema/index.ts` exportiert, und stoppen, sobald eine Tabelle nicht kompiliert – kein `rls`, `"inherit"` ohne `defaultRls`, eine Relation zu einer Tabelle, die der Index nicht exportiert, ein `defineTable` in einer Geschwisterdatei, die der Index auslässt –, wobei jede Tabelle, jeder Schlüssel und jedes Problem auf einmal benannt werden. Beheben Sie jedes einzelne Problem; `rebase verify` gibt dieselbe Liste aus, ohne irgendetwas zu starten.

## `config/collections` wird verweigert

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Projekt von vor Version 0.31 verwahrt sein Datenmodell in `config/collections`, was von nichts mehr gelesen wird: Die Runtime, jeder CLI-Befehl und ein Format-2-Bundle werden mit dem Hinweis auf `rebase migrate collections-to-tables` in der Meldung abgewiesen. Führen Sie dies auf einem sauberen Git-Tree aus; der Befehl schreibt das Projekt als `backend/schema` und `frontend/src/cms` um, verifiziert, dass das generierte SQL unverändert bleibt, und gibt die noch verbleibenden Schritte aus. Siehe [Upgrade von 0.30 auf 0.31](https://rebase.pro/docs/upgrading/0-30-to-0-31/).

## `type "vector" does not exist`

pgvector ist eine Server-Erweiterung, daher installiert Rebase sie nur dort, wo ein Projekt dies ausdrücklich erlaubt. Deklarieren Sie sie in `backend/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

Die Datenbank benötigt zudem ein Image, das die Bibliothek bereitstellt. Das vorgefertigte `pgvector/pgvector:pg18` des Scaffolds enthält sie; ein Standard-`postgres:18` nicht. Wenn die Installation selbst verweigert wird (`extension "vector" is not available` oder ein Berechtigungsfehler), ist die Konfiguration bereits korrekt und es fehlt lediglich die Bibliothek auf dem Server oder eine Rolle, die berechtigt ist, `CREATE EXTENSION vector;` auszuführen.

## Die Datenbank hat das Statement verweigert

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Darunter fallen zwei verschiedene Probleme, die durch die Meldung unterschieden werden:

- **Eine Row-Level-Security-Policy hat die Zeile verweigert** – die obige Meldung. Das Zugriffskontrollsystem funktioniert; der Aufrufer hat etwas angefordert, was seine Richtlinien nicht zulassen. Prüfen Sie das `rls` der Tabelle in `backend/schema` und führen Sie `npx @rebasepro/rls-check` für ein schreibgeschütztes Audit dessen aus, was die Datenbank tatsächlich erzwingt.
- **Der Rolle fehlt ein `GRANT`.** Die Meldung benennt stattdessen das Objekt:

  ```
  DB_PERMISSION_DENIED — Permission denied by the database: the role this request
  runs as has no privilege on schema "rebase". That is a missing GRANT to that
  role, not a row-level security policy.
  ```

  Nichts an der Anfrage wird helfen – die Rolle, unter der Anfragen ausgeführt werden, darf auf dieses Objekt überhaupt nicht zugreifen. Der Server vergibt beim Booten Berechtigungen für seine Anfrage-Rolle auf den Schemas, die er bereitstellt; ein außerhalb davon erstelltes Objekt (durch eine andere Rolle oder in einem Schema, das keine Tabelle deklariert) benötigt einen eigenen `GRANT`. Dies ist ein Deployment-Problem.

Ein Lesevorgang, den RLS ausschließt, ist kein Fehler: Die Zeilen werden gefiltert und Sie erhalten eine leere Seite. Wenn eine Tabelle für einen angemeldeten Benutzer als leer ausgegeben wird, obwohl dieser Zeilen sehen sollte, ist die Policy der Ansatzpunkt, nicht die Abfrage.

## `SCHEMA_DRIFT` — eine Tabelle oder Spalte existiert nicht

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

Code und Datenbank stimmen nicht überein. In der Entwicklungsumgebung:

```bash
rebase db push        # apply the tables to the database
rebase doctor         # the full three-way drift report
```

Auf einem gemanagten Cloud-Tenant kann `db push` die Datenbank nicht erreichen – die Runtime wendet das Schema stattdessen beim Booten an; führen Sie daher ein Redeploy durch, anstatt zu pushen.

Wenn eine Tabelle existiert, eine Spalte jedoch nicht, ist die Ursache meist eine Tabellendatei, die bearbeitet wurde, ohne sie neu zu generieren: Führen Sie `rebase schema generate` aus und pushen Sie erneut.

## `Error: EOF` von `db push` auf der verwalteten Datenbank

```
Error: EOF
✗ atlas schema apply --to file://.rebase/sql/schema.sql --dry-run failed.
```

Die verwaltete Entwicklungsdatenbank akzeptiert nur wenige Verbindungen gleichzeitig, und ein laufendes `rebase dev` belegt einige davon. Atlas, das den Push plant, öffnet zwei weitere, wovon eine unterbrochen wurde. Es wurde nichts angewendet, daher kann der Befehl bedenkenlos erneut ausgeführt werden; der Dev-Server schließt ungenutzte Verbindungen nach 30 Sekunden. Wenn der Fehler weiterhin auftritt, stoppen Sie `rebase dev` während des Pushs.

Der Push schließt seine eigenen Verbindungen, bevor Atlas startet, was Atlas im Normalfall genügend Spielraum lässt, und der Fehler beschreibt, was geschehen ist.

## Der Port wird bereits verwendet

```
Port 3001 is in use — trying 3002.
```

Der Dev-Server bindet den nächsten freien Port und meldet dies. Diese Meldung ist wichtig, da alles andere – die `VITE_API_URL` Ihres Frontends, ein Lesezeichen, ein `curl` – immer noch auf den alten Port verweist. Die übliche Ursache ist ein vorheriges `rebase dev`, das den Socket noch belegt.

Übergeben Sie `--port`, um einen festen Port zu erzwingen, oder stoppen Sie den anderen Prozess. In der Produktion gibt es keinen Neuversuch: Der konfigurierte Port ist der Port, und `EADDRINUSE` ist ein fataler Fehler.

## Das Backend ist abgestürzt und `rebase dev` läuft weiter

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Backend, das beim Booten einen Fehler auslöst, stoppt den Watcher nicht – es gibt den Stacktrace aus und wartet auf eine Dateiänderung. Wenn sich das Backend nicht innerhalb von `REBASE_DEV_READY_TIMEOUT_MS` (standardmäßig 30 Sekunden) meldet, meldet `rebase dev` Folgendes:

```
  ✗ The backend has not started after 30s.
    Fix the error above; the watcher restarts it on the next change.
```

Der darüber liegende Fehler ist der eigentliche Grund. Die häufigsten Ursachen sind ein Syntaxfehler in einer Datei in `backend/schema`, ein Import, der nicht aufgelöst werden kann, oder eine `DATABASE_URL`, die ins Leere zeigt.

## Eine benutzerdefinierte Funktion wird nicht bereitgestellt

Funktionen werden beim Booten aus `backend/functions` geladen. Eine Datei, die nicht geladen werden kann, wird **übersprungen und ist nicht fatal** – der Server startet ohne sie. Das Symptom ist daher ein 404-Fehler bei einer Route, die Sie gerade geschrieben haben, und die Erklärung findet sich zwei Zeilen früher im Boot-Log:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Die üblichen Ursachen: Eine Abhängigkeit wurde importiert, ist aber nicht in der `package.json` enthalten; ein relativer Import ohne Dateiendung (`./util` statt `./util.js` – da es sich um ein ESM-Projekt handelt, ist die Endung erforderlich); oder eine Datei exportiert etwas anderes als eine Hono-App. Erstellen Sie Funktionen mit `defineFunction(...)` aus `@rebasepro/server/functions`, um Letzteres stattdessen als Kompilierfehler zu erhalten – über diesen Subpfad und nicht über das Paket-Root, damit die Funktion portabel bleibt.

Unterverzeichnisse werden nicht durchsucht. `functions/admin/users.ts` wird als übersprungener Eintrag gemeldet, anstatt bereitgestellt zu werden.

Sobald der Server läuft, antwortet eine Funktion, die zur Laufzeit einer Anfrage einen Fehler wirft, mit dem JSON-Error-Envelope und protokolliert den Grund; eine Funktion, die nie zurückkehrt, wird nach `REBASE_FUNCTIONS_TIMEOUT_MS` abgebrochen und antwortet mit `504 FUNCTION_TIMEOUT`.

## Ist das System erreichbar? `/livez` und `/health`

| Pfad | Greift auf die Datenbank zu | Antwort |
| --- | --- | --- |
| `/livez` | Nein | `200 {"status":"ok"}`, solange der Prozess läuft. Verwenden Sie diesen Endpunkt für eine Liveness-Probe. |
| `/health` | Ja, jede Datenquelle | `200 {"status":"ok"}`, wenn jede konfigurierte Datenquelle antwortet; `503 {"status":"degraded"}`, wenn eine nicht antwortet. Verwenden Sie diesen Endpunkt für eine Readiness-Probe. |

Legen Sie keine Liveness-Probe auf `/health`: Ein kurzer Datenbankaussetzer würde dazu führen, dass der Orchestrator einen ansonsten fehlerfreien Prozess beendet, wodurch ein kurzer Ausfall zu einer Neustartschleife (Restart Loop) wird.

`/health` erfordert keine Authentifizierung, daher gibt der Endpunkt außerhalb der Entwicklungsumgebung lediglich das Ergebnis aus und welche Datenquelle herabgesetzt ist, sonst nichts. Der eigentliche Fehlertext des Treibers – der Host, Port, Datenbankname und Rolle nennt – wird in die Logs geschrieben.

## Fehler nach dem Booten

Jeder API-Fehler liefert dasselbe Envelope und enthält einen `code`. Die [Fehlercode-Referenz](/docs/backend/errors/) listet alle Fehlercodes zusammen mit dem Status und der Behebung auf.

## Nächste Schritte

- [Fehlercodes](/docs/backend/errors/) – jeder `code`, den die API zurückgeben kann, mit Status und Behebung.
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – jede Variable, die die Runtime einliest, und diejenigen, ohne die der Start in der Produktion verweigert wird.
- [Backend-Übersicht](/docs/backend/) – was der Boot-Vorgang der Reihe nach tut und welcher Probe welche Frage beantwortet.
