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
                "give me an array of animals, one for each letter of the alphabet, each starting with the letter of the alphabet it corresponds to. put it in the 'animals' key in your response, with each object having a 'letter' and 'animal' property",
            parse: {
                animals: "$.animals",
            },
        },
        {
            type: "do",
            for: {
                each: "animal",
                in: "animals",
                concurrency: 10,
            },
            dspl: {
                elements: [
                    {
                        type: "prompt",
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
