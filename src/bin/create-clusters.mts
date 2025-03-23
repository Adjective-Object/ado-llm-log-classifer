import * as path from 'node:path';
import { parseArgs, type ArgDescriptors } from '../args.mjs';
import { ClustersDir as ClusterDir, EmbedDir, LogDir } from '../LogDir.mjs';
import prompts from 'prompts'

import { Cluster, matchBestCluster } from '../cluster.mjs';
import color from 'cli-color';
import { cutoffColorize } from 'colorize-similarity.mjs';
import { printClusterSimilarities } from 'print-clusters.mjs';
import { printBuildInfo } from 'print-build.mjs';


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
    // create a colorizer based on the minimum combined cosine similarity
    let cformatSim = cutoffColorize(minCombinedCosineSim);

    let embedDir = new EmbedDir(args.outBaseDir);
    let logDir = new LogDir(args.outBaseDir);
    let clusterDir = new ClusterDir(args.outBaseDir);

    // load all the clusters
    const clusters = await clusterDir.loadAll(embedDir);
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

    // Cluster all the embeddings
    let jobTotal = await embedDir.getTotalJobEmbeddingCount();
    let jobCt = 0;
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

        // compute the similarity to each cluster
        let bestMatch = matchBestCluster(clusters, embedding);
        if (bestMatch) {
            printClusterSimilarities(bestMatch, cformatSim);
        }

        const jobRaw = await embedDir.loadBuildJobRaw(jobRef.buildId, jobRef.jobId);
        if (!jobRaw) {
            console.log("failed to look up job raw data. Can't print debug information about the job :(")
        } else {
            printBuildInfo(logDir, embedDir, jobRef, jobRaw);
        }
        console.log();

        if (bestMatch) {
            let bestSimilarity = bestMatch.similarities.get(bestMatch.bestClusterName);
            if (bestSimilarity == null) {
                throw new Error(`Internal error: cluster ${bestMatch.bestClusterName} not found in cluster similarities?`);
            } else if (bestSimilarity.combined < minCombinedCosineSim) {
                console.log(color.yellow(`Best match to existing cluster is a bad match: ${cformatSim(bestSimilarity.combined)} < ${cformatSim(minCombinedCosineSim)}`));
            } else {
                // best similarity is good enough, just add the job to the cluster
            }
        }

        const choices = Array.from(bestMatch?.similarities.entries() ?? [])
            .sort((a, b) => b[1].combined - a[1].combined)
            .map(
                ([clusterName,]) => ({ title: clusterName })
            );
        const getSuggestions = (input: string) =>
            input
                ? choices.filter(({ title }) => title.toLowerCase().startsWith(input.toLowerCase()))
                : choices;

        let selectedCluster = bestMatch?.bestClusterName;
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
                console.log("No cluster selected, exiting!");
                return;
            }

            selectedCluster = promptResult.cluster.trim();
        } while (!selectedCluster || selectedCluster.length === 0);

        // if the cluster already exists, add this job to it
        let cluster = clusters.get(selectedCluster);
        if (cluster == null) {
            // create a new cluster
            cluster = new Cluster(selectedCluster, []);
            clusters.set(selectedCluster, cluster);
        }
        // add the job to the cluster
        cluster.addReferenceJob(embedding);
        console.log(`Added job ${jobRef.buildId}-${jobRef.jobId} to cluster ${selectedCluster}`);

        // save the updated cluster descriptor to disk
        await clusterDir.saveClusterDescriptor(cluster.getDescriptor());
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