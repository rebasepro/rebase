---
sourceHash: 7262803dd6cb2e95
slug: es/docs/rls-check
title: rls-check
description: Audita la seguridad a nivel de fila (RLS) en cualquier base de datos PostgreSQL — Supabase, Neon, RDS o tu propio servidor. De solo lectura, sin registro y sin requerir Rebase.
---

# rls-check

`rls-check` lee el catálogo de una base de datos PostgreSQL e informa lo que realmente está expuesto:
tablas servidas con la seguridad a nivel de fila desactivada, políticas que se evalúan como verdaderas para
cualquiera, vistas que leen saltándose directamente el RLS de sus tablas base y tablas de unión
que se olvidaron mientras ambos extremos estaban protegidos.

Funciona en **cualquier** Postgres — Supabase, Neon, RDS, Cloud SQL o un servidor administrado por
ti mismo. No requiere Rebase y es útil tanto si lo adoptas como si no.

```bash
npx @rebasepro/rls-check
```

Ejecútalo en el directorio de tu proyecto y encontrará la base de datos automáticamente: primero `DATABASE_URL`,
luego `POSTGRES_URL` y después un archivo `.env` en el directorio actual. Pasa la cadena de conexión como
argumento únicamente cuando no puedas hacer lo anterior; npm muestra la línea de comandos antes de que
el programa inicie y tu shell la registra, por lo que una contraseña en un argumento termina en
dos lugares que `rls-check` no puede censurar. `$DATABASE_URL` no es más seguro allí: la shell
lo expande antes de que npm llegue a verlo.

Es de solo lectura por diseño: abre una transacción de solo lectura y ejecuta consultas
al catálogo. No escribe nada ni envía nada a ningún lado; no hay telemetría ni llamadas
de red aparte de la que va a tu base de datos.

## Ejecución

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Si tu contraseña contiene `/`, `?` o `#`, codifícala en porcentaje (percent-encoding). Esos tres caracteres delimitan la sección de
autoridad de la URL, por lo que la división caería dentro de la credencial; en lugar de imprimir fragmentos de
una contraseña, `rls-check` rechaza la cadena y lo notifica.

`@` y `:` no necesitan codificación: la información de usuario se divide en el **último** `@` y el usuario en el
**primer** `:`, que es lo que también hace `pg`, por lo que `postgres://user:pa@ss@host:5432/db` se conecta
al host con la contraseña `pa@ss`. Codificarlos de todos modos nunca es un error.

### Opciones

| Opción | Significado |
| --- | --- |
| `--json` | Salida legible por máquina en stdout, y nada más en stdout |
| `--html <path>` | También escribe allí un informe HTML autocontenido. Un solo archivo, sin solicitudes de red |
| `--schema <name>` | Restringe el escaneo a un esquema. Repetible o separado por comas |
| `--role <name>` | Trata este rol como uno con el que llega un cliente no confiable, además de `anon`, `authenticated`, `web_anon` y `rebase_user`. Repetible o separado por comas |
| `--fail-on <severity>` | Sale con código 1 en o por encima de esta severidad. Predeterminado `high`; `none` nunca falla |
| `--only <id>` | Ejecuta solo estas comprobaciones. Repetible o separado por comas |
| `--skip <id>` | Omite estas comprobaciones. Repetible o separado por comas |
| `--list-checks` | Imprime el catálogo y sale |
| `--timeout <ms>` | Tiempo de espera de la instrucción (statement timeout), predeterminado 15000 |
| `--quiet` | Solo hallazgos — sin banner, sin resumen |
| `--no-color` | Deshabilita los colores ANSI (también respeta `NO_COLOR` y un stdout que no sea TTY) |

Un identificador desconocido pasado a `--only` o `--skip` genera un error en lugar de ignorarse silenciosamente, ya que
un error tipográfico allí debilitaría el escaneo sin aviso. Un `--role` que no esté en `pg_roles` es un error por
la misma razón: cada comprobación depende de un privilegio otorgado a un rol expuesto, por lo que un nombre que no
coincida con nada eliminaría cobertura sin advertirlo.

El encabezado del informe lista los roles que la ejecución consideró expuestos, para que puedas ver de un vistazo
si `No findings` cubrió el rol con el que se conecta tu aplicación:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Cuando el escaneo se conecta con un rol que la seguridad a nivel de fila *puede* restringir —no un superusuario, no
un propietario, sin `BYPASSRLS`— ese rol se agrega al conjunto y el informe lo indica. Escanear con
el rol propio de tu aplicación es lo más cercano a preguntarle a la base de datos qué ve tu API.

### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Sin hallazgos en o por encima del umbral de `--fail-on` |
| `1` | Al menos un hallazgo en o por encima del umbral |
| `2` | El escaneo no pudo ejecutarse — argumentos incorrectos, conexión rechazada, fallo de autenticación, tiempo de espera agotado |

`1` y `2` son deliberadamente distintos: una conexión rota nunca debe parecer una base de datos limpia.

### En CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Un nuevo proyecto de Rebase no pasa esto desde el primer día, y no está diseñado para hacerlo.** Las
`defaultSecurityRules` del scaffold abren las lecturas a todo el mundo — `{ operation: "select", access:
"public" }` en `config/collections/index.ts` —, por lo que `posts`, `authors` y `tags` reportan cada una un
hallazgo crítico `policy-always-true`. `access: "public"` se refiere a las *filas*, no a quién puede llamar a la
API: una solicitud sin token sigue recibiendo un 401 mientras `AUTH_REQUIRE` esté activado. El hallazgo es
correcto de todos modos, porque eso es lo único que se interpone frente a los datos.

Decide cuál de estos dos casos aplica antes de integrarlo en CI:

- **las reglas son provisionales** — reemplázalas con las que tus datos realmente necesitan
  ([reglas de seguridad](/docs/collections/security-rules)), y los hallazgos desaparecerán;
- **las filas realmente deben ser legibles por todo el mundo** — decláralo explícitamente una vez con
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, teniendo en cuenta lo que descartas:
  `--skip` desactiva la comprobación en todas partes, incluida la tabla que agregues el mes que viene.

### Salida JSON

`--json` emite un objeto estable: `scannedAt`, `database` (solo host y nombre — nunca
credenciales), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` y `diagnostics`. Cada hallazgo incluye `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` y `confidence`.

`exposedRoles` y `diagnostics` forman parte del contrato, no son extras: cada comprobación depende del
conjunto expuesto, y `diagnostics.degraded` es la forma en que un consumidor distingue entre "no hubo problemas" y
"el escáner no pudo verificar". Leer `findings: []` sin ambos es leer la mitad de la respuesta.

## Ejecución programada

Una comprobación que tienes que recordar ejecutar manualmente es una comprobación que informará que la base de datos está limpia
justo hasta el día en que ocurra un problema. El backend puede ejecutar esta auditoría por ti y
servir el resultado en el panel de administración:

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // the default
    warnAtSeverity: "high"            // the default
};
```

Pasa eso como `rlsAudit` en el objeto que entregas a `initializeRebaseBackend`.

