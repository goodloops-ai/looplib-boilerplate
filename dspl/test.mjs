export const operator = ({
    timestamp = new Date().toISOString(),
    nonce = Math.floor(Math.random() * 1000),
    concurrency = 1,
    serial = true,
}) =>
    pipe(
        mergeMap(async function ({ blackboard, messages, env }) {
            // ... rest of the original code remains the same

            // At the end of the function, where you return the results,
            // include the blackboard, messages, and env in the return object
            return {
                blackboard,
                messages: [
                    ...messages,
                    {
                        type: "eval_results",
                        name: challenge.name,
                        tries,
                        ...total_results,
                    },
                ],
                env,
            };
        }, concurrency)
    );
