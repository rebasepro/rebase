---
sourceHash: 6bb68aec4ebcb624
title: Managed-Backend-Runtime
sidebar_label: Managed Runtime
description: Was ein Backend mit der Runtime „managed“ auf Rebase Cloud kann und was nicht — Pakete und Binärdateien, Arbeitsspeicher und CPU, Timeouts und Body-Größen, das Dateisystem, In-Memory-Status, Secrets, Speicher für generierte Dateien und ausgehender Netzwerkverkehr.
---

Eine Backend-App, die in `rebase.json` wie folgt deklariert ist, läuft auf der **Managed Runtime**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Managed bedeutet, dass Sie ein Bundle ausliefern, kein Image. `rebase cloud deploy` baut Ihre
Collections, `backend/functions/` und Crons in `dist-bundle`, lädt es hoch und
Rebase Cloud startet es auf dem veröffentlichten `rebasepro/server`-Image. Sie schreiben niemals
ein Dockerfile und können auch nicht ändern, was im Image enthalten ist. Diese Seite listet auf,
was dadurch möglich ist, damit Sie ein Feature planen können, bevor Sie es entwickeln.

Die Zahlen hier stammen aus der Runtime und der Plattform im aktuellen Zustand. Einige
sind Stellschrauben, die Sie anpassen können, und die Seite gibt an, welche das sind. Die wenigen Dinge, die
noch nicht zugesichert sind, sind [am Ende](#noch-nicht-zugesichert) zusammengefasst.

## Auf einen Blick

| Frage | Antwort |
|---|---|
| Node-Version | Node 22, auf Debian slim, `linux`/`x64` |
| npm-Pakete | Ja, aus der öffentlichen Registry oder einer privaten. Werden beim Deploy ins Bundle installiert |
| Native Module (`.node`, node-gyp) | Nein. `rebase cloud deploy` lehnt das Bundle ab |
| WebAssembly | Ja |
| Einen Child-Process starten | Ja, für eine `linux`/`x64`-Binärdatei, die ein npm-Paket mitbringt. Siehe [Binärdateien](#binärdateien-und-child-processes) |
| Arbeitsspeicher und CPU | Pro Projekt über `rebase cloud compute` konfigurierbar. Siehe [Compute](#compute-und-instanzen) |
| Instanzen | Standardmäßig 1, immer aktiv. Sie können bis zu 5 Instanzen festlegen oder den Autoscaler bis auf 16 hochskalieren lassen |
| Funktions-Timeout | 30 Sekunden, danach `504 FUNCTION_TIMEOUT`. Konfigurierbar bis zu 10 Minuten |
| Request-Body | 10 MiB, danach `413`. Konfigurierbar, bis zu den 64 MiB, die der Edge-Knoten akzeptiert |
| Beschreibbares Dateisystem | Ja, aber es ist temporär und gehört zu einer einzelnen Instanz |
| Status auf Modulebene (ein `Map`-Cache) | Bleibt zwischen Requests auf einer Instanz erhalten. Geht bei jedem Deploy und Neustart verloren und wird nicht zwischen Instanzen geteilt |
| Umgebungsvariablen und Secrets | `rebase cloud env set`, werden beim nächsten Deploy angewendet |
| Dateispeicher | Ein Bucket pro Projekt, bereitgestellt von Ihrem Backend unter `/api/storage/file/…` |
| Ausgehendes HTTP | Ja, auf den Ports 80 und 443 (sowie 465, 587, 993 für E-Mail). Andere Ports sind blockiert. Keine feste ausgehende IP |

## Code und Pakete

**Node und das Image.** Das Runtime-Image basiert auf `node:22-slim`
(Debian), und Ihr Bundle läuft auf `linux`/`x64` als Nicht-Root-Benutzer. Ihre
`tsconfig` und die Node-Version auf Ihrem Rechner ändern daran nichts.

**Abhängigkeiten.** `rebase cloud deploy` installiert die Abhängigkeiten, die Ihre
`package.json`-Dateien deklarieren, für `linux`/`x64` ins Bundle und lädt sie mit ihm hoch,
sodass eine neue Instanz nichts zu installieren hat. Ein Bundle, das mit ihnen das
Upload-Limit von 1 GB überschreiten würde, wird ohne sie hochgeladen, und der Deploy weist
darauf hin: Jede Instanz installiert sie dann beim Start mit `npm ci` (oder `npm install`
ohne Lockfile). Aus der Art der Installation ergeben sich vier Konsequenzen:

- **Installationsskripte werden niemals ausgeführt.** Die Installation verwendet `--ignore-scripts`. Ein Paket,
  das eine Binärdatei herunterlädt oder in `postinstall` etwas baut, wird ohne
  diese Schritte installiert.
- **Nur Registry-Versionen werden installiert.** Eine `file:`, `link:`, `git+…` oder `github:`-Abhängigkeit
  führt zum Abbruch des Builds, da die Runtime über keine Quelle verfügt, um sie aufzulösen.
- **Manche Pakete stammen aus dem Image, nicht von Ihnen.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` und `zod` werden aus den Abhängigkeiten des
  Bundles entfernt und die Kopien des Images werden verlinkt, sodass Ihre Version davon nicht
  greift. Andere `@rebasepro/*`-Pakete, etwa der Datenbanktreiber, werden wie jede Abhängigkeit
  aus Ihrer `package.json` installiert.
  `typescript` und `tsx` werden ebenfalls entfernt; sie sind Build-Tools.
- **Private Pakete erfordern eine `.npmrc`.** `rebase build` kopiert die `.npmrc` des Projekts
  (und `backend/.npmrc`) in das Bundle, sodass die Installation dieselben
  Registry-Einstellungen verwendet wie Ihr Rechner. Jede Anmeldeinformation darin muss ein
  Verweis auf eine Umgebungsvariable sein, niemals das Token selbst; ein literales Token lässt den
  Build fehlschlagen, da das Bundle zusammen mit Ihrem Code hochgeladen wird:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Der Bundle-Upload ist auf 100 MB komprimiert ohne Abhängigkeiten begrenzt.

**Native Module werden abgelehnt.** Ein Paket, das eine kompilierte `.node`-Binärdatei
mitbringt, kann auf der Managed Runtime nicht geladen werden. `rebase build` warnt davor, und
`rebase cloud deploy` bricht vor dem Upload ab:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Die Prüfung sucht nach bekannten nativen Paketen (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
nach `binding.gyp` oder `gypfile`, nach Installationsskripten, die `node-gyp` oder
`prebuild` aufrufen, und nach `.node`-Dateien. Der
[Leitfaden zum Deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
listet die üblichen Auswege auf. Die Kurzfassung: Erledigen Sie die Arbeit zur Build-Zeit,
rufen Sie einen externen Dienst auf oder deployen Sie mit `runtime: "custom"`.

**WebAssembly funktioniert.** Ein Paket, das eine `.wasm`-Datei ausliefert und aus
JavaScript lädt, ist kein natives Modul, und Node 22 führt es aus. Getestet im
Basis-Image der Runtime mit den Sicherheitseinstellungen des Pods unter Verwendung von `esbuild-wasm`.
Beachten Sie das [Speicherlimit](#compute-und-instanzen), falls das Modul groß ist,
wie etwa ein Sprach- oder ML-Modell.

### Binärdateien und Child-Processes

`child_process` funktioniert. Das Image selbst enthält nur sehr wenig Ausführbares: `node`, `npm`,
`sh`, `tar` und die PostgreSQL-Client-Tools (`pg_dump`, `pg_restore`). Es gibt
kein `ffmpeg`, kein ImageMagick, kein Python und keinen Compiler, und Sie können keine
Systempakete hinzufügen, da es kein Dockerfile gibt und der Prozess nicht als Root läuft.

Eine Binärdatei, die ein npm-Paket **im eigenen Tarball** mitführt, wird mit dem
Paket installiert und ausgeführt. Sie muss für `linux`/`x64` gegen die glibc
(Debian) gebaut sein und läuft als nicht privilegierter Benutzer ohne Linux-Capabilities.
Getestet mit `@esbuild/linux-x64` im Basis-Image der Runtime. Eine Binärdatei, die ein
Paket in `postinstall` *herunterlädt*, wird niemals übertragen, da Installationsskripte
nicht ausgeführt werden; Pakete wie `ffmpeg-static` funktionieren auf diese Weise.

Wenn ein Feature eine Binärdatei benötigt, nutzen Sie eine gehostete API für diese Aufgabe oder stellen Sie
das Backend auf `runtime: "custom"` um, wo Sie Ihr eigenes Image bauen.

## Compute und Instanzen

Jedes Projekt läuft in seinen eigenen Pods. Arbeitsspeicher und CPU gelten pro Instanz und werden
über die [Compute-Einstellungen](/docs/deployment/cloud/#compute-and-what-it-costs) konfiguriert:

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Ein Projekt, für das nie eine Einstellung vorgenommen wurde, läuft als Burstable-Pod: Es reserviert `100m` CPU
und `384Mi` Arbeitsspeicher und kann bis auf 2 CPUs und 2 GiB bursten. Eine konfigurierte Anforderung behält
dieses Verhältnis zwischen Anforderung (Request) und Limit bei. Führen Sie `rebase cloud compute` aus, um zu sehen,
was für Ihr Projekt eingestellt ist.

Instanzen:

- **Standardmäßig eine, immer aktiv.** `--replicas` legt eine feste Zahl zwischen 1 und 5 fest.
  Es gibt kein Herunterskalieren des Backends auf null.
- **Autoscaling ist optional (Opt-in).** `--autoscale-max` legt eine Obergrenze von bis zu 16 fest, und
  `--autoscale-cpu-target` (Standard: 70) die CPU-Auslastung, die der Autoscaler anstrebt.
- **Deploys erfolgen rollierend (Rolling Updates).** Eine neue Instanz startet und wird betriebsbereit, bevor die alte
  gestoppt wird, sodass für kurze Zeit zwei Versionen gleichzeitig Traffic verarbeiten.

`--spot` ist standardmäßig deaktiviert; Spot-Instanzen sind günstiger, werden jedoch ohne
Vorankündigung neu gestartet.

## Arbeitsspeicher und Status auf Modulebene

Ein Wert auf Modulebene, wie `const cache = new Map()` am Anfang einer Funktionsdatei,
lebt im Node-Prozess. Er bleibt auf derselben Instanz von einem Request zum nächsten erhalten.
Er geht jedoch verloren, sobald dieser Prozess beendet wird:

- bei **jedem Deploy**, da jeder Deploy neue Instanzen startet;
- wenn eine **Umgebungsvariable** geändert und bereitgestellt wird;
- wenn eine Instanz neu gestartet, neu zugewiesen oder (mit `--spot`) freigegeben wird.

Bei mehr als einer Instanz verfügt jede über ihre eigene Kopie, sodass zwei Requests
unterschiedliche Caches vorfinden können.

Nutzen Sie eine `Map` auf Modulebene als Cache, dessen Verlust Sie verschmerzen können: ein Cache, der den
nächsten Request beschleunigt, aber nicht die einzige Kopie der Daten darstellt. Speichern Sie alles, dessen
Erzeugung Ressourcen oder Geld gekostet hat – wie generierte Audiodateien oder eine teure API-Antwort –, in der
Datenbank oder im [Dateispeicher](#dateispeicher-für-generierte-dateien). Für Clients, die Sie nur einmal
erstellen, wie ein API-SDK, nutzen Sie `lazyResource`, damit der Client bei der ersten Verwendung
aus der Umgebung des Requests erstellt wird. Siehe
[Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

Unter [Mehrere Instanzen betreiben](/docs/deployment/multiple-instances/) finden Sie eine Auflistung
des Status, den Rebase selbst pro Prozess vorhält, wie Rate-Limit-Zähler und
Realtime-Channels.

## Das Dateisystem

Das Dateisystem des Containers ist beschreibbar, und `/tmp` funktioniert. Aber alles,
was dorthin geschrieben wird:

- gehört zu einer einzelnen Instanz und ist für andere Instanzen nicht sichtbar;
- wird gelöscht, wenn die Instanz stoppt, spätestens also beim nächsten Deploy;
- teilt sich ein Limit von 6 GiB an flüchtigem Speicher (Ephemeral Storage) mit dem Bundle und den installierten
  `node_modules`. Eine Instanz, die dieses Limit überschreitet, wird beendet (evicted).

Nutzen Sie es für temporäre Arbeitsdateien während eines einzelnen Requests. Verwenden Sie es nicht als Cache über
Deploys hinweg oder als Speicher für Uploads. Das ist auch der Grund, warum
[`STORAGE_TYPE=local` in der Produktionsumgebung deaktiviert ist](/docs/backend/storage/#environment-variables).

## Requests

| Limit | Standard | Ändern mit |
|---|---|---|
| Funktions-Timeout | 30 s, danach `504` mit Code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` deaktiviert es) |
| Warten auf Ihre Instanz am Edge | 10 Minuten zwischen Lese- oder Schreibvorgängen | Fest |
| Request-Body, `/api/*`-Routen ohne eigenes Limit | 10 MiB, danach `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in Bytes |
| Request-Body am Edge | 64 MiB | Fest |
| Einzelne Datei über `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Anonyme Aufrufe an `/api/functions/*` | 3000 pro IP pro 15 Minuten | `rateLimit.anonymousFunctions` |

Einige Details:

- **Das Timeout bricht den Aufrufer ab, nicht die Arbeit.** Nach 30 Sekunden erhält der Aufrufer
  ein `504`, und `getSignal(c)` wird abgebrochen (aborted). Übergeben Sie dieses Signal an `fetch` und
  alles andere, was ein Signal akzeptiert, damit auch die Hintergrundarbeit stoppt. Siehe
  [Timeouts und Rate-Limits](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **Der Edge-Knoten wartet länger als die Runtime.** Der Ingress vor Ihren
  Instanzen wartet bis zu 10 Minuten. Das Limit, auf das ein Request trifft, ist somit das der Runtime,
  die mit JSON antwortet und das Signal abbricht. Erhöhen Sie `REBASE_FUNCTIONS_TIMEOUT_MS`
  bis zu diesem Wert. Für Arbeiten, die länger dauern oder die einen Deploy überstehen müssen (eine
  Instanz hat eine Drain-Zeit von 15 Sekunden), antworten Sie sofort und führen Sie die Arbeit in einem
  [Job](/docs/backend/jobs/) aus.
- **Uploads größer als 64 MiB** erfordern den fortsetzbaren Upload (TUS), der
  die Datei in Chunks sendet. `client.storage.putObject()` wechselt ab 8 MiB automatisch
  dorthin.
- **Response-Größe.** Weder die Runtime noch der Edge setzen ein Limit für die Response-Größe.
  Eine große Response verbleibt dennoch im Arbeitsspeicher, wenn Ihr Handler sie an einem Stück
  zusammenbaut; streamen Sie sie daher oder liefern Sie sie direkt aus dem Speicher aus.

## Umgebungsvariablen und Secrets

Setzen Sie diese über das CLI oder in der Konsole. Es gibt dafür kein Feld in
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Eine Änderung wird beim nächsten Deploy wirksam.** Laufende Instanzen behalten die Werte,
  mit denen sie gestartet wurden. `set` und `unset` weisen Sie darauf hin
  (`Pending redeploy`).
- **Limits:** bis zu 100 Variablen pro Projekt, 32 KiB pro Wert und 256 KiB
  insgesamt. Namen folgen dem Muster `[A-Za-z_][A-Za-z0-9_]*`.
- **Manche Namen sind reserviert.** Die Plattform setzt `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` und `NODE_ENV` selbst und legt fest, wie der Prozess
  ausgeführt wird (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Das Setzen einer dieser Variablen wird
  abgelehnt, und die Fehlermeldung listet sie alle auf.
- **`CORS_ORIGINS` basiert standardmäßig auf Ihren Domains.** Die Plattform setzt diesen Wert auf den
  Host des Projekts und seine verifizierten [benutzerdefinierten Domains](/docs/deployment/cloud/#the-rest-of-the-surface).
  Ein von Ihnen gesetztes `CORS_ORIGINS` wird dieser Liste hinzugefügt, falls ein Frontend von
  woanders ausgeliefert wird: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Die Storage-Variablen sind Standardwerte.** Die Plattform schreibt die `STORAGE_*`-
  und `S3_*`-Variablen für ihren Bucket; ein von Ihnen festgelegter Wert überschreibt diese.
- **Build-Time-Variablennamen werden abgelehnt.** Variablen mit `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` und
  `REACT_APP_` sind für Frontends zur Build-Zeit gedacht, und das Backend
  sieht sie ohnehin nie rechtzeitig. `--force` speichert sie dennoch.

Lesen Sie diese in einer Funktion immer innerhalb des Handlers aus, niemals auf Modulebene am Anfang der Datei:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Ein Lesezugriff auf `process.env` im Modul-Scope, der fehlschlägt oder leer ist, führt dazu, dass die gesamte Datei
nicht geladen werden kann und ihre Routen mit `404` antworten. Siehe
[Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Dateispeicher für generierte Dateien

Ein Cloud-Projekt erhält Dateispeicher, sobald Sie ihn anlegen:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Oder verknüpfen Sie das Projekt über `rebase cloud storage attach` mit einem Bucket, den Sie bereits besitzen
(S3, R2, MinIO oder jeder S3-kompatible Bucket).
Ohne eine dieser Optionen antworten Uploads mit `501 STORAGE_NOT_CONFIGURED`. Weitere Buckets werden
in `config/resources.ts` deklariert; siehe
[Mehrere Buckets](/docs/backend/storage/#several-buckets).

Ein Deploy mit Dateispeicher wird abgewiesen, bis das Projekt festlegt, wer Dateien lesen und schreiben
darf. Die Gerüstdatei `config/storage.ts` exportiert hierfür einen `storageAuthorize`-Hook.
Siehe [Autorisierung pro Objekt](/docs/backend/storage-authorization/).

**Wie Dateien ausgeliefert werden.** Ihr Backend liefert jede Datei unter
`GET /api/storage/file/<key>` aus. Es liest das Objekt aus dem Bucket und streamt
es, inklusive `Content-Type`, Range-Requests und Caching-Headern. Es gibt keine direkte
Bucket-URL, die herausgegeben werden könnte.

- Ein Schlüssel unter **`public/`** wird für jeden ohne Token unter einer URL
  ausgeliefert, die sich niemals ändert. Nutzen Sie dies für Dateien, die jeder Besucher laden darf,
  wie etwa generiertes Audio für ein öffentliches Spiel.
- Jeder andere Schlüssel ist privat. Ein Client fragt bei `/api/storage/metadata/<key>` nach einer
  Download-URL an, die ein Token enthält, das standardmäßig für 300 Sekunden gültig ist
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, konfigurierbar bis zu einer Woche).

Aus einer Funktion heraus schreiben Sie mit `rebase.storage` (der Standard-Bucket) oder
`rebase.bucket(…)` (ein benannter Bucket). Ihr `storageAuthorize`-Hook entscheidet
nach wie vor, ob der Schreibvorgang erlaubt ist.

Bildtransformationen (`?width=`, `?format=`) erfordern `sharp`, was ein natives Modul ist
und sich nicht im Managed-Image befindet. Auf der Managed Runtime liefert eine
Transformationsanfrage das Originalbild zurück.

### Beispiel: Generierte Audiodaten cachen

Eine Funktion, die Text über eine gehostete API in Sprache umwandelt, jedes Ergebnis
einmalig speichert und danach aus dem Dateispeicher ausliefert. Die `Map` erspart lediglich
eine Speicherabfrage auf einer aktiven Instanz; der Bucket ist der eigentliche Cache, sodass bei einem Deploy
nichts verloren geht.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

Die Route ist öffentlich, wie jede Route in `backend/functions/`, bis Sie sie
absichern. Eine produktive Implementierung würde prüfen, wer neue Audiodaten generieren darf,
damit Fremde nicht Ihr Budget für die Speech-API aufbrauchen.

## Ausgehendes Netzwerk

Funktionen können externe Dienste aufrufen. Ausgehende Verbindungen von Ihren Instanzen
sind zu jeder Internetadresse ausschließlich auf diesen TCP-Ports erlaubt:

| Port | Zweck |
|---|---|
| 80, 443 | HTTP und HTTPS |
| 465, 587 | E-Mail-Versand über SMTP mit TLS oder STARTTLS |
| 993 | IMAP über TLS |

Alles andere ist blockiert. Das umfasst Port 25, einfaches IMAP sowie Datenbanken oder
Caches auf ihren Standard-Ports: Redis auf 6379 oder MongoDB auf 27017 außerhalb von
Rebase Cloud kann nicht erreicht werden. Die Cloud-Metadatenadresse
(`169.254.169.254`) ist ebenfalls blockiert.

Die einzige Ausnahme ist Ihre eigene Datenbank. Bringt das Projekt sein eigenes
PostgreSQL mit (BYODB), erlaubt jedes Deployment zusätzlich Verbindungen zum Host dieser
Datenbank auf dem Port in ihrem Connection-String, und zu nichts anderem auf diesem Port.
Der Host wird beim Deployment in seine IP-Adressen aufgelöst; zieht Ihr Provider die
Datenbank auf eine andere Adresse um, deployen Sie erneut. Die Datenbank muss Verbindungen
aus dem Internet annehmen: Die App verbindet sich direkt mit dem Connection-String. Die
Einstellungen des SSH-Bastion-Hosts werden nur vom Verbindungstest verwendet, nicht von der
deployten App.

Die Plattform fügt keinen Proxy und kein ausgehendes Rate-Limit hinzu; die von Ihnen aufgerufenen Dienste
haben ihre eigenen Limits. Übergeben Sie `getSignal(c)` an `fetch`, damit ein Aufruf stoppt,
wenn der zugehörige Request ein Timeout erreicht.

Es gibt **keine feste ausgehende IP-Adresse**. Der Datenverkehr wird über eine Adresse geleitet,
die von allen Projekten geteilt wird, vom Cloud-Provider zugewiesen wird und sich ändern kann. Fügen Sie diese
daher nicht zu einer Allowlist von Drittanbietern hinzu. Authentifizieren Sie sich bei solchen Diensten
stattdessen mit einem Schlüssel.

## Start und Shutdown

- **Kaltstart.** Eine neue Instanz lädt das Bundle herunter und entpackt es, bevor sie
  Requests verarbeitet, daher verlangsamt ein großer Abhängigkeitsbaum jedes Hochskalieren.
  Ein ohne seine Abhängigkeiten hochgeladenes Bundle installiert sie zusätzlich, was 40 bis
  60 Sekunden kostet. Die Plattform wartet bis zu 300 Sekunden darauf, dass eine Instanz
  hochfährt.
- **Health-Checks.** Die Plattform prüft `/livez` (der Prozess läuft) und
  `/health` (die Datenbank ist erreichbar). Beide Endpunkte werden von der Runtime bereitgestellt,
  Sie müssen sie also nicht selbst implementieren.
- **Shutdown.** Bei einem Deploy oder Neustart nimmt die Instanz keine neuen Requests mehr an,
  wartet 5 Sekunden, damit der Traffic umgeleitet werden kann, und empfängt dann `SIGTERM`. Laufende
  Requests haben bis zu 15 Sekunden Zeit, um abgeschlossen zu werden. Promises, die an `waitUntil` übergeben wurden,
  erhalten davon bis zu 5 Sekunden. Ein Promise, das nicht an `waitUntil` übergeben wurde, wird abgebrochen.
  Siehe [Hintergrundarbeit](/docs/backend/custom-functions/#background-work).

## Wann Managed nicht die richtige Wahl ist

Wechseln Sie für das Backend zu `"runtime": "custom"`, wenn Folgendes benötigt wird:

- ein natives Modul oder eine System-Binärdatei, die kein npm-Paket mitbringt, wie etwa `sharp`,
  ImageMagick oder eine lokale Speech-Engine;
- Systempakete oder ein anderes Basis-Image;
- eine langlebige Verbindung zu einem Dienst außerhalb der erlaubten Ports.

Eine Custom Runtime baut Ihr eigenes Dockerfile, und Sie verwalten das Image fortan
selbst. `rebase cloud deploy --eject` führt den Wechsel durch. Siehe
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Noch nicht zugesichert

- **Log-Historie.** `rebase cloud logs --runtime` liest Logdaten von den aktuell laufenden
  Instanzen und `rebase cloud debug logs --previous` von der letzten Ausführung einer
  Instanz, die neu gestartet wurde. Die Ausgabe einer Instanz, die durch ein Deploy ersetzt wurde, ist verloren. Schreiben
  Sie alle Daten, die Sie aufbewahren müssen, in die Datenbank oder in einen eigenen Logging-Dienst.
- **Skalierung auf null (Scale to zero)** wird nicht angeboten. Jedes Backend betreibt zu jeder Zeit
  mindestens eine Instanz.

## Weiterführende Seiten

- [Rebase Cloud](/docs/deployment/cloud/): Verknüpfung, Deployment, Compute-Einstellungen
  und was die Beta nicht beinhaltet
- [Custom Functions](/docs/backend/custom-functions/): Routen in
  `backend/functions/` schreiben
- [Runtime und Bundles](/docs/architecture/runtime-and-bundles/): Was ein Bundle
  ist und wie die Runtime es startet
- [Dateispeicher](/docs/backend/storage/): Buckets, Endpunkte, Größenbeschränkungen und Zugriffsregeln
- [Mehrere Instanzen betreiben](/docs/deployment/multiple-instances/): Der
  Status, den Rebase pro Prozess vorhält
