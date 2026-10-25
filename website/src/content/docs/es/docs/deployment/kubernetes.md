---
sourceHash: 8ca6480a862b6d07
title: Kubernetes
sidebar_label: Kubernetes
description: Despliega Rebase en un clúster de Kubernetes con el chart oficial de Helm — uno o varios Deployments, un Job de migración que gestiona el esquema y aplicaciones estáticas en el mismo host.
---

## Visión general

El chart oficial es el equivalente en Kubernetes de la configuración de autoalojamiento
con Docker Compose. Misma idea, misma imagen, mismo bundle: **el runtime es la
imagen, tu proyecto es el bundle y actualizar Rebase es un cambio de tag.**

Se publica como un artefacto OCI junto a la imagen del runtime, y ambos llevan
la misma versión — el chart que despliega el runtime `0.17.3` *es* el chart `0.17.3`,
por lo que solo hay un número que rastrear. Sin `--version` obtienes el más
reciente; fíjalo para un despliegue real, de la misma forma en que fijarías `image.tag`:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set config.adminEmail=you@example.com \
  --set config.adminPassword="$(openssl rand -hex 16)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

El chart se entrega con el autorregistro desactivado, así que una release tiene que nombrar la cuenta
con la que inicia sesión su operador; de lo contrario arranca con una tabla de usuarios vacía y
sin ninguna forma de producir el primer llamante autenticado. `config.adminPassword` debe tener
al menos 12 caracteres, y `config.adminEmail` necesita un punto en su dominio: la
ruta de login analiza su cuerpo con `z.string().email()`, así que `admin@localhost`
es una cuenta en la que nadie podría iniciar sesión y el runtime se niega a crearla. Ambos
son rechazos en tiempo de renderizado y no sorpresas en
tiempo de ejecución — consulta [lo que el chart se niega a
renderizar](#lo-que-el-chart-se-niega-a-renderizar). Inicia sesión y cambia la contraseña;
estos valores acaban en un Secret.

Gestiónalos por separado apuntando `existingSecret` a un Secret
que contenga `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` junto con
`DATABASE_URL` y el resto.

El chart despliega **únicamente el runtime**. No despliega Postgres — utiliza
CloudNativePG, una base de datos gestionada o tu propio StatefulSet, y apunta
`config.databaseUrl` hacia él. Un chart que también gestionara tu base de datos
asumiría la responsabilidad de tus copias de seguridad y tu conmutación por error
(failover), lo cual es una promesa mucho mayor que simplemente "ejecutar la aplicación".

> **Madurez.** En CI se comprueban dos cosas por separado, y una tercera no.
> El chart pasa por linting y renderizado contra Helm v4.2.4 — cada topología
> documentada en esta página, incluido el comando de instalación anterior, y un caso
> que alcanza cada rechazo listado a continuación. La imagen del runtime que
> despliega el chart se construye y se arranca contra un Postgres real, de las dos
> formas en que puede llegar un bundle. Lo que **nunca se ha ejecutado es el chart
> contra un clúster en vivo**: nada ha programado estos manifiestos, así que las
> probes, el orden del Job de migración previo a la instalación y el ingress son
> correctos como YAML y no están probados como despliegue. Considéralo un punto
> de partida bien testeado en lugar de una opción predeterminada probada en producción, y lee
> [Self-Hosting](/docs/deployment/self-hosting) para conocer la alternativa que sí lo está.

Para trabajar desde un repositorio clonado (checkout) — un chart modificado o una
instalación aislada (air-gapped) —, `helm install rebase ./infra/charts/rebase` acepta los mismos valores.

## Cómo incluir tu proyecto en el pod

| `bundle.mode` | Cómo | Cuándo |
|---|---|---|
| `image` (predeterminado) | Construye `FROM rebasepro/server` con `COPY dist-bundle /bundle`, luego define `image.repository` | Casi siempre. Un solo artefacto, inmutable, sin dependencia en tiempo de ejecución de que una URL permanezca activa |
| `url` | Imagen base; el runtime descarga un archivo tarball en cada inicio del pod | Un plano de control que distribuye bundles fuera de banda |

## Un proceso, o varios

La configuración predeterminada es un único Deployment que sirve todo — la misma
estructura que ejecuta el archivo Compose. Dividirlo requiere solo un valor:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Eso te proporciona una capa `api`, una capa `functions` y un `worker`, todos a
partir de la misma imagen y del mismo bundle. Consulta [Split Processes](/docs/deployment/split-processes)
para ver qué hace cada rol y por qué querrías separarlos.

Lo que aporta el chart frente a hacerlo manualmente es que **deriva las configuraciones
cuyo modo de fallo es silencioso**, a partir de los valores que ya le proporcionaste:

- `REBASE_ROLE` por unidad — `all` en la API cuando no hay unidad de functions, para que siga sirviendo tus funciones
- `REBASE_MIGRATE_ON_BOOT=none` en todas partes, ya que el Job de migración gestiona el esquema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` en la API una vez que existe un worker
- `TRUSTED_PROXY_HOPS` en la unidad de functions
- `REBASE_RATE_LIMIT_STORE=sql` tan pronto como un segundo proceso sirve HTTP

Un `REBASE_ROLE` incorrecto no sirve HTTP mientras `/health` sigue respondiendo,
por lo que la comprobación de preparación (readiness) pasa y cada solicitud devuelve un 404.
Un `REBASE_MIGRATE_ON_BOOT` ausente provoca un ciclo de reinicios constantes (crash loop)
cuya causa queda en un registro que nadie está mirando. El chart los configura todos y
`config.env` no puede anularlos.

### Separar cron de la ejecución de trabajos (jobs)

Dos workers con responsabilidades opuestas — sin un nuevo rol y sin código:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## El panel de administración y cualquier otro frontend

Una aplicación estática es la misma imagen de runtime iniciando un bundle con
`kind: static`. Esa ruta se ataja antes de que el runtime lea `DATABASE_URL` o
`JWT_SECRET`, por lo que estos pods **no contienen ningún secreto**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

El ingress enruta `/admin` hacia ella y `/` hacia la API, en el **mismo host**.
Esto es deliberado: el mismo origen significa que la autenticación mediante cookies
y CORS se mantienen exactamente iguales, y la división sigue siendo una decisión
de topología interna en lugar de un cambio en la superficie pública de tu producto.
El coste es que los assets deben estar *construidos* para esa ruta, lo cual el
runtime verifica al arrancar.

Desplegar el admin se reduce entonces a actualizar el tag de la imagen en un Deployment.
El backend no se reinicia.

## Esquema

`migrationJob.enabled` (el valor predeterminado) ejecuta un Job con hook
`pre-install,pre-upgrade` que aprovisiona y finaliza, y cada pod arranca con
`REBASE_MIGRATE_ON_BOOT=none`. Nada en la ruta de las peticiones gestiona el esquema de las colecciones,
lo que supone la solución más limpia a "exactamente un proceso aprovisiona el esquema"
— deja de ser una regla que alguien tenga que recordar. Los pods siguen manteniendo al día en el arranque las tablas
propias del framework (auth, claves de API, jobs, cron); `provision: false` detiene eso también,
no renderiza ningún Job y deja el esquema a una
[ejecución de aprovisionamiento](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
bajo tu propio proceso de cambios.

`mode: ensure` crea lo que falta, de forma aditiva, y es el único modo que acepta la
imagen del runtime. `push` se rechaza al arrancar: aplicar cambios en el esquema de las
colecciones es destructivo, y `rebase db push` desde un checkout o CI simula el cambio,
rechaza los destructivos sin confirmación y puede hacer antes una copia de seguridad —
nada de lo cual puede hacer un pod que arranca sin supervisión.

## Lo que el chart se niega a renderizar

Cada uno de estos casos es una configuración que no produce errores en tiempo de
ejecución — el despliegue se inicia y algo deja de funcionar en silencio. En su
lugar, `helm install` falla, indicando el valor que se debe cambiar:

- más de un proceso HTTP con `sharedState.rateLimitStore=memory`
- `functions.enabled` o `worker.enabled` mientras `split=false`
- dos aplicaciones estáticas reclamando la misma ruta, o una reclamando una ruta bajo `/api`
- `bundle.mode=image` mientras `image.repository` sigue siendo la imagen base del runtime
- `ingress.enabled` sin host, o `bundle.mode=url` sin URL
- un `migrationJob.mode` o `sharedState.rateLimitStore` no reconocido
- ningún `config.adminEmail` con el autorregistro desactivado — una release en la que nadie puede
  iniciar sesión. Define los dos valores de administrador, o `config.allowSelfRegistration=true`
  entendiendo que la primera persona que llegue al formulario de registro se convierte en su
  administrador
- un `config.adminPassword` de menos de 12 caracteres, o un `config.adminEmail` cuyo
  dominio no tiene punto. El runtime se niega a crear cualquiera de los dos, en el arranque, y deja la
  misma release bloqueada

## Lo que el chart no puede hacer por ti

**Transmisión (broadcast) en tiempo real y presencia entre réplicas.** El bus de
canales predeterminado del runtime es en memoria, por lo que con más de una réplica
de la API, un suscriptor en un pod no verá una transmisión publicada en otro. La
solución reside en la configuración de tu proyecto, no en el chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Establece `sharedState.channelBusConfigured: true` para confirmar que lo has hecho
— el chart solo lo utiliza para decidir si mostrar una advertencia. Las suscripciones
habituales a colecciones no se ven afectadas; esas viajan a través de Postgres CDC.

El resto de lo que un proceso guarda para sí mismo — archivos locales, subidas
reanudables, la caché de transformación de imágenes, el Explorador de logs —
está listado junto con el ajuste que comparte cada uno en
[Ejecutar más de una instancia](/docs/deployment/multiple-instances/).
