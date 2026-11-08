---
sourceHash: 35b2f33f3e05ddce
slug: es/docs/compatibility
title: Compatibilidad
description: "Lo que Rebase promete entre versiones y lo que no: los seis contratos versionados, cómo falla cada uno y qué puede seguir cambiando en una versión menor."
---

Lo que Rebase promete entre versiones, y lo que no.

Este es el documento que debe leer antes de cambiar cualquier cosa de la que ya
dependa un proyecto desplegado o un tenant activo de Rebase Cloud. También es la
respuesta honesta a "¿si construyo sobre Rebase hoy, qué dejará de funcionar más
adelante?".

## Qué significa "beta" aquí

Rebase está en beta pública. La mayoría de los proyectos usan esa palabra para
significar "cualquier cosa puede romperse", lo cual no le dice al lector nada
sobre lo que pueda planificar, así que esta es la línea que este proyecto
realmente traza:

> **La API sobre la que escribe puede cambiar en una versión menor, con una
> entrada en el changelog. Sus datos no pueden corromperse en silencio.**

La primera mitad es el comportamiento habitual de `0.x` y se describe más abajo.
La segunda mitad es la parte que vale la pena comprobar, porque es una afirmación
sobre mecanismos en lugar de intenciones: cada uno de los contratos versionados
en la siguiente sección está grabado en un artefacto o en una base de datos, cada
uno se verifica en el arranque o en la recepción, y cada uno **falla de forma
ruidosa y específica** en lugar de degradarse. Una inserción de esquema (`schema push`)
que eliminaría una columna es rechazada por una barrera destructiva
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), y la ruta de
actualización en sí misma es una prueba: `upgrade-e2e.test.ts` restaura bases de
datos tal como las dejaron versiones anteriores, ejecuta la ruta de migración
actual sobre cada una de ellas y asegura que las filas sobreviven, no simplemente
que el arranque lo hizo.

Lo que sí significa beta: todavía faltan funcionalidades, algunos subsistemas son
más nuevos que otros, y la forma de una aspereza es que algo está ausente o es
incómodo, no que corrompe algo silenciosamente. Qué subsistemas corresponden a
cada caso está publicado y fechado en lugar de dejarlo por descubrir: la
siguiente tabla es esa publicación.

## Madurez por subsistema

**Última revisión: 14 de septiembre de 2026, respecto a 0.21.0.** Vuelva a leerlo
en cada versión menor; una clasificación que no se ha movido en tres lanzamientos
está consolidada o ha sido olvidada, y esta nota está aquí para que se verifique
la diferencia.

Las tres clasificaciones significan:

- **Estable** — la forma está consolidada y cubierta por una barrera en CI. Aún
  puede incorporar funciones; no se rediseñará inesperadamente dentro de 0.x, y
  cualquier cambio que cause incompatibilidad se anunciará en el changelog.
- **Beta** — funciona y se utiliza en producción, y se sabe que algo en ello es
  imperfecto: un límite que se puede alcanzar, un caso particular incómodo o una
  decisión de diseño aún no tomada. La parte imperfecta se detalla en las notas,
  porque "beta" por sí sola no le dice nada sobre lo que pueda planificar.
- **Experimental** — publicado para que pueda usarse y recibir reportes. Espere
  toparse con las partes que nadie ha probado aún.

