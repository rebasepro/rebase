---
sourceHash: 1030bf24935489a6
slug: de/docs/troubleshooting
title: Fehlerbehebung
description: Die Fehler, die verhindern, dass ein Rebase-Backend startet oder Anfragen bedient – eine nicht erreichbare Datenbank, falsche Anmeldedaten, eine fehlende Extension, eine RLS-Verweigerung, Schema-Drift, ein belegter Port, eine Funktion, die nicht lädt – und wie jeder davon aussieht.
---

Die Fehler, die verhindern, dass ein Rebase-Backend startet oder Anfragen bedient, wie jeder davon auf dem Bildschirm aussieht und was dagegen zu tun ist.

Der Start (Boot) schlägt laut und vollständig fehl. Wenn die Datenbank nicht erreichbar ist, die Anmeldedaten falsch sind oder das Collection-Schema nicht angewendet werden kann, wirft `initializeRebaseBackend` einen Fehler, nichts wird ausgeliefert und der Prozess beendet sich mit Exit-Code `1`. Es gibt keinen degradierten Modus: Ein Server, der hochfährt und Sign-in-Anfragen beantwortet, während jede `/api/data/*`-Route fehlschlägt, ist schwerer zu diagnostizieren als einer, der gar nicht erst startet.

Der erste Ort, an dem man nachsehen sollte, ist daher immer der letzte Eintrag im Log vor dem Beenden.

## Einen Boot-Fehler lesen

Jeder Datenbankfehler, den Sie sehen, ist ein Wrapper. Drizzle wirft Abfragefehler als `Failed query: …` mit einem Stacktrace durch seine eigenen Interna erneut, und der Satz, der besagt, was nicht stimmt, liegt darunter in `.cause` – oder innerhalb eines `AggregateError`, wenn ein Dual-Stack-Host mehrere Adressen ausprobiert hat.

Die Runtime packt dies für Sie aus. Ein Boot-Fehler protokolliert:

- eine **eingerahmte Diagnose**, die den Host, den Port und die Lösung benennt, und
- `caused by:`-Zeilen, die die Kette fortführen und mit dem Grund enden, den das Betriebssystem oder Postgres gemeldet hat.

Wenn Sie JSON-Logs lesen (`NODE_ENV=production`), befindet sich dieselbe Kette unter `error.cause`, mit `code`, `address` und `port` bei jedem Kettenglied.

### `Failed query: [redacted]`

Das ist keine abgeschnittene Log-Zeile. Drizzle formatiert jeden Abfragefehler als `Failed query: <sql>`, gefolgt von den gebundenen Werten. Daher wandern das Statement und seine Parameter – eine E-Mail-Adresse, ein Passwort-Hash – in der Nachricht und im Stack von allem mit, was der Treiber erneut wirft. Der Logger entfernt diesen Bereich aus jeder geschriebenen Zeile und gibt stattdessen `[redacted]` aus.

Das Statement ist ohnehin selten die Antwort: Der Grund steht in den darunterliegenden `caused by:`-Zeilen. Wenn Sie es dennoch benötigen, setzen Sie in der Entwicklung `REBASE_LOG_RAW_QUERIES=true`, und das SQL wird stattdessen ausgegeben. Außerhalb der Entwicklung wird dies ignoriert, sodass eine Variable, die versehentlich in eine Produktionsumgebung gelangt, dort nichts sichtbar machen kann.

## Die Datenbank läuft nicht

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Auf dieser Adresse lauscht nichts. Starten Sie die Datenbank:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

Oder führen Sie `rebase dev` ganz ohne `DATABASE_URL` aus, wodurch eine verwaltete PGlite-Datenbank für Sie gestartet wird und keine Installation erforderlich ist.

Wenn der Host und der Port im Kasten nicht den erwarteten entsprechen, ist die `DATABASE_URL` in der `.env` nicht diejenige, die der Prozess gelesen hat – suchen Sie nach einer zweiten `.env`, einer bereits exportierten Shell-Variable oder einem Container, der gestartet wurde, bevor Sie die Datei bearbeitet haben.

