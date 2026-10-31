---
sourceHash: 3f0338ecb589f00b
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der Unterschied besteht darin, wer es betreibt.

:::note[Private beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits heute echte Mandanten und wird schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein Konto, das bereits freigeschaltet wurde. Alles andere auf dieser Website funktioniert auch ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind Bundle-Uploads, keine Container-Builds |
| **Database** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird beim ersten Deployment bereitgestellt und nach reservierten Ressourcen statt pro Benutzerplatz abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository lässt sich mit `docker compose` selbst hosten, und der Ausweg ist real: `rebase build` erzeugt ein Bundle, das überall startet, wo das Runtime-Image ausgeführt wird.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` akzeptiert keine Positionsargumente. Der Name und die Subdomain sind Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein Headless-Lauf, bei dem eines davon fehlt, wird mit `input_required` beendet, anstatt einen Wert zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der Host `<slug>.rebase.website`, unter dem das Projekt antwortet, wählen Sie sie also mit Bedacht.

`--link` bindet dieses Verzeichnis im selben Aufruf an das Projekt, sodass kein separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID und der Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Anmeldedaten – diese liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige Control Plane angeben kann. Wenn der Host ausschließlich aus dieser Datei stammt und es sich weder um die plattformeigene noch um eine handelt, bei der Sie sich zuvor angemeldet haben, benennt `login` ihn und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit `--json` bricht der Befehl mit `unknown_control_plane` ab; übergeben Sie `--url <host>` (oder setzen Sie `REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

**Registriert über Google, GitHub oder LinkedIn?** Ihr Konto hat kein Passwort, melden Sie sich daher stattdessen mit einem Code an:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist, und Sie geben ihn an der Eingabeaufforderung ein. Wenn `rebase cloud login` direkt im Terminal ausgeführt wird, fragt es, ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes setzen voraus, dass die Control Plane E-Mails versenden kann; ist dies nicht der Fall, meldet `--code` dies und wird mit `otp_unavailable` beendet.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes, unabhängig davon, wie Sie sich angemeldet haben. Weder ein Anmeldecode noch ein zweiter Faktor können ohne Terminal eingegeben werden. Erstellen Sie für ein Skript ein Zugriffstoken in der Konsole (**Settings → Access tokens**) und setzen Sie `REBASE_TOKEN`; siehe [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents).

Bei einem falschen Passwort antwortet das System mit `invalid_credentials` und denselben zwei Anmeldeoptionen, da die Ursache meist ein Konto ist, das nie ein Passwort besaß.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Es steht bewusst an erster Stelle der Sequenz: Das erste Deployment eines Projekts wird ohne hinterlegte Karte abgelehnt, und dies erst nach Abschluss des Bundle-Uploads festzustellen, wäre die schlechtere Reihenfolge.

Danach listet die Seite **Billing** in der Konsole die Rechnungen der Organisation auf – jeweils mit der von Stripe gehosteten Seite und dem PDF – und zeigt eine Vorschau auf die nächste Rechnung für jedes Projekt. `rebase cloud billing invoices` und `rebase cloud billing upcoming` geben dasselbe aus. Beide Befehle richten sich an Eigentümer und Administratoren der Organisation. Sofern die Plattform dies anbietet, öffnet **Manage billing** das Stripe-Kundenportal zur Verwaltung der Karte, der Rechnungsdaten und vergangener Rechnungen.

Wenn bereits eine Karte hinterlegt ist, ist beim Erstellen eines weiteren Projekts in der Konsole keine zweite Zahlung erforderlich: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte abgelehnt oder verlangt die Bank eine Zahlungsbestätigung, führt die Konsole Sie zu **Billing**, wo Sie über **Fix your card** eine andere Karte speichern und über **Complete the payment** die Rechnung von Stripe aufrufen können.

Die Ressourcennutzung eines Projekts wird in dessen Übersicht unter **Usage this month** angezeigt sowie für alle Projekte gesammelt auf der Seite **Billing**: Anfragen im Vergleich zum enthaltenen Freikontingent (der Balken färbt sich bei 80 % orange), 5xx-Fehler, die bisherige Mehrnutzung (Overage) und eine Hochrechnung für das Monatsende bei aktuellem Tempo. Die Mehrnutzung wird von demselben Code berechnet, der sie an Stripe meldet, entspricht also genau dem Betrag auf der Rechnung; sie erscheint auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dieselben Werte aus, und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen. Die Zahlen weisen darauf hin, was noch nicht erfasst wird: Objektspeicher wird nicht gemessen, daher wird keine Speichermehrnutzung abgerechnet; solange ein Projekt zwei oder mehr App-Pods betreibt, werden dessen Anfragen nicht gezählt; und an Tagen mit verpassten Messungen wird zu wenig erfasst. Ein automatisch skaliertes Projekt zeigt zudem die Pods, die über `--replicas` hinaus liefen, in Pod-Stunden an, was diese zu den eigenen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Bei einem von einem Agenten übernommenen Projekt (claimed) zählen erst die Tage ab der Übernahme: Davor gehörte das Projekt der Plattform.

Ein bestehendes Projekt kann verknüpft werden, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen

```bash
rebase cloud deploy
```

Ein einziger Befehl, und kein Flag, das man sich merken muss. Die `rebase.json` eines Scaffolds deklariert `runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies wird bei der Ausführung gemeldet (`rebase.json declares runtime: managed — deploying a bundle`), baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem finalen Status. Der Exit-Code liefert das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, unter welchen Adressen jede App nun erreichbar ist und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: `/health` eines Backends gab `ok` zurück, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die Plattform sie ausliefert). Die Überprüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig 60; `0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird das Deployment dennoch mit Exit-Code 0 beendet, da das Deployment erfolgreich war, und die letzte Zeile gibt an, welche App nicht geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen in einer einzigen Zeile, die die App und den Grund nennt, wobei `rebase cloud logs` das vollständige Build-Protokoll bereitstellt.

Skripte übergeben `--json`, um ein einzelnes Objekt mit denselben Informationen zu erhalten – `apps`, `hosts`, `live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von `rebase cloud` wechselt `deploy` bei einer Pipe nicht automatisch zu JSON.

Was diese Runtime erlaubt – Pakete und native Module, Speicher und Instanzen, Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender Netzwerkverkehr – wird auf einer eigenen Seite beschrieben:
[Managed Backend Runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt auszuliefern, das bereits zuvor gebaut wurde – beispielsweise in einem CI-Job, der einmal baut und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes löst dies aus: Ein Build, der ein verwaltetes Projekt auf ein Container-Image umstellen würde, das es dann selbst verwaltet, wird abgelehnt, bis Sie dies explizit bestätigen. Früher stand `--force` dafür, wodurch die am schwersten rückgängig zu machende Aktion der CLI unter demselben Begriff wie „diese Datei überschreiben“ lief; dies ist nun eine unbekannte Option statt eines Alias, sodass ein Skript, das sie verwendet, stattdessen abbricht.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie vorliegen. Wenn deren `build`-Schritt lediglich handgeschriebene Skripte nach `output` kopiert, wurden sie von nichts geparst, und eine Datei mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor also etwas hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Dies deckt sowohl einzeln bereitgestellte statische Apps ab als auch statische Apps, die in das Bundle des Backends integriert sind. Ein Syntaxfehler stoppt das Deployment unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser nicht als JavaScript ausführt, werden übersprungen: JSON, Import-Maps, Templates und alle anderen Nicht-JavaScript-`type`-Attribute, ein `<script src>` sowie Skripte, die noch ungerendertes Template-Markup wie `{{ }}` enthalten. Eine `.js`-Datei besteht die Prüfung, wenn sie sich entweder als klassisches Skript oder als Modul parsen lässt, da die Seite entscheidet, worum es sich handelt. Unterhalb von `node_modules` wird nichts gelesen, ebenso wenig in einem vorab erstellten `--bundle-dir`. `--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Überwachung:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` den Wert `null` hat, arbeitet die Plattform tatsächlich und Polling ist die richtige Vorgehensweise; wenn dort etwas angegeben ist, wartet dieses Etwas auf Sie.

## Vorschau einer Änderung

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was auch `deploy` verarbeiten würde, stellt es jedoch unter einer eigenen Adresse bereit, wie etwa `https://shop--k3x9ab.rebase.website`. Die Produktionsumgebung liefert weiterhin das aus, was sie zuvor ausgeliefert hat. Das Deployment gibt die Adresse der Preview aus, sobald der Build abgeschlossen ist.

Um eine feste Adresse über mehrere Deployments hinweg beizubehalten, können Sie der Preview einen Namen geben. Ein erneutes Bereitstellen mit demselben Namen aktualisiert diese:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** erstellt eine Vorschau des Backends inklusive der integrierten statischen Apps, genau so, wie die Produktion sie ausführt. Es erhält ein eigenes Backend auf einer **eigenen, leeren Datenbank**, niemals auf der Produktionsdatenbank. Ein Start gegen die Produktionsdatenbank würde das Schema und die Zugriffsregeln der Preview auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert in der Vorschau anzeigen, deren Seiten das **Produktions-Backend** aufrufen. Dazu ist eine Control Plane erforderlich, die statische Websites eigenständig ausliefert, was Rebase Cloud derzeit noch nicht unterstützt: Die Anfrage wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und nichts veröffentlicht. Erstellen Sie stattdessen eine Vorschau des Backends, das die integrierten statischen Apps mitausliefert; ein Projekt ohne verwaltetes Backend kann derzeit noch nicht in die Vorschau überführt werden.

Eine Preview lädt keinen Quellcode hoch und registriert weder Apps noch Hostnamen, da jede dieser Aktionen das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht mit `--preview` kombiniert werden. Beide bauen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** in der Konsole listet dieselben Previews auf und ermöglicht das Öffnen, Einsehen der Build-Logs oder Löschen der einzelnen Previews. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment darauf ab.

Nach Abschluss prüft das Deployment, ob die Adresse der Preview antwortet – genau wie bei einem Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer neuen Preview kann ein bis zwei Minuten in Anspruch nehmen, sodass ein erfolgreiches Deployment melden kann, dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität), anteilig für die Dauer ihrer Existenz berechnet und im monatlichen Kostenvoranschlag des Projekts in der Konsole aufgeführt. `rebase cloud deploy --preview` gibt denselben Kostenvoranschlag dafür pro Monat aus (`cost` unter `--json`). Zum Starten ist wie bei einem Produktions-Deployment eine hinterlegte Kreditkarte erforderlich. Ein erstes Deployment, das fehlschlägt, bevor etwas ausgeführt wird, wird entfernt und nicht abgerechnet. Ein Projekt darf bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt, das für eine Domain bis zu 50 neue Zertifikate pro Woche zulässt, geteilt mit jeder darauf betriebenen Produktionsseite. Previews dürfen plattformweit bis zu 20 davon innerhalb von jeweils 7 Tagen beanspruchen. Darüber hinaus wird eine neue Preview abgelehnt (`429`, `preview_cert_budget`), mit Angabe des Zeitpunkts, ab dem sie bereitgestellt werden kann; das erneute Bereitstellen einer bereits existierenden Preview zählt niemals dazu.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf dem PostgreSQL-Server der **Produktion**: eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10 Verbindungen beschränkt, damit Previews nicht die Verbindungen der Produktion aufbrauchen, sowie auf 2 GB: Eine Preview, deren Datenbank über diese Grenze anwächst, wird pausiert. Ihr Backend stoppt, ihre Adresse antwortet nicht mehr, `rebase cloud previews` und die Konsole zeigen sie mit der entsprechenden Begründung als `paused` an, und die Eigentümer sowie Administratoren des Projekts werden benachrichtigt (`preview.paused`). Ihre Daten bleiben bis zum Ablauf erhalten. Stellen Sie sie erneut bereit, um sie zu starten (sie wird erneut pausiert, solange die Datenbank noch zu groß ist), oder löschen Sie sie. Eine pausierte Preview wird weiterhin abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Previews, die Sie nicht mehr benötigen. In der Produktion installierte Erweiterungen werden nicht in der Datenbank einer Preview installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die diese noch nicht unterstützt, weist `--preview` mit `previews_unavailable` ab und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand, der bei einem früheren erfolgreichen Deployment ausgeliefert wurde, und baut niemals neu – der Wert eines Rollbacks besteht darin, dass ein Artefakt ausgeliefert wird, das bereits gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird; beide Varianten funktionieren:

