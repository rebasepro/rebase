---
sourceHash: 31645b4c27077651
title: Storage-Autorisierung
sidebar_label: Storage-Autorisierung
description: Entscheiden Sie mit storagePolicies und dem storageAuthorize-Hook, wer jedes Storage-Objekt lesen, schreiben, löschen oder auflisten darf und welche Storage-Scopes ein API-Schlüssel benötigt.
---

Tabellen werden durch Row-Level Security geschützt; ein Bucket hat kein objektbezogenes Äquivalent, daher wird der Speicher hier autorisiert. Die [Storage-Konfiguration](/docs/backend/storage/) behandelt die Backends selbst.

## Policies

Die deklarative Form. Eine Liste von Pfadmustern, die ausgewertet werden, ohne Code auszuführen:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Ein Schlüssel, auf den keine Policy zutrifft, wird abgelehnt**, es sei denn, ein `storageAuthorize`-Hook erlaubt ihn: Der Hook wird nur aufgerufen, wenn für diese Operation keine Policy auf den Schlüssel zutraf, und keines von beiden kann das andere einschränken. Eine Policy, die zutraf und keinen Zugriff gewährte, ist endgültig. Jede Erweiterung ist eine explizite Zeile, und ein Fehler führt eher zur Verweigerung als zur Gewährung.

Muster prüfen **nach Segmenten, niemals nach Teilzeichenfolgen** – `public/**` stimmt nicht mit `publicity/secret.png` überein:

| Muster | Treffer |
|---|---|
| `avatars/logo.png` | exakt dieser Schlüssel |
| `users/*/avatar.png` | genau ein Segment an der Stelle von `*` |
| `users/:uid/**` | ein erfasstes Segment, dann der Rest – einschließlich nichts |

`**` ist nur als abschließendes Segment zulässig. `:name` erfasst ein Segment und umfasst niemals ein `/`; die erfassten Werte werden als `params` an das Prädikat übergeben.

`allow` ist `"public"` (jeder, den die Route zulässt), `"authenticated"` (jeder Aufrufer mit einer uid) oder ein Prädikat, das die erfassten Parameter, den Benutzer, die Operation und den Bucket empfängt.

Eine Policy wird nach der Authentifizierung der Route ausgeführt, sodass `"public"` allein keinen Pfad für anonyme Aufrufer öffnet. Wenn `requireAuth` aktiviert ist, erreichen sie nur Lesezugriffe auf `public/`-Schlüssel oder jeden Lesezugriff mit `storagePublicRead`; `/upload`, `/list`, Löschungen und fortsetzbare Uploads erfordern immer einen Aufrufer. Andernfalls lautet die Antwort `401`.

`operations` gilt standardmäßig für alle vier Operationen – `read`, `write`, `delete`, `list`.

Policies erfüllen die Boot-Schutzprüfung für die Produktion bereits für sich allein, und ein fehlerhaftes Muster führt bereits beim Start zum Abbruch und nicht erst beim ersten Upload.

### Als Daten: `STORAGE_POLICIES`

<span class="since-badge" data-since="0.35">Seit 0.35</span>

Die verwaltete Runtime kann kein Prädikat aus Ihrem Code lesen, und ein Projekt auf dem Standard-Backend von Rebase Cloud verfügt über keinen Code, der gelesen werden könnte. Daher können dieselben Regeln als JSON in der Umgebungsvariablen `STORAGE_POLICIES` hinterlegt werden, wobei die beiden Prädikate, die nahezu jede App benötigt, über Namen statt Code definiert werden:

```bash
STORAGE_POLICIES='[
  { "path": "public/**", "operations": ["read"], "allow": "public" },
  { "path": "users/:uid/**", "allow": "owner" },
  { "path": "**", "allow": { "roles": ["admin"] } }
]'
```

| `allow` | Gewährt Zugriff für |
|---|---|
| `"public"` | jeden, den die Route zulässt |
| `"authenticated"` | jeden angemeldeten Aufrufer |
| `"owner"` | den angemeldeten Aufrufer, dessen uid dem `:uid`-Segment des Schlüssels entspricht – der `path` muss eines erfassen |
| `{ "roles": [...] }` | einen angemeldeten Aufrufer, der eine dieser Rollen besitzt |

