---
sourceHash: 1e1ed4905f58d5fd
title: Autorização de Storage
sidebar_label: Autorização de Storage
description: Decida quem pode ler, gravar, excluir ou listar cada objeto de storage com storagePolicies e o hook storageAuthorize, e de quais escopos de storage uma chave de API precisa.
---

Tabelas são protegidas por segurança em nível de linha (row-level security); um bucket não tem equivalente por objeto, portanto o storage é autorizado aqui. A [Configuração de Storage](/docs/backend/storage/) aborda os próprios backends.

## Políticas

A forma declarativa. Uma lista de padrões de caminho, lida sem executar nada:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Uma chave não correspondida por nenhuma política é recusada**, a menos que um hook `storageAuthorize` a permita: o hook é consultado apenas quando nenhuma política correspondeu à chave para essa operação, e nenhum dos dois pode restringir o outro. Uma política que correspondeu e não concedeu acesso é definitiva. Toda ampliação de permissão é uma linha explícita, e um erro nega em vez de conceder.

Os padrões correspondem **por segmento, nunca por substring** — `public/**` não corresponde a `publicity/secret.png`:

| Padrão | Correspondência |
|---|---|
| `avatars/logo.png` | exatamente essa chave |
| `users/*/avatar.png` | exatamente um segmento onde `*` está |
| `users/:uid/**` | um segmento capturado, depois o restante — incluindo nada |

`**` só é válido como o segmento final. `:name` captura um segmento e nunca abrange uma `/`; as capturas chegam como `params` no predicado.

`allow` pode ser `"public"` (qualquer pessoa que a rota permita o acesso), `"authenticated"` (qualquer chamador com um uid), ou um predicado recebendo os parâmetros capturados, o usuário, a operação e o bucket.

Uma política é executada após a autenticação da rota, portanto, `"public"` por si só não abre um caminho para chamadores anônimos. Com `requireAuth` ativado, eles acessam apenas leituras de chaves sob `public/`, ou todas as leituras com `storagePublicRead`; `/upload`, `/list`, exclusões e uploads retomáveis sempre precisam de um chamador. Caso contrário, a resposta é `401`.

`operations` tem como padrão todas as quatro — `read`, `write`, `delete`, `list`.

As políticas satisfazem a proteção de inicialização em produção por si sós, e um padrão malformado falha na inicialização em vez de no primeiro upload.

## O hook

`requireAuth` e `publicRead` são chaves *globais*: decidem se um chamador precisa estar autenticado, e não o que esse chamador pode acessar. Sem um hook de autorização, **qualquer usuário autenticado pode ler qualquer chave cujo nome conheça** — a única coisa que separa os arquivos de dois tenants é a impossibilidade de adivinhar a chave, o que não é um modelo de controle de acesso. Pior ainda, eles podem fazer `GET /storage/list?prefix=` primeiro, de modo que nem precisam adivinhar as chaves.

:::caution[O storage não inicializará em produção sem uma dessas opções]
As tabelas são protegidas por segurança em nível de linha (RLS); o storage não. Não há
equivalente por objeto no bucket, portanto este hook *é* o modelo — e o
`initializeRebaseBackend` **lança um erro na inicialização** com `NODE_ENV=production` quando
o storage estiver configurado e nenhum destes estiver definido:

- `storageAuthorize` — um hook, por objeto. Recomendado.
- `storagePolicies` — as regras declaradas acima.
- `storagePublicRead: true` — o bucket é genuinamente uma CDN pública somente leitura.
- `storageInsecureAllowAnyAuthenticated: true` — uma aplicação single-tenant onde todo
  usuário autenticado tem acesso a todos os arquivos. Nomeado deliberadamente para fazer você pensar duas vezes.

Em desenvolvimento, ele apenas registra um aviso, portanto um projeto pode estar configurado incorretamente
e funcionar bem localmente até ser implantado. Um projeto recém-gerado já inclui um hook em
`backend/storage.ts` — leia-o antes de substituí-lo e observe que ele modela uma
*biblioteca de conteúdo compartilhado* de CMS, que tem uma estrutura diferente de arquivos por usuário.
:::

