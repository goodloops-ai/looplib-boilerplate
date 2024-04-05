const haikuEpubFlow = {
    elements: [
        {
            type: "init",
            init: {
                $: {
                    prompt: {
                        model: "claude-3-opus-20240229",
                        temperature: 0.7,
                    },
                },
            },
        },
        {
            type: "prompt",
            content: "Write a haiku about a beautiful sunset.",
            set: "haiku",
            parse: {
                haiku: (response) => response.trim(),
            },
        },
        {
            type: "image",
            prompt: "{{haiku}}",
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
                    content: "<p>{{haiku}}</p>",
                },
            ],
            epubPath: "./dspl/test/sunset_haiku.epub",
        },
    ],
};

export default haikuEpubFlow;
