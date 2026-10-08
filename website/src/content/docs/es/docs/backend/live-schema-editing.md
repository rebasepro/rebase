---
sourceHash: 564c58f7bc002c6f
title: Edición de esquemas en vivo
description: "Crea y modifica colecciones en un backend en ejecución: primero se confirman en tu repositorio y luego se aplican."
---

El editor de esquemas del panel de administración reescribe el código fuente de tus colecciones. Eso funciona en tu máquina y en ningún otro lugar: los archivos de un servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo que una edición realizada allí se descartaría en el siguiente.

La edición de esquemas en vivo es la solución a eso. **Confirma el cambio en tu repositorio y luego aplica el DDL**, de modo que la edición sobrevive al siguiente despliegue, ya que el despliegue se compila a partir de ella.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

El estado y el plan necesitan el alcance `schema:read`, y aplicar necesita `schema:write`, al igual que cualquier otra superficie de `/api/admin` que nombra un alcance. Un administrador tiene ambos. Aplicar también requiere algo más que el alcance; consulta [Quién puede aplicar cambios](#quién-puede-aplicar-cambios).

## Planifica antes de aplicar

`/plan` no tiene efectos secundarios. Envía el cambio, y te indica qué implica
el cambio. Un cambio a una colección existente es
un `patch` — lo que cambió, como operaciones sobre rutas de claves — y una
colección nueva es el `collection` completo:

```json
{ "collectionId": "posts", "patch": [
    { "op": "set", "path": ["properties", "subtitle"], "value": { "name": "Subtitle", "type": "string" } },
    { "op": "remove", "path": ["admin", "group"] }
] }
```

Solo las claves que nombra un patch se escriben en el archivo de la colección.
Todo lo demás queda como está — imports, comentarios, formato, el `onClick` de
una acción de entidad, una propiedad compartida desde otro módulo, un enum
importado de otro lugar. Un patch que llega *hasta dentro* de algo definido en
código (`status: statusProperty`, `enum: LOCALE_ENUM`, un `...spread`) se
rechaza con la expresión en la que chocó, de modo que el cambio se hace donde
vive ese código. Un `collection` completo enviado para una colección que ya
existe se convierte en el patch de lo que difiere de ella, y una clave cuyo
valor es código nunca se elimina de ese modo. El panel de administración envía
patches. En 0.23, `/plan` y `/apply` solo aceptan el `collection` completo tal
como debería quedar.

`$ADMIN_TOKEN` es un token de acceso (el `accessToken` que devuelve un inicio de sesión) para una cuenta que tiene `schema:read`: un administrador, o un rol que lo declare. Nada en la máquina lo configura por ti.

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"collectionId":"posts","collection":{}}'
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
  "files": ["backend/src/schema.generated.ts"]
}
```

Esto no es una simple comodidad. Dos de los tres veredictos son rechazos, y uno de ellos es un rechazo que, de otro modo, solo descubrirías al presionar el botón en una base de datos en vivo.

## Los tres veredictos

| Veredicto | Significado |
|---|---|
| `safe` | La ruta ensure en el arranque lo expresa y el resultado coincide con tu configuración. Aplicado. |
| `diverges` | Se aplica *en parte*, dejando una base de datos que no coincide con tu configuración, y nada lo reporta. Rechazado. |
| `needs-migration` | La ruta ensure no puede expresarlo en absoluto. Rechazado. |

`diverges` es el que vale la pena comprender, porque parece que estos cambios funcionaron:

- **Una propiedad obligatoria agregada a una tabla que ya contiene filas** llega como **anulable** (nullable). `NOT NULL` se comprueba contra cada fila existente, y las filas escritas antes de que existiera la propiedad no tienen ningún valor para ella. En una tabla **vacía** no hay nada que comprobar, por lo que la restricción se aplica y esto es `safe`.
- **Hacer que una propiedad existente sea obligatoria** tiene la misma dinámica: `SET NOT NULL` escanea la tabla, por lo que es `safe` en una vacía y `diverges` en una con datos hasta que hagas un backfill.

Dos cambios que solían ser `diverges` ahora son `safe`, porque la ruta ensure los lleva a cabo:

- **Un valor agregado a un enum existente** se aplica mediante `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Antes se omitía junto con todo el tipo, y la primera fila que usaba el nuevo valor era rechazada por un tipo que nunca había oído hablar de él.
- **Hacer opcional una propiedad obligatoria** elimina el `NOT NULL`. Antes se dejaba en su lugar, por lo que las escrituras que omitían la propiedad seguían fallando.

