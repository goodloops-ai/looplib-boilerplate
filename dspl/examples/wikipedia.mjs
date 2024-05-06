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
            url: "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access/2024/04/25",
            json: true,
            hide: true,
            parse: {
                "$.pages": (response) => {
                    console.log(response);
                    return response.items[0].articles
                        .filter(
                            (a) =>
                                [
                                    "Main_Page",
                                    "Special:Search",
                                    "Wikipedia:Featured_pictures",
                                    "Portal:Current_events",
                                ].indexOf(a.article) === -1
                        )
                        .map((a) => ({
                            url: `https://wikipedia.org/wiki/${a.article}`,
                        }))
                        .slice(0, 100);
                },
            },
        },
        {
            type: "do",
            for: {
                each: "page",
                in: "$.pages",
            },
            dspl: {
                elements: [
                    {
                        type: "readability",
                        url: "{{await model.page.url}}",
                        hide: true,
                        parse: {
                            "page.text": (response) => {
                                console.log("Response:", response);
                                return response.textContent
                                    .replace(
                                        "From Wikipedia, the free encyclopedia",
                                        ""
                                    )
                                    .replace(/wikipedia/gm, "REDACTED")
                                    .replace(/Wikipedia/gm, "REDACTED")
                                    .trim();
                            },
                        },
                    },
                    {
                        type: "prompt",
                        mode: "json",
                        content:
                            "Count the number of violations of wikipedias neutral point of view policy in this text. For each violation, provide a severity score from 1 to 5 with an explanation, sum them in the score field of your output: {{await model.page.text}}",
                        parse: {
                            "page.grade": (response) => response,
                        },
                    },
                ],
            },
        },
        {
            type: "message",
            role: "system",
            content: ({ pages }) =>
                pages.map(({ url, grade }) => ({ url, grade })),
        },
    ],
};
