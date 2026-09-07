---
sourceHash: 4d7e2205e3aed6fc
title: Desplegando Rebase en Railway
description: Despliegue Rebase sin esfuerzo con el análisis de Dockerfile compatible con Railway de forma nativa. Manteniendo el enfoque en la UE.
sidebar_label: Railway
---

Railway es un PaaS (Plataforma como Servicio) moderno increíblemente popular que elimina las complejidades de DevOps. Detectará automáticamente el framework Rebase Node y lo construirá sin problemas.

Además, Railway es totalmente compatible con las regiones de despliegue europeas (Ámsterdam), lo que significa que seguirá disfrutando de un estricto cumplimiento del alojamiento regional.

## 1. Crear un Proyecto y Región de la UE
1. Inicie sesión en su [Cuenta de Railway](https://railway.app/).
2. Haga clic en **Nuevo Proyecto**.
3. Vaya a **Configuración -> Región predeterminada**, y configúrela explícitamente en **Europa (Ámsterdam)**. (Si hace esto *después* de crear servicios, es posible que deba migrarlos manualmente).

## 2. Aprovisionar PostgreSQL
1. Dentro de su proyecto, haga clic en **Nuevo** -> **Base de datos** -> **Añadir PostgreSQL**.
2. Espere unos segundos a que la base de datos se aprovisione.
3. Por defecto, Railway proporciona una variable interna `DATABASE_URL`. Haga clic en el widget de Postgres -> **Variables** para localizar esta cadena de conexión.

## 3. Desplegar el Código de Rebase
1. Haga clic en **Nuevo** -> **Repositorio de GitHub**.
2. Seleccione su repositorio de Rebase.
3. Railway detectará inmediatamente el repositorio y buscará un `Dockerfile`. Espere a que comience la construcción inicial.

:::caution
**No hay ninguna imagen de aplicación que construir a partir de tu código**. `rebase build` produce un directorio `dist-bundle` con tus colecciones, funciones y crons compilados y —si tu proyecto declara una app estática— tu frontend construido. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Railway extrae desde un registro, así que hornea el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Actualizar Rebase más adelante es un cambio en esa línea `FROM`. Tu bundle queda intacto.
:::

## 4. Establecer Variables de Entorno
La construcción inicial podría fallar porque le falta completamente la configuración. Vamos a solucionar eso.

1. Haga clic en la nueva tarjeta de servicio de Rebase GitHub.
2. Vaya a la pestaña **Variables**.
3. Haga clic en **Nueva Variable** y añada:
   - `JWT_SECRET`: Genere una cadena aleatoria segura de 32 o más caracteres.
   - `NODE_ENV`: Establezca en `production`
4. Haga clic en **Referenciar Variable** y seleccione `DATABASE_URL` del servicio PostgreSQL que aprovisionó. Railway inyectará de forma segura la URL interna de Postgres en tiempo de ejecución.

## 5. Crear el Esquema de la Base de Datos

Al arrancar, Rebase crea automáticamente **solo las tablas de autenticación**. Las tablas de sus propias colecciones **no se crean automáticamente**. Debe aplicar el esquema una vez contra la base de datos de producción:

```bash
pnpm run db:push
```

Si omite este paso, la aplicación arranca con normalidad y el inicio de sesión funciona —esa es la trampa—, pero cada colección devuelve un error de «tabla inexistente» (*missing table*) en su primera consulta.

Ejecútelo desde un checkout del proyecto o desde CI con `DATABASE_URL` apuntando a la base de datos de producción, **no dentro del contenedor**: la imagen de producción se distribuye sin la CLI. Use la cadena de conexión pública de su servicio de PostgreSQL en Railway (la variable `DATABASE_PUBLIC_URL`, en la pestaña **Variables**) para poder ejecutarlo desde su máquina local; la `DATABASE_URL` interna solo es accesible dentro de la red de Railway.

Para migraciones versionadas, use `pnpm run db:generate` + `pnpm run db:migrate` en lugar de `pnpm run db:push`.

## 6. Exponer el Dominio
1. En la tarjeta de servicio de Rebase, navegue hasta la pestaña **Configuración**.
2. Desplácese hasta **Redes**.
3. En **Redes Públicas**, haga clic en **Generar Dominio**. Railway proporcionará una URL de prueba `.up.railway.app`. También puede adjuntar de forma segura un Dominio Personalizado aquí.

Railway se reconstruirá automáticamente de forma segura. ¡Su plataforma alojada en la UE ya está completamente en línea!

---
