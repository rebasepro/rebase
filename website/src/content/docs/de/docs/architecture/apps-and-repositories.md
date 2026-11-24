---
sourceHash: 531c74d7c70e5df9
title: Apps und Repositories
sidebar_label: Apps & Repositories
description: Ein Projekt besteht aus einem Backend und den damit kommunizierenden Apps, die jeweils in einem eigenen Repository liegen können.
---

## Projekte und Apps

Ein **Projekt** ist das Backend: die Datenbank, Auth, Storage, Realtime und
Functions. Eine **App** ist etwas, das damit kommuniziert.

| Typ | Was es ist |
| --- | --- |
| `backend` | Die Tabellen, Hooks und Functions, die die API definieren. Genau eine pro Projekt. |
| `static` | Ein gebautes Client-Bundle – eine SPA oder statische Website, ausgeliefert unter einem eigenen Pfad oder auf einem eigenen Hostnamen. |

Das ist die gesamte Liste. Das Admin-Panel ist eine `static`-App wie jede
andere: Es wird in Ihrem Repository mit Ihren `frontend/src/cms`-Anpassungen
gebaut, weshalb benutzerdefinierte Felder und benutzerdefinierte Ansichten von
Tag eins an darin funktionieren.

Wer den Serverprozess besitzt, ist eine Eigenschaft des Backends, kein
separater App-Typ:

| `runtime` | Was es bedeutet |
| --- | --- |
| `managed` | Das Runtime-Image der Plattform führt Ihr Bundle aus. Sie stellen Tabellen, Functions, Crons und Schema bereit. |
| `custom` | Sie stellen den Server bereit: Ihr eigenes Dockerfile und Ihren Entrypoint. `rebase eject` richtet dies ein. |

Dies ist unabhängig davon, *wo* es läuft. Beide laufen auf Rebase Cloud und
beide lassen sich selbst hosten – das Ziel befindet sich in
`.rebase/cloud.json`, nicht im Manifest.

Der wichtige Punkt ist, was die Liste *besitzt*. Ein Repository deklariert nur
die Apps, die es enthält; das Projekt besitzt die Menge der existierenden Apps.
Zwei Repositories müssen nie voneinander wissen – sie müssen nur das Projekt
kennen. Das macht ein separates Frontend-Repository oder eine mobile App ganz
ohne Repository-Beziehung zu einem ganz normalen Fall statt zu einem Sonderfall.

## `rebase.json`

Das Manifest deklariert die Topologie und sonst nichts. Schema,
Sicherheitsregeln, Hooks und Functions bleiben in TypeScript, wo ein
Typsystem sie prüfen kann.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

Ein einziger Prozess liefert alles aus: die API unter `/api`, die Website unter
`/`, das Admin-Panel unter `/admin`. Das ist das Self-Hosting-Konzept und eine
vollkommen ausreichende kleine Stufe auf Rebase Cloud.

Der `path` einer statischen App nimmt eine von zwei Formen an:

