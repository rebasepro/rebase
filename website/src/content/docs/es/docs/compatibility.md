---
sourceHash: 1fd0f89847e543c2
slug: es/docs/compatibility
title: Compatibilidad
description: "Lo que Rebase promete entre versiones y lo que no: los seis contratos versionados, cómo falla cada uno y qué puede seguir cambiando en una versión menor."
---

Lo que Rebase promete entre versiones, y lo que no.

Este es el documento que debe leer antes de cambiar cualquier cosa de la que ya dependa
un proyecto desplegado o un tenant en ejecución de Rebase Cloud. También es la respuesta sincera a
"si construyo sobre Rebase hoy, ¿qué se romperá más adelante?"

## Qué significa "beta" aquí

Rebase está en beta pública. La mayoría de los proyectos usan esa palabra para referirse a que "cualquier
cosa puede romperse", lo cual no le dice nada a un lector que le permita planificar; por eso, esta es la línea
que este proyecto realmente traza:

> **La API sobre la que escribe puede cambiar en una versión menor, con una entrada en el changelog.
> Sus datos no pueden romperse silenciosamente.**

La primera mitad es el comportamiento habitual de `0.x` y se describe más abajo. La segunda
mitad es la parte que vale la pena comprobar, porque es una afirmación sobre mecanismos más que
sobre intenciones: cada uno de los contratos versionados en la siguiente sección está sellado
en un artefacto o en una base de datos, cada uno se verifica al arrancar o en la admisión, y cada uno
**falla de forma ruidosa y específica** en lugar de degradarse. Un push de esquema que
eliminaría una columna es rechazado por una compuerta destructiva
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), y la propia ruta de actualización
es una prueba: `upgrade-e2e.test.ts` restaura bases de datos tal como las dejaron las versiones
anteriores, ejecuta la ruta de migración actual sobre cada una de ellas y asegura que
las filas sobreviven, no solo que el arranque lo hizo.

Lo que sí significa beta: todavía faltan características, algunos subsistemas son más nuevos que
otros, y la forma de una aspereza es que algo está ausente o es incómodo de usar,
no que corrompa algo en silencio. Cuáles subsistemas son cuáles se publica
y fecha en lugar de dejarse al azar para ser descubierto; la siguiente tabla es esa
publicación.

## Estado de preparación por subsistema

**Última revisión el 14 de septiembre de 2026, respecto a 0.21.0.** Léalo de nuevo en cada versión menor; una
calificación que no se ha movido en tres versiones está consolidada o se ha olvidado, y
esta nota está aquí para que se compruebe la diferencia.

Las tres calificaciones significan:

- **Estable** — la estructura está consolidada y cubierta por una compuerta en CI. Todavía puede
  incorporar funciones; no se rediseñará inesperadamente dentro de 0.x, y cualquier cambio que
  cause incompatibilidad se anunciará en el changelog.
- **Beta** — funciona y se utiliza en producción, y se sabe que algo en ella
  tiene asperezas: un límite que se puede alcanzar, un caso límite incómodo, una decisión de diseño
  aún no tomada. La parte conflictiva se menciona en las notas, porque "beta" por sí sola
  no le dice nada sobre lo que pueda planificar.
- **Experimental** — lanzada para que pueda usarse y reportarse. Espere encontrarse
  con las partes que nadie ha tocado todavía.

