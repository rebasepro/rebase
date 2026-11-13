---
sourceHash: d1b243f804318232
title: Sistema de Plugins
sidebar_label: Plugins
description: Estenda o Rebase com plugins — injete componentes de interface, modifique coleções, adicione ações na barra de ferramentas e crie construtores de campos personalizados.
---

## Visão Geral

**Os plugins são um conceito do painel de administração.** Eles são executados no navegador,
dentro do admin React, e são registrados onde você o compila. Nada nesta página
atinge o backend: um plugin não pode adicionar uma rota, um callback ou um cron. Para isso,
consulte [Funções Personalizadas](/docs/backend/custom-functions), [Callbacks de Entidade](/docs/collections/callbacks)
e [Tarefas Cron](/docs/backend/cron-jobs).

Os plugins são o principal mecanismo de extensão no painel. Eles podem:

- Envolver toda a aplicação com um **provider** (contexto, gerenciamento de estado)
- Adicionar **ações na página inicial** e widgets
- Injetar componentes de **visualização de coleção** (barra de ferramentas, cabeçalhos de coluna)
- Adicionar componentes de **formulário** (construtores de campos, painéis adicionais)
- **Injetar ou modificar coleções** dinamicamente

## Interface do Plugin

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: AnySlotContribution[];

    // HOC providers. `scope: "root"` wraps the whole admin below
    // RebaseContext; `scope: "form"` wraps each entity form / edit view.
    providers?: PluginProvider[];

    // Behavioural (non-UI) hooks: collection modification and injection,
    // column reordering, navigation entries.
    hooks?: PluginHooks;

    // Custom field rendering (e.g. data enhancement).
    fieldBuilder?: FieldBuilderConfig;

    // Views added to the navigation automatically.
    views?: AppView[];

    // onMount, onAuthStateChange, onUnmount — see below.
    lifecycle?: PluginLifecycle;
}
```

Cada um desses é opcional, exceto o `key`. A lista completa de nomes de slots está na
página **[Slots](/docs/frontend/slots)**.

### Ciclo de Vida

- `onMount(context)` é executado uma vez, quando a autenticação fica pronta pela primeira vez: um usuário
  está conectado ou o login foi ignorado.
- `onAuthStateChange(user)` é executado a cada alteração posterior de usuário: o novo usuário no
  login, `null` no logout. O plugin permanece montado em ambos os casos.
- `onUnmount()` é executado quando `<Rebase>` é desmontado.

`lifecycle.onCollectionChange` está depreciado. Nada nunca o chamou. Um plugin que o define ainda compila, e o `<Rebase>` emite um aviso uma vez por
plugin. Para acompanhar as linhas de uma coleção, inscreva-se a partir de `onMount` e
cancele a inscrição em `onUnmount`:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

let stopListening: (() => void) | undefined;

const openOrdersPlugin: RebasePlugin = {
    key: "open_orders",
    lifecycle: {
        onMount: (context) => {
            stopListening = context.data.orders.listen(
                { where: { status: ["==", "open"] } },
                ({ data }) => console.log(`${data.length} open orders`)
            );
        },
        onUnmount: () => stopListening?.()
    }
};
```

## Usando Plugins

Os plugins são inseridos no `<Rebase>`, ao lado do client. Tudo abaixo dele — a
navegação, as visualizações de coleção, os formulários — os lê a partir dali:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

