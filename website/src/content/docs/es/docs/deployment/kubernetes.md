---
sourceHash: 00bc3369d6f3db69
title: Kubernetes
sidebar_label: Kubernetes
description: Despliega Rebase en un clúster de Kubernetes con el chart oficial de Helm — uno o varios Deployments, un Job de migración que gestiona el esquema y aplicaciones estáticas en el mismo host.
---

## Visión general

El chart oficial es el equivalente en Kubernetes de la configuración de autoalojamiento
con Docker Compose. Misma idea, misma imagen, mismo bundle: **el runtime es la
imagen, tu proyecto es el bundle y actualizar Rebase es cambiar una etiqueta (tag).**

Se publica como un artefacto OCI junto a la imagen del runtime, y ambos llevan
la misma versión: el chart que despliega el runtime `0.17.3` *es* el chart `0.17.3`,
por lo que solo hay un número que rastrear. Sin `--version` obtendrás la más
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

El chart viene con el autoregistro desactivado, por lo que una versión debe
especificar la cuenta con la que iniciará sesión su operador; de lo contrario, se
iniciará con una tabla de usuarios vacía y sin forma de generar el primer llamador
autenticado. `config.adminPassword` debe tener al menos 12 caracteres y `config.adminEmail`
necesita un punto en su dominio: la ruta de inicio de sesión analiza su cuerpo
con `z.string().email()`, por lo que `admin@localhost` es una cuenta con la que
nadie podría iniciar sesión y el runtime se negará a inicializarla. Ambas son
negativas en tiempo de renderizado en lugar de sorpresas en tiempo de ejecución;
consulta [lo que el chart se niega a renderizar](#lo-que-el-chart-se-niega-a-renderizar).
Inicia sesión y cambia la contraseña; estos valores van a un Secret.

Adminístralos fuera de banda apuntando `existingSecret` a un Secret que contenga
`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` junto con `DATABASE_URL` y el resto.

El chart despliega **únicamente el runtime**. No despliega Postgres: utiliza
CloudNativePG, una base de datos gestionada o tu propio StatefulSet, y apunta
`config.databaseUrl` hacia él. Un chart que también gestionara tu base de datos
se encargaría de tus copias de seguridad y de tu conmutación por error (failover),
lo cual es una promesa mucho mayor que simplemente "ejecutar la aplicación".

> **Madurez.** Se comprueban dos cosas independientes en CI y una tercera no.
> El chart se analiza (lint) y se renderiza contra Helm v4.2.4: cada topología
> documentada en esta página, incluido el comando de instalación anterior, y un
> caso para cada negativa listada a continuación. La imagen del runtime que despliega
> el chart se compila y se arranca contra un Postgres real, en las dos formas en
> que puede llegar un bundle. Lo que **nunca se ha ejecutado es el chart contra
> un clúster en vivo**: nada ha programado estos manifiestos, por lo que los sondeos
> (probes), el orden del Job de migración previo a la instalación y el ingress
> son correctos como YAML pero no han sido probados como despliegue. Trátalo como
> un punto de partida bien probado en lugar de un valor predeterminado contrastado
> en producción, y lee [Autoalojamiento](/docs/deployment/self-hosting) para conocer
> el camino que sí lo está.

Para trabajar desde un repositorio clonado —un chart modificado o una instalación
aislada (air-gapped)— `helm install rebase ./infra/charts/rebase` acepta los mismos
valores.

## Cómo incluir tu proyecto en el pod

| `bundle.mode` | Cómo | Cuándo |
|---|---|---|
| `image` (predeterminado) | Compila `FROM rebasepro/server` con `COPY dist-bundle /bundle`, luego establece `image.repository` | Casi siempre. Un único artefacto, inmutable, sin dependencia en tiempo de ejecución de que una URL permanezca disponible |
| `url` | Imagen base; el runtime descarga un archivo tarball en cada inicio del pod | Un plano de control que entrega bundles fuera de banda |

## Un proceso o varios

El comportamiento predeterminado es un único Deployment que sirve todo, la misma
estructura que ejecuta el archivo Compose. Dividirlo requiere solo un valor:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Esto te proporciona un nivel de `api`, un nivel de `functions` y un `worker`, todos
a partir de la misma imagen y el mismo bundle. Consulta [Procesos divididos](/docs/deployment/split-processes)
para conocer la función de cada rol y por qué convendría separarlos.

Lo que el chart aporta frente a hacerlo manualmente es que **deduce las configuraciones
cuyo modo de fallo es silencioso**, a partir de los valores que ya le has proporcionado:

- `REBASE_ROLE` por unidad: `all` en la api cuando no hay unidad de functions, de modo que aún sirva tus funciones
- `REBASE_MIGRATE_ON_BOOT=none` en todas partes, porque el Job de migración gestiona el esquema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` en la api en cuanto existe un worker
- `TRUSTED_PROXY_HOPS` en la unidad de functions
- `REBASE_RATE_LIMIT_STORE=sql` tan pronto como un segundo proceso sirva HTTP

Un `REBASE_ROLE` incorrecto no sirve HTTP mientras `/health` sigue respondiendo,
por lo que la comprobación de preparación (readiness) pasa y cada solicitud devuelve
un 404. La falta de `REBASE_MIGRATE_ON_BOOT` genera un bucle de reinicios (crash
loop) cuya causa queda en un registro que nadie está mirando. El chart escribe
todos ellos, y `config.env` no puede sobrescribirlos.

### Separar cron de la ejecución de jobs

Dos workers con responsabilidades opuestas: sin nuevos roles y sin código:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## El panel de administración y cualquier otro frontend

Una aplicación estática es la misma imagen del runtime iniciando un bundle con
`kind: static`. Esa ruta se interrumpe antes de que el runtime lea `DATABASE_URL`
o `JWT_SECRET`, por lo que estos pods **no contienen ningún secreto**.

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
y CORS se mantienen exactamente como estaban, y la división sigue siendo una decisión
de topología interna en lugar de un cambio en la superficie pública de tu producto.
El coste es que los recursos deben ser *compilados* para esa ruta, lo cual el
runtime comprueba en el arranque.

Desplegar el panel de administración consiste simplemente en actualizar la etiqueta
de la imagen en un Deployment. El backend no se reinicia.

## Esquema

`migrationJob.enabled` (por defecto) ejecuta un Job de `pre-install,pre-upgrade`
que aprovisiona y finaliza, y cada pod se inicia con `REBASE_MIGRATE_ON_BOOT=none`.
Nada en la ruta de las solicitudes gestiona el esquema de tablas, lo que supone la
respuesta más limpia posible a que "exactamente un proceso aprovisione el esquema";
deja de ser una regla que alguien deba recordar. Los pods aún mantienen actualizadas
en el arranque las tablas propias del framework (autenticación, claves API, jobs, cron);
`provision: false` desactiva esto también, no renderiza ningún Job y delega el esquema
a una [ejecución de aprovisionamiento](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
bajo tu propio proceso de control de cambios.

`mode: ensure` crea lo que falta, de forma acumulativa, y es el único modo que
acepta la imagen del runtime. Se rechaza `push` al arrancar: aplicar cambios en el
esquema de tablas es destructivo, y `rebase db push` desde un repositorio o CI
realiza una prueba previa (dry-run) del cambio, rechaza los cambios destructivos sin
confirmación y puede realizar una copia de seguridad primero, nada de lo cual puede
hacer un pod que se inicia de forma desatendida.

## Lo que el chart se niega a renderizar

Cada una de estas es una configuración que no produce ningún error en tiempo de
ejecución: el despliegue se levanta y algo deja de cumplirse silenciosamente.
En su lugar, `helm install` falla indicando el valor que se debe modificar:

- más de un proceso HTTP con `sharedState.rateLimitStore=memory`
- `functions.enabled` o `worker.enabled` mientras `split=false`
- dos aplicaciones estáticas reclamando la misma ruta, o una reclamando una ruta bajo `/api`
- `bundle.mode=image` mientras `image.repository` siga siendo la imagen base del runtime
- `ingress.enabled` sin host, o `bundle.mode=url` sin URL
- un `migrationJob.mode` o `sharedState.rateLimitStore` no reconocido
- ausencia de `config.adminEmail` con el autoregistro desactivado: una versión a la
  que nadie puede acceder. Establece los dos valores de administración o
  `config.allowSelfRegistration=true`, entendiendo que la primera persona que llegue
  al formulario de registro se convertirá en su administrador
- un `config.adminPassword` con menos de 12 caracteres, o un `config.adminEmail`
  cuyo dominio no contenga un punto. El runtime se negará a inicializar cualquiera
  de los dos en el arranque y dejará el mismo bloqueo de acceso a la versión

## Lo que el chart no puede hacer por ti

**Difusión en tiempo real (broadcast) y presencia entre réplicas.** El bus de
canales por defecto del runtime está en memoria, por lo que con más de una réplica
de API un suscriptor en un pod no verá una difusión publicada en otro. La solución
reside en la configuración de tu proyecto, no en el chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Establece `sharedState.channelBusConfigured: true` para confirmar que lo has hecho;
el chart solo lo utiliza para decidir si debe emitir una advertencia. Las suscripciones
habituales a tablas no se ven afectadas; esas viajan a través de CDC de Postgres.

El resto de lo que un proceso conserva para sí mismo (archivos locales, subidas
reanudables, la caché de transformación de imágenes, el Explorador de Logs) se lista
junto con la configuración para compartir cada uno en [Ejecutar más de una instancia](/docs/deployment/multiple-instances/).
