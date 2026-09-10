---
sourceHash: 2728510dde81de28
title: Self-Hosting
sidebar_label: Self-Hosting
description: Führen Sie Rebase überall mit dem offiziellen Runtime-Image und Ihrem Projekt-Bundle aus – Docker Compose, Fly, Railway oder auf einem einfachen VPS.
---

## Übersicht

Das Self-Hosting von Rebase erfordert zwei Dinge: eine Postgres-Datenbank und das
offizielle Image `rebasepro/server`, in das das Bundle Ihres Projekts gemountet
wird.

Es muss **kein Anwendungs-Image gebaut werden**. Ihr Projekt wird als Bundle
ausgeliefert, die Runtime ist bereits veröffentlicht, und ein Upgrade von
Rebase erfordert lediglich das Ändern eines Tags statt eines Rebuilds. Unter
[Runtime and bundles](/docs/architecture/runtime-and-bundles/) erfahren Sie,
warum diese Aufteilung gewählt wurde.

## Docker Compose

**Wenn Ihr Projekt über `rebase init` erstellt wurde, verwenden Sie dessen
eigene `docker-compose.yml`.** Sie befindet sich in Ihrem Repository; `init` hat
die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version bereits
eingetragen, und es ist genau die Datei, die unter
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
beschrieben wird:

```bash
rebase build
docker compose up -d
```

Der Rest dieser Seite beschreibt dasselbe Deployment ohne ein Scaffold im
Hintergrund – das Projekt eines anderen, ein in der CI erstelltes Bundle oder die
beiden Dinge, die die generierte Datei bewusst auslässt: einen Connection-Pooler
und Split-Process-Architekturen. Diese Datei befindet sich im Repository unter
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Nutzen Sie lieber diese, anstatt ein Snippet von dieser Seite zu kopieren: Beide
Dateien werden bei jedem Push vom projekteigenen Acceptance Gate gestartet,
sodass keine von dem abweichen kann, was tatsächlich funktioniert.