| `path` | Wo die App antwortet |
| --- | --- |
| `"/"`, `"/admin"` | Unter diesem Pfad auf jedem Hostnamen, auf dem das Projekt ausgeliefert wird. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Nur auf diesem Hostnamen unter dem Pfad dahinter. Siehe [Eine App auf einem eigenen Hostnamen](#eine-app-auf-einem-eigenen-hostnamen). |

Über die URL-Form wird aus einem Projekt mit einer Website pro Domain (wie
einem Vercel- oder Netlify-Projekt pro Domain) ein einziges Rebase-Projekt: eine
statische App pro Hostname, die alle über dasselbe Deployment ausgeliefert
werden.

## Festlegen, wo sich das CMS befindet

`cms` ist der URL-Pfad, unter dem eine App `<RebaseCMS>` mountet. Es ist
optional und das einzige Feld hier, das beschreibt, was sich *innerhalb* einer
App befindet, anstatt wo die App lebt – und es existiert, weil nichts anderes
dies ermitteln kann.

Das CMS ist eine React-Komponente in Ihrem eigenen Frontend, seine Adresse ist
also eine clientseitige Route. Es ist keine Server-Route, keine Datei im Build
und nicht von jedem anderen nicht übereinstimmenden Pfad unter einer SPA zu
unterscheiden – ein Request an `/admin` erhält dasselbe `index.html` wie ein
Request an `/anything-else`. Kein Deploy, kein laufender Server und kein noch so
gründliches Sondieren kann also erkennen, wo sich Ihr Admin-Panel befindet. Wenn
Sie es nicht notieren, weiß es niemand.

Wer es weiß, macht etwas daraus:

- **Rebase Cloud** platziert einen *Open CMS*-Link im Projekt-Header und listet
  die Adresse in der Projektübersicht auf – auf dem eigenen Hostnamen der App,
  falls sie einen hat. Ohne `cms` kann die Konsole nur den Projekt-Host
  anbieten – welcher das CMS nur erreicht, wenn das CMS zufällig im
  Root-Verzeichnis liegt.
- **`rebase dev`** gibt die CMS-URL im Start-Banner aus, wenn es nicht einfach
  die Startseite des Frontends ist.
- **`rebase apps list`** zeigt sie neben der App an, die sie bereitstellt.

Drei Formen, und alle sind ganz alltäglich.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Der Wert ist der Pfad, den man nach dem Hostnamen eingeben würde, kein relativer
Pfad zu `path`, und er muss innerhalb der deklarierenden App liegen – der
SPA-Fallback dieser App antwortet dort. Es ist immer ein Pfad, selbst wenn der
`path` der App eine URL ist: Das CMS befindet sich dann unter diesem Pfad auf dem
Hostnamen der App, sodass `"cms": "/"` oben `https://admin.example.com/`
bedeutet. Ein Projekt hat ein CMS; ein zweites zu deklarieren ist ein Fehler und
kein Münzwurf darüber, auf welches die Konsole verlinkt.

`path` ist sowohl eine Eingabe zur **Build-Zeit** als auch zur Auslieferung.
Eine unter `/admin` gemountete App muss für `/admin` *gebaut* werden,
andernfalls wird `index.html` geladen und jedes Asset liefert einen 404-Fehler –
eine weiße Seite ohne jegliche Fehlermeldung. `rebase build` übergibt den Wert
als `REBASE_APP_BASE`, was Ihr Bundler als Basispfad liest:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

und weigert sich, einen Build auszuliefern, der diesen ignoriert hat.

Ein bestehendes Projekt benötigt keines. Das CLI leitet dasselbe Layout aus der
Verzeichnisstruktur ab, und `rebase apps init` schreibt es fest, wenn Sie es
explizit haben möchten:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

Die Ableitung kann zwei Dinge nicht wissen, die das `rebase.json` eines Scaffolds
deklariert. Sie benennt die statische App `web`, wo ein Scaffold sie `admin`
nennt, und sie kann die `cms`-Route der App nicht kennen. Der Name ändert sich
nicht: Rebase Cloud hat `web` für jedes Projekt registriert, das ohne
`rebase.json` deployed wurde.
`rebase apps init --force` behält die Namen, `path`, `cms`, `routes`,
`frameAncestors`, `redirects` und `cleanUrls` der Apps bei, die von der ersetzten Datei
deklariert wurden, und kennzeichnet eine App, die es nicht mehr findet, als
entfernt.

## Eine App auf einem eigenen Hostnamen

`path` kann auch eine vollständige `https://`-URL sein, was der App einen
eigenen Hostnamen gibt:

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "web": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "https://admin.example.com",
      "cms": "/"
    }
  }
}
```

`https://admin.example.com` liefert `admin` aus. Jeder andere Hostname, auf dem
das Projekt antwortet – `example.com` oder die eigene Adresse des Projekts auf
Rebase Cloud – liefert `web` aus, und `admin` ist dort überhaupt nicht
erreichbar. Es handelt sich nach wie vor um einen einzigen Prozess und ein
einziges Deployment; der Hostname entscheidet lediglich, welche App auf eine
Anfrage antwortet.

