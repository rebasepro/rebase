---
sourceHash: 2455a5d25bcb60fd
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud in der CLI – Auth, Projektverknüpfung, Deployments, Benachrichtigungen, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Speicher, Cluster, Abrechnung und Nutzung.
---

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Siehe den
[Rebase Cloud Leitfaden](/docs/deployment/cloud/) für Details dazu, was es ist und was die Beta
nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch die
Standardeinstellung bei Weiterleitung über Pipes, außer bei `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in through the browser: a link and a code, approved in the console
rebase cloud login --no-browser   # print the link instead of opening it, e.g. over SSH
rebase cloud login --email me@example.com   # with your password instead
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` akzeptiert `deploy`, `logs`, `env`, `database` und `backups` für ein Projekt
(`--project` oder das verknüpfte), und `billing`, `audit` sowie
`notifications` für eine Organisation: `--org`, andernfalls die Organisation des Projekts,
andernfalls die ausgewählte. Ein Token kann auch ausschließlich Organisations-Berechtigungen (Capabilities) enthalten.
`logs` deckt auch `usage` ab. Was jede davon erreicht, ist in
[CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben. Wenn die Control
Plane eine Antwort auf ein Token als veraltet markiert (ein Token von vor `billing`,
das Abrechnungsdaten liest), gibt die CLI den Hinweis einmal auf stderr aus, niemals im
`--json`-Wert.

Ohne Flags meldet `login` Sie über den Browser an. Es gibt einen kurzen Code und
einen Link zur Konsole aus, öffnet den Browser und wartet, während Sie die
Anmeldung dort bestätigen. Sie sind entweder bereits in der Konsole angemeldet oder melden sich mit
einer beliebigen angebotenen Methode an (Passwort, Google, GitHub, LinkedIn). Überprüfen Sie, ob der
Browser denselben Code anzeigt, bevor Sie ihn bestätigen. Der Link läuft nach zehn
Minuten ab und funktioniert nur einmal. Ohne Terminal oder mit `--json` werden Link und Code
an stderr ausgegeben und `login` wartet weiter, sodass ein Agent Ihnen den Link übergeben kann. Eine
abgelehnte Anmeldung wird mit `access_denied` beendet, eine abgelaufene mit `expired_token`.

Mit `--email` fragt `login`, ob Sie Ihr Passwort oder einen Code verwenden möchten, den die Control
Plane Ihnen per E-Mail sendet. Wenn die Zwei-Faktor-Authentifizierung aktiviert ist, wird anschließend nach Ihrem
Authenticator-Code (oder einem Wiederherstellungscode) gefragt; bestätigen Sie im Browser über eine
Konsolensitzung, die diesen verwendet hat. Ohne Terminal kann keiner der Codes eingegeben werden: Setzen Sie
`REBASE_TOKEN` auf ein Zugriffstoken, das in der Konsole unter Settings → Access
tokens erstellt wurde. Siehe [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Projektverknüpfung

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Die Organisationsbefehle (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) wirken auf `--org <id>`, andernfalls auf die
von `cloud use` ausgewählte Organisation, andernfalls auf die Organisation des verknüpften Projekts. In
letzterem Fall geben sie an, welche verwendet wurde. `orgs delete` übernimmt dies niemals aus
der Verknüpfung: es erfordert `--org` oder eine ausgewählte Organisation.

### Eine selbst gehostete Instanz mit Claude verbinden

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Der [Rebase-Connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
erreicht sie dann neben Ihren Cloud-Projekten. `connect` gibt
`REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` aus; setzen Sie diese auf
dem Server und starten Sie ihn neu. Im Projektordner wird angeboten, sie in die
`.env` zu schreiben. Ein erneutes Ausführen ist sicher. `--name` benennt die Instanz, `--org` wählt die
Organisation aus, `--no-wait` kehrt ohne Wartezeit zurück. Eigentümer und Admins.

## Projekte

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects transfer [id] --to-org <id|slug>
rebase cloud projects delete [id]
```

`claim` gibt den Claim-Link des Projekts aus, das `init --claim` in diesem
Verzeichnis bereitgestellt hat, sowie die verbleibende Zeit, bis es unbeansprucht gelöscht wird (`Unclaimed: deleted
in 41h`). `--open` öffnet ihn zusätzlich im Browser. Der Link wird nur auf dem
Rechner gespeichert, auf dem `init --claim` ausgeführt wurde, und zwar in `~/.rebase/credentials.json`; die Control
Plane speichert einen Hash davon und kann ihn nicht erneut ausgeben. Vor der Ausgabe
prüft `claim` bei der Control Plane, ob das eigene Token des Projekts noch gültig ist. Ein Claim
widerruft dieses Token; sobald also jemand das Projekt beansprucht hat, bricht `claim`
mit `already_claimed` ab, anstatt einen toten Link auszugeben. Es bricht ebenfalls ab, sobald das
Zeitfenster abgelaufen ist (`claim_expired`), sowie in einem Verzeichnis ohne Claim-Link
(`no_claim_link`). `rebase cloud status` und `rebase cloud whoami` zeigen denselben
Link an, solange das Projekt nicht beansprucht wurde.

`projects transfer` verschiebt ein Projekt unverändert in eine andere Organisation: dieselbe
ID, Adresse, Custom Domains, Datenbank, Speicher, Umgebungsvariablen und
Deployments. Nur wer Eigentümer ist, wer es sehen kann und wer dafür bezahlt, ändert sich. Sie
müssen Eigentümer oder Admin beider Organisationen und über `rebase cloud login` angemeldet sein;
ein Zugriffstoken kann ein Projekt nicht verschieben. Der Zielorganisation wird es ab dann in Rechnung gestellt;
eine Organisation ohne hinterlegte Kreditkarte (und ohne interne Abrechnung) lehnt den Transfer ab und
nichts ändert sich. Ein Projekt, das noch darauf wartet, beansprucht zu werden, wird stattdessen über seinen Claim-Link
verschoben. Die Konsole bietet dieselbe Aktion unter den Einstellungen des Projekts in der
Danger Zone.

## Bereitstellen und beobachten

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
lädt auch den Quellcode des Projekts hoch – was Git trackt, niemals eine `.env` –, damit ein
Plattform-Upgrade es neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` deaktiviert es und löscht die gespeicherte Kopie. `--allow-downgrade` stellt ein älteres Release bereit.

Ein Plattform-Upgrade kann eine verwaltete App auf einem neueren `@rebasepro`-Release
neu bauen, als Ihr Checkout festlegt. Ein Deploy aus diesem Checkout würde das ältere Admin-Panel
und den Treiber wieder zurücksetzen, weshalb er verweigert wird, bevor überhaupt etwas gebaut wird, zusammen mit dem
Befehl zur Behebung (`rebase upgrade --to <version>`). `rebase cloud status`
zeigt dies bereits früher an: eine `Rebuilt on`-Zeile und unter `--json`
`runtime.platformRebuiltVersion` sowie `frameworkDrift`.

Ein verfolgter `deploy` endet mit einer Zusammenfassung: jede bereitgestellte App mit ihrer URL, der
Deployment-ID, der Dauer und der Information, ob die neue Version dort antwortet. Er
wartet bis zu `--live-timeout` Sekunden (Standard 60; `0` überspringt die Prüfung), bis `/health`
eines Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagener Deploy
endet mit einer Zeile, die die App und den Grund nennt, und wird mit einem Exit-Code ungleich null beendet. Die Zusammenfassung
wird auch bei Pipes ausgegeben; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein Objekt aus,
mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs`. Ein Host, dessen HTTPS-Zertifikat
noch nicht ausgestellt ist, wird mit dieser Begründung als nicht live gemeldet.

Vor dem Hochladen parst `deploy` das JavaScript jeder statischen App, die es ausliefert:
die `.js`- / `.mjs`- / `.cjs`-Dateien in deren `output` und die Inline-`<script>`-Blöcke in
deren HTML. Ein Syntaxfehler stoppt das Deployment mit `file:line:column` (Code
`syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreicher
Deploy endet mit dem Weg zurück: `rebase cloud rollback`. Eine statische App, die separat
bereitgestellt wurde, kann derzeit noch nicht zurückgerollt werden; siehe
[Rollback](/docs/deployment/cloud#roll-back).

`--preview` stellt den Build unter `https://<project>--<name>.rebase.website` bereit und
lässt die Produktion unberührt. Ein Preview des Backends führt ein eigenes Backend auf einer
eigenen leeren Datenbank aus, wobei seine statischen Apps integriert sind. Eine statische App kann auf
Rebase Cloud derzeit noch nicht separat in der Preview angezeigt werden: `rebase cloud deploy <app> --preview`
wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und veröffentlicht nichts. Ein Backend-Preview
wird für die Dauer seiner Existenz als eine weitere App-Einheit in Standardgröße abgerechnet, und
das Deployment gibt an, wie viel das pro Monat ausmacht, basierend auf dem Kostenvoranschlag der Control Plane
(`cost` unter `--json`; nur die Regel und dieser Link, wenn die Control Plane den Preis nicht
berechnen kann); `rebase cloud previews delete <name>` stoppt es. `rebase cloud previews`
zeigt ein von der Plattform pausiertes Preview (dessen Datenbank das Preview-Limit überschritten hat) als
`paused` an, zusammen mit dem Grund (`statusMessage` unter `--json`). Eine neue Preview-Adresse
kann mit `preview_cert_budget` abgelehnt werden, wenn das wöchentliche Budget der Plattform für
Preview-Zertifikate aufgebraucht ist; die Meldung gibt an, bis wann.
Siehe [Preview einer Änderung](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` gibt das neueste Build-Log aus, und `-f` verfolgt einen Build, der
noch läuft. `--runtime` liest stattdessen aus, was die App ausgibt, und zwar von jedem Pod
dahinter, wobei jede Zeile ihren Pod nennt, wenn mehr als einer geschrieben hat:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
rebase cloud logs --runtime --raw
```

- `--since` akzeptiert eine Zeitdauer (`30s`, `5m`, `1h`) oder eine RFC3339-Zeitangabe.
- `--tail <n>` ist die Anzahl der Zeilen pro Pod, ab der begonnen werden soll (die Control Plane begrenzt dies auf 2000).
- `--grep` behält Zeilen bei, die den Text enthalten (unabhängig von Groß-/Kleinschreibung); schreiben Sie `/re/flags` für einen
  regulären Ausdruck.
- Mit `--grep` oder `--level` durchsucht der Filter jede Zeile, die die Control Plane
  für das Zeitfenster zurückgibt (die jeweils neuesten 2000 jedes Pods), und `--tail` zählt übereinstimmende
  Zeilen: die neuesten `n` Treffer pro Pod, standardmäßig 500. Wenn ein Pod mehr
  Zeilen im Fenster hatte, gibt die Ausgabe an, dass die älteren nicht
  durchsucht wurden (`filter.scanCapped` unter `--json`).
- `--level error|warn|info|debug` behält Zeilen mit diesem oder einem schwerwiegenderen Schweregrad bei. Es liest
  die strukturierte `severity`, die ein Rebase-Backend protokolliert, ein Level-Wort am Anfang einer
  Klartextzeile oder ein Fehlermuster wie `TypeError:`. Zeilen ohne solche Angaben werden ausgelassen.
- Eine strukturierte Zeile wird lesbar ausgegeben: `14:30:32.126 WARN  [boot] Driver version skew …  fix="bump …"`, eine Anfrage als `GET /api/data/rooms/RCTF 404 16ms  requestId=…`. `--raw` gibt stattdessen jede Zeile so aus, wie der Pod sie geschrieben hat; Klartextzeilen bleiben in beiden Fällen unverändert, und `--json` enthält immer die Originalzeilen.

Ein Follow fragt alle zwei Sekunden ab und gibt jede Zeile einmal aus. Es kündigt Pods an,
die starten, stoppen oder neu starten. Wenn ein Container neu startet, werden auch die letzten
Zeilen der beendeten Instanz ausgegeben, in denen sich normalerweise der Grund befindet. Es wartet, solange kein
Pod läuft, und versucht nach einem Verbindungsabbruch mit Backoff erneut eine Verbindung aufzubauen und
setzt dort fort, wo es aufgehört hat. Mit `--json` gibt ein Follow ein JSON-Objekt pro
Zeile aus (NDJSON): `{"type":"line","ts","pod","text"}` für jede Logzeile und
`{"type":"event","event":…}` für den Rest.

`--preview <name>` liest ein Preview anstelle der Produktion. Verwenden Sie den Namen des
Previews oder die Deployment-ID, die ein Preview-Deploy ausgegeben hat. Ohne Angabe liest `--preview`
das einzige Preview des Projekts. Ein statisches Preview verfügt über ein Build-Log, aber über kein
Runtime-Log, da es keinen Server ausführt.

## Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` für einen Host, den das Projekt bereits besitzt (wie etwa einen, den ein Deploy
aus `rebase.json` registriert hat), gibt die DNS-Einträge und den Status dieses Hosts genauso aus wie ein
neu hinzugefügter Host; `--json` fügt `alreadyRegistered: true` hinzu. Ein verifizierter Host wird
über HTTPS bereitgestellt, sobald sein Zertifikat ausgestellt ist, einige Minuten nach der
Verifizierung. Bis dahin antwortet der Ingress mit einem Platzhalterzertifikat,
und `domains list`, `domains verify` sowie `status` melden
`verified, certificate pending` statt live. Die CLI ermittelt dies über
einen TLS-Handshake zu jedem verifizierten Host; `--json` liefert dies als `certificate`
(`ready`, `pending` oder `unreachable`, mit einer `reason`).

`app-key` listet den
Schlüssel auf, den `rebase cloud init --claim` auf der App generiert und in die `.env` als
`REBASE_API_TOKEN` geschrieben hat – anhand seines Präfixes und niemals seines Werts. Das Beanspruchen (Claiming) des Projekts
übergibt diesen Schlüssel, wodurch er nicht mehr abläuft. `app-key rotate` erzeugt einen neuen und
widerruft alle früheren Agent-Schlüssel auf einmal. Es schreibt den neuen Schlüssel in eine `.env`,
die `REBASE_API_TOKEN` bereits setzt, und schließt ihn dort aus `--json` aus. In
jedem anderen Verzeichnis wird der Schlüssel einmalig ausgegeben. Schlüssel, die im Admin-Panel der App
erstellt wurden, bleiben unberührt. Der Befehl wird mit Ihrem Login ausgeführt: Keine Token-Berechtigung (Capability) gewährt ihn.

`service-key`
gibt die Generation des `REBASE_SERVICE_KEY` des Projekts aus, wann er zuletzt
rotiert wurde und ob die App noch neu startet, um den neuesten zu übernehmen. Der Schlüssel selbst
wird niemals ausgegeben: dafür gibt es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
erstellt einen neuen Schlüssel und startet die App damit neu. Der alte Schlüssel funktioniert, bis der
Neustart abgeschlossen ist, danach nicht mehr. Dies wird verweigert, während ein Deploy
läuft, und erfordert Ihren Login. Das Beanspruchen eines Projekts rotiert auch dessen Service-Key.

Ein Backend-Preview verfügt über einen eigenen Service-Key. Dessen erster Deploy erstellt ihn,
erneute Deploys behalten ihn bei, und der Schlüssel der Produktion antwortet auf dem Preview mit 401.
`service-key --preview <name>` gibt ihn aus, ebenso wie `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
erstellt einen neuen und startet nur den Pod dieses Previews neu; der alte Schlüssel funktioniert, bis
der neue Pod bereit ist. Es wird vorher nachgefragt, und `--yes` überspringt die Abfrage. Beide erfordern
dieselbe Berechtigung wie `env reveal`: die Eigentümer- oder Admin-Rolle der Organisation und bei einem
Zugriffstoken die `env`-Capability auf einem beanspruchten Projekt. Der Schlüssel und der Pod der
Produktion bleiben unberührt.

Ein Backend-Preview startet mit den Variablen der Produktion, einschließlich Live-Schlüsseln.
`env set KEY=VALUE --preview` gibt Previews einen eigenen Wert, `env unset KEY
--preview` schließt die Variable davon aus, `env reset KEY --preview` setzt
auf den Wert der Produktion zurück, und `env list --preview` zeigt die Unterschiede.
Die Produktion wird durch keinen dieser Befehle verändert.

`env set KEY --stdin` liest den Wert von der Standardeingabe anstelle der
Befehlszeile, wo `ps` und Ihre Shell-History ihn anzeigen würden:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Ein nachgestellter Zeilenumbruch wird entfernt. Das Tool `rebase_cloud_env_set` des MCP-Servers setzt
Werte auf diese Weise.

`env set KEY --prompt` fragt den Wert an einer verdeckten Eingabeaufforderung in Ihrem Terminal ab.
Es wird nichts ausgegeben, und der Wert wird wie bei `--stdin --secret` als Secret
gespeichert. Ein Agent kann Ihnen den auszuführenden Befehl geben, sodass der Wert niemals
über den Chat übertragen wird. Ohne Terminal bricht der Befehl ab (`input_required`) und verweist
auf `--stdin`.

## Organisationen

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` fügt jemanden hinzu, der bereits ein Rebase-Konto mit einer
verifizierten E-Mail-Adresse besitzt, genau wie „Add member“ in der Konsole. Die Person hat sofort
Zugriff und es wird keine E-Mail versendet. Rebase Cloud verschickt derzeit noch keine Einladungen; eine
Person ohne Konto erhält daher keinen Link: Der Befehl bricht mit `no_account` ab und
fordert Sie auf, die Person sich zuerst registrieren zu lassen und den Befehl dann erneut auszuführen. Eine Control Plane,
die Einladungen unterstützt, erstellt stattdessen eine und gibt ihren Link aus (einmalig verwendbar, 7 Tage
gültig, wird nur von einem Konto akzeptiert, das diese Adresse verifiziert hat); `invites`
listet diese auf, widerruft sie und sendet sie erneut, und antwortet andernorts mit `not_served`.
`--role` ist `admin` oder `member` (Standard). Niemand wird als `owner` hinzugefügt: Fügen Sie sie
als Admin hinzu, und ein Eigentümer befördert sie mit `members role <email> owner`.
Das Hinzufügen von Mitgliedern und `invites` erfordert eine `rebase cloud login`-Sitzung;
`REBASE_TOKEN` wird abgelehnt. Beides erfordert die Rolle Eigentümer oder Admin; ein einfaches Mitglied erhält einen
entsprechenden Hinweis.
`members remove` fragt vorher nach (`--yes` überspringt dies); das Entfernen oder Herabstufen eines Eigentümers
erfordert einen Eigentümer, und der letzte Eigentümer bleibt bestehen. `--org <id>` wählt eine andere Organisation
als die derzeit ausgewählte.

### Projektzugriff

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` verwaltet, wer Zugriff auf ein Projekt hat – das verknüpfte oder `--project`. Die
Eigentümer und Admins einer Organisation sind `admin` für jedes Projekt, das sie besitzt, und ihre
Mitglieder sind `developer`; `access` weist jemandem eine Rolle ausschließlich für dieses Projekt zu,
unabhängig davon, ob die Person der Organisation angehört. Die effektive Rolle ist die
höhere der beiden, und `access` listet sie zusammen mit ihrer Herkunft auf. `admin` umfasst
alles, einschließlich Zugriff und Einstellungen; `developer` führt Deployments durch und nutzt Studio,
Logs sowie Umgebungsvariablen; `viewer` hat Lesezugriff.

`invite` erstellt eine Einladung für das Projekt (`--role` ist standardmäßig `developer`)
und gibt ihren Link aus: einmalig verwendbar, 7 Tage gültig, wird nur von einem Konto akzeptiert,
das diese Adresse verifiziert hat. `role` und `remove` ändern oder entfernen die
projekteigene Rolle und fragen vorher nach (`--yes` überspringt dies); jemand, der über die
Organisation Zugriff auf das Projekt hat, wird mit `orgs members remove` entfernt.
Der Verlust von `admin` bei einem Projekt entzieht dieser Person auch die `admin`-Rolle, die
**Open admin panel** innerhalb der App vergeben hat, und beendet deren dortige Sitzungen. Jede
Änderung erfordert eine `rebase cloud login`-Sitzung und `admin` auf dem Projekt; eine
Control Plane ohne Projektzugriff antwortet mit `not_served`.

`activity` ist das Audit-Log der ausgewählten Organisation, neueste Einträge zuerst: wer
ein Deployment durchgeführt, zurückgerollt, eine Umgebungsvariable gesetzt, gelöscht oder aufgedeckt hat (nach
Name, niemals nach Wert), eine Domain geändert, ein Backup erstellt, wiederhergestellt oder heruntergeladen hat,
Compute eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines
Mitglieds geändert oder ein Zugriffstoken erstellt oder widerrufen hat. `--action` nimmt einen Bereich
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oder eine vollständige Aktion
wie `env.set` an. Eine Seite fasst bis zu 100 Einträge (`--limit`, Standard 50); die
Ausgabe druckt den `--before`-Cursor für die nächste Seite. `--json` ist ein einzelner Wert,
`{ org, events, nextCursor }`. Es erfordert die Eigentümer- oder Admin-Rolle der Organisation.
Ein Token liest dies nur mit der `audit`-Capability auf der Organisation
(`rebase cloud tokens create --can audit`). Die **Activity**-Seite der Konsole
zeigt dasselbe Log an.

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` blendet das Passwort ein. Nur Eigentümer oder Admin.

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

`prune` nimmt eine Zeitspanne mit Einheit entgegen: `45m`, `12h`, `30d` oder `2w`. Ohne `--yes`
zählt es nur und löscht nichts. Es arbeitet sich in kleinen Batches durch Projekte beliebiger Größe.

Nur Gäste können entfernt werden. Ein Gast ist eine Zeile mit gesetztem `is_anonymous`, ohne Passwort und ohne
verknüpfte Identität. Die App wendet diese Regel in dem Statement an, das die Zeile löscht,
sodass der Befehl niemals einen regulären Account erfassen kann – selbst wenn dieser sich kurz
nach der Auflistung registriert hat. `delete` verweigert einen Account mit `NOT_ANONYMOUS`.

**Zuletzt gesehen** (Last seen) ist der Zeitpunkt, an dem die Sitzung des Gastes zuletzt ausgestellt oder aktualisiert wurde, oder wann
der Gast erstellt wurde, falls kein Refresh-Token mehr vorhanden ist. Ein Gast, der immer wieder
zurückkehrt, gilt nicht als alt, egal wie lange die Erstellung her ist. Die Refresh-Tokens
eines gelöschten Gastes und alle anderen Authentifizierungszeilen werden mit ihm entfernt.

Zeilen in Ihren eigenen Tabellen folgen ihrem Fremdschlüssel:

| Spalte | Was mit der Zeile passiert |
|---|---|
| Optionale Verknüpfung (`ON DELETE SET NULL`, Standard) | Bleibt erhalten, wobei die Verknüpfung geleert wird |
| Erforderliche Verknüpfung (`ON DELETE RESTRICT`, Standard) | Bleibt erhalten, und der Gast mit ihr: Der Gast wird als übersprungen gemeldet, mit `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Wird zusammen mit dem Gast gelöscht |
| Kein Fremdschlüssel (ein `userSelect`-Feld, eine reine ID) | Bleibt erhalten und enthält eine ID, die nicht mehr existiert |

Prüfen Sie vor der Übergabe von `--yes`, welche Ihrer Verknüpfungen kaskadieren: Dies kann nicht rückgängig gemacht werden.

Der Befehl läuft über den Studio-Proxy der Konsole, der den Schlüssel der App hält, sodass der Schlüssel niemals Ihren
Rechner erreicht. Er erfordert einen Eigentümer oder Admin der Organisation bei einem Projekt, dessen Studio-Zugriff aktiviert ist
(`rebase cloud settings set --studio on`). Ein Projekt mit einer älteren Runtime wird darauf hingewiesen, dass es eine neuere benötigt.
`rebase users guests --project <slug>` ist derselbe Befehl in der Projekt-Familie.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was dessen Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfernt wird – das
wären Daten, die durch einen Push gelöscht würden. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich bereinigt (`prune`).

## Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` wurde eingestellt: Jedes Backend führt mindestens eine Instanz aus, daher wird
`true` abgelehnt und `false` mit einer Warnung ignoriert. Es gibt keine Tarifstufen
(Plan Tiers): Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Speicher, Benachrichtigungen, Cluster, Abrechnung und Nutzung

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry | open | close   # the clusters tenants run on; `add` registers one from a kubeconfig
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
ausschließlich `{ "text" }` anstelle des Event-JSONs, welches ebenfalls ein `text`-Feld enthält. Die URL
ist ein Positionsargument, da `--url` die Control Plane benennt. `add` gibt
das Signiergeheimnis (Signing Secret) einmalig aus; `--json` gibt `{ projectId, webhook, secret }` zurück.
`test <id>` beendet mit Exit-Code 1 und dem Code `delivery_failed`, wenn der Empfänger das
Test-Event nicht akzeptiert hat. Das Auflisten steht jedem Mitglied der Organisation offen; `add`, `test`
und `remove` erfordern die Rolle Eigentümer oder Admin. Ein Token verwaltet diese mit der
`notifications`-Capability auf der Organisation unter denselben Rollenregeln. Siehe
[Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` weist dem eigenen
Cluster eines Kunden eine eigene Image-Registry zu, die ausschließlich für diesen Cluster verwendet wird. Ohne
eine solche Registry nutzt ein solcher Cluster die geteilte Registry der Plattform, und jedes Deployment dorthin
weist im Log darauf hin. Mit einer Registry pushen Builds mit einem Token für
dieses Dienstkonto in dieses Repository, Pods pullen ausschließlich mit diesem Schlüssel, und ein Rollback akzeptiert die
dortigen Images des Projekts. Images,
die das Projekt zuvor im gemeinsam genutzten Repository gebaut hat, bleiben pullbar und bleiben
Rollback-Ziele. Die drei Werte gehören zusammen; `--clear` verwirft sie. Der Schlüssel
wird beim Schreiben versiegelt und nie wieder ausgelesen. Wie der Rest von `clusters`
erfordert dies die Rolle platform-admin. Der Betreiber erstellt das Repository und beide
Konten mit Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registriert Kapazität, die von Rebase betrieben wird: Projekte,
die in dieser Region platziert sind, deployen dorthin, sobald deren Baseline bereit ist. Dies bietet
die Region Kunden nicht an. `--open-to-customers` tut dies direkt bei der Registrierung, oder später über
`clusters open <id-or-name>`; `clusters close <id-or-name>` beendet das Angebot.
Betreiber können auf einem geschlossenen Cluster deployen. Lassen Sie einen Cluster geschlossen, solange dessen
Basis-Domain mit einem anderen Cluster geteilt wird: Bis der Wildcard-Eintrag umgezogen wird, lösen dessen
Hostnamen nur über explizite Einträge auf (`ingress.<baseDomain>`,
`s3.<baseDomain>` und einer pro Projekt), und `clusters add` gibt aus, welche Einträge
hinzuzufügen sind. Wenn die Domain geteilt wird, warnt `open`, dass der Wildcard-Eintrag
bereits auf den Cluster zeigen muss. Es erfolgt keine interaktive Rückfrage, sodass der Befehl in Skripten funktioniert.

`billing invoices` und `billing upcoming` lesen dieselben Stripe-Daten wie die
Billing-Seite der Konsole und sind ausschließlich den Eigentümern und Admins der Organisation
zugänglich. Ein Token erreicht diese sowie den Rest von `billing` mit der `billing`-Capability
auf der Organisation; ein Token, das vor dieser Capability erstellt wurde, funktioniert noch
für ein Release weiter, mit einer Warnung bei jeder Antwort. Beträge in `--json` sind in der kleinsten Währungseinheit (Cents) angegeben, genau wie
Stripe sie übermittelt. Rechnungsentwürfe werden nicht aufgelistet; die Vorschau wird von
Stripe berechnet und ihre nutzungsbasierten Posten wachsen weiter, bis der Abrechnungszeitraum endet.

`usage` liest aus, was das verknüpfte Projekt (oder `--project`) in einem Kalendermonat
verbraucht hat (in UTC): Anfragen im Vergleich zum enthaltenen Freikontingent, 5xx-Fehler, die bisherige
Mehrnutzung in Euro und – für den laufenden Monat – die Hochrechnung bei aktuellem
Tempo (eine Schätzung). Die Mehrnutzung entspricht der Berechnung des Overage-Reports selbst – jener,
die Stripe mitteilt, was abzurechnen ist, und auf der Rechnung des Folgemonats landet.
`usage org` listet jedes Projekt der mit `rebase cloud use` ausgewählten Organisation
sowie die Gesamtsumme auf. Jedes Mitglied der Organisation kann dies einsehen. Ein Token liest
dies mit der `logs`-Capability auf dem Projekt; `usage org` listet die Projekte auf, für die
das Token diese Berechtigung besitzt.
`--month` nimmt einen vergangenen Monat entgegen. Die Antwort enthält `caveats`, jeweils mit einem `code`: `storage_not_measured`
(Objektspeicher zeigt 0 an), `multi_pod_undercount` (Anfragen, die bedient wurden, während zwei oder
mehr App-Pods liefen, werden nicht gezählt), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (ein
über einen Agenten beanspruchtes Projekt zählt erst ab dem Tag des Claims) und
`autoscale_not_charged` (Pods liefen über `--replicas` und diese Plattform stellt sie
noch nicht in Rechnung). Die Antwort eines automatisch skalierten Projekts enthält außerdem `autoscale`:
`extraPodSeconds` über dem Mindestwert, `amountEur` zu den jeweiligen Tarifen und `charged`.

## Deploy-Hooks, Alerts und der Rest

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms|requests_<surface>|errors_<surface>] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` gilt pro Domain und ist standardmäßig deaktiviert, sodass ein Projekt, das neben seiner Website einen `api.`-Host betreibt, beide behält; es wird wirksam, solange die Domain verifiziert und eine andere als primär festgelegt ist, und gilt niemals für eine Domain, auf der eine App ausgeliefert wird. `deploy-hooks create` gibt die URL des Hooks einmalig aus. `deploy --git` kann nicht mit den Flags eines lokalen Builds kombiniert werden und erfordert auf der verwalteten Runtime `--eject`, da die Control Plane aus dem Quellcode baut. `settings set --studio` ist der Schalter, den die Projektbefehle (`rebase data`, `rebase users`, …) für `--project` aktiviert benötigen: Sie erreichen die App über den Studio-Proxy der Konsole. Ein Befehl, dessen Control-Plane-Route noch nicht bereitgestellt ist, antwortet mit `not_served` und nennt diese. Destruktive Befehle fragen vorher nach und brechen mit `confirmation_required` ab, wenn niemand antworten kann: übergeben Sie `--yes`.
