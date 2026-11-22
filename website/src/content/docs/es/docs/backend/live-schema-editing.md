---
sourceHash: 972a11a8dc0defac
title: Edición de esquemas en vivo
description: Crea y modifica tablas en un backend en ejecución; la edición se escribe en backend/schema, se confirma primero en tu repositorio y luego se aplica.
---

El editor de esquemas del panel de administración reescribe los archivos de tabla en
`backend/schema`. Eso funciona en tu máquina y en ningún otro lugar: los archivos de un
servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo que una edición realizada
allí se descartaría en el siguiente.

La edición de esquemas en vivo es la respuesta a eso. **Confirma el cambio en tu
repositorio y luego aplica el DDL**, por lo que la edición sobrevive al siguiente despliegue,
ya que este se construye a partir de ella.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status y plan necesitan el scope `schema:read`, y apply necesita `schema:write`, al
igual que cualquier otra superficie de `/api/admin` que designe un scope. Un administrador posee ambos.
La aplicación también necesita una cosa más aparte del scope; consulta [Quién puede aplicar](#quién-puede-aplicar).

## Las ediciones: `TablePatch`

Cada ruta que modifica el esquema acepta el mismo cuerpo, `{ patches }`: una lista
de ediciones, cada una identificando su tabla por slug. El tipo es `TablePatch`, de
`@rebasepro/types`.

| `op` | Lo que escribe en `backend/schema` |
|---|---|
| `createTable` | un nuevo `backend/schema/<name>.ts` que contiene la tabla, exportado desde `index.ts` |
| `deleteTable` | elimina el archivo y su exportación |
| `addColumn` `{ key, column, before? }` | una columna, antes de la indicada por `before`, o al final |
| `changeColumn` `{ key, column }` | reescribe la cadena de construcción de una columna; se mantiene cualquier `.transform()` escrito en ella |
| `renameColumn` `{ key, to, column }` | renombra la clave, conservando la columna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | elimina o reordena una columna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | una entrada `rel.*`; el `target` de la relación es un slug |
| `setRls` `{ rls }` | la postura: `"admin-only"`, `"inherit"` o una lista de reglas |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | una regla de la lista |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` o `metadata`; `null` la elimina |

Una columna viaja como su definición —el tipo de Postgres como `{ kind: … }` y los
modificadores como flags— sin sus hooks `.transform()`, que son código y permanecen
donde están escritos:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Solo se reescribe el código especificado por una edición. Todo lo demás se mantiene como está:
importaciones, comentarios, formato, una columna compartida desde otro módulo. El editor
rechaza, indicando la expresión, cualquier edición que intente acceder *al interior* de algo definido
en código: una tabla construida con un spread, una columna construida mediante un helper, reglas almacenadas en
una variable, una clave computada, una columna cuya estructura JSON incluye transforms. Tampoco
renombra nunca un slug, una tabla, un esquema o el nombre de una definición (eso mueve
datos: escribe una migración), nunca elimina la última regla (por ejemplo, `setRls` con
`"admin-only"`), rechaza `rls` en una vista y rechaza eliminar una tabla a la que
apuntan otras relaciones. Una edición cuyo resultado no compile se rechaza con
`SCHEMA_EDIT_DOES_NOT_COMPILE` y los problemas del compilador. No se escribe nada
ante ningún rechazo.

El aspecto visual de una tabla en el panel de administración (etiquetas, iconos, grupos, modos de vista,
colores de enums) no es una edición de esquema: reside en `frontend/src/cms` y en las
preferencias guardadas del panel, y nada de eso viaja en un `TablePatch`.

`$ADMIN_TOKEN` es un token de acceso —el `accessToken` que devuelve un inicio de sesión— para una
cuenta que posee `schema:read`: un administrador o un rol que lo declare. Nada en
la máquina lo configura por ti.

## Planifica antes de aplicar

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

`files` contiene todos los archivos que la operación de aplicar confirma: el código fuente de la tabla,
cuando el backend puede escribirlo, y luego el esquema generado. Los registros de cambios del planificador conservan
sus nombres de transmisión (`add-property`, `collection`, `property`).

Esto no es una simple comodidad. Dos de los tres veredictos son rechazos, y uno de
ellos es un rechazo que, de otro modo, solo descubrirías al pulsar el botón en una
base de datos en producción.

## Los tres veredictos

| Veredicto | Significado |
|---|---|
| `safe` | La ruta de verificación al inicio (ensure path) puede expresarlo y el resultado coincide con tu configuración. Se aplica. |
| `diverges` | Se aplica *en parte*, dejando una base de datos que no coincide con tu configuración, y nada lo reporta. Rechazado. |
| `needs-migration` | La ruta de verificación no puede expresarlo en absoluto. Rechazado. |

`diverges` es el que vale la pena entender, porque parece que estos cambios
funcionaron:

- **Una columna `.notNull()` añadida a una tabla que ya contiene filas** llega como
  **nullable**. `NOT NULL` se comprueba contra cada fila existente, y las filas
  escritas antes de que existiera la columna no tienen ningún valor para ella. En una tabla **vacía**
  no hay nada que comprobar, por lo que la restricción se aplica y esto es
  `safe`.
- **Hacer que una columna existente sea `.notNull()`** tiene el mismo comportamiento: `SET NOT NULL`
  escanea la tabla, por lo que es `safe` en una vacía y `diverges` en una con datos
  hasta que realices un backfill.

Dos cambios que antes eran `diverges` ahora son `safe`, porque la ruta de verificación
los lleva a cabo:

- **Un valor añadido a un enum existente** se aplica mediante
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Antes se omitía junto con todo
  el tipo, y la primera fila que usaba el nuevo valor era rechazada por un tipo que
  nunca había oído hablar de él.
- **Relajar una columna `.notNull()`** elimina el `NOT NULL`. Antes se dejaba en
  su lugar, por lo que las escrituras que omitían la columna seguían fallando.

### Restricciones solicitadas que no se aplican

Un cambio puede ser aplicable y aun así dejar sin aplicar algo que tu configuración
solicita; una columna `.notNull()` en una tabla con filas es el caso típico. Eso no es
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

La ruta de verificación al inicio reporta lo mismo como una advertencia. Hasta que esto
existió, una restricción retenida se retenía en silencio.

`needs-migration` abarca todo lo que la ruta de verificación no puede hacer: eliminar una
tabla o una columna, cambiar el tipo de una columna (un interruptor a entero, una cadena
convertida en enum, el tipo de elemento de un array, el ancho de un varchar), renombrar una
columna, cambiar una clave primaria, eliminar un valor de enum, hacer única una columna
existente y cambiar una relación (su tipo, su destino, su `localKey`,
su `onDelete`). También se rechaza un `hasMany` o `hasOne` cuya columna de enlace no sea creada por nada.
Cada rechazo indica el cambio y qué hacer en su lugar.

El veredicto se obtiene a partir del esquema que produce cada parte (el mismo plan
a partir del cual se generan `schema.generated.ts` y `db push`), por lo que una edición que altera
la base de datos no puede reportarse como sin cambios. Dos ediciones que parecen cambios
y no se rechazan:

- **Renombrar la clave de una columna conservando su columna SQL** (`renameColumn`,
  que escribe el nombre anterior como el primer argumento del constructor, `col.text("old_name")`) no mueve datos. Es `safe`; los clientes de la API leen el nuevo nombre.
- **Definir, cambiar o eliminar un valor predeterminado** solo vincula a las escrituras futuras. Es
  `safe` y se aplica con `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Editar solo el código fuente

Un cambio rechazado aún puede escribirse en `backend/schema` y confirmarse,
dejando la base de datos como está; eliminar una columna que ya no utilizas es el
caso habitual. Envía un POST a `/apply` con `"sourceOnly": true`. No se ejecuta nada; el mensaje
del commit indica lo que conserva la base de datos, por ejemplo
`chore(schema): remove sku from products (source only — column products.sku kept)`,
y cada cambio en el plan incluye una frase `sourceOnly` indicando lo que
deja atrás, incluso si una columna que queda atrás es `NOT NULL` sin
valor predeterminado, lo que hace que cada inserción posterior falle hasta que se elimine o se haga
nullable. Un cambio que no tenga esto (mover una clave primaria, una relación cuya columna de enlace
no es creada por nada) no puede escribirse solo en el código fuente.

En un despliegue que no altera nada en su base de datos (`REBASE_PROVISION=false`),
no se aplica ningún cambio desde el panel, por lo que todos los cambios siguen este camino: el
botón principal del diálogo muestra **Commit** y envía `"sourceOnly": true`, y el
proceso que modifica esa base de datos aplica el esquema.

Eliminar una tabla desde el panel de administración sigue el mismo camino: `/apply` con una
edición `deleteTable` y `"sourceOnly": true` elimina el archivo de la tabla y su
exportación en `index.ts` y confirma ambos; la tabla y sus filas permanecen en la
base de datos. Se rechaza mientras la relación de otra tabla apunte a ella, indicando
esa tabla, ya que eliminarla impediría que el esquema compile.

## Qué se confirma en el commit

No solo el archivo de la tabla. El esquema de Drizzle se genera a partir de él, y
uno desactualizado rompería el siguiente despliegue, por lo que ambos van en el mismo commit:

- `backend/schema/<name>.ts` — la tabla en sí, y `backend/schema/index.ts` cuando se crea o elimina una tabla
- `backend/src/schema.generated.ts` — el esquema de Drizzle

Esas rutas son relativas a tu **proyecto**, no a tu repositorio. Cuando
ambos coinciden —un proyecto creado con `rebase init`, que es el caso habitual— no hay
nada de qué preocuparse. Cuando tu proyecto se encuentra en un subdirectorio de un repositorio
más grande, las rutas se prefijan con él, ubicándolo subiendo desde tu
directorio de esquemas hasta el `rebase.json` más cercano. Un proyecto sin
`rebase.json` conserva las rutas simples.

No se incluye SQL en el commit. `rebase db push` y `rebase db generate` escriben el suyo
a partir de las tablas en cada ejecución, en `.rebase/sql/`, que está en el gitignore.

El mensaje del commit describe el cambio en lugar de simplemente anunciarlo, y se
atribuye a la persona que lo realizó mediante el nombre visible y el correo electrónico de la cuenta
(un usuario sin ninguno de los dos se confirma como `<uid>@users.noreply.rebase.pro`).

Un cambio de esquema con un autor y un diff en el historial de tu proyecto es algo
que ni Firebase ni Supabase ofrecen: sus ediciones de tablas son invisibles para
tu repositorio.

## Quién puede aplicar

Tener `schema:read` es suficiente para **planificar**. La planificación no tiene efectos secundarios, y un
trabajo de CI que consulte si un cambio de esquema propuesto es aplicable es un buen uso de
ello.

Aplicar es un segundo privilegio, porque aplicar escribe un commit y un commit
lleva un autor:

| Emisor | Plan | Apply |
|---|---|---|
| Una persona autenticada con `schema:write` | sí | sí |
| Una API key con `schema:read` / `schema:write` | sí | no |
| La clave de servicio del servidor | sí | no |

Una credencial no es un autor. `api-key:7c3f…` en tu entorno de CI no es
una persona, y permitirle escribir en tu repositorio produce exactamente el
historial no atribuible que esta funcionalidad busca reemplazar.

Si lo que deseas es un cambio de esquema automatizado (por ejemplo, un pipeline de migraciones),
actívalo deliberadamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

o `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. El commit se atribuye entonces
a la credencial por su nombre —`Rebase API key (7c3f)`—, de modo que leer `git log` un
mes después todavía te permita saber qué cambios fueron realizados por una persona.

`GET /api/admin/schema/status` informa lo que *tú* puedes hacer, no solo lo que el
servidor admite, de modo que un panel puede deshabilitar el control y explicar el motivo en lugar de
rechazarte después de que hayas decidido:

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

Aplicar aquí **no** escribe una migración, y no puede hacerlo: una migración utiliza el formato
de Atlas con un archivo de integridad, generado por un binario externo contra una base de
datos desechable, y un servidor en ejecución no dispone de ninguno de los dos.

Lo que sí confirma es el archivo de la tabla, y a partir de él es de donde `rebase db generate`
escribe la migración. Así que la migración está a un solo comando de distancia:

```bash
rebase db generate
```

Tanto el plan como el resultado lo advierten cuando tu proyecto tiene migraciones, porque
de lo contrario el fallo es silencioso: tu base de datos tiene el cambio y tu repositorio
lo describe, pero el siguiente entorno construido al reproducir las migraciones no lo tiene,
sin que nada haya avisado.

Un proyecto aprovisionado mediante boot-ensure (el runtime administrado y cualquier self-host
que deje `REBASE_MIGRATE_ON_BOOT` en su valor predeterminado) no necesita ninguna migración. Sus
tablas son el esquema, y el siguiente inicio lo reconcilia.

## Confirmar primero, luego aplicar

El orden importa y no es arbitrario.

Si el DDL se ejecutara primero y el commit fallara, tu base de datos tendría una columna
que tu repositorio no describe. La ruta de verificación nunca elimina nada, por lo que el
siguiente despliegue ni la eliminaría ni la mencionaría: una columna invisible, ausente
de tus tablas, hasta que alguien se pusiera a buscarla.

Confirmar primero falla en el sentido opuesto: el repositorio describe algo que la
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

Un cambio en el `rls` de una tabla (o una tabla nueva) se aplica en la misma operación: las
políticas de las tablas modificadas se escriben en la base de datos justo después del DDL,
y la respuesta indica lo que ocurrió bajo `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Donde no se puedan escribir políticas —un backend que no pueda aprovisionar
(`provision.tables` desactivado) o un driver sin esa capacidad—, el estado es
`"deferred"`; cuando la escritura falla, es `"failed"`, con el error correspondiente. Ambos
incluyen el mensaje "Rules saved to source; they take effect on the next
deploy.", y el panel continúa mostrando las reglas que Postgres aplica hasta entonces,
nunca reglas que no estén en vigor.

Los hooks editados en el código fuente también surten efecto con la aplicación: el servidor ejecuta las
tablas compiladas del esquema editado sin necesidad de reiniciar.

## Disponible sin reiniciar

Un cambio aplicado desde Studio se sirve de inmediato. El driver de Postgres vuelve a leer
las tablas modificadas de la base de datos y las reemplaza: la API de datos,
los includes, los hooks y realtime detectan una nueva tabla, columna, relación o tabla de unión (junction)
sin necesidad de reiniciar, y una nueva tabla recibe sus permisos y captura de cambios. La
respuesta lo indica bajo `serving`:

```json
{ "serving": { "status": "now" } }
```

En un despliegue cuyas tablas se derivan de la base de datos (sin
`backend/schema`), o con un driver que no puede actualizar sus tablas, la
base de datos y el código fuente tienen el cambio, pero el proceso sigue sirviendo las
tablas con las que se inició. El estado es entonces `"after-restart"`, con un `message`
que el recibo de Studio muestra como una advertencia; reinicia el proceso para servir el
cambio.

## Cuando el archivo cambió durante la edición

Una edición se prepara a partir de los archivos tal como están. Si uno de ellos cambia en el disco
antes de que se aplique la edición (un guardado en el IDE, otro proceso), la aplicación
no escribe nada y responde 409 `SCHEMA_EDIT_STALE_FILE`. Realiza la edición nuevamente
a partir del archivo en su estado actual.

## Dónde funciona esto

La edición de esquemas en vivo reescribe `backend/schema` con el mismo editor que utilizan los
guardados de solo código fuente del panel (necesita tener instalado `ts-morph`). El origen de ese
código fuente determina dónde se ejecuta:

- **En disco** (`schemaDir`, por defecto): se ejecuta donde se ejecuta el editor de
  solo código fuente. Ese editor está desactivado bajo `NODE_ENV=production` a menos que el servidor
  configure `schemaEditor: true`.
- **En un repositorio que especifiques** (`liveSchema.repository`, o
  `REBASE_LIVE_SCHEMA_REPOSITORY` para un bundle): el código fuente se lee desde
  GitHub y el cambio se confirma allí, por lo que funciona en cualquier lugar,
  incluida producción. Esta es la opción de activación para un bundle compilado.

| Despliegue | Funciona |
|---|---|
| `rebase dev` en tu máquina | sí |
| Self-host con el proyecto y su árbol de trabajo de git montados | sí, cuando `NODE_ENV` no es `production`, o con `schemaEditor: true` |
| Un bundle compilado: un self-host que sirve una compilación, o la imagen publicada | solo si se habilita con `REBASE_LIVE_SCHEMA_REPOSITORY` — consulta [Desde un bundle compilado](#desde-un-bundle-compilado) |
| Cualquier servidor con `liveSchema.repository` configurado | sí, incluido `NODE_ENV=production` |

Un bundle es una salida compilada, por lo que no contiene el código fuente de `backend/schema`, y
el runtime que lo sirve desactiva el editor de solo código fuente. A menos que indique un
repositorio, `/api/admin/schema/status` responde `enabled: false` con el código
`SCHEMA_EDITOR_DISABLED`: edita `backend/schema` en desarrollo, haz commit y
despliega.

### Desde un bundle compilado

Un bundle no tiene código propio para configurar, por lo que se habilita mediante variables
de entorno. Nada cambia para un bundle que no las defina.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

La lista completa se encuentra en [Configuración](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un repositorio indicado sin una credencial utilizable (ninguna, ambos tipos, media GitHub
App) o con un valor que no sea `owner/name`, se niega a iniciar, en lugar de servir
un editor que falle cuando alguien presione Apply. Lo mismo ocurre con la variable obsoleta
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, con un mensaje que indica
`REBASE_LIVE_SCHEMA_PATH`, y con una ruta que apunte fuera del repositorio.

Lo que permanece igual cuando está activado:

- Es una superficie de `/api/admin`: no responde en absoluto sin `schema:read`, y
  `/apply` requiere `schema:write` y una persona (consulta [Quién puede aplicar](#quién-puede-aplicar)).
- El destino de escritura es únicamente el repositorio que hayas indicado. El editor de solo código fuente,
  que escribe archivos junto al proceso, permanece desactivado.
- Cada cambio se planifica, se muestra, se confirma en el commit y luego se aplica, exactamente igual que en tu
  máquina.

El proceso que aplicó el cambio lo sirve de inmediato: sus rutas REST, los
descriptores de `GET /api/schema/tables` y el panel de administración reflejan
la edición sin reiniciar. Otras réplicas, y este proceso tras un reinicio, servirán las
tablas con las que se compiló el bundle hasta que tu pipeline compile y despliegue el
commit.

Por lo tanto, un cambio espera a que se sirva el anterior. Un cambio planificado sobre
tablas respecto a las cuales el repositorio ya va por delante confirmaría archivos de esquema generados
que omitirían el cambio anterior. Por consiguiente, cada aplicación genera
`schema.generated.ts` a partir de las tablas que sirve este proceso y lo compara con
la copia del repositorio. Cuando difieren, la aplicación se rechaza con
`SCHEMA_CHANGE_FAILED`, indicando el archivo, hasta que un proceso que ejecute ese commit
reemplace a este. La verificación consulta el repositorio, no la memoria de este proceso,
por lo que se mantiene tras un reinicio, entre réplicas y ante un cambio que un desarrollador
haya enviado por push y que aún no esté desplegado. La planificación sigue estando disponible mientras tanto.

Las copias también difieren cuando el archivo fue generado por otra versión de Rebase,
reformateado o editado a mano. Si no hay nada pendiente de despliegue, ejecuta
`rebase schema generate` con la versión que ejecuta el despliegue, haz commit del
resultado y despliégalo. Los saltos de línea y los espacios en blanco al final no cuentan como una
diferencia.

### Confirmar cambios en un repositorio remoto

`liveSchema.repository` hace que el servidor confirme cada cambio en un repositorio de GitHub
a través de la Git Data API en lugar de ejecutar `git commit` en un
árbol de trabajo. No depende de que el editor de solo código fuente esté activado: con un
repositorio configurado, la edición en vivo funciona bajo `NODE_ENV=production` y con
`schemaEditor: false`, porque no se escribe nada en esta máquina. Un bundle
lo configura mediante las variables anteriores.

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
mismo editor que se ejecuta localmente y lo que cambió se confirma de vuelta a través de la
Git Data API: un blob por archivo, un tree, un commit y una actualización de ref. Nada se
clona ni se deja nada en disco. Se lee todo el directorio, no solo el
archivo editado, por lo que una relación puede apuntar a otra tabla y la eliminación de una tabla funciona
como lo hace localmente: se rechaza mientras la relación de otra tabla apunte a ella y se
elimina de `index.ts` en el mismo commit. Solo se obtiene `backend/schema`,
por lo que un archivo de tabla que importe algo externo a él no se puede editar de esta manera.

`auth` acepta un token o una instalación de GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Usa el token para un único proyecto que confirme cambios en un repositorio que ya posees:
configurar una App para que tu propio servidor pueda hacer commits en ella es demasiado protocolo para
una credencial de una sola línea. Usa la App para un plano de control que mantenga una sola clave a través de
muchos proyectos, que es lo que hace Rebase Cloud: una App, una instalación por
proyecto y ningún secreto por cliente que rotar.

El token necesita `contents: read and write` en ese repositorio, y nada más.

Sin `liveSchema.repository`, el commit es un simple `git commit` en el
árbol de trabajo que contiene `schemaDir`: nada que autenticar, sin token, sin
red.

Dos cosas que hacen que sea seguro ejecutarlo contra un repositorio en el que otra
persona esté trabajando:

- Prepara para commit (**stages**) **únicamente** los archivos que generó. Un commit de esquema que arrastrara
  trabajo a medio terminar sería un commit que nadie podría revisar, y se rechaza
  rotundamente si el árbol ya tiene modificado alguno de sus propios archivos.
- La ruta remota nunca actualiza una ref de forma forzada. Si entró algún cambio mientras
  se estaba construyendo el commit, la actualización se rechaza: perder el commit de alguien
  en silencio es peor que fallar.

## Limitaciones

- Solo cambios aditivos. Todo lo demás se rechaza con un motivo, porque la
  ruta de verificación es lo único que modifica un esquema y solo puede añadir.
- No se escribe ningún archivo de migración. Un proyecto aprovisionado mediante boot-ensure no necesita ninguno;
  un proyecto aprovisionado mediante migraciones debe ejecutar `rebase db generate`, el cual
  crea uno mediante Atlas con el hash de integridad que Atlas requiere.
- Solo Postgres. La capacidad se detecta en el driver, y un driver
  que no la tenga responde `SCHEMA_EDITING_UNSUPPORTED`.
- Un despliegue cuyas tablas se derivan de la base de datos sirve un cambio aplicado
  después del siguiente inicio (`serving.status: "after-restart"`, consulta
  [Disponible sin reiniciar](#disponible-sin-reiniciar)).

## Relacionado

- [Generación de esquemas](/docs/cli/schema/) — las mismas ediciones desde la línea de comandos
- [Tablas](/docs/schema/) — lo que el editor está reescribiendo
- [Studio](/docs/studio/) — el panel detrás del cual están estas rutas
