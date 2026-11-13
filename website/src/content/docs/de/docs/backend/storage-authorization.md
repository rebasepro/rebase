---
sourceHash: 1e1ed4905f58d5fd
title: Storage-Autorisierung
sidebar_label: Storage-Autorisierung
description: Bestimmen Sie mit storagePolicies und dem storageAuthorize-Hook, wer jedes Storage-Objekt lesen, schreiben, löschen oder auflisten darf, und welche Storage-Scopes ein API-Schlüssel benötigt.
---

Tabellen werden durch Row-Level Security geschützt; ein Bucket hat kein Äquivalent auf Objektebene, daher wird der Storage hier autorisiert. [Storage-Konfiguration](/docs/backend/storage/) behandelt die Backends selbst.

## Policies

Die deklarative Form. Eine Liste von Pfadmustern, die ausgewertet wird, ohne Code auszuführen:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Ein Schlüssel, auf den keine Policy zutrifft, wird abgelehnt**, es sei denn, ein `storageAuthorize`-Hook erlaubt ihn: Der Hook wird nur aufgerufen, wenn für diese Operation keine Policy auf den Schlüssel zutraf, und keines von beiden kann das andere einschränken. Eine Policy, die zutraf und keinen Zugriff gewährt hat, ist endgültig. Jede Erweiterung ist eine explizite Zeile, und ein Fehler verweigert den Zugriff, anstatt ihn zu gewähren.

Muster vergleichen **nach Segmenten, niemals nach Teilzeichenfolgen** — `public/**` passt nicht auf `publicity/secret.png`:

| Muster | Treffer |
|---|---|
| `avatars/logo.png` | genau dieser Schlüssel |
| `users/*/avatar.png` | genau ein Segment anstelle von `*` |
| `users/:uid/**` | ein erfasstes Segment, dann der Rest — einschließlich nichts |

`**` ist nur als abschließendes Segment zulässig. `:name` erfasst ein einzelnes Segment und überspannt niemals ein `/`; Erfassungen werden als `params` an das Prädikat übergeben.

`allow` ist `"public"` (jeder, den die Route zulässt), `"authenticated"` (jeder Aufrufer mit einer uid) oder ein Prädikat, das die erfassten Parameter, den Benutzer, die Operation und den Bucket empfängt.

Eine Policy wird nach der Authentifizierung der Route ausgeführt, daher öffnet `"public"` allein keinen Pfad für anonyme Aufrufer. Wenn `requireAuth` aktiviert ist, erreichen sie nur Lesevorgänge von `public/`-Schlüsseln oder jeden Lesevorgang mit `storagePublicRead`; `/upload`, `/list`, Löschvorgänge und Resumable Uploads erfordern immer einen Aufrufer. Andernfalls lautet die Antwort `401`.

`operations` ist standardmäßig auf alle vier eingestellt — `read`, `write`, `delete`, `list`.

Policies erfüllen den Boot-Schutz für die Produktion bereits für sich allein, und ein fehlerhaft formatiertes Muster lässt den Start fehlschlagen und nicht erst den ersten Upload.

## Der Hook

`requireAuth` und `publicRead` sind *globale* Schalter: Sie entscheiden, ob ein Aufrufer angemeldet sein muss, nicht worauf dieser Aufrufer zugreifen darf. Ohne einen Autorisierungs-Hook **kann jeder authentifizierte Benutzer jeden Schlüssel lesen, dessen Namen er kennt** — das Einzige, was die Dateien zweier Mandanten trennt, ist die Unvorhersehbarkeit von Schlüsseln, was kein Zugriffskontrollmodell ist. Schlimmer noch: Sie können zuerst `GET /storage/list?prefix=` aufrufen, sodass die Schlüssel nicht einmal erraten werden müssen.

:::caution[Storage startet in der Produktion nicht ohne einen Hook]
Tabellen werden durch Row-Level Security geschützt; Storage hingegen nicht. Es gibt im Bucket kein Äquivalent auf Objektebene, daher *ist* dieser Hook das Sicherheitsmodell — und `initializeRebaseBackend` **löst beim Start unter `NODE_ENV=production` einen Fehler aus**, wenn Storage konfiguriert ist und keines der folgenden Elemente gesetzt ist:

- `storageAuthorize` — ein Hook, pro Objekt. Empfohlen.
- `storagePolicies` — die oben deklarierten Regeln.
- `storagePublicRead: true` — der Bucket ist tatsächlich ein öffentliches Read-Only-CDN.
- `storageInsecureAllowAnyAuthenticated: true` — eine Single-Tenant-Anwendung, bei der jedem angemeldeten Benutzer bei jeder Datei vertraut wird. Bewusst so benannt, um zweimal gelesen zu werden.

In der Entwicklungsumgebung wird stattdessen eine Warnung protokolliert, sodass ein Projekt diesbezüglich fehlerhaft konfiguriert sein und lokal einwandfrei funktionieren kann, bis es bereitgestellt wird. Ein über ein Gerüst (Scaffolding) erstelltes Projekt enthält bereits einen Hook in `backend/storage.ts` — lesen Sie diesen, bevor Sie ihn ersetzen, und beachten Sie, dass er eine *gemeinsame Inhaltsbibliothek* eines CMS modelliert, was nicht dieselbe Struktur wie benutzerspezifische Dateien ist.
:::

