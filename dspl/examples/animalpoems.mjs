const poemdspl = {
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
            mode: "json",
            content:
                "give me a list of animals, one for each letter of the alphabet, each starting with the letter of the alphabet it corresponds to.",
            set: "animals",
        },
        {
            type: "do",
            for: {
                each: "animal",
                in: "animals",
            },
            dspl: {
                elements: [
                    {
                        type: "prompt",
                        mode: "json",
                        content:
                            "write me a short children's book poem about {{await model.item.animal}}",
                        set: "poem",
                    },
                ],
            },
        },
    ],
};

export default poemdspl;