## Das Passwort oder der Datenbankname ist falsch

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` steht für ein falsches Passwort, `28000` für eine Rolle, die sich von hier aus nicht verbinden darf, und `3D000` für eine Datenbank, die nicht existiert. Alle drei sind eindeutige Fakten über den Connection-String: Ein erneuter Versuch liefert dasselbe Ergebnis, daher schlägt der Start sofort fehl, anstatt einen Pool zu melden, der sich „möglicherweise erholt“.

Überprüfen Sie die Anmeldedaten in `DATABASE_URL`. Ein Passwort, das `@`, `/`, `?` oder `#` enthält, muss Prozent-kodiert werden – ein nicht kodiertes Passwort formt die URL stillschweigend um, und der Host, mit dem Sie sich letztendlich verbinden, ist nicht der, den Sie eingegeben haben.

## `type "vector" does not exist`

pgvector ist eine Server-Extension, daher installiert Rebase sie nur dort, wo ein Projekt dies ausdrücklich erlaubt. Deklarieren Sie sie in `config/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

Die Datenbank benötigt außerdem ein Image, das die Bibliothek bereitstellt. Das `pgvector/pgvector:pg18` des Scaffolds enthält sie; ein Standard-`postgres:18` nicht. Wenn die Installation selbst verweigert wird (`extension "vector" is not available` oder ein Berechtigungsfehler), ist die Konfiguration bereits korrekt, und was fehlt, ist die Bibliothek auf dem Server oder eine Rolle, die `CREATE EXTENSION vector;` ausführen darf.

## Die Datenbank hat das Statement verweigert

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Zwei verschiedene Probleme treten darunter auf, und die Meldung unterscheidet sie:

- **Eine Row-Level-Security-Policy hat die Zeile verweigert.** Das Zugriffskontrollsystem funktioniert; der Aufrufer hat etwas angefordert, das seine Richtlinien nicht erlauben. Überprüfen Sie die `securityRules` der Collection und führen Sie `npx @rebasepro/rls-check` für ein schreibgeschütztes Audit dessen aus, was die Datenbank tatsächlich durchsetzt.
- **Der Rolle fehlt ein `GRANT`.** Nichts an der Anfrage wird helfen – die Verbindungsrolle darf die Tabelle überhaupt nicht anrühren. Dies ist ein Deployment-Problem.

Ein Lesevorgang, den RLS ausschließt, ist kein Fehler: Die Zeilen werden gefiltert und Sie erhalten eine leere Seite. Wenn eine Collection für einen angemeldeten Benutzer, der Zeilen sehen sollte, als leer gelesen wird, ist die Policy der Ansatzpunkt, nicht die Abfrage.

## `SCHEMA_DRIFT` – eine Tabelle oder Spalte existiert nicht

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

Code und Datenbank stimmen nicht überein. In der Entwicklung:

```bash
rebase db push        # apply the collections to the database
rebase doctor         # the full three-way drift report
```

Auf einem verwalteten Cloud-Tenant kann `db push` die Datenbank nicht erreichen – die Runtime wendet das Schema stattdessen beim Booten an; führen Sie daher ein Redeploy durch, anstatt zu pushen.

Wenn eine Tabelle existiert, eine Spalte jedoch nicht, ist die Ursache meist eine Collection-Datei, die bearbeitet wurde, ohne sie neu zu generieren: Führen Sie `rebase schema generate` aus und pushen Sie erneut.

## Der Port wird bereits verwendet

```
Port 3001 is in use — trying 3002.
```

Dev bindet den nächsten freien Port und meldet dies. Die Meldung ist wichtig, da alles andere – die `VITE_API_URL` Ihres Frontends, ein Lesezeichen, ein `curl`-Befehl – weiterhin auf den alten Port zeigt. Die übliche Ursache ist ein vorheriges `rebase dev`, das den Socket noch belegt.

Übergeben Sie `--port`, um einen festzulegen, oder beenden Sie den anderen Prozess. In der Produktion gibt es keinen erneuten Versuch: Der konfigurierte Port ist der Port, und `EADDRINUSE` ist fatal.

## Das Backend ist abgestürzt und `rebase dev` lief weiter

Ein Backend, das beim Booten einen Fehler wirft, stoppt den Watcher nicht – es gibt den Stacktrace aus und wartet auf eine Dateiänderung. `rebase dev` meldet Folgendes:

```
  ✗ The backend crashed on startup.
    Fix the error above; the watcher restarts it on the next change.
