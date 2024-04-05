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
            guards: [
                {
                    type: "llm",
                    filter: "Is the poem a 10/10?",
                    recovery_prompt: "Improve the poem",
                    retries: 3,
                },
            ],
        },
    ],
};

export default sonnet;
