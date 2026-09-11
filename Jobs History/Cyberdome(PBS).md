# Technical Understanding of the project

## Catalog Composition

The NIST_SP-800-53_rev5_catalog.json catalog is actually is the combination of:

1. **SP 800-53** Rev 5.2 Controls - which supplies Controls, statements, guidance(Discussion in pdf version), and enhancements
2. **SP 800‑53A** Rev 5.2 Assessment Procedures. - which supplies the assessment-objective, examine, interview and test parts.
Transformer 1 2.
Each control in the OSCAL JSON catalog is described by:

- **id** — Code of the control. e.g. `ac-2`, `ac-2.1`.
- **class** — Typically `SP800-53` for base controls and `SP800-53-enhancement` for enhancements.
- **title** — Human-readable name of the control (e.g. "Account Management").
- **params** — Parameter placeholders referenced from prose via `{{ insert: param, <id> }}`. Organizations supply concrete values when tailoring a baseline for themselves(e.g. retention period, role names).
- **props** — Key/value metadata tags attached to the control or its parts. Common names: `label` (display label like `AC-2`), `sort-id`, `status` (e.g. `withdrawn`), and assessment-method markers. Used for filtering, sorting, and rendering.
- **links** — Cross-references to related items via `href` (often `#<id>`) and `rel` (e.g. `related`, `required`, `reference`, `incorporated-into`). Drives the control-relationship graph and citations to source documents.
- **parts** — The structured prose of the control, organized as a tree of named segments. Key `name` values:
  - `statement` — the normative control text (with nested `item` parts for sub-statements a., b., c., …).
  - `guidance` — supplemental discussion (the "Discussion" section in the PDF).
  - `objective` / `assessment-objective` — what an assessor must determine (from SP 800-53A).
  - `examine`, `interview`, `test` — assessment methods and objects (from SP 800-53A).
  Each part may carry its own `id`, `props`, `links`, `prose`, and nested `parts`.
- **controls** — Nested child controls representing **enhancements** (e.g. `ac-2.1`, `ac-2.2`). Recursively share the same schema as their parent.

## Oscal Controls vs Platform Evidence

**oscal_controls**
Chunks of OSCAL / NIST control catalog text (requirements, statements, etc.)
`core/intelligence`: retrieves and analyzes platform evidence
*Query Path:*  VectorStoreService.search() → EmbeddingClient → Qdrant → returns control-oriented results (no Postgres join for the chunk text itself in the same way)

**platform_evidence**
Vectors tied to platform_evidence rows — operational evidence (logs, findings payloads, connector output, etc.)
`core/ai`: Use models to generate answers from prompts optionally grounded by `core/intelligence`
*Query Path:* EvidenceSearchService.search_semantic() → embed query → Qdrant → then load matching rows from Postgres by evidence id

## Execution Flow of RAG for the OSCAL Controls

The pipeline runs in three groups of layers:

- **Offline indexing** (Parse → Layer 1 Flatten → Layer 2 Chunk → Layer 3 Embed → Layer 4 Store) — a batch job, kicked off by `scripts/index_oscal_vectors.py`, that turns the raw OSCAL catalog into vectors sitting in Qdrant. Nothing can be retrieved until it has run.
- **Online query** (Layer 5 Search → Layer 6 Inference) — runs per HTTP request: embed the question, retrieve the nearest chunks, and (for RAG) generate a grounded answer.
- **Delivery & operations surface** (Layer 7 Frontend page → Layer 8 Pickers & health → Layer 9 Answer rendering → Layer 10 Model management → Layer 11 Admin reindex) — the React "Compliance Q&A" page and the admin endpoints that drive it. This is the part a user actually touches: it chooses the embedding profile and chat model per request, shows whether the index is reachable, renders answers with clickable citations, and lets an operator pull/remove Ollama models or trigger a reindex from the browser.

Each step below is one element of that flow and has two components: **What this step does** (its intent) and **Control flow (start → end)** (how and why control moves to the next element — the gateways, function calls, and objects involved). A function's or class's home file is named the first time it appears and is not repeated afterward. All UI calls go through `api.get` / `api.post` in `frontend/src/api/client.ts`, which prefixes the `/api` base — so a path written here as `/v1/search/ask` hits the backend's `/api/v1/search/ask`.

> You use pypdfs to load the pdf text as strings.

#### Why we did not use LlamaIndex here

