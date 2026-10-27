---
sourceHash: 60c333829202e6eb
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud im CLI – Auth, Projektverknüpfung, Deployments, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Im
[Rebase Cloud-Leitfaden](/docs/deployment/cloud/) erfahren Sie, was es ist und was
die Beta nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten
Befehle beziehen sich auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>`
operiert auf einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei Pipes, außer für `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

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
(`--project` oder das verknüpfte) und <span class="since-badge" data-since="0.26">Seit 0.26</span> `billing`, `audit` und
`notifications` für eine Organisation: `--org`, sonst die Organisation des Projekts,
sonst die ausgewählte. Ein Token darf ausschließlich Organisations-Capabilities halten.
`logs` deckt auch `usage` ab. Was jede davon erreicht, steht in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Wenn die Control
Plane eine Antwort an ein Token als veraltet kennzeichnet (ein Token aus der Zeit vor
`billing` beim Lesen der Abrechnung), gibt die CLI den Hinweis einmal auf stderr aus, nie im
`--json`-Wert.

In einem Terminal ohne angegebenes Passwort fragt <span class="since-badge" data-since="0.26">Seit 0.26</span> `login`, ob Sie Ihr Passwort verwenden möchten
oder einen Code, den die Control Plane Ihnen per E-Mail schickt. Ist die Zwei-Faktor-Authentifizierung aktiv, fragt es
anschließend nach Ihrem Authenticator-Code (oder einem Wiederherstellungscode). Ohne Terminal
lässt sich beides nicht eingeben: Setzen Sie `REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole
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
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

<span class="since-badge" data-since="0.26">Seit 0.26</span> `claim` gibt den Claim-Link des Projekts aus, das `init --claim` in diesem
Verzeichnis provisioniert hat, und die Zeit, die bleibt, bevor es unübernommen gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich in einem Browser. Der Link wird nur auf dem
Rechner aufbewahrt, der `init --claim` ausgeführt hat, in `~/.rebase/credentials.json`; die Control
Plane speichert einen Hash davon und kann ihn nicht erneut ausgeben. Bevor `claim` antwortet, fragt es
die Control Plane, ob das eigene Token des Projekts noch funktioniert. Eine Übernahme
widerruft dieses Token, sodass `claim` sich, sobald jemand das Projekt übernommen hat, mit
`already_claimed` verweigert, statt einen toten Link auszugeben. Es verweigert sich auch, wenn das
Zeitfenster abgelaufen ist (`claim_expired`), und in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link, solange das Projekt nicht übernommen ist.

## Deployen und Überwachen

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
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` ohne App-Namen deployt das Backend. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – das, was Git verfolgt, niemals eine `.env` –,
damit ein Plattform-Upgrade ihn neu bauen kann; `--no-source` überspringt dies
einmalig, und `cloud settings set --platform-rebuilds off` deaktiviert dies und löscht
die gespeicherte Kopie. `--allow-downgrade` deployt ein älteres Release.

