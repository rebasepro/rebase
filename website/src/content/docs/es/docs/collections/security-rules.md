---
sourceHash: 22cf5bf2953fb715
title: Reglas de seguridad (RLS)
sidebar_label: Reglas de seguridad
description: Define políticas de seguridad a nivel de fila (RLS) para tus colecciones mediante atajos prácticos o expresiones SQL puras.
---

## Descripción general

Las reglas de seguridad te permiten definir políticas de **seguridad a nivel de fila (RLS)** para tus tablas de PostgreSQL directamente en las definiciones de tus colecciones. Cuando se genera el esquema de Drizzle, Rebase crea las sentencias `CREATE POLICY` correspondientes.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Cómo funciona

1. Defines `securityRules` en una colección
2. `rebase schema generate` crea el esquema de Drizzle con RLS habilitado
3. `rebase db push` o `rebase db migrate` aplica las políticas a PostgreSQL
4. Cada consulta se filtra automáticamente según el contexto del usuario actual

La identidad del usuario autenticado está disponible en SQL a través de:

| Función | Devuelve |
|----------|---------|
| `rebase.uid()` | El ID del usuario actual |
| `rebase.roles()` | IDs de roles de la aplicación separados por comas |
| `rebase.jwt()` | Los claims completos del JWT como JSONB |

El backend de Rebase establece estos valores automáticamente por transacción.

## Atajos prácticos

### Acceso basado en el propietario

El patrón más simple: los usuarios solo pueden acceder a las filas de las que son propietarios:

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

Esto genera: `USING (user_id = rebase.uid())`

### Acceso público

Permite que cualquiera (incluidos los usuarios no autenticados) pueda leer:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Esto genera: `USING (true)`

### Acceso autenticado

Permite el acceso a cualquier usuario que haya iniciado sesión. En este caso se trata de un `condition` en lugar de un atajo de `access` —`access` tiene exactamente un único valor, `"public"`—, porque "haber iniciado sesión" es una comprobación sobre quien realiza la llamada, y el builder es el lugar donde residen las comprobaciones sobre el emisor:

```typescript
import { policy } from "@rebasepro/types";

securityRules: [
    { operation: "select", condition: policy.authenticated() }
]
```

`policy.authenticated()` también es verdadero para el *inicio de sesión* anónimo, el cual genera una fila de usuario real y una sesión real. Utiliza `policy.registered()` donde un invitado no deba calificar: escribir una reseña, unirse a una organización o gastar dinero.

### Acceso basado en roles

Restringe las operaciones a roles específicos:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

### Acceso por membresía / relacional

Para delimitar el acceso según la membresía en una colección *relacionada* (por ejemplo, "solo las filas cuyo equipo incluya a quien realiza la llamada"), utiliza el `condition` estructurado con `policy.existsIn`. Se compila en una única subconsulta `EXISTS` correlacionada (sin búsquedas por fila) y es la alternativa segura y de primer nivel a escribir manualmente el SQL puro que se muestra más adelante.

```typescript
import { policy } from "@rebasepro/types";

// documents visible only to members of the document's team:
securityRules: [
    {
        operation: "select",
        condition: policy.existsIn({
            collection: "team_members",         // the join / membership collection
            where: policy.and(
                // correlate to the row being checked:
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                // …and to the caller:
                policy.compare(policy.field("user_id"), "eq", policy.authUid()),
            ),
        }),
    },
]
```

Dentro de `where`, `policy.field(...)` hace referencia a una columna de la colección unida (`team_members`), mientras que `policy.outerField(...)` se refiere a una columna de la fila que se está comprobando (`documents`). Combínalo con `policy.authUid()` para delimitarlo al usuario actual. Dado que se aplica a nivel de base de datos, la interfaz de administración lo trata con autoridad del servidor (server-authoritative).

#### El builder `policy`, en detalle

Importado desde `@rebasepro/types`. Las expresiones se componen; los operandos son las hojas.

