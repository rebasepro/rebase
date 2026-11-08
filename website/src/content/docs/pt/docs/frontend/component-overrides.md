---
sourceHash: 5ceaf45e05dbf2b8
title: Substituições de Componentes (Swizzling)
sidebar_label: Substituições de Componentes
description: Substitua componentes de interface padrão por implementações personalizadas no nível da aplicação ou da coleção.
---

## Visão Geral

O Rebase permite que você substitua componentes de interface padrão por suas próprias implementações personalizadas. Isso implementa um modelo de swizzling de componentes no estilo do Docusaurus que suporta dois padrões de personalização:
- **Modo Eject** (padrão): Seu componente substitui totalmente o componente nativo.
- **Modo Wrap** (`wrap: true`): Seu componente envolve o original. O que ele envolve (geralmente o componente nativo) é passado como a prop `OriginalComponent` para que você possa renderizá-lo dentro do seu layout/lógica personalizada.

Substituições de componentes podem ser aplicadas **globalmente** no nível da aplicação (no provedor `<Rebase>`) ou **localmente** no nível da coleção (dentro de definições individuais de coleção).

---

## Substituições Globais de Componentes

Para substituir componentes globalmente em toda a sua aplicação, passe um objeto `components` para o provedor raiz `<Rebase>`.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Substituições de Componentes no Nível de Coleção

Para substituir componentes apenas para uma coleção específica, adicione um objeto `components` sob o bloco `admin` dela. Isso é útil para personalizar empty states, cards ou visualizações de detalhes para modelos específicos.

No scaffold padrão, `config/collections/` é carregado **tanto** pelo painel administrativo quanto pelo backend, que lê os mesmos arquivos para derivar o schema e a API. Portanto, aponte para cada componente por **caminho de módulo** em vez de importá-lo. `Component` aceita os mesmos formatos que `admin.Field` e `entityViews[].Builder`: um caminho, um `import()` lazy ou o próprio componente.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

