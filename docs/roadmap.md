# Roadmap

ai-chat answers from a site's own content by loading every knowledge file into a cached system prompt. That works well for a small site like the first production deployment, but it has three limits: there is no way to measure answer quality, large knowledge bases don't fit in the prompt, and a provider outage means no answer at all. The steps below address those limits, in this order.

## 1. Evals

A suite of real questions with expected outcomes, run in CI so a drop in answer quality fails the build.

- About 50 questions drawn from the production deployment: prices, product details, out-of-scope questions, requests that should trigger the handoff or the lead form.
- Deterministic checks where the answer is a fact: quoted prices match the catalog, no product is invented, the right tool or handoff fires.
- An LLM judge only for what code can't check: groundedness in the knowledge files and tone.
- A report per run (pass rate, per-check results, token cost) and a threshold in CI.

Evals come first because every later step changes answer behavior, and this is how we will know whether it got better or worse.

## 2. Retrieval for large knowledge bases

An optional retrieval mode for sites whose knowledge doesn't fit in the prompt.

- Chunk knowledge files at ingest time and store embeddings in Postgres with pgvector.
- Hybrid search (keyword plus vector) to pick the chunks for each question.
- Keep the current full-prompt mode as the default for small sites; switch by config.
- Run the eval suite against both modes before shipping.

## 3. MCP server

Expose a site's catalog search and knowledge as [Model Context Protocol](https://modelcontextprotocol.io) tools, so the same content can be queried from Claude Desktop or any MCP client, not only from the widget.

## 4. Failure handling and observability

- Fallback from one provider to the other on errors, with timeouts and bounded retries.
- A safe, honest reply when every provider fails, instead of a broken stream.
- Per-request traces with latency, model, tool calls and token cost, keeping the current rule of no visitor text and no raw IPs in logs.

## 5. Agent framework example (optional)

An example app that builds a multi-step flow (for example, qualifying a lead before the handoff) with LangGraph.js on top of ai-chat-core, to show how the handler fits into a framework-based agent. The core stays framework-free.
