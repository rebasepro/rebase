---
sourceHash: b4a48b328135ef8c
title: CI, Agenten und beanspruchbare Backends
sidebar_label: CI und Agenten
description: Bereitstellung auf Rebase Cloud über CI oder einen Agenten mit einem bereichsbezogenen Token statt eines Passworts, und lassen Sie einen Agenten ein Live-Backend ohne Konto bereitstellen, das später von einer Person beansprucht werden kann.
---

Ein [Rebase Cloud](/docs/deployment/cloud/)-Projekt benötigt keine Person am
Terminal, um bereitgestellt zu werden. Ein CI-Job oder ein Agent agiert mit einem
Token, das auf wenige Aktionen für ein einzelnes Projekt beschränkt ist, und ein
Agent kann ein Projekt erstellen, bevor irgendjemand ein Konto besitzt, und dann
einen Link übergeben, um es zu beanspruchen.


## CI und Agenten

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Geben Sie ihm
stattdessen ein Token: einen Schlüssel, der als Ihr Konto fungiert und auf wenige
Aktionen für ein Projekt beschränkt ist. Erstellen Sie ihn über ein angemeldetes
Terminal:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Das Token wird einmalig als eine `export REBASE_TOKEN=rk_live_…`-Zeile ausgegeben.
Wenn `REBASE_TOKEN` gesetzt ist, authentifiziert sich jeder `rebase cloud`-Befehl
damit anstelle Ihres Logins und liest oder schreibt niemals die gespeicherte
Sitzung. Speichern Sie es in GitHub Actions als Repository-Secret und stellen Sie
es unter diesem Namen bereit:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` akzeptiert eine oder mehrere Berechtigungen, kommagetrennt oder wiederholt:

| Berechtigung | Was das Token tun darf |
|---|---|
| `deploy` | Das Projekt bereitstellen und dessen Builds verfolgen: `deploy` (`--preview` inbegriffen), `deployments`, `previews` |
| `logs` | Build- und Laufzeit-Logs, Cron-Historie, Live-Metriken und Auslastung lesen: `logs`, `cron`, `metrics`, `usage` |
| `env` | Umgebungsvariablen lesen und ändern, Secrets inbegriffen, sowie die eigenen Variablen von Previews (`--preview`) |
| `database` | `db list`, `db info` und `db connect`, was das Datenbankpasswort beinhaltet |
| `backups` | Backups auflisten, erstellen, inspizieren und herunterladen sowie das Point-in-Time-Fenster einsehen |

Drei weitere Berechtigungen beziehen sich auf eine Organisation statt auf ein
Projekt. Ein Token besitzt eine solche nur, wenn `--can` sie explizit nennt, und
zwar für die Organisation, die über `--org` angegeben ist (oder ohne `--org` die
Organisation des Projekts, gefolgt von der mit `rebase cloud use` ausgewählten).
Ein Token kann diese Berechtigungen besitzen, ohne Projektberechtigungen zu haben:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Berechtigung | Was das Token tun darf |
|---|---|
| `billing` | Die hinterlegte Karte, Rechnungen und die nächste Rechnung einsehen sowie die Rechnungs-E-Mail-Adresse ändern: `billing`, `billing invoices`, `billing upcoming`. Nur für Eigentümer und Administratoren |
| `audit` | Das Aktivitätsprotokoll der Organisation lesen: `activity`. Nur für Eigentümer und Administratoren |
| `notifications` | Die eigenen E-Mail-Einstellungen des Eigentümers sowie die Benachrichtigungs-Webhooks der Projekte der Organisation ändern: `notifications`. Das Hinzufügen, Ändern und Entfernen eines Webhooks erfordert weiterhin die Eigentümer- oder Administratorrolle |

Ein Token, das vor der Einführung von `billing` erstellt wurde, kann die
Abrechnungsinformationen noch für ein Release lang abrufen. Jede dieser Antworten
enthält einen `Deprecation: true`-Header und einen Hinweis auf den Scope, der dem
Token fehlt, und die CLI gibt diesen einmalig auf stderr als Warnung aus. Ersetzen
Sie ein solches Token vor dem nächsten Release durch ein mit `--can billing`
erstelltes Token, ab dem Anfragen für die Abrechnung abgelehnt werden.

Unter der Haube ist ein Token ein [persönlicher API-Schlüssel](/docs/backend/api-keys/#personal-keys)
auf der Control Plane. Jede Capability entspricht einigen
[Scopes](/docs/backend/roles-and-scopes/): `deploy` auf `shop` umfasst
`project:deploy:<id>` mit der ID des Projekts sowie die Daten- und Funktions-Scopes,
die von den Deploy-Befehlen aufgerufen werden. Eine Organisations-Capability umfasst
`org:billing:<id>`, `org:audit:<id>` oder `org:notifications:<id>` mit der ID der
Organisation. Das Token hat zu keinem Zeitpunkt mehr Berechtigungen als Ihr Konto zum
Verwendungszeitpunkt; es verliert also alles, was auch Ihr Konto verliert.

Zwei Dinge bleiben einer angemeldeten Person vorbehalten:

- **Token verwalten.** `rebase cloud tokens list`, `create` und `revoke <id>`
  erfordern Ihre `rebase cloud login`-Sitzung. Ein Token kann keine Token auflisten,
  erstellen oder widerrufen, da ein Token, das Token erzeugen könnte, seinen eigenen
  Nachfolger erzeugen könnte.
- **Wiederherstellen.** Keine Capability berechtigt zur Wiederherstellung von
  Backups oder zu einem Point-in-Time-`restore` und -`cutover`. Das Überschreiben
  einer Live-Datenbank mit alten Daten bleibt einem angemeldeten Eigentümer oder
  Administrator vorbehalten.

`rebase cloud whoami` mit gesetztem Token zeigt an, was es tun darf und für welches
Projekt bzw. welche Organisation. Die Seite **Access tokens** in der Konsole bietet
dieselben Berechtigungen, die organisatorischen unter **Organization access**.
`rebase cloud tokens revoke <id> --yes` widerruft es mit sofortiger Wirkung.

## Ein Backend ohne Konto

Ein Agent, der eine Anwendung erstellt hat, kann ihr ein Live-Backend bereitstellen,
noch bevor sich irgendjemand registriert hat, und der Person, für die er arbeitet,
einen Link übergeben, um es zu behalten:

```bash
rebase cloud init --claim
```

Dadurch wird ein Projekt auf Rebase Cloud bereitgestellt, `REBASE_BASE_URL` in der
`.env` auf dessen Live-Adresse gesetzt, das Verzeichnis verknüpft und die lokalen
Tabellen mit `rebase cloud deploy --bundle` bereitgestellt. Der Befehl gibt die
Live-URL, die Admin-Panel-URL und eine **Claim-URL** aus. Wer auch immer die
Claim-URL öffnet und sich anmeldet, kann das Projekt in eine seiner Organisationen
übertragen. Der Link funktioniert nur einmal. Ein Projekt, das innerhalb von
72 Stunden von niemandem beansprucht wird, wird gelöscht, inklusive Datenbank.
`rebase cloud claim` gibt die Claim-URL mitsamt der verbleibenden Zeit erneut aus,
und `--open` öffnet sie. Das Tool `rebase_cloud_provision` des MCP-Servers führt
denselben Befehl aus und gibt dieselben URLs zurück; die anderen Cloud-Tools des
MCP-Servers können das Projekt anschließend ohne Login überprüfen, bereitstellen,
Logs lesen, Variablen setzen und zurückrollen (siehe [MCP-Server](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` in der `.env` ist auch der Ort, an den `rebase api-keys`,
`rebase storage` und `rebase auth reset-password` den lokalen Service-Key senden,
sodass sie nach `init --claim` an das Cloud-Projekt gesendet werden, welches diesen
Schlüssel nicht akzeptiert. Die Befehle weisen darauf hin, wenn dies der Fall ist;
setzen Sie `REBASE_BASE_URL` in der Shell, um stattdessen ein lokales Backend zu
erreichen.

