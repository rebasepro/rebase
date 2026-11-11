---
sourceHash: 7410dc424b969f2a
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Auth, Storage, Admin, Meta – mit dem jeweiligen Gate und der Seite, die sie erklärt.
---

Jede Route, die der Server bereitstellt, in einer Tabelle zusammengefasst, inklusive der Voraussetzungen für den Zugriff.

Die Pfade setzen den standardmäßigen `basePath` von `/api` voraus; `REBASE_BASE_PATH` verschiebt alle Routen gemeinsam. `/health`, `/livez` und `/metrics` befinden sich bewusst außerhalb dieses Pfades, da ein Orchestrator `/health` prüft und den Basispfad nicht kennen muss. `/health` ist *zusätzlich* auch darunter eingebunden, sodass `/api/health` identisch antwortet, anstatt genau in dem Moment einen 404-Fehler auszulösen, in dem jemand prüft, ob der Server erreichbar ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – vergleicht diese Tabelle mit den im Quellcode registrierten Routen, sodass keine neue Schnittstelle hinzugefügt werden kann, ohne hier aufgeführt zu sein.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Unauthentifiziert. Jeder, der den Host erreichen kann, kann dies aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Zugriffstoken oder ein für die Operation beschränkter API-Schlüssel |
| **`resource:action`** | Ein Aufrufer mit diesem [Scope](/docs/backend/roles-and-scopes/): ein Administrator, eine Person, deren Rolle dies festlegt, ein damit erstellter API-Schlüssel oder der Service-Schlüssel |
| **RLS** | Authentifiziert, und die Datenbank entscheidet anschließend Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Nur außerhalb der Produktionsumgebung bereitgestellt |

## Daten

