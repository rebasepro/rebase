---
sourceHash: 3e18de6e2b935fc7
title: Firebase
sidebar_label: Firebase
description: "O @rebasepro/firebase executa o Rebase CMS com Firestore, Firebase Auth e Firebase Storage — um adaptador client-side, sem nenhum servidor Rebase envolvido."
---

O `@rebasepro/firebase` direciona o Rebase CMS para o Firebase. Suas
coleções descrevem documentos do Firestore, e o painel realiza leitura e escrita neles
por meio do SDK do Firebase.

:::caution[Experimental e estruturalmente diferente do restante do Rebase]
Este é um **adaptador client-side**. Não há nenhum servidor Rebase envolvido: o
navegador comunica-se diretamente com o Firebase, portanto, tudo o que o backend do Rebase oferece —
segurança a nível de linha (row-level security), a API REST, o SDK gerado, functions, crons, o
modelo de acesso ao storage — não faz parte deste arranjo.

A autorização é feita via **Firebase Security Rules**, escritas e implantadas no Firebase.
As `securityRules` do Rebase em uma coleção não se aplicam.
:::

## Instalação

```bash
pnpm add @rebasepro/firebase firebase
```

Peer dependencies: `firebase` (10, 11 ou 12), `react` ≥ 19, `react-dom` ≥ 19 e,
opcionalmente, `typesense` para busca textual.

## O que ele oferece

- **`RebaseFirebaseApp`** — uma aplicação administrativa completa: login com Firebase Auth, roteamento
  e CRUD no Firestore construídos a partir das definições das suas coleções.
- **Hooks por serviço** — auth, Firestore, storage, App Check, gerenciamento de usuários.
- **Adaptadores de busca textual** — Algolia, Typesense, Pinecone ou local.

```tsx title="src/App.tsx" no-verify
import { RebaseFirebaseApp } from "@rebasepro/firebase";

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[posts, authors]}
    />;
}
```

Um exemplo funcional está disponível em [`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).

## O que não se aplica

Tudo neste site que descreve o **backend** do Rebase descreve o
caminho do PostgreSQL (ou MongoDB), não este:

| | |
|---|---|
| Row-level security | Em vez disso, Firebase Security Rules, escritas no Firebase |
| API REST e SDK gerado | Ausente — o navegador usa o SDK do Firebase |
| Functions e crons | Em vez disso, Cloud Functions for Firebase |
| Modelo de acesso ao storage | Em vez disso, regras do Firebase Storage |
| Studio, `rls-check`, migrações | Recursos do Postgres; não aplicável |

## Quando escolher

Escolha esta opção se você já tiver um projeto Firebase e quiser um painel administrativo melhor
para ele. Se você estiver escolhendo um backend em vez de se adaptar a um existente,
o [caminho do PostgreSQL](/docs/getting-started/quickstart/) é sobre o qual o restante
desta documentação trata.

## Relacionado

- [Configuração do Frontend](/docs/frontend/) — o painel do qual este adaptador substitui a camada de dados
- [Autenticação e Login](/docs/frontend/authentication/) — a interface de login, de qualquer forma
- [Definindo Coleções](/docs/collections/) — o formato de coleção que ambos os drivers leem