Beide stimmen bei jeder Umgebungsvariable überein, mit Ausnahme des
Datenbankpassworts. Das liegt daran, dass jede für ihren eigenen Ersteller
geschrieben wurde: Diese liest `POSTGRES_PASSWORD`, welches von `quickstart.sh`
generiert wird; die generierte Datei liest `DATABASE_PASSWORD`, welches `rebase
init` auch in die `DATABASE_URL` einbettet, die in Ihre `.env` geschrieben wird.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` ist ein einzelner Befehl, der zwei naheliegende Dinge tut und
beide ausgibt. Die ausführliche Variante, falls Sie lieber jeden Schritt selbst
kontrollieren möchten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Sie müssen die Datenbank nicht separat starten – `api` wartet auf deren
Healthcheck.

### Die sechs benötigten Werte

`quickstart.sh` generiert diese für Sie. Um die `.env` manuell zu schreiben:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Drei Secrets, eine Tatsache und das Konto, mit dem Sie sich anmelden:

- **`POSTGRES_PASSWORD`** – das Datenbankpasswort. Eine spätere Änderung
  erfordert auch eine Änderung im Volume, wählen Sie es also einmalig mit
  Bedacht.
- **`JWT_SECRET`** – signiert jede Session. Eine Rotation meldet alle Benutzer
  ab.
- **`REBASE_SERVICE_KEY`** – die Anmeldeinformation (Credential), die Row-Level
  Security für Server-zu-Server-Aufrufe umgeht. Behandeln Sie diesen wie ein
  Root-Passwort: Jeder Dienst, der ihn besitzt, kann jede Zeile lesen.
- **`CORS_ORIGINS`** – die Origins (Ursprünge), von denen Ihr Frontend
  ausgeliefert wird, kommagetrennt. Kein Secret und nicht optional: Die Runtime
  verweigert in der Produktionsumgebung den Start ohne diesen Wert, anstatt
  Vermutungen anzustellen – denn eine API, die ihre erlaubten Origins errät,
  erlaubt früher oder später die falsche.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** – der erste
  Administrator. Eine frische Datenbank enthält keine Benutzer, und außerhalb der
  Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und
  befördert sie zum Administrator – andernfalls wäre eine leere Datenbank eine
  Sackgasse, da das Bootstrapping eines Admins einen Aufrufer erfordert, der
  bereits angemeldet ist. Sobald dieser Stack jedoch unter einem Hostnamen
  erreichbar ist, wird diese Bequemlichkeit zu einer Race Condition, die der
  Betreiber verlieren kann. In der Produktion wird dieses Zeitfenster daher
  geschlossen und das Konto stattdessen hier definiert. Die Runtime erstellt es
  genau einmal, solange die Benutzertabelle leer ist, und tut bei jedem
  nachfolgenden Start nichts weiter.

Jedes der drei Secrets muss mindestens 32 Zeichen lang sein und das
Admin-Passwort mindestens 12. Verwenden Sie eine E-Mail-Adresse mit einem Punkt
in der Domain: `POST /auth/login` parst den Body mit `z.string().email()`,
sodass `admin@localhost` zwar ein Konto initialisieren, danach aber jeden
Versuch, es zu verwenden, ablehnen würde. Die Compose-Datei deklariert alle sechs
Werte mit `${VAR:?…}`, sodass ein fehlender Wert den Stack mit einer
entsprechenden Fehlermeldung stoppt, anstatt ein halb konfiguriertes System zu
starten – und die Selbstregistrierung ist standardmäßig deaktiviert
(`DISABLE_SELF_REGISTRATION`, Standardwert `true`), sodass keine Konten frei
übernommen werden können.

Melden Sie sich mit diesen Anmeldedaten an und ändern Sie das Passwort: Sie
liegen unverschlüsselt in einer Datei auf dem Host.

## Abhängigkeiten

`rebase build` **installiert die Abhängigkeiten Ihres Projekts standardmäßig
direkt in das Bundle**, sodass `dist-bundle` zusammen mit `node_modules` und
einer `package-lock.json` neben der `package.json` ausgeliefert wird. Ein
vendoriertes Bundle startet in etwa fünf Sekunden.

Da sie bereits vorhanden sind, können Sie das Bundle schreibgeschützt
(read-only) mounten – das ist ratsam, da ein kompromittierter Hook dann den Code
nicht umschreiben kann, der nach dem nächsten Neustart ausgeführt wird:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` deaktiviert dieses Verhalten und erzeugt ein Bundle,
das seine Abhängigkeiten stattdessen beim ersten Start installiert, was 40–60
Sekunden pro Start dauert und einen beschreibbaren Mount erfordert.

Für ein produktives Deployment empfiehlt es sich, beides in ein Image
einzubacken, was zudem exakt festlegt, was ausgeführt wird:

