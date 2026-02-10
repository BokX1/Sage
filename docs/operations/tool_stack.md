# Self-Hosted Tool Stack

Run Sage with a local tool stack first, then fall back to hosted providers (Tavily, Exa, Firecrawl, Pollinations) when needed.

## 1) Start local services

```bash
docker compose -f config/self-host/docker-compose.tools.yml up -d
```

This starts:

- `sage-searxng` on `http://127.0.0.1:8080`
- `sage-crawl4ai` on `http://127.0.0.1:11235`
- `sage-ollama` on `http://127.0.0.1:11434`

## 2) Pull at least one Ollama model

```bash
docker exec sage-ollama ollama pull llama3.1:8b
```

## 3) Configure `.env` for self-host-first + fallback

```env
TOOL_WEB_SEARCH_PROVIDER_ORDER=searxng,tavily,exa,pollinations
TOOL_WEB_SCRAPE_PROVIDER_ORDER=crawl4ai,firecrawl,jina,raw_fetch

SEARXNG_BASE_URL=http://127.0.0.1:8080
CRAWL4AI_BASE_URL=http://127.0.0.1:11235
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
```

Optional hosted fallback keys:

```env
TAVILY_API_KEY=...
EXA_API_KEY=...
FIRECRAWL_API_KEY=...
```

## 4) Validate the stack

```bash
npm run tools:smoke
```

The smoke script checks:

- `web_search`
- `web_scrape`
- `wikipedia_lookup`
- `github_repo_lookup`
- `npm_package_lookup`
- `stack_overflow_search`
- `local_llm_models` (optional warning if Ollama is empty/down)

## 5) Stop local services

```bash
docker compose -f config/self-host/docker-compose.tools.yml down
```
