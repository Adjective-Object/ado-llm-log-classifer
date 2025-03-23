

export function formatSim(num: number): string {
    return (Math.round(num * 10000) / 10000).toFixed(2);
}

export function cutoffColorize(
    minCombinedCosineSim: number,
): (value: number) => string {
    // colorize the string based on the similarity

    const RED_CUTOFF = minCombinedCosineSim * 0.5;
    const GREEN_CUTOFF = minCombinedCosineSim
    const YELLOW_FRAC = 0.5;
    const YELLOW_MIDPOINT = (minCombinedCosineSim - RED_CUTOFF) * YELLOW_FRAC + RED_CUTOFF;
    type Color = [number, number, number];
    const red: Color = [255, 0, 0];
    const yellow: Color = [255, 170, 29];
    const green: Color = [0, 255, 0];

    const asColor = (str: any, r: number, g: number, b: number) => {
        return `\x1b[38;2;${r};${g};${b}m${str}\x1b[0m`;
    }

    // console.log("red-cutoff", asColor(RED_CUTOFF, ...red));
    // console.log("yellow-midpoint", asColor(YELLOW_MIDPOINT, ...yellow));
    // console.log("green-cutoff", asColor(GREEN_CUTOFF, ...green));

    return function cformatSim(num: number): string {
        let str = formatSim(num);
        let r = 0;
        let g = 0;
        let b = 0;
        if (num < RED_CUTOFF) {
            r = 255;
        } else if (num > GREEN_CUTOFF) {
            g = 255;
        } else if (num > YELLOW_MIDPOINT) {
            // weighted average of yellow and green
            let ratio = (num - YELLOW_MIDPOINT) / (GREEN_CUTOFF - YELLOW_MIDPOINT);
            r = Math.round(yellow[0] * (1 - ratio) + green[0] * ratio);
            g = Math.round(yellow[1] * (1 - ratio) + green[1] * ratio);
            b = Math.round(yellow[2] * (1 - ratio) + green[2] * ratio);
        } else {
            //weighted average of red and yellow
            let ratio = (num - RED_CUTOFF) / (YELLOW_MIDPOINT - RED_CUTOFF);
            r = Math.round(red[0] * (1 - ratio) + yellow[0] * ratio);
            g = Math.round(red[1] * (1 - ratio) + yellow[1] * ratio);
            b = Math.round(red[2] * (1 - ratio) + yellow[2] * ratio);
        }

        // add the hex color to the string
        return asColor(str, r, g, b);
    }
}