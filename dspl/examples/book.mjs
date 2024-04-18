const bookWritingFlow = {
    elements: [
        {
            type: "init",
            init: {
                $: {
                    prompt: {
                        model: "gpt-4-0125-preview",
                        temperature: 0.7,
                        max_tokens: 4000,
                    },
                },
                writingStyle: "In the style of Christopher Hitchens",
                bookDescription: "The heretics guide to AI safety",
                numChapters: 5,
                chapters: "5 object with an index number",
                bookTitle: "",
                coverImagePath: "./dspl/test/cover.png",
                bookFilePath: "./dspl/test/book.txt",
                epubFilePath: "./dspl/test/book.epub",
            },
        },
        {
            type: "prompt",
            mode: "json",
            content: `Create a detailed plot outline for a {{await model.$.numChapters}}-chapter book in the {{await model.$.writingStyle}} style, based on the following description:
{{await model.$.bookDescription}}
Each chapter should be at least 10 pages long.

organize your outline by chapter, with a brief description of the events that will take place in each chapter. put it in the 'chapters' key of your response and make sure each chapter has an 'index'`,
            parse: {
                chapters: "$.chapters",
            },
        },
        {
            type: "do",
            for: {
                each: "chapter",
                in: "chapters",
            },
            history: "append",
            dspl: {
                elements: [
                    {
                        type: "prompt",
                        mode: "json",
                        content:
                            "Write chapter {{await model.item.index}} of the book, ensuring it follows the plot outline and builds upon the previous chapters (if any). put it in the 'chapterText' key of your response.",
                        max_tokens: 4000,
                        set: "chapter",
                        parse: {
                            chapterText: "item.chapterText",
                        },
                    },
                    {
                        type: "prompt",
                        mode: "json",
                        content:
                            "Generate a concise and engaging title for this chapter based on its content. Respond with the title in the 'chapterTitle' key of your response.",
                        set: "chapterTitle",
                        parse: {
                            chapterTitle: "item.chapterTitle",
                        },
                    },
                ],
            },
        },
        {
            type: "prompt",
            mode: "json",
            content: `Here is the plot for the book: {{await model.$.plotOutline}}
                Respond with a great title for this book in the 'bookTitle' key of your response.`,
            set: "bookTitle",
            parse: {
                bookTitle: "$.bookTitle",
            },
        },
        {
            type: "prompt",
            mode: "json",
            content:
                "Describe the cover we should create, based on the plot. put it in the 'coverPrompt' key of your response. This should be two sentences long, maximum.",
            parse: {
                coverPrompt: "$.coverPrompt",
            },
        },
        {
            type: "image",
            prompt: "{{await model.$.coverPrompt}}",
            imagePath: "{{await model.$.coverImagePath}}",
            width: 512,
            height: 768,
            samples: 1,
            steps: 30,
        },
        {
            type: "epub",
            title: "{{await model.$.bookTitle}}",
            author: "AI",
            language: "en",
            identifier: "ai-generated-book-1",
            cover: "{{await model.$.coverImagePath}}",
            chapters: ({ chapters }) =>
                chapters.map((chapter, index) => ({
                    title: chapter.chapterTitle,
                    content: `<p>${chapter.chapterText
                        .split("\n")
                        .join("</p><p>")}</p>`,
                })),
            epubPath: "{{await model.$.epubFilePath}}",
        },
        {
            type: "message",
            role: "assistant",
            content:
                "Book generated successfully!\nBook Title: {{await model.$.bookTitle}}\nBook saved as: {{await model.$.bookFilePath}}\nEPUB file generated: {{await model.$.epubFilePath}}",
        },
    ],
};

export default bookWritingFlow;
