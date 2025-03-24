import type { Build, Timeline } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import type { EmbeddedJobFailure } from "./embedding.mjs";
import path from "node:path";
import readline from "node:readline";
import * as fs from "node:fs";
import { fileExists, dirExists, mkdirp } from "./fs-helpers.mjs";
import { LlamaEmbedding } from "node-llama-cpp";
import { FailedJob } from "timeline-helpers.mjs";
import { ClusterDescriptor } from "./cluster.mjs";
import { asyncMapWithLimit } from "./async-map.mjs";

async function saveObject(
    objPath: string,
    obj: any,
) {
    await mkdirp(path.dirname(objPath));
    await fs.promises.writeFile(
        objPath,
        JSON.stringify(obj, null, 2),
        { encoding: 'utf-8' },
    );
}

async function loadObject(
    objPath: string,
): Promise<any | undefined> {
    if (await fileExists(objPath)) {
        const obj = await fs.promises.readFile(objPath, { encoding: 'utf-8' });
        return JSON.parse(obj);
    }
    return undefined;
}

export class LogDir {
    constructor(private outDir: string) { }

    private getBase() {
        return path.join(this.outDir, 'logs');
    }

    getLogDirForBuild(buildId: number) {
        return path.join(this.getBase(), buildId.toString());
    }
    getEmbedsDirForBuild(buildId: number) {
        return path.join(this.getBase(), buildId.toString());
    }
    private logName(logId: number) {
        return `log-${logId}.txt`;
    }
    getPathForBuildLog(buildId: number, logId: number) {
        return path.join(this.getLogDirForBuild(buildId), this.logName(logId));
    }

    async saveBuild(buildId: number, build: Build) {
        await saveObject(path.join(this.getLogDirForBuild(buildId), "build.json"), build)
    }
    async loadBuild(buildId: number): Promise<Build | undefined> {
        return await loadObject(path.join(this.getLogDirForBuild(buildId), "build.json"))
    }
    /// Returns a list of build IDs
    async listBuilds(): Promise<number[]> {
        const buildsDir = this.getBase();
        if (!await dirExists(buildsDir)) {
            return [];
        }
        const buildDirs = await fs.promises.readdir(buildsDir);
        let results = await asyncMapWithLimit(
            buildDirs,
            async (dir) => {
                // check if it is a directory
                const dirPath = path.join(buildsDir, dir);
                if (!(await fs.promises.stat(dirPath)).isDirectory()) {
                    return null
                }
                const dirNum = parseInt(dir);
                if (isNaN(dirNum)) {
                    throw new Error(`Invalid build directory: ${dir}`);
                }
                return dirNum;
            });
        return results.filter((result) => result !== null) as number[];
    }

    getTimelinePathForBuild(buildId: number) {
        return path.join(this.getLogDirForBuild(buildId), 'timeline.json');
    }
    async saveTimeline(buildId: number, timeline: Timeline) {
        await saveObject(this.getTimelinePathForBuild(buildId), timeline);
    }
    async loadTimeline(buildId: number): Promise<Timeline | undefined> {
        return await loadObject(this.getTimelinePathForBuild(buildId));
    }

    async saveLog(
        buildId: number,
        logId: number,
        logContentStream: NodeJS.ReadableStream,
    ) {
        const logPath = this.getPathForBuildLog(buildId, logId);
        const logPartPath = logPath + ".part";
        // streaming write the log content stream to a file
        let logFile = fs.createWriteStream(logPartPath);
        logContentStream.on("data", (chunk) => {
            logFile.write(chunk);
        });
        // wait for the log content stream to close the file and reject/resolve this promise
        await new Promise((resolve, reject) => {
            logContentStream.on("end", () => {
                logFile.close(() => {
                    resolve(undefined);
                });
            });
            logContentStream.on("error", (err) => {
                logFile.close(() => {
                    reject(err);
                });
            });
        });
        // rename the file to remove the .part extension
        await fs.promises.rename(logPartPath, logPath);
    }
    async loadLogLines(
        buildId: number,
        logId: number,
        handleLine: (line: string) => string | null,
    ): Promise<string | undefined> {
        const logPath = this.getPathForBuildLog(buildId, logId);
        if (!await fileExists(logPath)) {
            return undefined;
        }

        const logFile = fs.createReadStream(logPath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
            input: logFile,
            // Note: we use the crlfDelay option to recognize all instances of CR LF
            // ('\r\n') in input.txt as a single line break.
            crlfDelay: Infinity
        });
        let lines: string[] = [];
        for await (const line of rl) {
            let processedLine = handleLine(line);
            if (typeof processedLine == 'string') {
                lines.push(processedLine);
            }
        }
        rl.close();
        logFile.destroy();
        return lines.join('\n');
    }
    async loadLog(
        buildId: number,
        logId: number,
    ): Promise<string | undefined> {
        const logPath = this.getPathForBuildLog(buildId, logId);
        if (await fileExists(logPath)) {
            return await fs.promises.readFile(logPath, { encoding: 'utf-8' });
        }
        return undefined;
    }
    async hasLog(
        buildId: number,
        logId: number,
    ): Promise<boolean> {
        const logPath = this.getPathForBuildLog(buildId, logId);
        return await fileExists(logPath);
    }
}