Ein verfolgtes `deploy` endet mit einer Zusammenfassung: jede ausgelieferte App mit ihrer URL, die Deployment-ID, die Dauer und ob die neue Version dort antwortet. Es wartet bis zu `--live-timeout` Sekunden (Standard 60; `0` überspringt die Prüfung) darauf, dass `/health` des Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagenes Deployment endet mit einer Zeile, die die App und den Grund nennt, und beendet sich mit einem Fehlercode. Die Zusammenfassung erscheint auch bei Pipes; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein Objekt mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs` aus.

Vor dem Upload parst `deploy` das JavaScript jeder statischen App, die es ausliefert: die `.js`/`.mjs`/`.cjs`-Dateien in ihrem `output` und die Inline-`<script>`-Blöcke in ihrem HTML. Ein Syntaxfehler stoppt das Deployment mit `file:line:column` (Code `syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches Deployment endet mit dem Weg zurück, `rebase cloud rollback`. Eine allein deployte statische App lässt sich noch nicht zurückrollen; siehe [Rollback](/docs/deployment/cloud#roll-back).

`--preview` liefert den Build unter `https://<project>--<name>.rebase.website` aus und lässt die Produktion unangetastet. Die Vorschau des Backends führt ein eigenes Backend auf einer eigenen, leeren Datenbank aus, mit seinen eingebetteten statischen Apps. Eine statische App lässt sich auf Rebase Cloud noch nicht für sich allein in der Vorschau zeigen: `rebase cloud deploy <app> --preview` wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und veröffentlicht nichts. Eine Backend-Vorschau wird, solange sie besteht, als eine weitere App-Einheit in der Standardgröße abgerechnet, und das Deployment nennt, was das pro Monat ausmacht, aus dem eigenen Angebot der Control Plane (`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control Plane es nicht bepreisen kann); `rebase cloud previews delete <name>` stoppt sie. `rebase cloud previews` zeigt eine Vorschau, die die Plattform pausiert hat (ihre Datenbank ist über das Limit für Vorschauen hinausgewachsen), als `paused`, mit dem Grund (`statusMessage` unter `--json`). Eine neue Vorschau-Adresse kann mit `preview_cert_budget` abgelehnt werden, wenn das wöchentliche Budget der Plattform für Vorschau-Zertifikate aufgebraucht ist; die Meldung nennt, bis wann.
Siehe [Eine Änderung in der Vorschau ansehen](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` verfolgt einen Build, der noch läuft. `--runtime` liest stattdessen, was die App ausgibt, von jedem Pod dahinter, jede Zeile mit ihrem Pod markiert:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` akzeptiert eine Dauer (`30s`, `5m`, `1h`) oder eine RFC3339-Zeit.
- `--tail <n>` sind die Zeilen pro Pod, ab denen begonnen wird (die Control Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen, die den Text enthalten, ohne Beachtung der Groß-/Kleinschreibung; schreiben Sie `/re/flags` für einen
  regulären Ausdruck.
- `--level error|warn|info|debug` behält Zeilen mit dieser Schwere oder schlimmer. Es liest
  das strukturierte `severity`, das ein Rebase-Backend loggt, ein Level-Wort am Anfang einer
  einfachen Zeile oder eine Fehlerform wie `TypeError:`. Zeilen ohne eines davon werden weggelassen.

<span class="since-badge" data-since="0.26">Seit 0.26</span> Ein Follow fragt alle zwei Sekunden ab und gibt jede Zeile einmal aus. Er kündigt Pods
an, die starten, stoppen oder neu starten. Wenn ein Container neu startet, gibt er außerdem die letzten
Zeilen der Instanz aus, die gestorben ist, wo meist der Grund steht. Er wartet, solange kein
Pod läuft, und versucht es nach einer abgebrochenen Verbindung mit Backoff erneut und
macht dort weiter, wo er aufgehört hat. Mit `--json` gibt ein Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Log-Zeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest eine Vorschau statt der Produktion. Verwenden Sie den Namen der Vorschau
oder die Deployment-ID, die ein Vorschau-Deployment ausgegeben hat. Für sich allein
liest `--preview` die einzige Vorschau des Projekts. Eine statische Vorschau hat ein Build-Log, aber kein
Runtime-Log, weil sie keinen Server ausführt.

## Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

<span class="since-badge" data-since="0.26">Seit 0.26</span> `app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` in der App erzeugt und als
`REBASE_API_TOKEN` in `.env` geschrieben hat, anhand seines Präfixes und nie seines Werts. Die Übernahme des Projekts
übergibt diesen Schlüssel, und er läuft nicht mehr ab. `app-key rotate` erzeugt einen neuen und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits setzt, und hält ihn dort aus `--json` heraus. In
jedem anderen Verzeichnis gibt es den Schlüssel einmal aus. Im Admin-Panel der App erstellte Schlüssel
bleiben unberührt. Es läuft mit Ihrem Login: Keine Token-Capability gewährt es.

<span class="since-badge" data-since="0.26">Seit 0.26</span> `service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch auf den neuesten umgestellt wird. Den Schlüssel selbst gibt es nie
aus: Das erledigt `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
stellt einen neuen Schlüssel aus und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, und danach nicht mehr. Es wird verweigert, solange ein Deployment
läuft, und es läuft mit Ihrem Login. Die Übernahme eines Projekts rotiert auch dessen Service
Key.

Eine Backend-Vorschau startet mit den Variablen der Produktion, einschließlich der Live-Schlüssel. `env set KEY=VALUE --preview` gibt Vorschauen einen eigenen Wert, `env unset KEY --preview` lässt die Variable in ihnen weg, `env reset KEY --preview` stellt den Wert der Produktion wieder her, und `env list --preview` zeigt die Unterschiede. Die Produktion wird von keinem dieser Befehle geändert.

<span class="since-badge" data-since="0.26">Seit 0.26</span> `env set KEY --stdin` liest den Wert von der Standardeingabe statt von der
Befehlszeile, wo `ps` und Ihre Shell-Historie ihn zeigen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein abschließender Zeilenumbruch wird verworfen. Das `rebase_cloud_env_set` des MCP-Servers setzt
Werte auf diese Weise.

## Organisationen

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

<span class="since-badge" data-since="0.26">Seit 0.26</span> `members invite` öffnet eine Einladung und gibt ihren Link aus: einmal verwendbar,
7 Tage gültig, nur von einem Konto annehmbar, das diese Adresse verifiziert hat.
Niemand tritt bei, bevor er annimmt, auch wer bereits ein Rebase-Konto hat.
Die Ausgabe (und `emailDelivery` in `--json`) sagt, ob sie per E-Mail verschickt wurde; wenn
nicht, weist eine Warnung darauf hin, den Link selbst zu senden. `--role` ist `admin` oder
`member` (Standard). Niemand wird als `owner` eingeladen: Laden Sie ihn als Admin ein, und
ein Owner befördert ihn mit `members role <email> owner`, sobald er beigetreten ist.
`invites resend` gibt einen neuen Link aus, und der alte funktioniert nicht mehr.
Einladen und `invites` erfordern eine `rebase cloud login`-Sitzung; `REBASE_TOKEN` wird
abgelehnt. Einladen, Auflisten, erneutes Senden und Widerrufen erfordern die Rolle Owner oder Admin;
ein Mitglied wird darauf hingewiesen.
`members remove` fragt zuerst nach (`--yes` überspringt das); einen Owner zu entfernen oder herabzustufen
erfordert einen Owner, und der letzte Owner bleibt. `--org <id>` wählt eine andere Organisation
als die ausgewählte.

<span class="since-badge" data-since="0.26">Seit 0.26</span> `activity` ist das Audit-Log der ausgewählten Organisation, neueste zuerst: wer
deployt, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder angezeigt hat (nur dem Namen nach, nie dem Wert),
eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat, die Compute-Einstellungen eines Projekts geändert,
ein Projekt gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` akzeptiert einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set`. Eine Seite enthält bis zu 100 Einträge (`--limit`, Standard 50); die
Ausgabe nennt den `--before`-Cursor für die nächste. `--json` ist ein einzelner Wert,
`{ org, events, nextCursor }`. Es erfordert die Rolle Owner oder Admin der Organisation.
Ein Token liest es nur mit der Capability `audit` für die Organisation
(`rebase cloud tokens create --can audit`). Die Seite **Activity** der Konsole
zeigt dasselbe Log.

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein
öffentlicher Endpunkt), bis Strg+C gedrückt wird; `--reveal` zeigt das Passwort an. Nur für
Owner oder Admins.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was sein Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfällt –
das wären Daten, die durch einen Push gelöscht würden. Die Plattform behält, bindet und
berechnet sie, bis sie jemand namentlich bereinigt.

## Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` wurde eingestellt: Jedes Backend führt mindestens eine Instanz aus,
daher wird `true` abgelehnt und `false` mit einer Warnung ignoriert. Es gibt keine
Tarifstufen: Alles wird pro Ressource abgerechnet. Siehe
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

<span class="since-badge" data-since="0.26">Seit 0.26</span> `notifications add <url>` sendet die Ereignisse des verknüpften Projekts an eine URL. `--events`
akzeptiert eine kommagetrennte Liste aus `deploy.failed` (Standard),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` und `preview.paused`. `--format slack` sendet
nur `{ "text" }` statt des Ereignis-JSON, das ebenfalls ein `text` enthält. Die URL
ist ein Positionsargument, weil `--url` die Control Plane benennt. `add` gibt
das Signing Secret einmal aus; `--json` liefert `{ projectId, webhook, secret }`.
`test <id>` endet mit Exit-Code 1 und dem Code `delivery_failed`, wenn der Empfänger das
Testereignis nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle Owner oder Admin. Ein Token verwaltet sie mit der Capability
`notifications` für die Organisation, innerhalb derselben Rollenregel. Siehe
[Cloud notifications](/docs/deployment/cloud-notifications/).

<span class="since-badge" data-since="0.26">Seit 0.26</span> `clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` gibt dem Cluster eines Kunden
eine eigene Image-Registry, die nur für diesen Cluster verwendet wird. Ohne
sie nutzt ein solcher Cluster die gemeinsame Registry der Plattform, und jedes Deployment dorthin
sagt das in seinem Log. Mit ihr pushen Builds mit einem Token für
dieses Konto in dieses Repository, Pods pullen allein mit diesem Schlüssel, und ein Rollback akzeptiert die
Images des Projekts dort. Images,
die das Projekt zuvor im gemeinsamen Repository gebaut hat, bleiben pullbar und bleiben
Rollback-Ziele. Die drei Werte gehören zusammen; `--clear` vergisst sie. Der Schlüssel
wird beim Schreiben versiegelt und nie zurückgelesen. Wie der Rest von `clusters`
erfordert es die Rolle Plattform-Admin. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

<span class="since-badge" data-since="0.26">Seit 0.26</span> `billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Billing-Seite der Konsole und stehen nur den Owners und Admins der Organisation
offen. Ein Token erreicht sie, und den Rest von `billing`, mit der Capability `billing`
für die Organisation; ein vor dieser Capability erstelltes Token funktioniert
noch ein Release lang weiter, mit einer Warnung bei jeder Antwort. Beträge in `--json` sind in der kleinsten Einheit der Währung (Cent), genau wie
Stripe sie sendet. Entwurfsrechnungen werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet, und ihre gemessenen Positionen wachsen weiter, bis der Zeitraum endet.

<span class="since-badge" data-since="0.26">Seit 0.26</span> `usage` liest, was das verknüpfte Projekt (oder `--project`) in einem Kalender-
monat verbraucht hat, in UTC: Anfragen im Verhältnis zum enthaltenen Kontingent, 5xx-Fehler, die bisherige
Überschreitung in Euro und, für den laufenden Monat, wohin er sich in diesem
Tempo entwickelt (eine Schätzung). Die Überschreitung ist die eigene Berechnung des Überschreitungsberichts, derselbe,
der Stripe mitteilt, was abzurechnen ist, und landet auf der Rechnung des Folgemonats.
`usage org` listet jedes Projekt der Organisation auf, die mit `rebase cloud
use` ausgewählt wurde, und die Summe. Jedes Mitglied der Organisation kann es lesen. Ein Token liest
es mit der Capability `logs` für das Projekt; `usage org` listet die Projekte auf, für die das
Token diese hält.
`--month` akzeptiert einen vergangenen Monat. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Object Storage zeigt 0), `multi_pod_undercount` (Anfragen, die bedient wurden, während zwei oder
mehr App-Pods laufen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
von einem Agenten übernommenes Projekt zählt nur die Tage ab der Übernahme) und
`autoscale_not_charged` (Pods liefen oberhalb von `--replicas`, und diese Plattform berechnet sie noch
nicht). Die Antwort eines automatisch skalierten Projekts enthält außerdem `autoscale`:
`extraPodSeconds` oberhalb der Untergrenze, `amountEur` zu seinen Tarifen und `charged`.
