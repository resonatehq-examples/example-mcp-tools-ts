# Durable MCP Tools with Resonate

> **The simpler alternative to Temporal for building reliable AI tool integrations**

This project demonstrates how to build production-ready MCP (Model Context Protocol) tools with automatic retries, state management, and fault tolerance using Resonate - with **dramatically less complexity** than Temporal.

## 🚀 Why Resonate Over Temporal?

| Feature | Temporal | Resonate |
|---------|----------|----------|
| **Processes needed** | 3 (Server + Worker + MCP) | 1 (Just MCP) |
| **Setup complexity** | High | Low |
| **Decorators** | 5+ types (`@workflow.defn`, `@workflow.run`, `@activity.defn`, `@workflow.signal`, `@workflow.query`) | 1 (`resonate.run()`) |
| **Special imports** | Required (`workflow.unsafe.imports_passed_through()`) | None |
| **Task queues** | Manual configuration | Automatic |
| **Lines of code** | ~150 (weather example) | ~80 (same functionality) |
| **Learning curve** | Steep | Gentle |
| **Infrastructure** | Temporal server required | Optional (works locally) |

## 📊 Side-by-Side Comparison

### Weather Forecast Example

#### Temporal's Approach (Python)

```python
# Need 4 separate files + running Temporal server + Worker process

# activities.py
from temporalio import activity
import httpx

@activity.defn
async def make_nws_request(url: str) -> dict[str, Any] | None:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/geo+json"}
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, timeout=5.0)
        response.raise_for_status()
        return response.json()

# workflow.py
from temporalio import workflow
from datetime import timedelta

# Special import pattern required!
with workflow.unsafe.imports_passed_through():
    from workflows.weather_activities import make_nws_request

@workflow.defn
class GetForecast:
    @workflow.run
    async def run(self, latitude: float, longitude: float) -> str:
        # Step 1: Get forecast endpoint
        points_url = f"{NWS_API_BASE}/points/{latitude},{longitude}"
        points_data = await workflow.execute_activity(
            make_nws_request,
            points_url,
            start_to_close_timeout=timedelta(seconds=40),
        )
        
        # ... more boilerplate ...

# worker.py
async def main():
    client = await Client.connect("localhost:7233")
    worker = Worker(
        client,
        task_queue="weather-task-queue",
        workflows=[GetForecast],
        activities=[make_nws_request],
    )
    await worker.run()

# weather.py (MCP server)
@mcp.tool()
async def get_forecast(latitude: float, longitude: float) -> str:
    client = await Client.connect("localhost:7233")
    handle = await client.start_workflow(
        GetForecast,
        args=[latitude, longitude],
        id=f"forecast-{latitude}-{longitude}",
        task_queue="weather-task-queue",
    )
    return await handle.result()

# Plus you need to:
# 1. Start Temporal server: temporal server start-dev
# 2. Start Worker: uv run worker.py
# 3. Start MCP server: uv run weather.py
```

#### Resonate's Approach (TypeScript)

```typescript
// Just ONE file! No separate server, no worker process

import { Resonate, Context } from '@resonatehq/sdk';

const resonate = new Resonate();
await resonate.start();

// Regular async function - that's it!
async function fetchNWS(ctx: Context, url: string): Promise<any> {
  const response = await fetch(url, { 
    headers: { 'User-Agent': 'resonate-weather/1.0' },
    signal: AbortSignal.timeout(5000) 
  });
  return response.json();
}

// No @workflow.defn, no special imports, just regular code
async function getForecast(
  ctx: Context, 
  latitude: number, 
  longitude: number
): Promise<string> {
  // Durable API call with automatic retries
  const pointsData = await resonate.run(
    ctx,
    'fetchPoints',
    fetchNWS,
    `${NWS_API_BASE}/points/${latitude},${longitude}`
  );

  const forecastData = await resonate.run(
    ctx,
    'fetchForecast',
    fetchNWS,
    pointsData.properties.forecast
  );

  return formatForecast(forecastData);
}

// MCP tool handler - calls our durable function
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { latitude, longitude } = request.params.arguments;
  
  // That's it! Automatic durability, retries, and state management
  const result = await resonate.run(
    `forecast-${latitude}-${longitude}`,
    getForecast,
    latitude,
    longitude
  );
  
  return { content: [{ type: 'text', text: result }] };
});

// Run: npm run weather
```

### Key Differences Highlighted

1. **No Infrastructure Required**
   - ❌ Temporal: Must run `temporal server start-dev` in separate terminal
   - ✅ Resonate: Just `npm run weather` and go

