---
title: Campos Personalizados
sidebar_label: Campos Personalizados
description: Crie campos de formulário personalizados para edição de entidades com acesso total ao contexto do formulário, valores da entidade e hooks do Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Visão Geral

Rebase gera campos de formulário automaticamente com base nos tipos de propriedade. Para um comportamento personalizado, você pode criar seus próprios campos.

## Criando um Campo Personalizado

Um campo personalizado é um componente React que recebe `FieldProps`:

```tsx
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty, NumberProperty } from "@rebasepro/types";

function ColorPickerField({ value, setValue, error, showError }: FieldProps<StringProperty>) {
    return (
        <div>
            <input
                type="color"
                value={value ?? "#000000"}
                onChange={(e) => setValue(e.target.value)}
            />
            {showError && error && <span className="text-red-500">{error}</span>}
        </div>
    );
}
```

### FieldProps

| Propriedade | Tipo | Descrição |
|------|------|-------------|
| `value` | `T` | Valor atual do campo |
| `setValue` | `(value: T) => void` | Atualiza o valor do campo |
| `error` | `string` | Mensagem de erro de validação |
| `showError` | `boolean` | Se deve exibir o erro |
| `isSubmitting` | `boolean` | O formulário está sendo salvo |
| `property` | `Property` | A configuração da propriedade |
| `context` | `FormContext` | Contexto completo do formulário com todos os valores da entidade |
| `disabled` | `boolean` | O campo é somente leitura |
| `tableMode` | `boolean` | Renderização dentro da planilha (modo compacto) |

## Registrando um Campo Personalizado

### Por Propriedade

Registre em uma única propriedade:

```typescript
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: ColorPickerField
        }
    }
}
```

### Quando o ficheiro da collection também é lido pelo servidor

No scaffold predefinido, `config/collections/` é carregado **tanto** pelo painel de administração como pelo backend — o backend lê os mesmos ficheiros para derivar o esquema e a API. Uma referência direta ao componente só é segura se nada no servidor carregar esse ficheiro, porque importar `ColorPickerField` importa também o React, o teu CSS e tudo o que o componente arraste para o grafo de módulos do servidor.

Aponta para o componente com um import lazy. É verificado nos tipos da mesma forma e o backend nunca o chama:

```ts no-verify
// config/collections/products.ts
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: () => import("../../frontend/src/ColorPickerField"),
            Preview: () => import("../../frontend/src/ColorPreview")
        }
    }
}
```

O módulo tem de ter um **export default** — o thunk resolve para `default`, e um export apenas nomeado não renderiza nada. O painel envolve-o em `React.lazy` no primeiro render, pelo que o componente fica num chunk próprio em vez do bundle inicial.

### Configuração de Propriedade Global

Registre um tipo de campo reutilizável:

```tsx
const colorPropertyConfig: PropertyConfig = {
    key: "color_picker",
    name: "Color Picker",
    property: {
        type: "string",
        admin: {
            Field: ColorPickerField
        }
    }
};

// Register globally — keyed by the config's `key`
<Rebase propertyConfigs={{ color_picker: colorPropertyConfig }}>…</Rebase>
```

Então use-o em qualquer coleção:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Acessando o Contexto do Formulário

Campos personalizados podem acessar os valores completos da entidade:

```tsx
function PriceWithTaxField({ value, setValue, context }: FieldProps<NumberProperty>) {
    const taxRate = Number(context.values.tax_rate ?? 0.1);
    const priceWithTax = value ? value * (1 + taxRate) : 0;

    return (
        <div>
            <input
                type="number"
                value={value ?? 0}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <p>With tax: ${priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Modo Tabela

Ao renderizar na visualização de planilha, os campos devem ser compactos. Verifique `tableMode`:

```tsx
function MyField({ value, setValue, minimalistView }: FieldProps<StringProperty>) {
    if (minimalistView) {
        return <span onClick={() => { /* open editor */ }}>{value}</span>;
    }

    return (
        <div>
            <label>Full Editor</label>
            <textarea value={value ?? ""} onChange={(e) => setValue(e.target.value)} />
        </div>
    );
}
```

## Pré-visualizações Personalizadas

Para renderização personalizada na tabela (modo não-edição), use o componente `Preview`:

```tsx
function ColorPreview({ value }: { value: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
                width: 24, height: 24,
                borderRadius: 4,
                backgroundColor: value
            }} />
            <span>{value}</span>
        </div>
    );
}

// Registre-o
properties: {
    color: {
        type: "string",
        name: "Color",
        admin: {
            Field: ColorPickerField,
            Preview: ColorPreview
        }
    }
}
```

## Próximos Passos

- **[Visualizações de Entidade](/docs/frontend/entity-views)** — Abas personalizadas no editor de entidade
- **[Ações de Entidade](/docs/frontend/entity-actions)** — Botões de ação personalizados
- **[Colunas Adicionais](/docs/frontend/additional-columns)** — Colunas de tabela calculadas
