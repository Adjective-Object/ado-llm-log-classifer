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

    type Waiter = {
        resolve: (v: [number, V]) => void;
        reject: (err: any) => void;
    }
    let waiter = {
        resolve: () => { },
        reject: () => { },
    } as Waiter;

    function startJob(i: number, item: T): Promise<void> {
        return fn(item).then(
            (item) => waiter.resolve([i, item]),
            (err) => {
                waiter.reject(err);
                throw err;
            },
        );
    }

    // start initial jobs
    let head = 0;
    for (; head < concurrentLimit; head++) {
        let next = items.next();
        if (next instanceof Promise) {
            next = await next;
        }

        if (next.done) {
            break;
        }
        startJob(head, next.value);
    }

    // wait for all jobs to finish
    let complete = 0;
    let sentAll = false;
    while (true) {
        let [index, result]: [number, V] = await new Promise((resolve, reject) => {
            waiter.resolve = function (v: [number, V]) {
                resolve(v);
            };
            waiter.reject = reject;
        });

        // save result
        results[index] = result;
        complete++;
        if (sentAll && complete >= head) {
            break;
        }

        // if all jobs are done, break
        let next = items.next();
        if (next instanceof Promise) {
            next = await next;
        }
        if (!next.done) {
            startJob(head, next.value);
            head++;
            sentAll = true;
        }
    }

    return results as V[];
}