| Art des Deployments | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell ausführt |

Statische Apps, die in das Bundle des Backends integriert sind (ein einfaches `rebase cloud deploy` bei einem Projekt mit Backend), sind Teil dieses Bundles und werden daher gemeinsam damit zurückgesetzt.

Eine isoliert bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht zurückgesetzt werden. Ihr Deployment zeichnet auf, welche App veröffentlicht wurde, jedoch kein Bundle, sodass die Control Plane keine Grundlage zur Wiederherstellung hat. Die Lösung besteht darin, die letzte funktionierende Version erneut bereitzustellen, beispielsweise ausgehend vom Commit vor dem fehlerhaften. Nach einem solchen Deployment weist `deploy` hierauf hin, anstatt auf `rollback` zu verweisen, und `rollback` ohne ID bricht ab, anstatt das aktuell aktive Backend erneut bereitzustellen.

Für ein Rollback ist daher ein Deployment erforderlich, bei dem eines von beiden aufgezeichnet wurde – das setzt ein Projekt voraus, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments` kennzeichnet diejenigen, die dafür infrage kommen, und `--json` gibt pro Zeile `rollbackable` zusammen mit dem `image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI gibt an, welche: ein Deployment, das nicht erfolgreich war, und eines aus der Zeit, bevor die Plattform dessen Artefakt aufgezeichnet hat. In beiden Fällen gibt es keinen Raum für Vermutungen – ein Raten würde das ausliefern, was zuletzt gebaut oder hochgeladen wurde, während behauptet wird, dieses wiederherzustellen – stellen Sie stattdessen die gewünschte Version bereit.