```dockerfile
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

## Schema erstellen

**Die Runtime erstellt fehlende Tabellen beim Booten automatisch,
einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist
standardmäßig auf `ensure` gesetzt, was additiv auf das gesamte Schema wirkt:
Fehlende Tabellen, Spalten und Enum-Typen werden erstellt und deren Row-Level
Security wird angewendet. Ein erster Start gegen eine leere Datenbank stellt Ihre
Collections ohne separaten Zwischenschritt sofort bereit.

Was `ensure` ganz bewusst niemals tut, ist das Ändern bereits existierender
Strukturen. Es ändert keinen Spaltentyp, löscht weder Tabellen noch Spalten und
bearbeitet keine Labels vorhandener Enums – denn ein Container-Neustart darf
nicht in der Lage sein, ein Schema als Nebeneffekt eines Deployments
umzustrukturieren.

Es lohnt sich also weiterhin, `rebase db push` für die beiden Dinge auszuführen,
die beim Booten unangetastet bleiben:

```bash
rebase db push
```

- **RLS für Junction-Tabellen** (Verbindungstabellen) bei
  Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein
  eingeschränkter Typ, ein entferntes Feld.

Führen Sie es aus einem lokalen Checkout oder einem CI-Job aus, der auf die
Datenbank des Deployments zeigt. Es führt die Änderung zuerst als Dry-Run aus,
verweigert destruktive Änderungen ohne explizite Bestätigung und kann vor dem
Anwenden ein Backup erstellen. Die Datenbank veröffentlicht in der Compose-Datei
einen Port, damit dieser Befehl sie vom Host aus erreichen kann; entfernen Sie
dieses Port-Mapping, sobald das Schema eingerichtet ist, falls die Datenbank von
außen nicht erreichbar sein soll.

`REBASE_MIGRATE_ON_BOOT` akzeptiert nur `ensure` und `none` und nichts anderes –
das Image **verweigert den Start** bei `push`, aus dem oben genannten Grund.

## Dateispeicher

Der Dateispeicher ist **deaktiviert**, es sei denn, es ist ein Bucket
konfiguriert, und das ist Absicht: Die alternative Standardeinstellung wäre das
Dateisystem des Containers, wodurch jede hochgeladene Datei beim nächsten
Neustart stillschweigend verloren ginge. Uploads werden mit
`501 STORAGE_NOT_CONFIGURED` abgelehnt, bis Sie einen Speicher einrichten.

Für einen Bucket setzen Sie `STORAGE_TYPE=s3` (oder `gcs`) sowie den
entsprechenden Bucket und die Anmeldedaten – die Compose-Datei listet diese
Variablen auskommentiert auf.

Für lokalen Festplattenspeicher, was nur dann angebracht ist, wenn der Pfad ein
echtes Volume ist, das über die Lebensdauer des Containers hinaus existiert:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` ist dort nicht optional: In der Produktion wird ein
`local`-Backend verworfen statt registriert, da die Alternative Uploads wären,
die in einem Dateisystem landen, das kurz vor der Zerstörung steht. Über diese
Variable bestätigen Sie, dass der Mount persistent ist.

### Storage erfordert ein Zugriffskontrollmodell

Sobald ein Bucket konfiguriert **ist**, **verweigert die Runtime in der
Produktion den Start**, bis das Deployment definiert, wie Objekte geschützt
werden. Storage unterliegt nicht der Row-Level Security und seine Keys teilen
sich einen flachen Namespace. Ohne Regeln ist das Einzige, was die Dateien
zweier Benutzer trennt, die Unvorhersehbarkeit der Keys – was durch
`GET /storage/list?prefix=` zunichtegemacht wird. Jede der folgenden Optionen
erfüllt diese Anforderung:

- ein **`storageAuthorize`-Hook** (oder `storagePolicies`) in der Konfiguration
  Ihres Projekts, was die empfohlene Lösung ist und vom Scaffold in
  `config/storage.ts` bereitgestellt wird – keine Umgebungsvariable kann
  ausdrücken: „dieser Benutzer darf diesen Key lesen“;
