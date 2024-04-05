const smartgpt = {
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
                userPrompt:
                    "What are the potential long-term impacts of artificial intelligence on society and the economy?",
            },
        },
        {
            type: "prompt",
            n: 3,
            content:
                "You are a researcher tasked with providing a comprehensive response to the following user prompt: {{userPrompt}}. Please break down your response into key points, considering various aspects such as technological advancements, societal implications, ethical considerations, and economic consequences. Provide a well-structured, in-depth analysis.",
        },
        {
            type: "prompt",
            content:
                "Acting as an impartial reviewer, carefully examine the {{history.length}} responses provided. Analyze the strengths and weaknesses of each response, considering factors such as thoroughness, clarity, objectivity, and relevance to the original question. Provide a comparative assessment and rank the responses from best to worst, explaining your reasoning.",
        },
        {
            type: "prompt",
            content:
                "Based on the reviewer's feedback, select the most comprehensive and insightful response from the options provided. Refine and expand upon this chosen response, addressing any shortcomings identified by the reviewer and incorporating the best elements from the other responses as appropriate. The goal is to produce a definitive, well-rounded answer to the original question: {{userQuestion}}",
            set: "aiAnswer",
        },
    ],
};

export default smartgpt;
