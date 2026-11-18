---
sourceHash: 79e9278ca30f0078
title: Windows
sidebar_label: Windows
description: Instala un proyecto Rebase y usa sus comandos de base de datos en Windows.
---

**Rebase 0.34+**

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

## Actualizar un proyecto PostgreSQL a Rebase 0.34

Ejecuta la CLI de Rebase 0.34 desde la raíz del proyecto en Linux, macOS o Windows.
Sustituye `@ariga/atlas` por `@stokaro/ptah-compat` en el backend PostgreSQL.
Conserva los archivos de migración, `atlas.sum` y las revisiones registradas.

```bash
pnpm dlx @rebasepro/cli@0.34.0 upgrade --to 0.34.0 # version-pin: ignore
```

## Rebase 0.33 y anteriores

```powershell
$dir = "$env:LOCALAPPDATA\Programs\atlas"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://release.ariga.io/atlas/atlas-windows-amd64-v1.2.3.exe -OutFile "$dir\atlas.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Abre una nueva terminal para que reconozca el nuevo `PATH` y verifícalo:

```powershell
atlas version
```

La versión 1.2.3 es la versión más antigua que acepta el scaffold (`"@ariga/atlas": "^1.2.3"`).
En Linux y macOS la instalación toma la versión 1.x más reciente, por lo que cualquier versión 1.x
posterior también funciona aquí: cambia la versión en la URL. Solo se publica una compilación x64;
Windows en Arm la ejecuta bajo emulación.

La CLI busca primero en `node_modules/.bin` y luego consulta a Windows (`where atlas`),
por lo que una vez que `atlas.exe` está en el `PATH`, los tres comandos lo encontrarán:

```bash
pnpm run db:push
```

[`rebase doctor`](/docs/cli/#rebase-doctor) también lo comprueba. Hasta que `atlas.exe` esté en el `PATH`, mostrará
una advertencia y enlazará a esta página.

### Si falla la instalación de un proyecto anterior

Si la instalación de un proyecto anterior falla con `ELIFECYCLE`, mueve
`@ariga/atlas` de `dependencies` a `optionalDependencies` en
`backend/package.json`. Ejecuta `pnpm install` e instala `atlas.exe` como se
indica arriba.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) es una alternativa
si prefieres desarrollar en Linux. Guarda el proyecto en el sistema de
archivos de Linux (`~/code/my-app`) para acelerar la instalación y la
observación de archivos.

Continúa con el [inicio rápido](/docs/getting-started/quickstart/) o la
[guía de comandos de base de datos](/docs/cli/database/).
