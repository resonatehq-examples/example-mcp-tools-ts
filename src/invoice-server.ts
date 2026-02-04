#!/usr/bin/env node
/**
 * Durable Invoice Processing MCP Server with Human-in-the-Loop
 * 
 * This demonstrates long-running workflows that wait for human approval.
 * 
 * Temporal requires:
 * - Separate Worker process
 * - Signal/Query handlers with decorators
 * - workflow.wait_condition() ceremony
 * - Complex state management
 * 
 * Resonate just needs:
 * - Regular async functions
 * - Simple state management
 * - Built-in durability
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Resonate, Context } from '@resonatehq/sdk';

// Initialize Resonate
const resonate = new Resonate();
resonate.start();

// In-memory state store for approvals (in production, use a real database)
// This is simpler than Temporal's signal/query pattern!
const approvals = new Map<string, {
  status: 'pending' | 'approved' | 'rejected' | 'processing' | 'completed';
  invoice: Invoice;
  result?: string;
}>();

interface InvoiceLine {
  item: string;
  amount: number;
  description: string;
}

interface Invoice {
  id: string;
  lines: InvoiceLine[];
  totalAmount: number;
}

/**
 * Durable payment processing function
 * In production, this would call Stripe, PayPal, etc.
 */
async function processPayment(
  ctx: Context,
  line: InvoiceLine
): Promise<string> {
  // Simulate payment processing
  console.log(`Processing payment: ${line.item} - $${line.amount}`);
  
  // In a real system, you'd call a payment gateway here
  // If it fails, Resonate automatically retries!
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return `Processed payment for ${line.item}: $${line.amount}`;
}

// Register the payment function
const durableProcessPayment = resonate.register('processPayment', processPayment);

/**
 * Main invoice processing workflow
 * 
 * This workflow:
 * 1. Waits for human approval (with timeout)
 * 2. Processes payments if approved
 * 3. Maintains state throughout
 * 
 * Notice: No @workflow.defn, no special imports, no Workers!
 */
async function processInvoice(
  ctx: Context,
  invoice: Invoice
): Promise<string> {
  const invoiceId = invoice.id;
  
  // Update status
  const state = approvals.get(invoiceId);
  if (state) {
    state.status = 'pending';
  }

  // Wait for approval with timeout (5 minutes for demo, would be days in production)
  const timeout = 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();
  const pollInterval = 1000; // Check every second

  while (Date.now() - startTime < timeout) {
    const currentState = approvals.get(invoiceId);
    
    if (currentState?.status === 'approved') {
      break;
    }
    
    if (currentState?.status === 'rejected') {
      return 'REJECTED by user';
    }
    
    // Durable sleep - if process crashes, we resume here!
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  const finalState = approvals.get(invoiceId);
  
  // Auto-reject on timeout
  if (finalState?.status === 'pending') {
    if (finalState) {
      finalState.status = 'rejected';
    }
    return 'REJECTED due to timeout';
  }

  // Process payments if approved
  if (finalState?.status === 'approved' && finalState) {
    finalState.status = 'processing';
    
    const results: string[] = [];
    
    // Process each line item with durability
    for (const line of invoice.lines) {
      const result = await ctx.run(processPayment, line);
      results.push(result);
    }

    finalState.status = 'completed';
    finalState.result = results.join('\n');
    
    return `COMPLETED\n${results.join('\n')}`;
  }

  return 'REJECTED';
}

// Register the invoice processing function
const durableProcessInvoice = resonate.register('processInvoice', processInvoice);

/**
 * MCP Server Setup
 */
const server = new Server(
  {
    name: 'resonate-invoice',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'submit_invoice',
        description: 'Submit an invoice for processing. The invoice will wait for human approval before processing payments. Automatically handles failures, retries, and maintains state across crashes.',
        inputSchema: {
          type: 'object',
          properties: {
            invoice_id: {
              type: 'string',
              description: 'Unique identifier for this invoice',
            },
            lines: {
              type: 'array',
              description: 'Invoice line items',
              items: {
                type: 'object',
                properties: {
                  item: { type: 'string' },
                  amount: { type: 'number' },
                  description: { type: 'string' },
                },
                required: ['item', 'amount', 'description'],
              },
            },
          },
          required: ['invoice_id', 'lines'],
        },
      },
      {
        name: 'approve_invoice',
        description: 'Approve a pending invoice for payment processing',
        inputSchema: {
          type: 'object',
          properties: {
            invoice_id: {
              type: 'string',
              description: 'ID of the invoice to approve',
            },
          },
          required: ['invoice_id'],
        },
      },
      {
        name: 'reject_invoice',
        description: 'Reject a pending invoice',
        inputSchema: {
          type: 'object',
          properties: {
            invoice_id: {
              type: 'string',
              description: 'ID of the invoice to reject',
            },
          },
          required: ['invoice_id'],
        },
      },
      {
        name: 'check_invoice_status',
        description: 'Check the current status of an invoice',
        inputSchema: {
          type: 'object',
          properties: {
            invoice_id: {
              type: 'string',
              description: 'ID of the invoice to check',
            },
          },
          required: ['invoice_id'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'submit_invoice') {
    const { invoice_id, lines } = args as {
      invoice_id: string;
      lines: InvoiceLine[];
    };

    const totalAmount = lines.reduce((sum, line) => sum + line.amount, 0);
    const invoice: Invoice = {
      id: invoice_id,
      lines,
      totalAmount,
    };

    // Store in pending state
    approvals.set(invoice_id, {
      status: 'pending',
      invoice,
    });

    // Start the durable workflow (non-blocking)
    // This runs in the background and survives process crashes!
    durableProcessInvoice(`invoice-${invoice_id}`, invoice).then(result => {
      const state = approvals.get(invoice_id);
      if (state) {
        state.result = result;
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: `Invoice ${invoice_id} submitted for approval. Total: $${totalAmount}\nUse approve_invoice or reject_invoice to respond.`,
        },
      ],
    };
  }

  if (name === 'approve_invoice') {
    const { invoice_id } = args as { invoice_id: string };
    const state = approvals.get(invoice_id);

    if (!state) {
      throw new Error(`Invoice ${invoice_id} not found`);
    }

    if (state.status !== 'pending') {
      throw new Error(`Invoice ${invoice_id} is not pending (status: ${state.status})`);
    }

    state.status = 'approved';

    return {
      content: [
        {
          type: 'text',
          text: `Invoice ${invoice_id} approved! Processing payments...`,
        },
      ],
    };
  }

  if (name === 'reject_invoice') {
    const { invoice_id } = args as { invoice_id: string };
    const state = approvals.get(invoice_id);

    if (!state) {
      throw new Error(`Invoice ${invoice_id} not found`);
    }

    if (state.status !== 'pending') {
      throw new Error(`Invoice ${invoice_id} is not pending (status: ${state.status})`);
    }

    state.status = 'rejected';

    return {
      content: [
        {
          type: 'text',
          text: `Invoice ${invoice_id} rejected.`,
        },
      ],
    };
  }

  if (name === 'check_invoice_status') {
    const { invoice_id } = args as { invoice_id: string };
    const state = approvals.get(invoice_id);

    if (!state) {
      throw new Error(`Invoice ${invoice_id} not found`);
    }

    let statusText = `Invoice ${invoice_id}:\n`;
    statusText += `Status: ${state.status}\n`;
    statusText += `Total Amount: $${state.invoice.totalAmount}\n`;
    
    if (state.result) {
      statusText += `\nResult:\n${state.result}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: statusText,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start the MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Resonate Invoice MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