Jedes erfolgreiche Deployment nennt am Ende den Weg zurück (`rebase cloud rollback`), sodass dieser genau in dem Moment sichtbar ist, in dem ein fehlerhaftes Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzudrehen, und wartet darauf, dass die wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird. Verfolgen Sie dies mit `rebase cloud logs -f`.

## Wiederherstellung der Datenbank zu einem bestimmten Zeitpunkt

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters zurückgesetzt werden – über **Database → Backups** in der Konsole oder mit der CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies erfolgt in zwei Schritten. Zunächst wird eine wiederhergestellte Kopie neben der Live-Datenbank bereitgestellt; Ihre App läuft auf der Live-Datenbank weiter, und der Speicher der Kopie wird abgerechnet, bis Sie die Umstellung vornehmen oder die Kopie verwerfen.
Sobald die Kopie bereitsteht, lenkt die Umstellung (Cutover) die App darauf um und startet sie neu. Alle Daten, die nach dem Zielzeitpunkt geschrieben wurden, sind in der Kopie nicht enthalten. Die ursprüngliche Datenbank bleibt als Rückfallebene erhalten und belegt weiterhin kostenpflichtigen Speicherplatz; das Zurückwechseln, Entfernen oder eine zweite Wiederherstellung erfolgt über den Support. Nur ein Eigentümer oder Administrator kann Kopien bereitstellen, den Cutover durchführen oder verwerfen, und die Konsole verlangt vor dem Cutover die Eingabe des Projektnamens zur Bestätigung.

