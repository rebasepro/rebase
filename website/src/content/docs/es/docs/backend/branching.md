---
sourceHash: bba1fa1dd7f34bed
title: Ramificación de bases de datos
sidebar_label: Ramificación
description: Crea ramas aisladas de bases de datos para desarrollo, staging y pruebas usando CREATE DATABASE ... TEMPLATE de PostgreSQL — copias instantáneas y de fidelidad total sin tiempo de inactividad.
---

## Visión general

La ramificación de bases de datos (database branching) te permite crear **copias instantáneas y aisladas** de toda tu base de datos (tanto el esquema como los datos) para realizar de forma segura tareas de desarrollo, pruebas de migración y procedimientos de control de calidad (QA).

Aprovechando las plantillas nativas de PostgreSQL, Rebase aprovisiona bases de datos clonadas a nivel del sistema de archivos. Esto significa que obtienes una réplica de fidelidad total que contiene todas las tablas, índices, tipos personalizados, restricciones y políticas de seguridad a nivel de fila (RLS) sin sobrecarga de transferencia de red ni demoras en la configuración del esquema.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## En detalle: plantillas de PostgreSQL

Cuando se crea una rama de base de datos, el `BranchService` de Rebase ejecuta el siguiente SQL:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL procesa esta operación copiando los directorios subyacentes del sistema de archivos que contienen los archivos de la base de datos de origen. Esto proporciona:
- **Clones en menos de un segundo**: No se genera SQL ni se realiza carga de datos.
- **Esquemas y datos idénticos**: Cada fila, índice y restricción se duplica al instante.
- **Aislamiento completo**: Modificar el esquema o insertar registros en la rama no afecta en absoluto a la base de datos de origen.

### La protección contra el límite de conexiones

PostgreSQL requiere que **no existan otras conexiones activas** en la base de datos plantilla (origen) al ejecutar el comando `CREATE DATABASE ... TEMPLATE`.

Para evitar fallos, el `DatabasePoolManager` de Rebase ejecuta un proceso de expulsión activo antes de clonar o eliminar una rama:
1. **Bucle de expulsión**: Cierra y desconecta automáticamente todos los grupos de conexiones (pools) inactivos que apuntan a la base de datos de destino dentro del contexto de la aplicación Rebase.
2. **Bloqueo por conexiones externas**: Si clientes externos (como DBeaver, pgAdmin o procesos de backend externos) mantienen transacciones activas en la base de datos de origen, PostgreSQL rechazará la operación de plantilla con un error de tipo `"being accessed by other users"`.

El mensaje de error detalla con precisión qué está conectado en lugar de dejarte con la duda:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` finaliza esas sesiones antes de aplicar la plantilla, tanto en `create` como en `delete`. Nunca finaliza la sesión que ejecuta el propio comando.

`DatabasePoolManager` desconecta sus propios pools inactivos antes de clonar o eliminar, pero solo los pools **dentro del proceso que realiza la tarea**. `rebase db branch` se ejecuta como su propio proceso, por lo que no alcanza a nada más en tu máquina:

- **Un `rebase dev` en ejecución bloquea la ramificación.** Este es el caso habitual, no un caso aislado: querer crear una rama y tener la aplicación ejecutándose suelen coincidir al mismo tiempo. Detén el servidor de desarrollo, crea la rama y vuelve a iniciarlo.
- **Lo mismo ocurre con cualquier otro cliente.** DBeaver, pgAdmin, una sesión de `psql`, una segunda instancia de la aplicación: PostgreSQL rechaza la operación con `is being accessed by other users` y esas conexiones deben cerrarse manualmente.

No hay forma de evitar esto dentro de PostgreSQL; `CREATE DATABASE ... TEMPLATE` es una copia a nivel de sistema de archivos y la plantilla debe permanecer en reposo durante el proceso.

---

## Esquema de metadatos

Las configuraciones de las ramas se almacenan en la base de datos predeterminada dentro de la tabla `rebase.branches`, la cual se aprovisiona durante la inicialización:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Sanitize user branch name (alphanumeric & underscores)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

---

## API programática

La API de ramificación se expone a través del `BranchService` del backend. A continuación, se muestra una referencia de la interfaz principal:

### Crear una rama de base de datos

Genera una nueva base de datos rama a partir de la base de datos predeterminada o de una plantilla de origen explícita.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### Listar ramas activas

Obtiene una lista de las ramas registradas junto con sus tamaños físicos consultados mediante la función de sistema `pg_database_size` de PostgreSQL.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

### Obtener información de una rama

Recupera los metadatos de una sola rama. Si la rama existe, el servicio intenta consultar su uso de disco físico actual:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Eliminar una rama

Elimina la base de datos de destino del servidor y limpia su registro en la tabla de metadatos `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Protección de seguridad: La base de datos principal (el nombre de base de datos predeterminado configurado en las cadenas de conexión) está protegida. Si intentas eliminar la base de datos principal, `BranchService` lanzará un error `"Cannot delete the main database"` y anulará la operación.

---

## Integración con la CLI

