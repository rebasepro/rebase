---
sourceHash: 582293a88fb2d626
title: CI, Agents und übernehmbare Backends
sidebar_label: CI und Agents
description: Deployen Sie aus CI oder durch einen Agenten mit einem Token mit begrenztem Umfang statt mit einem Passwort, und lassen Sie einen Agenten ein Live-Backend ohne Konto bereitstellen, das eine Person später übernimmt.
---

Ein [Rebase-Cloud](/docs/deployment/cloud/)-Projekt braucht keine Person an einem
Terminal, um zu deployen. Ein CI-Job oder ein Agent handelt mit einem Token, das auf
wenige Aktionen für ein einzelnes Projekt beschränkt ist, und ein Agent kann ein Projekt
anlegen, bevor irgendjemand ein Konto hat, und dann einen Link zum Übernehmen übergeben.


## CI und Agents

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Geben Sie ihm stattdessen
ein Token: einen Key, der als Ihr Konto handelt, beschränkt auf wenige Aktionen für ein
einzelnes Projekt. Erstellen Sie es von einem angemeldeten Terminal aus:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Das Token wird einmalig ausgegeben, als Zeile `export REBASE_TOKEN=rk_live_…`. Ist
`REBASE_TOKEN` gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit statt mit
Ihrer Anmeldung und liest oder schreibt die gespeicherte Sitzung nie. Legen Sie es in
GitHub Actions als Repository-Secret ab und stellen Sie es unter diesem Namen bereit:

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

`--can` nimmt eine oder mehrere Capabilities entgegen, kommagetrennt oder wiederholt:

| Capability | Was das Token darf |
|---|---|
| `deploy` | Das Projekt deployen und seine Builds verfolgen: `deploy` (einschließlich `--preview`), `deployments`, `previews` |
| `logs` | Build- und Laufzeit-Logs, Cron-Verlauf, Live-Metriken und Nutzung lesen: `logs`, `cron`, `metrics`, `usage` |
| `env` | Umgebungsvariablen lesen und ändern, Secrets eingeschlossen, ebenso die der Previews (`--preview`) |
| `database` | `db list`, `db info` und `db connect`, was das Datenbankpasswort einschließt |
| `backups` | Backups auflisten, erstellen, einsehen und herunterladen sowie das Point-in-Time-Fenster lesen |

<span class="since-badge" data-since="0.26">Seit 0.26</span> Drei weitere Capabilities beziehen sich auf eine Organisation statt auf ein Projekt. Ein Token
hält eine davon nur, wenn `--can` sie nennt, und zwar für die Organisation, die `--org` nennt (oder,
ohne `--org`, die Organisation des Projekts, dann die mit
`rebase cloud use` ausgewählte). Ein Token darf sie halten und keine Projekt-Capability:

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capability | Was das Token darf |
|---|---|
| `billing` | Die hinterlegte Karte, die Rechnungen und die nächste Rechnung lesen und die Abrechnungs-E-Mail ändern: `billing`, `billing invoices`, `billing upcoming`. Nur Owners und Admins |
| `audit` | Das Aktivitätsprotokoll der Organisation lesen: `activity`. Nur Owners und Admins |
| `notifications` | Die eigenen E-Mail-Einstellungen seines Eigentümers und die Benachrichtigungs-Webhooks der Projekte der Organisation ändern: `notifications`. Einen Webhook hinzuzufügen, zu ändern und zu entfernen erfordert weiterhin die Rolle Owner oder Admin |

Ein Token, das erstellt wurde, bevor es `billing` gab, liest die Abrechnung noch für ein
Release weiter. Jede dieser Antworten trägt einen `Deprecation: true`-Header und einen Satz,
der den Scope nennt, der dem Token fehlt, und die CLI gibt ihn einmal auf stderr als Warnung
aus. Ersetzen Sie ein solches Token vor dem nächsten Release durch eines, das mit
`--can billing` erstellt wurde, denn dann beginnt die Abrechnung, es abzulehnen.

