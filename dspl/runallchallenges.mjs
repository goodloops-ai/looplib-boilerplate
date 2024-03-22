import { of, from, mergeMap } from "rxjs";
import { z } from "zod";
import { wrap, schema as base } from "./operator.mjs";
import codium from "./codium.mjs";

const runChallengesSchema = z.object({
    challenges: z.array(
        z.object({
            description: z.string(),
            name: z.string(),
            public_tests: z.array(
                z.object({
                    input: z.array(z.string()),
                    output: z.array(z.string()),
                })
            ),
        })
    ),
    runTests: z.function().args(z.any(), z.any()).returns(z.any()),
    model: z.string().optional().default("gpt-3.5-turbo"),
    temperature: z.number().optional().default(0.3),
});

const runChallengesOperator = ({
    challenges,
    runTests,
    model,
    temperature,
}) => {
    return mergeMap(({ messages, env, blackboard }) => {
        return from(challenges).pipe(
            mergeMap((challenge) => {
                const challengeConfig = {
                    challenge: {
                        description: challenge.description,
                        name: challenge.name,
                        public_tests: challenge.public_tests,
                    },
                    runTests,
                    gptOptions: {
                        model,
                        temperature,
                    },
                };

                return of({ messages, env, blackboard }).pipe(
                    codium(challengeConfig)
                );
            })
        );
    });
};

export const schema = base
    .extend({
        config: runChallengesSchema,
        input: z.object({}).optional(),
        output: z.object({}).optional(),
    })
    .describe(
        "Challenges: Run a series of challenges through the codium operator, executing tests for each."
    );

export default wrap({ operator: runChallengesOperator, schema });
