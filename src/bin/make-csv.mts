import * as path from 'node:path';
import ora from 'ora';
import fs from 'node:fs';
import { parseArgs, type ArgDescriptors } from '../args.mjs';
import { ClustersDir as ClusterDir, EmbedDir, LogDir } from '../LogDir.mjs';
import { basicColorize } from '../colorize-similarity.mjs';
import { asyncMapWithLimit, asyncMapWithLimitIter } from '../async-map.mjs';
import { matchBestCluster } from '../cluster.mjs';
import { time } from 'node:console';


type Args = {
    help?: string;
    outBaseDir: string;
};
const argDescriptors: ArgDescriptors<Args> = {
    help: {
        shortName: 'h',
        helpDescription: 'Print this help message',
    },
    outBaseDir: {
        shortName: 'o',
        helpDescription: 'The base directory to save the output files',
        default: "./out",
    },
};

async function main() {
    // Parse arguments
    const args = await parseArgs(
        "make-csv",
        argDescriptors,
        (args: Partial<Args>) => path.join(args.outBaseDir ?? "out", "make-csv-args.json"),
    );
    if (args == null) {
        return;
    }

    // load all the clusters
    let embedDir = new EmbedDir(args.outBaseDir);
    let clusterDir = new ClusterDir(args.outBaseDir);
    let logDir = new LogDir(args.outBaseDir);

    const clusters = await clusterDir.loadAll(embedDir);
    console.log(`Loaded ${clusters.size} clusters from disk`);

    // iterate through all the embeds and find the best cluster for each one
    let totalJobs = await embedDir.getTotalJobEmbeddingCount();
    let i = 0;
    let spinner = ora(`(0/${totalJobs}) Finding best cluster for each embedding`).start();
    let advanceSpinner = (msg: string) => {
        i++;
        spinner.stopAndPersist({
            text: `(${i}/${totalJobs}) ${msg}`,
        });
        spinner = ora(`(${i}/${totalJobs}) Finding best cluster for each embedding`).start();
    };
    let maxClusterNameLength = Math.max(...Array.from(clusters.values()).map((c) => c.name.length));
    let buildAssocs = await asyncMapWithLimitIter(
        embedDir.listAllBuildJobEmbeddings(),
        async (jobRef): Promise<null | [number, string]> => {
            if (jobRef == null) {
                return null;
            }
            let jobEmbeddings = await embedDir.loadBuildJobEmbeddings(jobRef.buildId, jobRef.jobId);
            if (jobEmbeddings == null) {
                advanceSpinner(`No embeddings found for ${jobRef.buildId}-${jobRef.jobId}`);
                return null;
            }
            let clusterMatch = matchBestCluster(clusters, jobEmbeddings);
            let cluster = clusterMatch ? clusters.get(clusterMatch.bestClusterName) : null;
            if (cluster == null) {
                advanceSpinner(`No cluster found for ${jobRef.buildId}-${jobRef.jobId} (${clusterMatch?.bestClusterName})`);
                return null;
            }

            let clusterSim = cluster.getSimilarity(jobEmbeddings);
            let jobIdStr = `${jobRef.buildId}-${jobRef.jobId}`;
            advanceSpinner(
                `${jobIdStr.padEnd(12)} matches cluster ${cluster.name} ${' '.repeat(maxClusterNameLength - cluster.name.length)}` +
                `combo: ${basicColorize(clusterSim.combined)}\tissues: ${basicColorize(clusterSim.issuesSimilarity)}\tlog: ${basicColorize(clusterSim.logSimilarity)}`
            );

            return [jobRef.buildId, cluster.name]
        }
    )
    spinner.stopAndPersist({
        text: `Done finding best cluster for each embedding`,
    });
    // convert the list of build associations to a map of sets
    let buildAssocsMap = new Map<number, Set<string>>();
    for (let [buildId, clusterName] of buildAssocs.filter((x): x is [number, string] => x != null)) {
        if (!buildAssocsMap.has(buildId)) {
            buildAssocsMap.set(buildId, new Set());
        }
        buildAssocsMap.get(buildId)?.add(clusterName);
    }

    // open the output CSV file
    let outCsvPath = path.join(args.outBaseDir, "out.csv");
    console.log(`Writing output csv to ${outCsvPath}`);
    let outCsv = await fs.promises.open(outCsvPath, 'w');
    await outCsv.write("buildId,time,failureReasons,\n");
    let allClusterNames = new Set<string>();
    for (let cluster of clusters.values()) {
        allClusterNames.add(cluster.name);
    }

    // Map of date strings to maps of cluster names to counts
    let dayBins = new Map<string, Map<string, number>>();

    i = 0;
    let buildIds = await logDir.listBuilds();
    spinner = ora(`(${i.toString().padStart(Math.log10(buildIds.length))}/${buildIds.length}) Reading CSVs & writing build logs`).start();
    // now, load all the builds so we can get their build times, as well as the IDs of the non-failing builds.
    await asyncMapWithLimit(
        buildIds,
        async (buildId: number) => {
            i++;
            let build = await logDir.loadBuild(buildId);
            if (build == null) {
                advanceSpinner(`No build found for ${buildId}`);
                return null;
            }

            let buildTime = build.startTime! || new Date(0);
            let clusterNames = buildAssocsMap.get(buildId);
            let clusterNamesStr = clusterNames ? Array.from(clusterNames).sort().join("+") : 'success';

            outCsv.write(`${buildId},${buildTime.getTime() / 1000},${clusterNamesStr}\n`);

            // bin the build by day
            let dayStr = buildTime.toISOString().split("T")[0];
            if (!dayBins.has(dayStr)) {
                dayBins.set(dayStr, new Map());
            }
            let dayBin = dayBins.get(dayStr)!;
            for (let clusterName of clusterNames ?? []) {
                if (!dayBin.has(clusterName)) {
                    dayBin.set(clusterName, 0);
                }
                dayBin.set(clusterName, dayBin.get(clusterName)! + 1);
            }
            if (!dayBin.has("_total")) {
                dayBin.set("_total", 0);
            }
            dayBin.set("_total", dayBin.get("_total")! + 1);

            spinner.text = `(${i.toString().padStart(Math.log10(buildIds.length))}/${buildIds.length}) Reading CSVs & writing build logs`
        }
    )

    await outCsv.close();
    await spinner.stopAndPersist({
        text: `Wrote CSV to ${outCsvPath}`,
    });
    spinner = ora(`Writing day-binned CSV`).start();

    // now, write out the day-binned CSV
    let dayBinCsvPath = path.join(args.outBaseDir, "day-binned.csv");
    let dayBinCsv = await fs.promises.open(dayBinCsvPath, 'w');
    let clusterNamesSorted = ["_total"].concat(Array.from(allClusterNames).sort());
    await dayBinCsv.write("date," + clusterNamesSorted.join(",") + "\n");
    for (let [dayStr, dayBin] of dayBins) {
        let line = [dayStr];
        for (let clusterName of clusterNamesSorted) {
            line.push((dayBin.get(clusterName) ?? 0).toString());
        }
        await dayBinCsv.write(line.join(",") + "\n");
    }
    await dayBinCsv.close();
    await spinner.stopAndPersist({
        text: `Wrote day-binned CSV to ${dayBinCsvPath}`,
    });
}

main().then(() => {
    console.log("done");
}, (err) => {
    console.error(err);
    console.error(err.stack);
    process.exit(1);
});