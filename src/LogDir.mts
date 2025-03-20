import type { Build, Timeline } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import path from "node:path";
import * as fs from "node:fs";
import { fileExists, mkdirp } from "./fs-helpers.mjs";

export class LogDir {
    constructor(private outDir: string) {}

    private getBase() {
        return path.join(this.outDir, 'logs');
    }

    getLogDirForBuild(buildId: number) {
        return path.join(this.getBase(), buildId.toString());
    }

    private async saveObject(
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

    private async loadObject(
        objPath: string,
    ): Promise<any | undefined> {
        if (await fileExists(objPath)) {
            const obj = await fs.promises.readFile(objPath, { encoding: 'utf-8' });
            return JSON.parse(obj);
        }
        return undefined;
    }

    async saveBuild(buildId: number, build: Build) {
        await this.saveObject(path.join(this.getLogDirForBuild(buildId), "build.json"), build)
    }
    async loadBuild(buildId: number): Promise<Build | undefined> {
        return await this.loadObject(path.join(this.getLogDirForBuild(buildId), "build.json"))
    }
    /// Returns a list of build IDs
    async listBuilds(): Promise<number[]> {
        const buildsDir = this.getBase();
        if (!await fileExists(buildsDir)) {
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
        await this.saveObject(timelinePath, timeline);
    }
    async loadTimeline(buildId: number): Promise<Timeline | undefined> {
        return await this.loadObject(path.join(this.getLogDirForBuild(buildId), 'timeline.json'));
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