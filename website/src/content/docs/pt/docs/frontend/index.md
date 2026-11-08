---
sourceHash: 648bcb814d96b084
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controllers, scaffold, roteamento e views."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel de administração. Ele lê as definições das suas coleções e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel de administração **é** o frontend: ele é servido na raiz da sua URL implantada. Se você preferir construir seu próprio aplicativo de produto, poderá montar a administração sob um prefixo como `/admin` na mesma implantação — consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Este é o `frontend/src/App.tsx` como gerado pelo `rebase init`, sem suas importações de fontes, error boundary e Google client id — todo o painel de administração, quatro declarações dentro de um único provider:

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

Os três primeiros não renderizam nada: eles *registram* a configuração no provider. O `<RebaseShell>` é o que desenha — ele lê esse registro e constrói a navegação, as rotas e o layout a partir dele. Portanto, a ordem em que aparecem não importa, e adicionar um recurso significa adicionar um componente, não reconstruir uma árvore.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | coleções, views personalizadas, a página inicial, o editor de coleções |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza o admin a partir de tudo acima |

Remova o `<RebaseStudio>` e você terá um CMS apenas para conteúdo; remova o `<RebaseCMS>` e você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, consulte [Avançado: layout manual](#avançado-layout-manual).

## O Provider do Rebase

O `<Rebase>` é o provider raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

Todas as vinte e três, na íntegra — a tabela costumava listar dez, e duas delas eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-----------|
| `children` | Os componentes raiz do admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a válvula de escape para layout manual. |
| `apiUrl` | URL base da API de backend, disponibilizada para cada hook via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial do admin e a localidade em que as datas são formatadas — consulte [Traduções](/docs/frontend/i18n) |
| `client` | Instância de `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados extras, para coleções que especificam uma — consulte [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui diretamente a assinatura `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, sobrescrevendo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além do padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de esquema). Apenas o Studio precisa disso |
| `userConfigPersistence` | Preferências locais de interface — larguras de colunas, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics emitido pelo admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: a URL para o botão "abrir no seu app" em um registro, a partir do registro conforme o servidor envia a linha |
| `plugins` | Instâncias de plugins — consulte [Plugins](/docs/plugins) |
| `slots` | Contribuições de slots declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados pelo nome que uma propriedade define em `propertyConfig` |
| `entityViews` | Abas de view de entidade personalizadas, disponíveis para qualquer coleção que indique sua `key` em `admin.entityViews` |
| `collectionViews` | Modos de visualização de coleção personalizados, disponíveis para qualquer coleção por `key` |
| `entityActions` | Ações de entidade, disponíveis para qualquer coleção que indique sua `key` em `admin.entityActions` |
| `effectiveRoleController` | Simula uma role diferente enquanto o modo de desenvolvimento está ativo |
| `modeController` | Repassa ao Rebase o modo claro/escuro do aplicativo hospedeiro; o Rebase então nunca altera `<html>`, `prefers-color-scheme` ou localStorage — consulte [Estilização](#estilização) |
| `translations` | Sobrescreva ou estenda qualquer string da interface, indexada por locale — consulte [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes integrados — consulte [Substituição de Componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controllers de navegação, URL e registro de coleções **não** são props do `<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da árvore do admin (o `<RebaseShell>` conecta tudo para você no scaffold padrão).

O prefixo de URL também não é. Quando o admin é montado sob um caminho, isso pertence a `<RebaseCMS basePath="/admin">`, que é o responsável por resolver URLs para coleções — e somente quando o roteador não possui um `basename` próprio. Consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

## Um formato de dados único

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Seu código recebe as linhas (rows) exatamente como o servidor as envia, onde quer que solicite: `client.data`, `context.data` (tanto em um callback de backend quanto no navegador), `useRows`, `useRow` e `useRowWrites`, o `data` dos builders de coleções e views, e o que é entregue aos `browserCallbacks` de uma coleção. Uma linha é um objeto simples (flat): `row.title`, uma data como sua string ISO, um belongsTo como sua coluna de chave estrangeira.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

O admin em si renderiza um view model `Entity` — o invólucro (wrapper) de `id` / `path` / `values` do qual suas views de coleção e formulários se baseiam, com datas como `Date`s e uma relação como um `EntityRelation`. Essa camada pertence ao próprio admin e não faz parte da superfície pública: uma ação de entidade, um resolvedor de exibição, o `tableController.rows` de um `Builder` de modo de visualização, a seleção de uma ação de coleção e um slot recebem todos linhas (rows), com o id de cada registro ao lado de sua linha. Você só encontra `Entity` em uma cópia de uma das próprias partes do admin (`Collection.Table`, um card), que recebe o registro conforme o admin o renderiza. Os valores de um formulário são os do editor: `Date`s e relações, conforme um campo os edita.

## Uma coleção ou um registro em uma página própria

Você não precisa de todo o admin para exibir uma única tabela. `<CollectionPanel>`, `<EntityFormPanel>`, `<RecordDetail>` e `<FieldValue>` funcionam em qualquer lugar sob o `<Rebase>` e um roteador do React Router, sem necessidade de `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>`: uma coleção com as colunas e a barra de ferramentas que você escolher, o formulário de um registro com apenas alguns campos ou seu próprio layout, um registro somente leitura ou um valor exibido da mesma forma que o admin renderiza. Consulte [Painéis em uma página própria](/docs/frontend/panels).

## Avançado: layout manual

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout padrão estiver no caminho — uma interface (chrome) diferente ao redor do admin, uma árvore de rotas própria, um aplicativo onde o admin é uma página entre várias. Se você não estiver substituindo o layout, pare em [Views Personalizadas](#views-personalizadas).

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

A ordem é fixa: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. O `RebaseAuthGate` exibe a tela de login até que haja um usuário, portanto nada abaixo dele é renderizado para um visitante desconectado; o `RebaseNavigation` constrói os controllers de navegação, URL e registro de coleções lidos pelo `RebaseRouteDefs` e por cada view de coleção, de modo que usar o `RebaseRouteDefs` fora dele causará um erro. Para incorporar uma view de coleção ou um formulário de registro em uma página própria, sem as rotas do admin, o mais leve `CollectionsProvider` constrói esses controllers — consulte [Painéis em uma página própria](/docs/frontend/panels).

Cada camada pode ser usada individualmente. Apenas o `<RebaseAuthGate>` já protege seu próprio aplicativo com o login do Rebase. Troque o `<RebaseLayout>` pelo seu próprio componente para manter o roteamento e remover a interface externa; descarte também o `<RebaseRouteDefs>` e você construirá as rotas por conta própria usando os componentes em [Componentes de Scaffold](#componentes-de-scaffold).

Abaixo desse nível, o `<Rebase>` também aceita uma **render prop** em vez de children, entregando a você o contexto e a flag de carregamento e deixando toda a árvore sob sua responsabilidade:

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

Nesse ponto, nada é configurado automaticamente: você constrói os controllers abaixo manualmente e renderiza as rotas por conta própria.

### Controllers

Controllers são hooks do React que configuram aspectos específicos do framework. O `<RebaseNavigation>` chama todos eles para você — recorra a estes apenas dentro de uma render prop.

#### `useBuildNavigationStateController`

O controller principal que conecta tudo:

Seu `data` é o que é fornecido aos builders de coleções e views: o `context.data` simples (flat) do `<Rebase>` envolvente (consulte [Um formato de dados único](#um-formato-de-dados-único)), portanto este hook deve ser chamado dentro da árvore do `<Rebase>`.

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

Gerencia o tema claro/escuro. Enquanto habilitado, ele controla o tema da página: adiciona a classe `dark` no `<html>`, segue o `prefers-color-scheme` até que o usuário escolha um modo e lembra essa escolha no localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

O `<Rebase>` constrói um desses internamente.

Quando o componente que o utiliza é desmontado, ele remove a classe `dark` que adicionou; uma classe `dark` que a página já possuía permanece. Construa o seu próprio acima do `<Rebase>` apenas quando componentes fora dele também precisarem do modo, e passe-o através da [prop `modeController`](#estilização), para que haja apenas um controller e não dois. `useBuildModeController({ enabled: false })` constrói um controller inerte: ele mantém o `mode` no estado do React e não altera nenhuma classe, media query ou localStorage. Quando o seu aplicativo já gerencia o tema por conta própria, você não precisa deste hook: basta passar seu próprio controller como `modeController`.

#### `useBuildAdminModeController`

Alterna entre os modos Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descrição |
|------------|-----------|
| `<Scaffold>` | Container de layout principal com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, alternador de modo e menu de usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de visualização |
| `<SideDialogs>` | Container para editores de entidade em painéis laterais |
| `<RebaseRoutes>` | Container de rotas que se integra com o React Router |
| `<RebaseRoute>` | Lida com rotas de coleção (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão exibindo cards de coleção |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvedor |

## Views Personalizadas

Adicione views de navegação de nível superior para dashboards, ferramentas ou páginas personalizadas. Um `AppView` é um objeto simples (flat) — tudo abaixo fica no nível superior, não há nenhum bloco `admin` aninhado:

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

Passe-os para o `<RebaseCMS>`, ao lado das suas coleções — esse é o componente que registra a navegação:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho pelo qual é acessado, sob a raiz do admin |
| `name` | o rótulo no drawer e na página inicial |
| `view` | o elemento a ser renderizado, ou um `ComponentType` para renderizá-lo de forma preguiçosa (lazy) |
| `icon` | o nome de um ícone do [Lucide](https://lucide.dev/icons/), ex.: `"ShoppingCart"` — ou qualquer nó (node) |
| `group` | agrupa views no drawer; `"Admin"` e `"Settings"` são fixados na parte inferior |
| `pinToBottom` | fixa o grupo na parte inferior com qualquer nome — prefira isso em vez das duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para uma view com rotas próprias |
| `hideFromNavigation` | mantém a rota, mas remove o item da navegação |
| `roles` | apenas usuários com uma dessas roles podem ver a view ou acessá-la |
| `description` | Markdown exibido no card da página inicial |

Para colocar uma view sob o **Studio** em vez do CMS, passe-a para [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilização

O Rebase utiliza o **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Propriedades customizadas CSS (CSS variables)** — Sobrescreva tokens de design
- **`<Rebase modeController>`** — Repasse ao Rebase o modo claro/escuro do seu aplicativo
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

Por padrão, o `<Rebase>` controla o tema da página: ele adiciona a classe `dark` no `<html>`, segue o `prefers-color-scheme` até que o usuário escolha um modo no admin e lembra essa escolha no localStorage.

Quando o `<Rebase>` é desmontado, ele remove a classe `dark` que adicionou; uma classe que a página já possuía permanece. Na versão 0.24, a classe não é removida.

Quando o seu aplicativo já possui um tema, passe-o como `modeController`. O Rebase lê o `mode` dele, chama seu `setMode` a partir de seu próprio seletor de tema e nunca altera `<html>`, `prefers-color-scheme` ou localStorage:

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

O CSS do scaffold estiliza o modo escuro sob qualquer elemento com a classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Painéis laterais, diálogos e menus são renderizados em um portal no `<body>`, portanto coloque a classe no `<html>` ou `<body>` em vez de em um elemento envoltório (wrapper) ao redor do `<Rebase>`.

Envolver o `<Rebase>` em um `ModeControllerProvider` não funciona para isso: o `<Rebase>` fornece um controller próprio internamente. Na versão 0.24, essa prop não existe e não há como repassar ao `<Rebase>` o modo do seu aplicativo.

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construa campos de formulário personalizados
- **[Views de Entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidades
- **[Modos de Visualização](/docs/frontend/view-modes)** — List, Table, Cards, Kanban
- **[Traduções](/docs/frontend/i18n)** — Modifique qualquer texto ou adicione um idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
