import ora from 'ora';
import * as ado from 'azure-devops-node-api';
import path from 'node:path';
import * as bi from 'azure-devops-node-api/interfaces/BuildInterfaces.js';
import type { PagedList } from 'azure-devops-node-api/interfaces/common/VSSInterfaces.js';
import type { IBuildApi } from 'azure-devops-node-api/BuildApi.js';
import type { IRequestOptions, IRestResponse } from 'typed-rest-client';
import type { GitRepository } from 'azure-devops-node-api/interfaces/GitInterfaces.js';
import { ClustersDir, LogDir } from '../LogDir.mjs';
import { getLeafFailedLogIds } from '../timeline-helpers.mjs';
import { catchOra } from '../ora-helpers.mjs';
import { parseArgs, type ArgDescriptors } from '../args.mjs';
import { withOra } from '../ora-helpers.mjs';
import { asyncMapWithLimit } from 'async-map.mjs';

type Args = {
    help?: string;
    patToken: string;
    orgName: string;
    projectName: string;
    repo: string;
    branch: string;
    outBaseDir: string;
    continuationToken?: string;
};

const argDescriptors: ArgDescriptors<Args> = {
    help: {
        shortName: 'h',
        helpDescription: 'Print this help message',
    },
    patToken: {
        shortName: 'p',
        helpDescription: 'Azure DevOps Personal Access Token',
        missingPrompt: 'ADO Access Token (with build:read and code:read)',
    },
    orgName: {
        shortName: 'n',
        helpDescription: 'Azure DevOps Organization Name',
        missingPrompt: 'ADO Organization Name',
    },
    projectName: {
        shortName: 'j',
        helpDescription: 'Azure DevOps Project Name',
        missingPrompt: 'ADO Project Name',
    },
    repo: {
        shortName: 'r',
        helpDescription: 'Azure DevOps Repository Name',
        missingPrompt: 'ADO Repository Name',
    },
    branch: {
        shortName: 'br',
        helpDescription: 'Azure DevOps Branch Name',
        missingPrompt: 'ADO Branch Name',
    },
    outBaseDir: {
        shortName: 'o',
        helpDescription: 'The base directory to save the output files',
        default: "./out",
    },
    continuationToken: {
        shortName: 'c',
        helpDescription: 'Continuation token for pagination',
    },
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

async function downloadLogContent(args: Args, buildAPI: IBuildApi, logDir: LogDir, buildId: number, logId: number): Promise<boolean> {
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

async function main() {
    let args = await parseArgs(
        'dl-logs',
        argDescriptors,
        (args: Partial<Args>) => path.join(args.outBaseDir ?? "out", "dl-logs-args.json"),
    );
    if (args == null) {
        return;
    }

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


    let logDir = new LogDir(args.outBaseDir);

    // check if we have clusters defined
    let clusterDir = new ClustersDir(args.outBaseDir);
    let referenceJobs = new Set((await asyncMapWithLimit(await clusterDir.listClusters(), async (clusterName) => {
        let cluster = await clusterDir.loadClusterDescriptor(clusterName);
        return cluster?.referenceJobs.map((job) => job.buildId);
    })).flat().filter((x) => typeof x === 'number'))
    // ensure all the reference jobs are downloaded before we start downloading logs
    if (referenceJobs.size > 0) {
        console.log("Fetching builds/jobs referenced by clusters...");
        let spinner = ora({
            text: "fetching reference jobs..",
        }).start();
        let jobsArr = Array.from(referenceJobs);
        for (let buildId of jobsArr) {
            let build = await logDir.loadBuild(buildId);
            let bDownloaded = false
            if (build == null) {
                bDownloaded = true
                build = await buildAPI.getBuild(args.projectName, buildId);
                // save the build to a file, locally
                await logDir.saveBuild(buildId, build);
            }
            let [timeline, tDownloaded] = await getTimeline(args, logDir, buildAPI, buildId);
            let leafFailedLogIds = await getLeafFailedLogIds(timeline);
            let lDownloaded = false;
            for (let logId of leafFailedLogIds) {
                lDownloaded = await downloadLogContent(args, buildAPI, logDir, buildId, logId) || lDownloaded;
            }
            spinner.succeed(`reference build ${buildId} ready (build:${!bDownloaded ? "cached" : "fetched"} timeline:${!tDownloaded ? "cached" : "fetched"} log:${!lDownloaded ? "cached" : "fetched"})`);
            spinner = ora({
                text: "fetching reference jobs.."
            })
        }
    }

    // start bulk downloading the logs
    console.log("Starting bulk download of logs...");

    let continuationToken: string | undefined = args.continuationToken;
    let page = 0;
    let buildCt = 0;
    let logCt = 0;
    do {
        page++;

        // get the logs page and save its continuation token for the next loop
        console.log(`continuationToken=${continuationToken}`)
        let builds: PagedList<bi.Build> = await withOra(
            getBuildsPage(args, buildAPI, targetRepo, continuationToken),
            `pg:${page} fetching page`,
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
            if (build.result === bi.BuildResult.Succeeded ||
                build.result === bi.BuildResult.Canceled ||
                build.result === bi.BuildResult.None
            ) {
                console.log(`    build:${buildCt} (id:${build.id}) ${bi.BuildResult[build.result].toLocaleLowerCase()}, skipping`);
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
            let [timeline, timelineWasDownloaded] = await getTimeline(args, logDir, buildAPI, buildId).catch(catchOra(buildSpinner));
            let leafFailedLogIds = await getLeafFailedLogIds(timeline);

            if (leafFailedLogIds.length == 0) {
                buildSpinner.succeed(`build:${buildCt} (id:${build.id}) no failed logs`);
            } else {
                // download the logs for this build
                let skipCount = 0
                for (let [i, failedLogID] of leafFailedLogIds.entries()) {
                    buildSpinner.text = `build:${buildCt} (id:${build.id}) log:${i + 1}/${leafFailedLogIds.length} (id:${failedLogID})`;
                    let wasDownloaded = await downloadLogContent(args, buildAPI, logDir, buildId, failedLogID).catch(catchOra(buildSpinner));
                    if (wasDownloaded) {
                        logCt++;
                    } else {
                        skipCount++;
                    }
                }
                buildSpinner.succeed(
                    `build:${buildCt} (id:${build.id}) downloaded ${leafFailedLogIds.length} logs (${skipCount} skipped).${!timelineWasDownloaded ? " (timeline skipped)" : ""}`);
            }
        }

        console.log(`total_builds:${buildCt} total_logs:${logCt}`);

    } while (continuationToken != null);
    console.log("\nFinished downloading logs");
}

main().then(() => {
    console.log("done");
}, (err) => {
    console.error(err);
    console.error(err.stack);
    process.exit(1);
});