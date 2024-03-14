import { load } from "https://deno.land/std@0.214.0/dotenv/mod.ts";
import flowgen from "./flowgen.mjs";

await load({ export: true });

const env = {
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
    model: "gpt-4-0125-preview",
    temperature: 0.3,
    max_tokens: 4000,
    onContent: ({ chunk }) =>
        Deno.stdout.write(new TextEncoder().encode(chunk)),
};

const src = Deno.readTextFileSync(Deno.args[0]);

const result = await flowgen.execute(
    {
        config: {
            flowFile: Deno.args[0],
            description: src,
        },
    },
    {
        env,
    }
);

console.log("result", result.blackboard.flow);

if (Deno.args[1]) {
    Deno.writeTextFileSync(Deno.args[1], result.blackboard.flow);
    Deno.writeTextFileSync(
        Deno.args[1] + ".example.mjs",
        result.blackboard.example
    );
    console.log("wrote to", Deno.args[1]);
} else {
    console.log("Flow:");
    console.log(result.blackboard.flow);
    console.log("Example:");
    console.log(result.blackboard.example);
}
