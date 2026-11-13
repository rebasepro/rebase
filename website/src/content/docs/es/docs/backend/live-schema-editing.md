---
sourceHash: a8ca2780e6bbad15
title: Edición de esquemas en vivo
description: Crea y modifica tablas en un backend en ejecución; la edición se escribe en backend/schema, primero se confirma en tu repositorio y luego se aplica.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El editor de esquemas en el panel de administración reescribe los archivos de tablas en
`backend/schema`. Eso funciona en tu máquina y en ningún otro lugar: los archivos de un
servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo
que una edición realizada allí se descartaría en el siguiente.

La edición de esquemas en vivo es la solución a eso. **Confirma el cambio en tu
repositorio y luego aplica el DDL**, por lo que la edición sobrevive al siguiente despliegue,
ya que este se construye a partir de ella.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status y plan necesitan el ámbito `schema:read`, y apply necesita `schema:write`, como
cualquier otra superficie de `/api/admin` que especifique un ámbito. Un administrador posee ambos.
La aplicación también requiere una cosa más además del ámbito; consulta [Quién puede aplicar](#quién-puede-aplicar).

## Las ediciones: `TablePatch`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada ruta que cambia el esquema toma el mismo cuerpo, `{ patches }`: una lista
de ediciones, cada una identificando su tabla por slug. El tipo es `TablePatch`, de
`@rebasepro/types`.

| `op` | Lo que escribe en `backend/schema` |
|---|---|
| `createTable` | un nuevo `backend/schema/<name>.ts` que contiene la tabla, exportada desde `index.ts` |
| `deleteTable` | elimina el archivo y su exportación |
| `addColumn` `{ key, column, before? }` | una columna, antes de la indicada por `before`, o al final |
| `changeColumn` `{ key, column }` | reescribe la cadena de construcción de una columna; se conserva el `.transform()` escrito en ella |
| `renameColumn` `{ key, to, column }` | renombra la clave, conservando la columna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | elimina o reordena una columna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | una entrada `rel.*`; el `target` de la relación es un slug |
| `setRls` `{ rls }` | la postura: `"admin-only"`, `"inherit"` o una lista de reglas |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | una regla de la lista |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` o `metadata`; `null` la elimina |

Una columna viaja como su definición —el tipo de Postgres como `{ kind: … }`, y los
modificadores como flags— sin sus hooks `.transform()`, que son código y permanecen
donde están escritos:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Solo se reescribe el código especificado por una edición. Todo lo demás permanece tal cual:
importaciones, comentarios, formato, una columna compartida desde otro módulo. El editor
rechaza, nombrando la expresión, una edición que afecte *internamente* a algo definido
en código: una tabla construida con un spread, una columna construida mediante un helper, reglas
contenidas en una variable, una clave calculada o una columna cuya estructura JSON incluya transformaciones.
Tampoco renombra nunca un slug, una tabla, un esquema o el nombre de una definición (eso mueve
datos: escribe una migración), nunca elimina la última regla (utiliza `setRls` con
`"admin-only"`), rechaza `rls` en una vista y rechaza eliminar una tabla a la que
apunten otras relaciones. Una edición cuyo resultado no compile se rechaza con
`SCHEMA_EDIT_DOES_NOT_COMPILE` junto con los problemas del compilador. No se escribe nada
ante ningún rechazo.

La apariencia de una tabla en el panel de administración —etiquetas, iconos, grupos, modos
de vista, colores de enum— no es una edición de esquema: reside en `frontend/src/cms` y
en las preferencias guardadas del panel, y nada de esto viaja en un `TablePatch`.

`$ADMIN_TOKEN` es un token de acceso —el `accessToken` que devuelve un inicio de sesión— para
una cuenta con el permiso `schema:read`: un administrador o un rol que lo declare. Nada en
la máquina lo configurará por ti.

## Planifica antes de aplicar

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`/plan` no tiene efectos secundarios. Envía las ediciones por POST y te dirá lo que significan:

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"patches":[{"op":"addColumn","table":"posts","key":"subtitle","column":{"type":{"kind":"text"}}}]}'
```

```json
{
  "applicable": true,
  "verdict": "safe",
  "changes": [
    { "kind": "add-property", "verdict": "safe", "collection": "posts",
      "property": "subtitle", "detail": "New optional property subtitle …" }
  ],
  "statements": ["ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"subtitle\" TEXT;"],
  "files": ["backend/schema/posts.ts", "backend/src/schema.generated.ts"],
  "message": "…the commit message the apply would use…",
  "withheldConstraints": [],
  "followUp": []
}
```

`files` contiene cada archivo que la aplicación confirma en el commit: el código fuente
de la tabla, cuando el backend puede escribirlo, y luego el esquema generado. Los registros
de cambios del planificador mantienen sus nombres originales de transmisión (`add-property`, `collection`, `property`).

Esto no es solo una comodidad. Dos de los tres veredictos son rechazos, y uno de
ellos es un rechazo que, de otro modo, solo descubrirías al pulsar el botón en una
base de datos en producción.

## Los tres veredictos

| Veredicto | Significado |
|---|---|
| `safe` | La ruta de verificación al arranque (ensure path) puede expresarlo y el resultado coincide con tu configuración. Se aplica. |
| `diverges` | Se aplica *en parte*, dejando una base de datos que no coincide con tu configuración, y nada lo reporta. Rechazado. |
| `needs-migration` | La ruta ensure no puede expresarlo en absoluto. Rechazado. |

`diverges` es el que vale la pena comprender, porque estos cambios parecen
haber funcionado:

- **Una columna `.notNull()` añadida a una tabla que ya contiene filas** se crea
  como **nullable**. `NOT NULL` se comprueba contra cada fila existente, y las
  filas escritas antes de que la columna existiera no tienen valor para ella. En una
  tabla **vacía** no hay nada que comprobar, por lo que la restricción se aplica y esto es
  `safe`.
- **Hacer que una columna existente sea `.notNull()`** tiene el mismo comportamiento: `SET NOT NULL`
  escanea la tabla, por lo que es `safe` en una vacía y `diverges` en una con datos
  hasta que hagas un backfill.

Dos cambios que antes eran `diverges` ahora son `safe`, porque la ruta ensure
los lleva a cabo:

- **Un valor añadido a un enum existente** se incorpora mediante
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Antes se omitía junto con todo el
  tipo, y la primera fila que utilizaba el nuevo valor era rechazada por un tipo que
  nunca había tenido constancia de él.
- **Hacer más flexible una columna `.notNull()`** elimina el `NOT NULL`. Antes se dejaba
  intacto, por lo que las escrituras que omitían la columna seguían fallando.

### Restricciones solicitadas y no aplicadas

Un cambio puede ser aplicable y aun así dejar sin aplicar algo que tu configuración requiere;
una columna `.notNull()` en una tabla con datos es un ejemplo. Eso no es
un rechazo, por lo que no aparece en `changes`; aparece en
`withheldConstraints`, con el obstáculo y lo que lo resolvería:

```json
{
  "withheldConstraints": [
    {
      "target": "public.posts.author",
      "kind": "not-null",
      "reason": "\"author\" is required, but \"public.posts\" already holds rows …",
      "remedy": "Backfill the column, then apply this again."
    }
  ]
}
```

La ruta ensure al arrancar informa lo mismo como una advertencia. Hasta que esto
existió, una restricción retenida se retenía en silencio.

`needs-migration` cubre todo lo que la ruta ensure no puede hacer: eliminar una
tabla o columna, cambiar el tipo de una columna (un cambio a entero, una cadena
convertida en enum, el tipo de elemento de un array, la longitud de un varchar), renombrar una
columna, cambiar una clave primaria, eliminar un valor de enum, hacer única una columna
existente y cambiar una relación (su tipo, su destino, su `localKey`,
su `onDelete`). Un `hasMany` o `hasOne` cuya columna de enlace nada cree también
es rechazado. Cada rechazo especifica el cambio y qué hacer en su lugar.

El veredicto se obtiene a partir del esquema que produce cada lado —el mismo plan a partir
del cual se generan `schema.generated.ts` y `db push`—, por lo que una edición que
modifique la base de datos no puede reportarse como sin cambios. Dos ediciones que parecen
cambios y no se rechazan:

- **Renombrar la clave de una columna conservando su columna SQL** (`renameColumn`,
  que escribe el nombre anterior como primer argumento del builder, `col.text("old_name")`) no mueve datos. Es `safe`; los clientes de la API leen el nuevo nombre.
- **Establecer, cambiar o eliminar un valor predeterminado** solo vincula a futuras escrituras. Es
  `safe` y se aplica con `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Editar solo el código fuente

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un cambio rechazado todavía se puede escribir en `backend/schema` y confirmarse en un
commit, dejando la base de datos tal como está; eliminar una columna que ya no se utiliza es el
caso habitual. Envía un POST a `/apply` con `"sourceOnly": true`. No se ejecuta nada; el mensaje del commit
indica lo que conserva la base de datos, por ejemplo
`chore(schema): remove sku from products (source only — column products.sku kept)`,
y cada cambio en el plan incluye una frase de `sourceOnly` que explica lo que deja
atrás —incluso cuando una columna que se deja atrás es `NOT NULL` sin valor predeterminado,
lo que hace que cada inserción posterior falle hasta que se elimine o se haga
nullable. Un cambio que no tenga esto (mover una clave primaria, una relación cuya
columna de enlace nada cree) no se puede escribir únicamente en el código fuente.

En un despliegue que no realiza cambios en su base de datos (`REBASE_PROVISION=false`),
no se aplica ningún cambio desde el panel, por lo que cada cambio sigue este camino: el
botón principal del diálogo muestra **Commit** y envía `"sourceOnly": true`, y el
proceso encargado de modificar esa base de datos aplica el esquema.

Eliminar una tabla desde el panel de administración sigue el mismo camino: `/apply` con una
edición `deleteTable` y `"sourceOnly": true` elimina el archivo de la tabla y su
exportación en `index.ts` y confirma ambos; la tabla y sus filas permanecen en la
base de datos. Se rechaza mientras la relación de otra tabla apunte a ella, especificando
dicha tabla; eliminarla impediría que el esquema compile.

## Qué se confirma en el commit

No solo el archivo de la tabla. El esquema de Drizzle se genera a partir de él, y uno
desactualizado rompería el siguiente despliegue, por lo que ambos van en el mismo commit:

- `backend/schema/<name>.ts` — la tabla en sí, y `backend/schema/index.ts` cuando se crea o elimina una tabla
- `backend/src/schema.generated.ts` — el esquema de Drizzle

Esas rutas son relativas a tu **proyecto**, no a tu repositorio. Cuando los
dos son lo mismo —un proyecto creado con `rebase init`, que es el caso habitual— no
hay nada de qué preocuparse. Cuando tu proyecto se encuentra en un subdirectorio de un repositorio
más grande, las rutas llevan dicho subdirectorio como prefijo, localizándolo al subir desde tu
directorio de esquemas hasta el `rebase.json` más cercano. Un proyecto sin
`rebase.json` conserva las rutas simples.

No se incluye SQL en el commit. `rebase db push` y `rebase db generate` generan el suyo
a partir de las tablas en cada ejecución, dentro de `.rebase/sql/`, que está en el .gitignore.

El mensaje del commit describe el cambio en lugar de simplemente anunciarlo, y se
atribuye a la persona que lo realizó mediante el nombre visible y el correo electrónico de la cuenta
(un usuario sin ninguno de los dos se confirma como `<uid>@users.noreply.rebase.pro`).

Un cambio de esquema con autor y un diff en el historial de tu proyecto es algo
que ni Firebase ni Supabase te ofrecen: las ediciones de sus tablas son invisibles para
tu repositorio.

## Quién puede aplicar

Tener `schema:read` es suficiente para **planificar**. Planificar no tiene efectos secundarios, y un
trabajo de CI que consulte si un cambio de esquema propuesto es aplicable es un buen caso de
uso para ello.

Aplicar es un segundo privilegio, ya que aplicar genera un commit y un commit
lleva un autor:

| Solicitante | Plan | Apply |
|---|---|---|
| Una persona autenticada con `schema:write` | sí | sí |
| Una clave de API con `schema:read` / `schema:write` | sí | no |
| La service key del servidor | sí | no |

Una credencial no es un autor. `api-key:7c3f…` en tu entorno de CI no es
una persona, y permitirle escribir en tu repositorio produce exactamente el
historial no atribuible que esta funcionalidad existe para reemplazar.

Si lo que deseas es un cambio de esquema automatizado (por ejemplo, un pipeline de migraciones),
actívalo deliberadamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

o `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. El commit se atribuye entonces
a la credencial por nombre —`Rebase API key (7c3f)`—, de modo que leer `git log` un
mes después todavía te indica qué cambios fueron realizados por una persona.

`GET /api/admin/schema/status` informa lo que *tú* puedes hacer, no solo lo que el
servidor admite, permitiendo que un panel deshabilite el control y explique el motivo en lugar de
rechazarte después de haber tomado una decisión:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Si tu proyecto mantiene migraciones versionadas

Aplicar aquí **no** escribe una migración, y no puede hacerlo: una migración es el formato
de Atlas con un archivo de integridad, generado por un binario externo contra una base de datos
desechable, y un servidor en ejecución no cuenta con ninguno de los dos.

Lo que sí confirma en el commit es el archivo de la tabla, y a partir de él es de donde `rebase db generate`
escribe la migración. Así que la migración está a un solo comando de distancia:

```bash
rebase db generate
```

Tanto el plan como el resultado lo indican cuando tu proyecto tiene migraciones, porque
de lo contrario el fallo es silencioso: tu base de datos tiene el cambio y tu repositorio lo describe,
pero el siguiente entorno construido al reproducir las migraciones no lo tendrá,
y nada habrá avisado.

Un proyecto aprovisionado mediante boot-ensure (el runtime administrado y cualquier self-host
que deje `REBASE_MIGRATE_ON_BOOT` en su valor predeterminado) no necesita ninguna migración. Sus
tablas son el esquema, y el siguiente arranque lo reconcilia.

## Primero confirmar en el commit, luego aplicar

El orden importa y no es arbitrario.

Si el DDL se ejecutara primero y el commit fallara, tu base de datos tendría una columna
que tu repositorio no describe. La ruta ensure nunca elimina nada, por lo que el
siguiente despliegue ni la quitaría ni la mencionaría: una columna invisible, ausente
de tus tablas, hasta que alguien fuera a buscarla.

Confirmar primero en el commit falla en el sentido contrario: el repositorio describe algo que la
base de datos aún no tiene. Ese es el estado habitual de cualquier proyecto entre
una edición y un despliegue, y el arranque lo reconcilia en el siguiente inicio.

Por lo tanto, una aplicación fallida **no es un error**. La respuesta así lo indica:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Las reglas surten efecto en la misma aplicación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un cambio en el `rls` de una tabla (o una tabla nueva) se aplica en la misma ejecución: las
directivas de las tablas modificadas se escriben en la base de datos inmediatamente después del DDL,
y la respuesta detalla lo sucedido bajo `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Donde las directivas no puedan escribirse —un backend que no tenga permitido aprovisionar
(`provision.tables` desactivado) o un controlador sin esa capacidad— el estado es
`"deferred"`; si escribir las directivas falla, es `"failed"`, junto con el error. Ambos
muestran el mensaje "Rules saved to source; they take effect on the next
deploy.", y el panel continúa mostrando las reglas que Postgres aplica hasta ese momento,
nunca reglas que no estén en vigor.

Los hooks editados en el código fuente también surten efecto con la aplicación: el servidor ejecuta las
tablas compiladas del esquema editado sin necesidad de reiniciar.

## Servido sin reiniciar

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un cambio aplicado desde Studio se sirve de inmediato. El controlador de Postgres lee
las tablas modificadas de la base de datos y las reemplaza: la API de datos,
includes, hooks y realtime ven la nueva tabla, columna, relación o tabla de unión (junction)
sin necesidad de reiniciar, y una tabla nueva recibe sus permisos (grants) y captura de cambios. La
respuesta lo indica bajo `serving`:

```json
{ "serving": { "status": "now" } }
```

En un despliegue cuyas tablas se derivan de la base de datos (sin
`backend/schema`), o con un controlador que no puede actualizar sus tablas, la
base de datos y el código fuente tienen el cambio, pero el proceso sigue sirviendo las
tablas con las que se inició. El estado es entonces `"after-restart"`, con un `message`
que el comprobante de Studio muestra como una advertencia; reinicia el proceso para servir el
cambio.

## Cuando el archivo cambia durante la edición

Una edición se prepara sobre los archivos tal como están. Si uno de ellos cambia en
el disco antes de que se aplique la edición —un guardado en el IDE, otro proceso—, la
aplicación no escribe nada y responde 409 `SCHEMA_EDIT_STALE_FILE`. El editor de colecciones
ofrece Reload; vuelve a realizar la edición sobre el archivo tal como se encuentra ahora.

## Dónde funciona esto

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La edición de esquemas en vivo reescribe `backend/schema` con el mismo editor que utilizan los
guardados de solo código fuente del panel (necesita tener instalado `ts-morph`). El origen de ese
código fuente determina dónde se ejecuta:

- **En disco** (`schemaDir`, por defecto): se ejecuta donde se ejecute el editor de solo
  código fuente. Dicho editor está desactivado bajo `NODE_ENV=production` a menos que el servidor
  establezca `schemaEditor: true`.
- **En un repositorio especificado** (`liveSchema.repository`, o
  `REBASE_LIVE_SCHEMA_REPOSITORY` para un bundle): el código fuente se lee desde
  GitHub y el cambio se confirma allí mediante un commit, por lo que funciona en cualquier lugar,
  incluida la producción. Este es el método de habilitación para un bundle compilado.

| Despliegue | Funciona |
|---|---|
| `rebase dev` en tu máquina | sí |
| Self-host con el proyecto y su árbol de trabajo de git montados | sí, cuando `NODE_ENV` no es `production`, o con `schemaEditor: true` |
| Un bundle compilado: un self-host sirviendo una compilación, o la imagen publicada | solo si se habilita con `REBASE_LIVE_SCHEMA_REPOSITORY` — consulta [Desde un bundle compilado](#desde-un-bundle-compilado) |
| Cualquier servidor con `liveSchema.repository` configurado | sí, incluido `NODE_ENV=production` |

Un bundle es una salida compilada, por lo que no contiene el código fuente de `backend/schema`, y
el runtime que lo sirve desactiva el editor de solo código fuente. A menos que especifique un
repositorio, `/api/admin/schema/status` responde `enabled: false` con el código
`SCHEMA_EDITOR_DISABLED`: edita `backend/schema` en desarrollo, haz commit y
despliega.

### Desde un bundle compilado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un bundle no tiene código propio para configurar, por lo que se habilita mediante variables
de entorno. Nada cambia para un bundle que no las defina.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

La lista completa está en [Configuración](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un repositorio especificado sin una credencial utilizable (ninguna, de ambos tipos o una GitHub
App a medias), o un valor que no sea `owner/name`, rechazará el arranque en lugar de servir
un editor que falle cuando alguien pulse Apply. Lo mismo ocurre con la variable eliminada
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, con un mensaje que indica
`REBASE_LIVE_SCHEMA_PATH`, y con cualquier ruta que salga del repositorio.

Lo que permanece igual cuando está habilitado:

- Es una superficie de `/api/admin`: no hay respuesta alguna sin `schema:read`, y
  `/apply` requiere `schema:write` y a una persona (consulta [Quién puede aplicar](#quién-puede-aplicar)).
- El destino de escritura es únicamente el repositorio que especificaste. El editor de solo
  código fuente, que escribe archivos junto al proceso, permanece desactivado.
- Cada cambio se planifica, se muestra, se confirma en el commit y luego se aplica, exactamente
  igual que en tu máquina.

El proceso que aplicó el cambio lo sirve de inmediato: sus rutas REST, los
descriptores de `GET /api/schema/tables` y el panel de administración incorporan
la edición sin necesidad de reiniciar. Otras réplicas, y este proceso tras un reinicio, servirán
las tablas con las que se compiló el bundle hasta que tu pipeline compile y despliegue el
commit.

Por lo tanto, un cambio espera a que se sirva el anterior. Un cambio planificado contra
tablas respecto a las cuales el repositorio ya va por delante confirmaría archivos de esquemas generados
que omitirían el cambio anterior. En consecuencia, cada apply genera
`schema.generated.ts` a partir de las tablas que este proceso sirve y lo compara con
la copia del repositorio. Cuando difieren, la aplicación se rechaza con
`SCHEMA_CHANGE_FAILED`, indicando el archivo, hasta que un proceso que ejecute ese commit
reemplace a este. La comprobación lee el repositorio, no la memoria de este proceso,
por lo que se mantiene tras un reinicio, entre réplicas y ante un cambio que un desarrollador
haya subido mediante push y que aún no esté desplegado. Mientras tanto, la planificación sigue disponible.

Las copias también difieren si el archivo fue generado por otra versión de Rebase,
reformateado o editado a mano. Si no hay nada pendiente de despliegue, ejecuta
`rebase schema generate` con la versión que ejecuta el despliegue, confirma el
resultado en un commit y despliégalo. Los saltos de línea y los espacios en blanco al final de línea no cuentan como
diferencias.

### Confirmar en un repositorio remoto

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`liveSchema.repository` hace que el servidor confirme cada cambio en un repositorio de GitHub
a través de la Git Data API en lugar de ejecutar `git commit` en un
árbol de trabajo. No depende de que el editor de solo código fuente esté activo: con un
repositorio configurado, la edición en vivo funciona bajo `NODE_ENV=production` y con
`schemaEditor: false`, ya que no se escribe nada en esta máquina. Un bundle
lo define mediante las variables anteriores.

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where backend/schema lives in that repository.
            // Defaults to "backend/schema".
            schemaPath: "backend/schema",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

El directorio de esquemas se lee entonces desde el repositorio, se reescribe con el
mismo editor que se ejecuta localmente y lo modificado se confirma mediante la
Git Data API: un blob por archivo, un tree, un commit y una actualización de referencia (ref update). No se
clona nada ni se deja nada en disco. Se lee el directorio completo, no solo el
archivo editado, por lo que una relación puede apuntar a otra tabla y la eliminación de una tabla funciona
igual que en local: se rechaza mientras la relación de otra tabla apunte a ella, y se
elimina de `index.ts` en el mismo commit. Solo se obtiene `backend/schema`,
por lo que un archivo de tabla que importe algo fuera de él no se puede editar de esta manera.

`auth` acepta un token o una instalación de GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Usa el token para un único proyecto que confirme cambios en un repositorio del que ya eres propietario:
configurar una App para que tu propio servidor pueda hacer commits en ella implica demasiados pasos para
una credencial de una sola línea. Usa la App para un plano de control que gestione una clave para
múltiples proyectos, que es lo que hace Rebase Cloud: una App, una instalación por
proyecto y ningún secreto por cliente que rotar.

El token necesita permisos de `contents: read and write` en ese repositorio, y nada más.

Sin `liveSchema.repository`, el commit es un `git commit` simple en el
árbol de trabajo que contiene `schemaDir`: nada que autenticar, sin token ni
red.

Dos aspectos que hacen seguro ejecutarlo contra un repositorio en el que otra persona esté
trabajando:

- Prepara para commit (**stage**) **únicamente** los archivos que generó. Un commit de esquema que incluyera
  trabajo a medio terminar sería un commit que nadie podría revisar, y se rechaza
  de inmediato si el árbol de trabajo ya tiene modificado alguno de sus propios archivos.
- La ruta remota nunca actualiza una referencia de forma forzada (force-update). Si se integró algún cambio mientras se
  creaba el commit, la actualización se rechaza: perder el commit de alguien de forma silenciosa
  es peor que fallar.

## Limitaciones

- Solo cambios aditivos. Todo lo demás se rechaza con un motivo, porque la
  ruta ensure es lo único que modifica un esquema y solo puede añadir.
- No se escribe ningún archivo de migración. Un proyecto aprovisionado mediante boot-ensure no necesita ninguno;
  un proyecto aprovisionado mediante migraciones debe ejecutar `rebase db generate`, que
  crea uno a través de Atlas con el hash de integridad que Atlas requiere.
- Solo Postgres. La funcionalidad se detecta en el controlador, y un controlador
  que carezca de ella responde `SCHEMA_EDITING_UNSUPPORTED`.
- Un despliegue cuyas tablas se derivan de la base de datos sirve un cambio aplicado
  tras el siguiente inicio (`serving.status: "after-restart"`, consulta
  [Servido sin reiniciar](#servido-sin-reiniciar)).

## Relacionado

- [Generación de esquemas](/docs/cli/schema/) — las mismas ediciones desde la línea de comandos
- [Tablas](/docs/schema/) — lo que el editor está reescribiendo
- [Studio](/docs/studio/) — el panel detrás del cual están estas rutas
