---
sourceHash: 3d9958fb7e16f02e
title: Visão Geral do Frontend
sidebar_label: Frontend
description: "Construa e personalize o painel — Rebase CMS e Rebase Studio — com React: controllers, scaffold, roteamento e visualizações."
---

## Visão Geral

O frontend do Rebase é um **framework React** que renderiza seu painel administrativo. Ele
lê as tabelas que o backend disponibiliza e gera a navegação, tabelas,
formulários e rotas a partir delas, sem necessidade de configuração (consulte
[Tables in the CMS](/docs/collections/)). O que você adiciona é o que difere.

No scaffold padrão, o painel administrativo **é** o frontend: ele é servido na raiz da sua URL de deploy. Se, em vez disso, você construir seu próprio aplicativo de produto, poderá montar a administração sob um prefixo como `/admin` no mesmo deploy — consulte [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

Este é um `frontend/src/App.tsx` sem as importações de fontes, error boundary e
id de cliente do Google — todo o painel administrativo, quatro declarações dentro de um
único provider:

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

Os três primeiros não renderizam nada: eles *registram* a configuração no
provider. `<RebaseShell>` é o que desenha — ele lê esse registro e constrói a
navegação, as rotas e o layout a partir dele. Portanto, a ordem em que aparecem não
importa, e adicionar um recurso significa adicionar um componente, não refazer a estrutura de uma árvore.

| Componente | Pacote | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | a tela de login (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | as tabelas servidas com suas personalizações, coleções externas, visualizações personalizadas, a página inicial |
| `<RebaseStudio>` | `@rebasepro/studio` | as ferramentas de desenvolvedor (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — ele renderiza o painel administrativo a partir de tudo acima |

Remova o `<RebaseStudio>` e você terá um CMS apenas de conteúdo; remova o `<RebaseCMS>` e
você terá apenas as ferramentas de desenvolvedor. Para estruturar o shell manualmente, consulte
[Advanced: manual layout](#avançado-layout-manual).

## Onde ficam os arquivos do CMS

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` contém o que o painel não consegue derivar: um
[`customizeTable`](/docs/frontend/customize-table/) por tabela que você deseja
apresentar de forma diferente, e as [coleções do Firestore](/docs/frontend/firebase/)
que o navegador lê diretamente. Esses arquivos são executados apenas no navegador, portanto, um campo
personalizado é um componente que você importa por valor.

O frontend importa o **tipo** de uma tabela de `backend/schema`, nunca um valor:
`import type { posts } from "../../../backend/schema/posts"`. Uma importação de tipo é
apagada do bundle, de modo que os hooks e o código de servidor do backend nunca chegam ao
navegador. O backend não importa nada do frontend.

## Props do RebaseCMS

<!-- rebase-cms-props:start -->
| Prop | Descrição |
|------|-----------|
| `tableCustomizations` | Resultados de `customizeTable(...)`, no máximo um por tabela. Dois para a mesma tabela lançam um erro; um para uma tabela que não é servida ao chamador é ignorado, com um aviso em desenvolvimento |
| `externalCollections` | Coleções cujas linhas residem em outra fonte de dados, como resultados de `defineFirestoreCollection`, exibidas ao lado das tabelas na mesma navegação, busca e seletores de referência |
| `uiConfig` | As preferências de interface do workspace conforme gravadas no desenvolvimento: `import uiConfig from "./cms/ui-config.json"`. Aplicadas sobre `tableCustomizations`, sob as preferências próprias de cada usuário |
| `tables` | Para incorporação e testes: as tabelas a serem renderizadas em vez das que o servidor fornece (`compileTables([...])`). Quando fornecidas, nada é solicitado ao servidor |
| `views` | Páginas de nível superior na navegação, ou um construtor delas — consulte [Custom Views](#custom-views) |
| `homePage` | Substitui a página inicial de conteúdo |
| `entityViews` | Abas de registro que qualquer tabela pode indicar por `key` em seu `entityViews` |
| `collectionViews` | Modos de visualização que qualquer tabela pode indicar por `key` em seu `customViews` |
| `entityActions` | Ações de registro que qualquer tabela pode indicar por `key` em seu `entityActions` |
| `collectionEditor` | Opções para o schema controller através do qual o editor de RLS do Studio salva (`readOnly`, `getAuthToken`) |
| `navigationGroupMappings` | Grupos nomeados e as coleções e visualizações em cada um, em ordem |
| `basePath` | O prefixo de URL sob o qual o painel administrativo é montado, quando o roteador não possui um `basename` |
<!-- rebase-cms-props:end -->

As coleções do painel são compostas nesta ordem, que também é a ordem da
navegação: cada tabela servida (com sua personalização, seguida pelas preferências de interface
do workspace e do usuário aplicadas) e, em seguida, as `externalCollections`. Um slug
nomeia apenas uma coleção:

| Colisão | O que acontece |
|---|---|
| dois resultados de `customizeTable` para o mesmo slug | lança um erro: mescle-os em um só |
| uma coleção externa e uma tabela servida, ou outra coleção externa | o painel exibe um erro de carregamento citando ambas; atribua outro slug a uma delas |

Como o painel aguarda pelas tabelas e o que ele exibe quando elas não podem ser
carregadas está em [Tables in the CMS](/docs/collections/#loading-and-errors).

## O Provider Rebase

`<Rebase>` é o provider raiz que disponibiliza todas as funcionalidades do Rebase para os componentes filhos via contexto. Ele aceita:

Todas as vinte e três, na íntegra — a tabela costumava listar dez, e duas delas
eram props que o componente nunca lia:

<!-- rebase-props:start -->
| Prop | Descrição |
|------|-----------|
| `children` | Os componentes raiz do painel administrativo — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Uma função de renderização é a válvula de escape para layout manual. |
| `apiUrl` | URL base da API de backend, disponibilizada para cada hook via `useApiConfig()` |
| `dateTimeFormat` | Como as datas são exibidas. O padrão é `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial do painel administrativo e a localidade na qual as datas são formatadas — consulte [Translations](/docs/frontend/i18n) |
| `client` | Instância do `RebaseClient`: a fonte padrão para dados, autenticação e armazenamento |
| `dataSources` | Fontes de dados adicionais, para coleções que especificam uma — consulte [Multiple sources](/docs/backend/multiple-sources) |
| `authController` | Estado e métodos de autenticação. Substitui completamente a inscrição em `client.auth` |
| `storageSource` | A fonte de armazenamento padrão, sobrescrevendo `client.storage` |
| `storageSources` | Fontes de armazenamento nomeadas além da padrão |
| `databaseAdmin` | Operações administrativas de banco de dados (SQL, descoberta de esquema). Apenas o Studio precisa disso |
| `userConfigPersistence` | Preferências locais de UI — larguras de colunas, grupos recolhidos |
| `onAnalyticsEvent` | Chamado para cada evento de analytics que o painel administrativo emite |
| `entityLinkBuilder` | `({ row, id, path }) => string`: a URL para o botão "abrir no seu app" em um registro, a partir do registro conforme o servidor envia a linha |
| `plugins` | Instâncias de plugins — consulte [Plugins](/docs/plugins) |
| `slots` | Contribuições de slots declaradas diretamente, sem um plugin |
| `propertyConfigs` | Widgets de campo personalizados, indexados pelo nome que um campo define em `propertyConfig` |
| `entityViews` | Abas personalizadas de visualização de entidade, disponíveis para qualquer tabela que declare sua `key` em `entityViews` |
| `collectionViews` | Modos personalizados de visualização de coleção, disponíveis para qualquer coleção por `key` |
| `entityActions` | Ações de entidade, disponíveis para qualquer tabela que declare sua `key` em `entityActions` |
| `effectiveRoleController` | Simula um papel diferente enquanto o modo dev estiver ativo |
| `simulateAccess` | Exibe "Simular acesso", o controle do administrador que executa cada visualização de dados como um papel, usuário ou chave de serviço, em modo somente leitura, contra as políticas reais de row-level security. Desativado a menos que seja `true` |
| `modeController` | Entrega ao Rebase o modo claro/escuro da aplicação hospedeira; o Rebase então nunca toca em `<html>`, `prefers-color-scheme` ou localStorage — consulte [Styling](#styling) |
| `translations` | Sobrescreve ou estende qualquer string de interface, indexada por locale — consulte [Translations](/docs/frontend/i18n) |
| `components` | Substitui componentes internos — consulte [Component Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Os controllers de navegação, URL e registro de coleções **não** são props de
`<Rebase>` — eles são construídos pelos hooks abaixo e consumidos dentro da árvore administrativa
(`<RebaseShell>` os conecta para você no scaffold padrão).

O prefixo de URL também não é. Quando a administração é montada sob um caminho, isso pertence
ao `<RebaseCMS basePath="/admin">`, que é o responsável por resolver URLs para coleções —
e apenas quando o roteador não possui um `basename` próprio. Consulte
[Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

## Um único formato de dados

Seu código recebe linhas exatamente como o servidor as envia, onde quer que solicite: `client.data`,
`context.data` (tanto em um callback de backend quanto no navegador), `useRows`,
`useRow` e `useRowWrites`, o `data` dos construtores de coleção e visualização, e o que
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

O próprio painel administrativo renderiza um view model `Entity` — o wrapper de
`id` / `path` / `values` a partir do qual suas visualizações de coleção e formulários desenham, com datas como `Date`s e uma
relação como um `EntityRelation` (as classes de valor `EntityRelation`, `EntityReference`,
`GeoPoint` e `Vector` vêm de `@rebasepro/cms-types`). Antes de cada gravação e
de cada filtro, o painel administrativo o converte em valores de transmissão no navegador — relações como
chaves, vetores como listas de números, pontos como `{ latitude, longitude }`, datas como texto ISO —
para que o servidor veja o que qualquer outro cliente envia. Essa camada é própria do painel administrativo e não faz parte
da superfície pública: uma ação de entidade, um display resolver, o `tableController.rows` do
`Builder` de um modo de visualização, a seleção de uma ação de coleção e um slot
recebem todos linhas brutas, com o id de cada registro ao lado de sua linha. Você só encontra `Entity` em uma cópia de uma das
partes internas do painel administrativo (`Collection.Table`, um card), que recebe o registro conforme o painel administrativo
o desenha. Os valores de um formulário são os do editor: `Date`s e relações, conforme um campo
os edita.

## Uma coleção ou um registro em uma página própria

Você não precisa de todo o painel administrativo para exibir uma tabela. `<CollectionPanel>`,
`<RecordForm>`, `<RecordDetail>` e `<FieldValue>` funcionam em qualquer lugar sob
`<Rebase>` e um roteador do React Router, sem a necessidade de `<RebaseCMS>`,
`<RebaseNavigation>` ou `<RebaseShell>`: uma coleção com as colunas e a
barra de ferramentas que você escolher, o formulário de um registro com apenas alguns campos ou seu próprio
layout, um registro somente leitura ou um valor desenhado como o painel administrativo desenha. Consulte
[Panels in a page of your own](/docs/frontend/panels).

## Avançado: layout manual

Tudo abaixo substitui o `<RebaseShell>`. Você só precisa disso quando o layout padrão
for um obstáculo — uma moldura visual diferente ao redor do painel administrativo, uma árvore de rotas
própria, um aplicativo onde a administração é uma página entre várias. Se não for
substituir o layout, pare em [Custom Views](#custom-views).

`<RebaseShell>` é um atalho sintático para quatro camadas, e você pode utilizá-las uma por vez:

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
RebaseLayout`. `RebaseAuthGate` exibe a tela de login até que haja um usuário, de modo que
nada abaixo dele seja renderizado para um visitante desconectado; `RebaseNavigation` constrói
os controllers de navegação, URL e registro de coleções que o `RebaseRouteDefs`
e todas as visualizações de coleção leem, portanto, usar `RebaseRouteDefs` fora dele lança um erro.
Para incorporar uma
visualização de coleção ou formulário de registro em uma página própria, sem as
rotas do painel administrativo, o mais leve `CollectionsProvider` constrói esses controllers
em vez disso — consulte
[Panels in a page of your own](/docs/frontend/panels).

Cada camada pode ser usada individualmente. `<RebaseAuthGate>` sozinho protege seu próprio aplicativo
atrás do login do Rebase. Troque `<RebaseLayout>` pelo seu próprio componente para manter o
roteamento e remover a moldura padrão; remova `<RebaseRouteDefs>` também e você mesmo construirá
as rotas a partir dos componentes em
[Scaffold Components](#scaffold-components).

Abaixo desse nível, `<Rebase>` também aceita uma **render prop** em vez de children,
entregando a você o contexto e a flag de carregamento e deixando toda a árvore sob sua
responsabilidade:

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

Nesse ponto, nada é configurado automaticamente para você: você constrói os controllers abaixo
manualmente e renderiza as rotas por conta própria.

### Controllers

Controllers são hooks React que configuram aspectos específicos do framework.
`<RebaseNavigation>` chama todos eles para você — utilize-os diretamente apenas dentro de uma
render prop.

#### `useBuildNavigationStateController`

O controller principal que conecta tudo:

Seu `data` é o que é passado para os construtores de coleções e visualizações: o `context.data`
plano do `<Rebase>` delimitador (consulte [One data shape](#um-único-formato-de-dados)),
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

Gerencia o tema claro/escuro. Enquanto estiver habilitado, ele controla o tema da página: insere
a classe `dark` em `<html>`, segue `prefers-color-scheme` até que o usuário
escolha um modo e memoriza essa escolha no localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` constrói um desses internamente.

Quando o
componente que o utiliza é desmontado, ele remove a classe `dark` que adicionou; uma classe
`dark` que a página já possuía permanece. Construa o seu próprio
acima de `<Rebase>` apenas quando componentes fora dele também precisarem do modo, e passe-o
através da [prop `modeController`](#styling), para que haja apenas um controller
e não dois. `useBuildModeController({ enabled: false })` constrói um controller
inerte: ele mantém o `mode` no estado do React e não altera nenhuma classe, media query
ou localStorage. Quando seu aplicativo já gerencia o tema, você não precisa deste
hook: passe seu próprio controller como `modeController`.

#### `useBuildAdminModeController`

Alterna entre os modos Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Scaffold Components

| Componente | Descrição |
|------------|-----------|
| `<Scaffold>` | Contêiner principal de layout com barra lateral responsiva |
| `<AppBar>` | Barra de navegação superior com busca, alternador de modo e menu do usuário |
| `<Drawer>` | Navegação lateral com lista de coleções e links de visualização |
| `<SideDialogs>` | Contêiner para editores de entidade em painel lateral |
| `<RebaseRoutes>` | Contêiner de rotas que se integra com o React Router |
| `<RebaseRoute>` | Gerencia rotas de coleção (`/c/*`) |
| `<ContentHomePage>` | Página inicial padrão exibindo cards de coleção |
| `<StudioHomePage>` | Página inicial do modo Studio com ferramentas de desenvolvedor |

## Custom Views

Adicione visualizações de navegação de nível superior para dashboards, ferramentas ou páginas personalizadas. Um
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

Passe-as para `<RebaseCMS>`, junto com suas personalizações — esse é o
componente que registra a navegação:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Campo | |
|---|---|
| `slug` | o caminho pelo qual é acessada, sob a raiz da administração |
| `name` | o rótulo no drawer e na página inicial |
| `view` | o elemento a ser renderizado, ou um `ComponentType` para renderizá-lo de forma lazy |
| `icon` | o nome de um ícone do [Lucide](https://lucide.dev/icons/), por ex., `"ShoppingCart"` — ou qualquer nó |
| `group` | agrupa visualizações no drawer; `"Admin"` e `"Settings"` vão para o final |
| `pinToBottom` | fixa o grupo na parte inferior sob qualquer nome — prefira isso às duas strings mágicas |
| `nestedRoutes` | também registra `slug/*`, para uma visualização com rotas próprias |
| `hideFromNavigation` | mantém a rota, remove a entrada da navegação |
| `roles` | apenas usuários com um destes papéis veem a visualização ou podem acessá-la |
| `description` | Markdown exibido no card da página inicial |

Para colocar uma visualização sob o **Studio** em vez do CMS, passe-a para
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

O Rebase utiliza o **Tailwind CSS v4** e suporta modos claro/escuro. Personalize via:

- **Propriedades personalizadas de CSS** — Sobrescreva tokens de design
- **`<Rebase modeController>`** — Entregue ao Rebase o modo claro/escuro do seu aplicativo
- **Tailwind config** — Personalização padrão do Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modo claro e escuro

Por padrão, o `<Rebase>` controla o tema da página: ele adiciona a classe `dark` em
`<html>`, segue `prefers-color-scheme` até que o usuário escolha um modo no
painel administrativo e memoriza essa escolha no localStorage.

Quando o `<Rebase>`
é desmontado, ele remove a classe `dark` que adicionou; uma classe que a página já possuía
permanece.

Quando seu aplicativo
já possuir um tema, passe-o como `modeController`. O Rebase lê `mode` a partir dele,
chama seu `setMode` a partir do seu próprio seletor de tema e nunca toca em `<html>`,
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
menus são renderizados em um portal no `<body>`, portanto, coloque a classe em `<html>` ou `<body>`
em vez de um wrapper ao redor de `<Rebase>`.

Envolver o `<Rebase>` em um `ModeControllerProvider` não produz esse efeito:
o `<Rebase>` fornece um controller próprio internamente.

## Próximos Passos

- **[customizeTable](/docs/frontend/customize-table)** — Todas as opções da coleção de uma tabela
- **[Custom Fields](/docs/frontend/custom-fields)** — Crie campos de formulário personalizados
- **[Entity Views](/docs/frontend/entity-views)** — Adicione abas aos editores de entidade
- **[View Modes](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
- **[Translations](/docs/frontend/i18n)** — Altere qualquer string ou adicione um idioma
- **[Plugins](/docs/plugins)** — Estenda o framework
