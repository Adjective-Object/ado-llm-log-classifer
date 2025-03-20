import minimist from 'minimist';
import input from "@inquirer/input";
import ora, { type Ora } from 'ora';
import * as ado from 'azure-devops-node-api';
import path from 'node:path';
import fs from 'node:fs';
import * as bi from 'azure-devops-node-api/interfaces/BuildInterfaces.js';
import type { PagedList } from 'azure-devops-node-api/interfaces/common/VSSInterfaces.js';
import type { IBuildApi } from 'azure-devops-node-api/BuildApi.js';
import type { IRequestOptions, IRestResponse } from 'typed-rest-client';
import type { GitRepository } from 'azure-devops-node-api/interfaces/GitInterfaces.js';
import { LogDir } from './LogDir.mjs';
import { getLeafFailedLogIds } from './timeline-helpers.mjs';
import { mkdirp } from './fs-helpers.mjs';
import type { Timeline } from 'azure-devops-node-api/interfaces/TestInterfaces.js';


type Args = {
    help: boolean;
    patToken: string;
    orgName: string;
    projectName: string;
    repo: string;
    branch: string;
    out: string;
    continuationToken?: string;
};

function printHelp() {
    console.log("Usage: node src/index.js [options]");
    console.log("Options:");
    console.log("  -h, --help        Show help");
    console.log("  -p, --patToken    Azure DevOps Personal Access Token");
    console.log("  -n, --orgName     Azure DevOps Organization Name");
    console.log("  -j, --projectName Azure DevOps Organization Name");
    console.log("  -r, --repo        Repository Name");
    console.log("  -br, --branch     Branch Name");
    console.log("  -o, --out         Output Directory (default: ./out)");

    return;
}

async function getBuildsPage(args: Args, buildAPI: IBuildApi, targetRepo: GitRepository, continuationToken: string | undefined): Promise<PagedList<bi.Build>> {
    return await buildAPI.getBuilds(
        args.projectName,                           // project: string
        undefined,                                  // definitions: number[] 
        undefined,                                  // queues: number[]
        undefined,                                  // buildNumber
        new Date(2016, 1, 1),                       // minFinishTime
        undefined,                                  // maxFinishTime
        undefined,                                  // requestedFor: string
        bi.BuildReason.All ^ bi.BuildReason.Manual, // reason
        bi.BuildStatus.Completed,                   // statusFilter  
        bi.BuildResult.Canceled
        | bi.BuildResult.Failed
        | bi.BuildResult.PartiallySucceeded
        | bi.BuildResult.Succeeded,                 // buildResultFilter
        undefined,                                  // tagFilters: string[]
        undefined,                                  // properties: string[]
        10,                                         // top: number
        continuationToken,                          // continuationToken: string
        undefined,                                  // maxBuildsPerDefinition
        undefined,                                  // deletedFilter
        undefined,                                  // queryOrder
        args.branch,                                // branchName: string
        undefined,                                  // buildIds: number[]
        targetRepo.id,                              // repositoryId: string
        // This value is not documented anywhere, but this was an educated guess based on the old tfs api
        // See: https://learn.microsoft.com/en-us/dotnet/api/microsoft.teamfoundation.build.webapi.repositorytypes
        "tfsGit",                  // repositoryType: string
    )
}

function fileExists(filePath: string): Promise<boolean> {
    return fs.promises.stat(filePath).then(x => x.isFile()).catch(() => false)
}

function getBuildDir(args: Args, buildId: number): string {
    return path.join(args.out, "logs", buildId.toString());
}

async function downloadLogContent(args: Args, buildAPI: IBuildApi, logDir:LogDir, buildId: number, logId: number): Promise<boolean> {
    // check if the log file already exists
    if (await logDir.hasLog(buildId, logId)) {
        return false;
    }
    let logContentStream = await buildAPI.getBuildLog(args.projectName, buildId, logId);
    await logDir.saveLog(buildId, logId, logContentStream);
    return true
}

