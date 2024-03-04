import { map, pipe } from "rxjs";
import { operableFrom } from "looplib";
console.log("start");
export function get(query, hidden = false) {
    return map(function (trigger) {
        // console.log("GET", trigger.get(query), trigger.payload);
        const res = trigger.get(query);
        if (!res) {
            return;
        }
        return { result: res, hidden };
    });
}

function find(query) {
    return map(function (trigger) {
        return trigger.find(query);
    });
}

function findOne(query) {
    return map(function (trigger) {
        return trigger.findOne(query);
    });
}

export function not(fn) {
    return pipe(
        fn,
        map((res) => !res)
    );
}

export function passThrough(trigger) {
    return trigger;
}

export function conditional(conditions) {
    const input$ = operableFrom(passThrough);

    Object.entries(conditions).forEach(([key, value]) => {
        input$[key] = operableFrom(value);
        input$.pipe(input$[key]);
    });

    return input$;
}

export function maxLoops(max, bail$) {
    return guard(lessThan(max), bail$);
}

function lessThan(count) {
    return function (trigger) {
        // console.log("lessThan", trigger.find(this), this, count);
        return trigger.find(this).length < count;
    };
}

function guard(condition, bail$) {
    return function (trigger) {
        condition = condition.bind(this);
        const res = condition(trigger);
        return res || bail$.next(trigger);
    };
}
