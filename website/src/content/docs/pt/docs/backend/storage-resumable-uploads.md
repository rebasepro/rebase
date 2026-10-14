---
sourceHash: d79cfc20665e2e22
title: Uploads retomáveis (TUS)
sidebar_label: Uploads retomáveis (TUS)
description: O endpoint TUS v1.0.0 em /api/storage/tus — como um arquivo grande sobe um pedaço de cada vez, o que cada requisição responde, como o SDK e o painel de administração o usam e como ele se comporta entre reinicializações e instâncias.
---

Para enviar arquivos grandes ou lidar com condições de rede instáveis, o Rebase implementa o protocolo aberto **TUS v1.0.0**, incluindo as extensões `Creation` e `Termination`.
Os limites são os da fonte, como em todo upload — veja
[Qual o tamanho máximo de um arquivo](/docs/backend/storage/#how-large-a-file-may-be).

## Por que arquivos grandes seguem este caminho

`POST /api/storage/upload` é um corpo multipart único, que o servidor analisa por inteiro
antes de armazená-lo: de três a cinco vezes o tamanho do arquivo na sua memória (cerca de 340 MB
para um arquivo de 100 MB). Um upload retomável mantém um pedaço (chunk) de cada vez — cada `PATCH`
fica abaixo do limite global de corpo, 10 MB por padrão — e é gravado no armazenamento
a partir do disco: cerca de 50 MB para esse arquivo, e 80 MB para um de 400 MB. Portanto, dimensione o
limite da fonte de acordo com a memória do servidor se os clientes usarem `POST /api/storage/upload`
para arquivos grandes, e não de outra forma.

`client.storage.putObject()` e o painel de administração enviam um arquivo acima de
8 MiB pelo endpoint retomável, em chunks de 8 MiB, e retomam um chunk que
falha no caminho a partir do offset que o servidor mantém. O arquivo chega como
`POST /api/storage/upload` o armazenaria — a mesma chave, bucket, tipo, metadados
personalizados, limites, verificação de `storageAuthorize` e gatilho `finalize` — e a
chamada retorna o mesmo `{ key, bucket, storageUrl }`. Quando a rota retomável
não consegue levá-lo — um servidor sem o endpoint, um chunk acima do limite de corpo do
servidor, ou uma instância que não guarda o upload (veja
[Executando mais de uma instância](/docs/deployment/multiple-instances/#files)) — o
arquivo segue por `POST /api/storage/upload`, e essa fonte envia todos os
arquivos seguintes dessa forma também.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

## Ciclo de vida do upload

1. **Inicialização da sessão (`POST`)**: O cliente envia o tamanho total do arquivo no cabeçalho `Upload-Length` e metadados em base64 por `Upload-Metadata`: `key` (ou `filename`), `filetype`, `bucket`, `storageId`, `collection` e `property`, como `POST /api/storage/upload` os recebe em campos de formulário, e entradas `metadata_<name>`, que se tornam os metadados personalizados do objeto, como fazem os campos `metadata_<name>`. O servidor cria um arquivo marcador vazio em um diretório temporário oculto `.tus-uploads/`, com um registro do upload ao lado (`<id>.json`: sua chave, bucket, fonte, tipo, tamanho e dono), e retorna a URL do upload. Ele também responde `Rebase-Upload-Result: on-complete`: este servidor informa o que armazenou quando o upload termina. O upload vive nesse diretório, não no processo: um servidor reiniciado o retoma, e toda instância que compartilha `STORAGE_PATH` o atende — veja [Executando mais de uma instância](/docs/deployment/multiple-instances/#files).
2. **Consultas de progresso (`HEAD`)**: Se um upload é interrompido, o cliente consulta a URL do upload com uma requisição `HEAD`. O servidor retorna a posição atual em bytes no cabeçalho `Upload-Offset`.
3. **Anexação de dados (`PATCH`)**: O cliente retoma o envio de dados binários a partir do offset retornado, com `Content-Type: application/offset+octet-stream`. O servidor grava cada chunk no arquivo temporário no offset em bytes que a requisição declara, que deve ser o offset que o servidor mantém (`409` caso contrário). Um chunk é recebido de cada vez: um `PATCH` que chega enquanto outro para o mesmo upload ainda está sendo recebido — tipicamente um cliente reenviando um chunk que travou — é respondido com `423 UPLOAD_LOCKED`, e o cliente retoma a partir do offset que o `HEAD` informa.
4. **Finalização**: Quando o `Upload-Offset` acumulado coincide com o `Upload-Length` declarado, o Rebase lê o arquivo temporário completo, o envolve como um objeto `File` padrão do JavaScript e o salva no backend de armazenamento configurado (disco local ou S3). O arquivo temporário é então excluído. Esse último `PATCH` responde `Rebase-Upload-Result` com o objeto armazenado — `{ key, bucket, storageUrl }`, o que `POST /api/storage/upload` responde em `data` — como JSON codificado em URI. Um frontend em outra origem pode lê-lo, e também `Location` e `Upload-Offset`, apenas quando o servidor os expõe em `Access-Control-Expose-Headers`: o runtime do Rebase e o backend ejetado expõem; um [servidor customizado](/docs/backend/custom-server/) precisa fazê-lo.
5. **Varredura periódica**: Um limpador em segundo plano é executado a cada **60 segundos** para excluir uploads temporários incompletos iniciados há mais de **24 horas** — inclusive os que outro processo iniciou, lidos a partir do diretório.

## Quem pode acessar um upload

Um upload iniciado por um chamador autenticado responde apenas a esse chamador e aos administradores;
qualquer outra pessoa recebe `404`, como se o id não existisse. Um upload iniciado sem sessão não tem
dono, então seu id é uma capacidade: quem tiver a URL do upload pode ler seu progresso, anexar dados
a ele e cancelá-lo. Mantenha essa URL em segredo, como faria com um token de download. Somente uma implantação
que executa o armazenamento com `requireAuth: false` pode iniciar um: com `requireAuth` ligado, o
padrão, um `POST` sem sessão é recusado com `401`.

## Relacionado

- [Configuração de Armazenamento](/docs/backend/storage/) — fontes, limites, endpoints e autorização
- [Executando mais de uma instância](/docs/deployment/multiple-instances/#files) — onde vive um upload em andamento
- [Armazenamento e Arquivos](/docs/sdk/storage/) — `putObject()`, que usa este endpoint para arquivos acima de 8 MiB
