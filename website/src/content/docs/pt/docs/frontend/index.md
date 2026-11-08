---
sourceHash: f04fd00564e10891
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controllers, scaffold, roteamento e views."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel de administração. Ele lê as definições de suas coleções e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel de administração **é** o frontend: ele é servido na raiz da sua URL de deploy. Se você construir seu próprio aplicativo de produto, poderá montar a administração sob um prefixo como `/admin` na mesma implantação — consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Este é o `frontend/src/App.tsx` como o `rebase init` o cria, sem suas importações de fontes, error boundary e id de cliente do Google — todo o painel de administração, quatro declarações dentro de um único provider:

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

Os três primeiros não renderizam nada: eles *registram* configurações no provider. O `<RebaseShell>` é quem desenha — ele lê esse registro e constrói a navegação, rotas e layout a partir dele. Portanto, a ordem em que aparecem não importa, e adicionar uma funcionalidade significa adicionar um componente, não refazer a estrutura de uma árvore.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | coleções, views personalizadas, a página inicial, o editor de coleções |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — ele renderiza a administração a partir de tudo acima |

Remova o `<RebaseStudio>` e você terá um CMS apenas de conteúdo; remova o `<RebaseCMS>` e você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, consulte [Avançado: layout manual](#advanced-manual-layout).

## O Provider Rebase

O `<Rebase>` é o provider raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

Todas as vinte e três props, na íntegra — a tabela costumava listar dez, e duas delas eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-----------|
| `children` | Os componentes raiz da administração — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a válvula de escape para layout manual. |
| `apiUrl` | URL base da API backend, disponibilizada para cada hook via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial da administração e o locale no qual as datas são formatadas — consulte [Traduções](/docs/frontend/i18n) |
| `client` | Instância do `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados adicionais, para coleções que especificam uma — consulte [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui completamente a assinatura de `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, substituindo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além do padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de esquema). Apenas o Studio precisa disso |
| `userConfigPersistence` | Preferências locais de UI — larguras de colunas, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics que a administração emite |
| `entityLinkBuilder` | Retorna uma URL para o botão "abrir no seu app" em um formulário de entidade |
| `plugins` | Instâncias de plugins — consulte [Plugins](/docs/plugins) |
| `slots` | Contribuições de slots declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados pelo nome que uma propriedade define em `propertyConfig` |
| `entityViews` | Abas de visualização de entidade personalizadas, disponíveis para qualquer coleção que indique sua `key` em `admin.entityViews` |
| `collectionViews` | Modos de visualização de coleção personalizados, disponíveis para qualquer coleção por `key` |
| `entityActions` | Ações de entidade, disponíveis para qualquer coleção que indique sua `key` em `admin.entityActions` |
| `effectiveRoleController` | Simula uma role diferente enquanto o modo de desenvolvimento estiver ativo |
| `modeController` | Passa o modo claro/escuro do aplicativo hospedeiro para o Rebase; o Rebase então nunca altera `<html>`, `prefers-color-scheme` ou localStorage — consulte [Estilização](#styling) |
| `translations` | Sobrescreve ou estende qualquer string da UI, indexada por locale — consulte [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes internos — consulte [Substituições de Componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controllers de navegação, URL e registro de coleções **não** são props de `<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da árvore da administração (`<RebaseShell>` os conecta para você no scaffold padrão).

Nem o prefixo de URL. Quando a administração é montada sob um caminho, isso pertence a `<RebaseCMS basePath="/admin">`, que é o que resolve URLs para coleções — e apenas quando o router não possui um `basename` próprio. Consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

## Dois formatos de dados

Existem duas camadas de dados, e elas **não** são intercambiáveis. Passar uma onde a outra é esperada é um erro de tipo, então vale a pena saber disso antes de conectar um controller manualmente.

| | Formato | Onde você o obtém | Como uma linha se parece |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — linhas planas | `client.data`, e `context.data` em callbacks do backend | `row.title` |
| **Admin** | `RebaseData` — view-model de `Entity` | `useData()`, dentro da árvore de `<Rebase>` | `entity.values.title` |

A camada do SDK é a superfície pública e simétrica: idêntica no cliente frontend e nos callbacks do backend. A camada `Entity` é o view-model da administração — ela adiciona o wrapper com `id` / `path` / `values` com base no qual as views e formulários de coleções são renderizados. `CollectionAccessor` e `FindResponse` pertencem a ela e são marcados como `@internal` por esse motivo.

O `<Rebase>` é a fronteira entre elas: ele recebe seus dados planos de `client.data` e os envolve com `wrapAsEntityData()` antes de fornecê-los como o `RebaseData` da administração. Você nunca chama isso diretamente — apenas obtém o formato necessário do lugar correto:

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

## Uma coleção ou um registro em uma página própria

Você não precisa de toda a administração para exibir uma única tabela. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` e `<FieldValue>` funcionam em qualquer lugar sob `<Rebase>` e um router do React Router, sem `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`: uma coleção com as colunas e a barra de ferramentas que você escolher, o formulário de um registro com apenas alguns campos ou seu próprio layout, um registro somente leitura ou um valor desenhado exatamente como a administração o desenha. Consulte [Painéis em uma página própria](/docs/frontend/panels).

## Avançado: layout manual

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout padrão for um obstáculo — uma moldura visual diferente ao redor da administração, uma árvore de rotas própria, um aplicativo onde a administração é uma página entre várias. Se você não estiver substituindo o layout, pare em [Views Personalizadas](#custom-views).

O `<RebaseShell>` é um atalho sintático para quatro camadas, e você pode utilizá-las uma de cada vez:

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

A ordem é fixa: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. O `RebaseAuthGate` exibe a view de login até que haja um usuário, portanto nada abaixo dele é renderizado para um visitante desconectado; o `RebaseNavigation` constrói os controllers de navegação, URL e registro de coleções que o `RebaseRouteDefs` e cada view de coleção leem, portanto o `RebaseRouteDefs` fora dele lança um erro. Para incorporar uma view de coleção ou um formulário de registro em uma página própria, sem as rotas da administração, o mais leve `CollectionsProvider` constrói esses controllers em vez disso — consulte [Painéis em uma página própria](/docs/frontend/panels).

Cada camada pode ser usada individualmente. O `<RebaseAuthGate>` sozinho protege seu próprio aplicativo com o login do Rebase. Troque `<RebaseLayout>` pelo seu próprio componente para manter o roteamento e remover a moldura padrão; remova `<RebaseRouteDefs>` também e você estará construindo as rotas manualmente a partir dos componentes em [Componentes de Scaffold](#scaffold-components).

Abaixo desse nível, o `<Rebase>` também aceita uma **render prop** em vez de children, fornecendo o contexto e a flag de carregamento e deixando a árvore inteira por sua conta:

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

Nesse ponto, nada é conectado automaticamente para você: você constrói os controllers abaixo manualmente e renderiza as rotas você mesmo.

### Controllers

Controllers são hooks do React que configuram aspectos específicos do framework. O `<RebaseNavigation>` chama todos eles para você — recorra a estes apenas dentro de uma render prop.

#### `useBuildNavigationStateController`

O controller principal que conecta tudo:

Seu `data` é o `RebaseData` **no formato de Entity**, portanto ele vem de `useData()` — e não de `rebaseClient.data`, que é a camada do SDK de linhas planas. O `<Rebase>` converte um no outro para você (consulte [Dois formatos de dados](#two-data-shapes) abaixo), portanto este hook deve ser chamado dentro da árvore de `<Rebase>`.

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

Gerencia o tema claro/escuro. Enquanto habilitado, ele controla o tema da página: adiciona a classe `dark` ao `<html>`, segue o `prefers-color-scheme` até que o usuário escolha um modo e memoriza essa escolha no localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

O `<Rebase>` constrói um desses internamente.

Quando o componente que o utiliza é desmontado, ele remove a classe `dark` que adicionou; uma classe `dark` que a página já possuía permanece. Construa o seu próprio acima de `<Rebase>` apenas quando componentes fora dele também precisarem do modo, e passe-o com a [prop `modeController`](#styling), para que haja apenas um controller e não dois. `useBuildModeController({ enabled: false })` constrói um controller inerte: ele mantém `mode` no estado do React e não mexe em nenhuma classe, media query ou localStorage. Quando seu aplicativo já controla o tema, você não precisa deste hook: passe seu próprio controller como `modeController`.

#### `useBuildAdminModeController`

Alterna entre os modos Studio e Conteúdo:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descrição |
|-----------|-----------|
| `<Scaffold>` | Contêiner de layout principal com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, alternador de modo e menu de usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de views |
| `<SideDialogs>` | Contêiner para editores de entidades em painéis laterais |
| `<RebaseRoutes>` | Contêiner de rotas que se integra com o React Router |
| `<RebaseRoute>` | Manipula rotas de coleção (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão exibindo cards de coleções |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvedor |

## Views Personalizadas

Adicione views de navegação de nível superior para dashboards, ferramentas ou páginas personalizadas. Um `AppView` é um objeto plano — tudo abaixo fica no nível superior, não há nenhum bloco `admin` aninhado:

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

Passe-os para o `<RebaseCMS>`, junto com suas coleções — esse é o componente que registra a navegação:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho pelo qual é acessado, sob a raiz da administração |
| `name` | o rótulo no drawer e na página inicial |
| `view` | o elemento a ser renderizado, ou um `ComponentType` para renderizá-lo de forma lazy |
| `icon` | um nome de ícone do [Lucide](https://lucide.dev/icons/), ex.: `"ShoppingCart"` — ou qualquer nó |
| `group` | agrupa views no drawer; `"Admin"` e `"Settings"` vão para o final |
| `pinToBottom` | fixa o grupo na parte inferior sob qualquer nome — prefira isso em vez das duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para uma view com rotas próprias |
| `hideFromNavigation` | mantém a rota, mas remove a entrada da navegação |
| `roles` | apenas usuários com uma dessas roles podem ver a view ou acessá-la |
| `description` | Markdown, exibido no card da página inicial |

Para colocar uma view sob o **Studio** em vez do CMS, passe-a para [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilização

O Rebase usa o **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Custom properties de CSS** — Sobrescreva design tokens
- **`<Rebase modeController>`** — Passe o modo claro/escuro do seu aplicativo para o Rebase
- **Configuração do Tailwind** — Personalização padrão do Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modo claro e escuro

Por padrão, o `<Rebase>` controla o tema da página: ele adiciona a classe `dark` ao `<html>`, segue o `prefers-color-scheme` até que o usuário escolha um modo na administração e memoriza essa escolha no localStorage.

Quando o `<Rebase>` é desmontado, ele remove a classe `dark` que adicionou; uma classe que a página já possuía permanece. Na versão 0.24, a classe é mantida.

Quando seu aplicativo já possuir um tema, passe-o como `modeController`. O Rebase lerá o `mode` dele, chamará seu `setMode` a partir de seu próprio alternador de tema e nunca mexerá em `<html>`, `prefers-color-scheme` ou localStorage:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, type ModeController } from "@rebasepro/app";

export function App() {
    const [mode, setMode] = useState<"light" | "dark">("light");
    const modeController = useMemo<ModeController>(() => ({
        mode,
        setMode: (next) => setMode(next === "dark" ? "dark" : "light")
    }), [mode]);

    // Your app applies the mode, as it does for the rest of the page.
    useEffect(() => {
        document.documentElement.classList.toggle("dark", mode === "dark");
    }, [mode]);

    return (
        <Rebase client={client} modeController={modeController}>
            <MyAdmin/>
        </Rebase>
    );
}
```

O CSS do scaffold estiliza o modo escuro sob qualquer elemento com a classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Painéis laterais, diálogos e menus renderizam em um portal no `<body>`, portanto coloque a classe em `<html>` ou `<body>` em vez de em um wrapper ao redor de `<Rebase>`.

Envolver o `<Rebase>` em um `ModeControllerProvider` não faz isso: o `<Rebase>` fornece um controller próprio internamente. Na versão 0.24, essa prop não existe e não há como passar o modo do seu aplicativo para o `<Rebase>`.

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construa campos de formulário personalizados
- **[Views de Entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidades
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
- **[Traduções](/docs/frontend/i18n)** — Altere qualquer string ou adicione um idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
