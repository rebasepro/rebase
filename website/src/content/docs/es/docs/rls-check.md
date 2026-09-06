---
sourceHash: 45912133a3586b34
slug: es/docs/rls-check
title: rls-check
description: "Audita la seguridad a nivel de fila (RLS) en cualquier base de datos PostgreSQL: Supabase, Neon, RDS o tu propio servidor. Solo lectura, sin registro, sin necesidad de Rebase."
---

# rls-check

`rls-check` lee el catálogo de una base de datos PostgreSQL e informa lo que realmente está expuesto:
tablas servidas con la seguridad a nivel de fila desactivada, políticas que se evalúan como verdaderas para
todos, vistas que leen directamente saltándose el RLS de sus tablas base y tablas de unión
olvidadas mientras sus dos extremos estaban protegidos.

Funciona en **cualquier** Postgres: Supabase, Neon, RDS, Cloud SQL o un servidor administrado por
ti mismo. No requiere Rebase y es útil tanto si lo adoptas como si no.

```bash
npx @rebasepro/rls-check
```

Ejecútalo en el directorio de tu proyecto y encontrará la base de datos por sí solo: `DATABASE_URL`,
después `POSTGRES_URL`, después un `.env` junto a él. Pasa la cadena de conexión como argumento solo
cuando no puedas hacer eso — npm imprime la línea de comandos antes de que el programa arranque, y tu
shell la registra, así que una contraseña en un argumento acaba en dos sitios que `rls-check` no puede
ocultar. `$DATABASE_URL` no es más seguro ahí: la shell lo expande antes de que npm lo vea.

Es de solo lectura por diseño: abre una transacción de solo lectura y realiza consultas al catálogo.
No escribe nada y no envía nada a ninguna parte: no hay telemetría ni llamadas de
red aparte de la que realiza a tu base de datos.

## Cómo ejecutarlo

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Si tu contraseña contiene `/`, `?` o `#`, codifícala en formato percent-encoding. Esos tres caracteres
terminan la sección de autoridad de la URL, así que la división cae dentro de la credencial: en lugar de
imprimir fragmentos de una contraseña, `rls-check` rechaza la cadena y lo dice.

`@` y `:` no necesitan codificación: la userinfo se divide en la **última** `@` y el usuario en el
**primer** `:`, que es lo que hace también `pg`, de modo que `postgres://user:pa@ss@host:5432/db` conecta
con `host` usando la contraseña `pa@ss`. Codificarlos de todos modos nunca está mal.

### Opciones

| Opción | Significado |
| --- | --- |
| `--json` | Salida en formato legible por máquinas en stdout, y nada más en stdout |
| `--html <ruta>` | Escribe además un informe HTML autocontenido ahí. Un solo archivo, sin peticiones de red |
| `--schema <nombre>` | Restringe el escaneo a un esquema. Repetible o separado por comas |
| `--role <nombre>` | Trata este rol como uno con el que llega un llamante no confiable, además de `anon`, `authenticated`, `web_anon` y `rebase_user`. Repetible o separado por comas |
| `--fail-on <severidad>` | Sale con código 1 en o por encima de esta severidad. Valor por defecto `high`; `none` nunca falla |
| `--only <id>` | Ejecuta solo estas comprobaciones. Repetible o separado por comas |
| `--skip <id>` | Omite estas comprobaciones. Repetible o separado por comas |
| `--list-checks` | Muestra el catálogo y sale |
| `--timeout <ms>` | Tiempo de espera de la instrucción (timeout), por defecto 15000 |
| `--quiet` | Solo hallazgos: sin encabezado, sin resumen |
| `--no-color` | Desactiva el color ANSI (también respeta `NO_COLOR` y un stdout que no sea TTY) |

Un id desconocido pasado a `--only` o `--skip` genera un error en lugar de ignorarse silenciosamente, ya que
un error tipográfico allí debilitaría el escaneo sin que te des cuenta. Un `--role` que no esté en `pg_roles`
es un error por la misma razón: toda comprobación depende de un permiso concedido a un rol expuesto, así que
un nombre que no coincide con nada elimina cobertura sin decirlo.

El encabezado del informe nombra los roles que la ejecución trató como expuestos, para que veas de un vistazo
si `No findings` cubrió el rol con el que se conecta tu aplicación:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Cuando el escaneo se conecta con un rol que la seguridad a nivel de fila *sí* puede restringir —ni superusuario,
ni propietario, sin `BYPASSRLS`— ese rol se añade al conjunto y el informe lo indica. Escanear con el rol de tu
propia aplicación es lo más parecido a preguntarle a la base de datos qué ve tu API.

### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Sin hallazgos en o por encima del umbral `--fail-on` |
| `1` | Al menos un hallazgo en o por encima del umbral |
| `2` | El escaneo no se pudo ejecutar: argumentos no válidos, conexión rechazada, fallo de autenticación, tiempo de espera agotado |

`1` y `2` son deliberadamente distintos: una conexión rota nunca debe parecer una base
de datos limpia.

### En CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Un proyecto Rebase recién creado no pasa eso el primer día, y no se pretende que lo haga.** Las `defaultSecurityRules` del andamiaje abren la lectura a todo el mundo — `{ operation: "select", access: "public" }` en `config/collections/index.ts` —, de modo que `posts`, `authors` y `tags` informan cada uno de un `policy-always-true` crítico. `access: "public"` trata de *filas*, no de quién puede llamar a la API: una petición sin token sigue recibiendo un 401 mientras `AUTH_REQUIRE` esté activo. Aun así el hallazgo es correcto, porque eso es lo único que hay delante de los datos.

Decide cuál de los dos casos es el tuyo antes de conectar esto a CI:

- **las reglas son un marcador de posición** — sustitúyelas por las que tus datos necesitan de verdad ([reglas de seguridad](/docs/collections/security-rules)) y los hallazgos desaparecen;
- **las filas son realmente públicas** — dilo una vez, con `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, y ten claro a qué renuncias: `--skip` desactiva la comprobación en todas partes, incluida la tabla que añadas el mes que viene.

### Salida JSON

`--json` emite un objeto estable: `scannedAt`, `database` (solo host y nombre, nunca
credenciales), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` y `diagnostics`. Cada hallazgo incluye `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` y `confidence`.

`exposedRoles` y `diagnostics` forman parte del contrato, no son extras: toda comprobación
depende del conjunto de roles expuestos, y `diagnostics.degraded` es lo que permite a un
consumidor distinguir «no había nada mal» de «el escaneo no pudo mirar».

## Cómo leer el informe

**Los hallazgos confirmados aparecen primero; los heurísticos están en una sección separada "vale la pena comprobar".** Una comprobación heurística no puede interpretar la intencionalidad (una tabla de unión que dejaste abierta deliberadamente no es un error), por lo que se formulan como preguntas y nunca se mezclan con las certezas.

**Presta atención a la nota sobre privilegios.** Si el escaneo se conecta como superusuario, propietario de la tabla o un rol con `BYPASSRLS`, así lo indicará. Ese rol ve el catálogo completo, que es lo que hace posible la auditoría, pero también significa que nada en el informe describe lo que experimenta *esa* conexión. Los hallazgos se refieren a lo que obtienen otros roles.

### En una base de datos Rebase, cambia la regla, no la política

Cada política de un despliegue de Rebase se compila a partir de las `securityRules` de una colección, y el runtime **las vuelve a aplicar en cada arranque**: elimina cada política generada y la crea de nuevo a partir de la configuración. Por tanto, un `ALTER POLICY` sobre una de ellas sobrevive exactamente hasta el siguiente reinicio, y el hallazgo vuelve con él, después de que lo hayas visto desaparecer.

`rls-check` reconoce esas políticas (un nombre con la forma `<tabla>_<operación>_<hash>`, o una llamada a `rebase.uid()` / `rebase.roles()` en la expresión) y prescribe la regla en lugar de SQL. Cuando veas un arreglo que dice eso:

1. busca la colección cuya tabla nombra, dentro de `config/collections/`;
2. cambia sus `securityRules` — consulta [reglas de seguridad](/docs/collections/security-rules);
3. si la colección no declara ninguna propia, hereda `defaultSecurityRules` de `config/collections/index.ts`, y ese es el archivo que hay que editar;
4. vuelve a desplegar — el arranque reaplica las políticas — o ejecuta `rebase db push`.

Una política que escribiste a mano, en una migración, no se ve afectada por nada de esto, y su arreglo sigue siendo el SQL que hay que ejecutar.

## Las comprobaciones

Las severidades a continuación son las predeterminadas; varias comprobaciones ajustan su propia severidad según lo que encuentran, y el informe siempre indica la razón.

### rls-disabled

**Tabla expuesta sin seguridad a nivel de fila.** Crítica.

