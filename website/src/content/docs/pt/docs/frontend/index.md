---
sourceHash: 6c59cbcf5c1ee91f
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controllers, scaffold, roteamento e views."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza o seu painel de administração. Ele lê as definições das suas coleções e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel de administração **é** o frontend: ele é servido na raiz da sua URL de deploy. Se, em vez disso, você construir o seu próprio aplicativo de produto, poderá montar o painel de administração sob um prefixo como `/admin` no mesmo deploy — consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Este é o `frontend/src/App.tsx` como o `rebase init` o gera — todo o painel de administração, quatro declarações dentro de um único provider:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            {/* Sign-in screen. Pass `loginView` to replace it. */}
            <RebaseAuth/>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Os três primeiros não renderizam nada: eles *registram* configurações no provider. O `<RebaseShell>` é o que desenha — ele lê esse registro e constrói a navegação, as rotas e o layout a partir dele. Portanto, a ordem em que aparecem não importa, e adicionar uma funcionalidade significa adicionar um componente, não reestruturar uma árvore inteira.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | coleções, views personalizadas, a página inicial, o editor de coleções |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza a administração a partir de tudo acima |

Remova o `<RebaseStudio>` e você terá um CMS apenas de conteúdo; remova o `<RebaseCMS>` e você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, consulte [Avançado: layout manual](#avançado-layout-manual).

## O Provider Rebase

`<Rebase>` é o provider raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via context. Ele aceita:

Todas as vinte e duas, na íntegra — a tabela costumava listar dez, e duas delas eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-------------|
| `children` | Os componentes raiz da administração — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a válvula de escape para layout manual. |
| `apiUrl` | URL base da API de backend, disponibilizada para todos os hooks via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial da administração e o locale no qual as datas são formatadas — consulte [Traduções](/docs/frontend/i18n) |
| `client` | Instância de `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados adicionais, para coleções que especificam uma — consulte [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui completamente a inscrição de `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, substituindo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além da padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de schema). Apenas o Studio precisa disso |
| `userConfigPersistence` | Preferências locais de UI — larguras de coluna, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics emitido pelo admin |
| `entityLinkBuilder` | Retorna uma URL para o botão "abrir no seu aplicativo" em um formulário de entidade |
| `plugins` | Instâncias de plugins — consulte [Plugins](/docs/plugins) |
| `slots` | Contribuições de slot declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados pelo nome que uma propriedade define em `propertyConfig` |
| `entityViews` | Abas globais personalizadas de visualização de entidade |
| `collectionViews` | Modos personalizados de visualização de coleção, disponíveis para qualquer coleção por `key` |
| `entityActions` | Ações globais de entidade |
| `effectiveRoleController` | Simula um papel (role) diferente enquanto o modo de desenvolvimento está ativo |
| `translations` | Substitui ou estende qualquer string da UI, indexada por locale — consulte [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes integrados — consulte [Substituição de Componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controllers de navegação, URL e registro de coleções **não** são props de `<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da árvore de administração (`<RebaseShell>` os conecta para você no scaffold padrão).

O prefixo de URL também não é. Quando a administração é montada sob um caminho, isso pertence a `<RebaseCMS basePath="/admin">`, que é o que resolve URLs para coleções — e apenas quando o roteador não possui um `basename` próprio. Consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

## Dois formatos de dados

Existem duas camadas de dados e elas **não** são intercambiáveis. Passar uma onde a outra é esperada resultará em um erro de tipo, por isso vale a pena saber disso antes de conectar um controller manualmente.

| | Formato | Onde você o obtém | Como uma linha se parece |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — linhas simples (flat) | `client.data`, e `context.data` em callbacks do backend | `row.title` |
| **Admin** | `RebaseData` — view-model de `Entity` | `useData()`, dentro da árvore `<Rebase>` | `entity.values.title` |

A camada do SDK é a superfície pública e simétrica: idêntica no cliente frontend e nos callbacks do backend. A camada de `Entity` é a view-model da administração — ela adiciona o invólucro de `id` / `path` / `values` com o qual as visualizações de coleções e formulários trabalham para renderizar. `CollectionAccessor` e `FindResponse` pertencem a ela e são marcados como `@internal` por essa razão.

`<Rebase>` é a fronteira entre elas: ele recebe seus dados planos de `client.data` e os envolve com `wrapAsEntityData()` antes de fornecê-los como o `RebaseData` da administração. Você nunca chama isso diretamente — basta obter o formato necessário do lugar correto:

```tsx
// Flat rows — anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Entity view-model — inside the <Rebase> tree only.
// `data.posts` also works at runtime; `collection()` is the typed accessor.
const data = useData();
const { data: entities } = await data.collection("posts").find();
entities[0].values.title;
```

## Avançado: layout manual

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout padrão estiver no caminho — uma interface visual (chrome) diferente ao redor da administração, uma árvore de rotas própria, um aplicativo onde a administração é apenas uma página entre várias. Se você não estiver substituindo o layout, pare em [Views Personalizadas](#views-personalizadas).

`<RebaseShell>` é uma simplificação para quatro camadas, e você pode utilizá-las uma de cada vez:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>

    {/* login screen until there is a user */}
    <RebaseAuthGate>
        {/* builds the navigation, URL and collection-registry controllers */}
        <RebaseNavigation>
            {/* the admin's routes, drawn inside the layout you pass */}
            <RebaseRouteDefs layout={<RebaseLayout title="My App"/>}/>
        </RebaseNavigation>
    </RebaseAuthGate>
</Rebase>
```

A ordem é fixa: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. O `RebaseAuthGate` exibe a tela de login até que haja um usuário autenticado, de modo que nada abaixo dele seja renderizado para um visitante não logado; o `RebaseNavigation` constrói os controllers de navegação, URL e registro de coleções lidos por `RebaseRouteDefs` e por todas as visualizações de coleção, portanto, usar `RebaseRouteDefs` fora dele causará um erro.

Cada camada pode ser usada individualmente. Apenas o `<RebaseAuthGate>` protege seu próprio aplicativo com o login do Rebase. Troque `<RebaseLayout>` pelo seu próprio componente para manter o roteamento e remover a interface externa; remova também `<RebaseRouteDefs>` e você construirá as rotas por conta própria a partir dos componentes em [Componentes de Scaffold](#componentes-de-scaffold).

Abaixo desse nível, o `<Rebase>` também aceita uma **render prop** em vez de filhos (children), o que entrega a você o context e a flag de loading, deixando toda a árvore sob sua responsabilidade:

```tsx
<Rebase client={rebaseClient} authController={authController}>
    {({ context, loading }) => (
        <Scaffold>
            <AppBar/>
            <Drawer title="My App"/>
            <Outlet/>
            <SideDialogs/>
        </Scaffold>
    )}
</Rebase>
```

Nesse ponto, nada é conectado para você: você constrói os controllers abaixo manualmente e renderiza as rotas você mesmo.

### Controllers

Controllers são hooks do React que configuram aspectos específicos do framework. O `<RebaseNavigation>` chama todos eles para você — recorra a estes apenas dentro de uma render prop.

#### `useBuildNavigationStateController`

O controller principal que conecta tudo:

Seu `data` é o `RebaseData` **no formato de Entity**, portanto vem de `useData()` — e não de `rebaseClient.data`, que é a camada plana do SDK. O `<Rebase>` converte um no outro para você (consulte [Dois formatos de dados](#dois-formatos-de-dados) acima), portanto este hook deve ser chamado dentro da árvore `<Rebase>`.

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

#### `useBuildCollectionRegistryController`

Gerencia como as coleções são resolvidas a partir de caminhos de URL:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

#### `useBuildUrlController`

Configura a geração de URLs:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Gerencia o tema claro/escuro:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

#### `useBuildAdminModeController`

Alterna entre os modos Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descrição |
|-----------|-------------|
| `<Scaffold>` | Container principal de layout com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, alternador de tema e menu do usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de visualização |
| `<SideDialogs>` | Container para editores de entidade em painel lateral |
| `<RebaseRoutes>` | Container de rotas que se integra com o React Router |
| `<RebaseRoute>` | Trata rotas de coleções (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão exibindo cards das coleções |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvedor |

## Views Personalizadas

Adicione views de navegação de nível superior para painéis (dashboards), ferramentas ou páginas personalizadas. Um `AppView` é um objeto plano — tudo abaixo fica no nível superior, não há nenhum bloco `admin` aninhado:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        icon: "LayoutDashboard",
        view: <MyDashboard/>
    },
    {
        slug: "settings",
        name: "App Settings",
        icon: "Settings",
        group: "Admin",
        // Register `settings/*` too, so the view can route inside itself.
        nestedRoutes: true,
        // Reachable by URL, but not listed in the drawer.
        hideFromNavigation: true,
        view: <AppSettings/>
    }
];
```

Passe-as para o `<RebaseCMS>`, ao lado de suas coleções — esse é o componente que registra a navegação:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho pelo qual ela é acessada, sob a raiz da administração |
| `name` | o rótulo no drawer e na página inicial |
| `view` | o elemento a ser renderizado, ou um `ComponentType` para renderizá-lo de forma preguiçosa (lazy) |
| `icon` | um nome de ícone do [Lucide](https://lucide.dev/icons/), por exemplo, `"ShoppingCart"` — ou qualquer nó |
| `group` | agrupa visualizações no drawer; `"Admin"` e `"Settings"` vão para o final |
| `pinToBottom` | fixa o grupo na parte inferior sob qualquer nome — prefira isso em vez das duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para uma visualização com rotas próprias |
| `hideFromNavigation` | mantém a rota, mas remove a entrada da navegação |
| `roles` | apenas usuários com um desses papéis (roles) veem a view ou podem acessá-la |
| `description` | Markdown, exibido no card da página inicial |

Para colocar uma visualização no **Studio** em vez do CMS, passe-a para [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilização

O Rebase utiliza **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Propriedades customizadas de CSS (CSS custom properties)** — Sobrescreva design tokens
- **`ModeControllerProvider`** — Controle o modo claro/escuro
- **Configuração do Tailwind** — Personalização padrão do Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Crie campos de formulário personalizados
- **[Views de Entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidade
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
- **[Traduções](/docs/frontend/i18n)** — Altere qualquer string ou adicione um idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
