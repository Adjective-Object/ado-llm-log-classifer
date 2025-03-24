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
    let complete = 0;
    let initialErr: any = null;
    let waiter = {
        resolve: ([i, item]) => { results[i] = item; complete++; },
        reject: (err) => { initialErr = err },
    } as Waiter;

    function startJob(i: number, item: T): Promise<void> {
        // console.log('start job', i, item);
        return fn(item).then(
            (item) => waiter.resolve([i, item]),
            (err) => {
                waiter.reject(err);
                throw err;
            },
        );
    }

    // wait for all jobs to finish
    let sentAll = false;
    let head = 0;
    while (!sentAll || complete < head) {
        // replace the waiter so we can continue when the next promise resolves
        let continuationPromise = new Promise<void>((resolve, reject) => {
            let resolved = false;
            waiter = {
                resolve: ([index, value]) => {
                    if (!resolved) {
                        resolve();
                    }
                    results[index] = value;
                    complete++;
                },
                reject: (err) => {
                    initialErr = err;
                    reject(err);
                },
            }
        });

        // launch new jobs until there are concurrentLimit jobs running
        while (!sentAll && (head - complete) < concurrentLimit) {
            let idx = head;
            let next = items.next();
            if (next instanceof Promise) {
                next = await next;
            }
            if (next.done) {
                sentAll = true;
                // console.log('sent all');
                break;
            } else {
                head++
            }
            startJob(idx, next.value);
        }

        // wait for continuationPromise to mark resolution
        // console.log('continuationPromise', head, complete);
        await continuationPromise;
    }

    return results as V[];
}