Bis das Projekt beansprucht wird, gehört es zu keinem Konto. Sein Token ist auf
dieses eine Projekt beschränkt: Es kann bereitstellen, Logs und Metriken lesen,
Umgebungsvariablen setzen und `db info` ausführen. Es liest keine geheimen Werte
zurück: weder den Wert einer Variable (einschließlich des Service-Keys) noch das
Datenbankpasswort, und es kann weder `db connect` noch ein Preview öffnen. Es wird in
`~/.rebase/credentials.json` gespeichert, niemals im Repository, und `rebase cloud`-Befehle
im verknüpften Verzeichnis verwenden es automatisch. Wenn `REBASE_TOKEN` gesetzt ist,
hat es immer noch Vorrang, falls es einen Scope für dieses Projekt besitzt, und die
Befehle warnen davor; besitzt es keinen (z. B. ein für andere Projekte erstelltes
CI-Token), wird das projekteigene Token verwendet und der erste Befehl weist darauf
hin. Ein Befehl, dem `--project` für ein anderes Projekt übergeben wird, behält
`REBASE_TOKEN` bei, und das Deployment, das `init --claim` ausführt, verwendet stets
das projekteigene Token. Es läuft zusammen mit dem Projekt ab. `rebase cloud whoami`
in diesem Verzeichnis zeigt das Projekt, die Berechtigungen des Tokens, die
Claim-URL und das Ablaufdatum des Projekts an. Ein Befehl, der die Sitzung einer
Person erfordert, bricht mit `session_required` ab und behält das Token bei; es wird
erst verworfen, sobald die Control Plane es überall ablehnt – nach einer Beanspruchung
oder nach Ablauf –, wobei die Claim-URL beim Verwerfen ausgegeben wird. `rebase cloud status`
zeigt ebenfalls die Claim-URL und das Ablaufdatum an (`unclaimed` in `--json`).
`rebase cloud unlink` löscht ein nicht beanspruchtes Projekt nicht: Es warnt davor,
dass das Projekt bis zu seinem Ablauf weiterläuft, und gibt die Claim-URL aus. Ein
`init --claim` in einem Verzeichnis, das bereits mit einem Projekt verknüpft ist,
verweist auf dessen Claim-URL, anstatt ein zweites bereitzustellen. Bis zur
Beanspruchung erreicht die App das Internet nur über die Ports 80 und 443; die
Mail-Ports, die jedes andere Projekt besitzt (465, 587 und 993), werden erst
freigeschaltet, wenn das Projekt beansprucht wird.

