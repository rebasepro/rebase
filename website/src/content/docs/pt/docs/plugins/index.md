---
sourceHash: 71525adfd73230ec
title: Sistema de Plugins
sidebar_label: Plugins
description: Estenda o Rebase com plugins — injete componentes de UI, modifique coleções, adicione ações na barra de ferramentas e crie construtores de campos personalizados.
---

## Visão Geral

**Plugins são um conceito do painel de administração.** Eles são executados no
navegador, dentro do admin React, e são registrados onde você o constrói. Nada
nesta página alcança o backend: um plugin não pode adicionar uma rota, um
callback ou um cron. Para isso, consulte [Funções Personalizadas](/docs/backend/custom-functions),
[Callbacks de Entidade](/docs/collections/callbacks) e [Tarefas Cron](/docs/backend/cron-jobs).

Os plugins são o principal mecanismo de extensão no painel. Eles podem:

- Envolver toda a aplicação com um **provider** (contexto, gerenciamento de estado)
- Adicionar **ações na página inicial** e widgets
- Injetar componentes de **visualização de coleção** (barra de ferramentas, cabeçalhos de coluna)
- Adicionar componentes de **formulário** (construtores de campo, painéis adicionais)
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

Cada um desses itens é opcional, exceto `key`. A lista completa de nomes de slots
está na página de **[Slots](/docs/frontend/slots)**.

### Ciclo de vida

- `onMount(context)` é executado uma vez, quando a autenticação fica pronta pela
  primeira vez: um usuário está logado, ou o login foi pulado.
- `onAuthStateChange(user)` é executado a cada mudança de usuário posterior: com
  o novo usuário ao fazer login, com `null` ao sair. O plugin continua montado
  nos dois casos.
- `onUnmount()` é executado quando `<Rebase>` é desmontado.

`lifecycle.onCollectionChange` está obsoleto. Nada nunca o chamou, na 0.24
ou antes. Um plugin que o define continua compilando, e o `<Rebase>` avisa uma vez por
plugin. Para acompanhar as linhas de uma coleção, assine a partir de `onMount` e
cancele a assinatura em `onUnmount`:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

let stopListening: (() => void) | undefined;

const openOrdersPlugin: RebasePlugin = {
    key: "open_orders",
    lifecycle: {
        onMount: (context) => {
            stopListening = context.data.collection("orders").listen(
                { where: { status: ["==", "open"] } },
                ({ data }) => console.log(`${data.length} open orders`)
            );
        },
        onUnmount: () => stopListening?.()
    }
};
```

## Usando Plugins

Os plugins são adicionados no `<Rebase>`, junto ao client. Tudo abaixo dele — a
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
            <RebaseCMS collections={collections}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Os plugins geralmente são construídos por um hook, portanto, o array é reconstruído
a cada renderização; isso é esperado e é a razão pela qual `plugins` é uma prop
em vez de algo memorizado manualmente com memoize. Dois plugins com a mesma `key`
são um erro — o `<Rebase>` registra os duplicados no log em vez de descartar um
silenciosamente.

Para uma única contribuição, você não precisa de um plugin: `<Rebase slots>`
aceita diretamente as mesmas entradas de `SlotContribution`.

### Sob composição manual

Apenas se você tiver substituído o `<RebaseShell>` pelas camadas subjacentes a
ele, a lista de plugins precisará ser repassada manualmente para o controlador de
navegação:

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

O `<RebaseNavigation>` faz exatamente essa chamada para você, lendo `plugins`
a partir do controlador de customização fornecido pelo `<Rebase>`. Consulte
[Avançado: layout manual](/docs/frontend#advanced-manual-layout).

## Construindo um Plugin

Aqui está um plugin mínimo que adiciona uma ação de barra de ferramentas a cada coleção:

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

Na 0.24 o `wrap` de cada
plugin recebia o campo integrado, e apenas o último wrapper
retornado era renderizado.

Os wrappers de vários plugins se compõem, na ordem do array `plugins`.
O `wrap` de cada plugin recebe, como `params.Field`, o campo como os plugins
anteriores a ele o deixaram, de modo que o wrapper do primeiro plugin fica por dentro e o do último
por fora. Um plugin cujo `wrap` retorna `null`, ou cuja proteção `enabled`
retorna `false` para o campo, o repassa inalterado. Um wrapper que
renderiza `Field` mantém, portanto, todos os wrappers anteriores a ele:

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

## Plugins Nativos

### Plugin de Aprimoramento de Dados

Preenchimento automático de campos com tecnologia de IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

Ele adiciona uma ação Autofill a todo formulário e um comando de barra **Autocomplete**
a todo campo markdown, que continua o texto a partir do cursor. Ambos aparecem
apenas onde o plugin está habilitado: o serviço se declara disponível e
`getConfigForPath` (quando você passa um) permite a coleção. Um campo cujo
`customProps.editorProps.aiController` nomeia um controlador próprio usa
esse. Outro plugin pode dar aos campos markdown um controlador da mesma forma, com
`EditorAIControllerProvider` de `@rebasepro/cms` em um provider no escopo do formulário.

![Data enhancement](/img/data_enhancement.png)

:::caution[Este recurso envia dados para fora da sua máquina]
O preenchimento automático envia os valores dos campos da entidade para um serviço
hospedado para gerar uma sugestão. Por padrão, esse serviço é **`https://app.rebase.pro/api/functions/ai`**,
executado pelo Rebase — gratuito para uso, sem necessidade de configuração e sem
credencial anexada: as requisições são anônimas, limitadas por rate limit em vez de
identidade. Seu JWT não é enviado. O autocompletar por barra (slash) do editor também envia texto: até 8.000
caracteres de cada lado do cursor, nunca o documento inteiro.

Se isso é aceitável ou não depende do que está contido nos campos. Aponte o `endpoint`
para sua própria implantação para manter a geração dentro da sua infraestrutura:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

O formato de transmissão (wire format) é todo o contrato — consulte `api.ts` em
`@rebasepro/plugin-ai`, com uma implementação de referência em `functions/ai.ts` no
plano de controle. O plugin não renderiza nada até que o host para o qual ele aponta
informe que está disponível em `GET /status`, de modo que uma URL incorreta resulta
em um botão ausente em vez de uma requisição com falha.

Todos os outros plugins nativos são locais no navegador e não enviam nada para lugar algum.
:::

## Injeção de Coleções

Plugins podem adicionar novas coleções dinamicamente:

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Modificação de Coleções

Plugins podem modificar coleções existentes:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    modifyCollection: (collection) => ({
        ...collection,
        properties: {
            ...collection.properties,
            last_modified_by: {
                type: "string",
                name: "Modified By",
                admin: { readOnly: true }
            }
        }
    })
}
```

O `modifyCollection` é síncrono, e a administração o aplica quando resolve
suas coleções, não toda vez que o plugin muda. Quando a mudança precisa de dados
que você tem de buscar, busque-os antes de renderizar o `<Rebase>` e construa o plugin
a partir do que voltou:

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
            <RebaseCMS collections={collections}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

`hooks.modifyCollectionAsync` está obsoleto. Nada nunca o chamou, na 0.24
ou antes. Um plugin que o define continua compilando, e o `<Rebase>` avisa uma vez por
plugin. Use `modifyCollection`, como acima.

## Próximos Passos

- **[Ferramentas do Studio](/docs/studio)** — Console SQL, console JS, editor RLS
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construção de campos de formulário personalizados
