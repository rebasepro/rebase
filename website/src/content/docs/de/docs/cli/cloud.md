---
sourceHash: 279e0eca02e1be02
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud im CLI – Auth, Projektverknüpfung, Deployments, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in einer privaten Beta-Phase befindet. Weitere
Informationen darüber, was es ist und was die Beta nicht enthält, finden Sie im
[Rebase Cloud guide](/docs/deployment/cloud/).

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch standardmäßig bei
Verwendung von Pipes, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

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
andernfalls die aktuell ausgewählte. Ein Token darf auch ausschließlich Organisationsberechtigungen enthalten.
`logs` deckt auch `usage` ab. Was jede Berechtigung umfasst, ist unter
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben. Wenn die Control
Plane eine Antwort auf ein Token als veraltet markiert (ein Token von vor `billing`,
das Abrechnungsdaten liest), gibt das CLI den Hinweis einmalig auf stderr aus, niemals im
`--json`-Wert.

In einem Terminal ohne angegebenes Passwort fragt `login`, ob Sie Ihr Passwort
oder einen Code verwenden möchten, den die Control Plane Ihnen per E-Mail sendet. Wenn die
Zwei-Faktor-Authentifizierung aktiviert ist, wird anschließend nach Ihrem Authenticator-Code (oder einem Wiederherstellungscode) gefragt. Ohne Terminal
kann keines von beiden eingegeben werden: Setzen Sie `REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole
unter Settings → Access tokens erstellt wurde. Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Projektverknüpfung

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

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

`claim` gibt den Übernahme-Link (Claim-Link) des Projekts aus, das von `init --claim` in diesem
Verzeichnis bereitgestellt wurde, sowie die verbleibende Zeit, bis es ungeclaimt gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf dem
Rechner gespeichert, auf dem `init --claim` ausgeführt wurde (in `~/.rebase/credentials.json`); die Control
Plane speichert lediglich einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Antwort prüft `claim`
bei der Control Plane, ob das projekteigene Token noch gültig ist. Eine Übernahme
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, verweigert `claim`
die Ausführung mit `already_claimed`, anstatt einen toten Link anzuzeigen. Der Befehl wird ebenfalls verweigert, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt noch nicht übernommen wurde.

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

`deploy` ohne App-Namen deployt das Backend. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – was git trackt, niemals eine `.env` –, damit ein
Plattform-Upgrade ihn neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert es und löscht die gespeicherte Kopie. `--allow-downgrade` deployt ein älteres Release.

Ein verfolgtes `deploy` endet mit einer Zusammenfassung: jede bereitgestellte App mit ihrer URL, der
Deployment-ID, der Dauer und der Information, ob die neue Version dort antwortet. Es
wartet bis zu `--live-timeout` Sekunden (Standard: 60; `0` überspringt die Prüfung), bis `/health`
eines Backends und die Adressen jeder statischen App antworten. Ein fehlgeschlagenes Deployment
endet mit einer Zeile, die die App und den Grund nennt, und beendet sich mit einem Exit-Code ungleich null. Die Zusammenfassung
wird auch bei Pipelines ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein einzelnes Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die es ausliefert:
die `.js`/`.mjs`/`.cjs`-Dateien in deren `output` und die Inline-`<script>`-Blöcke in
ihrem HTML. Ein Syntaxfehler stoppt das Deployment mit `file:line:column` (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches
Deployment schließt mit dem Weg zurück ab: `rebase cloud rollback`. Eine separat bereitgestellte
statische App kann derzeit noch nicht zurückgerollt werden; siehe
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktion unverändert. Eine Preview des Backends führt ein eigenes Backend auf einer
eigenen leeren Datenbank aus, in das die statischen Apps integriert sind. Eine statische App kann auf
Rebase Cloud derzeit noch nicht separat als Vorschau bereitgestellt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` verweigert und veröffentlicht nichts. Eine Backend-Preview
wird für ihre Lebensdauer als eine weitere App-Einheit in Standardgröße abgerechnet, und
das Deployment gibt an, wie viel dies pro Monat kostet, basierend auf dem Angebot der Control Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control Plane keinen Preis
ermitteln kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews`
zeigt eine Preview, die von der Plattform pausiert wurde (da ihre Datenbank das Preview-Limit überschritten hat), als
`paused` mit dem entsprechenden Grund an (`statusMessage` unter `--json`). Eine neue Preview-Adresse
kann mit `preview_cert_budget` abgewiesen werden, wenn das wöchentliche Budget der Plattform für
Preview-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` folgt einem Build, der
noch läuft. `--runtime` liest stattdessen die Ausgaben der App von allen dahinterliegenden
Pods, wobei jede Zeile mit ihrem Pod gekennzeichnet ist:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder eine Zeitangabe nach RFC3339.
- `--tail <n>` gibt die Anzahl der Zeilen pro Pod an, ab denen begonnen werden soll (die Control Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen bei, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); verwenden Sie `/re/flags` für reguläre
  Ausdrücke.
