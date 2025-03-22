import * as path from 'node:path';
import { parseArgs, type ArgDescriptors } from './args.mjs';
import { ClustersDir as ClusterDir, EmbedDir } from './LogDir.mjs';

import { Cluster, ClusterDescriptor, CombinedSimilarity } from './cluster.mjs';
import ora from 'ora';

type Args = {
    help?: string;
    outBaseDir: string;
    minIssuesCosineSim: string;
    minLogCosineSim: string;
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
    minIssuesCosineSim: {
        shortName: 'i',
        helpDescription: 'The minimum cosine similarity to consider a log part of an existing category',
        default: "0.9",
    },
    minLogCosineSim: {
        shortName: 'l',
        helpDescription: 'The minimum cosine similarity to consider a log part of an existing category',
        default: "0.5",
    }
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

    // Create the output directory
    let embedDir = new EmbedDir(args.outBaseDir);
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

    // go through all the embeddings in the embed dir
    for await (let jobRef of embedDir.listAllBuildJobEmbeddings()) {
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
        spinner.succeed();
        console.log("cluster similarites", clusterSimilarities, "best cluster", bestCluster);
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