Zwei Regeln entscheiden darüber:

- Eine App mit Hostname antwortet nur auf diesem Hostnamen. Eine App ohne
  Hostname antwortet auf jedem Hostnamen.
- Von den verbleibenden Apps gewinnt wie gewohnt diejenige mit dem längsten
  Pfad. Bei gleichem Pfad gewinnt die App, die den Hostnamen angibt, gegenüber
  derjenigen, die dies nicht tut.

Im Beispiel liegen beide Apps auf `/`, daher wählt die zweite Regel auf
`admin.example.com` die App `admin` aus. Deklarieren Sie das Admin-Panel
stattdessen unter `"https://admin.example.com/cms"`, antwortet es auf diesem
Hostnamen nur unter `/cms`: `admin.example.com/pricing` geht an `web`. Ein
Hostname grenzt ein, wo eine App antwortet; er übergibt der App nicht
automatisch alles auf diesem Hostnamen. Keine zwei Apps dürfen sich sowohl
Hostname als auch Pfad teilen.

Das Backend ist keine App, und ein Hostname verschiebt es nicht. `/api`,
`/health` und die anderen Pfade, die das Backend reserviert, werden auf jedem
Hostnamen beantwortet, bevor irgendeine App konsultiert wird, sodass
`https://admin.example.com/api` dieselbe API wie `https://example.com/api` ist.
Eine App, die ihren eigenen Origin aufruft – das leere `VITE_API_URL` des
Scaffolds –, benötigt keine eigene API-URL und keine CORS-Konfiguration. Aus
demselben Grund werden diese Pfade nach einem Hostnamen genauso abgelehnt wie
alleinstehend: `https://admin.example.com/api` ist genauso unzulässig wie
`/api`.

Alles andere bezüglich `path` gilt für den Teil nach dem Hostnamen. Die App
wird nach wie vor dafür gebaut: `https://admin.example.com` wird mit
`REBASE_APP_BASE` auf `/` gebaut, `https://admin.example.com/cms` mit `/cms/`,
und ein Bundler, der dies ignoriert, liefert weiterhin eine weiße Seite. `cms`
ist ein Pfad auf dem Hostnamen der App innerhalb dieses Pfadteils. Die URL muss
`https://` sein und einen Hostnamen sowie einen Pfad enthalten und sonst nichts –
kein Port, keine Query und kein Fragment. Ein bloßes `admin.example.com` wird
abgelehnt, zusammen mit der URL, die es hätte sein sollen.

Unter `rebase dev` wird nichts nach Hostnamen geroutet. Es führt die App in
`frontend/` wie gewohnt am Root eines Localhost-Ports aus, und bei einer App mit
Hostname gibt das Banner zusätzlich die `https://`-Adresse aus, die sie nach dem
Deployment haben wird.

`rebase start` verhält sich anders, da es das gebaute Bundle über dieselbe
Runtime ausführt wie ein Deployment – inklusive Hostname-Routing. Eine App mit
Hostname antwortet nur auf Anfragen, deren `Host` dieser Hostname ist. Daher
zeigt `http://localhost:3001/` die App ohne Hostname an, und ein Bundle, dessen
einzige App einen Hostnamen angibt, antwortet dort mit 404. Um sie lokal zu
erreichen, senden Sie den Header selbst:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

oder leiten Sie den Hostnamen in `/etc/hosts` auf `127.0.0.1` weiter und öffnen
Sie `http://admin.example.com:3001/`. Es gibt bewusst keinen Query-Parameter
oder Header, der das Routing überschreibt: Ein solcher Parameter, der lokal
funktionierte, würde auch bei einem Deployment funktionieren, und die Auswahl
der App anhand von etwas anderem als dem tatsächlichen `Host` ist genau das,
was das Routing verhindern soll.

