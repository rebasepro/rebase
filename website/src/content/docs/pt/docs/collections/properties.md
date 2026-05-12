---
title: Propriedades
sidebar_label: Propriedades
slug: pt/docs/collections/properties
description: Os tipos de propriedades definem o tipo de dado, validação e renderização da UI para cada campo em uma coleção. O Rebase suporta os tipos string, number, boolean, date, array, map, reference, relation e geopoint.
---

## Visão Geral

As propriedades definem as colunas na sua tabela de banco de dados e como elas são renderizadas na UI de administração. Cada propriedade tem um `type` que determina:

- O **tipo de coluna do banco de dados** (via geração de esquema Drizzle)
- O componente de **campo de formulário**
- O renderizador de **célula de tabela**
- As regras de **validação**

## Tipos de Propriedade

| Tipo | Descrição | Coluna PostgreSQL |
|------|-------------|-------------------|
| `string` | Texto, seleção, markdown, upload de arquivo, URL, e-mail | `varchar`, `text`, `jsonb` |
| `number` | Inteiro, decimal, moeda | `integer`, `numeric`, `bigint`, `serial` |
| `boolean` | Alternador verdadeiro/falso | `boolean` |
| `date` | Data, data/hora, timestamp | `timestamp`, `date` |
| `array` | Lista ordenada de valores | `jsonb` |
| `map` | Objeto chave-valor | `jsonb` |
| `geopoint` | Par latitude/longitude | `jsonb` |
| `reference` | Referência incorporada a outra entidade | `varchar` (armazena ID) |
| `relation` | Relação de chave estrangeira SQL | Usa o array `relations` |

## Propriedades Comuns

Todos os tipos de propriedades compartilham estas opções:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `type` | `string` | **Obrigatório.** Tipo de dado (veja acima) |
| `name` | `string` | **Obrigatório.** Rótulo de exibição |
| `description` | `string` | Texto de ajuda exibido abaixo do campo |
| `columnWidth` | `number` | Largura da coluna em pixels (visualização de tabela) |
| `readOnly` | `boolean` | Impedir edição |
| `disabled` | `boolean \| PropertyDisabledConfig` | Desabilitar com tooltip opcional |
| `hideFromCollection` | `boolean` | Ocultar da visualização de tabela |
| `defaultValue` | `any` | Valor padrão para novas entidades |
| `validation` | `object` | Regras de validação |
| `Field` | `React.ComponentType` | Componente de campo personalizado |
| `Preview` | `React.ComponentType` | Componente de célula de tabela personalizado |
| `propertyConfig` | `string` | Chave de configuração de propriedade registrada |
| `editable` | `boolean` | Habilitar edição em linha na tabela (padrão: true) |

## Propriedades de String

```typescript
name: {
    type: "string",
    name: "Name",
    validation: { required: true, min: 2, max: 200 }
}

description: {
    type: "string",
    name: "Description",
    multiline: true,       // Textarea
    markdown: true         // Markdown editor
}

category: {
    type: "string",
    name: "Category",
    enum: [
        { id: "electronics", label: "Electronics", color: "blueDark" },
        { id: "clothing", label: "Clothing", color: "pinkLight" },
    ]
}

email: {
    type: "string",
    name: "Email",
    email: true,           // Email validation
    validation: { required: true }
}

website: {
    type: "string",
    name: "Website",
    url: true              // URL validation
}

avatar: {
    type: "string",
    name: "Avatar",
    storage: {             // File upload
        storagePath: "avatars",
        acceptedFiles: ["image/*"],
        maxSize: 2 * 1024 * 1024
    }
}
```

### Opções de String

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `multiline` | `boolean` | Renderizar como textarea |
| `markdown` | `boolean` | Renderizar como editor de markdown |
| `email` | `boolean` | Validação de formato de e-mail |
| `url` | `boolean` | Validação de formato de URL |
| `storage` | `StorageConfig` | Habilitar upload de arquivo |
| `enum` | `EnumValues` | Renderizar como seletor dropdown |
| `multiSelect` | `boolean` | Permitir múltiplas seleções de enum |
| `columnType` | `string` | Coluna de banco de dados: `"varchar"`, `"text"` |
| `isId` | `string` | Geração de ID: `"uuid"`, `"cuid"`, `"increment"`, `"manual"` |
| `userSelect` | `boolean` | Renderizar como um seletor de usuário |
| `previewAsTag` | `boolean` | Renderizar esta string como uma tag nas pré-visualizações |
| `clearable` | `boolean` | Adicionar um ícone para limpar o valor (definir como nulo) |

## Propriedades Numéricas

```typescript
price: {
    type: "number",
    name: "Price",
    validation: { required: true, min: 0 }
}

quantity: {
    type: "number",
    name: "Quantity",
    columnType: "integer"  // Store as integer
}
```

### Opções Numéricas

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `enum` | `EnumValues` | Renderizar como seletor com valores numéricos |
| `columnType` | `string` | `"integer"`, `"bigint"`, `"numeric"`, `"serial"`, `"smallint"` |
| `isId` | `string` | Estratégia de geração de ID |
| `clearable` | `boolean` | Adicionar um ícone para limpar o valor (definir como nulo) |

## Propriedades Booleanas

```typescript
active: {
    type: "boolean",
    name: "Active",
    defaultValue: true
}
```

![Switch field](/img/fields/Switch.png)

## Propriedades de Data

```typescript
created_at: {
    type: "date",
    name: "Created At",
    autoValue: "on_create",   // Set automatically on creation
    readOnly: true
}

updated_at: {
    type: "date",
    name: "Updated At",
    autoValue: "on_update"    // Set automatically on every save
}

event_date: {
    type: "date",
    name: "Event Date",
    mode: "date"              // Date only (no time)
}
```

