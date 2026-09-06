---
sourceHash: 03d03e9fa055a194
title: Visão Geral do Frontend
sidebar_label: Frontend
description: Construa e personalize o painel de administração Rebase com React — controllers, scaffold, roteamento e views.
---

## Overview

O frontend Rebase é um **framework React** que renderiza seu painel de administração. Ele lê suas definições de coleção e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel de administração **é** o frontend: ele é servido na raiz da sua URL implantada. Se, em vez disso, você construir a sua própria app de produto, pode montar o admin sob um prefixo como `/admin` na mesma implantação — veja [Alterar a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Os componentes chave que compõem um frontend Rebase:

```tsx
<Rebase
    client={rebaseClient}
    collectionRegistryController={collectionRegistryController}
    urlController={urlController}
    navigationStateController={navigationStateController}
    authController={authController}
>
    {({ loading }) => (
        <Scaffold>
            <AppBar />
            <Drawer title="My App" />
            <Outlet />
            <SideDialogs />
        </Scaffold>
    )}
</Rebase>
```

## O Provedor Rebase

`<Rebase>` é o provedor raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

| Prop | Descrição |
|------|-------------|
| `client` | Instância de `RebaseClient` para dados, autenticação e armazenamento |
| `collectionRegistryController` | Resolve caminhos e configurações de coleção |
| `urlController` | Constrói URLs e gerencia o roteamento |
| `navigationStateController` | Gerencia o estado de navegação, views e plugins |
| `authController` | Estado e métodos de autenticação |
| `storageSource` | Operações de armazenamento de arquivos |
| `userConfigPersistence` | Preferências de UI local (larguras de coluna, etc.) |
| `entityViews` | Abas de view de entidade personalizadas globais |
| `entityActions` | Ações de entidade globais |
| `plugins` | Instâncias de plugins (prop legada — prefira passar via controlador de navegação) |

## Controladores

Controladores são hooks React que configuram aspectos específicos do framework:

### `useBuildNavigationStateController`

O controlador principal que interliga tudo:

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Collection definitions
    views: customViews,                   // Custom navigation views
    plugins,                              // Plugin instances
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

### `useBuildCollectionRegistryController`

Gerencia como as coleções são resolvidas a partir de caminhos de URL:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

### `useBuildUrlController`

Configura a geração de URL:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

### `useBuildModeController`

Gerencia o tema claro/escuro:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

### `useBuildAdminModeController`

Alterna entre os modos Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("studio" | "content")
```

## Componentes Scaffold

| Componente | Descrição |
|-----------|-------------|
| `<Scaffold>` | Contêiner de layout principal com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com pesquisa, alternador de modo, menu do usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de views |
| `<SideDialogs>` | Contêiner para editores de entidade do painel lateral |
| `<RebaseRoutes>` | Contêiner de rotas que se integra com React Router |
| `<RebaseRoute>` | Gerencia rotas de coleção (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão mostrando cartões de coleção |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvedor |

## Views Personalizadas

Adicione views de navegação de nível superior para painéis, ferramentas ou páginas personalizadas:

```tsx
const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        view: <MyDashboard />
    },
    {
        slug: "settings",
        name: "App Settings",
        view: <AppSettings />,
        nestedRoutes: true  // Suporte a sub-caminhos,
        admin: {
            icon: "dashboard",
            group: "Analytics",
            icon: "settings"
        }
    }
];

```

## Estilização

Rebase usa **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Propriedades personalizadas CSS** — Sobrescreva tokens de design
- **`ModeControllerProvider`** — Controle o modo claro/escuro
- **Configuração Tailwind** — Personalização padrão do Tailwind

```css
/* Sobrescrever tokens de design */
:root {
    --font-sans: "Inter", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construa campos de formulário personalizados
- **[Views de Entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidade
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cartões, Kanban
- **[Plugins](/docs/plugins)** — Estenda o framework
---
