---
sourceHash: 91344f4bf4cb8889
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
- Injetar componentes de **visualização de coleção** (barra de ferramentas, construtores de coluna)
- Adicionar componentes de **formulário** (construtores de campo, painéis adicionais)
- **Injetar ou modificar coleções** dinamicamente

## Interface do Plugin

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: SlotContribution[];

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

    lifecycle?: PluginLifecycle;
}
```

Cada um desses itens é opcional, exceto `key`. A lista completa de nomes de slots
está na página de **[Slots](/docs/frontend/slots)**.

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
        // a *component* (or null to leave the default field alone) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

## Plugins Nativos

### Plugin de Aprimoramento de Dados

Preenchimento automático de campos com tecnologia de IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Data enhancement](/img/data_enhancement.png)

:::caution[Este recurso envia dados para fora da sua máquina]
O preenchimento automático envia os valores dos campos da entidade para um serviço
hospedado para gerar uma sugestão. Por padrão, esse serviço é **`https://app.rebase.pro/api/functions/ai`**,
executado pelo Rebase — gratuito para uso, sem necessidade de configuração e sem
credencial anexada: as requisições são anônimas, limitadas por rate limit em vez de
identidade. Seu JWT não é enviado.

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
    // Use `modifyCollectionAsync` when the change needs a fetch.
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

## Próximos Passos

- **[Ferramentas do Studio](/docs/studio)** — Console SQL, console JS, editor RLS
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construção de campos de formulário personalizados
