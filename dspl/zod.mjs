import { register } from "zod-metadata";
import { z } from "https://deno.land/x/zod/mod.ts";

register(z);

const schema = z
    .object({
        username: z.string().refine(
            async (value) => {
                // Simulating an async validation by delaying the response
                await new Promise((resolve) => setTimeout(resolve, 1000));
                console.log("Validating username:", value);
                console.log(schema.getMeta());
                return value.length >= 3;
            },
            () => ({
                message: `Username must be at least 3 characters long. ${
                    schema.getMeta().description
                }`,
            })
        ),
        email: z.string().transform(async (value) => {
            // Simulating an async transformation by delaying the response
            await new Promise((resolve) => setTimeout(resolve, 500));
            return value.toLowerCase();
        }),
    })
    .catch(async (error) => {
        // Simulating an async error handling by delaying the response
        await new Promise((resolve) => setTimeout(resolve, 1500));
        console.error("Caught error:", error.error);
        return { username: "default_user", email: "default@example.com" };
    })
    .describe("description 1")
    .describe("description 2")
    .meta({
        description: "A schema for validating and transforming user data",
    });

async function runSmokeTest() {
    try {
        const result = await schema.parseAsync({
            username: "jo",
            email: "John@example.com",
        });
        console.log("Validation passed:", result);
    } catch (error) {
        console.error("Validation failed:", error);
    }
}

runSmokeTest();
