---
sourceHash: 8e814603c912d2a1
title: Visão Geral do Frontend
sidebar_label: Frontend
description: Construa e personalize o painel de administração do Rebase com React — controladores, scaffold, roteamento e visualizações.
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel de administração. Ele lê suas definições de coleções e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel de administração **é** o frontend: ele é servido na raiz da sua URL implantada. Se em vez disso você construir seu próprio aplicativo de produto, pode montar o admin sob um prefixo como `/admin` na mesma implantação — veja [Alterar a URL base](/docs/getting-started/deployment#changing-the-base-url).

Isto é o `frontend/src/App.tsx` tal como o `rebase init` o escreve — o painel de
administração inteiro, quatro declarações dentro de um provider:

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

Os três primeiros não renderizam nada: eles *registram* configuração no provider.
O `<RebaseShell>` é o que desenha — ele lê esse registro e constrói a partir dele
a navegação, as rotas e o layout. Portanto a ordem em que aparecem não importa, e
adicionar um recurso significa adicionar um componente, não recabear uma árvore.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | coleções, visualizações personalizadas, a página inicial, o editor de coleções |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvimento (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — ele renderiza o admin a partir de tudo o que está acima |

Tire o `<RebaseStudio>` e você tem um CMS só de conteúdo; tire o `<RebaseCMS>` e
você tem apenas as ferramentas de desenvolvimento. Para diagramar a shell à mão,
veja [Avançado: layout manual](#avançado-layout-manual).

## O Provider Rebase

`<Rebase>` é o provider raiz que disponibiliza toda a funcionalidade do Rebase aos componentes filhos via contexto. Ele aceita:

Todas as vinte e duas, na íntegra — a tabela listava dez, e duas dessas eram
props que o componente nunca leu:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-------------|
| `children` | Os componentes raiz do admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma render function é a saída de emergência para o layout manual. |
| `apiUrl` | URL base da API do backend, disponibilizada a cada hook via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são impressas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial do admin, e o locale em que as datas são formatadas — veja [Traduções](/docs/frontend/i18n) |
| `client` | Instância de `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados extras, para coleções que nomeiam alguma — veja [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui por completo a assinatura de `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, que se sobrepõe a `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além da padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de schema). Apenas o Studio precisa delas |
| `userConfigPersistence` | Preferências locais de UI — larguras de coluna, grupos recolhidos |
| `onAnalyticsEvent` | Chamada para cada evento de analytics que o admin emite |
| `entityLinkBuilder` | Retorna uma URL para o botão «abrir no seu app» de um formulário de entidade |
| `plugins` | Instâncias de plugins — veja [Plugins](/docs/plugins) |
| `slots` | Contribuições de slots declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campo personalizados, indexados pelo nome que uma propriedade indica em `propertyConfig` |
| `entityViews` | Abas globais de visualizações de entidade personalizadas |
| `collectionViews` | Modos de visualização de coleção personalizados, disponíveis a qualquer coleção por `key` |
| `entityActions` | Ações globais de entidade |
| `effectiveRoleController` | Simula um papel diferente enquanto o modo de desenvolvimento está ativo |
| `translations` | Sobrescreve ou estende qualquer string da UI, indexada por locale — veja [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes integrados — veja [Sobrescrita de componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controladores de navegação, URL e registro de coleções **não** são props do
`<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da
árvore do admin (o `<RebaseShell>` os conecta para você no scaffold padrão).

O prefixo da URL também não. Quando o admin é montado sob um caminho, isso
pertence ao `<RebaseCMS basePath="/admin">`, que é o que resolve URLs para
coleções — e apenas quando o roteador não tem um `basename` próprio. Veja
[Alterar a URL base](/docs/getting-started/deployment#changing-the-base-url).

## Duas formas de dados

Há duas camadas de dados, e elas **não** são intercambiáveis. Passar uma onde a
outra é esperada é um erro de tipo, então vale a pena saber disso antes de
conectar um controlador à mão.

| | Forma | Onde você a obtém | Como é uma linha |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — linhas planas | `client.data`, e `context.data` nos callbacks do backend | `row.title` |
| **Admin** | `RebaseData` — view-model `Entity` | `useData()`, dentro da árvore `<Rebase>` | `entity.values.title` |

A camada do SDK é a superfície pública e simétrica: idêntica no cliente do
frontend e nos callbacks do backend. A camada `Entity` é o view-model do admin —
ela acrescenta o invólucro `id` / `path` / `values` contra o qual as
visualizações de coleção e os formulários renderizam. `CollectionAccessor` e
`FindResponse` pertencem a ela e são marcados como `@internal` por essa razão.

O `<Rebase>` é a fronteira entre elas: ele pega o seu `client.data` plano e o
embrulha com `wrapAsEntityData()` antes de fornecê-lo como o `RebaseData` do
admin. Você nunca chama isso — apenas pega a forma de que precisa no lugar certo:

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

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout de
fábrica atrapalha — outra moldura ao redor do admin, uma árvore de rotas própria,
um app em que o admin é uma página entre muitas. Se você não vai substituir o
layout, pare em [Visualizações personalizadas](#visualizações-personalizadas).

O `<RebaseShell>` é açúcar sintático para quatro camadas, e você pode assumi-las
uma de cada vez:

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

A ordem é fixa: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. O `RebaseAuthGate` mostra a tela de login até que exista um
usuário, então nada abaixo dele é renderizado para um visitante deslogado; o
`RebaseNavigation` constrói os controladores de navegação, URL e registro de
coleções que o `RebaseRouteDefs` e toda visualização de coleção leem, de modo que
um `RebaseRouteDefs` fora dele lança uma exceção.

Cada camada é utilizável por si só. O `<RebaseAuthGate>` sozinho coloca o seu
próprio app atrás do login do Rebase. Troque o `<RebaseLayout>` pelo seu próprio
componente para manter o roteamento e perder a moldura; tire também o
`<RebaseRouteDefs>` e você estará construindo as rotas por conta própria a partir
dos componentes em [Componentes do scaffold](#componentes-do-scaffold).

Abaixo desse piso o `<Rebase>` também aceita uma **render prop** em vez de
filhos, que lhe entrega o contexto e a flag de carregamento e deixa a árvore
inteira por sua conta:

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

A essa altura nada está conectado para você: você constrói os controladores
abaixo à mão e renderiza as rotas por conta própria.

### Controladores

Controladores são hooks React que configuram aspectos específicos do framework. O
`<RebaseNavigation>` chama todos eles por você — recorra a estes apenas dentro de
uma render prop.

#### `useBuildNavigationStateController`

O controlador principal que conecta tudo:

O seu `data` é o `RebaseData` **no formato Entity**, então vem de `useData()` —
não de `rebaseClient.data`, que é a camada do SDK com linhas planas. O
`<Rebase>` converte um no outro para você (veja
[Duas formas de dados](#duas-formas-de-dados) acima), portanto este hook precisa
ser chamado dentro da árvore `<Rebase>`.

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

Gerencia como as coleções são resolvidas a partir dos caminhos de URL:

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

Alterna entre os modos Studio e Conteúdo:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes do scaffold

| Componente | Descrição |
|-----------|-------------|
| `<Scaffold>` | Container de layout principal com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, seletor de modo e menu de usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de visualizações |
| `<SideDialogs>` | Container para os editores de entidade em painel lateral |
| `<RebaseRoutes>` | Container de rotas integrado ao React Router |
| `<RebaseRoute>` | Lida com as rotas de coleção (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão mostrando os cartões de coleções |
| `<StudioHomePage>` | Página inicial do modo Studio com as ferramentas de desenvolvimento |

## Visualizações personalizadas

Adicione visualizações de navegação de primeiro nível para dashboards,
ferramentas ou páginas personalizadas. Um `AppView` é um objeto plano — tudo
abaixo fica no nível superior, não há bloco `admin` aninhado:

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

Entregue-as ao `<RebaseCMS>`, ao lado das suas coleções — esse é o componente que
registra a navegação:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho em que ela é alcançada, sob a raiz do admin |
| `name` | o rótulo na gaveta e na página inicial |
| `view` | o elemento a renderizar, ou um `ComponentType` para renderizá-lo de forma diferida |
| `icon` | um nome de ícone do [Lucide](https://lucide.dev/icons/), por ex. `"ShoppingCart"` — ou qualquer nó |
| `group` | agrupa visualizações na gaveta; `"Admin"` e `"Settings"` afundam para o fim |
| `pinToBottom` | afunda o grupo para o fim sob qualquer nome — prefira isto às duas strings mágicas |
| `nestedRoutes` | registra também `slug/*`, para uma visualização com rotas próprias |
| `hideFromNavigation` | mantém a rota, remove a entrada de navegação |
| `roles` | apenas usuários que tenham um destes papéis veem a visualização, ou conseguem alcançá-la |
| `description` | Markdown, exibido no cartão da página inicial |

Para colocar uma visualização sob o **Studio** em vez do CMS, passe-a ao
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

O Rebase usa **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Propriedades personalizadas de CSS** — Sobrescreva os design tokens
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

- **[Campos personalizados](/docs/frontend/custom-fields)** — Crie campos de formulário personalizados
- **[Visualizações de entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidade
- **[Modos de visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cartões, Kanban
- **[Traduções](/docs/frontend/i18n)** — Altere qualquer string, ou adicione um idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
