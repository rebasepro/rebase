---
sourceHash: 9b25ea3a0b2cb11a
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Auth, Storage, Admin, Meta – mit dem jeweiligen Gate und der Seite, die sie erklärt.
---

Jede Route, die der Server bereitstellt, in einer Tabelle – mit den Voraussetzungen, um sie zu erreichen.

Die Pfade gehen vom Standard-`basePath` `/api` aus; `REBASE_BASE_PATH` verschiebt alle
gemeinsam. `/health`, `/livez` und `/metrics` liegen absichtlich außerhalb,
da ein Orchestrator `/health` abfragt und den Basispfad nicht kennen
müssen sollte. `/health` ist *auch* darunter eingebunden, sodass `/api/health` auf dieselbe
Weise antwortet, anstatt genau in dem Moment einen 404-Fehler auszugeben, in dem jemand prüft, ob der Server
erreichbar ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – gleicht diese
Tabelle mit den im Quellcode registrierten Routen ab, sodass keine neue Schnittstelle hinzugefügt werden
kann, ohne hier zu erscheinen.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Nicht authentifiziert. Jeder, der den Host erreichen kann, kann dies aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Access-Token oder ein für die Operation gültiger API-Schlüssel |
| **`resource:action`** | Ein Aufrufer, der diesen [Scope](/docs/backend/roles-and-scopes/) besitzt: ein Admin, eine Person, deren Rolle ihn deklariert, ein damit erstellter API-Schlüssel oder der Service-Key |
| **RLS** | Authentifiziert, und die Datenbank entscheidet Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Nur außerhalb der Produktionsumgebung eingebunden |