```

Der Fehler darüber ist der eigentliche Fehler. Die häufigsten Ursachen sind ein Syntaxfehler in einer Collection-Datei, ein Import, der nicht aufgelöst werden kann, und eine `DATABASE_URL`, die ins Leere zeigt.

## Eine benutzerdefinierte Funktion wird nicht bereitgestellt

Funktionen werden beim Booten aus `backend/functions` geladen, und eine Datei, die nicht geladen werden kann, wird **übersprungen, nicht als fatal gewertet** – der Server startet ohne sie. Das Symptom ist also ein 404-Fehler bei einer Route, die Sie gerade geschrieben haben, und die Erklärung steht zwei Zeilen zuvor im Boot-Log:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Die üblichen Ursachen: Eine Abhängigkeit wird importiert, ist aber nicht in `package.json` vorhanden; ein relativer Import ohne Dateiendung (`./util` statt `./util.js` – das Projekt ist ESM, daher ist die Dateiendung erforderlich); und eine Datei, die etwas anderes als eine Hono-App exportiert. Erstellen Sie Funktionen mit `defineFunction(...)` aus `@rebasepro/server/functions`, um Letzteres stattdessen als Kompilierungsfehler zu erhalten – über diesen Subpfad, nicht das Paket-Root, damit die Funktion portabel bleibt.

Unterverzeichnisse werden nicht durchsucht. `functions/admin/users.ts` wird als übersprungener Eintrag gemeldet, anstatt bereitgestellt zu werden.

Sobald der Server läuft, antwortet eine Funktion, die zur Laufzeit der Anfrage einen Fehler wirft, mit dem JSON-Fehler-Envelope und protokolliert den Grund; eine Funktion, die nie zurückkehrt, wird nach `REBASE_FUNCTIONS_TIMEOUT_MS` abgebrochen und antwortet mit `504 FUNCTION_TIMEOUT`.

## Läuft es? `/livez` und `/health`

| Pfad | Greift auf die Datenbank zu | Antwortet |
| --- | --- | --- |
| `/livez` | Nein | `200 {"status":"ok"}`, solange der Prozess läuft. Nutzen Sie dies für eine Liveness-Probe. |
| `/health` | Ja, jede Datenquelle | `200 {"status":"ok"}`, wenn jede konfigurierte Datenquelle antwortet; `503 {"status":"degraded"}`, wenn eine nicht antwortet. Nutzen Sie dies für eine Readiness-Probe. |

Legen Sie keine Liveness-Probe auf `/health`: Ein kurzer Datenbankaussetzer würde dazu führen, dass der Orchestrator einen ansonsten fehlerfreien Prozess beendet, wodurch ein kurzer Ausfall in eine Neustartschleife verwandelt wird.

Da `/health` nicht authentifiziert ist, gibt der Endpunkt außerhalb der Entwicklung nur das Gesamtergebnis aus und welche Datenquelle beeinträchtigt ist, sonst nichts. Der Fehlertext des Treibers selbst – der Host, Port, Datenbankname und Rolle enthält – wird in die Logs geschrieben.

## Fehler nach dem Booten

Jeder API-Fehler liefert denselben Envelope und enthält einen `code`. Die [Fehlercode-Referenz](/docs/backend/errors/) listet alle Fehler mit Status und Lösung auf.

## Nächste Schritte

- [Fehlercodes](/docs/backend/errors/) – Jeder `code`, den die API zurückgeben kann, mit Status und Lösung.
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – Jede Variable, die die Runtime liest, und diejenigen, ohne die der Start in der Produktion verweigert wird.
- [Backend-Übersicht](/docs/backend/) – Was der Boot-Vorgang der Reihe nach tut und welche Probe welche Frage beantwortet.

---
