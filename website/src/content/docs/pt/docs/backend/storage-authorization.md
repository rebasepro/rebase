---
sourceHash: b5b66e5876dc7d9c
title: Autorização de Storage
sidebar_label: Autorização de Storage
description: Decida quem pode ler, gravar, excluir ou listar cada objeto de storage com storagePolicies e o hook storageAuthorize, e de quais escopos de storage uma chave de API precisa.
---

As coleções são protegidas por segurança em nível de linha; um bucket não tem um
equivalente por objeto, então o storage é autorizado aqui. A [Configuração de
Storage](/docs/backend/storage/) cobre os próprios backends.

## Políticas

A forma declarativa. Uma lista de padrões de caminho, lida sem executar nada:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Uma chave que nenhuma política contempla é recusada**, a menos que um hook `storageAuthorize` a permita: o hook só é consultado quando nenhuma política correspondeu, e nenhum dos dois pode restringir o outro. Todo alargamento é uma linha explícita, e um erro nega em vez de conceder.

Os padrões correspondem **por segmento, nunca por substring** — `public/**` não corresponde a
`publicity/secret.png`:

| Padrão | Corresponde a |
|---|---|
| `avatars/logo.png` | exatamente essa chave |
| `users/*/avatar.png` | exatamente um segmento onde está o `*` |
| `users/:uid/**` | um segmento capturado e depois o resto — inclusive nada |

`**` só é permitido como segmento final. `:name` captura um segmento e nunca
atravessa uma `/`; as capturas chegam como `params` ao predicado.

`allow` é `"public"` (qualquer pessoa), `"authenticated"` (qualquer chamador com um uid) ou um
predicado que recebe os params capturados, o usuário, a operação e o bucket.
`operations` assume por padrão as quatro — `read`, `write`, `delete`, `list`.

As políticas satisfazem por si só a proteção de inicialização em produção, e um padrão malformado
faz a inicialização falhar, em vez do primeiro upload.

## O hook

`requireAuth` e `publicRead` são chaves *globais*: decidem se um chamador precisa estar autenticado, não no que esse chamador pode mexer. Sem um hook de autorização, **qualquer usuário autenticado pode ler qualquer chave que consiga nomear** — a única coisa que separa os arquivos de dois tenants é que a chave não pode ser adivinhada, o que não é um modelo de controle de acesso. Pior, ele pode fazer antes um `GET /storage/list?prefix=`, então as chaves nem precisam ser adivinhadas.

:::caution[O storage não inicializa em produção sem um]
As coleções são protegidas por segurança em nível de linha; o storage não. Não há um
equivalente por objeto no bucket, então este hook *é* o modelo — e
`initializeRebaseBackend` **lança uma exceção na inicialização** sob `NODE_ENV=production` quando
o storage está configurado e nenhum destes está definido:

- `storageAuthorize` — um hook, por objeto. Recomendado.
- `storagePublicRead: true` — o bucket realmente é uma CDN pública somente para leitura.
- `storageInsecureAllowAnyAuthenticated: true` — um app de tenant único em que todo
  usuário autenticado tem a confiança de acessar todos os arquivos. Com um nome feito para ser lido duas vezes.

Em desenvolvimento, ele registra um aviso em vez disso, de modo que um projeto pode estar errado nesse ponto e
funcionar bem localmente até o momento em que é implantado. Um projeto gerado já traz um hook em
`config/storage.ts` — leia-o antes de substituí-lo, e note que ele modela
a *biblioteca de conteúdo compartilhada* de um CMS, que não tem o mesmo formato que arquivos por usuário.
:::

