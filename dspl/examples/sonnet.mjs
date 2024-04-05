const sonnet = {
    elements: [
        {
            type: "init",
            init: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.3,
                    },
                },
            },
        },
        {
            type: "prompt",
            content: "write a sonnet about the moon",
            set: "sonnet",
            retries: 3,
            guards: [
                {
                    type: "llm",
                    filter: "Is the poem a 10/10?",
                    policy: "append",
                },
            ],
        },
    ],
};

export default sonnet;
