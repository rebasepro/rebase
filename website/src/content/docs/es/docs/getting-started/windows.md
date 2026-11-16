---
sourceHash: ce9b9cd9e35c5c3d
title: Windows
sidebar_label: Windows
description: Instala un proyecto Rebase y usa sus comandos de base de datos en Windows.
---

Los proyectos Rebase funcionan en Windows. El proyecto generado instala
Ptah Compat y su ejecutable para Windows mediante el gestor de paquetes.
No necesitas descargar otra herramienta de migración.

## Crear un proyecto

Instala Node.js 22.22+ y pnpm. Después, ejecuta:

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
pnpm dev
```

Los comandos de base de datos usan el paquete Ptah Compat instalado:

```bash
pnpm run db:push
pnpm run db:generate
pnpm run db:migrate
```

El paquete ofrece ejecutables nativos para Windows x64 y Arm64. Si
[`rebase doctor`](/docs/cli/#rebase-doctor) indica que falta el ejecutable,
reinstala las dependencias del proyecto con las dependencias opcionales
habilitadas.

## Actualizar un proyecto anterior

Los proyectos creados antes de la integración de Ptah pueden seguir
dependiendo de `@ariga/atlas`. Al pasar a una versión de Rebase que use
Ptah Compat, ejecuta `rebase upgrade`. La actualización sustituye esa
dependencia por `@stokaro/ptah-compat`. Después, ejecuta `pnpm install`.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) es una alternativa
si prefieres desarrollar en Linux. Guarda el proyecto en el sistema de
archivos de Linux (`~/code/my-app`) para acelerar la instalación y la
observación de archivos.

Continúa con el [inicio rápido](/docs/getting-started/quickstart/) o la
[guía de comandos de base de datos](/docs/cli/database/).
