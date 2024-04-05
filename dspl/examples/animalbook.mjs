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
            content:
                "Create a detailed plot outline for a {{await model.$.numChapters}}-chapter book in the {{await model.$.writingStyle}} style, based on the following description:\n\n{{await model.$.bookDescription}}\n\nEach chapter should be at least 10 pages long.",
            set: "plotOutline",
        },
        {
            type: "for",
            each: "chapter",
            in: "chapters",
            do: [
                {
                    type: "prompt",
                    content:
                        "Write chapter {{await model.item.index}} of the book, ensuring it follows the plot outline and builds upon the previous chapters (if any).",
                    max_tokens: 4000,
                    set: "chapter",
                    parse: {
                        chapter: (response) => {
                            const chapter = response
                                .replace(/^Here.*:\n/, "")
                                .trim();
                            return `<p>${chapter.replace(
                                /\n/g,
                                "</p><p>"
                            )}</p>`;
                        },
                    },
                },
                {
                    type: "prompt",
                    content:
                        "Chapter Content:\n\n{{chapter}}\n\n--\n\nGenerate a concise and engaging title for this chapter based on its content. Respond with the title only, nothing else.",
                    set: "chapterTitle",
                    parse: {
                        chapterTitle: (response) => response.trim(),
                    },
                },
            ],
        },
        {
            type: "prompt",
            content:
                "Here is the plot for the book: {{plotOutline}}\n\n--\n\nRespond with a great title for this book. Only respond with the title, nothing else is allowed.",
            set: "bookTitle",
            parse: {
                bookTitle: (response) => response.trim(),
            },
        },
        {
            type: "prompt",
            content:
                "Plot: {{plotOutline}}\n\n--\n\nDescribe the cover we should create, based on the plot. This should be two sentences long, maximum.",
            set: "coverPrompt",
        },
        {
            type: "image",
            prompt: "{{coverPrompt}}",
            imagePath: "{{coverImagePath}}",
            width: 512,
            height: 768,
            samples: 1,
            steps: 30,
        },
        {
            type: "epub",
            title: "{{bookTitle}}",
            author: "AI",
            language: "en",
            identifier: "ai-generated-book-1",
            cover: "{{coverImagePath}}",
            chapters: ({ chapters }) =>
                chapters.map((chapter, index) => ({
                    title: chapter.chapterTitle,
                    content: `<p>${chapter.chapter}</p>`,
                })),
            epubPath: "{{epubFilePath}}",
        },
        {
            type: "message",
            role: "assistant",
            content:
                "Book generated successfully!\nBook Title: {{bookTitle}}\nBook saved as: {{bookFilePath}}\nEPUB file generated: {{epubFilePath}}",
        },
    ],
};

export default bookWritingFlow;
