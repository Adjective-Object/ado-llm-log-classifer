import { asyncMapWithLimit, asyncMapWithLimitIter } from "../async-map.mjs";

describe('async-map', () => {
    it('should map async functions with a limit', async () => {
        const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
            11, 12, 13, 14, 15, 16, 17, 18, 19, 20
        ];
        const fn = async (item: number) => {
            return new Promise<number>((resolve) => {
                // Simulate async work that may not complete in order.
                //
                // TODO: don't use timeout here because it makes the test slower
                setTimeout(() => {
                    resolve(item * 2);
                }, Math.random() * 2);
            });
        };
        const results = await asyncMapWithLimit(items, fn, 2);
        expect(results).toEqual([
            2, 4, 6, 8, 10, 12, 14, 16, 18, 20,
            22, 24, 26, 28, 30, 32, 34, 36, 38, 40
        ]);
    });


    it('should map async functions with limit=1', async () => {
        const items = [1, 2, 3, 4, 5];
        const fn = async (item: number) => {
            return new Promise<number>((resolve) => {
                // Simulate async work that may not complete in order.
                //
                // TODO: don't use timeout here because it makes the test slower
                setTimeout(() => {
                    resolve(item * 2);
                }, Math.random() * 2);
            });
        };
        const results = await asyncMapWithLimit(items, fn, 1);
        expect(results).toEqual([2, 4, 6, 8, 10]);
    });
    
    it('should map empty list', async () => {
        let resut = await asyncMapWithLimit([], async (item) => item, 1);
        expect(resut).toEqual([]);
    });

    it('should map empty async generator', async () => {
        async function* emptyAsyncGenerator() {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        let resut = await asyncMapWithLimitIter(emptyAsyncGenerator(), async (item) => item, 1);
        expect(resut).toEqual([]);
    })
});