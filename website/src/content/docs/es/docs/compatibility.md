---
sourceHash: fb9fac4af8dcfaaf
slug: es/docs/compatibility
title: Compatibilidad
description: Lo que Rebase promete entre versiones y lo que no — los seis contratos versionados, cómo falla cada uno y qué puede seguir cambiando en una versión menor.
---

Lo que Rebase promete entre versiones, y lo que no.

Este es el documento que debe leer antes de cambiar cualquier cosa de la que ya
dependa un proyecto desplegado o un tenant en ejecución de Rebase Cloud. También
es la respuesta honesta a «si construyo sobre Rebase hoy, ¿qué se romperá más
adelante?»

## Qué significa «beta» aquí

Rebase está en beta pública. La mayoría de los proyectos usan esa palabra para
significar «cualquier cosa puede romperse», lo cual no le dice al lector nada
sobre lo que pueda planificar, así que esta es la línea que este proyecto
realmente traza:

> **La API sobre la que escribe puede cambiar en una versión menor, con una
> entrada en el registro de cambios (changelog). Sus datos no pueden romperse
> silenciosamente.**

La primera mitad es el comportamiento ordinario de `0.x` y se describe a
continuación. La segunda mitad es la parte que vale la pena comprobar, porque es
una afirmación sobre mecanismos más que sobre intenciones: los contratos
versionados de la siguiente sección están sellados cada uno en un artefacto o
base de datos, cada uno se comprueba al arrancar o en la admisión, y cada uno
**falla de forma ruidosa y específica** en lugar de degradarse. Una inserción de
esquema (schema push) que eliminaría una columna es rechazada por una barrera
destructiva (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), y la
ruta de actualización en sí es una prueba: `upgrade-e2e.test.ts` restaura bases
de datos tal como las dejaron versiones anteriores, ejecuta la ruta de migración
actual sobre cada una y afirma que las filas sobreviven — no simplemente que el
arranque lo hizo.

Lo que sí significa beta: todavía faltan características, algunos subsistemas
son más nuevos que otros, y la forma de un punto áspero es que algo está ausente
o es incómodo, no que corrompa algo en silencio. Cuáles subsistemas son cuáles
se publica y fecha en lugar de dejarse al descubrimiento — la siguiente tabla es
esa publicación.

## Preparación por subsistema

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Última revisión: 14 de septiembre de 2026, frente a 0.21.0.** Vuelva a leerlo
en cada versión menor; una calificación que no se haya movido en tres versiones
está consolidada o se ha olvidado, y esta nota está aquí para que se verifique
la diferencia.

Las tres calificaciones significan:

- **Estable** — la forma está consolidada y cubierta por una barrera en CI.
  Todavía puede incorporar funcionalidades; no se rediseñará de imprevisto
  dentro de 0.x, y cualquier cambio que cause una incompatibilidad se anunciará
  en el registro de cambios.
- **Beta** — funciona y se utiliza en producción, y se sabe que algo en ella es
  tosco: un límite que puede alcanzar, un caso límite incómodo, una decisión de
  diseño aún no tomada. La parte tosca se menciona en las notas, porque «beta»
  por sí solo no le dice nada sobre lo que pueda planificar.
- **Experimental** — publicado para que pueda usarse y reportarse. Espere
  encontrarse con las partes que nadie ha tocado aún.

