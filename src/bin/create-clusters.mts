import * as path from 'node:path';
import { parseArgs, type ArgDescriptors } from '../args.mjs';
import { ClustersDir as ClusterDir, EmbedDir, LogDir } from '../LogDir.mjs';
import input from "@inquirer/input";
import prompts from 'prompts'

import { Cluster, ClusterDescriptor, CombinedSimilarity } from '../cluster.mjs';
import ora from 'ora';
import color from 'cli-color';


type Args = {
    help?: string;
    outBaseDir: string;
    minCombinedCosineSim: string;
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
    minCombinedCosineSim: {
        shortName: 'i',
        helpDescription: 'The minimum cosine similarity to consider a log part of an existing category',
        default: "0.9",
    },
};

async function loadCluster(
    embedDir: EmbedDir,
    descriptor: ClusterDescriptor,
): Promise<Cluster> {
    return new Cluster(
        descriptor.name,
        await Promise.all(descriptor.referenceJobs.map(async (jobRef) => {
            let jobEmbedding = await embedDir.loadBuildJobEmbeddings(jobRef.buildId, jobRef.jobId);
            if (!jobEmbedding) {
                throw new Error(`Could not load job embedding for build:${jobRef.buildId}-job:${jobRef.jobId} referenced by cluster ${descriptor.name}. Did you forget to compute embeddings first?`);
            }
            return jobEmbedding;
        }))
    )
}

function formatSim(num: number): string {
    return (Math.round(num * 10000) / 10000).toFixed(2);
}

