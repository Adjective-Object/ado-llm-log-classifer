import v8flags from 'v8flags';
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
import * as rm from 'typed-rest-client/RestClient.js';
import type { GitRepository } from 'azure-devops-node-api/interfaces/GitInterfaces.js';

function _ora(msg: string): Ora {
    if (process.stdout.isTTY || process.stdin.isTTY) {
        return ora(msg);
    } else {
        return {
            start: console.log,
            succeed: console.log,
            fail: console.log,
            text: msg,
        } as unknown as Ora;
    }
}

type Args = {
    help: boolean;
    patToken: string;
    orgName: string;
    projectName: string;
    repo: string;
    branch: string;
    out: string;
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

async function downloadLogContent(args: Args, buildAPI: IBuildApi, buildId: number, logId: number) {
    let pathBase = path.join(args.out, buildId.toString(), logId.toString());

    // check if the log file already exists, if so, skip it
    if (await fileExists(pathBase + ".log")) {
        return;
    }

    let logContentStream = await buildAPI.getBuildLog(args.projectName, buildId, logId);
    // streaming write the log content stream to a file
    let logFile = fs.createWriteStream(pathBase + ".log.part");
    logContentStream.on("data", (chunk) => {
        logFile.write(chunk);
    });
    // wait for the log content stream to close the file and reject/resolve this promise
    await new Promise((resolve, reject) => {
        logContentStream.on("end", () => {
            logFile.close();
            resolve(undefined);
        });
        logContentStream.on("error", (err) => {
            logFile.close();
            reject(err);
        });
    });
    // rename the file to remove the .part extension
    await fs.promises.rename(pathBase + ".log.part", pathBase + ".log");
}

async function getBuildTimeline(args: Args, buildAPI: IBuildApi, buildId: number) {
    const timelinePath = path.join(args.out, buildId.toString(), "timeline.json");
    // check if the timeline file already exists, if so, read and return it
    if (await fileExists(timelinePath)) {
        let timeline = await fs.promises.readFile(timelinePath, "utf-8");
        return JSON.parse(timeline) as bi.Timeline;
    }

    // instead, download the timeline and save it to a file
    let timeline = await buildAPI.getBuildTimeline(args.projectName, buildId);
    // save the timeline to a file
    await fs.promises.mkdir(path.join(args.out, buildId.toString()), { recursive: true });
    await fs.promises.writeFile(timelinePath, JSON.stringify(timeline, null, 2));
    return timeline;
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
    await fs.promises.mkdir(pArgs.out, { recursive: true });
    // check if the args.json file exists, if so, read it and parse it
    let argsFile = path.join(pArgs.out, "args.json");
    if (await fileExists(argsFile)) {
        let args = await fs.promises.readFile(argsFile, "utf-8");
        let argsObj = JSON.parse(args);
        for (let key in argsObj) {
            if (!Object.hasOwnProperty.call(pArgs, key)) {
                // @ts-ignore
                console.log(`Using saved value for args.${key} from args file`);
                pArgs[key] = argsObj[key];
            }
        }
    }

    let argsDirty = false

    // prompt the user for missing fields
    if (!pArgs.patToken) {
        argsDirty = true;
        pArgs.patToken = await input({
            message: "ADO PAT token (with build:read and code:read access):",
            required: true,
        });
    }
    if (!pArgs.orgName) {
        argsDirty = true;
        pArgs.orgName = await input({
            message: "ADO organization",
            required: true,
        });
    }
    if (!pArgs.projectName) {
        argsDirty = true;
        pArgs.projectName = await input({
            message: "ADO project name",
            required: true,
        });
    }
    if (!pArgs.repo) {
        argsDirty = true;
        pArgs.repo = await input({
            message: `Repository from ${pArgs.orgName}`,
            required: true,
        });
    }
    if (!pArgs.branch) {
        argsDirty = true;
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

    if (argsDirty) {
        console.log("saving arguments for future runs...")
        // save the arguments to a json file in the out directory
        await fs.promises.mkdir(args.out, { recursive: true });
        await fs.promises.writeFile(path.join(args.out, "args.json"), JSON.stringify(args, null, 2));
    }

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

    let continuationToken: string | undefined = undefined;
    let page = 0;
    let buildCt = 0;
    do {
        page++;

        // get the logs page and save its continuation token for the next loop
        let pageSpinner = _ora(`pg:${page} fetching page of builds`).start();
        let builds: PagedList<bi.Build> = await getBuildsPage(args, buildAPI, targetRepo, continuationToken).catch(spinErr(pageSpinner));
        pageSpinner.succeed(
            `pg:${page} fetched ${builds.length} builds`,
        );
        continuationToken = lastContinuationToken;
        console.log(`  pg:${page} continuationToken: ${continuationToken}`);

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
            await fs.promises.mkdir(path.join(args.out, buildId.toString()), { recursive: true });
            await fs.promises.writeFile(path.join(args.out, buildId.toString(), "build.json"), JSON.stringify(build, null, 2));

            // if the build is a success, don't download the build logs
            if (build.result === bi.BuildResult.Succeeded) {
                console.log(`    build:${buildCt} (id:${build.id}) succeeded, skipping`);
                continue;
            } else if (!build.result) {
                console.log(`    build:${buildCt} (id:${build.id}) has no result, skipping`);
                continue
            }

            // download the build timeline
            let buildSpinner = _ora(`  build:${buildCt} (id:${build.id}) fetching timeline`).start();
            let timeline = await getBuildTimeline(args, buildAPI, buildId).catch(spinErr(buildSpinner));
            let records = timeline.records ?? [];
            let allParentTimelineEntryRecords = new Set();
            for (let record of records) {
                if (record.parentId != null) {
                    allParentTimelineEntryRecords.add(record.parentId);
                }
            }
            let leafFailedLogIds = (timeline.records ?? [])
                .filter((record) => record.result == bi.TaskResult.Failed && !allParentTimelineEntryRecords.has(record.id))
                .map((record) => record.log?.id)
                .filter((logId) => logId != null);

            if (leafFailedLogIds.length == 0) {
                buildSpinner.succeed(`  build:${buildCt} (id:${build.id}) no failed logs`);
            } else {
                // download the logs for this build
                for (let i = 0; i < leafFailedLogIds.length; i++) {
                    let failedLogID = leafFailedLogIds[i];
                    buildSpinner.text = `  build:${buildCt} (id:${build.id}) failed log:${i + 1}/${leafFailedLogIds.length} (${failedLogID})`;
                    await downloadLogContent(args, buildAPI, buildId, failedLogID).catch(spinErr(buildSpinner));
                }
                buildSpinner.succeed(`  build:${buildCt} (id:${build.id}) downloaded ${leafFailedLogIds.length} failed logs`);
            }
        }
    } while (continuationToken != null);
    console.log("\r\nFinished downloading logs");
}

// if __name__ == "__main__": for node
main().then(() => {
    console.log("done");
}, (err) => {
    console.error(err);
    process.exit(1);
});