async function getTimeline(args: Args, logDir: LogDir, buildAPI: IBuildApi, buildId: number): Promise<[bi.Timeline, boolean]> {
    let timeline = await logDir.loadTimeline(buildId);
    if (timeline) {
        return [timeline, false];
    }
    // instead, download the timeline and save it to a file
    timeline = await buildAPI.getBuildTimeline(args.projectName, buildId);
    await logDir.saveTimeline(buildId, timeline);
    return [timeline, true];
}

async function getArgs(): Promise<Args | null> {
    let pArgs = minimist(process.argv.slice(2), {
        alias: {
            h: "help",
            p: "patToken",
            br: "branch",
            n: "orgName",
            j: "projectName",
            r: "repo",
            o: "out",
            c: "continuationToken",
        },
    });

    if (pArgs.help) {
        printHelp();
        return null
    }

    if (!pArgs.out) {
        pArgs.out = './out';
    }

    // check if the out directory exists, if not create it
    await mkdirp(pArgs.out);
    // check if the args.json file exists, if so, read it and parse it
    const argsFilePath = path.join(pArgs.out, "dl-logs-args.json");
    if (await fileExists(argsFilePath)) {
        let args = await fs.promises.readFile(argsFilePath, "utf-8");
        let argsObj = JSON.parse(args);
        for (let key in argsObj) {
            if (!Object.hasOwnProperty.call(pArgs, key)) {
                // @ts-ignore
                console.log(`Using saved value for args.${key} from args file`);
                pArgs[key] = argsObj[key];
            }
        }
    }


    // prompt the user for missing fields
    if (!pArgs.patToken) {
        pArgs.patToken = await input({
            message: "ADO PAT token (with build:read and code:read access):",
            required: true,
        });
    }
    if (!pArgs.orgName) {
        pArgs.orgName = await input({
            message: "ADO organization",
            required: true,
        });
    }
    if (!pArgs.projectName) {
        pArgs.projectName = await input({
            message: "ADO project name",
            required: true,
        });
    }
    if (!pArgs.repo) {
        pArgs.repo = await input({
            message: `Repository from ${pArgs.orgName}`,
            required: true,
        });
    }
    if (!pArgs.branch) {
        pArgs.branch = await input({
            message: `Branch of ${pArgs.orgName}:${pArgs.projectName}/${pArgs.repo}`,
            required: true,
        });
    }

    // assert all fields of pArgs are populated
    delete (pArgs as any)["_"];
    delete (pArgs as any)["--"];
    let args: Args = pArgs as unknown as Args;

    console.log("Arguments:\n" + Object.entries(args).map(([k, v]) => `  ${k}: ${v}`).join("\n"));

    console.log("saving arguments for future runs...")
    // save the arguments to a json file in the out directory
    await fs.promises.mkdir(args.out, { recursive: true });
    await fs.promises.writeFile(argsFilePath, JSON.stringify(args, null, 2));

    return args
}

function spinErr(spinner: Ora) {
    return (err: Error) => {
        spinner.fail();
        throw err;
    };
}