- `--level error|warn|info|debug` filtert nach Zeilen mit dieser oder einer höheren Schweregradstufe. Es wertet
  den strukturierten `severity`-Wert aus, den ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  einfachen Zeile oder Fehlermuster wie `TypeError:`. Zeilen ohne diese Angaben werden weggelassen.

Ein Follow-Vorgang pollt alle zwei Sekunden und gibt jede Zeile einmal aus. Er meldet Pods,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, werden auch die letzten
Zeilen der beendeten Instanz ausgegeben, in denen meist die Ursache zu finden ist. Er wartet, solange kein
Pod läuft, und nach einem Verbindungsabbruch versucht er es mit Backoff erneut und
setzt dort fort, wo er aufgehört hat. Mit `--json` gibt Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Logzeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Preview anstelle der Produktion. Verwenden Sie den Namen der Preview
oder die Deployment-ID, die beim Preview-Deploy ausgegeben wurde. Für sich allein liest
`--preview` die einzige Preview des Projekts. Eine statische Preview hat ein Build-Log, aber kein
Runtime-Log, da sie keinen Server ausführt.

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
Schlüssel auf, den `rebase cloud init --claim` für die App generiert und als
`REBASE_API_TOKEN` in `.env` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Durch das Claimen des Projekts
wird dieser Schlüssel übergeben und läuft nicht mehr ab. `app-key rotate` generiert einen neuen Schlüssel und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits definiert, und hält ihn dort aus `--json` heraus. In
jedem anderen Verzeichnis wird der Schlüssel einmalig ausgegeben. Schlüssel, die im Admin-Panel der App
erstellt wurden, bleiben unberührt. Der Befehl wird mit Ihrem Login ausgeführt: Keine Token-Berechtigung gewährt Zugriff darauf.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um den neuesten Schlüssel zu übernehmen. Der
Schlüssel selbst wird nie ausgegeben: Dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
generiert einen neuen Schlüssel und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, danach nicht mehr. Der Befehl wird abgewiesen, während ein Deploy
läuft, und er erfordert Ihren Login. Das Übernehmen (Claimen) eines Projekts rotiert auch dessen Service-Schlüssel.

Eine Backend-Preview übernimmt zunächst die Variablen der Produktion, einschließlich Live-Schlüsseln.
`env set KEY=VALUE --preview` weist Previews einen eigenen Wert zu, `env unset KEY
--preview` schließt die Variable aus ihnen aus, `env reset KEY --preview` stellt
den Produktionswert wieder her, und `env list --preview` zeigt die Unterschiede an.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert von der Standardeingabe anstelle der
Befehlszeile, wo `ps` und Ihre Shell-Historie ihn sichtbar machen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird entfernt. Das Tool `rebase_cloud_env_set` des MCP-Servers
setzt Werte auf diese Weise.