### Restricciones solicitadas y no aplicadas

Un cambio puede ser aplicable y aun así dejar sin aplicar algo que tu configuración solicita; una propiedad obligatoria en una tabla con datos es el caso típico. Esto no es un rechazo, por lo que no aparece en `changes`; aparece en `withheldConstraints`, con el obstáculo y lo que lo resolvería:

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

La ruta ensure en el arranque reporta lo mismo como una advertencia. Antes de que esto existiera, una restricción retenida se retenía en silencio.

`needs-migration` cubre todo lo que la ruta ensure no puede hacer: eliminar una
colección o una propiedad, cambiar el tipo de una columna (alternar un entero,
que una cadena se convierta en un enum, el tipo de elemento de un array, el
ancho de un varchar), renombrar una columna, cambiar una clave primaria,
eliminar un valor de un enum, hacer única una columna existente, y cambiar una
relación — su `kind`, su destino, su `localKey`, su `onDelete`. Un `hasMany` o
`hasOne` cuya columna de enlace nada crea también se rechaza. Cada rechazo
especifica el cambio y qué hacer en su lugar.

El veredicto se lee a partir del esquema que produce cada lado — el mismo del
que se generan `schema.generated.ts` y `db push` — de modo que una edición que
cambia la base de datos no puede reportarse como que no hay cambio. Dos
ediciones que parecen cambios y no se rechazan (; 0.23 reporta
ambas como que necesitan una migración):

- **Renombrar la clave de una propiedad conservando su columna** (`columnName`
  fijado a la columna antigua) no mueve ningún dato. Es `safe`; los clientes
  de la API leen el nombre nuevo.
- **Definir, cambiar o eliminar un valor por defecto** solo condiciona las
  escrituras futuras. Es `safe`, y se aplica con `ALTER COLUMN … SET DEFAULT`
  / `DROP DEFAULT`.

### Editar solo el código fuente

Un cambio rechazado aún puede escribirse en el código fuente de tu colección y
confirmarse, dejando la base de datos como está — eliminar una propiedad que
ya no sirves es el caso habitual. Envía `/apply` con
`"sourceOnly": true`. No se ejecuta nada; el mensaje del commit especifica lo
que conserva la base de datos, por ejemplo
`chore(schema): remove sku from products (source only — column products.sku kept)`,
y cada cambio del plan lleva una frase `sourceOnly` que indica qué deja atrás
— incluso cuando la columna que deja atrás es `NOT NULL` sin valor por
defecto, lo que hace fallar toda inserción posterior hasta que se elimine o se
haga anulable. Un cambio sin esa frase (mover una clave primaria, una relación
cuya columna de enlace nada crea) no puede escribirse solo en el código
fuente.

Eliminar una colección desde el panel de administración sigue la misma vía:
`/apply` con `"remove": true` y `"sourceOnly": true` elimina el archivo de la
colección y su entrada en `index.ts`, y confirma ambos; la tabla y sus filas
permanecen. Se rechaza mientras otra colección importe el archivo (una
relación hacia ella), especificando el importador — eliminarlo detendría la
carga de todas las colecciones.

En 0.23, `/apply` no acepta ni `sourceOnly` ni `remove`, y «Editar solo el
código fuente» del panel escribe el archivo sin hacer un commit.

## Qué se confirma

No solo el archivo de la colección. El esquema de Drizzle se genera a partir de ella, y uno desactualizado romperá el siguiente despliegue, así que ambos van en el mismo commit:

- `config/collections/<name>.ts` — la colección en sí
- `backend/src/schema.generated.ts` — el esquema de Drizzle

Estas rutas son relativas a tu **proyecto**, no a tu repositorio. Cuando ambos son lo mismo —un proyecto `rebase init`, que es el caso habitual—, no hay nada de qué preocuparse. Cuando tu proyecto se encuentra en un subdirectorio de un repositorio más grande, las rutas se prefijan con él, ubicándolo subiendo desde tu directorio de colecciones hasta el `rebase.json` más cercano. Un proyecto sin `rebase.json` conserva las rutas simples.