| Subsistema | Clasificación | En qué se basa la clasificación |
|---|---|---|
| REST API + generated SDK | Estable | El contrato de transmisión está versionado y protegido por barreras; `client-sdk-e2e` ejecuta registro → inicio de sesión → lecturas con ámbito de RLS → actualización de token → almacenamiento → tiempo real de extremo a extremo |
| Auth — email/password, OAuth, OIDC, magic link, one-time code | Estable | Se incluyen doce proveedores OAuth. El esquema de autenticación es un contrato versionado, grabado y verificado en el arranque |
| Auth — MFA (TOTP) | Beta | El registro, la verificación y la recuperación funcionan y están probados. La rotación de claves está implementada para la clave de cifrado; no hay superficie de administración para restablecer el factor de un usuario bloqueado |
| Row-level security | Estable | El pilar fundamental del producto. `pnpm rls:check` audita una base de datos activa contra quince comprobaciones, y la suite e2e de RLS se ejecuta en cada push |
| Storage | Estable | Local, S3 y GCS. Denegación por defecto en producción desde 0.17.0, y el scaffold incluye un hook de autorización |
| Realtime | **Beta** | Las suscripciones solo se comparan por ruta de colección, por lo que N suscriptores en una colección cuestan N reconsultas con ámbito de RLS por cada escritura. Eso limita un despliegue a unos pocos cientos de suscriptores concurrentes. Correcto a cualquier escala; costoso más allá de esa |
| Vector search (pgvector) | Beta | Cada columna de vectores obtiene un índice HNSW para distancia coseno por defecto, ajustable por propiedad a través de `VectorIndexConfig` (método, distancias, parámetros de construcción) o desactivable, lo que deja un escaneo exacto. pgvector no puede indexar una columna de más de 2.000 dimensiones, por lo que esas se dejan sin indexar y se escanean |
| Offline sync | Beta | Las mutaciones llevan claves de idempotencia que el servidor respeta, y se han corregido los defectos de pérdida de datos detectados en la auditoría de julio. El modelo de resolución de conflictos es el de última escritura gana (last-write-wins) sin fusión por campo |
| Entity history | Estable | Basado en instantáneas, protegido por su propia suite de pruebas |
| Functions and crons | Estable | El punto de entrada portable (`@rebasepro/server/functions`) es un contrato versionado con su propia sección de superficie de API |
| MCP server + agent skills | Beta | `@rebasepro/mcp` se ejecuta sobre stdio: cincuenta y tres herramientas, autenticación bearer por proyecto, las herramientas destructivas rechazan destinos no locales a menos que se habilite explícitamente. Desde 0.21 el servidor también puede montar un endpoint `/mcp` remoto — OAuth 2.1, doce herramientas de datos, cada llamada bajo el RLS propio del usuario autenticado — desactivado a menos que `REBASE_MCP_ENABLED=true`, y solo para Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Utilizado a diario en proyectos reales. La ramificación (branching) está presente en el paquete OSS y deliberadamente no está expuesta en Rebase Cloud, porque migrar un despliegue en ejecución a una rama aún no tiene una solución definida |
| CMS + admin panel | Beta | Completo para CRUD, relaciones, campos de almacenamiento y roles. **La tabla de datos no tiene semántica de grid** — sin `role`, sin `aria-rowindex`, `tabIndex` eliminado — por lo que los usuarios de teclado y lectores de pantalla no pueden operar la vista principal. Sin borradores, sin contenido por idioma/localización, sin texto enriquecido en bloques |
| PGlite managed dev database | Beta | `rebase dev` sin configuración ni Docker. Una sesión a la vez, por lo que las solicitudes se serializan y la concurrencia no se puede reproducir contra ella; los comandos respaldados por Atlas (`db push`, `generate`, `migrate`) planifican contra un segundo PGlite desechable iniciado para el comando (en 0.24 rechazan la base de datos administrada); `db branch` no funciona allí y así lo indica |
| Helm chart | Beta | Representa la topología de procesos divididos y se publica en el registro OCI en cada lanzamiento. El valor predeterminado sigue siendo un único contenedor |
| `@rebasepro/server-mongo` | **Experimental** | Un controlador funcional con tiempo real mediante change streams e historial por instantáneas. **Sin seguridad a nivel de fila (RLS)** — todo el modelo de aislamiento anterior no se aplica aquí — y sin relaciones. Los change streams necesitan un replica set: en un `mongod` independiente nada los reemplaza, por lo que una suscripción ve las escrituras realizadas a través de ese proceso de Rebase y pierde todas las demás. Sin MFA: el enrolamiento responde 501, y las comprobaciones responden "sin factor", por lo que el inicio de sesión nunca solicita uno. La agregación de administración no puede apuntar a una colección — lee el nombre de una etapa `$from` que MongoDB no tiene —, por lo que no devuelve nada |
| `@rebasepro/firebase` | Experimental | Ejecuta el panel de administración y el SDK contra Firestore. Sin RLS, sin superficie SQL; el conjunto de características de Postgres no se traslada. El controlador de Firestore ignora los grupos de filtros `or(...)`/`and(...)`, por lo que una consulta que use uno de ellos lee todas las filas que permitan sus filtros simples |
| Rebase Cloud | **Private beta** | Activo, ejecutando tenants reales, abierto por lotes. No es de autoservicio |

