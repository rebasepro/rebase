---
sourceHash: 950f7cd092f53f01
title: Substituições de Componentes (Swizzling)
sidebar_label: Substituições de Componentes
description: Substitua componentes de UI padrão por implementações personalizadas no nível da aplicação ou da coleção.
---

## Visão Geral

O Rebase permite substituir componentes de UI padrão por suas próprias implementações personalizadas. Isso implementa um modelo de swizzling de componentes no estilo Docusaurus, que suporta dois padrões de customização:
- **Modo Eject** (padrão): Seu componente substitui totalmente o componente integrado (built-in).
- **Modo Wrap** (`wrap: true`): Seu componente envolve o original. O que ele envolve (geralmente o componente integrado) é passado como a prop `OriginalComponent`, permitindo que você o renderize dentro do seu layout/lógica personalizada.

As substituições de componentes podem ser aplicadas **globalmente** no nível da aplicação (no provedor `<Rebase>`) ou **localmente** no nível da coleção (dentro das definições individuais de cada coleção).

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

Para substituir componentes apenas para uma coleção específica, adicione um objeto `components` sob o seu bloco `admin`. Isso é útil para personalizar estados vazios (empty states), cards ou visualizações detalhadas para modelos específicos.

No scaffold padrão, `config/collections/` é carregado **tanto** pelo painel administrativo quanto pelo backend, que lê os mesmos arquivos para derivar o esquema e a API. Portanto, aponte para cada componente pelo **caminho do módulo** em vez de importá-lo. `Component` aceita os mesmos formatos que `admin.Field` e `entityViews[].Builder`: um caminho, um `import()` lazy ou o próprio componente.

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

