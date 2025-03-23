
// checks for a string of form
// 2024-11-01T09:14:56.5357114Z
const adoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z /;

// Checks for a string of form
// \x1b[2m[46.7129s] 

const oriLogLineRegex = /^(?:\x1b\[2m)?\[\d+\.\d+s\] /;

// Matches a string that looks like [23:34:02] 
const webpackTimestampRegex = /^\[\d+:\d+:\d+\] /g;

// Matches a full git commit hash
const gitCommitRegex = /\"(?:[0-9a-f]{40}\"|\'[0-9a-f]{40}\')/g;

// matches a string that looks like a GUID
// e.g. 0354917f-c947-433f-949d-a15c36a1b13b
const guidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// Matches a string that looks like 2024-12-05 22:06:32Z
const timestampRegex = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z/g;

// Matches a percentage string that looks like 00% or 100%
const percentRegex = /\d{1,2}%|100%/g;

function filterOriLines(line: string): boolean {
    // Check if the line is a verbose log line
    let noOri = line.replace(oriLogLineRegex, '');
    // Does the line start with one of the overly verbose garbage ori lines?
    return !(
        // throttler nonsesnse
        noOri.startsWith('throttler(') ||
        noOri.startsWith('throttler:cleaning up') ||
        // raw FS events
        (noOri.includes('oriwatcher') && (
            noOri.includes('(loop) raw event') ||
            noOri.includes('(loop) dismissing: not-tracked;') ||
            noOri.includes('no match for')
        )) ||
        // watcher directory walks
        noOri.startsWith('starting walk new directory') ||
        noOri.startsWith('finished walk new directory') ||
        noOri.startsWith('\x1b[36m(walk new directory ') ||
        noOri.startsWith('\x1b[36m(additional walks)') ||
        // tsc internal
        noOri.includes('tsc:watcher-consumer') ||
        noOri.includes('tsc:view') ||
        noOri.startsWith('tsc:lifecycle:') ||
        // tsc throughput
        noOri.startsWith('\x1b[36m(tsc) ') ||
        // MultiBuilderLoop updates
        noOri.startsWith('MultiBuilderLoop (') ||
        noOri.startsWith('sub-builder loop') ||
        !!noOri.match(/^sub-build \w+ \(/) ||
        noOri.includes('(build:workers) incremental rebuild') ||
        // Multibuilder cache updates
        noOri.startsWith('starting caching sub-build ') ||
        noOri.startsWith('finished caching sub-build ') ||
        // Cleaning up webpack progress messages
        noOri.startsWith('<s> [webpack.Progress] ') ||
        noOri.startsWith('<i> [webpack.Progress] ')
    )
}

export function cleanAdoLogLine(
    line: string,
): string | null {
    // ADO logs start with a timestamp, followed by a space, and then the log message.
    // We want to remove the timestamp and the space, so we can just split on the first space
    // and return the rest of the string.

    line = line.replace(adoDateRegex, '');
    line = line.replace(oriLogLineRegex, '');
    line = line.replace(webpackTimestampRegex, '');

    // replace git refs with <GIT_REF>
    line = line.replaceAll(gitCommitRegex, '<git-commit>');
    line = line.replaceAll(guidRegex, '<guid>');
    line = line.replaceAll(timestampRegex, '<timestamp>');
    line = line.replaceAll(percentRegex, '00%');

    return filterOriLines(line) ? line : null;
}