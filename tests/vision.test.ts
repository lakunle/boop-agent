import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describeImage } from "../server/vision.js";

async function withEnv<T>(
  overrides: Record<string, string | null>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("describeImage sends correct request shape and parses cost", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test" }, async () => {
    const calls: Array<{ url: string; body: any; headers: any }> = [];
    const captureFetch: typeof fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")),
        headers: init?.headers,
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "A green square on a white background." } }],
          model: "gpt-4o-2024-08-06",
          usage: { prompt_tokens: 1200, completion_tokens: 12, total_tokens: 1212 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const png = readFileSync("tests/fixtures/sample.png");
    const result = await describeImage(png, "image/png", {
      promptHint: "a small icon",
      deps: { fetch: captureFetch },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(calls[0].body.model, "gpt-4o");
    assert.ok(Array.isArray(calls[0].body.messages));
    const userMsg = calls[0].body.messages.find((m: any) => m.role === "user");
    assert.ok(userMsg, "should have user message");
    const imageBlock = userMsg.content.find((b: any) => b.type === "image_url");
    assert.ok(imageBlock, "should include image_url block");
    assert.match(imageBlock.image_url.url, /^data:image\/png;base64,/);
    // Prompt hint flows into the user text block
    const textBlock = userMsg.content.find((b: any) => b.type === "text");
    assert.match(textBlock.text, /a small icon/);

    assert.equal(result.description, "A green square on a white background.");
    // Cost: 1200 input @ $2.50/M + 12 output @ $10/M = $0.003 + $0.00012 ≈ $0.00312
    assert.ok(Math.abs(result.costUsd - 0.00312) < 0.0001, `costUsd=${result.costUsd}`);
    assert.equal(result.model, "gpt-4o");
  });
});

test("describeImage uses BOOP_VISION_MODEL override", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test", BOOP_VISION_MODEL: "gpt-4o-mini" }, async () => {
    const calls: any[] = [];
    const f: typeof fetch = (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    await describeImage(Buffer.from([0]), "image/png", { deps: { fetch: f } });
    assert.equal(calls[0].model, "gpt-4o-mini");
  });
});

test("describeImage throws on auth error with informative message", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-bad" }, async () => {
    const f: typeof fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), {
        status: 401,
      })) as typeof fetch;
    await assert.rejects(
      describeImage(Buffer.from([0]), "image/png", { deps: { fetch: f } }),
      /401|Incorrect API key/i,
    );
  });
});

test("describeImage throws when OPENAI_API_KEY is unset", async () => {
  await withEnv({ OPENAI_API_KEY: null }, async () => {
    await assert.rejects(
      describeImage(Buffer.from([0]), "image/png"),
      /OPENAI_API_KEY/,
    );
  });
});
