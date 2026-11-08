---
sourceHash: 758100d13ca5c533
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controladores, scaffold, roteamento e visualizações."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel administrativo. Ele lê as definições de suas coleções e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel administrativo **é** o frontend: ele é servido na raiz do seu URL de deploy. Se você construir sua própria aplicação de produto em vez disso, poderá montar o painel sob um prefixo como `/admin` no mesmo deploy — consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Este é o `frontend/src/App.tsx` conforme o `rebase init` o cria, sem suas importações de fontes, error boundary e id de cliente Google — todo o painel administrativo em quatro declarações dentro de um único provider:

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

Os três primeiros não renderizam nada: eles *registram* configurações no provider. `<RebaseShell>` é o que realmente renderiza na tela — ele lê esse registro e constrói a navegação, as rotas e o layout a partir dele. Portanto, a ordem em que aparecem não importa, e adicionar um recurso significa adicionar um componente, sem precisar reestruturar uma árvore inteira.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | coleções, visualizações personalizadas, a página inicial, o editor de coleções |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza a administração a partir de tudo acima |

Remova o `<RebaseStudio>` e você terá um CMS apenas de conteúdo; remova o `<RebaseCMS>` e você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, consulte [Avançado: layout manual](#avançado-layout-manual).

## O Provider Rebase

O `<Rebase>` é o provider raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

Todas as vinte e três, na íntegra — a tabela costumava listar dez, e duas delas eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-----------|
| `children` | Os componentes raiz do admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a válvula de escape para layout manual. |
| `apiUrl` | URL base da API do backend, disponibilizada para cada hook via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial do admin e a localidade na qual as datas são formatadas — consulte [Traduções](/docs/frontend/i18n) |
| `client` | Instância do `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados adicionais, para coleções que especificam uma — consulte [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui completamente a subscription de `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, substituindo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além da padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de esquema). Apenas o Studio precisa disso |
| `userConfigPersistence` | Preferências locais de UI — larguras de colunas, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics que o admin emite |
| `entityLinkBuilder` | `({ row, id, path }) => string`: o URL para o botão "abrir no seu app" em um registro, a partir do registro como o servidor envia a linha |
| `plugins` | Instâncias de plugins — consulte [Plugins](/docs/plugins) |
| `slots` | Contribuições de slots declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campos customizados, indexados pelo nome definido por uma propriedade em `propertyConfig` |
| `entityViews` | Abas de visualização de entidade customizadas, disponíveis para qualquer coleção que indique sua `key` em `admin.entityViews` |
| `collectionViews` | Modos de visualização de coleção customizados, disponíveis para qualquer coleção por `key` |
| `entityActions` | Ações de entidade, disponíveis para qualquer coleção que indique sua `key` em `admin.entityActions` |
| `effectiveRoleController` | Simula uma role diferente enquanto o modo dev estiver ativo |
| `modeController` | Transfere o controle do modo claro/escuro da aplicação hospedeira para o Rebase; o Rebase então nunca toca em `<html>`, `prefers-color-scheme` ou localStorage — consulte [Estilização](#estilização) |
| `translations` | Sobrescreve ou estende qualquer string da UI, indexada por locale — consulte [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes integrados — consulte [Substituições de Componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controladores de navegação, URL e registro de coleções **não** são props do `<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da árvore do admin (`<RebaseShell>` conecta-os para você no scaffold padrão).

O prefixo de URL também não é. Quando o admin é montado sob um caminho, isso pertence a `<RebaseCMS basePath="/admin">`, que é o que resolve URLs para coleções — e somente quando o roteador não possui um `basename` próprio. Consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

## Um formato de dados único

Seu código obtém linhas exatamente como o servidor as envia, onde quer que solicite: `client.data`, `context.data` (tanto em um callback de backend quanto no navegador), `useRows`, `useRow` e `useRowWrites`, o `data` dos construtores de coleção e visualização, e o que é passado para os `browserCallbacks` de uma coleção. Uma linha é um objeto plano: `row.title`, uma data como sua string ISO, um belongsTo como sua coluna de chave estrangeira.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

O admin em si renderiza um view model `Entity` — o invólucro de `id` / `path` / `values` do qual suas visualizações de coleção e formulários se baseiam, com datas como instâncias de `Date` e uma relação como um `EntityRelation`. Essa camada é própria do admin e não faz parte da superfície pública: uma ação de entidade, um resolvedor de exibição, o `tableController.rows` do `Builder` de um modo de visualização, a seleção de uma ação de coleção e um slot recebem todos linhas comuns. Você só lida com `Entity` em uma cópia de uma das próprias partes do admin (`Collection.Table`, um card), que recebe o registro como o admin o desenha. Os valores de um formulário são os do editor: `Date`s e relações, conforme um campo os edita.

## Uma coleção ou um registro em uma página própria

Você não precisa de todo o admin para exibir uma única tabela. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` e `<FieldValue>` funcionam em qualquer lugar sob `<Rebase>` e um roteador React Router, sem necessidade de `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`: uma coleção com as colunas e a barra de ferramentas que você escolher, o formulário de um registro com apenas alguns campos ou seu próprio layout, um registro somente leitura ou um único valor renderizado como o admin o renderiza. Consulte [Painéis em uma página própria](/docs/frontend/panels).

## Avançado: layout manual

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout padrão for um obstáculo — uma estrutura de interface diferente ao redor do admin, uma árvore de rotas própria, um aplicativo onde o admin é apenas uma página entre muitas. Se você não estiver substituindo o layout, pare em [Visualizações Personalizadas](#visualizações-personalizadas).

`<RebaseShell>` é um atalho sintático para quatro camadas, e você pode utilizá-las uma de cada vez:

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

A ordem é fixa: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. O `RebaseAuthGate` exibe a tela de login até que haja um usuário, de modo que nada abaixo dele seja renderizado para um visitante não autenticado; o `RebaseNavigation` constrói os controladores de navegação, URL e registro de coleções que o `RebaseRouteDefs` e todas as visualizações de coleção leem, portanto, usar `RebaseRouteDefs` fora dele causará um erro. Para incorporar uma visualização de coleção ou um formulário de registro em uma página própria, sem as rotas do admin, o `CollectionsProvider`, mais leve, constrói esses controladores — consulte [Painéis em uma página própria](/docs/frontend/panels).

Cada camada pode ser usada individualmente. O `<RebaseAuthGate>` sozinho protege seu próprio aplicativo com o login do Rebase. Troque `<RebaseLayout>` pelo seu próprio componente para manter o roteamento e remover a interface visual padrão; remova também `<RebaseRouteDefs>` e você estará construindo as rotas por conta própria a partir dos componentes em [Componentes de Scaffold](#componentes-de-scaffold).

Abaixo desse nível, o `<Rebase>` também aceita uma **render prop** em vez de filhos, o que entrega a você o contexto e o indicador de carregamento, deixando a árvore inteira sob sua responsabilidade:

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

Nesse ponto, nada é configurado automaticamente: você constrói os controladores abaixo manualmente e renderiza as rotas você mesmo.

### Controladores

Controladores são hooks do React que configuram aspectos específicos do framework. `<RebaseNavigation>` chama todos eles para você — utilize-os diretamente apenas dentro de uma render prop.

#### `useBuildNavigationStateController`

O controlador principal que conecta tudo:

Seu `data` é o que é passado para os construtores de coleção e visualização: o `context.data` plano do `<Rebase>` envolvente (consulte [Um formato de dados único](#um-formato-de-dados-único)), portanto, este hook deve ser chamado dentro da árvore do `<Rebase>`.

```typescript
const { data } = useRebaseContext();

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

Gerencia o tema claro/escuro. Enquanto estiver ativo, ele controla o tema da página: adiciona a classe `dark` em `<html>`, segue `prefers-color-scheme` até que o usuário escolha um modo e memoriza essa escolha no localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

O `<Rebase>` constrói um desses internamente.

Quando o componente que o utiliza é desmontado, ele remove a classe `dark` que adicionou; qualquer classe `dark` que a página já continha permanece. Construa o seu próprio acima de `<Rebase>` apenas quando componentes externos a ele também precisarem do modo e passe-o através da [prop `modeController`](#estilização), para que haja apenas um controlador e não dois. `useBuildModeController({ enabled: false })` cria um controlador inerte: ele mantém o `mode` no estado do React e não mexe em nenhuma classe, media query ou localStorage. Quando seu aplicativo já controla o tema, você não precisa deste hook: basta passar seu próprio controlador como `modeController`.

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
| `<Drawer>` | Navegação lateral com lista de coleções e links de visualização |
| `<SideDialogs>` | Contêiner para editores de entidade em painel lateral |
| `<RebaseRoutes>` | Contêiner de rotas que se integra com o React Router |
| `<RebaseRoute>` | Gerencia as rotas de coleção (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão exibindo os cards das coleções |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvedor |

## Visualizações Personalizadas

Adicione visualizações de navegação de nível superior para dashboards, ferramentas ou páginas customizadas. Um `AppView` é um objeto plano — tudo abaixo fica no nível raiz, sem nenhum bloco `admin` aninhado:

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

Passe-as para `<RebaseCMS>`, junto com suas coleções — esse é o componente que registra a navegação:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho pelo qual é acessada, sob a raiz do admin |
| `name` | o rótulo no drawer e na página inicial |
| `view` | o elemento a ser renderizado, ou um `ComponentType` para renderizá-lo de forma lazy |
| `icon` | o nome de um ícone [Lucide](https://lucide.dev/icons/), ex.: `"ShoppingCart"` — ou qualquer nó |
| `group` | agrupa visualizações no drawer; `"Admin"` e `"Settings"` são fixados na parte inferior |
| `pinToBottom` | fixa o grupo na parte inferior com qualquer nome — prefira isso às duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para uma visualização com rotas próprias |
| `hideFromNavigation` | mantém a rota, mas remove a entrada da navegação |
| `roles` | apenas usuários com uma dessas roles podem ver ou acessar a visualização |
| `description` | Markdown, exibido no card da página inicial |

Para colocar uma visualização sob o **Studio** em vez do CMS, passe-a para [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilização

O Rebase utiliza **Tailwind CSS v4** e suporta modos claro/escuro. Personalize através de:

- **Custom properties do CSS** — Sobrescreva design tokens
- **`<Rebase modeController>`** — Passe o modo claro/escuro do seu aplicativo para o Rebase
- **Configuração do Tailwind** — Customização padrão do Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modo claro e escuro

Por padrão, o `<Rebase>` controla o tema da página: ele adiciona a classe `dark` em `<html>`, segue `prefers-color-scheme` até que o usuário escolha um modo no admin e memoriza essa escolha no localStorage.

Quando o `<Rebase>` é desmontado, ele remove a classe `dark` adicionada; uma classe que a página já possuía permanece. Na versão 0.24, a classe não é removida.

Quando seu aplicativo já possuir um tema, passe-o como `modeController`. O Rebase lerá o `mode` a partir dele, chamará seu `setMode` a partir do seu próprio alternador de tema e nunca modificará `<html>`, `prefers-color-scheme` ou localStorage:

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

O CSS do scaffold estiliza o modo escuro sob qualquer elemento com a classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Painéis laterais, diálogos e menus são renderizados em um portal no `<body>`, portanto coloque a classe em `<html>` ou `<body>` em vez de um elemento contêiner ao redor de `<Rebase>`.

Envolver o `<Rebase>` em um `ModeControllerProvider` não resolve isso: o `<Rebase>` fornece um controlador próprio internamente. Na versão 0.24, essa prop não existe e não há como passar o modo do seu aplicativo para o `<Rebase>`.

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Crie campos de formulário personalizados
- **[Visualizações de Entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidade
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
- **[Traduções](/docs/frontend/i18n)** — Altere qualquer texto ou adicione um novo idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
