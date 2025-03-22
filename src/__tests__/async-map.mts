import { asyncMapWithLimit } from "../async-map.mjs";

describe('async-map', () => {
    it('should map async functions with a limit', async () => {
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
        const results = await asyncMapWithLimit(items, fn, 2);
        expect(results).toEqual([2, 4, 6, 8, 10]);
    });
});