| Subsistema | Calificación | En qué se basa la calificación |
|---|---|---|
| REST API + SDK generado | Estable | El contrato de transmisión (wire contract) está versionado y protegido por barreras; `client-sdk-e2e` ejecuta registro → inicio de sesión → lecturas con ámbito RLS → actualización → almacenamiento → tiempo real de extremo a extremo |
| Auth — email/contraseña, OAuth, OIDC, magic link, código de un solo uso | Estable | Se incluyen doce proveedores de OAuth. El esquema de autenticación es un contrato versionado, sellado y verificado en el arranque |
| Auth — MFA (TOTP) | Beta | El registro, la verificación y la recuperación funcionan y están probados. La rotación de claves está implementada para la clave de cifrado; no hay superficie de administración para restablecer el factor de un usuario bloqueado |
| Seguridad a nivel de fila (RLS) | Estable | La pieza angular del producto. `pnpm rls:check` audita una base de datos activa contra quince comprobaciones, y la suite e2e de RLS se ejecuta en cada push |
| Storage | Estable | Local, S3 y GCS. Denegación por defecto (default-deny) en producción desde 0.17.0, y el andamiaje (scaffold) incluye un hook de autorización |
| Realtime | **Beta** | Las suscripciones solo coinciden por la ruta de la tabla, por lo que N suscriptores en una tabla cuestan N reconsultas (refetches) con ámbito RLS por cada escritura. Eso limita un despliegue a unos cientos bajos de suscriptores concurrentes. Correcto a cualquier escala; costoso a partir de esa |
| Búsqueda vectorial (pgvector) | Beta | Cada columna vectorial obtiene por defecto un índice HNSW para distancia coseno, configurable por columna mediante `col.vector({ dimensions, index })` (método, distancias, parámetros de compilación) o desactivado, lo que deja un escaneo exacto. pgvector no puede indexar una columna de más de 2000 dimensiones, por lo que esas se dejan sin indexar y se escanean |
| Sincronización offline | Beta | Las mutaciones llevan claves de idempotencia que el servidor respeta, y se han corregido los defectos de pérdida de datos detectados en la auditoría de julio. El modelo de conflictos es «última escritura gana» (last-write-wins) sin combinación campo por campo |
| Historial de entidades | Estable | Basado en instantáneas (snapshots), protegido por su propia suite |
| Funciones y crons | Estable | El punto de entrada portable (`@rebasepro/server/functions`) es un contrato versionado con su propia sección de superficie de API |
| Servidor MCP + agent skills | Beta | `@rebasepro/mcp` se ejecuta sobre stdio: cincuenta y tres herramientas, autenticación bearer por proyecto, las herramientas destructivas rechazan destinos no locales a menos que se habilite explícitamente. Desde 0.21, el servidor también puede montar un endpoint remoto `/mcp` — OAuth 2.1, diecisiete herramientas de datos (las cuatro para aplicaciones guardadas son experimentales), cada llamada bajo el propio RLS de la persona que inició sesión — desactivado a menos que `REBASE_MCP_ENABLED=true`, y solo en Postgres |
| Studio (SQL, esquema, RLS, explorador de API) | Beta | Utilizado a diario en proyectos reales. La ramificación (branching) está presente en el paquete OSS y deliberadamente no está expuesta en Rebase Cloud, porque mover un despliegue en ejecución a una rama aún no tiene soporte |
| CMS + panel de administración | Beta | Completo para CRUD, relaciones, campos de almacenamiento y roles. **La tabla de datos no tiene semántica de cuadrícula (grid)** — sin `role`, sin `aria-rowindex`, `tabIndex` eliminado — por lo que los usuarios de teclado y lectores de pantalla no pueden operar la vista principal. Sin borradores, sin contenido por configuración regional (locale), sin texto enriquecido en bloques |
| Base de datos de desarrollo administrada PGlite | Beta | `rebase dev` sin configuración y sin Docker. Una sesión a la vez, por lo que las solicitudes se serializan y la concurrencia no se puede reproducir contra ella; los comandos respaldados por Atlas (`db push`, `generate`, `migrate`) planifican contra un segundo PGlite desechable iniciado para el comando; `db branch` no funciona allí y así lo indica |
| Helm chart | Beta | Representa la topología de procesos divididos y se publica en el registro OCI en cada versión. El valor predeterminado sigue siendo un único contenedor |
| `@rebasepro/firebase` | Experimental | Firestore como una fuente que el panel de administración lee directamente, junto a las tablas del backend: `defineFirestoreCollection` en `frontend/src/cms`, pasado como `externalCollections`. Sin RLS, sin superficie SQL; el conjunto de características de Postgres no se traslada. El controlador de Firestore ignora los grupos de filtros `or(...)`/`and(...)`, por lo que una consulta que use uno lee cada fila que sus filtros simples permitan |
| Rebase Cloud | **Beta privada** | En vivo, ejecutando tenants reales, abierto en lotes. No es de autoservicio |

Dos entradas anteriores son el costo honesto de publicar esta tabla: la
reconsulta de tiempo real y la accesibilidad de la tabla de datos son defectos
abiertos, no elementos de la hoja de ruta (roadmap), y ambos se enumeran en
lugar de dejarse para que el lector los descubra.

