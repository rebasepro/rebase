---
sourceHash: 784025478be49fb3
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud in der CLI – Authentifizierung, Projektverknüpfung, Deploys, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Im
[Rebase Cloud-Leitfaden](/docs/deployment/cloud/) erfahren Sie, worum es sich handelt und was die Beta
noch nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
beziehen sich auf das in `.rebase/cloud.json` verknüpfte Projekt; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgaben (auch die
Standardeinstellung bei einer Pipe, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control-Plane anzuvisieren (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` akzeptiert `deploy`, `logs`, `env`, `database` und `backups` für ein Projekt
(`--project` oder das verknüpfte) sowie `billing`, `audit` und
`notifications` für eine Organisation: `--org`, andernfalls die Organisation des Projekts,
andernfalls die aktuell ausgewählte. Ein Token darf nur Berechtigungen für eine Organisation enthalten.
`logs` deckt auch `usage` ab. Was die einzelnen Berechtigungen abdecken, finden Sie unter
[CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents). Wenn die Control-Plane
eine Antwort auf ein Token als veraltet markiert (ein Token von vor `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmalig auf stderr aus, niemals im
`--json`-Wert.

An einem Terminal ohne angegebenes Passwort fragt `login`, ob Sie Ihr Passwort
oder einen Code verwenden möchten, den Ihnen die Control-Plane per E-Mail sendet. Bei aktivierter
Zwei-Faktor-Authentifizierung wird anschließend nach Ihrem Authenticator-Code (oder einem Wiederherstellungscode) gefragt. Ohne Terminal
kann keines von beiden eingegeben werden: Setzen Sie `REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole
unter Einstellungen → Zugriffstoken erstellt wurde. Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Projektverknüpfung

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Eine selbst gehostete Instanz mit Claude verbinden

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Der [Rebase-Connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht sie dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Ordner des Projekts bietet der Befehl an, sie in
`.env` zu schreiben. Eine erneute Ausführung ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` beendet den Befehl ohne zu warten. Nur für Eigentümer und Admins.

## Projekte

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` gibt den Übernahme-Link des Projekts aus, das `init --claim` in diesem
Verzeichnis bereitgestellt hat, sowie die verbleibende Zeit, bevor es nicht übernommen gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf der
Maschine aufbewahrt, die `init --claim` ausgeführt hat, in `~/.rebase/credentials.json`; die Control-Plane
speichert einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Ausgabe
fragt `claim` bei der Control-Plane an, ob das eigene Token des Projekts noch funktioniert. Eine Übernahme
widerruft dieses Token; sobald jemand das Projekt übernommen hat, verweigert `claim`
den Dienst mit `already_claimed`, anstatt einen ungültigen Link auszugeben. Der Befehl verweigert den Dienst auch, wenn das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Übernahme-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt nicht übernommen wurde.

## Bereitstellen und Beobachten

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

Wird `deploy` ohne App-Namen ausgeführt, wird das Backend bereitgestellt. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – alles, was Git nachverfolgt, niemals eine `.env` –, damit ein
Plattform-Upgrade diesen neu kompilieren kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert es und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein mitverfolgtes `deploy` endet mit einer Zusammenfassung: jede bereitgestellte App mit ihrer URL, die
Deployment-ID, die benötigte Zeit und die Information, ob die neue Version dort antwortet. Der Befehl
wartet bis zu `--live-timeout` Sekunden (Standard 60; `0` überspringt die Prüfung), bis das `/health`
eines Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagenes Deploy
endet mit einer Zeile, die die App und die Ursache nennt, und beendet sich mit einem Exit-Code ungleich null. Die Zusammenfassung
wird auch bei Pipes ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein einzelnes Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die bereitgestellt wird:
die `.js`-/.mjs`-/.cjs`-Dateien in deren `output` und die Inline-`<script>`-Blöcke in
deren HTML. Ein Syntaxfehler stoppt das Deploy mit `file:line:column` (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches
Deploy endet mit dem Pfad zurück: `rebase cloud rollback`. Eine statische App, die allein
bereitgestellt wurde, kann derzeit noch nicht zurückgerollt werden; siehe
[Rollback](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktionsumgebung unberührt. Eine Vorschau des Backends führt ein eigenes Backend auf
einer eigenen leeren Datenbank aus, wobei die statischen Apps integriert sind. Eine statische App kann auf
Rebase Cloud derzeit noch nicht eigenständig in der Vorschau angezeigt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und veröffentlicht nichts. Eine Backend-Vorschau
wird für die Dauer ihres Bestehens als eine zusätzliche App-Einheit in der Standardgröße abgerechnet, und
das Deploy zeigt an, wie viel dies pro Monat kostet, basierend auf dem Preisangebot der Control-Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control-Plane keinen
Preis ermitteln kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Vorschau, die von der Plattform pausiert wurde (die Datenbank hat das Vorschau-Limit überschritten), als
`paused` an, zusammen mit der Begründung (`statusMessage` unter `--json`). Eine neue Vorschau-Adresse
kann mit `preview_cert_budget` abgelehnt werden, wenn das wöchentliche Budget der Plattform für
Vorschau-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Vorschau einer Änderung](/docs/deployment/cloud/#preview-a-change).

### Protokolle

`rebase cloud logs` gibt das neueste Build-Protokoll aus, und `-f` verfolgt einen Build, der
noch läuft. `--runtime` liest stattdessen aus, was die Anwendung ausgibt – von jedem Pod
dahinter, wobei jede Zeile mit ihrem Pod gekennzeichnet ist:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder eine RFC3339-Zeitangabe.
- `--tail <n>` gibt die Anzahl der Zeilen pro Pod an, ab denen begonnen werden soll (die Control-Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen bei, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für einen
  regulären Ausdruck.
- `--level error|warn|info|debug` behält Zeilen mit dieser oder einer höheren Priorität bei. Es liest
  den strukturierten `severity`-Wert, den ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  Klartextzeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne solche Angaben werden ausgelassen.

Ein Follow fragt alle zwei Sekunden ab und gibt jede Zeile einmal aus. Es meldet Pods,
die gestartet, gestoppt oder neu gestartet werden. Wenn ein Container neu startet, gibt es auch die letzten
Zeilen der beendeten Instanz aus, in denen sich gewöhnlich die Ursache befindet. Es wartet, solange kein
Pod läuft, und unternimmt nach einem Verbindungsabbruch erneute Versuche mit Backoff und
setzt dort fort, wo es unterbrochen wurde. Mit `--json` gibt ein Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Protokollzeile und
`{"type":"event","event":…}` für die restlichen Ereignisse.

`--preview <name>` liest eine Vorschau anstelle der Produktion aus. Verwenden Sie den Namen der
Vorschau oder die Deployment-ID, die ein Preview-Deploy ausgegeben hat. Alleine ausgeführt liest `--preview`
die einzige Vorschau des Projekts. Eine statische Vorschau hat ein Build-Protokoll, aber kein
Laufzeitprotokoll, da sie keinen Server ausführt.

## Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` für die App erstellt und als
`REBASE_API_TOKEN` in `.env` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Das Übernehmen des Projekts
übergibt diesen Schlüssel, wodurch er nicht mehr abläuft. `app-key rotate` erstellt einen neuen Schlüssel und
widerruft alle vorherigen Agenten-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits festlegt, und schließt ihn dort aus `--json` aus. In
jedem anderen Verzeichnis gibt der Befehl den Schlüssel einmalig aus. Schlüssel, die im Admin-Panel der App
erstellt wurden, bleiben unberührt. Er läuft mit Ihrem Login: Es gibt keine Token-Berechtigung, die diesen Zugriff gewährt.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um den neuesten Schlüssel zu übernehmen. Der Schlüssel selbst wird
niemals ausgegeben: Dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
erstellt einen neuen Schlüssel und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, und danach nicht mehr. Der Befehl wird abgewiesen, während ein Deploy
läuft, und er läuft mit Ihrem Login. Das Übernehmen eines Projekts rotiert auch dessen Service-Key.

Eine Backend-Vorschau übernimmt zunächst die Variablen der Produktionsumgebung, einschließlich produktiver Schlüssel.
`env set KEY=VALUE --preview` gibt Vorschauen einen eigenen Wert, `env unset KEY
--preview` schließt die Variable aus ihnen aus, `env reset KEY --preview` stellt
den Wert der Produktion wieder her, und `env list --preview` zeigt die Unterschiede an.
Die Produktionsumgebung wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert aus der Standardeingabe anstelle der
Befehlszeile, wo `ps` und Ihr Shell-Verlauf ihn sichtbar machen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird entfernt. Die Funktion `rebase_cloud_env_set` des MCP-Servers
setzt Werte auf diese Weise.

## Organisationen

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` erstellt eine Einladung und gibt ihren Link aus: einmalige Verwendung,
7 Tage gültig, kann nur von einem Konto akzeptiert werden, das diese Adresse bestätigt hat.
Niemand tritt bei, bevor die Einladung nicht angenommen wurde – selbst jemand, der bereits ein Rebase-Konto hat.
Die Ausgabe (und `emailDelivery` in `--json`) gibt an, ob die Einladung per E-Mail versendet wurde; falls
nicht, weist eine Warnung darauf hin, den Link selbst zu versenden. `--role` ist `admin` oder
`member` (Standard). Niemand wird als `owner` eingeladen: Laden Sie die Person als Admin ein, und
ein Eigentümer befördert sie nach dem Beitritt mit `members role <email> owner`.
`invites resend` erzeugt einen neuen Link, wodurch der alte ungültig wird.
Das Einladen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgewiesen. Das Einladen, Auflisten, erneute Senden und Widerrufen erfordern die Rolle Eigentümer
oder Admin; Mitglieder erhalten einen entsprechenden Hinweis.
`members remove` verlangt eine Bestätigung (`--yes` überspringt diese); das Entfernen oder Herabstufen eines Eigentümers
erfordert einen Eigentümer, und der letzte Eigentümer verbleibt immer. `--org <id>` wählt eine Organisation
aus, die nicht die aktuell ausgewählte ist.

`activity` ist das Audit-Protokoll der ausgewählten Organisation, neueste Einträge zuerst: wer
bereitgestellt, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder offengelegt hat (nach
Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
die Rechenleistung eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite umfasst bis zu 100 Einträge (`--limit`, Standard 50); die
Ausgabe gibt den `--before`-Cursor für die nächste Seite aus. `--json` liefert einen einzelnen Wert,
`{ org, events, nextCursor }`. Hierfür ist die Eigentümer- oder Admin-Rolle der Organisation erforderlich.
Ein Token kann dies nur mit der `audit`-Berechtigung für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die **Aktivität**-Seite in der Konsole
zeigt dasselbe Protokoll.

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Eigentümer oder Admins.

## Gäste

Jedes `signInAnonymously()` in einem Test, durch einen Bot oder einen abgebrochenen Besuch hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie, damit
sie niemand einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` akzeptiert eine Zeitspanne mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt der Befehl nur und löscht nichts. Er verarbeitet Projekte jeder Größe in kleinen
Batches.

Es können nur Gäste entfernt werden. Ein Gast ist eine Zeile mit gesetztem `is_anonymous`, ohne Passwort und ohne
verknüpfte Identität. Die App wendet diese Regel in der Anweisung an, die die
Zeile löscht, sodass der Befehl kein reguläres Konto erreichen kann – selbst dann nicht, wenn es sich einen Moment
nach der Auflistung registriert hat. `delete` weist ein Konto mit `NOT_ANONYMOUS` ab.

**Zuletzt gesehen** ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder an
dem der Gast erstellt wurde, falls er kein Refresh-Token mehr besitzt. Ein Gast, der regelmäßig
wiederkehrt, gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Tokens eines gelöschten
Gastes und alle anderen Auth-Zeilen werden mit ihm entfernt.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel:

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, Standard) | Bleibt erhalten, die Verknüpfung wird geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, Standard) | Bleibt erhalten und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Bleibt erhalten und enthält eine ID, die nicht mehr existiert |

