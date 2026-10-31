---
sourceHash: 4b7b199f1aa18e8d
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud in der CLI – Authentifizierung, Projektverknüpfung, Deploys, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Siehe den
[Rebase Cloud guide](/docs/deployment/cloud/) für Details dazu, was es ist und was die Beta
nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch die
Standardeinstellung bei Pipes, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>` zur Adressierung
einer bestimmten Control-Plane (oder `REBASE_CLOUD_URL`) und `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` akzeptiert `deploy`, `logs`, `env`, `database` und `backups` für ein Projekt
(`--project` oder das verknüpfte) sowie `billing`, `audit` und
`notifications` für eine Organisation: `--org`, andernfalls die Organisation des Projekts,
andernfalls die ausgewählte. Ein Token kann auch nur Organisations-Berechtigungen enthalten.
`logs` deckt auch `usage` ab. Was die einzelnen Berechtigungen abdecken, ist unter
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben. Wenn die Control-Plane
eine Antwort für ein Token als veraltet markiert (ein Token von vor der Einführung von `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmal auf stderr aus, niemals im
`--json`-Wert.

An einem Terminal ohne angegebenes Passwort fragt `login`, ob Sie Ihr Passwort
oder einen Code verwenden möchten, den die Control-Plane Ihnen per E-Mail sendet. Wenn die Zwei-Faktor-Authentifizierung
aktiviert ist, wird anschließend nach Ihrem Authentifikator-Code (oder einem Wiederherstellungscode) gefragt. Ohne Terminal
kann keines von beiden eingegeben werden: Setzen Sie `REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole
unter Settings → Access tokens erstellt wurde. Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projects

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` gibt den Claim-Link des Projekts aus, das von `init --claim` in diesem
Verzeichnis bereitgestellt wurde, sowie die verbleibende Zeit, bis es unbeansprucht gelöscht
wird (`Unclaimed: deleted in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf dem
Computer gespeichert, auf dem `init --claim` ausgeführt wurde (in `~/.rebase/credentials.json`); die Control-Plane
speichert einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort fragt `claim`
bei der Control-Plane an, ob das Token des Projekts selbst noch gültig ist. Ein Claim
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, verweigert `claim`
die Ausführung mit `already_claimed`, anstatt einen toten Link auszugeben. Der Befehl schlägt ebenfalls fehl, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt unbeansprucht ist.

## Deploy and observe

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

`deploy` ohne App-Namen stellt das Backend bereit. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – alles, was Git trackt, niemals eine `.env` –, damit ein
Plattform-Upgrade ihn neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert dies und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein verfolgter `deploy`-Vorgang endet mit einer Zusammenfassung: jede bereitgestellte App mit ihrer URL, der
Deployment-ID, der benötigten Dauer und der Information, ob die neue Version dort antwortet. Er
wartet bis zu `--live-timeout` Sekunden (Standard: 60; `0` überspringt die Prüfung), bis
das `/health` des Backends und die Adressen der einzelnen statischen Apps antworten. Ein fehlgeschlagenes Deployment
endet mit einer Zeile, die die App und den Grund nennt, und beendet sich mit einem Exit-Code ungleich null. Die Zusammenfassung
wird auch bei Pipes ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`.

Vor dem Hochladen analysiert `deploy` das JavaScript jeder statischen App, die es ausliefert:
die `.js`/`.mjs`/`.cjs`-Dateien in `output` und die Inline-`<script>`-Blöcke in
seinem HTML. Ein Syntaxfehler bricht das Deployment mit `file:line:column` ab (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt diese Prüfung. Ein erfolgreiches
Deployment endet mit dem Weg zurück, `rebase cloud rollback`. Eine statische App, die für
sich allein bereitgestellt wurde, kann derzeit noch nicht zurückgerollt werden; siehe
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktion unberührt. Eine Preview des Backends führt ein eigenes Backend auf
einer eigenen, leeren Datenbank aus, wobei die statischen Apps integriert sind. Eine statische App kann
auf Rebase Cloud derzeit noch nicht separat in der Vorschau angezeigt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgewiesen und veröffentlicht nichts. Eine Backend-Preview
wird, solange sie existiert, als eine zusätzliche App-Einheit in der Standardgröße abgerechnet, und
das Deployment gibt an, wie viel dies pro Monat kostet, basierend auf dem Kostenvoranschlag der Control-Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control-Plane den Preis nicht
ermitteln kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Preview, die von der Plattform pausiert wurde (deren Datenbank das Preview-Limit überschritten hat), als
`paused` mit der Begründung an (`statusMessage` unter `--json`). Eine neue Preview-Adresse
kann mit `preview_cert_budget` abgewiesen werden, wenn das wöchentliche Budget der Plattform für
Preview-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann dies gilt.
Siehe [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` verfolgt (tails) einen Build, der
noch läuft. `--runtime` liest stattdessen aus, was die App ausgibt, und zwar von jedem Pod
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
- `--level error|warn|info|debug` behält Zeilen mit diesem oder einem schwerwiegenderen Schweregrad bei. Es liest
  den strukturierten `severity`-Wert, den ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  Klartextzeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne solche Angaben werden ausgelassen.

Ein Follow pollt alle zwei Sekunden und gibt jede Zeile einmal aus. Es meldet Pods,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, werden auch die letzten
Zeilen der beendeten Instanz ausgegeben, in denen sich normalerweise der Grund befindet. Es wartet, solange kein
Pod läuft, und unternimmt nach einem Verbindungsabbruch erneute Versuche mit Backoff und
setzt dort fort, wo es aufgehört hat. Mit `--json` gibt ein Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Logzeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Preview anstelle der Produktion aus. Verwenden Sie den
Namen der Preview oder die Deployment-ID, die beim Preview-Deploy ausgegeben wurde. Alleinstehend
liest `--preview` die einzige Preview des Projekts aus. Eine statische Preview hat ein Build-Log,
aber kein Runtime-Log, da sie keinen Server ausführt.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` für die App generiert und als
`REBASE_API_TOKEN` in `.env` geschrieben hat – anhand seines Präfixes und niemals anhand seines Werts. Durch das Beanspruchen des Projekts
wird dieser Schlüssel übertragen und läuft nicht mehr ab. `app-key rotate` generiert einen neuen Schlüssel und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`-Datei,
die bereits `REBASE_API_TOKEN` festlegt, und schließt ihn dort von `--json` aus. In
jedem anderen Verzeichnis wird der Schlüssel einmalig ausgegeben. Schlüssel, die im Admin-Panel der App erstellt wurden,
bleiben unberührt. Der Befehl wird mit Ihrem Login ausgeführt: keine Token-Berechtigung gewährt diesen Zugriff.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um auf den neuesten Schlüssel umzustellen. Der Schlüssel selbst
wird nie ausgegeben: dafür dient `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
stellt einen neuen Schlüssel aus und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, danach nicht mehr. Der Befehl wird abgewiesen, während ein Deployment
läuft, und wird mit Ihrem Login ausgeführt. Durch das Beanspruchen eines Projekts wird auch dessen Service-Schlüssel rotiert.

Eine Backend-Preview übernimmt initial die Variablen der Produktion, einschließlich Live-Schlüsseln.
`env set KEY=VALUE --preview` weist Previews einen eigenen Wert zu, `env unset KEY
--preview` schließt die Variable aus Previews aus, `env reset KEY --preview` stellt
den Wert der Produktion wieder her und `env list --preview` zeigt die Unterschiede an.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert von der Standardeingabe anstelle der
Befehlszeile, wo `ps` und Ihre Shell-Historie ihn sichtbar machen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird entfernt. Das Tool `rebase_cloud_env_set` des MCP-Servers
setzt Werte auf diese Weise.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` erstellt eine Einladung und gibt deren Link aus: einmalig verwendbar,
7 Tage gültig, kann nur von einem Konto akzeptiert werden, das diese Adresse verifiziert hat.
Niemand tritt bei, bevor die Einladung akzeptiert wurde – selbst jemand, der bereits ein Rebase-Konto besitzt.
Die Ausgabe (und `emailDelivery` in `--json`) gibt an, ob die Einladung per E-Mail versendet wurde; wenn
dies nicht der Fall war, weist eine Warnung darauf hin, den Link selbst zu versenden. `--role` ist `admin` oder
`member` (Standard). Niemand kann als `owner` eingeladen werden: Laden Sie Personen als Admin ein, und
ein Owner befördert sie nach dem Beitritt mit `members role <email> owner`.
`invites resend` erzeugt einen neuen Link, wodurch der alte ungültig wird.
Das Einladen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgewiesen. Das Einladen, Auflisten, erneute Senden und Widerrufen erfordert die Rolle
Owner oder Admin; einem Member wird dies entsprechend mitgeteilt.
`members remove` fragt vorher nach (`--yes` überspringt die Abfrage); das Entfernen oder Herabstufen eines Owners
erfordert einen Owner, und der letzte Owner bleibt bestehen. `--org <id>` wählt eine Organisation
aus, die von der ausgewählten abweicht.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste Einträge zuerst: wer
ein Deployment durchgeführt, ein Rollback gemacht, eine Umgebungsvariable gesetzt, gelöscht oder offengelegt hat (nach
Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
das Compute eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines Mitglieds geändert
oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite fasst bis zu 100 Einträge (`--limit`, Standard: 50); die
Ausgabe gibt den `--before`-Cursor für die nächste Seite an. `--json` liefert ein Objekt:
`{ org, events, nextCursor }`. Hierfür ist die Rolle Owner oder Admin der Organisation erforderlich.
Ein Token kann dies nur mit der `audit`-Berechtigung für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die Seite **Activity** in der Konsole
zeigt dasselbe Log an.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admins.

## Guests

<span class="since-badge" data-since="0.27">Seit 0.27</span>

Jeder Aufruf von `signInAnonymously()` in einem Test, durch einen Bot oder einen abgebrochenen Besuch hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie, damit
niemand sie einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` nimmt eine Altersangabe mit einer Einheit entgegen: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt der Befehl nur und löscht nichts. Er arbeitet sich in kleinen
Batches durch ein Projekt beliebiger Größe.

Nur Gäste können entfernt werden. Ein Gast ist eine Zeile mit gesetztem `is_anonymous`, ohne Passwort und ohne
verknüpfte Identität. Die App wendet diese Regel direkt im Statement an, das die Zeile
löscht, sodass der Befehl kein reguläres Konto erfassen kann – selbst wenn dieses sich kurz
nach dem Auflisten registriert hat. `delete` verweigert das Löschen eines Kontos mit `NOT_ANONYMOUS`.

**Zuletzt gesehen** (**Last seen**) gibt an, wann die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder wann
der Gast erstellt wurde, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der immer wieder zurückkehrt,
gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Token eines gelöschten Gastes
sowie alle weiteren Auth-Zeilen werden mitgelöscht.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel:

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, der Standard) | Beibehalten, Verknüpfung wird geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, der Standard) | Beibehalten und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Beibehalten, enthält eine nicht mehr existierende ID |

Prüfen Sie, welche Ihrer Verknüpfungen kaskadieren, bevor Sie `--yes` übergeben: Dies kann nicht rückgängig gemacht werden.

Der Befehl liest `REBASE_SERVICE_KEY` genauso aus wie `env reveal`; daher ist die Rolle
Owner oder Admin erforderlich (oder ein Token mit der `env`-Berechtigung, das einem solchen gehört). Der
Schlüssel verbleibt im Arbeitsspeicher und wird ausschließlich an die projekteigene Adresse gesendet. Ein Projekt mit einer
älteren Runtime wird darauf hingewiesen, dass eine neuere erforderlich ist.

## Resources

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was dessen Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deployment entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfernt wird – das
wären Daten, die durch einen Push gelöscht würden. Sie wird beibehalten, angebunden und abgerechnet, bis
jemand sie namentlich bereinigt (`prune`).

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
wird `true` abgewiesen und `false` mit einer Warnung ignoriert. Es gibt keine
Tarifstufen: Alles wird pro Ressource bepreist. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

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
`{ "text" }` allein anstelle des Event-JSONs, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control-Plane angibt. `add` gibt
das Signiergeheimnis einmalig aus; `--json` liefert `{ projectId, webhook, secret }`.
`test <id>` beendet mit Exit-Code 1 und dem Code `delivery_failed`, wenn der Empfänger das
Test-Event nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle Owner oder Admin. Ein Token verwaltet diese mit der
`notifications`-Berechtigung für die Organisation unter denselben Rollenregeln. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` stellt einem kundeneigenen
Cluster eine eigene Image-Registry bereit, die ausschließlich für diesen Cluster verwendet wird. Ohne
eine solche verwendet ein derartiger Cluster die gemeinsam genutzte Plattform-Registry, und jedes Deployment darauf
weist im Log darauf hin. Mit einer Registry pushen Builds in dieses Repository mit einem Token für
dieses Konto, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
dortigen Images des Projekts. Images,
die das Projekt zuvor in der gemeinsam genutzten Registry gebaut hat, bleiben pullbar und stehen weiterhin
als Rollback-Ziele zur Verfügung. Die drei Werte gehören zusammen; `--clear` setzt sie zurück. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Rolle Platform-Admin. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Abrechnungsseite der Konsole und sind nur für Owner und Admins der Organisation
zugänglich. Ein Token hat Zugriff darauf und auf den Rest von `billing`, wenn es über die `billing`-Berechtigung
für die Organisation verfügt; ein vor dieser Berechtigung erstelltes Token funktioniert
für ein Release weiter, mit einer Warnung bei jeder Antwort. Beträge in `--json` werden in der kleinsten Währungseinheit (Cent) angegeben, exakt so, wie
Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und die nutzungsabhängigen Posten wachsen bis zum Ende des Abrechnungszeitraums weiter an.

`usage` liest aus, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
in UTC verbraucht hat: Anfragen im Vergleich zum enthaltenen Freikontingent, 5xx-Fehler, die bisherigen
Mehrkosten in Euro und – für den laufenden Monat – die Hochrechnung bei aktuellem
Tempo (eine Schätzung). Der Overage-Wert entspricht der Berechnung des Overage-Berichts selbst,
welcher Stripe mitteilt, was abgerechnet werden soll, und erscheint auf der Rechnung des Folgemonats.
`usage org` listet alle Projekte der mit `rebase cloud use` ausgewählten Organisation
sowie die Gesamtsumme auf. Jedes Mitglied der Organisation kann diese Daten einsehen. Ein Token liest
sie mit der `logs`-Berechtigung für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese Berechtigung besitzt.
`--month` nimmt einen vergangenen Monat entgegen. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher zeigt 0 an), `multi_pod_undercount` (Anfragen, die bedient wurden, während zwei oder
mehr App-Pods liefen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten beanspruchtes Projekt zählt erst ab dem Tag des Claims) und
`autoscale_not_charged` (Pods liefen über `--replicas` hinaus und diese Plattform stellt
sie noch nicht in Rechnung). Die Antwort eines automatisch skalierten Projekts enthält zudem `autoscale`:
`extraPodSeconds` oberhalb des Basiswerts, `amountEur` zu den entsprechenden Tarifen und `charged`.
