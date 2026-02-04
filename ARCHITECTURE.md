# Architecture Comparison

## Temporal's Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Desktop                          │
│                    (MCP Client built-in)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ MCP Protocol (stdio)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCP Server                              │
│                     (weather.py)                             │
│                                                              │
│  - Receives MCP tool calls                                  │
│  - Connects to Temporal Client                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ gRPC (localhost:7233)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Temporal Server                            │
│                 (temporal server start-dev)                  │
│                                                              │
│  - Event History Store                                       │
│  - Task Queue Management                                     │
│  - State Persistence                                         │
│  - Scheduling & Timers                                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ gRPC Polling
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Worker Process                            │
│                    (worker.py)                               │
│                                                              │
│  - Polls Task Queue                                          │
│  - Executes Workflows (workflow.py)                          │
│  - Executes Activities (activities.py)                       │
│  - Reports results back to Temporal                          │
└─────────────────────────────────────────────────────────────┘

Components: 3 processes
Network hops: 2 (MCP→Temporal, Temporal→Worker)
Files: 4 (weather.py, worker.py, workflow.py, activities.py)
Infrastructure: Temporal Server (with embedded database)
```

### Data Flow (Temporal)

1. **User asks Claude for weather**
   - Claude Desktop → MCP Server (weather.py)

2. **MCP Server starts workflow**
   - weather.py → Temporal Client → Temporal Server
   - Creates Workflow Execution
   - Workflow placed in Task Queue

3. **Worker picks up workflow**
   - Worker polls Task Queue
   - Receives Workflow task
   - Begins executing GetForecast workflow

4. **Workflow executes activities**
   - Workflow code calls `workflow.execute_activity()`
   - Activity task placed in Task Queue
   - Worker polls and picks up Activity task
   - Executes `make_nws_request()`
   - Result stored in Temporal history

5. **Workflow completes**
   - Final result stored in Temporal
   - Worker notifies Temporal Server
   - Temporal Server notifies MCP Server
   - MCP Server returns to Claude

**Total round trips:** 6+ gRPC calls

---

## Resonate's Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Desktop                          │
│                    (MCP Client built-in)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ MCP Protocol (stdio)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 MCP Server + Resonate                        │
│                  (weather-server.ts)                         │
│                                                              │
│  ┌──────────────────────────────────────────────┐          │
│  │         Resonate SDK (embedded)              │          │
│  │                                              │          │
│  │  - Function Registration                    │          │
│  │  - Durable Execution                        │          │
│  │  - State Management                         │          │
│  │  - Automatic Retries                        │          │
│  │  - Event History                            │          │
│  └──────────────────────────────────────────────┘          │
│                                                              │
│  Your Code:                                                  │
│  - fetchNWS() - fetch weather data                          │
│  - getForecast() - orchestrate calls                        │
│  - MCP handlers - receive tool calls                        │
└─────────────────────────────────────────────────────────────┘

Components: 1 process
Network hops: 0 (local function calls)
Files: 1 (weather-server.ts)
Infrastructure: None (Resonate SDK embedded)
```

### Data Flow (Resonate)

1. **User asks Claude for weather**
   - Claude Desktop → MCP Server (weather-server.ts)

2. **MCP handler calls registered function**
   - `durableGetForecast(id, lat, lon)`
   - Resonate SDK checks if this execution ID exists
   - If new, starts execution

3. **Function executes with durability**
   - Calls `ctx.run(fetchNWS, url)`
   - Resonate SDK:
     - Logs invocation
     - Executes function
     - Stores result
     - If failure: auto-retry with backoff

4. **Result returned**
   - Function completes
   - Result returned to MCP handler
   - MCP handler returns to Claude

**Total round trips:** 1 (just the MCP call)

---

## Key Architectural Differences

### State Management

**Temporal:**
```
Event History → Temporal Server DB
                       ↓
             Worker reads history
                       ↓
             Workflow replays
                       ↓
             State reconstructed
```

**Resonate:**
```
Function calls → Resonate SDK → Local/Remote Store
                                        ↓
                              State immediately available
```

### Retry Logic

**Temporal:**
```
Activity fails → Event in history → Worker notified
                                          ↓
                               Task requeued in Temporal
                                          ↓
                              Worker polls and retries
```

**Resonate:**
```
Function fails → Resonate SDK → Automatic retry
                                       ↓
                            Exponential backoff
```

### Adding a New Function

**Temporal:**
```
1. Define activity (activities.py)
2. Import in workflow (special pattern)
3. Register in worker (worker.py)
4. Restart worker
5. Call from workflow
```

**Resonate:**
```
1. Write function
2. resonate.register('name', func)
3. Call it: ctx.run(func, args)
```

---

## Operational Complexity

### Temporal Production Deployment