| Expresión | Se compila como |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` | conjunción / disyunción |
| `policy.not(e)` | negación |
| `policy.compare(left, op, right)` | una comparación entre dos operandos |
| `policy.rolesOverlap(roles)` | quien realiza la llamada tiene **cualquiera** de estos roles de la app |
| `policy.rolesContain(roles)` | quien realiza la llamada tiene **todos** estos roles de la app |
| `policy.authenticated()` | sesión iniciada: `rebase.uid()` está definido **y no es un centinela anónimo**. `IS NOT NULL` por sí solo sería una tautología, ya que una solicitud anónima establece un valor centinela en lugar de dejarlo indefinido |
| `policy.registered()` | sesión iniciada **con una cuenta**: `authenticated()` y no un invitado. Ver más abajo |
| `policy.serverContext()` | `rebase.uid() IS NULL` — consulta la advertencia a continuación |
| `policy.existsIn({ collection, where })` | una subconsulta `EXISTS` correlacionada |
| `policy.raw(sql)` | una vía de escape, insertada textualmente |

| Operando | Significado |
|---|---|
| `policy.field(name)` | una columna de la colección que se está comprobando; o, dentro de `existsIn`, de la unida |
| `policy.outerField(name)` | dentro de `existsIn`, una columna de la fila externa |
| `policy.literal(value)` | una cadena de texto, número, booleano o `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | `rebase.roles()` |

### `authenticated()` y `registered()`

A dos cosas distintas se las llama anónimas, y conviene ser precisos sobre a cuál de ellas se refiere una regla.

Una solicitud **no autenticada** no incluye ninguna sesión. Se le asigna un ID centinela para que `rebase.uid()` nunca sea `NULL` en la ruta de usuario, y `policy.authenticated()` la excluye; eso es lo que hace que signifique "con sesión iniciada" en lugar de "cualquiera".

Un **invitado** (guest) es lo opuesto: una sesión sin nadie detrás. `POST /auth/anonymous` crea una fila de usuario real con un uid real, por lo que un invitado supera cualquier comprobación que evalúe el ID. Ese es el propósito de la funcionalidad: un carrito antes del checkout, un borrador antes del registro; y significa que `authenticated()` es verdadero para cualquiera que haya pulsado *Continuar como invitado*, lo cual no solicita correo, contraseña ni aceptación de términos.

`policy.registered()` es `authenticated()` más "no ser un invitado". Recurre a él siempre que una regla concierna a una persona que deba ser responsable de algo: escribir una reseña, unirse a una organización o gastar dinero. Recurre a `authenticated()` donde un invitado sea genuinamente bienvenido.

```ts
// Anyone with a session, guests included — a draft cart.
{ operation: "insert", check: policy.authenticated() }

// Someone with an account.
{ operation: "insert", check: policy.registered() }
```

Internamente, el indicador de invitado viaja con la sesión: está en el token de acceso y llega a la base de datos como `rebase.is_anonymous()`, de modo que una política puede realizar la comprobación sin necesidad de hacer una consulta adicional. Una base de datos servida por un servidor demasiado antiguo para configurarlo interpreta cada sesión como una cuenta, que es el comportamiento que dicho despliegue ya tenía.

:::caution[`serverContext()` no es satisfecho por el singleton del servidor]
Se compila como `rebase.uid() IS NULL`, y `rebase.dataAsAdmin` se ejecuta como `uid: "service"`, por lo que es **falso** para el descriptor de acceso que la mayoría entiende por "el servidor". Una colección con `disableDefaultPolicies: true` cuya única regla sea `serverContext()` deniega esas escrituras (`42501`) y devuelve cero filas —HTTP 200, vacío— para esas lecturas. `rebase.sql()` es el descriptor de acceso que genuinamente omite las políticas.
:::

## Expresiones SQL puras