Esta tabla es lo que existe. Lo que aún no existe está en la
[hoja de ruta](https://rebase.pro/roadmap), una entrada por cada issue de GitHub,
con el subconjunto requerido para 1.0 marcado.

## La promesa de 0.x

Rebase está en `0.x`. Esta sección está redactada para ser válida en cada versión
0.x en lugar de para una sola, de modo que no quede desactualizada con cada
entrega. **Los cambios incompatibles (breaking changes) en la API de TypeScript
creada por el autor aún están permitidos en una versión menor**, y el registro
de cambios es donde se anuncian. Lo que *no* está permitido que se rompa
silenciosamente es el conjunto de contratos versionados a continuación: cada uno
está sellado en un artefacto o base de datos, cada uno se comprueba al arrancar
o en la admisión, y cada uno falla **de forma ruidosa y específica** en lugar de
degradarse.

Esa distinción es toda la promesa. Una exportación renombrada le cuesta un error
de compilación y cinco minutos. Un bundle que arranca contra el runtime
incorrecto y sirve datos sutilmente erróneos le cuesta un incidente, y los
contratos existen para que la segunda categoría no ocurra en silencio.

Rebase Cloud consume exactamente estos contratos y nada más. Todo lo que no esté
en esta lista es un detalle de implementación del que la plataforma no depende.

### Distintivos de versión y canaries

La documentación se publica desde `main`, por lo que una página puede describir
algo que ninguna versión estable tiene todavía. Un distintivo *Since* nombra la
primera versión estable que lo incluye, y el texto junto a él dice lo que hace
la versión anterior.

Un canary es una compilación de `main` numerada como la versión a la que se
dirige: `0.25.0-canary.g<commit>` es `main` en ese commit, después de 0.24.0 y
antes de 0.25.0, y `rebase upgrade --to canary` instala la más reciente. Incluye
todo lo que había llegado a `main` cuando se compiló, por lo que un distintivo
que mencione su versión se aplica a usted, y la nota sobre la versión anterior
describe la versión estable de la que provino.

## Los contratos versionados

Los valores a continuación se leen desde el código fuente; trate las
referencias de archivos como la verdad y esta tabla como el mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado en | Comprobado en | Dirección de compatibilidad |
|---|---|---|---|---|
| 1 | Rango de `rebase` en `rebase.json` | el proyecto del usuario | CLI en la compilación | el proyecto declara qué runtimes acepta |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatible hacia atrás** donde la estructura lo permita — el formato 3 rechaza los formatos 1 y 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | mismo archivo | mismo archivo | **coincidencia exacta, en ambas direcciones** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | en el arranque, contra `rebase.schema_meta` | **solo hacia adelante** — un runtime nuevo migra bases de datos antiguas |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado por el SDK como `x-rebase-schema` cuando está configurado | informativo — identifica contra qué esquema se compiló un cliente |
| 6 | Identificadores de base de datos derivados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — un nombre emitido por una versión nunca se vuelve a derivar |

### 1 — `rebase` en `rebase.json`

Un rango semver, leído como `engines` en un `package.json`: qué versiones de
runtime acepta este proyecto. Se llama deliberadamente `rebase` en lugar de
`runtime`, porque `runtime` ya significa *quién es el propietario del proceso*
(`managed` | `custom`) en una aplicación.

### 2 — `BUNDLE_FORMAT_VERSION` (actualmente 3)

<span class="since-badge" data-since="0.31">Since 0.31</span>

La disposición en disco de un bundle compilado. Un runtime rechaza un bundle
cuyo formato sea más nuevo que el suyo y lee uno más antiguo donde la estructura
lo permita, que es lo que le permite al nivel administrado migrar un tenant a
una nueva imagen sin que nadie tenga que recompilar su proyecto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un único directorio,
  `entry.admin` para un panel de administración empaquetado.
- **2** — `kind: "backend" | "static"`, `entry.static` una lista, `entry.admin`
  eliminado.
- **3** (0.31) — el esquema es `entry.tables`, el `backend/schema` compilado,
  junto a `entry.resources`, `entry.storage` y `entry.hooks`; `entry.config`,
  `entry.collections` y `entry.usersCollection` han desaparecido. **Los formatos 1
  y 2 son rechazados, no actualizados**: contienen `config/collections`, con lo
  cual un runtime que lee `backend/schema` no tiene nada con qué leerlo, y arrancar
  uno introspeccionaría la base de datos y serviría una API diferente. El rechazo
  menciona `rebase migrate collections-to-tables`; migre el código fuente y vuelva
  a compilar. Esta fue la única ruptura de compatibilidad hacia atrás, tomada
  junto con el incremento del contrato de runtime a continuación.

**Increméntelo cuando** la estructura cambie de tal manera que un runtime más
antiguo interpretaría incorrectamente un bundle más nuevo. El incremento es lo
que convierte un «arranca y no sirve nada» en una negativa a iniciar.

### 3 — `RUNTIME_CONTRACT_VERSION` (actualmente 2)

La versión principal (major) del contrato bundle↔runtime. Es distinta de la
versión del paquete `@rebasepro/server`, que puede lanzar cualquier cantidad de
versiones menores y parches mientras esta permanece fija.

**Lea esto antes de tocarlo.** La comprobación es `!==`, no `>`:

> un bundle dirigido al contrato *N* se ejecuta **únicamente** en un runtime que implementa *N*

por lo que incrementarlo invalida **todos los bundles compilados alguna vez**,
todos a la vez, hasta que cada uno se vuelva a compilar. Esa es la severidad
prevista — es la palanca de «nada antiguo puede ejecutarse aquí» —, pero
significa que un incremento es una migración en toda la flota, no una nota de
lanzamiento. Para el nivel administrado debe secuenciarse con la recompilación
del bundle de cada tenant.

Si un cambio es *aditivo* y los bundles antiguos seguirían siendo correctos,
corresponde `BUNDLE_FORMAT_VERSION` (o nada en absoluto), no esto. La versión
0.31 lo incrementó a 2, con el formato de bundle 3: el modelo de esquema cambió,
y el bundle de cada tenant se recompila a partir del código fuente migrado.

### 4 — `AUTH_SCHEMA_VERSION` (actualmente 2)

Sellado en `rebase.schema_meta` y comparado en el arranque. Un runtime **se
niega a iniciar** contra una base de datos migrada por una versión más nueva del
framework, en lugar de operar sobre una estructura que no comprende — durante un
despliegue progresivo (rolling deploy), esa es la diferencia entre que la mitad
de la flota dé errores y que la mitad de la flota corrompa datos.

La migración hacia adelante es automática: `ensureAuthTablesExist` actualiza una
base de datos antigua. Tenga en cuenta que este bloque de migración está envuelto
deliberadamente en `try/catch` y registra mensajes en lugar de lanzar
excepciones — un arranque renqueante es preferible a un bucle de caídas (crash
loop) — por lo que **«arrancó» no demuestra nada**. En su lugar, cada aserción
en la suite de actualización lee el catálogo o los datos.

**Increméntelo cuando** un runtime más antiguo no deba omitir una migración. No
lo incremente para una columna aditiva y compatible hacia atrás; hay un ejemplo
práctico de ese criterio en `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash de los descriptores de tabla compilados (`v2:…` desde 0.31), emitido en el
manifiesto del bundle y devuelto por un SDK generado en el encabezado
`x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Existe para que la plataforma pueda
indicar «esta aplicación se compiló contra un esquema más antiguo» en lugar de
fallar misteriosamente en la primera solicitud.

`rebase generate-sdk` escribe el valor en `schema.meta.ts`; páselo al cliente
para enviarlo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

El backend lee ese encabezado en cada solicitud de datos. La desviación (drift)
nunca rechaza una llamada — un SDK con una versión de esquema por detrás suele
ser compatible, y desplegar el backend antes del frontend es el orden de
despliegue normal —, pero cuando una solicitud falla con un 400 o un 404, el
error incluye la desviación como su causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on table \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v2:0e1c…",
      "serverSchema": "v2:9ab4…",
      "message": "This client was generated against schema v2:0e1c…; this backend serves v2:9ab4…"
    }
  }
}
```

Así, una columna renombrada se interpreta como «su SDK está desactualizado,
regenérelo» en lugar de un campo que sus propios tipos insisten en que existe. A
una solicitud que tiene éxito nunca se le notifica.

Cubre **únicamente las tablas**: sus descriptores compilados, en los cuales un
hook es un flag de presencia. El código de un hook o la edición de una función no
cambia el contrato del cliente y no debe invalidar todos los SDK generados.
Debido a que 0.31 trasladó el hash de las colecciones a los descriptores, cada
base de datos sellada con `v1:` reporta el cambio una vez, con el nuevo sellado
(arrancar el propietario del esquema, o `rebase db push`), y cada SDK generado
se interpreta como desactualizado una vez.

### Quién está llamando

Dos señales de identificación más, ninguna de las cuales bloquea nada por sí sola:

- **`GET /api/meta/schema-version`** no requiere autenticación y responde con la
  `schemaVersion` del proyecto *y* su `runtime` (`version` y `contract`). Un
  trabajo de CI que compare su SDK generado contra un proyecto activo no
  necesita credenciales, y tampoco las necesita un cliente que pregunte con qué
  runtime se está comunicando.
- **`User-Agent: rebase-cli/<version>`** va en cada solicitud de `rebase cloud`.
  El formato de transmisión del plano de control va por delante de lo publicado
  en npm, por lo que necesita poder responder a un cliente antiguo con
  `CLI_TOO_OLD` y la versión mínima — lo cual solo puede hacer para un emisor
  que diga quién es.

### 6 — Identificadores de base de datos derivados

<span class="since-badge" data-since="0.31">Since 0.31</span>

Cada nombre que este framework calcula por sí mismo en lugar de recibirlo
explícitamente: una columna de clave foránea, una restricción de clave foránea,
una tabla de unión (junction table) y sus dos columnas de clave, un tipo enum, un
nombre de política, la columna `snake_case` de una clave de columna en
`camelCase`. Desde 0.31, las tablas se declaran con `defineTable`, lo que deriva
exactamente los mismos nombres que una colección derivaba para un esquema
equivalente; `rebase migrate collections-to-tables` lo demuestra por proyecto
comparando el SQL generado byte por byte.

> **Un identificador derivado queda congelado en el momento en que una versión lo
> emite.**

No «congelado hasta la próxima versión mayor»: congelado. El razonamiento es
diferente al de los otros cinco contratos, y más estricto. Aquellos están
versionados, por lo que una discrepancia puede ser *detectada* y rechazada. Este
no: el nombre se escribe en la base de datos de un cliente el día en que se
despliega, y no hay sello de versión en una columna. Cada base de datos
aprovisionada por cada versión lanzada contiene lo que haya derivado, y ningún
código en este repositorio puede acceder a renombrarlas todas.

La versión 0.13 es el ejemplo práctico. `generateForeignKeyName` aprendió a
singularizar correctamente — `categorie_id` → `category_id`, `addres_id` →
`address_id` —, lo cual es inequívocamente una mejor derivación, y rompió todas
las bases de datos antiguas que tenían un plural irregular. Boot-ensure migró la
columna, por lo que los datos sobrevivieron; el archivo `schema.generated.ts`
bajo control de versiones del proyecto no lo hizo, y el arranque falló ante una
columna que existía. Tres commits, una nueva prueba de costura (seam test) y una
entrada permanente en las notas de actualización, a cambio de un nombre de
columna con mejor apariencia por el que nadie había preguntado.

**Si una derivación es genuinamente errónea**, cambia para las tablas creadas
*posteriormente*, bajo una estrategia de nomenclatura registrada en el proyecto —
nunca de forma retroactiva ni como efecto secundario de mejorar la función
subyacente.

**La única anulación legítima** es un cambio que hace coincidir el código con un
nombre que la base de datos *ya tiene*. El ejemplo práctico es el truncamiento de
identificadores: Postgres recorta silenciosamente un identificador a 63 bytes,
por lo que un nombre de restricción derivado más largo nunca fue el nombre en el
catálogo — la derivación describía un objeto que no existía bajo esa grafía, y
boot-ensure volvía a emitir `ADD CONSTRAINT` en cada arranque porque su
comparación nunca coincidía. Truncar en la construcción cambia lo que este
repositorio *deriva* y no cambia nada de lo que cualquier base de datos
desplegada *contiene*. Esa es la prueba que debe aplicarse: no «¿es mejor el
nuevo nombre?», sino «¿tiene que cambiar alguna base de datos existente?».

El otro caso donde un nombre puede cambiar es un conjunto de nombres que nunca
podrían coexistir. Una regla que abarcaba varias operaciones en una tabla de 42
bytes o más derivaba `<table>_default_admin_write_insert`, `_update` y `_delete`,
y las tres se recortaban a los mismos 63 bytes. Postgres almacenaba una sola
política, DELETE, y rechazaba cualquier INSERT y UPDATE de administrador. Solo
cuando los nombres de una regla colisionan de esta forma se derivan con el sufijo
primero, como `<head>_<hash8>_<op>`. Cada nombre que funciona hoy conserva su
grafía. El siguiente arranque o push elimina la única política truncada y crea
una política para cada operación.

Lo único que siempre es seguro es *reconocer* un nombre antiguo para migrarlo:
`legacyForeignKeyName` existe para ser detectado, nunca para ser generado, y la
línea base también fija esas detecciones. Eliminar una revierte silenciosamente
la migración de cada base de datos que aún conserve esa grafía.

**La barrera.** `tooling/scripts/derived-names.mts` ejecuta un caso de prueba
(fixture) de esfuerzo de nomenclatura — plurales irregulares, una terminación en
`ss`, un acrónimo, una unión desde un slug en plural, anulaciones explícitas, un
slug lo suficientemente largo como para ser truncado — a través de ambos
productores de DDL de esquema, y genera cada identificador que cualquiera de los
dos nombre:

```bash
pnpm check:derived-names
```

Una línea modificada o eliminada falla como una ruptura de contrato, mostrando la
grafía antigua y la nueva lado a lado. Un cambio puramente aditivo también falla,
pero con «regenerate» — de modo que la línea base no pueda desviarse a espaldas
de nadie.

También fija que `rebase db push` y el boot-ensure del runtime administrado
deriven los *mismos* nombres, lo cual es un segundo contrato oculto dentro del
primero: compilan las mismas tablas a través de código diferente, y un proyecto
enviado una vez con push y arrancado más tarde no debe terminar con dos esquemas.

## Lo que *no* está congelado

<span class="since-badge" data-since="0.31">Since 0.31</span>

Dicho claramente, para que nadie infiera una promesa que nunca se hizo:

- La API de TypeScript del autor — `defineTable` y `customizeTable`, opciones de
  `initializeRebaseBackend`, propiedades de administración, nombres de métodos
  del SDK. La versión 0.31 reemplazó las colecciones por tablas en una versión
  menor, con un codemod que demuestra que el SQL generado no cambia. Los cambios
  incompatibles llegan en versiones menores y se anuncian en el changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estos avanzan más rápido y tienen la menor cantidad de
  consumidores.
- Cualquier elemento dentro del `src/` de un paquete que no se reexporte desde
  su archivo barrel. `packages/client/src/index.ts` incluye una nota que explica
  que su lista de exportaciones se selecciona con precisión para que una
  exportación interna no pueda volverse pública por accidente.
- El esquema de base de datos de *sus* tablas. Eso es suyo; Rebase solo es
  propietario del esquema `rebase` (y, en una base de datos aprovisionada antes
  de 0.13, el antiguo esquema `auth` hasta que el arranque lo retire).

## Las barreras que sostienen esto

Nada de lo anterior es una convención — cada elemento tiene una prueba que falla
cuando se rompe:

| Barrera | Qué fija |
|---|---|
| `pnpm verify:corpus` | cada forma de bundle lanzada alguna vez, arrancada en el runtime de hoy. Los fixtures en `tests/fixtures/bundles/` están **creados a mano y congelados** — un fixture que el constructor regenera se mueve cada vez que el constructor se mueve |
| `pnpm verify:selfhost` | un bundle real compilado, plegado, arrancado y consultado tal como lo haría un navegador |
| `upgrade-e2e.test.ts` | esquemas de bases de datos antiguos (`schema-snapshots/`) gestionados por el runtime actual |
| `tests/e2e/tests/cli-init-e2e.ts` | un proyecto generado a partir de plantilla instalado desde **tarballs reales**, no enlaces de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | la ruta del usuario final: registro → inicio de sesión → lecturas con ámbito RLS → actualización → almacenamiento → tiempo real |
| `pnpm check:derived-names` | cada nombre de columna, restricción, tabla de unión, enum y política que deriva el framework — y que el arranque y `db push` los deriven idénticamente |
| `pnpm rls:check` | las políticas del esquema generado |
| `pnpm check:api-surface` | cada exportación, y sus miembros, de los cinco paquetes que suministra la imagen — `@rebasepro/server`, `types`, `client`, `common`, `utils` — además del punto de entrada `@rebasepro/server/functions`, contra las seis secciones de `contracts/server.api.txt`. Estos son los paquetes que `infra/docker/entrypoint.mjs` enlaza simbólicamente sobre las copias propias de un bundle desplegado, por lo que eliminar una exportación de uno de ellos no es un error de compilación para nadie: es un fallo de arranque en toda la flota, durante un despliegue que nadie solicitó |
| `pnpm test:gates` | las pruebas de las propias barreras, sobre fixtures — cuarenta y siete archivos, entre ellos `check:api-surface` y la comprobación de incremento de versión a continuación — de modo que una barrera que deja de ver lo que protege falla aquí. `check:api-surface` pasó toda su vida sin poder detectar la desaparición de un miembro de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que el nivel de incremento bajo el cual se lanza una versión coincida con lo que la versión hizo a las líneas base anteriores — ejecutado por `publish.yml` antes de sellar el changelog |
| saas CI | el plano de control compilado contra el `main` de este repositorio, en sus propios pushes y ejecuciones nocturnas |

**Registre un fixture de bundle y una instantánea de esquema una vez por versión.**
El valor de ambos conjuntos (corpora) radica enteramente en qué tan atrás llega
el más antiguo, y ninguno se puede rellenar retroactivamente.

### Aún no protegido por barreras

La tabla anterior es lo que se mantiene. Estas son las partes de la política que
nada sostiene todavía, enumeradas para que nadie suponga una promesa en ellas:

- **Sin ventana de desuso (deprecation) ni de soporte.** Mientras Rebase esté en
  `0.x`, no existe una regla escrita sobre cuánto tiempo sobrevive una exportación
  obsoleta antes de su eliminación, o durante cuánto tiempo recibe correcciones
  una versión menor anterior. Las correcciones de seguridad llegan únicamente a
  la versión menor más reciente.
- **El formato de transmisión HTTP no tiene barrera.** Ningún script `check:*`
  compara las formas de solicitud y respuesta contra una línea base como
  `check:api-surface` compara las exportaciones; una forma de respuesta
  modificada solo es detectada por una suite e2e que casualmente la lea.
- **Los flags de la CLI no tienen línea base de compatibilidad.** El verificador
  de documentación falla cuando desaparece un flag utilizado por las skills, los
  ejemplos o el sitio de marketing; nada detecta la desaparición de cualquier
  otro flag o el cambio de significado de un flag.
- **Un lanzamiento de CI no registra ninguno de los dos corpus.** El flujo de
  trabajo de publicación no registra ningún fixture de bundle ni ninguna
  instantánea de esquema; solo el script de lanzamiento local lo intenta, y
  advierte en lugar de detenerse cuando no puede. De 0.18 a 0.21 no tienen ninguna
  instantánea de proyecto registrada.
- **La superficie de exportación es una barrera, no un contrato.** Que las
  exportaciones públicas de los paquetes proporcionados por el runtime se
  conviertan en un séptimo contrato numerado — declarado como la línea base de
  `check:api-surface`, compatible de forma aditiva dentro de una versión principal
  de contrato — es una decisión abierta.

## Cómo cambiar un contrato

1. Decida cuál de los seis es. La mayoría de los cambios no son ninguno de ellos —
   pero «ninguno de los seis» no significa «libre de controversia». Eliminar o
   renombrar una exportación de `@rebasepro/server`, o un miembro de una, no es
   ninguno de los seis y es el cambio individual más peligroso en el repositorio,
   porque el código que rompe ya está compilado y no se recompilará.
   `pnpm check:api-surface` es lo que sostiene esa línea; que se convierta en un
   séptimo contrato numerado es una decisión abierta (consulte *Aún no protegido
   por barreras*, más arriba).
2. Agregue primero un fixture o snapshot para la forma **antigua** y verifique
   que pase.
3. Realice el cambio e incremente la constante.
4. Confirme que el fixture antiguo aún pasa, o que ahora falla *con el mensaje
   que un usuario necesitaría*. Ambos son resultados válidos; el silencio no lo
   es.
5. Para el contrato 3, planifique la recompilación de cada bundle desplegado
   antes de fusionar (merge).
6. El contrato 6 es la excepción a los pasos 3 y 4: no hay ninguna constante que
   incrementar ni ninguna versión bajo la cual rechazar, porque una columna no
   lleva sello de versión. El paso que los reemplaza es decidir no realizar el
   cambio — consulte la sección anterior para ver cómo se presenta la
   alternativa.

## Relacionado

- [Actualización](/docs/upgrading/) — lo que realmente se rompió, versión por versión
- [Registro de cambios](/docs/changelog/) — cada cambio, incluidos los que no rompieron nada
- [Runtime y Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — el formato de bundle contra el que ya está compilado un proyecto desplegado
