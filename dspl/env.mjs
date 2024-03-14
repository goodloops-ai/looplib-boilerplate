import { map, of } from "rxjs";

export function env(newEnv) {
    return map(({ messages, blackboard, env }) => ({
        messages,
        blackboard,
        env: {
            ...env,
            ...newEnv,
        },
    }));
}

export function start({ blackboard = {}, messages = [], env = {} } = {}) {
    return of({ blackboard, messages, env });
}