Beim Self-Hosting trifft der Prozess dieselbe Entscheidung anhand des
`Host`-Headers jeder Anfrage. Den Hostnamen auf den Server zu verweisen und ihm
ein Zertifikat zuzuweisen, liegt in Ihrer Verantwortung, genau wie beim
primären Hostnamen des Projekts. Ein vorgeschalteter Reverse-Proxy muss den
ursprünglichen `Host` weiterleiten – Caddy tut dies standardmäßig, nginx
benötigt `proxy_set_header Host $host;`. `X-Forwarded-Host` wird nicht gelesen,
da jeder Client einen solchen senden kann.

### Auf Rebase Cloud

`rebase cloud deploy` registriert den Hostnamen im Projekt – genau wie
`rebase cloud domains add` –, sodass kein separater Schritt vergessen werden
kann. Was als Nächstes passiert, hängt vom DNS ab:

- **Die Einträge existieren bereits.** Das Deployment verifiziert den Hostnamen,
  und er ist live, sobald das Deployment abgeschlossen ist.
- **Sie existieren nicht.** Das Deployment wird fortgesetzt und gibt die zwei
  anzulegenden DNS-Einträge aus: einen TXT-Record, der nachweist, dass Ihnen
  der Name gehört, und einen CNAME, der auf das Projekt verweist (ein A-Record,
  falls der Hostname der Apex der Domain ist).

Sobald die Records veröffentlicht sind:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` gibt die Records erneut aus, falls Sie sie
verlieren. Ein Hostname, der nicht innerhalb von 7 Tagen nach der Registrierung
verifiziert wird, wird freigegeben, und das nächste Deployment registriert ihn
erneut. Sobald die Verifizierung erfolgreich ist, stellt die Plattform das
HTTPS-Zertifikat für den Hostnamen aus; es muss nichts hochgeladen werden. Bis
dahin antwortet `admin` nirgendwo, da der einzige Hostname, auf dem es
antwortet, das Projekt noch nicht erreicht – der Rest des Projekts ist in jedem
Fall live.

Die Konsole folgt der App auf ihren Hostnamen: Der *Open CMS*-Link und die
CMS-Adresse in der Projektübersicht lauten `https://admin.example.com/`, nicht
der Projekt-Host.

Ein Hostname, den bereits ein anderes Projekt verifiziert hat, führt zum
Abbruch des Deployments, bevor etwas ausgerollt wird – ebenso ein Hostname
unter der plattformeigenen Domain. Ein Hostname, den ein anderes Projekt
registriert, aber nie verifiziert hat, steht Ihnen nicht im Weg: Die Ablehnung
liefert Ihnen einen TXT-Record für Ihr Projekt, und sobald dieser existiert,
übernimmt das nächste Deployment (oder `rebase cloud domains add`) den Hostnamen.
Das Hinzufügen eines Hostnamens, den das Projekt noch nicht besitzt, ändert die
Domains des Projekts, was ein mit `--can deploy` erstellter Access Token nicht
tun darf: Fügen Sie den Hostnamen aus CI heraus einmalig mit
`rebase cloud domains add` hinzu, während Sie angemeldet sind, und das Token
deployt ihn anschließend wie jeden bereits vorhandenen Hostnamen des Projekts.
Das Entfernen der App aus `rebase.json` belässt den Hostnamen im Projekt
registriert; entfernen Sie ihn mit
`rebase cloud domains remove admin.example.com`.

### Ein Hostname gehört zu einer App, nicht zu einer Route

