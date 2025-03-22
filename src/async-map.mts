export async function asyncMapWithLimit<T, V>(
    items: T[],
    fn: (item: T) => Promise<V>,
    concurrentLimit = 10,
): Promise<V[]> {
    const results: (null | V)[] = [];
    for (let i = 0; i < concurrentLimit; i++) {
        results.push(null);
    }

    type Waiter = {
        resolve: (v: [number, V]) => void;
        reject: (err: any) => void;
    }
    let waiter = {
        resolve: () => { },
        reject: () => { },
    } as Waiter;

    function startJob(i: number): Promise<void> {
        if (i >= items.length) {
            throw new Error("out of bound index");
        }
        const item = items[i];
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
    for (head = 0; head < Math.min(concurrentLimit, items.length); head++) {
        startJob(head);
    }

    // wait for all jobs to finish
    let complete = 0;
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

        // if all jobs are done, break
        if (complete >= items.length) {
            break;
        }

        // start next job, if available
        if (head < items.length) {
            startJob(head);
            head++;
        }
    }

    return results as V[];
}