async function* listAllBuildJobEmbeddings(d: EmbedDir) {
    const baseDir = d.getBase();
    if (!await dirExists(baseDir)) {
        return;
    }

    const embedFiles = await fs.promises.readdir(baseDir);
    for (let file of embedFiles) {
        // read the directory
        const buildDir = path.join(baseDir, file);
        if (!await dirExists(buildDir)) {
            continue;
        }
        const jobEmbedFiles = await fs.promises.readdir(buildDir);
        for (let jobEmbedFile of jobEmbedFiles) {
            if (jobEmbedFile.startsWith('embed-') && jobEmbedFile.endsWith('.json')) {
                yield {
                    buildId: parseInt(file),
                    jobId: parseInt(jobEmbedFile.replace(/^embed-/, '').replace(/\.json$/, '')),
                };
            }
        }
    }
}

export class EmbedDir {
    constructor(private outDir: string) { }

    getBase() {
        return path.join(this.outDir, 'embed');
    }

    getEmbedDirForBuild(buildId: number) {
        return path.join(this.getBase(), buildId.toString());
    }
    getEmbedFileForBuildJob(buildId: number, jobId: number) {
        return path.join(this.getEmbedDirForBuild(buildId), `embed-${jobId}.json`);
    }
    getCleanLogForBuildJob(buildId: number, logId: number) {
        return path.join(this.getEmbedDirForBuild(buildId), `cleanlog-${logId}.txt`);
    }
    getRawFileForBuildJob(buildId: number, jobId: number) {
        return path.join(this.getEmbedDirForBuild(buildId), `job-${jobId}.json`);
    }

    async saveBuildJobEmbeddings(
        buildId: number,
        embed: EmbeddedJobFailure,
        // optional string for the cleaned log to save alongside
        // the embeddings. This is just for debugging.
        cleanedLog?: string,
    ) {
        const toSimple = (embedding: LlamaEmbedding) => ({
            vector: Array.from(embedding.vector),
        });
        await saveObject(this.getEmbedFileForBuildJob(buildId, embed.jobId), {
            issues: embed.issues.map(toSimple),
            log: embed.log ? toSimple(embed.log) : undefined,
        });
        if (cleanedLog) {
            await fs.promises.writeFile(
                this.getCleanLogForBuildJob(buildId, embed.jobId),
                cleanedLog,
                { encoding: 'utf-8' },
            );
        } else {
            await fs.promises.unlink(
                this.getCleanLogForBuildJob(buildId, embed.jobId),
            ).catch(() => {
                // ignore if the file does not exist
            });
        }
    }
    async hasBuildJobEmbeddings(
        buildId: number,
        jobId: number,
    ): Promise<boolean> {
        return await fileExists(this.getEmbedFileForBuildJob(buildId, jobId));
    }
    listAllBuildJobEmbeddings() {
        return listAllBuildJobEmbeddings(this);
    }
    async getTotalJobEmbeddingCount(): Promise<number> {
        const baseDir = this.getBase();
        if (!await dirExists(baseDir)) {
            return 0;
        }
        const buildDirs = await fs.promises.readdir(baseDir);
        let count = 0;
        for (let buildDir of buildDirs) {
            const jobEmbedFiles = await fs.promises.readdir(path.join(baseDir, buildDir));
            count += jobEmbedFiles.filter(file => file.startsWith('embed-') && file.endsWith('.json')).length;
        }
        return count;
    }

    async loadBuildJobEmbeddings(
        buildId: number,
        jobId: number,
    ): Promise<EmbeddedJobFailure | undefined> {
        let raw = await loadObject(this.getEmbedFileForBuildJob(buildId, jobId));
        if (!raw) {
            return undefined;
        }

        // convert the raw object to an EmbeddedJobFailure object
        let issues = raw.issues.map((issue: any) => new LlamaEmbedding({
            vector: issue.vector,
        }))
        return {
            buildId,
            jobId,
            issues,
            log: raw.log ? new LlamaEmbedding({
                vector: raw.log.vector,
            }) : undefined,
        };
    }
    async saveBuildJobRaw(
        buildId: number,
        raw: FailedJob,
    ) {
        await saveObject(this.getRawFileForBuildJob(buildId, raw.id), raw);
    }
    async loadBuildJobRaw(
        buildId: number,
        jobId: number,
    ): Promise<FailedJob | undefined> {
        return await loadObject(this.getRawFileForBuildJob(buildId, jobId));
    }
}

export class ClustersDir {
    constructor(private outDir: string) { }

    private getBase() {
        return path.join(this.outDir, 'clusters');
    }

    getPathForClusterDescriptor(clusterName: string) {
        return path.join(this.getBase(), `cluster-${clusterName}.json`);
    }

    async saveClusterDescriptor(cluster: ClusterDescriptor) {
        await saveObject(this.getPathForClusterDescriptor(cluster.name), cluster);
    }
    async loadClusterDescriptor(clusterName: string): Promise<ClusterDescriptor | undefined> {
        let clusterDescriptor = await loadObject(this.getPathForClusterDescriptor(clusterName));
        if (!clusterDescriptor) {
            return clusterDescriptor;
        }
        if (clusterDescriptor.name !== clusterName) {
            throw new Error(`Cluster name mismatch: ${clusterDescriptor.name} !== ${clusterName}`);
        }
        return clusterDescriptor;
    }
    async listClusters(): Promise<string[]> {
        const clustersDir = this.getBase();
        if (!await dirExists(clustersDir)) {
            return [];
        }
        return await fs.promises.readdir(clustersDir).then(dirs => dirs.map(
            dir => dir.replace(/^cluster-/, '').replace(/\.json$/, '')
        ));
    }
}