## Ihr Konto absichern

Ihr Konsolen-Konto hat Zugriff auf Produktionsdatenbanken, Secrets und Abrechnungsinformationen – schützen Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar in der Konsole (oder rufen Sie `/account` auf). Diese Seite gehört Ihnen persönlich, nicht einer Organisation: Was Sie dort festlegen, gilt in jeder Organisation, der Sie angehören.

- **Zweistufige Verifizierung.** Aktivieren Sie diese mit einer beliebigen Authentifikator-App (1Password, Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum Hinzufügen zur App oder einen Link, der die App auf einem Smartphone mit vorausgefülltem Schlüssel öffnet, und fragt anschließend nach dem 6-stelligen Code, den die App anzeigt. Von da an erfordert jede Anmeldung einen Code – unabhängig davon, ob Sie sich mit einem Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn Einmalcodes, die nur einmal angezeigt werden. Jeder davon ermöglicht Ihnen die Anmeldung anstelle des Authentifikator-Codes, falls Sie Ihr Telefon verlieren; speichern Sie diese daher, bevor Sie den Dialog schließen. **New recovery codes** ersetzt sie, und die alten Codes verlieren ihre Gültigkeit. Sowohl das Deaktivieren der zweistufigen Verifizierung als auch das Abrufen neuer Codes erfordern zunächst die Eingabe eines Codes.
- **Passwort.** Eine Änderung meldet Sie auf allen anderen Geräten ab. Ein über Google, GitHub oder LinkedIn erstelltes Konto besitzt kein Passwort; die Seite bietet an, Ihnen per E-Mail einen Link zum Festlegen eines Passworts zu senden.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, das bei Ihrem Konto angemeldet ist, samt Adresse und Anmeldezeitpunkt. Melden Sie unbekannte Geräte oder alle Geräte auf einmal ab.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und verlangen keinen zweiten Faktor, sodass CI auch nach der Aktivierung weiterhin deployen kann. Widerrufen Sie ein Token, dem Sie nicht mehr vertrauen, unter **Settings → Access tokens**.

## Ihr Team einladen

**Members → Invite member** generiert einen Link zum Kopieren (der auch per E-Mail versendet wird, wenn diese Control Plane E-Mails verschickt), der einmalig für 7 Tage für ein Konto gültig ist, das diese Adresse verifiziert hat; der Beitritt erfolgt erst mit Annahme der Einladung. Laden Sie Administratoren oder Mitglieder ein und befördern Sie sie nach dem Beitritt bei Bedarf zum Eigentümer. Eigentümer und Administratoren können Einladungen unter **Pending invitations** einsehen, erneut senden oder widerrufen; im Terminal über [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Sehen, wer was getan hat

Die Seite **Activity** in der Konsole und `rebase cloud activity` zeigen den Eigentümern und Administratoren der Organisation, wer wann bereitgestellt hat, eine Umgebungsvariable gesetzt oder offengelegt hat (nur nach Name, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt, ein Projekt in der Größe angepasst, gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein Token erstellt hat. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge; Einträge zu gelöschten Projekten bleiben erhalten. Ein Skript kann diese Einträge mit einem Token auslesen, das mit `--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter finden Sie unter [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agenten

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Vergeben Sie stattdessen ein Token, das auf wenige Aktionen für ein einzelnes Projekt beschränkt ist. Erstellen Sie es über ein angemeldetes Terminal mit `rebase cloud tokens create --project shop --can deploy,logs` und setzen Sie es als `REBASE_TOKEN`. Die Abrechnung, das Aktivitätsprotokoll und die Benachrichtigungseinstellungen einer Organisation sind eigenständige Berechtigungen (`--can billing`, `audit`, `notifications`), die ein Token nur erhält, wenn sie explizit angefordert werden. Die Berechtigungen, ein GitHub Actions-Workflow und Details dazu, welche Rechte ausschließlich angemeldeten Personen vorbehalten bleiben, finden Sie unter [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

`rebase cloud init --claim` stattet eine App mit einem Live-Backend aus, noch bevor sich jemand registriert hat, und gibt eine Claim-URL aus, über die das Projekt dauerhaft übernommen werden kann; ein Projekt, das innerhalb von 72 Stunden von niemandem beansprucht wird, wird gelöscht. Was das Token des noch nicht beanspruchten Projekts tun darf, welches `REBASE_API_TOKEN` es schreibt und was sich durch die Übernahme ändert, ist unter [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) beschrieben.

## Compute und die Kosten

Der Preis eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach einer Tarifstufe. `compute` gibt jeden Regler und den detaillierten Kostenvoranschlag der Control Plane dafür aus. (`rebase cloud resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert, und ob diese jeweils bereitgestellt sind – siehe [CLI-Referenz](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Regler | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Ressourcenanforderung pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard – `100m` und `384Mi`, mit Bursting auf bis zu 2 CPUs und `2Gi` |
| `--replicas` | Instanzen, die dauerhaft existieren: die Untergrenze des Autoscalers und der Betrag, den das Abonnement des Projekts monatlich abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden sekundengenau pro Pod zu denselben Tarifen abgerechnet – und zwar nur dort, wo die Plattform dies aktiviert hat; **Usage this month** gibt Aufschluss darüber. `--no-autoscale` deaktiviert die Autoskalierung |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, gemessen am Request statt am Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible-Kapazität: günstiger, wird jedoch ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` ergänzt ein automatisches Standby |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein leerer Regler ist nicht dasselbe wie ein auf denselben Wert festgelegter: Ein leerer Regler folgt dem Plattformstandard und passt sich an, wenn dieser sich ändert.

Von der CLI wird bewusst nichts vorab validiert – die Grenzwerte hängen vom Cluster ab, auf dem ein Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control Plane lehnt Werte ab, die sie nicht bedienen kann, und benennt das entsprechende Feld. Führen Sie `rebase cloud compute` aus, um den Betrag in €/Monat vor und nach der Änderung zu sehen; Änderungen werden sofort wirksam und ab heute anteilig berechnet – mit Ausnahme von Änderungen, die einen Neustart der Datenbank erfordern, welche auf ein Wartungsfenster warten.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami` | Ihre Sitzung |
| `tokens` | Token für CI und Agenten, jeweils auf ein Projekt beschränkt. Siehe [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Binden dieses Verzeichnisses an ein Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `init`, `claim` | Mit `--claim`: Ein Live-Backend ohne Konto und ein Link zu dessen Übernahme; `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Ausliefern und überwachen |
| `previews` | Durch `deploy --preview` unter einer eigenen Adresse bereitgestellte Builds und deren Löschung. Siehe [Vorschau einer Änderung](#vorschau-einer-änderung) |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederaufnahme. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform berechnet für gestoppte Projekte lediglich Speicher und die Plattformgebühr; die Zeile **Billing** in der Konsole weist darauf hin, wenn dies der Fall ist |
| `status`, `metrics`, `debug` | Was es gerade tut und warum gegebenenfalls nicht |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen über Ihr `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist lesegeschützt |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der bei der Übernahme übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Eigentümer und Administratoren |
| `service-key` | `REBASE_SERVICE_KEY`, Administratorrechte für die eigene API der App: Wann er zuletzt rotiert wurde; `rotate` weist der App einen neuen zu. Eigentümer und Administratoren |
| `domains` | Eigene Domains, die hinzuzufügenden DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, die jeweils separat verifiziert werden; `verify` und `remove` erwarten die jeweilige Domain als Parameter, der nur weggelassen werden darf, wenn genau eine vorhanden ist (bei `verify` eine noch ausstehende). `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anhängen oder erstellen, Verbindung von Ihrem lokalen Rechner aus herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | <span class="since-badge" data-since="0.27">Since 0.27</span> Die Gastbenutzer, die durch anonyme Anmeldungen hinterlassen wurden: zählen, einzelne löschen oder diejenigen bereinigen, die seit langer Zeit nicht mehr aktiv waren. Siehe [Guests](/docs/cli/cloud/#guests). Eigentümer und Administratoren |
| `extensions` | Die Postgres-Erweiterungs-Allowlist |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet im Abgleich mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es anpasst |
| `usage` | In diesem Monat verbrauchte Anfragen im Vergleich zum enthaltenen Freikontingent und bisherige Mehrnutzung, wie sie auf der Rechnung ausgewiesen wird. `usage org` listet jedes Projekt der Organisation auf |
| `clusters` | Die Cluster, auf denen Mandanten ausgeführt werden. Nur für Plattform-Administratoren |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen und deren Mitglieder sowie Einladungen, Zahlung |
| `activity` | Das Audit-Protokoll der Organisation: Wer bereitgestellt hat, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Eigentümer und Administratoren. Siehe [Sehen, wer was getan hat](#sehen-wer-was-getan-hat) |
| `notifications`, `webhooks` | Wohin die Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige https-URL ([Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/)). `webhooks` ist veraltet und wird mit Exit-Code 1 und Code `command_retired` beendet |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Verwendungszeile, den zugehörigen Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test prüft den Index dieser Seiten; eine Gruppe, die ohne eine solche Seite hinzugefügt wird, lässt daher den Build fehlschlagen, anstatt nur das Inhaltsverzeichnis auszugeben. `verify:docs` gleicht die Tabelle selbst mit diesem Index ab: Jede von der CLI verarbeitete Gruppe erscheint hier genau einmal; eine Gruppe, die ohne Tabellenzeile hinzugefügt wird, führt ebenfalls zu einem Build-Fehler.

Wird die Ausgabe weitergeleitet, antwortet `--help` stattdessen mit JSON: dieselbe Verwendungszeile, Flags und Beispiele als lesbare Datenstruktur statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Offen und direkt dargelegt, denn es erst später herauszufinden, wäre ärgerlicher:

- **Keine Regionsauswahl.** Derzeit läuft alles in einer einzigen Region. Das Platzierungsmodell existiert zwar in der Plattform, ein Projekt kann die Region jedoch nicht frei wählen. `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen: Sie halten lediglich fest, zu welchem der registrierten Deployment-Ziele der Control Plane ein Projekt gehört. Da es derzeit nur eines gibt, fallen beide standardmäßig darauf zurück, und keines von beiden verschiebt ein Projekt an einen anderen Ort. `rebase cloud projects create --help` weist ebenfalls darauf hin.
- **Kein Self-Service.** Der Zugriff wird schrittweise in Batches gewährt; es gibt keine direkte Registrierung mit anschließender Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Falls Sie eines davon benötigen, geben Sie dies bitte direkt bei der Zugangsanfrage an, anstatt davon auszugehen.
- **Keine Branch-Deployments** und keine offizielle GitHub-App. Deploy-Hooks – geheime URLs, auf die ein Repository-Webhook verweist – sind die unterstützte Automatisierungsmethode. [Preview-Deployments](#vorschau-einer-änderung) werden schrittweise eingeführt und über die CLI gestartet.
- **Token agieren als Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents) wird von einem Benutzerkonto erzeugt und handelt in dessen Namen; es gibt derzeit noch keine organisationsweiten Maschinen-Identitäten. Wenn Sie sich stattdessen über CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Speicher – `--password` legt das Passwort in Ihrer Shell-Historie und in der Prozesstabelle ab und warnt davor, bevor Sie angemeldet werden. Wenn die `.rebase/cloud.json` des Repositories eine andere Control Plane als die plattformeigene angibt, übergeben Sie diese ebenfalls als `--url`: Ohne Terminal weigert sich `login`, ein Passwort an einen Host zu senden, der lediglich in der ausgecheckten Datei benannt wurde.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das Internet erreichbar. Der in der Konsole angezeigte Host ist die Backend-Adresse dafür und kann auf Ihrem lokalen Rechner nicht aufgelöst werden. `rebase cloud db connect` öffnet einen lokalen Port, der über die Control Plane getunnelt wird und diese Datenbank darstellt, solange der Befehl aktiv bleibt – es gibt jedoch keinen permanenten Hostnamen, mit dem sich ein Drittanbieterdienst verbinden könnte. Sowohl dieser Tunnel als auch das Passwort hinter `rebase cloud db info --reveal` erfordern die Eigentümer- oder Administratorrolle der Organisation: dieselbe Rolle, die auch der SQL-Editor von Studio verlangt, da alle drei Zugriffe auf eine Sitzung mit Ihren Produktionsdaten hinauslaufen.
- **Ein Deployment führt Code mit den Produktions-Secrets aus.** Die Umgebung der App enthält `REBASE_SERVICE_KEY` (Admin auf der eigenen API), `DATABASE_URL` und `JWT_SECRET`. Code, den ein Mitglied bereitstellt, kann diese Werte somit auslesen – auch wenn nur Eigentümer und Administratoren sie in der Konsole einsehen können. Laden Sie daher nur Personen als Mitglieder ein, denen Sie diese Werte anvertrauen würden.
- **Der Service-Key kann ersetzt werden.** Über die **Settings** des Projekts (oder mittels `rebase cloud service-key rotate`) wird ein neuer `REBASE_SERVICE_KEY` generiert und die App damit neu gestartet. Der alte Schlüssel bleibt gültig, bis der Neustart abgeschlossen ist, danach nicht mehr; jeder Dienst, der ihn kopiert hat, wird ab diesem Zeitpunkt abgewiesen. Das Übernehmen eines Projekts bewirkt dasselbe.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/) führt das identische Image und Bundle mit `docker compose` aus, und der [Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über das Helm-Chart ab.