| Subsistema | Calificación | En qué se basa la calificación |
|---|---|---|
| REST API + SDK generado | Estable | El contrato de red (wire contract) está versionado y controlado por compuertas; `client-sdk-e2e` ejecuta registro → inicio de sesión → lecturas con alcance RLS → actualización de token → almacenamiento → realtime de extremo a extremo |
| Autenticación — email/contraseña, OAuth, OIDC, magic link, código de un solo uso | Estable | Se incluyen doce proveedores OAuth. El esquema de autenticación es un contrato versionado, sellado y verificado en el arranque |
| Autenticación — MFA (TOTP) | Beta | El enrolamiento, la verificación y la recuperación funcionan y están probados. La rotación de claves está implementada para la clave de cifrado; no hay superficie de administración para restablecer el factor de un usuario bloqueado |
| Seguridad a nivel de fila (RLS) | Estable | La pieza angular del producto. `pnpm rls:check` audita una base de datos activa contra quince comprobaciones, y la suite e2e de RLS se ejecuta en cada push |
| Almacenamiento | Estable | Local, S3 y GCS. Denegación por defecto (default-deny) en producción desde 0.17.0, y el scaffold incluye un hook authorize |
| Realtime | **Beta** | Las suscripciones solo coinciden por la ruta de la colección, por lo que N suscriptores en una colección cuestan N reconsultas (refetches) con alcance RLS por cada escritura. Esto limita un despliegue a unos pocos cientos de suscriptores concurrentes. Correcto a cualquier escala; costoso más allá de esa cifra |
| Búsqueda vectorial (pgvector) | Beta | Cada columna de vectores obtiene un índice HNSW para distancia coseno por defecto, ajustable por propiedad a través de `VectorIndexConfig` (método, distancias, parámetros de construcción) o desactivable, lo que deja un escaneo exacto. pgvector no puede indexar una columna de más de 2.000 dimensiones, por lo que estas quedan sin indexar y realizan un escaneo |
| Sincronización offline | Beta | Las mutaciones llevan claves de idempotencia que el servidor respeta, y se han corregido los defectos de pérdida de datos detectados en la auditoría de julio. El modelo de conflictos es last-write-wins sin fusión por campo |
| Historial de entidades | Estable | Basado en instantáneas (snapshots), respaldado por su propia suite de pruebas |
| Funciones y crons | Estable | El punto de entrada portable (`@rebasepro/server/functions`) es un contrato versionado con su propia sección de superficie de API |
| Servidor MCP + habilidades de agente | Beta | `@rebasepro/mcp` se ejecuta sobre stdio: cincuenta y tres herramientas, autenticación bearer por proyecto, las herramientas destructivas rechazan objetivos no locales a menos que se habilite explícitamente. Desde 0.21 el servidor también puede montar un endpoint remoto `/mcp` — OAuth 2.1, once herramientas de datos, cada llamada bajo el propio RLS de la persona que inició sesión — desactivado a menos que `REBASE_MCP_ENABLED=true`, y solo para Postgres |
| Studio (SQL, schema, RLS, explorador de API) | Beta | Usado a diario en proyectos reales. El branching está presente en el paquete OSS y deliberadamente no está expuesto en Rebase Cloud, porque migrar un despliegue en ejecución a una rama aún no tiene una solución definida |
| CMS + panel de administración | Beta | Completo para CRUD, relaciones, campos de almacenamiento y roles. **La tabla de datos no tiene semántica de cuadrícula (grid)** — sin `role`, sin `aria-rowindex`, `tabIndex` eliminado — por lo que los usuarios de teclado y lectores de pantalla no pueden operar la vista principal. Sin borradores, sin contenido por configuración regional (locale), sin texto enriquecido por bloques |
| Base de datos de desarrollo gestionada PGlite | Beta | `rebase dev` sin configuración previa y sin Docker. Una sesión a la vez, por lo que las solicitudes se serializan y no se puede reproducir concurrencia contra ella; los comandos respaldados por Atlas (`db push`, `generate`, `migrate`) planifican contra un segundo PGlite desechable iniciado para el comando (en 0.24 rechazan la base de datos gestionada); `db branch` no funciona allí y así lo indica |
| Helm chart | Beta | Renderiza la topología de procesos divididos y se publica en el registro OCI en cada versión. El valor predeterminado sigue siendo un único contenedor |
| `@rebasepro/server-mongo` | **Experimental** | Un controlador funcional con realtime basado en change streams e historial por instantáneas. **Sin seguridad a nivel de fila (RLS)** — todo el modelo de aislamiento anterior no aplica a él — y sin relaciones. Los change streams necesitan un replica set: en un `mongod` independiente nada los reemplaza, por lo que una suscripción ve las escrituras realizadas a través de ese proceso de Rebase y pierde todas las demás. Sin MFA: el enrolamiento responde 501, y las comprobaciones responden "sin factor", por lo que el inicio de sesión nunca solicita uno. El agregador de administración no puede apuntar a una colección — lee el nombre de una etapa `$from` que MongoDB no tiene — por lo que no devuelve nada |
| `@rebasepro/firebase` | Experimental | Ejecuta el panel de administración y el SDK contra Firestore. Sin RLS, sin superficie SQL; el conjunto de características de Postgres no se traslada. El controlador de Firestore ignora los grupos de filtros `or(...)`/`and(...)`, por lo que una consulta que use uno lee cada fila que sus filtros simples permitan |
| Rebase Cloud | **Beta privada** | En vivo, ejecutando tenants reales, abierto por lotes. No es autoservicio |

