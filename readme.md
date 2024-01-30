
## Via Bash
```
$ export OPENAI_API_KEY="sk-..."
$ deno run -A demo.mjs
```
## Via Docker
```
$ export OPENAI_API_KEY="sk-..."
$ docker build -t my-deno-app .
$ docker run -e OPENAI_API_KEY=$OPENAI_API_KEY my-deno-app
```