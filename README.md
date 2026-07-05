# agent-pipe

Minimal local CLI for Agent Pipe Phase 4 manual job workflows.

## Quickstart

```bash
npm install
npm run agent-pipe -- --help
npm test
npm run typecheck
```

Quick local workflow:

```bash
npm run agent-pipe -- init
npm run agent-pipe -- put --entity coins_list --file ./coins.json
npm run agent-pipe -- records list
npm run agent-pipe -- records show 'my-project:coins_list:["bitcoin"]'
npm run agent-pipe -- jobs list
npm run agent-pipe -- run --job collect_prices
npm run agent-pipe -- source list
npm run agent-pipe -- source run coingecko_coins_list
npm run agent-pipe -- runs list
npm run agent-pipe -- runs show '<job-run-id>'
```

Example `coins.json`:

```json
[
  { "id": "bitcoin", "symbol": "btc", "name": "Bitcoin" },
  { "id": "ethereum", "symbol": "eth", "name": "Ethereum" }
]
```