## Organisationen

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` erstellt eine Einladung und gibt deren Link aus: einmalig nutzbar,
7 Tage gültig, nur annehmbar von einem Konto, das diese Adresse verifiziert hat.
Niemand tritt bei, bevor die Einladung angenommen wurde – selbst Personen mit bestehendem Rebase-Konto nicht.
Die Ausgabe (und `emailDelivery` in `--json`) zeigt an, ob die Einladung per E-Mail versendet wurde; falls
nicht, weist eine Warnung darauf hin, den Link selbst zu versenden. `--role` ist `admin` oder
`member` (Standard). Niemand wird als `owner` eingeladen: Laden Sie die Person als Admin ein, und
ein Owner befördert sie nach dem Beitritt mit `members role <email> owner`.
`invites resend` erzeugt einen neuen Link, und der alte verliert seine Gültigkeit.
Das Einladen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgewiesen. Das Einladen, Auflisten, erneute Senden und Widerrufen erfordert die Rolle 'Owner' oder 'Admin';
einem 'Member' wird dies mitgeteilt.
`members remove` fragt vorher nach (`--yes` überspringt die Nachfrage); das Entfernen oder Herabstufen eines Owners
erfordert einen Owner, und der letzte Owner bleibt bestehen. `--org <id>` wählt eine andere
als die aktuell ausgewählte Organisation aus.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste Einträge zuerst: wer
deployed, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder aufgedeckt hat (nach
Name, nie nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
die Compute-Ressourcen eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite umfasst bis zu 100 Einträge (`--limit`, Standard: 50); die
Ausgabe gibt den `--before`-Cursor für die nächste Seite an. `--json` liefert einen einzelnen Wert:
`{ org, events, nextCursor }`. Es erfordert die Rolle 'Owner' oder 'Admin' der Organisation.
Ein Token kann dies nur mit der Berechtigung `audit` für die Organisation lesen
(`rebase cloud tokens create --can audit`). Die **Activity**-Seite in der Konsole
zeigt dasselbe Protokoll an.

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank darstellt (kein öffentlicher
Endpunkt), bis Ctrl-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admins.

## Gäste

Jedes `signInAnonymously()` in einem Test, durch einen Bot oder bei einem abgebrochenen Besuch hinterlässt eine Zeile
in den Benutzern des Projekts. Diese Befehle zählen diese Zeilen und entfernen sie, sodass
niemand sie einzeln durchklicken muss.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` erwartet eine Altersangabe mit Einheit: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt es nur und löscht nichts. Es arbeitet sich in kleinen Batches durch
Projekte jeder Größe.

Es können nur Gäste entfernt werden. Ein Gast ist eine Zeile mit gesetztem `is_anonymous`, ohne Passwort und ohne
verknüpfte Identität. Die App wendet diese Regel direkt in der Anweisung an, die die Zeile
löscht, sodass der Befehl kein reguläres Konto erreichen kann – selbst dann nicht, wenn es sich kurz
nach der Auflistung registriert hat. `delete` verweigert Konten mit `NOT_ANONYMOUS`.

**Zuletzt gesehen** (Last seen) ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder
der Erstellungszeitpunkt des Gastes, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der regelmäßig wiederkehrt,
gilt nicht als alt, egal wie lange die Erstellung her ist. Mit einem gelöschten Gast werden auch
dessen Refresh-Tokens und alle weiteren Auth-Zeilen entfernt.

Zeilen in Ihren eigenen Tabellen folgen deren Fremdschlüsseln:

| Die Spalte | Was mit der Zeile geschieht |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, Standard) | Bleibt erhalten, die Verknüpfung wird geleert |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, Standard) | Bleibt erhalten und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine einfache ID) | Bleibt erhalten und enthält eine nicht mehr existierende ID |

Prüfen Sie vor der Übergabe von `--yes`, welche Ihrer Verknüpfungen kaskadieren: Dies kann nicht rückgängig gemacht werden.

Der Befehl liest `REBASE_SERVICE_KEY` genauso wie `env reveal`, erfordert also die Rolle
'Owner' oder 'Admin' (oder ein entsprechendes Token mit der `env`-Berechtigung). Der
Schlüssel verbleibt im Arbeitsspeicher und wird ausschließlich an die eigene Adresse des Projekts gesendet. Bei einem Projekt mit
einer älteren Laufzeitumgebung wird gemeldet, dass eine neuere Version erforderlich ist.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Abgleich mit dem, was im Code deklariert ist.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deployment entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfernt wird – das
wären durch einen Push gelöschte Daten. Sie wird weiterhin beibehalten, gebunden und abgerechnet, bis
sie explizit namentlich bereinigt (geprunt) wird.

