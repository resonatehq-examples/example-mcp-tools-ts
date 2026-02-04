#!/usr/bin/env node
/**
 * Durable Weather MCP Server with Resonate
 * 
 * This example demonstrates how to build MCP tools with automatic retries,
 * state management, and durability using Resonate - with FAR less complexity
 * than Temporal.
 * 
 * Key differences from Temporal:
 * - No separate server infrastructure needed
 * - No worker processes to manage
 * - No task queues to configure
 * - Simple function decorators instead of complex workflow patterns
 * - All in one process - just run and go!
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Resonate, Context } from '@resonatehq/sdk';

// Initialize Resonate - that's it! No servers, no workers, no task queues
const resonate = new Resonate();

// Start Resonate (connects to local or remote store)
resonate.start();

// National Weather Service API base URL
const NWS_API_BASE = 'https://api.weather.gov';

/**
 * Durable function to fetch from NWS API
 * 
 * With Resonate, ANY function can be durable by registering it
 * No need for special @activity.defn decorators or Activity classes!
 */
async function fetchNWS(ctx: Context, url: string): Promise<any> {
  const headers = {
    'User-Agent': 'resonate-weather-mcp/1.0',
    'Accept': 'application/geo+json'
  };

  const response = await fetch(url, { 
    headers,
    signal: AbortSignal.timeout(5000) 
  });

  if (!response.ok) {
    throw new Error(`NWS API error: ${response.status}`);
  }

  return response.json();
}

// Register the fetch function with Resonate
const durableFetchNWS = resonate.register('fetchNWS', fetchNWS);

/**
 * Main weather forecast workflow
 * 
 * This is our "workflow" - but notice:
 * - No @workflow.defn decorator
 * - No special import patterns
 * - No workflow.execute_activity() ceremony
 * - Just regular async/await!
 */
async function getForecast(
  ctx: Context, 
  latitude: number, 
  longitude: number
): Promise<string> {
  try {
    // Step 1: Get the forecast endpoint
    // Call the registered durable function
    const pointsUrl = `${NWS_API_BASE}/points/${latitude},${longitude}`;
    const pointsData = await ctx.run(fetchNWS, pointsUrl);

    if (!pointsData) {
      return 'Unable to fetch forecast data for this location.';
    }

    // Step 2: Optional delay (durable sleep - survives crashes!)
    // Unlike Temporal's workflow.sleep(), this is just a regular async operation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Get the actual forecast
    const forecastUrl = pointsData.properties.forecast;
    const forecastData = await ctx.run(fetchNWS, forecastUrl);

    if (!forecastData) {
      return 'Unable to fetch detailed forecast.';
    }

    // Step 4: Format the results
    const periods = forecastData.properties.periods.slice(0, 5);
    const forecasts = periods.map((period: any) => `
${period.name}:
Temperature: ${period.temperature}°${period.temperatureUnit}
Wind: ${period.windSpeed} ${period.windDirection}
Forecast: ${period.detailedForecast}
    `.trim());

    return forecasts.join('\n\n---\n\n');
  } catch (error) {
    console.error('Weather forecast error:', error);
    throw error;
  }
}

// Register the main forecast function
const durableGetForecast = resonate.register('getForecast', getForecast);

/**
 * MCP Server Setup
 */
const server = new Server(
  {
    name: 'resonate-weather',
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
        name: 'get_forecast',
        description: 'Get weather forecast for a location. Automatically retries on failure, maintains state across crashes, and handles API timeouts gracefully.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude of the location',
            },
            longitude: {
              type: 'number',
              description: 'Longitude of the location',
            },
          },
          required: ['latitude', 'longitude'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_forecast') {
    const { latitude, longitude } = request.params.arguments as {
      latitude: number;
      longitude: number;
    };

    // Create a unique execution ID for this forecast request
    const executionId = `${latitude}-${longitude}-${Date.now()}`;
    
    // Run the durable workflow using the registered function
    // This ENTIRE operation is now durable - if anything fails, Resonate
    // automatically retries with exponential backoff. No retry policy config needed!
    const result = await durableGetForecast(executionId, latitude, longitude);

    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Start the MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Resonate Weather MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
