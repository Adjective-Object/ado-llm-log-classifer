import * as path from 'node:path';
import ora from 'ora';
import { parseArgs, type ArgDescriptors } from '../args.mjs';
import { ClustersDir as ClusterDir, EmbedDir } from '../LogDir.mjs';
import { basicColorize } from '../colorize-similarity.mjs';
import { asyncMapWithLimitIter } from '../async-map.mjs';
import { matchBestCluster } from '../cluster.mjs';


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

    const clusters = await clusterDir.loadAll(embedDir);
    console.log(`Loaded ${clusters.size} clusters from disk`);

    // iterate through all the embeds and find the best cluster for each one
    let totalJobs = embedDir.getTotalJobEmbeddingCount();
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
    asyncMapWithLimitIter(
        embedDir.listAllBuildJobEmbeddings(),
        async (jobRef) => {
            if (jobRef == null) {
                return;
            }
            let jobEmbeddings = await embedDir.loadBuildJobEmbeddings(jobRef.buildId, jobRef.jobId);
            if (jobEmbeddings == null) {
                advanceSpinner(`No embeddings found for ${jobRef.buildId}-${jobRef.jobId}`);
                return;
            }
            let clusterMatch = matchBestCluster(clusters, jobEmbeddings);
            let cluster = clusterMatch ? clusters.get(clusterMatch.bestClusterName) : null;
            if (cluster == null) {
                advanceSpinner(`No cluster found for ${jobRef.buildId}-${jobRef.jobId} (${clusterMatch?.bestClusterName})`);
                return;
            }

            let clusterSim = cluster.getSimilarity(jobEmbeddings);
            advanceSpinner(
                `${jobRef.buildId}-${jobRef.jobId} matches cluster ${cluster.name}:${' '.repeat(maxClusterNameLength - cluster.name.length)}` +
                `combo: ${basicColorize(clusterSim.combined)}\tissues: ${basicColorize(clusterSim.issuesSimilarity)}\tlog: ${basicColorize(clusterSim.logSimilarity)}`
            );
        }
    )

}