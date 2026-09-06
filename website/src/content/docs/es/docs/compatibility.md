---
sourceHash: 64da41d7e9319170
slug: es/docs/compatibility
title: Compatibilidad
description: Qué promete Rebase entre versiones y qué no — los seis contratos versionados, cómo falla cada uno y qué puede seguir cambiando en una versión menor.
---

Qué promete Rebase entre versiones y qué no.

Este es el documento que se debe leer antes de cambiar cualquier cosa de la que
ya dependa un proyecto desplegado o un tenant en ejecución de Rebase Cloud.
También es la respuesta honesta a «si desarrollo sobre Rebase hoy, ¿qué se
romperá más adelante?».

## Qué significa «beta» aquí

Rebase está en beta pública. La mayoría de los proyectos usan esa palabra para
referirse a que «cualquier cosa puede romperse», lo que no aporta al lector nada
sobre lo que pueda planificar, así que esta es la línea que realmente traza este
proyecto:

> **La API sobre la que escribes puede cambiar en una versión menor, con una
> entrada en el registro de cambios (changelog). Tus datos no pueden romperse en
> silencio.**

La primera mitad es el comportamiento habitual de `0.x` y se describe a
continuación. La segunda mitad es la parte que vale la pena revisar, ya que es una
afirmación sobre mecanismos más que sobre intenciones: los contratos versionados
en la siguiente sección están cada uno estampados en un artefacto o en una base
de datos, cada uno se verifica en el arranque (boot) o en la admisión, y cada uno
**falla de forma ruidosa y específica** en lugar de degradarse. Una inserción o
actualización de esquema que eliminaría una columna es rechazada por una barrera
destructiva (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), y la
propia ruta de actualización es una prueba: `upgrade-e2e.test.ts` restaura las
bases de datos tal como las dejaron versiones anteriores, ejecuta la ruta de
migración actual sobre cada una de ellas y asegura que las filas sobrevivan, no
solo que el arranque lo hiciera.

Lo que sí significa beta: aún faltan características, algunos subsistemas son más
nuevos que otros, y la forma que adopta una imperfección es que algo está ausente
o resulta incómodo, no que corrompa algo en silencio. Cuáles subsistemas son
cuáles se publica con fecha en lugar de dejarse al descubrimiento.

## La promesa 0.x

Rebase está en `0.x` — 0.16 al momento de escribir esto. Esta sección está
redactada para aplicarse a cada versión 0.x en lugar de a una sola, por lo que no
queda obsoleta con cada corte. **Los cambios incompatibles (breaking changes) en
la API TypeScript creada todavía están permitidos en una versión menor**, y el
registro de cambios es donde se anuncian. Lo que *no* está permitido que se
rompa en silencio es el conjunto de contratos versionados a continuación: cada
uno está estampado en un artefacto o en una base de datos, cada uno se verifica
al arrancar o en la admisión, y cada uno falla **de forma ruidosa y específica**
en lugar de degradarse.

Esa distinción es toda la promesa. Una exportación renombrada te cuesta un error
de compilación y cinco minutos. Un bundle que arranca contra el runtime incorrecto
y sirve datos sutilmente erróneos te cuesta un incidente, y los contratos existen
para que la segunda categoría no pueda ocurrir en silencio.

Rebase Cloud consume exactamente estos contratos y nada más. Todo lo que no esté
listado aquí es un detalle de implementación del que la plataforma no depende.

## Los contratos versionados

Los valores a continuación se leen desde el código fuente; considera las
referencias de archivos como la verdad y esta tabla como el mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado en | Verificado en | Dirección de compatibilidad |
|---|---|---|---|---|
| 1 | rango de `rebase` en `rebase.json` | el proyecto del usuario | CLI en la compilación | el proyecto declara qué runtimes acepta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatible** — el nuevo runtime lee bundles antiguos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mismo archivo | mismo archivo | **coincidencia exacta, en ambas direcciones** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | en el arranque, contra `rebase.schema_meta` | **solo hacia adelante** — el nuevo runtime migra bases de datos antiguas |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado por el SDK como `x-rebase-schema` | informativo — identifica contra qué esquema se compiló un cliente |
| 6 | Identificadores de base de datos derivados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — un nombre emitido por una versión nunca se vuelve a derivar |

### 1 — `rebase` en `rebase.json`

