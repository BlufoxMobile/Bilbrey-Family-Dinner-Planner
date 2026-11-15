// Test-only entry point: wraps the real Worker and swaps the Workers AI binding for a mock.
// The mock forwards each env.AI.run(model, inputs) call to the AI_BACKEND service binding, which
// the Node test process implements (see test/helpers.mjs), so tests can script AI replies and
// inspect exactly what the Worker sent to the model.
import worker, { Kitchen } from "../../src/index.js";

export { Kitchen };

export default {
  async fetch(request, env, ctx) {
    let AI;
    if (env.AI_BACKEND) {
      AI = {
        async run(model, inputs) {
          const res = await env.AI_BACKEND.fetch("http://ai.mock/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, inputs }),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(text || `AI error ${res.status}`);
          return JSON.parse(text);
        },
      };
    }
    return worker.fetch(request, { ...env, AI }, ctx);
  },
};