El commit no incluye SQL. `rebase db push` y `rebase db generate` escriben el suyo a partir de las colecciones en cada ejecución, en `.rebase/sql/`, que Git ignora.
En 0.23 el commit también incluía `drizzle/schema.sql`, `drizzle/policies.sql` y
`drizzle/search.sql`, escritos en la raíz del proyecto.

El mensaje del commit describe el cambio en lugar de limitarse a anunciarlo, y se atribuye a la persona que lo realizó. Un cambio de esquema con autor y un diff en el historial de tu proyecto es algo que ni Firebase ni Supabase ofrecen: sus ediciones de tablas son invisibles para tu repositorio.

## Quién puede aplicar cambios

Tener `schema:read` es suficiente para **planificar**. La planificación no tiene efectos secundarios, y un trabajo de CI que consulte si un cambio propuesto en una colección es aplicable es un buen caso de uso.

Aplicar los cambios es un privilegio adicional, porque aplicar escribe un commit y un commit lleva un autor:

| Solicitante | Planificar | Aplicar |
|---|---|---|
| Una persona autenticada que tiene `schema:write` | sí | sí |
| Una clave de API que tiene `schema:read` / `schema:write` | sí | no |
| La service key del servidor | sí | no |

Una credencial no es un autor. `api-key:7c3f…` en tu entorno de CI no es una persona, y permitirle escribir en tu repositorio produce exactamente el historial sin atribuir que esta característica busca reemplazar.

En 0.23 la línea la marca el rol `admin`: un administrador planifica y aplica, y cualquier clave de API puede planificar.

Si lo que deseas es un cambio de esquema automatizado (por ejemplo, un pipeline de migraciones), actívalo deliberadamente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

