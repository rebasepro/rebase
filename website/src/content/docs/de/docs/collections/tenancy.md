---
sourceHash: 9338d2b094861fba
title: Mandantenfähigkeit
sidebar_label: Mandantenfähigkeit
description: Beschränken Sie jede Zeile einer Tabelle mit einer einzigen Tenant-Deklaration auf eine Site, Organisation oder einen Workspace, durchgesetzt durch Postgres-Row-Level-Security.
---

## Funktionsweise

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`tenant` an einer Tabelle benennt die Spalte, die den Mandanten enthält, zu dem eine Zeile
gehört (eine Site, eine Organisation, ein Workspace), und gibt an, woher der Mandant
des Aufrufers stammt. Aus dieser einzigen Deklaration generiert Rebase:

- **Eine restriktive RLS-Policy**, `<table>_tenant_scope`. Restriktive Policies
  werden mit jeder anderen Policy für die Tabelle per UND verknüpft, sodass Mandantenfähigkeit das einschränkt, was
  das `rls` der Tabelle erlaubt, und es niemals erweitert. Eine
  `access: "public"`-Regel an anderer Stelle in der Datei kann diese Begrenzung nicht aufheben.
- **Eine indizierte `NOT NULL`-Spalte.** Eine Zeile ohne Mandanten würde niemandem gehören,
  und eine nicht indizierte Mandantenspalte würde jeden Lesevorgang in einen sequenziellen Scan verwandeln.
