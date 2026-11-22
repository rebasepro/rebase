---
sourceHash: 45b2459dff0e5ec4
title: Edición de esquemas en vivo
description: "Cree y modifique tablas en un backend en ejecución: la edición se escribe en backend/schema, se confirma primero en su repositorio y luego se aplica."
---

El editor de esquemas de solo código fuente, `/api/admin/schema-editor/*`, reescribe los
archivos de tablas en `backend/schema` y no toca nada más. Eso funciona en su
máquina y en ningún otro lugar: los archivos de un servidor desplegado se reconstruyen a partir de su
repositorio en cada despliegue, por lo que una edición realizada allí se descartaría en el
siguiente.

La edición de esquemas en vivo es la solución a eso. **Confirma el cambio en su
repositorio y luego aplica el DDL**, por lo que la edición sobrevive al siguiente despliegue,
ya que este se construye a partir de ella. El editor de RLS de Studio guarda las
políticas de una tabla a través de estas rutas (se planifican, se muestran como SQL, se confirman y
luego se aplican), y un script o un agente que posea el scope puede enviar las mismas ediciones.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status y plan necesitan el scope `schema:read`, y apply necesita `schema:write`, como
cualquier otra superficie de `/api/admin` que requiera un scope. Un administrador tiene ambos.
Aplicar también necesita una cosa más aparte del scope; consulte [Quién puede aplicar](#quién-puede-aplicar).

## Las ediciones: `TablePatch`

Cada ruta que modifica el esquema toma el mismo cuerpo, `{ patches }`: una lista
de ediciones, cada una identificando su tabla por slug. El tipo es `TablePatch`, de
`@rebasepro/types`.

| `op` | Qué escribe en `backend/schema` |
|---|---|
| `createTable` | un nuevo `backend/schema/<name>.ts` que contiene la tabla, exportado desde `index.ts` |
| `deleteTable` | elimina el archivo y su exportación |
| `addColumn` `{ key, column, before? }` | una columna, antes de la indicada por `before`, o al final |
| `changeColumn` `{ key, column }` | reescribe la cadena del builder de una columna; si tiene un `.transform()` definido, se conserva |
| `renameColumn` `{ key, to, column }` | renombra la clave, conservando la columna SQL |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | elimina o reordena una columna |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | una entrada `rel.*`; el `target` de la relación es un slug |
| `setRls` `{ rls }` | la postura: `"admin-only"`, `"inherit"` o una lista de reglas |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | una regla de la lista |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` o `metadata`; `null` la elimina |

Una columna viaja como su definición —el tipo de Postgres como `{ kind: … }` y los
modificadores como flags— sin sus hooks `.transform()`, que son código y permanecen
donde fueron escritos:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Solo se reescribe el código al que hace referencia una edición. Todo lo demás se mantiene tal como está:
importaciones, comentarios, formato o una columna compartida desde otro módulo. El editor
rechaza, señalando la expresión, cualquier edición que acceda *al interior* de algo definido
en código: una tabla construida con un spread, una columna construida mediante un helper, reglas almacenadas en
una variable, una clave calculada o una columna cuya estructura JSON incluye transformaciones. Tampoco
renombra nunca un slug, una tabla, un esquema o el nombre de una definición (eso mueve
datos: escriba una migración), nunca elimina la última regla (utilice `setRls` con
`"admin-only"`), rechaza `rls` en una vista y rechaza eliminar una tabla a la que
apunten otras relaciones. Una edición cuyo resultado no compila se rechaza con
`SCHEMA_EDIT_DOES_NOT_COMPILE` y los problemas del compilador. No se escribe nada
ante ningún rechazo.

La apariencia de una tabla en el panel de administración (etiquetas, iconos, grupos, modos de vista,
colores de enum) no es una edición de esquema: reside en `frontend/src/cms` y en las
preferencias guardadas del panel, y nada de ello viaja en un `TablePatch`.

`$ADMIN_TOKEN` es un token de acceso —el `accessToken` que devuelve un inicio de sesión— para una
cuenta que posea `schema:read`: un administrador o un rol que lo declare. Nada en
la máquina lo configura por usted.

## Planifique antes de aplicar

`/plan` no tiene efectos secundarios. Envíe las ediciones mediante POST y le indicará lo que significan:

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

`files` representa cada archivo que la operación apply confirma: el código fuente de la tabla, cuando el backend
puede escribirlo, y luego el esquema generado. Los registros de cambios del planificador conservan
sus nombres de transferencia (`add-property`, `collection`, `property`).

Esto no es una simple conveniencia. Dos de los tres veredictos son rechazos, y uno de
ellos es un rechazo que de otro modo solo descubriría al presionar el botón en una
base de datos en producción.

## Los tres veredictos

| Veredicto | Significado |
|---|---|
| `safe` | La ruta ensure en tiempo de arranque puede expresarlo y el resultado coincide con su configuración. Aplicado. |
| `diverges` | Se aplica *en parte*, dejando una base de datos que no coincide con su configuración, y nada lo reporta. Rechazado. |
| `needs-migration` | La ruta ensure no puede expresarlo en absoluto. Rechazado. |

`diverges` es el que vale la pena entender, porque parece que estos cambios
funcionaron:

- **Una columna `.notNull()` añadida a una tabla que ya contiene filas** llega como
  **nullable**. `NOT NULL` se comprueba contra cada fila existente, y las filas
  creadas antes de que existiera la columna no tienen ningún valor para ella. En una tabla **vacía**
  no hay nada que comprobar, por lo que la restricción se aplica y esto es
  `safe`.
- **Hacer que una columna existente sea `.notNull()`** tiene el mismo comportamiento: `SET NOT NULL`
  escanea la tabla, por lo que es `safe` en una vacía y `diverges` en una con datos
  hasta que realice un backfill.

Dos cambios que solían ser `diverges` ahora son `safe`, porque la ruta ensure
los lleva a cabo:

- **Un valor añadido a un enum existente** se incorpora mediante
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Antes se omitía junto con todo el
  tipo, y la primera fila que utilizaba el nuevo valor era rechazada por un tipo que
  nunca había oído hablar de él.
- **Flexibilizar una columna `.notNull()`** elimina el `NOT NULL`. Antes se dejaba en
  su lugar, por lo que las escrituras que omitían la columna seguían fallando.

### Restricciones solicitadas que no se aplican

Un cambio puede ser aplicable y aun así dejar sin aplicar algo que su configuración solicita
(una columna `.notNull()` en una tabla poblada es el caso típico). Eso no es
un rechazo, por lo que no aparece en `changes`; aparece en
`withheldConstraints`, con el obstáculo y lo que lo solucionaría:

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

La ruta ensure en tiempo de arranque informa lo mismo como una advertencia. Hasta que
esto existió, una restricción retenida se retenía en silencio.

`needs-migration` cubre todo lo que la ruta ensure no puede hacer: eliminar una
tabla o una columna, cambiar el tipo de una columna (un selector de entero, un string que
pasa a ser un enum, el tipo de elemento de un array, el ancho de un varchar), renombrar una
columna, cambiar una clave primaria, eliminar un valor de enum, hacer única una columna
existente y cambiar una relación (su tipo, su destino, su `localKey`,
su `onDelete`). Un `hasMany` o `hasOne` cuya columna de enlace nada crea también se
rechaza. Cada rechazo indica el cambio y qué hacer en su lugar.

El veredicto se lee a partir del esquema que produce cada lado (el mismo plan a partir del cual
se generan `schema.generated.ts` y `db push`), por lo que una edición que cambia
la base de datos no puede reportarse como si no hubiera cambios. Dos ediciones que parecen cambios
y no se rechazan:

- **Renombrar la clave de una columna manteniendo su columna SQL** (`renameColumn`,
  que escribe el nombre antiguo como primer argumento del builder, `col.text("old_name")`) no mueve datos. Es `safe`; los clientes de la API leen el nuevo nombre.
- **Establecer, cambiar o eliminar un valor predeterminado** solo afecta a futuras escrituras. Es
  `safe` y se aplica con `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`.

### Editar solo el código fuente

Un cambio rechazado aún puede escribirse en `backend/schema` y confirmarse,
dejando la base de datos tal como está (eliminar una columna que ya no utiliza es el
caso habitual). Envíe un POST a `/apply` con `"sourceOnly": true`. No se ejecuta nada; el mensaje
del commit indica lo que conserva la base de datos, por ejemplo
`chore(schema): remove sku from products (source only — column products.sku kept)`,
y cada cambio en el plan incluye una frase `sourceOnly` que explica lo que
deja atrás, incluso cuando una columna que se deja atrás es `NOT NULL` sin
valor predeterminado, lo que hace que cualquier inserción posterior falle hasta que se elimine o se haga
nullable. Un cambio sin dicha frase (mover una clave primaria, una relación cuya columna de
enlace nada crea) no puede escribirse únicamente en el código fuente.

En un despliegue que no modifica nada en su base de datos (`REBASE_PROVISION=false`),
no se aplica ningún cambio desde el panel, por lo que cada cambio sigue este camino: el
botón principal del diálogo muestra **Commit** y envía `"sourceOnly": true`, y el
proceso encargado de modificar esa base de datos aplica el esquema.

Eliminar una tabla sigue la misma vía: `/apply` con una
edición `deleteTable` y `"sourceOnly": true` elimina el archivo de la tabla y su
exportación en `index.ts` y confirma ambos; la tabla y sus filas permanecen en la
base de datos. Se rechaza mientras una relación de otra tabla apunte a ella, señalando
dicha tabla; eliminarla impediría que el esquema compile.

## Qué se incluye en el commit

No solo el archivo de la tabla. El esquema de Drizzle se genera a partir de él, y uno
desactualizado rompería el siguiente despliegue, por lo que ambos van en el mismo commit:

- `backend/schema/<name>.ts`: la tabla en sí, y `backend/schema/index.ts` cuando se crea o elimina una tabla
- `backend/src/schema.generated.ts`: el esquema de Drizzle

Esas rutas son relativas a su **proyecto**, no a su repositorio. Cuando ambos
coinciden —un proyecto creado con `rebase init`, que es el caso habitual—, no hay
nada de qué preocuparse. Cuando su proyecto se encuentra en un subdirectorio de un repositorio más
grande, las rutas llevan ese prefijo, que se localiza subiendo desde el directorio del
esquema hasta el `rebase.json` más cercano. Un proyecto sin
`rebase.json` conserva las rutas simples.

No se incluye SQL en el commit. `rebase db push` y `rebase db generate` escriben el suyo
a partir de las tablas en cada ejecución, en `.rebase/sql/`, que está en el .gitignore.

El mensaje del commit describe el cambio en lugar de simplemente anunciarlo, y se
atribuye a la persona que lo realizó mediante el nombre visible y el correo electrónico de la cuenta
(un usuario sin ninguno de los dos se confirma como `<uid>@users.noreply.rebase.pro`).

Un cambio de esquema con autor y un diff en el historial de su proyecto es algo
que ni Firebase ni Supabase ofrecen: sus ediciones de tablas son invisibles para
su repositorio.

## Quién puede aplicar

Disponer de `schema:read` es suficiente para **planificar**. Planificar no tiene efectos secundarios, y un
trabajo de CI que consulte si un cambio de esquema propuesto es aplicable es un buen caso de uso para
ello.

Aplicar es un segundo privilegio, ya que aplicar escribe un commit y un commit
lleva un autor:

| Emisor | Plan | Apply |
|---|---|---|
| Una persona con sesión iniciada que posea `schema:write` | sí | sí |
| Una clave de API que posea `schema:read` / `schema:write` | sí | no |
| La service key del servidor | sí | no |

Una credencial no es un autor. `api-key:7c3f…` en su entorno de CI no es
una persona, y permitirle escribir en su repositorio genera exactamente el
historial sin atribución que esta función existe para reemplazar.

Si lo que desea es un cambio de esquema automatizado (por ejemplo, un pipeline de migración),
actívelo deliberadamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

o bien `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. El commit se atribuye entonces
a la credencial por su nombre —`Rebase API key (7c3f)`—, de modo que leer `git log` un
mes después todavía le indica qué cambios realizó una persona.

`GET /api/admin/schema/status` reporta lo que *usted* puede hacer, no solo lo que el
servidor admite, de modo que un panel puede deshabilitar el control y explicar el motivo en lugar de
rechazarlo después de que haya tomado una decisión:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Si su proyecto mantiene migraciones versionadas

Aplicar aquí **no** escribe una migración, ni puede hacerlo: una migración utiliza el
formato de Atlas con un archivo de integridad, generado por un binario externo sobre una
base de datos desechable, y un servidor en ejecución no dispone de ninguno de los dos.

Lo que sí confirma es el archivo de la tabla, y a partir de él es de donde `rebase db generate`
escribe la migración. Por lo tanto, la migración está a un solo comando de distancia:

```bash
rebase db generate
```

Tanto el plan como el resultado lo indican cuando su proyecto tiene migraciones, porque
de lo contrario el fallo es silencioso: su base de datos tiene el cambio y su repositorio
lo describe, pero el siguiente entorno construido al reproducir las migraciones no lo tiene,
y nada alertó al respecto.

Un proyecto aprovisionado mediante boot-ensure (el runtime administrado y cualquier autoalojamiento
que deje `REBASE_MIGRATE_ON_BOOT` en su valor predeterminado) no necesita ninguna migración. Sus
tablas son el esquema, y el siguiente arranque se encarga de reconciliar.

## Confirmar primero en el commit y luego aplicar

El orden importa y no es arbitrario.

Si el DDL se ejecutara primero y el commit fallara, su base de datos tendría una columna
que su repositorio no describe. La ruta ensure nunca elimina nada, por lo que el
siguiente despliegue no la quitaría ni la mencionaría: una columna invisible, ausente
de sus tablas, hasta que alguien fuera a buscarla.

Hacer el commit primero falla en el sentido contrario: el repositorio describe algo que la
base de datos aún no tiene. Ese es el estado habitual de cualquier proyecto entre
una edición y un despliegue, y el arranque lo reconcilia en el siguiente inicio.

Por lo tanto, una operación de apply fallida **no es un error**. La respuesta así lo indica:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Las reglas surten efecto en el mismo apply

Un cambio en el `rls` de una tabla (o una tabla nueva) se aplica en la misma operación: las
políticas de las tablas modificadas se escriben en la base de datos inmediatamente después del DDL,
y la respuesta indica lo ocurrido bajo `policies`:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Cuando las políticas no se pueden escribir —un backend que no puede aprovisionar
(`provision.tables` desactivado) o un driver sin esa capacidad—, el estado es
`"deferred"`; cuando la escritura falla, es `"failed"`, junto con el error. Ambos
incluyen el mensaje "Rules saved to source; they take effect on the next
deploy.", y el panel continúa mostrando las reglas que Postgres aplica hasta ese momento,
nunca reglas que no estén en vigor.

Los hooks editados en el código fuente también surten efecto con el apply: el servidor ejecuta las
tablas compiladas del esquema editado sin necesidad de reiniciar.

## Servido sin reiniciar

Un cambio aplicado desde Studio se sirve de inmediato. El driver de Postgres vuelve a leer
las tablas modificadas de la base de datos y las intercambia: la API de datos,
includes, hooks y realtime ven una nueva tabla, columna, relación o tabla de unión (junction)
sin necesidad de reiniciar, y una nueva tabla obtiene sus permisos (grants) y captura de cambios. La
respuesta lo indica bajo `serving`:

```json
{ "serving": { "status": "now" } }
```

En un despliegue cuyas tablas se derivan de la base de datos (sin
`backend/schema`), o con un driver que no puede actualizar sus tablas, la
base de datos y el código fuente tienen el cambio, pero el proceso sigue sirviendo las
tablas con las que se inició. En ese caso, el estado es `"after-restart"`, con un `message`
que el comprobante de Studio muestra como advertencia; reinicie el proceso para servir el
cambio.

## Cuando el archivo cambió durante la edición

Una edición se prepara a partir de los archivos tal como están. Si uno de ellos cambia en el
disco antes de que se aplique la edición (un guardado en el IDE, otro proceso), la operación apply
no escribe nada y responde con 409 `SCHEMA_EDIT_STALE_FILE`. Realice la edición nuevamente
sobre el archivo tal como está ahora.

## Dónde funciona esto

La edición de esquemas en vivo reescribe `backend/schema` con el mismo editor que utilizan los
guardados de solo código fuente del panel (requiere tener instalado `ts-morph`). El origen de ese
código fuente determina dónde se ejecuta:

- **En disco** (`schemaDir`, por defecto): se ejecuta donde se ejecuta el editor de solo
  código fuente. Dicho editor está desactivado bajo `NODE_ENV=production`, a menos que el servidor
  configure `schemaEditor: true`.
- **En un repositorio especificado** (`liveSchema.repository`, o
  `REBASE_LIVE_SCHEMA_REPOSITORY` para un bundle): el código fuente se lee desde
  GitHub y el cambio se confirma de vuelta allí, por lo que se ejecuta en cualquier lugar,
  incluida producción. Esta es la opción de activación para un bundle compilado.

| Despliegue | Funciona |
|---|---|
| `rebase dev` en su máquina | sí |
| Autoalojamiento con el proyecto y su working tree de git montados | sí, cuando `NODE_ENV` no es `production`, o con `schemaEditor: true` |
| Un bundle compilado: un autoalojamiento que sirve una compilación, o la imagen publicada | solo si se activa con `REBASE_LIVE_SCHEMA_REPOSITORY`; consulte [Desde un bundle compilado](#desde-un-bundle-compilado) |
| Cualquier servidor con `liveSchema.repository` configurado | sí, incluido `NODE_ENV=production` |

Un bundle es una salida compilada, por lo que no contiene el código fuente de `backend/schema` y
el runtime que lo sirve desactiva el editor de solo código fuente. A menos que especifique un
repositorio, `/api/admin/schema/status` responderá con `enabled: false` y el código
`SCHEMA_EDITOR_DISABLED`: edite `backend/schema` en desarrollo, haga commit y
despliegue.

### Desde un bundle compilado

Un bundle no tiene código propio para configurar, por lo que se activa mediante variables
de entorno. Nada cambia para un bundle que no las defina.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

La lista completa se encuentra en [Configuración](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Un repositorio especificado sin una credencial utilizable (ninguna, ambos tipos o media GitHub
App), o un valor que no sea `owner/name`, se negará a arrancar en lugar de servir
un editor que falle cuando alguien presione Apply. Lo mismo ocurre con la variable eliminada
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, mostrando un mensaje que hace referencia a
`REBASE_LIVE_SCHEMA_PATH`, y una ruta que se salga del repositorio.

Lo que se mantiene igual cuando está activado:

- Es una superficie de `/api/admin`: no responde en absoluto sin `schema:read`, y
  `/apply` requiere `schema:write` y una persona (consulte [Quién puede aplicar](#quién-puede-aplicar)).
- El destino de escritura es exclusivamente el repositorio que haya especificado. El editor de solo código fuente,
  que escribe archivos junto al proceso, permanece desactivado.
- Cada cambio se planifica, se muestra, se confirma en un commit y luego se aplica, exactamente igual que en su
  máquina.

El proceso que aplicó el cambio lo sirve de inmediato: sus rutas REST, los
descriptores de `GET /api/schema/tables` y el panel de administración incorporan
la edición sin reiniciar. Otras réplicas, y este proceso tras un reinicio, servirán las
tablas con las que se compiló el bundle hasta que su pipeline compile y despliegue el
commit.

Por lo tanto, un cambio espera a que el anterior sea servido. Un cambio planificado contra
tablas respecto a las cuales el repositorio ya va por delante generaría commits de archivos de esquema
que dejarían fuera el cambio previo. Por ello, cada apply renderiza
`schema.generated.ts` a partir de las tablas que este proceso sirve y lo compara con
la copia del repositorio. Cuando difieren, el apply se rechaza con
`SCHEMA_CHANGE_FAILED`, indicando el archivo, hasta que un proceso que ejecute ese commit
reemplace a este. La comprobación lee el repositorio, no la memoria de este proceso,
por lo que es válida tras un reinicio, entre réplicas y para cambios enviados por un desarrollador
que aún no se hayan desplegado. Mientras tanto, la planificación sigue disponible.

Las copias también difieren si el archivo fue generado por otra versión de Rebase,
reformateado o editado manualmente. Si no hay nada pendiente de despliegue, ejecute
`rebase schema generate` con la versión que ejecuta el despliegue, confirme el
resultado y despliéguelo. Los saltos de línea y los espacios en blanco al final de línea no cuentan como
diferencias.

### Confirmar en un repositorio remoto

`liveSchema.repository` hace que el servidor confirme cada cambio en un repositorio de GitHub
mediante la Git Data API en lugar de ejecutar `git commit` en un
working tree. No depende de que el editor de solo código fuente esté activado: con un
repositorio configurado, la edición en vivo funciona bajo `NODE_ENV=production` y con
`schemaEditor: false`, porque no se escribe nada en esta máquina. Un bundle
lo configura a través de las variables anteriores.

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

El directorio del esquema se lee entonces del repositorio, se reescribe con el
mismo editor que se ejecuta localmente y lo que cambió se confirma de vuelta mediante la
Git Data API: un blob por archivo, un tree, un commit y una actualización de ref. No se
clona nada ni se deja nada en el disco. Se lee el directorio completo, no solo el
archivo editado, por lo que una relación puede apuntar a otra tabla y la eliminación de una tabla funciona
como localmente: se rechaza mientras la relación de otra tabla apunte a ella y se
elimina de `index.ts` en el mismo commit. Solo se obtiene `backend/schema`,
por lo que un archivo de tabla que importe algo fuera de él no puede editarse de esta manera.

`auth` admite un token o una instalación de GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Utilice el token para un único proyecto que realice commits en un repositorio de su propiedad;
configurar una App para que su propio servidor pueda hacer commits en ella supone demasiado trámite para
una credencial de una sola línea. Utilice la App para un plano de control que gestione una sola clave en
múltiples proyectos, que es lo que hace Rebase Cloud: una sola App, una instalación por
proyecto y ningún secreto por cliente que rotar.

El token necesita `contents: read and write` en ese repositorio, y nada más.

Sin `liveSchema.repository`, el commit es un simple `git commit` en el
working tree que contiene `schemaDir`: nada que autenticar, sin token ni
red.

Dos aspectos que hacen que sea seguro ejecutarlo contra un repositorio en el que otra
persona esté trabajando:

- Prepara en el stage **únicamente** los archivos que generó. Un commit de esquema que arrastrara
  trabajo a medio terminar sería un commit imposible de revisar, y se rechaza
  rotundamente si el árbol ya tiene modificado alguno de sus propios archivos.
- La vía remota nunca fuerza la actualización de una referencia (`force-update`). Si se integró
  algún cambio mientras se construía el commit, la actualización se rechaza:
  perder el commit de alguien en silencio es peor que fallar.

## Limitaciones

- Solo cambios aditivos. Todo lo demás se rechaza con un motivo, ya que la
  ruta ensure es lo único que modifica un esquema y solo puede añadir.
- No se escribe ningún archivo de migración. Un proyecto aprovisionado mediante boot-ensure no necesita ninguno;
  un proyecto aprovisionado mediante migraciones debe ejecutar `rebase db generate`, que
  crea uno mediante Atlas con el hash de integridad requerido por este.
- Solo Postgres. La funcionalidad se detecta en el driver, y un driver
  sin ella responde `SCHEMA_EDITING_UNSUPPORTED`.
- Un despliegue cuyas tablas se derivan de la base de datos sirve un cambio aplicado
  tras el siguiente reinicio (`serving.status: "after-restart"`, consulte
  [Servido sin reiniciar](#servido-sin-reiniciar)).

## Relacionado

- [Generación de esquemas](/docs/cli/schema/) — las mismas ediciones desde la línea de comandos
- [Tablas](/docs/schema/) — lo que el editor está reescribiendo
- [Studio](/docs/studio/) — el panel detrás del cual están estas rutas