Para lógica compleja, utiliza `using` y `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtra qué filas existentes son visibles (se aplica a SELECT, UPDATE, DELETE)
- **`withCheck`** — Valida los valores de las nuevas filas (se aplica a INSERT, UPDATE)

Las referencias a columnas utilizan la sintaxis `{nombre_columna}`, la cual se resuelve a la columna completamente calificada con el nombre de la tabla.

## Combinar atajos y SQL

Combina atajos prácticos con SQL puro:

```typescript
securityRules: [
    // Admins can do anything
    { operation: "all", roles: ["admin"], using: "true" },
    // Regular users can only see their own rows
    { operation: "select", ownerField: "user_id" },
    // Users can insert, but only for themselves
    { operation: "insert", withCheck: "{user_id} = rebase.uid()" },
    // Locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permisivo vs Restrictivo

PostgreSQL tiene dos modos de políticas:

- **Permisivo** (predeterminado) — Múltiples políticas permisivas se combinan con un operador **OR**. Si cualquiera de ellas se cumple, se concede el acceso.
- **Restrictivo** — Las políticas restrictivas se combinan con un operador **AND**. Todas deben cumplirse.

```typescript
securityRules: [
    // Permissive: owners can access their rows
    { operation: "all", ownerField: "user_id" },
    // Restrictive: but locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operaciones

| Operación | Equivalente en SQL | Descripción |
|-----------|-------------------|-------------|
| `"select"` | `SELECT` | Leer filas |
| `"insert"` | `INSERT` | Crear nuevas filas |
| `"update"` | `UPDATE` | Modificar filas existentes |
| `"delete"` | `DELETE` | Eliminar filas |
| `"all"` | Todas las anteriores | Atajo para todas las operaciones |

También puedes usar `operations` (en plural) para aplicar una regla a múltiples operaciones:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Interfaz completa de SecurityRule

`SecurityRule` es una **unión**, no un único objeto abierto: una regla elige exactamente una forma de expresar su predicado, y las demás se tipifican como `never`, de modo que mezclarlas produce un error de compilación en lugar de una política que ignore silenciosamente la mitad de lo que escribiste.

```typescript no-verify
// Shared by every variant
interface SecurityRuleBase {
    name?: string;                        // Policy name. Omit it and one is derived
    operation?: SecurityOperation;        // "select" | "insert" | "update" | "delete" | "all"
    operations?: SecurityOperation[];     // …or several at once
    mode?: "permissive" | "restrictive";  // Default: "permissive"
    roles?: string[];                     // App roles, via rebase.roles()
    pgRoles?: string[];                   // Native Postgres roles — the CREATE POLICY `TO` clause.
                                          // NOT the same as `roles`. Default: ["public"]
}

// …plus exactly one of:
{ ownerField: string }                        // <column> = rebase.uid()
{ access: "public" }                          // the one shortcut — "no row filter"
{ condition: PolicyExpression;                // the structured builder — `policy.*`
  check?: PolicyExpression }                  // defaults to `condition`, as Postgres does
{ using?: string; withCheck?: string }        // raw SQL
```

`roles` y `pgRoles` son los dos que suelen confundirse. `roles` es un rol de aplicación, aplicado *dentro* de la cláusula `USING` / `WITH CHECK` a través de `rebase.roles()`. `pgRoles` es un rol de base de datos y controla a qué conexiones se vincula la política en absoluto. Prácticamente todos los proyectos necesitan `roles`.

:::tip[Cómo rellenar la columna indicada en `ownerField`]
`ownerField` compara una columna con `rebase.uid()`; no introduce ningún valor en ella. Declara esa columna como una cadena de texto con [`autoValue: "user_on_create"`](/docs/collections/properties#audit-columns) y el controlador estampará el uid del usuario actuante al insertar, sobrescribiendo lo que haya enviado el cuerpo de la solicitud, que es lo que hace verdadera la premisa de la política. Si una columna es proporcionada por quien realiza la llamada, quien realiza la llamada puede mentir sobre ella.
:::

## Ejemplos

### Plataforma de blog

```typescript
securityRules: [
    // Anyone can read published posts
    { operation: "select", using: "{status} = 'published'" },
    // Authors can see their own drafts
    { operation: "select", ownerField: "authorId" },
    // Authors can create and edit their own posts
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Only admins can delete
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS multiinquilino (Multi-Tenant)

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Acceso anónimo (inserciones públicas)

Una necesidad común es permitir que los **usuarios no autenticados** envíen datos: formularios de contacto, suscripciones a boletines o solicitudes públicas. Rebase ofrece un patrón limpio para esto.

### Recomendado: una regla `withCheck` pura

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const contactMessagesCollection = defineCollection({
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Anyone can submit a contact message
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Only admins can read, update, or delete messages
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

El atajo `access: "public"` genera una política que permite la operación sin requerir autenticación.

### Para captación de prospectos / registros

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const leadSignupsCollection = defineCollection({
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Allow anonymous inserts
        { operation: "insert", using: "true", withCheck: "true" },
        // Admins can view all signups
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

### Cómo funcionan las solicitudes anónimas

Cuando llega una solicitud sin un token JWT, el backend de Rebase establece las variables de sesión de PostgreSQL en:

| Variable | Valor |
|----------|-------|
| `app.user_id` | `'anonymous'` |
| `app.user_roles` | `''` (vacío) |

Esto significa que:

- `rebase.uid()` devuelve `'anonymous'`
- `rebase.roles()` devuelve una cadena vacía
- Las políticas con `access: "public"` se cumplen porque generan `USING (true)` / `WITH CHECK (true)`
- Las condiciones `policy.authenticated()` fallan porque comprueban un ID de usuario real
- Las políticas con `ownerField` fallan porque ninguna fila tendrá `user_id = 'anonymous'` (a menos que se establezca explícitamente)

### Avanzado: SQL puro para acceso anónimo

Si necesitas un control más granular, utiliza SQL puro:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Evita el patrón heredado de comprobar `string_to_array(rebase.roles(), ',')` para el acceso anónimo. El atajo `access: "public"` es más simple y genera la política correcta automáticamente.
:::

## Filas aquí, campos al lado

Las reglas de seguridad responden a una sola pregunta: a **qué filas** accede quien realiza la llamada. Postgres las aplica por sí mismo, en cada instrucción y sin importar la ruta; razón por la cual constituyen el modelo de autorización y todo lo que está por encima es mera conveniencia.

No tienen nada que decir acerca de las *columnas* de una fila a la que el emisor sí accede. Una política que permite a un empleado leer las filas de su equipo le permite leer todos los campos de esas filas, salario incluido. Para eso existe el [`access`](/docs/collections/field-access/) por propiedad:

```typescript
salary: {
    type: "number",
    // Everyone the rules above let read the row; only HR gets this column.
    access: { read: ["hr"], write: [] }
}
```

Ambos se complementan y nunca entran en contradicción: una regla de campo no puede ampliar el acceso a filas, y una fila que no puedes leer no tiene campos de los que hablar. Los roles son los mismos roles: `rebase.roles()` dentro de una política, `user.roles` en la solicitud; por lo que `rolesOverlap(['hr'])` en una regla y `access: { read: ["hr"] }` en una propiedad significan el mismo `hr`. Las reglas de campo son aplicadas por el servidor en lugar de Postgres, por lo que cubren la superficie de la API; una consulta ejecutada mediante `rebase.sql()` ve todas las columnas, tal como omite RLS.

## Pasos siguientes

- **[Acceso a nivel de campo](/docs/collections/field-access)** — Roles de lectura/escritura por campo
- **[Relaciones](/docs/collections/relations)** — Claves foráneas y uniones (joins)
- **[Callbacks de entidades](/docs/collections/callbacks)** — Hooks del ciclo de vida
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Endpoints de API personalizados
