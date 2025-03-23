import { cleanAdoLogLine } from "../clean-ado-log.js";

describe('clean-ado-log', () => {
    it('cleans ugly ori logs', () => {
        let log = `2024-11-19T18:56:05.7157649Z [2m[4.4697s] throttler:cleaning up CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-app-header/src/updateNotificationsBadge.locstring.d.json.ts[22m
2024-11-19T18:56:05.7158066Z [2m[4.4701s] throttler:cleaning up CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccCommandBar.locstring.d.json.ts[22m
2024-11-19T18:56:05.7219264Z [2m[4.4764s] throttler:cleaning up CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccListHeader.locstring.d.json.ts[22m
2024-11-19T18:56:05.7242273Z [2m[4.4786s] [2moriwatcher:[2m(loop) raw event CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccOutageMessageBar.locstring.d.json.ts[22m[22m[22m
2024-11-19T18:56:05.7243269Z [2m[4.4787s] throttler(source-watcher):processing CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccOutageMessageBar.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7246471Z [2m[4.4787s] throttler(source-watcher):emitted CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccOutageMessageBar.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7252567Z [2m[4.4797s] throttler:cleaning up CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccMessageBar.locstring.d.json.ts[22m
2024-11-19T18:56:05.7276755Z [2m[4.4821s] [2moriwatcher:[2m(loop) raw event CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccPivot.locstring.d.json.ts[22m[22m[22m
2024-11-19T18:56:05.7277935Z [2m[4.4822s] throttler(source-watcher):processing CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccPivot.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7278927Z [2m[4.4822s] throttler(source-watcher):emitted CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccPivot.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7313756Z [2m[4.4858s] [2moriwatcher:[2m(loop) raw event CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccTabList.locstring.d.json.ts[22m[22m[22m
2024-11-19T18:56:05.7328844Z [2m[4.4864s] throttler(source-watcher):processing CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccTabList.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7330327Z [2m[4.4864s] throttler(source-watcher):emitted CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccTabList.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7351206Z [2m[4.4894s] [2moriwatcher:[2m(loop) raw event CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/EventTile.locstring.d.json.ts[22m[22m[22m
2024-11-19T18:56:05.7352022Z [2m[4.4894s] throttler(source-watcher):processing CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/EventTile.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7354460Z [2m[4.4894s] throttler(source-watcher):emitted CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/EventTile.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7355526Z [2m[4.4895s] throttler:cleaning up CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccOutageMessageBar.locstring.d.json.ts[22m
2024-11-19T18:56:05.7380018Z [2m[4.4923s] [2moriwatcher:[2m(loop) raw event CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-diverse-reactions/src/AddReactionButton.locstring.d.json.ts[22m[22m[22m
2024-11-19T18:56:05.7381086Z [2m[4.4924s] throttler(source-watcher):processing CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-diverse-reactions/src/AddReactionButton.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7382013Z [2m[4.4924s] throttler(source-watcher):emitted CREATE:/mnt/vss/_work/1/s/packages/accelerator/accelerator-diverse-reactions/src/AddReactionButton.locstring.d.json.ts @ 1732042565[22m
2024-11-19T18:56:05.7382778Z [2m[4.4924s] throttler:cleaning up CREATE on /mnt/vss/_work/1/s/packages/accelerator/accelerator-common/src/AccPivot.locstring.d.json.ts[22m
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.81617.js generate SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.81617.js generated SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.43720.js generate SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.43720.js generated SourceMap
<i> [webpack.Progress]  |  |  | 159 ms SourceMapDevToolPlugin > owa.43720.js
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.23188.css generate SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.23188.css generated SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.23188.js generate SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.23188.js generated SourceMap
<i> [webpack.Progress]  |  |  | 71 ms SourceMapDevToolPlugin > owa.23188.js
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.87951.css generate SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.87951.css generated SourceMap
<s> [webpack.Progress] 92% sealing asset processing SourceMapDevToolPlugin owa.87951.js generate SourceMap
`
        let cleaned = log.split('\n').map(cleanAdoLogLine).filter(line => typeof line === 'string').join('\n');
        expect(cleaned).toEqual('');
    });
});