`storageAuthorize` é o análogo, para o storage, das regras de segurança de uma coleção, e é executado após a autenticação em toda rota de storage:

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
| `key` | Chave do objeto, com o prefixo do bucket removido e a travessia de diretórios sanitizada |
| `bucket` | Bucket resolvido (`"default"` quando não especificado) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` quando a rota permite acesso anônimo |
| `storageId` | O backend nomeado, quando a requisição apontou para um — sua chave canônica (`storageId=%20media` é `"media"`). Ausente para a fonte padrão, qualquer que seja a forma como a requisição a nomeou (sem parâmetro, vazio ou `(default)`) |
| `data` | Acesso de leitura confiável que **ignora a RLS** — `data.collection(slug).find(query)` / `.findById(id)`. A propriedade fica em uma linha, não em um prefixo de chave, então o hook precisa de um leitor para responder "quem é o dono deste objeto?". Ele ignora a segurança em nível de linha de propósito: este hook *é* a decisão de autorização, e tomá-la por meio de um leitor já restringido pelas próprias permissões do chamador seria circular. Somente leitura, de propósito. |

Retorne `false` para negar com um **403**. Lançar uma exceção também nega — uma consulta de propriedade que falha não deixa o acesso aberto.

Vale saber:

- **A rota de metadados é onde o acesso de leitura é de fato decidido.** Ela emite o token de download de curta duração, restrito ao caminho, em que a rota de arquivo confia, então é ali que o hook a controla. Duas leituras pulam o hook, de propósito. Uma que traz um token desse tipo: o hook a aprovou quando o token foi emitido, para aquele caminho e aquela fonte apenas, de modo que um hook que agora recusaria (uma associação revogada desde então) não a impede antes de o token expirar — `storageDownloadTokenTtl`, 300 segundos por padrão. E a leitura de uma chave sob `public/` por um chamador sem credencial: o prefixo é a declaração de que qualquer pessoa pode lê-la, visitantes anônimos e CDNs inclusive. A leitura dela por um chamador autenticado ainda é consultada, mas a de um anônimo não, então um hook não consegue tornar privada uma chave `public/`; guarde o arquivo fora de `public/`. Só essas duas leituras o pulam: um usuário que o seu adaptador de autenticação chame de `public` é consultado como qualquer outro.
- **Um bucket, um nome.** No S3 e no GCS, o `bucket` do hook é sempre `"default"`, inclusive quando uma requisição nomeia o bucket do provedor, o que alcança os mesmos objetos.
- **Um caminho é público quando a chave que ele nomeia é.** O prefixo `public/` é testado na chave canônica que a rota serve — depois de um segmento de bucket `default/` inicial ser lido e de `//`, `./` e uma `/` inicial serem eliminados — nunca na URL como foi escrita. `/api/storage/file/notes://public/x.txt` nomeia a chave privada `notes:/public/x.txt`, e a chave `default/public/x.txt` (alcançada como `/api/storage/file/default/default/public/x.txt`) fica em uma pasta chamada `default`; nenhuma das duas é pública. Em um hook, teste a `key` que lhe foi entregue com `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lê um caminho ou URL do lado do cliente, e lê as duas como públicas.
- **`list` é controlado pelo prefixo.** Listar é como se descobrem chaves que ninguém lhe contou.
- **Os uploads resumíveis (TUS) são controlados no momento da criação**, então um upload negado não deixa nenhum arquivo temporário para trás.
- Omitir o hook (e `storagePolicies`) não deixa nenhuma verificação por objeto, então a produção se recusa a inicializar a menos que `storagePublicRead` ou `storageInsecureAllowAnyAuthenticated` esteja definido.

## Chaves de API e tokens

Uma pessoa autenticada tem todos os escopos de storage, então o hook e as políticas acima
decidem por ela. Uma [chave de API](/docs/backend/api-keys/) também precisa do escopo de
storage da operação, na fonte que a requisição nomeia: `storage:read` para
downloads, metadados e listagens, `storage:write` para uploads, pastas e todas as
etapas de um upload resumível, `storage:delete` para exclusões. O alvo é o id da
fonte, e o da fonte padrão é `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Sem ele, a resposta é `403 SCOPE_MISSING`. Com ele,
o hook ainda é executado, como quem quer que a chave represente.

## Próximos Passos

- **[Configuração de Storage](/docs/backend/storage/)** — backends, endpoints e limites
- **[Chaves de API](/docs/backend/api-keys/)** — os escopos que uma chave carrega