Ein Hostname wird einer gesamten App zugewiesen. Er kann nicht auf eine Route
innerhalb einer App zeigen. Wenn das CMS eine Route einer einzelnen SPA ist –
`web` unter `/` mit `"cms": "/admin"` –, liegt es unter `/admin` auf jedem
Hostname, auf dem das Projekt antwortet. Würde man dieser App
`https://admin.example.com` zuweisen, würde die gesamte SPA dorthin
verschoben, wobei das CMS darunter weiterhin unter `/admin` läge. Um dem CMS
einen eigenen Hostnamen zu geben, machen Sie daraus eine eigene App mit einem
eigenen Build, wie im obigen Beispiel.

## Eine Function unter einem Pfad auf einer App bereitstellen

Eine benutzerdefinierte Function antwortet unter `/api/functions/<name>`, und
eine statische App kann `/api` nicht beanspruchen. Eine Publishing-Website
benötigt jedoch einige Pfade, die kein Build enthalten kann – eine Sitemap und
einen Feed, die die neuesten Beiträge auflisten, eine aus der Datenbank
gerenderte Seite. `routes` liefert die Antwort einer Function unter einem Pfad
auf der eigenen Adresse der App aus:

```jsonc
"site": {
  "type": "static",
  "root": "site",
  "output": "site/dist",
  "path": "https://www.example.com",
  "routes": [
    { "path": "/sitemap.xml", "function": "sitemap" },
    { "path": "/feed.xml", "function": "feed" },
    { "path": "/blog/*", "function": "blog" }
  ]
}
```

`https://www.example.com/sitemap.xml` ist dann das, was `functions/sitemap.ts`
zurückgibt, mit eigenem `Content-Type`, Status und Headern. Alles andere auf dem
Hostnamen ist wie bisher der Build der Website.

- **Exakt oder Wildcard.** `/sitemap.xml` matched nur diesen Pfad. `/blog/*`
  matched `/blog` und jeden Pfad darunter und übergibt den Rest an die Function:
  `/blog/hello` erreicht die `/:slug`-Route der Function, wobei `slug` auf
  `hello` gesetzt ist, und `/blog` erreicht deren `/`-Route.
- **Die Function sieht einen ganz normalen Aufruf.** Der Request erreicht sie
  so, als wäre er an `/api/functions/<name>` gerichtet worden, durch dieselbe
  Authentifizierung, dieselben Scope-Prüfungen, dasselbe Rate-Limit und
  denselben Timeout. Methode, Header, Body und Query-String werden
  durchgereicht, ebenso wie `Host`, sodass `new URL(c.req.url).origin` der
  Origin der Website ist – woraus die absoluten URLs einer Sitemap gebaut
  werden. Die Function antwortet weiterhin auch unter `/api/functions/<name>`.
- **Die spezifischste Route gewinnt**: ein exakter Pfad vor einer Wildcard und
  eine längere Wildcard vor einer kürzeren. Eine Route gewinnt auch gegenüber
  einer Datei mit demselben Pfad im Build, sodass ein veraltetes
  `public/sitemap.xml` sie nicht verdecken kann.
- **Nur dort, wo die App antwortet.** Eine Route gilt für Anfragen, die die App
  selbst beantworten würde – auf ihrem Hostnamen, falls vorhanden, und nicht
  unter dem Pfad einer anderen App. `rebase.json` wird abgelehnt, wenn eine
  Route dort liegt, wo eine andere App antwortet.
- **Innerhalb der App und niemals dem Backend zugehörig.** Der Pfad einer
  Route ist absolut, liegt innerhalb des `path` der App und darf nicht unter
  `/api`, `/health`, `/healthz`, `/livez`, `/readyz` oder `/metrics` liegen
  sowie kein Segment enthalten, das mit `.` beginnt. Eine Wildcard kann nicht
  die gesamte App abdecken, da ihr Build sonst nicht mehr ausgeliefert werden
  könnte.