LlamaIndex is commonly used as a higher-level RAG framework. In a typical setup, it helps load documents, split them into nodes/chunks, generate embeddings, write them to a vector store such as Qdrant, retrieve relevant chunks for a user question, and pass that retrieved context into an LLM. In other words, it can abstract over much of the indexing and query orchestration that this project implements directly.

For this OSCAL controls path, we chose not to use LlamaIndex as the core layer because the retrieval logic needs tight, auditable control. The platform manually parses OSCAL, creates deterministic control chunks, assigns stable Qdrant point IDs, stores compliance-specific metadata, routes writes to profile-specific collections, applies explicit framework/family/control filters, builds citations only from retrieved chunks, and exposes health/model-management behavior through the product UI. Those requirements are central to a GRC/security product, so the custom pipeline keeps the behavior visible and predictable instead of hiding it behind a general RAG abstraction.

The short version: LlamaIndex could have accelerated an early prototype, but here we manually built the chunking, embedding, Qdrant storage, retrieval, and LLM prompt assembly so the system remains deterministic, explainable, and easier to audit.

#### Parse (precedes Layer 1)

**What this step does:** Read the raw OSCAL catalog JSON once and turn it into a structured `OscalCatalog` object, so no later layer walks the raw JSON again. The result carries the whole control tree (base controls plus nested enhancements) and, on each control, its `statement`, `guidance`, `params`, and extracted `assessment_parts`.

**Control flow (start → end):**

1. `scripts/index_oscal_vectors.py` builds a `VectorStoreService` and calls `index_catalog_path()`, which calls `parse_oscal_catalog()` in `core/frameworks/oscal_parser.py` to read the catalog JSON.

2. `parse_oscal_catalog()` walks the catalog's `groups` and, for every control in a group, calls `_parse_control()` with the group id as the `family`.

3. `_parse_control()` returns an `OscalControl`, filling `id`, `title`, `family`, `statement` and `guidance` (both via `_extract_prose(parts, name)`), `params` (straight from `raw["params"]`), and `parent_control_id`. It then recurses into each child under the control's `controls` key, so enhancements like `ac-2.1` become nested `OscalControl` objects in the `enhancements` list, each tagged with its `parent_control_id`.

4. For the assessment text, `_parse_control()` calls `_collect_named_parts()` with the target set `ASSESSMENT_PART_NAMES = {"assessment-objective", "examine", "interview", "test"}`. It recursively walks the control's `parts` tree and, for each part whose `name` is in that set and that has prose, appends an `OscalControlPart` preserving its `id`, `name`, `prose`, and `label` (via `_extract_label()`).

5. The `prose` for each collected part comes from `_collect_prose()`, which recursively concatenates the part's own prose with the prose of every descendant part. Because `_collect_named_parts()` keeps recursing into `part["parts"]` afterward, a parent objective and its children can each become their own `OscalControlPart`: the parent's prose holds the combined child text, and the children also appear as separate parts.

6. After all groups are parsed, `parse_oscal_catalog()` returns an `OscalCatalog` (`uuid`, `title`, `version`, `families`) whose tree already contains parsed enhancements and per-control `assessment_parts`.

7. As a result, later layers operate on typed `OscalCatalog`, `OscalControl`, and `OscalControlPart` objects rather than raw JSON.

#### Layer 1: Flatten

**What this step does:** Collapse the nested control tree into a single flat list of controls (base controls and enhancements together) so the chunker can process one control at a time, without losing the enhancement→parent link.

**Control flow (start → end):**

1. The indexer (Layer 3) calls `OscalCatalog.flatten_controls()` on the parsed catalog.

2. `flatten_controls()` iterates each `OscalFamily` in `self.families` and, for every base control in `family.controls`, appends the control to the result list and then calls `_flatten_enhancements(control, result)`.

3. `_flatten_enhancements()` recursively walks the control's `enhancements`, appending each one (and its nested enhancements) to the same flat list, so every base control and every nested enhancement lands in the output as its own `OscalControl`.

4. Enhancements keep their `parent_control_id`, so the base-control relationship survives flattening; each control also still carries its own `assessment_parts` (the parts are never flattened into a separate list).

5. As a result, the flat `list[OscalControl]` lets later layers treat base controls and enhancements uniformly while preserving both the enhancement→parent link (`parent_control_id`) and the control→part link (`assessment_parts`).

#### Layer 2: Chunk

**What this step does:** Expand each control into one or more self-contained, embedding-ready `ControlChunk` objects — separating the control's `statement`, each `assessment-objective`, and its `guidance` into distinct chunks so retrieval can return and cite text at a fine granularity.

