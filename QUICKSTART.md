# Quick Start Guide

Get your first durable MCP tool running in under 10 minutes.

## Prerequisites

- Node.js 18+ or Bun
- Claude Desktop (optional, for testing)

## 5-Minute Setup

### 1. Clone and Install

```bash
cd /Users/flossypurse/code/example-mcp-tools-ts
npm install
```

### 2. Build (optional)

```bash
npm run build
```

Or just use `tsx` to run TypeScript directly:

```bash
npm run weather
```

### 3. Test It Works

The server should start and show:
```
Resonate Weather MCP Server running on stdio
```

Press Ctrl+C to stop it.

## Configure Claude Desktop

### Option 1: Using tsx (Development)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Option 2: Using compiled JS (Production)

First build:
```bash
npm run build
```

Then configure:
```json
{
  "mcpServers": {
    "resonate-weather": {
      "command": "node",
      "args": [
        "/Users/yourname/code/example-mcp-tools-ts/dist/weather-server.js"
      ]
    }
  }
}
```

**Important:** Replace `/Users/yourname/code/example-mcp-tools-ts` with your actual path!

## Test with Claude Desktop

1. **Completely quit** Claude Desktop (don't just close the window)
   - macOS: Right-click dock icon → Quit
   - Windows: System tray → Exit

2. **Restart** Claude Desktop

3. **Check the connection:**
   - Click the icon next to the (+) button
   - You should see "resonate-weather" with a blue toggle (on)

4. **Test the tool:**
   - Ask: "What's the weather forecast for San Francisco?"
   - Or: "Get me the weather for 37.7749, -122.4194"

## What Just Happened?

When Claude asks for weather:

1. Claude Desktop calls your MCP server via stdio
2. Your server receives the `get_forecast` tool call
3. Resonate makes the weather API calls **durably**
   - If the API fails, it automatically retries
   - If your process crashes, it resumes from the last successful step
4. Results are returned to Claude

## Try Breaking It

### Test 1: Durability During Execution

1. Ask Claude for weather
2. While it's processing, press Ctrl+C in your terminal (if running manually)
3. Restart the server
4. The request completes successfully!

Why? Resonate saved the state and resumed from where it left off.

### Test 2: API Failure Recovery

The National Weather Service API sometimes rate limits. Try asking for multiple forecasts rapidly:

1. "What's the weather in San Francisco?"
2. "What's the weather in New York?"
3. "What's the weather in Seattle?"

Even if some requests fail temporarily, Resonate automatically retries until they succeed.

## Next Steps

### Add the Invoice Tool

```bash
npm run invoice
```

Configure in Claude:
```json
{
  "mcpServers": {
    "resonate-weather": { ... },
    "resonate-invoice": {
      "command": "npx",
      "args": [
        "tsx",
        "/Users/yourname/code/example-mcp-tools-ts/src/invoice-server.ts"
      ]
    }
  }
}
```

Test it:
1. "Create an invoice for $100 consulting and $50 expenses"
2. "Approve the invoice" (in a new message)
3. Payments process automatically!

### Customize the Code

Both examples are heavily commented. Open them in your editor:

- `src/weather-server.ts` - See how durable API calls work
- `src/invoice-server.ts` - See how human-in-the-loop works

Change anything! The code is simple and designed to be forked.

## Troubleshooting

### "Command not found: npx"

Install Node.js from https://nodejs.org/

### "Cannot find module @resonatehq/sdk"

```bash
npm install
```

### Claude doesn't see the tool

1. Make sure you completely quit Claude (not just close)
2. Check the path in `claude_desktop_config.json` is correct
3. Try running the server manually to check for errors:
   ```bash
   npx tsx src/weather-server.ts
   ```

### "Connection refused" or "Port already in use"

The MCP servers use stdio (standard input/output), not network ports. This error shouldn't happen. If it does:

1. Check you're not accidentally running an HTTP server
2. Make sure no other process is using the same file

### Weather API returns errors

The National Weather Service API:
- Only works for US locations
- Requires specific lat/lon format
- Rate limits aggressively

If you get errors, try these known-good coordinates:
- San Francisco: 37.7749, -122.4194
- New York: 40.7128, -74.0060
- Seattle: 47.6062, -122.3321

## Getting Help

- [Resonate Documentation](https://docs.resonatehq.io/)
- [Resonate Discord](https://discord.gg/resonate)
- [MCP Documentation](https://modelcontextprotocol.io/)

## What's Next?

You now have working durable MCP tools! Consider:

1. **Add your own tools** - Use the weather example as a template
2. **Deploy to production** - These run anywhere Node.js runs
3. **Add observability** - Integrate logging, metrics, tracing
4. **Scale up** - Use Resonate Cloud for distributed state

The beauty of Resonate: it's just code. No special infrastructure needed.

---

**Time to first working tool: ~10 minutes** ⚡