El resultado se sirve en `GET /api/admin/rls-audit`, restringido a administradores como cualquier otra
superficie administrativa, y cada ejecución registra una línea: en nivel `warn` cuando un hallazgo alcanza
`warnAtSeverity`, o en `info` en caso contrario:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit.
```

### Por qué pasas `scan` como argumento

`@rebasepro/server` no incluye ningún driver de base de datos —eso es lo que permite que sea utilizable con
Postgres, Mongo y Firebase por igual. `@rebasepro/rls-check` incluye `pg`, ya que
se conecta a Postgres. Importarlo dentro del paquete del servidor añadiría un
driver de Postgres a cada instalación, para una funcionalidad que solo algunas pueden usar; por eso,
entregas la función externamente.

### En un despliegue distribuido

La auditoría es un singleton con *propietario*, igual que el programador de cron. Cada proceso que
la posea ejecuta su propio escaneo, el cual es de solo lectura e inofensivo pero redundante; asígnalo
a un solo proceso:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

o, para un entorno de ejecución configurado por variables de entorno:

```bash
REBASE_RLS_AUDIT=false
```

El rol `functions` ya lo posee como `false` —ese proceso no ejecuta temporizadores
en absoluto. Indicar una anulación de propiedad nunca altera otra: desactivar cron deja
la auditoría intacta, y viceversa.

Un proceso que sirve la interfaz de administración sin ser propietario del escaneo responde al
endpoint con total sinceridad, indicando que el escaneo no se ejecuta allí.

### Es una red de seguridad, no un monitor

El intervalo predeterminado es de un día, porque lo que se vigila es un esquema:
cambia con los despliegues, no con el tráfico. Un escaneo fallido se registra en el log y se anota en
el estado — nunca lanza una excepción. Convertir una comprobación de seguridad en una nueva forma de
hacer caer el servidor sería perjudicial en ambos sentidos.

## Cómo interpretar el informe

**Los hallazgos confirmados aparecen primero; los heurísticos se encuentran en una sección separada de "vale la pena revisar".** Una comprobación heurística no puede predecir la intención —una tabla de unión que dejaste
abierta deliberadamente no es un error—, por lo que estas se formulan como preguntas y nunca se mezclan con
las certezas.

**Presta atención a la nota sobre privilegios.** Si el escaneo se conecta como superusuario, propietario de la tabla o un
rol con `BYPASSRLS`, el informe lo indicará. Ese rol ve el catálogo real, que es lo que hace posible
la auditoría, pero también significa que nada en el informe describe lo que experimenta *esa*
conexión específica. Los hallazgos se refieren a lo que obtienen los demás roles.

### En una base de datos Rebase, cambia la regla, no la política

Cada política en un despliegue de Rebase se compila a partir de las `securityRules` de una colección, y el
entorno de ejecución **las vuelve a aplicar en cada inicio**: elimina cada política generada y la crea
nuevamente a partir de la configuración. Por lo tanto, un `ALTER POLICY` ejecutado directamente sobre una de ellas sobrevive exactamente
hasta el siguiente reinicio, y el hallazgo reaparecerá con él, después de haberlo visto desaparecer.

`rls-check` reconoce esas políticas (un nombre con formato `<table>_<operation>_<hash>`, o una llamada a
`rebase.uid()` / `rebase.roles()` en la expresión) y prescribe la regla en lugar de SQL.
Cuando veas una solución que indique esto:

1. busca la colección cuya tabla se menciona, bajo `config/collections/`;
2. modifica sus `securityRules` — consulta [reglas de seguridad](/docs/collections/security-rules);
3. si la colección no declara reglas propias, hereda `defaultSecurityRules` de
   `config/collections/index.ts`, y ese es el archivo que se debe editar;
4. vuelve a desplegar —el arranque vuelve a aplicar las políticas— o ejecuta `rebase db push`.

Una política escrita a mano en una migración no se ve afectada por nada de esto, y su solución
sigue siendo la sentencia SQL correspondiente.

## Las comprobaciones

Las severidades indicadas a continuación son las predeterminadas; varias comprobaciones ajustan su propia severidad en función de lo
que encuentran, y el informe siempre especifica el motivo.

### rls-disabled

**Tabla expuesta sin seguridad a nivel de fila.** Crítica.

La tabla tiene RLS desactivado *y* otorga `SELECT`/`INSERT`/`UPDATE`/`DELETE` a un rol al que
un cliente no confiable puede acceder (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres no aplica
ningún filtro por fila en absoluto, por lo que las políticas —si existe alguna— nunca se consultan.

Una tabla con RLS desactivado pero sin permisos otorgados a un rol expuesto *no* se reporta. No es accesible,
y señalarla generaría ruido innecesario.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Habilitar RLS sin políticas deniega cada fila a todos excepto al propietario, así que agrega la política
que deseas en la misma migración; de lo contrario, habrás cambiado una exposición por una
interrupción silenciosa del servicio. Consulta [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La política otorga acceso incondicional.** Crítica.

Una política permisiva cuya expresión `USING` o `WITH CHECK` es una verdad constante: `true`,
`(true)`, `1 = 1`. Las políticas permisivas se combinan con el operador OR, por lo que una sola de estas satisface
el filtro de filas de la tabla sin importar cuán estrictas sean todas las demás políticas.

Si una política de tipo `RESTRICTIVE` cubre el mismo comando, esto se degrada a medio y
se reporta como algo para verificar en lugar de una certeza, porque las políticas restrictivas aplican un AND
después de que las permisivas aplican el OR.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

En una base de datos Rebase, la solución es la regla de la colección en lugar de esa sentencia — consulta
[cambia la regla, no la política](#en-una-base-de-datos-rebase-cambia-la-regla-no-la-política). Un
scaffold base reporta esta comprobación en `posts`, `authors` y `tags` por diseño.

### policy-anonymous-tautology

**La política solo comprueba que exista un identificador de solicitante.** La severidad depende de la plataforma.

La expresión tiene la forma `rebase.uid() IS NOT NULL` (o `auth.uid()` en Supabase, y en una
base de datos Rebase aprovisionada antes de la versión 1.0): separa a los clientes autenticados de los no autenticados, pero
no delimita las filas. Cada usuario autenticado puede acceder a todas las filas que cubre la política.

La severidad depende de la plataforma, y esta distinción es importante:

- **En Supabase**, `auth.uid()` devuelve `NULL` para clientes anónimos, por lo que es una comprobación funcional
  exclusiva para usuarios autenticados. Se reporta como **baja** — una falta de delimitación de datos entre usuarios
  autenticados, no una brecha de acceso anónimo.
- **En Rebase o PostgREST**, donde un identificador en blanco se convierte en un centinela `'anonymous'`,
  la expresión es *verdadera también para clientes sin sesión iniciada*. Se reporta como **crítica**.
- **En una plataforma no reconocida**, se reporta como **media**, ya que determinar si es una brecha
  depende de si tu infraestructura utiliza dicho centinela.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

El SQL sugerido se imprime con la función de identificación que tu base de datos realmente tiene:
`rebase.uid()` en una base de datos Rebase, `auth.uid()` en Supabase y PostgREST. Ambas
nomenclaturas se reconocen al leer las políticas, por lo que una base de datos Rebase en proceso de migración desde
el esquema `auth` previo a la 1.0 se sigue comprobando adecuadamente.

### policy-authenticated-tautology

**La política permite a cualquier cliente autenticado acceder a todas las filas.** Alta.

La forma corregida de la comprobación anterior — `rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'` — y el punto en el que muchos se detienen. Excluye a los clientes no autenticados, pero
lo que no hace es delimitar las filas: lo que queda es que *toda cuenta registrada puede leer cada fila de
esta tabla*, lo cual difiere bastante de lo que suele pretenderse.