2. **No Worker Management**
   - ❌ Temporal: Must create and run separate Worker process
   - ✅ Resonate: Workers are handled automatically

3. **No Special Patterns**
   - ❌ Temporal: `workflow.unsafe.imports_passed_through()`, `@workflow.defn`, `@workflow.run`, `workflow.execute_activity()`
   - ✅ Resonate: Just `resonate.run()` - that's it!

4. **Simpler Mental Model**
   - ❌ Temporal: Learn Workflows, Activities, Workers, Task Queues, Signals, Queries
   - ✅ Resonate: Learn `resonate.run()` - done!

## 📦 What's Included

### 1. Weather Forecast Tool (`src/weather-server.ts`)

A durable weather forecast MCP tool that:
- Fetches real-time data from the National Weather Service API
- Automatically retries failed API calls
- Maintains state across crashes
- Handles network timeouts gracefully

**Use case:** Claude Desktop can ask for weather forecasts reliably, even if the API is temporarily down.

### 2. Invoice Processing with Human-in-the-Loop (`src/invoice-server.ts`)

A long-running invoice processing workflow that:
- Accepts invoice submissions
- Waits for human approval (with timeout)
- Processes payments only after approval
- Maintains state during the entire waiting period
- Survives process crashes while waiting

**Use case:** AI agent can prepare invoices, but humans maintain control over final payment execution.

## 🎯 Getting Started

### Prerequisites

- Node.js 18+ or Bun
- No other infrastructure needed!

### Installation

```bash
cd /Users/flossypurse/code/example-mcp-tools-ts
npm install
```

### Running the Examples

#### Weather MCP Server

```bash
npm run weather
```

#### Invoice MCP Server

```bash
npm run invoice
```

### Configuring with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "resonate-weather": {
      "command": "node",
      "args": [
        "/Users/yourname/code/example-mcp-tools-ts/dist/weather-server.js"
      ]
    },
    "resonate-invoice": {
      "command": "node",
      "args": [
        "/Users/yourname/code/example-mcp-tools-ts/dist/invoice-server.js"
      ]
    }
  }
}
```

Or if using `tsx`:

```json
{
  "mcpServers": {
    "resonate-weather": {
      "command": "npx",
      "args": [
        "tsx",
        "/Users/yourname/code/example-mcp-tools-ts/src/weather-server.ts"
      ]
    }
  }
}
```

## 🧪 Testing the Tools

### Weather Tool

1. Open Claude Desktop
2. Ask: "What's the weather forecast for San Francisco?" (37.7749, -122.4194)
3. Claude will use the `get_forecast` tool
4. Get reliable results even if the API has transient failures

### Invoice Tool

1. Ask Claude: "Submit an invoice for $100 consulting and $50 expenses"
2. Claude creates the invoice and waits for approval
3. In another message, say: "Approve the invoice"
4. Payments are processed automatically

**Try the durability:**
- Submit an invoice
- Quit Claude Desktop while it's pending
- Restart Claude and check the status
- The invoice is still there, waiting!

## 💡 Why This Matters

### For Developers

**Temporal Forces You To:**
- Run and manage a Temporal server
- Understand complex concepts (Workflows, Activities, Task Queues)
- Write significant boilerplate
- Debug across multiple processes
- Configure retry policies manually

**Resonate Lets You:**
- Write regular async functions
- Add durability with one function call
- Run everything in one process
- Get automatic retries out of the box
- Focus on business logic, not infrastructure

### For Production

Both Temporal and Resonate provide:
- ✅ Automatic retries
- ✅ State persistence
- ✅ Crash recovery
- ✅ Long-running operations
- ✅ Observability

But Resonate does it with:
- ✅ Less code
- ✅ Simpler deployment
- ✅ Fewer moving parts
- ✅ Easier debugging

## 📈 Code Metrics Comparison

| Metric | Temporal (Python) | Resonate (TypeScript) | Improvement |
|--------|-------------------|------------------------|-------------|
| **Files required** | 4 | 1 | **75% fewer** |
| **Lines of code** | ~150 | ~80 | **47% fewer** |
| **Processes needed** | 3 | 1 | **67% fewer** |
| **Decorators to learn** | 5+ | 1 | **80% fewer** |
| **Special patterns** | 3+ | 0 | **100% fewer** |
| **Setup steps** | 6 | 2 | **67% fewer** |

## 🏗️ Architecture Comparison

### Temporal Architecture

```
┌─────────────────┐
│ Claude Desktop  │
└────────┬────────┘
         │ MCP
         ▼