`storageAuthorize` é o análogo no storage do `rls` de uma tabela, e é executado após a autenticação em cada rota de storage:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Campo | Descrição |
|-------|-----------|
| `key` | Chave do objeto, com o prefixo do bucket removido e traversal sanitizado |
| `bucket` | Bucket resolvido (`"default"` quando não especificado) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` onde a rota permite acesso anônimo |
| `storageId` | O backend nomeado, quando a requisição tiver um como alvo — sua chave canônica (`storageId=%20media` é `"media"`). Ausente para a fonte padrão, independentemente de como a requisição o nomeou (sem parâmetro, vazio ou `(default)`) |
| `data` | Acesso de leitura confiável que **ignora RLS** — `data.table(slug).find(query)` / `.findById(id)`. A propriedade pertence a uma linha, não a um prefixo de chave, portanto o hook precisa de um leitor para responder "quem é o proprietário deste objeto?". Ele ignora o row-level security deliberadamente: este hook *é* a decisão de autorização, e fazê-la por meio de um leitor já restrito pelas próprias permissões do chamador seria circular. Somente leitura por design. |

Retorne `false` para negar com um **403**. Lançar um erro (throw) também nega — uma busca de propriedade que falha não deixa o acesso aberto.

Vale a pena saber:

- **A rota de metadados é onde o acesso de leitura é realmente decidido.** Ela gera o token de download de curta duração e com escopo de caminho no qual a rota de arquivo confia, portanto o hook atua como portão ali. Duas leituras ignoram o hook, por design. Uma que carrega tal token: o hook a aprovou quando o token foi gerado, apenas para aquele caminho e fonte, de modo que um hook que agora recusaria (uma associação revogada desde então) não a interrompe antes que o token expire — `storageDownloadTokenTtl`, 300 segundos por padrão. E uma leitura de uma chave sob `public/` por um chamador sem credenciais: o prefixo é a declaração de que qualquer pessoa pode lê-la, incluindo visitantes anônimos e CDNs. A leitura feita por um chamador autenticado ainda passa pelo hook, mas a de um anônimo não; logo, um hook não pode tornar privada uma chave sob `public/`; em vez disso, armazene o arquivo fora de `public/`. Apenas essas duas leituras o ignoram: um usuário que seu adaptador de autenticação por acaso chame de `public` é consultado como qualquer outro.
- **Um bucket, um nome.** No S3 e no GCS, o `bucket` do hook é sempre `"default"`, mesmo quando uma requisição especifica o nome do bucket no provedor, o que acessa os mesmos objetos.
- **Um caminho é público quando a chave que ele nomeia é pública.** O prefixo `public/` é testado na chave canônica servida pela rota — depois que o segmento inicial de bucket `default/` é removido e `//`, `./` e uma `/` inicial são normalizados — nunca na URL exatamente como escrita. `/api/storage/file/notes://public/x.txt` referencia a chave privada `notes:/public/x.txt`, e a chave `default/public/x.txt` (acessada como `/api/storage/file/default/default/public/x.txt`) fica em uma pasta chamada `default`; nenhuma das duas é pública. Em um hook, teste a `key` recebida com `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lê um caminho ou URL do lado do cliente e considera ambos como públicos.
- **`list` é controlado pelo prefixo.** Listar é como se descobre chaves sobre as quais ninguém lhe informou.
- **Uploads retomáveis (TUS) são controlados no momento da criação**, de modo que um upload negado não deixa arquivos temporários para trás.
- Omitir o hook (e `storagePolicies`) não deixa nenhuma verificação por objeto, portanto o ambiente de produção se recusa a inicializar, a menos que `storagePublicRead` ou `storageInsecureAllowAnyAuthenticated` esteja definido.

## Chaves de API e tokens

Uma pessoa autenticada possui todos os escopos de storage, portanto o hook e as políticas acima decidem por ela. Uma [chave de API](/docs/backend/api-keys/) também precisa do escopo de storage para a operação, na fonte indicada pela requisição: `storage:read` para downloads, metadados e listagens; `storage:write` para uploads, pastas e cada etapa de um upload retomável; `storage:delete` para exclusões. O alvo é o ID da fonte, e o da fonte padrão é `(default)`: `storage:read:(default)`, `storage:write:avatars`. Sem isso, a resposta é `403 SCOPE_MISSING`. Com isso, o hook ainda é executado, atuando em nome de quem quer que a chave represente.

## Próximos passos

- **[Configuração de Storage](/docs/backend/storage/)** — backends, endpoints e limites
- **[Chaves de API](/docs/backend/api-keys/)** — os escopos que uma chave carrega
