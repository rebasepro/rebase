---
sourceHash: 31645b4c27077651
title: Autorização de Armazenamento
sidebar_label: Autorização de Armazenamento
description: Decida quem pode ler, escrever, excluir ou listar cada objeto de armazenamento com storagePolicies e o hook storageAuthorize, e de quais escopos de armazenamento uma chave de API precisa.
---

As tabelas são protegidas por segurança em nível de linha (row-level security); um bucket não possui um equivalente por objeto, portanto o armazenamento é autorizado aqui. A [Configuração de Armazenamento](/docs/backend/storage/) aborda os próprios backends.

## Políticas

A forma declarativa. Uma lista de padrões de caminho, lida sem executar nada:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Uma chave que não corresponda a nenhuma política é recusada**, a menos que um hook `storageAuthorize` a permita: o hook é consultado apenas quando nenhuma política correspondeu à chave para essa operação, e nenhum pode restringir o outro. Uma política que correspondeu e não concedeu acesso é definitiva. Toda ampliação de permissão é uma linha explícita, e um erro nega em vez de conceder.

Os padrões correspondem **por segmento, nunca por substring** — `public/**` não corresponde a `publicity/secret.png`:

| Padrão | Correspondências |
|---|---|
| `avatars/logo.png` | exatamente essa chave |
| `users/*/avatar.png` | exatamente um segmento onde `*` está |
| `users/:uid/**` | um segmento capturado e depois o restante — incluindo nada |

`**` só é válido como o segmento final. `:name` captura um segmento e nunca abrange uma `/`; as capturas chegam como `params` no predicado.

`allow` é `"public"` (qualquer pessoa que a rota permita entrar), `"authenticated"` (qualquer chamador com um uid) ou um predicado que recebe os params capturados, o usuário, a operação e o bucket.

Uma política é executada após a autenticação da rota, portanto, `"public"` por si só não abre um caminho para chamadores anônimos. Com `requireAuth` ativado, eles acessam apenas leituras de chaves `public/`, ou todas as leituras com `storagePublicRead`; `/upload`, `/list`, exclusões e uploads retomáveis sempre precisam de um chamador. Caso contrário, a resposta é `401`.

`operations` tem como padrão todas as quatro — `read`, `write`, `delete`, `list`.

As políticas satisfazem a proteção de inicialização de produção por conta própria, e um padrão malformado falha na inicialização em vez de no primeiro upload.

### Como dados: `STORAGE_POLICIES`

<span class="since-badge" data-since="0.35">Desde 0.35</span>

O runtime gerenciado não consegue ler um predicado do seu código, e um projeto no backend padrão do Rebase Cloud não possui código para ler. Portanto, as mesmas regras podem ser definidas como JSON na variável de ambiente `STORAGE_POLICIES`, com os dois predicados que quase todo aplicativo escreve nomeados em vez de codificados:

```bash
STORAGE_POLICIES='[
  { "path": "public/**", "operations": ["read"], "allow": "public" },
  { "path": "users/:uid/**", "allow": "owner" },
  { "path": "**", "allow": { "roles": ["admin"] } }
]'
```

| `allow` | Concede |
|---|---|
| `"public"` | qualquer pessoa que a rota permita entrar |
| `"authenticated"` | qualquer chamador autenticado |
| `"owner"` | o chamador autenticado cujo uid seja o segmento `:uid` da chave — o `path` deve capturar um |
| `{ "roles": [...] }` | um chamador autenticado que possua qualquer uma dessas funções (roles) |

Elas são compiladas para `storagePolicies`, portanto a correspondência, a ordem e o fallback para `storageAuthorize` seguem a forma de código: uma chave que nenhuma regra cobre é consultada no hook se o projeto tiver um, e recusada caso contrário. Um valor que não seja uma lista válida impede a inicialização, detalhando cada problema; o Rebase Cloud se recusa a salvar um valor inválido, e seu console edita a lista em **File storage → Access rules**.

## O hook

<span class="since-badge" data-since="0.35">Desde 0.35</span>

`requireAuth` e `publicRead` são opções *globais*: elas decidem se um chamador deve estar autenticado, não o que esse chamador pode acessar. Sem um hook de autorização, **qualquer usuário autenticado pode ler qualquer chave que conseguir nomear** — a única coisa que separa os arquivos de dois tenants é a imprevisibilidade da chave, o que não é um modelo de controle de acesso. Pior ainda, eles podem executar `GET /storage/list?prefix=` primeiro, de modo que as chaves nem precisam ser adivinhadas.

:::caution[O armazenamento não iniciará em produção sem um]
As tabelas são protegidas por segurança em nível de linha (RLS); o armazenamento, não. Não há equivalente por objeto no bucket, portanto este hook *é* o modelo — e `initializeRebaseBackend` **lança um erro na inicialização** sob `NODE_ENV=production` quando o armazenamento está configurado e nenhum destes está definido:

- `storageAuthorize` — um hook, por objeto. Recomendado.
- `storagePolicies` — as regras declaradas acima.
- `storagePublicRead: true` — o bucket é genuinamente uma CDN pública somente leitura.
- `storageInsecureAllowAnyAuthenticated: true` — um aplicativo single-tenant onde todos os usuários autenticados são confiáveis para acessar qualquer arquivo. Nomeado propositalmente para chamar atenção.