┌─────────────────┐      ┌─────────────────┐
│  MCP Server     │─────▶│ Temporal Server │
│  (weather.py)   │      │  (localhost:7233)│
└─────────────────┘      └────────┬─────────┘
                                   │
                                   ▼
                         ┌─────────────────┐
                         │  Worker Process  │
                         │   (worker.py)    │
                         └─────────────────┘

3 separate processes, 2 network hops, complex state sync
```

### Resonate Architecture

```
┌─────────────────┐
│ Claude Desktop  │
└────────┬────────┘
         │ MCP
         ▼
┌─────────────────────────┐
│  MCP Server + Resonate  │
│  (weather-server.ts)    │
│  ┌──────────────┐       │
│  │   Resonate   │       │
│  │   (embedded) │       │
│  └──────────────┘       │
└─────────────────────────┘

1 process, 0 network hops, simple and fast
```

## 🔍 Deep Dive: What Makes Resonate Simpler?

### 1. No Separate Infrastructure

**Temporal:**
```bash
# Terminal 1: Start Temporal server
temporal server start-dev

# Terminal 2: Start Worker
uv run worker.py

# Terminal 3: Start MCP server
uv run weather.py
```

**Resonate:**
```bash
# Just one command
npm run weather
```

### 2. No Special Decorators

**Temporal:**
```python
@workflow.defn
class GetForecast:
    @workflow.run
    async def run(self, ...): ...

@activity.defn
async def make_nws_request(...): ...

@workflow.signal
async def approve_invoice(self): ...

@workflow.query
def get_status(self): ...
```

**Resonate:**
```typescript
// Just regular functions + resonate.run()
async function getForecast(...) {
  return await resonate.run(...);
}
```

### 3. No Import Magic

**Temporal:**
```python
# This is required and non-obvious
with workflow.unsafe.imports_passed_through():
    from workflows.weather_activities import make_nws_request
```

**Resonate:**
```typescript
// Normal imports
import { Resonate } from '@resonatehq/sdk';
```

### 4. No Manual Worker Setup

**Temporal:**
```python
worker = Worker(
    client,
    task_queue="weather-task-queue",  # Manual config
    workflows=[GetForecast],           # Manual registration
    activities=[make_nws_request],     # Manual registration
)
```

**Resonate:**
```typescript
// Workers are automatic - just call resonate.run()
```

## 🎓 Learning Path

### To Build with Temporal:

1. Learn MCP protocol
2. Learn Temporal concepts (Workflows, Activities, Workers, Task Queues)
3. Learn decorators and special patterns
4. Learn how to configure retry policies
5. Learn how to set up and run Temporal server
6. Learn how to debug across multiple processes

**Estimated time: 4-8 hours**

### To Build with Resonate:

1. Learn MCP protocol
2. Learn `resonate.run()`

**Estimated time: 1-2 hours**

## 🚢 Deployment

### Temporal Deployment

Requires:
- Temporal server infrastructure (self-hosted or Temporal Cloud)
- Worker deployment and scaling
- MCP server deployment
- Load balancer configuration
- Multiple service health checks

### Resonate Deployment

Requires:
- MCP server deployment (single service)
- Optional: Resonate Cloud for distributed state
- Standard health checks

## 🤝 Contributing

This is a reference example. Feel free to:
- Fork and adapt for your use case
- Add more MCP tools
- Improve error handling
- Add observability

## 📚 Resources

- [Resonate Documentation](https://docs.resonatehq.io/)
- [MCP Protocol Docs](https://modelcontextprotocol.io/)
- [Temporal's Original Tutorial](https://learn.temporal.io/tutorials/ai/building-mcp-tools-with-temporal/)

## 🎯 When to Use Each

### Use Resonate when:
- ✅ You want to get started quickly
- ✅ You prefer simpler code
- ✅ You want fewer moving parts
- ✅ You're building new projects
- ✅ You value developer experience

### Use Temporal when:
- ✅ You already have Temporal infrastructure
- ✅ Your team knows Temporal well
- ✅ You need enterprise support contracts
- ✅ You have complex workflow patterns

## 📄 License

MIT

## 🙌 Credits

This example was created to demonstrate that durable execution doesn't have to be complex. Inspired by Temporal's MCP tutorial, reimagined with Resonate's simplicity-first approach.

---

**Built with ❤️ by the Resonate team**

*Making durable execution accessible to everyone*