o `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. El commit se atribuirá entonces a la credencial por su nombre —`Rebase API key (7c3f)`—, de modo que leer `git log` un mes después te seguirá diciendo qué cambios fueron realizados por una persona.

`GET /api/admin/schema/status` reporta lo que *tú* puedes hacer, no solo lo que el servidor admite, para que un panel pueda deshabilitar el control y explicar el motivo en lugar de rechazarte después de que hayas tomado la decisión:

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

Aplicar cambios aquí **no** escribe una migración, ni puede hacerlo: una migración utiliza el formato de Atlas con un archivo de integridad, generado por un binario externo contra una base de datos desechable, y un servidor en ejecución no tiene ninguno de los dos.

Lo que sí confirma es la colección, y a partir de ella `rebase db generate` escribe la migración. Por lo tanto, la migración está a un solo comando de distancia:

```bash
rebase db generate
```

Tanto el plan como el resultado lo advierten cuando tu proyecto tiene migraciones, porque de lo contrario el fallo pasa desapercibido: tu base de datos tiene el cambio y tu repositorio lo describe, pero el siguiente entorno construido reproduciendo las migraciones no lo tendrá, y nada habrá avisado.

Un proyecto aprovisionado mediante boot-ensure (el runtime administrado y cualquier entorno autohospedado que deje `REBASE_MIGRATE_ON_BOOT` en su valor predeterminado) no necesita ninguna migración en absoluto. Sus colecciones son el esquema, y el siguiente arranque se encarga de reconciliarlo.

## Primero el commit, luego aplicar

El orden importa y no es arbitrario.

Si el DDL se ejecutara primero y el commit fallara, tu base de datos tendría una columna que tu repositorio no describe. La ruta ensure nunca elimina nada, por lo que el siguiente despliegue no la quitaría ni la mencionaría: una columna invisible, ausente de tus colecciones, hasta que alguien se pusiera a buscar.

Hacer primero el commit falla en el sentido contrario: el repositorio describe algo que la base de datos aún no tiene. Ese es el estado habitual de cualquier proyecto entre una edición y un despliegue, y el arranque lo reconcilia en el siguiente inicio.

Por lo tanto, una aplicación fallida **no es un error**. La respuesta así lo indica:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Dónde funciona esto

La línea divisoria es si el servidor en ejecución tiene tu **código fuente en disco**, no si está en producción.

### MongoDB

Todo lo anterior describe Postgres, donde un cambio de esquema implica DDL. En MongoDB no hay tablas que modificar: agregar una propiedad no añade nada, quitar una no elimina nada, y un documento escrito ayer sigue siendo válido mañana.

Así que cada cambio es aplicable, nunca se rechaza nada y el plan no contiene sentencias: el commit *es* el cambio. El panel muestra «Commit» en lugar de «Commit and apply», y no afirma que se haya ejecutado nada contra la base de datos.

Lo único que vale la pena leer con atención es una eliminación. En Postgres, eliminar una propiedad se rechaza porque descartaría una columna. En MongoDB, el campo permanece en cada documento que lo contiene; tu API simplemente deja de servirlo. El cambio lo especifica en lugar de dejarte asumir la respuesta relacional.

| Despliegue | Funciona |
|---|---|
| `rebase dev` en tu máquina | sí |
| Autohospedado con el proyecto montado | sí |
| Autohospedado desde un bundle compilado | sí, con `liveSchema.repository` |
| Rebase Cloud o cualquier bundle | sí, con `liveSchema.repository` |

Un bundle es una salida compilada, por lo que no contiene el código fuente de las colecciones. Si configuras `liveSchema.repository`, el código fuente se obtiene de tu repositorio en su lugar; sin esto, las rutas responden `SCHEMA_EDITING_NO_REPOSITORY` y explican el motivo.

### Un despliegue sin código fuente en disco

Un bundle es una salida compilada: todos los tenants de Cloud y cualquier autohospedado que sirva una compilación. No hay código fuente de colecciones que el editor pueda reescribir, así que apúntalo al repositorio donde realmente reside el código fuente:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where the collection source lives in that repository.
            // Defaults to "config/collections".
            collectionsPath: "config/collections",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

El cambio se lee entonces desde el repositorio, se reescribe con el mismo editor que se ejecuta localmente y se vuelve a confirmar a través de la API Git Data: un blob, un tree, un commit y una actualización de ref. No se clona nada ni se deja nada en disco.

`auth` acepta un token o una instalación de GitHub App:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Usa el token para un único proyecto que realice commits en un repositorio del que ya eres propietario; configurar una App para que tu propio servidor pueda hacer commits en ella es demasiado protocolo para una credencial de una sola línea. Usa la App para un plano de control que gestione una sola clave para muchos proyectos, que es lo que hace Rebase Cloud: una App, una instalación por proyecto y ningún secreto por cliente que rotar.

El token necesita permisos de `contents: read and write` en ese repositorio, y nada más.

En una máquina que tiene el repositorio, el commit es un simple `git commit`: nada que autenticar, sin token, sin red. Un despliegue sin él realiza el commit a través de la API Git Data en su lugar, sin clonar; consulta [Un despliegue sin código fuente en disco](#un-despliegue-sin-código-fuente-en-disco).

Dos cosas que hacen que sea seguro ejecutarlo contra un repositorio en el que otra persona está trabajando:

- Hace **stage** **únicamente** de los archivos que generó. Un commit de esquema que barriera con trabajo a medio terminar sería un commit que nadie podría revisar, y se rechaza de plano si el árbol ya tiene modificado alguno de sus propios archivos.
- La ruta remota nunca actualiza una ref de forma forzada (`force-update`). Si se integró algo mientras se construía el commit, la actualización se rechaza: perder el commit de alguien en silencio es peor que fallar.

## Limitaciones

- Solo cambios aditivos. Cualquier otra cosa se rechaza con un motivo, porque la ruta ensure es lo único que modifica un esquema y solo puede agregar.
- No se escribe ningún archivo de migración. Un proyecto aprovisionado mediante boot-ensure no necesita ninguno; un proyecto aprovisionado mediante migraciones debe ejecutar `rebase db generate`, que genera uno a través de Atlas con el hash de integridad que Atlas requiere.
- Solo para Postgres. La capacidad se detecta en el controlador (driver), y otros motores responden `SCHEMA_EDITING_UNSUPPORTED`.

## Relacionado

- [Generación de esquemas](/docs/cli/schema/) — las mismas ediciones desde la línea de comandos
- [Definición de colecciones](/docs/collections/) — lo que el editor está reescribiendo
- [Studio](/docs/studio/) — el panel detrás del cual están estas rutas