- **Den Mandanten bei Schreibvorgängen.** Ein Erstellungsvorgang, der das Feld leer lässt, erhält den
  Mandanten des Aufrufers, wenn dieser genau einen besitzt. Alles Mehrdeutige oder Fremde wird
  abgelehnt (siehe [Schreibvorgänge](#schreibvorgänge)).
- **Einen Trigger, der Zeilen in ihrem Mandanten hält.** Eine Aktualisierung, die eine Zeile zu einem
  anderen Mandanten verschieben würde, wird abgelehnt – sowohl in der API als auch in SQL, das als Aufrufer ausgeführt wird.

Da Postgres dies durchsetzt, sehen das Admin-Panel, die REST-API, das SDK und als
Aufrufer ausgeführtes SQL alle dieselben Zeilen.

## Ein Mandant pro Benutzer: ein Claim

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn jeder Benutzer zu genau einem Mandanten gehört, hinterlegen Sie ihn auf dessen Session-Token
und benennen Sie den Claim:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: { field: "siteId", from: { claim: "site_id" } },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

Die Policy vergleicht die `site_id` der Zeile mit dem `site_id`-Claim, umgewandelt in den
Typ der Spalte. Der
Claim stammt von Ihrem Identity-Provider oder aus dem `customizeAccessToken`-Auth-Hook
(`auth.hooks`, siehe [Authentifizierung](/docs/backend/authentication/);
die Managed Runtime bietet keine Route für Hooks, daher ist hierfür ein Ejected Backend erforderlich).
Reservierte Claims wie `uid`, `roles` und `aal` können keinen Mandanten benennen: Sie
werden nach benutzerdefinierten Claims geschrieben, sodass ein Hook sie nicht festlegen kann, und eine Konfiguration,
die einen solchen benennt, wird abgewiesen.

## Mehrere Mandanten pro Benutzer: eine Membership-Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn Personen mandantenübergreifend arbeiten (ein Editor auf zwei Sites, ein Berater in drei
Organisationen), führen Sie die Mitgliedschaften in einer eigenen Tabelle:

```ts
// backend/schema/site-members.ts
import { defineTable, col } from "@rebasepro/server/schema";

// One row per person per site they work on.
export const siteMembers = defineTable("site_members", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        userId: col.uuid().notNull(),
        siteId: col.uuid().notNull(),
    },
    // Members read their own rows. Required: the tenancy policy reads this
    // table as the caller, so without it nobody but an admin sees a post.
    rls: [{ operation: "select", ownerField: "userId" }],
});
```

```ts
// backend/schema/posts.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: {
        field: "siteId",
        from: { membership: { table: "site_members", userField: "userId", tenantField: "siteId" } },
    },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

`membership.table` ist der Slug der Membership-Tabelle; `userField` und
`tenantField` sind Spaltenschlüssel darin.

Die Policy ist ein korreliertes `EXISTS` über `site_members`: „Ist der Aufrufer ein
Mitglied der Site dieser Zeile?“, beantwortet in derselben Abfrage. Auf dem
Token wird nichts gespeichert, sodass das Hinzufügen oder Entfernen einer Mitgliedschaft mit der nächsten Anweisung wirksam wird,
ohne dass eine erneute Anmeldung erforderlich ist.

Die Membership-Tabelle muss Aufrufern das Lesen ihrer eigenen Zeilen erlauben, da eine
Policy als der abfragende Benutzer ausgewertet wird und das RLS der Membership-Tabelle selbst
darin greift. Boot weist eine Konfiguration zurück, bei der dies nicht der Fall ist, und der Fehler benennt
die hinzuzufügende Regel. Boot weist auch eine Membership-Tabelle zurück, die nicht existiert, der eine der genannten
Spalten fehlt oder die nicht in derselben Postgres-Datenbank gespeichert ist.

## Für wen dies nicht gilt

`bypassRoles` listet die Rollen auf, die über alle Mandanten hinweg lesen und schreiben dürfen. Der
Standardwert ist `["admin"]`, damit das Admin-Panel einem Admin keine leere
Tabelle anzeigt. Ein leeres Array bedeutet, dass keine Rolle dies umgeht; der vertrauenswürdige
Kontext des Servers selbst (Migrationen, die Auth-Flows) tut dies weiterhin.

```typescript
tenant: { field: "siteId", from: { claim: "site_id" }, bypassRoles: ["admin", "support"] }
```

## Schreibvorgänge

Jede Ablehnung ist ein `400`-Fehler, der das Feld benennt, noch bevor die Datenbank abgefragt wird:

| Code | Wann |
|---|---|
| `TENANT_REQUIRED` | Bei einer Erstellung wurde das Feld leer gelassen und der Aufrufer hat keinen Mandanten oder gehört mehreren an. Übergeben Sie den Mandanten beim Schreibvorgang |
| `TENANT_MISMATCH` | Der Schreibvorgang benennt einen Mandanten, zu dem der Aufrufer nicht gehört |
| `TENANT_IMMUTABLE` | Eine Aktualisierung würde die Zeile zu einem anderen Mandanten verschieben. Erstellen Sie sie im anderen Mandanten und löschen Sie diese, oder führen Sie den Vorgang mit einer Rolle aus `bypassRoles` durch |

Als Aufrufer ausgeführtes SQL erhält dieselben Antworten von Postgres: Das
`WITH CHECK` der Policy weist einen fremden Mandanten zurück, und ein `BEFORE UPDATE`-Trigger weist eine
Verschiebung zurück (`42501`). Ein Aufrufer in einer Bypass-Rolle ist von allen dreien ausgenommen.

## Das Feld

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- Eine Spalte vom Typ Text, `uuid`, Enum oder Integer (auch `numeric`) oder eine `belongsTo`-Relation
  zur Mandantentabelle. Bei einer Relation ist deren Fremdschlüsselspalte
  das Feld; es wird kein zweites erstellt.
- Es muss auf der Tabelle deklariert und lesbar sein: Das Schema wird zurückgewiesen, wenn das
  Feld fehlt, einen anderen Typ hat oder durch `.private()` oder
  `.access({ read })` eingeschränkt ist. Die Typen prüfen, ob das Feld eine Spalte benennt.
- Die Spalte wird unabhängig von ihrer Deklaration als `NOT NULL` definiert und indiziert.
- Nicht auf einem View: Row-Level-Security ist das, was dies durchsetzt.

## Was nicht abgedeckt ist

- **Dateien.** Uploads sind keine Zeilen. Schränken Sie deren Gültigkeitsbereich nach Pfad mit
  [Storage-Autorisierung](/docs/backend/storage-authorization/) ein, beispielsweise ein
  Ordner pro Site.
- **Navigation.** Tabellen werden im CMS pro Rolle ein- oder ausgeblendet, nicht pro
  Mandant. Ein Mitglied einer Site sieht dieselben Tabellen wie alle anderen, die
  nur die Zeilen seiner Site enthalten.
- **Getrennte Infrastruktur.** Jeder Mandant teilt sich eine Datenbank und einen Server.
  Wo Mandanten sich überhaupt keine Infrastruktur teilen dürfen, geben Sie jedem ein eigenes
  Deployment.

## Verwandte Themen

- [Row-Level-Security](/docs/collections/security-rules/): Die Regeln, mit denen Mandantenfähigkeit per UND verknüpft wird
- [Feldzugriff](/docs/collections/field-access/): Lese- und Schreibberechtigungen auf Feldebene
- [Storage-Autorisierung](/docs/backend/storage-authorization/): Wer welche Dateien liest und schreibt