Dos de las entradas anteriores representan el costo sincero de publicar esta tabla: el
refetch de realtime y la accesibilidad de la tabla de datos son defectos abiertos, no
elementos de la hoja de ruta, y ambos se detallan en lugar de dejarse al lector para que los descubra.

Esta tabla es lo que existe. Lo que aún no existe está en el
[roadmap](https://rebase.pro/roadmap), con una entrada por cada issue de GitHub, con el
subconjunto requerido para la versión 1.0 marcado.

## La promesa de 0.x

Rebase está en `0.x`. Esta sección está redactada para ser válida en cada lanzamiento 0.x y
no solo en uno de ellos, de modo que no quede desactualizada con cada versión. **Los cambios incompatibles (breaking changes) en
la API de TypeScript que usted escribe todavía están permitidos en una versión menor**, y el changelog es
donde se anuncian. Lo que
*no* está permitido que se rompa silenciosamente es el conjunto de contratos versionados a continuación: cada
uno está sellado en un artefacto o base de datos, cada uno se verifica en el arranque o en la
admisión, y cada uno falla **de forma ruidosa y específica** en lugar de degradarse.

Esa distinción es toda la promesa. Una exportación renombrada le cuesta un error de compilación
y cinco minutos. Un bundle que arranca con el runtime incorrecto y sirve
datos sutilmente erróneos le cuesta un incidente, y los contratos existen para que la
segunda categoría no pueda ocurrir en silencio.

Rebase Cloud consume exactamente estos contratos y nada más. Todo lo que no esté
listado aquí es un detalle de implementación del que la plataforma no depende.

### Insignias de versión y canaries

La documentación se publica desde `main`, por lo que una página puede describir algo que ninguna
versión estable tiene todavía. Una insignia *Since* indica la primera versión estable que lo incluye,
y el texto junto a ella dice qué hace la versión anterior.

Un canary es una compilación de `main` numerada con la versión a la que se dirige:
`0.25.0-canary.g<commit>` es `main` en ese commit, después de 0.24.0 y antes de
0.25.0, y `rebase upgrade --to canary` instala la más reciente. Contiene
todo lo que había llegado a `main` cuando se construyó, por lo que una insignia que mencione su
versión (Since 0.25) se aplica a usted, y la nota sobre la versión anterior (en
0.24) describe la versión estable de la que provino. Los canaries anteriores a 0.25.0 estaban
numerados con respecto a la última versión lanzada: `0.24.1-canary.g<commit>` también es una
vista previa de 0.25.

## Los contratos versionados

Los valores siguientes se leen del código fuente; considere las referencias a archivos como la verdad
y esta tabla como el mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado en | Verificado en | Dirección de compatibilidad |
|---|---|---|---|---|
| 1 | Rango de `rebase` en `rebase.json` | el proyecto del usuario | CLI en la compilación | el proyecto indica qué runtimes acepta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatible hacia atrás** — el nuevo runtime lee bundles antiguos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mismo archivo | mismo archivo | **coincidencia exacta, ambas direcciones** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | en el arranque, contra `rebase.schema_meta` | **solo hacia adelante** — el nuevo runtime migra bases de datos antiguas |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado por el SDK como `x-rebase-schema` cuando está configurado | orientativo — identifica con qué esquema se construyó un cliente |
| 6 | Identificadores de base de datos derivados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — un nombre emitido por una versión nunca se vuelve a derivar |

### 1 — `rebase` en `rebase.json`

Un rango semver, interpretado como `engines` en un `package.json`: qué versiones de runtime
acepta este proyecto. Nombrado deliberadamente `rebase` en lugar de `runtime`, porque
`runtime` ya significa *quién es el dueño del proceso* (`managed` | `custom`) en una app.

### 2 — `BUNDLE_FORMAT_VERSION` (actualmente 2)

La distribución en disco de un bundle compilado. Un runtime acepta cualquier bundle cuyo formato
sea **menor o igual** al suyo propio, que es lo que permite al nivel gestionado migrar un
tenant a una nueva imagen sin que nadie tenga que recompilar su proyecto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un único directorio,
  `entry.admin` para un panel de administración empaquetado.
- **2** — `kind: "backend" | "static"`, `entry.static` una lista, `entry.admin`
  eliminado. El formato 1 aún se lee, a través de `upgradeLegacyManifest`.

**Increméntelo cuando** la distribución cambie de tal manera que un runtime más antiguo interpretaría erróneamente
un bundle más nuevo. El incremento es lo que convierte un "arranca y no sirve nada" en una
negativa a iniciar.

### 3 — `RUNTIME_CONTRACT_VERSION` (actualmente 1)

El número mayor del contrato bundle↔runtime. Es distinto de la versión del paquete
`@rebasepro/server`, que puede lanzar cualquier cantidad de versiones menores y parches mientras este se mantiene intacto.

**Lea esto antes de modificarlo.** La comprobación es `!==`, no `>`:

> un bundle dirigido al contrato *N* se ejecuta **únicamente** en un runtime que implementa *N*

por lo que incrementarlo invalida **todos los bundles jamás creados**, todos a la vez, hasta
que cada uno sea recompilado. Esa es la severidad prevista —es la palanca de "nada antiguo puede ejecutarse aquí"—,
pero significa que un incremento es una migración en toda la flota, no una simple nota de la versión. Para
el nivel gestionado, debe coordinarse con una recompilación del bundle de cada tenant.

Si un cambio es *aditivo* y los bundles antiguos seguirían siendo correctos, lo que corresponde
es `BUNDLE_FORMAT_VERSION` (o nada en absoluto), no esto.

### 4 — `AUTH_SCHEMA_VERSION` (actualmente 2)

Sellado en `rebase.schema_meta` y comparado en el arranque. Un runtime **se niega a
iniciar** contra una base de datos migrada por una versión más nueva del framework, en lugar de
operar sobre una estructura que no comprende; durante un despliegue progresivo (rolling deploy), esa es
la diferencia entre que la mitad de la flota dé error y que la mitad de la flota se corrompa.

La migración hacia adelante es automática: `ensureAuthTablesExist` actualiza una base de datos antigua.
Tenga en cuenta que este bloque de migración está envuelto deliberadamente en un `try/catch` y
registra logs en lugar de lanzar una excepción —un arranque defectuoso es preferible a un crash loop—, por lo que **"arrancó"
no demuestra nada**. En su lugar, cada aserción en la suite de actualización lee el
catálogo o los datos.

**Increméntelo cuando** un runtime más antiguo no deba omitir una migración. No
lo incremente para una columna aditiva y retrocompatible; hay un ejemplo práctico de este
criterio en `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash de las definiciones de colecciones compiladas, emitido en el manifiesto del bundle
y replicado por un SDK generado en el encabezado `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Existe para que la plataforma pueda indicar "esta aplicación se compiló
con un esquema anterior" en lugar de fallar misteriosamente en la primera solicitud.

`rebase generate-sdk` escribe el valor en `schema.meta.ts`; páselo al
cliente para enviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

El backend lee ese encabezado en cada solicitud de datos. La desviación (drift) nunca rechaza una
llamada —un SDK con un esquema por detrás suele seguir siendo compatible, y desplegar el
backend antes del frontend es el orden habitual de despliegue—, pero cuando una solicitud
falla con un 400 o un 404, el error incluye la desviación como su causa:

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

De este modo, una columna renombrada se interpreta como "su SDK está desactualizado, regenérelo" en lugar de
un campo que sus propios tipos insisten en que existe. A una solicitud que tiene éxito nunca se le informa.

Cubre **únicamente colecciones**. La edición de un hook o función no cambia el
contrato del cliente y no debe invalidar todos los SDK generados.

### Quién está llamando

Dos señales de identificación adicionales, ninguna de las cuales bloquea nada por sí sola:

- **`GET /api/meta/schema-version`** no requiere autenticación y responde con la
  `schemaVersion` del proyecto *y* su `runtime` (`version` y `contract`). Un
  trabajo de CI que compare su SDK generado contra un proyecto activo no necesita
  credenciales, y tampoco un cliente que pregunte con qué runtime se está comunicando.
- **`User-Agent: rebase-cli/<version>`** se incluye en cada solicitud a `rebase cloud`.
  El formato de red del plano de control va por delante de lo que se publica en npm, por lo que
  necesita poder responder a un cliente antiguo con `CLI_TOO_OLD` y la versión
  mínima —lo cual solo puede hacer para un emisor que indique quién es.

### 6 — Identificadores de base de datos derivados

Cada nombre que este framework deduce por sí mismo en lugar de recibirlo explícitamente: una
columna de clave foránea, una restricción de clave foránea, una tabla de unión (junction table) y sus dos columnas de clave, un
tipo enum, el nombre de una política, la columna `snake_case` de una propiedad en `camelCase`.

> **Un identificador derivado queda congelado en el momento en que una versión lo emite.**

No "congelado hasta la próxima versión mayor": congelado. El razonamiento es diferente al de
los otros cinco contratos, y más estricto. Aquellos están versionados, por lo que una discrepancia puede ser
*detectada* y rechazada. Este no: el nombre se escribe en la base de datos de un cliente
el día en que realiza el despliegue, y no hay ningún sello de versión en una columna. Cada
base de datos aprovisionada por cada versión jamás lanzada lleva lo que haya
derivado, y ningún código en este repositorio puede acceder y renombrarlas todas.

La versión 0.13 es el ejemplo práctico. `generateForeignKeyName` aprendió a singularizar
correctamente (`categorie_id` → `category_id`, `addres_id` → `address_id`), lo cual es
indudablemente una mejor derivación, y rompió todas las bases de datos antiguas que tenían un
plural irregular. Boot-ensure migró la columna, por lo que los datos sobrevivieron; el
archivo `schema.generated.ts` guardado en el repositorio del proyecto no lo hizo, y el arranque falló ante una columna
que sí existía. Tres commits, una nueva prueba de costura (seam test) y una entrada permanente en las notas
de actualización, a cambio de un nombre de columna con mejor aspecto sobre el cual nadie había preguntado.

**Si una derivación es genuinamente errónea**, cambia para las colecciones creadas
*posteriormente*, detrás de una estrategia de nomenclatura registrada en el proyecto; nunca
retroactivamente y nunca como efecto secundario de mejorar la función subyacente.

**La única excepción legítima** es un cambio que hace que el código coincida con un nombre
que la base de datos *ya tiene*. El ejemplo práctico es el truncamiento de identificadores: Postgres
recorta silenciosamente un identificador a 63 bytes, por lo que un nombre de restricción derivado más largo
nunca fue el nombre en el catálogo; la derivación describía un objeto que
no existía bajo esa grafía, y boot-ensure volvía a emitir `ADD CONSTRAINT` en
cada inicio porque su comparación nunca podía coincidir. Truncar en el momento
de la construcción cambia lo que este repositorio *deriva* y no cambia nada de lo que cualquier
base de datos desplegada *contiene*. Esa es la prueba a aplicar: no "¿es mejor el nuevo nombre?",
sino "¿tiene que cambiar alguna base de datos existente?".

El otro caso en el que un nombre puede cambiar es un conjunto de nombres que nunca podrían coexistir.
Una regla que abarcaba varias operaciones en una tabla de 42 bytes o más derivaba
`<table>_default_admin_write_insert`, `_update` y `_delete`, y las tres se recortaban a
los mismos 63 bytes. Postgres almacenaba solo una política, DELETE, y rechazaba cada INSERT
y UPDATE de administrador. Solo cuando los nombres de una regla colisionan de esta manera se derivan
con el sufijo primero, como `<head>_<hash8>_<op>`. Cada nombre que funciona hoy conserva su
grafía. El siguiente arranque o push elimina la única política truncada y crea una
política para cada operación.

Lo único que siempre es seguro es *reconocer* un nombre antiguo para poder
migrarlo: `legacyForeignKeyName` existe para ser detectado, nunca para ser generado,
y la línea base fija también esas detecciones. Descartar una revierte silenciosamente
la migración de cada base de datos que aún conserve esa grafía.

**La compuerta.** `tooling/scripts/derived-names.mts` ejecuta un caso de prueba de estrés de nombres —plurales
irregulares, una terminación en `ss`, un acrónimo, una unión a partir de un slug en plural, anulaciones
explícitas, un slug lo suficientemente largo como para ser truncado— a través de ambos productores de DDL de esquema,
y genera cada identificador nombrado por cualquiera de los dos:

```bash
pnpm check:derived-names
```

Una línea modificada o eliminada falla como una ruptura de contrato, mostrando la grafía antigua y la nueva
lado a lado. Un cambio puramente aditivo también falla, pero con "regenerate" —para que la
línea base no se desvíe inadvertidamente para nadie.

También fija que `rebase db push` y el boot-ensure del runtime gestionado deriven
los *mismos* nombres, lo cual es un segundo contrato oculto dentro del primero: compilan
las mismas colecciones a través de código diferente, y un proyecto enviado una vez con push y arrancado
más tarde no debe terminar con dos esquemas distintos.

## Lo que *no* está congelado

Dicho claramente, para que nadie deduzca una promesa que nunca se hizo:

- La API de TypeScript que usted escribe: configuración de colecciones, opciones de
  `initializeRebaseBackend`, props de administración, nombres de métodos del SDK. Los cambios incompatibles
  se introducen en versiones menores y se anuncian en el changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estos avanzan más rápido y tienen la menor cantidad de consumidores.
- Cualquier elemento dentro del directorio `src/` de un paquete que no se reexporte desde su archivo barrel principal.
  `packages/client/src/index.ts` incluye una nota que explica que su lista de exportaciones
  se mantiene cuidadosamente para que una exportación interna no pase a ser pública por accidente.
- El esquema de base de datos de *sus* colecciones. Ese le pertenece a usted; Rebase solo es dueño del
  esquema `rebase` (y, en una base de datos aprovisionada antes de 0.13, del antiguo esquema `auth`
  hasta que el arranque lo retire).

## Las compuertas que sostienen esto

Nada de lo anterior es una simple convención: cada elemento tiene una prueba que falla cuando se rompe:

| Compuerta | Lo que asegura |
|---|---|
| `pnpm verify:corpus` | cada estructura de bundle jamás lanzada, iniciada en el runtime de hoy. Los fixtures en `tests/fixtures/bundles/` están **escritos manualmente y congelados** — un fixture que el compilador regenera se modifica cada vez que el compilador cambia |
| `pnpm verify:selfhost` | un bundle real compilado, empaquetado, iniciado y consultado como lo haría un navegador |
| `upgrade-e2e.test.ts` | esquemas antiguos de bases de datos (`schema-snapshots/`) gestionados por el runtime actual |
| `tests/e2e/tests/cli-init-e2e.ts` | un proyecto inicializado con scaffold instalado desde **archivos tarball reales**, no enlaces de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | el flujo del usuario final: registro → inicio de sesión → lecturas con alcance RLS → actualización de token → almacenamiento → realtime |
| `pnpm check:derived-names` | cada nombre de columna, restricción, tabla de unión, enum y política que el framework deriva — y que el arranque y `db push` los derivan de forma idéntica |
| `pnpm rls:check` | las políticas del esquema generado |
| `pnpm check:api-surface` | cada exportación, y sus miembros, de los cinco paquetes que proporciona la imagen — `@rebasepro/server`, `types`, `client`, `common`, `utils` — además del punto de entrada `@rebasepro/server/functions`, frente a las seis secciones de `contracts/server.api.txt`. Estos son los paquetes a los que `infra/docker/entrypoint.mjs` crea enlaces simbólicos sobre las copias propias de un bundle desplegado, por lo que eliminar una exportación de uno de ellos no es un error de compilación para nadie: es un fallo de arranque en toda la flota, durante un despliegue que nadie solicitó |
| `pnpm test:gates` | las pruebas propias de las compuertas, sobre fixtures — cuarenta y siete archivos, entre ellos `check:api-surface` y la verificación de incremento de versión más abajo —, de modo que una compuerta que deje de detectar lo que protege falle aquí. `check:api-surface` pasó toda su vida sin poder ver la desaparición de un miembro de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que el nivel de incremento bajo el cual se publica una versión coincida con lo que la versión modificó en las líneas base anteriores; ejecutado por `publish.yml` antes de estampar el changelog |
| CI de saas | el plano de control compilado contra la rama `main` de este repositorio, en sus propios pushes y ejecuciones nocturnas |

**Registre un fixture de bundle y una instantánea de esquema una vez por versión.** El valor de
ambos conjuntos (corpora) reside enteramente en cuán antiguo sea el más viejo de ellos, y ninguno puede
completarse retroactivamente después de los hechos.

### Aún no controlado por compuertas

La tabla anterior es lo que se mantiene garantizado. Estas son las partes de la política que aún
nada asegura, listadas para que nadie suponga una promesa en ellas:

- **Sin ventana de obsolescencia ni soporte.** Mientras Rebase esté en `0.x` no existe
  una regla escrita sobre cuánto tiempo sobrevive una exportación obsoleta (deprecated) antes de su eliminación,
  o cuánto tiempo recibe correcciones una versión menor anterior. Las correcciones de seguridad solo se aplican a la última versión menor.
- **El formato de red HTTP no tiene compuerta.** Ningún script `check:*` compara las formas
  de solicitud y respuesta con una línea base del modo en que `check:api-surface` compara exportaciones;
  un cambio en la estructura de respuesta solo es detectado por una suite e2e que por casualidad la lea.
- **Los flags de la CLI no tienen una línea base de compatibilidad.** El verificador de documentación falla cuando
  desaparece un flag que usan las habilidades (skills), los ejemplos o el sitio de marketing; nada
  detecta la desaparición de cualquier otro flag o el cambio de significado de uno.
- **Una versión generada por CI no registra ningún corpus.** El flujo de publicación no registra ningún
  fixture de bundle ni ninguna instantánea de esquema; solo el script de lanzamiento local lo intenta, y
  advierte en lugar de detenerse cuando no puede hacerlo. De la versión 0.18 a la 0.21 no hay ninguna
  instantánea de proyecto registrada.
- **La superficie de exportación es una compuerta, no un contrato.** Si las exportaciones públicas
  de los paquetes proporcionados por el runtime se convertirán en un séptimo contrato numerado —declarado como
  la línea base de `check:api-surface`, compatible de forma aditiva dentro de una versión mayor de contrato—
  es una decisión pendiente.

## Modificar un contrato

1. Decida cuál de los seis es. La mayoría de los cambios no son ninguno de ellos, pero "ninguno
   de los seis" no significa "sin controversia". Eliminar o renombrar una exportación de
   `@rebasepro/server`, o un miembro de ella, no pertenece a ninguno de los seis y es el cambio
   más peligroso de todo el repositorio, porque el código que rompe ya está compilado
   y no se recompilará. `pnpm check:api-surface` es lo que sostiene esa línea; si se
   convierte en un séptimo contrato numerado es una decisión abierta (consulte
   *Aún no controlado por compuertas*, arriba).
2. Agregue primero un fixture o instantánea para la estructura **antigua** y verifique que pase la prueba.
3. Realice el cambio e incremente la constante.
4. Confirme que el fixture antiguo todavía pasa, o que ahora falla *con el mensaje
   que un usuario necesitaría*. Ambos son resultados válidos; el silencio no lo es.
5. Para el contrato 3, planifique la recompilación de cada bundle desplegado antes de fusionar el cambio.
6. El contrato 6 es la excepción a los pasos 3 y 4: no hay ninguna constante que incrementar ni
   ninguna versión en la que basar un rechazo, porque una columna no lleva sello de versión. El paso
   que los reemplaza es decidir no hacer el cambio; consulte la sección anterior
   para ver cómo es la alternativa.

## Relacionado

- [Actualización](/docs/upgrading/) — qué se rompió realmente, versión por versión
- [Changelog](/docs/changelog/) — cada cambio, incluidos los que no rompieron nada
- [Runtime y Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — el formato de bundle contra el que ya está construido un proyecto desplegado