Sobald das Deployment die App gebaut hat, setzt der Befehl außerdem `REBASE_API_TOKEN`
in der `.env`: ein Schlüssel, der auf der App selbst generiert wurde und den der
MCP-Server und das SDK an sie senden. Ein bereits in der `.env` vorhandenes
`REBASE_API_TOKEN` wird beibehalten und es wird kein neues generiert; eine vom Befehl
erstellte `.env`-Datei ist nur für Sie lesbar. Es liest und schreibt Daten
(`data:read`, `data:write`) über die Row-Level Security der App als Aufrufer, der
weder eine Person noch ein Administrator ist. Es besitzt keinerlei Rechte auf der
Admin-Ebene und läuft mit dem Claim-Zeitfenster ab, es sei denn, das Projekt wird
zuvor beansprucht. Mit `--no-deploy` oder wenn das erste Deployment fehlschlägt,
existiert noch kein Schlüssel: Das nächste erfolgreiche `rebase cloud deploy` im
Verzeichnis fordert einen an, solange das Projekt unbeansprucht ist und `.env` noch
kein `REBASE_API_TOKEN` definiert. `init`, `deploy`, `status` und `whoami` geben das
Ablaufdatum aus.

Durch das Beanspruchen wird der Schlüssel übergeben: Die Beanspruchung hebt sein
Ablaufdatum auf, sodass die `.env` der App weiterhin funktioniert. Der Agent besitzt
immer noch eine Kopie, daher kann die Person, die das Projekt beansprucht hat, ihn
ersetzen. `rebase cloud app-key rotate` oder **Rotate app key** in den Einstellungen
des Projekts generiert einen neuen Schlüssel und widerruft alle vorherigen Agentenschlüssel
auf einmal. Es schreibt den neuen Schlüssel in eine `.env`-Datei, die bereits
`REBASE_API_TOKEN` setzt, oder zeigt ihn einmalig an. Eigentümer und Administratoren
können ihn im angemeldeten Zustand rotieren. Ein Schlüssel, der nicht übergeben werden
konnte, behält sein Ablaufdatum bei – dies geschieht, wenn die App zum Zeitpunkt der
Beanspruchung nicht bereitgestellt war oder nicht antwortete. Die Rotation ersetzt ihn
durch einen Schlüssel, der nicht abläuft.

Die Beanspruchung ersetzt auch den `REBASE_SERVICE_KEY` des Projekts, der über
Administratorrechte für die eigene API der App verfügt und den der bereitgestellte
Code des Agenten lesen konnte. Die App startet einmalig mit einem neuen Schlüssel
neu, und alles, was der Agent behalten hatte, funktioniert nach Abschluss dieses
Neustarts nicht mehr. Wenn zum Zeitpunkt der Beanspruchung ein Deployment läuft,
übernimmt das nächste Deployment den neuen Schlüssel.

Das Beanspruchen erfordert eine angemeldete Browser-Sitzung, kein Token, sowie eine
Zahlungsmethode für die Organisation, in die das Projekt verschoben wird. Ab der
Beanspruchung wird das Projekt wie jedes andere abgerechnet. Die Beanspruchung
widerruft außerdem das Token des Agenten: Melden Sie sich mit `rebase cloud login`
an oder generieren Sie ein neues Token mit `rebase cloud tokens create`.

Die Bereitstellung ohne Konto ist pro Adresse, pro Netzwerk (ein IPv4-/24-Subnetz)
und insgesamt limitiert; eine Control Plane, die dies nicht aktiviert hat, lehnt dies
mit einer entsprechenden Meldung ab. Die Nutzung vor der Beanspruchung wird der Person,
die das Projekt beansprucht, nicht in Rechnung gestellt.
