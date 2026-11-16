---
sourceHash: 7fea9b51c30a3c41
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Auth, Storage, Admin, Meta – mit dem jeweiligen Gate und der Seite, die sie erklärt.
---

Jede vom Server bereitgestellte Route in einer Tabelle, zusammen mit den Voraussetzungen, um sie zu erreichen.

Die Pfade setzen den Standard-`basePath` von `/api` voraus; `REBASE_BASE_PATH` verschiebt
alle gemeinsam. `/health`, `/livez` und `/metrics` befinden sich absichtlich außerhalb,
da ein Orchestrator `/health` prüft und den Basispfad nicht kennen muss. `/health`
wird *auch* darunter bereitgestellt, sodass `/api/health` auf dieselbe Weise antwortet,
anstatt genau in dem Moment einen 404-Fehler zu liefern, in dem jemand überprüft,
ob der Server erreichbar ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – vergleicht diese
Tabelle mit den Routen, die der Quellcode registriert, sodass keine neue Schnittstelle
hinzugefügt werden kann, ohne hier aufgeführt zu werden.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Nicht authentifiziert. Jeder, der den Host erreichen kann, kann den Endpunkt aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Access Token oder ein für die Operation autorisierter API-Schlüssel |
| **`resource:action`** | Ein Aufrufer mit diesem [Scope](/docs/backend/roles-and-scopes/): ein Admin, eine Person, deren Rolle dies deklariert, ein damit erstellter API-Schlüssel oder der Service-Schlüssel |
| **RLS** | Authentifiziert, und die Datenbank entscheidet Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Wird nur außerhalb der Produktionsumgebung bereitgestellt |

## Daten