export function App() {
    const authController = useRebaseAuthController({ client });
    const dataEnhancementPlugin = useDataEnhancementPlugin();

    return (
        <Rebase
            client={client}
            authController={authController}
            plugins={[dataEnhancementPlugin]}
        >
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Os plugins geralmente são construídos por um hook, portanto o array é reconstruído a cada renderização;
isso é normal e é a razão pela qual `plugins` é uma prop em vez de algo que você
memoriza manualmente. Dois plugins com o mesmo `key` são um erro — o `<Rebase>`
registra os duplicados em log em vez de descartar um silenciosamente.

Para uma única contribuição, você não precisa de um plugin: o `<Rebase slots>`
aceita diretamente as mesmas entradas de `SlotContribution`.

### Sob composição manual

Somente se você tiver substituído o `<RebaseShell>` pelas camadas subjacentes a ele,
a lista de plugins precisará ser encadeada manualmente no controlador de navegação:

```tsx
const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // These four are required — the controller resolves navigation against them.
    authController,
    data,
    collectionRegistryController,
    urlController
});
```

O `<RebaseNavigation>` faz exatamente essa chamada para você, lendo `plugins` do
controlador de personalização fornecido por `<Rebase>`. Consulte
[Avançado: layout manual](/docs/frontend#advanced-manual-layout).

## Construindo um Plugin

Aqui está um plugin mínimo que adiciona uma ação na barra de ferramentas a cada coleção:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

function useMyPlugin(): RebasePlugin {
    return {
        key: "my_plugin",

        // `slots` is a flat array of contributions, each naming its slot.
        // See the Slots page for the full list of slot names.
        slots: [
            { slot: "collection.actions", Component: MyToolbarAction }
        ],

        // `fieldBuilder` is top-level and takes a `wrap` function that returns
        // a *component* (or null to leave the field as it is) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

### Wrappers de campo de vários plugins

Wrappers de vários plugins são compostos na ordem do array `plugins`.
O `wrap` de cada plugin recebe, como `params.Field`, o campo tal como os plugins
anteriores o deixaram, de modo que o wrapper do primeiro plugin seja o mais interno e o
do último seja o mais externo. Um plugin cujo `wrap` retorna `null`, ou cujo
guard `enabled` retorna `false` para o campo, o repassa inalterado. Um wrapper que
renderiza `Field`, portanto, mantém todos os wrappers anteriores a ele:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";
import { Typography } from "@rebasepro/ui";

const descriptionPlugin: RebasePlugin = {
    key: "description_below",
    fieldBuilder: {
        // `Field` is the built-in field, or the earlier plugins' wrapper of it.
        wrap: ({ Field, property }) => property.description
            ? (props) => (
                <>
                    <Field {...props}/>
                    <Typography variant="caption" color="secondary">
                        {property.description}
                    </Typography>
                </>
            )
            : null
    }
};
```

## Plugins Integrados



### Plugin de Aprimoramento de Dados

Autocompletar de campos baseado em IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

Ele adiciona uma ação de Autofill a cada formulário e um comando de barra (slash command)
**Autocomplete** a cada campo markdown, que continua o texto a partir do cursor. Ambos aparecem
apenas onde o plugin está habilitado: o serviço informa que está disponível e
`getConfigForPath` (quando fornecido) permite a coleção. Um campo cujo
`customProps.editorProps.aiController` especifica um controlador próprio usará
esse. Outro plugin pode fornecer um controlador aos campos markdown da mesma maneira, com
o `EditorAIControllerProvider` do `@rebasepro/cms` em um provider com escopo de formulário.

![Aprimoramento de dados](/img/data_enhancement.png)

:::caution[Este recurso envia dados para fora da sua máquina]
O Autofill envia (POST) os valores dos campos da entidade para um serviço hospedado para gerar uma
sugestão: apenas os valores das propriedades declaradas, nunca de propriedades somente leitura,
desabilitadas ou ocultas, com `dynamicProps`, ou de uma coluna não declarada pela coleção. Por padrão,
esse serviço é **`https://app.rebase.pro/api/functions/ai`**, operado pelo Rebase — gratuito para uso,
sem configuração e sem credencial anexada: as requisições são anônimas, limitadas por rate limit
e não por identidade. Seu JWT não é enviado. O autocompletar por barra do editor também envia texto:
até 8.000 caracteres em cada lado do cursor, nunca o documento inteiro.

Se isso é aceitável ou não depende do que está nos campos. Aponte o `endpoint` para
a sua própria infraestrutura para manter a geração dentro dela:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

O formato da mensagem (wire format) é todo o contrato — consulte `api.ts` em `@rebasepro/plugin-ai`,
com uma implementação de referência no `functions/ai.ts` do plano de controle. O
plugin não renderiza nada até que o host para o qual ele aponta reporte que está disponível em
`GET /status`, portanto uma URL incorreta resulta em um botão ausente em vez de uma requisição com falha.

Todos os outros plugins integrados são locais ao navegador e não enviam nada para lugar nenhum.
:::

## Injeção de Coleções

Os plugins podem adicionar novas coleções dinamicamente:

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Modificação de Coleções

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os plugins podem modificar coleções existentes:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    modifyCollection: (collection) => ({
        ...collection,
        description: `${collection.description ?? ""} Managed by the ops team.`.trim()
    })
}
```

A coleção que um plugin recebe é a visualização resolvida da tabela pelo painel, após
a aplicação de seu `customizeTable`, portanto o plugin vê exatamente o que o painel está prestes
a renderizar.

`modifyCollection` é síncrono, e o admin o aplica quando resolve suas coleções,
não a cada alteração do plugin. Quando a alteração precisa de dados que você tem que
buscar, busque-os antes de renderizar o `<Rebase>` e construa o plugin a partir do
que for retornado:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import type { RebasePlugin } from "@rebasepro/cms-types";
import { CircularProgressCenter } from "@rebasepro/ui";

export function App() {
    const authController = useRebaseAuthController({ client });
    const [labels, setLabels] = useState<Record<string, string>>();

    useEffect(() => {
        fetch("/collection-labels.json")
            .then((response) => response.json())
            .then(setLabels);
    }, []);

    const labelsPlugin = useMemo<RebasePlugin | undefined>(() => labels && {
        key: "collection_labels",
        hooks: {
            modifyCollection: (collection) => ({
                ...collection,
                name: labels[collection.slug] ?? collection.name
            })
        }
    }, [labels]);

    if (!labelsPlugin) return <CircularProgressCenter/>;

    return (
        <Rebase client={client} authController={authController} plugins={[labelsPlugin]}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

`hooks.modifyCollectionAsync` está depreciado. Nada nunca o chamou. Um plugin que o define ainda compila, e o `<Rebase>` emite um aviso uma vez por
plugin. Use `modifyCollection` como mostrado acima.

## Próximos Passos

- **[Ferramentas do Studio](/docs/studio)** — Console SQL, console JS, editor de RLS
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construindo campos de formulário personalizados
