---
sourceHash: 9338d2b094861fba
title: Tenancy
sidebar_label: Tenancy
description: Delimita cada fila de una tabla a un sitio, organización o espacio de trabajo con una sola declaración de tenant, aplicada mediante la seguridad a nivel de fila de Postgres.
---

## Qué hace

<span class="since-badge" data-since="0.31">Since 0.31</span>

`tenant` en una tabla especifica la columna que contiene el tenant al que pertenece una fila (un sitio, una organización, un espacio de trabajo) e indica de dónde proviene el tenant de quien realiza la llamada. A partir de esa única declaración, Rebase genera:

- **Una política RLS restrictiva**, `<table>_tenant_scope`. Las políticas restrictivas se combinan mediante un operador lógico AND con todas las demás políticas de la tabla, por lo que la tenencia (tenancy) restringe lo que permite el `rls` de la tabla y nunca lo amplía. Una regla `access: "public"` en otra parte del archivo no puede anular este límite.
- **Una columna `NOT NULL` e indexada.** Una fila sin tenant no pertenecería a nadie, y una columna de tenant no indexada convertiría cada lectura en un escaneo secuencial (sequential scan).
- **El tenant en las escrituras.** Una operación de creación que deje el campo vacío obtiene el tenant de quien realiza la llamada cuando este tiene exactamente uno. Cualquier valor ambiguo o externo es rechazado (consulte [Escrituras](#escrituras)).
- **Un trigger que mantiene las filas en su tenant.** Una actualización que intente mover una fila a otro tenant es rechazada, tanto en la API como en el SQL ejecutado como quien realiza la llamada.

Dado que Postgres lo hace cumplir, el panel de administración, la API REST, el SDK y el SQL ejecutado como quien realiza la llamada ven todos las mismas filas.

## Un tenant por usuario: un claim

<span class="since-badge" data-since="0.31">Since 0.31</span>

Cuando cada usuario pertenece exactamente a un tenant, colóquelo en su token de sesión e indique el nombre del claim:

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

La política compara el `site_id` de la fila con el claim `site_id`, convertido (cast) al tipo de la columna. El claim proviene de su proveedor de identidad o del hook de autenticación `customizeAccessToken` (`auth.hooks`, consulte [Autenticación](/docs/backend/authentication/); el runtime administrado no tiene rutas para hooks, por lo que esto requiere un backend desacoplado [ejected]). Los claims reservados como `uid`, `roles` y `aal` no pueden designar a un tenant: se escriben después de los claims personalizados, por lo que un hook no puede definirlos, y cualquier configuración que especifique uno de ellos será rechazada.

## Varios tenants por usuario: una tabla de membresías

<span class="since-badge" data-since="0.31">Since 0.31</span>

Cuando los usuarios trabajan en varios tenants (un editor en dos sitios, un consultor en tres organizaciones), mantenga las membresías en una tabla propia:

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

`membership.table` es el slug de la tabla de membresías; `userField` y `tenantField` son las claves de columna en ella.

La política es un `EXISTS` correlacionado sobre `site_members`: "¿es quien realiza la llamada un miembro del sitio de esta fila?", resuelto dentro de la misma consulta. Nada se incluye en el token, por lo que agregar o quitar una membresía surte efecto en la siguiente instrucción, sin necesidad de iniciar sesión nuevamente.

La tabla de membresías debe permitir que quienes realizan llamadas lean sus propias filas, ya que la política se evalúa como el usuario que realiza la consulta y el RLS propio de la tabla de membresías se aplica en su interior. El inicio (Boot) rechazará cualquier configuración en la que esto no suceda, y el error indicará la regla que debe agregarse. Boot también rechazará una tabla de membresías que no exista, que carezca de alguna de las columnas indicadas o que no esté almacenada en la misma base de datos de Postgres.

## A quién no se aplica

`bypassRoles` enumera los roles que leen y escriben a través de todos los tenants. Su valor predeterminado es `["admin"]`, para que el panel de administración no le muestre una tabla vacía a un administrador. Un arreglo vacío significa que ningún rol lo omite; el contexto confiable del propio servidor (migraciones, flujos de autenticación) aún lo hace.

```typescript
tenant: { field: "siteId", from: { claim: "site_id" }, bypassRoles: ["admin", "support"] }
```

## Escrituras

Cada rechazo es un error `400` que nombra el campo, antes de consultar a la base de datos:

| Código | Cuándo |
|---|---|
| `TENANT_REQUIRED` | Una operación de creación dejó el campo vacío y quien realiza la llamada no tiene ningún tenant o pertenece a varios. Envíe el tenant en la escritura |
| `TENANT_MISMATCH` | La escritura especifica un tenant al que quien realiza la llamada no pertenece |
| `TENANT_IMMUTABLE` | Una actualización movería la fila a otro tenant. Créela en el otro tenant y elimine esta, o hágalo con un rol de `bypassRoles` |

El SQL ejecutado como quien realiza la llamada obtiene las mismas respuestas de Postgres: el `WITH CHECK` de la política rechaza un tenant ajeno y un trigger `BEFORE UPDATE` rechaza un traslado (`42501`). Quien realiza la llamada con un rol de omisión (bypass role) está exento de los tres.

## El campo

<span class="since-badge" data-since="0.31">Since 0.31</span>

- Una columna de tipo text, `uuid`, enum o integer (`numeric` también), o una relación `belongsTo` con la tabla de tenants. Para una relación, su columna de clave foránea es el campo; no se crea una segunda.
- Debe declararse en la tabla y ser legible: el esquema es rechazado cuando el campo falta, es de otro tipo o está restringido por `.private()` o `.access({ read })`. Los tipos comprueban que el campo designe una columna.
- La columna se convierte en `NOT NULL`, independientemente de cómo se haya declarado, y se indexa.
- No en una vista: la seguridad a nivel de fila (row-level security) es lo que la hace cumplir.

## Qué no cubre

- **Archivos.** Las subidas no son filas. Delimítelas por ruta con la [autorización de almacenamiento](/docs/backend/storage-authorization/), por ejemplo, una carpeta por sitio.
- **Navegación.** Las tablas se muestran u ocultan en el CMS por rol, no por tenant. Un miembro de un sitio ve las mismas tablas que todos los demás, conteniendo únicamente las filas de su sitio.
- **Infraestructura separada.** Todos los tenants comparten una única base de datos y un único servidor. Cuando los tenants no deban compartir infraestructura en absoluto, proporcione a cada uno su propio despliegue.

## Relacionado

- [Seguridad a nivel de fila](/docs/collections/security-rules/): las reglas con las que la tenencia (tenancy) se combina mediante AND
- [Acceso a campos](/docs/collections/field-access/): permisos de lectura y escritura por campo
- [Autorización de almacenamiento](/docs/backend/storage-authorization/): quién lee y escribe qué archivos