async function main() {
    let a = await getArgs();
    if (a == null) {
        return;
    }
    let args: Args = a;

    // Create ADO client
    console.log("Getting build metadata...");
    const client = new ado.WebApi(`https://dev.azure.com/${encodeURIComponent(args.orgName)}`, ado.getPersonalAccessTokenHandler(args.patToken));

    const buildAPI = await client.getBuildApi();

    // Azure devops provides a fundamentally broken node api and has for years.
    // 
    // It doesn't look like they are going to fix it any time soon, so we have to
    // // monkey patch the rest client to get the continuation token from the headers.
    //
    // See:         https://github.com/microsoft/azure-devops-node-api/issues/493
    // See also:    https://github.com/microsoft/azure-devops-node-api/issues/609
    let oldget = client.rest.get;
    let lastContinuationToken: string | undefined = undefined;
    buildAPI.rest.get = async function <T>(resource: string, options?: IRequestOptions | undefined): Promise<IRestResponse<T>> {
        let restResponse = await oldget.apply(this, [resource, options]) as IRestResponse<T>
        lastContinuationToken = (restResponse.headers as any)["x-ms-continuationtoken"];
        (restResponse.result as any).continuationToken = continuationToken;
        return restResponse;
    };

    // get the internal ID of the repo form ado
    let gitAPI = await client.getGitApi();
    let repos = await gitAPI.getRepositories(args.projectName);
    let targetRepo = repos.find((repo) => repo.name === args.repo);
    if (targetRepo == null) {
        console.error(`Repository ${args.repo} not found in project ${args.projectName}`);
        return;
    }

    // start bulk downloading the logs
    console.log("Starting bulk download of logs...");

    let logDir = new LogDir(args.out);

    let continuationToken: string | undefined = args.continuationToken;
    let page = 0;
    let buildCt = 0;
    let logCt = 0;
    do {
        page++;

        // get the logs page and save its continuation token for the next loop
        let pageSpinner = ora(`pg:${page} fetching page with continuationToken=${continuationToken}`).start();
        let builds: PagedList<bi.Build> = await getBuildsPage(args, buildAPI, targetRepo, continuationToken).catch(spinErr(pageSpinner));
        pageSpinner.succeed(
            `pg:${page} fetched ${builds.length} builds`,
        );
        continuationToken = lastContinuationToken;

        // download the logs for this page
        for (let build of builds) {
            buildCt++;
            // save the build to a file, locally
            let buildId = build.id;
            if (buildId == null) {
                console.error("Build ID is null, skipping build", build);
                return;
            }

            // save the build json to a file
            await logDir.saveBuild(buildId, build);

            // if the build is a success, don't download the build logs
            if (build.result === bi.BuildResult.Succeeded) {
                console.log(`    build:${buildCt} (id:${build.id}) succeeded, skipping`);
                continue;
            } else if (!build.result) {
                console.log(`    build:${buildCt} (id:${build.id}) has no result, skipping`);
                continue
            }

            // download the build timeline
            let buildSpinner = ora({
                text: `build:${buildCt} (id:${build.id}) fetching timeline`,
                indent: 2
            }).start();
            let [timeline, timelineWasDownloaded] = await getTimeline(args, logDir, buildAPI, buildId).catch(spinErr(buildSpinner));
            let leafFailedLogIds = await getLeafFailedLogIds(timeline);

            if (leafFailedLogIds.length == 0) {
                buildSpinner.succeed(`build:${buildCt} (id:${build.id}) no failed logs`);
            } else {
                // download the logs for this build
                let skipCount = 0
                for (let [i,id] of leafFailedLogIds.entries()) {
                    let failedLogID = leafFailedLogIds[i];
                    buildSpinner.text = `build:${buildCt} (id:${build.id}) log:${i + 1}/${leafFailedLogIds.length} (id:${failedLogID})`;
                    let wasDownloaded = await downloadLogContent(args, buildAPI, logDir, buildId, failedLogID).catch(spinErr(buildSpinner));
                    if (wasDownloaded) {
                        logCt++;
                    } else {
                        skipCount++;
                    }
                }
                buildSpinner.succeed(`build:${buildCt} (id:${build.id}) downloaded ${leafFailedLogIds.length} logs (${skipCount} skipped).${
                    !timelineWasDownloaded ? " (timeline skipped)" : ""
                }`);
            }
        }

        console.log(`total_builds:${buildCt} total_logs:${logCt}`);

    } while (continuationToken != null);
    console.log("\r\nFinished downloading logs");
}

// if __name__ == "__main__": for node
main().then(() => {
    console.log("done");
}, (err) => {
    console.error(err);
    console.error(err.stack);
    process.exit(1);
});