Dos entradas anteriores son el coste honesto de publicar esta tabla: la
reconsulta en tiempo real y la accesibilidad de la tabla de datos son defectos
abiertos, no elementos de la hoja de ruta, y ambos se enumeran en lugar de
dejarse para que el lector los descubra.

Esta tabla es lo que existe. Lo que aún no existe está en la
[hoja de ruta](https://rebase.pro/roadmap), una entrada por issue de GitHub, con el
subconjunto requerido para la versión 1.0 marcado.

## La promesa de 0.x

Rebase está en `0.x`. Esta sección está redactada para ser válida en cada versión 0.x
en lugar de para una sola, de modo que no quede desactualizada con cada entrega.
**Los cambios que rompen la compatibilidad en la API de TypeScript creada por el
usuario siguen estando permitidos en una versión menor**, y el changelog es
donde se anuncian. Lo que *no* está permitido que se rompa en silencio es el
conjunto de contratos versionados a continuación: cada uno está grabado en un
artefacto o en una base de datos, cada uno se verifica en el arranque o en la
recepción, y cada uno falla **de forma ruidosa y específica** en lugar de
degradarse.

Esa distinción es toda la promesa. Una exportación renombrada le cuesta un error
de compilación y cinco minutos. Un bundle que arranca contra el runtime
incorrecto y sirve datos sutilmente erróneos le cuesta un incidente, y los
contratos existen para que la segunda categoría no pueda ocurrir en silencio.

Rebase Cloud consume exactamente estos contratos y nada más. Cualquier cosa que
no figure aquí es un detalle de implementación del que la plataforma no depende.

### Insignias de versión y versiones canary

La documentación se publica desde `main`, por lo que una página puede describir
algo que ninguna versión estable tiene todavía. Una insignia *Since* (Desde)
indica la primera versión estable que lo incluye, y el texto junto a ella explica
lo que hace la versión anterior.

Una versión canary es una compilación de `main` numerada según la versión hacia la
que se dirige: `0.25.0-canary.g<commit>` es `main` en ese commit, después de 0.24.0
y antes de 0.25.0, y `rebase upgrade --to canary` instala la más reciente. Incluye
todo lo que había llegado a `main` cuando se compiló, por lo que una insignia que
mencione su versión (Since 0.25) se aplica a usted, y la nota sobre la versión
anterior (on 0.24) describe la versión estable de la que proviene. Las canaries
anteriores a 0.25.0 se numeraban siguiendo la última versión:
`0.24.1-canary.g<commit>` también es una vista previa de 0.25.

## Los contratos versionados

Los valores a continuación se leen del código fuente; considere las referencias a
archivos como la verdad y esta tabla como el mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado en | Verificado en | Dirección de compatibilidad |
|---|---|---|---|---|
| 1 | rango de `rebase` en `rebase.json` | el proyecto del usuario | CLI en la compilación | el proyecto declara qué runtimes acepta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **hacia atrás (retrocompatible)** — el nuevo runtime lee bundles antiguos |
| 3 | `RUNTIME_CONTRACT_VERSION` | el mismo archivo | el mismo archivo | **coincidencia exacta, en ambas direcciones** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | en el arranque, contra `rebase.schema_meta` | **solo hacia adelante** — el nuevo runtime migra bases de datos antiguas |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado por el SDK como `x-rebase-schema` cuando está configurado | informativa — identifica contra qué esquema se compiló un cliente |
| 6 | Identificadores de base de datos derivados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — un nombre emitido por una versión nunca se vuelve a derivar |

### 1 — `rebase` en `rebase.json`

Un rango de semver, leído como `engines` en un `package.json`: qué versiones de
runtime acepta este proyecto. Nombrado deliberadamente `rebase` en lugar de
`runtime`, porque `runtime` ya significa *quién es el propietario del proceso*
(`managed` | `custom`) en una app.

### 2 — `BUNDLE_FORMAT_VERSION` (actualmente 2)

La disposición en disco de un bundle compilado. Un runtime acepta cualquier
bundle cuyo formato sea **menor o igual que** el suyo, lo que permite que el
nivel administrado traslade un tenant a una nueva imagen sin que nadie tenga que
recompilar su proyecto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un único directorio,
  `entry.admin` para un panel de administración integrado.
- **2** — `kind: "backend" | "static"`, `entry.static` una lista, `entry.admin`
  eliminado. El formato 1 todavía se lee, a través de `upgradeLegacyManifest`.

**Increméntelo cuando** la disposición cambie de tal manera que un runtime más
antiguo interpretaría erróneamente un bundle más nuevo. El incremento es lo que
convierte un "arranca y no sirve nada" en una negativa a iniciar.

### 3 — `RUNTIME_CONTRACT_VERSION` (actualmente 1)

La versión mayor del contrato bundle↔runtime. Distinta de la versión del paquete
`@rebasepro/server`, que puede lanzar cualquier número de versiones menores y
parches mientras esta permanece fija.

**Lea esto antes de tocarlo.** La comprobación es `!==`, no `>`:

> un bundle dirigido al contrato *N* se ejecuta **únicamente** en un runtime que implemente *N*

por lo que incrementarlo invalida **todos los bundles jamás construidos**, todos a
la vez, hasta que cada uno sea recompilado. Esa es la severidad prevista — es la
palanca de "nada antiguo puede ejecutarse aquí" —, pero significa que un
incremento es una migración a escala de toda la flota, no una simple nota de
lanzamiento. Para el nivel administrado, debe secuenciarse con la recompilación del
bundle de cada tenant.

Si un cambio es *aditivo* y los bundles antiguos seguirían siendo correctos,
requiere `BUNDLE_FORMAT_VERSION` (o nada en absoluto), no esto.

### 4 — `AUTH_SCHEMA_VERSION` (actualmente 2)

Grabado en `rebase.schema_meta` y comparado en el arranque. Un runtime **se
niega a iniciar** contra una base de datos migrada por una versión más nueva del
framework, en lugar de operar sobre una estructura que no comprende; durante un
despliegue gradual (rolling deploy), esa es la diferencia entre que la mitad de
la flota dé errores y que la mitad de la flota corrompa datos.

La migración hacia adelante es automática: `ensureAuthTablesExist` actualiza una
base de datos más antigua. Tenga en cuenta que este bloque de migración está
envuelto deliberadamente en un `try/catch` y registra logs en lugar de lanzar una
excepción —un arranque renqueante es mejor que un bucle de reinicios (crash loop)—,
por lo que **"ha arrancado" no demuestra nada**. Cada aserción en la suite de
actualización lee el catálogo o los datos en su lugar.

**Increméntelo cuando** una migración no deba ser omitida por un runtime más
antiguo. No lo incremente para una columna aditiva y retrocompatible; hay un
ejemplo práctico de ese criterio en
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash de las definiciones de colecciones compiladas, emitido en el manifiesto
del bundle y devuelto por un SDK generado en el encabezado `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Existe para que la plataforma pueda indicar "esta app
se compiló contra un esquema más antiguo" en lugar de fallar misteriosamente en
la primera solicitud.

`rebase generate-sdk` escribe el valor en `schema.meta.ts`; páselo al cliente
para enviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

El backend lee ese encabezado en cada solicitud de datos. La divergencia (drift)
nunca rechaza una llamada —un SDK con un esquema por detrás suele ser compatible
aún, y desplegar el backend antes que el frontend es el orden normal de
despliegue—, pero cuando una solicitud falla con un 400 o un 404, el error
incluye la divergencia como su causa:

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

De este modo, una columna renombrada se interpreta como "su SDK está obsoleto,
regenérelo" en lugar de un campo que sus propios tipos insisten que existe. A una
solicitud que tiene éxito nunca se le informa esto.

Cubre **únicamente colecciones**. La edición de un hook o una función no cambia
el contrato del cliente y no debe invalidar todos los SDK generados.

### Quién está llamando

Dos señales de identificación más, ninguna de las cuales condiciona nada por sí
sola:

- **`GET /api/meta/schema-version`** no requiere autenticación y responde con el
  `schemaVersion` del proyecto *y* su `runtime` (`version` y `contract`). Un
  trabajo de CI que compare su SDK generado contra un proyecto activo no
  necesita credenciales, ni tampoco un cliente que pregunte con qué runtime se
  está comunicando.
- **`User-Agent: rebase-cli/<version>`** se incluye en cada solicitud a
  `rebase cloud`. El formato de transmisión del plano de control va por delante
  de lo que se publica en npm, por lo que necesita poder responder a un cliente
  antiguo con `CLI_TOO_OLD` y la versión mínima, lo cual solo puede hacer para un
  emisor que declare quién es.

### 6 — Identificadores de base de datos derivados

Cada nombre que este framework deduce por sí mismo en lugar de recibirlo
explícitamente: una columna de clave foránea, una restricción de clave foránea,
una tabla de unión (junction table) y sus dos columnas de clave, un tipo enum,
el nombre de una política o la columna en `snake_case` de una propiedad en
`camelCase`.

> **Un identificador derivado queda congelado en el momento en que una versión lo emite.**

No "congelado hasta la próxima versión mayor": congelado. El razonamiento es
diferente al de los otros cinco contratos, y más estricto. Aquellos están
versionados, por lo que una discrepancia puede ser *detectada* y rechazada. Este
no puede: el nombre se escribe en la base de datos de un cliente el día en que se
despliega, y no hay ninguna marca de versión en una columna. Cada base de datos
aprovisionada por cada versión jamás lanzada lleva lo que haya derivado, y ningún
código en este repositorio puede intervenir y renombrarlas todas.

La versión 0.13 es el ejemplo práctico. `generateForeignKeyName` aprendió a
singularizar correctamente (`categorie_id` → `category_id`, `addres_id` →
`address_id`), lo cual es inequívocamente una mejor derivación, y rompió todas
las bases de datos antiguas que tenían un plural irregular. Boot-ensure migró la
columna, por lo que los datos sobrevivieron; el archivo `schema.generated.ts`
guardado en el control de versiones del proyecto no lo hizo, y el arranque falló
ante una columna que ya existía. Tres commits, una nueva prueba de integración y
una entrada permanente en las notas de actualización, a cambio de un nombre de
columna más estético por el que nadie había preguntado.

**Si una derivación es genuinamente errónea**, cambia para las colecciones
creadas *posteriormente*, respaldada por una estrategia de nomenclatura
registrada en el proyecto; nunca retroactivamente y nunca como efecto secundario
de mejorar la función subyacente.

**La única anulación legítima** es un cambio que hace coincidir el código con un
nombre que la base de datos *ya tiene*. El ejemplo práctico es el truncamiento de
identificadores: Postgres recorta silenciosamente un identificador a 63 bytes,
por lo que un nombre de restricción derivado más largo nunca fue el nombre en el
catálogo: la derivación describía un objeto que no existía bajo esa grafía, y
boot-ensure volvía a emitir `ADD CONSTRAINT` en cada arranque porque su
comparación nunca podía coincidir. Truncar en la construcción cambia lo que este
repositorio *deriva* y no cambia nada de lo que cualquier base de datos
desplegada *contiene*. Esa es la prueba que se debe aplicar: no "si el nuevo
nombre es mejor", sino "si alguna base de datos existente tiene que cambiar".

El otro caso en el que un nombre puede cambiar es un conjunto de nombres que
nunca podrían coexistir. Una regla que abarcaba varias operaciones en una tabla
de 42 bytes o más derivaba `<table>_default_admin_write_insert`, `_update` y
`_delete`, y las tres se recortaban a los mismos 63 bytes. Postgres almacenaba
una sola política, DELETE, y rechazaba todos los INSERT y UPDATE de
administración. Solo cuando los nombres de una regla colisionan de esta manera se
derivan priorizando el sufijo, como `<head>_<hash8>_<op>`. Cada nombre que
funciona hoy mantiene su grafía. El siguiente arranque o push elimina la única
política truncada y crea una política para cada operación.

Lo único que siempre es seguro es *reconocer* un nombre antiguo para poder
migrarlo: `legacyForeignKeyName` existe para ser detectado, nunca para ser
generado, y la línea base fija también esas detecciones. Eliminar una revierte
silenciosamente la migración de cada base de datos que todavía conserve esa
grafía.

**La barrera.** `tooling/scripts/derived-names.mts` ejecuta un caso de prueba de
estrés de nombres —plurales irregulares, terminaciones en `ss`, un acrónimo, una
unión a partir de un slug en plural, anulaciones explícitas, un slug lo
suficientemente largo como para ser truncado— a través de ambos generadores de DDL
de esquema, y genera cada identificador que cualquiera de los dos nombre:

```bash
pnpm check:derived-names
```

Una línea cambiada o eliminada falla como una ruptura de contrato, mostrando la
grafía antigua y la nueva lado a lado. Un cambio puramente aditivo también falla,
pero con "regenerate", de modo que la línea base no pueda divergir
inadvertidamente.

También fija que `rebase db push` y el boot-ensure del runtime administrado
deriven los *mismos* nombres, lo cual es un segundo contrato oculto dentro del
primero: compilan las mismas colecciones mediante código diferente, y un proyecto
que se envía una vez y se arranca después no debe terminar con dos esquemas.

## Lo que *no* está congelado

Dicho claramente, para que nadie deduzca una promesa que nunca se hizo:

- La API de TypeScript escrita por el usuario: configuración de colecciones,
  opciones de `initializeRebaseBackend`, props de admin, nombres de métodos del
  SDK. Los cambios incompatibles se introducen en versiones menores y se anuncian
  en el changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estos avanzan más rápido y tienen la menor cantidad de
  consumidores.
- Cualquier elemento bajo el directorio `src/` de un paquete que no se reexporte
  desde su archivo barrel. `packages/client/src/index.ts` incluye una nota que
  explica que su lista de exportaciones está seleccionada minuciosamente para que
  una exportación interna no pueda hacerse pública por accidente.
- El esquema de base de datos de *sus* colecciones. Eso es suyo; Rebase solo es
  propietario del esquema `rebase` (y, en una base de datos aprovisionada antes de
  0.13, del antiguo esquema `auth` hasta que el arranque lo retire).

## Las barreras que sostienen esto

Nada de lo anterior es una convención: cada elemento tiene una prueba que falla
cuando se rompe:

| Barrera | Lo que fija |
|---|---|
| `pnpm verify:corpus` | cada estructura de bundle jamás lanzada, arrancada en el runtime de hoy. Las fixtures en `tests/fixtures/bundles/` están **escritas a mano y congeladas** — una fixture que el builder regenera cambia cada vez que el builder cambia |
| `pnpm verify:selfhost` | un bundle real compilado, empaquetado, arrancado y consultado tal como lo haría un navegador |
| `upgrade-e2e.test.ts` | esquemas de bases de datos antiguos (`schema-snapshots/`) gestionados por el runtime actual |
| `tests/e2e/tests/cli-init-e2e.ts` | un proyecto inicializado instalado desde **tarballs reales**, no enlaces de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | la ruta del usuario final: registro → inicio de sesión → lecturas con ámbito de RLS → actualización de token → almacenamiento → tiempo real |
| `pnpm check:derived-names` | cada columna, restricción, tabla de unión, enum y nombre de política que el framework deriva — y que el arranque y `db push` los deriven de forma idéntica |
| `pnpm rls:check` | las políticas del esquema generado |
| `pnpm check:api-surface` | cada exportación, y sus miembros, de los cinco paquetes que proporciona la imagen — `@rebasepro/server`, `types`, `client`, `common`, `utils` — además del punto de entrada `@rebasepro/server/functions`, contra las seis secciones de `contracts/server.api.txt`. Estos son los paquetes que `infra/docker/entrypoint.mjs` enlaza simbólicamente sobre las copias propias de un bundle desplegado, por lo que eliminar una exportación de uno de ellos no es un error de compilación para nadie: es un fallo de arranque en toda la flota, durante un despliegue que nadie solicitó |
| `pnpm test:gates` | las pruebas propias de las barreras, sobre fixtures — cuarenta y siete archivos, entre ellos `check:api-surface` y la comprobación de incremento de versión a continuación —, de modo que una barrera que deje de detectar lo que protege falle aquí. `check:api-surface` pasó toda su vida sin poder detectar si un miembro desaparecía de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que el nivel de incremento bajo el cual se publica una versión coincida con lo que la versión hizo a las líneas base anteriores — ejecutado por `publish.yml` antes de estampar el changelog |
| CI de saas | el plano de control compilado contra el `main` de este repositorio, en sus propios pushes y ejecuciones nocturnas |

**Registre una fixture de bundle y una instantánea de esquema una vez por lanzamiento.**
El valor de ambos corpus reside enteramente en cuán atrás en el tiempo llega el
más antiguo, y ninguno de ellos puede completarse retrospectivamente a posteriori.

### Aún no cubierto por barreras

La tabla anterior es lo que se mantiene garantizado. Estas son las partes de la
política que aún nada garantiza, listadas para que nadie suponga una promesa en
ellas:

- **Sin ventana de obsolescencia ni soporte.** Mientras Rebase esté en `0.x`, no
  existe una regla escrita sobre cuánto tiempo sobrevive una exportación obsoleta
  antes de su eliminación, ni durante cuánto tiempo recibe correcciones una
  versión menor anterior. Las correcciones de seguridad solo se aplican a la
  versión menor más reciente.
- **El formato de transmisión HTTP no tiene barrera.** Ningún script `check:*`
  compara las estructuras de solicitud y respuesta contra una línea base como lo
  hace `check:api-surface` con las exportaciones; un cambio en la estructura de
  respuesta solo es detectado por una suite e2e que casualmente la lea.
- **Los flags de la CLI no tienen una línea base de compatibilidad.** El
  verificador de documentación falla cuando desaparece un flag utilizado por las
  skills, los ejemplos o el sitio web; nada detecta si cualquier otro flag
  desaparece o si cambia de significado.
- **Un lanzamiento en CI no registra ningún corpus.** El flujo de trabajo de
  publicación no registra ninguna fixture de bundle ni instantánea de esquema;
  solo el script de lanzamiento local lo intenta, y advierte en lugar de
  detenerse cuando no puede. De la versión 0.18 a la 0.21 no tienen ninguna
  instantánea de proyecto registrada.
- **La superficie de exportación es una barrera, no un contrato.** Si las
  exportaciones públicas de los paquetes proporcionados por el runtime se
  convertirán en un séptimo contrato numerado —declarado como la línea base de
  `check:api-surface`, compatible de forma aditiva dentro de una versión mayor del
  contrato— es una decisión abierta.

## Cambiar un contrato

1. Decida cuál de los seis es. La mayoría de los cambios no son ninguno de ellos,
   pero "ninguno de los seis" no significa "incontroversial". Eliminar o
   renombrar una exportación de `@rebasepro/server`, o un miembro de ella, no
   pertenece a ninguno de los seis y es el cambio más peligroso en el
   repositorio, porque el código que rompe ya está compilado y no se recompilará.
   `pnpm check:api-surface` es lo que defiende esa línea; si se convierte en un
   séptimo contrato numerado es una decisión abierta (consulte *Aún no cubierto
   por barreras*, más arriba).
2. Añada primero una fixture o instantánea para la estructura **antigua** y
   verifique que pase la prueba.
3. Realice el cambio e incremente la constante.
4. Confirme que la fixture antigua sigue pasando la prueba, o que ahora falla
   *con el mensaje que un usuario necesitaría*. Ambos son resultados válidos; el
   silencio no lo es.
5. Para el contrato 3, planifique la recompilación de cada bundle desplegado
   antes de fusionar (merge).
6. El contrato 6 es la excepción a los pasos 3 y 4: no hay ninguna constante que
   incrementar ni ninguna versión en la que rechazar, porque una columna no lleva
   una marca de versión. El paso que los reemplaza es decidir no hacer el cambio;
   consulte la sección anterior para ver cómo es la alternativa.

## Relacionado

- [Actualización](/docs/upgrading/) — lo que realmente cambió de forma incompatible, versión por versión
- [Registro de cambios](/docs/changelog/) — cada cambio, incluidos los que no rompieron nada
- [Runtime y Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — el formato de bundle contra el que ya está compilado un proyecto desplegado