Prüfen Sie, welche Ihrer Verknüpfungen kaskadieren, bevor Sie `--yes` übergeben: Dies kann nicht rückgängig gemacht werden.

Der Befehl liest `REBASE_SERVICE_KEY` auf die gleiche Weise wie `env reveal`, benötigt also einen
Eigentümer oder Admin (oder ein Token mit der `env`-Berechtigung, das einem solchen gehört). Der
Schlüssel verbleibt im Speicher und wird ausschließlich an die Adresse des Projekts selbst gesendet. Einem Projekt auf einer
älteren Laufzeitumgebung wird mitgeteilt, dass es eine neuere benötigt.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was dessen Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfällt – das
wären Daten, die durch einen Push gelöscht würden. Die Plattform behält sie bei, bindet sie ein und rechnet sie ab, bis sie
jemand explizit über ihren Namen bereinigt.

## Compute

Was das Projekt reserviert und was dies kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` wurde eingestellt: Jedes Backend führt mindestens eine Instanz aus, daher
wird `true` abgelehnt und `false` mit einer Warnung ignoriert. Es gibt keine Tarifstufen
(Plan Tiers): Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, Benachrichtigungen, Cluster, Abrechnung und Nutzung

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud webhooks            # retired: exits 1 (`command_retired`) and names `notifications`
rebase cloud clusters list | add | verify | registry   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` sendet die Ereignisse des verknüpften Projekts an eine URL. `--events`
akzeptiert eine kommagetrennte Liste von `deploy.failed` (Standard),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` und `preview.paused`. `--format slack` sendet
ausschließlich `{ "text" }` anstelle des vollständigen Ereignis-JSONs, das ebenfalls ein `text`-Feld enthält. Die URL
ist ein positionsbezogenes Argument, da `--url` die Control-Plane bezeichnet. `add` gibt
das Signaturgeheimnis einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` beendet mit Exit-Code 1 und dem Fehlercode `delivery_failed`, wenn der Empfänger
das Testereignis nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle Eigentümer oder Admin. Ein Token verwaltet diese mit der
`notifications`-Berechtigung für die Organisation unter denselben Rollenregeln. Siehe
[Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo> --push-service-account <email> --pull-key-file <key.json>` stellt für den
eigenen Cluster eines Kunden eine eigene Image-Registry bereit, die ausschließlich für diesen Cluster verwendet wird. Ohne
eine solche Registry nutzt ein solcher Cluster die geteilte Registry der Plattform, worauf jedes Deploy
im Protokoll hinweist. Mit einer eigenen Registry pushen Builds mit einem Token für
dieses Konto in dieses Repository, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
Bilder des Projekts dort. Images,
die das Projekt zuvor im geteilten Repository erstellt hat, bleiben abrufbar und bleiben
mögliche Rollback-Ziele. Die drei Werte gehören zusammen; `--clear` setzt sie zurück. Der Schlüssel
wird beim Schreiben versiegelt und niemals wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Platform-Admin-Rolle. Der Operator erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Abrechnungsseite der Konsole und sind ausschließlich für Eigentümer und Admins der Organisation zugänglich.
Ein Token erreicht diese Befehle – und den Rest von `billing` – mit der `billing`-Berechtigung
für die Organisation; ein Token, das vor Einführung dieser Berechtigung erstellt wurde, funktioniert noch für
ein Release weiter, mit einer Warnung bei jeder Antwort. Beträge in `--json` sind in der kleinsten Währungseinheit (Cent) angegeben, exakt so,
wie Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und die nutzungsbasierten Posten wachsen bis zum Ende des Abrechnungszeitraums weiter an.

`usage` liest aus, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
in UTC verbraucht hat: Anfragen im Vergleich zum enthaltenen Freikontingent, 5xx-Fehler, die bisherige
Mehrnutzung in Euro und für den laufenden Monat eine Hochrechnung, wohin die Entwicklung bei diesem
Tempo führt (eine Schätzung). Die Mehrnutzung entspricht der Berechnung des Over-Usage-Reports selbst – jener,
die Stripe mitteilt, was abgerechnet werden soll, und die auf der Rechnung des Folgemonats erscheint.
`usage org` listet jedes Projekt der mit `rebase cloud use` ausgewählten Organisation
sowie die Gesamtsumme auf. Jedes Mitglied der Organisation kann diese Daten einsehen. Ein Token liest
sie mit der `logs`-Berechtigung für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese Berechtigung besitzt.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher wird mit 0 ausgelesen), `multi_pod_undercount` (Anfragen, die bedient werden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (bei einem von einem
Agenten übernommenen Projekt werden nur die Tage ab der Übernahme gezählt) und
`autoscale_not_charged` (Pods liefen über `--replicas` hinaus und diese Plattform stellt
sie noch nicht in Rechnung). Die Antwort eines automatisch skalierten Projekts enthält außerdem `autoscale`:
`extraPodSeconds` oberhalb der Minimalgrenze, `amountEur` zu den entsprechenden Tarifen und `charged`.
