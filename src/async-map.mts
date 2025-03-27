export async function asyncMapWithLimit<T, V>(
    items: Iterable<T>,
    fn: (item: T) => Promise<V>,
    concurrentLimit = 10,
): Promise<V[]> {
    return asyncMapWithLimitIter(items[Symbol.iterator](), fn, concurrentLimit);
}

export async function asyncMapWithLimitIter<T, V>(
    items: Iterator<T> | AsyncIterator<T>,
    fn: (item: T) => Promise<V>,
    concurrentLimit = 10,
): Promise<V[]> {
    if (concurrentLimit < 1) {
        throw new Error('concurrentLimit must be 1 or more');
    }
    if (concurrentLimit == 1) {
        // if concurrentLimit is 1, just use map
        const results: V[] = [];
        let next = items.next();
        do {
            let n = (next instanceof Promise) ? await next : next;
            if (n.done) {
                break;
            }
            results.push(await fn(n.value));
        } while (next = items.next())
        return results;
    }

    const results: V[] = [];
    const errors = new Map<number, any>();

    // wait for all jobs to finish
    let sentAll = false;
    let sent = 0;
    let completed = 0;

    let checkAllDone: () => void
    let allDonePromise = new Promise<void>((resolve, reject) => {
        checkAllDone = () => {
            if (sentAll && completed == sent) {
                resolve()
            }
        }
    })

    async function dispatchJob() {
        let next = items.next();
        if (next instanceof Promise) {
            next = await next;
        }
        if (next.done) {
            sentAll = true;
            return false
        } else {
            let idx = sent
            sent++
            // dispatch the job, non-blocking
            fn(next.value).then(
                (result) => {
                    results[idx] = result;
                    completed++;
                    if (!sentAll) {
                        dispatchJob();
                    }
                    checkAllDone();
                },
                (error) => {
                    errors.set(idx, error);
                    completed++;
                    if (!sentAll) {
                        dispatchJob();
                    }
                    checkAllDone();
                }
            )
            return true
        }
    }

    // start by spawning jobs up until we reach the concurrentLimit
    for (let i = 0; i < concurrentLimit; i++) {
        if (!await dispatchJob()) {
            break
        }
    }

    await allDonePromise
    if (errors.size == 1 ) {
        throw errors.values().next().value
    } else if (errors.size > 1) {
        throw new Error(`Multiple errors:\n${Array.from(errors.values()).map(e => e.message).join("\n")}`);
    }

    return results;
}