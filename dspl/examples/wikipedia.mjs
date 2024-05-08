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
            type: "fetch",
            url: "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access/2023/04/26",
            json: true,
            hide: true,
            parse: {
                "$.articles": (data) => {
                    console.log(data);
                    return data.items[0].articles
                        .filter(
                            (article) =>
                                !["Main_Page", "Special:Search"].includes(
                                    article.article
                                )
                        )
                        .slice(0, 1)
                        .map((article) => ({
                            ...article,
                            url: `https://en.wikipedia.org/wiki/${article.article}`,
                        }));
                },
            },
        },
        {
            type: "do",
            for: {
                each: "article",
                in: "$.articles",
            },
            dspl: {
                elements: [
                    {
                        type: "readability",
                        url: "{{await model.article.url}}",
                        hide: true,
                        parse: {
                            "article.textContent": (data) =>
                                data.textContent
                                    .replace("Wikipedia", "REDACTED")
                                    .replace("wikipedia", "REDACTED"),
                        },
                    },
                    {
                        type: "prompt",
                        mode: "json",
                        content: `please evaluate the following text for conformance to wikipedias neutral point of view policy:
\`\`\`
{{await model.article.textContent}}
\`\`\`

provide a list of violations and a severity rating between 1 and 5, where 1 is a minor issue and 5 is a major issue.
put the violations in an array, and put a total score in the variable "score"`,
                        set: "article.violations",
                    },
                ],
            },
        },
    ],
};