Em desenvolvimento, ele apenas registra um aviso, de modo que um projeto pode estar configurado incorretamente e funcionar perfeitamente localmente até ser implantado. Um projeto gerado por scaffolding já inclui um hook em `backend/storage.ts` — leia-o antes de substituí-lo e observe que ele modela uma *biblioteca de conteúdo compartilhado* de um CMS, que não possui a mesma estrutura de arquivos individuais por usuário.
:::

`storageAuthorize` é o equivalente no armazenamento ao `rls` de uma tabela e é executado após a autenticação em cada rota de armazenamento:

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
|-------|-------------|
| `key` | Chave do objeto, com o prefixo do bucket removido e traversal sanitizado |
| `bucket` | Bucket resolvido (`"default"` quando não especificado) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` onde a rota permite acesso anônimo |
| `storageId` | O backend nomeado, quando a requisição tiver um como destino — sua chave canônica (`storageId=%20media` é `"media"`). Ausente para a fonte padrão, independentemente de como a requisição a nomeou (sem parâmetro, vazio ou `(default)`) |
| `data` | Acesso de leitura confiável que **ignora RLS** — `data.table(slug).find(query)` / `.findById(id)`. A propriedade reside em uma linha, não no prefixo de uma chave, portanto o hook precisa de um leitor para responder "quem é o proprietário deste objeto?". Ele ignora a segurança em nível de linha deliberadamente: este hook *é* a decisão de autorização, e fazê-la por meio de um leitor já restrito pelas próprias permissões do chamador seria circular. Somente leitura por design. |

Retorne `false` para negar com um **403**. Lançar um erro (throw) também nega — uma busca de propriedade que falha não deixa o acesso aberto por padrão.

Vale a pena saber:

- **A rota de metadados é onde o acesso de leitura é realmente decidido.** Ela gera o token de download de curta duração com escopo de caminho no qual a rota de arquivo confia, portanto o hook controla o acesso ali. Duas leituras ignoram o hook, por design. Uma que contenha tal token: o hook a aprovou quando o token foi gerado, apenas para aquele caminho e fonte, portanto, um hook que agora recusaria (uma associação revogada desde então) não a interrompe antes que o token expire — `storageDownloadTokenTtl`, 300 segundos por padrão. E uma leitura de uma chave sob `public/` por um chamador sem credenciais: o prefixo é a declaração de que qualquer pessoa pode lê-la, incluindo visitantes anônimos e CDNs. A leitura feita por um chamador autenticado ainda é consultada, mas a de um anônimo não, de modo que um hook não pode tornar privada uma chave `public/`; armazene o arquivo fora de `public/` em vez disso. Apenas essas duas leituras o ignoram: um usuário que o seu adaptador de autenticação por acaso chame de `public` é consultado como qualquer outro.
- **Um bucket, um nome.** No S3 e no GCS, o `bucket` do hook é sempre `"default"`, mesmo quando uma requisição especifica o bucket do provedor, o qual acessa os mesmos objetos.
- **Um caminho é público quando a chave que ele nomeia é pública.** O prefixo `public/` é testado na chave canônica servida pela rota — depois que o segmento inicial do bucket `default/` é removido e `//`, `./` e uma `/` inicial são normalizados — nunca na URL exatamente como escrita. `/api/storage/file/notes://public/x.txt` nomeia a chave privada `notes:/public/x.txt`, e a chave `default/public/x.txt` (acessada como `/api/storage/file/default/default/public/x.txt`) fica em uma pasta chamada `default`; nenhuma das duas é pública. Em um hook, teste a `key` fornecida com `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lê um caminho ou URL do lado do cliente e interpretará ambos como públicos.
- **`list` é controlado no prefixo.** Listar é como você descobre chaves sobre as quais ninguém lhe informou.
- **Uploads retomáveis (TUS) são controlados no momento da criação**, de modo que um upload negado não deixa arquivos temporários para trás.
- Omitir o hook (e `storagePolicies`, e `STORAGE_POLICIES`) deixa o sistema sem verificação por objeto, portanto o ambiente de produção se recusará a inicializar a menos que `storagePublicRead` ou `storageInsecureAllowAnyAuthenticated` esteja definido.

## Chaves de API e tokens

Uma pessoa autenticada possui todos os escopos de armazenamento, de modo que o hook e as políticas acima decidem por ela. Uma [chave de API](/docs/backend/api-keys/) também precisa do escopo de armazenamento para a operação, na fonte designada pela requisição: `storage:read` para downloads, metadados e listagens, `storage:write` para uploads, pastas e cada etapa de um upload retomável, `storage:delete` para exclusões. O destino é o id da fonte, e o da fonte padrão é `(default)`: `storage:read:(default)`, `storage:write:avatars`. Sem isso, a resposta é `403 SCOPE_MISSING`. Com isso, o hook ainda é executado, atuando como a identidade vinculada à chave.

## Próximos Passos

- **[Configuração de Armazenamento](/docs/backend/storage/)** — backends, endpoints e limites
- **[Chaves de API](/docs/backend/api-keys/)** — os escopos que uma chave possui