La tabla tiene RLS desactivado *y* otorga permisos `SELECT`/`INSERT`/`UPDATE`/`DELETE` a un rol al que puede acceder un cliente no confiable (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres no aplica ningún filtro por fila, por lo que las políticas, si existen, nunca se consultan.

Una tabla con RLS desactivado pero sin permisos otorgados a un rol expuesto *no* se reporta. No es accesible y marcarla generaría ruido.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Habilitar RLS sin políticas deniega todas las filas a todos excepto al propietario, por lo que debes agregar la política prevista en la misma migración; de lo contrario, habrás cambiado una exposición por una interrupción silenciosa del servicio. Consulta [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La política otorga acceso incondicional.** Crítica.

Una política permisiva cuya expresión `USING` o `WITH CHECK` es una verdad constante: `true`, `(true)`, `1 = 1`. Las políticas permisivas se combinan mediante un operador OR, por lo que una sola de estas satisface el filtro de filas de la tabla sin importar cuán estrictas sean las demás políticas.

Si una política `RESTRICTIVE` cubre el mismo comando, esta severidad se degrada a media y se notifica como algo que se debe verificar en lugar de como una certeza, ya que las políticas restrictivas aplican un operador AND después de que las permisivas aplican el OR.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

En una base de datos Rebase el arreglo es la regla de la colección, no esa sentencia: consulta «En una base de datos Rebase, cambia la regla, no la política». Un andamiaje recién creado informa de esta comprobación en `posts`, `authors` y `tags` por diseño.

### policy-anonymous-tautology

**La política solo comprueba que exista un ID de quien realiza la llamada.** La severidad depende de la plataforma.

La expresión tiene la forma `rebase.uid() IS NOT NULL` (o `auth.uid()` en Supabase y en bases de datos Rebase aprovisionadas antes de la versión 1.0): separa a los usuarios autenticados de los no autenticados, pero no limita las filas. Cualquier usuario autenticado puede acceder a todas las filas que cubre la política.

La severidad depende de la plataforma y esta distinción es importante:

- **En Supabase**, `auth.uid()` devuelve `NULL` para llamadas anónimas, por lo que es una comprobación válida solo para usuarios autenticados. Se reporta como **baja**: una falta de limitación del alcance de datos entre usuarios autenticados, no una vulnerabilidad de acceso anónimo.
- **En Rebase o PostgREST**, donde un ID no especificado se convierte al centinela `'anonymous'`, la expresión es *verdadera también para usuarios no autenticados*. Se reporta como **crítica**.
- **En una plataforma no reconocida**, se reporta como **media**, ya que dependerá de si tu arquitectura utiliza dicho centinela.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

El SQL sugerido se muestra con la función de ID de llamada que realmente tiene tu base de datos: `rebase.uid()` en una base de datos Rebase, `auth.uid()` en Supabase y PostgREST. Ambas variantes se reconocen al leer las políticas, por lo que una base de datos Rebase en proceso de migración desde el esquema `auth` previo a la 1.0 seguirá siendo auditada.

### view-bypasses-rls

**La vista omite el RLS de su tabla base.** Crítica.

Una vista con permisos concedidos a un rol no confiable que realiza una consulta en una tabla protegida por RLS sin `security_invoker = true`. La vista se ejecuta con los privilegios de su **propietario**, por lo que lee la tabla base como propietario y las políticas de quien realiza la llamada nunca se aplican. Esta es la forma más común en que se filtran datos de una tabla cuidadosamente protegida.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

En versiones de PostgreSQL anteriores a la 15, esta opción no existe, por lo que todas las vistas de este tipo se comportan así. En ese caso, el hallazgo se reporta como heurístico y la solución consiste en mover la lógica a una función o actualizar la versión.

### matview-bypasses-rls

**La vista materializada expone datos protegidos por RLS.** Alta.

Las vistas materializadas no pueden tener seguridad a nivel de fila y los datos en ellas son una instantánea almacenada generada por quien la haya actualizado. Si se conceden permisos a un rol no confiable y la consulta que la define lee una tabla protegida por RLS, ninguna política podrá evitar la exposición: revoca el permiso o mueve la vista materializada a un esquema al que los roles no confiables no tengan acceso.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Usuarios no autenticados pueden escribir.** Alta.

Una política permisiva de tipo `INSERT`/`UPDATE`/`DELETE`/`ALL` accesible sin autenticación cuya expresión de comprobación acepta cualquier fila, respaldada por la concesión de permisos correspondiente.

La condición "acepta cualquier fila" es esencial y deliberadamente estricta. Supabase otorga a `anon` y `authenticated` permisos completos de DML por defecto, por lo que una política dirigida a esos roles no es en sí misma un problema: una regla estándar como `FOR INSERT TO public WITH CHECK (userId = auth.uid())` es correcta y no se reporta.

### unqualified-column-in-subquery

**Columna no cualificada dentro de una subconsulta de política.** Alta, heurística.

Un nombre de columna sin cualificar dentro de una subconsulta `EXISTS`/`IN` que existe *tanto* en la relación interna como en la propia tabla de la política. Postgres la vincula a la tabla **interna**, por lo que la correlación con la fila externa que querías escribir desaparece silenciosamente y la condición pasa a ser trivialmente verdaderos —o trivialmente falsos, denegando todas las filas a todos.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**La ausencia de este hallazgo no es prueba de seguridad.** `pg_policies.qual` es la re-representación que hace el propio Postgres del árbol de sintaxis y, por lo general, vuelve a cualificar las referencias a las columnas, por lo que el nombre original sin cualificar a menudo ya no es visible cuando se lee el catálogo. Cuando esta comprobación se activa, es una prueba contundente; cuando no lo hace, no demuestra nada.

### junction-table-unprotected

**Tabla de unión muchos a muchos sin RLS.** Alta, heurística.

Una tabla que se reduce esencialmente a los dos extremos de dos claves foráneas, ambas apuntando a tablas que *sí* tienen RLS, sin seguridad a nivel de fila propia. Ambos lados de la relación están bloqueados pero el vínculo entre ellos está abierto, lo cual es suficiente para enumerar la relación incluso cuando ninguno de los extremos puede ser leído.

Es heurística porque una tabla de unión se infiere a partir de su estructura. Si la tuya es deliberadamente pública, usa `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS habilitado pero no forzado para el propietario de la tabla.** Media o alta.

Sin `FORCE`, el propietario de la tabla está exento de sus propias políticas. Esto es inofensivo cuando el propietario es un rol de aprovisionamiento al que nada se conecta, pero grave cuando tu aplicación se conecta como propietario, por lo que esto se clasifica como **alta** cuando el rol propietario puede iniciar sesión y **media** en caso contrario.

Si el propietario es un superusuario o tiene `BYPASSRLS`, se mantiene como media y así se indica: `FORCE` no puede restringir a dicho rol e implicar lo contrario sería engañoso.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS habilitado sin políticas.** Media.

No es un problema de seguridad, sino todo lo contrario. RLS activado sin políticas deniega todas las filas a todos excepto al propietario. Se notifica porque es un fallo *invisible*: la API devuelve `[]` y una tabla vacía no se puede distinguir de una filtrada. Esta configuración ha provocado en entornos de producción la entrega silenciosa de colecciones vacías durante semanas.

### policy-role-unreachable

**Las políticas se dirigen a roles a los que nada se conecta.** Media.

Cada política de la tabla especifica roles que no existen, no pueden iniciar sesión y ningún rol de inicio de sesión hereda de forma transitiva. Las políticas parecen correctas pero no se aplican a nadie, por lo que la tabla parece estar vacía.

El caso clásico son las políticas escritas como `TO authenticated` (un nombre de rol de Supabase) en una base de datos cuyas peticiones realmente llegan con otro rol.

### grant-to-public

**Privilegios de tabla otorgados a PUBLIC.** Media.

Un privilegio DML otorgado a `PUBLIC`. Incluso con RLS habilitado, esto amplía *para quién* se evalúan las políticas, y casi nunca es algo deliberado.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Rutina SECURITY DEFINER con un search_path mutable.** Media.

La rutina se ejecuta con los permisos de su propietario (a menudo un superusuario) mientras que quien realiza la llamada controla cómo se resuelven sus identificadores. Ese es el esquema clásico de escalada de privilegios, y cualquier elemento al que acceda la rutina se leerá con los derechos del propietario, omitiendo RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La política llama a `current_setting()` sin `missing_ok`.** Baja, heurística.

`current_setting('app.tenant_id')` con un solo argumento *lanza una excepción* cuando la configuración no está establecida, en lugar de devolver `NULL`. Por tanto, en lugar de denegar la fila, la solicitud genera un error: el usuario ve un error 500 en lugar de un resultado vacío, y el middleware que reintenta errores 5xx reintentará una solicitud que nunca podrá tener éxito.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Lo que no hace esta herramienta

Ser claros sobre los límites es fundamental: una herramienta de seguridad que exagera su cobertura es peor que no tener ninguna.

- **Es una auditoría estática del catálogo.** Lee `pg_class`, `pg_policies`, `pg_depend` y tablas relacionadas. No se conecta como tu rol `anon` ni intenta leer tus datos, por lo que no puede confirmar si se puede acceder a una exposición a través de tu API.
- **No puede probar que una política sea correcta.** Detecta patrones que se sabe que son erróneos. Una política que supere todas las comprobaciones de esta herramienta aún puede estar expresando una regla de negocio equivocada.
- **Un informe sin hallazgos no es una certificación de seguridad.** En particular, consulta la nota sobre [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres reescribe las expresiones de las políticas, por lo que algunos errores dejan de ser visibles por completo en el catálogo.
- **No comprueba la autorización a nivel de aplicación**, claves de API, exposición de la red, gestión de secretos ni nada fuera de la base de datos.

## Relacionado

- [Reglas de seguridad (RLS)](/docs/collections/security-rules) — definición de la seguridad a nivel de fila en las colecciones de Rebase, la cual se compila en las políticas que audita esta herramienta.

---