async function main() {
    // Parse arguments
    const args = await parseArgs(
        "create-clusters",
        argDescriptors,
        (args: Partial<Args>) => path.join(args.outBaseDir ?? "out", "create-clusters-args.json"),
    );
    if (args == null) {
        return;
    }

    let minCombinedCosineSim = parseFloat(args.minCombinedCosineSim);
    if (isNaN(minCombinedCosineSim)) {
        console.error(`Invalid minimum combined cosine similarity: ${args.minCombinedCosineSim}`);
        return;
    }
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

    function cformatSim(num: number): string {
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
        str = `\x1b[38;2;${r};${g};${b}m${str}\x1b[0m`;
        return str
    }

    // Create the output directory
    let embedDir = new EmbedDir(args.outBaseDir);
    let logDir = new LogDir(args.outBaseDir);
    let clusterDir = new ClusterDir(args.outBaseDir);

    let clusters = new Map<string, Cluster>();
    let clusterNames = await clusterDir.listClusters();
    await Promise.all(clusterNames.map(async (clusterName) => {
        let clusterDesc = await clusterDir.loadClusterDescriptor(clusterName);
        if (clusterDesc == null) {
            console.warn(`Could not load cluster descriptor for cluster ${clusterName}, is it malformed on disk?`);
            return
        }
        // load the cluster from disk
        clusters.set(clusterName, await loadCluster(embedDir, clusterDesc));
    }));

    console.log(`Loaded ${clusters.size} clusters from disk`);
    if (clusters.size > 0) {
        console.log(`Clusters:`);
        for (let [clusterName, cluster] of clusters) {
            console.log(`  ${color.blue(clusterName)}:`);
            console.log(`    reference job${(cluster.referenceJobs.length > 1) ? "s" : ""
                }:`, cluster.referenceJobs.map(job => `${job.buildId}-${job.jobId}`).join(", "));
            console.log(`    self-similarity: ${cformatSim(cluster.getSelfSimilarity())}`);
        }
    }

    console.log();

    // go through all the embeddings in the embed dir
    let jobTotal = await embedDir.getTotalJobEmbeddingCount();
    let jobCt = 0;
    let bestIncorrectGuess = 0;
    let worstCorrectGuess = 0;

    for await (let jobRef of embedDir.listAllBuildJobEmbeddings()) {
        jobCt++;
        // If this is one of the reference jobs, skip it
        if (Array.from(clusters.values()).some(
            cluster => cluster.referenceJobs.some(
                refJob => refJob.buildId === jobRef.buildId && refJob.jobId === jobRef.jobId))) {
            console.log(`Skipping reference job ${jobRef.buildId}-${jobRef.jobId}`);
            continue
        }

        let embedding = await embedDir.loadBuildJobEmbeddings(jobRef.buildId, jobRef.jobId);
        if (!embedding) {
            throw new Error(`Could not load job embedding for build:${jobRef.buildId}-job:${jobRef.jobId}`);
        }

        // computer the similarity to each cluster
        let clusterSimilarities = new Map<string, CombinedSimilarity>();
        let bestCluster: string | null = null;
        let spinner = ora(`Computing similarity for job ${jobRef.buildId}-${jobRef.jobId}`).start();
        for (let [clusterName, cluster] of clusters) {
            let similarity = cluster.getSimilarity(embedding);
            clusterSimilarities.set(clusterName, similarity);
            if (bestCluster == null || similarity.combined > clusterSimilarities.get(bestCluster)!.combined) {
                bestCluster = clusterName;
            }
        }
        spinner.succeed(`=== [${jobCt}/${jobTotal}] Job ${jobRef.buildId}-${jobRef.jobId} ===`);
        let addClusterName: string | null = null;

        // Print the similarities to existing clusters
        let sortedClusterSimilarities = Array.from(clusterSimilarities.entries()).sort((a, b) => b[1].combined - a[1].combined);
        if (clusterSimilarities.size > 0) {
            console.log(`\n  ${color.bold("Similarities")}:`);
            let maxClusterLen = Math.max(...sortedClusterSimilarities.map(([clusterName]) => clusterName.length));

            for (let [clusterName, similarity] of sortedClusterSimilarities) {
                const isBestCluster = clusterName == bestCluster && similarity.combined >= minCombinedCosineSim;
                console.log(`    ${isBestCluster ? color.cyan(clusterName) : color.blue(clusterName)}:${' '.repeat(maxClusterLen - clusterName.length)
                    }\tcombo: ${cformatSim(similarity.combined)
                    }\tissues: ${cformatSim(similarity.issuesSimilarity)}\tlogs: ${cformatSim(similarity.logSimilarity)} `);
            }
        }

        // Print information on this line
        const jobRaw = await embedDir.loadBuildJobRaw(jobRef.buildId, jobRef.jobId);
        if (jobRaw?.issues?.length && jobRaw.issues.length > 0) {
            console.log(`\n  ${color.bold("Issues")}:\n${jobRaw.issues.map(issue => `    - ${issue.trim()}`).join("\n")}`);
        }
        const logPath = (jobRaw?.logId) ? logDir.getPathForBuildLog(jobRef.buildId, jobRaw.logId) : "<none>";
        console.log(`\n  ${color.bold("Log")}: ${logPath}`);
        if (jobRaw?.logId) {
            let logCleanPath = embedDir.getCleanLogForBuildJob(jobRef.buildId, jobRef.jobId);
            console.log(`  ${color.bold("Log (cleaned)")}: ${logCleanPath}`);
        }

        // clear a line
        console.log()

        if (bestCluster == null) {
            addClusterName = await input({
                message: "Name for first cluster:",
            });
        } else {
            let bestSimilarity = clusterSimilarities.get(bestCluster);
            if (bestSimilarity == null) {
                throw new Error(`Internal error: cluster ${bestCluster} not found in cluster similarities?`);
            }

            const choices = sortedClusterSimilarities.map(
                ([clusterName,]) => ({ title: clusterName })
            );
            const getSuggestions = (input: string) =>
                input
                    ? choices.filter(({ title }) => title.toLowerCase().startsWith(input.toLowerCase()))
                    : choices;

            if (bestSimilarity.combined < minCombinedCosineSim) {
                console.log(color.yellow(`This is less than the minimum required similarity ${cformatSim(bestSimilarity.combined)} < ${cformatSim(minCombinedCosineSim)}`));
                console.log("Choose a cluster to add this job to, or create a new one:")
                do {
                    const promptResult = await prompts(
                        {
                            type: 'autocomplete',
                            name: 'cluster',
                            message: 'Add this job to an existing cluster or create a new one',
                            choices: choices,
                            suggest: (input: string) => Promise.resolve(getSuggestions(input)),
                            onState: function (this: { input: string; value: string; fallback: string }) {
                                // If there are no suggestions, update the value to match the input, and unset the fallback
                                // (this.suggestions may be out of date if the user pasted text ending with a newline, so re-calculate)
                                if (!getSuggestions(this.input).length) {
                                    this.value = this.input;
                                    this.fallback = '';
                                }
                            },
                        }
                    );
                    if (!promptResult.cluster) {
                        console.log("No cluster selected, exiting");
                        return;
                    } else {
                        addClusterName = promptResult.cluster.trim();
                    }
                } while (!addClusterName || addClusterName.length === 0);
            }
        }

        if (addClusterName) {
            // if the cluster already exists, add this job to it
            let cluster = clusters.get(addClusterName);
            if (cluster == null) {
                // create a new cluster
                cluster = new Cluster(addClusterName, []);
                clusters.set(addClusterName, cluster);
            }
            // add the job to the cluster
            cluster.addReferenceJob(embedding);
            console.log(`Added job ${jobRef.buildId}-${jobRef.jobId} to cluster ${addClusterName}`);

            // save the cluster descriptor to disk
            let clusterDesc = await clusterDir.saveClusterDescriptor(cluster.getDescriptor());
        }
    }
}

main().then(
    () => {
        process.exit(0);
    },
    err => {
        console.error(err);
        if (err instanceof Error) {
            console.error(err.stack);
            console.error(err.cause);
        }
        process.exit(1);
    });