Diese werden zu `storagePolicies` kompiliert, daher entsprechen Musterabgleich, Reihenfolge und der Fallback auf `storageAuthorize` der Code-Form: Ein Schlüssel, der von keiner Regel abgedeckt wird, wird an den Hook übergeben, sofern das Projekt über einen verfügt, andernfalls wird er abgelehnt. Ein Wert, der keine gültige Liste darstellt, verhindert den Systemstart unter Angabe des jeweiligen Problems; Rebase Cloud verweigert das Speichern eines solchen Werts, und die Konsole ermöglicht das Bearbeiten der Liste unter **File storage → Access rules**.

## Der Hook

<span class="since-badge" data-since="0.35">Seit 0.35</span>

`requireAuth` und `publicRead` sind *globale* Schalter: Sie entscheiden, ob ein Aufrufer angemeldet sein muss, nicht, worauf dieser Aufrufer zugreifen darf. Ohne einen Autorisierungs-Hook kann **jeder authentifizierte Benutzer jeden Schlüssel lesen, den er benennen kann** – das Einzige, was die Dateien zweier Mandanten trennt, ist die Unvorhersehbarkeit der Schlüssel, was kein Zugriffskontrollmodell darstellt. Schlimmer noch: Aufrufer können zuerst `GET /storage/list?prefix=` ausführen, sodass die Schlüssel nicht einmal erraten werden müssen.

:::caution[Storage startet in der Produktion nicht ohne Autorisierung]
Tabellen sind durch Row-Level Security geschützt; Storage ist es nicht. Es gibt kein objektbezogenes Äquivalent im Bucket, daher *ist* dieser Hook das Modell – und `initializeRebaseBackend` **wirft beim Start eine Exception** unter `NODE_ENV=production`, wenn Storage konfiguriert ist und keines der folgenden Elemente gesetzt ist:

- `storageAuthorize` — ein Hook pro Objekt. Empfohlen.
- `storagePolicies` — die oben deklarierten Regeln.
- `storagePublicRead: true` — der Bucket dient tatsächlich als öffentliches, schreibgeschütztes CDN.
- `storageInsecureAllowAnyAuthenticated: true` — eine Single-Tenant-App, bei der jedem angemeldeten Benutzer jede Datei anvertraut wird. Bewusst so benannt, um zweimal gelesen zu werden.

In der Entwicklungsumgebung wird stattdessen eine Warnung protokolliert, sodass ein Projekt hier fehlerhaft konfiguriert sein und lokal einwandfrei funktionieren kann, bis es bereitgestellt wird. Ein über Scaffolding erstelltes Projekt enthält bereits einen Hook in `backend/storage.ts` – lesen Sie diesen, bevor Sie ihn ersetzen, und beachten Sie, dass er die *geteilte Inhaltsbibliothek* eines CMS abbildet, was eine andere Struktur als benutzerspezifische Dateien darstellt.
:::

`storageAuthorize` ist das Storage-Analogon zum `rls` einer Tabelle und wird nach der Authentifizierung auf jeder Storage-Route ausgeführt:

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
| `key` | Objektschlüssel, Bucket-Präfix entfernt und Pfad-Traversal bereinigt |
| `bucket` | Aufgelöster Bucket (`"default"`, wenn nicht angegeben) |
| `operation` | `"read"`, `"write"`, `"delete"` oder `"list"` |
| `user` | `{ uid, email?, roles? }` oder `null`, falls die Route anonymen Zugriff erlaubt |
| `storageId` | Das benannte Backend, wenn die Anfrage auf eines abzielte – dessen kanonischer Schlüssel (`storageId=%20media` ist `"media"`). Fehlt für die Standardquelle, unabhängig davon, wie die Anfrage sie benannt hat (kein Parameter, leer oder `(default)`) |
| `data` | Vertrauenswürdiger, **RLS-umgehender** Lesezugriff – `data.table(slug).find(query)` / `.findById(id)`. Die Eigentümerschaft liegt in einer Zeile, nicht in einem Schlüsselpräfix, daher benötigt der Hook einen Reader, um zu ermitteln: „Wer besitzt dieses Objekt?“. Er umgeht Row-Level Security bewusst: Dieser Hook *ist* die Autorisierungsentscheidung, und diese über einen Reader zu treffen, der bereits durch die eigenen Berechtigungen des Aufrufers eingeschränkt ist, wäre zirkulär. Konstruktionsbedingt schreibgeschützt. |

Geben Sie `false` zurück, um mit **403** abzulehnen. Das Auslösen einer Exception führt ebenfalls zur Verweigerung – eine fehlgeschlagene Eigentumsprüfung führt keinesfalls zu offenem Zugriff.

Wissenswertes:

- **Auf der Metadaten-Route wird der Lesezugriff tatsächlich entschieden.** Sie stellt das kurzlebige, pfadbezogene Download-Token aus, dem die Datei-Route vertraut, daher steuert der Hook den Zugriff an dieser Stelle. Zwei Lesezugriffe überspringen den Hook konstruktionsbedingt. Zum einen Anfragen mit einem solchen Token: Der Hook hat die Anfrage genehmigt, als das Token ausgestellt wurde, ausschließlich für diesen Pfad und diese Quelle. Ein Hook, der den Zugriff jetzt verweigern würde (z. B. durch eine zwischenzeitlich entzogene Mitgliedschaft), blockiert ihn daher nicht, bevor das Token abläuft – `storageDownloadTokenTtl`, standardmäßig 300 Sekunden. Zum anderen das Lesen eines Schlüssels unter `public/` durch einen Aufrufer ohne Anmeldedaten: Das Präfix stellt die Deklaration dar, dass jeder ihn lesen darf, einschließlich anonymer Besucher und CDNs. Der Lesezugriff eines angemeldeten Aufrufers darauf wird weiterhin über den Hook geprüft, der eines anonymen Aufrufers jedoch nicht, sodass ein Hook einen `public/`-Schlüssel nicht privat machen kann; speichern Sie die Datei stattdessen außerhalb von `public/`. Nur diese beiden Lesezugriffe überspringen den Hook: Ein Benutzer, den Ihr Auth-Adapter zufällig `public` nennt, wird wie jeder andere geprüft.
- **Ein Bucket, ein Name.** Auf S3 und GCS ist der `bucket` des Hooks immer `"default"`, auch wenn eine Anfrage den Bucket des Providers explizit benennt, welcher dieselben Objekte anspricht.
- **Ein Pfad ist öffentlich, wenn der von ihm benannte Schlüssel öffentlich ist.** Das `public/`-Präfix wird auf dem kanonischen Schlüssel geprüft, den die Route bereitstellt – nachdem ein führendes `default/`-Bucket-Segment entfernt und `//`, `./` sowie ein führendes `/` bereinigt wurden – niemals auf der URL in ihrer ursprünglichen Form. `/api/storage/file/notes://public/x.txt` benennt den privaten Schlüssel `notes:/public/x.txt`, und der Schlüssel `default/public/x.txt` (erreichbar über `/api/storage/file/default/default/public/x.txt`) liegt in einem Ordner namens `default`; keiner von beiden ist öffentlich. Prüfen Sie in einem Hook den übergebenen `key` mit `isPublicStorageKey` aus `@rebasepro/types` – `isPublicStoragePath` liest einen clientseitigen Pfad oder eine URL und stuft beide als öffentlich ein.
- **`list` wird anhand des Präfixes kontrolliert.** Über das Auflisten lassen sich Schlüssel ermitteln, die zuvor nicht bekannt waren.
- **Fortsetzbare (TUS) Uploads werden zum Erstellungszeitpunkt geprüft**, sodass ein abgelehnter Upload keine temporäre Datei hinterlässt.
- Das Weglassen des Hooks (sowie von `storagePolicies` und `STORAGE_POLICIES`) hinterlässt keine Prüfung pro Objekt, sodass der Start in der Produktionsumgebung verweigert wird, es sei denn, `storagePublicRead` oder `storageInsecureAllowAnyAuthenticated` ist gesetzt.

## API-Schlüssel und Tokens

Eine angemeldete Person verfügt über jeden Storage-Scope, sodass der Hook und die oben beschriebenen Policies die Zugriffsentscheidung treffen. Ein [API-Schlüssel](/docs/backend/api-keys/) benötigt zusätzlich den Storage-Scope für die Operation auf der von der Anfrage angegebenen Quelle: `storage:read` für Downloads, Metadaten und Listenansichten, `storage:write` für Uploads, Ordner und jeden Schritt eines fortsetzbaren Uploads, `storage:delete` für Löschvorgänge. Das Ziel ist die ID der Quelle, und die ID der Standardquelle lautet `(default)`: `storage:read:(default)`, `storage:write:avatars`. Fehlt dieser Scope, lautet die Antwort `403 SCOPE_MISSING`. Ist er vorhanden, wird der Hook dennoch ausgeführt – unter der Identität, für die der Schlüssel agiert.

## Nächste Schritte

- **[Storage-Konfiguration](/docs/backend/storage/)** — Backends, Endpunkte und Limits
- **[API-Schlüssel](/docs/backend/api-keys/)** — die Scopes, die ein Schlüssel umfasst
