
// checks for a string of form
// 2024-11-01T09:14:56.5357114Z
const adoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z /;

// Checks for a string of form
// \x1b[2m[46.7129s] 
const oriLogLineRegex = /^\x1b\[2m\[\d+\.\d+s\] /;

function removeVerboseOriLines(line: string): boolean {
    // Check if the line is a verbose log line
    let noOri = line.replace(oriLogLineRegex, '');
    // Does the line start with one of the overly verbose garbage ori lines?
    return !(
        // throttler nonsesnse
        noOri.startsWith('throttler(') ||
        noOri.startsWith('throttler:cleaning up') ||
        // raw FS events
        noOri.includes('(loop) raw event') ||
        // tsc internal
        noOri.includes('tsc:watcher-consumer') ||
        noOri.includes('tsc:view') ||
        // tsc throughput
        noOri.startsWith('\x1b[36m(tsc) ')
    )
}

export function cleanAdoLog(
    log: string,
): string {
    // ADO logs start with a timestamp, followed by a space, and then the log message.
    // We want to remove the timestamp and the space, so we can just split on the first space
    // and return the rest of the string.
    let lines = log.split('\n');
    let cleanedLines = lines.map(line => {
        let firstSpace = line.indexOf(' ');
        if (firstSpace === -1) {
            return line;
        }
        // check that the first segment is a timestamp, and strip it if so
        line = line.replace(adoDateRegex, '');
        line = line.replace(oriLogLineRegex, '');
        return line;
    })
        .filter(removeVerboseOriLines)
    return cleanedLines.join('\n');
}