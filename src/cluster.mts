import { EmbeddedJobFailure } from "embedding.mjs";

// References a failed job and the build it was a part of.
export type JobReference = {
    buildId: number;
    jobId: number;
}

export type ClusterDescriptor = {
    // Name of this cluster
    name: string;
    // Set of references to the jobs that define members of this cluster.
    //
    // New jobs that are sufficiently cosine-similar to both the issues and
    // the log text of the jobs in this cluster will be considered members
    // of this cluster.
    referenceJobs: JobReference[];
}

function issueSimilarity(job1: EmbeddedJobFailure, job2: EmbeddedJobFailure) {
    let maxSimilarity = 0.0;
    for (const issue of job1.issues) {
        for (const refIssue of job2.issues) {
            maxSimilarity = Math.max(maxSimilarity, issue.calculateCosineSimilarity(refIssue));
        }
    }
    return maxSimilarity;
}

export type CombinedSimilarity = {
    issuesSimilarity: number;
    logSimilarity: number;
    combined: number;
}

export class Cluster {
    constructor(
        public name: string,
        public referenceJobs: EmbeddedJobFailure[],
    ) { }

    addReferenceJob(
        job: EmbeddedJobFailure,
    ) {
        // Add a reference job to this cluster. This is used when
        // a new job is added to the cluster and we want to
        // add it to the list of reference jobs.
        this.referenceJobs.push(job);
    }

    getIssuesSimilarity(
        job: EmbeddedJobFailure,
    ) {
        // Find the maximum similarity between any two issue messages
        // between all reference jobs that define this cluster and
        // the passed-in job.
        let maxSim = 0.0;
        for (const refJob of this.referenceJobs) {
            maxSim = Math.max(maxSim, issueSimilarity(job, refJob));
        }

        return maxSim;
    }

    getLogSimilarity(
        job: EmbeddedJobFailure,
    ) {
        // Find the maximum similarity between the log messages of all
        // reference jobs that define this cluster and the passed-in job.
        let maxSim = 0.0;
        for (const refJob of this.referenceJobs) {
            if (job.log == null && refJob.log == null) {
                // if neither entry has logs, we consider them 100% similar
                return 1;
            } else if ((job.log == null) != (refJob.log == null)) {
                // logs are optional, so if one is null and the other is not,
                // we don't want to consider them similar
                continue;
            }
            maxSim = Math.max(maxSim, job.log!.calculateCosineSimilarity(refJob.log!));
        }

        return maxSim;
    }

    getSimilarity(
        job: EmbeddedJobFailure,
    ): CombinedSimilarity {
        const issuesSimilarity = this.getIssuesSimilarity(job);
        const logSimilarity = this.getLogSimilarity(job);
        return {
            issuesSimilarity,
            logSimilarity,
            // weigh the issues similarity more than the log similarity
            // because the logs are more noisy
            combined: (issuesSimilarity * 2 + logSimilarity) / 3,
        };
    }

    // Gets the average similarity between the reference jobs in the cluster
    getSelfSimilarity() {
        let sum = 0.0;
        let count = 0;
        for (let i = 0; i < this.referenceJobs.length; i++) {
            for (let j = 0; j < this.referenceJobs.length; j++) {
                if (i == j) {
                    continue;
                }
                sum += issueSimilarity(this.referenceJobs[i], this.referenceJobs[j]);
                count++;
            }
        }
        if (count == 0) {
            return 0;
        }
        return sum / count;
    }

    getDescriptor(): ClusterDescriptor {
        // Returns a descriptor of this cluster that can be used to
        // recreate it later.
        return {
            name: this.name,
            referenceJobs: this.referenceJobs.map((job) => ({
                buildId: job.buildId,
                jobId: job.jobId,
            })),
        };
    }
}

export type BestClusterMatch = {
    similarities: Map<string, CombinedSimilarity>,
    bestClusterName: string
}

export function matchBestCluster(
    clusters: Map<string, Cluster>,
    job: EmbeddedJobFailure,
): BestClusterMatch | null {
    // Find the best cluster for the given job.
    let bestClusterName: string | null = null;
    let similarities = new Map<string, CombinedSimilarity>();
    for (const [clusterName, cluster] of clusters) {
        const similarity = cluster.getSimilarity(job);
        similarities.set(clusterName, similarity);
        if (bestClusterName == null || similarity.combined > similarities.get(bestClusterName)!.combined) {
            bestClusterName = clusterName;
        }
    }
    if (bestClusterName == null) {
        return null;
    }
    return {
        similarities,
        bestClusterName,
    };
}
