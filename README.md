# Building MCP Tools with Resonate

Build production-ready MCP (Model Context Protocol) tools with automatic retries, state management, and fault tolerance using Resonate.

## What You'll Build

This example demonstrates two real-world MCP tools:

1. **Weather Forecast Tool** - Fetch real-time weather data with automatic retries and error handling
2. **Invoice Processing** - Submit invoices with human-in-the-loop approval workflows

Both examples show how Resonate's durable execution guarantees make AI tool integrations reliable without complex infrastructure.

## Why Resonate for MCP Tools?

**Automatic Retries**  
API calls automatically retry on failure without losing context.

**State Persistence**  
Long-running operations (like waiting for human approval) maintain state across restarts.

**Simple Code**  
Write regular async functions. Resonate handles durability.

**No Infrastructure**  
Start with local development, scale to production without architectural changes.

## Quick Start

### Install
```bash
npm install
```

### Run the Weather Tool
```bash
npm run weather
```

### Configure with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "resonate-weather": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/example-mcp-tools-ts/src/weather-server.ts"
      ]
    }
  }
}
```

Restart Claude Desktop, then ask: "What's the weather in San Francisco?"

## How It Works

### Weather Example

The weather tool fetches forecasts from the National Weather Service API:

```typescript
import { Resonate, Context } from '@resonatehq/sdk';

const resonate = new Resonate();
await resonate.start();

// Regular async function with automatic retry
async function fetchNWS(ctx: Context, url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Resonate-MCP-Example',
      'Accept': 'application/geo+json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`NWS API error: ${response.status}`);
  }
  
  return response.json();
}

// Register for durability
resonate.register('fetchNWS', fetchNWS);

// Use in your workflow
async function getForecast(ctx: Context, lat: number, lon: number) {
  // Durable API call - retries automatically on failure
  const pointsData = await ctx.run(fetchNWS, pointsUrl);
  const forecastData = await ctx.run(fetchNWS, forecastUrl);
  
  return formatForecast(forecastData);
}

resonate.register('getForecast', getForecast);
```

**Key Benefits:**
- `ctx.run()` makes API calls durable - they'll retry on failure
- State is preserved if your process crashes
- No decorators, task queues, or special patterns to learn

### Invoice Example

The invoice tool demonstrates human-in-the-loop workflows:

```typescript
async function processInvoice(ctx: Context, invoice: Invoice) {
  // Submit for approval
  const submissionResult = await ctx.run(submitInvoice, invoice);
  
  // Wait for human decision (could be hours or days)
  const decision = await ctx.lfc(
    `invoice-approval-${invoice.id}`,
    (decision: string) => decision === 'approved' || decision === 'rejected'
  );
  
  if (decision === 'approved') {
    // Process payment
    const payment = await ctx.run(processPayment, invoice);
    return { status: 'paid', payment };
  }
  
  return { status: 'rejected' };
}
```

**Key Benefits:**
- Process can wait for human input indefinitely
- State is maintained even if the server restarts
- No polling, no manual state management

## Project Structure

```
src/
├── weather-server.ts     # Weather forecast MCP tool
├── invoice-server.ts     # Invoice processing with human-in-the-loop
└── shared/
    └── types.ts          # Shared TypeScript types
```

## Features Demonstrated

✅ **Durable API Calls** - Automatic retries with exponential backoff  
✅ **Error Handling** - Graceful degradation on API failures  
✅ **State Persistence** - Survives process restarts  
✅ **Human-in-the-Loop** - Wait for external input indefinitely  
✅ **Type Safety** - Full TypeScript support  
✅ **MCP Integration** - Works with Claude Desktop and other MCP clients  

## Running the Examples

### Weather Tool
```bash
npm run weather
```

Ask Claude: "What's the weather forecast for Seattle?"

### Invoice Tool
```bash
npm run invoice
```

Ask Claude: "Submit invoice INV-001 for $150 to ACME Corp"

Then approve/reject:
```bash
# In another terminal
curl -X POST http://localhost:3000/approve/INV-001
# or
curl -X POST http://localhost:3000/reject/INV-001
```

## Extending the Examples

### Add Your Own Tool

1. Create a new file in `src/` (e.g., `my-tool-server.ts`)
2. Define your durable functions:

```typescript
async function myDurableOperation(ctx: Context, input: string) {
  const result = await ctx.run(externalAPI, input);
  return processResult(result);
}

resonate.register('myDurableOperation', myDurableOperation);
```

3. Wrap in an MCP server:

```typescript
const server = new Server({
  name: 'my-tool',
  version: '1.0.0',
}, { capabilities: { tools: {} } });

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'my_tool') {
    const result = await resonate.run(
      'my-op-1',
      myDurableOperation,
      request.params.arguments.input
    );
    return { content: [{ type: 'text', text: result }] };
  }
});
```

4. Add npm script in `package.json`:

```json
{
  "scripts": {
    "my-tool": "tsx src/my-tool-server.ts"
  }
}
```

### Connect to Real Services

Replace mock data with real API calls:

```typescript
// Example: OpenWeatherMap instead of NWS
async function fetchWeather(ctx: Context, city: string) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}`;
  
  const response = await fetch(url);
  return response.json();
}

resonate.register('fetchWeather', fetchWeather);
```

### Deploy to Production

Resonate works the same locally and in production:

```typescript
// Development (local)
const resonate = new Resonate();

// Production (with Resonate server)
const resonate = Resonate.remote({
  url: process.env.RESONATE_SERVER_URL
});
```

See [Resonate deployment docs](https://docs.resonatehq.io/deploy) for production patterns.

## Learn More

- [Resonate Documentation](https://docs.resonatehq.io)
- [MCP Protocol](https://modelcontextprotocol.io)
- [TypeScript SDK Guide](https://docs.resonatehq.io/develop/typescript)
- [Example Applications](https://github.com/resonatehq-examples)

## Common Questions

**Do I need to run a Resonate server?**  
No, you can start with `new Resonate()` for local development. Switch to `Resonate.remote()` when you need distributed workers or production durability.

**What happens if my process crashes?**  
Resonate persists execution state. When your process restarts, workflows resume from the last successful step.

**How do retries work?**  
`ctx.run()` automatically retries failed operations with exponential backoff. You can customize retry behavior with options.

**Can I use this with other AI models?**  
Yes! MCP tools work with any MCP-compatible client, not just Claude.

## Contributing

Found a bug or have an improvement? Open an issue or PR at [resonatehq-examples](https://github.com/resonatehq-examples).

## License

MIT
