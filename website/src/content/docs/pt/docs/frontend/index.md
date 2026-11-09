---
sourceHash: b42c1d93bc690ca0
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controllers, scaffold, roteamento e views."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel administrativo. Ele lê as definições de suas coleções e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel administrativo **é** o frontend: ele é servido na raiz da sua URL de deploy. Se, em vez disso, você construir seu próprio app de produto, poderá montar o admin sob um prefixo como `/admin` no mesmo deploy — veja [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Este é o `frontend/src/App.tsx` como o `rebase init` o cria, sem suas importações de fontes, error boundary e id de cliente do Google — todo o painel administrativo, quatro declarações dentro de um único provider:

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

Os três primeiros não renderizam nada: eles *registram* configurações no provider. O `<RebaseShell>` é o que desenha — ele lê esse registro e constrói a navegação, rotas e layout a partir dele. Portanto, a ordem em que aparecem não importa, e adicionar uma funcionalidade significa adicionar um componente, não reconstruir uma árvore.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | coleções, views personalizadas, a página inicial, o editor de coleções |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — ele renderiza o admin a partir de tudo acima |

Remova o `<RebaseStudio>` e você terá um CMS apenas de conteúdo; remova o `<RebaseCMS>` e você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, veja [Avançado: layout manual](#avançado-layout-manual).

## O Provider do Rebase

O `<Rebase>` é o provider raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

Todas as vinte e três, na íntegra — a tabela costumava listar dez, e duas delas eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-----------|
| `children` | Os componentes raiz do admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a válvula de escape para layout manual. |
| `apiUrl` | URL base da API backend, disponibilizada para cada hook via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial do admin e a localidade em que as datas são formatadas — veja [Traduções](/docs/frontend/i18n) |
| `client` | Instância do `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados adicionais, para coleções que especificam uma — veja [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui diretamente a assinatura de `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, substituindo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além da padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de esquema). Apenas o Studio precisa disso |
| `userConfigPersistence` | Preferências locais de UI — larguras de colunas, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics que o admin emite |
| `entityLinkBuilder` | `({ row, id, path }) => string`: a URL para o botão "abrir no seu app" em um registro, a partir do registro conforme o servidor envia a linha |
| `plugins` | Instâncias de plugins — veja [Plugins](/docs/plugins) |
| `slots` | Contribuições de slot declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados pelo nome definido por uma propriedade em `propertyConfig` |
| `entityViews` | Abas de visualização de entidade personalizadas, disponíveis para qualquer coleção que indique sua `key` em `admin.entityViews` |
| `collectionViews` | Modos de visualização de coleção personalizados, disponíveis para qualquer coleção por `key` |
| `entityActions` | Ações de entidade, disponíveis para qualquer coleção que indique sua `key` em `admin.entityActions` |
| `effectiveRoleController` | Simula uma role diferente enquanto o modo dev estiver ativo |
| `modeController` | Passa para o Rebase o modo claro/escuro da aplicação host; o Rebase então nunca altera `<html>`, `prefers-color-scheme` ou localStorage — veja [Estilização](#estilização) |
| `translations` | Substitui ou estende qualquer string da UI, indexada por locale — veja [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes integrados — veja [Sobrescrita de Componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controllers de navegação, URL e registro de coleções **não** são props do `<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da árvore do admin (o `<RebaseShell>` os conecta para você no scaffold padrão).

O prefixo de URL também não é. Quando o admin é montado sob um caminho, isso pertence ao `<RebaseCMS basePath="/admin">`, que é o que resolve URLs para coleções — e somente quando o router não possui um `basename` próprio. Veja [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

## Um formato único de dados

Seu código recebe as linhas (rows) exatamente como o servidor as envia, onde quer que solicite: `client.data`, `context.data` (tanto em um callback de backend quanto no navegador), `useRows`, `useRow` e `useRowWrites`, o `data` dos builders de coleções e views, e o que é entregue aos `browserCallbacks` de uma coleção. Uma linha é um objeto plano: `row.title`, uma data como sua string ISO, um belongsTo como sua coluna de chave estrangeira.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

O próprio admin renderiza um view model `Entity` — o wrapper de `id` / `path` / `values` do qual suas visualizações de coleção e formulários se baseiam, com datas como objetos `Date` e uma relação como um `EntityRelation`. Essa camada é própria do admin e não faz parte da superfície pública: uma ação de entidade, um display resolver, o `tableController.rows` do `Builder` de modo de visualização, a seleção de uma ação de coleção e um slot recebem todos rows, com o id de cada registro ao lado de sua linha. Você só encontra `Entity` em uma cópia de uma das próprias partes do admin (`Collection.Table`, um card), que recebe o registro conforme o admin o renderiza. Os valores de um formulário são os do editor: objetos `Date` e relações, conforme um campo os edita.

## Uma coleção ou um registro em uma página própria

Você não precisa de todo o admin para exibir uma tabela. `<CollectionPanel>`, `<RecordForm>`, `<RecordDetail>` e `<FieldValue>` funcionam em qualquer lugar sob `<Rebase>` e um router do React Router, sem `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`: uma coleção com as colunas e a barra de ferramentas que você escolher, o formulário de um registro com apenas alguns campos ou seu próprio layout, um registro somente leitura ou um valor renderizado da mesma forma que o admin o renderiza. Veja [Painéis em uma página própria](/docs/frontend/panels).

## Avançado: layout manual

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout padrão for um obstáculo — uma estrutura diferente ao redor do admin, uma árvore de rotas própria, um aplicativo onde o admin é uma página entre várias. Se você não estiver substituindo o layout, pare em [Views Personalizadas](#views-personalizadas).

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

A ordem é fixa: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. O `RebaseAuthGate` exibe a tela de login até que haja um usuário, de modo que nada abaixo dele seja renderizado para um visitante desconectado; o `RebaseNavigation` constrói os controllers de navegação, URL e registro de coleções que o `RebaseRouteDefs` e cada visualização de coleção leem, portanto, usar `RebaseRouteDefs` fora dele lança um erro. Para incorporar uma visualização de coleção ou um formulário de registro em uma página própria, sem as rotas do admin, o `CollectionsProvider`, mais leve, constrói esses controllers — veja [Painéis em uma página própria](/docs/frontend/panels).

Cada camada pode ser usada individualmente. O `<RebaseAuthGate>` sozinho protege seu próprio app com o login do Rebase. Troque `<RebaseLayout>` pelo seu próprio componente para manter o roteamento e remover a moldura da interface; remova `<RebaseRouteDefs>` também e você mesmo construirá as rotas a partir dos componentes em [Componentes de Scaffold](#componentes-de-scaffold).

Abaixo desse nível, o `<Rebase>` também aceita uma **render prop** em vez de children, fornecendo o context e a flag de loading, deixando toda a árvore sob sua responsabilidade:

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

Nesse ponto, nada é configurado automaticamente: você constrói os controllers abaixo manualmente e renderiza as rotas você mesmo.

### Controllers

Controllers são hooks do React que configuram aspectos específicos do framework. O `<RebaseNavigation>` chama todos eles para você — utilize-os apenas dentro de uma render prop.

#### `useBuildNavigationStateController`

O controller principal que conecta tudo:

Seu `data` é o que é passado para os builders de coleções e views: o `context.data` plano do `<Rebase>` pai (veja [Um formato único de dados](#um-formato-único-de-dados)), portanto, este hook deve ser chamado dentro da árvore do `<Rebase>`.

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

Gerencia como as coleções são resolvidas a partir dos caminhos da URL:

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

Gerencia o tema claro/escuro. Enquanto estiver ativado, ele controla o tema da página: adiciona a classe `dark` ao `<html>`, segue `prefers-color-scheme` até que o usuário escolha um modo e lembra dessa escolha no localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

O `<Rebase>` constrói um desses internamente.

Quando o componente que o utiliza é desmontado, ele remove a classe `dark` que adicionou; uma classe `dark` que a página já possuía é mantida. Crie o seu próprio acima de `<Rebase>` apenas quando componentes fora dele também precisarem do modo, e passe-o através da [prop `modeController`](#estilização), para que haja apenas um controller e não dois. `useBuildModeController({ enabled: false })` cria um controller inerte: ele mantém `mode` no estado do React e não mexe em nenhuma classe, media query ou localStorage. Quando seu app já controla o tema, você não precisa deste hook: basta passar seu próprio controller como `modeController`.

#### `useBuildAdminModeController`

Alterna entre os modos Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descrição |
|------------|-----------|
| `<Scaffold>` | Contêiner de layout principal com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, alternador de modo, menu do usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de views |
| `<SideDialogs>` | Contêiner para editores de entidade em painel lateral |
| `<RebaseRoutes>` | Contêiner de rotas que se integra com o React Router |
| `<RebaseRoute>` | Gerencia rotas de coleção (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão mostrando cards de coleções |
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

Passe-os para `<RebaseCMS>`, ao lado de suas coleções — esse é o componente que registra a navegação:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho pelo qual ela é acessada, sob a raiz do admin |
| `name` | o rótulo no drawer e na página inicial |
| `view` | o elemento a ser renderizado, ou um `ComponentType` para renderizá-lo de forma lazy |
| `icon` | um nome de ícone do [Lucide](https://lucide.dev/icons/), ex.: `"ShoppingCart"` — ou qualquer nó |
| `group` | agrupa views no drawer; `"Admin"` e `"Settings"` vão para a parte inferior |
| `pinToBottom` | fixa o grupo na parte inferior com qualquer nome — prefira isso em vez das duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para uma view com rotas próprias |
| `hideFromNavigation` | mantém a rota, remove a entrada da navegação |
| `roles` | apenas usuários com uma dessas roles veem a view ou podem acessá-la |
| `description` | Markdown, exibido no card da página inicial |

Para colocar uma view sob o **Studio** em vez do CMS, passe-a para [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilização

O Rebase usa **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Propriedades personalizadas de CSS (custom properties)** — Sobrescreva tokens de design
- **`<Rebase modeController>`** — Passe para o Rebase o modo claro/escuro do seu app
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

Por padrão, o `<Rebase>` controla o tema da página: ele adiciona a classe `dark` ao `<html>`, segue `prefers-color-scheme` até que o usuário selecione um modo no admin e memoriza essa escolha no localStorage.

Quando o `<Rebase>` é desmontado, ele remove a classe `dark` que adicionou; uma classe que a página já possuía é mantida. Na versão 0.24, a classe permanecia.

Quando seu app já possui um tema, passe-o como `modeController`. O Rebase lê `mode` dele, chama seu `setMode` a partir de seu próprio alternador de tema e nunca altera `<html>`, `prefers-color-scheme` ou localStorage:

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

O CSS do scaffold estiliza o modo escuro sob qualquer elemento com a classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Painéis laterais, diálogos e menus são renderizados em um portal no `<body>`, portanto, coloque a classe em `<html>` ou `<body>` em vez de em um elemento wrapper ao redor do `<Rebase>`.

Envolver o `<Rebase>` em um `ModeControllerProvider` não produz esse efeito: o `<Rebase>` fornece um controller próprio internamente. Na versão 0.24 a prop não existe, e não há como passar o modo do seu app para o `<Rebase>`.

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construa campos de formulário personalizados
- **[Views de Entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidade
- **[Modos de Visualização](/docs/frontend/view-modes)** — List, Table, Cards, Kanban
- **[Traduções](/docs/frontend/i18n)** — Modifique qualquer string ou adicione um idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