`storageAuthorize` ist das Storage-Analogon zum `rls` einer Tabelle und wird nach der Authentifizierung bei jeder Storage-Route ausgeführt:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Feld | Beschreibung |
|-------|-------------|
| `key` | Objektschlüssel, Bucket-Präfix entfernt und Pfadbereinigung durchgeführt |
| `bucket` | Aufgelöster Bucket (`"default"`, wenn nicht angegeben) |
| `operation` | `"read"`, `"write"`, `"delete"` oder `"list"` |
| `user` | `{ uid, email?, roles? }`, oder `null`, wenn die Route anonymen Zugriff erlaubt |
| `storageId` | Das benannte Backend, wenn die Anfrage auf eines abzielte — dessen kanonischer Schlüssel (`storageId=%20media` ist `"media"`). Nicht vorhanden für die Standardquelle, unabhängig davon, wie die Anfrage sie benannt hat (kein Parameter, leer oder `(default)`) |
| `data` | Vertrauenswürdiger Lesezugriff unter **Umgehung von RLS** — `data.table(slug).find(query)` / `.findById(id)`. Die Eigentümerschaft liegt in einer Zeile, nicht in einem Schlüsselpräfix, daher benötigt der Hook einen Reader, um die Frage „Wem gehört dieses Objekt?“ zu beantworten. Row-Level Security wird bewusst umgangen: Dieser Hook *ist* die Autorisierungsentscheidung, und sie über einen Reader zu treffen, der bereits durch die Berechtigungen des Aufrufers eingeschränkt ist, wäre zirkulär. Konstruktionsbedingt schreibgeschützt (Read-only). |

Geben Sie `false` zurück, um mit einem **403** abzulehnen. Das Auslösen einer Exception (Throw) lehnt ebenfalls ab — eine fehlgeschlagene Eigentümerprüfung bleibt nicht versehentlich offen.

Gut zu wissen:

- **Auf der Metadaten-Route wird der Lesezugriff tatsächlich entschieden.** Sie erzeugt das kurzlebige, pfadgebundene Download-Token, dem die Datei-Route vertraut, weshalb der Hook den Zugriff dort regelt. Zwei Lesevorgänge umgehen den Hook absichtlich. Einer, der ein solches Token mitführt: Der Hook hat ihn genehmigt, als das Token ausgestellt wurde, und zwar ausschließlich für diesen Pfad und diese Quelle; ein Hook, der die Anfrage nun verweigern würde (z. B. weil eine Mitgliedschaft inzwischen widerrufen wurde), stoppt ihn nicht, bevor das Token abläuft — `storageDownloadTokenTtl`, standardmäßig 300 Sekunden. Und das Lesen eines Schlüssels unter `public/` durch einen Aufrufer ohne Anmeldedaten: Das Präfix ist die Deklaration, dass jeder ihn lesen darf, einschließlich anonymer Besucher und CDNs. Bei einem angemeldeten Aufrufer wird dennoch der Hook konsultiert, bei einem anonymen jedoch nicht, sodass ein Hook einen `public/`-Schlüssel nicht privat machen kann; speichern Sie die Datei stattdessen außerhalb von `public/`. Nur diese beiden Lesevorgänge überspringen ihn: Ein Benutzer, den Ihr Auth-Adapter zufällig `public` nennt, wird wie jeder andere geprüft.
- **Ein Bucket, ein Name.** Auf S3 und GCS ist der `bucket` des Hooks immer `"default"`, auch wenn eine Anfrage den Bucket des Providers beim Namen nennt, der dieselben Objekte erreicht.
- **Ein Pfad ist öffentlich, wenn der Schlüssel, den er benennt, öffentlich ist.** Das `public/`-Präfix wird anhand des kanonischen Schlüssels geprüft, den die Route bereitstellt — nachdem ein führendes `default/`-Bucket-Segment entfernt und `//`, `./` sowie ein führendes `/` bereinigt wurden — niemals anhand der URL, wie sie geschrieben steht. `/api/storage/file/notes://public/x.txt` benennt den privaten Schlüssel `notes:/public/x.txt`, und der Schlüssel `default/public/x.txt` (erreichbar als `/api/storage/file/default/default/public/x.txt`) liegt in einem Ordner namens `default`; keiner von beiden ist öffentlich. Testen Sie in einem Hook den übergebenen `key` mit `isPublicStorageKey` aus `@rebasepro/types` — `isPublicStoragePath` liest einen clientseitigen Pfad oder eine URL und stuft beide als öffentlich ein.
- **`list` wird über das Präfix geregelt.** Über Listings entdeckt man Schlüssel, von denen man bisher nichts wusste.
- **Resumable (TUS) Uploads werden beim Erstellen geprüft**, sodass ein abgelehnter Upload keine temporäre Datei hinterlässt.
- Das Weglassen des Hooks (und von `storagePolicies`) führt dazu, dass keine Prüfung auf Objektebene stattfindet; die Produktion verweigert daher den Start, sofern nicht `storagePublicRead` oder `storageInsecureAllowAnyAuthenticated` gesetzt ist.

## API-Schlüssel und Tokens

Eine angemeldete Person besitzt jeden Storage-Scope, sodass der Hook und die obigen Policies für sie entscheiden. Ein [API-Schlüssel](/docs/backend/api-keys/) benötigt zusätzlich den Storage-Scope für die Operation auf der in der Anfrage angegebenen Quelle: `storage:read` für Downloads, Metadaten und Auflistungen, `storage:write` für Uploads, Ordner und jeden Schritt eines Resumable Uploads, `storage:delete` für Löschvorgänge. Das Ziel ist die Quell-ID, und die ID der Standardquelle ist `(default)`: `storage:read:(default)`, `storage:write:avatars`. Ohne diesen lautet die Antwort `403 SCOPE_MISSING`. Mit ihm wird der Hook weiterhin ausgeführt — und zwar im Namen der Entität, als die der Schlüssel agiert.

## Nächste Schritte

- **[Storage-Konfiguration](/docs/backend/storage/)** — Backends, Endpunkte und Limits
- **[API-Schlüssel](/docs/backend/api-keys/)** — die Scopes, die ein Schlüssel beinhaltet