![Date field](/img/fields/Date.png)

### Opções de Data

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `mode` | `"date" \| "date_time"` | Apenas data ou data + hora (padrão: `"date_time"`) |
| `autoValue` | `"on_create" \| "on_update"` | Definir timestamps automaticamente |
| `columnType` | `string` | `"timestamp"`, `"date"` |
| `timezone` | `string` | String de fuso horário para avaliar a data |
| `clearable` | `boolean` | Adicionar um ícone para limpar o valor (definir como nulo) |

## Propriedades de Array

```typescript
tags: {
    type: "array",
    name: "Tags",
    of: { type: "string" }    // Array of strings
}

images: {
    type: "array",
    name: "Images",
    of: {
        type: "string",
        storage: { storagePath: "images", acceptedFiles: ["image/*"] }
    }
}

// Block editor (multiple types)
content: {
    type: "array",
    name: "Content Blocks",
    oneOf: {
        properties: {
            text: {
                type: "map",
                properties: {
                    body: { type: "string", name: "Body", markdown: true }
                }
            },
            image: {
                type: "map",
                properties: {
                    src: { type: "string", name: "Image", storage: { ... } },
                    caption: { type: "string", name: "Caption" }
                }
            }
        }
    }
}
```

![Block field](/img/fields/Block.png)

### Opções de Array

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `of` | `Property \| Property[]` | Esquema de propriedade para itens do array |
| `oneOf` | `object` | Array de objetos tipados com múltiplos tipos discriminadores |
| `expanded` | `boolean` | O campo deve ser inicialmente expandido (padrão: true) |
| `minimalistView` | `boolean` | Exibir propriedades filhas diretamente sem painel extensível |
| `sortable` | `boolean` | Os elementos podem ser reordenados (padrão: true) |
| `canAddElements` | `boolean` | Novos elementos podem ser adicionados (padrão: true) |

## Propriedades de Mapa

```typescript
address: {
    type: "map",
    name: "Address",
    properties: {
        street: { type: "string", name: "Street" },
        city: { type: "string", name: "City" },
        zip: { type: "string", name: "ZIP Code" },
        country: { type: "string", name: "Country" }
    }
}

metadata: {
    type: "map",
    name: "Metadata",
    keyValue: true    // Free-form key-value editor
}
```

![Group field](/img/fields/Group.png)

### Opções de Mapa

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `properties` | `Properties` | Registro de propriedades incluídas no mapa |
| `propertiesOrder` | `string[]` | Chaves ordenadas para renderização |
| `previewProperties` | `string[]` | Quais propriedades mostrar na pré-visualização da tabela |
| `pickOnlySomeKeys` | `boolean` | Permitir que o usuário adicione chaves seletivamente na UI |
| `spreadChildren` | `boolean` | Renderizar propriedades filhas como colunas separadas na visualização de tabela |
| `minimalistView` | `boolean` | Exibir propriedades sem um painel de envoltório |
| `expanded` | `boolean` | O campo deve ser inicialmente expandido (padrão: true) |
| `keyValue` | `boolean` | Renderizar como editor de pares chave-valor arbitrários |

## Valores de Enum

Usado com propriedades de string ou numéricas para renderizar seleções:

```typescript
// Simple array
enum: ["draft", "published", "archived"]

// With labels
enum: [
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
    { id: "archived", label: "Archived" }
]

// With colors (for Kanban columns and chips)
enum: [
    { id: "draft", label: "Draft", color: "grayDark" },
    { id: "published", label: "Published", color: "greenDark" },
    { id: "archived", label: "Archived", color: "orangeDark" }
]
```

![Select field](/img/fields/Select.png)

## Validação

```typescript
validation: {
    required: true,             // Field is required
    unique: true,               // Must be unique in the table
    requiredMessage: "Custom error message",

    // String-specific
    min: 2,                     // Minimum length
    max: 200,                   // Maximum length
    matches: /^[a-z]+$/,       // Regex pattern
    email: true,                // Email format
    url: true,                  // URL format

    // Number-specific
    min: 0,                     // Minimum value
    max: 1000,                  // Maximum value
    integer: true,              // Must be integer

    // Array-specific
    min: 1,                     // Minimum items
    max: 10,                    // Maximum items
}
```

## Campos Condicionais

Você pode tornar os campos dinâmicos para que reajam aos valores da entidade. Existem duas maneiras de fazer isso:

### 1. Condições JSON Logic (Declarativas)

Você pode usar a propriedade `conditions` para definir regras JSON Logic declarativas que podem ser serializadas e modificadas visualmente no editor de coleção.

```typescript
price: {
    type: "number",
    name: "Price",
    conditions: {
        disabled: { "==": [{ "var": "values.is_free" }, true] },
        required: { "!=": [{ "var": "values.is_free" }, true] },
        min: 0,
        clearOnDisabled: true // Set to null if field gets disabled
    }
}
```

O objeto conditions dá acesso a:
- `disabled`, `hidden`, `readOnly`
- `required`, `min`, `max`
- `defaultValue`
- `enumConditions`, `allowedEnumValues`, `excludedEnumValues`
- `referencePath`, `referenceFilter`
- `canAddElements`, `sortable` (para arrays)

### 2. Construtores de Propriedades (Programáticos)

Para comportamentos complexos que não podem ser expressos via JSON Logic, você pode usar `dynamicProps`, que avalia uma função Javascript.

```typescript
price: {
    type: "number",
    name: "Price",
    dynamicProps: ({ values, user }) => ({
        disabled: values.is_free === true || !user.roles.includes("admin"),
        validation: values.is_free ? {} : { required: true, min: 0 }
    })
}
```

## Próximos Passos

- **[Relações](/docs/collections/relations)** — Chaves estrangeiras e junções
- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construir componentes de campo personalizados
---