Wird pro Collection generiert, daher enthalten die Pfade Ihre Slugs anstelle einer festen Liste. `:slug` ist der `slug` einer Collection.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Die Auflistung, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Die Anzahl, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST-API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Berechnet eine Materialized-View-Collection neu, bei Collections, die eine solche bereitstellen – [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias für `PATCH` – gleicher partieller Schreibzugriff, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optionales Upsert – [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen anhand der ID aktualisieren – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen anhand der ID löschen – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Collection-übergreifend in einer Transaktion schreiben – [Schreiben über REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entitätshistorie](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entitätshistorie](/docs/backend/history/) |

Zählen und Aggregation sind eigenständige Routen, die vor `/:id` registriert werden, damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=` sind deren Parameter, wobei `select` bei `/aggregate` erforderlich ist.

Volltextsuche, Vektorsuche, Einbindung von Relationen und Feldauswahl sind Abfrageparameter auf `GET /api/data/:slug` und keine separaten Routen – `searchString`, `vector_search`, `include`, `fields`. Siehe [REST-API](/docs/backend/api/).

Ein Projekt, das keine Collections deklariert und keine introspeziert, beantwortet dieses Präfix mit einem einfachen `404 NO_COLLECTIONS`. Siehe [Nur Backend](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Was der Login-Bildschirm anbieten kann: Registrierung, Passwort-Reset, Magic Link, E-Mail-Codes, Gast-Anmeldung, OAuth-Provider und ob die Ersteinrichtung des Administrators ausstehend ist |
| `POST` | `/api/auth/register` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh-Token) | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft alle anderen Sitzungen |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine Sitzung |
| `POST` | `/api/auth/forgot-password` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Sendet einen Bestätigungslink an die neue Adresse – [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (ein Link-Token) | Überträgt das Konto auf die neue Adresse – [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentifizierung](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungstoken) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (ein Verifizierungstoken und eine Sitzung oder das Passwort, um sie beizubehalten) | [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Seit 0.31</span> [Geräteanmeldung](/docs/backend/device-sign-in/). Deaktiviert, es sei denn, das Backend aktiviert es |
| `POST` | `/api/auth/device/token` | none (ein Gerätecode) | [Geräteanmeldung](/docs/backend/device-sign-in/): das Polling des Geräts |
| `GET` | `/api/auth/device/:userCode` | session | [Geräteanmeldung](/docs/backend/device-sign-in/): was die Genehmigungsseite anzeigt |
| `POST` | `/api/auth/device/approve` | session (`aal2` mit einem zweiten Faktor) | [Geräteanmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Geräteanmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Gastsitzungen. Deaktiviert, außer bei `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein reguläres Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, außer bei `AUTH_ALLOW_USER_LOOKUP` – stellt eine Angriffsfläche für Aufzählungen (Enumeration) dar |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (eine laufende Anmeldung) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Jeder Scope, den dieses Backend kennt, und diejenigen, die der Aufrufer besitzt – [Rollen und Scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (ein Konto) | Die eigenen [persönlichen Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | session (ein Konto) | Der Klartext-Schlüssel wird nur einmal zurückgegeben. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Users-Collection setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (ein Konto) | Widerruft einen der eigenen Schlüssel des Aufrufers |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrisches Signieren](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert ist |

## Admin

Alles unter `/api/admin` erfordert einen Scope aus der Admin-Ebene, und jede Schnittstelle definiert ihren eigenen: `users:read` listet Konten auf, `cron:write` stößt einen Job an. Ein Administrator verfügt über alle diese Scopes, ebenso wie der Service-Schlüssel. Eine Person verfügt über diejenigen, die ihre Rollen deklarieren, und ein API-Schlüssel über jene, mit denen er erstellt wurde. Ein auf eine Collection beschränkter Schlüssel hat hierauf keinerlei Zugriff. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Administrator existiert | In Produktion verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Benutzerverwaltung |
| `POST` | `/api/admin/users` | `users:write` | Benutzerverwaltung. Rollen, die über die eigenen des Aufrufers hinausgehen, werden verweigert |
| `GET` | `/api/admin/users/pick` | `users:read`, oder Schreibzugriff auf eine Collection mit einem `userSelect`-Feld | Das [Lesen des User-Pickers](/docs/backend/auth-endpoints/): nur ID, Name, E-Mail und Avatar. Eine Collection, deren Schreibregeln aus reinem SQL bestehen, zählt nicht |
| `GET` | `/api/admin/users/:uid` | `users:read` | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Verweigert für ein Konto, das mehr Rechte besitzt als der Aufrufer |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Verweigert für ein Konto, das mehr Rechte besitzt als der Aufrufer |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Gibt ein temporäres Passwort aus |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Entfernt die zweiten Faktoren und Wiederherstellungscodes des Kontos und beendet dessen Sitzungen |
| `GET` | `/api/admin/guests` | `users:read` | Gäste, sortiert nach der am längsten zurückliegenden Aktivität zuerst. `?lastSeenBefore=` schränkt sie auf das ein, was das nachfolgende Löschen erfassen würde, und `total` zählt sie |
| `DELETE` | `/api/admin/guests` | `users:write` | Löscht einen Batch der Gäste, die zuletzt vor `?lastSeenBefore=` aktiv waren (erforderlich). Antwortet mit `{ deleted, skipped, remaining }`. Wiederholen, solange `remaining` ungleich 0 ist, mit `?offset=` auf die Anzahl der übersprungenen Einträge gesetzt. Reguläre Konten können nicht erreicht werden |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Löscht einen Gast. Ein reguläres Konto wird mit `NOT_ANONYMOUS` abgewiesen |
| `GET` | `/api/admin/roles` | `users:read` | `admin` und die vom Projekt deklarierten Rollen samt ihren Scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/). Niemals über einen API-Schlüssel aufrufbar |
| `POST` | `/api/admin/api-keys` | `keys:write` | Der Klartext-Schlüssel wird nur einmal bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Einen Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Einen Job jetzt ausführen. `?async=1` antwortet mit `202`, sobald er gestartet wurde – [Cron-Jobs-API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Backup-Bestand |
| `GET` | `/api/admin/backups/download` | `backups:read` | Streamt ein Backup. Mit `?token=` aus einem Download-Link ist kein Header erforderlich, nur für dieses Backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Ein Link zu einem Backup, `{ key }` → `{ url, token, expiresIn }`, gültig für 60 Sekunden – [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Startet im Hintergrund einen Scan nach gespeicherten Dateien ohne Zeilenreferenz, `?storageId=&olderThanHours=`. Antwortet mit `202` und dem Datensatz des Scans: `id`, `status` (`queued`) und `runner` (`worker`, wenn es sich um einen `storage.orphans`-Job in der Job-Queue handelt, `in-process`, wenn der Server ihn selbst ausführt). Der Datensatz wird in die Quelle unter dem reservierten Pfad `_rebase/maintenance/` geschrieben |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Der Datensatz des Scans, `?storageId=`. Während der Ausführung: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` von `collectionsTotal`, `unscanned`). Sobald `completed`: `result`, der Bericht, den das alte `GET /orphans` lieferte. Ein Lauf, der 10 Minuten lang keine Rückmeldung gibt, wird als `failed` beantwortet. `404 STORAGE_SCAN_NOT_FOUND`, wenn die Quelle keinen solchen Scan enthält |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Löscht verwaiste Dateien eines abgeschlossenen Scans im Hintergrund, `202`. Jede Datei wird erneut gegen jede Zeile und jeden Verlaufseintrag geprüft und unmittelbar vor dem Löschen erneut angefordert. Das Ergebnis ist das `deletion`-Feld des Scan-Datensatzes. `409` mit `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` oder `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Veraltet: der Scan innerhalb der Anfrage, `?storageId=&olderThanHours=`. Antwortet mit `Deprecation: true`. Verwenden Sie `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Veraltet, ohne `?scan=`: scannt erneut und löscht innerhalb der Anfrage. `409 STORAGE_SCAN_INCOMPLETE`, wenn eine Collection nicht gelesen werden konnte |
| `POST` | `/api/admin/storage/move` | `database:write` | Kopiert einen Ordner unter denselben Schlüsseln in eine andere Quelle, seitenweise pro Aufruf – das, was `rebase storage move` sendet; `400 STORAGE_SAME_LOCATION` bei `deleteSource` zwischen zwei Quellen am selben Speicherort |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Listet die Quelle nach einem Verschiebevorgang mit demselben Body erneut auf, seitenweise pro Aufruf: `{ checked, notMoved: [{ key, reason }], cursor? }` – jede noch in der Quelle verbliebene Datei bei `deleteSource`, jede Datei, von der das Ziel keine Kopie besitzt, ohne diese Option. `rebase storage move` fragt dies ab, wenn der Vorgang abgeschlossen ist |
| `GET` | `/api/admin/logs` | `logs:read` | Der Puffer der jüngsten Protokolleinträge |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Die aktuellsten Einträge |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Das jüngste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rollen, Regelrollen der Benutzer und aktive Service-Schlüssel, die ein Administrator simulieren kann |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Jede Collection so, wie `{ role?, userId?, apiKeyId? }` sie erreicht: sichtbare Zeilen im Vergleich zu denen des Aufrufers, ausgeblendet durch Scopes oder RLS, maskierte Felder. Nur mit Administrator-Sitzung |
| `POST` | `/api/admin/sql/csv` | `database:write` | Streamt das gesamte Ergebnis einer schreibgeschützten Abfrage als CSV – [Studio](/docs/studio/)'s "Download full result as CSV" |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Was ein [Branch](/docs/backend/branching/#reviewing-and-merging-a-branch) geändert hat: Schema, Policies und Zeilen, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Schreibt die Zeilen des Branches in dessen Parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409`, wenn sich eine der beiden Seiten seit dem Diff geändert hat oder Zeilen kollidieren |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Plant eine Änderung; wendet niemals eine an |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Nur durch eine Person ausführbar, außer bei `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Plant die Lockerung von `NOT NULL` und das Löschen nicht deklarierter Spalten, die in `drop` aufgeführt sind, für [Schema Reconcile](/docs/cli/schema/#rebase-schema-reconcile); wendet niemals eine Änderung an |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Wendet einen Abgleichsplan (Reconcile-Plan) an, jedoch nur, wenn dessen `digest` mit dem übermittelten `confirm` übereinstimmt |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Gibt an, ob der Editor verfügbar ist, und nennt den Grund, falls nicht |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) – schreibt den Quellcode der Collection neu |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-Mails, die der Development-Transport abgefangen hat, anstatt sie zu senden |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Leert das abgefangene Postfach |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch unter ihren Pfaden aus Versionen vor 0.17 ohne das `/admin`-Segment bereitgestellt. Diese Aliase dienen Projekten, die noch nicht migriert wurden; schreiben Sie neuen Code stets gegen den kanonischen Pfad.

## Storage

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, pro Schlüssel | [Storage](/docs/backend/storage/#storage-endpoints): Metadaten für bis zu 100 Objekte |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Die benannten Storage-Quellen, die dieses Backend bereitstellt |
| `OPTIONS` | `/api/storage/tus` | none | Wiederaufnehmbare Uploads: die von diesem Server unterstützten TUS-Versionen und -Erweiterungen |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Wiederaufnehmbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | Eigentümer des Uploads | Wiederaufnehmbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | Eigentümer des Uploads | Wiederaufnehmbare Uploads: Anhängen |
| `DELETE` | `/api/storage/tus/:id` | Eigentümer des Uploads | Wiederaufnehmbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Storage beantwortet dieses Präfix mit einem `501`-Fehler, der die benötigte Variable benennt, anstatt mit 404 so zu reagieren, als gäbe es das Feature nicht – mit Ausnahme von `GET /api/storage/sources`, das mit `200` und einer leeren Liste antwortet.

## Funktionen

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/functions` | session | Die Namen der bereitgestellten Funktionen und wie viele Dateien nicht geladen werden konnten |
| beliebige | `/api/functions/<name>` | Was auch immer die Funktion deklariert. Ein API-Schlüssel benötigt zusätzlich `functions:invoke` | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, sodass die Pfade aus Ihrem Projekt stammen. `GET /api/functions` listet sie nur für angemeldete Aufrufer auf – eine Sitzung, ein API-Schlüssel oder der Service-Schlüssel – und antwortet allen anderen mit `401`: Eine Übersicht der benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Reine Liveness-Prüfung: Läuft dieser Prozess? Greift nicht auf die Datenbank zu, weshalb dies der Probe-Pfad ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Meldet jede konfigurierte Datenquelle, nicht nur die Standardquelle |
| `GET` | `/api/docs` | none (`schema:read`, wenn `enableSwagger` auf `false` gesetzt ist, dem Runtime-Standard in Produktion) | Das OpenAPI 3.0-Dokument |
| `GET` | `/api/swagger` | none | Swagger UI. Nur außerhalb der Produktion; `REBASE_ENABLE_SWAGGER` kann dies in der Produktion nicht aktivieren. Wird auch in der Entwicklung nicht bereitgestellt, wenn `enableSwagger` auf `false` steht |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und die Runtime-Version – sonst nichts |
| `GET` | `/api/meta/contract` | `schema:read` | Der vollständige Collection-Vertrag, für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server und nicht über einen eigenen Pfad – siehe [Echtzeit](/docs/backend/realtime/).

## MCP-Schnittstelle

Wird nur eingebunden, wenn `REBASE_MCP_ENABLED=true` gesetzt ist, was zusätzlich `REBASE_PUBLIC_URL` erfordert – siehe [Konfiguration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig deaktiviert: Kein `REBASE_ROLE` schaltet dies automatisch ein, da hierdurch Software von Drittanbietern Zugriff auf das Projekt erhält, was eine manuelle Entscheidung erfordert.

Die `.well-known`-Dokumente liegen am **Origin**, nicht unter `basePath`: RFC 8414 und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab, bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC 9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Wird auch in der Form mit Pfadsuffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC 8414-Metadaten: die Endpunkte, Grant-Typen und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Der MCP-Protokoll-Endpunkt. Agiert **als der angemeldete Benutzer** (oder als die Identität, für die der Schlüssel gilt), sodass jeder Lese- und Schreibzugriff denselben RLS unterliegt. Die `data:*`-Scopes bestimmen, welche Tools angeboten werden |
| `GET` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Antwortet mit `405` und `Allow: POST, DELETE`: Dieser Server öffnet keinen serverinitiierten Stream. Das Token wird zuerst geprüft, sodass ein fehlendes oder veraltetes Token stattdessen den `401`-Challenge erhält |
| `DELETE` | `/mcp` | none | Antwortet mit `204`. Der Endpunkt hält keine Sitzung, daher gibt es nichts zu beenden |
| `POST` | `/api/oauth/register` | rate-limited | Dynamische Client-Registrierung nach RFC 7591. Abgelehnt, wenn `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Der Zustimmungsbildschirm, zu dem ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Entscheidung der Person hierzu – zustimmen oder ablehnen |
| `POST` | `/api/oauth/token` | Client Credentials + PKCE | Tauscht einen Autorisierungscode ein oder erneuert ihn |
| `POST` | `/api/oauth/revoke` | Client Credentials | Token-Widerruf nach RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer autorisiert hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Zieht eine Freigabe zurück, sodass eine Person eine Einwilligung ohne Administrator rückgängig machen kann |

Der eigene MCP-Endpunkt des Admin-Panels ist nicht Teil dieser Oberfläche: Er verwendet die Sitzung des Admin-Panels, niemals ein OAuth-Token, und wird unabhängig davon eingebunden, ob `REBASE_MCP_ENABLED` gesetzt ist – auf einem Treiber, der jeden Aufruf auf RLS beschränkt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, niemals anonym | **Experimentell.** Dieselben Tools wie `/mcp` für die angemeldete Person mit `data:read`, `data:write` und `data:delete` unter deren RLS. Die `savedAppsView` des Admin-Panels öffnet [gespeicherte Apps](/docs/ai/remote-mcp/) darüber |

## Weiterführende Links

- [REST-API](/docs/backend/api/) – die Datenrouten im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth-Endpunkte](/docs/backend/auth-endpoints/) – Request- und Response-Formate für die obige Authentifizierungstabelle
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – die Variablen, die steuern, welche dieser Routen bereitgestellt werden
