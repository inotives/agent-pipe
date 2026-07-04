# agent-pipe

Minimal local CLI scaffold for Agent Pipe Phase 1.

## Quickstart

```bash
npm install
npm run agent-pipe -- --help
npm test
npm run typecheck
```

Phase 1 workflow:

```bash
npm run agent-pipe -- init
npm run agent-pipe -- put --entity coins_list --file ./coins.json
```

Example `coins.json`:

```json
[
  { "id": "bitcoin", "symbol": "btc", "name": "Bitcoin" },
  { "id": "ethereum", "symbol": "eth", "name": "Ethereum" }
]
```