Un rango de semver, leído como `engines` en un `package.json`: qué versiones de
runtime acepta este proyecto. Llamado `rebase` en lugar de `runtime`
deliberadamente, porque `runtime` ya significa *quién posee el proceso*
(`managed` | `custom`) en una aplicación.

### 2 — `BUNDLE_FORMAT_VERSION` (actualmente 2)

La disposición en disco de un bundle compilado. Un runtime acepta cualquier
bundle cuyo formato sea **menor o igual** al suyo, lo que permite al nivel
administrado (managed tier) mover un tenant a una nueva imagen sin que nadie
tenga que recompilar su proyecto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un único directorio,
  `entry.admin` para un admin empaquetado.
- **2** — `kind: "backend" | "static"`, `entry.static` una lista, `entry.admin`
  eliminado. El formato 1 todavía se lee, a través de `upgradeLegacyManifest`.

**Increméntalo cuando** la estructura cambie de tal manera que un runtime más
antiguo interpretaría erróneamente un bundle más nuevo. El incremento es lo que
convierte un «arranca y no sirve nada» en un rechazo a iniciar.

### 3 — `RUNTIME_CONTRACT_VERSION` (actualmente 1)

La versión mayor del contrato bundle↔runtime. Distinta de la versión del paquete
`@rebasepro/server`, que puede lanzar cualquier cantidad de versiones menores y
parches mientras esta se mantiene fija.

**Lee esto antes de tocarlo.** La comprobación es `!==`, no `>`:

> un bundle dirigido al contrato *N* se ejecuta **únicamente** en un runtime que
> implemente *N*

por lo que incrementarlo invalida **todos los bundles construidos hasta la
fecha**, de una sola vez, hasta que cada uno sea recompilado. Esa es la severidad
intencionada —es la palanca de «nada antiguo puede ejecutarse aquí»—, pero
significa que un incremento es una migración en toda la flota, no una nota de
versión. Para el nivel administrado, debe secuenciarse con la recompilación del
bundle de cada tenant.

Si un cambio es *aditivo* y los bundles antiguos seguirían siendo correctos,
requiere `BUNDLE_FORMAT_VERSION` (o nada en absoluto), no esto.

### 4 — `AUTH_SCHEMA_VERSION` (actualmente 2)

Estampado en `rebase.schema_meta` y comparado al arrancar. Un runtime **se niega
a iniciar** contra una base de datos migrada por una versión más nueva del
framework, en lugar de operar sobre una estructura que no comprende; durante un
despliegue progresivo (rolling deploy), esa es la diferencia entre que la mitad
de la flota devuelva un error y que la mitad de la flota corrompa datos.

La migración hacia adelante es automática: `ensureAuthTablesExist` actualiza una
base de datos más antigua. Ten en cuenta que este bloque de migración está
deliberadamente envuelto en un `try/catch` y registra logs en lugar de lanzar
excepciones —un arranque renqueante es preferible a un ciclo de reinicios
constantes (crash loop)—, por lo que **«arrancó» no demuestra nada**. Cada
aserción en la suite de actualización lee el catálogo o los datos en su lugar.

**Increméntalo cuando** un runtime más antiguo no deba omitir una migración. No lo
incrementes para una columna aditiva y retrocompatible; hay un ejemplo detallado
de este criterio en `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash de las definiciones de colecciones compiladas, emitido en el manifiesto
del bundle y replicado por un SDK generado en el encabezado `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Existe para que la plataforma pueda indicar «esta
aplicación se compiló contra un esquema más antiguo» en lugar de fallar
misteriosamente en la primera petición.

El backend lee ese encabezado en cada petición de datos. La deriva nunca rechaza
una llamada —un SDK con un esquema de retraso suele seguir siendo compatible, y
desplegar el backend antes que el frontend es el orden habitual—, pero cuando una
petición falla con un 400 o un 404, el error lleva la deriva como su causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

Así, una columna renombrada se lee como «tu SDK está obsoleto, vuelve a
generarlo» y no como un campo que tus propios tipos aseguran que existe. A una
petición que funciona nunca se le dice nada.

Cubre **únicamente colecciones**. La edición de un hook o una función no cambia
el contrato de un cliente y no debe invalidar todos los SDK generados.

### 6 — Identificadores de base de datos derivados

