---
sourceHash: 15779772a2359662
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controllers, scaffold, roteamento e views."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel administrativo. Ele
lê as tabelas fornecidas pelo backend e gera a navegação, tabelas,
formulários e rotas a partir delas, sem necessidade de configuração (consulte
[Tabelas no CMS](/docs/collections/)). O que você adiciona é o que difere.

No scaffold padrão, o painel administrativo **é** o frontend: ele é servido na raiz da sua URL publicada. Se, em vez disso, você construir seu próprio aplicativo de produto, poderá montar o painel sob um prefixo como `/admin` na mesma publicação — consulte [Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

Este é um `frontend/src/App.tsx` sem suas importações de fontes, error boundary e
Google client id — todo o painel administrativo, quatro declarações dentro de um
único provedor:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { tableCustomizations } from "./cms";

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
            {/* Every table the backend serves, plus your customizations. */}
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Os três primeiros não renderizam nada: eles *registram* configurações no
provedor. `<RebaseShell>` é quem realmente desenha a interface — ele lê esse registro e constrói a
navegação, rotas e layout a partir dele. Portanto, a ordem em que aparecem não
importa, e adicionar uma funcionalidade significa adicionar um componente, não reestruturar uma árvore inteira.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | as tabelas servidas com suas customizações, coleções externas, views personalizadas, a página inicial, o editor de coleções |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — ele renderiza o painel administrativo a partir de tudo acima |

Remova `<RebaseStudio>` e você terá um CMS apenas para conteúdo; remova `<RebaseCMS>` e
você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, consulte
[Avançado: layout manual](#avançado-layout-manual).

## Onde os arquivos do CMS ficam

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` armazena o que o painel não consegue deduzir: um
[`customizeTable`](/docs/frontend/customize-table/) por tabela que você deseja
apresentar de forma diferente, e as [coleções do Firestore](/docs/frontend/firebase/)
que o navegador lê diretamente. Esses arquivos rodam apenas no navegador, portanto, um campo
personalizado é um componente que você importa por valor.

O frontend importa o **tipo** de uma tabela de `backend/schema`, nunca um valor:
`import type { posts } from "../../../backend/schema/posts"`. Uma importação de tipo é
removida do bundle, de modo que os hooks e o código de servidor do backend nunca cheguem ao
navegador. O backend não importa nada do frontend.

## Props do RebaseCMS

<span class="since-badge" data-since="0.31">Desde 0.31</span>

<!-- rebase-cms-props:start -->
| Prop | Descrição |
|------|-------------|
| `tableCustomizations` | Resultados de `customizeTable(...)`, no máximo um por tabela. Dois para a mesma tabela lançam um erro; um para uma tabela que o chamador não recebe é ignorado, com um aviso em desenvolvimento |
| `externalCollections` | Coleções cujas linhas residem em outra fonte de dados, como resultados de `defineFirestoreCollection`, exibidas ao lado das tabelas na mesma navegação, busca e seletores de referência |
| `uiConfig` | As preferências de interface do workspace conforme gravadas em desenvolvimento: `import uiConfig from "./cms/ui-config.json"`. Aplicadas sobre `tableCustomizations`, abaixo das preferências individuais de cada usuário |
| `tables` | Para incorporação e testes: as tabelas a serem renderizadas em vez daquelas servidas pelo servidor (`compileTables([...])`). Quando fornecidas, nenhuma é solicitada ao servidor |
| `views` | Páginas de nível superior na navegação, ou um builder delas — consulte [Views Personalizadas](#views-personalizadas) |
| `homePage` | Substitui a página inicial de conteúdo |
| `entityViews` | Abas de registro que qualquer tabela pode nomear por `key` em suas `entityViews` |
| `collectionViews` | Modos de visualização que qualquer tabela pode nomear por `key` em suas `customViews` |
| `entityActions` | Ações de registro que qualquer tabela pode nomear por `key` em suas `entityActions` |
| `collectionEditor` | `true` ou opções para o editor visual de esquemas |
| `navigationGroupMappings` | Grupos nomeados e as coleções e views em cada um, em ordem |
| `basePath` | O prefixo de URL sob o qual o painel está montado, quando o roteador não possui um `basename` |
<!-- rebase-cms-props:end -->

As coleções do painel são compostas nesta ordem, que também é a ordem da
navegação: cada tabela servida (com sua customização, e então as preferências
de UI do workspace e do usuário aplicadas), seguida pelas `externalCollections`. Um slug
nomeia apenas uma coleção:

| Colisão | O que acontece |
|---|---|
| dois resultados de `customizeTable` para um mesmo slug | lança erro: mescle-os em um só |
| uma coleção externa e uma tabela servida, ou outra coleção externa | o painel exibe um erro de carregamento citando ambas; atribua outro slug a uma delas |

A forma como o painel aguarda as tabelas e o que ele exibe quando elas não podem
ser carregadas estão descritos em [Tabelas no CMS](/docs/collections/#loading-and-errors).

## O Rebase Provider

`<Rebase>` é o provedor raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

Todas as vinte e três props, na íntegra — a tabela costumava listar dez, e duas delas
eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-------------|
| `children` | Os componentes raiz do painel administrativo — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a alternativa para layout manual. |
| `apiUrl` | URL base da API do backend, disponibilizada para cada hook via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial do painel e o locale no qual as datas são formatadas — consulte [Traduções](/docs/frontend/i18n) |
| `client` | Instância de `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados adicionais, para coleções que especificam uma — consulte [Múltiplas fontes](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui a inscrição em `client.auth` por completo |
| `storageSource` | A fonte de armazenamento padrão, substituindo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além da padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de esquema). Apenas o Studio precisa disso |
| `userConfigPersistence` | Preferências locais de UI — larguras de colunas, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics emitido pelo painel |
| `entityLinkBuilder` | `({ row, id, path }) => string`: a URL para o botão "abrir no seu app" em um registro, a partir do registro conforme o servidor envia a linha |
| `plugins` | Instâncias de plugins — consulte [Plugins](/docs/plugins) |
| `slots` | Contribuições de slots declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados pelo nome especificado pelo campo em `propertyConfig` |
| `entityViews` | Abas de visualização de entidade personalizadas, disponíveis para qualquer tabela que indique sua `key` em `entityViews` |
| `collectionViews` | Modos de visualização de coleção personalizados, disponíveis para qualquer coleção por `key` |
| `entityActions` | Ações de entidade, disponíveis para qualquer tabela que indique sua `key` em `entityActions` |
| `effectiveRoleController` | Simula uma role diferente enquanto o modo de desenvolvimento estiver ativado |
| `modeController` | Transfere para o Rebase o controle do modo claro/escuro da aplicação hospedeira; o Rebase não manipulará `<html>`, `prefers-color-scheme` ou localStorage — consulte [Estilização](#estilização) |
| `translations` | Sobrescreve ou estende qualquer string da UI, indexada por locale — consulte [Traduções](/docs/frontend/i18n) |
| `components` | Substitui componentes integrados — consulte [Substituições de Componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controllers de navegação, URL e registro de coleções **não** são props
de `<Rebase>` — eles são criados pelos hooks abaixo e consumidos dentro da árvore do painel
(`<RebaseShell>` os conecta para você no scaffold padrão).

Nem o prefixo de URL. Quando o painel administrativo é montado sob um caminho, isso pertence
ao `<RebaseCMS basePath="/admin">`, que é o responsável por resolver URLs em coleções —
e apenas quando o roteador não possui um `basename` próprio. Consulte
[Alterando a URL Base](/docs/getting-started/deployment#changing-the-base-url).

## Um formato único de dados

Seu código obtém as linhas exatamente como o servidor as envia, onde quer que solicite: `client.data`,
`context.data` (tanto em um callback de backend quanto no navegador), `useRows`,
`useRow` e `useRowWrites`, o `data` dos builders de coleções e views, e o que
é passado para os `browserCallbacks` de uma tabela. Uma linha é um objeto plano: `row.title`,
uma data como sua string ISO, um belongsTo como sua coluna de chave estrangeira.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

O próprio painel administrativo renderiza um view model `Entity` — o invólucro
de `id` / `path` / `values` do qual suas visualizações de coleção e formulários se baseiam, com datas como `Date`s e uma
relação como um `EntityRelation` (as classes de valor `EntityRelation`, `EntityReference`,
`GeoPoint` e `Vector` vêm de `@rebasepro/cms-types`). Antes de cada gravação e
de cada filtro, o painel o converte em valores de transmissão no navegador — relações como
chaves, vetores como listas numéricas, pontos como `{ latitude, longitude }`, datas como texto
ISO — para que o servidor receba o que qualquer outro cliente envia. Essa camada pertence ao próprio painel e não faz parte
da superfície pública: uma ação de entidade, um display resolver, o `tableController.rows` de um
`Builder` de modo de exibição, a seleção de uma ação de coleção e um slot
recebem todos linhas puras, com o id de cada registro ao lado de sua linha. Você só encontra `Entity` em uma cópia de uma das
partes internas do painel (`Collection.Table`, um card), que recebe o registro conforme o painel o
desenha. Os valores de um formulário são os do editor: `Date`s e relações, conforme um campo
os edita.

## Uma coleção ou um registro em uma página própria

Você não precisa de todo o painel administrativo para exibir uma única tabela. `<CollectionPanel>`,
`<RecordForm>`, `<RecordDetail>` e `<FieldValue>` funcionam em qualquer lugar sob
o `<Rebase>` e um roteador React Router, sem necessidade de `<RebaseCMS>`,
`<RebaseNavigation>` ou `<RebaseShell>`: uma coleção com as colunas e
toolbar que você escolher, o formulário de um registro apenas com alguns campos ou seu próprio
layout, um registro somente leitura ou um valor desenhado exatamente como o painel o desenha. Consulte
[Painéis em uma página própria](/docs/frontend/panels).

## Avançado: layout manual

Tudo abaixo substitui `<RebaseShell>`. Você só precisa disso quando o layout
padrão for um obstáculo — uma moldura visual diferente ao redor do painel, uma árvore de rotas
própria, um aplicativo onde o painel administrativo é apenas uma página entre várias. Se não for
substituir o layout, você pode parar na seção [Views Personalizadas](#views-personalizadas).

`<RebaseShell>` é um atalho sintático para quatro camadas, e você pode utilizá-las separadamente:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
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
RebaseLayout`. O `RebaseAuthGate` exibe a tela de login até que haja um usuário autenticado, de modo que
nada abaixo dele seja renderizado para um visitante desconectado; o `RebaseNavigation` constrói
os controllers de navegação, URL e registro de coleções lidos por `RebaseRouteDefs`
e por cada view de coleção, de modo que `RebaseRouteDefs` fora dele lançará um erro.
Para incorporar uma
visualização de coleção ou um formulário de registro em uma página própria, sem as
rotas administrativas, o mais leve `CollectionsProvider` cria esses controllers
em seu lugar — consulte
[Painéis em uma página própria](/docs/frontend/panels).

Cada camada pode ser usada individualmente. O `<RebaseAuthGate>` isolado protege seu próprio aplicativo
com a autenticação do Rebase. Troque `<RebaseLayout>` pelo seu próprio componente para manter o
roteamento e remover o layout visual padrão; remova também `<RebaseRouteDefs>` e você estará
construindo as rotas manualmente a partir dos componentes em
[Componentes de Scaffold](#componentes-de-scaffold).

Abaixo desse nível, `<Rebase>` também aceita uma **render prop** em vez de children,
fornecendo o contexto e o indicador de carregamento, deixando toda a árvore por
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
manualmente e renderiza as rotas por conta própria.

### Controllers

Controllers são React hooks que configuram aspectos específicos do framework.
`<RebaseNavigation>` chama todos eles para você — utilize-os manualmente apenas dentro de uma
render prop.

#### `useBuildNavigationStateController`

O controller principal que conecta tudo:

Seu `data` é o que os builders de coleções e views recebem: o `context.data`
plano do `<Rebase>` delimitador (consulte [Um formato único de dados](#um-formato-único-de-dados)),
portanto, este hook deve ser chamado dentro da árvore do `<Rebase>`.

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

Gerencia o tema claro/escuro. Enquanto habilitado, ele controla o tema da página: insere
a classe `dark` em `<html>`, segue `prefers-color-scheme` até que o usuário
escolha um modo, e memoriza essa escolha no localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

O `<Rebase>` constrói um desses internamente.

Quando o
componente que o utiliza é desmontado, ele remove a classe `dark` adicionada; uma
classe `dark` que a página já continha permanece. Crie o seu próprio
acima de `<Rebase>` apenas quando componentes externos a ele também precisarem do modo, e repasse-o
por meio da [prop `modeController`](#estilização), para que exista apenas um controller
e não dois. `useBuildModeController({ enabled: false })` cria um controller
inerte: ele mantém o `mode` no estado do React e não altera classes, media queries
ou o localStorage. Quando sua aplicação já gerencia o tema, você não precisa deste
hook: basta passar seu próprio controller como `modeController`.

#### `useBuildAdminModeController`

Alterna entre os modos Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descrição |
|-----------|-------------|
| `<Scaffold>` | Contêiner de layout principal com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, alternador de tema e menu de usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de views |
| `<SideDialogs>` | Contêiner para os editores de entidade em painel lateral |
| `<RebaseRoutes>` | Contêiner de rotas que se integra ao React Router |
| `<RebaseRoute>` | Trata as rotas de coleções (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão exibindo os cards das coleções |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvimento |

## Views Personalizadas

Adicione views de navegação de nível superior para dashboards, ferramentas ou páginas customizadas. Um
`AppView` é um objeto plano — tudo abaixo reside no nível raiz, não há um bloco
`admin` aninhado:

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

Passe-os para `<RebaseCMS>`, junto com suas customizações — esse é o
componente que registra a navegação:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho pelo qual a view é acessada, sob a raiz do admin |
| `name` | o rótulo exibido no drawer e na página inicial |
| `view` | o elemento a renderizar, ou um `ComponentType` para renderização preguiçosa (lazy) |
| `icon` | o nome de um ícone [Lucide](https://lucide.dev/icons/), ex.: `"ShoppingCart"` — ou qualquer node |
| `group` | agrupa views no drawer; `"Admin"` e `"Settings"` vão para o final |
| `pinToBottom` | fixa o grupo na parte inferior com qualquer nome — preferível em relação às duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para views com rotas internas próprias |
| `hideFromNavigation` | mantém a rota, mas remove o item da navegação |
| `roles` | apenas usuários com uma dessas roles podem ver a view ou acessá-la |
| `description` | Markdown exibido no card da página inicial |

Para incluir uma view sob o **Studio** em vez do CMS, passe-a para
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilização

O Rebase utiliza **Tailwind CSS v4** e suporta modos claro e escuro. Personalize via:

- **CSS custom properties** — Sobrescreva design tokens
- **`<Rebase modeController>`** — Entregue ao Rebase o controle de modo claro/escuro da sua aplicação
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

Por padrão, o `<Rebase>` controla o tema da página: adiciona a classe `dark` em
`<html>`, segue o `prefers-color-scheme` até que o usuário selecione um modo no
painel, e memoriza essa escolha no localStorage.

Quando `<Rebase>`
é desmontado, ele remove a classe `dark` que havia adicionado; uma classe já existente
na página permanece.

Quando sua aplicação
já gerencia um tema, passe-o como `modeController`. O Rebase lerá o `mode` a partir dele,
chamará seu `setMode` a partir de seu próprio alternador de tema e nunca manipulará `<html>`,
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

O CSS do scaffold aplica os estilos de modo escuro sob qualquer elemento que possua a classe `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Painéis laterais, diálogos e
menus são renderizados em um portal no `<body>`, portanto, aplique a classe em `<html>` ou `<body>`,
em vez de aplicá-la em um elemento intermediário em volta do `<Rebase>`.

Envolver o `<Rebase>` em um `ModeControllerProvider` não produz esse efeito:
o `<Rebase>` provê um controller próprio internamente.

## Próximos Passos

- **[customizeTable](/docs/frontend/customize-table)** — Todas as opções de configuração da coleção de uma tabela
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construa campos de formulário personalizados
- **[Entity Views](/docs/frontend/entity-views)** — Adicione abas aos editores de entidades
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
- **[Traduções](/docs/frontend/i18n)** — Modifique qualquer texto ou adicione um novo idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