O componente que envolve o original fica junto com o restante do código do seu frontend e recebe o que ele envolve como `OriginalComponent` — o componente integrado, a menos que sua aplicação também o substitua (consulte [Quando ambos os escopos substituem um componente](#quando-ambos-os-escopos-substituem-um-componente)):

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

Cada módulo precisa de um **default export**. O plugin Vite de coleções reescreve um caminho em uma importação lazy, de forma que o componente fica em seu próprio chunk e é carregado na primeira vez que a substituição for renderizada. Essa reescrita cobre os arquivos dentro do `collectionsDir` configurado. Um caminho em um arquivo fora dele chega ao admin como uma string pura: o console indicará isso e o componente integrado será renderizado em seu lugar. Fora de `collectionsDir`, escreva você mesmo a importação lazy: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Uma referência direta (`Component: ProductCustomForm`) também funciona, mas apenas em um arquivo de coleção que nada no servidor carregue, pois importar o componente também importa o React e tudo o que ele traz consigo.

### Quando ambos os escopos substituem um componente

Os dois escopos se compõem. A substituição no nível da aplicação (`<Rebase components>`) é aplicada primeiro ao componente integrado, e a da coleção (`admin.components`) é aplicada ao resultado:

| Nível da aplicação | Nível da coleção | O que renderiza dentro dessa coleção |
|---|---|---|
| qualquer | nenhum | o que renderiza em todos os outros lugares: a substituição no nível da aplicação ou o componente integrado |
| nenhum | wrap | o wrapper da coleção em torno do componente integrado |
| replace ou wrap | wrap | o wrapper da coleção em torno da substituição no nível da aplicação, passado como `OriginalComponent` |
| qualquer | replace | somente o componente da coleção; ele substitui ambos |

Assim, uma coleção pode adicionar algo em torno de um componente que sua aplicação já personaliza sem perder essa personalização. Para descartar a versão no nível da aplicação para uma coleção, use a substituição direta (replace) em vez de envolver (wrap).

---

## Escopos de Componentes Substituíveis

### Componentes com Escopo de Aplicação (`AppComponentName`)

Esses componentes só podem ser substituídos no nível do provedor raiz `<Rebase>`, pois representam a estrutura de nível de shell.

| Chave do Componente | Descrição |
|---|---|
| `"Shell.AppBar"` | A barra de cabeçalho no topo da página |
| `"Shell.Drawer"` | A gaveta retrátil de navegação da barra lateral principal |
| `"Shell.DrawerNavigationItem"` | Links individuais dentro da barra lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeçalhos retráteis de grupos de navegação na barra lateral |
| `"HomePage"` | A página inicial padrão do modo de conteúdo |
| `"HomePage.CollectionCard"` | Cards individuais de coleção na página inicial |
| `"Auth.LoginView"` | A sobreposição (overlay) exibida ao solicitar autenticação |

### Componentes com Escopo de Coleção (`CollectionComponentName`)

Esses componentes podem ser substituídos globalmente (atuando como padrões para todas as coleções) ou em coleções individuais.

| Chave do Componente | Descrição |
|---|---|
| `"Collection.View"` | A página inicial completa da coleção |
| `"Collection.Table"` | A visualização tabular padrão em formato de planilha |
| `"Collection.Card"` | O wrapper de item da visualização em cards |
| `"Collection.EmptyState"` | Visualização exibida quando uma coleção está vazia |
| `"Collection.Actions"` | Botões da barra de ferramentas acima da tabela/cards |
| `"Collection.FilterField"` | Campo de filtro personalizado para uma coluna |
| `"Entity.Form"` | O formulário de detalhes para criação/atualização |
| `"EditView.FormActions"` | Barra de botões para envio/cancelamento de formulário |
| `"DetailView"` | Visualização de detalhes somente leitura |
| `"Entity.SidePanel"` | O contêiner do painel lateral para formulário/detalhes |
| `"EntityPreview"` | Pré-visualização inline em chip de referência/relação |
| `"Entity.MissingReference"` | Renderizado quando uma entidade referenciada está ausente |

:::note[Três chaves não seguem o padrão `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` não possuem o prefixo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` não
estão na união — eles geram erro de tipagem e, em JavaScript puro, a substituição
simplesmente nunca é aplicada.
:::

Seu substituto recebe as mesmas props fornecidas ao componente integrado. O
mapa de substituições não define um tipo de props por chave — `ComponentOverride<P>` define
o padrão de `P` como `Record<string, unknown>` — portanto, tipifique o parâmetro você mesmo
ou passe um argumento de tipo quando quiser checagem de tipos nas props. Alguns dos
componentes integrados exportam um tipo de props que você pode importar e reutilizar:
`CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`,
`SidePanelBindingProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` e `DrawerNavigationGroupProps`
(`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). Os demais não têm tipo de props
exportado — defina o formato que você de fato utiliza.

### O que uma substituição de `Collection.View` deve respeitar

`Collection.View` é o que um `CollectionPanel` renderiza, portanto as props do painel
chegam à sua substituição como `CollectionViewBindingProps` (`@rebasepro/cms`), combinadas com
as da própria coleção. Uma substituição que as ignore quebra todas as páginas que incorporam
a coleção. Respeite pelo menos estas:

| Prop | O que o chamador espera |
|---|---|
| `collectionOverrides` | O que o chamador altera na coleção (um filtro fixo, uma ordenação, o modo de visualização), aplicado sobre a coleção registrada |
| `fields` | Apenas estas propriedades, nesta ordem: as colunas e os dados com os quais as linhas da lista e os cards são preenchidos |
| `highlightedIds` | Os IDs das linhas exibidas como selecionadas; `[]` para nenhuma |
| `onRowClick` | Chamado com a linha clicada, conforme enviada pelo servidor, e seu ID, em vez de abri-la. O próprio `onRowClick` do painel |

O painel também passa `viewMode` (o modo no qual abrir), `toolbar` (a barra de ferramentas
a ser renderizada, `null` para nenhuma) e `title` (`false` para não renderizar título), quando
definidos pelo chamador. O `CollectionViewBinding` integrado lida com todos eles; uma
substituição que o envolva em vez de substituí-lo pode apenas repassá-los diretamente.

Para começar a partir da parte integrada em vez do zero, copie seu código-fonte para
o seu projeto e registre a cópia aqui: todas as partes, exceto `Collection.View`,
`DetailView` e o drag-and-drop da página inicial, compilam com importações de pacotes.
Consulte [Copiando uma parte integrada](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionados

- [Estendendo o Rebase](/docs/frontend/extending/) — os pontos de extensão que não precisam de substituição
- [Campos Personalizados](/docs/frontend/custom-fields/) — substituindo o editor de uma propriedade em vez de um componente
- [Slots](/docs/frontend/slots/) — adicionando elementos a um componente em vez de substituí-lo