```
┌─────────────┐
│  Load       │
│  Balancer   │
└──────┬──────┘
       │
   ┌───┴────┬─────────┬─────────┐
   │        │         │         │
   ▼        ▼         ▼         ▼
┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐
│Temp │  │Temp │  │Temp │  │Temp │
│ Srvr│  │ Srvr│  │ Srvr│  │ Srvr│
└──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘
   │        │         │         │
   └────────┴────┬────┴─────────┘
                 │
         ┌───────┴────────┐
         │                │
         ▼                ▼
   ┌──────────┐    ┌──────────┐
   │PostgreSQL│    │Elastic-  │
   │ Cluster  │    │ search   │
   └──────────┘    └──────────┘

   ┌─────────────────────────────┐
   │      Worker Cluster         │
   │  ┌────┐ ┌────┐ ┌────┐      │
   │  │Wkr │ │Wkr │ │Wkr │ ...  │
   │  └────┘ └────┘ └────┘      │
   └─────────────────────────────┘

   ┌─────────────────────────────┐
   │     MCP Server Cluster      │
   │  ┌────┐ ┌────┐ ┌────┐      │
   │  │MCP │ │MCP │ │MCP │ ...  │
   │  └────┘ └────┘ └────┘      │
   └─────────────────────────────┘
```

**Components to manage:**
- Temporal Server cluster
- PostgreSQL database cluster  
- Elasticsearch cluster (for visibility)
- Worker deployment/auto-scaling
- MCP server deployment/auto-scaling
- Load balancers
- Monitoring & alerting
- Log aggregation

**Required expertise:**
- Kubernetes/container orchestration
- Database administration
- Search cluster management
- Distributed systems debugging
- gRPC networking
- Multi-service tracing

### Resonate Production Deployment

```
┌─────────────┐
│  Load       │
│  Balancer   │
└──────┬──────┘
       │
   ┌───┴────┬─────────┬─────────┐
   │        │         │         │
   ▼        ▼         ▼         ▼
┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐
│ MCP │  │ MCP │  │ MCP │  │ MCP │
│     │  │     │  │     │  │     │
│ +   │  │ +   │  │ +   │  │ +   │
│     │  │     │  │     │  │     │
│Reson│  │Reson│  │Reson│  │Reson│
└──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘
   │        │         │         │
   └────────┴────┬────┴─────────┘
                 │
                 ▼
        ┌────────────────┐
        │ Resonate Store │
        │  (Optional)    │
        └────────────────┘
```

**Components to manage:**
- MCP server deployment
- Optional: Resonate store (or use local)
- Load balancer
- Monitoring & alerting

**Required expertise:**
- Standard web deployment
- Optional: Database management
- Basic monitoring

---

## Failure Scenarios

### API Timeout During Call

**Temporal:**
1. Activity timeout detected
2. Event written to history
3. Activity marked for retry
4. Worker picks up retry task
5. Activity executes again
6. Success → workflow continues

**Resonate:**
1. Function call times out
2. Resonate SDK auto-retries
3. Success → continues

### Process Crashes Mid-Execution

**Temporal:**
1. Worker crashes
2. Temporal Server detects via heartbeat
3. Task rescheduled
4. New worker picks up task
5. Workflow replays from history
6. Resumes from last completed activity

**Resonate:**
1. Process crashes
2. Process restarts
3. Resonate SDK checks pending executions
4. Resumes from last stored state
5. Continues execution

---

## Performance Characteristics

### Latency

| Operation | Temporal | Resonate |
|-----------|----------|----------|
| Start execution | 20-50ms | 1-5ms |
| Activity call | 10-30ms | <1ms |
| State read | 10-20ms | <1ms |
| Workflow complete | 30-60ms | 5-10ms |

*Temporal has network overhead; Resonate is in-process*

### Throughput

| Metric | Temporal | Resonate |
|--------|----------|----------|
| Executions/sec | 100-1000s | 1000-10000s |
| Limited by | gRPC + DB | CPU + Store |

### Resource Usage (Single Tool)

| Resource | Temporal | Resonate |
|----------|----------|----------|
| Memory | ~600MB (all) | ~50MB |
| CPU (idle) | Low × 3 | Low × 1 |
| Network | Internal gRPC | None |
| Disk | ~100MB (logs) | Minimal |

---

## Code Organization

### Temporal Structure
```
durable-mcp-tutorial/
├── activities.py         # Activity definitions
├── workflow.py           # Workflow definitions
├── worker.py            # Worker setup
├── weather.py           # MCP server
└── requirements.txt     # Dependencies
```

**Execution flow spans all files**

### Resonate Structure
```
example-mcp-tools-ts/
├── src/
│   ├── weather-server.ts    # Everything in one file
│   └── invoice-server.ts    # Another complete tool
├── package.json
└── tsconfig.json
```

**Each file is complete and self-contained**

---

## The Simplicity Advantage

**Temporal:**
- Multi-process architecture → more to manage
- Network communication → latency & complexity
- Distributed state → consistency challenges
- Separate worker → deployment complexity

**Resonate:**
- Single process → simple to run
- In-process calls → fast & reliable
- Embedded SDK → just works
- Self-contained → easy deployment

**Result:** Same durability guarantees, 1/10th the complexity.

---

## Mental Model

### Temporal

> "Workflows orchestrate Activities through a central server. Workers execute tasks by polling queues. State is managed through event history replay."

**Concepts to understand:** 7+ (Workflow, Activity, Worker, Task Queue, Client, Event History, Replay)

### Resonate

> "Register your functions. Call them. They're durable."

**Concepts to understand:** 1 (resonate.register)

---

**The best architecture is the one you don't have to think about.**
