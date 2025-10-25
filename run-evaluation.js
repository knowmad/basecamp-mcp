#!/usr/bin/env node

/**
 * Evaluation harness for testing the Basecamp MCP server
 *
 * This script:
 * 1. Starts the MCP server as a subprocess
 * 2. Connects to it via stdio transport
 * 3. Runs evaluation questions through an LLM using the MCP tools
 * 4. Compares answers against expected results
 *
 * Usage: ANTHROPIC_API_KEY=your_key node run-evaluation.js
 */

import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import { parseStringPromise } from "xml2js";

// Load .env file
dotenv.config();

const EVALUATIONS_FILE = "evaluations.xml";
const MCP_SERVER_COMMAND = "node";
const MCP_SERVER_ARGS = ["dist/index.js"];

async function loadEvaluations() {
  const xmlContent = fs.readFileSync(EVALUATIONS_FILE, "utf8");
  const result = await parseStringPromise(xmlContent);
  return result.evaluation.qa_pair.map((pair) => ({
    question: pair.question[0],
    expectedAnswer: pair.answer[0],
  }));
}

async function startMCPServer() {
  console.log("Starting MCP server...");

  const serverProcess = spawn(MCP_SERVER_COMMAND, MCP_SERVER_ARGS, {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
  });

  const transport = new StdioClientTransport({
    command: MCP_SERVER_COMMAND,
    args: MCP_SERVER_ARGS,
    env: process.env,
  });

  const client = new Client(
    {
      name: "evaluation-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);
  console.log("✓ Connected to MCP server\n");

  return { client, serverProcess };
}

async function askQuestionWithMCP(anthropic, mcpClient, question) {
  // Get available tools from MCP server
  const toolsResponse = await mcpClient.listTools();
  const tools = toolsResponse.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  console.log(`  Using ${tools.length} MCP tools`);

  const messages = [
    {
      role: "user",
      content: `You are an AI assistant with access to Basecamp MCP tools. Answer this question using ONLY the provided tools. Be concise and provide just the answer without explanation.\n\nQuestion: ${question}\n\nProvide ONLY the direct answer (a number, text, or status). Do not include any explanation or additional text.`,
    },
  ];

  let finalAnswer = null;
  let turnCount = 0;
  const maxTurns = 15;

  while (turnCount < maxTurns) {
    turnCount++;
    console.log(`    Turn ${turnCount}...`);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      tools,
      messages,
    });

    // Check if we got a final answer
    const textContent = response.content.find((c) => c.type === "text");
    if (response.stop_reason === "end_turn" && textContent) {
      finalAnswer = textContent.text.trim();
      break;
    }

    // Process tool uses
    const toolUses = response.content.filter((c) => c.type === "tool_use");

    if (toolUses.length === 0) {
      // No tools used and no final answer - something went wrong
      finalAnswer = textContent?.text.trim() || "ERROR: No response";
      break;
    }

    // Execute each tool
    const toolResults = [];
    for (const toolUse of toolUses) {
      console.log(
        `      → Calling ${toolUse.name} — ${JSON.stringify(toolUse.input)}`,
      );

      try {
        const result = await mcpClient.callTool({
          name: toolUse.name,
          arguments: toolUse.input,
        });

        console.log(result);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.content
            .map((c) => c.text || JSON.stringify(c))
            .join("\n"),
        });
      } catch (error) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: ${error.message}`,
          is_error: true,
        });
      }
    }

    // Add assistant response and tool results to conversation
    messages.push({
      role: "assistant",
      content: response.content,
    });

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  return finalAnswer || "ERROR: Max turns reached";
}

function normalizeAnswer(answer) {
  return String(answer)
    .toLowerCase()
    .trim()
    .replace(/[.,;!?]/g, "");
}

function checkAnswer(actual, expected) {
  const normalizedActual = normalizeAnswer(actual);
  const normalizedExpected = normalizeAnswer(expected);

  // Exact match
  if (normalizedActual === normalizedExpected) {
    return true;
  }

  // Contains match (for longer answers)
  if (
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  ) {
    return true;
  }

  return false;
}

async function runEvaluations() {
  console.log("=== Basecamp MCP Server Evaluation ===\n");

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY environment variable not set");
    process.exit(1);
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Load evaluation questions
  console.log("Loading evaluations...");
  const evaluations = await loadEvaluations();
  console.log(`✓ Loaded ${evaluations.length} evaluation questions\n`);

  // Start MCP server
  const { client: mcpClient, serverProcess } = await startMCPServer();

  const results = [];

  try {
    // Run each evaluation
    for (let i = 0; i < evaluations.length; i++) {
      const { question, expectedAnswer } = evaluations[i];

      console.log(`\n[${i + 1}/${evaluations.length}] ${question}`);
      console.log(`  Expected: ${expectedAnswer}`);

      try {
        const actualAnswer = await askQuestionWithMCP(
          anthropic,
          mcpClient,
          question,
        );
        console.log(`  Actual: ${actualAnswer}`);

        const passed = checkAnswer(actualAnswer, expectedAnswer);
        console.log(`  Result: ${passed ? "✓ PASS" : "✗ FAIL"}`);

        results.push({
          question,
          expectedAnswer,
          actualAnswer,
          passed,
        });
      } catch (error) {
        console.log(`  Error: ${error.message}`);
        console.log(`  Result: ✗ FAIL (error)`);

        results.push({
          question,
          expectedAnswer,
          actualAnswer: `ERROR: ${error.message}`,
          passed: false,
        });
      }
    }

    // Print summary
    console.log("\n\n=== Evaluation Results ===\n");
    const passCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    const passRate = ((passCount / totalCount) * 100).toFixed(1);

    console.log(`Passed: ${passCount}/${totalCount} (${passRate}%)\n`);

    console.log("Details:");
    results.forEach((result, i) => {
      const status = result.passed ? "✓" : "✗";
      console.log(`  ${status} Q${i + 1}: ${result.passed ? "PASS" : "FAIL"}`);
      if (!result.passed) {
        console.log(`      Expected: ${result.expectedAnswer}`);
        console.log(`      Got: ${result.actualAnswer}`);
      }
    });

    // Save detailed results
    fs.writeFileSync(
      "evaluation-results.json",
      JSON.stringify(results, null, 2),
    );
    console.log("\n✓ Detailed results saved to evaluation-results.json");
  } finally {
    // Cleanup
    console.log("\nShutting down MCP server...");
    serverProcess.kill();
  }

  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

runEvaluations().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