Cada nombre que este framework calcula por sí mismo en lugar de ser
especificado: una columna de clave foránea, una restricción de clave foránea,
una tabla de unión (junction table) y sus dos columnas de clave, un tipo enum,
un nombre de política, la columna en `snake_case` de una propiedad en
`camelCase`.

> **Un identificador derivado queda congelado en el momento en que una versión lo
> emite.**

No «congelado hasta la próxima versión mayor»: congelado. El razonamiento es
diferente al de los otros cinco contratos, y más contundente. Aquellos están
versionados, por lo que una discrepancia puede *detectarse* y rechazarse. Este
no: el nombre se escribe en la base de datos de un cliente el día que despliega,
y no hay marca de versión en una columna. Cada base de datos aprovisionada por
cada versión que se haya publicado lleva lo que haya derivado, y ningún código en
este repositorio puede acceder y renombrarlos a todos.

0.13 es el ejemplo práctico. `generateForeignKeyName` aprendió a singularizar
correctamente (`categorie_id` → `category_id`, `addres_id` → `address_id`), lo
cual es inequívocamente una mejor derivación, y rompió todas las bases de datos
antiguas que tenían un plural irregular. Boot-ensure migró la columna, por lo que
los datos sobrevivieron; el archivo `schema.generated.ts` registrado en el
repositorio no lo hizo, y el arranque falló debido a una columna que sí existía.
Tres commits, una nueva prueba de costura (seam test) y una entrada permanente en
las notas de actualización, a cambio de un nombre de columna más elegante por el
que nadie había preguntado.

**Si una derivación es genuinamente errónea**, se cambia para las colecciones
creadas *posteriormente*, detrás de una estrategia de nombrado registrada en el
proyecto; nunca de forma retroactiva, y nunca como efecto secundario de mejorar la
función subyacente.

**La única anulación legítima** es un cambio que hace que el código concuerde con
un nombre que la base de datos *ya tiene*. El ejemplo práctico es el
truncamiento de identificadores: Postgres corta silenciosamente un identificador
a 63 bytes, por lo que un nombre de restricción derivado más largo nunca fue el
nombre en el catálogo; la derivación estaba describiendo un objeto que no existía
bajo esa grafía, y boot-ensure volvía a emitir `ADD CONSTRAINT` en cada arranque
porque su comparación nunca coincidía. Truncar en el momento de la construcción
cambia lo que este repositorio *deriva* y no cambia nada de lo que cualquier base
de datos desplegada *contiene*. Esa es la prueba que se debe aplicar: no «¿es
mejor el nuevo nombre?», sino «¿tiene que cambiar alguna base de datos
existente?».
Lo único que siempre es seguro es *reconocer* un nombre antiguo para poder
migrarlo: `legacyForeignKeyName` existe para ser detectado, nunca para ser
generado, y la línea base también fija esas detecciones. Eliminar una desharía
silenciosamente la migración de cada base de datos que aún conserve esa grafía.

**La barrera.** `scripts/derived-names.mts` ejecuta un fixture de prueba de
esfuerzo de nombrado (plurales irregulares, una terminación en `ss`, un acrónimo,
una unión a partir de un slug en plural, anulaciones explícitas, un slug lo
suficientemente largo como para truncarse) a través de ambos generadores de DDL
de esquema, y renderiza cada identificador que cualquiera de los dos nombre:

```bash
pnpm check:derived-names
```

Una línea modificada o eliminada falla como una ruptura de contrato, mostrando la
grafía antigua y la nueva lado a lado. Un cambio puramente aditivo también falla,
pero con «regenerate», de modo que la línea base no pueda variar sin que nadie se
dé cuenta.

También fija que `rebase db push` y el boot-ensure del runtime administrado
deriven los *mismos* nombres, lo cual es un segundo contrato oculto dentro del
primero: compilan las mismas colecciones a través de código diferente, y un
proyecto publicado (`db push`) una vez y arrancado más tarde no debe terminar con
dos esquemas.

## Qué *no* está congelado

Dicho claramente, para que nadie infiera una promesa que nunca se hizo:

- La API TypeScript creada: configuración de colecciones, opciones de
  `initializeRebaseBackend`, props de admin, nombres de métodos del SDK. Los
  cambios incompatibles (breaking changes) llegan en versiones menores y se
  anuncian en el registro de cambios.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*`: estos evolucionan más rápido y tienen la menor cantidad
  de consumidores.
- Cualquier cosa bajo el `src/` de un paquete que no se reexporte desde su barrel.
  `packages/client/src/index.ts` incluye una nota que explica que su lista de
  exportaciones está seleccionada precisamente para que una exportación interna
  no se vuelva pública por accidente.
- El esquema de base de datos de *tus* colecciones. Eso es tuyo; Rebase solo es
  propietario de los esquemas `rebase` y `auth`.

## Las barreras que sostienen esto

Nada de lo anterior es una convención: cada elemento tiene una prueba que falla
cuando se rompe:

| Barrera | Qué fija |
|---|---|
| `pnpm verify:corpus` | cada estructura de bundle que se haya publicado, arrancada en el runtime actual. Los fixtures en `fixtures/bundles/` están **escritos a mano y congelados**; un fixture que el constructor regenera cambia cada vez que el constructor cambia |
| `pnpm verify:selfhost` | un bundle real compilado, empaquetado, arrancado y consultado como lo haría un navegador |
| `upgrade-e2e.test.ts` | esquemas de bases de datos antiguos (`schema-snapshots/`) gestionados por el runtime actual |
| `e2e/tests/cli-init-e2e.ts` | un proyecto generado desde plantilla instalado a partir de **archivos tarball reales**, no enlaces de workspace |
| `e2e/tests/client-sdk-e2e.ts` | la ruta del usuario final: registrarse → iniciar sesión → lecturas con alcance RLS → refrescar → almacenamiento → realtime |
| `pnpm check:derived-names` | cada nombre de columna, restricción, unión, enum y política que el framework deriva, y que el arranque y `db push` los deriven de forma idéntica |
| `pnpm rls:check` | las políticas del esquema generado |
| `pnpm check:api-surface` | cada exportación de `@rebasepro/server`, y sus miembros, contra `contracts/server.api.txt`. Este es el paquete que `infra/docker/entrypoint.mjs` enlaza simbólicamente sobre la propia copia de un bundle desplegado, por lo que eliminar una exportación de él no es un error de compilación para nadie: es un fallo de arranque en toda la flota, durante un despliegue que nadie solicitó |
| `pnpm test:gates` | las dos barreras anteriores, sobre fixtures. `check:api-surface` pasó toda su existencia sin poder detectar si un miembro desaparecía de `const rebase` |
| `node scripts/check-release-bump.mjs` | que el nivel de incremento con el que se publica una versión coincida con lo que la versión modificó en las líneas base anteriores; ejecutado por `publish.yml` antes de estampar el registro de cambios |
| saas CI | el plano de control compilado contra `main` de este repositorio, en sus propios pushes y de forma nocturna |

**Registra un fixture de bundle y una captura de esquema (schema snapshot) una
vez por versión.** El valor de ambos corpus radica enteramente en qué tan atrás
llega el más antiguo, y ninguno puede completarse retroactivamente después de
los hechos.

## Cambiar un contrato

1. Decide cuál de los seis es. La mayoría de los cambios no son ninguno de ellos,
   pero «ninguno de los seis» no significa «exento de controversia». Eliminar o
   renombrar una exportación de `@rebasepro/server`, o un miembro de ella, no es
   ninguno de los seis y es el cambio individual más peligroso en el repositorio,
   porque el código que rompe ya está compilado y no se volverá a compilar.
   `pnpm check:api-surface` es lo que mantiene esa línea; si se convierte en un
   séptimo contrato numerado es una decisión abierta
   (`docs/audits/81-compat-policy.md`).
2. Añade primero un fixture o snapshot para la estructura **antigua** y comprueba
   que pase.
3. Realiza el cambio e incrementa la constante.
4. Confirma que el fixture antiguo todavía pase, o que ahora falle *con el
   mensaje que un usuario necesitaría*. Ambos son resultados válidos; el silencio
   no lo es.
5. Para el contrato 3, planifica la recompilación de cada bundle desplegado antes
   de fusionar (merge).
6. El contrato 6 es la excepción a los pasos 3 y 4: no hay constante que
   incrementar ni versión sobre la cual rechazar, porque una columna no lleva marca
   de versión. El paso que los reemplaza es decidir no hacer el cambio; consulta
   la sección anterior para ver cómo es la alternativa.

---