Las ramas de la base de datos se pueden gestionar directamente mediante la CLI de Rebase.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` es lo que hace que una rama sea utilizable. Registra la rama en `.rebase/branch.json` —un nombre, nunca una cadena de conexión, de modo que tus credenciales permanezcan únicamente en `.env`— y cada comando `rebase` posterior en ese checkout resolverá la base de datos de la rama: `dev`, `db push`, `db migrate`, `db backup`.

Se sitúa entre el shell y el archivo del proyecto en el orden de resolución:

1. `--database-url` en la línea de comandos
2. `DATABASE_URL` en el entorno del shell
3. **la rama a la que está cambiado este checkout**
4. `DATABASE_URL` en el archivo `.env` del proyecto

Una rama debe tener mayor precedencia que `.env`; de lo contrario, cambiar de rama no tendría efecto en ningún proyecto que defina `DATABASE_URL`. No debe anular a los dos primeros, ya que una opción en la línea de comandos es una instrucción más inmediata que un cambio de rama realizado ayer.

`.rebase/` se encuentra en el archivo gitignore, por lo que la rama en la que te encuentras es un dato propio de tu máquina y nunca del proyecto.

Las ramas son bases de datos de PostgreSQL comunes nombradas con el prefijo `rb_` seguido del nombre de la rama; por lo tanto, el comando `dev_sandbox` anterior corresponde a la base de datos `rb_dev_sandbox` en el mismo servidor.

Crear una rama **no** cambia la base de datos con la que se comunica tu proyecto. `rebase db branch create` realiza la copia y se detiene ahí; nada escribe en `.env`, y la siguiente ejecución de `rebase dev` seguirá utilizando la base de datos que usaba antes. Para trabajar contra una rama, apunta tú mismo `DATABASE_URL` hacia ella: la cadena de conexión es la que ya tienes, reemplazando únicamente el nombre de la base de datos:

```bash
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## La ramificación requiere un servidor PostgreSQL real

La ramificación **no** funciona con la base de datos de desarrollo administrada: la base de datos PGlite sin configuración que `rebase dev` inicia cuando un proyecto no tiene un `DATABASE_URL`.

PGlite sirve exactamente una sola base de datos. Ejecutar `CREATE DATABASE ... TEMPLATE` sobre ella crea una entrada en el catálogo pero no copia nada, por lo que la "rama" resuelve a la misma base de datos de la que fue clonada: las escrituras que crees aisladas terminarán en tu base de datos de desarrollo y no habrá una segunda copia a la que volver.

Utiliza la ramificación contra un servidor real: tu propio PostgreSQL mediante `DATABASE_URL`, o bien `rebase dev --docker`.

---

## Buenas prácticas y limitaciones

### Uso de disco
Debido a que PostgreSQL duplica los archivos en disco, cada rama consume un espacio equivalente al de la base de datos de origen. Si tienes una base de datos de producción de 100 GB, crear 5 ramas consumirá 500 GB adicionales de almacenamiento.
* *Recomendación*: Utiliza bases de datos con subconjuntos de datos o plantillas de desarrollo ligeras como orígenes de clonación en lugar de clones completos de producción.

`rebase db branch prune` es la forma de recuperar ese espacio:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nada expira a menos que lo solicites: una rama puede contener la única copia del trabajo de una tarde entera, por lo que `--older-than` es opcional, las edades se redondean hacia abajo y el comando muestra su plan y solicita confirmación antes de eliminar nada, a menos que pases `--yes`.

El comando prune también detecta las dos formas en que las ramas pueden diferir de sus metadatos: una entrada cuya base de datos fue eliminada directamente con SQL plano (que `list` continuaría reportando indefinidamente), y una base de datos de rama cuya entrada nunca se escribió (una caída entre las dos instrucciones que ejecuta `create`). Las bases de datos temporales `<db>_dev_diff` de Atlas se notifican a la par pero solo se eliminan con `--include-dev-diff`: no son ramas, y alguna podría pertenecer a un `db push` que se esté ejecutando en este momento.

### Compatibilidad con pgBouncer
Al desplegar detrás de pgBouncer o balanceadores de conexiones, asegúrate de que el balanceador admita operaciones administrativas sobre la base de datos. La creación y eliminación de bases de datos elude los pools estándar a nivel de transacción y requiere conexiones directas al servidor Postgres (utilizando privilegios elevados de usuario) a través de la configuración `adminConnectionString`.

### Consultas entre bases de datos
Dado que las ramas son bases de datos de PostgreSQL independientes, no puedes ejecutar sentencias `JOIN` de SQL entre distintas ramas. Todas las relaciones deben estar contenidas dentro del alcance de la única base de datos de la rama activa.


## Relacionado

- [Comandos de la CLI](/docs/cli/) — `rebase db branch` y sus opciones
- [Generación de esquemas](/docs/cli/schema/) — cómo se produce el esquema que copia una rama
- [Entorno y configuración](/docs/getting-started/configuration/) — `DATABASE_URL` y la prioridad de una rama seleccionada

---
