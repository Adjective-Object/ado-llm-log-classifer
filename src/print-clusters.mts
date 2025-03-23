import { BestClusterMatch, Cluster, CombinedSimilarity } from "cluster.mjs";
import color from "cli-color";

export function printClusterInfos(
    clusters: Map<string, Cluster>,
    cformatSim: (num: number) => string,
) {
    console.log(`Clusters:`);
    for (let [clusterName, cluster] of clusters) {
        console.log(`  ${color.blue(clusterName)}:`);
        console.log(`    reference job${(cluster.referenceJobs.length > 1) ? "s" : ""
            }:`, cluster.referenceJobs.map(job => `${job.buildId}-${job.jobId}`).join(", "));
        console.log(`    self-similarity: ${cformatSim(cluster.getSelfSimilarity())}`);
    }
}

export function printClusterSimilarities(
    match: BestClusterMatch,
    cformatSim: (num: number) => string,
) {
    console.log(`\n  ${color.bold("Similarities")}:`);
    let sortedClusterSimilarities = Array.from(match.similarities.entries()).sort((a, b) => b[1].combined - a[1].combined);

    let maxClusterLen = Math.max(...sortedClusterSimilarities.map(([clusterName]) => clusterName.length));

    for (let [clusterName, similarity] of sortedClusterSimilarities) {
        console.log(`    ${color.blue(clusterName)}:${' '.repeat(maxClusterLen - clusterName.length)
            }\tcombo: ${cformatSim(similarity.combined)
            }\tissues: ${cformatSim(similarity.issuesSimilarity)}\tlogs: ${cformatSim(similarity.logSimilarity)} `);
    }
}