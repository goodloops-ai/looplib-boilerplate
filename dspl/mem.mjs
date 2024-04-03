import _ from "https://esm.sh/lodash";
import moize from "https://esm.sh/moize";

const memoize = moize({
    isPromise: true,
    isDeepEqual: true,
    // onCacheAdd: (key, value) => {
    //     console.log("cache add", key, value);
    // },
    // onCacheHit: (key, value) => {
    //     console.log("cache hit", key, value);
    // },
    matchesKey: (key, cacheKey) => {
        return _.isEqual(key, cacheKey);
    },
});

export const importJson = async (pathOrObj, def = {}) => {
    const obj =
        typeof pathOrObj === "string"
            ? JSON.parse(await Deno.readTextFile(pathOrObj))
            : pathOrObj;

    console.log("importJson", obj, def);
    if (Array.isArray(obj)) {
        return obj.map((item) => mem({ ...item, ...def }));
    } else if (typeof obj === "object") {
        return mem({ ...def, ...obj });
    } else {
        throw new Error("Invalid JSON object");
    }
};

async function resolve(obj) {
    // Check if obj is a promise and await it if so
    if (typeof obj !== "object" || obj.then) return await obj;

    // If obj is an array, map over it and resolve each element
    if (Array.isArray(obj)) {
        return Promise.all(obj.map(async (item) => await resolve(item)));
    }

    if (obj._mem) return resolve(obj._obj);

    // If obj is an object, resolve each property
    const ret = {};
    for (const [key, value] of Object.entries(obj)) {
        ret[key] = await resolve(value);
    }
    return ret;
}
export function mem(def) {
    const deps = {};
    const memoizers = Object.entries(def)
        .filter(
            ([key, value]) =>
                (!key.startsWith("[") && typeof value === "function") ||
                typeof value.get === "function"
        )
        .reduce((acc, [key, value]) => {
            const base = value.get || value;

            // parse the base function toString and get all descructured properties in the function signature
            const args = base
                .toString()
                .match(/\s*\(\s*{\s*([^}]+)}\s*\)/)[1]
                .split(",")
                .map((arg) => arg.trim())
                .filter((arg) => arg);

            deps[key] = args;

            const ensuredAsync = async (obj) => {
                obj = await resolve(obj);
                return await base(obj);
            };

            acc[key] = memoize(ensuredAsync);
            return acc;
        }, {});

    let obj = {
        ...def,
        ...Object.entries(memoizers).reduce((acc, [key, value]) => {
            acc[key] = undefined;
            return acc;
        }, {}),
    };

    const resolveDeps = (arg, key, seen = new Set()) => {
        if (seen.has(key)) return;
        seen.add(key);
        if (!memoizers[key]) return;
        const _deps = deps[key];
        if (_deps) {
            for (const dep of _deps) {
                resolveDeps(arg, dep);
            }
        }

        const actualArgs = _deps.reduce((acc, dep) => {
            acc[dep] = arg[dep];
            return acc;
        }, {});

        arg[key] = memoizers[key](actualArgs);
        return arg;
    };

    const handler = {
        set(target, key, value, receiver) {
            let partial = {};
            if (typeof def[key]?.set === "function") {
                partial = def[key].set(obj, value);
            } else {
                partial[key] = value;
            }
            obj = Object.assign(obj, partial);

            // obj = fn(obj);
            return true;
        },
        get(target, key, receiver) {
            // console.log("get", key, obj);
            if (key === "_mem") return true;
            if (key === "_obj") return resolve(obj);

            if (obj[key]?._mem) return obj[key];
            console.log("get", key);
            if (memoizers[key]) {
                obj = resolveDeps(obj, key);
                return obj[key];
            }
            return obj[key];
        },
    };

    return new Proxy({}, handler);
}

// const person = mem({
//   firstName: 'John',
//   lastName: 'Doe',
//   age: 30,

//   get fullName({ firstName, lastName }) {
//     return `${firstName} ${lastName}`;
//   },

//   set fullName({ firstName, lastName }, value) {
//     [firstName, lastName] = value.split(' ');
//     return { firstName, lastName };
//   },
// });