## Compute

Was das Projekt reserviert und was dies kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` wurde eingestellt: Jedes Backend führt mindestens eine Instanz aus, weshalb
`true` abgewiesen und `false` mit einer Warnung ignoriert wird. Es gibt keine
Tarifstufen (Plan Tiers): Alles wird pro Ressource abgerechnet. Siehe
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
akzeptiert eine kommagetrennte Liste aus `deploy.failed` (Standard),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` und `preview.paused`. `--format slack` sendet
ausschließlich `{ "text" }` anstelle des vollständigen Event-JSON, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control Plane bezeichnet. `add` gibt
das Signiergeheimnis (Signing Secret) einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` wird mit Exit-Code 1 und dem Fehlercode `delivery_failed` beendet, wenn der Empfänger
das Test-Ereignis nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle 'Owner' oder 'Admin'. Ein Token verwaltet diese mit der
Berechtigung `notifications` auf Organisationsebene unter denselben Rollenregeln. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` richtet für einen kundeneigenen
Cluster eine eigene Image-Registry ein, die ausschließlich für diesen Cluster verwendet wird. Ohne
diese nutzt ein solcher Cluster die geteilte Registry der Plattform, worauf jedes Deployment in seinem Log
hinweist. Mit einer eigenen Registry pushen Builds mit einem Token für dieses Dienstkonto in dieses Repository,
Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
Projekt-Images von dort. Images,
die das Projekt zuvor in der gemeinsam genutzten Registry erstellt hat, bleiben pullbar und stehen weiterhin als
Rollback-Ziele zur Verfügung. Die drei Werte gehören zusammen; `--clear` verwirft sie. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Rolle 'Platform-Admin'. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Abrechnungsseite (Billing) der Konsole und sind nur für Owner und Admins der Organisation
zugänglich. Ein Token kann auf diese sowie den Rest von `billing` mit der Berechtigung `billing`
auf Organisationsebene zugreifen; ein Token, das vor der Einführung dieser Berechtigung erstellt wurde, funktioniert noch
für ein Release mit einer Warnung bei jeder Antwort weiter. Beträge in `--json` sind in der kleinsten Währungseinheit (Cent) angegeben, exakt so, wie
Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und deren verbrauchsbasierte Posten wachsen bis zum Ende des Abrechnungszeitraums weiter an.

`usage` liest ab, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
(in UTC) verbraucht hat: Anfragen im Vergleich zum enthaltenen Freikontingent, 5xx-Fehler, die bisherige
Mehrnutzung (Overage) in Euro und – für den laufenden Monat – eine Hochrechnung bei aktuellem
Verlauf (eine Schätzung). Die Mehrnutzung entspricht der Berechnung des Overage-Berichts,
welche Stripe mitteilt, was abgerechnet werden soll, und auf der Rechnung des Folgemonats erscheint.
`usage org` listet alle Projekte der mit `rebase cloud use` ausgewählten Organisation sowie die
Gesamtsumme auf. Jedes Mitglied der Organisation kann diese Daten abrufen. Ein Token liest
sie mit der Berechtigung `logs` für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese Berechtigung besitzt.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats` (Einschränkungen), jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher wird mit 0 ausgelesen), `multi_pod_undercount` (Anfragen, die bedient werden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten übernommenes Projekt zählt erst ab dem Tag der Übernahme) und
`autoscale_not_charged` (Pods liefen oberhalb von `--replicas`, werden auf dieser Plattform jedoch noch nicht in Rechnung gestellt). Die Antwort eines automatisch skalierten Projekts enthält zudem `autoscale`:
`extraPodSeconds` oberhalb des Basiswerts, `amountEur` gemäß den Tarifen und `charged`.
