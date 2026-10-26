# @franyerhiguerey/ai-chat-ingest

Turns files a site owner uploads into ai-chat knowledge documents. Node only. Use it in your dashboard's upload handler, then hand the documents to the chat through a source (see [docs/integration.md](../../docs/integration.md)).

```sh
pnpm add @franyerhiguerey/ai-chat-ingest
# Only for the formats you accept:
pnpm add unpdf     # PDF
pnpm add mammoth   # DOCX
```

```ts
import { IngestError, toKnowledgeDoc } from '@franyerhiguerey/ai-chat-ingest';

try {
  const doc = await toKnowledgeDoc({ name: file.name, type: file.type, bytes });
  await db.saveKnowledgeDoc(doc); // { file: 'lista-de-precios.md', content: '…' }
} catch (error) {
  if (error instanceof IngestError)
    showToOwner(error.message); // error.code for logic
  else throw error;
}
```

| Input           | Output                               |
| --------------- | ------------------------------------ |
| `.md`, `.txt`   | The text, line endings normalized    |
| `.html`, `.htm` | Text without scripts, styles or tags |
| `.pdf`          | The text layer, via `unpdf`          |
| `.docx`         | The document text, via `mammoth`     |

The type comes from the file extension, then from `type` (MIME).

**Errors** (`IngestError.code`): `unsupported_type`, `too_large` (over `maxBytes`, default 10 MB), `empty` (no text, e.g. a scanned PDF) and `missing_parser` (install `unpdf` or `mammoth`).

**File names.** `doc.file` is a lowercase slug ending in `.md` (`safeFileName()`), so it is safe as a file name or key: `../../etc/passwd` becomes `etc-passwd.md`.

Convert at upload time, not per chat: parsing is slow, and stored text keeps the bot's prompt fast and identical between requests, which prompt caching needs.
