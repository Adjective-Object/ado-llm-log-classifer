export function formatSim(num: number): string {
    return (Math.round(num * 10000) / 10000).toFixed(2);
}

function asColor(str: any, r: number, g: number, b: number): string {
    return `\x1b[38;2;${r};${g};${b}m${str}\x1b[0m`;
}

type Color = [number, number, number];
const red: Color = [255, 0, 0];
const yellow: Color = [255, 170, 29];
const green: Color = [0, 255, 0];

export function colorRange(num: number, redCutoff: number, greenCutoff: number): [number, number, number] {
    let yellowMidpoint = (greenCutoff - redCutoff) / 2 + redCutoff;
    if (num < redCutoff) {
        return red;
    } else if (num > greenCutoff) {
        return green;
    } else if (num > yellowMidpoint) {
        // weighted average of yellow and green
        let ratio = (num - yellowMidpoint) / (greenCutoff - yellowMidpoint);
        let r = Math.round(yellow[0] * (1 - ratio) + green[0] * ratio);
        let g = Math.round(yellow[1] * (1 - ratio) + green[1] * ratio);
        let b = Math.round(yellow[2] * (1 - ratio) + green[2] * ratio);
        return [r, g, b];
    } else {
        //weighted average of red and yellow
        let ratio = (num - redCutoff) / (yellowMidpoint - redCutoff);
        let r = Math.round(red[0] * (1 - ratio) + yellow[0] * ratio);
        let g = Math.round(red[1] * (1 - ratio) + yellow[1] * ratio);
        let b = Math.round(red[2] * (1 - ratio) + yellow[2] * ratio);
        return [r, g, b];
    }
}

export function basicColorize(
    num: number
): string {
    return asColor(formatSim(num), ...colorRange(num, 0, 1));
}

export function cutoffColorize(
    minCombinedCosineSim: number,
): (value: number) => string {
    const RED_CUTOFF = minCombinedCosineSim * 0.5;
    const GREEN_CUTOFF = minCombinedCosineSim

    return function cformatSim(num: number): string {
        return asColor(formatSim(num), ...colorRange(
            num,
            RED_CUTOFF,
            GREEN_CUTOFF,
        ));
    }
}