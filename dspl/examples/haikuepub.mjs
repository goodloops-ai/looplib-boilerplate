const haikuEpubFlow = {
    elements: [
        {
            type: "init",
            init: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.7,
                    },
                },
            },
        },
        {
            type: "prompt",
            mode: "json",
            content: "Write a haiku about a beautiful sunset.",
            parse: {
                haiku: "$.haiku",
            },
        },
        {
            type: "image",
            prompt: "{{await model.$.haiku}}",
            imagePath: "./dspl/test/sunset_haiku.png",
            width: 512,
            height: 512,
            samples: 1,
            steps: 50,
        },
        {
            type: "epub",
            title: "Sunset Haiku",
            author: "AI Poet",
            language: "en",
            identifier: "sunset-haiku-1",
            cover: "./dspl/test/sunset_haiku.png",
            chapters: [
                {
                    title: "Sunset Haiku",
                    content: "<p>{{await model.$.haiku}}</p>",
                },
            ],
            epubPath: "./dspl/test/sunset_haiku.epub",
        },
    ],
};

export default haikuEpubFlow;