Routen werden von dem Backend-Prozess ausgeliefert, in den die App integriert
ist, da dort die Functions ausgeführt werden: `rebase build` und
`rebase cloud deploy` integrieren jede statische App in das Bundle des
Backends, und der Build schlägt fehl, wenn eine Route eine Function benennt, die
das Backend nicht besitzt. Eine isoliert deployte statische App hat keine
Functions, die sie aufrufen könnte; daher verweigert `rebase cloud deploy` eine
solche mit Routen, und die Runtime weigert sich, ein reines Static-Bundle zu
starten, das diese deklariert.

Eine geroutete Response, die keine `Content-Security-Policy` sendet, erhält die
der App selbst, sodass die Origins in deren [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app)
eine serverseitig gerenderte Seite ebenso einbetten (frame) können wie den Rest
der Website.

Unter `rebase dev` wird die App von ihrem eigenen Dev-Server ausgeliefert, der
nichts von den Routen weiß; rufen Sie die Function dort unter
`/api/functions/<name>` auf oder testen Sie die Routen mit `rebase start` gegen
einen Build.

## Redirects und Clean URLs

Eine statische App akzeptiert `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`,
einschließlich Weiterleitungen zu einer anderen Domain) und `cleanUrls: true`
(`/x` liefert `x.html` aus). Siehe
[Redirects und Clean URLs](/docs/architecture/redirects-and-clean-urls/), wo
auch ein `vercel.json` auf `rebase.json` abgebildet wird.

## App Links, Universal Links und andere `/.well-known`-Dateien

Android App Links und iOS Universal Links werden verifiziert, indem eine Datei
vom Origin der Website abgerufen wird:
`https://<host>/.well-known/assetlinks.json` und
`https://<host>/.well-known/apple-app-site-association`. Bis eine Plattform
diese abrufen kann, öffnet sich ein angetippter oder gescannter Link im Browser
statt in der installierten App. Legen Sie die Dateien im `.well-known/`-Ordner
des Builds ab (bei Vite: `public/.well-known/`), und die App unter `/` liefert
sie aus:

```text
site/dist/
  index.html
  .well-known/
    assetlinks.json
    apple-app-site-association
```

- **Eine Datei oder ein 404.** `/.well-known/<name>` antwortet mit dieser Datei
  aus dem Build oder 404, wenn der Build keine enthält – niemals mit dem
  `index.html` der App und niemals mit einem Redirect. Dateien mit der Endung
  `.json` und das dateiendungslose `apple-app-site-association` werden als
  `application/json` gesendet; andere anhand ihrer Endung (`security.txt` als
  `text/plain`). Jede Antwort enthält einen `ETag` und
  `Cache-Control: no-cache`.
- **Die Dokumente des Backends haben Vorrang.** `jwks.json`,
  `oauth-protected-resource`, `oauth-authorization-server`,
  `openid-configuration` und `acme-challenge/` werden niemals aus einem Build
  ausgeliefert – selbst in einem Prozess, in dem das Backend sie nicht selbst
  bereitstellt. Ein Build kann somit keine Signaturschlüssel oder OAuth-Metadaten
  veröffentlichen.
- **Keine weiteren Dotfiles.** Ein Segment, das unter `.well-known` mit `.`
  beginnt (`/.well-known/.secret`), sowie jeder andere Dot-Pfad (`/.env`,
  `/.git/config`), werden weiterhin abgewiesen (ob encodiert oder nicht), und
  eine Datei, die ein Symlink aus dem Build heraus ist, wird nicht ausgeliefert.