Ese es el patrón que convierte una tabla `users` en un directorio de todas las direcciones de la
plataforma, legible por cualquiera que se haya registrado; y cuando el registro es abierto, "cualquiera que
se haya registrado" es cualquier persona. Se reporta por separado del caso anónimo porque la
solución y la severidad son distintas, y porque legítimamente podrías querer silenciar
una y no la otra.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Si la tabla realmente debe ser legible por todas las cuentas —una lista compartida de precios, un listado
de países—, conserva la política y silencia el hallazgo con
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**La vista elude el RLS de su tabla base.** Crítica.

Una vista asignada a un rol no confiable que realiza una consulta sobre una tabla protegida por RLS sin
`security_invoker = true`. La vista se ejecuta con los privilegios de su **propietario**, por lo que lee la
tabla base como propietaria y las políticas del usuario que consulta nunca se aplican. Esta es la forma más común en que
una tabla cuidadosamente asegurada termina filtrando información.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

En PostgreSQL inferior a la versión 15 esta opción no existe, por lo que cualquier vista en esa situación se comporta de
este modo. En esos casos, el hallazgo se reporta como heurístico y la solución consiste en trasladar la lógica a una
función o actualizar la versión de PostgreSQL.

### matview-bypasses-rls

**La vista materializada expone datos protegidos por RLS.** Alta.

Las vistas materializadas no pueden tener seguridad a nivel de fila, y los datos que contienen son una
captura almacenada tomada por quienquiera que la haya refrescado. Si se otorga acceso a un rol no confiable y su
consulta de definición lee una tabla protegida por RLS, ninguna política podrá protegerla: revoca el permiso o mueve
la vista materializada a un esquema al que los roles no confiables no puedan acceder.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Clientes no autenticados pueden escribir.** Alta.

Una política permisiva de tipo `INSERT`/`UPDATE`/`DELETE`/`ALL` accesible sin autenticación cuya
expresión de verificación acepta cualquier fila, respaldada por un permiso coincidente.

La condición de "aceptar cualquier fila" es esencial y deliberadamente estricta. Supabase otorga a `anon`
y `authenticated` permisos DML completos de forma predeterminada, por lo que una política dirigida a esos roles no es en sí
misma un problema; un caso típico como `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` es correcto
y no se reporta.

### unqualified-column-in-subquery

**Columna no calificada dentro de una subconsulta de política.** Alta, heurística.

Un nombre de columna sin calificar dentro de una subconsulta `EXISTS`/`IN` que existe en *ambas* relaciones: la interna
y la tabla propia de la política. Postgres la vincula a la tabla **interna**, por lo que la correlación con
la fila externa que pretendías establecer desaparece silenciosamente y el predicado se vuelve trivialmente
satisfacible —o trivialmente insatisfacible, denegando cada fila a todos—.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**La ausencia de este hallazgo no es prueba de seguridad.** `pg_policies.qual` es la propia
representación que Postgres hace del árbol sintáctico (parse tree), y habitualmente vuelve a calificar las referencias a columnas; por tanto, el
nombre sin calificar original con frecuencia ya no es visible cuando se lee el catálogo. Cuando
esta comprobación se activa es una evidencia sólida; cuando no lo hace, no demuestra nada.

### junction-table-unprotected

**Tabla de unión muchos a muchos sin RLS.** Alta, heurística.