Wird pro Tabelle generiert, sodass die Pfade Ihre Slugs anstelle einer festen
Liste enthalten. `:slug` ist der Slug einer Tabelle (ihr Name, es sei denn, `defineTable` legt `slug` fest).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | Die Auflistung, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Abfragen](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | Die Zählung, Abfrageparameter im Body – [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST-API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Eine materialisierte View neu berechnen, bei Views, die materialisiert sind – [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias von `PATCH` – derselbe partielle Schreibvorgang, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optional mit Upsert – [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen nach ID aktualisieren – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen nach ID löschen – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Tabellenübergreifend in einer Transaktion schreiben – [Schreiben über REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entitätshistorie](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entitätshistorie](/docs/backend/history/) |

Zählung und Aggregation sind eigene Routen, die vor `/:id` registriert werden,
damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=` sind
ihre Parameter, und `select` ist bei `/aggregate` erforderlich.

Textsuche, Vektorsuche, Einbindung von Relationen und Feldauswahl *sind* Abfrageparameter
auf `GET /api/data/:slug` und keine Routen – `searchString`, `vector_search`, `include`,
`fields`. Siehe [REST-API](/docs/backend/api/).

Ein Projekt, das keine Tabellen deklariert und keine introspeziert, liefert für diesen
Präfix ein einzelnes `404 NO_TABLES` zurück. Siehe [Nur Backend](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Was der Login-Bildschirm anbieten kann: Registrierung, Passwort-Reset, Magic Link, E-Mail-Codes, Gast-Anmeldung, OAuth-Provider und ob die Ersteinrichtung des Administrators aussteht |
| `POST` | `/api/auth/register` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh Token) | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft jede andere Sitzung |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine einzelne Sitzung |
| `POST` | `/api/auth/forgot-password` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Sendet einen Bestätigungslink an die neue Adresse – [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (ein Link-Token) | Überträgt das Konto auf die neue Adresse – [E-Mail-Adresse ändern](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentifizierung](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungstoken) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (ein Verifizierungstoken und eine Session oder das Passwort, um sie beizubehalten) | [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/device` | none | [Geräte-Anmeldung](/docs/backend/device-sign-in/). Deaktiviert, sofern nicht vom Backend aktiviert |
| `POST` | `/api/auth/device/token` | none (ein Geräte-Code) | [Geräte-Anmeldung](/docs/backend/device-sign-in/): das Polling des Geräts |
| `GET` | `/api/auth/device/:userCode` | session | [Geräte-Anmeldung](/docs/backend/device-sign-in/): was die Bestätigungsseite anzeigt |
| `POST` | `/api/auth/device/approve` | session (`aal2` mit einem zweiten Faktor) | [Geräte-Anmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Geräte-Anmeldung](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Gast-Sitzungen. Deaktiviert, außer bei `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein reguläres Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, außer bei `AUTH_ALLOW_USER_LOOKUP` – stellt eine Aufzählungsoberfläche dar |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (ein laufender Login) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Jeder Scope, den dieses Backend kennt, und diejenigen, die der Aufrufer besitzt – [Rollen und Scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (ein Konto) | Die eigenen [persönlichen Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | session (ein Konto) | Der Klartext-Schlüssel wird einmalig zurückgegeben. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Auth-Tabelle setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (ein Konto) | Widerruft einen der eigenen Schlüssel des Aufrufers |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrische Signaturen](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert sind |

## Admin

Alles unter `/api/admin` erfordert einen Scope aus der Admin-Ebene, und jede
Schnittstelle benennt ihren eigenen: `users:read` listet Konten auf, `cron:write` löst einen Job aus.
Ein Admin besitzt alle davon, ebenso wie der Service-Schlüssel. Eine Person besitzt diejenigen,
die ihre Rollen deklarieren, und ein API-Schlüssel diejenigen, mit denen er erstellt wurde. Ein Schlüssel
mit Beschränkung auf eine Tabelle erreicht hiervon nichts. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Admin existiert | In Produktion verweigert – siehe [Bootstrap des ersten Benutzers](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Benutzerverwaltung |
| `POST` | `/api/admin/users` | `users:write` | Benutzerverwaltung. Rollen über die des Aufrufers hinaus werden abgelehnt |
| `GET` | `/api/admin/users/pick` | `users:read`, oder Schreibzugriff auf eine Tabelle mit einer `.userId()`-Spalte | Das [Lesen des User-Pickers](/docs/backend/auth-endpoints/): nur ID, Name, E-Mail und Avatar. Eine Tabelle, deren Schreibregeln reines SQL sind, zählt nicht |
| `GET` | `/api/admin/users/:uid` | `users:read` | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Abgelehnt für ein Konto, das mehr Rechte besitzt als der Aufrufer |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Abgelehnt für ein Konto, das mehr Rechte besitzt als der Aufrufer |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Stellt ein temporäres Passwort aus |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Entfernt die zweiten Faktoren und Wiederherstellungscodes des Kontos, beendet dessen Sitzungen |
| `GET` | `/api/admin/guests` | `users:read` | Gäste, am längsten nicht mehr aktiv zuerst. `?lastSeenBefore=` grenzt sie auf das ein, was das nachfolgende Löschen erfassen würde, und `total` zählt sie |
| `DELETE` | `/api/admin/guests` | `users:write` | Löscht einen Batch der Gäste, die zuletzt vor `?lastSeenBefore=` aktiv waren (erforderlich). Antwortet mit `{ deleted, skipped, remaining }`. Wiederholen, solange `remaining` nicht 0 ist, mit `?offset=` auf die Anzahl der übersprungenen Gäste gesetzt. Reguläre Konten können nicht erreicht werden |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Löscht einen einzelnen Gast. Ein reguläres Konto wird mit `NOT_ANONYMOUS` abgewiesen |
| `GET` | `/api/admin/roles` | `users:read` | `admin` und die Rollen, die das Projekt deklariert, mit ihren Scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API-Schlüssel](/docs/backend/api-keys/). Niemals ein API-Schlüssel |
| `POST` | `/api/admin/api-keys` | `keys:write` | Der Klartext-Schlüssel wird einmalig bei der Erstellung zurückgegeben |
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
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Startet im Hintergrund einen Scan nach gespeicherten Dateien ohne Zeilennamen, `?storageId=&olderThanHours=`. Antwortet mit `202` und dem Datensatz des Scans: `id`, `status` (`queued`) und `runner` (`worker`, wenn es sich um einen `storage.orphans`-Job in der Job-Queue handelt, `in-process`, wenn der Server ihn selbst ausführt). Der Datensatz wird in die Quelle unter dem reservierten Pfad `_rebase/maintenance/` geschrieben |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | Der Datensatz des Scans, `?storageId=`. Während der Ausführung: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` von `collectionsTotal`, `unscanned`). Nach Abschluss (`completed`): `result`, der Bericht, den das alte `GET /orphans` lieferte. Ein Lauf, der 10 Minuten lang keine Rückmeldung gibt, wird als `failed` gewertet. `404 STORAGE_SCAN_NOT_FOUND`, wenn die Quelle keinen solchen Scan enthält |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Löscht verwaiste Dateien eines abgeschlossenen Scans im Hintergrund, `202`. Jede Datei wird erneut gegen jede Zeile und jeden Verlaufseintrag geprüft und unmittelbar vor dem Löschen erneut abgefragt. Das Ergebnis ist das `deletion`-Feld des Scan-Datensatzes. `409` mit `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` oder `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Veraltet: der Scan innerhalb der Anfrage, `?storageId=&olderThanHours=`. Antwortet mit `Deprecation: true`. Verwenden Sie `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Veraltet, ohne `?scan=`: scannt erneut und löscht innerhalb der Anfrage. `409 STORAGE_SCAN_INCOMPLETE`, wenn eine Tabelle nicht gelesen werden konnte |
| `POST` | `/api/admin/storage/move` | `database:write` | Kopiert einen Ordner unter denselben Schlüsseln in eine andere Quelle, eine Seite pro Aufruf – was `rebase storage move` sendet; `400 STORAGE_SAME_LOCATION` bei `deleteSource` zwischen zwei Quellen, die am selben Ort speichern |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Listet die Quelle nach einem Verschiebevorgang erneut auf, mit demselben Body, eine Seite pro Aufruf: `{ checked, notMoved: [{ key, reason }], cursor? }` – jede noch in der Quelle vorhandene Datei bei `deleteSource`, jede Datei, von der das Ziel keine Kopie besitzt, ohne diesen Parameter. `rebase storage move` fragt dies ab, sobald der Verschiebevorgang abgeschlossen ist |
| `GET` | `/api/admin/logs` | `logs:read` | Der Puffer der letzten Logs |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Die neuesten Einträge |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | Das neueste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Rollen, Regel-Rollen von Benutzern und aktive Service-Schlüssel, die ein Administrator simulieren kann |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Jede Tabelle, wie `{ role?, userId?, apiKeyId? }` sie erreicht: sichtbare Zeilen im Vergleich zu denen des Aufrufers, ausgeblendet durch Scope oder RLS, maskierte Felder. Nur mit Administratorsitzung |
| `POST` | `/api/admin/sql/csv` | `database:write` | Gibt das gesamte Ergebnis einer schreibgeschützten Abfrage als CSV-Stream aus – die Funktion „Download full result as CSV“ in [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Was ein [Branch](/docs/backend/branching/#reviewing-and-merging-a-branch) geändert hat: Schema, Richtlinien und Zeilen, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Schreibt die Zeilen des Branches in dessen Parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409`, wenn sich eine Seite seit dem Diff geändert hat oder Zeilen im Konflikt stehen |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Plant eine Änderung; wendet niemals eine an |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Nur eine Person, es sei denn `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` ist gesetzt |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Plant die Lockerung von `NOT NULL` und das Löschen der in `drop` genannten, nicht deklarierten Spalten für [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); wendet niemals eine Änderung an |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Wendet einen Reconcile-Plan nur an, wenn dessen `digest` mit dem gesendeten `confirm` übereinstimmt |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Ob der Editor verfügbar ist, und der Grund, falls nicht |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Jede Tabelle, die `backend/schema/index.ts` exportiert, so wie der Editor sie liest, mit Angabe, was im Code bearbeitet wird (schreibgeschützt) und warum – [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: die Dateien, die die Bearbeitung schreiben würde, kompiliert; schreibt nichts |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | Dieselbe Bearbeitung, geschrieben in `backend/schema`; die Datenbank bleibt unberührt |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabellen, die die Datenbank besitzt und die `backend/schema` nicht deklariert: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Eine davon beschrieben: `{ table: { …, descriptor, rlsRaised?, notes } }`, für „Bestehende Tabelle importieren“. `404` bei unbekannter oder bereits deklarierter Tabelle, `400 SCHEMA_EDIT_REFUSED` ohne Primärschlüssel |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | Die `defineFirestoreCollection`-Aufrufe in `frontend/src/cms`, die der Editor umschreiben kann (nur Entwicklung) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | Die Dateien, die eine Bearbeitung eines dieser Aufrufe schreiben würde; schreibt nichts |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | Dieselbe Bearbeitung, direkt an Ort und Stelle geschrieben. `409 SCHEMA_EDIT_STALE_FILE`, wenn sich die Datei auf der Festplatte geändert hat |
| `GET` | `/api/admin/ui-config` | session | Die UI-Einstellungen des Workspace pro Tabelle, die eigenen des Aufrufers und ob der Aufrufer die des Workspace schreiben darf – siehe [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Ein `UiTablePreferences`-Delta in die Workspace-Einstellungen einer Tabelle zusammenführen (`replace` ersetzt). Geschrieben in `frontend/src/cms/ui-config.json`, wo der Server Schreibrechte auf den Projektquellcode hat, andernfalls in `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Entfernt die Workspace-Einstellungen einer Tabelle |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (eine Person) | Die eigenen Einstellungen des Aufrufers für eine Tabelle. Ein API-Schlüssel hat keine: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (eine Person) | Entfernt die eigenen Einstellungen des Aufrufers für eine Tabelle |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-Mails, die der Development-Transport abgefangen hat, anstatt sie zu senden |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Leert das Postfach der abgefangenen E-Mails |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch
unter ihren Pfaden aus Versionen vor 0.17 ohne das Segment `/admin` bereitgestellt.
Diese Aliase sind für Projekte gedacht, die noch nicht umgestellt wurden; schreiben
Sie neuen Code stets gegen den kanonischen Pfad.

## Schema

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, oder ein Credential mit `schema:read` oder einem `data:*`-Scope | Jede von diesem Backend bereitgestellte Tabelle als JSON-Array von Deskriptoren, die für den Aufrufer redigiert sind |
| `GET` | `/api/schema/tables/:slug` | wie oben | Ein Deskriptor. `404 TABLE_NOT_FOUND`, wenn dieser Aufrufer für diese Tabelle keine Berechtigung hat |

Die Deskriptoren sind das, woraus das CMS seine Standardwerte rendert, woraus Studio
den Schema-Visualisierer und den RLS-Editor erzeugt und woraus MCP-Apps Tabellen
und Formulare aufbauen. Sie enthalten Spalten mit ihren Postgres-Typen, Nullability,
Validierungs- und Speicherregeln, Relationen nach Slug und den Status der
Row-Level Security. Hook-Code verlässt niemals den Server: Ein Deskriptor gibt
lediglich an, welche Hooks eine Tabelle besitzt.

Was für einen Aufrufer bereitgestellt wird, hängt von dessen Identität ab:

| Aufrufer | Tabellen | Redigiert |
|---|---|---|
| Ein Administrator, ein Inhaber von `schema:read` oder der Service-Schlüssel | Jede Tabelle, einschließlich einfacher Views | `.private()`-Spalten, für alle |
| Jede andere angemeldete Person, einschließlich Gäste | Nur die Tabellen, die eine zustimmende Regel für ihre Rollen abdeckt (zuzüglich der Auth-Tabelle und materialisierter Views, deren `roles` sie besitzen) | Spalten und Relationen, bei denen ihre Rollen an `access.read` scheitern; `.private()`-Spalten; nur die Regeln, die für ihre Rollen gelten können; Relationen zu Tabellen, auf die sie keinen Zugriff haben; Hook-Flags; rohes SQL in Regeln, kompilierte Policies, View-Queries und Indizes |
| Ein Credential (API-Schlüssel, MCP- oder Plattform-Token) | Die Tabellen, die seine `data:*`-Scopes benennen, oder alle mit `schema:read` | Wie oben, bewertet anhand der mitgeführten Scopes |
| Niemand angemeldet | Keine – `401` – es sei denn, das Backend setzt `schemaTables: { public: true }` | Dann die Tabellen mit einer öffentlichen `select`-Regel, redigiert wie für den Aufrufer mit den geringsten Rechten: keine Spalte mit einer `access.read`-Liste, kein rohes SQL, keine Policies |

Eine Person behält `metadata`, `softDelete`, `tenant`, `history` und `search` bei
den Tabellen, auf die sie Zugriff hat. `schemaTables: { persons: "all" }` in den
Backend-Optionen beschreibt jede Tabelle und Regel für jeden angemeldeten Aufrufer;
der Standardwert ist `"granted"`. MCP-Verbindungen werden durch denselben
Serialisierer als Credential bewertet.

Wer der Aufrufer ist, bestimmt der Auth-Adapter des Backends – derselbe, den auch die
Daten-Routen abfragen. Ein Backend mit einem [benutzerdefinierten Adapter](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
wird hier (sowie unter `/api/docs` und jeder Admin-Oberfläche) mit den Rollen bedient,
die sein Adapter zurückgibt; ein Credential, das er nicht erkennt, führt zu einem `401`.

Ein Credential, das weder `schema:read` noch einen `data:*`-Scope besitzt, erhält
`403 SCOPE_MISSING`. Ein Backend ohne konfigurierte Authentifizierung beantwortet
jede Anfrage mit `404 SCHEMA_UNAVAILABLE`: Es gibt keinen Aufrufer, für den redigiert
werden könnte, und `auth.requireAuth: false` ändert daran nichts.

Antworten enthalten `ETag: W/"<schema version>-<view>"`, `Cache-Control: private, no-cache`
und den Header `x-rebase-schema`; eine Anfrage, deren `If-None-Match` das aktuelle Tag
benennt, erhält ein `304`. Das Tag ändert sich bei jeder Schema-Änderung, einschließlich
nach einer Live-Schema-Bearbeitung.

`schemaTables` ist eine Option von `initializeRebaseBackend` ohne Umgebungsvariable:
Ein per Scaffolding erstelltes Projekt erreicht sie durch Ejecten.

## Storage

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, pro Key | [Storage](/docs/backend/storage/#storage-endpoints): Metadaten für bis zu 100 Objekte |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Die benannten Storage-Quellen, die dieses Backend bedient |
| `OPTIONS` | `/api/storage/tus` | none | Wiederaufnehmbare Uploads: die TUS-Versionen und -Erweiterungen, die dieser Server unterstützt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Wiederaufnehmbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | Eigentümer des Uploads | Wiederaufnehmbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | Eigentümer des Uploads | Wiederaufnehmbare Uploads: Anfügen |
| `DELETE` | `/api/storage/tus/:id` | Eigentümer des Uploads | Wiederaufnehmbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Speicher beantwortet diesen Präfix mit `501` und
nennt die benötigte Variable, anstatt einen 404-Fehler zurückzugeben, als ob das
Feature nicht existierte – mit Ausnahme von `GET /api/storage/sources`, das mit `200`
und einer leeren Liste antwortet.

## Push

Wird nur mit `push: true` (`REBASE_PUSH=true`) bereitgestellt. Wenn Push aktiviert ist,
aber keine Schlüssel vorhanden sind, antwortet jede Route mit `503 PUSH_NOT_CONFIGURED`.
API-Schlüssel und der Service-Schlüssel werden abgelehnt: Ein Abonnement gehört zum
Browser einer Person.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/push/key` | session | Der öffentliche VAPID-Schlüssel – [Push-Benachrichtigungen](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Dieser Browser empfängt Benachrichtigungen für den Aufrufer – [Push-Benachrichtigungen](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Benachrichtigungen im eigenen Browser des Aufrufers beenden – [Push-Benachrichtigungen](/docs/backend/push-notifications/#routes) |

## Funktionen

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/functions` | session | Die Namen der bereitgestellten Funktionen und wie viele Dateien nicht geladen werden konnten |
| beliebig | `/api/functions/<name>` | Was immer die Funktion deklariert. Ein API-Schlüssel benötigt zusätzlich `functions:invoke` | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, sodass die Pfade aus Ihrem Projekt
stammen. `GET /api/functions` listet sie nur für angemeldete Aufrufer auf – eine Session,
einen API-Schlüssel oder den Service-Schlüssel – und antwortet allen anderen mit `401`:
Eine Übersicht über die benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Reine Liveness: Läuft dieser Prozess. Greift nicht auf die Datenbank zu, weshalb dies der Prüfpfad ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Meldet jede konfigurierte Datenquelle, nicht nur die Standardquelle |
| `GET` | `/api/docs` | Standardmäßig die Zielgruppe des Schema-Endpunkts (401 für anonyme Aufrufer, außer bei `schemaTables.public`, 403 für Credentials ohne Schema- oder Daten-Scope); none, wenn `enableSwagger` auf `true` steht; das Admin-Gate, wenn `false` | Das OpenAPI-3.0-Dokument der Tabellen, die `GET /api/schema/tables` für den Aufrufer beschreibt (alle bei `enableSwagger: true`). `404 DOCS_UNAVAILABLE`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/api/swagger` | none | Swagger UI. Nur wenn `enableSwagger` auf `true` steht, und niemals in Produktion |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, sowie die Runtime-Version, und sonst nichts |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` – jede Tabelle, wie ein Administrator sie sieht, die Eingabe für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server und nicht über
einen eigenen Pfad – siehe [Echtzeit](/docs/backend/realtime/).

## MCP-Schnittstelle

Wird nur bereitgestellt, wenn `REBASE_MCP_ENABLED=true` gesetzt ist, was zusätzlich
`REBASE_PUBLIC_URL` erfordert – siehe
[Konfiguration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig
deaktiviert: Keine `REBASE_ROLE` aktiviert dies automatisch, da hierdurch Drittanbieter-Software
Zugriff auf das Projekt erhält und dies eine Entscheidung ist, die eine Person treffen muss.

Die `.well-known`-Dokumente liegen am **Origin**, nicht unter `basePath`: RFC 8414
und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab,
bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC-9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Wird auch unter der Form mit Pfad-Suffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC-8414-Metadaten: die Endpunkte, Grant Types und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth Bearer oder ein API-Schlüssel | Der MCP-Protokoll-Endpunkt. Agiert **als der angemeldete Benutzer** (oder als derjenige, für den der Schlüssel agiert), sodass jeder Lese- und Schreibvorgang demselben RLS unterliegt. Die `data:*`-Scopes bestimmen, welche Tools angeboten werden |
| `GET` | `/mcp` | OAuth Bearer oder ein API-Schlüssel | Antwortet mit `405` und `Allow: POST, DELETE`: Dieser Server öffnet keinen serverinitiierten Stream. Das Token wird zuerst überprüft, sodass ein fehlendes oder veraltetes Token stattdessen den `401`-Challenge erhält |
| `DELETE` | `/mcp` | none | Antwortet mit `204`. Der Endpunkt verwaltet keine Session, daher gibt es nichts zu beenden |
| `POST` | `/api/oauth/register` | Rate-limited | Dynamische Client-Registrierung nach RFC 7591. Abgelehnt, wenn `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Der Zustimmungsbildschirm, zu dem ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Entscheidung der Person darauf – Genehmigen oder Ablehnen |
| `POST` | `/api/oauth/token` | Client Credentials + PKCE | Tauscht einen Autorisierungscode ein oder führt einen Refresh durch |
| `POST` | `/api/oauth/revoke` | Client Credentials | Token-Widerruf nach RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer autorisiert hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Widerruft einen Client, sodass eine Person eine Zustimmung ohne einen Admin rückgängig machen kann |

Der eigene MCP-Endpunkt des Admin-Panels gehört nicht zu dieser Schnittstelle: Er
verwendet die Session des Admin-Panels, niemals ein OAuth-Token, und wird zusammen
mit den Admin-Routen bereitgestellt – unabhängig davon, ob `REBASE_MCP_ENABLED` gesetzt
ist oder nicht – über einen Treiber, der jeden Aufruf auf RLS beschränkt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, niemals anonym | **Experimentell.** Dieselben Tools wie `/mcp`, für die angemeldete Person, mit `data:read`, `data:write` und `data:delete`, unter deren RLS. Die `savedAppsView` des Admin-Panels öffnet [gespeicherte Apps](/docs/ai/remote-mcp/) darüber |

## Verwandte Themen

- [REST-API](/docs/backend/api/) – die Daten-Routen im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth-Endpunkte](/docs/backend/auth-endpoints/) – Struktur von Anfragen und Antworten für die obige Auth-Tabelle
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – die Variablen, die steuern, welche dieser Routen bereitgestellt werden