**Control flow (start → end):**

1. For each `OscalControl` from Layer 1, `build_control_chunks(control, catalog)` in `core/frameworks/embedding_formatter.py` produces its chunks. It draws on two sources: the control's own `statement`/`guidance` strings, and the `OscalControlPart` items in `control.assessment_parts` collected during Parse.

2. It emits chunks in this order, each stamped with a `chunk_type`:

- **statement** — one chunk from `control.statement` (when present)
- **guidance** — one chunk from `control.guidance` (when present)
- one chunk per `OscalControlPart` in `control.assessment_parts`, whose `chunk_type` is the part's own `name` (e.g. `assessment-objective`)

3. Because Parse collected a parent objective and its children as separate `OscalControlPart` entries (with the parent's prose already containing the combined child text via `_collect_prose()`), the assessment chunks are overlapping and fine-grained. For example, objectives `pt-8_obj.b`, `pt-8_obj.b-1`, and `pt-8_obj.b-2` become three chunks: `pt-8_obj.b` (whose prose contains `b-1` and `b-2`), plus `b-1` and `b-2` on their own. This is what lets a grounded answer cite a precise sub-objective like `[AC-2.3_obj.a]`.

4. For every chunk, `build_control_chunks()` prepares the text:

- `resolve_param_inserts(content, control.params)` replaces `{{ insert: param, ... }}` tokens with human-readable values derived from the control's `params`
- `_format_chunk_text()` prepends self-contained headers (`Control ID`, `Control Title`, `Family`, `Chunk Type`, and, for assessment chunks, `Part ID` then `Part Label`) to the resolved body

5. Each chunk is returned as a `ControlChunk` with two fields: `text` (the formatted body to embed) and `metadata`, a `ControlChunkMetadata` carrying `control_id`, `family`, `parent_control_id`, `part_id`, `chunk_type`, `catalog_version`, and `catalog_uuid`.

6. As a result, Layer 2 turns one control into several self-contained chunks, each independently retrievable and citable.

#### Layer 3: Embed

**What this step does:** Convert each new chunk's text into an embedding vector, skipping chunks already indexed, while keeping every vector paired with its originating `ControlChunk`.

**Control flow (start → end):**

1. `OscalVectorIndexer.index_catalog()` in `core/frameworks/vector_indexer.py` first builds the chunk list via `_catalog_chunks()`, which runs Layer 1's `flatten_controls()` then Layer 2's `build_control_chunks()` for each control.

2. For each chunk it computes `_stable_point_id()` — a deterministic UUID derived from a SHA-256 of `catalog_uuid`, `catalog_version`, `control_id`, `part_id`, `chunk_type`, and `text` — so identical content always maps to the same Qdrant point.

3. `_get_existing_ids()` retrieves which of those IDs already exist in the collection; chunks whose ID is already present are dropped, so unchanged content is never re-embedded.

4. For the remaining new chunks, `index_catalog()` calls `EmbeddingClient.embed_texts()` in `core/frameworks/embedding_client.py` with the chunk texts.

5. `embed_texts()` batches the texts by `EMBEDDING_BATCH_SIZE` and POSTs them to the configured provider (Ollama's `/api/embed` or OpenAI's `/v1/embeddings`), with retry/backoff on transient failures, returning one vector per text.

6. As a result, Layer 3 yields a list of vectors aligned one-to-one with the new `ControlChunk` objects, ready to be combined with their metadata into Qdrant points.

#### Layer 4: Vector indexing / storage

**What this step does:** Write each (vector, payload) pair into the Qdrant collection that belongs to the active embedding profile, so the chunks become searchable and filterable. This closes the offline indexing phase.

**Control flow (start → end):**

1. `VectorStoreService.index_catalog()` in `core/ai/vector_store.py` routes the write through the selected profile's bundle to `OscalVectorIndexer`. The indexer calls `ensure_collection(vector_size)` to create the collection (with `Distance.COSINE`) on first use and to add payload indexes on `control_id`, `family`, `catalog_uuid`, etc.

2. For each chunk, `_to_point()` builds a Qdrant `PointStruct` with two parts:

- the **vector** from Layer 3
- the **payload**, the chunk's metadata plus its `text` (`control_id`, `family`, `catalog_uuid`, `chunk_type`, `text`, `catalog_version`, …) — this is what makes filtered retrieval possible later

3. Points are upserted in batches of 100. *Which* collection they land in depends on the active **embedding profile**. In this system, an embedding profile means one embedding provider/model configuration plus that model's matching vector index. `EmbeddingProfile` (built by `build_profiles()` in `core/ai/embedding_profiles.py`) implements that by pairing a provider + model with its own vector index, backed by a dedicated Qdrant collection. Vectors from different models have different dimensions and embedding-space geometry, so they cannot share one index. `VectorStoreService` holds one embedder/indexer bundle per profile, and `_select(profile)` routes the write — the **default** profile reuses the legacy `oscal_controls` collection (so upgrading needs no re-index), while every other profile gets a namespaced `oscal_controls__{profile}` (e.g. `oscal_controls__openai_text_embedding_3_small`). This is why `EmbeddingClient` accepts `provider`/`model` overrides: one `Settings` instance yields a distinct embedder per profile.

4. As a result, Qdrant now holds each chunk as a searchable vector plus structured payload. The payload is what lets Layer 5 narrow a search to only points whose metadata matches a framework, family, or control ID rather than scanning every point.

#### Layer 5: Search / retrieval

**What this step does:** On each request, embed the user's query with the same model used to build that model's vector index, search the matching Qdrant collection, and fall back across the ordered embedding profiles when the first profile does not return relevant controls. This is the retrieval half of the online query phase.

**Control flow (start → end):**

1. **API gateway:** `create_app()` in `core/app.py` mounts the `vector_search` router under `/api/v1`, so `GET /api/v1/search/controls` is routed by FastAPI to `search_controls()` in `core/routes/vector_search.py`. (The same router exposes `GET /search/profiles` and `GET /health/qdrant`, which the UI calls to populate its profile picker and index-status badge.)

2. `search_controls()` reads the query from `q` and optional `framework`/`family`/`control` filters, packs them into a `SearchFilters` object (`core/ai/vector_store.py`), and calls `VectorStoreService.search()` with `q`, `filters`, `top_k`, and the requested `profile`. The service instance is reused across requests via the `_get_vector_service()` dependency, which caches it on `app.state`.

3. `search()` resolves the requested profile into an ordered retrieval chain. The selected or default profile is tried first; lower-priority profiles act as fallbacks when the current profile is unavailable, empty, or returns no hits that meet the relevance threshold.

4. For each profile in that chain, `search()` calls `_select(profile)` to pick that profile's embedder and vector index, then calls `EmbeddingClient.embed_texts()` to turn the original text query into a vector for that model. The query is re-embedded for each fallback profile; vectors are never reused across profiles because each embedding model has its own dimensionality and geometry.

5. `_build_filter()` converts the `SearchFilters` into a Qdrant `Filter` of `FieldCondition` objects: `framework`→`catalog_uuid`, `family`→`family`, `control`→`control_id`. When filters are present, Qdrant restricts the search to matching points instead of scanning the whole collection.

6. `search()` calls `QdrantClient.query_points()` (qdrant-client 1.7+ replaced `.search()`) with the query vector, filter, and `top_k`, against that model's vector index. If the returned hits are relevant, the cascade stops and those hits become the retrieval result. If not, the same text query is embedded with the next profile's model and searched against that model's vector index.

7. Each returned hit is mapped by `_hit_to_result()` into a `ControlSearchResult` — `control_id`, `family`, `chunk_type`, `text`, `catalog_version`, plus the similarity `score` — drawn from the payload stored in Layer 4.

8. `search_controls()` wraps the list in a `ControlSearchResponse` (query, results, total) and returns it. The API hands back plain text plus metadata, never raw vectors. If every embedding profile in the fallback chain is exhausted without relevant hits, the response contains no results.

#### Layer 6: Inference (LLM)

**What this step does:** Turn the retrieved chunks into a grounded, citation-bearing answer — the generation half of the online query phase, reached via `POST /api/v1/search/ask`. The chat model sees **only text**, never vectors, so swapping the chat model needs no re-indexing, whereas changing the *embedding* model means re-running Layers 3–4 (reindex) so stored and query vectors match.

**Control flow (start → end):**

1. **API gateway:** `POST /api/v1/search/ask` (body validated against the `AskRequest` model) routes to `ask()` in `core/routes/vector_search.py`, which calls `VectorStoreService.ask()` with the question, filters, `top_k`, an optional `model` override, and `profile`.

2. `ask()` first runs Layer 5's `search()` to retrieve chunks, including the embedding-profile fallback chain, and builds the `citations` list directly from those retrieved chunks — never from LLM output — so a citation can only reference a control that was actually retrieved. If fallback is exhausted and nothing is retrieved, it returns early with an `"Insufficient evidence: …"` `GroundedAnswer` and makes no LLM call.

3. Otherwise it assembles the prompt: `_build_control_context()` concatenates the chunk texts into a bounded context string, and `_build_rag_messages()` combines that with `_RAG_SYSTEM_PROMPT` / `_RAG_USER_TEMPLATE` (all in `core/ai/vector_store.py`). The system prompt enforces grounding rules, including citing a fine-grained ID like `[AC-2.3_obj.a]` only when that exact string appears in the context.

4. `_resolve_rag_provider()` picks the chat model and credentials (default priority OpenAI → Anthropic → Ollama; a `model` override re-routes accordingly), and `ask()` calls `litellm.acompletion()` with that model and the messages.

5. `ask()` returns a `GroundedAnswer` (answer text, citations, `model_used`, `chunks_used`). If the provider call fails, the `ask()` route translates the error into a precise HTTP status (e.g. 422 for an unknown model, 503 for an unreachable provider) for the UI.

> Note: this OSCAL Q&A path uses `VectorStoreService.ask()`. A separate `AIEngine` (`core/ai/engine.py`) backs other product flows and may additionally require `AI_FEATURES_ENABLED=True` in `core/config.py`.

#### Layer 7: Frontend — the Compliance Q&A page

**What this step does:** Give the user a single page to ask a question, with a switch between full RAG and retrieval-only, and own the form state and submit lifecycle that calls Layers 5/6.

**Control flow (start → end):**

1. **Route entry:** the `/search` route is registered in `frontend/src/router.tsx` (`searchRoute`, nested under `layoutRoute` so it requires auth), lazy-loading the default export `SearchPage` from `frontend/src/pages/search/search.tsx`. The sidebar links to it as "Compliance Q&A" (`frontend/src/components/app-sidebar.tsx`).

2. `SearchPage` holds one `AskFormState` (`question`, `family`, `controlId`, `topK`, `model`, `profile`) initialized from `DEFAULT_FORM`, plus a `tab` of `"ask" | "search"`. A `<Tabs>` toggles between **Ask (RAG)** and **Retrieval only**; the same form serves both, only the max length and chunk cap differ.

3. On submit, `handleSubmit()` branches on `tab`. For `"ask"` it builds an `AskRequest` via `buildAskRequest()` (mapping the `__any__` family and blank fields to `null`) and fires `askMutation`, whose `mutationFn` calls `api.post<GroundedAnswer>("/v1/search/ask", req)` — entering **Layer 6**. For `"search"` it builds a query string via `buildSearchParams()` and fires `searchMutation`, which calls `api.get<ControlSearchResponse>("/v1/search/controls?…")` — entering **Layer 5**. Each path `.reset()`s its mutation first so a stale answer never lingers under a new question.

4. The mutation owns the async state (`isPending`, `error`, `data`); the JSX below the form renders off it. Control returns to the page when the backend responds, handed to Layer 9 for display.

#### Layer 8: Frontend — profile picker, model dropdown, and index health

**What this step does:** Let the user pick *which* embedding profile and *which* chat model a request uses, and show whether the chosen profile's Qdrant collection is actually reachable — all sourced from the backend so the UI never hardcodes what's available.

**Control flow (start → end):**

1. **Profiles:** `profilesQuery` calls `api.get<ProfilesListResponse>("/v1/search/profiles")`. On the backend, `list_profiles()` in `core/routes/vector_search.py` returns `svc.list_profiles()` mapped to `EmbeddingProfileResponse` rows (`name`, `provider`, `model`, `collection`, `description`, `available`, `is_default`). The `<Select>` lists every profile but disables those with `available=false` (provider not configured), and shows the active profile's `collection`/`provider` beneath it. A `useEffect` pre-fills `form.profile` with the server `default` once known, so the dropdown shows the resolved name rather than a blank "default".

2. **Models:** `modelsQuery` calls `api.get<ModelsListResponse>("/v1/search/models")`. `list_models()` builds the list from the **curated catalog** in `core/ai/model_catalog.py` (`OPENAI_CHAT_MODELS`, `ANTHROPIC_CHAT_MODELS`, `OLLAMA_CHAT_MODELS`) — *not* raw Ollama `/api/tags` — so embedding-only models like `nomic-embed-text` never appear as chat options. Hosted models are listed only when their `AI_*_ENABLED` flag and API key are set (`installed=true` always); for each Ollama model, `_fetch_ollama_models()` hits Ollama's `/api/tags` to set `installed`, letting the UI offer a "pull" action. The default is computed to mirror `_resolve_rag_provider` (OpenAI → Anthropic → Ollama). The dropdown shows "Server default · <id>" plus every `installed` model; selecting the default sends `model: null`.

3. **Index health:** the `QdrantStatus` badge calls `api.get<QdrantHealthResponse>("/v1/health/qdrant?profile=…")` for the *active* profile. `qdrant_health()` calls `svc.collection_info(profile)` and **always returns HTTP 200** — the badge reads `qdrant_reachable` and `collection.points_count` to render "N chunks indexed", "index degraded", or "index unreachable". This is why a missing index shows as a calm badge rather than a thrown error.

#### Layer 9: Frontend — rendering the grounded answer

**What this step does:** Turn the `GroundedAnswer` (or `ControlSearchResponse`) into readable output: prose with inline citation chips, a citation list, and a distinct treatment for "insufficient evidence".

**Control flow (start → end):**

1. When `askMutation` resolves, the answer card renders. `insufficient` is `true` when `answer` starts with `INSUFFICIENT_PREFIX` ("Insufficient evidence"); that flips the card to an amber warning style instead of the blue "Grounded answer" style, and surfaces `model_used` and `chunks_used` in the header.

2. The answer text goes through the `AnswerText` component, which runs a regex over the string to find `[AC-2]`-style control IDs (including enhancement/sub-objective forms like `[AC-2(3)]` / `[AC-2.3_obj.a]`) and renders each match as an inline `<Badge>` chip, leaving the rest as plain text. This is the front-end half of the grounding contract: the backend guarantees the IDs are real (citations built from retrieved chunks in Layer 6), and the UI makes them visually scannable.

3. Below the answer, each item in `askAnswer.citations` renders as a `CitationCard` (control ID, `chunk_type`, similarity `score` with a color band from `scoreBadgeClass()`, and the `text_excerpt`). In the **Retrieval only** tab, `searchResponse.results` render as `ResultCard`s instead — same shape, no LLM answer above them. Empty states and `error` cards cover the no-results and provider-failure paths.

#### Layer 10: Model management — pull / remove Ollama models from the UI

**What this step does:** Let a user make a curated Ollama model usable (pull) or reclaim space (remove) without shell access, and reflect long-running pulls live in the dropdown.

**Control flow (start → end):**

1. The **Manage models** dialog (`ManageOllamaModelsDialog`) lists the Ollama models from Layer 8 with an `installed`/`pulling…` badge. "Pull" fires `pullMutation` → `api.post("/v1/admin/models/pull", { pull_name })`; "Remove" opens a confirm dialog, then fires `removeMutation` → `api.post("/v1/admin/models/remove", { pull_name })`. Both admin endpoints require `require_admin`.

2. **Pull (backend):** `admin_pull_model()` first calls `_validate_catalog_pull_name()` — rejecting any name not in the curated catalog, so the endpoint can't be used to pull arbitrary (huge) models into the shared container. It then `asyncio.create_task(_perform_ollama_pull(...))` and returns **202 Accepted** immediately. `_perform_ollama_pull()` streams Ollama's `/api/pull` to completion, then calls `_evict_model_cache()` to free the just-pulled model from the OS page cache so it has RAM to load into (see the sidebar **"Freeing the page cache after a pull"** below for how this works).

3. **Live updates:** because the pull is fire-and-forget, the UI tracks it in a `pendingPulls` set (added in `pullMutation.onSuccess`). While that set is non-empty, `modelsQuery` sets `refetchInterval: 3000`, re-polling `/v1/search/models` every 3 s; a `useEffect` drops a name from `pendingPulls` once the model reports `installed`, which stops the polling. Another `useEffect` falls the selected `model` back to the server default if the currently-chosen model is removed.

4. **Remove (backend):** `admin_remove_model()` re-validates against the catalog, then issues `DELETE /api/delete` to Ollama, translating 404 (not installed) and other failures into precise HTTP codes; `removeMutation.onSuccess` invalidates the `chat-models` query so the dropdown refreshes.

---

**Sidebar — freeing the page cache after a pull (`_evict_model_cache`)**

*The concept everything hinges on — the page cache.* When a program reads or writes a file, the OS keeps a copy of that file's contents in RAM so the next access is fast. That in-RAM copy is the **page cache** ("page" = one ~4 KB chunk the OS manages memory in; the page cache is the collection of pages currently holding file data). It's normally invisible and helpful.

*Why this code exists.* When Ollama *pulls* a model, the OS fills the page cache with that big model file. RAM then looks "used" even though the real copy is safely on disk. Ollama decides whether it can load a model by checking roughly *free* RAM and does **not** count reclaimable *Available* cache as free — so right after a download it can **refuse to load the model it just pulled**. The fix: evict that file's pages from the page cache so the RAM reads as free again. `_evict_model_cache()` (`core/routes/vector_search.py:537`) does this. It's run via `await asyncio.to_thread(_evict_model_cache, ...)` — i.e. on a **separate worker thread**, because the steps below are slow, blocking disk operations and the async server's event loop must never get stuck.

The three steps that matter regarding this in control-flow order:

1. **`os.sync()` — flush first, so pages are safe to drop.** Some cached pages may be *dirty* (written in RAM but not yet saved to disk). A dirty page can't be safely dropped — that would lose data. `os.sync()` forces the OS to write all pending changes to disk *now*, turning every dirty page *clean*. A clean page is just a redundant copy of what's on disk, so it's safe to throw away. This is the "make everything evictable" step, and it must come before eviction.

2. **`os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)` — the actual eviction.** `fadvise` = "file advice": telling the OS how you'll use a file so it can manage the cache. The args: `fd` is a handle to the open file; `0, 0` is offset + length, where the second `0` means **the whole file** (not zero bytes); `POSIX_FADV_DONTNEED` is the advice **"I won't need this file's data again soon."** In response the OS **drops that file's clean pages from the page cache** — reclaiming the RAM. (Linux/Unix only — on macOS this function doesn't exist, so the whole routine no-ops.)

3. **Targeting only our own files (`os.scandir` + `entry.is_file()` + `os.open`/`os.close`).** Rather than the blunt, privileged, system-wide `drop_caches`, the code evicts *only Ollama's model files*: `os.scandir({models_path}/models/blobs)` lists the blob files; `entry.is_file()` skips sub-directories (a folder has no file-content pages to evict); `os.open(path, os.O_RDONLY)` gets a read-only **file descriptor** (a small integer handle the OS uses to refer to an open file) to pass to `fadvise`; `os.close(fd)` in a `finally` releases that handle even on error, so looping over thousands of blobs can't leak handles. Read-only is enough — evicting cache doesn't modify the file.

*How the backend can even see Ollama's files.* The two run in separate containers, so this only works because of `docker-compose.yml` (lines 50–52): the backend mounts the shared `ollama_data` volume **read-only** at `/ollama-models`, and `OLLAMA_MODELS_PATH=/ollama-models` (config default is empty — `core/config.py:44`) points the eviction at it.

*Safety / no-op conditions (so it never breaks a pull).* The function returns early and does nothing when `OLLAMA_MODELS_PATH` is unset (local non-Docker runs), when `os.posix_fadvise` is unavailable (macOS), or when the blobs dir is absent; per-file `OSError`s are caught and logged. It's designed to be safe to call unconditionally and never raise into the pull.

> This is the automatic, unprivileged, surgical version of the manual `echo 3 > /proc/sys/vm/drop_caches`  — that one is system-wide and needs root; this one targets only our own model files and needs no privileges.

```bash
#Freeing up cache
docker run --rm --privileged alpine sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'

# Seeing if the cache freed up
docker exec -it $(docker compose ps -q ollama) free -h
```

#### Layer 11: Admin reindex

**What this step does:** Re-run the offline indexing phase (Layers 1–4) on demand from the API, without dropping to the CLI — useful after adding catalogs or switching a profile's embedding model.

**Control flow (start → end):**

1. `POST /v1/admin/reindex` (body `ReindexRequest`: `force`, `oscal_dir`, `profile`) routes to `admin_reindex()`, gated by `require_admin`.

2. It resolves the OSCAL directory (defaulting to `data/oscal/` at repo root) and calls `VectorStoreService.reindex(oscal_path, force=…, profile=…)` — the same service method the CLI uses. With `force=true` the profile's collection is deleted and recreated for a clean index; otherwise the stable-ID skip from Layer 3 makes the re-run idempotent.

3. It returns a `ReindexResponse` (`catalogs_indexed`, `total_chunks`, `catalog_titles`, `force`). The docstring notes this runs synchronously and can take minutes for large catalogs, so the CLI (`scripts/index_oscal_vectors.py`) remains the preferred path for production bulk indexing.

## Manual CLI RAG Setup

Step 1: Set up the docker containers

```bash
docker compose up -d
```

Step 2: Pull the embedding model and the chat model inside the Ollama container so it can serve them locally (the `ollama` CLI lives inside the container, not on the host)

```bash
docker exec -it cyberdome-ollama-1 ollama pull nomic-embed-text # replace `nomic-embed-text` with a different model like `mxbai-embed-large` for testing a different embedding model. But remember - you will have to build a different embedding profile for that. 
docker exec -it cyberdome-ollama-1 ollama pull llama3.1  # replace `llama 3.1` with a different model like `qwen3:8b` for testing a different chat model
```

Step 3: Create a fresh project virtualenv using Python 3.13 (the project's `pyproject.toml` requires `>=3.13`; the default `python3` on macOS may be 3.12), activate it, verify Python is pointing at the venv at the right version, then install the project + dev dependencies so the next Python command has everything it needs

```bash
rm -rf .venv
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
which python && python --version          # should print .../.venv/bin/python and Python 3.13.x
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

Step 4: Index the OSCAL catalog into Qdrant so the control chunks are embedded and stored for retrieval (`--force` drops and recreates the collection for a clean state)

```bash
python scripts/index_oscal_vectors.py --list-profiles # Confirm both profiles report AVAIL=yes
python scripts/index_oscal_vectors.py --force # Index using the default profile(ollama_nomic_embed_text) results in a collection named `oscal_vectors`
python scripts/index_oscal_vectors.py --profile openai_text_embedding_3_small --force # Index using the openAI profile results in a collection named `oscal_controls__openai_text_embedding_3_small`
```

Step 5: Verify both collections are populated
curl -s '<http://localhost:8000/api/v1/health/qdrant?profile=ollama_nomic_embed_text>' | jq
curl -s '<http://localhost:8000/api/v1/health/qdrant?profile=openai_text_embedding_3_small>' | jq

Step 6: Start the FastAPI backend so the search and ask endpoints become reachable

```bash
uvicorn core.app:create_app --factory --reload --port 8000
```

Step 7: Run a semantic search against the indexed controls to confirm retrieval is working end-to-end

```bash
curl -sG 'http://localhost:8000/api/v1/search/controls' \
    --data-urlencode 'q=What does the control baseline require for account management?' \
    --data-urlencode 'top_k=5' | jq .
```

Step 8: Ask a grounded RAG question using 2 models on the collections made from the 2 profiles—

```bash
Q='What does AC-2 require for inactive account disablement?'

  for MODEL in 'ollama_chat/llama3.1' 'gpt-4o-mini'; do
    for PROFILE in ollama_nomic_embed_text openai_text_embedding_3_small; do
      echo "=== model=$MODEL  profile=$PROFILE ==="
      curl -s -X POST http://localhost:8000/api/v1/search/ask \
        -H 'Content-Type: application/json' \
        -d "{\"question\":\"$Q\",\"profile\":\"$PROFILE\",\"model\":\"$MODEL\",\"top_k\":5}" \
        | jq '{model_used, chunks_used, citations:[.citations[] | {control_id, score}], answer}'
    done
  done
```

## Sample questions for testing embedding profiles and models

1. **Prompt:** What does AC-2 require for inactive account disablement?

- **Tests:** Basic control retrieval and summarization.

2. **Prompt:** How does AC-2(3) differ from AC-2?

- **Tests:** Retrieval of control enhancements and comparison.

3. **Prompt:** Which controls support multifactor authentication, and how are they related?

- **Tests:** Multi-control retrieval and reasoning.

4. **Prompt:** What evidence would an auditor expect to see to assess compliance with AU-6?

- **Tests:** Conversion of control text into compliance guidance.

5. **Prompt:** Which controls are relevant to privileged account management, and why?

- **Tests:** Thematic retrieval across multiple families.

6. **Prompt:** Build a table of controls related to remote access, including their control families and purposes.

- **Tests:** Aggregation, organization, and synthesis.

### Prompts that return Insufficient evidence

1. **Prompt:** What organization-defined parameters exist in IA-5?

- **Tests:** OSCAL-specific structured data retrieval.

2. **Prompt:** Is AC-2 included in the Moderate baseline?

- **Tests:** Baseline/profile awareness.

3. **Prompt:** What does control AC-999 require?

- **Tests:** Hallucination resistance and ability to recognize nonexistent controls.