Una tabla que consiste esencialmente en los dos extremos de dos claves foráneas que apuntan a
tablas que *sí* tienen RLS, pero sin seguridad a nivel de fila propia. Ambos lados de la relación
están protegidos y la unión entre ellos está abierta, lo cual basta para enumerar la relación
incluso cuando ninguno de los extremos puede ser leído.

Es heurística porque una tabla de unión se infiere a partir de su estructura. Si la tuya es deliberadamente
pública, usa `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS habilitado pero no forzado para el propietario de la tabla.** Media o alta.

Sin `FORCE`, el propietario de la tabla queda exento de sus propias políticas. Esto es inofensivo cuando el
propietario es un rol de aprovisionamiento con el que nada se conecta, pero es grave cuando tu aplicación se conecta
como propietaria; por lo tanto, esto es **alta** cuando el rol propietario puede iniciar sesión, y **media** en caso contrario.

Si el propietario es un superusuario o tiene `BYPASSRLS`, se mantiene como media y lo señala: `FORCE` no puede
restringir a dicho rol, y dar a entender lo contrario sería engañoso.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS habilitado sin políticas.** Media.

No es una brecha de seguridad —es todo lo contrario—. RLS activo sin ninguna política deniega todas las filas a todos
excepto al propietario. Se reporta porque es un fallo *invisible*: la API devuelve `[]`, y
una tabla vacía es indistinguible de una filtrada. Esta configuración ha provocado que colecciones vacías se sirvan
en producción de forma silenciosa durante semanas.

### policy-role-unreachable

**Las políticas apuntan a roles con los que nada se conecta.** Media.

Todas las políticas de la tabla nombran roles que no existen, no pueden iniciar sesión y que ningún rol de
inicio de sesión hereda transitivamente. Las políticas parecen correctas pero no aplican a nadie, por lo que la tabla se lee
como vacía.

El caso clásico son las políticas escritas con `TO authenticated` —un nombre de rol de Supabase— en una base de datos
cuyas peticiones en realidad llegan como algún otro rol.

### grant-to-public

**Privilegios de tabla otorgados a PUBLIC.** Media.

Un privilegio DML otorgado a `PUBLIC`. Incluso con RLS habilitado, esto amplía *para quiénes* se evalúan
las políticas, y casi nunca es intencional.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Rutina SECURITY DEFINER con search_path mutable.** Media.

La rutina se ejecuta con los privilegios de su propietario —a menudo un superusuario— mientras que el solicitante controla cómo
se resuelven sus identificadores. Ese es el patrón estándar de escalada de privilegios, y cualquier elemento que la
rutina toque se lee con los derechos del propietario, eludiendo el RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La política invoca `current_setting()` sin `missing_ok`.** Baja, heurística.

`current_setting('app.tenant_id')` con un solo argumento *lanza una excepción* cuando el parámetro no está definido,
en lugar de devolver `NULL`. Por tanto, en vez de denegar la fila, la solicitud falla: el cliente
recibe un 500 en lugar de un resultado vacío, y el middleware configurado para reintentar errores 5xx reintentará una solicitud
que jamás podrá completarse con éxito.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Lo que esta herramienta no hace

Tener claros los límites es fundamental: una herramienta de seguridad que exagera su alcance es
peor que no tener ninguna.

- **Es una auditoría estática del catálogo.** Lee `pg_class`, `pg_policies`, `pg_depend` y
  estructuras afines. No se conecta como tu rol `anon` para intentar leer datos, por lo que no puede
  confirmar si una exposición es explotable a través de tu API.
- **No puede demostrar que una política sea correcta.** Detecta patrones que se sabe que son erróneos. Una
  política que supere todas las comprobaciones de aquí aún puede expresar una regla de negocio equivocada.
- **Un informe limpio no constituye una certificación de seguridad.** En particular, consulta la nota sobre
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres reescribe las expresiones de
  las políticas, por lo que algunos errores ya no son visibles en el catálogo en absoluto.
- **No comprueba la autorización a nivel de aplicación**, claves de API, exposición de red,
  gestión de secretos ni nada fuera de la base de datos.

## Relacionado

- [Reglas de seguridad (RLS)](/docs/collections/security-rules) — definición de seguridad a nivel de fila en
  colecciones de Rebase, que se compilan en las políticas que esta herramienta audita.
- [Solo backend](/docs/getting-started/headless/) — por qué una tabla sin directivas no se sirve
  en absoluto en un proyecto headless.
- [API REST](/docs/backend/api/) — la superficie que expone una política permisiva.