- **`STORAGE_PUBLIC_READ=true`** für einen Bucket, der tatsächlich ein
  öffentliches, schreibgeschütztes CDN ist;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`** für eine Single-Tenant-App, bei der
  jedem angemeldeten Benutzer jede Datei anvertraut werden kann.

Außerhalb der Produktion führt diese Bedingung lediglich zu einer deutlichen
Warnung statt zu einer Verweigerung. Dies ist also ein Boot-Fehler, der Ihnen
erst beim Deployment und nicht auf dem Entwicklungsrechner begegnet. Das ist
beabsichtigt: Der Fehler, den er verhindert, bliebe sonst unbemerkt.

Setzen Sie auch `MFA_ENCRYPTION_KEY`, wenn Sie TOTP verwenden. Bleibt dieser
ungesetzt, werden gespeicherte Authenticator-Secrets mit `JWT_SECRET`
verschlüsselt – eine Rotation dessen meldet dann alle Benutzer ab *und* macht
jedes registrierte Gerät unentschlüsselbar.

## Andere Plattformen

Die Runtime ist ein gewöhnlicher Container, der auf `$PORT` lauscht, sodass
jede Umgebung funktioniert, die Container ausführen kann. Zwei Dinge müssen
überall beachtet werden:

1. Das Bundle muss unter `/bundle` liegen (oder dort, worauf `REBASE_BUNDLE`
   verweist), mit installierten Abhängigkeiten daneben – siehe
   [Abhängigkeiten](#dependencies).
2. Setzen Sie `CORS_ORIGINS`, `JWT_SECRET` und `DATABASE_URL`. Die Runtime
   verweigert in der Produktion den Start ohne diese Werte, anstatt Vermutungen
   anzustellen.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.20.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie die oben gezeigte Form mit dem abgeleiteten Image, damit das
Bundle mit der App ausgeliefert wird, und führen Sie dann `fly deploy` aus.

### Railway / Render

Verweisen Sie den Dienst auf das abgeleitete Image, setzen Sie die
Umgebungsvariablen und legen Sie den Healthcheck-Pfad auf `/livez` fest.

### Ein einfacher VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` listet die Variablen auf, die gelesen werden. Unter
systemd – die drei Admin-Zeilen sind neu, und unter 0.17.3 wird stattdessen das
erste registrierte Konto zum Administrator:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` ist keine Dekoration. Bleibt dies ungesetzt, läuft der
Prozess im Entwicklungsmodus: Er spiegelt localhost-Origins wider, liefert die
OpenAPI-Spezifikation aus und **lässt das Zeitfenster für den ersten Admin
offen** – sodass der erste Fremde, der das Registrierungsformular findet, zum
Administrator wird. Die beiden Zeilen `REBASE_ADMIN_*` schließen dieses Fenster;
siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

Bevorzugen Sie `EnvironmentFile=/etc/rebase.env` mit Dateiberechtigungen `0600`
gegenüber `Environment=`-Zeilen für die Secrets: Eine Unit-Datei ist für alle
lesbar (world-readable), und `systemctl show` gibt jeden `Environment=`-Wert im
Klartext aus.

## Connection Pooling

Die Runtime verwaltet einen kleinen, langlebigen Pool und benötigt keinen
Pooler. Was jedoch einen benötigt, ist alles andere, was mit derselben Datenbank
kommuniziert und keine Verbindung aufrechterhalten kann: eine Serverless-Funktion,
ein geplantes Skript, ein BI-Tool, ein Queue-Worker, der auf fünfzig Instanzen
skaliert. `max_connections` von Postgres ist ein hartes Limit im unteren
Hunderterbereich und jede Verbindung ist ein eigener *Prozess*, sodass ein
Fan-Out von Lambdas diesen Pool erschöpft, lange bevor die Datenbank
ausgelastet ist.

Die Compose-Datei liefert einen `pgbouncer`-Dienst für diesen Datenverkehr mit,
hinter einem Profil, sodass ein Deployment ohne solche Aufrufer keinen
unnötigen Prozess ausführt:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

Die Client-Authentifizierung wird beim Start aus `DATABASE_URL` generiert,
sodass das Passwort nicht doppelt eingetragen werden muss. Der Pooler
authentifiziert sich bei Postgres mittels `scram-sha-256`, was von Postgres 18
gespeichert wird – die standardmäßige `md5`-Einstellung des Images schlägt beim
*Server*-Login mit `FATAL: server login failed: wrong password type` fehl, was
wie ein falsches Passwort aussieht, aber keines ist.

Halten Sie die Summe von `PGBOUNCER_POOL_SIZE` über alle Pooler hinweg deutlich
unter dem Wert von `max_connections` der Datenbank – die Runtime bedient sich aus
demselben Kontingent.

### Was Transaction Pooling ändert

Ein gepoolter Client hält eine Serververbindung für die Dauer einer Transaktion
und gibt sie danach wieder frei – genau das ermöglicht es 500 Clients, sich 20
Verbindungen zu teilen. Drei Dinge funktionieren über diesen Port nicht mehr, und
jede davon wird von Rebase selbst genutzt – was genau der Grund ist, warum die
Runtime sich direkt verbindet und dieser Port für andere Aufrufer gedacht ist:

- **`LISTEN`/`NOTIFY`.** Realtime basiert darauf, und ein Listener benötigt eine
  Verbindung, die über eine Transaktion hinaus besteht. `LISTEN` wird vom Pooler
  zwar *akzeptiert* – er bestätigt `LISTEN`, aber es wird niemals eine
  Benachrichtigung eintreffen.
- **Session-Status**: `SET` (im Gegensatz zu `SET LOCAL`), anweisungsübergreifende
  Advisory Locks, `WITH HOLD`-Cursor, temporäre Tabellen. Die nächste Transaktion
  landet möglicherweise auf einer anderen Serververbindung, die von alledem
  nichts weiß. Beides scheitert auf dieselbe trügerische Weise: Bei einem
  einzelnen untätigen Client ist der Status meist noch da, sodass es beim Testen
  funktioniert, aber genau unter der Nebenläufigkeit fehlschlägt, für die der
  Pooler eingeführt wurde.
- **Prepared Statements auf Protokollebene.** Den meisten Treibern kann
  mitgeteilt werden, diese nicht zu verwenden – node-postgres tut dies
  standardmäßig nicht; asyncpg benötigt `statement_cache_size=0`.

`SET LOCAL` ist transaktionsgebunden und funktioniert; damit wird auch
Row-Level Security gesetzt – RLS verhält sich über den gepoolten Port also
identisch.

Lassen Sie das Profil deaktiviert, wenn sich nichts außerhalb der Runtime mit
Ihrer Datenbank verbindet. Ein ungenutzter Port stellt eine Angriffsfläche dar.

## Healthchecks

| Pfad | Verwendung |
| --- | --- |
| `/livez` | Liveness. Beantwortet die Frage „Lebt dieser Prozess?“, ohne die Datenbank zu kontaktieren. |
| `/health` | Readiness. Führt einen Datenbank-Roundtrip durch und meldet die Latenz. |

Richten Sie Liveness-Probes auf `/livez` aus. Eine Liveness-Probe auf `/health`
startet bei einem kurzen Schluckauf der Datenbank einen vollkommen gesunden
Prozess neu – was genau dem Zweck widerspricht.

## Metriken

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Stellt Prometheus-Metriken unter `/metrics` bereit: Anzahl der Anfragen und
Latenz-Histogramme, aufgeschlüsselt nach API-Bereich (data, auth, storage,
functions) und Collection, sowie Prozess-Gauges. Ohne Token ist der Endpunkt für
jeden lesbar, der den Port erreichen kann. Setzen Sie daher ein Token, sofern
der Dienst nicht in einem privaten Netzwerk läuft.

## Ausführen von Functions in einem eigenen Prozess

Alles oben Genannte läuft in einem einzigen Container, der das gesamte Projekt
bedient – was für fast jedes Deployment die richtige Form ist. Wenn eine
benutzerdefinierte Function nicht mehr mit der Daten-API um die Event-Loop
konkurrieren soll – oder unabhängig skaliert, neu gestartet werden und
fehlschlagen können soll –, können dasselbe Image und dasselbe Bundle als
mehrere zusammenarbeitende Prozesse gestartet werden. Siehe [Getrennte
Prozesse](/docs/deployment/split-processes/).

## Upgrades

```yaml
image: rebasepro/server:0.20.0
```

Starten Sie neu. Ihr Bundle bleibt unverändert. Innerhalb einer Major-Version
des Runtime-Contracts funktioniert ein validiertes Bundle weiterhin – siehe
[Kompatibilität](/docs/architecture/runtime-and-bundles/#compatibility).

---
