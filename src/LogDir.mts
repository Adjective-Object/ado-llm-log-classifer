import type { Build, Timeline } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import type { EmbeddedJobFailure } from "./embedding.mjs";
import path from "node:path";
import * as fs from "node:fs";
import { fileExists, dirExists, mkdirp } from "./fs-helpers.mjs";
import { LlamaEmbedding } from "node-llama-cpp";
import { FailedJob } from "timeline-helpers.mjs";

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
        return buildDirs.map((dir) => {
            const dirNum = parseInt(dir);
            if (isNaN(dirNum)) {
                throw new Error(`Invalid build directory: ${dir}`);
            }
            return dirNum;
        });
    }


    async saveTimeline(buildId: number, timeline: unknown) {
        const timelinePath = path.join(this.getLogDirForBuild(buildId), 'timeline.json');
        await saveObject(timelinePath, timeline);
    }
    async loadTimeline(buildId: number): Promise<Timeline | undefined> {
        return await loadObject(path.join(this.getLogDirForBuild(buildId), 'timeline.json'));
    }

    private logName(logId: number) {
        return `log-${logId}.txt`;
    }
    async saveLog(
        buildId: number,
        logId: number,
        logContentStream: NodeJS.ReadableStream,
    ) {
        const logPath = path.join(this.getLogDirForBuild(buildId), this.logName(logId));
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
    async loadLog(
        buildId: number,
        logId: number,
    ): Promise<string | undefined> {
        const logPath = path.join(this.getLogDirForBuild(buildId), this.logName(logId));
        if (await fileExists(logPath)) {
            return await fs.promises.readFile(logPath, { encoding: 'utf-8' });
        }
        return undefined;
    }
    async hasLog(
        buildId: number,
        logId: number,
    ): Promise<boolean> {
        const logPath = path.join(this.getLogDirForBuild(buildId), this.logName(logId));
        return await fileExists(logPath);
    }
}

export class EmbedDir {
    constructor(private outDir: string) { }

    private getBase() {
        return path.join(this.outDir, 'embed');
    }

    getEmbedDirForBuild(buildId: number) {
        return path.join(this.getBase(), buildId.toString());
    }
    getEmbedFileForBuildJob(buildId: number, logId: number) {
        return path.join(this.getEmbedDirForBuild(buildId), `embed-${logId}.json`);
    }
    getRawFileForBuildJob(buildId: number, logId: number) {
        return path.join(this.getEmbedDirForBuild(buildId), `job-${logId}.json`);
    }

    async saveBuildJobEmbeddings(
        buildId: number,
        embed: EmbeddedJobFailure,
    ) {
        const toSimple = (embedding: LlamaEmbedding) => ({
            vector: Array.from(embedding.vector),
        });
        await saveObject(this.getEmbedFileForBuildJob(buildId, embed.jobId), {
            issues: embed.issues.map(toSimple),
            log: embed.log ? toSimple(embed.log) : undefined,
        });
    }
    async hasBuildJobEmbeddings(
        buildId: number,
        jobId: number,
    ): Promise<boolean> {
        return await fileExists(this.getEmbedFileForBuildJob(buildId, jobId));
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