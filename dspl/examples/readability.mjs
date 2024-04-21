export default {
    elements: [
        {
            type: "init",
            init: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.5,
                    },
                },
            },
        },
        {
            type: "readability",
            url: "https://example.com",
        },
        {
            type: "prompt",
            content: "please summarize the text content of the page",
        },
    ],
};