## Data

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wird pro Tabelle generiert, sodass die Pfade Ihre Slugs anstelle einer festen
Liste enthalten. `:slug` ist der Slug einer Tabelle (ihr Name, es sei denn, `defineTable` legt `slug` fest).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Die Auflistung, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Die Anzahl, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Berechnet eine materialisierte View neu, bei Views, die materialisiert sind – [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias für `PATCH` – derselbe partielle Schreibvorgang, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optional mit Upsert – [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen nach ID aktualisieren – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen nach ID löschen – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Tabellenübergreifend in einer Transaktion schreiben – [Schreiben über REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Zählen und Aggregation sind eigene Routen, die vor `/:id` registriert werden,
damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=` sind
deren Parameter, wobei `select` bei `/aggregate` erforderlich ist.

Textsuche, Vektorsuche, Einbeziehung von Relationen und Feldauswahl *sind* Query-Parameter
für `GET /api/data/:slug` und keine Routen – `searchString`,
`vector_search`, `include`, `fields`. Siehe [REST API](/docs/backend/api/).

Ein Projekt, das keine Tabellen deklariert und keine introspektiert, beantwortet diesen
Präfix mit einem einfachen `404 NO_TABLES`. Siehe [Backend only](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Was der Anmeldebildschirm anbieten kann: Registrierung, Passwort-Reset, Magic Link, E-Mail-Codes, Gast-Anmeldung, OAuth-Provider und ob die Ersteinrichtung des Admins noch aussteht |
| `POST` | `/api/auth/register` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh-Token) | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft jede andere Sitzung |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine |
| `POST` | `/api/auth/forgot-password` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Sendet einen Bestätigungslink per E-Mail an die neue Adresse – [Ändern einer E-Mail-Adresse](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (ein Link-Token) | Überträgt das Konto auf die neue Adresse – [Ändern einer E-Mail-Adresse](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentifizierung](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungstoken) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (ein Verifizierungstoken und eine Session oder das Passwort, um sie beizubehalten) | [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmalcodes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmalcodes per E-Mail |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Seit 0.31</span> [Geräte-Anmeldung](/docs/backend/device-sign-in/). Deaktiviert, sofern das Backend sie nicht aktiviert |
| `POST` | `/api/auth/device/token` | none (ein Gerätecode) | [Geräte-Anmeldung](/docs/backend/device-sign-in/): das Polling des Geräts |
| `GET` | `/api/auth/device/:userCode` | session | [Geräte-Anmeldung](/docs/backend/device-sign-in/): was die Genehmigungsseite anzeigt |
| `POST` | `/api/auth/device/approve` | session (`aal2` mit einem zweiten Faktor) | [Geräte-Anmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Geräte-Anmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Gastsitzungen. Deaktiviert, es sei denn, `ALLOW_ANONYMOUS` ist aktiv |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, es sei denn, `AUTH_ALLOW_USER_LOOKUP` ist aktiv – es handelt sich um eine Angriffsfläche für Enumeration |
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
| `POST` | `/api/auth/keys` | session (ein Konto) | Der Klartext-Schlüssel wird nur einmal zurückgegeben. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Auth-Tabelle setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (ein Konto) | Widerruft einen der eigenen Schlüssel des Aufrufers |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrisches Signieren](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert ist |

## Admin

Alles unter `/api/admin` erfordert einen Scope aus der Admin-Ebene, und jede
Oberfläche benennt ihren eigenen: `users:read` listet Konten auf, `cron:write` löst einen Job aus.
Ein Administrator besitzt alle, ebenso wie der Service-Key. Eine Person besitzt diejenigen,
die ihre Rollen vorgeben, und ein API-Schlüssel diejenigen, mit denen er erstellt wurde. Ein auf
eine Tabelle beschränkter Schlüssel hat hierauf keinen Zugriff. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Admin existiert | In der Produktionsumgebung verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Benutzerverwaltung |
| `POST` | `/api/admin/users` | `users:write` | Benutzerverwaltung. Rollen, die über die des Aufrufers hinausgehen, werden abgelehnt |
| `GET` | `/api/admin/users/pick` | `users:read` oder Schreibzugriff auf eine Tabelle mit einer `.userId()`-Spalte | Das [Auslesen der Benutzerauswahl](/docs/backend/auth-endpoints/): nur ID, Name, E-Mail und Avatar. Eine Tabelle, deren Schreibregeln reines SQL sind, zählt nicht |
| `GET` | `/api/admin/users/:uid` | `users:read` | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Abgelehnt für ein Konto, das über mehr Berechtigungen verfügt als der Aufrufer |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Abgelehnt für ein Konto, das über mehr Berechtigungen verfügt als der Aufrufer |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Erstellt ein temporäres Passwort |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Entfernt die zweiten Faktoren und Wiederherstellungscodes des Kontos, beendet dessen Sitzungen |
| `GET` | `/api/admin/guests` | `users:read` | Gäste, die am längsten inaktiv sind zuerst. `?lastSeenBefore=` grenzt sie auf das ein, was das nachfolgende Löschen erfassen würde, und `total` zählt sie |
| `DELETE` | `/api/admin/guests` | `users:write` | Löscht einen Batch der Gäste, die zuletzt vor `?lastSeenBefore=` gesehen wurden (Pflichtfeld). Antwortet mit `{ deleted, skipped, remaining }`. Wiederholen, solange `remaining` nicht 0 ist, wobei `?offset=` auf die Anzahl der übersprungenen Einträge gesetzt wird. Reguläre Konten sind nicht erreichbar |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Löscht einen Gast. Ein reguläres Konto wird mit `NOT_ANONYMOUS` abgelehnt |
| `GET` | `/api/admin/roles` | `users:read` | `admin` und die vom Projekt deklarierten Rollen mit ihren Scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/). Niemals über einen API-Schlüssel aufrufbar |
| `POST` | `/api/admin/api-keys` | `keys:write` | Der Klartext-Schlüssel wird nur einmal bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API-Schlüssel](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Einen Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Einen Job jetzt ausführen. `?async=1` antwortet mit `202`, sobald er gestartet wurde – [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Backup-Inventar |
| `GET` | `/api/admin/backups/download` | `backups:read` | Streamt ein Backup. Mit `?token=` aus einem Download-Link ist kein Header erforderlich, nur für dieses spezifische Backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Ein Link zu einem Backup, `{ key }` → `{ url, token, expiresIn }`, gültig für 60 Sekunden – [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Startet im Hintergrund einen Scan nach gespeicherten Dateien, die von keiner Zeile referenziert werden, `?storageId=&olderThanHours=`. Antwortet mit `202` und dem Datensatz des Scans: `id`, `status` (`queued`) und `runner` (`worker`, wenn es sich um einen `storage.orphans`-Job in der Job-Queue handelt, `in-process`, wenn der Server ihn selbst ausführt). Dessen Datensatz wird in die Quelle unter dem reservierten Pfad `_rebase/maintenance/` geschrieben |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Der Datensatz des Scans, `?storageId=`. Während der Ausführung: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` von `collectionsTotal`, `unscanned`). Nach Abschluss (`completed`): `result`, der Bericht, den das alte `GET /orphans` lieferte. Ein Durchlauf, der 10 Minuten lang keine Rückmeldung gibt, wird mit `failed` beantwortet. `404 STORAGE_SCAN_NOT_FOUND`, wenn die Quelle keinen solchen Scan enthält |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Löscht verwaiste Dateien (Orphans) eines abgeschlossenen Scans im Hintergrund, `202`. Jede Datei wird vor dem Löschen erneut gegen jede Zeile und jeden Verlaufseintrag geprüft. Das Ergebnis ist das Feld `deletion` des Scan-Datensatzes. `409` bei `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` oder `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Veraltet: der Scan innerhalb der Anfrage, `?storageId=&olderThanHours=`. Antwortet mit `Deprecation: true`. Verwenden Sie `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Veraltet, ohne `?scan=`: scannt erneut und löscht innerhalb der Anfrage. `409 STORAGE_SCAN_INCOMPLETE`, wenn eine Tabelle nicht gelesen werden konnte |
| `POST` | `/api/admin/storage/move` | `database:write` | Kopiert einen Ordner unter denselben Schlüsseln in eine andere Quelle, eine Seite pro Aufruf – was `rebase storage move` sendet; `400 STORAGE_SAME_LOCATION` bei `deleteSource` zwischen zwei Quellen, die am selben Ort speichern |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Listet die Quelle nach einem Verschiebevorgang erneut auf, mit demselben Body, eine Seite pro Aufruf: `{ checked, notMoved: [{ key, reason }], cursor? }` – jede Datei, die bei `deleteSource` noch in der Quelle verblieben ist, bzw. jede Datei, für die das Ziel ohne diese Option keine Kopie besitzt. `rebase storage move` fragt dies ab, wenn das Verschieben beendet ist |
| `GET` | `/api/admin/logs` | `logs:read` | Der aktuelle Log-Puffer |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Die neuesten Einträge |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Das neueste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rollen, Regel-Rollen von Benutzern und aktive Service-Keys, die ein Administrator simulieren kann |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Jede Tabelle so, wie `{ role?, userId?, apiKeyId? }` darauf zugreift: sichtbare Zeilen im Vergleich zu denen des Aufrufers, ausgeblendet durch Scope oder RLS, maskierte Felder. Nur mit Administrator-Sitzung |
| `POST` | `/api/admin/sql/csv` | `database:write` | Streamt das gesamte Ergebnis einer schreibgeschützten Abfrage als CSV – die Funktion „Download full result as CSV“ in [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Was ein [Branch](/docs/backend/branching/#reviewing-and-merging-a-branch) geändert hat: Schema, Policies und Zeilen, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Schreibt die Zeilen des Branches in dessen Parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409`, wenn sich eine Seite seit dem Diff geändert hat oder Zeilen kollidieren |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Plant eine Änderung; wendet niemals eine an |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Nur Personen, es sei denn `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` ist gesetzt |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Plant das Lockern von `NOT NULL` und das Löschen der in `drop` genannten, nicht deklarierten Spalten für [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); wendet niemals Änderungen an |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Wendet einen Reconcile-Plan an, aber nur, wenn dessen `digest` mit dem übermittelten `confirm` übereinstimmt |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Ob der Editor verfügbar ist, und der Grund, falls nicht |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Jede von `backend/schema/index.ts` exportierte Tabelle so, wie der Editor sie liest, einschließlich der im Code bearbeiteten Elemente (schreibgeschützt) und warum – [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> `{ patches: TablePatch[] }`: die Dateien, die die Bearbeitung schreiben würde, kompiliert; schreibt nichts |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Dieselbe Bearbeitung, geschrieben nach `backend/schema`; die Datenbank wird nicht berührt |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Tabellen, die in der Datenbank vorhanden sind, aber von `backend/schema` nicht deklariert werden: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Eine davon beschrieben: `{ table: { …, descriptor, rlsRaised?, notes } }`, für „Bestehende Tabelle importieren“. `404`, wenn unbekannt oder bereits deklariert, `400 SCHEMA_EDIT_REFUSED` ohne Primärschlüssel |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die `defineFirestoreCollection`-Aufrufe in `frontend/src/cms`, die der Editor umschreiben kann (nur Entwicklung) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die Dateien, die eine Bearbeitung eines dieser Aufrufe schreiben würde; schreibt nichts |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Dieselbe Bearbeitung, direkt vor Ort geschrieben. `409 SCHEMA_EDIT_STALE_FILE`, wenn sich die Datei auf der Festplatte geändert hat |
| `GET` | `/api/admin/ui-config` | session | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die UI-Einstellungen des Workspaces pro Tabelle, die des Aufrufers selbst und die Information, ob der Aufrufer die des Workspaces bearbeiten darf – siehe [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Ein `UiTablePreferences`-Delta in die Workspace-Einstellungen einer Tabelle zusammenführen (`replace` ersetzt). Wird nach `frontend/src/cms/ui-config.json` geschrieben, wenn der Server den Projektquellcode beschreiben darf, andernfalls nach `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Entfernt die Workspace-Einstellungen einer Tabelle |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (eine Person) | <span class="since-badge" data-since="0.31">Seit 0.31</span> Die eigenen Einstellungen des Aufrufers für eine Tabelle. Ein API-Schlüssel hat keine: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (eine Person) | <span class="since-badge" data-since="0.31">Seit 0.31</span> Entfernt die eigenen Einstellungen des Aufrufers für eine Tabelle |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-Mails, die der Development-Transport abgefangen hat, anstatt sie zu senden |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Leert das Postfach für abgefangene E-Mails |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch
unter ihren Pfaden vor Version 0.17 ohne das `/admin`-Segment bereitgestellt. Diese Aliase sind
für Projekte gedacht, die noch nicht migriert wurden; schreiben Sie neuen Code für den kanonischen Pfad.

## Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session oder ein Berechtigungsnachweis mit `schema:read` oder einem `data:*`-Scope | Jede Tabelle, die dieses Backend bereitstellt, als JSON-Array von Deskriptoren, redigiert für den jeweiligen Aufrufer |
| `GET` | `/api/schema/tables/:slug` | wie oben | Ein Deskriptor. `404 TABLE_NOT_FOUND`, wenn dem Aufrufer diese Tabelle nicht bereitgestellt wird |

Aus den Deskriptoren generiert das CMS seine Standardwerte, das Studio
seine Schemadarstellung sowie den RLS-Editor, und MCP-Apps ihre
Tabellen und Formulare. Sie enthalten Spalten mit ihren Postgres-Typen,
Nullable-Eigenschaften, Validierungs- und Speicherregeln, Relationen nach Slug und die
Sicherheitskonfiguration auf Zeilenebene (Row-Level Security). Hook-Code verlässt niemals den Server: Ein Deskriptor
gibt lediglich an, welche Hooks eine Tabelle besitzt.

Was einem Aufrufer bereitgestellt wird, hängt davon ab, wer er ist:

| Aufrufer | Tabellen | Redigiert |
|---|---|---|
| Ein Administrator, ein Inhaber von `schema:read` oder der Service-Key | jede Tabelle, einschließlich normaler Views | `.private()`-Spalten, für jeden |
| Jede andere angemeldete Person, einschließlich Gäste | nur die Tabellen, die eine zustimmende Regel für deren Rollen abdeckt (plus die Auth-Tabelle und materialisierte Views, deren `roles` sie besitzen) | Spalten und Relationen, bei denen deren Rollen die Prüfung für `access.read` nicht bestehen; `.private()`-Spalten; nur die Regeln, die für deren Rollen gelten können; Relationen zu Tabellen, die ihnen nicht bereitgestellt werden; Hook-Flags; rohes SQL in Regeln, kompilierte Policies, View-Abfragen und Indizes |
| Ein Berechtigungsnachweis (API-Schlüssel, MCP- oder Plattform-Token) | die Tabellen, die seine `data:*`-Scopes benennen, oder alle mit `schema:read` | wie oben, bewertet anhand der enthaltenen Scopes |
| Niemand angemeldet | keine – `401` – es sei denn, das Backend setzt `schemaTables: { public: true }` | dann die Tabellen mit einer öffentlichen `select`-Regel, redigiert wie für den Aufrufer mit den geringsten Rechten: keine Spalte mit einer `access.read`-Liste, kein rohes SQL, keine Policies |

Eine Person behält `metadata`, `softDelete`, `tenant`, `history` und `search` bei
den Tabellen, die ihr bereitgestellt werden. `schemaTables: { persons: "all" }` in den Backend-Optionen
beschreibt jede Tabelle und jede Regel für jeden angemeldeten Aufrufer; der
Standardwert ist `"granted"`. MCP-Verbindungen werden durch denselben Serialisierer
als Berechtigungsnachweis bewertet.

Wer der Aufrufer ist, bestimmt der Auth-Adapter des Backends – derselbe, den auch die Data-Routen
abfragen. Ein Backend mit einem [benutzerdefinierten Adapter](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
wird hier (sowie unter `/api/docs` und jeder Admin-Oberfläche) mit den Rollen bedient, die sein
Adapter zurückgibt; ein nicht anerkanntes Credential führt zu `401`.

Ein Berechtigungsnachweis, der weder `schema:read` noch einen `data:*`-Scope besitzt, erhält
`403 SCOPE_MISSING`. Ein Backend ohne konfigurierte Authentifizierung beantwortet
jede Anfrage mit `404 SCHEMA_UNAVAILABLE`: Es gibt keinen Aufrufer, für den redigiert werden könnte, und
`auth.requireAuth: false` ändert daran nichts.

Antworten enthalten `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` und den Header `x-rebase-schema`; eine Anfrage, deren `If-None-Match`
den aktuellen Tag nennt, erhält `304`. Der Tag ändert sich, wenn sich das Schema ändert,
auch nach einer Live-Schema-Bearbeitung.

`schemaTables` ist eine Option von `initializeRebaseBackend` ohne Umgebungsvariable:
Ein scaffolded Projekt erreicht sie durch Ejecten.

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
| `GET` | `/api/storage/sources` | session | Die benannten Speicherquellen, die dieses Backend bereitstellt |
| `OPTIONS` | `/api/storage/tus` | none | Wiederaufnehmbare Uploads: die TUS-Versionen und -Erweiterungen, die dieser Server unterstützt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Wiederaufnehmbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | der Eigentümer des Uploads | Wiederaufnehmbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | der Eigentümer des Uploads | Wiederaufnehmbare Uploads: Anhängen |
| `DELETE` | `/api/storage/tus/:id` | der Eigentümer des Uploads | Wiederaufnehmbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Speicher beantwortet dieses Präfix mit `501` und nennt die
benötigte Variable, anstatt mit einem 404-Fehler so zu tun, als gäbe es das Feature nicht –
mit Ausnahme von `GET /api/storage/sources`, das mit `200` und einer leeren Liste antwortet.

## Functions

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/functions` | session | Die Namen der bereitgestellten Funktionen und wie viele Dateien nicht geladen werden konnten |
| any | `/api/functions/<name>` | was auch immer die Funktion deklariert. Ein API-Schlüssel benötigt zusätzlich `functions:invoke` | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, sodass die Pfade aus Ihrem
Projekt stammen. `GET /api/functions` listet sie nur für angemeldete Aufrufer auf – eine
Session, ein API-Schlüssel oder der Service-Key – und beantwortet alle anderen mit `401`: Eine
Übersicht über die benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Nur Liveness: Läuft dieser Prozess. Berührt die Datenbank nicht, weshalb dies der Probe-Pfad ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Meldet jede konfigurierte Datenquelle, nicht nur die Standardquelle |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Seit 0.31</span> standardmäßig die Zielgruppe des Schema-Endpunkts (401 für Anonyme, es sei denn `schemaTables.public`, 403 für Credentials ohne Schema- oder Data-Scope); none, wenn `enableSwagger` auf `true` steht; das Admin-Gate, wenn `false` | Das OpenAPI 3.0-Dokument der Tabellen, die `GET /api/schema/tables` für den Aufrufer beschreibt (alle bei `enableSwagger: true`). `404 DOCS_UNAVAILABLE`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/api/swagger` | none | Swagger UI. Nur wenn `enableSwagger` auf `true` steht, und niemals in der Produktionsumgebung |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und die Runtime-Version, sonst nichts |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` – jede Tabelle so, wie ein Administrator sie sieht; die Eingabe für `rebase generate-sdk --from`. `404`, wenn keine Auth konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server und nicht über
einen eigenen Pfad – siehe [Realtime](/docs/backend/realtime/).

## MCP-Schnittstelle

Wird nur eingebunden, wenn `REBASE_MCP_ENABLED=true` gesetzt ist, was auch
`REBASE_PUBLIC_URL` erfordert – siehe
[Konfiguration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig
deaktiviert: Keine `REBASE_ROLE` schaltet dies ein, da Drittanbietersoftware Zugriff auf das Projekt
gewährt wird und dies eine Entscheidung ist, die eine Person treffen muss.

Die `.well-known`-Dokumente liegen am **Origin** (Ursprung), nicht unter `basePath`: RFC 8414
und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab,
bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC 9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Wird auch in der Form mit Pfad-Suffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC 8414-Metadaten: die Endpunkte, Grant-Typen und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Der MCP-Protokoll-Endpunkt. Agiert **als der angemeldete Benutzer** (oder als derjenige, für den der Schlüssel agiert), sodass jeder Lese- und Schreibvorgang demselben RLS unterliegt. Die `data:*`-Scopes entscheiden darüber, welche Tools angeboten werden |
| `GET` | `/mcp` | OAuth-Bearer oder ein API-Schlüssel | Antwortet mit `405` und `Allow: POST, DELETE`: Dieser Server öffnet keinen serverinitiierten Stream. Das Token wird zuerst überprüft, sodass ein fehlendes oder abgelaufenes Token stattdessen den `401`-Challenge erhält |
| `DELETE` | `/mcp` | none | Antwortet mit `204`. Der Endpunkt hält keine Sitzung, daher gibt es nichts zu beenden |
| `POST` | `/api/oauth/register` | rate-limited | Dynamische Client-Registrierung nach RFC 7591. Abgelehnt, wenn `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Die Zustimmungsseite (Consent Screen), zu der ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Antwort der Person darauf – zustimmen oder ablehnen |
| `POST` | `/api/oauth/token` | Client Credentials + PKCE | Tauscht einen Autorisierungscode ein oder führt einen Refresh durch |
| `POST` | `/api/oauth/revoke` | Client Credentials | Token-Widerruf nach RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer autorisiert hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Zieht eine Autorisierung zurück, sodass eine Person eine Zustimmung ohne Admin rückgängig machen kann |

Der eigene MCP-Endpunkt des Admin-Panels ist nicht Teil dieser Schnittstelle: Er verwendet die
Sitzung des Admin-Panels, niemals ein OAuth-Token, und wird zusammen mit den Admin-Routen
eingebunden, unabhängig davon, ob `REBASE_MCP_ENABLED` gesetzt ist, auf einem Treiber, der jeden
Aufruf auf RLS beschränkt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, niemals anonym | **Experimentell.** Dieselben Tools wie `/mcp`, für die angemeldete Person, mit `data:read`, `data:write` und `data:delete`, unter deren RLS. Die `savedAppsView` des Admin-Panels öffnet [gespeicherte Apps](/docs/ai/remote-mcp/) darüber |

## Verwandte Themen

- [REST API](/docs/backend/api/) – die Data-Routen im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth-Endpunkte](/docs/backend/auth-endpoints/) – Anfrage- und Antwortstrukturen für die obige Auth-Tabelle
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – die Variablen, die bestimmen, welche dieser Routen eingebunden werden