O componente wrapper fica junto com o restante do seu código frontend e recebe o que ele envolve como `OriginalComponent` — o componente nativo, a menos que sua aplicação também o substitua (consulte [Quando ambos os escopos substituem um componente](#quando-ambos-os-escopos-substituem-um-componente)):

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Cada módulo precisa de um **export default**. O plugin Vite de coleções reescreve um caminho em uma importação lazy, de modo que o componente seja seu próprio chunk e carregue na primeira vez que a substituição for renderizada. Essa reescrita abrange os arquivos dentro do `collectionsDir` configurado. Um caminho em um arquivo fora dele chega ao admin como uma string pura: o console avisa sobre isso, e o componente nativo é renderizado em seu lugar. Fora de `collectionsDir`, escreva a importação lazy você mesmo: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Uma referência direta (`Component: ProductCustomForm`) também funciona, mas apenas em um arquivo de coleção que nada no servidor carregue, pois importar o componente também importa o React e tudo o que ele traz consigo.

### Quando ambos os escopos substituem um componente

Na versão 0.24, o wrapper de uma coleção sempre recebe o componente nativo, e a substituição no nível da aplicação é ignorada dentro dessa coleção.

Os dois escopos se compõem. A substituição no nível da aplicação (`<Rebase components>`) é aplicada primeiro ao componente nativo, e a da coleção (`admin.components`) é aplicada ao resultado:

| Nível da aplicação | Nível da coleção | O que renderiza dentro dessa coleção |
|---|---|---|
| qualquer | nenhum | o que renderiza em todos os outros lugares: a substituição no nível da aplicação ou o componente nativo |
| nenhum | wrap | o wrapper da coleção em torno do componente nativo |
| replace ou wrap | wrap | o wrapper da coleção em torno da substituição no nível da aplicação, passado como `OriginalComponent` |
| qualquer | replace | o componente da coleção sozinho; ele substitui ambos |

Assim, uma coleção pode adicionar algo em torno de um componente que sua aplicação já personaliza sem perder essa personalização. Para descartar a versão do nível da aplicação em uma coleção específica, use replace em vez de wrap.

---

## Escopos de Componentes Substituíveis

### Componentes com Escopo de Aplicação (`AppComponentName`)

Esses componentes só podem ser substituídos no nível do provedor raiz `<Rebase>`, pois representam a estrutura no nível do shell.

| Chave do Componente | Descrição |
|---|---|
| `"Shell.AppBar"` | A barra de cabeçalho no topo da página |
| `"Shell.Drawer"` | O menu lateral retrátil principal de navegação |
| `"Shell.DrawerNavigationItem"` | Links individuais dentro da barra lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeçalhos de grupos de navegação retráteis na barra lateral |
| `"HomePage"` | A página inicial padrão do modo de conteúdo |
| `"HomePage.CollectionCard"` | Cards individuais de coleção na página inicial |
| `"Auth.LoginView"` | A sobreposição exibida ao solicitar autenticação |

### Componentes com Escopo de Coleção (`CollectionComponentName`)

Esses componentes podem ser substituídos globalmente (atuando como padrões para todas as coleções) ou em coleções individuais.

| Chave do Componente | Descrição |
|---|---|
| `"Collection.View"` | A página principal completa da coleção |
| `"Collection.Table"` | A visualização tabular padrão em formato de planilha |
| `"Collection.Card"` | O wrapper de item da visualização em cards |
| `"Collection.EmptyState"` | Visualização exibida quando uma coleção está vazia |
| `"Collection.Actions"` | Botões da barra de ferramentas acima da tabela/cards |
| `"Collection.FilterField"` | Campo de filtro personalizado para uma coluna |
| `"Entity.Form"` | O formulário de detalhes para criação/atualização |
| `"EditView.FormActions"` | Barra de botões de envio/cancelamento do formulário |
| `"DetailView"` | Visualização de detalhes somente leitura |
| `"Entity.SidePanel"` | O contêiner do painel lateral para formulário/detalhes |
| `"EntityPreview"` | Pré-visualização inline em chip de referência/relação |
| `"Entity.MissingReference"` | Renderizado quando uma entidade referenciada está ausente |

:::note[Três chaves quebram o padrão `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` não possuem o prefixo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` não
estão na união — eles causam erro de tipo (type-error), e em JavaScript puro a
substituição simplesmente nunca é aplicada.
:::

Sua substituição recebe as mesmas props que foram fornecidas ao componente nativo. O
mapa de substituições não define um tipo de props por chave — `ComponentOverride<P>` padroniza
`P` como `Record<string, unknown>` — portanto, tipifique o parâmetro você mesmo ou passe um
argumento de tipo quando desejar a verificação de props. Alguns dos componentes nativos exportam
um tipo de props que você pode importar e reutilizar: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` e
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). Os demais não possuem um tipo de props exportado — defina o formato
que você de fato utiliza.

### O que uma substituição de `Collection.View` deve respeitar

`Collection.View` é o que um `CollectionPanel` renderiza, portanto, as props do painel chegam
à sua substituição como `CollectionViewBindingProps` (`@rebasepro/cms`), combinadas com as
da própria coleção. Uma substituição que as ignore quebra todas as páginas que incorporam a
coleção. Respeite pelo menos estas:

| Prop | O que o chamador espera |
|---|---|
| `collectionOverrides` | O que o chamador altera na coleção (um filtro fixo, uma ordenação, o modo de visualização), aplicado sobre a coleção registrada |
| `fields` | Apenas estas propriedades, nesta ordem: as colunas e a partir de onde as linhas da lista e cards são preenchidos |
| `highlightedEntityId` | A linha exibida como selecionada; `null` para nenhuma |
| `onEntityClick` | Chamado com a linha clicada (uma `Entity`) em vez de abri-la. O `onRowClick` do painel chega como este |

O painel também passa `viewMode` (o modo no qual abrir), `toolbar` (a barra de ferramentas
a ser renderizada, `null` para nenhuma) e `title` (`false` para não renderizar título), caso seu
chamador os tenha definido. O `CollectionViewBinding` nativo lida com todos eles; uma
substituição que o envolva em vez de substituí-lo pode simplesmente repassá-los diretamente.

Para começar a partir da parte nativa em vez do zero, copie seu código-fonte para
o seu projeto e registre a cópia aqui: todas as partes, exceto `Collection.View`,
`DetailView` e o drag-and-drop da página inicial, compilam com importações de pacotes.
Consulte [Copiando uma parte nativa](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionado

- [Extending Rebase](/docs/frontend/extending/) — os pontos de extensão que não precisam de uma substituição
- [Custom Fields](/docs/frontend/custom-fields/) — substituindo o editor de uma propriedade em vez de um componente
- [Slots](/docs/frontend/slots/) — adicionando a um componente em vez de substituí-lo