- **Nur die App unter `/`.** `/.well-known` gehört zum Origin, daher
  veröffentlicht eine App unter einem Pfad (`/admin`) nichts aus ihrem
  `.well-known/`-Ordner. Bei [Apps auf eigenen Hostnamen](#eine-app-auf-einem-eigenen-hostnamen)
  liefert die App jedes Hostnamens unter `/` ihre eigenen Dateien aus, sodass
  `admin.example.com` und `www.example.com` unterschiedliche Dateien
  veröffentlichen können.

Die Dateien werden von dem Backend-Prozess ausgeliefert, in den die App
integriert ist (`rebase start`, ein Self-Hosted- oder Cloud-Deployment), genau
wie der Rest des Builds. Der Pfad einer Route darf nicht unter `/.well-known`
liegen; um eines dieser Dokumente zu generieren, schreiben Sie es in den Build.

## Apps bauen und deployen

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Das Backend wird zuerst gebaut, da der Build einer Client-App ein SDK verwenden
kann, das aus dessen Tabellen generiert wurde.

## Mehrere Repositories

Das Monorepo bleibt der Standard: Ein einziges Repository mit einem Backend und
einem Admin-Panel ist der einfachste funktionierende Ansatz, und `rebase init`
richtet diesen ein. Das Aufteilen ist der nächste Entwicklungsschritt, keine
Voraussetzung.

In einem separaten Frontend-Repository benötigen Sie zwei Dinge – ein
Manifest, das deklariert, was dieses Repository beisteuert, und eine
Verknüpfung mit dem Projekt:

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

Die Verknüpfung wird in `.rebase/cloud.json` geschrieben und wird **nicht
committet** – sie gilt pro Checkout, ähnlich wie ein Git-Remote. Das Manifest
wird committet; der Link nicht.

## Typisierte Clients ohne die Tabellen

Das ist der Mechanismus, der Multi-Repo ermöglicht. Ein Repository, das keine
Tabellen enthält, generiert sein typisiertes SDK direkt aus dem Projekt:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

Das CLI ruft `/api/meta/contract` ab und liest dessen `tables` aus – die
kompilierten Deskriptoren inklusive Relationszielen, die der Typgenerator
benötigt, um zu entscheiden, ob ein Fremdschlüssel ein String oder eine Zahl ist
– und erzeugt exakt dieselbe Ausgabe, die es aus lokalem Quellcode erzeugt hätte.

Der Contract-Endpunkt erfordert den Scope `schema:read`, den ein Administrator
besitzt. Er beschreibt jede Tabelle, Spalte und Relation im Projekt,
einschließlich jener, die keine Sicherheitsregel jemals offenlegen würde;
dabei handelt es sich um ein Abbild der Datenbank, nicht um eine öffentliche
API-Dokumentation.

## Drift erkennen

Das Aufteilen von Repositories bringt einen nennenswerten Nachteil mit sich:
Eine Schema-Änderung und das Frontend, das sie verwendet, landen nicht mehr im
selben Commit. Das Backend kann eine Änderung deployen, die einen Client
lahmlegt, der für die alte Struktur gebaut wurde.

Jedes generierte SDK zeichnet das Schema auf, aus dem es stammt:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Und jedes Projekt veröffentlicht sein aktuelles Schema ohne Authentifizierung,
da ein Versionsstempel nichts über das Schema verrät, für das er steht:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.36.0","contract":1}}
```

Ein Vergleich der beiden in der CI verwandelt eine unbemerkte Diskrepanz in
einen fehlgeschlagenen Check. Der Stempel ändert sich, wenn sich die
generierten Typen ändern könnten – eine neue Eigenschaft, eine geänderte
Relation – und bewusst *nicht*, wenn sich ein Hook, eine Sicherheitsregel oder
ein Icon ändert, sodass kein falscher Alarm ausgelöst wird.

## Client-Konfiguration

```bash
rebase apps config web
```

Gibt aus, was ein Client benötigt, um das Projekt zu erreichen. Es gibt niemals
ein Secret aus: Die API-URL und die veröffentlichbare Identität einer App sind
dafür gedacht, in einem Client-Bundle ausgeliefert zu werden, und alles, was dort
nicht sicher ist, gehört nicht in eine Ausgabe, die letztlich in einer committeten
`.env` landet.

## Verwandte Themen

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) – was `rebase build` erzeugt und was es startet
- [Split Processes](/docs/deployment/split-processes/) – Ausführen eines Bundles als mehrere Prozesse
- [CLI-Befehle](/docs/cli/) – `rebase apps` und der Rest