Intern ist ein Token ein [persönlicher API-Key](/docs/backend/api-keys/#personal-keys)
auf der Control Plane. Jede Capability wird zu einigen wenigen
[Scopes](/docs/backend/roles-and-scopes/): `deploy` auf `shop` hält
`project:deploy:<id>`, mit der ID des Projekts, dazu die Daten- und Funktions-Scopes,
die die Deploy-Befehle aufrufen. Eine Organisations-Capability hält `org:billing:<id>`,
`org:audit:<id>` oder `org:notifications:<id>`, mit der ID der Organisation. Das Token hält nie mehr, als Ihr Konto im Moment
der Verwendung hält, sodass es verliert, was Ihr Konto verliert.

Zwei Dinge bleiben einer angemeldeten Person vorbehalten:

- **Tokens verwalten.** `rebase cloud tokens list`, `create` und `revoke <id>` verlangen
  Ihre `rebase cloud login`-Sitzung. Ein Token kann keine Tokens auflisten, erstellen oder
  widerrufen, denn ein Token, das Tokens ausstellen könnte, könnte seinen eigenen Nachfolger ausstellen.
- **Wiederherstellen.** Keine Capability gewährt eine Backup-Wiederherstellung oder ein
  Point-in-Time-`restore` und -`cutover`. Alte Daten über eine Live-Datenbank zu legen,
  bleibt einem angemeldeten Owner oder Admin vorbehalten.

`rebase cloud whoami` mit gesetztem Token zeigt, was es darf und auf welchem
Projekt oder welcher Organisation. Die Konsolen-Seite **Access tokens** bietet dieselben
Capabilities, die der Organisation unter **Organization access**. `rebase cloud tokens revoke <id> --yes` stoppt es sofort.

## Ein Backend ohne Konto

<span class="since-badge" data-since="0.26">Seit 0.26</span>

Ein Agent, der eine App gebaut hat, kann ihr ein Live-Backend geben, bevor sich jemand
registriert hat, und der Person, für die er arbeitet, einen Link übergeben, um es zu behalten:

```bash
rebase cloud init --claim
```

Das legt ein Projekt auf Rebase Cloud an, setzt `REBASE_BASE_URL` in `.env` auf dessen
Live-Adresse, verknüpft das Verzeichnis und deployt die lokalen Collections mit
`rebase cloud deploy --bundle`. Es gibt die Live-URL, die URL des Admin-Panels und eine
**Claim-URL** aus. Wer die Claim-URL öffnet und sich anmeldet, kann das Projekt in
eine seiner Organisationen verschieben. Der Link funktioniert einmal. Ein Projekt, das
innerhalb von 72 Stunden niemand übernimmt, wird gelöscht, die Datenbank eingeschlossen.
`rebase cloud claim` gibt die Claim-URL mit der verbleibenden Zeit erneut aus, und `--open`
öffnet sie. Das Tool `rebase_cloud_provision` des MCP-Servers führt denselben Befehl aus und
liefert dieselben URLs; seine übrigen Cloud-Tools prüfen, deployen, lesen Logs, setzen
Variablen und rollen das Projekt dann ohne Anmeldung zurück (siehe [MCP-Server](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` in `.env` ist auch das Ziel, an das `rebase api-keys`, `rebase storage`
und `rebase auth reset-password` den lokalen Service-Key senden, sodass sie nach `init
--claim` an das Cloud-Projekt gehen, das diesen Key nicht annimmt. Sie weisen darauf hin,
wenn das geschieht; setzen Sie `REBASE_BASE_URL` in der Shell, um stattdessen ein lokales Backend zu erreichen.

Bis das Projekt übernommen wird, gehört es keinem Konto. Sein Token ist auf
dieses eine Projekt beschränkt: Es deployt, liest Logs und Metriken, setzt Umgebungsvariablen
und führt `db info` aus. Es liest nichts Geheimes zurück: nicht den Wert einer Variable (den
Service-Key eingeschlossen), nicht das Datenbankpasswort, und es kann weder
`db connect` noch eine Preview öffnen. Es wird in
`~/.rebase/credentials.json` aufbewahrt, nie im Repository, und `rebase cloud`-Befehle
im verknüpften Verzeichnis verwenden es von selbst. `REBASE_TOKEN`, wenn gesetzt,
hat weiterhin Vorrang, sofern es einen Scope auf diesem Projekt hält, und diese Befehle warnen,
dass es das getan hat; hält es keinen (ein CI-Token, das für andere Projekte erstellt wurde), wird das
eigene Token des Projekts verwendet, und der erste Befehl sagt das. Ein Befehl, der `--project` für
ein anderes Projekt erhält, behält `REBASE_TOKEN`, und das Deployment, das `init --claim` ausführt,
verwendet stets das eigene Token des Projekts. Es läuft mit dem Projekt ab. `rebase cloud whoami` in diesem Verzeichnis zeigt das Projekt, was das
Token darf, die Claim-URL und wann das Projekt abläuft. Ein Befehl, der die Sitzung einer
Person braucht, lehnt mit `session_required` ab und behält das Token; es wird erst
vergessen, wenn die Control Plane es überall ablehnt, nach einer Übernahme oder bei
Ablauf, und dabei wird die Claim-URL ausgegeben. `rebase cloud status` zeigt die
Claim-URL und den Ablauf ebenfalls (`unclaimed` in `--json`). `rebase cloud unlink`
löscht ein nicht übernommenes Projekt nicht: Es warnt, dass das Projekt bis zu seinem Ablauf
weiterläuft, und gibt die Claim-URL aus, und `init --claim` in einem Verzeichnis,
das bereits mit einem Projekt verknüpft ist, verweist auf dessen Claim-URL, statt ein
zweites Projekt bereitzustellen. Bis zur Übernahme erreicht die App das Internet nur über die Ports 80 und 443;
die Mail-Ports, die jedes andere Projekt hat (465, 587 und 993), werden geöffnet, wenn das Projekt
übernommen wird.

Sobald das Deployment die App gebaut hat, setzt der Befehl außerdem `REBASE_API_TOKEN` in
`.env`: einen Key, der in der App selbst ausgestellt wird und den der MCP-Server und das SDK
an sie senden. Ein bereits in `.env` vorhandenes `REBASE_API_TOKEN` bleibt erhalten, und es wird keines ausgestellt,
und eine `.env`, die der Befehl anlegt, ist nur für Sie lesbar. Der Key liest und schreibt Daten (`data:read`, `data:write`) durch die
Row-Level Security der App, als Aufrufer, der weder eine Person noch ein Admin ist. Er
hält nichts von der Admin-Ebene, und er läuft mit dem Übernahmefenster ab, es sei denn, das
Projekt wird zuvor übernommen. Mit `--no-deploy`, oder wenn dieses erste Deployment scheitert,
gibt es noch keinen Key: Das nächste erfolgreiche `rebase cloud deploy` im
Verzeichnis fragt nach einem, solange das Projekt nicht übernommen ist und `.env` nicht bereits
ein `REBASE_API_TOKEN` setzt. `init`, `deploy`, `status` und `whoami` geben das
Datum aus, an dem er abläuft.

Die Übernahme übergibt den Key: Sie entfernt seinen Ablauf, sodass die `.env` der App
weiter funktioniert. Der Agent hält weiterhin eine Kopie, daher kann die Person, die das
Projekt übernommen hat, ihn ersetzen. `rebase cloud app-key rotate`, oder **Rotate app key** in den
Settings des Projekts, stellt einen neuen Key aus und widerruft sofort jeden früheren Agent-Key.
Er schreibt den neuen Key in eine `.env`, die bereits `REBASE_API_TOKEN` setzt,
oder zeigt ihn einmalig an. Owners und Admins rotieren ihn, angemeldet. Ein Key, der nicht
übergeben werden konnte, behält seinen Ablauf, was passiert, wenn die App bei der Übernahme nicht
deployt war oder nicht antwortete. Das Rotieren ersetzt ihn durch einen, der nicht abläuft.

Die Übernahme ersetzt außerdem den `REBASE_SERVICE_KEY` des Projekts, der auf der eigenen API der App
Admin ist und den der deployte Code des Agenten lesen konnte. Die App
startet einmal auf einen neuen Key neu, und was der Agent behalten hat, funktioniert nicht mehr,
sobald dieser Neustart abgeschlossen ist. Läuft im Moment der Übernahme ein Deployment,
trägt das nächste Deployment den neuen Key.

Die Übernahme verlangt eine angemeldete Browser-Sitzung, kein Token, und eine Zahlungsmethode bei
der Organisation, in die das Projekt verschoben wird. Ab der Übernahme wird das Projekt wie jedes
andere abgerechnet. Die Übernahme widerruft außerdem das Token des Agenten: Melden Sie sich mit
`rebase cloud login` an oder stellen Sie mit `rebase cloud tokens create` ein neues Token aus.

Das Bereitstellen ohne Konto ist pro Adresse, pro Netzwerk (ein IPv4-
/24) und insgesamt begrenzt, und eine Control Plane, die es nicht eingeschaltet hat, lehnt mit
einer Meldung ab, die das sagt. Die Nutzung vor der Übernahme wird demjenigen, der
das Projekt übernimmt, nicht berechnet.
