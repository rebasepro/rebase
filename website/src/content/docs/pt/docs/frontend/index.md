---
sourceHash: 0b034023f28eb28f
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controllers, scaffold, roteamento e visualizações."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel de administração. Ele lê as definições da sua collection e gera tabelas, formulários, navegação e roteamento automaticamente.

No scaffold padrão, o painel de administração **é** o frontend: ele é servido na raiz da sua URL de deploy. Se você construir seu próprio app de produto, pode montar o admin sob um prefixo como `/admin` na mesma implantação — consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Este é o `frontend/src/App.tsx` como o `rebase init` o escreve, sem suas importações
de fontes, error boundary e id de cliente do Google — todo o painel de administração, quatro
declarações dentro de um único provider:

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

Os três primeiros não renderizam nada: eles *registram* configurações no
provider. O `<RebaseShell>` é o que desenha — ele lê esse registro e constrói a
navegação, as rotas e o layout a partir dele. Portanto, a ordem em que aparecem não
importa, e adicionar uma funcionalidade significa adicionar um componente, não refazer a árvore de componentes.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collections, visualizações personalizadas, a página inicial, o editor de collections |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — ele renderiza o admin a partir de tudo acima |

Remova o `<RebaseStudio>` e você terá um CMS apenas de conteúdo; remova o `<RebaseCMS>` e
você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, consulte
[Avançado: layout manual](#avançado-layout-manual).

## O Provider do Rebase

O `<Rebase>` é o provider raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

Todas as vinte e três, na íntegra — a tabela costumava listar dez, e duas delas
eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-----------|
| `children` | Os componentes raiz do admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a saída de emergência para layout manual. |
| `apiUrl` | URL base da API do backend, disponibilizada para todos os hooks via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial do admin e o locale no qual as datas são formatadas — consulte [Traduções](/docs/frontend/i18n) |
| `client` | Instância do `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados adicionais, para collections que especificam uma — consulte [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui completamente a inscrição em `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, substituindo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além da padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de esquema). Apenas o Studio precisa |
| `userConfigPersistence` | Preferências locais de UI — larguras de colunas, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics emitido pelo admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: a URL para o botão "abrir no seu app" em um registro, a partir do registro conforme o servidor envia a linha |
| `plugins` | Instâncias de plugins — consulte [Plugins](/docs/plugins) |
| `slots` | Contribuições de slots declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados pelo nome especificado em `propertyConfig` |
| `entityViews` | Abas de visualização de entidade personalizadas, disponíveis para qualquer collection que liste sua `key` em `admin.entityViews` |
| `collectionViews` | Modos de visualização de collection personalizados, disponíveis para qualquer collection por `key` |
| `entityActions` | Ações de entidade, disponíveis para qualquer collection que liste sua `key` em `admin.entityActions` |
| `effectiveRoleController` | Simula uma role diferente enquanto o modo de desenvolvimento está ativo |
| `modeController` | Entrega ao Rebase o modo claro/escuro do aplicativo hospedeiro; o Rebase então nunca toca em `<html>`, `prefers-color-scheme` ou localStorage — consulte [Estilização](#estilização) |
| `translations` | Substitui ou estende qualquer string da UI, indexada por locale — consulte [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes integrados — consulte [Substituições de Componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controllers de navegação, URL e registro de collections **não** são
props de `<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da árvore do admin
(o `<RebaseShell>` os conecta para você no scaffold padrão).

Nem o prefixo de URL. Quando o admin é montado sob um caminho, isso pertence
ao `<RebaseCMS basePath="/admin">`, que é o que resolve URLs para collections —
e apenas quando o roteador não possui um `basename` próprio. Consulte
[Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

## Um único formato de dados

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Seu código obtém as linhas (rows) exatamente como o servidor as envia, onde quer que solicite: `client.data`,
`context.data` (tanto em um callback de backend quanto no navegador), `useRows`,
`useRow` e `useRowWrites`, o `data` dos builders de visualização e collection, e o que
é passado para os `browserCallbacks` de uma collection. Uma linha é um objeto plano: `row.title`,
uma data como sua string ISO, um belongsTo como sua coluna de chave estrangeira.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

O próprio admin renderiza um view model `Entity` — o invólucro de `id` / `path` / `values`
do qual suas visualizações de collection e formulários extraem dados, com datas como instâncias de `Date` e uma
relação como um `EntityRelation`. Essa camada pertence ao próprio admin e não faz parte da
superfície pública: uma ação de entidade, um display resolver, o `tableController.rows` de um
`Builder` de modo de visualização, a seleção de uma ação de collection e um slot
recebem todos linhas simples, com o id de cada registro ao lado de sua linha. Você só encontra `Entity` em uma cópia de uma das
partes do próprio admin (`Collection.Table`, um card), que recebe o registro conforme o admin
o renderiza. Os valores de um formulário são os do editor: `Date`s e relações, conforme um campo
os edita.

## Uma collection ou um registro em uma página própria

Você não precisa do admin inteiro para exibir uma única tabela. `<CollectionPanel>`,
`<EntityFormPanel>`, `<EntityViewPanel>` e `<FieldValue>` funcionam em qualquer lugar sob
o `<Rebase>` e um roteador do React Router, sem `<RebaseCMS>`,
`<RebaseNavigation>` ou `<RebaseShell>`: uma collection com as colunas e a
barra de ferramentas que você escolher, o formulário de um registro apenas com alguns campos ou seu próprio
layout, um registro somente leitura ou um único valor renderizado como o admin o renderiza. Consulte
[Painéis em uma página própria](/docs/frontend/panels).

## Avançado: layout manual

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout
padrão for um obstáculo — uma moldura visual diferente ao redor do admin, uma árvore de rotas
própria, um aplicativo onde o admin é uma página entre várias. Se você não estiver
substituindo o layout, pare em [Visualizações Personalizadas](#visualizações-personalizadas).

`<RebaseShell>` é um atalho sintático para quatro camadas, e você pode utilizá-las individualmente:

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
RebaseLayout`. O `RebaseAuthGate` exibe a tela de login até que haja um usuário, portanto
nada abaixo dele é renderizado para um visitante não autenticado; o `RebaseNavigation` constrói
os controllers de navegação, URL e registro de collections que o `RebaseRouteDefs`
e cada visualização de collection leem, de modo que usar `RebaseRouteDefs` fora dele dispara um erro.
Para incorporar uma
visualização de collection ou formulário de registro em uma página própria, sem as
rotas do admin, o mais leve `CollectionsProvider` constrói esses controllers
em vez disso — consulte
[Painéis em uma página própria](/docs/frontend/panels).

Cada camada pode ser usada individualmente. Apenas o `<RebaseAuthGate>` já protege seu próprio app
com o login do Rebase. Troque `<RebaseLayout>` pelo seu próprio componente para manter o
roteamento e descartar a moldura visual; remova `<RebaseRouteDefs>` também e você estará construindo
as rotas por conta própria a partir dos componentes em
[Componentes de Scaffold](#componentes-de-scaffold).

Abaixo desse nível, o `<Rebase>` também aceita uma **render prop** em vez de children,
que fornece o context e o indicador de loading, deixando a árvore inteira por
sua conta:

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

Nesse ponto, nada é conectado automaticamente: você constrói os controllers abaixo
manualmente e renderiza as rotas você mesmo.

### Controllers

Controllers são hooks React que configuram aspectos específicos do framework.
O `<RebaseNavigation>` chama todos eles para você — utilize-os diretamente apenas dentro de uma
render prop.

#### `useBuildNavigationStateController`

O controller principal que conecta tudo:

Seu `data` é o que é passado para os builders de collection e de visualização: o
`context.data` plano do `<Rebase>` envolvente (consulte [Um único formato de dados](#um-único-formato-de-dados)),
portanto este hook deve ser chamado dentro da árvore do `<Rebase>`.

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

Gerencia como as collections são resolvidas a partir dos caminhos de URL:

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

Gerencia o tema claro/escuro. Enquanto habilitado, ele controla o tema da página: adiciona
a classe `dark` ao `<html>`, segue o `prefers-color-scheme` até que o usuário
escolha um modo e lembra essa escolha no localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

O `<Rebase>` cria um desses internamente.

Quando o
componente que o utiliza é desmontado, ele remove a classe `dark` adicionada; uma classe
`dark` que a página já possuía permanece. Crie o seu próprio
acima de `<Rebase>` somente quando componentes fora dele também precisarem do modo, e passe-o
através da [prop `modeController`](#estilização), para que haja apenas um controller
e não dois. `useBuildModeController({ enabled: false })` cria um controller
inerte: ele mantém o `mode` no estado do React e não mexe em nenhuma classe, media query
ou localStorage. Quando seu aplicativo já gerencia o tema, você não precisa deste
hook: passe seu próprio controller como `modeController`.

#### `useBuildAdminModeController`

Alterna entre os modos Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descrição |
|-----------|-----------|
| `<Scaffold>` | Contêiner de layout principal com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, alternador de modo e menu de usuário |
| `<Drawer>` | Navegação lateral com lista de collections e links de visualização |
| `<SideDialogs>` | Contêiner para editores de entidade em painel lateral |
| `<RebaseRoutes>` | Contêiner de rotas que se integra com o React Router |
| `<RebaseRoute>` | Lida com rotas de collection (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão exibindo cards de collections |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvedor |

## Visualizações Personalizadas

Adicione visualizações de navegação de nível superior para dashboards, ferramentas ou páginas personalizadas. Uma
`AppView` é um objeto plano — tudo abaixo fica no nível superior, não há nenhum
bloco `admin` aninhado:

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

Passe-as para o `<RebaseCMS>`, ao lado de suas collections — esse é o componente
que registra a navegação:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho no qual ela é acessada, sob a raiz do admin |
| `name` | o rótulo no drawer e na página inicial |
| `view` | o elemento a ser renderizado, ou um `ComponentType` para renderizá-lo de forma lazy |
| `icon` | um nome de ícone do [Lucide](https://lucide.dev/icons/), ex.: `"ShoppingCart"` — ou qualquer nó |
| `group` | agrupa visualizações no drawer; `"Admin"` e `"Settings"` vão para o final |
| `pinToBottom` | fixa o grupo na parte inferior sob qualquer nome — prefira isso em relação às duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para uma visualização com rotas próprias |
| `hideFromNavigation` | mantém a rota, remove a entrada de navegação |
| `roles` | apenas usuários com uma dessas roles veem a visualização ou podem acessá-la |
| `description` | Markdown, exibido no card da página inicial |

Para colocar uma visualização sob o **Studio** em vez do CMS, passe-a para
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilização

O Rebase utiliza o **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Propriedades customizadas CSS** — Sobrescreva tokens de design
- **`<Rebase modeController>`** — Entregue ao Rebase o modo claro/escuro do seu app
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

Por padrão, o `<Rebase>` controla o tema da página: ele adiciona a classe `dark` ao
`<html>`, segue o `prefers-color-scheme` até que o usuário escolha um modo no
admin e lembra essa escolha no localStorage.

Quando o `<Rebase>`
é desmontado, ele remove a classe `dark` adicionada; uma classe que a página já possuía
permanece. Na versão 0.24, a classe não é removida.

Quando seu app
já tiver um tema, passe-o como `modeController`. O Rebase lê `mode` dele,
chama seu `setMode` a partir do seu próprio alternador de tema e nunca toca em `<html>`,
`prefers-color-scheme` ou localStorage:

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

O CSS do scaffold estiliza o modo escuro sob qualquer elemento com a classe `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Painéis laterais, diálogos e
menus são renderizados em um portal no `<body>`, portanto coloque a classe em `<html>` ou `<body>`
em vez de colocá-la em um wrapper ao redor de `<Rebase>`.

Envolver o `<Rebase>` em um `ModeControllerProvider` não produz esse efeito:
o `<Rebase>` fornece um controller próprio dentro de si. Na versão 0.24 a prop não
existe e não há como fornecer ao `<Rebase>` o modo do seu app.

## Próximos Passos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construa campos de formulário personalizados
- **[Visualizações de Entidade](/docs/frontend/entity-views)** — Adicione abas aos editores de entidade
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
- **[Traduções](/docs/frontend/i18n)** — Altere qualquer string ou adicione um idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
